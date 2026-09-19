/**
 * Groq — OpenAI-mos chat API. Bepul tarif, karta talab qilinmaydi (sinov uchun).
 * Hujjat: https://console.groq.com/docs/models · manzil: /openai/v1/chat/completions
 *
 * Model GROQ_CHAT_MODEL bilan almashtiriladi. Hisobga ochiq ro'yxatni tekshirish:
 *   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
 *
 * 2026-09-19 sinovi (bir xil o'zbekcha savol, dashboard konteksti bilan):
 *   openai/gpt-oss-20b   — standart. 0,6 s, ma'lumotdan chetga chiqmadi, sabablarni to'g'ri ajratdi
 *   qwen/qwen3.8-27b     — 1,3 s, eng qisqa va aniq javob, yaxshi muqobil
 *   openai/gpt-oss-120b  — 1,5 s, eng ravon, LEKIN yo'q menyu yo'llari va yo'q raqamlarni o'ylab topdi
 * Llama modellari bu hisobda yo'q (404). groq/compound* — internetga chiqadigan agentlar, ishlatilmaydi.
 * Ro'yxat o'zgarishi mumkin — model o'chirilgan bo'lsa Groq 404 qaytaradi, xato matnida model nomi bo'ladi.
 */

import type { LlmRequest, LlmReply } from "./llm";

const URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";

type GroqResponse = {
  model?: string;
  choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[];
  error?: { message?: string };
};

export async function askGroq({ system, question, context, history }: LlmRequest): Promise<LlmReply> {
  const model = process.env.GROQ_CHAT_MODEL ?? MODEL;
  const messages = [
    { role: "system" as const, content: system },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.text })),
    { role: "user" as const, content: `DASHBOARD MA'LUMOTLARI (hozirgi holat):\n${context}\n\nSAVOL: ${question}` },
  ];
  const body: Record<string, unknown> = { model, messages, max_tokens: 2048, temperature: 0.3 };
  // gpt-oss — fikrlovchi model; "low" javobni tezlashtiradi va chat uchun yetarli.
  // Boshqa modellar bu parametrni rad etishi mumkin, shuning uchun faqat gpt-oss uchun yuboriladi.
  if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY!}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json: GroqResponse;
  try { json = JSON.parse(raw) as GroqResponse; } catch { throw new Error(`Groq javobi tushunarsiz (${res.status}): ${raw.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`Groq xatosi (${res.status}): ${json.error?.message ?? raw.slice(0, 200)}`);

  // Fikrlash matni (reasoning) alohida keladi — foydalanuvchiga faqat yakuniy javob ko'rsatiladi.
  const text = json.choices?.[0]?.message?.content?.trim();
  return { text: text || "Javob olinmadi.", model: json.model ?? model };
}
