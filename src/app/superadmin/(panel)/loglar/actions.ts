"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import type { ActionStatusT } from "@/lib/control/monitor/shared";
import { enqueueAction } from "../monitor-actions";

/** Loglar: LOG_TAIL so'rovi (agent o'qiydi, panel faqat natijani — AgentAction.output — ko'rsatadi). */
export type LogRequest = { source: string; lines: string; filter: string; priority: string };

export async function requestLogs(req: LogRequest): Promise<{ id?: string; error?: string }> {
  await requireAdmin();
  const params = {
    source: String(req?.source ?? ""), lines: String(req?.lines ?? "200"),
    filter: String(req?.filter ?? "").trim(), priority: String(req?.priority ?? ""),
  };
  const r = await enqueueAction("LOG_TAIL", params, null, null);
  // Xuddi shu so'rov navbatda bo'lsa — o'shaning natijasini kutamiz
  if (r.error && r.id) return { id: r.id };
  return r.error ? { error: r.error } : { id: r.id };
}

const ID = z.string().regex(/^[a-z0-9]{10,40}$/i);

export async function logResult(id: string): Promise<{ status: ActionStatusT; output: string | null; finishedAt: string | null } | { error: string }> {
  await requireAdmin();
  if (!ID.safeParse(id).success) return { error: "Amal topilmadi" };
  const a = await control.agentAction.findUnique({ where: { id }, select: { type: true, status: true, output: true, finishedAt: true } });
  if (!a || a.type !== "LOG_TAIL") return { error: "Amal topilmadi" };
  return { status: a.status, output: a.output, finishedAt: a.finishedAt?.toISOString() ?? null };
}
