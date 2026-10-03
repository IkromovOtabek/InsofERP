"use server";

import { requireAction } from "@/lib/auth";
import { aiAnswer, aiReport, type Answer, type ReportType, type Report } from "@/lib/bi/ai";

export async function ask(question: string, sp: Record<string, string | undefined>): Promise<Answer> {
  await requireAction("bi-tahlil", "ai");
  const q = question.trim().slice(0, 300);
  if (!q) return { key: "none", text: "Savol bo'sh." };
  return aiAnswer(q, sp);
}

export async function report(type: ReportType): Promise<Report> {
  await requireAction("bi-tahlil", "ai");
  return aiReport(type);
}
