import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Car, Fuel, PackageOpen, Truck, Undo2 } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { DISPATCH_WH, DISPATCH_WH_NAME, dispatcherMoves, dispatcherStock } from "@/lib/dispatcher-stock";
import { driverEmployees, mainDriverOf } from "@/lib/logistics";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { dateTime, fmtNum, money, moneyShort } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { DayRangeBar, parseDayRange } from "@/app/(app)/bi-tahlil/month-bar";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelIssueAction } from "./actions";
import { IssueForm, PickForm, type PickRow } from "./forms";

export const dynamic = "force-dynamic";

const BASE = "/stock/dispetcher";
const KIND: Record<string, { label: string; color: "blue" | "slate" | "amber" | "green" | "red" }> = {
  take: { label: "Skladdan olindi", color: "blue" },
  return: { label: "Skladga qaytarildi", color: "slate" },
  fuel: { label: "Zapravka", color: "amber" },
  part: { label: "Zapchast", color: "green" },
  storno: { label: "Bekor qilindi", color: "red" },
};

/**
 * Dispetcher ombori (`lib/dispatcher-stock.ts`): skladdagi avto zapchast va yoqilg'i — dispetcher ko'radi, lekin qo'sha olmaydi;
 * keraklisini tanlab, miqdorini yozib o'ziga oladi, mashinaga beradi (yoqilg'i — zapravka, zapchast — transport xarajati),
 * ortganini skladga qaytaradi. Amallar — `stock` → `dispatch` (dispetcher); sklad, ish boshqaruvchi va mexanik faqat ko'radi.
 */
export default async function DispatcherStockPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage(BASE);
  const sp = await searchParams;
  const can = canDo(s, "stock", "dispatch");
  const period = parseDayRange(sp);
  const [{ warehouses, rows }, moves, vehicles, drivers] = await Promise.all([
    dispatcherStock(),
    dispatcherMoves(period.from, period.to),
    can ? db.vehicle.findMany({
      where: { isActive: true, hiddenAt: null }, orderBy: [{ external: "asc" }, { plate: "asc" }],
      select: { id: true, plate: true, external: true, mainDriverId: true, drivers: { where: { isActive: true }, select: { id: true } } },
    }) : Promise.resolve([]),
    can ? driverEmployees({ activeOnly: true }) : Promise.resolve([]),
  ]);

  const held = rows.filter((r) => r.held > 0.0005);
  const inStock = rows.filter((r) => r.inStock > 0.0005);
  const heldSum = held.reduce((a, r) => a + r.held * (r.price ?? 0), 0);
  const issued = moves.filter((m) => (m.kind === "fuel" || m.kind === "part") && !m.cancelled);
  const issuedSum = issued.reduce((a, m) => a + (m.sum ?? 0), 0);
  const fuelOut = new Map<string, number>();
  for (const m of issued.filter((x) => x.kind === "fuel")) fuelOut.set(unitLabel(m.unit), (fuelOut.get(unitLabel(m.unit)) ?? 0) + m.qty);
  const pick = (r: (typeof rows)[number], avail: number): PickRow => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, fuel: !!r.fuel, category: r.category, price: r.price, avail, byWh: r.byWh });

  return (
    <div>
      <PageHeader back={{ href: "/stock", label: "Sklad" }} title={DISPATCH_WH_NAME}
        subtitle="Skladdagi avto zapchast va yoqilg'i: keraklisini o'zingizga olasiz, mashinaga berasiz — yoqilg'i zapravka, zapchast transport xarajati bo'lib yoziladi. Skladga yangi mahsulot qo'shilmaydi." />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Dispetcherda" value={moneyShort(heldSum)} hint={`${held.length} xil mahsulot`} icon={PackageOpen} tone="brand" />
        <StatCard label="Skladda (avto zapchast, yoqilg'i)" value={inStock.length} hint="olish mumkin bo'lgan xillar" icon={Car} href={`/stock?tab=balance&wh=${DISPATCH_WH}`} />
        <StatCard label="Mashinalarga berildi" value={moneyShort(issuedSum)} hint={`${issued.length} ta · ${period.label}`} icon={Truck} tone="success" />
        <StatCard label="Yoqilg'i berildi" value={[...fuelOut].map(([u, q]) => `${fmtNum(q, 0)} ${u}`).join(" + ") || "—"} hint={period.label} icon={Fuel} tone="warning" />
      </div>

      {!can && <Callout tone="info" title="Faqat ko'rish">Olish, mashinaga berish va qaytarish — dispetcher (Sklad → «Dispetcher ombori» ruxsati).</Callout>}

      {can && (
        <Card className="mb-5">
          <CardHeader title="Mashinaga berish" icon={Truck} description="Qo'lingizdagi mahsulotdan: yoqilg'i — shu mashinaga zapravka (hisob varag'i va yoqilg'i qoldig'iga tushadi), zapchast — transport xarajati. Narx skladdagi «Dona narxi» bo'yicha." />
          <IssueForm held={held.map((r) => pick(r, r.held))} drivers={drivers.map((d) => ({ id: d.id, label: d.fullName }))}
            vehicles={vehicles.map((v) => ({ id: v.id, label: `${v.plate}${v.external ? " (ko'chadan)" : ""}`, driverId: mainDriverOf(v)?.id ?? null }))} />
        </Card>
      )}

      <Section title="Mening qo'limdagi">
        {held.length === 0 ? <Card><Empty text="Dispetcher omborida hozir hech narsa yo'q" icon={PackageOpen} /></Card> : (
          <Table>
            <thead><tr><Th>Mahsulot</Th><Th>Kategoriya</Th><Th right>Qoldiq</Th><Th right>Narx</Th><Th right>Summa</Th></tr></thead>
            <tbody>
              {held.map((r) => (
                <Tr key={r.id}>
                  <Td><span className="font-medium">{r.name}</span> <span className="text-xs text-slate-400">{r.code}</span>{r.fuel && <span className="ml-1.5"><Badge color="amber" dot={false}>yoqilg&apos;i</Badge></span>}</Td>
                  <Td className="text-sm text-slate-600">{MATERIAL_CATEGORY_LABEL[r.category as keyof typeof MATERIAL_CATEGORY_LABEL] ?? r.category}</Td>
                  <Td right className="font-semibold">{fmtNum(r.held, 3)} {unitLabel(r.unit)}</Td>
                  <Td right>{r.price != null ? money(r.price) : <span className="text-amber-700">narx yo&apos;q</span>}</Td>
                  <Td right>{r.price != null ? money(r.held * r.price) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {can && held.length > 0 && (
          <details className="mt-3 rounded-(--radius-card) border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700"><Undo2 size={14} className="mr-1 inline" aria-hidden />Ortganini skladga qaytarish</summary>
            <div className="mt-3"><PickForm mode="return" rows={held.map((r) => pick(r, r.held))} warehouses={warehouses.map((w) => ({ id: w.id, label: w.name }))} /></div>
          </details>
        )}
      </Section>

      <Section title="Skladdagi avto zapchast va yoqilg'i">
        {can ? (
          <Card>
            <CardHeader title="O'zimga olish" icon={ArrowDownToLine} description="Keraklisini belgilab miqdorini yozing («Hammasi» — skladdagining hammasi, masalan salyarka). Skladdan kamayib, dispetcher omboriga o'tadi; sarf emas — mashinaga berilganda sarf bo'ladi." />
            <PickForm mode="take" rows={rows.filter((r) => r.inStock > 0.0005 || r.held > 0.0005).map((r) => pick(r, r.inStock))} warehouses={warehouses.map((w) => ({ id: w.id, label: w.name }))} />
          </Card>
        ) : (
          <Table>
            <thead><tr><Th>Mahsulot</Th><Th>Kategoriya</Th><Th right>Skladda</Th><Th right>Dispetcherda</Th></tr></thead>
            <tbody>
              {inStock.length === 0 && <Empty text="Skladda avto zapchast yoki yoqilg'i yo'q" icon={Car} />}
              {inStock.map((r) => (
                <Tr key={r.id}>
                  <Td><span className="font-medium">{r.name}</span> <span className="text-xs text-slate-400">{r.code}</span></Td>
                  <Td className="text-sm text-slate-600">{MATERIAL_CATEGORY_LABEL[r.category as keyof typeof MATERIAL_CATEGORY_LABEL] ?? r.category}</Td>
                  <Td right>{fmtNum(r.inStock, 3)} {unitLabel(r.unit)}</Td>
                  <Td right>{r.held ? `${fmtNum(r.held, 3)} ${unitLabel(r.unit)}` : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title={`Harakatlar — ${period.label}`}>
        <DayRangeBar base={BASE} range={period} />
        {moves.length === 0 ? <Card><Empty text="Bu davrda harakat yo'q" icon={ArrowUpFromLine} /></Card> : (
          <Table>
            <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th right>Summa</Th><Th>Mashina / sklad</Th><Th>Kim</Th><Th>Izoh</Th>{can && <Th />}</tr></thead>
            <tbody>
              {moves.map((m) => (
                <Tr key={m.id} className={m.cancelled ? "opacity-60" : undefined}>
                  <Td className="whitespace-nowrap tabular">{dateTime(m.at)}</Td>
                  <Td><Badge color={KIND[m.kind]!.color}>{KIND[m.kind]!.label}</Badge>{m.cancelled && m.kind !== "storno" && <div className="text-[11px] text-slate-500">bekor qilingan</div>}</Td>
                  <Td>{m.material}</Td>
                  <Td right>{fmtNum(m.qty, 3)} {unitLabel(m.unit)}</Td>
                  <Td right>{m.sum != null ? money(m.sum) : "—"}</Td>
                  <Td className="whitespace-nowrap">{m.plate ? <span className="font-medium tabular">{m.plate}</span> : m.warehouse ?? "—"}{m.who && <div className="text-xs text-slate-500">{m.who}</div>}</Td>
                  <Td className="text-sm text-slate-600">{m.by}</Td>
                  <Td className="max-w-64 truncate text-xs text-slate-500">{m.note ?? ""}</Td>
                  {can && <Td>{m.cancelRef && (
                    <ConfirmButton action={cancelIssueAction.bind(null, m.cancelRef)} reason="required" label="" title="Bekor qilish" icon={<Undo2 size={14} />}
                      question={`${m.material} (${fmtNum(m.qty, 3)} ${unitLabel(m.unit)}, ${m.plate ?? ""}) berish bekor qilinsinmi? ${m.kind === "fuel" ? "Zapravka" : "Xarajat"} bekor bo'ladi, mol dispetcher omboriga qaytadi.`}
                      okText="Bekor qilindi" className="h-7 px-1.5" />
                  )}</Td>}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-slate-500">Mashinaga berilgani — <Link href="/logistika/tabel?bolim=hisob" className="text-blue-700 hover:underline">Hisob varag&apos;i</Link> (zapravka, zapchast ustunlari) va Transport kartasida ko&apos;rinadi.</p>
      </Section>
    </div>
  );
}
