/**
 * Claude — erkin savollar uchun (ANTHROPIC_API_KEY bo'lganda), asbob chaqiruvi bilan.
 * Provayder tanlash va tizim ko'rsatmasi — llm.ts da, asboblar — tools.ts da.
 * Model kerakli raqamni asboblar orqali bazadan oladi va shu chegarada javob beradi.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MAX_TOOL_ROUNDS, type LlmRequest, type LlmReply } from "./llm";
import { runTool } from "./tools";

const MODEL = "claude-opus-5";

export async function askClaude({ system, question, context, history, tools }: LlmRequest): Promise<LlmReply> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: `KONTEKST:\n${context}\n\nSAVOL: ${question}` },
  ];
  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema }));
  const used: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? MODEL,
      max_tokens: 4096, // ataylab qisqa javob — chat paneli / Telegram
      output_config: { effort: "low" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: toolDefs,
      // oxirgi raundda asbob chaqirish taqiqlanadi — model javob berishga majbur
      ...(round === MAX_TOOL_ROUNDS ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    if (res.stop_reason === "refusal") return { text: "Bu savolga javob bera olmayman.", model: res.model, tools: used };

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text || "Javob olinmadi.", model: res.model, tools: used };
    }

    // Javobning to'liq mazmuni (fikrlash bloklari bilan) qaytariladi — API shuni talab qiladi.
    messages.push({ role: "assistant", content: res.content });
    const results = await Promise.all(uses.map((u) => runTool(tools, u.name, u.input)));
    messages.push({
      role: "user",
      content: uses.map((u, i) => { used.push(u.name); return { type: "tool_result" as const, tool_use_id: u.id, content: results[i] }; }),
    });
  }
  throw new Error("Claude: asbob chaqiruvlari limiti oshdi");
}
