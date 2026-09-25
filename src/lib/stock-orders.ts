import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import type { Prisma } from "@/generated/prisma";

/**
 * Sklad zayavkasi — zaxiraga ishlab chiqarish.
 *
 * Mijoz zayavkasidan farqi: mijoz ham, narx ham, dastavka ham yo'q. Ma'nosi bitta —
 * "shu mahsulotdan shuncha ishlab chiqarilib, hovliga qo'yib qo'yilsin". Tayyor bo'lgani
 * hech kimga band qilinmaydi: `lib/ostatka.ts` faqat SALE zayavkalarni band hisoblaydi,
 * shuning uchun zaxira mahsulot hamma joyda "erkin" bo'lib turadi.
 *
 * Texnik jihatdan bu ham `Order` (kind = STOCK): shunda brigada tayinlash, topshiriq,
 * zames va ishlab chiqarish oynasi hech qanday o'zgarishsiz ishlayveradi. Order.customerId
 * majburiy bo'lgani uchun zayavka ichki "Sklad — zaxira" kartochkasiga yoziladi — u mijozlar
 * ro'yxatida, limit/reyting hisobida va ECO sinxronida ko'rinmaydi.
 */

/** Sklad zayavkasini kim ocha oladi: sotuv, ishlab chiqarish, ish boshqaruvchi, sklad (direktor har doim). */
export const STOCK_ORDER_ROLES = ["SALES", "PRODUCTION", "SUPERVISOR", "WAREHOUSE"] as const;

/** Ichki kartochka nomi — mijozlar ro'yxatiga chiqmaydi, faqat sklad zayavkasi egasi sifatida. */
export const STOCK_CUSTOMER_NAME = "Sklad — zaxira";
/** Sklad zayavkasining "manzili": mahsulot hech qayerga ketmaydi, zavod hovlisida qoladi. */
export const STOCK_ORDER_ADDRESS = "Zavod hovlisi — zaxira";

/** Ichki "Sklad" kartochkasi: bo'lmasa bir marta ochiladi. */
export async function stockCustomerId(tx: Prisma.TransactionClient): Promise<string> {
  const found = await tx.customer.findFirst({ where: { isInternal: true }, select: { id: true } });
  if (found) return found.id;
  const c = await tx.customer.create({ data: { name: STOCK_CUSTOMER_NAME, isInternal: true, creditLimit: 0 } });
  return c.id;
}

export type NewStockOrderInput = {
  /** Tayyor bo'lish muddati — zayavkaning `deliveryDate` maydoniga yoziladi. */
  dueDate: Date;
  items: { productId: string; qtyM3: number }[];
  isUrgent?: boolean;
  note?: string | null;
};

export type NewStockOrderResult = { id: string; orderNo: string };

/** Sklad zayavkasini ochish (qoralama). Narx yozilmaydi — hamma qator 0 so'm. */
export async function createStockOrder(input: NewStockOrderInput, userId: string): Promise<NewStockOrderResult> {
  const items = input.items.filter((i) => i.productId && i.qtyM3 > 0);
  if (items.length === 0) throw new Error("Kamida bitta mahsulot qatori kerak");
  if (Number.isNaN(input.dueDate.getTime())) throw new Error("Tayyor bo'lish muddati noto'g'ri");

  // Bitta zayavkada bir mahsulot ikki marta yozilmasin — brigada topshirig'i chalkashmasligi uchun
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.qtyM3);

  return db.$transaction(async (tx) => {
    const customerId = await stockCustomerId(tx);
    const o = await tx.order.create({
      data: {
        orderNo: await nextNo(tx, "order", "Z"),
        customerId,
        kind: "STOCK",
        deliveryDate: input.dueDate,
        deliveryAddress: STOCK_ORDER_ADDRESS,
        needsDelivery: false, // hech qayerga yetkazilmaydi — hovlida qoladi
        needsPump: false,
        onCredit: false,
        isUrgent: !!input.isUrgent,
        note: input.note ?? undefined,
        createdById: userId,
        items: { create: [...merged].map(([productId, qtyM3]) => ({ productId, qtyM3, price: 0, nds: false })) },
      },
    });
    await audit(tx, userId, "CREATE", "Order", o.id, undefined, { ...o, items: [...merged], kind: "STOCK" });
    return { id: o.id, orderNo: o.orderNo };
  });
}
