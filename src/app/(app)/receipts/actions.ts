"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { num, str } from "@/lib/excel";
import { resolveMaterials } from "@/lib/import-materials";

const schema = z.object({
  supplierId: zStr("Yetkazuvchi tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
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
    await audit(tx, s.userId, "CREATE", "GoodsReceipt", rec.id, undefined, { ...rec, items });
    return rec.id;
  });
  revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/sales"); revalidatePath("/orders/new"); revalidatePath("/");
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
type ImportRow = { material?: unknown; qty?: unknown; price?: unknown; unit?: unknown };

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
    const pr = str(x.price) === "" ? 0 : num(x.price); if (!(pr >= 0)) return { error: `${i + 1}-qator (${str(x.material)}): narx noto'g'ri` };
  }

  const out = await db.$transaction(async (tx) => {
    const { result, missing, created } = await resolveMaterials(tx, rows.map((x) => ({ name: str(x.material), unit: str(x.unit) })), d.createMissing);
    if (missing.length) throw new Error(`Bunday mahsulot/xomashyo yo'q: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}. "Yo'q mahsulotlarni yaratish" ni belgilang.`);
    const items = rows.map((x) => ({ materialId: result.get(str(x.material).toLowerCase().trim())!.id, qty: num(x.qty), price: str(x.price) === "" ? 0 : num(x.price) }));
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
