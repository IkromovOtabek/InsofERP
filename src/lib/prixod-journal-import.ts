import { createHash } from "node:crypto";
import { db } from "./db";
import { audit } from "./audit";
import { validDate } from "./action";
import { resolveMaterials } from "./import-materials";
import { toMaterialUnit } from "./unit";
import { createGoodsReceipt, resolveRecipient } from "./receipts";
import { PAID_IMPORT_TOKEN } from "./receipt-payables";
import { journalMaterials, journalUnit, type JournalDoc } from "./prixod-journal";
import { matchTarget } from "./issue-target";
import { issueTargetOptions } from "./stock-recipients";
import type { Role } from "@/generated/prisma";

export type JournalChunkResult = {
  error?: string;
  created: number;
  /** Shu fayl avval yuklangan — kirim qayta ochilmadi (bir martalik kalit) */
  existed: number;
  failed: { date: string; supplier: string; error: string }[];
};

/** Bir chaqiruvda ko'pi bilan shuncha hujjat — so'rov uzoq osilib qolmasin, sahifa jarayonni ko'rsatib tursin. */
const MAX_DOCS = 40;

/**
 * Sklad → Kirim → «Excel jurnal»: brauzer o'qib guruhlagan hujjatlarning bir bo'lagini kirim qiladi
 * (ruxsat chaqiruvchida — `stock/prixod/jurnal/actions.ts`).
 * Har hujjat — oddiy kirim (`createGoodsReceipt`): sklad qoldig'i oshadi, yetkazuvchiga to'lanmagan kirim bo'lib tushadi.
 * Yo'q yetkazuvchi va xomashyolar yaratiladi. Bir martalik kalit hujjat mazmunidan olinadi —
 * xuddi shu fayl qayta yuklansa (yoki ulanish uzilib qayta yuborilsa) ikkinchi kirim ochilmaydi.
 *
 * `paid` — eski daftar, puli allaqachon to'langan: kirimlar «To'lanmagan kirimlar» ga va yetkazuvchi qarziga tushmaydi
 * (kalit `PAID_IMPORT_TOKEN` bilan), kassaga chiqim yozilmaydi.
 * `supplierVat` — kichik harfli yetkazuvchi nomi → fayldagi qatorlarida QQS bormi (yangi yetkazuvchining «QQS to'lovchisi» belgisi).
 */
export async function importJournalDocs(
  input: { warehouseId: string; docs: JournalDoc[]; supplierVat: Record<string, boolean>; paid?: boolean },
  s: { userId: string; role: Role; canAddSuppliers: boolean },
): Promise<JournalChunkResult> {
  const res: JournalChunkResult = { created: 0, existed: 0, failed: [] };
  const docs = Array.isArray(input?.docs) ? input.docs.slice(0, MAX_DOCS) : [];
  if (!docs.length) return { ...res, error: "Hujjat yo'q" };
  const bad = docs.find((d) => !validDate(String(d?.date ?? "")) || !Array.isArray(d.rows) || !d.rows.length || !String(d.supplier ?? "").trim());
  if (bad) return { ...res, error: `Hujjat noto'g'ri: ${bad?.date ?? "?"} · ${bad?.supplier ?? "?"} (sana bugundan keyin bo'lmasin)` };
  const wh = await db.warehouse.findFirst({ where: { id: String(input.warehouseId ?? ""), isActive: true }, select: { id: true } });
  if (!wh) return { ...res, error: "Sklad topilmadi yoki yopilgan" };

  // Yetkazuvchilar: nom bo'yicha (katta-kichik harf farqsiz), yo'qlari yaratiladi
  const suppliers = await db.supplier.findMany({ select: { id: true, name: true } });
  const supId = new Map(suppliers.map((x) => [x.name.trim().toLowerCase(), x.id]));
  const missingSup = [...new Map(docs.map((d) => [d.supplier.trim().toLowerCase(), d.supplier.trim()])).entries()].filter(([k]) => !supId.has(k));
  if (missingSup.length && !s.canAddSuppliers) {
    return { ...res, error: `Yetkazuvchi spravochnikda yo'q: ${missingSup.slice(0, 5).map(([, n]) => n).join(", ")} — avval Yetkazuvchilar bo'limida qo'shing` };
  }
  for (const [k, name] of missingSup) {
    const sup = await db.supplier.create({ data: { name: name.slice(0, 200), vatPayer: input.supplierVat?.[k] ?? true } });
    await audit(db, s.userId, "CREATE", "Supplier", sup.id, undefined, { ...sup, via: "excel-jurnal" });
    supId.set(k, sup.id);
  }

  // Oluvchilar («Kimga», «Darhol kimga berildi») — nom bo'yicha; yo'g'i «Kimga» ro'yxatiga qo'shiladi (kirim formasidagi kabi)
  const recId = new Map<string, string | null>();
  const recipientOf = async (name: string): Promise<string | null> => {
    const k = name.trim().toLowerCase();
    if (!k) return null;
    if (!recId.has(k)) {
      const r = await resolveRecipient({ name }, s.userId);
      recId.set(k, "error" in r ? null : r.id);
    }
    return recId.get(k) ?? null;
  };

  // «Darhol kimga berildi»: brigada → xodim → oluvchi (Chiqim «Kimga» bilan bir tartib); topilmasa — yangi oluvchi
  const targets = await issueTargetOptions();
  const autoKeyOf = async (name: string): Promise<string | null> => {
    if (!name.trim()) return null;
    const hit = matchTarget(targets, name);
    if (hit) return hit.key;
    const id = await recipientOf(name);
    return id ? `r:${id}` : null;
  };

  // Xomashyolar: nom bo'yicha topiladi, yo'qlari yaratiladi; birligi mos kelmasa — «Nomi (birlik)» alohida xomashyo
  const allRows = docs.flatMap((d) => d.rows);
  const existing = await db.material.findMany({ select: { name: true, unit: true } });
  const assigned = journalMaterials(allRows, new Map(existing.map((m) => [m.name.trim().toLowerCase(), m.unit])));
  const { result: mats } = await db.$transaction((tx) =>
    resolveMaterials(tx, [...assigned.values()].map((m) => ({ name: m.name, unit: m.unit })), true),
  );

  for (const d of docs) {
    try {
      const items = d.rows.map((r) => {
        const a = assigned.get(r.line)!;
        const m = mats.get(a.name.toLowerCase().trim());
        if (!m) throw new Error(`«${r.material}» xomashyosi topilmadi`);
        const conv = toMaterialUnit(Number(r.qty), Number(r.price), journalUnit(r.unit), m.unit);
        if (!conv) throw new Error(`«${r.material}»: birlik «${r.unit}», xomashyoda «${m.unit}» — o'girib bo'lmaydi`);
        return { materialId: m.id, qty: conv.qty, price: conv.price, vatRate: r.vatRate === 12 ? (12 as const) : (0 as const), deliveryCost: Number(r.delivery) || 0 };
      });
      const hash = createHash("sha256").update(JSON.stringify([wh.id, d.key, d.rows.map((r) => [r.material, r.unit, r.qty, r.price, r.vatRate, r.delivery])])).digest("hex").slice(0, 40);
      const token = (input.paid ? PAID_IMPORT_TOKEN : "jrn-") + hash;
      // Shu hujjat boshqa rejimda (to'langan / to'lanmagan) yuklangan bo'lsa ham qayta ochilmasin
      if (await db.goodsReceipt.findFirst({ where: { clientToken: { in: [`jrn-${hash}`, `${PAID_IMPORT_TOKEN}${hash}`] } }, select: { id: true } })) { res.existed++; continue; }
      const src = input.paid ? "Excel jurnaldan (to'langan)" : "Excel jurnaldan";
      const note = String(d.note ?? "").trim();
      const out = await createGoodsReceipt({
        supplierId: supId.get(d.supplier.trim().toLowerCase())!, warehouseId: wh.id, date: d.date,
        waybillNo: d.waybillNo || null, payment: d.payment === "BANK" || d.payment === "CASH" ? d.payment : null,
        recipientId: await recipientOf(String(d.recipient ?? "")), address: d.address || null,
        carrier: String(d.carrier ?? "") || null, loadedFrom: String(d.loadedFrom ?? "") || null,
        autoIssueKey: await autoKeyOf(String(d.autoIssueTo ?? "")),
        note: note ? `${note.slice(0, 900)} · ${src}` : src, clientToken: token, items,
      }, { userId: s.userId, role: s.role });
      if (out.existed) res.existed++; else res.created++;
    } catch (e) {
      res.failed.push({ date: d.date, supplier: d.supplier, error: e instanceof Error ? e.message : "Saqlanmadi" });
    }
  }
  return res;
}
