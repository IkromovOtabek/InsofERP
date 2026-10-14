import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { isoDate } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { ContentForm, EMPTY_CONTENT } from "../content-form";

export default async function ContentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/marketing/kontent");
  const { id } = await params;
  const item = id === "new" ? null : await db.marketingContent.findUnique({ where: { id } });
  if (id !== "new" && !item) notFound();

  const v = item
    ? {
        title: item.title, type: item.type, rubric: item.rubric ?? "", status: item.status,
        // @db.Date UTC yarim tunda saqlanadi — sana UTC bo'yicha olinadi
        publishDate: item.publishDate ? item.publishDate.toISOString().slice(0, 10) : "",
        hook: item.hook ?? "", script: item.script ?? "", caption: item.caption ?? "", url: item.url ?? "",
        views: item.views, likes: item.likes, saves: item.saves, leads: item.leads,
      }
    : { ...EMPTY_CONTENT, publishDate: isoDate() };

  return (
    <div>
      <PageHeader
        back={{ href: "/marketing/kontent", label: "Kontent reja" }}
        title={item ? item.title : "Yangi kontent"}
        subtitle={item?.createdBy ? `Muallif: ${item.createdBy}` : undefined}
      />
      <Card><ContentForm id={item?.id ?? null} v={v} canEdit={canDo(s, "marketing", "content")} /></Card>
    </div>
  );
}
