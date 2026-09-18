import { db } from "./db";

/** Mijozning joriy qarzi: ochiq schyotlar − ularga to'langan summa. */
export async function customerDebt(customerId: string) {
  const [inv, pay] = await Promise.all([
    db.invoice.aggregate({ where: { customerId, status: { in: ["OPEN", "PARTIAL"] } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { customerId, invoice: { status: { in: ["OPEN", "PARTIAL"] } } }, _sum: { amount: true } }),
  ]);
  return Number(inv._sum.amount ?? 0) - Number(pay._sum.amount ?? 0);
}

/** Tasdiqlangan, lekin hali schyot yozilmagan zayavkalar summasi (limitga kiradi). */
export async function customerOpenOrdersTotal(customerId: string, excludeOrderId?: string) {
  const items = await db.orderItem.findMany({
    where: {
      order: { customerId, status: { in: ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"] }, invoices: { none: {} }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
    },
    select: { qtyM3: true, price: true },
  });
  return items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
}
