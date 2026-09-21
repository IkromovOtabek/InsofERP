/**
 * Erkin savollar uchun til modeli — yagona kirish nuqtasi.
 *
 * Ikki provayder qo'llab-quvvatlanadi, kalit qaysi biriga berilgan bo'lsa o'sha ishlaydi:
 *   ANTHROPIC_API_KEY — Claude (pullik; o'zbek tilida javob sifati yuqori)
 *   GROQ_API_KEY      — Groq (bepul tarif, karta talab qilinmaydi — sinov uchun)
 * AI_PROVIDER = claude | groq — qo'lda tanlash (bo'lmasa kalitga qarab avtomatik).
 *
 * Model raqamlarni ASBOBLAR (tools.ts) orqali bazadan o'zi oladi: sana oralig'i, mijoz qidiruvi,
 * ro'yxatlar, kassa, ombor, ishlab chiqarish, reyslar. Bir savol uchun bir nechta asbob chaqirilishi mumkin.
 *
 * Kalit umuman bo'lmasa — panel qoida asosidagi javob bilan chegaralanadi (0 token).
 * Diqqat: modelga yuboriladigan kontekstda haqiqiy biznes raqamlari bo'ladi.
 * Bepul tariflar odatda yuborilgan ma'lumotni saqlab qolish huquqini o'zida qoldiradi.
 */

import { askClaude } from "./claude";
import { askGroq } from "./groq";
import { TOOLS, type Tool } from "./tools";

export type LlmProvider = "claude" | "groq";
export type LlmTurn = { role: "user" | "assistant"; text: string };

/** Provayderga uzatiladigan so'rov — ikkala backend uchun bir xil. */
export type LlmRequest = { system: string; question: string; context: string; history: LlmTurn[]; tools: Tool[] };
export type LlmReply = { text: string; model: string; tools: string[] };

/** Bitta savol uchun asbob chaqiruvlari (raundlar) limiti — cheksiz aylanishdan himoya. */
export const MAX_TOOL_ROUNDS = 6;

const KEY_ENV: Record<LlmProvider, string> = { claude: "ANTHROPIC_API_KEY", groq: "GROQ_API_KEY" };

export const PROVIDER_LABEL: Record<LlmProvider, string> = { claude: "Claude", groq: "Groq (bepul)" };

export function llmProvider(): LlmProvider | null {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase() as LlmProvider | undefined;
  if (forced && forced in KEY_ENV) return process.env[KEY_ENV[forced]] ? forced : null;
  // sifat bo'yicha: claude → groq (bepul)
  return (["claude", "groq"] as const).find((p) => process.env[KEY_ENV[p]]) ?? null;
}

export const llmEnabled = () => llmProvider() !== null;

export const SYSTEM = `Sen "Insof AI" — beton zavodi ERP tizimining tahlilchi yordamchisisan. Foydalanuvchi — direktor yoki moliyachi. Savol ko'pincha ovozli xabar transkripti: xatolar, kirill yoki ruscha so'zlar bo'lishi mumkin — ma'nosini tushunib javob ber.

MA'LUMOT
- Raqamlar FAQAT asboblardan (tools). Kerakli raqam yo'q bo'lsa — asbobni chaqir. Taxmin qilma, o'rtacha bilan "hisoblama", ekstrapolyatsiya qilma, yo'q raqamni o'ylab topma.
- Sana oralig'i («1-dan 10-gacha», «kecha», «o'tgan hafta», «avgust») — KONTEKSTdagi bugungi sanadan aniq sanalarni hisoblab asbobga ber; faqat kun aytilsa oy va yil joriy. "to" davrga kiradi.
- Mijoz, zayavka, nakladnoy, xodim, xomashyo nomi bo'lsa — avval qidir (customer_find, orders_list, trips_list, employees_list, stock_status). Transkriptda nom buzilgan bo'lishi mumkin («Owen» → «Oven») — asbob o'xshash nom taklif qilsa, shundan foydalan.
- Qaysi asbob: sotuv/savdo/foyda/marja → sales_summary; kassa/tushum/to'lov/xarajat/pul → cash_summary (bu SOTUV EMAS — mijozlar haqiqatda to'lagan pul); qarz/debitorka/schyot → invoices_list yoki customers_list(debtors); zayavka → orders_list; reys/nakladnoy/haydovchi → trips_list; ombor/xomashyo → stock_status; zames/brigada → production_summary; kirim/yetkazuvchi → receipts_list; reja → plan_status.
- Savolda bir nechta narsa so'ralsa (masalan «kecha sotuv qancha va shu hafta kassaga qancha tushdi») — HAR BIRI uchun alohida asbob chaqir va har biriga alohida javob ber. Kerak bo'lsa asboblarni ketma-ket chaqir (mijozni top → zayavkalarini ol; ikki davr uchun asbobni ikki marta).
- Asbob "topilmadi"/bo'sh qaytarsa — shuni ayt, o'ylab topma. Umumiy «holat qanday / nimaga e'tibor» — dashboard_snapshot (KONTEKSTda tayyor hisob-kitob bo'lsa, shundan foydalan).

JAVOB
- O'zbek tilida, lotin alifbosida (savol kirill/ruscha bo'lsa ham). Sodda, biznes egasiga tushunarli.
- Avval asosiy raqam/xulosa, keyin kerak bo'lsa "• " ro'yxat. Ro'yxat so'ralsa — asbob bergan qatorlarni to'liq ber (20 tagacha).
- Pul «12,5 mln so'm», sana 05.09.2026, hajm m³. Sabab va bugungi harakatni ma'lumot ko'rsatsa ayt, ko'rsatmasa maslahat o'ylab topma.
- Format: faqat *qalin* (bitta yulduzcha). Sarlavha (#), jadval, kod bloki, ** yo'q — javob Telegramda ko'rinadi.
- Hujjat (nakladnoy, PDF, chop etish) so'ralsa — trips_list bergan "chop etish/PDF" havolasini oddiy matn sifatida ber, backtick yoki kod blokiga o'rama (brauzerda ochilib chop etiladi/PDF saqlanadi).
- Bo'limlarga faqat shu ro'yxatdan yo'naltir, havolani KONTEKSTdagi tizim manzili bilan to'liq yoz: Zayavkalar /orders · Sotuv /sales · Mijozlar /customers · Schyotlar /invoices · Kassa/bank /payments · Kirim-chiqim /cashflow · Ishlab chiqarish /production · Topshiriqlar /tasks · Brigadalar /brigades · Reyslar/nakladnoy /trips · Sklad /stock (xomashyo qoldig'i, hovlidagi dona mahsulot va ishlab chiqarish imkoni) · Kirim /receipts · Yetkazuvchilar /suppliers · Xodimlar /employees · Texnika /vehicles · Retseptlar /recipes. Tahlil: /bi-tahlil (sotuvlar, agentlar, mijozlar, ombor, mahsulotlar, ishlab-chiqarish, marketing, reja, moliya, ml, ai).`;

/** Erkin savolga javob. Chaqiruvchi avval llmEnabled() ni tekshiradi. */
export async function askLlm(question: string, context: string, history: LlmTurn[]): Promise<LlmReply> {
  const provider = llmProvider();
  if (!provider) throw new Error("Til modeli sozlanmagan (ANTHROPIC_API_KEY yoki GROQ_API_KEY).");
  const req: LlmRequest = { system: SYSTEM, question, context, history, tools: TOOLS };
  return provider === "groq" ? askGroq(req) : askClaude(req);
}
