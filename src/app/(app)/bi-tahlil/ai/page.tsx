import Link from "next/link";
import { Bot, Zap, TrendingUp, FileText, MessageSquare, ArrowRight, Clock, RefreshCw, AlertTriangle, ListChecks, MessagesSquare, Timer, History } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { aiDirector, aiReport, REPORTS, type ReportType } from "@/lib/bi/ai";
import { aiUsageStats } from "@/lib/bi/ai-chat";
import { rangeQuery, startOfDay } from "@/lib/bi/core";
import { moneyShort, dateTime, date as fmtDate, time, fmtNum } from "@/lib/format";
import { Panel, Note, ScoreRing, Chip, Kpi } from "../ui";
import { cn } from "@/lib/utils";
import { requirePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/ai");
  const { s, sp, range } = await biContext(searchParams);
  const type: ReportType = (REPORTS.some((r) => r.key === sp.report) ? sp.report : "executive") as ReportType;
  // Direktor — butun korxona bo'yicha foydalanish; boshqa rollar — faqat o'zining savollari
  const all = s.role === "DIRECTOR";
  const [d, rep, u] = await Promise.all([aiDirector(range), aiReport(type), aiUsageStats(all ? null : s.userId)]);
  // Sana — mahalliy (Toshkent) kun: toISOString UTC bo'yicha bir kun oldingi sanani berardi
  const q = (extra: Record<string, string>) => `/bi-tahlil/ai?${rangeQuery(range, { report: type, ...extra })}`;
  const today = startOfDay(new Date()), sec = (ms: number | null) => (ms === null ? "—" : `${fmtNum(ms / 1000, 1)} soniya`);
  const dangerRisks = d.risks.filter((r) => r.tone === "danger").length, taskMoney = d.tasks.reduce((t, x) => t + (x.money ?? 0), 0);

  return (
    <BiPage title="Insof AI — tahlil" info={<>
      <p>Bu sahifa savolni kutmaydi: tizim butun biznesni o&apos;zi ko&apos;rib chiqadi va bugun nima qilish kerakligini pul bo&apos;yicha tartiblab beradi. Savol berish uchun — AI Chat.</p>
      <p>Insof AI — qoida asosidagi tahlil dvigateli. Javoblar dashboard ma&apos;lumotlaridan olinadi; muhim qarordan oldin manbani tekshiring.</p>
    </>} eyebrow="Insof AI" tab="ai" range={range} keep={{ report: type }}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Xavflar" value={String(d.risks.length)} icon={AlertTriangle} tone={dangerRisks ? "danger" : d.risks.length ? "warning" : "success"} hint={d.risks.length ? `${dangerRisks} tasi jiddiy · pul bo'yicha tartiblangan` : "shoshilinch xavf yo'q"} href="#xavflar" />
          <Kpi label="Vazifalar" value={String(d.tasks.length)} icon={ListChecks} tone="brand" hint={taskMoney ? `≈ ${moneyShort(taskMoney)} so'm ta'sir` : "bajariladigan ish yo'q"} href="#xavflar" />
          <Kpi label="AI savollar · bu oy" value={String(u.month)} icon={MessageSquare} tone="info" hint={`bugun ${u.today} · panel ${u.panel.month} · Telegram ${u.telegram.month}${all ? "" : " (sizniki)"}`} href="/bi-tahlil/ai/chat" />
          <Kpi label="Suhbatlar" value={String(u.chats)} icon={MessagesSquare} tone="violet" hint={all ? `bu oy ${u.users} foydalanuvchi savol berdi` : "AI Chat'dagi suhbatlaringiz"} href="/bi-tahlil/ai/chat" />
          <Kpi label="O'rtacha javob vaqti" value={sec(u.avgMs)} icon={Timer} hint={u.avgMs === null ? "bu oy savol yo'q" : `bu oy · panel ${sec(u.panel.avgMs)} · Telegram ${sec(u.telegram.avgMs)}`} />
          <Kpi label="Oxirgi savol" value={u.last ? (u.last.at >= today ? time(u.last.at) : fmtDate(u.last.at)) : "—"} icon={History} hint={u.last ? `${u.last.at >= today ? "bugun" : time(u.last.at)} · ${u.last.channel}` : "hali savol berilmagan"} />
        </div>

        {/* AI Direktor */}
        <div className="on-dark rounded-(--radius-card) bg-gradient-to-br from-ink-950 via-ink-900 to-slate-800 px-6 py-5 text-white shadow-(--shadow-pop)">
          <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-400"><Bot size={14} /> AI Direktor</div>
          <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">Bugun nima qilish kerakligini tizim o'zi aytadi</h2>
          <p className="mt-1 max-w-3xl text-[14px] text-slate-300">Savol berish shart emas. Butun biznes ko'rib chiqildi va bajariladigan {d.tasks.length} ta ish pul bo'yicha tartiblandi — har biriga aniq ro'yxat va bir bosishli harakat bilan.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <ScoreRing score={d.health} size={84} />
            <div><div className="text-sm font-semibold">Biznes salomatligi: {d.healthLabel}</div><div className="text-xs text-slate-400">{d.summary[2]}</div></div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel id="xavflar" className="xl:col-span-2" title={<span className="inline-flex items-center gap-1.5"><Zap size={15} className="text-brand-500" /> Salom. Hozir {d.risks.length} ta xavf.</span>} eyebrow="Bugungi vazifalar" info="Pul bo'yicha tartiblangan. Har karta — nima bo'lyapti, nima qilish kerak va qayerga borish." action={<span className="inline-flex items-center gap-1"><Clock size={12} /> {dateTime(d.generatedAt)} · <RefreshCw size={12} /> avtomatik</span>} padded={false}>
            {d.risks.length ? <ul className="divide-y divide-slate-100">{d.risks.map((r) => (
              <li key={r.key} className="px-5 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="flex items-center gap-2 text-[14px] font-semibold"><span className={cn("h-2 w-2 rounded-full", r.tone === "danger" ? "bg-red-500" : r.tone === "warning" ? "bg-amber-500" : "bg-blue-500")} />{r.title}</div><div className={cn("text-sm font-bold tabular", r.tone === "danger" ? "text-red-600" : r.tone === "warning" ? "text-amber-600" : "text-blue-600")}>{r.money}</div></div>
                <p className="mt-1 text-[13px] text-slate-600">{r.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]"><span className="inline-flex items-center gap-1 font-medium text-slate-800"><ArrowRight size={13} className="text-brand-500" /> {r.action}</span><Link href={r.href} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200">ochish</Link></div>
              </li>
            ))}</ul> : <div className="p-5"><Note>Hozir shoshilinch xavf yo'q — biznes odatiy rejimda.</Note></div>}
            {d.tasks.length > 0 && <div className="border-t border-slate-100 px-5 py-3"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Vazifalar ro'yxati · pul bo'yicha</div><ol className="space-y-1 text-[13px]">{d.tasks.map((t) => <li key={t.n} className="flex items-start gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{t.n}</span><div className="min-w-0 flex-1"><Link href={t.href} className="font-medium hover:underline">{t.title}</Link> <span className="text-slate-500">— {t.text}</span></div><span className="shrink-0 text-xs font-semibold tabular text-slate-700">{t.money ? moneyShort(t.money) : ""}</span></li>)}</ol></div>}
          </Panel>
          <div className="space-y-6">
            <Panel title={<span className="inline-flex items-center gap-1.5"><TrendingUp size={15} className="text-emerald-500" /> Yaxshi xabar</span>}>
              {d.good.length ? <ul className="space-y-2 text-[13px]">{d.good.map((g, i) => <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /><span>{g.text} <Link href={g.href} className="text-xs font-medium text-blue-600 hover:underline">ochish</Link></span></li>)}</ul> : <Note>Bu davrda alohida ijobiy signal yo'q.</Note>}
            </Panel>
            <Panel title={<span className="inline-flex items-center gap-1.5"><FileText size={15} className="text-slate-500" /> Qisqacha</span>}>
              <ul className="space-y-1.5 text-[13px]">{d.summary.map((s, i) => <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" /><span>{s}</span></li>)}</ul>
            </Panel>
          </div>
        </div>

        {/* Hisobotlar */}
        <Panel title={<span className="inline-flex items-center gap-1.5"><FileText size={15} /> Hisobotlar</span>} eyebrow="Morning · Evening · Weekly · Monthly · Executive" info={<>
          <p>Hisobot matni dashboard ma&apos;lumotlaridan avtomatik yig&apos;iladi — har ochilganda yangi.</p>
          <p>Barcha raqamlar ERP bazasidan jonli hisoblanadi: sotuv — tasdiqlangan zayavkalar, reja — Reja nazorati, xomashyo — StockMove jurnali, qarz — ochiq schyotlar. Matn shablon asosida yig&apos;iladi; tashqi AI xizmati ishlatilmaydi, ma&apos;lumot tashqariga chiqmaydi.</p>
        </>} action={<div className="flex flex-wrap gap-1">{REPORTS.map((r) => <Chip key={r.key} active={type === r.key} href={q({ report: r.key })}>{r.label}</Chip>)}</div>}>
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-lg font-semibold">{rep.title}</h3><div className="text-xs text-slate-500">{rep.sub}</div></div>
            <div className="mt-1 text-xs text-slate-400">{REPORTS.find((r) => r.key === type)?.desc} · {fmtDate(new Date())}</div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">{rep.sections.map((s) => <div key={s.title} className="rounded-lg bg-white p-3.5 shadow-xs"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{s.title}</div><ul className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-slate-700">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></div>)}</div>
            <div className="mt-4 flex flex-wrap gap-2">{rep.hrefs.map((h) => <Link key={h.href} href={h.href} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">{h.label} <ArrowRight size={12} /></Link>)}</div>
          </div>
        </Panel>

        <Link href="/bi-tahlil/ai/chat" className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-slate-200/80 bg-white px-5 py-4 shadow-(--shadow-card) transition hover:border-slate-300 hover:shadow-md">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700"><MessageSquare size={18} /></div><div><div className="font-semibold">Savolingiz bormi? AI Chat'ga o'ting</div><div className="text-xs text-slate-500">Nega sotuv kamaydi · Qaysi sotuvchi ortda · Foyda nega o'zgardi · Qaysi xomashyo tugayapti</div></div></div>
          <ArrowRight size={18} className="text-slate-400" />
        </Link>
      </div>
    </BiPage>
  );
}
