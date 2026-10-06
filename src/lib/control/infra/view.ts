import { control } from "../db";
import { loadMonitorSnapshot, toActionView } from "../monitor/snapshot";
import type { ActionView, CheckView, MonitorSnapshot } from "../monitor/shared";
import { infraKey, type BackupInventory, type SystemInfo } from "./contract";

/**
 * Zaxira va Tizim sahifalari uchun ma'lumot — faqat O'QIYDI (agent yozgan ServiceCheck va AgentAction).
 * Monitoring surati (agent holati, host) umumiy keshdan olinadi.
 */
export type InfraView = {
  snap: MonitorSnapshot;
  check: (key: string) => CheckView | null;
  backup: BackupInventory | null;
  system: SystemInfo | null;
  actions: ActionView[];
};

const asObj = <T,>(v: unknown): T | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : null);

export async function loadInfraView(actionTypes: string[]): Promise<InfraView> {
  const [snap, rows] = await Promise.all([
    loadMonitorSnapshot(),
    control.agentAction.findMany({ where: { type: { in: actionTypes } }, orderBy: { requestedAt: "desc" }, take: 15 }),
  ]);
  const ids = [...new Set(rows.map((r) => r.requestedById).filter((x): x is string => !!x))];
  const admins = ids.length ? await control.superAdmin.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(admins.map((a) => [a.id, a.fullName]));
  const byKey = new Map(snap.checks.map((c) => [c.key, c]));
  const check = (key: string) => byKey.get(key) ?? null;
  return {
    snap, check,
    backup: asObj<BackupInventory>(check(infraKey.backup())?.data),
    system: asObj<SystemInfo>(check(infraKey.system())?.data),
    actions: rows.map((r) => toActionView(r, names)),
  };
}
