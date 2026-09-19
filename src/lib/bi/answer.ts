import { parseRange } from "./core";
import { aiAnswer, aiSnapshot, matchQuestion, type Answer } from "./ai";
import { askLlm, llmEnabled, type LlmTurn } from "@/lib/ai/llm";

/**
 * Bitta savolga javob — AI panel (/api/ai) va Telegram bot shu yerdan foydalanadi.
 * level 0 — qoida asosidagi hisob-kitob (token sarflanmaydi), 2 — Claude (kalit bo'lsa).
 */
export type AskResult = { answer: Answer; level: 0 | 2; model?: string; period: string };

/** level 2 javobida qaysi provayder ishlaganini ko'rsatish uchun model nomi qaytariladi. */

export async function askInsofAi(
  question: string,
  opts: { sp?: Record<string, string | undefined>; history?: LlmTurn[] } = {},
): Promise<AskResult> {
  const sp = opts.sp ?? {};
  const range = parseRange(sp);
  const key = matchQuestion(question);
  const rule = await aiAnswer(question, sp);

  // Kalit yo'q → qoida asosidagi javob (mos kelsa hisob-kitob, bo'lmasa "javob bera olmayman")
  if (!llmEnabled()) return { answer: rule, level: 0, period: range.label };

  // Kontekst = butun biznes kesimi (katalogdagi hamma hisob-kitob, bitta baza o'qishi bilan).
  // Shu tufayli model katalogda yo'q savolga ham javob bera oladi — raqam kontekstda turadi.
  const ctx = [
    await aiSnapshot(sp),
    key ? `## Savolga eng mos hisob-kitob (${rule.key})\n${rule.text}${rule.bullets?.length ? "\n" + rule.bullets.map((b) => `  - ${b}`).join("\n") : ""}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const llm = await askLlm(question, ctx, opts.history ?? []);
    return { answer: { key: rule.key, text: llm.text, href: rule.href }, level: 2, model: llm.model, period: range.label };
  } catch (e) {
    // Til modeli ishlamasa (limit, tarmoq, model o'chirilgan) — javobsiz qoldirmaymiz.
    console.error("[askInsofAi] LLM:", e instanceof Error ? e.message.split("\n")[0] : e);
    if (rule.key !== "none") return { answer: rule, level: 0, period: range.label };
    const limited = /\b429\b|rate[ _-]?limit/i.test(String(e instanceof Error ? e.message : e));
    return {
      answer: {
        key: "none",
        text: limited
          ? "AI xizmatining daqiqalik limiti tugadi. 15–20 soniyadan keyin savolni qayta yuboring — yoki tayyor savollardan birini tanlang (/savollar)."
          : "Javobni tayyorlab bo'lmadi (AI xizmati javob bermadi). Qayta urinib ko'ring yoki tayyor savollardan birini tanlang (/savollar).",
      },
      level: 0,
      period: range.label,
    };
  }
}
