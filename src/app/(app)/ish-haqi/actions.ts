"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, requireAction } from "@/lib/auth";
import { notSignedIn } from "@/lib/access-denied";
import { audit } from "@/lib/audit";
import { parseForm, type ActionState } from "@/lib/action";
import { approveRun, calculateRun, cancelRun, payRun, recalculateRun, returnRun, submitRun } from "@/lib/hr/payroll";
import type { PayrollKind } from "@/generated/prisma";

/* Ish haqi vedomostlari — qoidalar `lib/hr/payroll.ts` da (veb va mobil bir xil). */

const refresh = (id?: string) => {
  for (const p of ["/ish-haqi", "/hisobim", "/cashflow", "/payments", "/dashboard"]) revalidatePath(p);
  if (id) revalidatePath(`/ish-haqi/${id}`);
};
async function who() {
  const s = await getSession();
  if (!s) throw notSignedIn();
  return s;
}
const asState = (r: { error?: string; note?: string; ok?: boolean }): ActionState => (r.error ? { error: r.error } : { ok: true, note: r.note });

export async function calculateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payroll", "calc");
  const month = String(fd.get("month") ?? "");
  const kind = String(fd.get("kind") ?? "") as PayrollKind;
  if (kind !== "ADVANCE" && kind !== "FINAL") return { error: "Vedomost turini tanlang" };
  const r = await calculateRun(month, kind, s);
  if (r.error) return { error: r.error };
  refresh(r.id);
  redirect(`/ish-haqi/${r.id}`);
}

export async function recalcAction(id: string): Promise<ActionState> {
  const s = await requireAction("payroll", "calc");
  const r = await recalculateRun(id, s);
  refresh(id);
  return asState(r);
}

export async function submitAction(id: string): Promise<ActionState> {
  const r = await submitRun(id, await who());
  refresh(id);
  return asState(r);
}
export async function approveAction(id: string): Promise<ActionState> {
  const r = await approveRun(id, await who());
  refresh(id);
  return asState(r);
}
export async function returnAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await returnRun(id, String(fd.get("note") ?? ""), await who());
  refresh(id);
  return asState(r);
}
export async function cancelAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await cancelRun(id, String(fd.get("reason") ?? ""), await who());
  refresh(id);
  return asState(r);
}
export async function payAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const lineIds = fd.getAll("line").map(String).filter(Boolean);
  const r = await payRun(id, { cashAccountId: String(fd.get("cashAccountId") ?? ""), lineIds: lineIds.length ? lineIds : null, note: String(fd.get("note") ?? "") }, await who());
  refresh(id);
  return asState(r);
}

// ───────────────────────── Sozlamalar ─────────────────────────

const pct = (max: number) => z.coerce.number({ message: "Foiz raqam bo'lsin" }).min(0, "Manfiy bo'lmasin").max(max, `Ko'pi ${max}`);
const settingsSchema = z.object({
  incomeTaxPct: pct(50), inpsPct: pct(10), socialTaxPct: pct(50),
  advancePct: z.coerce.number().int("Butun son").min(0).max(100), advanceDay: z.coerce.number().int().min(1, "1–28").max(28, "1–28"),
  sickPctShort: z.coerce.number().int().min(0).max(100), sickPctLong: z.coerce.number().int().min(0).max(100),
  hoursPerDay: z.coerce.number().min(1).max(24),
  vacationPaid: z.string().optional().transform((v) => v === "on"),
});

export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payroll", "settings");
  const r = parseForm(settingsSchema, fd);
  if ("error" in r) return { error: r.error };
  await db.$transaction(async (tx) => {
    const before = await tx.payrollSettings.findUnique({ where: { id: "main" } });
    const after = await tx.payrollSettings.upsert({ where: { id: "main" }, create: { id: "main", ...r.data, updatedById: s.userId }, update: { ...r.data, updatedById: s.userId } });
    await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "PayrollSettings", "main", before ?? undefined, after);
  });
  refresh();
  return { ok: true, note: "Sozlamalar saqlandi — keyingi hisobda qo'llanadi" };
}

/** Sdelka narxlari: `rate:<productId>` maydonlari (bo'sh — sdelka yo'q). */
export async function savePieceRatesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payroll", "settings");
  const updates: { id: string; rate: number | null }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("rate:")) continue;
    const raw = String(v).replace(/\s/g, "");
    const rate = raw === "" ? null : Number(raw);
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 1e12)) return { error: "Sdelka narxi raqam bo'lsin" };
    updates.push({ id: k.slice(5), rate });
  }
  const cur = new Map((await db.product.findMany({ where: { id: { in: updates.map((u) => u.id) } }, select: { id: true, pieceRate: true } })).map((p) => [p.id, p.pieceRate == null ? null : Number(p.pieceRate)]));
  const changed = updates.filter((u) => cur.has(u.id) && cur.get(u.id) !== u.rate);
  if (!changed.length) return { ok: true, note: "O'zgarish yo'q" };
  await db.$transaction(async (tx) => {
    for (const u of changed) await tx.product.update({ where: { id: u.id }, data: { pieceRate: u.rate } });
    await audit(tx, s.userId, "UPDATE", "Product", "pieceRate", undefined, { sdelka: changed });
  });
  refresh();
  return { ok: true, note: `${changed.length} ta mahsulot sdelka narxi saqlandi` };
}
