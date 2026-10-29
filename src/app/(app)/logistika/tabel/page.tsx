import Link from "next/link";
import { BellRing, Calculator, ChevronLeft, ChevronRight, Coins, FileSpreadsheet, Fuel, Route, Settings2, ShieldCheck, Timer, Users, Wrench } from "lucide-react";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { normMonth } from "@/lib/attendance-report";
import { monthTitle, shiftMonth, today } from "@/lib/davomat";
import { driverTariff, fuelNormText, PAY_TYPE_LABEL, payTrips, pendingApprovalWhere, tariffSet, unpricedWhere, type PayTripRow } from "@/lib/driver-trip-pay";
import { MASTER_PROBLEMS, MECH_STATUS_COLOR, MECH_STATUS_LABEL } from "@/lib/mechanic-requests";
import { driverLedger, fuelBalances } from "@/lib/driver-ledger";
import { date, dateTime, fmtNum, isoDate, money } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, Empty, PageHeader, Section, Select, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { AllCheck, ApproveButton, MasterPayForm, PriceAllButton, PriceForm, RejectPayForm, RowCheck, Selectable, TariffForm, TopRows } from "./tabel-forms";
import { LedgerSheet } from "./ledger-sheet";

export const dynamic = "force-dynamic";

const hours = (min: number | null) => (min == null ? "—" : min < 60 ? `${min} daq` : `${fmtNum(min / 60, 1)} soat`);

/** Yoqilg'i qoldig'i: «66,2 m³», manfiy — qizil (norma bo'yicha zapravkadan ko'p sarflangan). */
const Bal = ({ v, unit }: { v: number; unit: string }) => <span className={v < 0 ? "font-semibold text-red-600" : undefined}>{fmtNum(v, 1)} {unit}</span>;
type BalMap = Map<string, { after: number; unit: string }>;

/** Reys haqi holati: to'lov turi va tasdiq / kassa bosqichi; rad etilgani — sababi bilan. */
function PayStatus({ r }: { r: PayTripRow }) {
  if (r.amount == null) return r.rejectReason ? <div className="text-[11px] text-red-600">Rad etildi: {r.rejectReason}</div> : null;
  if (!r.payType) return null;
  const [color, text] = !r.approvedAt ? ["amber", "Tasdiq kutilmoqda"] as const
    : r.payType === "PAYROLL" ? ["green", "Oylikka tasdiqlangan"] as const
    : r.cashStatus === "PAID" ? ["green", "Kassa berdi"] as const : ["blue", "Kassa kutilmoqda"] as const;
  return <div className="mt-0.5 flex flex-wrap justify-end gap-1"><Badge color="slate" dot={false}>{PAY_TYPE_LABEL[r.payType]}</Badge><Badge color={color}>{text}</Badge></div>;
}

/** Reys qatori — narxsizlar ro'yxati va haydovchi oyi uchun bir xil. */
function TripRows({ rows, canPrice, showDriver, bal, select }: { rows: PayTripRow[]; canPrice: boolean; showDriver: boolean; bal: BalMap; select?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          {select && <Th className="w-10"><AllCheck /></Th>}
          <Th>Sana · nakladnoy</Th>{showDriver && <Th>Haydovchi</Th>}<Th>Obyekt</Th>
          <Th right>Km</Th><Th right>Kutish</Th><Th right>Aylantirish</Th><Th right>Ishladi</Th><Th right>Norma (yoqilg&apos;i)</Th>
          <Th right>Qoldiq (yoqilg&apos;i)</Th><Th right>Taklif</Th><Th right>Narx</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.id}>
            {select && <Td><RowCheck id={r.id} /></Td>}
            <Td className="text-sm"><span className="font-medium tabular">{r.no}</span><div className="text-xs text-slate-500">{dateTime(r.deliveredAt)} · {r.plate}</div></Td>
            {showDriver && <Td className="text-sm"><Link href={`/logistika/tabel?bolim=reyslar&driver=${r.driverId}&oy=${isoDate(r.deliveredAt).slice(0, 7)}`} className="hover:underline">{r.driver}</Link></Td>}
            <Td className="max-w-48 truncate text-sm">{r.customer}</Td>
            <Td right className="tabular">{fmtNum(r.km, 0)}</Td>
            <Td right className="tabular">{r.vehicleType === "MIXER" ? hours(r.waitMin) : "—"}</Td>
            <Td right className="tabular">{r.drumTurns ?? "—"}</Td>
            <Td right className="tabular">{r.workHours != null ? `${fmtNum(r.workHours, 1)} soat` : <span className="text-amber-700">kiritilmagan</span>}</Td>
            <Td right className="tabular">{fuelNormText(r) ?? "—"}</Td>
            <Td right className="tabular">{(() => { const b = bal.get(r.id); return b ? <Bal v={b.after} unit={b.unit} /> : "—"; })()}</Td>
            <Td right className="tabular"><span title={r.suggestText}>{money(r.suggested)}</span><div className="text-[11px] text-slate-400">{r.suggestText}</div></Td>
            <Td right>
              {r.amount != null && <div className="font-semibold tabular">{money(r.amount)}</div>}
              {r.note && <div className="text-[11px] text-slate-500">{r.note}</div>}
              <PayStatus r={r} />
              {/* Naqdi kassaga o'tgan reys narxi o'zgarmaydi */}
              {canPrice && !(r.payType === "CASH" && r.approvedAt) ? <PriceForm tripId={r.id} suggested={r.suggested} amount={r.amount} payType={r.payType} />
                : !canPrice && r.amount == null && <Badge color="amber">Narxsiz</Badge>}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Haydovchilar tabeli (dispetcher): yetkazilgan har reys o'zi tushadi — km, obyektda kutish, mikser aylantirish,
 * ishlagan soat, yoqilg'i normasi va tarif bo'yicha taklif. Dispetcher narx qo'yadi; narxsizlari tepada alohida
 * (har 12 soatda eslatma). Narxlangan reyslar oy yakunida Ish haqi vedomostiga «Reyslar» bo'lib tushadi.
 * «Hisob varag'i» (`?view=hisob`) — dispetcher Excel'i: gaz qoldig'i/zapravka/sarf, xarajatlar, dastavka daromadi, foyda.
 */
/** Sahifa bo'limlari — sarlavha ostidagi bar. Eski havolalar (`?view=hisob`) ham ishlaydi. */
const SECTIONS = ["narxsiz", "tasdiq", "usta", "oy", "reyslar", "hisob", "oylik", "tarif"] as const;
type SectionKey = (typeof SECTIONS)[number];

export default async function DriverTabelPage({ searchParams }: { searchParams: Promise<{ oy?: string; driver?: string; view?: string; bolim?: string; transport?: string }> }) {
  const s = await requireRoles(["LOGISTICS", "DISPATCHER", "SUPERVISOR", "ACCOUNTING"], { module: "logistika" });
  const sp = await searchParams;
  const month = normMonth(sp.oy);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(y!, m! - 1, 1), to = new Date(y!, m!, 1);
  const canPrice = canDo(s, "logistika", "pay");
  const canApprove = canDo(s, "logistika", "pay_approve");
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const bolim: SectionKey = (SECTIONS as readonly string[]).includes(sp.bolim ?? "") ? (sp.bolim as SectionKey)
    : sp.view === "hisob" ? "hisob" : sp.driver ? "reyslar" : "narxsiz";
  const view = bolim === "hisob" ? "hisob" : "tabel";
  const filtered = !!(sp.driver || sp.transport);
  const [unpriced, monthTrips, tariff, full, filteredLedger, monthVehicles, pending, masters, vehicles, payees] = await Promise.all([
    payTrips(unpricedWhere()),
    payTrips({ status: "DELIVERED", deliveredAt: { gte: from, lt: to }, ...(sp.driver ? { driverId: sp.driver } : {}) }, 3000),
    driverTariff(),
    // Yoqilg'i qoldig'i mashina bo'yicha — oyning hamma reysidan (haydovchi filtri qoldiqni buzmasin)
    driverLedger(from, to),
    view === "hisob" && filtered ? driverLedger(from, to, { driverId: sp.driver, vehicleId: sp.transport }) : null,
    view === "hisob"
      ? db.trip.groupBy({ by: ["vehicleId"], where: { status: "DELIVERED", deliveredAt: { gte: from, lt: to }, ...(sp.driver ? { driverId: sp.driver } : {}) } })
        .then((g) => db.vehicle.findMany({ where: { id: { in: g.map((x) => x.vehicleId) } }, select: { id: true, plate: true }, orderBy: { plate: "asc" } }))
      : [],
    payTrips(pendingApprovalWhere()),
    // Usta puli: muddatlilari va ochiqlari hammasi, yopilganlari — oxirgi 30 kun
    db.mechanicRequest.findMany({
      where: { payee: { not: null }, tripId: null, problem: { in: [...MASTER_PROBLEMS] }, OR: [{ status: { in: ["DEFERRED", "NEW", "APPROVED"] } }, { createdAt: { gte: monthAgo } }] },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 60,
      select: { id: true, docNo: true, createdAt: true, payee: true, problem: true, amount: true, status: true, dueAt: true, note: true, vehicle: { select: { plate: true } } },
    }),
    db.vehicle.findMany({ where: { isActive: true }, select: { id: true, plate: true }, orderBy: { plate: "asc" } }),
    db.mechanicRequest.findMany({ where: { payee: { not: null }, tripId: null }, distinct: ["payee"], select: { payee: true }, orderBy: { payee: "asc" }, take: 200 }),
  ]);

  const ledger = view === "hisob" ? filteredLedger ?? full : null;
  const balOf: BalMap = new Map(full.rows.map((r) => [r.id, { after: r.balAfter, unit: r.unit }]));
  const balances = fuelBalances(full.rows);
  const balById = new Map(balances.map((b) => [b.vehicleId, b]));
  // Haydovchi oxirgi yurgan mashinalari (yangisi oldin) — jadvaldagi qoldiq ustuni uchun
  const driverVehicles = new Map<string, string[]>();
  for (const r of [...full.rows].reverse()) {
    const list = driverVehicles.get(r.driverId) ?? [];
    if (!list.includes(r.vehicleId)) list.push(r.vehicleId);
    driverVehicles.set(r.driverId, list);
  }

  // Haydovchilar bo'yicha oy jami
  const byDriver = new Map<string, { id: string; name: string; trips: number; km: number; wait: number; hours: number; turns: number; fuelL: number; fuelM3: number; sum: number; unpriced: number }>();
  for (const r of monthTrips) {
    const d = byDriver.get(r.driverId) ?? { id: r.driverId, name: r.driver, trips: 0, km: 0, wait: 0, hours: 0, turns: 0, fuelL: 0, fuelM3: 0, sum: 0, unpriced: 0 };
    d.trips++; d.km += r.km; d.wait += r.vehicleType === "MIXER" ? r.waitMin ?? 0 : 0; d.hours += r.workHours ?? 0; d.turns += r.drumTurns ?? 0;
    // Norma birligi bo'yicha alohida: dizel — l, metan — m³ («Dizel + metan» reysda ikkalasi)
    if (r.fuelUnit === "m³") d.fuelM3 += r.fuelNorm ?? 0; else d.fuelL += r.fuelNorm ?? 0;
    d.fuelM3 += r.gasNorm ?? 0;
    if (r.pricedAt) d.sum += r.amount ?? 0; else d.unpriced++;
    byDriver.set(r.driverId, d);
  }
  const drivers = [...byDriver.values()].sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
  const total = { trips: monthTrips.length, km: drivers.reduce((a, d) => a + d.km, 0), sum: drivers.reduce((a, d) => a + d.sum, 0), unpriced: drivers.reduce((a, d) => a + d.unpriced, 0) };
  const picked = sp.driver ? drivers.find((d) => d.id === sp.driver) ?? null : null;
  const cur = today().slice(0, 7);
  const qs = (o: { oy?: string; driver?: string | null; bolim?: SectionKey; transport?: string | null }) => {
    const b = o.bolim ?? bolim;
    const p = new URLSearchParams({ bolim: b, oy: o.oy ?? month });
    const driver = o.driver === undefined ? sp.driver : o.driver, tr = o.transport === undefined ? sp.transport : o.transport;
    if (driver) p.set("driver", driver);
    if (b === "hisob" && tr) p.set("transport", tr);
    return `/logistika/tabel?${p}`;
  };
  // Oylik hisoblash: haydovchi bo'yicha reys haqi — oylikka (vedomost), naqd (kassa) va hali hal bo'lmagani
  type PayRow = { id: string; name: string; trips: number; payroll: number; payrollWait: number; cashPaid: number; cashDesk: number; cashWait: number; unpriced: number; unpricedSum: number };
  const payMap = new Map<string, PayRow>();
  for (const r of monthTrips) {
    const d = payMap.get(r.driverId) ?? { id: r.driverId, name: r.driver, trips: 0, payroll: 0, payrollWait: 0, cashPaid: 0, cashDesk: 0, cashWait: 0, unpriced: 0, unpricedSum: 0 };
    d.trips++;
    const a = r.amount ?? 0;
    // Narxsiz — `pricedAt` bo'yicha (narxsizlar ro'yxati bilan bir xil qoida)
    if (!r.pricedAt) { d.unpriced++; d.unpricedSum += r.suggested; }
    else if (r.payType === "CASH") { if (!r.approvedAt) d.cashWait += a; else if (r.cashStatus === "PAID") d.cashPaid += a; else d.cashDesk += a; }
    // Oylik yoki turi yo'q (funksiyadan oldin narxlangan — oylikka tasdiqsiz tushadi)
    else if (r.payType === "PAYROLL" && !r.approvedAt) d.payrollWait += a;
    else d.payroll += a;
    payMap.set(r.driverId, d);
  }
  const payRows = [...payMap.values()].sort((a, b) => b.payroll + b.cashPaid - (a.payroll + a.cashPaid) || a.name.localeCompare(b.name));
  const payTotal = payRows.reduce((t, r) => ({ ...t, trips: t.trips + r.trips, payroll: t.payroll + r.payroll, payrollWait: t.payrollWait + r.payrollWait, cashPaid: t.cashPaid + r.cashPaid, cashDesk: t.cashDesk + r.cashDesk, cashWait: t.cashWait + r.cashWait, unpriced: t.unpriced + r.unpriced, unpricedSum: t.unpricedSum + r.unpricedSum }),
    { id: "", name: "Jami", trips: 0, payroll: 0, payrollWait: 0, cashPaid: 0, cashDesk: 0, cashWait: 0, unpriced: 0, unpricedSum: 0 } as PayRow);
  const openMasters = masters.filter((m) => m.status === "DEFERRED" || m.status === "NEW" || m.status === "APPROVED").length;
  // Oy tanlash — oyga bog'liq bo'limlarda (oy jami, reyslar, hisob varag'i)
  const monthNav = (
    <div className="flex items-center gap-1 text-sm">
      {picked && <Link href={qs({ driver: null })} className="mr-2 text-blue-700 hover:underline">Hamma haydovchilar</Link>}
      <Link href={qs({ oy: shiftMonth(month, -1) })} scroll={false} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Oldingi oy"><ChevronLeft size={16} /></Link>
      <span className="font-medium">{monthTitle(month)}</span>
      {month < cur && <Link href={qs({ oy: shiftMonth(month, 1) })} scroll={false} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Keyingi oy"><ChevronRight size={16} /></Link>}
    </div>
  );
  const monthTitleText = picked ? `${picked.name} — ${monthTitle(month)}` : `Oy bo'yicha: ${monthTitle(month)}`;

  return (
    <div>
      <PageHeader title="Haydovchilar tabeli" subtitle="Yetkazilgan reyslar o'zi tushadi · narx va to'lov turini dispetcher qo'yadi · ish boshqaruvchi tasdiqlaydi: naqd — kassa, oylik — Ish haqi" />

      <Tabs scroll={false} current={bolim} items={[
        { key: "narxsiz", label: "Narx belgilanmagan", href: qs({ bolim: "narxsiz" }), icon: BellRing, count: unpriced.length },
        { key: "tasdiq", label: "Reys haqi tasdig'i", href: qs({ bolim: "tasdiq" }), icon: ShieldCheck, count: pending.length },
        { key: "usta", label: "Remont usta puli", href: qs({ bolim: "usta" }), icon: Wrench, ...(openMasters ? { count: openMasters } : {}) },
        { key: "oy", label: `Oy bo'yicha: ${monthTitle(month)}`, href: qs({ bolim: "oy" }), icon: Coins },
        { key: "reyslar", label: "Reyslar va narx", href: qs({ bolim: "reyslar" }), icon: Route },
        { key: "hisob", label: "Hisob varag'i", href: qs({ bolim: "hisob" }), icon: FileSpreadsheet },
        { key: "oylik", label: "Oylik hisoblash", href: qs({ bolim: "oylik" }), icon: Calculator },
        { key: "tarif", label: "Tarif", href: qs({ bolim: "tarif" }), icon: Settings2 },
      ]} />

      {!tariffSet(tariff) && bolim !== "tarif" && <Callout tone="warning" title="Tarif kiritilmagan">Taklif narx 0 chiqadi — <Link href={qs({ bolim: "tarif" })} className="font-medium underline">«Tarif»</Link> bo&apos;limida km va kutish narxini kiriting.</Callout>}

      {/* ── Narx belgilanmagan reyslar — «propushenniy»: hal bo'lmaguncha shu yerda va eslatmada ── */}
      {bolim === "narxsiz" && <Card padded={false} className={unpriced.length ? "border-amber-300 ring-2 ring-amber-100" : undefined}>
        <div id="narxsiz" className="scroll-mt-20 px-5 pt-5">
          <CardHeader title={`Narx belgilanmagan reyslar${unpriced.length ? ` (${unpriced.length})` : ""}`} icon={BellRing}
            description="Narx va to'lov turi (naqd / oylik) qo'yilgach reys ish boshqaruvchi tasdig'iga o'tadi"
            action={canPrice && unpriced.length > 1 ? <PriceAllButton ids={unpriced.map((r) => r.id)} /> : undefined} />
        </div>
        {unpriced.length === 0 ? <div className="px-5 pb-5 text-sm text-emerald-700">Hamma yetkazilgan reysga narx qo&apos;yilgan</div>
          : canPrice
            ? <Selectable ids={unpriced.map((r) => r.id)} mode="price"><TopRows total={unpriced.length}><TripRows rows={unpriced} canPrice showDriver bal={balOf} select /></TopRows></Selectable>
            : <TopRows total={unpriced.length}><TripRows rows={unpriced} canPrice={false} showDriver bal={balOf} /></TopRows>}
      </Card>}

      {/* ── Reys haqi tasdig'i (ish boshqaruvchi): naqd — kassaga, oylik — vedomostga ── */}
      {bolim === "tasdiq" && <Card padded={false} className={pending.length && canApprove ? "border-blue-300 ring-2 ring-blue-100" : undefined}>
        <div id="tasdiq" className="scroll-mt-20 px-5 pt-5">
          <CardHeader title={`Reys haqi tasdig'i${pending.length ? ` (${pending.length})` : ""}`} icon={ShieldCheck}
            description="Ish boshqaruvchi tasdiqlaydi: naqd — kassaga o'tadi va kassir beradi (kassa chiqimi), oylik — oy yakuni vedomostiga tushadi (buxgalter ko'radi)"
            action={canApprove && pending.length > 1 ? <ApproveButton ids={pending.map((r) => r.id)} label="Hammasini tasdiqlash" /> : undefined} />
        </div>
        {pending.length === 0 ? <div className="px-5 pb-5 text-sm text-slate-500">Tasdiq kutayotgan reys haqi yo&apos;q</div> : (
          <Selectable ids={canApprove ? pending.map((r) => r.id) : []} mode="approve">
            <Table>
              <thead><tr>{canApprove && <Th className="w-10"><AllCheck /></Th>}<Th>Sana · nakladnoy</Th><Th>Haydovchi</Th><Th>Obyekt</Th><Th right>Km</Th><Th right>Reys haqi</Th><Th>To&apos;lov turi</Th>{canApprove && <Th right>Qaror</Th>}</tr></thead>
              <tbody>
                {pending.map((r) => (
                  <Tr key={r.id}>
                    {canApprove && <Td><RowCheck id={r.id} /></Td>}
                    <Td className="text-sm"><span className="font-medium tabular">{r.no}</span><div className="text-xs text-slate-500">{dateTime(r.deliveredAt)} · {r.plate}</div></Td>
                    <Td className="text-sm">{r.driver}</Td>
                    <Td className="max-w-48 truncate text-sm">{r.customer}</Td>
                    <Td right className="tabular">{fmtNum(r.km, 0)}</Td>
                    <Td right><div className="font-semibold tabular">{money(r.amount ?? 0)}</div>{r.note && <div className="text-[11px] text-slate-500">{r.note}</div>}</Td>
                    <Td><Badge color={r.payType === "CASH" ? "amber" : "blue"}>{r.payType ? PAY_TYPE_LABEL[r.payType] : "—"}</Badge></Td>
                    {canApprove && <Td right><div className="flex flex-wrap items-center justify-end gap-1"><ApproveButton ids={[r.id]} label="Tasdiqlash" /><RejectPayForm tripId={r.id} /></div></Td>}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="px-5 py-3 text-xs text-slate-500">
              Naqd: {money(pending.filter((r) => r.payType === "CASH").reduce((a, r) => a + (r.amount ?? 0), 0))} ·
              Oylik: {money(pending.filter((r) => r.payType === "PAYROLL").reduce((a, r) => a + (r.amount ?? 0), 0))}
            </div>
          </Selectable>
        )}
      </Card>}

      {/* ── Remont usta puli: joyida (tasdiq → kassa) yoki N kunda (muddat kuni eslatma va tasdiq) ── */}
      {bolim === "usta" && <Card padded={false}>
        <div id="usta" className="scroll-mt-20 px-5 pt-5">
          <CardHeader title="Remont usta puli" icon={Wrench}
            description="Ta'mir, vulkanizatsiya, zapchast. Joyida berish — ish boshqaruvchi tasdiqlaydi, kassa beradi. N kunda berish — muddat kuni «… ga remont puli berish vaqti keldi» eslatmasi keladi va tasdiqqa o'tadi"
            action={canApprove ? <Link href="/mexanik-sorovlar?tab=NEW" className="text-sm text-blue-700 hover:underline">Tasdiqlash — Mexanik so&apos;rovlari</Link> : undefined} />
          {canPrice && <div className="pb-4"><MasterPayForm vehicles={vehicles} payees={payees.map((p) => p.payee!).filter(Boolean)} problems={MASTER_PROBLEMS} /></div>}
        </div>
        {(() => {
          // Muddatli qarzlar usta bo'yicha: soni, jami, eng yaqin muddat
          const due = new Map<string, { n: number; sum: number; dueAt: Date }>();
          for (const m of masters.filter((x) => x.status === "DEFERRED" && x.dueAt)) {
            const g = due.get(m.payee!) ?? { n: 0, sum: 0, dueAt: m.dueAt! };
            g.n++; g.sum += Number(m.amount); if (m.dueAt! < g.dueAt) g.dueAt = m.dueAt!;
            due.set(m.payee!, g);
          }
          const days = (d: Date) => Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
          return (
            <>
              {due.size > 0 && (
                <div className="flex flex-wrap gap-2 px-5 pb-3">
                  {[...due].map(([payee, g]) => (
                    <div key={payee} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <div className="font-medium">{payee}</div>
                      <div className="text-xs text-slate-500">{g.n} ta xarajat · <span className="font-semibold tabular text-slate-800">{money(g.sum)}</span> · {date(g.dueAt)} ({days(g.dueAt)} kun qoldi)</div>
                    </div>
                  ))}
                </div>
              )}
              {masters.length === 0 ? <div className="px-5 pb-5 text-sm text-slate-500">Usta puli yozuvlari yo&apos;q</div> : (
                <Table>
                  <thead><tr><Th>Sana</Th><Th>Usta</Th><Th>Transport</Th><Th>Turi</Th><Th right>Summa</Th><Th>Holat</Th><Th>Izoh</Th></tr></thead>
                  <tbody>
                    {masters.map((m) => (
                      <Tr key={m.id}>
                        <Td className="text-sm"><span className="tabular">{date(m.createdAt)}</span><div className="text-xs text-slate-500">{m.docNo}</div></Td>
                        <Td className="text-sm font-medium">{m.payee}</Td>
                        <Td className="text-sm">{m.vehicle?.plate ?? "—"}</Td>
                        <Td className="text-sm">{m.problem}</Td>
                        <Td right className="font-semibold tabular">{money(Number(m.amount))}</Td>
                        <Td>
                          <Badge color={MECH_STATUS_COLOR[m.status]}>{MECH_STATUS_LABEL[m.status]}</Badge>
                          {m.status === "DEFERRED" && m.dueAt && <div className="mt-0.5 text-[11px] text-slate-500">muddat {date(m.dueAt)}</div>}
                        </Td>
                        <Td className="max-w-56 truncate text-sm text-slate-600">{m.note}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          );
        })()}
      </Card>}

      {/* ── Oy jami: ko'rsatkichlar va yoqilg'i qoldig'i ── */}
      {bolim === "oy" && <Section title={monthTitleText} className="mt-0" action={monthNav}>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Reyslar" value={picked ? picked.trips : total.trips} icon={Route} tone="info" href={qs({ bolim: "reyslar" })} />
          <StatCard label="Km" value={fmtNum(picked ? picked.km : total.km, 0)} hint="zavod → obyekt → zavod" icon={Users} href={qs({ bolim: "reyslar" })} />
          <StatCard label="Narxlangan summa" value={money(picked ? picked.sum : total.sum)} hint="oylikka tushadi" icon={Coins} tone="success" href={qs({ bolim: "reyslar" })} />
          <StatCard label="Narxsiz" value={picked ? picked.unpriced : total.unpriced} icon={Timer} tone={(picked ? picked.unpriced : total.unpriced) ? "warning" : "default"} href={qs({ bolim: "narxsiz" })} />
        </div>

        {(() => {
          // Haydovchi tanlangan bo'lsa — faqat u yurgan mashinalar (qoldiq baribir butun mashina bo'yicha)
          const list = picked ? balances.filter((b) => driverVehicles.get(picked.id)?.includes(b.vehicleId)) : balances;
          if (!list.length) return null;
          return (
            <Card padded={false} className="mb-4">
              <div className="px-5 pt-5">
                <CardHeader title="Yoqilg'i qoldig'i" icon={Fuel}
                  description="Transport bo'yicha: oy boshidagi qoldiq + zapravka − norma sarfi (km × 100 km normasi + baraban soati × soat normasi)" />
              </div>
              <Table>
                <thead><tr><Th>Transport</Th><Th>Haydovchilar</Th><Th right>Reys</Th><Th right>Oy boshida</Th><Th right>Zapravka</Th><Th right>Sarf (norma)</Th><Th right>Qoldiq</Th></tr></thead>
                <tbody>
                  {list.map((b) => (
                    <Tr key={b.vehicleId}>
                      <Td className="font-medium"><Link href={qs({ bolim: "hisob", transport: b.vehicleId })} className="hover:underline">{b.plate}</Link></Td>
                      <Td className="text-sm text-slate-600">{b.drivers.join(", ")}</Td>
                      <Td right className="tabular">{b.trips}</Td>
                      <Td right className="tabular"><Bal v={b.opening} unit={b.unit} /></Td>
                      <Td right className="tabular">{fmtNum(b.refuel, 1)} {b.unit}</Td>
                      <Td right className="tabular">{fmtNum(b.use, 1)} {b.unit}</Td>
                      <Td right className="font-semibold tabular"><Bal v={b.closing} unit={b.unit} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })()}
        {balances.length === 0 && <Card><Empty text="Bu oyda yetkazilgan reys yo'q" icon={Route} /></Card>}
      </Section>}

      {/* ── Hisob varag'i (dispetcher Excel'i ko'rinishida) ── */}
      {bolim === "hisob" && ledger && <Section title={monthTitleText} className="mt-0" action={monthNav}>
          <>
            <form method="get" action="/logistika/tabel" className="mb-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="oy" value={month} />
              <input type="hidden" name="bolim" value="hisob" />
              {sp.driver && <input type="hidden" name="driver" value={sp.driver} />}
              <Select name="transport" defaultValue={sp.transport ?? ""} className="w-56" aria-label="Transport">
                <option value="">Hamma transport</option>
                {monthVehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
              </Select>
              <Button type="submit" variant="secondary">Ko&apos;rsatish</Button>
            </form>
            {ledger.rows.length === 0 ? <Card><Empty text="Bu oyda yetkazilgan reys yo'q" icon={Route} /></Card>
              : <LedgerSheet rows={ledger.rows} total={ledger.total} month={month} showDriver={!picked}
                file={`Haydovchi tabeli ${month}${picked ? ` ${picked.name}` : ""}${sp.transport ? ` ${monthVehicles.find((v) => v.id === sp.transport)?.plate ?? ""}` : ""}`} />}
          </>
      </Section>}

      {/* ── Reyslar va narx: haydovchilar bo'yicha oy, haydovchi tanlansa — uning reyslari ── */}
      {bolim === "reyslar" && <Section title={monthTitleText} className="mt-0" action={monthNav}>
        {picked ? (
          <Card padded={false}>
            {monthTrips.length === 0 ? <Empty text="Bu oyda yetkazilgan reys yo'q" icon={Route} /> : <TripRows rows={[...monthTrips].reverse()} canPrice={canPrice} showDriver={false} bal={balOf} />}
          </Card>
        ) : (
          <Card padded={false}>
            <Table>
              <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Km</Th><Th right>Kutish</Th><Th right>Ishlagan soat</Th><Th right>Aylantirish</Th><Th right>Yoqilg&apos;i normasi</Th><Th right>Yoqilg&apos;i qoldig&apos;i</Th><Th right>Narxsiz</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {drivers.length === 0 && <Empty text="Bu oyda yetkazilgan reys yo'q" icon={Users} />}
                {drivers.map((d) => (
                  <Tr key={d.id}>
                    <Td><Link href={qs({ driver: d.id })} className="font-medium hover:underline">{d.name}</Link></Td>
                    <Td right className="tabular">{d.trips}</Td>
                    <Td right className="tabular">{fmtNum(d.km, 0)}</Td>
                    <Td right className="tabular">{hours(d.wait)}</Td>
                    <Td right className="tabular">{fmtNum(d.hours, 1)}</Td>
                    <Td right className="tabular">{d.turns || "—"}</Td>
                    <Td right className="tabular">{[d.fuelL ? `${fmtNum(d.fuelL, 0)} l` : null, d.fuelM3 ? `${fmtNum(d.fuelM3, 0)} m³` : null].filter(Boolean).join(" + ") || "—"}</Td>
                    <Td right className="tabular text-sm">
                      {(driverVehicles.get(d.id) ?? []).map((vid) => balById.get(vid)).filter((b) => !!b).map((b) => (
                        <div key={b.vehicleId} className="whitespace-nowrap"><span className="text-xs text-slate-500">{b.plate}</span> <Bal v={b.closing} unit={b.unit} /></div>
                      ))}
                    </Td>
                    <Td right>{d.unpriced ? <Badge color="amber">{d.unpriced}</Badge> : <span className="text-slate-400">0</span>}</Td>
                    <Td right className="font-semibold tabular">{money(d.sum)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
        <p className="mt-2 text-xs text-slate-500">Yoqilg&apos;i normasi: km × 100 km normasi + ishlagan soat × turib ishlash normasi (metan — m³, dizel — l). Oylik {date(new Date(y!, m!, 0))} gacha yetkazilgan reyslardan.</p>
      </Section>}

      {/* ── Oylik hisoblash: reys haqi haydovchi bo'yicha — oylikka (Ish haqi vedomosti) va naqd (kassa) ── */}
      {bolim === "oylik" && <Section title={`Oylik hisoblash: ${picked ? `${picked.name} — ` : ""}${monthTitle(month)}`} className="mt-0" action={monthNav}>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Oylikka (tasdiqlangan)" value={money(payTotal.payroll)} hint="oy yakuni vedomostiga tushadi" icon={Calculator} tone="success" />
          <StatCard label="Naqd berildi" value={money(payTotal.cashPaid)} hint={payTotal.cashDesk ? `kassada kutmoqda ${money(payTotal.cashDesk)}` : "kassadan"} icon={Coins} tone="info" />
          <StatCard label="Tasdiq kutmoqda" value={money(payTotal.payrollWait + payTotal.cashWait)} hint={`oylik ${money(payTotal.payrollWait)} · naqd ${money(payTotal.cashWait)}`} icon={ShieldCheck} tone={payTotal.payrollWait + payTotal.cashWait ? "warning" : "default"} href={qs({ bolim: "tasdiq" })} />
          <StatCard label="Narxsiz" value={payTotal.unpriced} hint={payTotal.unpriced ? `taklif bo'yicha ${money(payTotal.unpricedSum)}` : "hammasi narxlangan"} icon={Timer} tone={payTotal.unpriced ? "warning" : "default"} href={qs({ bolim: "narxsiz" })} />
        </div>
        {payRows.length === 0 ? <Card><Empty text="Bu oyda yetkazilgan reys yo'q" icon={Users} /></Card> : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Faqat reys haqi. Oklad, avans va ushlanmalar bilan to&apos;liq oylik — Ish haqi bo&apos;limida (oy yakuni vedomosti).</p>
              <ExcelButton file={`Haydovchilar oyligi ${month}`} sheets={[{ name: "Oylik hisoblash", rows: [...payRows, payTotal].map((r) => ({
                Haydovchi: r.name, Reys: r.trips, "Oylikka (tasdiqlangan)": r.payroll, "Oylik — tasdiq kutmoqda": r.payrollWait,
                "Naqd berildi": r.cashPaid, "Naqd — kassada": r.cashDesk, "Naqd — tasdiq kutmoqda": r.cashWait, "Narxsiz reys": r.unpriced, "Narxsiz, taklif": r.unpricedSum,
                "Jami hisoblangan": r.payroll + r.payrollWait + r.cashPaid + r.cashDesk + r.cashWait,
              })) }]} />
            </div>
            <Card padded={false}>
              <Table>
                <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Oylikka</Th><Th right>Oylik — tasdiqda</Th><Th right>Naqd berildi</Th><Th right>Naqd — kassada</Th><Th right>Naqd — tasdiqda</Th><Th right>Narxsiz</Th><Th right>Jami hisoblangan</Th></tr></thead>
                <tbody>
                  {[...payRows, payTotal].map((r) => {
                    const sum = r.payroll + r.payrollWait + r.cashPaid + r.cashDesk + r.cashWait;
                    const isTotal = r === payTotal;
                    const cell = (v: number, cls = "") => <Td right className={`tabular ${cls}`}>{v ? money(v) : <span className="text-slate-300">—</span>}</Td>;
                    return (
                      <Tr key={r.id || "jami"} className={isTotal ? "bg-slate-50 font-semibold" : undefined}>
                        <Td>{isTotal ? "Jami" : <Link href={qs({ bolim: "reyslar", driver: r.id })} className="font-medium hover:underline">{r.name}</Link>}</Td>
                        <Td right className="tabular">{r.trips}</Td>
                        {cell(r.payroll, "font-semibold text-emerald-700")}
                        {cell(r.payrollWait, "text-amber-700")}
                        {cell(r.cashPaid)}
                        {cell(r.cashDesk, "text-blue-700")}
                        {cell(r.cashWait, "text-amber-700")}
                        <Td right className="tabular">{r.unpriced ? <span className="text-amber-700">{r.unpriced} ta · {money(r.unpricedSum)}</span> : <span className="text-slate-300">—</span>}</Td>
                        <Td right className="font-semibold tabular">{money(sum)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          </>
        )}
      </Section>}

      {bolim === "tarif" && <Section title="Tarif" className="mt-0">
        <Card>
          <CardHeader title="Reys haqi tarifi" icon={Settings2} description="Taklif = reys + km × tarif + mikser kutish soati × tarif (1000 so'mga yaxlitlanadi)" />
          {canPrice ? <TariffForm v={{ drvTripRate: tariff.trip, drvKmRate: tariff.km, drvWaitHourRate: tariff.waitHour }} />
            : <p className="text-sm text-slate-600">Reys: {money(tariff.trip)} · 1 km: {money(tariff.km)} · kutish: {money(tariff.waitHour)} / soat. Tarifni dispetcher o&apos;zgartiradi.</p>}
        </Card>
      </Section>}
    </div>
  );
}
