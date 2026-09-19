/**
 * Erkin savollar uchun til modeli — yagona kirish nuqtasi.
 *
 * Ikki provayder qo'llab-quvvatlanadi, kalit qaysi biriga berilgan bo'lsa o'sha ishlaydi:
 *   ANTHROPIC_API_KEY — Claude (pullik; o'zbek tilida javob sifati yuqori)
 *   GROQ_API_KEY      — Groq (bepul tarif, karta talab qilinmaydi — sinov uchun)
 * AI_PROVIDER = claude | groq — qo'lda tanlash (bo'lmasa kalitga qarab avtomatik).
 *
 * Kalit umuman bo'lmasa — panel qoida asosidagi javob bilan chegaralanadi (0 token).
 * Diqqat: modelga yuboriladigan kontekstda haqiqiy biznes raqamlari bo'ladi.
 * Bepul tariflar odatda yuborilgan ma'lumotni saqlab qolish huquqini o'zida qoldiradi.
 */

import { askClaude } from "./claude";
import { askGroq } from "./groq";

export type LlmProvider = "claude" | "groq";
export type LlmTurn = { role: "user" | "assistant"; text: string };

/** Provayderga uzatiladigan so'rov — ikkala backend uchun bir xil. */
export type LlmRequest = { system: string; question: string; context: string; history: LlmTurn[] };
export type LlmReply = { text: string; model: string };

const KEY_ENV: Record<LlmProvider, string> = { claude: "ANTHROPIC_API_KEY", groq: "GROQ_API_KEY" };

export const PROVIDER_LABEL: Record<LlmProvider, string> = { claude: "Claude", groq: "Groq (bepul)" };

export function llmProvider(): LlmProvider | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase() as LlmProvider | undefined;
  if (forced && forced in KEY_ENV) return process.env[KEY_ENV[forced]] ? forced : null;
  // sifat bo'yicha: claude → groq (bepul)
  return (["claude", "groq"] as const).find((p) => process.env[KEY_ENV[p]]) ?? null;
}

export const llmEnabled = () => llmProvider() !== null;

export const SYSTEM = `Sen "Insof AI" — beton zavodi ERP tizimining tahlilchi yordamchisisan. Foydalanuvchi rahbar yoki moliyachi.
Qoidalar:
- Faqat berilgan DASHBOARD MA'LUMOTLARI asosida javob ber. Raqam o'ylab topma; ma'lumot yetmasa, shuni ayt va tizimning qaysi bo'limida ko'rish mumkinligini ko'rsat.
- O'zbek tilida (lotin), sodda, biznes egasiga tushunarli. Nega shunday bo'lganini va bugun nima qilish kerakligini ayt.
- Qisqa: 3–8 qator. **qalin** faqat asosiy raqam/xulosa uchun, ro'yxat uchun "• ". Sarlavha, jadval, kod ishlatma.
- Bo'limga yo'naltirsang, faqat tizimda haqiqatan bor bo'limlarni ayt. Menyu yo'llarini o'ylab topma.
  Bo'limlar: Zayavkalar, Mijozlar, Schyotlar, Ishlab chiqarish, Retseptlar, Reyslar, Texnika, Sklad, Astatka, Kirim, Yetkazuvchilar, Kassa/bank, Xodimlar.
  Tahlil: BI tahlil, Sotuvlar, Agentlar, Ombor, Mahsulotlar, Marketing, Reja nazorati, Moliya, ML tahlil.`;

/** Erkin savolga javob. Chaqiruvchi avval llmEnabled() ni tekshiradi. */
export async function askLlm(question: string, context: string, history: LlmTurn[]): Promise<LlmReply> {
  const provider = llmProvider();
  if (!provider) throw new Error("Til modeli sozlanmagan (ANTHROPIC_API_KEY yoki GROQ_API_KEY).");
  const req: LlmRequest = { system: SYSTEM, question, context, history };
  return provider === "groq" ? askGroq(req) : askClaude(req);
}
