"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zOpt, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { approveBoost, marketingSettings, rejectBoost, requestBoost, toggleBoost } from "@/lib/smm/boosts";

const actorOf = (s: { userId: string; fullName: string }) => ({ userId: s.userId, name: s.fullName });

export async function requestBoostAction(contentId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "boost");
  const r = parseForm(z.object({
    objective: z.enum(["REACH", "MESSAGES", "LEADS"]),
    audience: z.string().min(1),
    dailyBudget: zDec(0.01),
    days: z.coerce.number({ message: "kun raqam bo'lsin" }).int().min(1, "kamida 1 kun").max(30, "ko'pi bilan 30 kun"),
    note: zOpt,
  }), fd);
  if ("error" in r) return { error: r.error };
  const res = await requestBoost({ contentId, ...r.data }, actorOf(s));
  if (!res.ok) return { error: res.error };
  revalidatePath("/marketing", "layout");
  return { ok: true };
}

export async function approveBoostAction(id: string): Promise<ActionState> {
  const s = await requireAction("marketing", "boost_approve");
  const res = await approveBoost(id, actorOf(s));
  revalidatePath("/marketing", "layout");
  return res.ok ? { ok: true, note: res.note } : { error: res.error };
}

export async function rejectBoostAction(id: string): Promise<ActionState> {
  const s = await requireAction("marketing", "boost_approve");
  const res = await rejectBoost(id, null, actorOf(s));
  revalidatePath("/marketing", "layout");
  return res.ok ? { ok: true } : { error: res.error };
}

export async function toggleBoostAction(id: string, to: "PAUSED" | "ACTIVE"): Promise<ActionState> {
  const s = await requireAction("marketing", "boost_approve");
  const res = await toggleBoost(id, to, actorOf(s));
  revalidatePath("/marketing", "layout");
  return res.ok ? { ok: true } : { error: res.error };
}

/** Limitlar va standart heshteglar — targetni tasdiqlay oladigan (odatda direktor) */
export async function saveMarketingSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "boost_approve");
  const r = parseForm(z.object({
    adCurrency: z.string().trim().regex(/^[A-Z]{3}$/, "valyuta: USD, UZS kabi 3 harf"),
    boostDailyCap: zDec(0),
    boostMonthlyCap: zDec(0),
    defaultHashtags: zOpt,
  }), fd);
  if ("error" in r) return { error: r.error };
  if (r.data.boostDailyCap > r.data.boostMonthlyCap) return { error: "Kunlik limit oylikdan katta bo'lmasin" };
  const before = await marketingSettings();
  const after = await db.marketingSettings.update({
    where: { id: "main" },
    data: { adCurrency: r.data.adCurrency, boostDailyCap: new Prisma.Decimal(r.data.boostDailyCap), boostMonthlyCap: new Prisma.Decimal(r.data.boostMonthlyCap), defaultHashtags: r.data.defaultHashtags },
  });
  await audit(db, s.userId, "UPDATE", "MarketingSettings", "main", before, after);
  revalidatePath("/marketing", "layout");
  return { ok: true };
}
