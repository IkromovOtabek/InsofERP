import { Badge } from "@/components/ui";
import type { InvoiceStatus } from "@/generated/prisma";

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; color: "slate" | "blue" | "amber" | "red" | "green" }> = {
  OPEN: { label: "Ochiq", color: "amber" },
  PARTIAL: { label: "Qisman to'langan", color: "blue" },
  PAID: { label: "To'langan", color: "green" },
  CANCELLED: { label: "Bekor", color: "slate" },
};
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = INVOICE_STATUS[status];
  return <Badge color={s.color}>{s.label}</Badge>;
}
