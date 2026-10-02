import { cn } from "@/lib/utils";
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

// Ixcham status belgisi — umumiy Badge'dan bir pog'ona kichikroq (kichikroq nuqta,
// to'ldirish va shrift) toki zayavkalar ro'yxati tig'izroq va professional ko'rinsin.
const STATUS_TONE: Record<(typeof ORDER_STATUS)[OrderStatus]["color"], string> = {
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
const STATUS_DOT: Record<(typeof ORDER_STATUS)[OrderStatus]["color"], string> = {
  slate: "bg-slate-400", blue: "bg-blue-500", amber: "bg-amber-500", red: "bg-red-500", green: "bg-emerald-500", violet: "bg-violet-500",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular ring-1 ring-inset", STATUS_TONE[s.color])}>
      <span aria-hidden className={cn("h-1 w-1 shrink-0 rounded-full", STATUS_DOT[s.color])} />
      {s.label}
    </span>
  );
}
