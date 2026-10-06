"use server";

import { requireAdmin } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { DEPLOY_REF_RE, DETACHED_ACTIONS } from "@/lib/control/devops/contract";
import { loadDeployActions } from "@/lib/control/devops/data";
import type { ActionView } from "@/lib/control/monitor/shared";
import { enqueueAction, type MonitorResult } from "../monitor-actions";

/**
 * Relizlar: DEPLOY / ROLLBACK so'rovi. Panel serverga tegmaydi — AgentAction navbatiga qo'yadi (enqueueAction: sessiya,
 * zod + contract tekshiruvi, «TASDIQLAYMAN» yozma tasdig'i, chastota, jurnal). Bu yerda qo'shimcha: bir vaqtda bitta deploy.
 */
async function busy(): Promise<string | null> {
  const a = await control.agentAction.findFirst({ where: { type: { in: [...DETACHED_ACTIONS] }, status: { in: ["PENDING", "RUNNING"] } }, select: { id: true } });
  return a ? a.id : null;
}

export async function requestDeploy(ref: string, confirm: string): Promise<MonitorResult> {
  await requireAdmin();
  const r = (ref ?? "").trim().toLowerCase() || "main";
  if (!DEPLOY_REF_RE.test(r)) return { error: "Ref: faqat «main» yoki 7–40 belgili commit sha (0-9, a-f)" };
  const b = await busy();
  if (b) return { error: "Boshqa deploy/qaytarish hozir bajarilmoqda — tugashini kuting", id: b };
  return enqueueAction("DEPLOY", { ref: r }, null, confirm);
}

export async function requestRollback(confirm: string): Promise<MonitorResult> {
  await requireAdmin();
  const b = await busy();
  if (b) return { error: "Boshqa deploy/qaytarish hozir bajarilmoqda — tugashini kuting", id: b };
  return enqueueAction("ROLLBACK", {}, null, confirm);
}

/** Jonli kuzatuv (2–3 s da): ishlayotgan va oxirgi deploy amallari. */
export async function deployStatus(): Promise<{ active: ActionView | null; last: ActionView | null }> {
  await requireAdmin();
  const { history, active } = await loadDeployActions(1);
  return { active, last: history[0] ?? null };
}
