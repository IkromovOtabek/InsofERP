import { ChevronDown, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, fmtNum } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { AddKeyword, PositionsForm } from "./seo-forms";

const TOOLS = [
  { t: "Yandex Webmaster", h: "https://webmaster.yandex.ru/" },
  { t: "Google Search Console", h: "https://search.google.com/search-console" },
  { t: "Yandex Wordstat", h: "https://wordstat.yandex.ru/" },
  { t: "Yandex Metrica", h: "https://metrika.yandex.ru/" },
  { t: "PageSpeed Insights", h: "https://pagespeed.web.dev/" },
];

/** SEO semantik yadro: klaster → sahifa, chastota va Yandex/Google pozitsiyalari. */
export default async function SeoPage() {
  const s = await requirePage("/marketing/seo");
  const canEdit = canDo(s, "marketing", "seo");
  const kws = await db.seoKeyword.findMany({ orderBy: [{ cluster: "asc" }, { lang: "asc" }, { phrase: "asc" }] });
  const clusters = [...new Set(kws.map((k) => k.cluster))];
  const top = (key: "posYandex" | "posGoogle", n: number) => kws.filter((k) => k[key] !== null && k[key]! <= n).length;
  const last = kws.reduce<Date | null>((a, k) => (k.checkedAt && (!a || k.checkedAt > a) ? k.checkedAt : a), null);

  return (
    <div>
      <PageHeader title="SEO" subtitle="Semantik yadro va pozitsiyalar. Chastotani Wordstat'dan, pozitsiyani Webmaster / Search Console'dan haftasiga bir marta yozing." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Kalit so'zlar" value={fmtNum(kws.length)} hint={`${clusters.length} klaster`} />
        <StatCard label="Yandex TOP-10" value={fmtNum(top("posYandex", 10))} hint={`TOP-3: ${top("posYandex", 3)}`} />
        <StatCard label="Google TOP-10" value={fmtNum(top("posGoogle", 10))} hint={`TOP-3: ${top("posGoogle", 3)}`} />
        <StatCard label="Oxirgi tekshiruv" value={last ? date(last) : "—"} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TOOLS.map((x) => (
          <a key={x.t} href={x.h} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-400">
            {x.t} <ExternalLink size={13} className="text-slate-400" />
          </a>
        ))}
      </div>

      {canEdit && (
        <details className="group mt-6 rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-medium">So&apos;rov qo&apos;shish <ChevronDown size={16} className="transition group-open:rotate-180" /></summary>
          <div className="border-t border-slate-100 p-4"><AddKeyword clusters={clusters} /></div>
        </details>
      )}

      <div className="mt-6 space-y-4">
        {kws.length === 0 ? (
          <Card><EmptyState title="Kalit so'zlar yo'q" text="Semantik yadro: docs/marketing/04-seo-semantik-yadro.md — `npm run marketing:seed` yuklaydi." /></Card>
        ) : clusters.map((cl) => (
          <Card key={cl} padded={false}>
            <div className="px-4 pt-4"><CardHeader title={cl} description="Chastota · Yandex · Google" /></div>
            <ul className="divide-y divide-slate-100">
              {kws.filter((k) => k.cluster === cl).map((k) => (
                <li key={k.id} className="grid gap-2 px-4 py-2 sm:grid-cols-[1fr_40px_1fr_auto] sm:items-center sm:gap-4">
                  <span className="text-sm">{k.phrase}</span>
                  <span className="text-xs text-slate-500 uppercase">{k.lang}</span>
                  <span className="truncate font-mono text-xs text-slate-500">{k.url ?? "—"}</span>
                  <PositionsForm k={k} canEdit={canEdit} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
