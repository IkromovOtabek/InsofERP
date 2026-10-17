/**
 * Avtomatik marketing agentlari — odam so'ramasdan ishlaydi, natija Telegram bot va ilovadagi bildirishnoma orqali:
 *   · haftalik (dushanba 09:00): Claude profil va raqobatchilarni tahlil qiladi (hisobot saqlanadi), keyingi hafta
 *     uchun g'oyalar beradi; ulardan `autoDrafts` tasi kontent rejaga «G'oya» holatida qo'shiladi;
 *   · kunlik (har kuni 08:30): bugun chiqadigan postlar, tasdiq kutayotganlar, xatolar, target, yangi arizalar —
 *     faktlar bazadan, Claude ulardan bugungi 3 ta ishni ajratadi (AI bo'lmasa — faqat faktlar).
 * Vaqt — server soati (Asia/Tashkent, `instrumentation.ts`). O'tkazib yuborilgan ish (server o'chgan) keyingi tsiklda bajariladi.
 * Ikki jarayon bir bazada ishlasa ham bir marta ketadi: ishga tushish vaqti shartli `updateMany` bilan egallanadi.
 * Hamma narsa qoralama: post chiqarish, tasdiqlash va reklama — faqat odam.
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { date, dateTime, fmtNum } from "@/lib/format";
import { notifyUsers } from "@/lib/notify";
import { botEnabled, sendMessage } from "@/lib/telegram/api";
import { linkedChatId } from "@/lib/telegram/notify";
import { marketingSettings } from "./boosts";

export const WEEKLY_AT = { weekday: 1, hour: 9, minute: 0 }; // dushanba
export const DAILY_AT = { hour: 8, minute: 30 };
const BY = "Avtomatik agent";

/** Shu haftaning dushanba 09:00 (yoki bugungi 08:30) — undan oldin ishlagan bo'lsa, navbat keldi */
export function weeklyDue(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), WEEKLY_AT.hour, WEEKLY_AT.minute);
  d.setDate(d.getDate() - ((d.getDay() - WEEKLY_AT.weekday + 7) % 7));
  return d;
}
export const dailyDue = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), DAILY_AT.hour, DAILY_AT.minute);

/** Rejalashtiruvchi (har daqiqa) chaqiradi. Uzoq ish — kutilmaydi, xato nashr tsiklini to'xtatmaydi */
let running = false;
export async function autoAgentsTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const st = await marketingSettings();
    if (st.autoWeekly) {
      const due = weeklyDue(now);
      if (now >= due && (!st.autoWeeklyAt || st.autoWeeklyAt < due) && (await claim("autoWeeklyAt", due, now))) await safe("haftalik", () => runWeekly(now));
    }
    if (st.autoDaily) {
      const due = dailyDue(now);
      if (now >= due && (!st.autoDailyAt || st.autoDailyAt < due) && (await claim("autoDailyAt", due, now))) await safe("kunlik", () => runDaily(now));
    }
  } finally {
    running = false;
  }
}

async function claim(field: "autoWeeklyAt" | "autoDailyAt", due: Date, now: Date): Promise<boolean> {
  const r = await db.marketingSettings.updateMany({ where: { id: "main", OR: [{ [field]: null }, { [field]: { lt: due } }] }, data: { [field]: now } });
  return r.count === 1;
}

async function safe(name: string, fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[smm-auto] ${name}`, msg);
    // Qayta urinilmaydi (har daqiqa AI xatosi yog'masin) — qabul qiluvchilar biladi, sahifadan qo'lda ishga tushiradi
    await deliver(`*Marketing — ${name} agent ishlamadi*\n\n${msg.slice(0, 300)}\n\nMarketing → Sozlamalar → «Hozir yuborish» bilan qayta urinib ko'ring.`, { type: "MARKETING_AUTO_FAILED", title: `Marketing: ${name} agent ishlamadi`, body: msg.slice(0, 200) }).catch(() => undefined);
  }
}

/* ───────── Yetkazish ───────── */

/** Qabul qiluvchilar: sozlamada tanlanganlar, bo'lmasa barcha faol direktorlar */
export async function recipients(): Promise<{ id: string; fullName: string }[]> {
  const st = await marketingSettings();
  return db.user.findMany({
    where: { isActive: true, ...(st.autoRecipients.length ? { id: { in: st.autoRecipients } } : { role: "DIRECTOR" }) },
    select: { id: true, fullName: true },
  });
}

/** Telegram (ulangan chat bo'lsa) + ilovadagi bildirishnoma. Qaytaradi: nechta odamga, nechtasiga Telegram ketdi */
async function deliver(text: string, n: { type: string; title: string; body: string }): Promise<{ users: number; telegram: number }> {
  const users = await recipients();
  let telegram = 0;
  if (botEnabled()) {
    for (const u of users) {
      const chat = await linkedChatId(u.id);
      if (!chat) continue;
      try { await sendMessage(chat, text); telegram++; } catch (e) { console.error("[smm-auto] telegram", u.id, e instanceof Error ? e.message : e); }
    }
  }
  await notifyUsers(users.map((u) => u.id), { ...n, channel: "oddiy" });
  return { users: users.length, telegram };
}

const origin = () => {
  const u = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return u && !/localhost|127\.0\.0\.1/.test(u) ? u : null;
};
const link = (path: string) => (origin() ? `\n${origin()}${path}` : "");

/** Claude markdown → Telegram (oddiy Markdown): sarlavha va qalin — *…*, ro'yxat — •, jadval qatori — « · » bilan */
export function tgText(md: string): string {
  return md.split("\n").filter((l) => !(/^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-"))).map((l) => { // jadval chizig'i tashlanadi
    let x = l.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#{1,6}\s*(.+)$/, "*$1*").replace(/^\s*[-*]\s+/, "• ");
    if (/^\s*\|.*\|\s*$/.test(x)) x = x.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" · ");
    return x;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ───────── Haftalik: hisobot + reja ───────── */

export async function runWeekly(now = new Date(), by?: { userId: string; name: string }): Promise<{ reportId: string; drafts: number; users: number; telegram: number }> {
  const { aiReady, insightReport } = await import("@/lib/ai/smm-writer");
  if (!aiReady()) throw new Error("AI ulanmagan (ANTHROPIC_API_KEY yo'q)");
  const st = await marketingSettings();
  const r = await insightReport();
  const to = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const rep = await db.smmInsightReport.create({
    data: { periodFrom: new Date(to.getTime() - 30 * 86_400_000), periodTo: to, summary: r.summary, ideas: r.ideas, createdById: by?.userId ?? null, createdByName: by ? `${BY} (${by.name})` : BY },
  });

  // Keyingi hafta rejasi: g'oyalar kontent rejaga «G'oya» bo'lib tushadi — studiyada bir bosishda Reels/post qilinadi
  const take = Math.max(0, Math.min(7, st.autoDrafts));
  const existing = new Set((await db.marketingContent.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, select: { title: true } })).map((c) => c.title.toLowerCase()));
  let drafts = 0;
  for (const idea of r.ideas) {
    if (drafts >= take) break;
    if (existing.has(idea.title.toLowerCase())) continue;
    await db.marketingContent.create({
      data: {
        title: idea.title.slice(0, 160), type: idea.format, status: "IDEA", hook: idea.hook || null, brief: idea.brief || null,
        script: idea.why ? `**Nega:** ${idea.why}` : null, channels: ["INSTAGRAM", "TELEGRAM"], createdBy: `${BY} (haftalik reja)`,
      },
    });
    drafts++;
  }
  if (by) await audit(db, by.userId, "CREATE", "SmmInsightReport", rep.id, undefined, { auto: "weekly", drafts });

  const ideas = r.ideas.slice(0, 8).map((x, i) => `${i + 1}. *${x.title}* (${x.format === "REELS" ? "Reels" : x.format === "POST" ? "post" : "Stories"}) — ${x.hook}`);
  const text = [
    `*Marketing — haftalik hisobot* · ${date(now)}`, "",
    tgText(r.summary).slice(0, 2800), "",
    "*Keyingi hafta uchun g'oyalar*", ...ideas,
    drafts ? `\n${drafts} tasi kontent rejaga «G'oya» bo'lib qo'shildi — studiyada video yoki post qiling.` : "",
    link("/marketing"),
  ].join("\n");
  const d = await deliver(text, { type: "MARKETING_WEEKLY", title: "Marketing: haftalik hisobot tayyor", body: `${r.ideas.length} ta g'oya, ${drafts} tasi kontent rejada` });
  return { reportId: rep.id, drafts, ...d };
}

/* ───────── Kunlik tekshiruv ───────── */

export type DailyFacts = {
  today: { title: string; at: string; approval: string; type: string }[];
  pending: number; // tasdiq kutayotgan postlar
  failedPubs: { title: string; channel: string; error: string }[];
  failedVideos: number;
  boostsPending: number;
  boostsActive: { title: string; spend: number }[];
  leadsYesterday: number;
  leadsUnanswered: number; // 24 soatdan beri «Yangi»
  accountErrors: { name: string; status: string; error: string | null }[];
  ideas: number; // kontent rejadagi g'oyalar (hali ssenariy yo'q)
};

export async function dailyFacts(now = new Date()): Promise<DailyFacts> {
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day1 = new Date(day0.getTime() + 86_400_000);
  const ago24 = new Date(now.getTime() - 86_400_000);
  const [today, pending, failedPubs, failedVideos, boostsPending, boostsActive, leadsYesterday, leadsUnanswered, accountErrors, ideas] = await Promise.all([
    db.marketingContent.findMany({ where: { scheduledAt: { gte: day0, lt: day1 }, status: { not: "CANCELLED" } }, orderBy: { scheduledAt: "asc" }, select: { title: true, scheduledAt: true, approval: true, type: true } }),
    db.marketingContent.count({ where: { approval: "PENDING" } }),
    db.smmPublication.findMany({ where: { status: "FAILED", updatedAt: { gte: ago24 } }, take: 10, select: { channel: true, error: true, content: { select: { title: true } } } }),
    db.smmVideoJob.count({ where: { status: "FAILED", updatedAt: { gte: ago24 } } }),
    db.smmBoost.count({ where: { status: "PENDING_APPROVAL" } }),
    db.smmBoost.findMany({ where: { status: "ACTIVE" }, select: { spend: true, content: { select: { title: true } } } }),
    db.lead.count({ where: { createdAt: { gte: ago24 } } }),
    db.lead.count({ where: { status: "NEW", createdAt: { lt: ago24 } } }),
    db.smmAccount.findMany({ where: { status: { in: ["ERROR", "EXPIRED"] } }, select: { name: true, status: true, lastError: true } }),
    db.marketingContent.count({ where: { status: "IDEA" } }),
  ]);
  const APPROVAL: Record<string, string> = { DRAFT: "qoralama", PENDING: "tasdiq kutmoqda", APPROVED: "tasdiqlangan", REJECTED: "rad etilgan" };
  return {
    today: today.map((c) => ({ title: c.title, at: c.scheduledAt ? dateTime(c.scheduledAt).slice(-5) : "", approval: APPROVAL[c.approval] ?? c.approval, type: c.type })),
    pending,
    failedPubs: failedPubs.map((p) => ({ title: p.content.title, channel: p.channel, error: (p.error ?? "").slice(0, 120) })),
    failedVideos, boostsPending,
    boostsActive: boostsActive.map((b) => ({ title: b.content.title, spend: Number(b.spend) })),
    leadsYesterday, leadsUnanswered,
    accountErrors: accountErrors.map((a) => ({ name: a.name, status: a.status, error: a.lastError })),
    ideas,
  };
}

function factsText(f: DailyFacts): string[] {
  const out: string[] = [];
  out.push(f.today.length ? `*Bugun chiqadi:* ${f.today.length} ta` : "*Bugun chiqadigan post yo'q*");
  for (const t of f.today) out.push(`• ${t.at} — ${t.title} (${t.approval}${t.approval === "tasdiqlangan" ? "" : " — vaqtida chiqmaydi!"})`);
  if (f.pending) out.push(`• Tasdiq kutayotgan postlar: ${f.pending}`);
  if (f.failedPubs.length) { out.push(`*Nashr xatolari (24 soat):* ${f.failedPubs.length}`); for (const p of f.failedPubs.slice(0, 5)) out.push(`• ${p.title} — ${p.channel}: ${p.error}`); }
  if (f.failedVideos) out.push(`• Video montaj xatolari (24 soat): ${f.failedVideos}`);
  if (f.boostsPending) out.push(`• Target so'rovlari tasdiq kutmoqda: ${f.boostsPending}`);
  if (f.boostsActive.length) out.push(`• Faol reklama: ${f.boostsActive.length} ta, jami sarf ${fmtNum(f.boostsActive.reduce((a, b) => a + b.spend, 0), 2)}`);
  out.push(`• Arizalar: oxirgi 24 soatda ${f.leadsYesterday}${f.leadsUnanswered ? `, javobsiz (1 kundan ortiq) — ${f.leadsUnanswered}` : ""}`);
  for (const a of f.accountErrors) out.push(`• Profil «${a.name}» — ${a.status === "EXPIRED" ? "token muddati tugagan" : "xato"}${a.error ? `: ${a.error.slice(0, 100)}` : ""}`);
  if (f.ideas) out.push(`• Kontent rejadagi g'oyalar: ${f.ideas} (studiyada ishlang)`);
  return out;
}

/** Claude faktlardan bugungi 3 ta eng muhim ishni ajratadi (faqat berilgan faktlar bo'yicha) */
async function dailyAdvice(f: DailyFacts): Promise<string | null> {
  const { aiReady } = await import("@/lib/ai/smm-writer");
  if (!aiReady()) return null;
  const { MARKETING_MODEL } = await import("@/lib/ai/marketing-agent");
  const res = await new Anthropic().messages.create({
    model: MARKETING_MODEL,
    max_tokens: 1200,
    output_config: { effort: "low" },
    system: "Sen beton zavodi marketing bo'limining kunlik yordamchisisan. Faqat berilgan faktlarga tayan, raqam o'ylab topma. O'zbek tilida (lotin), qisqa: bugun qilinishi kerak bo'lgan eng muhim 3 ta ish, har biri bitta qator, «1.» «2.» «3.» bilan, muhimidan boshlab. Emoji ishlatma, markdown jadval ishlatma.",
    messages: [{ role: "user", content: `Bugungi faktlar (JSON):\n${JSON.stringify(f)}` }],
  });
  const t = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return t || null;
}

export async function runDaily(now = new Date()): Promise<{ users: number; telegram: number }> {
  const f = await dailyFacts(now);
  const advice = await dailyAdvice(f).catch((e) => { console.error("[smm-auto] kunlik AI", e instanceof Error ? e.message : e); return null; });
  const text = [
    `*Marketing — kunlik tekshiruv* · ${date(now)}`, "",
    ...factsText(f),
    advice ? `\n*Bugun nima qilish kerak*\n${tgText(advice)}` : "",
    link("/marketing/kontent"),
  ].join("\n");
  const problems = f.failedPubs.length + f.failedVideos + f.accountErrors.length + f.today.filter((t) => t.approval !== "tasdiqlangan").length;
  return deliver(text, {
    type: "MARKETING_DAILY",
    title: "Marketing: kunlik tekshiruv",
    body: `Bugun ${f.today.length} ta post${problems ? `, ${problems} ta muammo` : ""}; arizalar 24 soatda — ${f.leadsYesterday}`,
  });
}
