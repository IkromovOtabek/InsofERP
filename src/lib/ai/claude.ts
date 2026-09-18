import Anthropic from "@anthropic-ai/sdk";

/**
 * Erkin savollar uchun Claude. Faqat ANTHROPIC_API_KEY bo'lganda ishlaydi —
 * bo'lmasa panel qoida asosidagi javob bilan chegaralanadi (0 token).
 * Model dashboard'dan olingan raqamlar (context) chegarasida javob beradi.
 */
export const llmEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const SYSTEM = `Sen "Insof AI" — beton zavodi ERP tizimining tahlilchi yordamchisisan. Foydalanuvchi rahbar yoki moliyachi.
Qoidalar:
- Faqat berilgan DASHBOARD MA'LUMOTLARI asosida javob ber. Raqam o'ylab topma; ma'lumot yetmasa, shuni ayt va tizimning qaysi bo'limida ko'rish mumkinligini ko'rsat.
- O'zbek tilida (lotin), sodda, biznes egasiga tushunarli. Nega shunday bo'lganini va bugun nima qilish kerakligini ayt.
- Qisqa: 3–8 qator. **qalin** faqat asosiy raqam/xulosa uchun, ro'yxat uchun "• ". Sarlavha, jadval, kod ishlatma.`;

export type LlmTurn = { role: "user" | "assistant"; text: string };

export async function askClaude(question: string, context: string, history: LlmTurn[]): Promise<{ text: string; model: string }> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: `DASHBOARD MA'LUMOTLARI (hozirgi holat):\n${context}\n\nSAVOL: ${question}` },
  ];
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048, // ataylab qisqa javob — chat paneli
    output_config: { effort: "low" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages,
  });
  if (res.stop_reason === "refusal") return { text: "Bu savolga javob bera olmayman.", model: res.model };
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { text: text || "Javob olinmadi.", model: res.model };
}
