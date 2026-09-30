import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";

/**
 * Brak yozuvi — yagona joy (veb sex sahifasi ham, brigadir ilovasi ham).
 *
 * Mahsulot hovli qoldig'idan WRITE_OFF bilan ayriladi — shuning uchun qoldiqdan ko'p brak
 * yozib bo'lmaydi (u holda mahsulot hali kirim qilinmagan bo'ladi).
 */
export type DefectInput = { productId: string; qty: number; reason: string; brigadeId?: string | null; note?: string | null };

export async function addProductDefect(d: DefectInput, userId: string): Promise<{ error: string } | { ok: true; id: string; text: string }> {
  if (!(d.qty > 0)) return { error: "Miqdor 0 dan katta bo'lsin" };
  if (!d.reason.trim()) return { error: "Sababini tanlang" };
  const product = await db.product.findUnique({ where: { id: d.productId }, select: { id: true, name: true, unit: true } });
  if (!product) return { error: "Mahsulot topilmadi" };
  const wh = await db.warehouse.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!wh) return { error: "Sklad ochilmagan" };
  const bal = await db.stockMove.aggregate({ where: { productId: product.id }, _sum: { qty: true } });
  const balance = Number(bal._sum.qty ?? 0);
  if (d.qty > balance + 0.0005) {
    return { error: `Hovlida ${product.name} faqat ${fq(Math.max(0, balance))} ${unitLabel(product.unit)} — brak undan ko'p bo'lolmaydi. Avval ishlab chiqarilgani qayd qilinsin.` };
  }

  const id = await db.$transaction(async (tx) => {
    const def = await tx.productDefect.create({
      data: { productId: product.id, qty: d.qty, reason: d.reason, brigadeId: d.brigadeId || null, note: d.note || null, createdById: userId },
    });
    await tx.stockMove.create({
      data: {
        type: "WRITE_OFF", warehouseId: wh.id, productId: product.id, brigadeId: d.brigadeId || null, qty: -d.qty,
        refType: "ProductDefect", refId: def.id, note: `Brak: ${d.reason}${d.note ? ` · ${d.note}` : ""}`, createdById: userId,
      },
    });
    await audit(tx, userId, "CREATE", "ProductDefect", def.id, undefined, def);
    return def.id;
  });
  return { ok: true, id, text: `${fq(d.qty)} ${unitLabel(product.unit)} ${product.name} — brak (${d.reason})` };
}
