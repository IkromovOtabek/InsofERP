"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { cancelIssue, issueStock, IssueError, parseIssueTarget } from "@/lib/stock-issue";
import { upsertRecipient, setRecipientActive } from "@/lib/stock-recipients";
import { isoDate } from "@/lib/format";

/**
 * Sklad → «Chiqim» (avval «Расход»). Xato matnlari o'zbekcha, «Рус» rejimida lug'atdan.
 * Kim: `stock` → `issue` amali (lib/permissions.ts) — Sklad, Snabjeniye, direktor va u ruxsat bergan xodim.
 * Mantiq `lib/stock-issue.ts` (berish) va `lib/stock-recipients.ts` («Kimga» ro'yxati) da — mobil/ECO ham shulardan.
 */

const refresh = () => {
  revalidatePath("/stock"); revalidatePath("/stock/rasxod"); revalidatePath("/brigades");
  revalidatePath("/production"); revalidatePath("/dashboard"); revalidatePath("/snabjeniye");
};

const schema = z.object({
  warehouseId: zStr("Skladni tanlang"),
  to: zStr("Kimga berilishini tanlang (Kimga)"),
  date: zOpt,
  note: zOpt,
  clientToken: zOpt,
  materialId: z.array(z.string(), { message: "Kamida bitta qator qo'shing" }).min(1, "Kamida bitta qator qo'shing"),
  qty: z.array(z.string(), { message: "Miqdorni kiriting" }),
});

/** Yangi chiqim: qatorlar `materialId[]` + `qty[]`, «Kimga» — "r:<id>" | "b:<id>". Muvaffaqiyatda → /stock/rasxod. */
export async function createRasxod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "issue");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const to = parseIssueTarget(d.to);
  if (!to) return { error: "Kimga berilishini tanlang (Kimga)" };
  const items: { materialId: string; qty: number }[] = [];
  for (const [i, materialId] of d.materialId.entries()) {
    if (!materialId.trim()) continue;
    const raw = String(d.qty[i] ?? "").replace(/\s+/g, "").replace(",", ".");
    const qty = Number(raw);
    if (!raw || !Number.isFinite(qty) || qty <= 0) return { error: `${i + 1}-qator: miqdorni 0 dan katta kiriting` };
    items.push({ materialId, qty });
  }
  if (!items.length) return { error: "Kamida bitta qator qo'shing: nomi va miqdori" };

  let res;
  try {
    res = await issueStock({ warehouseId: d.warehouseId, date: d.date, to, items, note: d.note, clientToken: d.clientToken }, { userId: s.userId, role: s.role });
  } catch (e) {
    if (e instanceof IssueError) return { error: e.message };
    throw e;
  }
  refresh();
  // Davr standart — joriy oy: o'tgan oyga yozilgan chiqim ham ro'yxatda ko'rinsin
  const now = new Date();
  const monthStart = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const q = new URLSearchParams({ saved: String(res.count) });
  if (d.date && d.date < monthStart) q.set("from", d.date);
  redirect(`/stock/rasxod?${q.toString()}`);
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
    return { ok: true, note: `Chiqim bekor qilindi (storno): ${r.count} qator` };
  } catch (e) {
    if (e instanceof IssueError) return { error: e.message };
    throw e;
  }
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
