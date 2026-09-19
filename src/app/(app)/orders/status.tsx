import { Badge } from "@/components/ui";
import type { OrderStatus } from "@/generated/prisma";

export const ORDER_STATUS: Record<OrderStatus, { label: string; color: "slate" | "blue" | "amber" | "red" | "green" | "violet" }> = {
  DRAFT: { label: "Qoralama", color: "slate" },
  BLOCKED: { label: "Bloklangan", color: "red" },
  CONFIRMED: { label: "Tasdiqlangan", color: "blue" },
  IN_PRODUCTION: { label: "Ishlab chiqarilmoqda", color: "violet" },
  DELIVERED: { label: "Yetkazildi", color: "amber" },
  CLOSED: { label: "Yopilgan", color: "green" },
  CANCELLED: { label: "Bekor", color: "slate" },
};

/** Qabul qilingan zayavkalar — Sotuv bo'limida ko'rinadi: tasdiqlangan → ishlab chiqarish → yetkazildi → yopildi. */
export const SALES_STATUSES: OrderStatus[] = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"];
/** Qabul qilinmagan zayavkalar — Zayavkalar bo'limida. */
export const PENDING_STATUSES: OrderStatus[] = ["DRAFT", "BLOCKED", "CANCELLED"];

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status];
  return <Badge color={s.color}>{s.label}</Badge>;
}
