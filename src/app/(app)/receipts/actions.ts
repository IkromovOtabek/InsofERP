"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { num, numMoney, str } from "@/lib/excel";
import { resolveMaterials } from "@/lib/import-materials";
import { toMaterialUnit } from "@/lib/unit";
import { isoDate } from "@/lib/format";
import { cancelReceipt } from "@/lib/storno";
import { Prisma } from "@/generated/prisma";
import { companyVatPayer, supplierVatRate, vatLine, type VatRate } from "@/lib/receipt-vat";
import { createGoodsReceipt, receiptTokenOf } from "@/lib/receipts";

/** Formadagi bir martalik kalit (brauzer yaratadi): bo'sh yoki g'alati bo'lsa — e'tiborga olinmaydi. */
const tokenOf = (v: FormDataEntryValue | null) => receiptTokenOf(v);

const schema = z.object({
  supplierId: zStr("Yetkazuvchi tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  // Faqat direktor kirim bilan birga to'lovni ham yoza oladi; boshqalarda to'lov moliyaga qoladi
  cashAccountId: zOpt,
  date: zStr("Sana kerak"),
  note: zOpt,
  // Nakladnoy rekvizitlari va tarozi: ТТН alohida ustunda ham, hammasi izohga tuzilgan holda (`receiptNote`)
  waybillNo: zOpt,
  vehicle: zOpt,
  gross: zOpt,
  tare: zOpt,
  materialId: z.array(z.string()).min(1, "Kamida bitta qator"),
  qty: z.array(z.coerce.number().positive("miqdor 0 dan katta bo'lsin").max(MAX_AMOUNT, "qiymat juda katta")),
  price: z.array(z.coerce.number().min(0, "narx manfiy bo'lmasin").max(MAX_AMOUNT, "qiymat juda katta")),
  // Qator QQS stavkasi (0 yoki 12). Berilmasa — yetkazuvchidan (QQS to'lovchisi → 12, aks holda 0)
  vatRate: z.array(z.string()).optional(),
});

const kg = (v: string | null) => (v ? Number(v.replace(/\s+/g, "").replace(",", ".")) : null);

/**
 * Kirim: GoodsReceipt + har qator uchun StockMove RECEIPT (+qty, unitCost).
 * Narx QQS'siz kiritiladi; qatorga QQS (0/12%) qo'shiladi — to'lanadigan summa QQS bilan (`lib/receipt-vat.ts`).
 * Mantiq `lib/receipts.ts#createGoodsReceipt` da (Sklad → «Приход» formasi bilan bitta qoida).
 */
export async function createReceipt(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "receipt");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const rates = d.vatRate ?? [];
  let res: Awaited<ReturnType<typeof createGoodsReceipt>>;
  try {
    res = await createGoodsReceipt({
      supplierId: d.supplierId, warehouseId: d.warehouseId, date: d.date, note: d.note, cashAccountId: d.cashAccountId,
      waybillNo: d.waybillNo, vehicle: d.vehicle, gross: kg(d.gross), tare: kg(d.tare), clientToken: tokenOf(fd.get("clientToken")),
      items: d.materialId.map((materialId, i) => {
        const rate = rates[i];
        return { materialId, qty: d.qty[i], price: d.price[i], vatRate: rate != null && rate !== "" ? (Number(rate) as VatRate) : null };
      }),
    }, { userId: s.userId, role: s.role });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Kirim saqlanmadi" };
  }
  if (!res.existed) { revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/sales"); revalidatePath("/orders/new"); revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/"); revalidatePath("/suppliers"); }
  redirect(`/receipts/${res.id}`);
}

const importSchema = z.object({
  supplierId: zStr("Yetkazuvchi tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  date: zStr("Sana kerak"),
  note: zOpt,
  rows: z.string(),
  createMissing: z.string().optional().transform((v) => v === "on"),
  // "Narxlar QQS bilan": "Narx" va "Summa" ustunlaridagi qiymat QQS bilan — QQS ichidan ajratiladi
  pricesWithVat: z.string().optional().transform((v) => v === "on"),
});
type ImportRow = { material?: unknown; code?: unknown; qty?: unknown; price?: unknown; priceVat?: unknown; unit?: unknown; nds?: unknown; sum?: unknown; sumVat?: unknown; note?: unknown };

/**
 * Qator narxi (fayldagi birlikda) va u QQS bilanmi (`gross`).
 * Ustunlar ustuvorligi: "Narx QQS bilan" → "Narx" → "Summa QQS bilan" / miqdor → "Summa" / miqdor
 * (ko'p nakladnoyda faqat "Сумма" bo'ladi; ilgari bunday qator 0 tannarx bilan kirib, o'rtacha narxni buzardi).
 * "Narx" va "Summa" ustunlari odatda QQS'siz; "Narxlar QQS bilan" belgilansa — QQS bilan deb olinadi.
 */
function rowPrice(x: ImportRow, withVat: boolean): { price: number; gross: boolean } {
  const q = num(x.qty);
  const perUnit = (v: unknown) => { const sum = str(v) === "" ? NaN : numMoney(v); return Number.isFinite(sum) && q > 0 ? Math.round((sum / q) * 100) / 100 : NaN; };
  if (str(x.priceVat) !== "") return { price: numMoney(x.priceVat), gross: true };
  if (str(x.price) !== "") return { price: numMoney(x.price), gross: withVat };
  const sv = perUnit(x.sumVat);
  if (Number.isFinite(sv)) return { price: sv, gross: true };
  const sb = perUnit(x.sum);
  if (Number.isFinite(sb)) return { price: sb, gross: withVat };
  return { price: 0, gross: false };
}

/**
 * Excel'dan kirim: zavod va texnikaga kerakli mahsulotlar ro'yxati (nomi, miqdor, narx, birlik) bitta kirim hujjati bo'lib tushadi.
 * Ro'yxatda yo'q mahsulotlar `createMissing` bilan xomashyo sifatida yaratiladi, sklad qoldig'i darhol oshadi.
 */
export async function importReceiptFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "receipt");
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  let rows: ImportRow[];
  try { rows = JSON.parse(d.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows)) return { error: "Excel ma'lumotlari o'qilmadi" };
  rows = rows.filter((x) => str(x.material));
  if (!rows.length) return { error: "Faylda qator yo'q" };
  if (!validDate(d.date)) return { error: "Sana noto'g'ri — 2000-yildan bugungacha bo'lsin" };
  for (const [i, x] of rows.entries()) {
    const q = num(x.qty); if (!(q > 0) || q > MAX_AMOUNT) return { error: `${i + 1}-qator (${str(x.material)}): miqdor 0 dan katta raqam bo'lsin` };
    const pr = rowPrice(x, d.pricesWithVat).price; if (!(pr >= 0) || pr > MAX_AMOUNT || q * pr > MAX_AMOUNT) return { error: `${i + 1}-qator (${str(x.material)}): narx noto'g'ri` };
  }
  // Ikki marta bosilgan "Kirimni qayd etish" ikkinchi kirim ochmasin (qo'lda kirimdagi kabi)
  const clientToken = tokenOf(fd.get("clientToken"));
  if (clientToken) {
    const dup = await db.goodsReceipt.findUnique({ where: { clientToken }, select: { id: true } });
    if (dup) redirect(`/receipts/${dup.id}`);
  }
  const [wh, sup] = await Promise.all([
    db.warehouse.findFirst({ where: { id: d.warehouseId, isActive: true }, select: { id: true } }),
    db.supplier.findUnique({ where: { id: d.supplierId }, select: { name: true, isActive: true, vatPayer: true } }),
  ]);
  if (!wh) return { error: "Sklad topilmadi yoki yopilgan" };
  if (!sup) return { error: "Yetkazuvchi topilmadi" };
  if (!sup.isActive) return { error: `"${sup.name}" yopilgan — avval Yetkazuvchilar bo'limida faollashtiring` };
  // QQS: stavka yetkazuvchidan (QQS to'lovchisi — 12%, aks holda 0). QQS to'lovchisi bo'lmagan yetkazuvchida
  // "QQS bilan" narx ham o'zgarmaydi — ichida QQS yo'q
  const vatPayer = await companyVatPayer();
  const rate = supplierVatRate(sup.vatPayer);

  const out = await db.$transaction(async (tx) => {
    const { result, missing, created } = await resolveMaterials(tx, rows.map((x) => ({ name: str(x.material), unit: str(x.unit), code: str(x.code) })), d.createMissing);
    if (missing.length) throw new Error(`Bunday mahsulot/xomashyo yo'q: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}. "Yo'q mahsulotlarni yaratish" ni belgilang.`);
    const items = rows.map((x) => {
      const m = result.get(str(x.material).toLowerCase().trim())!;
      const p = rowPrice(x, d.pricesWithVat);
      const conv = toMaterialUnit(num(x.qty), p.price, x.unit, m.unit);
      if (!conv) throw new Error(`"${m.name}": faylda birlik «${str(x.unit)}», spravochnikda «${m.unit}» — o'girib bo'lmaydi. Faylni tuzating`);
      return { materialId: m.id, ...vatLine(conv.qty, conv.price, rate, vatPayer, p.gross) };
    });
    const rec = await tx.goodsReceipt.create({
      data: {
        docNo: await nextNo(tx, "goodsReceipt", "K"), date: new Date(d.date), supplierId: d.supplierId, warehouseId: d.warehouseId, note: d.note ?? "Excel'dan import", createdById: s.userId, clientToken,
        items: { create: items.map((i) => ({ materialId: i.materialId, qty: i.qty, price: i.price, vatRate: i.vatRate, vatAmount: i.vatAmount })) },
      },
    });
    await tx.stockMove.createMany({
      data: items.map((i) => ({ type: "RECEIPT" as const, date: new Date(d.date), warehouseId: d.warehouseId, materialId: i.materialId, qty: i.qty, unitCost: i.unitCost, refType: "GoodsReceipt", refId: rec.id, createdById: s.userId })),
    });
    await audit(tx, s.userId, "CREATE", "GoodsReceipt", rec.id, undefined, { ...rec, items, via: "excel", createdMaterials: created.map((m) => m.name) });
    return rec.id;
  }).catch(async (e: Error) => {
    // Bir vaqtda kelgan ikki bir xil yuborish: ikkinchisi unique kalitga urildi — birinchisining kirimi ochiladi
    if (clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await db.goodsReceipt.findUnique({ where: { clientToken }, select: { id: true } });
      if (dup) return dup.id;
    }
    return { error: e.message };
  });
  if (typeof out === "object") return out;
  revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/stock/prixod"); revalidatePath("/settings"); revalidatePath("/sales"); revalidatePath("/orders/new"); revalidatePath("/cashflow"); revalidatePath("/suppliers");
  // Sklad → Kirim → «Excel orqali» dan kelgan bo'lsa — qo'lda kirimdagidek jurnalga «Kirim saqlandi» bilan qaytadi
  if (fd.get("back") === "prixod") {
    const rec = await db.goodsReceipt.findUnique({ where: { id: out }, select: { docNo: true } });
    const today = isoDate();
    const qs = new URLSearchParams({ from: `${d.date.slice(0, 7)}-01`, to: d.date > today ? d.date : today, saved: rec?.docNo ?? "" });
    redirect(`/stock/prixod?${qs.toString()}`);
  }
  redirect(`/receipts/${out}`);
}

/**
 * Kirimni storno qilish — faqat direktor (yoki direktor "Kirimni storno qilish" amalini bergan xodim).
 * Qoida `lib/storno.ts` da: teskari sklad harakatlari, to'lov bog'langan bo'lsa rad, qoldiq minusga tushmasin.
 */
export async function stornoReceipt(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("stock", "receipt_storno");
  const r = await cancelReceipt(id, String(reason ?? "").slice(0, 300), s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/receipts"); revalidatePath(`/receipts/${id}`); revalidatePath("/stock"); revalidatePath("/cashflow"); revalidatePath("/suppliers"); revalidatePath("/");
  return { ok: true, note: r.note };
}
