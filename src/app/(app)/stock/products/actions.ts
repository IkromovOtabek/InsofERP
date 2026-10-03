"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { lockStock } from "@/lib/stock-lock";
import { Prisma } from "@/generated/prisma";

class AddStockError extends Error {}

const schema = z.object({
  productId: zStr("Mahsulot tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  qty: z.coerce.number().int("butun son").positive("miqdor 0 dan katta bo'lsin").max(MAX_AMOUNT, "qiymat juda katta"),
  note: zOpt,
});

/**
 * Hovliga tayyor mahsulotni qo'lda kirim qilish (retseptsiz). Sklad harakati: ADJUSTMENT (+).
 * Qoldiqni hujjatsiz oshirib bo'lmasin: faqat HALI HARAKATI YO'Q mahsulotga (boshlang'ich qoldiq)
 * yoki direktor. Ishlab chiqarilgan mahsulot topshiriq orqali (PRODUCTION_OUTPUT) kirim bo'ladi.
 */
export async function addStock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "products");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const [p, wh] = await Promise.all([
    db.product.findUnique({ where: { id: d.productId } }),
    db.warehouse.findFirst({ where: { id: d.warehouseId, isActive: true }, select: { id: true } }),
  ]);
  if (!p || p.unit === "m3") return { error: "Faqat dona mahsulot qo'shiladi" };
  if (!wh) return { error: "Sklad topilmadi" };
  // Ikki marta bosilgan "Qo'shish": formadagi bir martalik kalit (StockMove.clientToken — unique) bilan
  // ikkinchi so'rov hech narsa yozmaydi. Kalitsiz eski forma uchun — "harakati yo'q" tekshiruvi qulf ichida.
  const raw = fd.get("clientToken");
  const clientToken = typeof raw === "string" && /^[A-Za-z0-9-]{16,64}$/.test(raw.trim()) ? raw.trim() : null;
  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    if (clientToken && (await tx.stockMove.findUnique({ where: { clientToken }, select: { id: true } }))) return "dup" as const;
    if (s.role !== "DIRECTOR") {
      const moved = await tx.stockMove.count({ where: { productId: p.id } });
      if (moved) throw new AddStockError(`"${p.name}" skladda harakati bor — qo'lda qoldiq qo'shib bo'lmaydi. Ishlab chiqarilgani topshiriq (brigada) orqali kirim bo'ladi; sanoq farqini direktor tuzatadi`);
    }
    const m = await tx.stockMove.create({ data: { type: "ADJUSTMENT", warehouseId: wh.id, productId: d.productId, qty: d.qty, note: d.note ?? "Qo'lda qo'shildi", refType: "Manual", clientToken, createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "StockMove", m.id, undefined, { product: p.code, qty: d.qty, note: d.note });
    return "ok" as const;
  }).catch((e: Error) => {
    if (e instanceof AddStockError) return { error: e.message };
    if (clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "dup" as const;
    throw e;
  });
  if (typeof res === "object") return res;
  revalidatePath("/stock"); revalidatePath(`/stock/products/${d.productId}`);
  redirect("/stock?tab=capacity");
}
