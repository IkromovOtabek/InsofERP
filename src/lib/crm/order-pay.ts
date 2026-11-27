import { db } from "@/lib/db";
import { orderTotal } from "@/lib/order-total";
import { customerBalances } from "@/lib/receivables";

/**
 * Zayavkaning to'lov holati (CRM_SPEC 3.3: To'lanmagan / Qisman to'landi / To'liq to'landi).
 * ERP'da to'lov mijoz hisobiga tushadi, zayavkaga emas — shuning uchun mijozning jami to'lagani (`customerBalances().paid`)
 * bekor qilinmagan zayavkalariga sana tartibida (eng eskisidan) taqsimlanadi. Debitorka bilan bir xil manbadan.
 */
export type PayStatus = "UNPAID" | "PARTIAL" | "PAID";
export type OrderPay = { total: number; paid: number; status: PayStatus };

export const PAY_LABEL: Record<PayStatus, string> = { UNPAID: "To'lanmagan", PARTIAL: "Qisman to'landi", PAID: "To'liq to'landi" };
export const PAY_COLOR = { UNPAID: "red", PARTIAL: "amber", PAID: "green" } as const;

export async function orderPayments(customerIds: string[]): Promise<Map<string, OrderPay>> {
  const out = new Map<string, OrderPay>();
  if (!customerIds.length) return out;
  const [orders, bal] = await Promise.all([
    db.order.findMany({
      where: { customerId: { in: customerIds }, kind: "SALE", status: { not: "CANCELLED" } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { id: true, customerId: true, deliveryFee: true, items: { select: { qtyM3: true, price: true } } },
    }),
    customerBalances({ ids: customerIds }),
  ]);
  const left = new Map<string, number>(customerIds.map((id) => [id, Math.max(0, bal.get(id)?.paid ?? 0)]));
  for (const o of orders) {
    const total = orderTotal(o);
    const avail = left.get(o.customerId) ?? 0;
    const paid = Math.min(total, avail);
    left.set(o.customerId, avail - paid);
    out.set(o.id, { total, paid, status: total > 0 && paid >= total - 0.5 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID" });
  }
  return out;
}
