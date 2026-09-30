import Link from "next/link";
import { AlertTriangle, Clock, PackageCheck, ShoppingCart, Store, XCircle } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { procurementReport } from "@/lib/procurement-report";
import { INCIDENT_LABEL } from "@/lib/procurement-const";
import { money, moneyShort, qty, fmtNum, isoDate } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, Input, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

/** Snabjeniye hisoboti — xaridlar, sarf, yetkazib berish, kechikish, yetkazib beruvchilar (davr bo'yicha). */
export default async function ProcurementReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const sp = await searchParams;
  const d = await procurementReport(sp);
  const t = d.totals;

  return (
    <div>
      <PageHeader back={{ href: "/snabjeniye", label: "Snabjeniye" }} title="Snabjeniye hisoboti"
        subtitle="Xaridlar, sarf, yetkazib berish muddati, kechikishlar va yetkazib beruvchilar" action={<PrintButton />} />

      <form method="get" className="mb-5 flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-xs text-slate-500">Sanadan<Input type="date" name="from" defaultValue={isoDate(d.from)} className="mt-1 w-44" /></label>
        <label className="text-xs text-slate-500">Sanagacha<Input type="date" name="to" defaultValue={isoDate(d.to)} className="mt-1 w-44" /></label>
        <button className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="Xarid summasi" value={`${moneyShort(t.purchase)} so'm`} hint="kirim hujjatlari bo'yicha" icon={ShoppingCart} tone="brand" />
        <StatCard label="Talablar" value={`${t.requests} ta`} hint={`${t.done} bajarildi · ${t.rejected} bekor`} icon={PackageCheck} tone="info" />
        <StatCard label="O'rtacha yetkazish" value={t.avgLead == null ? "—" : `${fmtNum(t.avgLead, 1)} kun`} hint="talabdan kirimgacha" icon={Clock} tone={t.avgLead != null && t.avgLead > 5 ? "warning" : "success"} />
        <StatCard label="Kechikkan xaridlar" value={`${t.lateCount} ta`} hint="kerak sana / ETA dan keyin keldi" icon={AlertTriangle} tone={t.lateCount ? "danger" : "success"} />
        <StatCard label="Muammolar" value={`${t.incidents} ta`} hint="davrda qayd qilingan" icon={XCircle} tone={t.incidents ? "warning" : "success"} />
      </div>

      <Section title="Yetkazib beruvchilar">
        <Table>
          <thead><tr><Th>Yetkazuvchi</Th><Th right>Xarid summasi</Th><Th right>Kirimlar</Th><Th right>Ta&apos;minot buyurtmalari</Th><Th right>O&apos;rtacha muddat</Th><Th right>Kechikish</Th><Th right>Muammo</Th></tr></thead>
          <tbody>
            {d.suppliers.length === 0 && <Empty text="Davrda xarid yo'q" icon={Store} />}
            {d.suppliers.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium">{s.name}</Td>
                <Td right>{money(s.sum)}</Td>
                <Td right className="text-slate-500">{s.receipts}</Td>
                <Td right className="text-slate-500">{s.orders}</Td>
                <Td right>{s.avgLead == null ? "—" : `${fmtNum(s.avgLead, 1)} kun`}</Td>
                <Td right>{s.late ? <Badge color="red">{s.late}</Badge> : <span className="text-slate-400">—</span>}</Td>
                <Td right>{s.incidents ? <Badge color="amber">{s.incidents}</Badge> : <span className="text-slate-400">—</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Materiallar: xarid va sarf">
        <Table>
          <thead><tr><Th>Material</Th><Th right>Sotib olindi</Th><Th right>Summa</Th><Th right>O&apos;rtacha narx</Th><Th right>Ishlab chiqarishda sarf</Th></tr></thead>
          <tbody>
            {d.materials.length === 0 && <Empty text="Davrda harakat yo'q" icon={PackageCheck} />}
            {d.materials.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium">{m.name}</Td>
                <Td right>{m.qty ? `${qty(m.qty)} ${m.unit}` : "—"}</Td>
                <Td right>{m.sum ? money(m.sum) : "—"}</Td>
                <Td right className="text-slate-500">{m.avgPrice == null ? "—" : money(m.avgPrice)}</Td>
                <Td right className={m.used > m.qty && m.qty > 0 ? "font-medium text-amber-700" : ""}>{m.used ? `${qty(m.used)} ${m.unit}` : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Bo'limlar bo'yicha talablar" />
          <Table>
            <thead><tr><Th>Bo&apos;lim</Th><Th right>Talab</Th><Th right>Bajarildi</Th><Th right>Kritik</Th></tr></thead>
            <tbody>
              {d.departments.length === 0 && <Empty text="Talab yo'q" />}
              {d.departments.map((x) => <Tr key={x.name}><Td>{x.name}</Td><Td right>{x.count}</Td><Td right>{x.done}</Td><Td right>{x.critical || "—"}</Td></Tr>)}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Muammolar turi bo'yicha" />
          <Table>
            <thead><tr><Th>Turi</Th><Th right>Jami</Th><Th right>Ochiq</Th></tr></thead>
            <tbody>
              {d.incidents.length === 0 && <Empty text="Muammo yo'q" />}
              {d.incidents.map((x) => <Tr key={x.kind}><Td>{INCIDENT_LABEL[x.kind]}</Td><Td right>{x.total}</Td><Td right className={x.open ? "font-semibold text-red-600" : ""}>{x.open}</Td></Tr>)}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Eng ko'p kechikkanlar" />
          <Table>
            <thead><tr><Th>№</Th><Th>Yetkazuvchi</Th><Th right>Kechikish</Th></tr></thead>
            <tbody>
              {d.late.length === 0 && <Empty text="Kechikish yo'q" />}
              {d.late.map((x) => <Tr key={x.id}><Td><Link href={`/taminot/${x.id}`} className="font-medium hover:underline">{x.docNo}</Link></Td><Td className="text-slate-600">{x.supplier}</Td><Td right className="font-semibold text-red-600">{x.late} kun</Td></Tr>)}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
