"use server";

import { requireAdmin } from "@/lib/control/auth";
import { DEPLOY_REF_RE } from "@/lib/control/devops/contract";
import { loadDeployActions } from "@/lib/control/devops/data";
import type { ActionView } from "@/lib/control/monitor/shared";
import { enqueueAction, type MonitorResult } from "../monitor-actions";

/**
 * Relizlar: DEPLOY / ROLLBACK so'rovi. Panel serverga tegmaydi — AgentAction navbatiga qo'yadi (enqueueAction: sessiya,
 * zod + contract tekshiruvi, «TASDIQLAYMAN» yozma tasdig'i, joriy parol qayta tekshiruvi, chastota, jurnal). «Bir vaqtda
 * bitta deploy/rollback» tekshiruvi ham enqueueAction ichida — AgentAction yaratish bilan bitta tranzaksiyada (advisory lock).
 */
export async function requestDeploy(ref: string, confirm: string, password: string): Promise<MonitorResult> {
  await requireAdmin();
  const r = (ref ?? "").trim().toLowerCase() || "main";
  if (!DEPLOY_REF_RE.test(r)) return { error: "Ref: faqat «main» yoki 7–40 belgili commit sha (0-9, a-f)" };
  return enqueueAction("DEPLOY", { ref: r }, null, confirm, password);
}

export async function requestRollback(confirm: string, password: string): Promise<MonitorResult> {
  await requireAdmin();
  return enqueueAction("ROLLBACK", {}, null, confirm, password);
}

/** Jonli kuzatuv (2–3 s da): ishlayotgan va oxirgi deploy amallari. */
export async function deployStatus(): Promise<{ active: ActionView | null; last: ActionView | null }> {
  await requireAdmin();
  const { history, active } = await loadDeployActions(1);
  return { active, last: history[0] ?? null };
}
