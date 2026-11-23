import { db } from "@/lib/db";
import type { HrCallStatus, Prisma } from "@/generated/prisma";
import { canDo } from "@/lib/permissions";
import { dateRu, fmtNum, isoDate, opAt, time } from "@/lib/format";
import { driverLedger } from "@/lib/driver-ledger";
import { ledgerEditData, ledgerEditSchema, isLedgerKind, updateLedgerRow, type LedgerEditData } from "@/lib/ledger-edit";
import { PAY_TYPE_LABEL as DRIVER_PAY_LABEL, PAY_TYPES } from "@/lib/driver-trip-pay";
import { LEDGER_REVENUE_LABEL, LEDGER_REVENUE_TYPES } from "@/lib/ledger-revenue";
import { LOGI_EXPENSE, LOGI_INCOME, LOGI_TRANSFER_IN, addLogiTx, canSeeLogiMoney, cancelLogiTx, logiAccounts, paySourceLabel, paySources } from "@/lib/logistics-finance";
import { dispatcherStock } from "@/lib/dispatcher-stock";
import { realizationRows } from "@/lib/realization";
import { PERIOD_SECTIONS, periodMonthLabel } from "@/lib/period-sections";
import { closePeriod, reopenPeriod } from "@/lib/period-close";
import { addMonths, monthKeyOf } from "@/lib/fin-report/period";
import { LOAN_KIND_LABEL, loanBalances } from "@/lib/fin-report/loans";
import { activeAssets, assetStateAt } from "@/lib/fin-report/assets";
import { CALL_STATUSES, CALL_STATUS_LABEL } from "@/lib/hr/labels";
import { listDebts } from "@/lib/hr/employee-debt";
import { dayUtc, validDay } from "@/lib/davomat";
import { normalizePhone } from "@/lib/phone";
import { audit } from "@/lib/audit";
import { accountBalance, tashkentDay } from "@/lib/nazorat/checks";
import type { MobileUser } from "./auth";
import type { CreateForm, CreateResult } from "./create";
import type { DetailAction, DetailField, FormField, FormOption, MobileDetail } from "./detail";
import type { HomeRow, Tone } from "./home";
import { ListError, SKLAD_PERIODS, skladPeriod, type ListFilter, type MobileList } from "./list";
import { money, short } from "./fmt";

/* ───────────────────────── Vebdan ko'chirilgan bo'limlar (`./port-access.ts`) ─────────────────────────
 * Mantiq vebdagi bilan bitta: hisob-kitob va qoidalar `lib/*` da, bu yerda — ilova uchun ro'yxat, kartochka va forma.
 * Ruxsat: ro'yxat — `list.ts` ACCESS (rol + direktor bergan modul), amal — `detail.ts` `can` (veb katalog), forma — `create.ts`.
 */

const TAKE = 300;
const n = (v: unknown) => Number(v ?? 0);
const who = (u: MobileUser) => ({ role: u.role, perms: u.perms });
const fail = (msg: string, status = 400): never => { throw new ListError("BAD_REQUEST", msg, status); };
const opt = (label: string, v: string | null | undefined): DetailField[] => (v ? [{ label, value: v }] : []);
const periodChips = (pk: string): ListFilter[] => SKLAD_PERIODS.map((x) => ({ key: x.key, label: x.label, active: x.key === pk }));
const like = (q: string) => ({ contains: q, mode: "insensitive" as const });
const str = (v: unknown) => (v == null ? "" : String(v)).trim();
/** Transport raqamlari (id → raqam): `LogisticsTx` da relatsiya yo'q. */
async function plateMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  return new Map((await db.vehicle.findMany({ where: { id: { in: list } }, select: { id: true, plate: true } })).map((v) => [v.id, v.plate]));
}

// Hisob varag'i qatori id'si: `turi~id` (reyssiz kun id'sidagi «:» — «|»: `splitRef` uni kartochka kaliti deb o'qimasin)
const ledgerId = (kind: string, id: string) => `${kind}~${id.replace(/:/g, "|")}`;
function parseLedgerId(raw: string): { kind: "trip" | "entry" | "cost"; id: string } {
  const i = raw.indexOf("~");
  const kind = raw.slice(0, i), id = raw.slice(i + 1).replace(/\|/g, ":");
  if (i < 1 || !isLedgerKind(kind)) fail("Qator topilmadi", 404);
  return { kind: kind as "trip" | "entry" | "cost", id };
}

/* ══════════════════════ Ro'yxatlar ══════════════════════ */

export async function portList(user: MobileUser, key: string, title: string, q?: string, filter?: string): Promise<MobileList> {
  switch (key) {
    case "ledger": return ledgerList(user, title, q, filter);
    case "logi-moliya": return logiList(user, title, q, filter);
    case "disp-stock": return dispList(title, q);
    case "real-reestr": return realList(title, q, filter);
    case "oy-yopish": return periodList(title);
    case "loans": return loansList(title, q);
    case "assets": return assetsList(title, q);
    case "pay-plan": return planList(title);
    case "hr-calls": return callsList(title, q, filter);
    case "emp-debts": return debtsList(title, q, filter);
    case "teams": return teamsList(title, q);
  }
  return fail("Bunday ro'yxat yo'q", 404);
}

async function ledgerList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const p = skladPeriod(filter);
  const { rows } = await driverLedger(p.from, p.to);
  const ql = q?.toLowerCase();
  const list = rows
    .filter((r) => !ql || [r.plate, r.driver, r.pickup, r.dropoff, r.cargo, r.no].some((x) => x?.toLowerCase().includes(ql)))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const pay = list.reduce((s, r) => s + r.pay, 0);
  return {
    key: "ledger", title: `${title} · ${p.range}${pay ? ` · haq ${short(pay)}` : ""}`,
    rows: list.slice(0, TAKE).map((r) => ({
      id: ledgerId(r.kind, r.id),
      title: `${dateRu(r.at)} · ${r.plate}${r.driver ? ` · ${r.driver}` : ""}`,
      subtitle: [r.kind === "cost" ? "Reyssiz kun" : `${r.pickup || "—"} → ${r.dropoff || r.address || "—"}`, r.km ? `${fmtNum(r.km, 1)} km` : null, r.trips > 1 ? `${r.trips} reys` : null, r.no || null].filter(Boolean).join(" · "),
      right: r.pay ? money(r.pay) : r.total ? money(r.total) : undefined,
      tone: (r.kind === "entry" ? "info" : r.kind === "cost" ? "warning" : undefined) as Tone,
    })),
    filters: periodChips(p.key),
  };
}

async function logiList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const p = skladPeriod(filter);
  const where: Prisma.LogisticsTxWhereInput = {
    date: { gte: p.from, lt: p.to },
    ...(q ? { OR: [{ category: like(q) }, { counterparty: like(q) }, { note: like(q) }, { docNo: like(q) }] } : {}),
  };
  const [tx, acc] = await Promise.all([
    db.logisticsTx.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: TAKE, include: { account: { select: { name: true } } } }),
    logiAccounts(),
  ]);
  const plates = await plateMap(tx.map((t) => t.vehicleId));
  const seeMoney = canSeeLogiMoney(who(user));
  const total = acc.reduce((s, a) => s + a.balance, 0);
  return {
    key: "logi-moliya", title: seeMoney ? `${title} · qoldiq ${short(total)}` : title,
    rows: tx.map((t) => ({
      id: t.id,
      title: `${t.type === "EXPENSE" ? "Chiqim" : "Kirim"} · ${t.category}`,
      subtitle: [opAt(t.date, t.createdAt), t.account?.name, t.vehicleId ? plates.get(t.vehicleId) : null, t.counterparty, t.docNo].filter(Boolean).join(" · "),
      right: seeMoney ? `${t.type === "EXPENSE" ? "−" : "+"}${money(n(t.amount))}` : undefined,
      tone: (t.cancelledAt ? undefined : t.type === "EXPENSE" ? "danger" : "success") as Tone | undefined,
      ...(t.cancelledAt ? { status: "Bekor" } : {}),
    })),
    filters: periodChips(p.key),
  };
}

async function dispList(title: string, q?: string): Promise<MobileList> {
  const { rows } = await dispatcherStock();
  const ql = q?.toLowerCase();
  const list = rows.filter((r) => !ql || r.name.toLowerCase().includes(ql) || r.code?.toLowerCase().includes(ql))
    .sort((a, b) => Math.abs(b.held) - Math.abs(a.held) || a.name.localeCompare(b.name));
  return {
    key: "disp-stock", title: `${title} · ${list.filter((r) => Math.abs(r.held) > 0.0005).length} xil dispetcherda`,
    rows: list.slice(0, TAKE).map((r) => ({
      id: r.id, title: r.name,
      subtitle: [r.code, `skladda ${fmtNum(r.inStock, 3)} ${r.unit}`].filter(Boolean).join(" · "),
      right: `${fmtNum(r.held, 3)} ${r.unit}`, tone: (r.held > 0 ? "info" : undefined) as Tone,
    })),
  };
}

async function realList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const p = skladPeriod(filter);
  const rows = await realizationRows(p.from, p.to);
  const ql = q?.toLowerCase();
  const list = rows.filter((r) => !ql || [r.customer, r.product, r.ttn, r.vehicle, r.address].some((x) => x?.toLowerCase().includes(ql)))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const total = list.reduce((s, r) => s + r.total, 0);
  return {
    key: "real-reestr", title: `${title} · ${p.range} · ${short(total)}`,
    rows: list.slice(0, TAKE).map((r) => ({
      id: `${isoDate(r.date)}~${r.key}`,
      title: `${r.customer} · ${r.product}`,
      subtitle: [dateRu(r.date), `${fmtNum(r.qty, 3)} ${r.unit}`, r.payLabel, r.ttn ? `TTN ${r.ttn}` : null, r.vehicle].filter(Boolean).join(" · "),
      right: money(r.total), tone: "success" as Tone,
    })),
    filters: periodChips(p.key),
  };
}

const PERIOD_MONTHS = 6;
const lastMonths = () => { const cur = monthKeyOf(new Date()); return Array.from({ length: PERIOD_MONTHS }, (_, i) => addMonths(cur, -1 - i)); };

async function periodList(title: string): Promise<MobileList> {
  const months = lastMonths();
  const rows = await db.periodClose.findMany({ where: { month: { in: months } }, select: { section: true, month: true } });
  return {
    key: "oy-yopish", title,
    rows: months.map((m) => {
      const closed = PERIOD_SECTIONS.filter((s) => rows.some((r) => r.month === m && r.section === s.key));
      const all = closed.length === PERIOD_SECTIONS.length;
      return {
        id: m, title: periodMonthLabel(m),
        subtitle: closed.length ? (all ? "Hamma bo'lim yopiq" : `Yopiq: ${closed.map((s) => s.short).join(", ")}`) : "Hamma bo'lim ochiq",
        right: `${closed.length}/${PERIOD_SECTIONS.length}`, tone: (all ? "success" : closed.length ? "warning" : undefined) as Tone,
      };
    }),
  };
}

async function loansList(title: string, q?: string): Promise<MobileList> {
  const ql = q?.toLowerCase();
  const list = (await loanBalances()).filter((l) => !ql || l.name.toLowerCase().includes(ql) || l.counterparty.toLowerCase().includes(ql))
    .sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt) || b.balance - a.balance);
  return {
    key: "loans", title: `${title} · ${list.filter((l) => !l.closedAt).length} ta faol`,
    rows: list.map((l) => ({
      id: l.id, title: l.name, subtitle: [LOAN_KIND_LABEL[l.kind], l.counterparty, l.closedAt ? "yopilgan" : null].filter(Boolean).join(" · "),
      right: money(l.balance), tone: (l.closedAt ? undefined : l.kind === "LENT" ? "info" : "warning") as Tone,
    })),
  };
}

async function assetsList(title: string, q?: string): Promise<MobileList> {
  const now = monthKeyOf(new Date());
  const ql = q?.toLowerCase();
  const list = (await activeAssets()).filter((a) => !ql || a.name.toLowerCase().includes(ql) || a.group.toLowerCase().includes(ql));
  const net = list.reduce((s, a) => s + assetStateAt(a, now).net, 0);
  return {
    key: "assets", title: `${title} · qoldiq qiymat ${short(net)}`,
    rows: list.map((a) => ({
      id: a.id, title: a.name, subtitle: [a.group, `olingan ${dateRu(a.acquiredAt)}`, a.disposedAt ? "chiqarilgan" : null].filter(Boolean).join(" · "),
      right: money(assetStateAt(a, now).net), tone: (a.disposedAt ? undefined : "info") as Tone,
    })),
  };
}

async function planList(title: string): Promise<MobileList> {
  const [flows, rec] = await Promise.all([
    db.plannedFlow.findMany({ where: { status: "PLANNED" }, orderBy: { date: "asc" }, take: TAKE }),
    db.recurringPayment.findMany({ where: { isActive: true, cancelledAt: null }, orderBy: { dayOfMonth: "asc" } }),
  ]);
  return {
    key: "pay-plan", title: `${title} · ${flows.length} reja, ${rec.length} doimiy`,
    rows: [
      ...flows.map((f) => ({
        id: `f~${f.id}`, title: `${f.type === "EXPENSE" ? "To'lov" : "Tushum"} · ${f.counterparty}`,
        subtitle: [dateRu(f.date), f.category, f.note].filter(Boolean).join(" · "),
        right: money(n(f.amount)), tone: (f.type === "EXPENSE" ? "danger" : "success") as Tone,
      })),
      ...rec.map((r) => ({
        id: `r~${r.id}`, title: `Har oy ${r.dayOfMonth}-sanada · ${r.name}`, subtitle: [r.category, r.note].filter(Boolean).join(" · "),
        right: money(n(r.amount)), tone: "warning" as Tone,
      })),
    ],
  };
}

const CALL_TONE: Record<HrCallStatus, Tone | undefined> = { WAITING: "warning", CAME: "info", NO_SHOW: "danger", NO_ANSWER: undefined, HIRED: "success" };

async function callsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const st = CALL_STATUSES.find((s) => s === filter);
  const where: Prisma.HrCallLogWhereInput = {
    ...(st ? { status: st } : {}),
    ...(q ? { OR: [{ fullName: like(q) }, { phone: { contains: q.replace(/\D+/g, "") || q } }, { position: like(q) }, { address: like(q) }] } : {}),
  };
  const [rows, counts] = await Promise.all([
    db.hrCallLog.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: TAKE }),
    db.hrCallLog.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const cnt = (s: HrCallStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  return {
    key: "hr-calls", title,
    rows: rows.map((r) => ({
      id: r.id, title: `${r.fullName || r.phone || "—"} · ${r.position}`,
      subtitle: [dateRu(r.date), r.phone, r.age ? `${r.age} yosh` : null, r.visitDate ? `suhbat ${dateRu(r.visitDate)}` : null, r.reason].filter(Boolean).join(" · "),
      status: CALL_STATUS_LABEL[r.status], tone: CALL_TONE[r.status],
    })),
    filters: [{ key: "all", label: "Hammasi", active: !st }, ...CALL_STATUSES.map((s) => ({ key: s, label: CALL_STATUS_LABEL[s], count: cnt(s), active: st === s }))],
  };
}

async function debtsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const ql = q?.toLowerCase();
  const open = filter !== "all";
  const list = (await listDebts()).filter((d) => (!open || (!d.cancelledAt && d.left > 0)) && (!ql || d.employee.fullName.toLowerCase().includes(ql)));
  return {
    key: "emp-debts", title: `${title} · qoldiq ${short(list.reduce((s, d) => s + d.left, 0))}`,
    rows: list.map((d) => ({
      id: d.id, title: d.employee.fullName,
      subtitle: [d.employee.position, `${d.months} oy · ${d.startMonth} — ${d.endMonth}`, `oyiga ${money(d.monthly)}`].filter(Boolean).join(" · "),
      right: money(d.left), tone: (d.cancelledAt ? undefined : d.left > 0 ? "warning" : "success") as Tone,
      ...(d.cancelledAt ? { status: "Bekor" } : {}),
    })),
    filters: [{ key: "open", label: "Ushlanmoqda", active: open }, { key: "all", label: "Hammasi", active: !open }],
  };
}

async function teamsList(title: string, q?: string): Promise<MobileList> {
  const teams = await db.team.findMany({
    where: { ...(q ? { name: like(q) } : {}) }, orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { leader: { select: { fullName: true } }, _count: { select: { members: true } } },
  });
  return {
    key: "teams", title: `${title} · ${teams.filter((t) => t.isActive).length} ta`,
    rows: teams.map((t) => ({
      id: t.id, title: t.name, subtitle: [t.leader ? `brigadir ${t.leader.fullName}` : null, t.phone].filter(Boolean).join(" · "),
      right: `${t._count.members} kishi`, tone: (t.isActive ? "info" : undefined) as Tone | undefined, ...(t.isActive ? {} : { status: "Nofaol" }),
    })),
  };
}

/* ══════════════════════ Kartochkalar ══════════════════════ */

export async function portDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  switch (key) {
    case "ledger": return ledgerDetail(user, id);
    case "logi-moliya": return logiDetail(user, id);
    case "disp-stock": return dispDetail(id);
    case "real-reestr": return realDetail(id);
    case "oy-yopish": return periodDetail(user, id);
    case "loans": return loanDetail(id);
    case "assets": return assetDetail(id);
    case "pay-plan": return planDetail(id);
    case "hr-calls": return callDetail(user, id);
    case "emp-debts": return debtDetail(id);
    case "teams": return teamDetail(id);
  }
  return fail("Bunday kartochka yo'q", 404);
}

const numF = (name: string, label: string, v: number | null | undefined): FormField => ({ name, label, type: "number", value: v == null ? "" : String(v) });
const textF = (name: string, label: string, v: string | null | undefined): FormField => ({ name, label, type: "text", value: v ?? "" });

/** Tahrir formasi: qator turiga qarab vebdagi qalam oynasi maydonlari (qiymatlari bilan). */
function ledgerForm(d: LedgerEditData, canPay: boolean): FormField[] {
  const payType: FormField = { name: "payType", label: "Haq turi", type: "select", value: d.payType ?? "", options: [{ value: "", label: "—" }, ...PAY_TYPES.map((t) => ({ value: t, label: DRIVER_PAY_LABEL[t] }))] };
  const costs = [numF("refuel", `Zapravka, ${d.unit}`, d.refuel), numF("fuelPrice", "Yoqilg'i narxi", d.fuelPrice ?? d.lastPrice), numF("repair", "Ta'mir", d.repair), numF("parts", "Zapchast", d.parts), numF("vulc", "Vulkanizatsiya", d.vulc), numF("other", "Boshqa xarajat", d.other)];
  if (d.kind === "cost") return [...costs, textF("note", "Izoh", d.note)];
  // Taklif summa maydonga yozilmaydi (aks holda to'lov turi so'raladi) — yorliqda ko'rinadi, kerak bo'lsa qo'lda kiritiladi
  const payLabel = d.pay == null && d.suggested ? `Haydovchi haqi (taklif ${money(d.suggested)})` : "Haydovchi haqi";
  const pay = canPay && !d.payLock ? [numF("payAmount", payLabel, d.pay), payType] : [];
  if (d.kind === "trip") return [textF("pickup", "Yuklash joyi", d.pickup), numF("km", "Km", d.km), numF("drumHours", "Baraban soati", d.hours), ...pay, ...(pay.length && d.priced ? [textF("payReason", "Haq o'zgarsa — sababi", "")] : []), ...costs, textF("note", "Izoh", d.note)];
  return [
    { name: "date", label: "Sana", type: "date", value: d.date },
    numF("trips", "Reys soni", d.trips), textF("pickup", "Yuklash joyi", d.pickup), textF("dropoff", "Tushirish joyi", d.dropoff), textF("cargo", "Yuk", d.cargo),
    numF("km", "Km", d.km), numF("drumHours", "Baraban soati", d.hours), ...pay,
    numF("revenue", "Kirim (bajarilgan ish)", d.revenue || null),
    { name: "revenueType", label: "Kirim turi", type: "select", value: d.revenueType ?? "", options: [{ value: "", label: "—" }, ...LEDGER_REVENUE_TYPES.map((t) => ({ value: t, label: LEDGER_REVENUE_LABEL[t] }))] },
    ...costs, textF("note", "Izoh", d.note),
  ];
}
/** Formada yo'q maydonlar qatorning hozirgi qiymati bilan to'ldiriladi — bo'sh qoldirilgan ustun 0 bo'lib ketmasin. */
function ledgerInput(d: LedgerEditData, payload: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    date: d.date, driverId: d.driverId ?? "", vehicleId: d.vehicleId, trips: d.trips, km: d.km, payAmount: d.pay ?? "", payType: d.payType ?? "",
    revenue: d.revenue || "", revenueType: d.revenueType ?? "", pickup: d.pickup, dropoff: d.dropoff, cargo: d.cargo, drumHours: d.hours ?? "",
    kmGas: d.kmGas ?? "", drumHoursGas: d.hoursGas ?? "", refuel: d.refuel, fuelPrice: d.fuelPrice ?? "", repair: d.repair, parts: d.parts, vulc: d.vulc, other: d.other, note: d.note,
  };
  for (const [k, v] of Object.entries(payload)) if (v !== undefined) base[k] = v;
  return base;
}

async function ledgerDetail(user: MobileUser, raw: string): Promise<MobileDetail> {
  const { kind, id } = parseLedgerId(raw);
  const d = await ledgerEditData(kind, id);
  if ("error" in d) fail(d.error, 404);
  const r = d as LedgerEditData;
  const seeMoney = canSeeLogiMoney(who(user));
  const canPay = canDo(who(user), "logistika", "pay");
  const actions: DetailAction[] = canDo(who(user), "logistika", "ledger")
    ? [{ id: "ledger.edit", label: "Tahrirlash", tone: "brand", form: ledgerForm(r, canPay) }]
    : [];
  return {
    key: "ledger", id: raw, title: `${r.plate} · ${r.dateText}`, subtitle: [r.no, r.driver].filter(Boolean).join(" · "),
    status: kind === "trip" ? "Reys" : kind === "entry" ? "Qo'lda qator" : "Reyssiz kun",
    fields: [
      ...opt("Yuklash", r.pickup), ...opt("Tushirish", r.dropoff || r.address), ...opt("Yuk", r.cargo),
      ...(r.trips ? [{ label: "Reys soni", value: String(r.trips) }] : []),
      { label: "Km", value: fmtNum(r.km, 1) },
      ...(r.hours != null ? [{ label: "Baraban soati", value: fmtNum(r.hours, 1) }] : []),
      ...(r.refuel ? [{ label: "Zapravka", value: `${fmtNum(r.refuel, 1)} ${r.unit}` }] : []),
      { label: "Haydovchi haqi", value: r.pay != null ? `${money(r.pay)}${r.payType ? ` · ${DRIVER_PAY_LABEL[r.payType]}` : ""}` : r.suggested ? `taklif ${money(r.suggested)}` : "—", tone: r.approved ? "success" : undefined },
      ...(r.payLock ? [{ label: "Haq qotgan", value: r.payLock, tone: "warning" as Tone }] : []),
      ...(r.repair + r.parts + r.vulc + r.other ? [{ label: "Xarajatlar", value: money(r.repair + r.parts + r.vulc + r.other) }] : []),
      ...(seeMoney && r.revenue ? [{ label: "Bajarilgan ish", value: `${money(r.revenue)}${r.revenueType ? ` · ${LEDGER_REVENUE_LABEL[r.revenueType]}` : ""}` }] : []),
      ...opt("Izoh", r.note),
    ],
    sections: [], actions,
  };
}

async function logiDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.logisticsTx.findUnique({ where: { id }, include: { account: { select: { name: true } } } });
  if (!t) return fail("Yozuv topilmadi", 404);
  const [plates, driver, author] = await Promise.all([
    plateMap([t.vehicleId]),
    t.driverId ? db.employee.findUnique({ where: { id: t.driverId }, select: { fullName: true } }) : null,
    db.user.findUnique({ where: { id: t.createdById }, select: { fullName: true } }),
  ]);
  const seeMoney = canSeeLogiMoney(who(user));
  const actions: DetailAction[] = !t.cancelledAt && canDo(who(user), "logistika", "fin_write")
    ? [{ id: "logitx.cancel", label: "Bekor qilish", tone: "danger", confirm: `${t.docNo} bekor qilinsinmi?`, form: [{ name: "reason", label: "Sabab", type: "text", required: true }] }]
    : [];
  return {
    key: "logi-moliya", id: t.id, title: `${t.type === "EXPENSE" ? "Chiqim" : "Kirim"} · ${t.category}`, subtitle: `${t.docNo} · ${dateRu(t.date)}`,
    status: t.cancelledAt ? "Bekor qilingan" : undefined,
    fields: [
      ...(seeMoney ? [{ label: "Summa", value: money(n(t.amount)), tone: (t.type === "EXPENSE" ? "danger" : "success") as Tone }] : []),
      ...opt("Hisob", t.account?.name), ...opt("Transport", t.vehicleId ? plates.get(t.vehicleId) : null), ...opt("Haydovchi", driver?.fullName),
      ...opt("Kimdan / kimga", t.counterparty), ...opt("Izoh", t.note), ...opt("Bekor sababi", t.cancelReason),
      { label: "Yozdi", value: `${author?.fullName ?? "—"} · ${dateRu(t.createdAt)} ${time(t.createdAt)}` },
    ],
    sections: [], actions,
  };
}

async function dispDetail(id: string): Promise<MobileDetail> {
  const { warehouses, rows } = await dispatcherStock();
  const r = rows.find((x) => x.id === id);
  if (!r) return fail("Mahsulot topilmadi", 404);
  return {
    key: "disp-stock", id, title: r.name, subtitle: [r.code, r.unit].filter(Boolean).join(" · "),
    fields: [
      { label: "Dispetcherda", value: `${fmtNum(r.held, 3)} ${r.unit}`, tone: "brand" },
      { label: "Skladlarda jami", value: `${fmtNum(r.inStock, 3)} ${r.unit}` },
      ...warehouses.filter((w) => Math.abs(r.byWh[w.id] ?? 0) > 0.0005).map((w) => ({ label: w.name, value: `${fmtNum(r.byWh[w.id] ?? 0, 3)} ${r.unit}` })),
      ...(r.price != null ? [{ label: "Narx", value: money(r.price) }] : []),
    ],
    sections: [], actions: [],
  };
}

async function realDetail(raw: string): Promise<MobileDetail> {
  const i = raw.indexOf("~");
  const day = raw.slice(0, i), key = raw.slice(i + 1);
  if (!validDay(day)) return fail("Qator topilmadi", 404);
  const from = new Date(`${day}T00:00:00`), to = new Date(from); to.setDate(to.getDate() + 1);
  const r = (await realizationRows(from, to)).find((x) => x.key === key);
  if (!r) return fail("Qator topilmadi", 404);
  return {
    key: "real-reestr", id: raw, title: r.product, subtitle: `${r.customer} · ${dateRu(r.date)}`,
    fields: [
      { label: "Miqdor", value: `${fmtNum(r.qty, 3)} ${r.unit}` }, { label: "Narx", value: money(r.price) },
      ...(r.delivery ? [{ label: "Dastavka", value: money(r.delivery) }] : []),
      { label: "Summa (QQS'siz)", value: money(r.net) }, { label: "QQS", value: money(r.vat) },
      { label: "Jami", value: money(r.total), tone: "brand" }, { label: "To'lov", value: r.payLabel },
      ...opt("Sotuvchi", r.seller), ...opt("TTN", r.ttn), ...opt("Mashina", r.vehicle), ...opt("Haydovchi", r.driver), ...opt("Ortilgan joy", r.loadPlace),
      ...opt("Manzil", r.address), ...opt("Telefon", r.phone), ...opt("Shartnoma", r.contractNo), ...opt("Schyot-faktura", r.invoiceNo),
    ],
    sections: [], actions: [],
  };
}

async function periodDetail(user: MobileUser, month: string): Promise<MobileDetail> {
  if (!lastMonths().includes(month)) return fail("Oy topilmadi", 404);
  const rows = await db.periodClose.findMany({ where: { month } });
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.closedById) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const closed = new Map(rows.map((r) => [r.section, r]));
  const open = PERIOD_SECTIONS.filter((s) => !closed.has(s.key));
  const shut = PERIOD_SECTIONS.filter((s) => closed.has(s.key));
  const opts = (list: typeof open): FormOption[] => list.map((s) => ({ value: s.key, label: s.label }));
  const actions: DetailAction[] = [];
  if (open.length && canDo(who(user), "moliya", "period_close")) {
    actions.push({ id: "period.close", label: "Bo'limni yopish", tone: "brand", form: [{ name: "section", label: "Bo'lim", type: "select", required: true, options: opts(open) }] });
    if (open.length > 1) actions.push({ id: "period.closeall", label: "Hammasini yopish", tone: "warning", confirm: `${periodMonthLabel(month)} — ochiq ${open.length} ta bo'lim yopilsinmi?` });
  }
  if (shut.length && canDo(who(user), "moliya", "period_reopen")) {
    actions.push({ id: "period.reopen", label: "Oyni ochish", tone: "danger", form: [
      { name: "section", label: "Bo'lim", type: "select", required: true, options: opts(shut) },
      { name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nima uchun ochilyapti" },
    ] });
  }
  return {
    key: "oy-yopish", id: month, title: periodMonthLabel(month), subtitle: `${shut.length} / ${PERIOD_SECTIONS.length} bo'lim yopiq`,
    fields: PERIOD_SECTIONS.map((s) => {
      const r = closed.get(s.key);
      return { label: s.label, value: r ? `Yopiq · ${names.get(r.closedById) ?? "—"} · ${dateRu(r.closedAt)}` : "Ochiq", tone: (r ? "success" : undefined) as Tone };
    }),
    sections: [], actions,
  };
}

async function loanDetail(id: string): Promise<MobileDetail> {
  const l = (await loanBalances()).find((x) => x.id === id);
  if (!l) return fail("Kredit topilmadi", 404);
  return {
    key: "loans", id, title: l.name, subtitle: `${LOAN_KIND_LABEL[l.kind]} · ${l.counterparty}`, status: l.closedAt ? "Yopilgan" : undefined,
    fields: [
      { label: "Qoldiq", value: money(l.balance), tone: "brand" },
      { label: "Boshlang'ich", value: `${money(l.opening)} · ${dateRu(l.openingDate)}` },
      { label: l.kind === "LENT" ? "Berildi" : "Olindi", value: money(l.principalIn) },
      { label: l.kind === "LENT" ? "Qaytdi" : "Qaytarildi", value: money(l.principalOut) },
      ...(l.interestPaid ? [{ label: "Foiz to'langan", value: money(l.interestPaid) }] : []),
      ...(l.rate != null ? [{ label: "Foiz stavkasi", value: `${fmtNum(l.rate, 2)}%` }] : []),
      ...opt("Izoh", l.note),
    ],
    sections: [], actions: [],
  };
}

async function assetDetail(id: string): Promise<MobileDetail> {
  const a = (await activeAssets()).find((x) => x.id === id);
  if (!a) return fail("Vosita topilmadi", 404);
  const st = assetStateAt(a, monthKeyOf(new Date()));
  return {
    key: "assets", id, title: a.name, subtitle: `${a.group} · olingan ${dateRu(a.acquiredAt)}`, status: a.disposedAt ? "Chiqarilgan" : undefined,
    fields: [
      { label: "Boshlang'ich qiymat", value: money(a.cost) },
      { label: "Yig'ilgan amortizatsiya", value: money(st.accumulated) },
      { label: "Qoldiq qiymat", value: money(st.net), tone: "brand" },
      { label: "Muddat", value: `${a.lifeMonths} oy` },
      ...(a.disposedAt ? [{ label: "Chiqarilgan", value: dateRu(a.disposedAt) }] : []),
    ],
    sections: [], actions: [],
  };
}

async function planDetail(raw: string): Promise<MobileDetail> {
  const [k, id] = [raw.slice(0, 1), raw.slice(2)];
  if (k === "f") {
    const f = await db.plannedFlow.findUnique({ where: { id } });
    if (!f) return fail("Reja topilmadi", 404);
    return {
      key: "pay-plan", id: raw, title: `${f.type === "EXPENSE" ? "To'lov" : "Tushum"} · ${f.counterparty}`, subtitle: dateRu(f.date),
      fields: [{ label: "Summa", value: money(n(f.amount)), tone: "brand" }, ...opt("Kategoriya", f.category), ...opt("Izoh", f.note)],
      sections: [], actions: [],
    };
  }
  const r = await db.recurringPayment.findUnique({ where: { id } });
  if (!r) return fail("To'lov topilmadi", 404);
  return {
    key: "pay-plan", id: raw, title: r.name, subtitle: `Har oy ${r.dayOfMonth}-sanada`,
    fields: [{ label: "Summa", value: money(n(r.amount)), tone: "brand" }, { label: "Kategoriya", value: r.category }, ...opt("Izoh", r.note)],
    sections: [], actions: [],
  };
}

async function callDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = await db.hrCallLog.findUnique({ where: { id } });
  if (!r) return fail("Yozuv topilmadi", 404);
  const author = await db.user.findUnique({ where: { id: r.createdById }, select: { fullName: true } });
  const actions: DetailAction[] = canDo(who(user), "employees", "calls")
    ? [{ id: "hrcall.status", label: "Holatni o'zgartirish", tone: "brand", form: [{ name: "status", label: "Holat", type: "select", required: true, value: r.status, options: CALL_STATUSES.map((s) => ({ value: s, label: CALL_STATUS_LABEL[s] })) }] }]
    : [];
  return {
    key: "hr-calls", id, title: r.fullName || r.phone || "—", subtitle: `${r.position} · ${dateRu(r.date)}`, status: CALL_STATUS_LABEL[r.status],
    fields: [
      ...opt("Telefon", r.phone), ...opt("Manzil", r.address), ...(r.age ? [{ label: "Yoshi", value: String(r.age) }] : []),
      ...(r.visitDate ? [{ label: "Suhbat kuni", value: dateRu(r.visitDate) }] : []), ...opt("Izoh", r.reason),
      { label: "Yozdi", value: `${author?.fullName ?? "—"} · ${dateRu(r.createdAt)}` },
    ],
    sections: [], actions,
  };
}

async function debtDetail(id: string): Promise<MobileDetail> {
  const d = (await listDebts()).find((x) => x.id === id);
  if (!d) return fail("Qarz topilmadi", 404);
  return {
    key: "emp-debts", id, title: d.employee.fullName, subtitle: [d.employee.position, dateRu(d.date)].filter(Boolean).join(" · "),
    status: d.cancelledAt ? "Bekor qilingan" : d.left > 0 ? "Ushlanmoqda" : "To'liq ushlandi",
    fields: [
      { label: "Qarz", value: money(d.amount) }, { label: "Ushlandi", value: `${money(d.held)} · ${d.heldN} oy` },
      { label: "Qoldiq", value: money(d.left), tone: "brand" }, { label: "Oyiga", value: money(d.monthly) },
      { label: "Muddat", value: `${d.startMonth} — ${d.endMonth} (${d.months} oy)` },
      ...opt("Kassa", d.account), ...opt("Izoh", d.note), ...opt("Bekor sababi", d.cancelReason),
    ],
    sections: [], actions: [],
  };
}

async function teamDetail(id: string): Promise<MobileDetail> {
  const t = await db.team.findUnique({
    where: { id },
    include: { leader: { select: { fullName: true } }, members: { orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true, phone: true } } },
  });
  if (!t) return fail("Komanda topilmadi", 404);
  const paid = await db.cashTransaction.aggregate({ where: { teamId: id, cancelledAt: null, type: "EXPENSE" }, _sum: { amount: true } });
  return {
    key: "teams", id, title: t.name, subtitle: t.leader ? `Brigadir: ${t.leader.fullName}` : undefined, status: t.isActive ? undefined : "Nofaol",
    fields: [
      { label: "A'zolar", value: `${t.members.length} kishi` }, ...opt("Telefon", t.phone),
      { label: "Kassadan berilgan (jami)", value: money(n(paid._sum.amount)) }, ...opt("Izoh", t.note),
    ],
    sections: [{ title: "Tarkibi", empty: "A'zo yo'q", target: "employees", rows: t.members.map((m) => ({ id: m.id, title: m.fullName, subtitle: [m.position, m.phone].filter(Boolean).join(" · ") })) }],
    actions: [],
  };
}

/* ══════════════════════ Amallar ══════════════════════ */

export async function runPortAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "ledger.edit": {
      const { kind, id: rowId } = parseLedgerId(id);
      const d = await ledgerEditData(kind, rowId);
      if ("error" in d) return fail(d.error);
      const p = ledgerEditSchema.safeParse(ledgerInput(d as LedgerEditData, payload));
      if (!p.success) return fail(p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri");
      const r = await updateLedgerRow(kind, rowId, p.data, user.id, canDo(who(user), "logistika", "pay"));
      if ("error" in r) return fail(r.error);
      return r.note;
    }
    case "logitx.cancel": {
      const r = await cancelLogiTx(id, str(payload.reason), user.id);
      if (r.error) return fail(r.error);
      return "Bekor qilindi";
    }
    case "period.close":
    case "period.closeall": {
      const r = await closePeriod(user.id, action === "period.closeall" ? "all" : str(payload.section), id);
      if ("error" in r) return fail(r.error);
      return r.note;
    }
    case "period.reopen": {
      const r = await reopenPeriod(user.id, str(payload.section), id, str(payload.reason));
      if ("error" in r) return fail(r.error);
      return r.note;
    }
    case "hrcall.status": {
      const status = CALL_STATUSES.find((s) => s === payload.status);
      if (!status) return fail("Holat noto'g'ri");
      await db.$transaction(async (tx) => {
        const before = await tx.hrCallLog.findUnique({ where: { id }, select: { status: true } });
        if (!before) throw new ListError("NOT_FOUND", "Yozuv topilmadi", 404);
        if (before.status === status) return;
        await tx.hrCallLog.update({ where: { id }, data: { status } });
        await audit(tx, user.id, "UPDATE", "HrCallLog", id, before, { status });
      });
      return `Holat: ${CALL_STATUS_LABEL[status]}`;
    }
  }
  return fail("Bunday amal yo'q", 404);
}

/* ══════════════════════ Yangi hujjat formalari ══════════════════════ */

export async function portForm(user: MobileUser, key: string): Promise<CreateForm> {
  const today = isoDate(new Date());
  if (key === "logi-tx") {
    const [sources, vehicles] = await Promise.all([
      paySources(true),
      db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" }, select: { id: true, plate: true } }),
    ]);
    const cats: FormOption[] = [...LOGI_EXPENSE.map((c) => ({ value: `EXPENSE|${c}`, label: `Chiqim: ${c}` })), ...LOGI_INCOME.map((c) => ({ value: `INCOME|${c}`, label: `Kirim: ${c}` }))];
    return {
      key, title: "Logistika kirim / chiqim", submitLabel: "Saqlash",
      fields: [
        { name: "date", label: "Sana", type: "date", required: true, value: today },
        { name: "category", label: "Toifa", type: "select", required: true, options: cats },
        { name: "amount", label: "Summa", type: "number", required: true },
        { name: "source", label: "Hisob (chiqimda — qayerdan, kirimda — qayerga)", type: "select", required: true, options: sources.map((s) => ({ value: s.id, label: paySourceLabel(s) })) },
        { name: "fromCashAccountId", label: `«${LOGI_TRANSFER_IN}» uchun: zavod hisobi`, type: "select", options: [{ value: "", label: "—" }, ...sources.filter((s) => s.group === "Zavod hisobi").map((s) => ({ value: s.id, label: paySourceLabel(s) }))] },
        { name: "vehicleId", label: "Transport", type: "select", options: [{ value: "", label: "—" }, ...vehicles.map((v) => ({ value: v.id, label: v.plate }))] },
        { name: "counterparty", label: "Kimdan / kimga", type: "text" },
        { name: "note", label: "Izoh", type: "text" },
      ],
    };
  }
  if (key === "kassa-yopish") {
    const accs = await db.cashAccount.findMany({ where: { type: "CASH", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    const bal = await Promise.all(accs.map((a) => accountBalance(a.id)));
    return {
      key, title: "Kassani yopish (sanash)", submitLabel: "Kassani yopish",
      fields: [
        { name: "cashAccountId", label: "Kassa", type: "select", required: true, value: accs.length === 1 ? accs[0].id : undefined, options: accs.map((a, i) => ({ value: a.id, label: a.name, hint: `Tizimda: ${money(bal[i])}` })) },
        { name: "counted", label: "Sanalgan naqd", type: "number", required: true },
        { name: "note", label: "Izoh (farq bo'lsa — sababi)", type: "text" },
      ],
    };
  }
  if (key === "hr-call") {
    return {
      key, title: "Qo'ng'iroq yozish", submitLabel: "Jurnalga yozish",
      fields: [
        { name: "date", label: "Sana", type: "date", required: true, value: today },
        { name: "position", label: "Lavozim", type: "text", required: true },
        { name: "phone", label: "Telefon", type: "text", required: true, placeholder: "90 123 45 67" },
        { name: "fullName", label: "Ism familiya", type: "text" },
        { name: "address", label: "Manzil", type: "text" },
        { name: "age", label: "Yoshi", type: "number" },
        { name: "status", label: "Holat", type: "select", required: true, value: "WAITING", options: CALL_STATUSES.map((s) => ({ value: s, label: CALL_STATUS_LABEL[s] })) },
        { name: "visitDate", label: "Suhbat kuni", type: "date" },
        { name: "reason", label: "Izoh", type: "text" },
      ],
    };
  }
  return fail("Bunday forma yo'q", 404);
}

export async function portCreate(user: MobileUser, key: string, payload: unknown): Promise<CreateResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (key === "logi-tx") {
    const [type, category] = str(p.category).split("|");
    if ((type !== "EXPENSE" && type !== "INCOME") || !category) return fail("Toifani tanlang");
    const amount = Number(str(p.amount).replace(/\s+/g, "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return fail("Summani kiriting");
    const day = validDay(str(p.date));
    if (!day) return fail("Sana noto'g'ri");
    const r = await addLogiTx({
      type, category, amount, date: new Date(`${day}T00:00:00`), source: str(p.source),
      fromCashAccountId: str(p.fromCashAccountId) || null, vehicleId: str(p.vehicleId) || null,
      counterparty: str(p.counterparty) || null, note: str(p.note) || null, clientToken: str(p.clientToken) || null,
    }, user.id);
    if (r.error || !r.id) return fail(r.error ?? "Saqlanmadi");
    return { key: "logi-moliya", id: r.id, message: r.note ?? `${r.docNo ?? ""} saqlandi`.trim() };
  }
  if (key === "kassa-yopish") {
    const acc = await db.cashAccount.findFirst({ where: { id: str(p.cashAccountId), type: "CASH", isActive: true }, select: { id: true } });
    if (!acc) return fail("Naqd kassa topilmadi");
    const counted = Number(str(p.counted).replace(/\s+/g, "").replace(",", "."));
    if (!Number.isFinite(counted) || counted < 0) return fail("Sanalgan summani kiriting");
    const note = str(p.note) || null;
    const day = tashkentDay();
    const system = await accountBalance(acc.id);
    const diff = Math.round((counted - system) * 100) / 100;
    if (Math.abs(diff) >= 1 && !note) return fail(`Farq ${money(diff)} — sababini izohga yozing`);
    const row = await db.$transaction(async (tx) => {
      const before = await tx.cashCount.findUnique({ where: { cashAccountId_day: { cashAccountId: acc.id, day } } });
      const after = await tx.cashCount.upsert({
        where: { cashAccountId_day: { cashAccountId: acc.id, day } },
        update: { counted, system, diff, note, createdById: user.id },
        create: { cashAccountId: acc.id, day, counted, system, diff, note, createdById: user.id },
      });
      await audit(tx, user.id, before ? "UPDATE" : "CREATE", "CashCount", after.id, before ?? undefined, after);
      return after;
    });
    return { key: "cashflow", id: row.id, message: Math.abs(diff) < 1 ? "Kassa yopildi — farq yo'q" : `Kassa yopildi — farq ${money(diff)}` };
  }
  if (key === "hr-call") {
    const day = validDay(str(p.date));
    if (!day) return fail("Sanani kiriting");
    const position = str(p.position).slice(0, 80);
    if (!position) return fail("Lavozimni yozing");
    const phone = normalizePhone(str(p.phone));
    if (!phone) return fail("Telefon raqami noto'g'ri — 9 xonali raqam yozing (90 123 45 67)");
    const status = CALL_STATUSES.find((s) => s === p.status) ?? "WAITING";
    const ageN = str(p.age) ? Math.trunc(Number(str(p.age))) : null;
    if (ageN != null && (!Number.isFinite(ageN) || ageN < 14 || ageN > 90)) return fail("Yoshi 14 dan 90 gacha bo'lsin");
    const visit = str(p.visitDate) ? validDay(str(p.visitDate)) : null;
    if (str(p.visitDate) && !visit) return fail("Suhbat kuni noto'g'ri");
    const x = await db.$transaction(async (tx) => {
      const c = await tx.hrCallLog.create({ data: {
        date: dayUtc(day), position, phone, fullName: str(p.fullName).slice(0, 120) || null, address: str(p.address).slice(0, 160) || null,
        age: ageN, status, visitDate: visit ? dayUtc(visit) : null, reason: str(p.reason).slice(0, 300) || null, createdById: user.id,
      } });
      await audit(tx, user.id, "CREATE", "HrCallLog", c.id, undefined, c);
      return c;
    });
    return { key: "hr-calls", id: x.id, message: "Jurnalga yozildi" };
  }
  return fail("Bunday forma yo'q", 404);
}

export type PortRow = HomeRow;
