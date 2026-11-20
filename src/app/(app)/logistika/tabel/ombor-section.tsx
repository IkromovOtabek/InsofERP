import { Fragment } from "react";
import Link from "next/link";
import { PackageOpen, Truck, Users, Warehouse } from "lucide-react";
import { Badge, Card, CardHeader, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { dispatcherHeldCount, driverStock, type DriverStockHolder } from "@/lib/driver-stock";
import { date, dateTime, fmtNum, money } from "@/lib/format";
import { unitShort } from "@/lib/unit";

const qtyText = (q: number, unit: string) => `${fmtNum(q, 3)} ${unitShort(unit)}`;

/** Bir guruh (haydovchi yoki transport): sarlavha qatori + narsalar. */
function HolderRows({ h, filterHref }: { h: DriverStockHolder; filterHref: string | null }) {
  return (
    <Fragment>
      <Tr className="bg-slate-50">
        <Td colSpan={4} className="py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {h.kind === "driver" ? (
              <>
                {h.sub && <Badge color="blue" dot={false}>{h.sub}</Badge>}
                <span className="font-semibold text-slate-900">{h.name}</span>
              </>
            ) : (
              <>
                <Badge color="blue" dot={false}>{h.name}</Badge>
                <span className="text-slate-600">{h.sub ?? "haydovchi biriktirilmagan"}</span>
              </>
            )}
            {!h.active && <Badge color="slate">{h.kind === "driver" ? "ishlamaydi" : "nofaol"}</Badge>}
            <span className="text-xs text-slate-500">{h.items.length} xil</span>
            {filterHref && <Link href={filterHref} className="ml-auto text-xs text-blue-700 hover:underline">Faqat shu haydovchi</Link>}
          </div>
        </Td>
      </Tr>
      {h.items.map((x) => (
        <Tr key={`${h.key}|${x.materialId}`}>
          <Td className="pl-8 text-sm">{x.name}</Td>
          <Td right className={x.month < 0 ? "text-red-600" : x.month ? "font-medium" : "text-slate-400"}>{x.month ? qtyText(x.month, x.unit) : "—"}</Td>
          <Td right className="font-semibold">{qtyText(x.total, x.unit)}</Td>
          <Td className="whitespace-nowrap text-sm text-slate-600">{x.last ? date(x.last) : "—"}</Td>
        </Tr>
      ))}
    </Fragment>
  );
}

/**
 * Haydovchilar tabeli → «Ombor»: skladdan haydovchilarga va o'z transportimizga berilgan narsalar — kimda nima bor
 * (barcha vaqt va tanlangan oy) va oyning berish jurnali (`lib/driver-stock.ts`). Summalar — faqat `showMoney`.
 */
export async function OmborSection({ from, to, title, driverId, showMoney, monthNav, driverHref, dispatchHref }: {
  from: Date; to: Date; title: string; driverId: string | null; showMoney: boolean; monthNav: React.ReactNode;
  /** «Faqat shu haydovchi» havolasi (haydovchi id → URL) */
  driverHref: (id: string) => string;
  /** Dispetcher ombori sahifasi — ochiq bo'lsa */
  dispatchHref: string | null;
}) {
  const [{ drivers, vehicles, journal }, held] = await Promise.all([driverStock({ from, to, driverId }), dispatcherHeldCount()]);
  const picked = driverId ? drivers.find((d) => d.id === driverId) ?? null : null;
  const kinds = new Set(drivers.flatMap((d) => d.items.map((x) => x.materialId)));
  const live = journal.filter((j) => !j.cancelled);
  const sum = live.reduce((a, j) => a + (j.sum ?? 0), 0);
  return (
    <Section title={`Ombor: ${picked ? `${picked.name} — ` : ""}${title}`} className="mt-0" action={monthNav} info={<>
      <p>Skladdan haydovchiga berilgan narsalar: Sklad → Chiqim → «Kimga» → <b>Haydovchilar</b> (mashina raqami va F.I.O.). Avto zapchast mashinaga berilsa — «Transportlarga» bo&apos;limida.</p>
      <p className="mt-2">Berilgan narsa sarf hisoblanadi (skladga qaytmaydi): «Jami» — barcha vaqt olgani, «Shu oy» — tanlangan oyda. Bekor qilingan chiqim ayirib tashlanadi.</p>
      <p className="mt-2">Yangi chiqim yozilsa dispetcherga bildirishnoma keladi.</p>
    </>}>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Haydovchilarda" value={drivers.length} hint={`${kinds.size} xil narsa`} icon={Users} tone="info" />
        <StatCard label="Transportlarda" value={vehicles.length} hint="avto zapchast" icon={Truck} />
        <StatCard label="Shu oy berildi" value={live.length} hint={showMoney && sum ? money(sum) : `${journal.length - live.length} ta bekor qilingan`} icon={PackageOpen} tone="success" />
        <StatCard label="Dispetcher omborida" value={held} hint="xil narsa (o'ziga olgan)" icon={Warehouse} {...(dispatchHref ? { href: dispatchHref } : {})} />
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5"><CardHeader title="Kimda nima bor — haydovchilar" icon={Users} /></div>
        {drivers.length === 0 ? <Empty text="Skladdan haydovchilarga hali hech narsa berilmagan" /> : (
          <Table>
            <thead><tr><Th>Nima</Th><Th right>Shu oy</Th><Th right>Jami</Th><Th>Oxirgi olgan</Th></tr></thead>
            <tbody>{drivers.map((h) => <HolderRows key={h.key} h={h} filterHref={driverId ? null : driverHref(h.id)} />)}</tbody>
          </Table>
        )}
      </Card>

      {vehicles.length > 0 && <Card padded={false} className="mt-4">
        <div className="px-5 pt-5"><CardHeader title="Transportlarga berilgan" icon={Truck} info="Sklad → Chiqim → «Avto zapchast» → transport. Summasi Logistika moliyada chiqim bo'ladi" /></div>
        <Table>
          <thead><tr><Th>Nima</Th><Th right>Shu oy</Th><Th right>Jami</Th><Th>Oxirgi olgan</Th></tr></thead>
          <tbody>{vehicles.map((h) => <HolderRows key={h.key} h={h} filterHref={null} />)}</tbody>
        </Table>
      </Card>}

      <Card padded={false} className="mt-4">
        <div className="px-5 pt-5"><CardHeader title={`Skladdan berilganlar — ${title}`} icon={PackageOpen} /></div>
        {journal.length === 0 ? <Empty text="Bu oyda haydovchi va transportlarga chiqim yo'q" /> : (
          <Table>
            <thead><tr><Th>Sana</Th><Th>Kimga</Th><Th>Nima</Th><Th right>Miqdor</Th>{showMoney && <Th right>Summa</Th>}<Th>Sklad</Th><Th>Kim berdi</Th><Th>Izoh</Th></tr></thead>
            <tbody>
              {journal.map((j) => (
                <Tr key={j.id} className={j.cancelled ? "text-slate-400" : undefined}>
                  <Td className="whitespace-nowrap text-sm">{dateTime(j.at)}</Td>
                  <Td className="text-sm">
                    {j.kind === "driver"
                      ? <><span className="font-medium">{j.name}</span>{j.sub && <div className="text-xs text-slate-500">{j.sub}</div>}</>
                      : <><span className="font-medium">{j.name}</span><div className="text-xs text-slate-500">transport{j.sub ? ` · ${j.sub}` : ""}</div></>}
                  </Td>
                  <Td className={`text-sm ${j.cancelled ? "line-through" : ""}`}>{j.material}</Td>
                  <Td right className={j.cancelled ? "line-through" : "font-semibold"}>{qtyText(j.qty, j.unit)}</Td>
                  {showMoney && <Td right className={j.cancelled ? "line-through" : undefined}>{j.sum != null ? money(j.sum) : "—"}</Td>}
                  <Td className="text-sm">{j.warehouse}</Td>
                  <Td className="text-sm">{j.by}</Td>
                  <Td className="max-w-56 text-sm text-slate-600">
                    {j.cancelled && <Badge color="red">Bekor qilingan</Badge>}
                    {j.auto && <Badge color="slate" dot={false}>kirim bilan</Badge>}
                    {j.note && <div className="truncate">{j.note}</div>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </Section>
  );
}
