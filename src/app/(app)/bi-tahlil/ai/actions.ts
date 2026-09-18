"use server";

import { requireSession } from "@/lib/auth";
import { aiAnswer, aiReport, type Answer, type ReportType, type Report } from "@/lib/bi/ai";

export async function ask(question: string, sp: Record<string, string | undefined>): Promise<Answer> {
  await requireSession(["DIRECTOR", "FINANCE", "ACCOUNTING"]);
  const q = question.trim().slice(0, 300);
  if (!q) return { key: "none", text: "Savol bo'sh." };
  return aiAnswer(q, sp);
}

export async function report(type: ReportType): Promise<Report> {
  await requireSession(["DIRECTOR", "FINANCE", "ACCOUNTING"]);
  return aiReport(type);
}
