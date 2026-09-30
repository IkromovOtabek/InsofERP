"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
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
  materialId: z.array(z.string()).min(1, "Kamida bitta qator"),
  qty: z.array(z.coerce.number().positive("miqdor 0 dan katta bo'lsin")),
  price: z.array(z.coerce.number().min(0)),
});

/** Kirim: GoodsReceipt + har qator uchun StockMove RECEIPT (+qty, unitCost). */
export async function createReceipt(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const items = d.materialId.map((materialId, i) => ({ materialId, qty: d.qty[i], price: d.price[i] })).filter((i) => i.materialId);
  if (!items.length) return { error: "Kamida bitta qator kerak" };

  const id = await db.$transaction(async (tx) => {
    const rec = await tx.goodsReceipt.create({
      data: { docNo: await nextNo(tx, "goodsReceipt", "K"), date: new Date(d.date), supplierId: d.supplierId, warehouseId: d.warehouseId, note: d.note, createdById: s.userId, items: { create: items } },
    });
    await tx.stockMove.createMany({
      data: items.map((i) => ({
        type: "RECEIPT" as const, date: new Date(d.date), warehouseId: d.warehouseId, materialId: i.materialId,
        qty: i.qty, unitCost: i.price, refType: "GoodsReceipt", refId: rec.id, createdById: s.userId,
      })),
    });
    // Kirim summasi — hisobdan chiqim. Sklad/snabjeniye kassadan pul chiqara olmaydi: bunday kirim
    // Kirim-Chiqimda "To'lanmagan kirimlar" ro'yxatiga tushadi va moliya to'laydi (`payReceipt`).
    // Direktor esa hisobni tanlab, shu zahoti to'langan deb yozishi mumkin.
    const total = items.reduce((x, i) => x + i.qty * i.price, 0);
    if (total > 0 && s.role === "DIRECTOR" && d.cashAccountId) {
      const sup = await tx.supplier.findUnique({ where: { id: d.supplierId }, select: { name: true } });
      const cashTx = await tx.cashTransaction.create({
        data: {
          type: "EXPENSE", date: new Date(d.date), cashAccountId: d.cashAccountId, amount: total,
          category: "Xomashyo", supplierId: d.supplierId, counterparty: sup?.name,
          note: `Kirim ${rec.docNo} · ${items.length} qator`,
          refType: "GoodsReceipt", refId: rec.id, createdById: s.userId,
        },
      });
      await audit(tx, s.userId, "CREATE", "CashTransaction", cashTx.id, undefined, cashTx);
    }
    await audit(tx, s.userId, "CREATE", "GoodsReceipt", rec.id, undefined, { ...rec, items });
    return rec.id;
  });
  revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/sales"); revalidatePath("/orders/new"); revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
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
  rows = rows.filter((x) => str(x.material));
  if (!rows.length) return { error: "Faylda qator yo'q" };
  for (const [i, x] of rows.entries()) {
    const q = num(x.qty); if (!(q > 0)) return { error: `${i + 1}-qator (${str(x.material)}): miqdor 0 dan katta raqam bo'lsin` };
    const pr = str(x.price) === "" ? 0 : numMoney(x.price); if (!(pr >= 0)) return { error: `${i + 1}-qator (${str(x.material)}): narx noto'g'ri` };
  }

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
