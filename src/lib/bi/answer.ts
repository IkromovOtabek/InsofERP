import { parseRange, startOfDay, addDays, WEEKDAYS_FULL } from "./core";
import { aiAnswer, matchQuestion, type Answer } from "./ai";
import { askLlm, llmEnabled, type LlmTurn } from "@/lib/ai/llm";
import { appUrl } from "@/lib/ai/tools";
import { isoDate } from "@/lib/format";

/**
 * Bitta savolga javob — AI panel (/api/ai) va Telegram bot shu yerdan foydalanadi.
 * level 0 — qoida asosidagi hisob-kitob (token sarflanmaydi), 2 — til modeli (kalit bo'lsa).
 * Til modeli kerakli raqamlarni asboblar orqali bazadan o'zi oladi (src/lib/ai/tools.ts).
 */
export type AskResult = { answer: Answer; level: 0 | 2; model?: string; tools?: string[]; period: string };

/** Modelga beriladigan kontekst: bugungi sana (davr hisoblash uchun), tizim manzili, mos tayyor hisob-kitob. */
function contextFor(range: ReturnType<typeof parseRange>, rule: Answer, key: string | null) {
  const now = new Date(), today = startOfDay(now);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0");
  const base = appUrl();
  return [
    `Bugun: ${isoDate(today)} (${WEEKDAYS_FULL[today.getDay()]}), soat ${hh}:${mm}. Kecha: ${isoDate(addDays(today, -1))}. Shu hafta boshi (dushanba): ${isoDate(monday)}. Oy boshi: ${isoDate(new Date(today.getFullYear(), today.getMonth(), 1))}. O'tgan oy: ${isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1))} — ${isoDate(addDays(new Date(today.getFullYear(), today.getMonth(), 1), -1))}.`,
    `Panelda tanlangan davr: ${range.label}.`,
    base ? `Tizim manzili (havolalar uchun): ${base}` : "Tizim manzili sozlanmagan — havolalarni yo'l ko'rinishida yoz (/orders).",
    key && rule.key !== "none"
      ? `Tayyor hisob-kitob «${rule.key}» (savolga mos bo'lsa shundan foydalan, mos bo'lmasa e'tiborsiz qoldir):\n${rule.text}${rule.bullets?.length ? "\n" + rule.bullets.map((b) => `  - ${b}`).join("\n") : ""}`
      : "",
  ].filter(Boolean).join("\n");
}

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

  try {
    const llm = await askLlm(question, contextFor(range, rule, key), opts.history ?? []);
    // Havola: tayyor hisob-kitob mos kelgan bo'lsa uning sahifasi; aks holda model matn ichida beradi.
    return { answer: { key: rule.key, text: llm.text, href: key ? rule.href : undefined }, level: 2, model: llm.model, tools: llm.tools, period: range.label };
  } catch (e) {
    // Til modeli ishlamasa (limit, tarmoq, model o'chirilgan) — javobsiz qoldirmaymiz.
    console.error("[askInsofAi] LLM:", e instanceof Error ? e.message.split("\n")[0] : e);
    const limited = /\b429\b|rate[ _-]?limit/i.test(String(e instanceof Error ? e.message : e));
    // Tayyor hisob-kitob bo'lsa — beramiz, lekin bu AI javobi emasligini va davri joriy ekanini aniq aytamiz
    if (rule.key !== "none") return { answer: { ...rule, text: `⚠️ AI ${limited ? "daqiqalik limitga tiqildi" : "javob bermadi"}. ${range.label} davri bo'yicha tayyor hisob-kitob:\n\n${rule.text}` }, level: 0, period: range.label };
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
