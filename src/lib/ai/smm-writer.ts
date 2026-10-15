/**
 * SMM yozuvchi (Claude): post muharriridagi AI tugmalari va oylik kontent reja.
 * Javob strukturali (zod sxema) — matn emas, maydonlar to'g'ridan-to'g'ri formaga tushadi.
 * Korxona va katalog ma'lumoti bazadan (ko'p korxonali — kodda korxonaga xos fakt yo'q).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
/** Agent bilan bir xil model (`marketing-agent.ts` → MARKETING_MODEL); aylanma importsiz */
const MARKETING_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

export const aiReady = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** API xatosini foydalanuvchiga tushunarli o'zbekcha matnga aylantiradi (xom JSON ko'rsatilmaydi) */
export function aiErrorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "AI kaliti noto'g'ri: ANTHROPIC_API_KEY ni tekshiring.";
  if (e instanceof Anthropic.RateLimitError) return "AI xizmati chegarasi — bir daqiqadan keyin qayta urinib ko'ring.";
  if (e instanceof Anthropic.APIError) {
    if (/credit balance/i.test(e.message)) return "AI hisobida mablag' tugagan — console.anthropic.com da balansni to'ldiring.";
    return `AI xizmati xatosi (${e.status ?? "tarmoq"}). Birozdan keyin qayta urinib ko'ring.`;
  }
  return e instanceof Error ? e.message : "AI xatosi";
}

const SYSTEM = `Sen beton va temir-beton zavodining SMM muallifisan: Instagram Reels, Telegram kanal va Facebook uchun yozasan.
Auditoriya — quruvchilar, prorablar, xususiy uy quruvchilar, qurilish kompaniyalari (Toshkent va viloyatlar).
Qoidalar:
- Faqat berilgan korxona ma'lumoti va katalogga tayan. Narx, muddat, sertifikat, raqam yoki da'voni o'ylab topma; kerak bo'lsa [aniqlash kerak] deb yoz.
- Reels: birinchi 2 soniyadagi hook kuchli bo'lsin, kadrlar qisqa, oxirida aniq CTA (qo'ng'iroq yoki Direct'ga so'z).
- Asosiy matn (caption) — rus tilida, o'zbekcha matn (captionUz) — lotin yozuvida, mazmuni bir xil, tabiiy til bilan.
- Heshteglar: 8–12 ta, rus va o'zbek aralash, # bilan, bo'sh joy bilan ajratilgan.
- Emoji ishlatma.`;

async function context(): Promise<string> {
  const [c, products] = await Promise.all([
    getCompany(),
    db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 60, select: { name: true, unit: true } }),
  ]);
  return [
    `Korxona: ${c.name}${c.legalName ? ` (${c.legalName})` : ""}`,
    c.about ? `Tavsif: ${c.about}` : null,
    c.phone ? `Telefon: ${c.phone}` : null,
    c.address ? `Manzil: ${c.address}` : null,
    c.foundedYear ? `Tashkil etilgan: ${c.foundedYear}` : null,
    `Katalog: ${products.map((p) => p.name).join("; ") || "—"}`,
  ].filter(Boolean).join("\n");
}

const client = () => new Anthropic();

async function ask<T extends z.ZodType>(schema: T, prompt: string, maxTokens = 16000): Promise<z.infer<T>> {
  const res = await client().beta.messages.parse({
    model: MARKETING_MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${await context()}\n\n${prompt}` }],
  });
  if (res.stop_reason === "refusal") throw new Error("AI bu so'rovga javob bermadi — mavzuni boshqacha yozing");
  if (res.stop_reason === "max_tokens") throw new Error("AI javobi juda uzun bo'lib ketdi — qisqaroq so'rov bering");
  if (!res.parsed_output) throw new Error("AI javobini o'qib bo'lmadi — qayta urinib ko'ring");
  return res.parsed_output as z.infer<T>;
}

const PostText = z.object({
  hook: z.string().describe("Birinchi 2 soniya: kadr + ekrandagi matn"),
  script: z.string().describe("Reels ssenariysi: davomiylik, kadrlar ro'yxati, ovoz matni (RU), ekrandagi matn, CTA — markdown"),
  caption: z.string().describe("Instagram/Telegram izohi, rus tilida"),
  captionUz: z.string().describe("Xuddi shu izoh o'zbek tilida (lotin)"),
  hashtags: z.string().describe("8–12 heshteg, bo'sh joy bilan"),
});
export type PostTextT = z.infer<typeof PostText>;

/** Sarlavha/rubrika/qisqa g'oyadan to'liq Reels ssenariysi va matnlar */
export async function writeScript(p: { title: string; rubric?: string | null; brief?: string | null; type: string }): Promise<PostTextT> {
  return ask(PostText, `Vazifa: ${p.type === "REELS" ? "Reels" : p.type} uchun ssenariy va matnlar yoz.
Sarlavha: ${p.title}
${p.rubric ? `Rubrika: ${p.rubric}` : ""}
${p.brief ? `Qo'shimcha g'oya / mavjud qoralama:\n${p.brief}` : ""}`);
}

const Caption = PostText.pick({ caption: true, captionUz: true, hashtags: true });

/** Mavjud ssenariydan izoh (RU/UZ) va heshteglar */
export async function writeCaption(p: { title: string; script?: string | null; hook?: string | null }): Promise<z.infer<typeof Caption>> {
  return ask(Caption, `Vazifa: shu post uchun izoh (RU va UZ) va heshteglar yoz. Izoh 600 belgidan oshmasin, oxirida CTA.
Sarlavha: ${p.title}
${p.hook ? `Hook: ${p.hook}` : ""}
${p.script ? `Ssenariy:\n${p.script}` : ""}`, 4000);
}

const Translation = z.object({ captionUz: z.string() });

/** Ruscha izohni o'zbekchaga (lotin) */
export async function translateCaption(caption: string): Promise<string> {
  const r = await ask(Translation, `Vazifa: quyidagi ruscha izohni o'zbek tiliga (lotin) tabiiy qilib tarjima qil, ma'nosini saqlab:\n\n${caption}`, 4000);
  return r.captionUz;
}

const Plan = z.object({
  posts: z.array(z.object({
    title: z.string(),
    type: z.enum(["REELS", "POST", "STORIES"]),
    rubric: z.string(),
    date: z.string().describe("YYYY-MM-DD"),
    time: z.string().describe("HH:MM, Toshkent vaqti"),
    hook: z.string(),
    script: z.string(),
    caption: z.string(),
    captionUz: z.string(),
    hashtags: z.string(),
  })),
});
export type PlanT = z.infer<typeof Plan>;

/** Oylik kontent reja (qoralamalar). Mavjud rejadagi sarlavhalar takrorlanmaydi. */
export async function planMonth(p: { year: number; month: number; count: number; focus?: string | null }): Promise<PlanT> {
  const from = new Date(Date.UTC(p.year, p.month - 1, 1));
  const to = new Date(Date.UTC(p.year, p.month, 1));
  const existing = await db.marketingContent.findMany({ where: { OR: [{ publishDate: { gte: from, lt: to } }, { scheduledAt: { gte: from, lt: to } }] }, select: { title: true } });
  return ask(Plan, `Vazifa: ${p.year}-yil ${p.month}-oy uchun ${p.count} ta post rejasi tuz (asosan Reels; haftasiga 2 ta, seshanba va juma, 18:30–20:00 oralig'ida).
Rubrikalar: «Завод изнутри», «Цены в цифрах», «Доставка», «Разборы», «Объекты», «Комплект под объект» — teng taqsimla.
${p.focus ? `Shu oy urg'u: ${p.focus}` : ""}
${existing.length ? `Rejada allaqachon bor (takrorlama): ${existing.map((e) => e.title).join("; ")}` : ""}`, 32000);
}
