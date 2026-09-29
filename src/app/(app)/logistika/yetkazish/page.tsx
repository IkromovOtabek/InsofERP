import Link from "next/link";
import { PackageCheck, PackageX, Scale, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ISSUE_KIND, tripPhase } from "@/lib/logistics";
import { dateTime, qty } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { PeriodTabs, PhaseBadge, periodRange, RangeForm } from "../ui";

export const dynamic = "force-dynamic";

/**
 * Yetkazib berish moduli (TZ 11): yuklangan / yetkazilgan / qabul qilingan / qaytarilgan miqdor,
 * muammo va qabul qiluvchi tasdig'i. "Yopilmagan" — yetkazilgan, lekin qabul hali tasdiqlanmagan reyslar.
 */
export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; tab?: string }> }) {
  await requireSession(["LOGISTICS", "ACCOUNTING"]);
  const sp = await searchParams;
  const r = periodRange(sp, "week");
  const tab = sp.tab ?? "";
  const trips = await db.trip.findMany({
    where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } },
    include: {
      order: { select: { orderNo: true, customer: { select: { name: true } }, items: { select: { product: { select: { unit: true } } } } } },
      vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, issues: true,
    },
    orderBy: { deliveredAt: "desc" },
  });
  const accepted = (t: (typeof trips)[number]) => Number(t.acceptedQty ?? t.qtyM3);
  const loaded = trips.reduce((a, t) => a + Number(t.qtyM3), 0);
  const acc = trips.reduce((a, t) => a + accepted(t), 0);
  const ret = trips.reduce((a, t) => a + Number(t.returnedQty ?? 0), 0);
  const diff = trips.filter((t) => Math.abs(Number(t.qtyM3) - accepted(t)) > 0.001 || Number(t.returnedQty ?? 0) > 0);
  const open = trips.filter((t) => !t.closedAt);
  const shown = tab === "open" ? open : tab === "diff" ? diff : tab === "issues" ? trips.filter((t) => t.issues.length) : trips;
  const extra = `period=${r.period}${sp.from ? `&from=${sp.from}&to=${sp.to}` : ""}`;

  return (
    <div>
      <PageHeader title="Yetkazib berish" subtitle={`${r.label}: yuklangan va qabul qilingan miqdor, qaytgan beton, muammolar`} />
      <PeriodTabs base="/logistika/yetkazish" current={r.period} />
      <RangeForm base="/logistika/yetkazish" from={r.from} to={r.to} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Yuklangan" value={qty(loaded)} hint={`${trips.length} reys`} icon={PackageCheck} tone="brand" />
        <StatCard label="Qabul qilingan" value={qty(acc)} hint={loaded ? `${((acc / loaded) * 100).toFixed(1)}%` : undefined} icon={Scale} tone="success" />
        <StatCard label="Qaytarilgan" value={qty(ret)} hint={`${diff.length} reysda farq`} icon={Undo2} tone={ret ? "warning" : "default"} />
        <StatCard label="Yopilmagan" value={open.length} hint="qabul tasdig'i kutilmoqda" icon={PackageX} tone={open.length ? "warning" : "default"} href={`/logistika/yetkazish?${extra}&tab=open`} />
      </div>
      <Tabs current={tab} items={[
        { key: "", label: "Hammasi", href: `/logistika/yetkazish?${extra}`, count: trips.length },
        { key: "open", label: "Yopilmagan", href: `/logistika/yetkazish?${extra}&tab=open`, count: open.length },
        { key: "diff", label: "Farq bor", href: `/logistika/yetkazish?${extra}&tab=diff`, count: diff.length },
        { key: "issues", label: "Muammoli", href: `/logistika/yetkazish?${extra}&tab=issues`, count: trips.filter((t) => t.issues.length).length },
      ]} />
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Mijoz</Th><Th>Transport</Th><Th right>Yuklangan</Th><Th right>Qabul</Th><Th right>Qaytgan</Th><Th>Qabul qiluvchi</Th><Th>Muammo / izoh</Th><Th>Holat</Th><Th>Yetkazildi</Th></tr></thead>
          <tbody>
            {shown.length === 0 && <Empty text="Bu davrda yetkazish yo'q" />}
            {shown.map((t) => {
              const a = accepted(t);
              const short = Number(t.qtyM3) - a > 0.001;
              return (
                <Tr key={t.id}>
                  <Td><Link href={`/trips/${t.id}`} className="font-medium tabular hover:underline">{t.deliveryNoteNo}</Link><div className="text-xs text-slate-500">{t.order.orderNo}</div></Td>
                  <Td className="text-sm">{t.order.customer.name}</Td>
                  <Td className="text-sm"><span className="tabular">{t.vehicle.plate}</span><div className="text-xs text-slate-500">{t.driver.fullName}</div></Td>
                  <Td right className="tabular">{qty(t.qtyM3)}</Td>
                  <Td right className={`tabular ${short ? "font-medium text-amber-700" : ""}`}>{t.acceptedQty != null ? qty(t.acceptedQty) : <span className="text-slate-400">{qty(t.qtyM3)}</span>}</Td>
                  <Td right className="tabular">{t.returnedQty ? qty(t.returnedQty) : "—"}</Td>
                  <Td className="text-sm">{t.receiverName ?? "—"}</Td>
                  <Td className="max-w-[16rem] text-xs">
                    {t.issues.map((i) => <div key={i.id} className={i.resolvedAt ? "text-slate-500" : "text-red-700"}>{ISSUE_KIND[i.kind]}{i.note ? `: ${i.note}` : ""}</div>)}
                    {t.deliveryComment && <div className="text-slate-600">{t.deliveryComment}</div>}
                  </Td>
                  <Td>{t.closedAt ? <PhaseBadge phase={tripPhase(t)} /> : <Badge color="amber">yopilmagan</Badge>}</Td>
                  <Td className="text-xs tabular">{t.deliveredAt ? dateTime(t.deliveredAt) : "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Qabul miqdori kiritilmagan bo'lsa — yuklangan miqdor olinadi (kulrang). Reysni yopish va miqdorni tuzatish — reys kartasida.</p>
    </div>
  );
}
