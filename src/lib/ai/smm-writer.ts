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
  if (e instanceof Anthropic.AuthenticationError) return "AI kaliti noto'g'ri — administratorga murojaat qiling.";
  if (e instanceof Anthropic.RateLimitError) return "AI xizmati chegarasi — bir daqiqadan keyin qayta urinib ko'ring.";
  if (e instanceof Anthropic.APIError) {
    if (/credit balance/i.test(e.message)) return "AI hisobida mablag' tugagan — console.anthropic.com da balansni to'ldiring.";
    return `AI xizmati xatosi (${e.status ?? "tarmoq"}). Birozdan keyin qayta urinib ko'ring.`;
  }
  // SDK ichki xatolari (inglizcha) — foydalanuvchiga xom matn ko'rsatilmaydi
  if (e instanceof Anthropic.AnthropicError) return "AI xizmatiga ulanib bo'lmadi — birozdan keyin qayta urinib ko'ring.";
  return e instanceof Error ? e.message : "AI xatosi";
}

const SYSTEM = `Sen beton va temir-beton zavodining SMM muallifisan: Instagram Reels, Telegram kanal va Facebook uchun yozasan.
Auditoriya — quruvchilar, prorablar, xususiy uy quruvchilar, qurilish kompaniyalari (Toshkent va viloyatlar).
Qoidalar:
- Faqat berilgan korxona ma'lumoti va katalogga tayan. Narx, muddat, sertifikat, raqam yoki da'voni o'ylab topma; kerak bo'lsa [aniqlash kerak] deb yoz.
- Reels: birinchi 2 soniyadagi hook kuchli bo'lsin, kadrlar qisqa, oxirida aniq CTA (qo'ng'iroq yoki Direct'ga so'z).
- Asosiy matn (caption) — brend profilidagi asosiy tilda (odatda rus), ikkinchi til (captionUz) — o'zbek lotin yozuvida, mazmuni bir xil, tabiiy til bilan. Faqat bitta til tanlangan bo'lsa, ikkinchisini bo'sh qoldir.
- Statistika berilgan bo'lsa — tavsiyalarni shu raqamlarga asosla (qaysi format, mavzu, soat ko'p ko'rilgan); taxminni fakt deb yozma.
- Heshteglar: 8–12 ta, rus va o'zbek aralash, # bilan, bo'sh joy bilan ajratilgan.
- Emoji ishlatma.`;

async function context(): Promise<string> {
  const [c, products, st] = await Promise.all([
    getCompany(),
    db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 60, select: { name: true, unit: true } }),
    db.marketingSettings.findUnique({ where: { id: "main" } }),
  ]);
  const places = (Array.isArray(st?.locations) ? st.locations : []) as { name?: string }[];
  const lang = (st?.languages ?? "ru,uz").split(",");
  return [
    `Korxona: ${c.name}${c.legalName ? ` (${c.legalName})` : ""}`,
    c.about ? `Tavsif: ${c.about}` : null,
    c.phone ? `Telefon: ${c.phone}` : null,
    c.address ? `Manzil: ${c.address}` : null,
    c.foundedYear ? `Tashkil etilgan: ${c.foundedYear}` : null,
    `Katalog: ${products.map((p) => p.name).join("; ") || "—"}`,
    st?.brandAbout ? `Brend profili (zavod haqida, faktlar): ${st.brandAbout}` : null,
    st?.brandTone ? `Ohang: ${st.brandTone}` : null,
    st?.audience ? `Maqsadli auditoriya: ${st.audience}` : null,
    `Post tillari: asosiy — ${lang[0] === "uz" ? "o'zbek" : "rus"}${lang[1] ? `, ikkinchi — ${lang[1] === "uz" ? "o'zbek" : "rus"}` : " (ikkinchi til yo'q)"}`,
    places.length ? `Joylashuvlar: ${places.map((x) => x.name).filter(Boolean).join("; ")}` : null,
    st?.defaultHashtags ? `Doimiy heshteglar (har postga o'zi qo'shiladi, takrorlama): ${st.defaultHashtags}` : null,
  ].filter(Boolean).join("\n");
}

/** Profil statistikasining qisqa xulosasi — AI tavsiyalari raqamlarga tayansin */
async function performance(): Promise<string> {
  const { analytics } = await import("@/lib/smm/insights");
  const a = await analytics(30);
  if (!a.account || (!a.posts && !a.byFormat.length)) return "Profil statistikasi hali yo'q (profil ulanmagan yoki yangi).";
  const wd = ["Yak", "Du", "Se", "Chor", "Pay", "Ju", "Sha"];
  return [
    `Instagram @${a.account.username ?? a.account.name}: ${a.account.followers ?? "?"} obunachi; 30 kunda ko'rishlar ${a.totals.views} (oldingi 30 kun ${a.prev.views}), qamrov ${a.totals.reach}, obunachi o'sishi ${a.totals.followersDelta ?? "?"}, ${a.posts} ta post.`,
    `Formatlar (90 kun): ${a.byFormat.map((f) => `${f.type}: ${f.posts} ta, o'rtacha ${f.avgViews} ko'rish, ER ${f.engagement}%${f.avgWatch ? `, o'rtacha tomosha ${f.avgWatch}s` : ""}`).join("; ")}`,
    a.byWeekday.length ? `Hafta kunlari (o'rtacha ko'rish): ${a.byWeekday.map((d) => `${wd[d.day]} ${d.avgViews} (${d.posts})`).join(", ")}` : null,
    a.byHour.length ? `Soatlar (o'rtacha ko'rish): ${a.byHour.map((h) => `${h}:00 ${h.avgViews} (${h.posts})`).join(", ")}` : null,
    a.top.length ? `Eng ko'p ko'rilganlar: ${a.top.slice(0, 5).map((t) => `«${(t.caption ?? "").slice(0, 80)}» — ${t.mediaType}, ${t.views} ko'rish, ${t.saves} saqlash${t.avgWatchSec ? `, ${t.avgWatchSec}s tomosha` : ""}`).join(" | ")}` : null,
    a.worst.length ? `Eng kam ko'rilganlar: ${a.worst.map((t) => `«${(t.caption ?? "").slice(0, 80)}» — ${t.mediaType}, ${t.views} ko'rish`).join(" | ")}` : null,
  ].filter(Boolean).join("\n");
}

const client = () => new Anthropic();

async function ask<T extends z.ZodType>(schema: T, prompt: string, maxTokens = 16000): Promise<z.infer<T>> {
  // Oqimli so'rov: katta max_tokens da SDK oqimsiz so'rovni (10 daqiqadan uzoq bo'lishi mumkin) rad etadi
  const res = await client().beta.messages.stream({
    model: MARKETING_MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${await context()}\n\n${prompt}` }],
  }).finalMessage();
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
  return ask(Plan, `Vazifa: ${p.year}-yil ${p.month}-oy uchun ${p.count} ta post rejasi tuz (asosan Reels).
Kun va soatni statistikaga qarab tanla (auditoriya faol kunlar va soatlar); statistika bo'lmasa — seshanba va juma, 18:30–20:00.
Mavsumni hisobga ol: qurilish mavsumi (bahor–kuz) — buyurtma, yetkazib berish, obyektlar; qish — sovuqda betonlash, oldindan buyurtma, narx.
Rubrikalar: zavod ichidan, narxlar raqamlarda, yetkazib berish, xatolar tahlili, obyektlar, obyekt uchun komplekt — teng taqsimla.
Har post ssenariysi qisqa (sahnalar ro'yxati), izoh 600 belgigacha.

Profil statistikasi:
${await performance()}
${p.focus ? `Shu oy urg'u: ${p.focus}` : ""}
${existing.length ? `Rejada allaqachon bor (takrorlama): ${existing.map((e) => e.title).join("; ")}` : ""}`, 32000);
}

/* ───────── AI studiya: g'oyadan tayyor post paketi ───────── */

const Studio = z.object({
  title: z.string().describe("Post sarlavhasi (ichki, 3–8 so'z)"),
  rubric: z.string(),
  hook: z.string().describe("Birinchi 2 soniya: nima ko'rinadi va ekranda qaysi matn"),
  scenes: z.array(z.object({
    durationSec: z.number().describe("2–6 soniya"),
    shot: z.string().describe("Kadr tavsifi: nima va qanday suratga olinadi (o'zbekcha)"),
    text: z.string().describe("Ekrandagi matn, asosiy tilda, 1–7 so'z"),
    voice: z.string().describe("Ovoz matni, asosiy tilda (bo'sh bo'lishi mumkin)"),
    mediaTags: z.array(z.string()).describe("Media kutubxonadan mos kadr qidirish uchun 1–3 kalit so'z (o'zbekcha: zavod, mikser, beton, ustun, fbs, yetkazish, obyekt…)"),
    aiPrompt: z.string().describe("Kutubxonada mos kadr bo'lmasa, AI video uchun inglizcha prompt: realistic, vertical 9:16, concrete plant… (odam yuzi va logotipsiz)"),
  })).describe("Reels uchun 4–8 sahna, jami 15–40 soniya; Post/Stories uchun 1–3"),
  music: z.string().describe("Musiqa uslubi va temp (Instagram kutubxonasidan tanlash uchun)"),
  caption: z.string().describe("Asosiy tildagi izoh, 600 belgigacha, oxirida CTA"),
  captionUz: z.string().describe("Ikkinchi tildagi izoh (bo'lmasa bo'sh)"),
  hashtags: z.string().describe("8–12 heshteg: soha + mahalliy (shahar/viloyat)"),
  location: z.string().describe("Joylashuvlar ro'yxatidan eng mosi (nomi aynan) yoki bo'sh"),
  bestTime: z.object({ weekday: z.number().describe("0 — yakshanba … 6 — shanba"), time: z.string().describe("HH:MM"), why: z.string() }),
  coverText: z.string().describe("Muqova (cover) uchun 2–5 so'z"),
  tips: z.array(z.string()).describe("Suratga olish bo'yicha 3–5 amaliy maslahat (telefon bilan, zavodda)"),
});
export type StudioT = z.infer<typeof Studio>;

/** Foydalanuvchi oddiy so'z bilan aytgan g'oyadan: ssenariy (sahnalar), matn, heshteg, joy, vaqt, maslahatlar */
export async function studioPackage(p: { brief: string; format: "REELS" | "POST" | "STORIES"; mediaTags: string[] }): Promise<StudioT> {
  return ask(Studio, `Vazifa: AI studiya. Foydalanuvchi g'oyasidan ${p.format === "REELS" ? "Instagram Reels" : p.format === "POST" ? "Instagram post (rasm/karusel)" : "Stories"} uchun to'liq paket tayyorla.
Maqsad — ko'p ko'rish va ariza: kuchli hook, tez montaj, bitta aniq fikr, oxirida CTA.
Media kutubxonadagi mavjud teglar (mediaTags ni shulardan tanlashga harakat qil): ${p.mediaTags.slice(0, 80).join(", ") || "—"}

Profil statistikasi:
${await performance()}

Foydalanuvchi g'oyasi:
${p.brief}`, 12000);
}

/* ───────── Statistika tahlili va g'oyalar ───────── */

const Report = z.object({
  summary: z.string().describe("Markdown: 1) asosiy xulosa 2–3 gap; 2) nima ishladi (raqamlar bilan); 3) nima ishlamadi; 4) raqobatchilardan nima o'rganish mumkin; 5) keyingi 2 hafta uchun 3–5 aniq qadam (format, kun, soat, mavzu)"),
  ideas: z.array(z.object({
    title: z.string(),
    format: z.enum(["REELS", "POST", "STORIES"]),
    hook: z.string(),
    why: z.string().describe("Nega aynan shu — qaysi raqamga asoslangan"),
    brief: z.string().describe("AI studiyaga beriladigan g'oya matni (2–4 gap)"),
  })).describe("6–8 ta g'oya, ko'rishni oshirishga qaratilgan"),
});
export type ReportT = z.infer<typeof Report>;

export async function insightReport(): Promise<ReportT> {
  const [competitors, recent] = await Promise.all([
    db.smmCompetitor.findMany({ where: { followers: { not: null } }, take: 10 }),
    db.marketingContent.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { title: true, type: true, status: true } }),
  ]);
  const comp = competitors.map((c) => {
    const top = (Array.isArray(c.topPosts) ? c.topPosts : []) as { caption?: string; likes?: number; mediaType?: string }[];
    return `@${c.username}: ${c.followers} obunachi, o'rtacha ${c.avgLikes} layk / ${c.avgComments} izoh; eng yaxshilari: ${top.slice(0, 3).map((t) => `«${(t.caption ?? "").slice(0, 70)}» (${t.mediaType}, ${t.likes} layk)`).join("; ")}`;
  });
  return ask(Report, `Vazifa: SMM tahlilchi sifatida Instagram profilimizni tahlil qil va ko'rishni oshirish bo'yicha aniq tavsiya va g'oyalar ber. Javob o'zbek tilida (lotin).

Profil statistikasi:
${await performance()}

Raqobatchilar:
${comp.join("\n") || "— (qo'shilmagan)"}

Kontent rejadagi oxirgi postlar (takrorlamaslik uchun): ${recent.map((r) => r.title).join("; ") || "—"}`, 12000);
}

