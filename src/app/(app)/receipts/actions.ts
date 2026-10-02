"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { num, numMoney, str } from "@/lib/excel";
import { resolveMaterials } from "@/lib/import-materials";
import { toMaterialUnit } from "@/lib/unit";

const schema = z.object({
  supplierId: zStr("Yetkazuvchi tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  // Faqat direktor kirim bilan birga to'lovni ham yoza oladi; boshqalarda to'lov moliyaga qoladi
  cashAccountId: zOpt,
  date: zStr("Sana kerak"),
  note: zOpt,
  // Nakladnoy rekvizitlari va tarozi (sxemada alohida ustun yo'q — izohga tuzilgan holda yoziladi)
  waybillNo: zOpt,
  vehicle: zOpt,
  gross: zOpt,
  tare: zOpt,
  materialId: z.array(z.string()).min(1, "Kamida bitta qator"),
  qty: z.array(z.coerce.number().positive("miqdor 0 dan katta bo'lsin").max(MAX_AMOUNT, "qiymat juda katta")),
  price: z.array(z.coerce.number().min(0, "narx manfiy bo'lmasin").max(MAX_AMOUNT, "qiymat juda katta")),
});

const kg = (v: string | null) => (v ? Number(v.replace(/\s+/g, "").replace(",", ".")) : null);

/**
 * Nakladnoy raqami, mashina va tarozi (brutto − tara = netto) — kirim izohiga bir xil tuzilishda yoziladi:
 * "Nakladnoy № 123 · Mashina 01A123BC · Tarozi: brutto 32 500, tara 12 300, netto 20 200 kg · <izoh>".
 * Sxemaga tegmasdan qidirish va chop etishda o'qiladi.
 */
function receiptNote(d: { note: string | null; waybillNo: string | null; vehicle: string | null; gross: string | null; tare: string | null }): { note: string | null } | { error: string } {
  const gross = kg(d.gross), tare = kg(d.tare);
  if (gross != null && !(Number.isFinite(gross) && gross > 0 && gross <= MAX_AMOUNT)) return { error: "Brutto og'irligi noto'g'ri" };
  if (tare != null && !(Number.isFinite(tare) && tare >= 0 && tare <= MAX_AMOUNT)) return { error: "Tara og'irligi noto'g'ri" };
  if ((gross == null) !== (tare == null)) return { error: "Tarozi: brutto va tara ikkalasini ham kiriting" };
  if (gross != null && tare != null && tare >= gross) return { error: "Tara bruttodan kichik bo'lishi kerak" };
  const parts = [
    d.waybillNo ? `Nakladnoy № ${d.waybillNo}` : null,
    d.vehicle ? `Mashina ${d.vehicle.toUpperCase()}` : null,
    gross != null && tare != null ? `Tarozi: brutto ${gross}, tara ${tare}, netto ${Math.round((gross - tare) * 1000) / 1000} kg` : null,
    d.note,
  ].filter(Boolean);
  return { note: parts.length ? parts.join(" · ") : null };
}

/** Kirim: GoodsReceipt + har qator uchun StockMove RECEIPT (+qty, unitCost). */
export async function createReceipt(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (!validDate(d.date)) return { error: "Sana noto'g'ri — 2000-yildan bugungacha bo'lsin" };
  const date = new Date(d.date);
  const items = d.materialId.map((materialId, i) => ({ materialId, qty: d.qty[i], price: d.price[i] })).filter((i) => i.materialId);
  if (!items.length) return { error: "Kamida bitta qator kerak" };
  if (items.some((i) => !(i.qty > 0) || !(i.price >= 0))) return { error: "Har qatorda miqdor va narx bo'lsin" };
  const total = items.reduce((x, i) => x + i.qty * i.price, 0);
  if (total > MAX_AMOUNT) return { error: "Kirim summasi juda katta" };
  const n = receiptNote(d);
  if ("error" in n) return { error: n.error };

  // Sklad, yetkazuvchi, xomashyo va hisob — mavjud va faol bo'lsin (aks holda bazada FK xatosi → 500)
  const ids = [...new Set(items.map((i) => i.materialId))];
  const [wh, sup, mats, acc] = await Promise.all([
    db.warehouse.findFirst({ where: { id: d.warehouseId, isActive: true }, select: { id: true } }),
    db.supplier.findUnique({ where: { id: d.supplierId }, select: { id: true, name: true, isActive: true } }),
    db.material.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } }),
    d.cashAccountId && s.role === "DIRECTOR" ? db.cashAccount.findFirst({ where: { id: d.cashAccountId, isActive: true }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!wh) return { error: "Sklad topilmadi yoki yopilgan" };
  if (!sup) return { error: "Yetkazuvchi topilmadi" };
  if (!sup.isActive) return { error: `"${sup.name}" yopilgan — avval Yetkazuvchilar bo'limida faollashtiring` };
  if (mats.length !== ids.length) return { error: "Xomashyo topilmadi — sahifani yangilang" };
  if (mats.some((m) => !m.isActive)) return { error: "Yopilgan xomashyoga kirim qilinmaydi" };
  if (d.cashAccountId && s.role === "DIRECTOR" && !acc) return { error: "To'lov hisobi topilmadi yoki yopilgan" };

  const id = await db.$transaction(async (tx) => {
    const rec = await tx.goodsReceipt.create({
      data: { docNo: await nextNo(tx, "goodsReceipt", "K"), date, supplierId: sup.id, warehouseId: wh.id, note: n.note, createdById: s.userId, items: { create: items } },
    });
    await tx.stockMove.createMany({
      data: items.map((i) => ({
        type: "RECEIPT" as const, date, warehouseId: wh.id, materialId: i.materialId,
        qty: i.qty, unitCost: i.price, refType: "GoodsReceipt", refId: rec.id, createdById: s.userId,
      })),
    });
    // Kirim summasi — hisobdan chiqim. Sklad/snabjeniye kassadan pul chiqara olmaydi: bunday kirim
    // Kirim-Chiqimda "To'lanmagan kirimlar" ro'yxatiga tushadi va moliya to'laydi (`payReceipt`).
    // Direktor esa hisobni tanlab, shu zahoti to'langan deb yozishi mumkin.
    if (total > 0 && acc) {
      const cashTx = await tx.cashTransaction.create({
        data: {
          type: "EXPENSE", date, cashAccountId: acc.id, amount: total,
          category: "Xomashyo", supplierId: sup.id, counterparty: sup.name,
          note: `Kirim ${rec.docNo} · ${items.length} qator`,
          refType: "GoodsReceipt", refId: rec.id, createdById: s.userId,
        },
      });
      await audit(tx, s.userId, "CREATE", "CashTransaction", cashTx.id, undefined, cashTx);
    }
    await audit(tx, s.userId, "CREATE", "GoodsReceipt", rec.id, undefined, { ...rec, items });
    return rec.id;
  }).catch((e: Error) => ({ error: e.message }));
  if (typeof id === "object") return { error: id.error };
  revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/sales"); revalidatePath("/orders/new"); revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/"); revalidatePath("/suppliers");
  redirect(`/receipts/${id}`);
}

const importSchema = z.object({
  supplierId: zStr("Yetkazuvchi tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  date: zStr("Sana kerak"),
  note: zOpt,
  rows: z.string(),
  createMissing: z.string().optional().transform((v) => v === "on"),
});
type ImportRow = { material?: unknown; code?: unknown; qty?: unknown; price?: unknown; unit?: unknown; nds?: unknown; sum?: unknown; note?: unknown };

/**
 * Excel'dan kirim: zavod va texnikaga kerakli mahsulotlar ro'yxati (nomi, miqdor, narx, birlik) bitta kirim hujjati bo'lib tushadi.
 * Ro'yxatda yo'q mahsulotlar `createMissing` bilan xomashyo sifatida yaratiladi, sklad qoldig'i darhol oshadi.
 */
export async function importReceiptFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PROCUREMENT", "WAREHOUSE"]);
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
    const pr = str(x.price) === "" ? 0 : numMoney(x.price); if (!(pr >= 0) || pr > MAX_AMOUNT || q * pr > MAX_AMOUNT) return { error: `${i + 1}-qator (${str(x.material)}): narx noto'g'ri` };
  }
  const [wh, sup] = await Promise.all([
    db.warehouse.findFirst({ where: { id: d.warehouseId, isActive: true }, select: { id: true } }),
    db.supplier.findUnique({ where: { id: d.supplierId }, select: { name: true, isActive: true } }),
  ]);
  if (!wh) return { error: "Sklad topilmadi yoki yopilgan" };
  if (!sup) return { error: "Yetkazuvchi topilmadi" };
  if (!sup.isActive) return { error: `"${sup.name}" yopilgan — avval Yetkazuvchilar bo'limida faollashtiring` };

  const out = await db.$transaction(async (tx) => {
    const { result, missing, created } = await resolveMaterials(tx, rows.map((x) => ({ name: str(x.material), unit: str(x.unit), code: str(x.code) })), d.createMissing);
    if (missing.length) throw new Error(`Bunday mahsulot/xomashyo yo'q: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}. "Yo'q mahsulotlarni yaratish" ni belgilang.`);
    const items = rows.map((x) => {
      const m = result.get(str(x.material).toLowerCase().trim())!;
      const conv = toMaterialUnit(num(x.qty), str(x.price) === "" ? 0 : numMoney(x.price), x.unit, m.unit);
      if (!conv) throw new Error(`"${m.name}": faylda birlik «${str(x.unit)}», spravochnikda «${m.unit}» — o'girib bo'lmaydi. Faylni tuzating`);
      return { materialId: m.id, qty: conv.qty, price: conv.price };
    });
    const rec = await tx.goodsReceipt.create({
      data: { docNo: await nextNo(tx, "goodsReceipt", "K"), date: new Date(d.date), supplierId: d.supplierId, warehouseId: d.warehouseId, note: d.note ?? "Excel'dan import", createdById: s.userId, items: { create: items } },
    });
    await tx.stockMove.createMany({
      data: items.map((i) => ({ type: "RECEIPT" as const, date: new Date(d.date), warehouseId: d.warehouseId, materialId: i.materialId, qty: i.qty, unitCost: i.price, refType: "GoodsReceipt", refId: rec.id, createdById: s.userId })),
    });
    await audit(tx, s.userId, "CREATE", "GoodsReceipt", rec.id, undefined, { ...rec, items, via: "excel", createdMaterials: created.map((m) => m.name) });
    return rec.id;
  }).catch((e: Error) => ({ error: e.message }));
  if (typeof out === "object") return out;
  revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/settings"); revalidatePath("/sales"); revalidatePath("/orders/new");
  redirect(`/receipts/${out}`);
}
