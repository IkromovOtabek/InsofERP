import { Badge, type BadgeColor } from "@/components/ui";
import type { TenantStatus } from "@/generated/control";

export const TENANT_STATUS: Record<TenantStatus, { label: string; color: BadgeColor }> = {
  PROVISIONING: { label: "Ishga tushirilmagan", color: "amber" },
  ACTIVE: { label: "Faol", color: "green" },
  SUSPENDED: { label: "To'xtatilgan", color: "red" },
  ARCHIVED: { label: "Arxiv", color: "slate" },
};

export function TenantStatusBadge({ s }: { s: TenantStatus }) {
  return <Badge color={TENANT_STATUS[s].color}>{TENANT_STATUS[s].label}</Badge>;
}

export function Health({ up, label }: { up: boolean | null | undefined; label: string }) {
  if (up == null) return <span className="text-xs text-slate-400">{label}: —</span>;
  return <Badge color={up ? "green" : "red"}>{label}</Badge>;
}

/** "5 daq oldin" — oxirgi faollik/tekshiruv uchun. */
export function ago(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "hozir";
  if (m < 60) return `${m} daq oldin`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} soat oldin`;
  return `${Math.round(h / 24)} kun oldin`;
}
