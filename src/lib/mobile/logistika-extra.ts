import { z } from "zod";
import { after } from "next/server";
import { db } from "@/lib/db";
import {
  ACTIVE_TRIP, capText, DRUM_MAX_MIN, EXPENSE_KIND, FUEL_TYPE, METHANE_NORM, VEHICLE_FUELS, ORDER_LOGI, SERVICE_KINDS, TRIP_PHASE, VEHICLE_LIVE, VEHICLE_TYPE,
  dayRange, delayLevel, driverEmployees, expiryLevel, isConcreteTrip, logisticsSettings, minutesLabel, orderLogistics, orderPlannedAt,
  serviceDueLevel, tripDelayMin, tripPhase, tripPlannedAt, vehicleLive, vehicleServiceDue,
  type OrderLogiStatus, type VehicleLive,
} from "@/lib/logistics";
import type { LogisticsDashboard } from "@/lib/logistics-dashboard";
import { avgMin, cost as reportCost, logisticsReport, onTimePct } from "@/lib/logistics-report";
import { fuelConsumption, lastFuelPrice } from "@/lib/logistics-costs";
import { CANCELLED_LABEL, cancelNote, cancellerNames } from "@/lib/cancelled";
import {
  EXPENSE_KINDS, MECHANIC_EXPENSE_KINDS, VEHICLE_STATUSES, addExpenseRecord, addFuelRecord, addVehicleServiceRecord, cancelExpenseRecord,
  cancelFuelRecord, cancelVehicleServiceRecord, driverCardSchema, expenseSchema, fuelSchema, saveDriverCardRecord, saveSiteRecord,
  saveVehicleRecord, serviceSchema, setVehicleStatusRecord, siteSchema, vehicleSchema, type AdminResult,
} from "@/lib/logistics-admin";
import { TRIP_EXPENSE_KINDS, addTripCostRecord, dispatchDelivered, dispatchOnRoad } from "@/lib/trip-dispatch";
import { READINESS_INCLUDE, createTrip, orderReadiness, tripPickup } from "@/lib/trips";
import { customerMarks } from "@/lib/finance";
import { driverPositionNames } from "@/lib/positions";
import { publicOrigin } from "@/lib/public-url";
import { ecoEnabled, normalizePhone } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { pullTripFromEco, pushTripStatus, pushTripToEco } from "@/lib/eco/sync";
import { approveDriverInEco, linkDriverToEco } from "@/lib/eco/driver-link";
import { date, dateRu, dateTime, deliveryAt, fmtNum, money, moneyShort } from "@/lib/format";
import { unitLabel, unitShort } from "@/lib/unit";
import type { FuelType, Role, TripStatus } from "@/generated/prisma";
import type { MobileUser } from "./auth";
import type { DetailAction, DetailField, FormField, FormOption, MobileDetail } from "./detail";
import { can } from "./detail";
import type { HomeRow, HomeSection, SectionChart, Tone } from "./home";
import { ListError, type ListFilter, type MobileList } from "./list";
import type { CreateForm, CreateResult } from "./create";
import { LOGI_ACTION_ROLES, LOGI_CREATE, LOGI_DETAIL_ROLES } from "./logistika-access";
import { runTripPrice, tripPayDetail, tripPayList } from "./trip-pay";

/**
 * Logistika kabineti — ilovadagi qismi (veb `app/(app)/logistika/*`, `trips/[id]`, `dashboard/logistics-home.tsx`).
 *
 * Bu yerda faqat ko'rinish va kirish ma'lumotini o'qish: qoidalar `lib/logistics-admin.ts`,
 * `lib/trip-dispatch.ts`, `lib/trips.ts`, `lib/logistics*.ts` da — veb bilan bitta joyda.
 * Ro'yxat/kartochka/amal ruxsatlari — `./logistika-access.ts`.
 */

const TAKE = 60;
const n = (v: unknown) => Number(v ?? 0);
const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
const textOf = (p: Record<string, unknown>, key: string) => String(p[key] ?? "").trim();
const numOf = (p: Record<string, unknown>, key: string) => {
  const v = Number(textOf(p, key).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};
/** Bo'sh — "berilmagan" (null), 0 emas. */
const optNum = (p: Record<string, unknown>, key: string) => (textOf(p, key) === "" ? null : numOf(p, key));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Zod xatosi → bitta o'zbekcha satr (`lib/action.ts` `parseForm` bilan bir xil uslub). */
const ZOD_DEFAULT = /^(required|invalid|expected|too (small|big)|string must|number must|array must|unrecognized)/i;
function zodMsg(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "Ma'lumot to'liq emas";
  if (!ZOD_DEFAULT.test(i.message)) return i.message.charAt(0).toUpperCase() + i.message.slice(1);
  return `${i.path.join(".") || "Forma"}: ${i.message}`;
}
const parse = <T extends z.ZodTypeAny>(schema: T, payload: unknown): z.infer<T> => {
  const r = schema.safeParse(payload);
  if (!r.success) fail(zodMsg(r.error));
  return (r as { data: z.infer<T> }).data;
};
const done = (r: AdminResult): string => ("error" in r ? fail(r.error) : r.id);

/** Badge rangi (veb) → ilova ohangi. */
const COLOR_TONE: Record<string, Tone> = { slate: "info", green: "success", amber: "warning", red: "danger", blue: "brand", violet: "brand" };
const allowed = (user: MobileUser, card: keyof typeof LOGI_DETAIL_ROLES) => user.role === "DIRECTOR" || LOGI_DETAIL_ROLES[card].includes(user.role);

// ───────────────────────── Davr (veb `logistika/ui.tsx` `periodRange` bilan bir xil chegaralar) ─────────────────────────

export type LogiPeriodKey = "day" | "week" | "month" | "prev";
const PERIODS: { key: LogiPeriodKey; label: string }[] = [
  { key: "day", label: "Bugun" }, { key: "week", label: "Hafta" }, { key: "month", label: "Oy" }, { key: "prev", label: "O'tgan oy" },
];
export function logiPeriod(key: string | undefined, fallback: LogiPeriodKey = "month") {
  const p = PERIODS.find((x) => x.key === key) ?? PERIODS.find((x) => x.key === fallback)!;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let from: Date, to: Date, label: string;
  if (p.key === "day") { from = today; to = new Date(today); to.setDate(to.getDate() + 1); label = "Bugun"; }
  else if (p.key === "week") { from = new Date(today); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); to = new Date(from); to.setDate(to.getDate() + 7); label = "Shu hafta"; }
  else if (p.key === "prev") { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); label = "O'tgan oy"; }
  else { from = new Date(today.getFullYear(), today.getMonth(), 1); to = new Date(today.getFullYear(), today.getMonth() + 1, 1); label = "Shu oy"; }
  return { key: p.key, from, to, label };
}
const periodChips = (active: LogiPeriodKey, keys: LogiPeriodKey[] = ["day", "week", "month", "prev"]): ListFilter[] =>
  PERIODS.filter((p) => keys.includes(p.key)).map((p) => ({ key: p.key, label: p.label, active: p.key === active }));

// ───────────────────────── Ro'yxatlar ─────────────────────────

export async function logiList(user: MobileUser, key: string, title: string, q?: string, filter?: string): Promise<MobileList> {
  switch (key) {
    case "logi-orders": return ordersList(title, q, filter);
    case "logi-day": return dayList(title, filter);
    case "vehicles": return vehiclesList(title, q, filter);
    case "fuel": return fuelList(title, q, filter);
    case "expenses": return expensesList(title, q, filter);
    case "waybills": return waybillsList(title, q, filter);
    case "deliveries": return deliveriesList(title, q, filter);
    case "logi-report": return reportList(title);
    case "sites": return sitesList(title, q, filter);
    case "trip-pay": return tripPayList(title, filter);
    default: throw new ListError("UNKNOWN_LIST", "Bunday ro'yxat yo'q", 404);
  }
}

const orderUnit = (items: { product: { unit: string } }[]) => (items.every((i) => i.product.unit === "m3") ? "m3" : items[0]?.product.unit ?? "m3");

type LogiFilter = "open" | "waiting" | "onroad" | "late" | "problem" | "done" | "all";
const LOGI_TABS: { key: LogiFilter; label: string }[] = [
  { key: "open", label: "Ochiq" }, { key: "waiting", label: "Transport kutmoqda" }, { key: "onroad", label: "Yo'lda" },
  { key: "late", label: "Kechikmoqda" }, { key: "problem", label: "Muammo" }, { key: "done", label: "Yetkazilgan" }, { key: "all", label: "Hammasi" },
];
const OPEN_LOGI: OrderLogiStatus[] = ["NEW", "CONFIRMED", "PLANNED", "ASSIGNED", "LOADING", "ON_ROAD"];
const LOGI_MATCH: Record<LogiFilter, (l: ReturnType<typeof orderLogistics>) => boolean> = {
  open: (l) => OPEN_LOGI.includes(l.status),
  waiting: (l) => ["CONFIRMED", "PLANNED", "ASSIGNED", "LOADING", "ON_ROAD"].includes(l.status) && l.remaining > 0.001,
  onroad: (l) => ["LOADING", "ON_ROAD"].includes(l.status),
  late: (l) => l.late,
  problem: (l) => l.problem,
  done: (l) => ["DELIVERED", "CLOSED"].includes(l.status),
  all: () => true,
};
const logiRow = (o: { id: string; orderNo: string; isUrgent: boolean; needsPump: boolean; lat: number | null; deliveryDate: Date; deliveryTime: string | null; deliveryAddress: string; customer: { name: string }; items: { product: { unit: string } }[] }, l: ReturnType<typeof orderLogistics>): HomeRow => {
  const u = unitShort(orderUnit(o.items));
  return {
    id: o.id,
    title: `${o.orderNo} · ${o.customer.name}${o.isUrgent ? " · shoshilinch" : ""}`,
    subtitle: `${deliveryAt(o.deliveryDate, o.deliveryTime)} · ${o.deliveryAddress}${o.needsPump ? " · nasos" : ""}${o.lat == null ? " · nuqta yo'q" : ""}`,
    right: `${fmtNum(l.delivered, 1)} / ${fmtNum(l.total, 1)} ${u}`,
    status: l.problem ? "Muammo" : l.late ? "Kechikmoqda" : ORDER_LOGI[l.status].label,
    tone: l.problem || l.late ? "danger" : COLOR_TONE[ORDER_LOGI[l.status].color],
  };
};

/** Buyurtmalar — veb «Logistika → Buyurtmalar» bilan bir xil so'rov va tablar. */
async function ordersList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tab = LOGI_TABS.find((t) => t.key === filter)?.key ?? "open";
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 14); from.setHours(0, 0, 0, 0);
  const to = new Date(now); to.setDate(to.getDate() + 30);
  const orders = await db.order.findMany({
    where: {
      kind: "SALE", needsDelivery: true,
      ...(q ? { AND: [{ OR: [{ orderNo: { contains: q, mode: "insensitive" as const } }, { customer: { name: { contains: q, mode: "insensitive" as const } } }, { deliveryAddress: { contains: q, mode: "insensitive" as const } }] }] } : {}),
      OR: [{ status: { in: ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION"] } }, { deliveryDate: { gte: from, lt: to } }],
    },
    include: {
      customer: { select: { name: true } },
      items: { select: { qtyM3: true, product: { select: { unit: true } } } },
      trips: { select: { status: true, qtyM3: true, plannedAt: true, deliveredAt: true, closedAt: true, issues: { select: { resolvedAt: true } } } },
    },
    orderBy: [{ deliveryDate: "asc" }, { deliveryTime: "asc" }],
    take: 400,
  });
  const rows = orders.map((o) => ({ o, l: orderLogistics(o, now) }));
  return {
    key: "logi-orders", title,
    rows: rows.filter((r) => LOGI_MATCH[tab](r.l)).slice(0, TAKE).map((r) => logiRow(r.o, r.l)),
    filters: LOGI_TABS.map((t) => ({ key: t.key, label: t.label, count: rows.filter((r) => LOGI_MATCH[t.key](r.l)).length, active: t.key === tab })),
  };
}

/** Kun chiplari: kechadan 6 kun oldinga. Kalit `d<siljish>` (d0 — bugun). */
const DAY_SHIFTS = [-2, -1, 0, 1, 2, 3, 4, 5, 6];
const WEEKDAY = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const shiftLabel = (s: number, d: Date) => (s === 0 ? "Bugun" : s === -1 ? "Kecha" : s === 1 ? "Ertaga" : `${WEEKDAY[d.getDay()]} ${dm(d)}`);

/**
 * Dispetcher kalendari ro'yxat ko'rinishida (veb `/logistika/kalendar`): tanlangan kundagi dastavkali zayavkalar
 * soat bo'yicha, soati belgilanmaganlari va (bugun) oldingi kunlardan qolib ketgan ochiq zayavkalar.
 */
async function dayList(title: string, filter?: string): Promise<MobileList> {
  const shift = DAY_SHIFTS.find((s) => `d${s}` === filter) ?? 0;
  const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + shift);
  const { from, to } = dayRange(day);
  const isToday = shift === 0;
  const include = {
    customer: { select: { name: true } },
    items: { select: { qtyM3: true, product: { select: { unit: true } } } },
    trips: { where: { status: { not: "CANCELLED" as TripStatus } }, select: { status: true, qtyM3: true, plannedAt: true, deliveredAt: true, closedAt: true } },
  };
  const [orders, backlog, mixers] = await Promise.all([
    db.order.findMany({ where: { kind: "SALE", needsDelivery: true, status: { notIn: ["CANCELLED", "DRAFT"] }, deliveryDate: { gte: from, lt: to } }, include, orderBy: { deliveryTime: "asc" } }),
    // Oldingi kunlardan qolib ketgan ochiq zayavkalar — bugungi rejaga qo'shilishi kerak (veb kalendar bilan bir xil)
    isToday ? db.order.findMany({ where: { kind: "SALE", needsDelivery: true, status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, deliveryDate: { lt: from } }, include, orderBy: { deliveryDate: "asc" } }) : Promise.resolve([]),
    db.vehicle.count({ where: { isActive: true, type: "MIXER", status: { not: "REPAIR" } } }),
  ]);
  const row = (o: (typeof orders)[number], kind: "timed" | "untimed" | "backlog"): HomeRow => {
    const l = orderLogistics(o);
    const u = unitShort(orderUnit(o.items));
    const left = l.remaining > 0.001 ? `qoldi ${fmtNum(l.remaining, 1)} ${u}` : `${fmtNum(l.delivered, 1)} / ${fmtNum(l.total, 1)} ${u}`;
    return {
      id: o.id,
      title: `${kind === "timed" ? `${o.deliveryTime} · ` : ""}${o.orderNo} · ${o.customer.name}${o.isUrgent ? " · shoshilinch" : ""}`,
      subtitle: `${kind === "backlog" ? `${date(o.deliveryDate)} · ` : ""}${o.deliveryAddress}${o.needsPump ? " · nasos" : ""}`,
      right: left,
      status: kind === "backlog" ? "Oldingi kundan" : kind === "untimed" ? "Soat yo'q" : l.late ? "Kechikmoqda" : ORDER_LOGI[l.status].label,
      tone: kind === "backlog" || l.late ? "danger" : kind === "untimed" ? "warning" : COLOR_TONE[ORDER_LOGI[l.status].color],
    };
  };
  const timed = orders.filter((o) => !!orderPlannedAt(o));
  const untimed = orders.filter((o) => !orderPlannedAt(o));
  const late = backlog.filter((o) => orderLogistics(o).remaining > 0.001);
  return {
    key: "logi-day",
    title: `${title} · ${dateRu(day)} · ${orders.length} zayavka · ${mixers} mikser`,
    rows: [...late.map((o) => row(o, "backlog")), ...timed.map((o) => row(o, "timed")), ...untimed.map((o) => row(o, "untimed"))],
    filters: DAY_SHIFTS.map((s) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + s); return { key: `d${s}`, label: shiftLabel(s, d), active: s === shift }; }),
  };
}

type VehTab = "all" | "free" | "busy" | "repair" | "idle" | "docs" | "service";
const VEH_TABS: { key: VehTab; label: string }[] = [
  { key: "all", label: "Hammasi" }, { key: "free", label: "Bo'sh" }, { key: "busy", label: "Reysda" }, { key: "repair", label: "Ta'mirda" },
  { key: "idle", label: "Faol emas / bekor" }, { key: "docs", label: "Hujjat muddati" }, { key: "service", label: "Texnik xizmat" },
];
const docsBad = (v: { isActive: boolean; inspectionUntil: Date | null; insuranceUntil: Date | null }) =>
  v.isActive && [expiryLevel(v.inspectionUntil), expiryLevel(v.insuranceUntil)].some((l) => l === "crit" || l === "warn");

/** Transport — veb «Transport» sahifasi: joriy holat (reyslardan), hujjat muddati, texnik xizmat, oy xarajati. */
async function vehiclesList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tab = VEH_TABS.find((t) => t.key === filter)?.key ?? "all";
  const monthFrom = new Date(); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const [vehicles, due] = await Promise.all([
    db.vehicle.findMany({
      where: q ? { OR: [{ plate: { contains: q, mode: "insensitive" } }, { brand: { contains: q, mode: "insensitive" } }, { drivers: { some: { fullName: { contains: q, mode: "insensitive" } } } }] } : {},
      orderBy: [{ isActive: "desc" }, { type: "asc" }, { plate: "asc" }],
      include: {
        drivers: { where: { isActive: true }, select: { fullName: true } },
        trips: {
          where: { OR: [{ status: { in: ACTIVE_TRIP } }, { deliveredAt: { gte: new Date(Date.now() - 3 * 3600_000) } }, { createdAt: { gte: monthFrom } }] },
          select: { deliveryNoteNo: true, status: true, deliveredAt: true, returnedAt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
        fuelLogs: { where: { date: { gte: monthFrom }, cancelledAt: null }, select: { amount: true } },
        expenses: { where: { date: { gte: monthFrom }, cancelledAt: null }, select: { amount: true } },
      },
    }),
    vehicleServiceDue(),
  ]);
  const dueBy = new Map<string, typeof due>();
  for (const d of due) dueBy.set(d.vehicleId, [...(dueBy.get(d.vehicleId) ?? []), d]);
  const rows = vehicles.map((v) => ({ v, live: vehicleLive(v, v.trips) }));
  const match: Record<VehTab, (r: (typeof rows)[number]) => boolean> = {
    all: () => true,
    free: (r) => r.live === "FREE",
    busy: (r) => (["ON_TRIP", "LOADING", "ASSIGNED", "RETURNING"] as VehicleLive[]).includes(r.live),
    repair: (r) => r.live === "REPAIR",
    idle: (r) => r.live === "INACTIVE" || r.live === "IDLE",
    docs: (r) => docsBad(r.v),
    service: (r) => dueBy.has(r.v.id),
  };
  return {
    key: "vehicles", title,
    rows: rows.filter(match[tab]).slice(0, TAKE).map(({ v, live }) => {
      const current = v.trips.find((t) => ACTIVE_TRIP.includes(t.status));
      const month = v.trips.filter((t) => t.createdAt >= monthFrom && t.status !== "CANCELLED").length;
      const costSum = v.fuelLogs.reduce((a, f) => a + n(f.amount), 0) + v.expenses.reduce((a, e) => a + n(e.amount), 0);
      const vd = dueBy.get(v.id) ?? [];
      const ins = expiryLevel(v.inspectionUntil), sur = expiryLevel(v.insuranceUntil);
      const warn = [
        ins === "crit" || ins === "warn" ? `ko'rik ${date(v.inspectionUntil!)}` : null,
        sur === "crit" || sur === "warn" ? `sug'urta ${date(v.insuranceUntil!)}` : null,
        ...vd.map((d) => d.text),
      ].filter(Boolean);
      const crit = ins === "crit" || sur === "crit" || vd.some((d) => d.level === "crit");
      return {
        id: v.id,
        title: `${v.plate} · ${VEHICLE_TYPE[v.type] ?? v.type}${capText(v) ? ` · ${capText(v)}` : ""}`,
        subtitle: [v.drivers.map((d) => d.fullName).join(", ") || "haydovchi biriktirilmagan", current ? current.deliveryNoteNo : null, v.statusNote, ...warn].filter(Boolean).join(" · "),
        right: costSum ? `${month} reys · ${moneyShort(costSum)}` : `${month} reys`,
        status: VEHICLE_LIVE[live].label,
        tone: crit ? "danger" : warn.length ? "warning" : COLOR_TONE[VEHICLE_LIVE[live].color],
      } satisfies HomeRow;
    }),
    filters: VEH_TABS.map((t) => ({ key: t.key, label: t.label, count: rows.filter(match[t.key]).length, active: t.key === tab })),
  };
}

const journalTitle = (title: string, count: number, unitWord: string, total: number) => (count ? `${title} · ${count} ${unitWord} · ${moneyShort(total)}` : title);

/** Yoqilg'i — veb «Yoqilg'i»: davr bo'yicha zapravkalar. Qator → zapravka kartochkasi (bekor qilish shu yerda). */
async function fuelList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const p = logiPeriod(filter, "month");
  const logs = await db.fuelLog.findMany({
    where: { date: { gte: p.from, lt: p.to }, ...(q ? { OR: [{ vehicle: { plate: { contains: q, mode: "insensitive" } } }, { driver: { fullName: { contains: q, mode: "insensitive" } } }, { station: { contains: q, mode: "insensitive" } }] } : {}) },
    include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, trip: { select: { deliveryNoteNo: true } } },
    orderBy: { date: "desc" },
  });
  // Bekor qilingan zapravka ro'yxatda «Bekor qilingan» bo'lib qoladi, lekin jamiga kirmaydi
  const ok = logs.filter((f) => !f.cancelledAt);
  const liters = ok.reduce((a, f) => a + n(f.liters), 0);
  const total = ok.reduce((a, f) => a + n(f.amount), 0);
  return {
    key: "fuel",
    title: ok.length ? `${title} · ${ok.length} zapravka · ${fmtNum(liters, 0)} l · ${moneyShort(total)}` : title,
    rows: logs.slice(0, TAKE).map((f) => ({
      id: f.id,
      title: `${f.vehicle.plate} · ${fmtNum(n(f.liters), 1)} l`,
      subtitle: [date(f.date), FUEL_TYPE[f.fuelType], f.driver?.fullName, f.station, f.trip?.deliveryNoteNo, f.odometerKm != null ? `${fmtNum(f.odometerKm)} km` : null].filter(Boolean).join(" · "),
      right: money(n(f.amount)),
      ...(f.cancelledAt ? { status: CANCELLED_LABEL, tone: "danger" as Tone } : { tone: "info" as Tone }),
    })),
    filters: periodChips(p.key),
  };
}

/** Transport xarajatlari — veb «Transport xarajatlari» (yoqilg'idan tashqari). */
async function expensesList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const p = logiPeriod(filter, "month");
  const rows = await db.transportExpense.findMany({
    where: { date: { gte: p.from, lt: p.to }, ...(q ? { OR: [{ vehicle: { plate: { contains: q, mode: "insensitive" } } }, { driver: { fullName: { contains: q, mode: "insensitive" } } }, { note: { contains: q, mode: "insensitive" } }] } : {}) },
    include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, trip: { select: { deliveryNoteNo: true } } },
    orderBy: { date: "desc" },
  });
  const ok = rows.filter((e) => !e.cancelledAt);
  const total = ok.reduce((a, e) => a + n(e.amount), 0);
  return {
    key: "expenses",
    title: journalTitle(title, ok.length, "ta", total),
    rows: rows.slice(0, TAKE).map((e) => ({
      id: e.id,
      title: `${EXPENSE_KIND[e.kind]}${e.vehicle ? ` · ${e.vehicle.plate}` : ""}`,
      subtitle: [date(e.date), e.driver?.fullName, e.trip?.deliveryNoteNo, e.note].filter(Boolean).join(" · "),
      right: money(n(e.amount)),
      ...(e.cancelledAt ? { status: CANCELLED_LABEL, tone: "danger" as Tone } : { tone: "warning" as Tone }),
    })),
    filters: periodChips(p.key),
  };
}

const tripInclude = {
  order: { select: { orderNo: true, customer: { select: { name: true } }, items: { select: { product: { select: { code: true, name: true, unit: true } } } } } },
  vehicle: { select: { plate: true } }, driver: { select: { fullName: true } },
} as const;
const tripTone = (t: { status: string; arrivedAt?: Date | null; unloadingAt?: Date | null; closedAt?: Date | null }): Tone => COLOR_TONE[TRIP_PHASE[tripPhase(t)].color];

/** Nakladnoylar — veb «Nakladnoylar» (davr bo'yicha reyslar). Qator → reys kartochkasi (QR havolasi o'sha yerda). */
async function waybillsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const p = logiPeriod(filter, "week");
  const trips = await db.trip.findMany({
    where: {
      createdAt: { gte: p.from, lt: p.to },
      ...(q ? { OR: [{ deliveryNoteNo: { contains: q, mode: "insensitive" } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }, { vehicle: { plate: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: tripInclude, orderBy: { createdAt: "desc" }, take: TAKE,
  });
  return {
    key: "waybills", title,
    rows: trips.map((t) => ({
      id: t.id,
      title: `${t.deliveryNoteNo} · ${t.order.customer.name}`,
      subtitle: [t.vehicle.plate, t.driver.fullName, [...new Set(t.order.items.map((i) => i.product.code ?? i.product.name))].join(", "), t.loadedAt ? `yuklandi ${dateTime(t.loadedAt)}` : null, t.receiverName ? `qabul: ${t.receiverName}` : null].filter(Boolean).join(" · "),
      right: `${fmtNum(n(t.qtyM3), 1)} ${unitShort(orderUnit(t.order.items))}`,
      status: TRIP_PHASE[tripPhase(t)].label,
      tone: tripTone(t),
    })),
    filters: periodChips(p.key),
  };
}

/** Yetkazib berish chiplari: davr (hammasi) va oy bo'yicha holatlar — veb tablar bilan bir xil ma'no. */
const DELIV_CHIPS = [
  { key: "week", label: "Hafta" }, { key: "month", label: "Oy" },
  { key: "open", label: "Yopilmagan" }, { key: "diff", label: "Farq bor" }, { key: "issues", label: "Muammoli" },
] as const;

/**
 * Yetkazib berish — veb «Yetkazib berish»: yuklangan / qabul qilingan / qaytarilgan, yopilmagan reyslar.
 * Birinchi qator — jami (bosilsa davr hisoboti kartasi `logi-report`).
 */
async function deliveriesList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const chip = DELIV_CHIPS.find((c) => c.key === filter)?.key ?? "week";
  const p = logiPeriod(chip === "week" ? "week" : "month");
  const trips = await db.trip.findMany({
    where: {
      status: "DELIVERED", deliveredAt: { gte: p.from, lt: p.to },
      ...(q ? { OR: [{ deliveryNoteNo: { contains: q, mode: "insensitive" } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
    },
    include: { ...tripInclude, issues: { select: { kind: true, resolvedAt: true } } },
    orderBy: { deliveredAt: "desc" },
  });
  const accepted = (t: (typeof trips)[number]) => n(t.acceptedQty ?? t.qtyM3);
  const isDiff = (t: (typeof trips)[number]) => Math.abs(n(t.qtyM3) - accepted(t)) > 0.001 || n(t.returnedQty) > 0;
  const loaded = trips.reduce((a, t) => a + n(t.qtyM3), 0);
  const acc = trips.reduce((a, t) => a + accepted(t), 0);
  const ret = trips.reduce((a, t) => a + n(t.returnedQty), 0);
  const open = trips.filter((t) => !t.closedAt);
  const shown = chip === "open" ? open : chip === "diff" ? trips.filter(isDiff) : chip === "issues" ? trips.filter((t) => t.issues.length) : trips;
  const head: HomeRow = {
    id: `logi-report:${p.key}`,
    title: `Jami (${p.label}) · ${trips.length} reys`,
    subtitle: `Yuklangan ${fmtNum(loaded, 1)} · qabul ${fmtNum(acc, 1)}${loaded ? ` (${fmtNum((acc / loaded) * 100, 1)}%)` : ""} · qaytgan ${fmtNum(ret, 1)} · yopilmagan ${open.length}`,
    right: open.length ? `${open.length} ochiq` : undefined,
    tone: open.length ? "warning" : "success",
  };
  return {
    key: "deliveries", title,
    rows: [head, ...shown.slice(0, TAKE - 1).map((t) => {
      const a = accepted(t);
      const openIssue = t.issues.some((i) => !i.resolvedAt);
      return {
        id: t.id,
        title: `${t.deliveryNoteNo} · ${t.order.customer.name}`,
        subtitle: [t.vehicle.plate, t.driver.fullName, t.receiverName ? `qabul: ${t.receiverName}` : null, t.deliveredAt ? dateTime(t.deliveredAt) : null, n(t.returnedQty) > 0 ? `qaytgan ${fmtNum(n(t.returnedQty), 1)}` : null, t.issues.length ? `${t.issues.length} muammo` : null].filter(Boolean).join(" · "),
        right: `${fmtNum(a, 1)} / ${fmtNum(n(t.qtyM3), 1)} ${unitShort(orderUnit(t.order.items))}`,
        status: t.closedAt ? "Yopilgan" : "Yopilmagan",
        tone: (openIssue ? "danger" : isDiff(t) || !t.closedAt ? "warning" : "success") as Tone,
      };
    })],
    filters: DELIV_CHIPS.map((c) => ({ key: c.key, label: c.label, active: c.key === chip })),
  };
}

/** Hisobotlar — davrlar ro'yxati; har biri davr kartasini (`logi-report`) ochadi. */
async function reportList(title: string): Promise<MobileList> {
  return {
    key: "logi-report", title,
    rows: PERIODS.map((p) => ({ id: p.key, title: logiPeriod(p.key).label, subtitle: "Reyslar, o'z vaqtida %, transport bandligi, haydovchilar reytingi, 1 m³ tannarxi", tone: "brand" as Tone })),
  };
}

/** Obyektlar — veb «Obyektlar»: faol / hammasi, kontakt va nuqta holati, ochiq zayavkalar tepada. */
async function sitesList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const all = filter === "all";
  const sites = await db.site.findMany({
    where: {
      ...(all ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: {
      customer: { select: { name: true } },
      orders: { where: { status: { not: "CANCELLED" } }, select: { status: true, deliveryDate: true }, orderBy: { deliveryDate: "desc" } },
    },
    orderBy: { updatedAt: "desc" }, take: 300,
  });
  const rows = sites.map((s) => ({
    s, orders: s.orders.length,
    open: s.orders.filter((o) => ["CONFIRMED", "IN_PRODUCTION", "BLOCKED", "DRAFT"].includes(o.status)).length,
    last: s.orders[0]?.deliveryDate ?? null,
  })).sort((a, b) => b.open - a.open || (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));
  return {
    key: "sites", title,
    rows: rows.slice(0, TAKE).map(({ s, orders, open, last }) => ({
      id: s.id,
      title: s.name,
      subtitle: [s.customer.name, s.name !== s.address ? s.address : null, s.contactPhone ?? (s.contactName ? null : "kontakt yo'q"), s.lat == null ? "nuqta yo'q" : null, last ? `oxirgi ${date(last)}` : null].filter(Boolean).join(" · "),
      right: `${orders} zayavka`,
      status: !s.isActive ? "Nofaol" : open ? `${open} ochiq` : undefined,
      tone: (!s.isActive ? "info" : s.lat == null ? "warning" : open ? "brand" : "success") as Tone,
    })),
    filters: [{ key: "active", label: "Faol", active: !all }, { key: "all", label: "Hammasi", active: all }],
  };
}

// ───────────────────────── Reyslar ro'yxati — holat tablari (veb `/trips`) ─────────────────────────

const TRIP_STATUS_LABEL: Record<TripStatus, string> = { PLANNED: "Rejalashtirilgan", LOADED: "Yuklandi", ON_ROAD: "Yo'lda", DELIVERED: "Yetkazildi", CANCELLED: "Bekor" };
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };
/** Haydovchi kesimidagi tarix — xodim kartasini ochadiganlarga (`detail.ts` DETAIL_ROLES.employees bilan bir xil). */
const HISTORY_ROLES: Role[] = ["DIRECTOR", "LOGISTICS", "PRODUCTION", "SUPERVISOR"];

/**
 * Reyslar — vebdagi tablar: Hammasi, har holat va «Tarix» (haydovchilar kesimida). Haydovchidan boshqa hamma rolga.
 * Qator ko'rinishi `list.ts` dagi oddiy reys qatori bilan bir xil.
 */
export async function tripsList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const history = filter === "tarix" && HISTORY_ROLES.includes(user.role);
  const status = (Object.keys(TRIP_STATUS_LABEL) as TripStatus[]).find((s) => s === filter);
  const [counts, rows] = await Promise.all([
    db.trip.groupBy({ by: ["status"], _count: { _all: true } }),
    history ? driverHistoryRows(q) : db.trip.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q ? { OR: [{ deliveryNoteNo: { contains: q, mode: "insensitive" } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }, { vehicle: { plate: { contains: q, mode: "insensitive" } } }] } : {}),
      },
      orderBy: { createdAt: "desc" }, take: TAKE, include: { order: { include: { customer: true } }, driver: true, vehicle: true },
    }).then((list) => list.map((t): HomeRow => ({
      id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`,
      subtitle: `${t.driver.fullName} · ${t.vehicle.plate}${t.ecoStatus ? ` · ${ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus}` : ""}`,
      right: `${n(t.qtyM3).toFixed(n(t.qtyM3) % 1 ? 1 : 0)} m³`, status: t.status, tone: t.ecoError ? "danger" : TRIP_TONE[t.status],
    }))),
  ]);
  const by = (s?: TripStatus) => (s ? counts.find((c) => c.status === s)?._count._all ?? 0 : counts.reduce((a, c) => a + c._count._all, 0));
  return {
    key: "trips", title, rows,
    filters: [
      { key: "all", label: "Hammasi", count: by(), active: !status && !history },
      ...(Object.keys(TRIP_STATUS_LABEL) as TripStatus[]).map((s) => ({ key: s, label: TRIP_STATUS_LABEL[s], count: by(s), active: s === status })),
      ...(HISTORY_ROLES.includes(user.role) ? [{ key: "tarix", label: "Tarix", active: history }] : []),
    ],
  };
}

/** «Tarix»: haydovchilar va ularning butun reyslari soni (veb `trips/driver-history.tsx` `driverTotals` bilan bir xil sanoq). */
async function driverHistoryRows(q?: string): Promise<HomeRow[]> {
  const [byStatus, lastTrip, positions] = await Promise.all([
    db.trip.groupBy({ by: ["driverId", "status"], _count: { _all: true }, _sum: { qtyM3: true } }),
    db.trip.groupBy({ by: ["driverId"], _max: { createdAt: true } }),
    driverPositionNames(),
  ]);
  const tot = new Map<string, { all: number; delivered: number; cancelled: number; m3: number; last: Date | null }>();
  const get = (id: string) => tot.get(id) ?? tot.set(id, { all: 0, delivered: 0, cancelled: 0, m3: 0, last: null }).get(id)!;
  for (const r of byStatus) {
    const t = get(r.driverId);
    t.all += r._count._all;
    if (r.status === "DELIVERED") { t.delivered += r._count._all; t.m3 += n(r._sum.qtyM3); }
    if (r.status === "CANCELLED") t.cancelled += r._count._all;
  }
  for (const r of lastTrip) get(r.driverId).last = r._max.createdAt;
  const people = await db.employee.findMany({
    where: { OR: [{ position: { in: positions } }, { id: { in: [...tot.keys()] } }], ...(q ? { fullName: { contains: q, mode: "insensitive" } } : {}) },
    select: { id: true, fullName: true, phone: true, isActive: true },
  });
  return people
    .map((e) => ({ e, t: tot.get(e.id) ?? { all: 0, delivered: 0, cancelled: 0, m3: 0, last: null } }))
    .sort((a, b) => (b.t.last?.getTime() ?? 0) - (a.t.last?.getTime() ?? 0))
    .slice(0, TAKE)
    .map(({ e, t }) => ({
      // Aralash ro'yxat: qator xodim kartochkasini ochadi (`splitRef`)
      id: `employees:${e.id}`,
      title: e.fullName,
      subtitle: `${t.all} reys · ${t.delivered} yetkazildi${t.cancelled ? ` · ${t.cancelled} bekor` : ""}${t.last ? ` · oxirgi ${date(t.last)}` : ""}${e.phone ? ` · ${e.phone}` : ""}`,
      right: t.m3 ? fmtNum(t.m3, 1) : undefined,
      status: e.isActive ? undefined : "Nofaol",
      tone: (e.isActive ? "success" : "info") as Tone,
    }));
}

// ───────────────────────── Reys kartochkasi — qo'shimchalar ─────────────────────────

const RECEIVER_FIELDS: FormField[] = [
  { name: "receiverName", label: "Obyektda kim qabul qildi", type: "text", required: true, placeholder: "F.I.Sh." },
  { name: "acceptedQty", label: "Qabul qilingan miqdor", type: "number", hint: "Bo'sh qoldirsangiz — hammasi qabul qilingan" },
  { name: "returnedQty", label: "Qaytarilgan miqdor", type: "number" },
  { name: "comment", label: "Izoh", type: "text" },
];

/** Reja vaqti maydonlari (sana + soat) — reys ochish formalari uchun. Bo'sh — zayavkadagi vaqt olinadi. */
export const plannedFields = (dateValue?: string, timeValue?: string | null): FormField[] => [
  { name: "plannedDate", label: "Reja: sana", type: "date", value: dateValue, hint: "Bo'sh qoldirsangiz — zayavkadagi sana va soat" },
  { name: "plannedTime", label: "Reja: soat", type: "time", value: timeValue ?? undefined },
];
/** `plannedDate` + `plannedTime` → aniq vaqt; soat berilmasa — null (zayavka vaqti ishlatiladi). */
export function plannedAtOf(p: Record<string, unknown>, fallbackDay?: Date): Date | null {
  const t = textOf(p, "plannedTime");
  if (!t) return null;
  if (!/^\d{1,2}:\d{2}$/.test(t)) fail("Reja soati noto'g'ri (ss:dd)");
  const d = textOf(p, "plannedDate") || ymd(fallbackDay ?? new Date());
  const at = new Date(`${d}T${t.padStart(5, "0")}:00`);
  if (!Number.isFinite(at.getTime())) fail("Rejadagi vaqt noto'g'ri");
  return at;
}
/** Zayavka varianti tanlanganda reja vaqtini to'ldirish (`option.extra`). */
export const plannedExtra = (o: { deliveryDate: Date; deliveryTime: string | null }): Record<string, string> => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return { ...(o.deliveryDate >= today ? { plannedDate: ymd(o.deliveryDate) } : {}), ...(o.deliveryTime ? { plannedTime: o.deliveryTime } : {}) };
};

/** Ochiq muammolar ko'p bo'lsa — qaysi birini hal qilish tanlanadi (veb har muammo ostidagi forma kabi). */
export function resolveIssueForm(open: { id: string; kind: string; note: string | null; createdAt: Date }[], labels: Record<string, string>): FormField[] {
  return [
    ...(open.length > 1 ? [{
      name: "issueId", label: "Qaysi muammo", type: "select" as const, required: true, value: open[0]!.id,
      options: [...open.map((i) => ({ value: i.id, label: `${labels[i.kind] ?? i.kind} · ${dm(i.createdAt)} ${hhmm(i.createdAt)}`, hint: i.note ?? undefined })), { value: "all", label: `Hammasi (${open.length} ta)` }],
    }] : []),
    { name: "resolution", label: "Qanday hal qilindi", type: "text" as const, required: true },
  ];
}

export type TripExtras = { warnings: DetailField[]; fields: DetailField[]; sections: HomeSection[]; actions: DetailAction[] };

/**
 * Reys kartochkasiga logistika qo'shimchalari (veb `trips/[id]/page.tsx`): ogohlantirishlar (qora ro'yxat, baraban vaqti,
 * kechikish), yuk olgan joyi, xarajatlar, dispetcher bosqichlari, ECO'dan yangilash, nakladnoy QR havolasi.
 * Haydovchiga faqat havola (o'z ishi `detail.ts` da).
 */
export async function tripExtras(user: MobileUser, tripId: string): Promise<TripExtras> {
  const t = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      order: { select: { customerId: true, deliveryDate: true, deliveryTime: true, items: { select: { product: { select: { unit: true } } } } } },
      vehicle: { select: { type: true } },
      fuelLogs: { orderBy: { date: "desc" }, select: { id: true, date: true, fuelType: true, liters: true, amount: true, note: true, cancelledAt: true, cancelledById: true, cancelReason: true } },
      expenses: { orderBy: { date: "desc" }, select: { id: true, date: true, kind: true, amount: true, note: true, cancelledAt: true, cancelledById: true, cancelReason: true } },
    },
  });
  const out: TripExtras = { warnings: [], fields: [], sections: [], actions: [] };
  if (!t) return out;
  const isDriver = user.role === "DRIVER";

  // Nakladnoy — ommaviy tekshiruv sahifasi (chop etilgan QR shu manzilga olib boradi)
  const { origin } = await publicOrigin().catch(() => ({ origin: "" }));
  if (origin) {
    const url = `${origin}/verify/${encodeURIComponent(t.deliveryNoteNo)}${t.verifyToken ? `?k=${t.verifyToken}` : ""}`;
    out.fields.push({ label: "Nakladnoy (QR)", value: url });
    out.actions.push({ id: "trip.waybill", label: "Nakladnoyni ochish (QR)", local: true, effect: { openUrl: url } });
  }
  if (isDriver) return out;

  // ── Ogohlantirishlar ──
  const live = t.status !== "CANCELLED" && t.status !== "DELIVERED";
  if (live && (await customerMarks([t.order.customerId])).black.has(t.order.customerId)) {
    out.warnings.push({ label: "Diqqat", value: "Mijoz qora ro'yxatda — jo'natishdan oldin sotuv yoki direktor bilan kelishing", tone: "danger" });
  }
  const tripLike = { ...t, vehicle: t.vehicle, order: { items: t.order.items } };
  if (isConcreteTrip(tripLike) && ["LOADED", "ON_ROAD"].includes(t.status) && t.loadedAt) {
    const drum = Math.round((Date.now() - t.loadedAt.getTime()) / 60000);
    if (drum >= DRUM_MAX_MIN * 0.8) out.warnings.push({ label: drum >= DRUM_MAX_MIN ? "Baraban vaqti oshdi" : "Baraban vaqti tugayapti", value: `Yuklanganiga ${minutesLabel(drum)} (chegara ${DRUM_MAX_MIN} daq) — obyekt bilan bog'laning`, tone: drum >= DRUM_MAX_MIN ? "danger" : "warning" });
  }
  if (t.status !== "CANCELLED" && tripPlannedAt(t, t.order)) {
    const delay = tripDelayMin(t, t.order);
    const lvl = delayLevel(delay, await logisticsSettings());
    if (delay != null && lvl !== "ok") out.warnings.push({ label: "Kechikish", value: `+${minutesLabel(delay)}`, tone: lvl === "crit" ? "danger" : "warning" });
    else if (delay != null) out.fields.push({ label: "Kechikish", value: delay <= 0 ? "o'z vaqtida" : `+${minutesLabel(delay)}`, tone: "success" });
  }
  if (t.pickupAddress) out.fields.push({ label: "Yuk olgan joyi", value: t.pickupAddress });

  // ── Xarajatlar (yoqilg'i + boshqa) ── bekor qilingani «Bekor qilingan» bo'lib qoladi, jamiga kirmaydi
  const cNames = await cancellerNames([...t.fuelLogs, ...t.expenses]);
  const costs = [
    ...t.fuelLogs.map((f) => ({ id: `fuel:${f.id}`, at: f.date, title: `Yoqilg'i · ${FUEL_TYPE[f.fuelType]} ${fmtNum(n(f.liters), 1)} l`, note: f.note, amount: n(f.amount), cancel: cancelNote(f, cNames) })),
    ...t.expenses.map((e) => ({ id: `expenses:${e.id}`, at: e.date, title: EXPENSE_KIND[e.kind], note: e.note, amount: n(e.amount), cancel: cancelNote(e, cNames) })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const costSum = costs.filter((c) => !c.cancel).reduce((a, c) => a + c.amount, 0);
  if (costs.length) {
    const open = allowed(user, "fuel");
    out.sections.push({
      title: `Reys xarajatlari · ${money(costSum)}${n(t.qtyM3) ? ` · 1 birlikka ${money(costSum / n(t.qtyM3))}` : ""}`,
      empty: "", icon: "wallet", ...(open ? { target: "fuel" } : {}),
      rows: costs.map((c) => ({
        id: open ? c.id : c.id.split(":")[1]!, title: c.title, subtitle: [date(c.at), c.note, c.cancel ? `bekor qilindi: ${c.cancel}` : null].filter(Boolean).join(" · "), right: money(c.amount),
        ...(c.cancel ? { status: CANCELLED_LABEL, tone: "danger" as Tone } : {}),
      })),
    });
  }

  // ── Dispetcher amallari ──
  if (t.status === "LOADED" && can(user, "trip.dispatch.onroad")) {
    out.actions.push({ id: "trip.dispatch.onroad", label: "Yo'lga chiqdi (dispetcher)", tone: "brand", confirm: "Haydovchi ilovadan belgilay olmayaptimi? Reys yo'lga chiqdi deb belgilansinmi (auditda — dispetcher)?" });
  }
  if (["LOADED", "ON_ROAD"].includes(t.status) && can(user, "trip.dispatch.delivered")) {
    out.actions.push({ id: "trip.dispatch.delivered", label: "Yetkazildi (dispetcher)", tone: "success", form: RECEIVER_FIELDS, hint: "GPS tasdig'isiz — reysga muammo yoziladi va yopishdan oldin ko'rib chiqiladi" });
  }
  if (t.status === "LOADED" && can(user, "trip.pickup")) {
    const plant = await db.companySettings.findUnique({ where: { id: "main" }, select: { name: true, address: true, lat: true, lng: true } });
    const lat = t.pickupLat ?? plant?.lat ?? null, lng = t.pickupLng ?? plant?.lng ?? null;
    out.actions.push({
      id: "trip.pickup", label: "Yukni olgani joyi", tone: "brand",
      form: [
        { name: "pickupAddress", label: "Manzil", type: "text", required: true, value: t.pickupAddress ?? plant?.address ?? plant?.name ?? "" },
        // Ilovada xarita tanlovi yo'q — nuqta raqam bilan (xaritadan nusxa); bo'sh qolsa faqat manzil saqlanadi
        { name: "pickupLat", label: "Kenglik (lat)", type: "number", value: lat != null ? String(lat) : undefined, placeholder: "41.311081", hint: "Xaritadan nusxa oling; haydovchi ilovasida marshrut shu nuqtadan boshlanadi" },
        { name: "pickupLng", label: "Uzunlik (lng)", type: "number", value: lng != null ? String(lng) : undefined, placeholder: "69.240562" },
      ],
    });
  }
  if (t.status !== "CANCELLED" && can(user, "trip.cost")) {
    const price = await lastFuelPrice(null);
    out.actions.push({
      id: "trip.cost", label: "Xarajat qo'shish", tone: "warning",
      form: [
        { name: "what", label: "Nima", type: "select", required: true, value: "FUEL", options: [{ value: "FUEL", label: "Yoqilg'i" }, ...TRIP_EXPENSE_KINDS.map((k) => ({ value: k, label: EXPENSE_KIND[k] }))] },
        { name: "liters", label: "Litr", type: "number", required: true, showIf: { field: "what", equals: "FUEL" } },
        { name: "pricePerL", label: "1 litr narxi, so'm", type: "number", required: true, value: price ? String(price) : undefined, showIf: { field: "what", equals: "FUEL" } },
        { name: "fuelType", label: "Yoqilg'i turi", type: "select", options: fuelTypeOptions, hint: "Bo'sh — transport kartasidagi tur", showIf: { field: "what", equals: "FUEL" } },
        { name: "odometerKm", label: "Probeg, km", type: "number", showIf: { field: "what", equals: "FUEL" } },
        { name: "station", label: "Zapravka", type: "text", showIf: { field: "what", equals: "FUEL" } },
        { name: "amount", label: "Summa, so'm (yoqilg'idan boshqa xarajat)", type: "number", hint: "Yoqilg'ida summa litr × narxdan hisoblanadi" },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  if (ecoEnabled() && t.ecoDeliveryId && t.status !== "CANCELLED" && can(user, "trip.pull")) {
    out.actions.push({ id: "trip.pull", label: "ECO'dan yangilash", tone: "warning" });
  }
  return out;
}

const fuelTypeOptions: FormOption[] = (Object.keys(FUEL_TYPE) as FuelType[]).map((k) => ({ value: k, label: FUEL_TYPE[k] }));
/** Transport kartasi: dizel va metan; eski kartadagi benzin/propan o'zgartirilmaguncha ro'yxatda qoladi. */
const vehicleFuelOptions = (cur?: string | null): FormOption[] => [
  ...VEHICLE_FUELS.map((k) => ({ value: k, label: FUEL_TYPE[k] })),
  ...(cur && !(VEHICLE_FUELS as readonly string[]).includes(cur) ? [{ value: cur, label: `${FUEL_TYPE[cur as FuelType]} (eski)` }] : []),
];

// ───────────────────────── Zayavka kartochkasidan reys ochish ─────────────────────────

/** Transport va haydovchi tanlovi — veb/mobil "Yangi reys" formasidagi bilan bir xil ro'yxat. */
async function tripResourceFields(): Promise<FormField[]> {
  const [vehicles, drivers] = await Promise.all([
    db.vehicle.findMany({ where: { isActive: true, type: { in: ["MIXER", "TRUCK"] } }, orderBy: [{ type: "asc" }, { plate: "asc" }] }),
    db.employee.findMany({ where: { isActive: true, position: { in: await driverPositionNames() } }, orderBy: { fullName: "asc" }, include: { vehicle: { select: { plate: true } } } }),
  ]);
  return [
    { name: "vehicleId", label: "Texnika", type: "select", required: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.type === "MIXER" ? "mikser" : "yuk mashina"}${capText(v) ? ` · ${capText(v)}` : ""}${v.status === "REPAIR" ? " · ta'mirda" : ""}` })), hint: "Beton — mikser, dona mahsulot — yuk mashina" },
    { name: "driverId", label: "Haydovchi", type: "select", required: true, options: drivers.map((d) => ({ value: d.id, label: `${d.fullName}${d.vehicle ? ` · ${d.vehicle.plate}` : " · texnikasiz"}${normalizePhone(d.phone) ? "" : " · telefonsiz"}`, extra: d.vehicleId ? { vehicleId: d.vehicleId } : undefined })) },
  ];
}

/**
 * "Reys ochish" zayavka kartasida (veb «+ Reys» → `/trips/new?orderId=`): zayavka tanlangan, tayyor miqdor va
 * reja vaqti oldindan to'ldirilgan. Eski ilova ham ishlaydi — oddiy formali amal.
 */
export async function orderTripAction(user: MobileUser, orderId: string): Promise<DetailAction | null> {
  if (!can(user, "order.trip")) return null;
  const o = await db.order.findUnique({ where: { id: orderId }, include: READINESS_INCLUDE });
  if (!o || o.kind !== "SALE" || !["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return null;
  const rd = orderReadiness(o);
  if (!(rd.available > 0.001)) return null;
  const plan = plannedExtra(o);
  return {
    id: "order.trip", label: "Reys ochish", tone: "brand",
    form: [
      ...(await tripResourceFields()),
      { name: "qtyM3", label: `Hajmi${rd.unit ? `, ${unitLabel(rd.unit)}` : ""}`, type: "number", required: true, value: String(rd.available), hint: `Tayyor ${rd.available}${rd.inProduction > 0 ? ` · sexda ${rd.inProduction}` : ""}` },
      ...plannedFields(plan.plannedDate, plan.plannedTime),
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

// ───────────────────────── Xodim (haydovchi) kartochkasi — qo'shimchalar ─────────────────────────

/** Haydovchi kartasi: guvohnoma, toifa, muddat, grafik, transport (logistika) va ECO ilovasi (ulash / tasdiqlash). */
export async function driverExtras(user: MobileUser, employeeId: string): Promise<{ fields: DetailField[]; actions: DetailAction[] }> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, include: { vehicle: { select: { plate: true } } } });
  if (!e) return { fields: [], actions: [] };
  const names = (await driverPositionNames()).map((x) => x.trim().toLowerCase());
  const isDriver = names.includes(e.position.trim().toLowerCase()) || !!e.vehicleId || !!e.licenseNo;
  if (!isDriver) return { fields: [], actions: [] };
  const lic = expiryLevel(e.licenseExpiry);
  const fields: DetailField[] = [
    { label: "Guvohnoma", value: [e.licenseNo, e.licenseCategory].filter(Boolean).join(" · ") || "—" },
    { label: "Guvohnoma muddati", value: e.licenseExpiry ? date(e.licenseExpiry) : "—", tone: lic === "crit" ? "danger" : lic === "warn" ? "warning" : undefined },
    { label: "Ish grafigi", value: e.workSchedule ?? "—" },
    { label: "Transport", value: e.vehicle?.plate ?? "biriktirilmagan", tone: e.vehicle ? undefined : "warning" },
  ];
  const actions: DetailAction[] = [];
  if (can(user, "driver.card")) {
    const vehicles = await db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" }, select: { id: true, plate: true } });
    actions.push({
      id: "driver.card", label: "Haydovchi kartasi", tone: "brand",
      form: [
        { name: "licenseNo", label: "Guvohnoma raqami", type: "text", value: e.licenseNo ?? undefined },
        { name: "licenseCategory", label: "Toifalar", type: "text", value: e.licenseCategory ?? undefined, placeholder: "B, C, CE" },
        { name: "licenseExpiry", label: "Guvohnoma muddati", type: "text", value: e.licenseExpiry ? dateRu(e.licenseExpiry) : undefined, placeholder: "kk.oo.yyyy" },
        { name: "workSchedule", label: "Ish grafigi", type: "text", value: e.workSchedule ?? undefined, placeholder: "08:00–20:00, 2/2" },
        { name: "vehicleId", label: "Biriktirilgan transport", type: "select", value: e.vehicleId ?? "", options: [{ value: "", label: "Biriktirilmagan" }, ...vehicles.map((v) => ({ value: v.id, label: v.plate }))] },
      ],
    });
  }
  if (ecoEnabled() && e.isActive) {
    if ((!e.ecoUserId || e.ecoError) && can(user, "driver.link")) actions.push({ id: "driver.link", label: e.ecoUserId ? "ECO'ga qayta ulash" : "Haydovchi ilovasiga ulash", tone: "brand", confirm: "Xodim Insof ECO haydovchi ilovasiga ulansinmi? Telefoni +998… bo'lishi shart." });
    if (e.ecoUserId && !e.ecoActive && can(user, "driver.approve")) actions.push({ id: "driver.approve", label: "Ilovada tasdiqlash", tone: "success", confirm: "Haydovchi ilovaga kira olsinmi?" });
  }
  return { fields, actions };
}

// ───────────────────────── Kartochkalar ─────────────────────────

export async function logiDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  switch (key) {
    case "vehicles": return vehicleDetail(user, id.split("~")[0]!);
    case "fuel": return fuelDetail(user, id);
    case "expenses": return expenseDetail(user, id);
    case "sites": return siteDetail(user, id);
    case "logi-report": return reportDetail(user, id);
    case "trip-pay": return tripPayDetail(user, id);
    default: throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  }
}

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Saflda", REPAIR: "Ta'mirda", IDLE: "Bekor turibdi" };
const expiryTone = (d: Date | null): Tone | undefined => { const l = expiryLevel(d); return l === "crit" ? "danger" : l === "warn" ? "warning" : undefined; };

/** Transport tahrirlash / qo'shish maydonlari (veb `transport/vehicle-form.tsx`). */
async function vehicleFields(v?: {
  plate: string; type: string; brand: string | null; model: string | null; year: number | null; capacityM3: unknown; capacityUnit: string; fuelType: string | null;
  fuelNormL100: unknown; idleNormPerHour: unknown; odometerKm: number | null; hasGps: boolean; inspectionUntil: Date | null; insuranceCompany: string | null;
  insurancePolicy: string | null; insuranceUntil: Date | null; isActive: boolean; note: string | null; driverId: string | null;
}): Promise<FormField[]> {
  const drivers = await driverEmployees({ activeOnly: true });
  const s = (x: unknown) => (x == null || x === "" ? undefined : String(Number.isFinite(Number(x)) ? Number(x) : x));
  return [
    { name: "plate", label: "Davlat raqami", type: "text", required: true, value: v?.plate, placeholder: "01 A 123 BC" },
    { name: "type", label: "Turi", type: "select", required: true, value: v?.type ?? "MIXER", options: Object.entries(VEHICLE_TYPE).map(([value, label]) => ({ value, label })) },
    { name: "capacityM3", label: "Yuk sig'imi", type: "number", value: s(v?.capacityM3), hint: "Mikser — m³ (majburiy); yuk mashina — quyidagi birlikda" },
    { name: "capacityUnit", label: "Yuk mashina sig'imi birligi", type: "select", value: v?.capacityUnit && v.capacityUnit !== "M3" ? v.capacityUnit : "TON", options: [{ value: "TON", label: "Tonna" }, { value: "PIECE", label: "Dona (birlik)" }], showIf: { field: "type", equals: "TRUCK" } },
    { name: "brand", label: "Marka", type: "text", value: v?.brand ?? undefined, placeholder: "Howo, Shacman, Kamaz" },
    { name: "model", label: "Modeli", type: "text", value: v?.model ?? undefined },
    { name: "year", label: "Yili", type: "number", value: s(v?.year) },
    { name: "driverId", label: "Biriktirilgan haydovchi", type: "select", value: v?.driverId ?? "", options: [{ value: "", label: "Biriktirilmagan" }, ...drivers.map((d) => ({ value: d.id, label: d.fullName }))], hint: "Reys ochilganda o'zi tanlanadi" },
    { name: "fuelType", label: "Yoqilg'i turi", type: "select", value: v?.fuelType ?? "DIESEL", options: vehicleFuelOptions(v?.fuelType) },
    { name: "fuelNormL100", label: "Sarf normasi 100 km ga (dizel — l, metan — m³)", type: "number", value: s(v?.fuelNormL100), hint: `Metan bo'sh qolsa — ${METHANE_NORM.per100km} m³` },
    { name: "idleNormPerHour", label: "Turib ishlash (mikser aylantirish), soatiga", type: "number", value: s(v?.idleNormPerHour), hint: `Metan bo'sh qolsa — ${METHANE_NORM.perHour} m³` },
    { name: "odometerKm", label: "Probeg, km", type: "number", value: s(v?.odometerKm), hint: v?.odometerKm != null ? "Kamaytirib bo'lmaydi — faqat xatoni tuzatish (sababi bilan)" : undefined },
    ...(v?.odometerKm != null ? [{ name: "odometerReason", label: "Probegni kamaytirish sababi", type: "text" as const, hint: "Faqat probeg avvalgisidan kam kiritilsa kerak (auditga yoziladi)" }] : []),
    { name: "hasGps", label: "Doimiy GPS-treker o'rnatilgan", type: "switch", value: v?.hasGps ? "true" : "false" },
    // Ilovadagi sana tanlovi faqat yaqin 14 kun — hujjat muddati uzoq bo'ladi, shuning uchun matn (kk.oo.yyyy)
    { name: "inspectionUntil", label: "Texnik ko'rik muddati", type: "text", value: v?.inspectionUntil ? dateRu(v.inspectionUntil) : undefined, placeholder: "kk.oo.yyyy" },
    { name: "insuranceCompany", label: "Sug'urta kompaniyasi", type: "text", value: v?.insuranceCompany ?? undefined },
    { name: "insurancePolicy", label: "Polis raqami", type: "text", value: v?.insurancePolicy ?? undefined },
    { name: "insuranceUntil", label: "Sug'urta muddati", type: "text", value: v?.insuranceUntil ? dateRu(v.insuranceUntil) : undefined, placeholder: "kk.oo.yyyy" },
    ...(v ? [{ name: "isActive", label: "Faol (reysga beriladi)", type: "switch" as const, value: v.isActive ? "true" : "false", hint: "Sotilgan / hisobdan chiqarilgan bo'lsa o'chiring" }] : []),
    { name: "note", label: "Izoh", type: "text", value: v?.note ?? undefined },
  ];
}

const serviceFields = (odometerKm: number | null): FormField[] => [
  { name: "kind", label: "Xizmat turi", type: "select", required: true, value: SERVICE_KINDS[0], options: SERVICE_KINDS.map((k) => ({ value: k, label: k })) },
  { name: "date", label: "Sana", type: "text", value: dateRu(new Date()), placeholder: "kk.oo.yyyy" },
  { name: "odometerKm", label: "Probeg, km", type: "number", hint: odometerKm != null ? `Kartada: ${fmtNum(odometerKm)} km` : undefined },
  { name: "cost", label: "Narx, so'm", type: "number", hint: "Jurnal uchun; pul xarajati alohida yoziladi" },
  { name: "nextDueAt", label: "Keyingi xizmat sanasi", type: "text", placeholder: "kk.oo.yyyy" },
  { name: "nextDueKm", label: "Keyingi xizmat probegi, km", type: "number" },
  { name: "note", label: "Izoh", type: "text", placeholder: "Nima qilindi: moy 15W-40, filtr, shina…" },
];

/** Zapravka maydonlari — `vehicleId` berilsa transport tanlovi chiqmaydi (transport kartasidan). */
async function fuelFields(vehicleId?: string): Promise<FormField[]> {
  const since = new Date(); since.setDate(since.getDate() - 7);
  const [vehicles, drivers, trips, price] = await Promise.all([
    db.vehicle.findMany({ where: { isActive: true, ...(vehicleId ? { id: vehicleId } : {}) }, orderBy: { plate: "asc" }, include: { drivers: { where: { isActive: true }, select: { id: true }, take: 1 } } }),
    driverEmployees({ activeOnly: true }),
    db.trip.findMany({ where: { createdAt: { gte: since }, status: { not: "CANCELLED" }, ...(vehicleId ? { vehicleId } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, deliveryNoteNo: true, vehicleId: true, order: { select: { customer: { select: { name: true } } } } } }),
    lastFuelPrice(),
  ]);
  const own = vehicleId ? vehicles[0] : undefined;
  return [
    ...(vehicleId ? [] : [{ name: "vehicleId", label: "Transport", type: "select" as const, required: true, options: vehicles.map((v) => ({ value: v.id, label: v.plate, extra: { ...(v.drivers[0] ? { driverId: v.drivers[0].id } : {}), ...(v.fuelType ? { fuelType: v.fuelType } : {}) } })) }]),
    { name: "driverId", label: "Haydovchi", type: "select", value: own?.drivers[0]?.id, options: [{ value: "", label: "—" }, ...drivers.map((d) => ({ value: d.id, label: d.fullName }))] },
    { name: "tripId", label: "Reys (oxirgi 7 kun)", type: "select", options: [{ value: "", label: "—" }, ...trips.map((t) => ({ value: t.id, label: `${t.deliveryNoteNo} · ${t.order.customer.name}`, extra: { vehicleId: t.vehicleId } }))], ...(vehicleId ? {} : { dependsOn: "vehicleId" }) },
    { name: "fuelType", label: "Yoqilg'i turi", type: "select", value: own?.fuelType ?? undefined, options: fuelTypeOptions, hint: "Bo'sh — transport kartasidagi tur" },
    { name: "liters", label: "Litr", type: "number", required: true },
    { name: "pricePerL", label: "1 litr narxi, so'm", type: "number", required: true, value: price ? String(price) : undefined },
    { name: "odometerKm", label: "Probeg (spidometr), km", type: "number", hint: own?.odometerKm != null ? `Oxirgi: ${fmtNum(own.odometerKm)} km` : undefined },
    { name: "station", label: "Zapravka", type: "text" },
    { name: "date", label: "Sana", type: "text", placeholder: "kk.oo.yyyy", hint: "Bo'sh — bugun" },
    { name: "note", label: "Izoh", type: "text" },
  ];
}

/** Xarajat maydonlari. Mexanik — faqat ta'mir / ehtiyot qism / yuvish, transportga (veb `VehicleExpenseForm`). */
async function expenseFields(role: Role, vehicleId?: string): Promise<FormField[]> {
  const mech = role === "MECHANIC";
  const kinds = mech ? MECHANIC_EXPENSE_KINDS : EXPENSE_KINDS;
  const head: FormField[] = [
    { name: "kind", label: "Turi", type: "select", required: true, value: mech ? "REPAIR" : undefined, options: kinds.map((k) => ({ value: k, label: EXPENSE_KIND[k] })) },
    { name: "amount", label: "Summa, so'm", type: "number", required: true },
  ];
  const tail: FormField[] = [
    { name: "date", label: "Sana", type: "text", placeholder: "kk.oo.yyyy", hint: "Bo'sh — bugun" },
    { name: "note", label: "Izoh", type: "text" },
  ];
  if (mech) return [...head, ...tail];
  const since = new Date(); since.setDate(since.getDate() - 7);
  const [vehicles, drivers, trips] = await Promise.all([
    vehicleId ? Promise.resolve([]) : db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" }, select: { id: true, plate: true } }),
    driverEmployees({ activeOnly: true }),
    db.trip.findMany({ where: { createdAt: { gte: since }, status: { not: "CANCELLED" }, ...(vehicleId ? { vehicleId } : {}) }, orderBy: { createdAt: "desc" }, select: { id: true, deliveryNoteNo: true, vehicleId: true, order: { select: { customer: { select: { name: true } } } } } }),
  ]);
  return [
    ...head,
    ...(vehicleId ? [] : [{ name: "vehicleId", label: "Transport", type: "select" as const, options: [{ value: "", label: "—" }, ...vehicles.map((v) => ({ value: v.id, label: v.plate }))], hint: "Transport, haydovchi yoki reysdan biri" }]),
    { name: "driverId", label: "Haydovchi", type: "select", options: [{ value: "", label: "—" }, ...drivers.map((d) => ({ value: d.id, label: d.fullName }))] },
    { name: "tripId", label: "Reys (oxirgi 7 kun)", type: "select", options: [{ value: "", label: "—" }, ...trips.map((t) => ({ value: t.id, label: `${t.deliveryNoteNo} · ${t.order.customer.name}`, extra: { vehicleId: t.vehicleId } }))], hint: "Reys tanlansa transport va haydovchi undan olinadi" },
    ...tail,
  ];
}

/** Transport kartasi — veb `logistika/transport/[id]`: ma'lumot, xizmat muddati, yoqilg'i va xarajat, jurnal, oxirgi reyslar. */
async function vehicleDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const monthFrom = new Date(); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const v = await db.vehicle.findUnique({
    where: { id },
    include: {
      drivers: { where: { isActive: true }, select: { id: true, fullName: true } },
      trips: { orderBy: { createdAt: "desc" }, take: 30, include: { order: { select: { orderNo: true, customer: { select: { name: true } } } }, driver: { select: { fullName: true } } } },
      fuelLogs: { orderBy: { date: "desc" }, take: 30, include: { driver: { select: { fullName: true } } } },
      expenses: { orderBy: { date: "desc" }, take: 30 },
      services: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 50, include: { createdBy: { select: { fullName: true } } } },
    },
  });
  if (!v) throw new ListError("NOT_FOUND", "Transport topilmadi", 404);
  const live = vehicleLive(v, v.trips);
  const due = await vehicleServiceDue({ vehicleId: v.id });
  // Bekor qilingan yozuvlar ro'yxatda «Bekor qilingan» bo'lib qoladi, lekin sarf, xarajat va muddatga kirmaydi
  const fuelOk = v.fuelLogs.filter((f) => !f.cancelledAt);
  const cNames = await cancellerNames([...v.fuelLogs, ...v.expenses, ...v.services]);
  const per100 = fuelConsumption(fuelOk).per100;
  const norm = v.fuelNormL100 ? n(v.fuelNormL100) : null;
  const monthTrips = v.trips.filter((t) => t.createdAt >= monthFrom && t.status !== "CANCELLED");
  const monthCost = fuelOk.filter((f) => f.date >= monthFrom).reduce((a, f) => a + n(f.amount), 0) + v.expenses.filter((e) => !e.cancelledAt && e.date >= monthFrom).reduce((a, e) => a + n(e.amount), 0);
  const current = v.trips.find((t) => ACTIVE_TRIP.includes(t.status));
  const actions: DetailAction[] = [];
  if (v.isActive && can(user, "vehicle.status")) {
    actions.push({
      id: "vehicle.status", label: `Holat: ${STATUS_LABEL[v.status] ?? v.status}`, tone: v.status === "ACTIVE" ? "brand" : "warning",
      form: [
        { name: "status", label: "Texnik holat", type: "select", required: true, value: v.status, options: VEHICLE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
        { name: "note", label: "Sabab", type: "text", value: v.statusNote ?? undefined, placeholder: "dvigatel, hujjat, haydovchi yo'q…", hint: "Ta'mirda / bekor turibdi — sababi majburiy; ta'mirdagi transport reysga berilmaydi" },
      ],
    });
  }
  if (can(user, "vehicle.service")) actions.push({ id: "vehicle.service", label: "Texnik xizmat yozish", tone: "brand", form: serviceFields(v.odometerKm) });
  if (v.isActive && can(user, "vehicle.fuel")) actions.push({ id: "vehicle.fuel", label: "Zapravka qo'shish", tone: "warning", form: await fuelFields(v.id) });
  if (can(user, "vehicle.expense")) actions.push({ id: "vehicle.expense", label: "Xarajat qo'shish", tone: "warning", form: await expenseFields(user.role, v.id) });
  if (can(user, "vehicle.edit")) {
    actions.push({ id: "vehicle.edit", label: "Kartani tahrirlash", form: await vehicleFields({ ...v, driverId: v.drivers[0]?.id ?? null }) });
  }
  const liveServices = v.services.filter((x) => !x.cancelledAt);
  if (liveServices.length && can(user, "vehicle.service.cancel")) {
    actions.push({
      id: "vehicle.service.cancel", label: "Xizmat yozuvini bekor qilish", tone: "danger",
      form: [
        { name: "serviceId", label: "Qaysi yozuv", type: "select", required: true, options: liveServices.map((x) => ({ value: x.id, label: `${x.kind} · ${date(x.date)}`, hint: x.note ?? undefined })), hint: "Faqat xato yozilganini bekor qiling — yozuv jurnalda «Bekor qilingan» bo'lib qoladi" },
        { name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda" },
      ],
    });
  }

  const fuelOpen = allowed(user, "fuel"), expOpen = allowed(user, "expenses");
  return {
    key: "vehicles", id: v.id, title: v.plate, subtitle: `${VEHICLE_TYPE[v.type] ?? v.type}${v.brand ? ` · ${v.brand}${v.model ? ` ${v.model}` : ""}` : ""}${v.year ? ` · ${v.year}` : ""}`,
    status: VEHICLE_LIVE[live].label,
    fields: [
      { label: "Joriy holat", value: `${VEHICLE_LIVE[live].label}${v.statusNote ? ` · ${v.statusNote}` : ""}`, tone: COLOR_TONE[VEHICLE_LIVE[live].color] },
      ...(current ? [{ label: "Hozirgi reys", value: current.deliveryNoteNo }] : []),
      { label: "Haydovchi", value: v.drivers.map((d) => d.fullName).join(", ") || "biriktirilmagan", tone: v.drivers.length ? undefined : "warning" },
      ...(capText(v) ? [{ label: "Sig'im", value: capText(v) }] : []),
      { label: "Yoqilg'i", value: `${v.fuelType ? FUEL_TYPE[v.fuelType] : "—"}${norm ? ` · norma ${fmtNum(norm, 1)} l/100` : ""}` },
      { label: "Haqiqiy sarf", value: per100 != null ? `${fmtNum(per100, 1)} l/100 km` : "—", tone: per100 != null && norm ? (per100 > norm * 1.1 ? "danger" : "success") : undefined },
      { label: "Probeg", value: v.odometerKm != null ? `${fmtNum(v.odometerKm)} km` : "—" },
      { label: "GPS", value: v.hasGps ? "Treker o'rnatilgan" : "Telefon GPS'i" },
      { label: "Texnik ko'rik", value: v.inspectionUntil ? date(v.inspectionUntil) : "—", tone: expiryTone(v.inspectionUntil) },
      { label: "Sug'urta", value: [v.insuranceCompany, v.insurancePolicy, v.insuranceUntil ? `${date(v.insuranceUntil)} gacha` : null].filter(Boolean).join(" · ") || "—", tone: expiryTone(v.insuranceUntil) },
      { label: "Shu oy", value: `${monthTrips.length} reys · ${fmtNum(monthTrips.reduce((a, t) => a + n(t.qtyM3), 0), 1)} · ${money(monthCost)}` },
      ...(!v.isActive ? [{ label: "Faol emas", value: "Reysga berilmaydi", tone: "danger" as Tone }] : []),
      ...(v.note ? [{ label: "Izoh", value: v.note }] : []),
    ],
    sections: [
      ...(due.length ? [{ title: "Texnik xizmat muddati", empty: "", icon: "wrench", rows: due.map((d) => ({ id: d.serviceId, title: d.kind, subtitle: d.text, tone: (d.level === "crit" ? "danger" : "warning") as Tone })) }] : []),
      { title: "Oxirgi reyslar", empty: "Reys yo'q", target: "trips", rows: v.trips.slice(0, 10).map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.driver.fullName} · ${t.loadedAt ? dateTime(t.loadedAt) : date(t.createdAt)}`, right: fmtNum(n(t.qtyM3), 1), status: TRIP_PHASE[tripPhase(t)].label, tone: tripTone(t) })) },
      {
        title: "Yoqilg'i", empty: "Zapravka yozilmagan", icon: "droplets", ...(fuelOpen ? { target: "fuel" } : {}),
        rows: v.fuelLogs.slice(0, 10).map((f) => ({
          id: f.id, title: `${fmtNum(n(f.liters), 1)} l · ${FUEL_TYPE[f.fuelType]}`, subtitle: [date(f.date), f.driver?.fullName, f.odometerKm != null ? `${fmtNum(f.odometerKm)} km` : null, f.cancelledAt ? `bekor qilindi: ${cancelNote(f, cNames)}` : null].filter(Boolean).join(" · "), right: money(n(f.amount)),
          ...(f.cancelledAt ? { status: CANCELLED_LABEL, tone: "danger" as Tone } : {}),
        })),
      },
      {
        title: "Boshqa xarajatlar", empty: "Xarajat yozilmagan", icon: "wallet", ...(expOpen ? { target: "expenses" } : {}),
        rows: v.expenses.slice(0, 10).map((e) => ({
          id: e.id, title: EXPENSE_KIND[e.kind], subtitle: [date(e.date), e.note, e.cancelledAt ? `bekor qilindi: ${cancelNote(e, cNames)}` : null].filter(Boolean).join(" · "), right: money(n(e.amount)),
          ...(e.cancelledAt ? { status: CANCELLED_LABEL, tone: "danger" as Tone } : {}),
        })),
      },
      {
        title: "Texnik xizmat jurnali", empty: "Xizmat yozilmagan", icon: "wrench",
        rows: v.services.map((x) => {
          const lv = x.cancelledAt ? null : serviceDueLevel(x, v.odometerKm);
          const next = [x.nextDueAt ? date(x.nextDueAt) : null, x.nextDueKm != null ? `${fmtNum(x.nextDueKm)} km` : null].filter(Boolean).join(" / ");
          return {
            id: `s${x.id}`, title: `${x.kind} · ${date(x.date)}`,
            subtitle: [x.odometerKm != null ? `${fmtNum(x.odometerKm)} km` : null, next ? `keyingisi ${next}` : null, x.note, x.createdBy.fullName, x.cancelledAt ? `bekor qilindi: ${cancelNote(x, cNames)}` : null].filter(Boolean).join(" · "),
            right: x.cost != null ? money(n(x.cost)) : undefined,
            ...(x.cancelledAt ? { status: CANCELLED_LABEL, tone: "danger" as Tone } : lv ? { status: lv.level === "crit" ? "O'tgan" : "Yaqin", tone: (lv.level === "crit" ? "danger" : "warning") as Tone } : {}),
          };
        }),
      },
    ],
    actions,
  };
}

/** Bekor qilish formasi — sabab majburiy (kamida 3 belgi, `cancelReasonOf`). */
const cancelForm = (hint: string): FormField[] => [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda", hint }];

/** Zapravka kartochkasi — yozuv va xato bo'lsa bekor qilish (veb «Yoqilg'i» jadvalidagi «Bekor qilish» tugmasi). */
async function fuelDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const f = await db.fuelLog.findUnique({ where: { id }, include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, trip: { select: { deliveryNoteNo: true } }, } });
  if (!f) throw new ListError("NOT_FOUND", "Zapravka topilmadi", 404);
  const by = await db.user.findUnique({ where: { id: f.createdById }, select: { fullName: true } });
  const cancel = cancelNote(f, await cancellerNames([f]));
  return {
    key: "fuel", id: f.id, title: `Zapravka · ${f.vehicle.plate}`, subtitle: date(f.date),
    ...(cancel ? { status: CANCELLED_LABEL } : {}),
    fields: [
      ...(cancel ? [{ label: CANCELLED_LABEL, value: cancel, tone: "danger" as Tone }] : []),
      { label: "Summa", value: money(n(f.amount)) },
      { label: "Litr", value: `${fmtNum(n(f.liters), 2)} l · ${FUEL_TYPE[f.fuelType]}` },
      { label: "1 litr narxi", value: money(n(f.pricePerL)) },
      ...(f.odometerKm != null ? [{ label: "Probeg", value: `${fmtNum(f.odometerKm)} km` }] : []),
      ...(f.driver ? [{ label: "Haydovchi", value: f.driver.fullName }] : []),
      ...(f.trip ? [{ label: "Reys", value: f.trip.deliveryNoteNo }] : []),
      ...(f.station ? [{ label: "Zapravka", value: f.station }] : []),
      ...(f.note ? [{ label: "Izoh", value: f.note }] : []),
      { label: "Kim yozdi", value: `${by?.fullName ?? "—"} · ${dateTime(f.createdAt)}` },
    ],
    sections: [],
    actions: !cancel && can(user, "fuel.cancel") ? [{ id: "fuel.cancel", label: "Bekor qilish", tone: "danger", form: cancelForm("Xato kiritilgan zapravka bekor qilinadi — yozuv «Bekor qilingan» bo'lib qoladi, jamiga kirmaydi; holati auditda") }] : [],
  };
}

async function expenseDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const e = await db.transportExpense.findUnique({ where: { id }, include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, trip: { select: { deliveryNoteNo: true } } } });
  if (!e) throw new ListError("NOT_FOUND", "Xarajat topilmadi", 404);
  const by = await db.user.findUnique({ where: { id: e.createdById }, select: { fullName: true } });
  const cancel = cancelNote(e, await cancellerNames([e]));
  return {
    key: "expenses", id: e.id, title: EXPENSE_KIND[e.kind], subtitle: date(e.date),
    ...(cancel ? { status: CANCELLED_LABEL } : {}),
    fields: [
      ...(cancel ? [{ label: CANCELLED_LABEL, value: cancel, tone: "danger" as Tone }] : []),
      { label: "Summa", value: money(n(e.amount)) },
      ...(e.vehicle ? [{ label: "Transport", value: e.vehicle.plate }] : []),
      ...(e.driver ? [{ label: "Haydovchi", value: e.driver.fullName }] : []),
      ...(e.trip ? [{ label: "Reys", value: e.trip.deliveryNoteNo }] : []),
      ...(e.note ? [{ label: "Izoh", value: e.note }] : []),
      { label: "Kim yozdi", value: `${by?.fullName ?? "—"} · ${dateTime(e.createdAt)}` },
    ],
    sections: [],
    actions: !cancel && can(user, "expense.cancel") ? [{ id: "expense.cancel", label: "Bekor qilish", tone: "danger", form: cancelForm("Xato kiritilgan xarajat bekor qilinadi — yozuv «Bekor qilingan» bo'lib qoladi, jamiga kirmaydi; holati auditda") }] : [],
  };
}

/**
 * Obyekt formasi maydonlari (veb `obyektlar/site-form.tsx`). Mijoz kartasidan yangi obyekt ochilganda
 * `customerId` beriladi — tanlov o'rniga yashirin qiymat (mijoz o'zgarmaydi).
 */
export async function siteFormFields(s?: { customerId: string; name: string; address: string; lat: number | null; lng: number | null; contactName: string | null; contactPhone: string | null; deliveryHours: string | null; instructions: string | null; isActive: boolean }, fixedCustomerId?: string): Promise<FormField[]> {
  const customers = fixedCustomerId ? [] : await db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return [
    ...(fixedCustomerId ? [] : [{ name: "customerId", label: "Mijoz", type: "select" as const, required: true, value: s?.customerId, options: customers.map((c) => ({ value: c.id, label: c.name })) }]),
    { name: "name", label: "Obyekt nomi", type: "text", required: true, value: s?.name },
    { name: "address", label: "Manzil", type: "text", required: true, value: s?.address },
    // Geozona markazi: haydovchi "Yetib keldim / Yetkazdim" shu nuqtadan 300 m ichida (ilovada xarita tanlovi yo'q — raqam bilan)
    { name: "lat", label: "Kenglik (lat)", type: "number", value: s?.lat != null ? String(s.lat) : undefined, placeholder: "41.311081", hint: "Obyekt nuqtasi — haydovchi navigatsiyasi va geozona (300 m) shu nuqtadan" },
    { name: "lng", label: "Uzunlik (lng)", type: "number", value: s?.lng != null ? String(s.lng) : undefined, placeholder: "69.240562" },
    { name: "contactName", label: "Obyektda kontakt", type: "text", value: s?.contactName ?? undefined },
    { name: "contactPhone", label: "Kontakt telefoni", type: "text", value: s?.contactPhone ?? undefined, placeholder: "+998 90 123 45 67" },
    { name: "deliveryHours", label: "Qabul vaqti", type: "text", value: s?.deliveryHours ?? undefined, placeholder: "08:00–18:00" },
    { name: "instructions", label: "Ko'rsatma", type: "text", value: s?.instructions ?? undefined, placeholder: "Kirish darvozasi, nasos joyi, yo'l cheklovi…" },
    ...(s ? [{ name: "isActive", label: "Faol", type: "switch" as const, value: s.isActive ? "true" : "false" }] : []),
  ];
}

/** Obyekt kartasi — veb `logistika/obyektlar/[id]`: kontakt, nuqta, buyurtmalar va yetkazish tarixi. */
async function siteDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const s = await db.site.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      orders: {
        orderBy: { deliveryDate: "desc" }, take: 50,
        include: {
          items: { select: { qtyM3: true, product: { select: { unit: true, name: true } } } },
          trips: { include: { vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, issues: { select: { resolvedAt: true } } }, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!s) throw new ListError("NOT_FOUND", "Obyekt topilmadi", 404);
  const trips = s.orders.flatMap((o) => o.trips.map((t) => ({ ...t, orderNo: o.orderNo })));
  const delivered = trips.filter((t) => t.status === "DELIVERED");
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const road = avg(delivered.filter((t) => t.loadedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.loadedAt!.getTime()) / 60000));
  const unload = avg(delivered.filter((t) => t.arrivedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.arrivedAt!.getTime()) / 60000));
  return {
    key: "sites", id: s.id, title: s.name, subtitle: `${s.customer.name} · ${s.address}`, status: s.isActive ? "Faol" : "Nofaol",
    fields: [
      { label: "Mijoz", value: `${s.customer.name}${s.customer.phone ? ` · ${s.customer.phone}` : ""}` },
      { label: "Manzil", value: s.address },
      { label: "Nuqta (geozona)", value: s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : "belgilanmagan", tone: s.lat != null ? "success" : "warning" },
      { label: "Kontakt", value: [s.contactName, s.contactPhone].filter(Boolean).join(", ") || "—", tone: s.contactName || s.contactPhone ? undefined : "warning" },
      ...(s.deliveryHours ? [{ label: "Qabul vaqti", value: s.deliveryHours }] : []),
      ...(s.instructions ? [{ label: "Ko'rsatma", value: s.instructions, tone: "warning" as Tone }] : []),
      { label: "Zayavkalar", value: String(s.orders.length) },
      { label: "Yetkazilgan", value: `${fmtNum(delivered.reduce((a, t) => a + n(t.qtyM3), 0), 1)} · ${delivered.length} reys` },
      { label: "O'rtacha yo'l", value: minutesLabel(road) },
      { label: "O'rtacha tushirish", value: minutesLabel(unload) },
    ],
    sections: [
      { title: "Buyurtmalar", empty: "Zayavka yo'q", target: "orders", rows: s.orders.slice(0, 20).map((o) => { const l = orderLogistics(o); return { id: o.id, title: o.orderNo, subtitle: `${deliveryAt(o.deliveryDate, o.deliveryTime)} · ${o.items.map((i) => i.product.name).join(", ")}`, right: fmtNum(l.total, 1), status: ORDER_LOGI[l.status].label, tone: l.problem || l.late ? "danger" as Tone : COLOR_TONE[ORDER_LOGI[l.status].color] }; }) },
      { title: "Yetkazib berish tarixi", empty: "Reys yo'q", target: "trips", rows: trips.slice(0, 20).map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.vehicle.plate}`, subtitle: [t.orderNo, t.driver.fullName, t.receiverName ? `qabul: ${t.receiverName}` : null, t.deliveredAt ? dateTime(t.deliveredAt) : null].filter(Boolean).join(" · "), right: `${t.acceptedQty != null ? `${fmtNum(n(t.acceptedQty), 1)} / ` : ""}${fmtNum(n(t.qtyM3), 1)}`, status: TRIP_PHASE[tripPhase(t)].label, tone: tripTone(t) })) },
    ],
    actions: can(user, "site.save") ? [{ id: "site.save", label: "Obyekt kartasini tahrirlash", tone: "brand", form: await siteFormFields(s) }] : [],
  };
}

/**
 * Davr hisoboti (veb «Hisobotlar» + «Analitika», Excel'siz) — `logisticsReport(from, to)` dan: o'z vaqtida %,
 * transport bandligi, haydovchilar reytingi, 1 m³ tannarxi; yetkazib berish (yuklangan / qabul / qaytgan, yopilmagan).
 */
async function reportDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const p = logiPeriod(id, "month");
  const [rep, delivered] = await Promise.all([
    logisticsReport(p.from, p.to),
    db.trip.findMany({
      where: { status: "DELIVERED", deliveredAt: { gte: p.from, lt: p.to } },
      select: { id: true, deliveryNoteNo: true, qtyM3: true, acceptedQty: true, returnedQty: true, closedAt: true, deliveredAt: true, order: { select: { customer: { select: { name: true } } } } },
      orderBy: { deliveredAt: "desc" },
    }),
  ]);
  const T = rep.total;
  const loaded = delivered.reduce((a, t) => a + n(t.qtyM3), 0);
  const acc = delivered.reduce((a, t) => a + n(t.acceptedQty ?? t.qtyM3), 0);
  const ret = delivered.reduce((a, t) => a + n(t.returnedQty), 0);
  const open = delivered.filter((t) => !t.closedAt);
  const totalCost = reportCost(T);
  const util = rep.byVehicle.filter((v) => v.trips > 0 || v.busyMin > 0);
  const avgUtil = util.length ? Math.round(util.reduce((a, v) => a + v.utilization, 0) / util.length) : null;
  const ot = onTimePct(T);
  const driversOpen = user.role === "DIRECTOR" || user.role === "LOGISTICS";

  const days = rep.byDay;
  const bars: SectionChart = {
    kind: "bars",
    series: [{ key: "m3", label: "Beton, m³" }, { key: "trips", label: "Yetkazilgan reys" }],
    points: days.map((d) => ({ label: d.day.slice(8, 10) + "." + d.day.slice(5, 7), values: [Math.round(d.m3 * 10) / 10, d.delivered], texts: [`${fmtNum(d.m3, 1)} m³`, `${d.delivered} reys${onTimePct(d) != null ? ` · o'z vaqtida ${onTimePct(d)}%` : ""}`] })),
    total: `${fmtNum(T.m3, 1)} m³ · ${T.delivered} reys`,
  };
  const utilChart: SectionChart = {
    kind: "progress",
    items: rep.byVehicle.slice(0, 12).map((v) => ({ label: v.plate, pct: v.utilization, fact: `${v.trips} reys · ${fmtNum(v.m3, 1)} m³`, plan: null, tone: (v.utilization >= 80 ? "success" : v.utilization >= 40 ? "warning" : "info") as Tone })),
  };
  return {
    key: "logi-report", id: p.key, title: `Logistika hisoboti · ${p.label}`, subtitle: `${dateRu(p.from)} — ${dateRu(new Date(p.to.getTime() - 86_400_000))}`,
    fields: [
      { label: "Reyslar", value: `${T.trips} · ${T.delivered} yetkazildi${T.cancelled ? ` · ${T.cancelled} bekor` : ""}` },
      { label: "Yetkazildi", value: `${fmtNum(T.m3, 1)} m³${T.pieces ? ` · ${fmtNum(T.pieces)} dona` : ""}`, tone: "brand" },
      { label: "O'z vaqtida", value: ot != null ? `${ot}% (${T.judged - T.late} / ${T.judged})` : "—", tone: ot == null ? undefined : ot >= 90 ? "success" : ot >= 75 ? "warning" : "danger" },
      { label: "O'rtacha yetkazish", value: minutesLabel(avgMin(T)) },
      { label: "Transport bandligi", value: avgUtil != null ? `${avgUtil}% (o'rtacha, ${rep.workDays} ish kuni)` : "—" },
      { label: "Xarajat", value: `${money(totalCost)} · yoqilg'i ${moneyShort(T.fuel)} · boshqa ${moneyShort(T.other)}` },
      { label: "1 m³ ga tannarx", value: T.m3 ? money(totalCost / T.m3) : "—" },
      { label: "Yuklangan / qabul / qaytgan", value: `${fmtNum(loaded, 1)} / ${fmtNum(acc, 1)} / ${fmtNum(ret, 1)}`, tone: ret > 0 ? "warning" : undefined },
      { label: "Yopilmagan reyslar", value: String(open.length), tone: open.length ? "warning" : "success" },
      { label: "Muammolar", value: String(T.issues), tone: T.issues ? "warning" : undefined },
    ],
    sections: [
      { title: "Boshqa davr", empty: "", target: "logi-report", icon: "calendar-days", rows: PERIODS.filter((x) => x.key !== p.key).map((x) => ({ id: x.key, title: logiPeriod(x.key).label })) },
      ...(open.length ? [{ title: "Yopilmagan reyslar", empty: "", target: "trips", rows: open.slice(0, 15).map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: t.deliveredAt ? dateTime(t.deliveredAt) : undefined, right: `${fmtNum(n(t.acceptedQty ?? t.qtyM3), 1)} / ${fmtNum(n(t.qtyM3), 1)}`, tone: "warning" as Tone })) }] : []),
      { title: "Kunlar bo'yicha", empty: "Bu davrda reys yo'q", icon: "chart-column", chart: bars, rows: days.map((d) => ({ id: d.day, title: d.day.split("-").reverse().join("."), subtitle: `${d.delivered} reys · o'z vaqtida ${onTimePct(d) ?? "—"}%`, right: `${fmtNum(d.m3, 1)} m³` })) },
      { title: "Transport bandligi", empty: "Transport yo'q", target: "vehicles", chart: utilChart, rows: rep.byVehicle.slice(0, 20).map((v) => ({ id: v.id, title: v.plate, subtitle: `${v.trips} reys · ${fmtNum(v.km, 0)} km · ${moneyShort(v.fuel + v.other)}${v.m3 ? ` · 1 m³ ga ${moneyShort((v.fuel + v.other) / v.m3)}` : ""}`, right: `${v.utilization}%`, tone: (v.utilization >= 80 ? "success" : v.utilization >= 40 ? "warning" : "info") as Tone })) },
      {
        title: "Haydovchilar reytingi", empty: "Bu davrda reys yo'q", ...(driversOpen ? { target: "employees" } : {}), icon: "id-card",
        rows: rep.byDriver.slice(0, 20).map((d, i) => ({ id: d.id, title: `${i + 1}. ${d.name}`, subtitle: `${d.delivered} reys · o'z vaqtida ${onTimePct(d) ?? "—"}% · o'rt. ${minutesLabel(avgMin(d))}${d.issues ? ` · ${d.issues} muammo` : ""}`, right: `${fmtNum(d.m3, 1)} m³`, tone: (onTimePct(d) != null && onTimePct(d)! < 75 ? "warning" : "success") as Tone })),
      },
      { title: "Obyektlar", empty: "Bu davrda reys yo'q", icon: "map-pin", rows: rep.bySite.slice(0, 10).map((s) => ({ id: s.id, title: s.name, subtitle: `${s.customer} · ${s.delivered} reys`, right: `${fmtNum(s.m3 + s.pieces, 1)}` })) },
    ],
    actions: [],
  };
}

// ───────────────────────── Bosh sahifa qo'shimchalari ─────────────────────────

/**
 * Logistika bosh sahifasi (veb `dashboard/logistics-home.tsx`): transport holati va bandligi, bugungi haydovchilar,
 * so'nggi 14 kun, nasoslar va boshqa kunni ochish. Raqamlar — `logisticsDashboard()` dan (bosh sahifa bilan bitta chaqiruv).
 */
export function logisticsHomeSections(d: LogisticsDashboard): HomeSection[] {
  const shift = Math.max(60, (d.settings.shiftEndHour - d.settings.shiftStartHour) * 60);
  const pumpFleet = d.vehicles.filter((v) => v.type === "PUMP" && v.live !== "INACTIVE");
  const freePumps = pumpFleet.filter((v) => v.live === "FREE" || v.live === "IDLE").length;
  const maxM3 = Math.max(1, ...d.week.map((w) => w.m3));
  return [
    {
      title: "Transport holati", empty: "Faol transport yo'q", target: "vehicles", icon: "truck",
      rows: d.vehicles.filter((v) => v.live !== "INACTIVE").map((v) => ({
        id: v.id,
        title: `${v.plate} · ${VEHICLE_TYPE[v.type] ?? v.type}${v.capacity ? ` · ${v.capacity} m³` : ""}`,
        subtitle: [v.driver ?? "haydovchisiz", `${v.todayTrips} reys`, `bandlik ${Math.round((v.busyMin / shift) * 100)}%`, v.trip?.noteNo, v.statusNote, v.docs === "crit" ? "hujjat o'tgan" : null].filter(Boolean).join(" · "),
        status: VEHICLE_LIVE[v.live].label,
        tone: v.docs === "crit" ? "danger" as Tone : COLOR_TONE[VEHICLE_LIVE[v.live].color],
      })),
    },
    {
      title: "Haydovchilar (bugun)", empty: "Bugun reys yo'q", target: "employees", icon: "id-card",
      rows: d.drivers.map((x) => ({
        id: x.id, title: `${x.name}${x.active ? " · yo'lda" : ""}`,
        subtitle: `${x.trips} reys · ${fmtNum(x.qty, 1)} · o'rt. ${minutesLabel(x.avgMin)}${x.late ? ` · kechikish ${x.late}` : ""}${x.issues ? ` · muammo ${x.issues}` : ""}`,
        tone: (x.issues ? "danger" : x.late ? "warning" : "success") as Tone,
      })),
    },
    {
      title: "So'nggi 14 kun", empty: "", icon: "chart-column",
      chart: {
        kind: "bars", series: [{ key: "m3", label: "Beton, m³" }],
        points: d.week.map((w) => ({ label: String(w.day.getDate()), values: [Math.round(w.m3 * 10) / 10], texts: [`${dm(w.day)}: ${fmtNum(w.m3, 1)} m³ · ${w.trips} reys${w.onTime != null ? ` · o'z vaqtida ${w.onTime}%` : ""}`] })),
        total: `${fmtNum(d.week.reduce((a, w) => a + w.m3, 0), 1)} m³`,
      },
      rows: d.week.slice().reverse().map((w) => ({ id: ymd(w.day), title: dm(w.day), subtitle: `${w.trips} reys${w.onTime != null ? ` · o'z vaqtida ${w.onTime}%` : ""}`, right: `${fmtNum(w.m3, 1)} m³`, tone: (w.onTime != null && w.onTime < 75 ? "warning" : w.m3 >= maxM3 * 0.8 ? "success" : "info") as Tone })),
    },
    {
      title: `Nasoslar · ${freePumps} bo'sh / ${pumpFleet.length}`, empty: "Nasos kerak bo'lgan ochiq zayavka yo'q", target: "orders", icon: "truck",
      rows: d.pumps.map((x) => ({ id: x.orderId, title: `${x.orderNo} · ${x.customer}`, right: x.time ?? "—", tone: (d.pumps.length > freePumps ? "warning" : "info") as Tone })),
    },
    {
      title: "Kun rejasi", empty: "", icon: "calendar-days",
      rows: [{ id: "logi-day", title: "Dispetcher kalendari", subtitle: "Boshqa kunni tanlash · soatsiz va oldingi kundan qolgan zayavkalar", open: "logi-day" }],
    },
  ];
}

/** Mexanik bosh sahifasi: «Texnik xizmat muddati» (veb `mechanic-home.tsx`, `vehicleServiceDue()`) — qator transport kartasini ochadi. */
export async function mechanicServiceSection(): Promise<HomeSection | null> {
  const due = await vehicleServiceDue();
  if (!due.length) return null;
  return {
    title: "Texnik xizmat muddati", empty: "", target: "vehicles", icon: "wrench",
    rows: due.slice(0, 15).map((d) => ({ id: `${d.vehicleId}~${d.serviceId}`, title: `${d.plate} · ${d.kind}`, subtitle: d.text, status: d.level === "crit" ? "O'tgan" : "Yaqin", tone: (d.level === "crit" ? "danger" : "warning") as Tone })),
  };
}

// ───────────────────────── Yangi hujjat formalari ─────────────────────────

export const LOGI_FORMS = new Set(Object.keys(LOGI_CREATE));

export async function logiForm(user: MobileUser, key: string): Promise<CreateForm> {
  const meta = LOGI_CREATE[key]!;
  switch (key) {
    case "vehicles": return { key, title: meta.title, submitLabel: "Qo'shish", fields: await vehicleFields() };
    case "fuel": return { key, title: meta.title, submitLabel: "Saqlash", fields: await fuelFields() };
    case "expenses": return { key, title: meta.title, submitLabel: "Saqlash", fields: await expenseFields(user.role) };
    case "sites": return { key, title: meta.title, submitLabel: "Qo'shish", fields: await siteFormFields() };
    default: throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  }
}

export async function logiCreate(user: MobileUser, key: string, payload: unknown): Promise<CreateResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (key) {
    case "vehicles": {
      const id = done(await saveVehicleRecord(null, parse(vehicleSchema, { isActive: true, ...p }), user.id));
      return { key: "vehicles", id, message: "Transport qo'shildi" };
    }
    case "fuel": {
      const d = parse(fuelSchema, p);
      const id = done(await addFuelRecord(d, user.id));
      return { key: "fuel", id, message: `Zapravka yozildi: ${money(Math.round((d.liters ?? 0) * (d.pricePerL ?? 0)))}` };
    }
    case "expenses": {
      const d = parse(expenseSchema, p);
      const id = done(await addExpenseRecord(user.role, d, user.id));
      return { key: "expenses", id, message: `Xarajat yozildi: ${money(d.amount ?? 0)}` };
    }
    case "sites": {
      const id = await runSiteSave(user, null, p);
      return { key: "sites", id, message: "Obyekt qo'shildi" };
    }
    default: throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  }
}

// ───────────────────────── Amallar ─────────────────────────

export const LOGI_ACTIONS = new Set(Object.keys(LOGI_ACTION_ROLES));

/**
 * Obyektni saqlash (`site.save`) — logistika obyekt kartasidan ham, mijoz kartasidan ham (sotuv) chaqiriladi.
 * `id`: mavjud obyekt bo'lsa — tahrir; aks holda yangi obyekt (mijoz — `payload.customerId`, bo'lmasa `id` mijoz id'si).
 * Qaytaradi: obyekt id'si. Ruxsat (`logistika` → `sites`) chaqiruvchida.
 */
export async function runSiteSave(user: MobileUser, id: string | null, payload: Record<string, unknown>): Promise<string> {
  const site = id ? await db.site.findUnique({ where: { id }, select: { id: true, customerId: true, isActive: true } }) : null;
  if (site) {
    return done(await saveSiteRecord(site.id, parse(siteSchema, { customerId: site.customerId, isActive: site.isActive, ...payload }), user.id));
  }
  const customerId = textOf(payload, "customerId") || id || "";
  if (!customerId || !(await db.customer.count({ where: { id: customerId } }))) fail("Mijozni tanlang");
  return done(await saveSiteRecord(null, parse(siteSchema, { ...payload, customerId }), user.id));
}

export async function runLogiAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  const APP_NOTE = "Dispetcher belgiladi (ilova)";
  switch (action) {
    case "trip.dispatch.onroad": {
      const r = await dispatchOnRoad(id, user.id, APP_NOTE);
      if ("error" in r) return fail(r.error);
      if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "EN_ROUTE"));
      return "Reys yo'lga chiqdi (dispetcher belgiladi)";
    }
    case "trip.dispatch.delivered": {
      const receiverName = textOf(payload, "receiverName");
      const q = { acceptedQty: optNum(payload, "acceptedQty"), returnedQty: optNum(payload, "returnedQty"), comment: textOf(payload, "comment") || null };
      const r = await dispatchDelivered(id, user.id, receiverName, q, APP_NOTE);
      if ("error" in r) return fail(r.error);
      if (ecoEnabled()) after(() => pushTripStatus(id, "COMPLETED", { note: `Qabul qildi: ${receiverName}`, acceptedM3: q.acceptedQty ?? undefined }));
      return "Yetkazildi deb belgilandi — GPS tasdig'isiz, reysga muammo yozildi (yopishdan oldin hal qiling)";
    }
    case "trip.pickup": {
      const lat = optNum(payload, "pickupLat"), lng = optNum(payload, "pickupLng");
      if ((lat == null) !== (lng == null)) fail("Nuqta uchun kenglik va uzunlikni birga kiriting");
      if (lat != null && (lat < -90 || lat > 90)) fail("Kenglik −90…90 oralig'ida bo'lsin");
      if (lng != null && (lng < -180 || lng > 180)) fail("Uzunlik −180…180 oralig'ida bo'lsin");
      const r = await tripPickup(id, user.id, { address: textOf(payload, "pickupAddress"), lat, lng });
      if (r.error) fail(r.error);
      return "Yuk olgan joyi saqlandi";
    }
    case "trip.cost": {
      const what = textOf(payload, "what");
      const r = await addTripCostRecord(id, {
        what, fuelType: textOf(payload, "fuelType"), liters: optNum(payload, "liters"), pricePerL: optNum(payload, "pricePerL"),
        odometerKm: optNum(payload, "odometerKm"), station: textOf(payload, "station"), amount: optNum(payload, "amount"), note: textOf(payload, "note"),
      }, user.id);
      if ("error" in r) return fail(r.error);
      return what === "FUEL" ? "Zapravka yozildi" : "Xarajat yozildi";
    }
    case "trip.pull": {
      const r = await pullTripFromEco(id);
      if (r.skipped) fail("ECO ulanmagan");
      if (!r.ok) fail(r.error ?? "ECO'dan olib bo'lmadi", 502);
      return "Haydovchi ilovasidagi holat olindi";
    }
    // Ilova ichidagi havola — eski ilova serverga yuborsa ham holat o'zgarmaydi
    case "trip.waybill":
      return "Nakladnoy";
    case "order.trip": {
      const o = await db.order.findUnique({ where: { id }, select: { deliveryDate: true } });
      if (!o) return fail("Zayavka topilmadi", 404);
      const qtyM3 = numOf(payload, "qtyM3");
      if (!textOf(payload, "vehicleId")) fail("Texnika tanlanmagan");
      if (!textOf(payload, "driverId")) fail("Haydovchi tanlanmagan");
      let r: { id: string; deliveryNoteNo: string };
      try {
        r = await createTrip({ orderId: id, vehicleId: textOf(payload, "vehicleId"), driverId: textOf(payload, "driverId"), qtyM3, note: textOf(payload, "note") || null, plannedAt: plannedAtOf(payload, o.deliveryDate) }, user.id);
      } catch (e) { if (e instanceof ListError) throw e; return fail((e as Error).message); }
      if (ecoEnabled()) {
        const push = await pushTripToEco(r.id);
        if (push.error) return `${r.deliveryNoteNo} ochildi. ${push.error}`;
      }
      return `${r.deliveryNoteNo} ochildi va haydovchi ilovasiga yuborildi`;
    }
    case "vehicle.edit": {
      done(await saveVehicleRecord(id, parse(vehicleSchema, payload), user.id));
      return "Transport kartasi saqlandi";
    }
    case "vehicle.status": {
      const status = textOf(payload, "status");
      done(await setVehicleStatusRecord(id, status, textOf(payload, "note"), user.id));
      return `Holat: ${STATUS_LABEL[status] ?? status}`;
    }
    case "vehicle.service": {
      done(await addVehicleServiceRecord(id, parse(serviceSchema, payload), user.id));
      return "Xizmat yozildi";
    }
    case "vehicle.service.cancel": {
      const sid = textOf(payload, "serviceId");
      // By-id tekshiruv (bekor qilinganini ham ko'radi) — "allaqachon bekor qilingan" xatosi `cancelVehicleServiceRecord` da
      const x = sid ? await db.vehicleService.findUnique({ where: { id: sid }, select: { vehicleId: true } }) : null;
      if (!x || x.vehicleId !== id) fail("Yozuv topilmadi");
      done(await cancelVehicleServiceRecord(sid, textOf(payload, "reason"), user.id));
      return "Xizmat yozuvi bekor qilindi";
    }
    case "vehicle.fuel": {
      done(await addFuelRecord(parse(fuelSchema, { ...payload, vehicleId: id }), user.id));
      return "Zapravka yozildi";
    }
    case "vehicle.expense": {
      done(await addExpenseRecord(user.role, parse(expenseSchema, { ...payload, vehicleId: id }), user.id));
      return "Xarajat yozildi";
    }
    case "trip.price": return runTripPrice(user, id, payload);
    case "fuel.cancel": {
      done(await cancelFuelRecord(id, textOf(payload, "reason"), user.id));
      return "Zapravka bekor qilindi";
    }
    case "expense.cancel": {
      done(await cancelExpenseRecord(id, textOf(payload, "reason"), user.id));
      return "Xarajat bekor qilindi";
    }
    case "site.save": {
      const existed = !!(await db.site.count({ where: { id } }));
      await runSiteSave(user, id, payload);
      return existed ? "Obyekt saqlandi" : "Obyekt qo'shildi";
    }
    case "driver.card": {
      done(await saveDriverCardRecord(id, parse(driverCardSchema, payload), user.id));
      return "Haydovchi kartasi saqlandi";
    }
    case "driver.link": {
      const r = await linkDriverToEco(id, user.id);
      if ("error" in r) return fail(r.error);
      return "Haydovchi ilovasiga ulandi";
    }
    case "driver.approve": {
      const r = await approveDriverInEco(id, user.id);
      if ("error" in r) return fail(r.error);
      return "Ilovada tasdiqlandi";
    }
    default:
      return fail("Bunday amal yo'q", 404);
  }
}

// ───────────────────────── `detail.ts` uchun o'ramlar (kartochka tayyor bo'lgach qo'shimcha qo'shiladi) ─────────────────────────

/** Reys kartochkasi + logistika qo'shimchalari: ogohlantirishlar tepada, havola/xarajat/dispetcher amallari oxirida. */
export async function withTripExtras(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  const x = await tripExtras(user, d.id);
  return { ...d, fields: [...x.warnings, ...d.fields, ...x.fields], sections: [...d.sections, ...x.sections], actions: [...d.actions, ...x.actions] };
}

/** Zayavka kartochkasi + «Reys ochish» (logistika / ishlab chiqarish). */
export async function withOrderTrip(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  const a = await orderTripAction(user, d.id);
  return a ? { ...d, actions: [...d.actions, a] } : d;
}

/** Xodim kartochkasi + haydovchi kartasi (guvohnoma, grafik, transport) va ECO ilovasi amallari. */
export async function withDriverExtras(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  const x = await driverExtras(user, d.id);
  if (!x.fields.length && !x.actions.length) return d;
  return { ...d, fields: [...d.fields, ...x.fields], actions: [...d.actions, ...x.actions] };
}
