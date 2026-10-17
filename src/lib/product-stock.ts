import { db } from "./db";
import { audit } from "./audit";
import { lockStock } from "./stock-lock";
import { MAX_AMOUNT } from "./action";
import { Prisma, type Role } from "@/generated/prisma";

class AddStockError extends Error {}

/**
 * Hovliga tayyor mahsulotni qo'lda kirim qilish (retseptsiz). Sklad harakati: ADJUSTMENT (+), refType "Manual".
 * Qoldiqni hujjatsiz oshirib bo'lmasin: faqat HALI HARAKATI YO'Q mahsulotga (boshlang'ich qoldiq)
 * yoki direktor. Ishlab chiqarilgan mahsulot topshiriq orqali (PRODUCTION_OUTPUT) kirim bo'ladi.
 * Veb (`stock/products/actions.ts`) va mobil ilova (`lib/mobile/sklad-extra.ts`) shu yerdan chaqiradi.
 * Ruxsat (stock → "products") va `revalidatePath` — chaqiruvchida.
 *
 * Ikki marta bosilgan "Qo'shish": formadagi bir martalik kalit (StockMove.clientToken — unique) bilan
 * ikkinchi so'rov hech narsa yozmaydi (`dup`). Kalitsiz so'rov uchun — "harakati yo'q" tekshiruvi qulf ichida.
 */
export async function addProductStock(
  input: { productId: string; warehouseId: string; qty: number; note?: string | null; clientToken?: string | null },
  actor: { userId: string; role: Role },
): Promise<{ ok: true; dup: boolean; productId: string } | { error: string }> {
  if (!input.productId) return { error: "Mahsulot tanlanmagan" };
  if (!input.warehouseId) return { error: "Sklad tanlanmagan" };
  if (!Number.isInteger(input.qty)) return { error: "Miqdor butun son bo'lsin" };
  if (!(input.qty > 0)) return { error: "Miqdor 0 dan katta bo'lsin" };
  if (input.qty > MAX_AMOUNT) return { error: "Qiymat juda katta" };
  const [p, wh] = await Promise.all([
    db.product.findUnique({ where: { id: input.productId } }),
    db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } }),
  ]);
  if (!p || p.unit === "m3") return { error: "Faqat dona mahsulot qo'shiladi" };
  if (!wh) return { error: "Sklad topilmadi" };
  const raw = input.clientToken;
  const clientToken = typeof raw === "string" && /^[A-Za-z0-9-]{16,64}$/.test(raw.trim()) ? raw.trim() : null;
  const note = input.note?.trim() || null;
  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    if (clientToken && (await tx.stockMove.findUnique({ where: { clientToken }, select: { id: true } }))) return "dup" as const;
    if (actor.role !== "DIRECTOR") {
      const moved = await tx.stockMove.count({ where: { productId: p.id } });
      if (moved) throw new AddStockError(`"${p.name}" skladda harakati bor — qo'lda qoldiq qo'shib bo'lmaydi. Ishlab chiqarilgani topshiriq (brigada) orqali kirim bo'ladi; sanoq farqini direktor tuzatadi`);
    }
    const m = await tx.stockMove.create({ data: { type: "ADJUSTMENT", warehouseId: wh.id, productId: p.id, qty: input.qty, note: note ?? "Qo'lda qo'shildi", refType: "Manual", clientToken, createdById: actor.userId } });
    await audit(tx, actor.userId, "CREATE", "StockMove", m.id, undefined, { product: p.code, qty: input.qty, note });
    return "ok" as const;
  }).catch((e: Error) => {
    if (e instanceof AddStockError) return { error: e.message };
    if (clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "dup" as const;
    throw e;
  });
  if (typeof res === "object") return res;
  return { ok: true, dup: res === "dup", productId: p.id };
}
