import Link from "next/link";
import { CheckCircle2, CircleAlert, Crosshair } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { dateTime, fmtNum } from "@/lib/format";
import { marketingSettings, monthCommitted } from "@/lib/smm/boosts";
import { audienceByKey } from "@/lib/smm/audiences";
import { BOOST_OBJECTIVE, BOOST_STATUS, CHANNEL_LABEL } from "@/lib/smm/labels";
import { missingChannels, smmDryRun } from "@/lib/smm/config";
import { Badge, Callout, Card, CardHeader, EmptyState, LinkButton, PageHeader, Progress, StatCard } from "@/components/ui";
import { BoostButtons } from "./boost-buttons";

/** Target: chiqqan postlarni Meta'da reklama qilish — so'rov → direktor tasdig'i → ishga tushish; limitlar */
export default async function TargetPage() {
  const s = await requirePage("/marketing/target");
  const [boosts, settings, committed, miss] = await Promise.all([
    db.smmBoost.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { content: { select: { id: true, title: true } } } }),
    marketingSettings(),
    monthCommitted(),
    missingChannels(),
  ]);
  const cur = settings.adCurrency;
  const canApprove = canDo(s, "marketing", "boost_approve");
  const spend = boosts.reduce((a, b) => a + Number(b.spend), 0);
  const results = boosts.reduce((a, b) => a + b.results, 0);
  const reach = boosts.reduce((a, b) => a + b.reach, 0);
  const pending = boosts.filter((b) => b.status === "PENDING_APPROVAL").length;
  const dry = smmDryRun();

  return (
    <div>
      <PageHeader title="Target" subtitle="Instagram'da chiqqan postni reklama qilish. Sotuvchi so'rov yuboradi, direktor tasdiqlagach Meta'da ishga tushadi — limitdan oshib bo'lmaydi." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sarflandi" value={`${fmtNum(spend, 2)} ${cur}`} icon={Crosshair} />
        <StatCard label="Qamrov" value={fmtNum(reach)} hint={`Natija (xabar/ariza): ${fmtNum(results)}`} />
        <StatCard label="Natija narxi" value={results ? `${fmtNum(spend / results, 2)} ${cur}` : "—"} />
        <StatCard label="Tasdiq kutmoqda" value={fmtNum(pending)} tone={pending ? "warning" : "default"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card padded={false}>
          <div className="p-4 pb-2"><CardHeader title="Reklamalar" description="Yangi so'rov — post sahifasidan («Target qilish»)" /></div>
          {boosts.length === 0 ? <EmptyState title="Reklama yo'q" text="Kontent rejada Instagram'da chiqqan postni oching va «Target qilish» formasini to'ldiring." /> : (
            <ul className="divide-y divide-slate-100">
              {boosts.map((b) => {
                const total = Number(b.dailyBudget) * b.days;
                return (
                  <li key={b.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/marketing/kontent/${b.content.id}`} className="font-medium hover:underline">{b.content.title}</Link>
                        <p className="text-xs text-slate-500">
                          {BOOST_OBJECTIVE[b.objective].label} · {audienceByKey(b.audience)?.label ?? b.audience} · {fmtNum(Number(b.dailyBudget), 2)} {cur} × {b.days} kun = {fmtNum(total, 2)} {cur}
                        </p>
                        <p className="text-xs text-slate-400">So&apos;radi: {b.requestedByName ?? "—"} · {dateTime(b.createdAt)}{b.approvedByName ? ` · ko'rib chiqdi: ${b.approvedByName}` : ""}</p>
                      </div>
                      <Badge color={BOOST_STATUS[b.status].color}>{BOOST_STATUS[b.status].label}</Badge>
                    </div>
                    {(b.status === "ACTIVE" || b.status === "PAUSED" || b.status === "COMPLETED") && (
                      <div>
                        <div className="flex justify-between text-xs text-slate-500 tabular"><span>{fmtNum(Number(b.spend), 2)} / {fmtNum(total, 2)} {cur}</span><span>qamrov {fmtNum(b.reach)} · klik {fmtNum(b.clicks)} · natija {fmtNum(b.results)}</span></div>
                        <Progress value={Number(b.spend)} max={total} />
                      </div>
                    )}
                    {b.note && <p className="text-xs text-slate-600">«{b.note}»</p>}
                    {b.error && <p className="text-xs text-slate-500">{b.error}</p>}
                    {canApprove && <BoostButtons id={b.id} status={b.status} total={fmtNum(total, 2)} currency={cur} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Oylik limit" description="Joriy oyda so'ralgan va ishlayotgan reklamalar" />
            <p className="mb-2 text-sm tabular">{fmtNum(committed, 2)} / {fmtNum(Number(settings.boostMonthlyCap), 2)} {cur}</p>
            <Progress value={committed} max={Number(settings.boostMonthlyCap)} tone={committed > Number(settings.boostMonthlyCap) * 0.8 ? "warning" : "default"} />
            <p className="mt-2 text-xs text-slate-500">Bitta reklama kunlik limiti: {fmtNum(Number(settings.boostDailyCap), 2)} {cur}. Limitlar — Sozlamalar&apos;da.</p>
          </Card>
          <Card>
            <CardHeader title="Ulanishlar" action={<LinkButton href="/marketing/sozlamalar" size="sm" variant="secondary">Sozlamalar</LinkButton>} />
            {dry && <Callout tone="info">Sinov rejimi: hech narsa tarmoqqa yuborilmaydi, pul sarflanmaydi.</Callout>}
            <ul className="space-y-2 text-sm">
              {(["INSTAGRAM", "TELEGRAM", "FACEBOOK"] as const).map((ch) => (
                <li key={ch} className="flex items-center gap-2">
                  {miss[ch] ? <CircleAlert size={16} className="shrink-0 text-amber-500" /> : <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />}
                  <span>{CHANNEL_LABEL[ch]}{miss[ch] ? " — ulanmagan" : ""}</span>
                </li>
              ))}
              <li className="flex items-center gap-2">
                {miss.ADS ? <CircleAlert size={16} className="shrink-0 text-amber-500" /> : <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />}
                <span>Meta reklama kabineti{miss.ADS ? " — ulanmagan" : ""}</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
