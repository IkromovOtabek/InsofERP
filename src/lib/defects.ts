import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { lockStock, STOCK_EPS } from "@/lib/stock-lock";

/**
 * Brak yozuvi — yagona joy (veb sex sahifasi ham, brigadir ilovasi ham).
 *
 * Mahsulot hovli qoldig'idan WRITE_OFF bilan ayriladi — shuning uchun qoldiqdan ko'p brak
 * yozib bo'lmaydi (u holda mahsulot hali kirim qilinmagan bo'ladi).
 */
export type DefectInput = { productId: string; qty: number; reason: string; brigadeId?: string | null; note?: string | null; taskId?: string | null };

/** Topshiriq bo'yicha brak yig'indisi (id → miqdor) — kartochka va jadvallarda "nechtasi brak" uchun. */
export async function taskDefectTotals(taskIds: string[]): Promise<Map<string, number>> {
  if (!taskIds.length) return new Map();
  const g = await db.productDefect.groupBy({ by: ["taskId"], where: { taskId: { in: taskIds } }, _sum: { qty: true } });
  return new Map(g.map((r) => [r.taskId!, Number(r._sum.qty ?? 0)]));
}

export async function addProductDefect(d: DefectInput, userId: string): Promise<{ error: string } | { ok: true; id: string; text: string }> {
  if (!(d.qty > 0)) return { error: "Miqdor 0 dan katta bo'lsin" };
  if (!d.reason.trim()) return { error: "Sababini tanlang" };
  const product = await db.product.findUnique({ where: { id: d.productId }, select: { id: true, name: true, unit: true } });
  if (!product) return { error: "Mahsulot topilmadi" };
  const wh = await db.warehouse.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!wh) return { error: "Sklad ochilmagan" };

  // Tekshiruv va yozuv bitta tranzaksiyada, sklad qulfi ostida: ikki brak bir vaqtda kelsa
  // ikkalasi eski qoldiqni ko'rib o'tib ketmasin (bajarilganidan / hovlidagidan ko'p brak).
  const res = await db.$transaction(async (tx): Promise<{ error: string } | { id: string }> => {
    await lockStock(tx);
    let brigadeId = d.brigadeId || null;
    // Topshiriqdan chiqqan brak — shu topshiriqda bajarilganidan (oldingi braklar ayirilgan) ko'p bo'lolmaydi
    if (d.taskId) {
      const t = await tx.brigadeTask.findUnique({ where: { id: d.taskId }, select: { doneQty: true, brigadeId: true, orderItem: { select: { productId: true } } } });
      if (!t) return { error: "Topshiriq topilmadi" };
      if (t.orderItem.productId !== product.id) return { error: "Brak topshiriqdagi mahsulotga yozilishi kerak" };
      const g = await tx.productDefect.aggregate({ where: { taskId: d.taskId }, _sum: { qty: true } });
      const prev = Number(g._sum.qty ?? 0);
      const room = Number(t.doneQty) - prev;
      if (d.qty > room + STOCK_EPS) {
        return { error: room > 0 ? `Bu topshiriqda bajarilgan ${fq(Number(t.doneQty))} ${unitLabel(product.unit)}, shundan ${fq(prev)} brak yozilgan — yana ko'pi bilan ${fq(room)}` : "Avval bajarilgan miqdorni kiriting — brak undan oshmaydi" };
      }
      brigadeId = brigadeId ?? t.brigadeId;
    }
    const bal = await tx.stockMove.aggregate({ where: { productId: product.id }, _sum: { qty: true } });
    const balance = Number(bal._sum.qty ?? 0);
    if (d.qty > balance + STOCK_EPS) {
      return { error: `Hovlida ${product.name} faqat ${fq(Math.max(0, balance))} ${unitLabel(product.unit)} — brak undan ko'p bo'lolmaydi. Avval ishlab chiqarilgani qayd qilinsin.` };
    }

    const def = await tx.productDefect.create({
      data: { productId: product.id, qty: d.qty, reason: d.reason, brigadeId, taskId: d.taskId || null, note: d.note || null, createdById: userId },
    });
    await tx.stockMove.create({
      data: {
        type: "WRITE_OFF", warehouseId: wh.id, productId: product.id, brigadeId, qty: -d.qty,
        refType: "ProductDefect", refId: def.id, note: `Brak: ${d.reason}${d.note ? ` · ${d.note}` : ""}`, createdById: userId,
      },
    });
    await audit(tx, userId, "CREATE", "ProductDefect", def.id, undefined, def);
    return { id: def.id };
  });
  if ("error" in res) return res;
  const id = res.id;
  return { ok: true, id, text: `${fq(d.qty)} ${unitLabel(product.unit)} ${product.name} — brak (${d.reason})` };
}
