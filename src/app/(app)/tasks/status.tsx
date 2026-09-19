import { Badge } from "@/components/ui";
import type { TaskStatus } from "@/generated/prisma";

export const TASK_STATUS: Record<TaskStatus, { label: string; color: "slate" | "blue" | "amber" | "red" | "green" | "violet" }> = {
  NEW: { label: "Yuborildi", color: "blue" },
  IN_PROGRESS: { label: "Bajarilmoqda", color: "amber" },
  DONE: { label: "Bajarildi", color: "green" },
  CANCELLED: { label: "Bekor", color: "slate" },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status];
  return <Badge color={s.color}>{s.label}</Badge>;
}
