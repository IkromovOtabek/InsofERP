import Link from "next/link";
import { CheckCheck, FilePen, PackageCheck, Plus, Truck } from "lucide-react";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, money } from "@/lib/format";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { listShipments, shipmentCounts, SHIPMENT_STATUS_COLOR, SHIPMENT_STATUS_LABEL, SHIPMENT_TABS, type ShipmentTab } from "@/lib/shipments";
import { Badge, Empty, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";

/**
 * Jo'natmalar: snabjenets olib kelgan molni nakladnoy qilib skladga jo'natadi, sklad tekshirib qabul qiladi.
 * Snabjenets faqat o'zinikini, sklad — hammasini (qoralamalarsiz) ko'radi.
 */
export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const s = await requireRoles(["PROCUREMENT", "WAREHOUSE"], { module: "stock" });
  const sp = await searchParams;
  const canSend = canDo(s, "stock", "shipment");
  const canAccept = canDo(s, "stock", "shipment_accept");
  const tab = (SHIPMENT_TABS.some((t) => t.key === sp.tab) ? sp.tab : "open") as ShipmentTab;
  const q = (sp.q ?? "").trim().slice(0, 80) || undefined;
  const viewer = { userId: s.userId, role: s.role };
  const [rows, counts] = await Promise.all([listShipments(tab, viewer, { q }), shipmentCounts(viewer)]);
  const procurement = s.role === "PROCUREMENT";

  return (
    <div>
      <PageHeader
        title={procurement ? "Mening jo'natmalarim" : "Jo'natmalar"}
        subtitle={procurement
          ? "Olib kelgan mahsulotlar nakladnoyini kiriting va skladga jo'nating. Sklad qabul qilganda xabar olasiz."
          : "Snabjeniye olib kelgan mahsulotlar. Tekshirib, hammasini yoki belgilaganlaringizni qabul qiling — skladga kirim bo'lib tushadi."}
        action={canSend ? <LinkButton href="/jonatma/new"><Plus size={16} /> Yangi jo&apos;natma</LinkButton> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Qabul kutmoqda" value={`${counts.open} ta`} hint={canAccept ? "Skladda tekshirilishi kerak" : "Sklad hali ko'rmagan"} icon={Truck} tone={counts.open ? "warning" : "default"} href="/jonatma?tab=open" />
        <StatCard label="Qoralamalar" value={`${counts.draft} ta`} hint="Skladga yuborilmagan" icon={FilePen} href="/jonatma?tab=draft" />
        <StatCard label="Yakunlangan" value={`${counts.done} ta`} icon={CheckCheck} tone="success" href="/jonatma?tab=done" />
        <StatCard label="Jami" value={`${counts.all} ta`} icon={PackageCheck} href="/jonatma?tab=all" />
      </div>

      <form className="mb-3 flex gap-2" action="/jonatma">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={q} placeholder="№, nakladnoy, yetkazuvchi yoki mahsulot…" className="h-10 w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 text-sm" />
      </form>

      <Tabs current={tab} items={SHIPMENT_TABS.map((t) => ({ key: t.key, label: t.label, href: `/jonatma?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`, count: counts[t.key] }))} />

      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Yetkazuvchi</Th><Th>Tarkib</Th><Th right>Summa</Th><Th>Holat</Th>{!procurement && <Th>Snabjenets</Th>}</tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text={tab === "open" ? "Qabul kutayotgan jo'natma yo'q" : "Jo'natma topilmadi"} icon={Truck} />}
          {rows.map((r) => (
            <Tr key={r.id} className={r.status === "SENT" && canAccept ? "bg-amber-50/60" : undefined}>
              <Td>
                <Link href={`/jonatma/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link>
                {r.waybillNo && <div className="text-xs text-slate-500">Nakl. № {r.waybillNo}</div>}
              </Td>
              <Td>{date(r.date)}</Td>
              <Td className="text-slate-600">{r.supplier}</Td>
              <Td className="text-slate-600">
                {r.lines} qator
                <div className="mt-1 flex flex-wrap gap-1">{r.categories.map((c) => <Badge key={c} color="slate" dot={false}>{MATERIAL_CATEGORY_LABEL[c]}</Badge>)}</div>
              </Td>
              <Td right>{money(r.total)}</Td>
              <Td>
                <Badge color={SHIPMENT_STATUS_COLOR[r.status]}>{SHIPMENT_STATUS_LABEL[r.status]}</Badge>
                {(r.accepted > 0 || r.rejected > 0) && (
                  <div className="mt-1 text-xs text-slate-500">
                    {r.accepted > 0 && <span className="text-emerald-700">{r.accepted} qabul</span>}
                    {r.rejected > 0 && <span className="text-red-600"> · {r.rejected} rad</span>}
                    {r.pending > 0 && <span> · {r.pending} kutmoqda</span>}
                  </div>
                )}
              </Td>
              {!procurement && <Td className="text-slate-600">{r.by}</Td>}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
