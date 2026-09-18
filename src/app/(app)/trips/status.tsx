import { Badge } from "@/components/ui";
import type { TripStatus } from "@/generated/prisma";

export const TRIP_STATUS: Record<TripStatus, { label: string; color: "slate" | "blue" | "amber" | "red" | "green" | "violet" }> = {
  PLANNED: { label: "Rejalashtirilgan", color: "slate" },
  LOADED: { label: "Yuklandi", color: "blue" },
  ON_ROAD: { label: "Yo'lda", color: "amber" },
  DELIVERED: { label: "Yetkazildi", color: "green" },
  CANCELLED: { label: "Bekor", color: "red" },
};

export function TripStatusBadge({ status }: { status: TripStatus }) {
  const s = TRIP_STATUS[status];
  return <Badge color={s.color}>{s.label}</Badge>;
}
