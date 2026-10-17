"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { aiAllowed } from "@/lib/rate-limit";
import { aiErrorText, aiReady, insightReport } from "@/lib/ai/smm-writer";
import { syncMarketingNow } from "@/lib/smm/insights";
import { aiRateText } from "@/lib/smm/studio";

type Res = { ok?: boolean; error?: string; note?: string };

/** AI tahlil: statistika + raqobatchilar → xulosa va g'oyalar (hisobot sifatida saqlanadi) */
export async function runInsightReport(): Promise<Res> {
  const s = await requireAction("marketing", "agent");
  if (!aiReady()) return { error: "AI ulanmagan — administratorga murojaat qiling" };
  if (!aiAllowed(s.userId)) return { error: aiRateText };
  try {
    const r = await insightReport();
    const now = new Date();
    const to = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const rep = await db.smmInsightReport.create({
      data: { periodFrom: new Date(to.getTime() - 30 * 86_400_000), periodTo: to, summary: r.summary, ideas: r.ideas, createdById: s.userId, createdByName: s.fullName },
    });
    await audit(db, s.userId, "CREATE", "SmmInsightReport", rep.id, undefined, { ideas: r.ideas.length });
    revalidatePath("/marketing");
    return { ok: true };
  } catch (e) {
    return { error: aiErrorText(e) };
  }
}

/** Statistikani hozir yangilash (odatda har 6 soatda o'zi yangilanadi). Qoida `lib/smm/insights.ts` da — mobil ham shuni chaqiradi */
export async function syncNow(): Promise<Res> {
  await requireAction("marketing", "content");
  const r = await syncMarketingNow();
  if (!r.ok) return { error: r.error };
  revalidatePath("/marketing");
  return { ok: true, note: r.note };
}
