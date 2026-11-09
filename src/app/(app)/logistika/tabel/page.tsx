import { Fragment } from "react";
import Link from "next/link";
import { BellRing, Calculator, ChevronLeft, ChevronRight, Coins, FileSpreadsheet, Fuel, PencilLine, Route, Settings2, ShieldCheck, Timer, TrendingUp, Truck, Undo2, Users, Wrench } from "lucide-react";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { normMonth } from "@/lib/attendance-report";
import { monthTitle, shiftMonth, today } from "@/lib/davomat";
import { driverTariff, fuelNormText, PAY_TYPE_LABEL, payTrips, pendingApprovalWhere, tariffSet, unpricedWhere, type PayTripRow } from "@/lib/driver-trip-pay";
import { MASTER_PROBLEMS, MECH_STATUS_COLOR, MECH_STATUS_LABEL } from "@/lib/mechanic-requests";
import { driverLedger, fuelBalances, ledgerTotals } from "@/lib/driver-ledger";
import { driverEmployees, mainDriverOf } from "@/lib/logistics";
import { avtoReport } from "@/lib/fin-report/avto";
import { entryRows, pendingEntryWhere, type EntryRow } from "@/lib/logistics-entry";
import { date, dateTime, fmtNum, isoDate, money, opAt } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { AllCheck, ApproveButton, EntryEditButton, EntryEditProvider, EntryForm, MasterPayForm, PriceAllButton, PriceForm, RejectPayForm, RowCheck, Selectable, TariffForm, TopRows } from "./tabel-forms";
import { LedgerSheet } from "./ledger-sheet";
import { LedgerFormsProvider, LedgerRowForm, type LedgerOptions } from "./ledger-forms";
import { ConfirmButton } from "../../payments/confirm-button";
import { ExpenseForm } from "../cost-forms";
import { costOptions } from "../cost-data";
import { cancelEntryAction } from "../actions";

export const dynamic = "force-dynamic";

const hours = (min: number | null) => (min == null ? "—" : min < 60 ? `${min} daq` : `${fmtNum(min / 60, 1)} soat`);

/** Yoqilg'i qoldig'i: «66,2 m³», manfiy — qizil (norma bo'yicha zapravkadan ko'p sarflangan). */
const Bal = ({ v, unit }: { v: number; unit: string }) => <span className={v < 0 ? "font-semibold text-red-600" : undefined}>{fmtNum(v, 1)} {unit}</span>;
type BalMap = Map<string, { after: number; unit: string }>;

/** Reys haqi holati: to'lov turi va tasdiq / kassa bosqichi; rad etilgani — sababi bilan. */
function PayStatus({ r }: { r: PayTripRow }) {
  if (!r.pricedAt) return r.rejectReason ? <div className="text-[11px] text-red-600">Rad etildi: {r.rejectReason}</div> : null;
  if (!r.payType) return null;
  const [color, text] = !r.approvedAt ? ["amber", "Tasdiq kutilmoqda"] as const
    : r.payType === "PAYROLL" ? ["green", "Oylikka tasdiqlangan"] as const
    : r.cashStatus === "PAID" ? ["green", "Kassa berdi"] as const : ["blue", "Kassa kutilmoqda"] as const;
  return <div className="mt-0.5 flex flex-wrap justify-end gap-1"><Badge color="slate" dot={false}>{PAY_TYPE_LABEL[r.payType]}</Badge><Badge color={color}>{text}</Badge></div>;
}

/** Qo'lda yozuv holati: bekor qilingan (sababi bilan), tasdiq / oylik / kassa bosqichi; haqsiz yozuv — faqat kirim. */
function EntryStatus({ e }: { e: EntryRow }) {
  if (e.cancelledAt) return <><Badge color="slate">Bekor qilingan</Badge>{e.cancelReason && <div className="mt-0.5 max-w-48 text-[11px] text-slate-500">{e.cancelReason}</div>}</>;
  if (e.pay <= 0) return <Badge color="slate" dot={false}>Faqat kirim</Badge>;
  const [color, text] = !e.approvedAt ? ["amber", "Tasdiq kutilmoqda"] as const
    : e.payType === "PAYROLL" ? ["green", "Oylikka tasdiqlangan"] as const
    : e.cashStatus === "PAID" ? ["green", "Kassa berdi"] as const : ["blue", "Kassa kutilmoqda"] as const;
  return <Badge color={color}>{text}</Badge>;
}

/**
 * Qo'lda yozuvlar jadvali — «Qo'lda yozuvlar» bo'limi va haydovchi oyligi uchun. Naqdi kassaga o'tgani bekor qilinmaydi
 * va tahrirlanmaydi. `edit` — tahrir oynasining haydovchi/transport ro'yxatlari (berilsa har qatorda qalam).
 */
function EntryTable({ rows, canCancel, edit }: { rows: EntryRow[]; canCancel: boolean; edit?: { drivers: { id: string; label: string }[]; vehicles: { id: string; label: string }[] } | null }) {
  const actions = canCancel || !!edit;
  const table = (
    <Table>
      <thead><tr><Th>Sana · №</Th><Th>Haydovchi</Th><Th>Transport</Th><Th>Ish</Th><Th right>Haydovchi haqi</Th><Th right>Kirim</Th><Th>Holat</Th>{actions && <Th className="w-20" />}</tr></thead>
      <tbody>
        {rows.map((e) => (
          <Tr key={e.id} className={e.cancelledAt ? "opacity-60" : undefined}>
            <Td className="text-sm"><span className="whitespace-nowrap tabular">{opAt(e.date, e.createdAt)}</span><div className="text-xs text-slate-500 tabular">{e.docNo}</div></Td>
            <Td className="text-sm">{e.driver ?? <span className="text-slate-300">—</span>}</Td>
            <Td className="text-sm tabular">{e.plate ?? <span className="text-slate-300">—</span>}</Td>
            <Td className="max-w-72 text-sm">{e.note}<div className="text-xs text-slate-500">{[e.trips ? `${e.trips} reys` : null, e.km != null ? `${fmtNum(e.km, 0)} km` : null, `yozdi: ${e.createdBy}`].filter(Boolean).join(" · ")}</div></Td>
            <Td right className="tabular">{e.pay ? <><span className="font-semibold">{money(e.pay)}</span>{e.payType && <div className="text-[11px] text-slate-500">{PAY_TYPE_LABEL[e.payType]}</div>}</> : <span className="text-slate-300">—</span>}</Td>
            <Td right className="tabular">{e.revenue ? money(e.revenue) : <span className="text-slate-300">—</span>}</Td>
            <Td><EntryStatus e={e} /></Td>
            {actions && <Td>{!e.cancelledAt && !(e.payType === "CASH" && e.approvedAt) && (
              <div className="flex items-center justify-end gap-0.5">
                {edit && <EntryEditButton entry={{
                  id: e.id, docNo: e.docNo, date: isoDate(e.date), driverId: e.driverId, driver: e.driver, vehicleId: e.vehicleId, plate: e.plate,
                  trips: e.trips, km: e.km, pay: e.pay, payType: e.payType, revenue: e.revenue, note: e.note, approved: !!e.approvedAt,
                }} />}
                {canCancel && <ConfirmButton action={cancelEntryAction.bind(null, e.id)} reason="required" label="" title="Bekor qilish" icon={<Undo2 size={14} />}
                  question={`${e.docNo} (${date(e.date)}) bekor qilinsinmi?`} okText="Bekor qilindi" className="h-7 px-1.5" />}
              </div>
            )}</Td>}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
  return edit ? <EntryEditProvider options={edit}>{table}</EntryEditProvider> : table;
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
              {r.pricedAt && r.amount != null && <div className="font-semibold tabular">{money(r.amount)}</div>}
              {r.note && <div className="text-[11px] text-slate-500">{r.note}</div>}
              <PayStatus r={r} />
              {/* Naqdi kassaga o'tgan reys narxi o'zgarmaydi */}
              {canPrice && !(r.payType === "CASH" && r.approvedAt) ? <PriceForm tripId={r.id} suggested={r.suggested} amount={r.amount} payType={r.payType} priced={!!r.pricedAt} />
                : !canPrice && !r.pricedAt && <Badge color="amber">Narxsiz</Badge>}
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
 * «Hisob varag'i» (`?view=hisob`) — dispetcher Excel'i, mashina bo'yicha varaq (tab): gaz qoldig'i/zapravka/sarf, xarajatlar,
 * dastavka daromadi, foyda. Reyslar ECO'dan o'zi tushadi, tushmagani — qo'lda qator (logistika va dispetcher, `ledger`).
 * «Oylik hisoblash» — BARCHA faol haydovchi va transport (reysi yo'q, ECO'ga ulanmagani ham); «Qo'lda yozuvlar» — reys tizimga
 * tushmagan ish, haq, kirim (`lib/logistics-entry.ts`) va transport chiqimi.
 */
/** Sahifa bo'limlari — sarlavha ostidagi bar. Eski havolalar (`?view=hisob`) ham ishlaydi. */
const SECTIONS = ["narxsiz", "tasdiq", "usta", "oy", "reyslar", "hisob", "oylik", "qolda", "tarif"] as const;
type SectionKey = (typeof SECTIONS)[number];

export default async function DriverTabelPage({ searchParams }: { searchParams: Promise<{ oy?: string; driver?: string; view?: string; bolim?: string; transport?: string; kesim?: string }> }) {
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
  const canLedger = canDo(s, "logistika", "ledger");
  const [unpriced, monthTrips, tariff, full, pending, masters, vehicles, payees] = await Promise.all([
    payTrips(unpricedWhere()),
    payTrips({ status: "DELIVERED", deliveredAt: { gte: from, lt: to }, ...(sp.driver ? { driverId: sp.driver } : {}) }, 3000),
    driverTariff(),
    // Yoqilg'i qoldig'i mashina bo'yicha — oyning hamma reysidan (haydovchi filtri qoldiqni buzmasin)
    driverLedger(from, to),
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

  // Qo'lda yozuvlar: tasdiq kutayotganlari — tab soni uchun; oy ro'yxati (bekor qilinganlari ham) — oylik va «Qo'lda yozuvlar» da
  const kesim = sp.kesim === "transport" ? "transport" : "haydovchi";
  const canExpense = canDo(s, "logistika", "expense");
  const [pendingEntries, monthEntries, staff, avto, extVehicles, opts] = await Promise.all([
    entryRows(pendingEntryWhere()),
    bolim === "oylik" || bolim === "qolda" ? entryRows({ date: { gte: from, lt: to }, ...(bolim === "oylik" && sp.driver ? { driverId: sp.driver } : {}) }, 2000) : Promise.resolve([] as EntryRow[]),
    bolim === "oylik" && kesim === "haydovchi" ? driverEmployees({ activeOnly: true }) : Promise.resolve([]),
    bolim === "oylik" && kesim === "transport" ? avtoReport(from, to) : Promise.resolve(null),
    bolim === "oylik" && kesim === "transport" ? db.vehicle.findMany({ where: { external: true }, select: { id: true } }) : Promise.resolve([]),
    bolim === "qolda" && (canPrice || canExpense) ? costOptions() : Promise.resolve(null),
  ]);
  const liveEntries = monthEntries.filter((e) => !e.cancelledAt);

  // Hisob varag'i: mashina varag'i (tab) — butun hisobdan filtr (qoldiq baribir mashina bo'yicha hisoblangan)
  const ledgerRows = view === "hisob" ? full.rows.filter((r) => (!sp.transport || r.vehicleId === sp.transport) && (!sp.driver || r.driverId === sp.driver)) : [];
  const ledger = view === "hisob" ? { rows: ledgerRows, total: ledgerTotals(ledgerRows) } : null;
  const ledgerOpts: LedgerOptions | null = view === "hisob" ? await ledgerOptions(canLedger) : null;
  // Tablar: faol o'z transporti va shu oyda qatori borlari (ko'chadan mashina ham)
  const sheetCount = new Map<string, number>();
  for (const r of full.rows) if (!sp.driver || r.driverId === sp.driver) sheetCount.set(r.vehicleId, (sheetCount.get(r.vehicleId) ?? 0) + 1);
  const sheetTabs = ledgerOpts ? [...new Map([
    ...ledgerOpts.vehicles.map((v) => [v.id, v.plate] as const),
    ...full.rows.filter((r) => sheetCount.has(r.vehicleId)).map((r) => [r.vehicleId, r.plate] as const),
  ])].sort((a, b) => a[1].localeCompare(b[1])) : [];
  const balOf: BalMap = new Map(full.rows.map((r) => [r.id, { after: r.balAfter, unit: r.unit }]));
  const balances = fuelBalances(full.rows);
  const balById = new Map(balances.map((b) => [b.vehicleId, b]));
  // Haydovchi oxirgi yurgan mashinalari (yangisi oldin) — jadvaldagi qoldiq ustuni uchun
  const driverVehicles = new Map<string, string[]>();
  for (const r of [...full.rows].reverse()) {
    if (!r.driverId) continue;
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
  const qs = (o: { oy?: string; driver?: string | null; bolim?: SectionKey; transport?: string | null; kesim?: "transport" | null }) => {
    const b = o.bolim ?? bolim;
    const p = new URLSearchParams({ bolim: b, oy: o.oy ?? month });
    const driver = o.driver === undefined ? sp.driver : o.driver, tr = o.transport === undefined ? sp.transport : o.transport;
    const k = o.kesim === undefined ? (kesim === "transport" ? "transport" : null) : o.kesim;
    if (driver) p.set("driver", driver);
    if (b === "hisob" && tr) p.set("transport", tr);
    if (b === "oylik" && k) p.set("kesim", k);
    return `/logistika/tabel?${p}`;
  };
  // Oylik hisoblash: BARCHA faol haydovchi (reysi yo'q, ECO'ga ulanmagani ham) — reys haqi va qo'lda yozilgan haq:
  // oylikka (vedomost), naqd (kassa) va hali hal bo'lmagani. Ro'yxatda yo'q (ko'chadan, ishdan ketgan) — shu oyda haqi bo'lsa, pastda
  type PayRow = { id: string; name: string; eco: boolean | null; plate: string | null; outside: boolean; trips: number; manual: number; payroll: number; payrollWait: number; cashPaid: number; cashDesk: number; cashWait: number; unpriced: number; unpricedSum: number };
  const blank = (id: string, name: string): PayRow => ({ id, name, eco: null, plate: null, outside: true, trips: 0, manual: 0, payroll: 0, payrollWait: 0, cashPaid: 0, cashDesk: 0, cashWait: 0, unpriced: 0, unpricedSum: 0 });
  const plateOf = new Map(vehicles.map((v) => [v.id, v.plate]));
  const payMap = new Map<string, PayRow>();
  for (const d of staff) {
    if (sp.driver && d.id !== sp.driver) continue;
    payMap.set(d.id, { ...blank(d.id, d.fullName), eco: !!d.ecoUserId, plate: d.vehicleId ? plateOf.get(d.vehicleId) ?? null : null, outside: false });
  }
  for (const e of liveEntries) {
    if (!e.driverId || e.pay <= 0) continue;
    const d = payMap.get(e.driverId) ?? blank(e.driverId, e.driver ?? "—");
    d.manual++;
    if (!e.approvedAt) { if (e.payType === "CASH") d.cashWait += e.pay; else d.payrollWait += e.pay; }
    else if (e.payType === "CASH") { if (e.cashStatus === "PAID") d.cashPaid += e.pay; else d.cashDesk += e.pay; }
    else d.payroll += e.pay;
    payMap.set(e.driverId, d);
  }
  for (const r of monthTrips) {
    const d = payMap.get(r.driverId) ?? blank(r.driverId, r.driver);
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
  // Ro'yxatdan tashqaridagilar: ko'chadan chaqirilgan yoki faol emas — belgisi bilan
  const outsideIds = [...payMap.values()].filter((r) => r.outside).map((r) => r.id);
  const outsideInfo = new Map(outsideIds.length ? (await db.employee.findMany({ where: { id: { in: outsideIds } }, select: { id: true, external: true } })).map((e) => [e.id, e.external ? "ko'chadan" : "faol emas"]) : []);
  const earned = (r: PayRow) => r.payroll + r.payrollWait + r.cashPaid + r.cashDesk + r.cashWait;
  const payRows = [...payMap.values()].sort((a, b) => Number(a.outside) - Number(b.outside) || earned(b) - earned(a) || b.trips - a.trips || a.name.localeCompare(b.name));
  const payTotal = payRows.reduce((t, r) => ({ ...t, trips: t.trips + r.trips, manual: t.manual + r.manual, payroll: t.payroll + r.payroll, payrollWait: t.payrollWait + r.payrollWait, cashPaid: t.cashPaid + r.cashPaid, cashDesk: t.cashDesk + r.cashDesk, cashWait: t.cashWait + r.cashWait, unpriced: t.unpriced + r.unpriced, unpricedSum: t.unpricedSum + r.unpricedSum }),
    { ...blank("", "Jami"), outside: false });
  const pickedName = picked?.name ?? (sp.driver ? payMap.get(sp.driver)?.name ?? null : null);
  const openMasters = masters.filter((m) => m.status === "DEFERRED" || m.status === "NEW" || m.status === "APPROVED").length;
  // Oy tanlash — oyga bog'liq bo'limlarda (oy jami, reyslar, hisob varag'i)
  const monthNav = (
    <div className="flex items-center gap-1 text-sm">
      {sp.driver && <Link href={qs({ driver: null })} className="mr-2 text-blue-700 hover:underline">Hamma haydovchilar</Link>}
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
        { key: "tasdiq", label: "Reys haqi tasdig'i", href: qs({ bolim: "tasdiq" }), icon: ShieldCheck, count: pending.length + pendingEntries.length },
        { key: "usta", label: "Remont usta puli", href: qs({ bolim: "usta" }), icon: Wrench, ...(openMasters ? { count: openMasters } : {}) },
        { key: "oy", label: `Oy bo'yicha: ${monthTitle(month)}`, href: qs({ bolim: "oy" }), icon: Coins },
        { key: "reyslar", label: "Reyslar va narx", href: qs({ bolim: "reyslar" }), icon: Route },
        { key: "hisob", label: "Hisob varag'i", href: qs({ bolim: "hisob" }), icon: FileSpreadsheet },
        { key: "oylik", label: "Oylik hisoblash", href: qs({ bolim: "oylik" }), icon: Calculator },
        { key: "qolda", label: "Qo'lda yozuvlar", href: qs({ bolim: "qolda" }), icon: PencilLine },
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

      {/* ── Qo'lda yozilgan haq tasdig'i: dispetcher yozgan ish / oylik haq (reys tizimga tushmagan) ── */}
      {bolim === "tasdiq" && pendingEntries.length > 0 && <Card padded={false} className={`mt-4 ${canApprove ? "border-blue-300 ring-2 ring-blue-100" : ""}`}>
        <div className="px-5 pt-5">
          <CardHeader title={`Qo'lda yozilgan haq (${pendingEntries.length})`} icon={PencilLine}
            description="Dispetcher yozgan: reys tizimga tushmagan ish yoki oylik haq. Tasdiqlansa — naqd kassaga, oylik vedomostga; rad etilsa yozuv sababi bilan bekor bo'ladi"
            action={canApprove && pendingEntries.length > 1 ? <ApproveButton ids={pendingEntries.map((e) => e.id)} label="Hammasini tasdiqlash" entry /> : undefined} />
        </div>
        <Table>
          <thead><tr><Th>Sana · №</Th><Th>Haydovchi</Th><Th>Transport</Th><Th>Ish</Th><Th right>Haq</Th><Th>To&apos;lov turi</Th>{canApprove && <Th right>Qaror</Th>}</tr></thead>
          <tbody>
            {pendingEntries.map((e) => (
              <Tr key={e.id}>
                <Td className="text-sm"><span className="whitespace-nowrap tabular">{opAt(e.date, e.createdAt)}</span><div className="text-xs text-slate-500 tabular">{e.docNo}</div></Td>
                <Td className="text-sm">{e.driver}</Td>
                <Td className="text-sm tabular">{e.plate ?? <span className="text-slate-300">—</span>}</Td>
                <Td className="max-w-72 text-sm">{e.note}<div className="text-xs text-slate-500">{[e.trips ? `${e.trips} reys` : null, e.km != null ? `${fmtNum(e.km, 0)} km` : null, `yozdi: ${e.createdBy}`].filter(Boolean).join(" · ")}</div></Td>
                <Td right className="font-semibold tabular">{money(e.pay)}</Td>
                <Td><Badge color={e.payType === "CASH" ? "amber" : "blue"}>{e.payType ? PAY_TYPE_LABEL[e.payType] : "—"}</Badge></Td>
                {canApprove && <Td right><div className="flex flex-wrap items-center justify-end gap-1"><ApproveButton ids={[e.id]} label="Tasdiqlash" entry /><RejectPayForm entryId={e.id} /></div></Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
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
                        <Td className="text-sm"><span className="whitespace-nowrap tabular">{dateTime(m.createdAt)}</span><div className="text-xs text-slate-500">{m.docNo}</div></Td>
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

      {/* ── Hisob varag'i (dispetcher Excel'i ko'rinishida): har mashina — alohida varaq ── */}
      {bolim === "hisob" && ledger && ledgerOpts && <Section title={monthTitleText} className="mt-0" action={monthNav}>
        <Tabs scroll={false} current={sp.transport ?? "all"} className="[&_a]:tabular" items={[
          { key: "all", label: "Hammasi", href: qs({ transport: null }), count: [...sheetCount.values()].reduce((a, n) => a + n, 0) },
          ...sheetTabs.map(([id, plate]) => ({ key: id, label: plate, href: qs({ transport: id }), ...(sheetCount.get(id) ? { count: sheetCount.get(id) } : {}) })),
        ]} />
        {/* Qator qo'shish va qatorni tahrirlash oynasi ro'yxatlarni bitta joydan oladi */}
        <LedgerFormsProvider options={ledgerOpts} canPay={canPrice}>
          <LedgerSheet rows={ledger.rows} total={ledger.total} month={month} showDriver={!picked} showPlate={!sp.transport} canEdit={canLedger}
            file={`Hisob varag'i ${month}${picked ? ` ${picked.name}` : ""}${sp.transport ? ` ${sheetTabs.find(([id]) => id === sp.transport)?.[1] ?? ""}` : ""}`} />
          {canLedger && <div className="mt-3"><LedgerRowForm vehicleId={sp.transport ?? null} clientToken={crypto.randomUUID()} /></div>}
        </LedgerFormsProvider>
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

      {/* ── Oylik hisoblash: BARCHA haydovchi (reys haqi + qo'lda haq: oylikka / naqd) va BARCHA transport (kirim, chiqim, foyda) ── */}
      {bolim === "oylik" && <Section title={`Oylik hisoblash: ${pickedName && kesim === "haydovchi" ? `${pickedName} — ` : ""}${monthTitle(month)}`} className="mt-0" action={monthNav}>
        <Tabs scroll={false} current={kesim} className="w-fit" items={[
          { key: "haydovchi", label: "Haydovchilar", href: qs({ kesim: null }), icon: Users },
          { key: "transport", label: "Transport", href: qs({ kesim: "transport", driver: null }), icon: Truck },
        ]} />
        {kesim === "haydovchi" && <>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Oylikka (tasdiqlangan)" value={money(payTotal.payroll)} hint="oy yakuni vedomostiga tushadi" icon={Calculator} tone="success" />
          <StatCard label="Naqd berildi" value={money(payTotal.cashPaid)} hint={payTotal.cashDesk ? `kassada kutmoqda ${money(payTotal.cashDesk)}` : "kassadan"} icon={Coins} tone="info" />
          <StatCard label="Tasdiq kutmoqda" value={money(payTotal.payrollWait + payTotal.cashWait)} hint={`oylik ${money(payTotal.payrollWait)} · naqd ${money(payTotal.cashWait)}`} icon={ShieldCheck} tone={payTotal.payrollWait + payTotal.cashWait ? "warning" : "default"} href={qs({ bolim: "tasdiq" })} />
          <StatCard label="Narxsiz" value={payTotal.unpriced} hint={payTotal.unpriced ? `taklif bo'yicha ${money(payTotal.unpricedSum)}` : "hammasi narxlangan"} icon={Timer} tone={payTotal.unpriced ? "warning" : "default"} href={qs({ bolim: "narxsiz" })} />
        </div>
        {payRows.length === 0 ? <Card><Empty text="Faol haydovchi yo'q (Otdel kadr → haydovchi lavozimi)" icon={Users} /></Card> : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Hamma faol haydovchi — reysi yo&apos;q yoki ECO&apos;ga ulanmagani ham. Reys tizimga tushmagan ishni <Link href={qs({ bolim: "qolda" })} className="text-blue-700 hover:underline">«Qo&apos;lda yozuvlar»</Link> da yozing. Oklad, avans va ushlanmalar bilan to&apos;liq oylik — Ish haqi bo&apos;limida.</p>
              <ExcelButton file={`Haydovchilar oyligi ${month}`} sheets={[{ name: "Oylik hisoblash", rows: [...payRows, payTotal].map((r) => ({
                Haydovchi: r.name, ECO: r === payTotal ? "" : r.eco == null ? outsideInfo.get(r.id) ?? "" : r.eco ? "ulangan" : "ulanmagan", Transport: r.plate ?? "",
                Reys: r.trips, "Qo'lda yozuv": r.manual, "Oylikka (tasdiqlangan)": r.payroll, "Oylik — tasdiq kutmoqda": r.payrollWait,
                "Naqd berildi": r.cashPaid, "Naqd — kassada": r.cashDesk, "Naqd — tasdiq kutmoqda": r.cashWait, "Narxsiz reys": r.unpriced, "Narxsiz, taklif": r.unpricedSum,
                "Jami hisoblangan": earned(r),
              })) }]} />
            </div>
            <Card padded={false}>
              <Table>
                <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Qo&apos;lda</Th><Th right>Oylikka</Th><Th right>Oylik — tasdiqda</Th><Th right>Naqd berildi</Th><Th right>Naqd — kassada</Th><Th right>Naqd — tasdiqda</Th><Th right>Narxsiz</Th><Th right>Jami hisoblangan</Th></tr></thead>
                <tbody>
                  {[...payRows, payTotal].map((r, i, all) => {
                    const isTotal = r === payTotal;
                    const cell = (v: number, cls = "") => <Td right className={`tabular ${cls}`}>{v ? money(v) : <span className="text-slate-300">—</span>}</Td>;
                    return (
                      <Fragment key={r.id || "jami"}>
                        {r.outside && !isTotal && !all[i - 1]?.outside && (
                          <tr><td colSpan={10} className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">Ro&apos;yxatdan tashqari — shu oyda reysi yoki haqi bor (ko&apos;chadan chaqirilgan, faol emas)</td></tr>
                        )}
                        <Tr className={isTotal ? "bg-slate-50 font-semibold" : undefined}>
                          <Td>
                            {isTotal ? "Jami" : <>
                              <Link href={qs({ bolim: "oylik", driver: r.id })} scroll={false} className="font-medium hover:underline">{r.name}</Link>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                                {r.eco == null ? <Badge color="slate" dot={false}>{outsideInfo.get(r.id) ?? "ro'yxatda yo'q"}</Badge>
                                  : r.eco ? <Badge color="green" dot={false}>ECO</Badge> : <Badge color="amber" dot={false}>ECO&apos;siz</Badge>}
                                {r.plate && <span className="tabular">{r.plate}</span>}
                              </div>
                            </>}
                          </Td>
                          <Td right className="tabular">{r.trips || <span className="text-slate-300">0</span>}</Td>
                          <Td right className="tabular">{r.manual || <span className="text-slate-300">0</span>}</Td>
                          {cell(r.payroll, "font-semibold text-emerald-700")}
                          {cell(r.payrollWait, "text-amber-700")}
                          {cell(r.cashPaid)}
                          {cell(r.cashDesk, "text-blue-700")}
                          {cell(r.cashWait, "text-amber-700")}
                          <Td right className="tabular">{r.unpriced ? <span className="text-amber-700">{r.unpriced} ta · {money(r.unpricedSum)}</span> : <span className="text-slate-300">—</span>}</Td>
                          <Td right className="font-semibold tabular">{money(earned(r))}</Td>
                        </Tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
            {/* Haydovchi tanlangan: har reys — summa, to'lov turi (oylik / naqd) va holati; qo'lda yozuvlari alohida */}
            {sp.driver && pickedName && (
              <Card padded={false} className="mt-4">
                <div className="px-5 pt-5">
                  <CardHeader title={`${pickedName} — reyslar va to'lov turi`} icon={Route}
                    description="Oylik — tasdiqlangach oy yakuni vedomostiga tushadi; naqd — tasdiqlangach kassa beradi"
                    action={<Link href={qs({ driver: null })} scroll={false} className="text-sm text-blue-700 hover:underline">Hamma haydovchilar</Link>} />
                </div>
                {monthTrips.length === 0 ? <div className="px-5 pb-5 text-sm text-slate-500">Bu oyda tizimda yetkazilgan reysi yo&apos;q</div> : (
                <Table>
                  <thead><tr><Th>Sana · nakladnoy</Th><Th>Obyekt</Th><Th right>Km</Th><Th right>Reys haqi</Th><Th>To&apos;lov turi</Th><Th>Holat</Th></tr></thead>
                  <tbody>
                    {[...monthTrips].reverse().map((r) => {
                      const [color, text] = !r.pricedAt ? ["amber", "Narxsiz"] as const
                        : !r.payType ? ["green", "Oylikka (eski tartib)"] as const
                        : !r.approvedAt ? ["amber", "Tasdiq kutilmoqda"] as const
                        : r.payType === "PAYROLL" ? ["green", "Oylikka tasdiqlangan"] as const
                        : r.cashStatus === "PAID" ? ["green", "Kassa berdi"] as const : ["blue", "Kassa kutilmoqda"] as const;
                      return (
                        <Tr key={r.id}>
                          <Td className="text-sm"><Link href={`/trips/${r.id}`} className="font-medium tabular hover:underline">{r.no}</Link><div className="text-xs text-slate-500">{dateTime(r.deliveredAt)} · {r.plate}</div></Td>
                          <Td className="max-w-56 truncate text-sm">{r.customer}</Td>
                          <Td right className="tabular">{fmtNum(r.km, 0)}</Td>
                          <Td right className="tabular">{r.pricedAt ? <span className="font-semibold">{money(r.amount ?? 0)}</span> : <span className="text-slate-400" title="Tarif bo'yicha taklif">{money(r.suggested)}</span>}</Td>
                          <Td>{r.pricedAt ? <Badge color={r.payType === "CASH" ? "amber" : "blue"} dot={false}>{r.payType ? PAY_TYPE_LABEL[r.payType] : "Oylik"}</Badge> : <span className="text-slate-300">—</span>}</Td>
                          <Td><Badge color={color}>{text}</Badge>{r.rejectReason && !r.pricedAt && <div className="mt-0.5 text-[11px] text-red-600">Rad etildi: {r.rejectReason}</div>}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
                )}
                {liveEntries.some((e) => e.pay > 0) && <>
                  <div className="border-t border-slate-100 px-5 pt-4 text-sm font-semibold text-slate-700">Qo&apos;lda yozilgan haq</div>
                  <EntryTable rows={liveEntries.filter((e) => e.pay > 0)} canCancel={false} />
                </>}
              </Card>
            )}
          </>
        )}
        </>}

        {kesim === "transport" && avto && (() => {
          // Transport: kirim (dastavka haqi + qo'lda kirim), chiqim (yoqilg'i, haydovchi haqi, ta'mir/zapchast, boshqa), foyda —
          // Tahlil → Avtotransport bilan bitta manba (`avtoReport`). Ko'chadan mashina — faqat shu oyda harakati bo'lsa, pastda
          const ext = new Set(extVehicles.map((v) => v.id));
          const manualBy = new Map<string, { pay: number; rev: number }>();
          for (const e of liveEntries) {
            if (!e.vehicleId) continue;
            const x = manualBy.get(e.vehicleId) ?? { pay: 0, rev: 0 };
            x.pay += e.pay; x.rev += e.revenue; manualBy.set(e.vehicleId, x);
          }
          const noVehicle = liveEntries.filter((e) => !e.vehicleId && e.pay > 0).reduce((a, e) => a + e.pay, 0);
          const moved = (r: typeof avto.total) => r.trips || r.fuelSum || r.pay || r.repair || r.other || r.revenue;
          const rows = [...avto.rows.filter((r) => !ext.has(r.id)), ...avto.rows.filter((r) => ext.has(r.id) && moved(r))];
          const t = avto.total;
          const cell = (v: number, cls = "") => <Td right className={`tabular ${cls}`}>{v ? money(v) : <span className="text-slate-300">—</span>}</Td>;
          return (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
                <StatCard label="Kirim" value={money(t.revenue)} hint="dastavka haqi + qo'lda kirim" icon={TrendingUp} tone="success" />
                <StatCard label="Chiqim" value={money(t.total)} hint="yoqilg'i, haydovchi haqi, ta'mir, boshqa" icon={Coins} tone="warning" />
                <StatCard label="Foyda" value={money(t.profit)} icon={Calculator} tone={t.profit < 0 ? "danger" : "info"} />
                <StatCard label="Transport" value={rows.filter((r) => !ext.has(r.id)).length} hint={`${t.trips} reys · ${fmtNum(t.km, 0)} km`} icon={Truck} href="/logistika/transport" />
              </div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">Hamma faol transport — reysi yo&apos;q oyda ham. Yoqilg&apos;i — zapravka summasi; haydovchi haqi — reys haqi + qo&apos;lda haq.{noVehicle ? ` Transportsiz qo'lda haq ${money(noVehicle)} — transport foydasiga kirmaydi.` : ""}</p>
                <ExcelButton file={`Transport oylik hisobi ${month}`} sheets={[{ name: "Transport", rows: [...rows, t].map((r) => ({
                  Transport: r.plate, Turi: r.type, Reys: r.trips, Km: r.km, Kirim: r.revenue, "Shundan qo'lda kirim": manualBy.get(r.id)?.rev ?? 0,
                  "Yoqilg'i": r.fuelSum, "Haydovchi haqi": r.pay, "Shundan qo'lda haq": manualBy.get(r.id)?.pay ?? 0, "Ta'mir / zapchast": r.repair, Boshqa: r.other,
                  "Jami chiqim": r.total, Foyda: r.profit, "Ko'chadan": ext.has(r.id) ? "ha" : "",
                })) }]} />
              </div>
              <Card padded={false}>
                <Table>
                  <thead><tr><Th>Transport</Th><Th right>Reys</Th><Th right>Km</Th><Th right>Kirim</Th><Th right>Yoqilg&apos;i</Th><Th right>Haydovchi haqi</Th><Th right>Ta&apos;mir / zapchast</Th><Th right>Boshqa</Th><Th right>Jami chiqim</Th><Th right>Foyda</Th></tr></thead>
                  <tbody>
                    {[...rows, t].map((r, i, all) => {
                      const isTotal = r === t, m = manualBy.get(r.id), outside = ext.has(r.id);
                      return (
                        <Fragment key={r.id}>
                          {outside && !ext.has(all[i - 1]?.id ?? "") && (
                            <tr><td colSpan={10} className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">Ko&apos;chadan chaqirilgan mashinalar — shu oyda reysi bor</td></tr>
                          )}
                          <Tr className={isTotal ? "bg-slate-50 font-semibold" : undefined}>
                            <Td>{isTotal ? "Jami" : <><Link href={`/logistika/transport/${r.id}`} className="font-medium tabular hover:underline">{r.plate}</Link><div className="text-xs text-slate-500">{[r.type, r.model].filter(Boolean).join(" · ")}</div></>}</Td>
                            <Td right className="tabular">{r.trips || <span className="text-slate-300">0</span>}</Td>
                            <Td right className="tabular">{r.km ? fmtNum(r.km, 0) : <span className="text-slate-300">—</span>}</Td>
                            <Td right className="tabular">{r.revenue ? money(r.revenue) : <span className="text-slate-300">—</span>}{m?.rev ? <div className="text-[11px] font-normal text-slate-500">qo&apos;lda {money(m.rev)}</div> : null}</Td>
                            {cell(r.fuelSum)}
                            <Td right className="tabular">{r.pay ? money(r.pay) : <span className="text-slate-300">—</span>}{m?.pay ? <div className="text-[11px] font-normal text-slate-500">qo&apos;lda {money(m.pay)}</div> : null}</Td>
                            {cell(r.repair)}
                            {cell(r.other)}
                            {cell(r.total, "font-semibold")}
                            <Td right className={`font-semibold tabular ${r.profit < 0 ? "text-red-600" : r.profit > 0 ? "text-emerald-700" : "text-slate-400"}`}>{money(r.profit)}</Td>
                          </Tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>
              </Card>
            </>
          );
        })()}
      </Section>}

      {/* ── Qo'lda yozuvlar: reys tizimga tushmagan ish, haq va kirim (`lib/logistics-entry.ts`) + transport chiqimi ── */}
      {bolim === "qolda" && <Section title={`Qo'lda yozuvlar: ${monthTitle(month)}`} className="mt-0" action={monthNav}>
        {canPrice && opts && (
          <Card className="mb-4">
            <CardHeader title="Qo'lda yozuv: ish, haq, kirim" icon={PencilLine}
              description="Reys tizimga tushmagan ish (ECO'ga ulanmagan haydovchi, zavoddan tashqari ish), oyiga qat'iy haq yoki transport kirimi. Haq ish boshqaruvchi tasdig'idan keyin: oylik — vedomostga, naqd — kassaga" />
            <EntryForm drivers={opts.drivers.map((d) => ({ ...d, vehicleId: opts.vehicles.find((v) => v.driverId === d.id)?.id ?? null }))} vehicles={opts.vehicles} clientToken={crypto.randomUUID()} />
          </Card>
        )}
        {canExpense && opts && (
          <Card className="mb-4">
            <CardHeader title="Transport chiqimi" icon={Wrench} description="Ta'mir, zapchast, yo'l, jarima va boshqalar — Transport xarajatlariga yoziladi (Avtotransport tahlili va transport kartasi bilan bitta manba)" />
            <ExpenseForm vehicles={opts.vehicles} drivers={opts.drivers} trips={opts.trips} />
          </Card>
        )}
        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader title={`${monthTitle(month)} — qo'lda yozuvlar`} icon={FileSpreadsheet}
              description={`Haq: ${money(liveEntries.reduce((a, e) => a + e.pay, 0))} · kirim: ${money(liveEntries.reduce((a, e) => a + e.revenue, 0))}. Yozuv o'chirilmaydi — bekor qilinadi (sababi bilan)`} />
          </div>
          {monthEntries.length === 0 ? <Empty text="Bu oyda qo'lda yozuv yo'q" icon={PencilLine} /> : <EntryTable rows={monthEntries} canCancel={canPrice} edit={canPrice && opts ? { drivers: opts.drivers, vehicles: opts.vehicles.map((v) => ({ id: v.id, label: v.label })) } : null} />}
        </Card>
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

/**
 * Hisob varag'i: tab va qo'lda qator formasi uchun — faol o'z transporti (asosiy haydovchi, yoqilg'i normasi, oxirgi
 * zapravka narxi), haydovchilar va oldingi qo'lda qatorlardagi joy/yuk nomlari (taklif ro'yxati).
 */
async function ledgerOptions(withForm: boolean): Promise<LedgerOptions> {
  const [list, drivers, recent, sites, prices] = await Promise.all([
    db.vehicle.findMany({
      where: { isActive: true, external: false, hiddenAt: null }, orderBy: { plate: "asc" },
      select: { id: true, plate: true, mainDriverId: true, fuelType: true, fuelNormL100: true, idleNormPerHour: true, gasNormPer100: true, gasIdlePerHour: true, drivers: { where: { isActive: true }, select: { id: true } } },
    }),
    withForm ? driverEmployees({ activeOnly: true }) : Promise.resolve([]),
    withForm ? db.logisticsEntry.findMany({ where: { cancelledAt: null, OR: [{ pickup: { not: null } }, { dropoff: { not: null } }, { cargo: { not: null } }] }, orderBy: { createdAt: "desc" }, take: 300, select: { pickup: true, dropoff: true, cargo: true } }) : Promise.resolve([]),
    withForm ? db.site.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true }, take: 500 }) : Promise.resolve([]),
    withForm ? db.fuelLog.findMany({ where: { cancelledAt: null, pricePerL: { gt: 0 } }, orderBy: { date: "desc" }, distinct: ["fuelType"], select: { fuelType: true, pricePerL: true } }) : Promise.resolve([]),
  ]);
  const price = new Map(prices.map((p) => [p.fuelType, Number(p.pricePerL)]));
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x?.trim()))].slice(0, 200);
  return {
    vehicles: list.map((v) => {
      const dual = v.fuelType === "DIESEL_METHANE", gas = dual || v.fuelType === "METHANE";
      return {
        id: v.id, plate: v.plate, driverId: mainDriverOf(v)?.id ?? null, unit: gas ? "m³" : "l",
        per100: Number((dual ? v.gasNormPer100 : v.fuelNormL100) ?? 0), perHour: Number((dual ? v.gasIdlePerHour : v.idleNormPerHour) ?? 0),
        lastPrice: price.get(gas ? "METHANE" : v.fuelType ?? "DIESEL") ?? null,
      };
    }),
    drivers: drivers.map((d) => ({ id: d.id, name: d.fullName })),
    pickups: uniq(["Zavod", ...recent.map((r) => r.pickup)]),
    dropoffs: uniq([...recent.map((r) => r.dropoff), ...sites.map((x) => x.name)]),
    cargos: uniq(recent.map((r) => r.cargo)),
  };
}
