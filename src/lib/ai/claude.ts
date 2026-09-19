/**
 * Claude — erkin savollar uchun (ANTHROPIC_API_KEY bo'lganda).
 * Provayder tanlash va tizim ko'rsatmasi — llm.ts da.
 * Model dashboard'dan olingan raqamlar (context) chegarasida javob beradi.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LlmRequest, LlmReply } from "./llm";

export async function askClaude({ system, question, context, history }: LlmRequest): Promise<LlmReply> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: `DASHBOARD MA'LUMOTLARI (hozirgi holat):\n${context}\n\nSAVOL: ${question}` },
  ];
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048, // ataylab qisqa javob — chat paneli
    output_config: { effort: "low" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  });
  if (res.stop_reason === "refusal") return { text: "Bu savolga javob bera olmayman.", model: res.model };
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { text: text || "Javob olinmadi.", model: res.model };
}
