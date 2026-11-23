"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { cancelIssue, issueStock, issueStockMany, IssueError, ISSUE_STORNO, parseIssueTarget, type IssueStockResult } from "@/lib/stock-issue";
import { upsertRecipient, setRecipientActive } from "@/lib/stock-recipients";
import { dateRu, isoDate } from "@/lib/format";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canDo } from "@/lib/permissions";
import { notifyDriverIssue } from "@/lib/driver-stock";
import type { BulkStornoResult } from "../prixod/actions";

/**
 * Sklad → «Chiqim» (avval «Расход»). Xato matnlari o'zbekcha, «Рус» rejimida lug'atdan.
 * Kim: `stock` → `issue` amali (lib/permissions.ts) — Sklad, Snabjeniye, direktor va u ruxsat bergan xodim.
 * Mantiq `lib/stock-issue.ts` (berish) va `lib/stock-recipients.ts` («Kimga» ro'yxati) da — mobil/ECO ham shulardan.
 */

const refresh = () => {
  revalidatePath("/stock"); revalidatePath("/stock/rasxod"); revalidatePath("/brigades");
  revalidatePath("/production"); revalidatePath("/dashboard"); revalidatePath("/snabjeniye");
  revalidatePath("/logistika/tabel");
};

const schema = z.object({
  warehouseId: zStr("Skladni tanlang"),
  // Bitta chiqim — `to`; bir oynada bir nechta oluvchi — `to[]` (har chiqimga bittadan, tartib bilan)
  to: z.union([z.string(), z.array(z.string())]).optional(),
  date: zOpt,
  note: zOpt,
  clientToken: zOpt,
  // «Tuzatish»: bekor qilingan chiqim hujjati (`ref`) — o'sha sanada qayta yozishga ruxsat (31 kunlik chegaradan tashqari)
  copyOf: zOpt,
  materialId: z.array(z.string(), { message: "Kamida bitta qator qo'shing" }).min(1, "Kamida bitta qator qo'shing"),
  qty: z.array(z.string(), { message: "Miqdorni kiriting" }),
  // Qator qaysi chiqimga tegishli (`to[]` indeksi); yo'q bo'lsa — hammasi birinchisiga
  grp: z.array(z.string()).optional(),
});

/**
 * Yangi chiqim: qatorlar `materialId[]` + `qty[]`, «Kimga» — "r:<id>" | "b:<id>" | "e:<id>" | "v:<id>".
 * Bir oynada bir nechta oluvchiga: `to[]` + har qatorda `grp[]` — har oluvchiga alohida hujjat, hammasi bitta
 * tranzaksiyada (`issueStockMany`): birortasida qoldiq yetmasa, hech biri yozilmaydi. Muvaffaqiyatda → /stock/rasxod.
 */
export async function createRasxod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "issue");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const tos = Array.isArray(d.to) ? d.to : [d.to ?? ""];
  const multi = tos.length > 1;
  const groups = tos.map((raw) => ({ to: parseIssueTarget(raw), items: [] as { materialId: string; qty: number }[] }));
  for (const [i, materialId] of d.materialId.entries()) {
    if (!materialId.trim()) continue;
    const gi = d.grp ? Number(d.grp[i]) : 0;
    const g = Number.isInteger(gi) ? groups[gi] : undefined;
    if (!g) return { error: "Forma eskirgan — sahifani yangilab, qaytadan kiriting" };
    const raw = String(d.qty[i] ?? "").replace(/\s+/g, "").replace(",", ".");
    const qty = Number(raw);
    const where = multi ? `${gi + 1}-chiqim, ${g.items.length + 1}-qator` : `${i + 1}-qator`;
    if (!raw || !Number.isFinite(qty) || qty <= 0) return { error: `${where}: miqdorni 0 dan katta kiriting` };
    g.items.push({ materialId, qty });
  }
  for (const [gi, g] of groups.entries()) {
    if (!g.to) return { error: multi ? `${gi + 1}-chiqim: Kimga berilishini tanlang` : "Kimga berilishini tanlang (Kimga)" };
    if (!g.items.length) return { error: multi ? `${gi + 1}-chiqim: kamida bitta qator qo'shing — nomi va miqdori` : "Kamida bitta qator qo'shing: nomi va miqdori" };
  }
  // «Tuzatish» orqa sanasi faqat bekor qilingan o'sha bitta hujjat uchun — boshqa oluvchilar alohida yoziladi
  if (multi && d.copyOf) return { error: "Tuzatishda faqat bitta chiqim yoziladi — boshqa oluvchilarga alohida chiqim qiling" };

  // Tuzatishda eski sana saqlanadi: faqat bekor qilingan hujjatning AYNAN o'z sanasi uchun 31 kunlik chegara ochiladi.
  // Faqat stornoni shu xodim o'zi qilgan bo'lsa, 2 soat ichida va bir marta — aks holda istalgan eski bekor qilingan
  // hujjat id'si bilan orqa sanaga cheksiz chiqim yozish mumkin bo'lardi
  let anyPastDate = false;
  if (d.copyOf && d.date) {
    const [orig, storno, used] = await Promise.all([
      db.stockMove.findFirst({ where: { refType: "Issue", refId: d.copyOf }, select: { date: true } }),
      db.stockMove.findFirst({ where: { refType: ISSUE_STORNO, refId: d.copyOf }, orderBy: { createdAt: "desc" }, select: { createdById: true, createdAt: true } }),
      db.auditLog.count({ where: { entity: "IssueCopy", entityId: d.copyOf } }),
    ]);
    anyPastDate = !!orig && !!storno && isoDate(orig.date) === d.date && storno.createdById === s.userId
      && Date.now() - storno.createdAt.getTime() < 2 * 3600_000 && used === 0;
  }

  const actor = { userId: s.userId, role: s.role };
  let results: IssueStockResult[];
  try {
    results = multi
      ? await issueStockMany(groups.map((g) => ({ warehouseId: d.warehouseId, date: d.date, to: g.to!, items: g.items, note: d.note })), d.clientToken, actor)
      : [await issueStock({ warehouseId: d.warehouseId, date: d.date, to: groups[0].to!, items: groups[0].items, note: d.note, clientToken: d.clientToken, anyPastDate }, actor)];
  } catch (e) {
    if (e instanceof IssueError) return { error: e.message };
    throw e;
  }
  const count = results.reduce((a, x) => a + x.count, 0);
  // Orqa sana ruxsati bir martalik: shu nusxa ishlatildi
  if (anyPastDate && d.copyOf) await audit(db, s.userId, "CREATE", "IssueCopy", d.copyOf, undefined, { date: d.date, count });
  // Haydovchiga / transportga berilsa — dispetcherga xabar (oddiy xodim bo'lsa funksiya o'zi jim qoladi)
  for (const [gi, res] of results.entries()) {
    const to = groups[gi]?.to;
    if (to && !res.existed && (to.kind === "employee" || to.kind === "vehicle")) notifyDriverIssue(res.ref, s.userId);
  }
  refresh();
  redirect(savedUrl(count, d.date, results.length));
}

/** Saqlangandan keyin jurnal. Davr standart — joriy oy: o'tgan oyga yozilgan chiqim ham ro'yxatda ko'rinsin. */
function savedUrl(count: number, date: string | null | undefined, docs = 1) {
  const now = new Date();
  const monthStart = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const q = new URLSearchParams({ saved: String(count) });
  if (docs > 1) q.set("docs", String(docs));
  if (date && date < monthStart) q.set("from", date);
  return `/stock/rasxod?${q.toString()}`;
}

/**
 * Chiqim stornosi (bekor qilish): hujjatning barcha qatorlari skladga teskari yoziladi (`lib/stock-issue` cancelIssue).
 * Kim: `stock` → `issue_storno` — direktor yoki u ruxsat bergan xodim. Sabab majburiy.
 */
export async function cancelRasxod(ref: string, reason: string): Promise<ActionState> {
  const s = await requireAction("stock", "issue_storno");
  try {
    const r = await cancelIssue(String(ref ?? ""), String(reason ?? ""), { userId: s.userId, role: s.role });
    refresh();
    return { ok: true, note: `Chiqim bekor qilindi: ${r.count} qator` };
  } catch (e) {
    if (e instanceof IssueError) return { error: e.message };
    throw e;
  }
}

/**
 * «Tuzatish»: chiqim bekor qilinadi (`cancelIssue` — o'sha storno qoidasi, brigada qoldig'i tekshiruvi bilan), keyin forma
 * eski qatorlar bilan ochiladi (`/stock/rasxod/new?copy=<ref>`) — yangi chiqimni foydalanuvchi yozadi.
 * Kim: `stock` → `issue_storno` (odatda direktor) va chiqim yozish huquqi (`issue`).
 */
export async function fixRasxod(ref: string, reason: string): Promise<ActionState> {
  const s = await requireAction("stock", "issue_storno");
  if (!canDo(s, "stock", "issue")) return { error: "Yangi chiqim yozishga ruxsatingiz yo'q — faqat «Bekor qilish» mumkin" };
  const why = String(reason ?? "").trim();
  if (why.length < 3) return { error: "Tuzatish sababini yozing (kamida 3 belgi)" };
  try {
    const r = await cancelIssue(String(ref ?? ""), `Tuzatish: ${why}`, { userId: s.userId, role: s.role });
    refresh();
    return { ok: true, note: `Chiqim bekor qilindi: ${r.count} qator` };
  } catch (e) {
    if (e instanceof IssueError) return { error: e.message };
    throw e;
  }
}

/** Bir chaqiruvda ko'pi bilan shuncha hujjat — so'rov uzoq osilib qolmasin (Kirimdagi kabi). */
const BULK_STORNO_MAX = 20;

/**
 * Chiqim jurnali → «Ro'yxatdagi chiqimlarni bekor qilish»: har hujjat alohida `cancelIssue` bilan (o'z tranzaksiyasi,
 * brigada qoldig'i tekshiruvi, AuditLog). Bo'lmaganlari sababi bilan qaytadi. Kim: `stock` → `issue_storno`. Sabab majburiy.
 */
export async function stornoRasxods(refs: string[], reason: string): Promise<BulkStornoResult> {
  const s = await requireAction("stock", "issue_storno");
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { error: "Bekor qilish sababini yozing", done: 0, failed: [] };
  const list = [...new Set((Array.isArray(refs) ? refs : []).map(String))].filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)).slice(0, BULK_STORNO_MAX);
  const res: BulkStornoResult = { done: 0, failed: [] };
  for (const ref of list) {
    try {
      await cancelIssue(ref, why, { userId: s.userId, role: s.role });
      res.done++;
    } catch (e) {
      const m = await db.stockMove.findFirst({
        where: { refType: "Issue", refId: ref },
        select: { date: true, recipient: { select: { name: true } }, brigade: { select: { name: true } }, employee: { select: { fullName: true } } },
      });
      const label = m ? `${dateRu(m.date)} — ${m.recipient?.name ?? m.brigade?.name ?? m.employee?.fullName ?? "?"}` : ref;
      res.failed.push({ docNo: label, error: e instanceof IssueError ? e.message : "Bajarilmadi — qayta urinib ko'ring" });
    }
  }
  if (res.done) refresh();
  return res;
}

const recipientSchema = z.object({
  id: zOpt,
  name: zStr("Oluvchining ismini kiriting"),
  note: zOpt,
  sortOrder: zOpt,
});

/** «Kimga» ro'yxati: yangi oluvchi yoki nomini/izohini o'zgartirish (`id` bilan). */
export async function saveRecipient(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "issue");
  const r = parseForm(recipientSchema, fd);
  if ("error" in r) return { error: r.error };
  const sortOrder = r.data.sortOrder == null ? null : Number(r.data.sortOrder);
  if (sortOrder != null && !Number.isFinite(sortOrder)) return { error: "Tartib raqami son bo'lishi kerak" };
  const res = await upsertRecipient({ id: r.data.id, name: r.data.name, note: r.data.note, sortOrder }, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock/rasxod"); revalidatePath("/stock/rasxod/new");
  return { ok: true, note: res.created ? "Oluvchi qo'shildi" : "Saqlandi" };
}

/** Faol / nofaol (o'chirish yo'q — eski chiqim qatorlarida nomi qoladi). */
export async function toggleRecipient(id: string, isActive: boolean): Promise<ActionState> {
  const s = await requireAction("stock", "issue");
  const res = await setRecipientActive(String(id ?? ""), isActive === true, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock/rasxod"); revalidatePath("/stock/rasxod/new");
  return { ok: true, note: isActive ? `«${res.name}» yana faol` : `«${res.name}» «Kimga» ro'yxatidan yashirildi` };
}
