import Link from "next/link";
import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/ui";
import { Uploader } from "./uploader";
import { MediaCard } from "./media-card";

/** Media kutubxona: zavod, obyekt va mahsulot rasm/videolari — postga shu yerdan biriktiriladi */
export default async function MediaPage({ searchParams }: { searchParams: Promise<{ t?: string; k?: string }> }) {
  const s = await requirePage("/marketing/media");
  const sp = await searchParams;
  const tag = (sp.t ?? "").toLowerCase().slice(0, 40);
  const kind = sp.k === "VIDEO" || sp.k === "IMAGE" ? sp.k : undefined;
  const where: Prisma.SmmMediaWhereInput = { ...(tag ? { tags: { has: tag } } : {}), ...(kind ? { kind } : {}) };
  const [items, all] = await Promise.all([
    db.smmMedia.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { contents: true } } } }),
    db.smmMedia.findMany({ select: { tags: true, kind: true } }),
  ]);
  const tags = [...new Set(all.flatMap((m) => m.tags))].sort();
  const canEdit = canDo(s, "marketing", "content");
  const link = (p: { t?: string; k?: string }) => {
    const q = new URLSearchParams({ ...(p.t ? { t: p.t } : {}), ...(p.k ? { k: p.k } : {}) }).toString();
    return `/marketing/media${q ? `?${q}` : ""}`;
  };
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 text-sm transition", active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-400");

  return (
    <div>
      <PageHeader title="Media kutubxona" subtitle={`Suratga olish kunlaridagi material bitta joyda — teglab qo'ying, postga bir bosishda biriktiriladi. Jami: ${all.length} (video ${all.filter((m) => m.kind === "VIDEO").length})`} />
      {canEdit && <div className="mb-6"><Uploader /></div>}
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={link({ t: tag })} className={chip(!kind)}>Hammasi</Link>
        <Link href={link({ t: tag, k: "VIDEO" })} className={chip(kind === "VIDEO")}>Video</Link>
        <Link href={link({ t: tag, k: "IMAGE" })} className={chip(kind === "IMAGE")}>Rasm</Link>
        <span className="mx-1 w-px bg-slate-200" />
        {tags.map((t) => <Link key={t} href={link({ t: tag === t ? undefined : t, k: kind })} className={chip(tag === t)}>#{t}</Link>)}
      </div>
      {items.length === 0 ? (
        <EmptyState title="Media yo'q" text="Zavod, obyekt va mahsulot videolarini yuklang — AI ssenariy va postlar shu material bilan tayyorlanadi." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {items.map((m) => (
            <MediaCard key={m.id} canEdit={canEdit} m={{ id: m.id, kind: m.kind, title: m.title, tags: m.tags, sizeMb: (m.size / 1048576).toFixed(1), used: m._count.contents, by: m.uploadedBy }} />
          ))}
        </div>
      )}
    </div>
  );
}
