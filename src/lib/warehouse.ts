import { db } from "./db";
import type { Prisma } from "@/generated/prisma";
import { STOCK_EPS } from "./stock-lock";

type Client = Prisma.TransactionClient | typeof db;

/**
 * Asosiy sklad — aniq va har safar bir xil: avval `isDefault` belgilangani, bo'lmasa faol skladlardan
 * eng birinchi ochilgani (id — cuid, vaqt bo'yicha o'sadi). Ilgari `findFirst({ isActive: true })`
 * tartibsiz chaqirilardi: Postgres istalgan qatorni qaytarishi mumkin edi — kirim bir skladga,
 * chiqim boshqasiga tushib, qoldiqlar minusga ketardi.
 */
export async function defaultWarehouse(client: Client = db): Promise<{ id: string; name: string } | null> {
  return client.warehouse.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * Tayyor mahsulot chiqimi (reys yuklash, brak) uchun sklad: qoldiq va chiqim BITTA skladda bo'lishi shart.
 * Avval asosiy sklad; unda yetmasa — qoldig'i yetadigan boshqa faol sklad (eng ko'pidan).
 * Hech birida yetmasa — `short` bilan umumiy qoldiq va skladlar bo'yicha taqsimot qaytadi.
 * Tranzaksiya ichida, `lockStock` dan KEYIN chaqiriladi.
 */
export async function pickProductWarehouse(
  tx: Prisma.TransactionClient,
  productId: string,
  qty: number,
): Promise<{ id: string; name: string; balance: number } | { short: true; total: number; detail: string; none: boolean }> {
  const [warehouses, sums] = await Promise.all([
    tx.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { id: "asc" }], select: { id: true, name: true } }),
    tx.stockMove.groupBy({ by: ["warehouseId"], where: { productId }, _sum: { qty: true } }),
  ]);
  if (!warehouses.length) return { short: true, total: 0, detail: "", none: true };
  const bal = new Map(sums.map((s) => [s.warehouseId, Number(s._sum.qty ?? 0)]));
  const list = warehouses.map((w) => ({ ...w, balance: bal.get(w.id) ?? 0 }));
  const first = list[0]!;
  if (qty <= first.balance + STOCK_EPS) return first;
  const other = list.slice(1).filter((w) => qty <= w.balance + STOCK_EPS).sort((a, b) => b.balance - a.balance)[0];
  if (other) return other;
  const total = list.reduce((s, w) => s + Math.max(0, w.balance), 0);
  const detail = list.filter((w) => w.balance > STOCK_EPS).map((w) => `${w.name}: ${Math.round(w.balance * 1000) / 1000}`).join(", ");
  return { short: true, total, detail, none: false };
}
