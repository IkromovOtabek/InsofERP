/**
 * Groq — OpenAI-mos chat API, asbob chaqiruvi (function calling) bilan.
 * Hujjat: https://console.groq.com/docs/tool-use · manzil: /openai/v1/chat/completions
 *
 * Model GROQ_CHAT_MODEL bilan almashtiriladi. Hisobga ochiq ro'yxatni tekshirish:
 *   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
 *
 * 2026-09-19: openai/gpt-oss-20b (standart) va openai/gpt-oss-120b asboblar bilan ishlaydi;
 * qwen/qwen3.8-27b ham. groq/compound* — internetga chiqadigan agentlar, ishlatilmaydi.
 * Ro'yxat o'zgarishi mumkin — model o'chirilgan bo'lsa Groq 404 qaytaradi, xato matnida model nomi bo'ladi.
 */

import { MAX_TOOL_ROUNDS, type LlmRequest, type LlmReply } from "./llm";
import { runTool } from "./tools";

const URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning?: string }
  | { role: "tool"; tool_call_id: string; name: string; content: string };
type GroqResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; reasoning?: string; tool_calls?: ToolCall[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 xabaridan kutish vaqtini o'qish: "try again in 3.06s" / "in 1m12.5s" yoki Retry-After sarlavhasi. */
function retryAfterSec(res: Response, message: string): number | null {
  const h = Number(res.headers.get("retry-after"));
  if (Number.isFinite(h) && h > 0) return h;
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(message);
  if (m) return Number(m[1] ?? 0) * 60 + Number(m[2]);
  return null;
}

/**
 * Bepul tarifda daqiqalik token limiti (TPM) kichik — bitta savol 2–3 so'rovdan iborat bo'lgani uchun
 * 429 tez-tez keladi. Groq aniq necha soniya kutishni aytadi: shuncha kutib qayta urinamiz (60 s gacha).
 */
async function post(body: Record<string, unknown>): Promise<GroqResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY!}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let json: GroqResponse;
    try { json = JSON.parse(raw) as GroqResponse; } catch { throw new Error(`Groq javobi tushunarsiz (${res.status}): ${raw.slice(0, 200)}`); }
    if (res.ok) return json;
    const msg = json.error?.message ?? raw.slice(0, 200);
    const wait = res.status === 429 ? retryAfterSec(res, msg) : null;
    if (wait !== null && wait <= 60 && attempt < 3) {
      console.warn(`[groq] 429 — ${wait.toFixed(1)} s kutib qayta urinamiz (${attempt + 1}/3)`);
      await sleep(wait * 1000 + 500);
      continue;
    }
    throw new Error(`Groq xatosi (${res.status}): ${msg}`);
  }
}

export async function askGroq({ system, question, context, history, tools }: LlmRequest): Promise<LlmReply> {
  const model = process.env.GROQ_CHAT_MODEL ?? MODEL;
  const messages: Msg[] = [
    { role: "system", content: system },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: `KONTEKST:\n${context}\n\nSAVOL: ${question}` },
  ];
  const toolDefs = tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const used: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const body: Record<string, unknown> = {
      model, messages, tools: toolDefs,
      // oxirgi raundda asbob chaqirish taqiqlanadi — model javob berishga majbur
      tool_choice: round < MAX_TOOL_ROUNDS ? "auto" : "none",
      max_tokens: 2048, temperature: 0.2,
    };
    // gpt-oss — fikrlovchi model; "low" javobni tezlashtiradi va chat uchun yetarli.
    if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

    const json = await post(body);
    if (json.usage) console.log(`[groq] ${model} raund ${round + 1}: so'rov ${json.usage.prompt_tokens} · javob ${json.usage.completion_tokens} token`);

    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error("Groq: javob bo'sh");
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      // Fikrlash matni (reasoning) alohida keladi — foydalanuvchiga faqat yakuniy javob ko'rsatiladi.
      return { text: msg.content?.trim() || "Javob olinmadi.", model: json.model ?? model, tools: used };
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls, ...(msg.reasoning ? { reasoning: msg.reasoning } : {}) });
    const results = await Promise.all(calls.map((c) => runTool(tools, c.function.name, c.function.arguments)));
    calls.forEach((c, i) => {
      used.push(c.function.name);
      messages.push({ role: "tool", tool_call_id: c.id, name: c.function.name, content: results[i] });
    });
  }
  throw new Error("Groq: asbob chaqiruvlari limiti oshdi");
}
