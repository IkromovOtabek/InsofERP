import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CATALOG, aiAnswer } from "@/lib/bi/ai";
import { parseRange } from "@/lib/bi/core";
import { llmEnabled, type LlmTurn } from "@/lib/ai/llm";
import { askInsofAi } from "@/lib/bi/answer";

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
    const r = await askInsofAi(question, { sp, history: body.history ?? [] });
    return NextResponse.json({ answer: r.answer, level: r.level, model: r.model, period: r.period, latency: Date.now() - t0 });
  } catch (e) {
    console.error("[ai]", e);
    return NextResponse.json({ error: "SERVER" }, { status: 500 });
  }
}
