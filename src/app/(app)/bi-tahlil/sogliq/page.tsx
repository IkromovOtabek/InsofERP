import Link from "next/link";
import { ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { requirePage } from "@/lib/page-guard";
import { HEALTH_STATUS_LABEL, lastDataHealthRun, type HealthCheck } from "@/lib/data-health";
import { dateTime } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, StatCard, Table, Td, Th, Tr, type BadgeColor } from "@/components/ui";
import { RunButton } from "./run-button";

export const dynamic = "force-dynamic";

const COLOR: Record<HealthCheck["status"], BadgeColor> = { crit: "red", warn: "amber", ok: "green" };

/**
 * Ma'lumot sog'ligi — raqamlar bir-biriga to'g'ri kelmasligining manbasi (Sarvar rejasi, 2026-11-24): har kecha ~02:00
 * avtomatik tekshiriladi (`lib/data-health-watch.ts`), muammo bo'lsa direktorga Telegram. «Hozir tekshirish» — qo'lda.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/sogliq");
  const { range } = await biContext(searchParams, "/bi-tahlil/sogliq");
  const run = await lastDataHealthRun();
  const checks = (run?.result ?? []) as unknown as HealthCheck[];
  const crit = checks.filter((c) => c.status === "crit").length, warn = checks.filter((c) => c.status === "warn").length;

  return (
    <BiPage title="Ma'lumot sog'ligi" tab="overview" range={range} period={false}
      info="Har kecha soat 02:00 da (Toshkent) avtomatik tekshiriladi: sotilgan va ishlab chiqarilgan miqdor, beton zamesi, retsept me'yori, kassa qoldig'i, QQS, narx va tannarx, katalog to'liqligi, ochiq zayavkalar. Muammo bo'lsa direktorga Telegram'da xabar boradi. Davr — joriy oy boshidan bugungacha.">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          {run ? <>Oxirgi tekshiruv: <b>{dateTime(run.ranAt)}</b> ({run.manual ? "qo'lda" : "tungi avtomatik"}{run.notified ? `, Telegram — ${run.notified} ta` : ""})</> : "Hali tekshirilmagan"}
        </div>
        <RunButton />
      </div>

      {run ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Shoshilinch" value={String(crit)} icon={AlertTriangle} tone={crit ? "danger" : "default"} />
            <StatCard label="Tekshirish kerak" value={String(warn)} icon={AlertTriangle} tone={warn ? "warning" : "default"} />
            <StatCard label="Joyida" value={String(checks.length - crit - warn)} icon={CheckCircle2} tone="success" />
          </div>
          <div className="space-y-4">
            {[...checks].sort((a, b) => ["crit", "warn", "ok"].indexOf(a.status) - ["crit", "warn", "ok"].indexOf(b.status)).map((c) => (
              <Card key={c.key}>
                <CardHeader title={c.title} icon={ShieldCheck} info={c.hint}
                  description={<span className="flex flex-wrap items-center gap-2"><Badge color={COLOR[c.status]}>{HEALTH_STATUS_LABEL[c.status]}</Badge><span>{c.value}</span></span>}
                  action={<Link href={c.href} className="text-sm font-medium text-blue-600 hover:underline">Manbaga o&apos;tish</Link>} />
                {c.rows.length > 0 && (
                  <Table className="mt-3">
                    <thead><tr><Th>Yozuv</Th><Th>Tafsilot</Th></tr></thead>
                    <tbody>
                      {c.rows.map((r, i) => (
                        <Tr key={i}>
                          <Td className="font-medium">{r.href ? <Link href={r.href} className="hover:underline">{r.label}</Link> : r.label}</Td>
                          <Td className="text-slate-600">{r.detail}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Empty text="Natija yo'q — «Hozir tekshirish» tugmasini bosing" icon={ShieldCheck} />
      )}
    </BiPage>
  );
}
