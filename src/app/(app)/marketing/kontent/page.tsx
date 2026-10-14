import Link from "next/link";
import { Eye, Heart, Plus, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, fmtNum } from "@/lib/format";
import { CONTENT_FLOW, CONTENT_STATUS, CONTENT_TYPE } from "@/lib/marketing";
import { Badge, LinkButton, PageHeader, StatCard } from "@/components/ui";

/** Kontent reja: Reels/post/maqola — g'oyadan nashrgacha (kanban). */
export default async function ContentPlanPage() {
  const s = await requirePage("/marketing/kontent");
  const items = await db.marketingContent.findMany({ orderBy: [{ publishDate: "asc" }, { createdAt: "asc" }] });
  const pub = items.filter((i) => i.status === "PUBLISHED");
  const sum = (k: "views" | "likes" | "leads") => pub.reduce((a, i) => a + i[k], 0);
  const cancelled = items.filter((i) => i.status === "CANCELLED").length;

  return (
    <div>
      <PageHeader
        title="Kontent reja"
        subtitle="Reels, post va maqolalar. Chiqqan kontentga ko'rishlar va lidlarni yozib boring — oylik natija shundan yig'iladi."
        action={canDo(s, "marketing", "content") ? <LinkButton href="/marketing/kontent/new"><Plus size={15} /> Yangi kontent</LinkButton> : undefined}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Chiqdi" value={`${pub.length} / ${items.length - cancelled}`} hint="nashr / rejada" />
        <StatCard label="Ko'rishlar" value={fmtNum(sum("views"))} />
        <StatCard label="Layklar" value={fmtNum(sum("likes"))} />
        <StatCard label="Kontentdan lid" value={fmtNum(sum("leads"))} />
      </div>

      <div className="-mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-5 xl:overflow-visible">
        {CONTENT_FLOW.map((col) => {
          const list = items.filter((i) => i.status === col);
          return (
            <section key={col} className="w-72 shrink-0 snap-start rounded-xl bg-slate-100/80 p-2.5 xl:w-auto">
              <header className="mb-2.5 flex items-center justify-between px-1">
                <Badge color={CONTENT_STATUS[col].color}>{CONTENT_STATUS[col].label}</Badge>
                <span className="text-xs text-slate-500 tabular">{list.length}</span>
              </header>
              <ul className="space-y-2">
                {list.map((i) => (
                  <li key={i.id}>
                    <Link href={`/marketing/kontent/${i.id}`} className="block rounded-lg border border-slate-200 bg-white p-3 shadow-xs transition hover:border-slate-400">
                      <div className="flex justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate">{CONTENT_TYPE[i.type]}{i.rubric ? ` · ${i.rubric}` : ""}</span>
                        <span className="shrink-0">{i.publishDate ? date(i.publishDate) : "—"}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-snug font-medium">{i.title}</p>
                      {i.status === "PUBLISHED" && (
                        <p className="mt-2 flex gap-3 text-[11px] text-slate-500 tabular">
                          <span className="inline-flex items-center gap-1"><Eye size={12} />{fmtNum(i.views)}</span>
                          <span className="inline-flex items-center gap-1"><Heart size={12} />{fmtNum(i.likes)}</span>
                          <span className="inline-flex items-center gap-1"><UserPlus size={12} />{i.leads}</span>
                        </p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
