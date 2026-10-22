"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { isoDate } from "@/lib/format";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { resolveMaterials } from "@/lib/import-materials";
import { canDo } from "@/lib/permissions";
import { createGoodsReceipt, receiptTokenOf, resolveRecipient, resolveSupplier } from "@/lib/receipts";
import { cancelReceipt } from "@/lib/storno";
import type { VatRate } from "@/lib/receipt-vat";

/** Xato matnlari o'zbekcha — «Рус» rejimida lug'atdan o'giriladi. */
const req = (msg: string) => z.string().trim().min(1, msg);
const opt = z.string().trim().optional().transform((v) => (v ? v : null));
const numStr = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").replace(",", ".") : v);

const schema = z.object({
  // «Ta'minotchi»: ro'yxatdan tanlangan id yoki yozilgan nom (yangi yetkazuvchi saqlashda yaratiladi — `resolveSupplier`)
  supplierId: opt,
  supplierName: opt,
  warehouseId: req("Skladni tanlang"),
  date: req("Sanani kiriting"),
  payment: z.enum(["BANK", "CASH"], { message: "To'lov turini tanlang: bank o'tkazma yoki naqd pul" }),
  waybillNo: opt,
  // «Kimga» va «Darhol kimga berildi» — id yoki yozilgan nom (`resolveRecipient`)
  recipientId: opt,
  recipientName: opt,
  autoIssueToId: opt,
  autoIssueToName: opt,
  // «Kimga» (darhol chiqim): "b:<id>" brigada | "e:<id>" xodim | "r:<id>" oluvchi; bo'sh — skladda qoladi
  autoIssueKey: opt,
  address: opt,
  carrier: opt,
  loadedFrom: opt,
  buyerId: opt,
  purpose: opt,
  note: opt,
  cashAccountId: opt,
  // Xomashyosiz qatorlarni forma yubormaydi; bo'sh ro'yxat — pastda tekshiriladi (o'z xabari bilan)
  materialId: z.array(z.string()).optional(),
  // Nakladnoy skaneridan: spravochnikda yo'q xomashyo — `materialId` bo'sh, nomi va birligi shu yerda (qatorlar bilan parallel)
  newMaterial: z.array(z.string()).optional(),
  newUnit: z.array(z.string()).optional(),
  qty: z.array(z.preprocess(numStr, z.coerce.number({ message: "Miqdor son bo'lishi kerak" }).positive("Miqdor 0 dan katta bo'lishi kerak").max(MAX_AMOUNT, "Qiymat juda katta"))).optional(),
  price: z.array(z.preprocess(numStr, z.coerce.number({ message: "Narx son bo'lishi kerak" }).min(0, "Narx manfiy bo'lmasin").max(MAX_AMOUNT, "Qiymat juda katta"))).optional(),
  deliveryCost: z.array(z.string()).optional(),
  vatRate: z.array(z.string()).optional(),
});

const LIMITS: [keyof z.infer<typeof schema>, number, string][] = [
  ["waybillNo", 60, "TTN"], ["address", 300, "Manzil"], ["purpose", 300, "Maqsad"], ["note", 1000, "Izoh"],
  ["carrier", 120, "Mashina (kim olib keldi)"], ["loadedFrom", 300, "Qayerdan yuklandi"], ["supplierName", 200, "Ta'minotchi"],
  ["recipientName", 80, "Kimga"], ["autoIssueToName", 80, "Darhol kimga berildi"],
];

/**
 * Sklad → «Kirim»: yangi kirim (GoodsReceipt) — `lib/receipts.ts#createGoodsReceipt` (Kirim formasi bilan bitta qoida).
 * Muvaffaqiyatda jurnalga (kirim sanasi oyi → bugun) «Kirim saqlandi» xabari bilan qaytadi.
 * Nakladnoy skaneridan kelgan yangi xomashyolar (`newMaterial[]`) kirimdan oldin yaratiladi — Excel importidagi
 * `resolveMaterials` bilan: shu nomli xomashyo bo'lsa (ikki marta bosish ham) o'shanisi olinadi, takror yaratilmaydi.
 */
export async function createPrixod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "receipt");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  for (const [k, max, label] of LIMITS) {
    const v = d[k];
    if (typeof v === "string" && v.length > max) return { error: `«${label}»: ${max} belgidan oshmasin` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { error: "Sana noto'g'ri" };
  const mats = d.materialId ?? [], qtys = d.qty ?? [], prices = d.price ?? [], deliveries = d.deliveryCost ?? [], rates = d.vatRate ?? [];
  const newNames = d.newMaterial ?? [], newUnits = d.newUnit ?? [];
  const items: { materialId: string; newName?: string; qty: number; price: number; deliveryCost: number; vatRate: VatRate | null }[] = [];
  for (const [i, id] of mats.entries()) {
    const newName = id ? "" : (newNames[i] ?? "").trim().replace(/\s+/g, " ");
    if (!id && !newName) continue;
    if (newName.length > 200) return { error: `${i + 1}-qator: xomashyo nomi 200 belgidan oshmasin` };
    if (qtys[i] == null || prices[i] == null) return { error: `${i + 1}-qator: miqdor va narxni kiriting` };
    const raw = String(numStr(deliveries[i] ?? "") ?? "");
    const delivery = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(delivery) || delivery < 0) return { error: `${i + 1}-qator: yetkazib berish summasi noto'g'ri` };
    const rate = rates[i];
    items.push({ materialId: id, ...(newName ? { newName } : {}), qty: qtys[i], price: prices[i], deliveryCost: delivery, vatRate: rate != null && rate !== "" ? (Number(rate) as VatRate) : null });
  }
  if (!items.length) return { error: "Kamida bitta qatorda xomashyoni tanlang" };

  // Ta'minotchi va oluvchilar: ro'yxatda yo'q nom shu yerda spravochnikga qo'shiladi — keyingi kirimda ro'yxatdan chiqadi
  const sup = await resolveSupplier({ id: d.supplierId, name: d.supplierName }, { userId: s.userId, canAdd: canDo(s, "stock", "suppliers") });
  if ("error" in sup) return sup;
  const rec = await resolveRecipient({ id: d.recipientId, name: d.recipientName }, s.userId);
  if ("error" in rec) return { error: `«Kimga»: ${rec.error}` };
  const autoTo = await resolveRecipient({ id: d.autoIssueToId, name: d.autoIssueToName }, s.userId);
  if ("error" in autoTo) return { error: `«Darhol kimga berildi»: ${autoTo.error}` };

  const fresh = items.filter((x) => x.newName);
  if (fresh.length) {
    try {
      const unitOf = new Map(mats.flatMap((id, i) => (id ? [] : [[(newNames[i] ?? "").trim().replace(/\s+/g, " ").toLowerCase(), newUnits[i] ?? ""] as const])));
      const res = await db.$transaction(async (tx) => {
        const r = await resolveMaterials(tx, fresh.map((x) => ({ name: x.newName!, unit: unitOf.get(x.newName!.toLowerCase()) })), true);
        for (const m of r.created) await audit(tx, s.userId, "CREATE", "Material", m.id, undefined, { ...m, via: "nakladnoy-scan" });
        return r.result;
      });
      for (const x of fresh) x.materialId = res.get(x.newName!.toLowerCase())!.id;
    } catch (e) {
      return { error: e instanceof Error ? `Yangi xomashyo qo'shilmadi: ${e.message}` : "Yangi xomashyo qo'shilmadi" };
    }
    revalidatePath("/stock/materials"); revalidatePath("/settings");
  }

  let res: Awaited<ReturnType<typeof createGoodsReceipt>>;
  try {
    res = await createGoodsReceipt({
      supplierId: sup.id, warehouseId: d.warehouseId, date: d.date, payment: d.payment,
      waybillNo: d.waybillNo, recipientId: rec.id, address: d.address, buyerId: d.buyerId, purpose: d.purpose, note: d.note,
      carrier: d.carrier, loadedFrom: d.loadedFrom, autoIssueToId: autoTo.id, autoIssueKey: d.autoIssueKey,
      cashAccountId: d.cashAccountId, clientToken: receiptTokenOf(fd.get("clientToken")),
      items: items.map(({ materialId, qty, price, deliveryCost, vatRate }) => ({ materialId, qty, price, deliveryCost, vatRate })),
    }, { userId: s.userId, role: s.role });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Kirim saqlanmadi" };
  }
  if (!res.existed) {
    revalidatePath("/stock"); revalidatePath("/stock/prixod"); revalidatePath("/receipts"); revalidatePath("/sales"); revalidatePath("/orders/new");
    revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/"); revalidatePath("/suppliers");
    if (autoTo.id || d.autoIssueKey) { revalidatePath("/stock/rasxod"); revalidatePath("/brigades"); }
  }
  // Jurnal shu kirim ko'rinadigan davrda ochiladi: kirim oyining 1-kunidan bugungacha (kirim kelajak sanada bo'lsa — o'sha kungacha)
  const today = isoDate();
  const qs = new URLSearchParams({ from: `${d.date.slice(0, 7)}-01`, to: d.date > today ? d.date : today, saved: res.docNo });
  redirect(`/stock/prixod?${qs.toString()}`);
}

/** Bir chaqiruvda ko'pi bilan shuncha kirim — so'rov uzoq osilib qolmasin, sahifa jarayonni ko'rsatib tursin. */
const BULK_STORNO_MAX = 20;
export type BulkStornoResult = { error?: string; done: number; failed: { docNo: string; error: string }[] };

/**
 * Kirim jurnali → «Ro'yxatdagi kirimlarni bekor qilish»: bir bo'lak kirimni storno qiladi (har biri `cancelReceipt`
 * orqali — o'z tranzaksiyasi, to'lov/qoldiq tekshiruvi, avto chiqimi ham teskari yoziladi, AuditLog). Hujjatlar o'chirilmaydi.
 * Kim: `stock` → `receipt_storno` (direktor yoki u ruxsat bergan xodim). Sabab majburiy.
 */
export async function stornoReceipts(ids: string[], reason: string): Promise<BulkStornoResult> {
  const s = await requireAction("stock", "receipt_storno");
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { error: "Bekor qilish sababini yozing", done: 0, failed: [] };
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)).slice(0, BULK_STORNO_MAX);
  const res: BulkStornoResult = { done: 0, failed: [] };
  for (const id of list) {
    const r = await cancelReceipt(id, why, s.userId).catch(() => ({ error: "Bajarilmadi — qayta urinib ko'ring" }));
    if ("error" in r) {
      const rec = await db.goodsReceipt.findUnique({ where: { id }, select: { docNo: true } });
      res.failed.push({ docNo: rec?.docNo ?? id, error: r.error });
    } else res.done++;
  }
  if (res.done) {
    for (const p of ["/receipts", "/stock", "/stock/prixod", "/stock/rasxod", "/brigades", "/cashflow", "/suppliers", "/"]) revalidatePath(p);
  }
  return res;
}
