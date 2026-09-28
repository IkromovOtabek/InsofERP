import { requireMobileUser, MobileAuthError } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { CATALOG, aiAnswer } from "@/lib/bi/ai";
import { parseRange } from "@/lib/bi/core";
import { askInsofAi } from "@/lib/bi/answer";
import { llmEnabled, type LlmTurn } from "@/lib/ai/llm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Vebdagi AI panel (`/api/ai`) bilan bir xil rollar. */
const AI_ROLES = new Set(["DIRECTOR", "FINANCE", "ACCOUNTING"]);
type Body = { mode?: "quick" | "chat"; key?: string; question?: string; history?: LlmTurn[] };

async function guard(req: Request) {
  const user = await requireMobileUser(req);
  if (!AI_ROLES.has(user.role)) throw new MobileAuthError("FORBIDDEN", "AI yordamchi faqat direktor va moliya uchun", 403);
  return user;
}

/** GET /api/mobile/ai — tez savollar katalogi (ilovadagi chiplar). */
export async function GET(req: Request) {
  return handle(async () => {
    await guard(req);
    return {
      llm: llmEnabled(),
      groups: CATALOG.map((c) => ({ label: c.group, questions: c.items.map((i) => ({ key: i.key, text: i.q })) })),
    };
  });
}

/**
 * POST /api/mobile/ai — `quick`: katalogdagi savol (0 token), `chat`: erkin savol
 * (mos kelsa qoida, bo'lmasa til modeli). Davr — joriy oy, vebdagi panel standarti.
 */
export async function POST(req: Request) {
  return handle(async () => {
    await guard(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const sp = { period: "month" };
    const range = parseRange(sp);

    if (body.mode === "quick") {
      const q = CATALOG.flatMap((c) => c.items).find((i) => i.key === body.key);
      if (!q) throw new MobileAuthError("UNKNOWN_KEY", "Bunday savol yo'q", 400);
      return { answer: await aiAnswer(q.q, sp), level: 0, period: range.label };
    }

    const question = (body.question ?? "").trim().slice(0, 1000);
    if (!question) throw new MobileAuthError("EMPTY", "Savol bo'sh", 400);
    // Tarix qisqa: Groq bepul tarifida bitta so'rov 8K token bilan cheklangan
    const history = (body.history ?? []).slice(-6).map((t) => ({ role: t.role, text: String(t.text).slice(0, 2000) }));
    const r = await askInsofAi(question, { sp, history });
    return { answer: r.answer, level: r.level, model: r.model, period: r.period };
  });
}

export const OPTIONS = preflight;
