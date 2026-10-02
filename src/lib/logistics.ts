import { db } from "@/lib/db";
import type { FuelType, Prisma, TransportExpenseKind, TripIssueKind, TripStatus, VehicleStatus } from "@/generated/prisma";

/**
 * Logistika bo'limi — umumiy qoidalar va nomlar (Biton Logistika TZ).
 *
 * Nega alohida fayl: reys bosqichi, zayavkaning logistik holati, transport holati va
 * kechikish vebdagi 10 dan ortiq sahifada, mobil ilovada va dashbordda ko'rinadi.
 * Hammasi shu funksiyalardan olinadi — bir joyda "kechikmoqda", boshqasida "o'z vaqtida"
 * deb chiqib qolmasin.
 */

type BadgeColor = "slate" | "green" | "amber" | "red" | "blue" | "violet";

// ───────────────────────── Sozlamalar ─────────────────────────

export type LogisticsSettings = {
  lateWarnMin: number; lateCritMin: number; gpsSilentMin: number; loadedWarnMin: number;
  assignLeadMin: number; shiftStartHour: number; shiftEndHour: number; avgSpeedKmh: number;
  plant: { lat: number; lng: number } | null;
};

export async function logisticsSettings(): Promise<LogisticsSettings> {
  const s = await db.companySettings.findUnique({ where: { id: "main" } });
  return {
    lateWarnMin: s?.lateWarnMin ?? 15, lateCritMin: s?.lateCritMin ?? 45, gpsSilentMin: s?.gpsSilentMin ?? 15,
    loadedWarnMin: s?.loadedWarnMin ?? 30, assignLeadMin: s?.assignLeadMin ?? 60,
    shiftStartHour: s?.shiftStartHour ?? 8, shiftEndHour: s?.shiftEndHour ?? 20, avgSpeedKmh: s?.avgSpeedKmh ?? 35,
    plant: s?.lat != null && s?.lng != null ? { lat: s.lat, lng: s.lng } : null,
  };
}

/**
 * Baraban vaqti: beton yuklangandan shuncha daqiqada quyilishi kerak, keyin qota boshlaydi.
 * Sozlamalar jadvalida (`CompanySettings`) alohida maydon yo'q — sxemaga tegmaslik uchun konstanta.
 * Maydon qo'shilsa `logisticsSettings()` ga `drumMaxMin` sifatida olib o'tiladi.
 */
export const DRUM_MAX_MIN = 90;

/** Reys beton (m³) tashiydimi: mikser + zayavkada m³ qator. Aralash zayavkada dona qatorni yuk mashina oladi. */
export function isConcreteTrip(t: { vehicle: { type: string }; order: { items: { product: { unit: string } }[] } }): boolean {
  return t.vehicle.type === "MIXER" && t.order.items.some((i) => i.product.unit === "m3");
}

// ───────────────────────── Reys bosqichi ─────────────────────────

/**
 * TZ dagi reys statuslari: Rejalashtirilgan → Transport biriktirildi → Yuklash kutilmoqda →
 * Yuklanmoqda → Yo'lda → Obyektga yetib keldi → Yuk tushirilmoqda → Yetkazildi → Yopildi.
 *
 * Bazadagi `TripStatus` o'zgarmaydi (sklad, schyot, ECO unga tayanadi) — oraliq bosqichlar
 * vaqt belgilaridan chiqariladi. Reys ochilganda transport va haydovchi doim biriktiriladi,
 * shuning uchun "Rejalashtirilgan" va "Transport biriktirildi" bitta bosqich: PLANNED.
 */
export type TripPhase = "ASSIGNED" | "LOADED" | "ON_ROAD" | "ARRIVED" | "UNLOADING" | "DELIVERED" | "CLOSED" | "CANCELLED";

export const TRIP_PHASE: Record<TripPhase, { label: string; color: BadgeColor; step: number }> = {
  ASSIGNED: { label: "Yuklash kutilmoqda", color: "slate", step: 1 },
  LOADED: { label: "Yuklandi", color: "blue", step: 2 },
  ON_ROAD: { label: "Yo'lda", color: "amber", step: 3 },
  ARRIVED: { label: "Obyektga keldi", color: "violet", step: 4 },
  UNLOADING: { label: "Tushirilmoqda", color: "violet", step: 5 },
  DELIVERED: { label: "Yetkazildi", color: "green", step: 6 },
  CLOSED: { label: "Yopildi", color: "green", step: 7 },
  CANCELLED: { label: "Bekor qilindi", color: "red", step: 0 },
};
/** Bosqichlar ketma-ketligi — reys kartasidagi qadamlar chizig'i uchun. */
export const PHASE_STEPS: TripPhase[] = ["ASSIGNED", "LOADED", "ON_ROAD", "ARRIVED", "UNLOADING", "DELIVERED", "CLOSED"];

type PhaseTrip = { status: TripStatus | string; arrivedAt?: Date | null; unloadingAt?: Date | null; closedAt?: Date | null };

export function tripPhase(t: PhaseTrip): TripPhase {
  switch (t.status) {
    case "PLANNED": return "ASSIGNED";
    case "LOADED": return "LOADED";
    case "ON_ROAD": return t.unloadingAt ? "UNLOADING" : t.arrivedAt ? "ARRIVED" : "ON_ROAD";
    case "DELIVERED": return t.closedAt ? "CLOSED" : "DELIVERED";
    default: return "CANCELLED";
  }
}

/** Reys "faol" — mashina band, beton yo'lda yoki yuklanmoqda. */
export const ACTIVE_TRIP: TripStatus[] = ["PLANNED", "LOADED", "ON_ROAD"];

// ───────────────────────── Vaqt va kechikish ─────────────────────────

/** Zayavka sanasi + soati → aniq vaqt. Soat berilmagan bo'lsa null: kechikishni aytib bo'lmaydi. */
export function orderPlannedAt(o: { deliveryDate: Date; deliveryTime?: string | null }): Date | null {
  if (!o.deliveryTime || !/^\d{2}:\d{2}$/.test(o.deliveryTime)) return null;
  const [h, m] = o.deliveryTime.split(":").map(Number);
  const d = new Date(o.deliveryDate);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Reysning rejadagi yetkazish vaqti: dispetcher kalendarda qo'ygan vaqt, bo'lmasa zayavkaniki. */
export function tripPlannedAt(t: { plannedAt?: Date | null }, o: { deliveryDate: Date; deliveryTime?: string | null }): Date | null {
  return t.plannedAt ?? orderPlannedAt(o);
}

export type Level = "ok" | "warn" | "crit";

/**
 * Kechikish, daqiqa (manfiy — erta). Yetkazilgan reysda haqiqiy vaqt, yo'ldagisida —
 * "hozir" yoki ETA (qaysi kech bo'lsa). Rejadagi vaqt yo'q bo'lsa null.
 */
export function tripDelayMin(
  t: { status: string; deliveredAt?: Date | null; plannedAt?: Date | null },
  o: { deliveryDate: Date; deliveryTime?: string | null },
  now = new Date(),
  etaMin?: number | null,
): number | null {
  const plan = tripPlannedAt(t, o);
  if (!plan || t.status === "CANCELLED") return null;
  if (t.status === "DELIVERED") return t.deliveredAt ? Math.round((t.deliveredAt.getTime() - plan.getTime()) / 60000) : null;
  const expected = Math.max(now.getTime(), etaMin != null ? now.getTime() + etaMin * 60000 : 0);
  return Math.round((expected - plan.getTime()) / 60000);
}

export function delayLevel(delayMin: number | null, s: Pick<LogisticsSettings, "lateWarnMin" | "lateCritMin">): Level {
  if (delayMin == null) return "ok";
  return delayMin >= s.lateCritMin ? "crit" : delayMin >= s.lateWarnMin ? "warn" : "ok";
}

/** `95` → `1 s 35 daq`, `40` → `40 daq`. */
export function minutesLabel(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  const m = Math.round(Math.abs(min));
  // Kundan oshsa daqiqa ma'nosiz ("10165 daq") — kun va soat
  const s = m >= 1440 ? `${Math.floor(m / 1440)} kun${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)} s` : ""}`
    : m >= 60 ? `${Math.floor(m / 60)} s${m % 60 ? ` ${m % 60} daq` : ""}` : `${m} daq`;
  return min < 0 ? `−${s}` : s;
}

// ───────────────────────── Zayavkaning logistik holati ─────────────────────────

/**
 * TZ: Yangi → Tasdiqlangan → Rejalashtirilgan → Transport biriktirilgan → Yuklanmoqda → Yo'lda →
 * Yetkazildi → Yopildi; qo'shimcha: Bekor qilindi, Kechikmoqda, Muammo mavjud.
 *
 * Zayavkaning o'z holati (`OrderStatus`) sotuv/moliya uchun — logistika holati reyslardan chiqadi.
 * "Kechikmoqda" va "Muammo mavjud" asosiy holat emas, ustiga qo'yiladigan belgi (bayroq).
 */
export type OrderLogiStatus = "NEW" | "CONFIRMED" | "PLANNED" | "ASSIGNED" | "LOADING" | "ON_ROAD" | "DELIVERED" | "CLOSED" | "CANCELLED";

export const ORDER_LOGI: Record<OrderLogiStatus, { label: string; color: BadgeColor }> = {
  NEW: { label: "Yangi", color: "slate" },
  CONFIRMED: { label: "Tasdiqlangan", color: "blue" },
  PLANNED: { label: "Rejalashtirilgan", color: "blue" },
  ASSIGNED: { label: "Transport biriktirilgan", color: "violet" },
  LOADING: { label: "Yuklanmoqda", color: "amber" },
  ON_ROAD: { label: "Yo'lda", color: "amber" },
  DELIVERED: { label: "Yetkazildi", color: "green" },
  CLOSED: { label: "Yopildi", color: "green" },
  CANCELLED: { label: "Bekor qilindi", color: "red" },
};

type LogiOrder = {
  status: string; deliveryDate: Date; deliveryTime?: string | null;
  items: { qtyM3: unknown }[];
  trips: { status: string; qtyM3: unknown; plannedAt?: Date | null; deliveredAt?: Date | null; closedAt?: Date | null; issues?: { resolvedAt: Date | null }[] }[];
};

export type OrderLogi = {
  status: OrderLogiStatus; late: boolean; problem: boolean;
  total: number; assigned: number; delivered: number; remaining: number;
  plannedAt: Date | null;
};

export function orderLogistics(o: LogiOrder, now = new Date()): OrderLogi {
  const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const live = o.trips.filter((t) => t.status !== "CANCELLED");
  const assigned = live.reduce((s, t) => s + Number(t.qtyM3), 0);
  const deliveredTrips = live.filter((t) => t.status === "DELIVERED");
  const delivered = deliveredTrips.reduce((s, t) => s + Number(t.qtyM3), 0);
  const plannedAt = orderPlannedAt(o);
  const problem = live.some((t) => (t.issues ?? []).some((i) => !i.resolvedAt));

  let status: OrderLogiStatus;
  if (o.status === "CANCELLED") status = "CANCELLED";
  else if (o.status === "DRAFT" || o.status === "BLOCKED") status = "NEW";
  // Yopildi: to'lov yopilgan yoki hamma reys qabul tasdig'i bilan yopilgan
  else if (o.status === "CLOSED" || (o.status === "DELIVERED" && deliveredTrips.length > 0 && deliveredTrips.every((t) => t.closedAt))) status = "CLOSED";
  else if (o.status === "DELIVERED") status = "DELIVERED";
  else if (live.some((t) => t.status === "ON_ROAD")) status = "ON_ROAD";
  else if (live.some((t) => t.status === "LOADED")) status = "LOADING";
  else if (live.some((t) => t.status === "PLANNED")) status = "ASSIGNED";
  else if (o.status === "IN_PRODUCTION") status = "PLANNED";
  else status = "CONFIRMED";

  // Kechikmoqda: yetkazish vaqti o'tgan, hali hammasi yetkazilmagan
  const open = !["DELIVERED", "CLOSED", "CANCELLED", "NEW"].includes(status);
  const late = open && plannedAt != null && now > plannedAt && delivered < total - 0.001;
  return { status, late, problem, total, assigned, delivered, remaining: Math.max(0, total - assigned), plannedAt };
}

// ───────────────────────── Transport holati ─────────────────────────

/** TZ: Bo'sh / Reysda / Yuklanmoqda / Ta'mirda / Faol emas (+ biriktirilgan, qaytmoqda, bekor turibdi). */
export type VehicleLive = "FREE" | "ASSIGNED" | "LOADING" | "ON_TRIP" | "RETURNING" | "REPAIR" | "IDLE" | "INACTIVE";

export const VEHICLE_LIVE: Record<VehicleLive, { label: string; color: BadgeColor }> = {
  FREE: { label: "Bo'sh", color: "green" },
  ASSIGNED: { label: "Reys biriktirilgan", color: "blue" },
  LOADING: { label: "Yuklanmoqda", color: "blue" },
  ON_TRIP: { label: "Reysda", color: "amber" },
  RETURNING: { label: "Qaytmoqda", color: "violet" },
  REPAIR: { label: "Ta'mirda", color: "red" },
  IDLE: { label: "Bekor turibdi", color: "slate" },
  INACTIVE: { label: "Faol emas", color: "slate" },
};

/** Yetkazilgandan keyin shuncha vaqt ichida "Zavodga qaytdim" bosilmasa — mashina bo'sh deb hisoblanadi. */
const RETURN_WINDOW_MS = 3 * 60 * 60_000;

export function vehicleLive(
  v: { isActive: boolean; status: VehicleStatus },
  trips: { status: string; deliveredAt?: Date | null; returnedAt?: Date | null }[],
  now = new Date(),
): VehicleLive {
  if (!v.isActive) return "INACTIVE";
  if (v.status === "REPAIR") return "REPAIR";
  if (trips.some((t) => t.status === "ON_ROAD")) return "ON_TRIP";
  if (trips.some((t) => t.status === "LOADED")) return "LOADING";
  if (trips.some((t) => t.status === "PLANNED")) return "ASSIGNED";
  if (trips.some((t) => t.status === "DELIVERED" && !t.returnedAt && t.deliveredAt && now.getTime() - t.deliveredAt.getTime() < RETURN_WINDOW_MS)) return "RETURNING";
  if (v.status === "IDLE") return "IDLE";
  return "FREE";
}

export const VEHICLE_TYPE: Record<string, string> = { MIXER: "Mikser", PUMP: "Nasos", TRUCK: "Yuk mashina" };

// ───────────────────────── Nomlar ─────────────────────────

export const ISSUE_KIND: Record<TripIssueKind, string> = {
  BREAKDOWN: "Mashina buzildi",
  TRAFFIC: "Tirbandlik / yo'l yopiq",
  SITE_NOT_READY: "Obyekt tayyor emas",
  QUALITY: "Sifat / hajm e'tirozi",
  ACCIDENT: "YTH (avariya)",
  DECLINED: "Haydovchi rad etdi",
  OTHER: "Boshqa",
};

export const FUEL_TYPE: Record<FuelType, string> = { DIESEL: "Dizel", PETROL: "Benzin", METHANE: "Metan", PROPANE: "Propan" };

export const EXPENSE_KIND: Record<TransportExpenseKind, string> = {
  DRIVER_PAY: "Haydovchi haqi",
  ROAD: "Yo'l to'lovi",
  REPAIR: "Ta'mirlash",
  PARTS: "Ehtiyot qism / moy",
  PARKING: "Turargoh",
  FINE: "Jarima",
  WASH: "Yuvish",
  OTHER: "Boshqa",
};

// ───────────────────────── Hujjat muddatlari ─────────────────────────

/** Texnik ko'rik / sug'urta / guvohnoma muddati: o'tgan — kritik, 30 kundan kam — e'tibor. */
export function expiryLevel(d: Date | null | undefined, now = new Date()): Level | null {
  if (!d) return null;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  return days < 0 ? "crit" : days < 30 ? "warn" : "ok";
}

// ───────────────────────── Obyekt ─────────────────────────

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Zayavka manzili → obyekt kartasi. Bir mijozning bir xil manzili bitta obyekt bo'ladi,
 * shuning uchun obyekt bo'yicha yetkazish tarixi yig'iladi. Nuqta keyin berilsa — to'ldiriladi.
 */
export async function ensureSite(
  tx: Prisma.TransactionClient | typeof db,
  customerId: string,
  address: string,
  point?: { lat?: number | null; lng?: number | null },
): Promise<string | null> {
  const a = address.trim();
  if (!a) return null;
  const same = (await tx.site.findMany({ where: { customerId }, select: { id: true, address: true, lat: true } }))
    .find((s) => norm(s.address) === norm(a));
  if (same) {
    if (same.lat == null && point?.lat != null && point.lng != null) await tx.site.update({ where: { id: same.id }, data: { lat: point.lat, lng: point.lng } });
    return same.id;
  }
  const s = await tx.site.create({
    data: { customerId, name: a.length > 60 ? `${a.slice(0, 57)}…` : a, address: a, lat: point?.lat ?? null, lng: point?.lng ?? null },
  });
  return s.id;
}

// ───────────────────────── Kun chegarasi ─────────────────────────

export function dayRange(d = new Date()): { from: Date; to: Date } {
  const from = new Date(d); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  return { from, to };
}

/** "2026-09-29" → Date (mahalliy yarim tun). Noto'g'ri bo'lsa — bugun. */
export function parseDay(s?: string | null): Date {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const t = new Date(); t.setHours(0, 0, 0, 0); return t;
}

// ───────────────────────── Haydovchilar ─────────────────────────

/**
 * Haydovchi lavozimidagi xodimlar (Otdel kadr "haydovchi ilovasiga chiqsin" belgilagan lavozimlar).
 * Reys formasi, transport kartasi va haydovchilar sahifasi bir xil ro'yxatni ko'rsin.
 */
export async function driverEmployees(opts: { activeOnly?: boolean } = {}) {
  const { driverPositionNames } = await import("@/lib/positions");
  const names = (await driverPositionNames()).map((n) => n.trim().toLowerCase());
  const all = await db.employee.findMany({ where: opts.activeOnly ? { isActive: true } : {}, orderBy: [{ isActive: "desc" }, { fullName: "asc" }] });
  return all.filter((e) => names.includes(e.position.trim().toLowerCase()));
}

// ───────────────────────── Texnik xizmat muddati (mexanik) ─────────────────────────

/** Keyingi xizmatgacha shuncha kun yoki km qolsa — "yaqinlashdi" (e'tibor). */
export const SERVICE_WARN_DAYS = 14;
export const SERVICE_WARN_KM = 1000;

/** Xizmat jurnalidagi oddiy turlar — formada tanlov, lekin boshqasini ham yozish mumkin. */
export const SERVICE_KINDS = ["Moy almashtirish", "Filtrlar", "Ta'mir", "Shina", "Tormoz tizimi", "Akkumulyator", "Baraban / gidravlika", "Texnik ko'rik", "Boshqa"] as const;

export type ServiceDue = {
  serviceId: string; vehicleId: string; plate: string; kind: string; level: Exclude<Level, "ok">;
  dueAt: Date | null; dueKm: number | null; daysLeft: number | null; kmLeft: number | null; text: string;
};

/**
 * Bitta xizmat yozuvining muddati: sana yoki probeg (qaysi biri oldin kelsa). O'tgan — kritik,
 * `SERVICE_WARN_DAYS` / `SERVICE_WARN_KM` ichida — e'tibor. Muddati yo'q yoki uzoq — null.
 */
export function serviceDueLevel(
  s: { nextDueAt: Date | null; nextDueKm: number | null },
  odometerKm: number | null,
  now = new Date(),
): { level: Exclude<Level, "ok">; daysLeft: number | null; kmLeft: number | null } | null {
  const daysLeft = s.nextDueAt ? Math.floor((s.nextDueAt.getTime() - now.getTime()) / 86_400_000) : null;
  const kmLeft = s.nextDueKm != null && odometerKm != null ? s.nextDueKm - odometerKm : null;
  if ((daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft < 0)) return { level: "crit", daysLeft, kmLeft };
  if ((daysLeft != null && daysLeft <= SERVICE_WARN_DAYS) || (kmLeft != null && kmLeft <= SERVICE_WARN_KM)) return { level: "warn", daysLeft, kmLeft };
  return null;
}

/**
 * Muddati yaqinlashgan / o'tgan texnik xizmatlar — transport ro'yxati, transport kartasi va
 * mexanik bosh sahifasi uchun (dashboard shu funksiyani chaqiradi, o'zi hisoblamaydi).
 *
 * Har texnika va har xizmat turi bo'yicha faqat OXIRGI yozuv qaraladi: moy almashtirilib yangi
 * yozuv kiritilsa, eskisining "muddati o'tgan" ogohlantirishi o'z-o'zidan yo'qoladi.
 */
export async function vehicleServiceDue(opts: { vehicleId?: string; now?: Date } = {}): Promise<ServiceDue[]> {
  const now = opts.now ?? new Date();
  const rows = await db.vehicleService.findMany({
    where: { ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}), vehicle: { isActive: true }, OR: [{ nextDueAt: { not: null } }, { nextDueKm: { not: null } }] },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { id: true, vehicleId: true, kind: true, nextDueAt: true, nextDueKm: true, vehicle: { select: { plate: true, odometerKm: true } } },
  });
  // Har (texnika, tur) uchun eng oxirgi yozuv — undan oldingilari allaqachon bajarilgan
  const latest = await db.vehicleService.findMany({
    where: { ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}), vehicle: { isActive: true } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    distinct: ["vehicleId", "kind"],
    select: { id: true },
  });
  const latestIds = new Set(latest.map((x) => x.id));
  const out: ServiceDue[] = [];
  for (const r of rows) {
    if (!latestIds.has(r.id)) continue;
    const d = serviceDueLevel(r, r.vehicle.odometerKm, now);
    if (!d) continue;
    const parts: string[] = [];
    if (d.daysLeft != null) parts.push(d.daysLeft < 0 ? `${-d.daysLeft} kun o'tdi` : d.daysLeft === 0 ? "bugun" : `${d.daysLeft} kun qoldi`);
    if (d.kmLeft != null) parts.push(d.kmLeft < 0 ? `${-d.kmLeft} km o'tdi` : `${d.kmLeft} km qoldi`);
    out.push({
      serviceId: r.id, vehicleId: r.vehicleId, plate: r.vehicle.plate, kind: r.kind, level: d.level,
      dueAt: r.nextDueAt, dueKm: r.nextDueKm, daysLeft: d.daysLeft, kmLeft: d.kmLeft, text: `${r.kind}: ${parts.join(" · ")}`,
    });
  }
  return out.sort((a, b) => (a.level === b.level ? (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9) : a.level === "crit" ? -1 : 1));
}
