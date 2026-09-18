import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CATALOG, aiAnswer, aiDirector, matchQuestion, type Answer } from "@/lib/bi/ai";
import { parseRange } from "@/lib/bi/core";
import { askClaude, llmEnabled, type LlmTurn } from "@/lib/ai/claude";

const AI_ROLES = new Set(["DIRECTOR", "FINANCE", "ACCOUNTING"]);
type Body = { mode: "quick" | "chat"; key?: string; question?: string; history?: LlmTurn[]; sp?: Record<string, string | undefined> };

async function guard() {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!AI_ROLES.has(s.role)) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  return { s };
}

/** Tez savollar katalogi (Team24: /api/v1/ai/suggestions). */
export async function GET() {
  const g = await guard(); if (g.error) return g.error;
  return NextResponse.json({ groups: CATALOG.map((c) => ({ key: c.group, label: c.group, icon: c.icon, questions: c.items.map((i) => ({ id: i.key, text: i.q })) })), llm: llmEnabled() });
}

/** quick — katalogdagi savol (0 token). chat — erkin savol: mos kelsa qoida, bo'lmasa (kalit bo'lsa) Claude. */
export async function POST(req: Request) {
  const g = await guard(); if (g.error) return g.error;
  const t0 = Date.now();
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "BAD_JSON" }, { status: 400 }); }
  const sp = body.sp ?? {};
  const range = parseRange(sp);

  try {
    if (body.mode === "quick") {
      const q = CATALOG.flatMap((c) => c.items).find((i) => i.key === body.key);
      if (!q) return NextResponse.json({ error: "UNKNOWN_KEY" }, { status: 400 });
      const answer = await aiAnswer(q.q, sp);
      return NextResponse.json({ answer, level: 0, period: range.label, latency: Date.now() - t0 });
    }

    const question = (body.question ?? "").trim().slice(0, 1000);
    if (!question) return NextResponse.json({ error: "EMPTY" }, { status: 400 });
    const key = matchQuestion(question);
    const rule = await aiAnswer(question, sp);

    // Kalit yo'q → qoida asosidagi javob (mos kelsa hisob-kitob, bo'lmasa "javob bera olmayman")
    if (!llmEnabled()) return NextResponse.json({ answer: rule, level: 0, period: range.label, latency: Date.now() - t0 });

    // Claude: kontekst = rahbar xulosasi + mos kelgan qoida javobi
    const d = await aiDirector(range);
    const ctx = [
      `Davr: ${range.label}`,
      ...d.summary,
      d.risks.length ? "Xavflar:\n" + d.risks.map((r) => `- ${r.title}: ${r.money}. ${r.text} Harakat: ${r.action}`).join("\n") : "Shoshilinch xavf yo'q.",
      key ? `Savolga mos hisob-kitob (${rule.key}): ${rule.text}${rule.bullets?.length ? "\n" + rule.bullets.map((b) => `- ${b}`).join("\n") : ""}` : "",
    ].filter(Boolean).join("\n");
    const llm = await askClaude(question, ctx, body.history ?? []);
    const answer: Answer = { key: rule.key, text: llm.text, href: rule.href };
    return NextResponse.json({ answer, level: 2, model: llm.model, period: range.label, latency: Date.now() - t0 });
  } catch (e) {
    console.error("[ai]", e);
    return NextResponse.json({ error: "SERVER" }, { status: 500 });
  }
}
