import Link from "next/link";
import { CircleAlert, CircleCheck, CircleDashed, Info, MessageSquareText, Settings2 } from "lucide-react";
import { db } from "@/lib/db";
import { publicOrigin } from "@/lib/public-url";
import { runChecks, tashkentDay, STATUS_LABEL, type CheckStatus } from "@/lib/nazorat/checks";
import { directorText } from "@/lib/nazorat/report";
import { dateTime } from "@/lib/format";
import { Card, CardHeader, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { NazoratSettingsForm, SendNowButton } from "./nazorat-forms";

const STYLE: Record<CheckStatus, { box: string; bar: string; icon: typeof CircleAlert; ic: string }> = {
  crit: { box: "border-red-200 bg-red-50/70", bar: "bg-red-500", icon: CircleAlert, ic: "text-red-600" },
  warn: { box: "border-amber-200 bg-amber-50/60", bar: "bg-amber-500", icon: CircleAlert, ic: "text-amber-600" },
  ok: { box: "border-slate-200 bg-white", bar: "bg-emerald-500", icon: CircleCheck, ic: "text-emerald-600" },
  info: { box: "border-slate-200 bg-white", bar: "bg-blue-400", icon: Info, ic: "text-blue-600" },
  unset: { box: "border-dashed border-slate-300 bg-slate-50", bar: "bg-slate-300", icon: CircleDashed, ic: "text-slate-400" },
};

/**
 * Direktor «Nazorat» tabi (shablon 03, «Insof 2026» → «Nazorat»): 14 ta kunlik tekshiruv plitkasi — holat, qiymat,
 * mas'ul va nima qilish kerak; bosilsa muammoli yozuvlar sahifasi. Pastda Telegram xabarining ko'rinishi,
 * yuborilgan hisobotlar va sozlamalar. Hisob — `lib/nazorat/checks.ts`, yuborish — `lib/nazorat/report.ts`.
 */
export async function NazoratHome({ date }: { date?: string }) {
  const picked = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00+05:00`) : undefined;
  const day = tashkentDay(picked);
  const [checks, settings, reports, materials, origin] = await Promise.all([
    runChecks({ day: picked }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { controlReportEnabled: true, controlReportHour: true, controlNotifyOwners: true, fuelMaterialId: true } }),
    db.controlReport.findMany({ orderBy: { day: "desc" }, take: 7 }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    publicOrigin().catch(() => ({ origin: "" })),
  ]);
  const count = (s: CheckStatus) => checks.filter((c) => c.status === s).length;
  const ymd = new Date(day.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
  const hour = settings?.controlReportHour ?? 19;
  const preview = directorText(checks, day, `${origin.origin}/dashboard?view=nazorat`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
          <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">{count("crit")} shoshilinch</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">{count("warn")} tekshirish kerak</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">{count("ok")} joyida</span>
          {count("unset") > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{count("unset")} sozlanmagan</span>}
        </div>
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="view" value="nazorat" />
          <Input type="date" name="date" defaultValue={ymd} className="h-9 w-44" aria-label="Kun" />
          <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {checks.map((c) => {
          const st = STYLE[c.status], Icon = st.icon;
          return (
            <Link key={c.key} href={c.href} className={cn("relative flex flex-col gap-1.5 overflow-hidden rounded-xl border p-3.5 pl-4 transition hover:shadow-sm", st.box)}>
              <span className={cn("absolute inset-y-0 left-0 w-1", st.bar)} />
              <span className="flex items-center justify-between gap-2 text-[12px] font-semibold text-slate-500">
                <span>{String(c.no).padStart(2, "0")} · {c.owner}</span>
                <Icon size={16} className={st.ic} aria-label={STATUS_LABEL[c.status]} />
              </span>
              <span className="text-[14px] font-semibold leading-snug text-slate-900">{c.title}</span>
              <span className={cn("text-[17px] font-bold tabular", c.status === "crit" ? "text-red-700" : c.status === "warn" ? "text-amber-800" : "text-slate-800")}>{c.value}</span>
              {c.detail && <span className="text-[12px] text-slate-500">{c.detail}</span>}
              {(c.status === "crit" || c.status === "warn" || c.status === "unset") && <span className="text-[12px] text-slate-600">{c.action}</span>}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title={`Telegram xabari (har kuni ${String(hour).padStart(2, "0")}:00)`} icon={MessageSquareText} description="Direktorga to'liq; mas'ullarga — faqat o'z bandlari" action={<SendNowButton />} />
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-[13px] leading-relaxed text-slate-700">{preview}</pre>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Yuborilgan hisobotlar" />
          {reports.length === 0 ? <p className="text-sm text-slate-500">Hali yuborilmagan.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {reports.map((r) => {
                const sm = r.summary as { crit?: number[]; warn?: number[] };
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{dateTime(r.sentAt)}{r.manual && <span className="ml-1 text-[12px] text-slate-400">qo&apos;lda</span>}</span>
                    <span className="text-[13px] text-slate-500"><b className="text-red-600">{sm.crit?.length ?? 0}</b> / <b className="text-amber-700">{sm.warn?.length ?? 0}</b> · {r.recipients} kishiga</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div id="sozlamalar" className="scroll-mt-20">
        <Card>
          <CardHeader title="Sozlamalar" icon={Settings2} description="Hisobot vaqti, kimga yuborilishi va salyarka nazorati" />
          <NazoratSettingsForm enabled={settings?.controlReportEnabled ?? true} hour={hour} owners={settings?.controlNotifyOwners ?? true} fuelMaterialId={settings?.fuelMaterialId ?? null} materials={materials} />
        </Card>
      </div>
    </div>
  );
}
