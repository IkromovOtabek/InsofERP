import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CATALOG, aiAnswer } from "@/lib/bi/ai";
import { parseRange } from "@/lib/bi/core";
import { llmEnabled, type LlmTurn } from "@/lib/ai/llm";
import { askInsofAi } from "@/lib/bi/answer";
import { canDo } from "@/lib/permissions";
import { aiAllowed } from "@/lib/rate-limit";

type Body = { mode: "quick" | "chat"; key?: string; question?: string; history?: LlmTurn[]; sp?: Record<string, string | undefined> };

async function guard() {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  // Rol (direktor, moliya, buxgalteriya) + direktor bergan "bi-tahlil → ai" ruxsati — `lib/permissions.ts`
  if (!canDo(s, "bi-tahlil", "ai")) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
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
  // Foydalanuvchi bo'yicha chek: LLM so'rovlari pulli/kvotali — bitta hisob tsiklda so'rov yog'dirmasin
  if (!aiAllowed(g.s.userId)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const t0 = Date.now();
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "BAD_JSON" }, { status: 400 }); }
  // `null`/massiv/raqam — `body.sp` da TypeError → 500 bo'lardi
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  // Davr parametrlari — faqat satrlar (parseRange obyekt/massivni kutmaydi)
  const sp = Object.fromEntries(Object.entries(body.sp && typeof body.sp === "object" && !Array.isArray(body.sp) ? body.sp : {})
    .filter(([, v]) => typeof v === "string").map(([k, v]) => [k, (v as string).slice(0, 40)]));
  const range = parseRange(sp);

  try {
    if (body.mode === "quick") {
      const q = CATALOG.flatMap((c) => c.items).find((i) => i.key === body.key);
      if (!q) return NextResponse.json({ error: "UNKNOWN_KEY" }, { status: 400 });
      const answer = await aiAnswer(q.q, sp);
      return NextResponse.json({ answer, level: 0, period: range.label, latency: Date.now() - t0 });
    }

    const question = (typeof body.question === "string" ? body.question : "").trim().slice(0, 1000);
    if (!question) return NextResponse.json({ error: "EMPTY" }, { status: 400 });
    // Mobil yo'l bilan bir xil cheklov: cheksiz tarix LLM tokenlarini (va pulini) yeb qo'yardi
    const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
      .filter((t) => t && (t.role === "user" || t.role === "assistant"))
      .map((t) => ({ role: t.role, text: String(t.text ?? "").slice(0, 2000) }));
    const r = await askInsofAi(question, { sp, history });
    return NextResponse.json({ answer: r.answer, level: r.level, model: r.model, period: r.period, latency: Date.now() - t0 });
  } catch (e) {
    console.error("[ai]", e);
    return NextResponse.json({ error: "SERVER" }, { status: 500 });
  }
}
