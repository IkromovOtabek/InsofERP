/**
 * Hujjat rasmidan (nakladnoy, schyot-faktura) qatorlarni o'qish — "kamera bilan kirim".
 *
 * Provayder kalitga qarab tanlanadi (llm.ts dagi tartibga o'xshash):
 *   ANTHROPIC_API_KEY — Claude (eng aniq; qo'lda yozilgan hujjatni ham o'qiydi)
 *   OPENAI_API_KEY    — OpenAI (vision)
 *   GROQ_API_KEY      — Groq (bepul tarif; VISION_MODEL bilan almashtiriladi)
 * VISION_PROVIDER = claude | openai | groq — qo'lda tanlash.
 *
 * MUHIM: model raqamlarni HUJJATDA QANDAY YOZILGAN BO'LSA shundayligicha ("4,900", "48 109 286")
 * matn sifatida qaytaradi — vergul/probel ajratkichini `num()` (lib/excel.ts) o'zi to'g'ri o'qiydi.
 * Modelga raqamni "tushuntirib" berishga ruxsat berilsa, "4,900" ni 4.9 qilib yuboradi.
 *
 * Natija hech qachon to'g'ridan-to'g'ri bazaga yozilmaydi: foydalanuvchi jadvalda ko'radi,
 * tuzatadi va odatdagi import tugmasi bilan saqlaydi.
 */

export type ScanImage = { mime: string; base64: string };
export type ScanRow = Record<string, string>;
export type ScanResult = { doc: { supplier: string; date: string; docNo: string }; rows: ScanRow[]; model: string };

export type VisionProvider = "claude" | "openai" | "groq";
const KEY_ENV: Record<VisionProvider, string> = { claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", groq: "GROQ_API_KEY" };
const DEFAULT_MODEL: Record<VisionProvider, string> = {
  claude: "claude-sonnet-5",
  openai: "gpt-4.1-mini",
  groq: "qwen/qwen3.8-27b", // Groq hisobida rasmni o'qiydigan model; ro'yxat o'zgarsa VISION_MODEL bilan almashtiring
};

export function visionProvider(): VisionProvider | null {
  const forced = process.env.VISION_PROVIDER?.trim().toLowerCase() as VisionProvider | undefined;
  if (forced && forced in KEY_ENV) return process.env[KEY_ENV[forced]] ? forced : null;
  return (["claude", "openai", "groq"] as const).find((p) => process.env[KEY_ENV[p]]) ?? null;
}
export const visionEnabled = () => visionProvider() !== null;
export const visionModel = (p: VisionProvider) => process.env.VISION_MODEL?.trim() || DEFAULT_MODEL[p];

/** Bir hujjatda shuncha qatorgacha o'qiladi (uzun nakladnoy ham sig'sin). */
const MAX_ROWS = 120;

const PROMPT = `Sen — omborchi yordamchisisan. Rasmda kirim hujjati (nakladnoy, schyot-faktura, tovar cheki) bor. U o'zbek (lotin yoki kirill) yoki rus tilida bo'lishi mumkin, qo'lda yozilgan ham bo'lishi mumkin.

Vazifa: hujjatdagi TOVAR QATORLARINI o'qib, faqat JSON qaytar. Boshqa hech qanday matn yozma.

JSON ko'rinishi:
{"supplier":"","date":"","docNo":"","rows":[{"material":"","code":"","unit":"","qty":"","price":"","nds":"","sum":"","note":""}]}

Qoidalar:
- "material" — tovar nomi hujjatdagidek (tarjima qilma, qisqartirma).
- "unit" — o'lchov birligi hujjatdagidek ("letr", "тн", "dona", "м3"…). Yo'q bo'lsa bo'sh qoldir.
- RAQAMLAR (qty, price, nds, sum) — HUJJATDA QANDAY YOZILGAN BO'LSA SHUNDAY, matn sifatida: "4,900", "23.5", "48 109 286". Ajratkichlarni o'zgartirma, hisoblama, yaxlitlama. O'qib bo'lmasa bo'sh qoldir.
- "date" — hujjat sanasi YYYY-MM-DD ko'rinishida (bo'lmasa bo'sh).
- "supplier" — yetkazuvchi (kimdan) nomi; "docNo" — hujjat raqami.
- "Jami", "Итого", "NDS", "Bo'yicha" kabi YAKUNIY qatorlarni rows ga QO'SHMA — faqat tovar qatorlari.
- Ishonch bo'lmagan katakni bo'sh qoldir — o'ylab topma. Hujjatda tovar qatori bo'lmasa: {"rows":[]}.
- Ko'pi bilan ${MAX_ROWS} qator.`;

/** Model javobidan JSON obyektni ajratib oladi (```json bloki yoki matn ichidan). */
function parseJson(text: string): { supplier?: string; date?: string; docNo?: string; rows?: unknown[] } {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fence ? fence[1] : text;
  const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
  if (i < 0 || j <= i) throw new Error("Model javobidan ma'lumot o'qilmadi");
  return JSON.parse(raw.slice(i, j + 1));
}

const KEYS = ["material", "code", "unit", "qty", "price", "nds", "sum", "note"] as const;
const cellText = (v: unknown) => (v == null || typeof v === "object" ? "" : String(v).trim());

function shape(parsed: { supplier?: string; date?: string; docNo?: string; rows?: unknown[] }, model: string): ScanResult {
  const rows = (Array.isArray(parsed.rows) ? parsed.rows : [])
    .slice(0, MAX_ROWS)
    .map((r) => Object.fromEntries(KEYS.map((k) => [k, cellText((r as Record<string, unknown>)?.[k])])) as ScanRow)
    .filter((r) => r.material !== "");
  return {
    doc: { supplier: cellText(parsed.supplier), date: cellText(parsed.date), docNo: cellText(parsed.docNo) },
    rows,
    model,
  };
}

/** Rasm(lar)dan hujjat qatorlarini o'qiydi. Bir nechta rasm — bitta hujjatning varaqlari. */
export async function scanInvoice(images: ScanImage[]): Promise<ScanResult> {
  const provider = visionProvider();
  if (!provider) throw new Error("Rasmdan o'qish sozlanmagan: ANTHROPIC_API_KEY, OPENAI_API_KEY yoki GROQ_API_KEY kerak.");
  if (!images.length) throw new Error("Rasm yo'q");
  const model = visionModel(provider);
  const text = provider === "claude" ? await askClaudeVision(images, model) : await askOpenAiVision(images, model, provider);
  return shape(parseJson(text), model);
}

async function askClaudeVision(images: ScanImage[], model: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: [
        ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mime as "image/jpeg", data: im.base64 } })),
        { type: "text" as const, text: PROMPT },
      ],
    }],
  });
  return res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

/** OpenAI-mos API (OpenAI va Groq bir xil ko'rinishda ishlaydi). */
async function askOpenAiVision(images: ScanImage[], model: string, provider: "openai" | "groq"): Promise<string> {
  const url = provider === "groq" ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env[KEY_ENV[provider]]}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.base64}` } })),
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!res.ok || data.error) throw new Error(`Rasmni o'qib bo'lmadi (${provider}): ${data.error?.message ?? res.status}`);
  return data.choices?.[0]?.message?.content ?? "";
}
