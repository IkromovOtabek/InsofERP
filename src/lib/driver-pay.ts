import { db } from "@/lib/db";
import { driverPositionNames } from "@/lib/positions";
import { dayUtc, isoDay, monthDays, monthTitle, shiftMonth, today } from "@/lib/davomat";
import { dayTimes, shiftOf } from "@/lib/attendance-time";
import { employeesInWindow, normMonth } from "@/lib/attendance-report";
import { soleUnit } from "@/lib/unit";
import { totalsText } from "@/lib/mobile/fmt";

/**
 * Haydovchilar: reyslar va davomat — haydovchi ish haqining asosi (asosan yetkazilgan reyslar soni).
 *
 * Reys oyga yetkazilgan kuni bo'yicha tushadi (`deliveredAt`, server vaqti — Asia/Tashkent), faqat DELIVERED.
 * Hajm — reys miqdori zayavka mahsuloti birligida (m³ va dona qo'shilmaydi).
 * Km — taxminiy: zavod → obyekt → zavod (`Order.distanceKm × 2`), haydovchi bosh sahifasidagi bilan bir xil.
 * Ish kuni — davomatda "Keldi" bo'lgan YOKI shu kuni reys bilan ishlagan kun (haydovchi har doim ham "Keldim"
 * bosmaydi): reys faolligi birinchi yuklash/yo'lga chiqishdan oxirgi yetkazish/qaytishgacha.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(y!, m! - 1, 1), to: new Date(y!, m!, 1) };
}

const TRIP_SELECT = {
  id: true, deliveryNoteNo: true, driverId: true, qtyM3: true, loadedAt: true, departedAt: true, deliveredAt: true, returnedAt: true,
  vehicle: { select: { plate: true } },
  order: { select: { distanceKm: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true, name: true } } } } } },
} as const;

type TripRow = {
  id: string; deliveryNoteNo: string; driverId: string; qtyM3: unknown;
  loadedAt: Date | null; departedAt: Date | null; deliveredAt: Date | null; returnedAt: Date | null;
  vehicle: { plate: string };
  order: { distanceKm: unknown; customer: { name: string }; items: { qtyM3: unknown; product: { unit: string; name: string } }[] };
};

const unitOf = (t: TripRow) => soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: String(i.qtyM3) }))) ?? "m3";
const kmOf = (t: TripRow) => Number(t.order.distanceKm ?? 0) * 2;
const qtyRows = (list: TripRow[]) => list.map((t) => ({ unit: unitOf(t), qty: Number(t.qtyM3) }));

/** Haydovchi lavozimidagi (Otdel kadr belgilagan) yoki shu oyda reys qilgan xodimlar. */
async function driversFor(month: string, tripDriverIds: string[]) {
  const days = monthDays(month);
  const names = await driverPositionNames();
  return db.employee.findMany({
    where: {
      OR: [
        { id: { in: tripDriverIds } },
        { AND: [employeesInWindow(dayUtc(days[0]!.iso), dayUtc(days[days.length - 1]!.iso)), { position: { in: names, mode: "insensitive" } }] },
      ],
    },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, phone: true, workSchedule: true, vehicle: { select: { plate: true } } },
  });
}

export type DriverMonthRow = {
  id: string; fullName: string; phone: string | null; plate: string | null;
  trips: number; qtyText: string; m3: number; km: number;
  workedDays: number; attDays: number; tripDays: number; minutes: number; lateDays: number;
};

export type DriversMonth = {
  month: string; title: string; prev: string; next: string | null;
  totals: { drivers: number; trips: number; qtyText: string; km: number; workedDays: number };
  rows: DriverMonthRow[];
};

/** Oy bo'yicha barcha haydovchilar jadvali (direktor, otdel kadr, logistika). */
export async function driversMonth(rawMonth?: string | null): Promise<DriversMonth> {
  const month = normMonth(rawMonth);
  const { from, to } = monthRange(month);
  const days = monthDays(month);
  const trips = (await db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: from, lt: to } }, select: TRIP_SELECT })) as TripRow[];
  const drivers = await driversFor(month, [...new Set(trips.map((t) => t.driverId))]);
  const att = await db.attendance.findMany({
    where: { employeeId: { in: drivers.map((d) => d.id) }, date: { gte: dayUtc(days[0]!.iso), lte: dayUtc(days[days.length - 1]!.iso) } },
    select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true, lateMinutes: true },
  });
  const rows: DriverMonthRow[] = drivers.map((d) => {
    const mine = trips.filter((t) => t.driverId === d.id);
    const myAtt = att.filter((a) => a.employeeId === d.id);
    const shift = shiftOf(d.workSchedule);
    const present = myAtt.filter((a) => a.status === "PRESENT");
    const tripDays = new Set(mine.map((t) => localDay(t.deliveredAt!)));
    const worked = new Set([...tripDays, ...present.map((a) => isoDay(a.date))]);
    const times = present.map((a) => dayTimes(a, shift));
    return {
      id: d.id, fullName: d.fullName, phone: d.phone, plate: d.vehicle?.plate ?? mine[0]?.vehicle.plate ?? null,
      trips: mine.length, qtyText: mine.length ? totalsText(qtyRows(mine)) : "—",
      m3: mine.filter((t) => unitOf(t) === "m3").reduce((s, t) => s + Number(t.qtyM3), 0),
      km: Math.round(mine.reduce((s, t) => s + kmOf(t), 0)),
      workedDays: worked.size, attDays: present.length, tripDays: tripDays.size,
      minutes: times.reduce((s, x) => s + (x.minutes ?? 0), 0), lateDays: times.filter((x) => x.lateMin).length,
    };
  }).sort((a, b) => b.trips - a.trips || a.fullName.localeCompare(b.fullName));
  const cur = today().slice(0, 7);
  return {
    month, title: monthTitle(month), prev: shiftMonth(month, -1), next: month < cur ? shiftMonth(month, 1) : null,
    totals: {
      drivers: rows.length, trips: trips.length, qtyText: trips.length ? totalsText(qtyRows(trips)) : "0",
      km: rows.reduce((s, r) => s + r.km, 0), workedDays: rows.reduce((s, r) => s + r.workedDays, 0),
    },
    rows,
  };
}

export type DriverTrip = { id: string; no: string; time: string; customer: string; product: string; qtyText: string; km: number; plate: string };
export type DriverDay = {
  date: string; day: number; weekday: string;
  trips: DriverTrip[]; tripCount: number; qtyText: string | null; km: number;
  /** Davomat (bo'lsa): kelgan/ketgan, soat, kechikish. */
  checkIn: string | null; checkOut: string | null; minutes: number | null; lateMin: number | null; status: string | null;
  /** Reys faolligi: birinchi yuklash/yo'lga chiqish — oxirgi yetkazish/qaytish. */
  firstAt: string | null; lastAt: string | null;
};
export type DriverMonth = {
  month: string; title: string; prev: string; next: string | null;
  driver: { id: string; fullName: string; phone: string | null; plate: string | null };
  totals: { trips: number; qtyText: string; km: number; workedDays: number; attDays: number; tripDays: number; minutes: number; lateDays: number; lateMinutes: number };
  days: DriverDay[];
};

/** Bitta haydovchi — oy bo'yicha kunlar (reyslar va davomat). */
export async function driverMonth(employeeId: string, rawMonth?: string | null): Promise<DriverMonth | null> {
  const month = normMonth(rawMonth);
  const { from, to } = monthRange(month);
  const days = monthDays(month);
  const d = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, phone: true, workSchedule: true, vehicle: { select: { plate: true } } } });
  if (!d) return null;
  const [trips, att] = await Promise.all([
    db.trip.findMany({ where: { driverId: employeeId, status: "DELIVERED", deliveredAt: { gte: from, lt: to } }, orderBy: { deliveredAt: "asc" }, select: TRIP_SELECT }) as Promise<TripRow[]>,
    db.attendance.findMany({ where: { employeeId, date: { gte: dayUtc(days[0]!.iso), lte: dayUtc(days[days.length - 1]!.iso) } }, select: { date: true, status: true, checkIn: true, checkOut: true, lateMinutes: true } }),
  ]);
  const shift = shiftOf(d.workSchedule);
  const attBy = new Map(att.map((a) => [isoDay(a.date), a]));
  const tripsBy = new Map<string, TripRow[]>();
  for (const t of trips) { const k = localDay(t.deliveredAt!); tripsBy.set(k, [...(tripsBy.get(k) ?? []), t]); }
  const now = today();
  const out: DriverDay[] = days.filter((x) => x.iso <= now).reverse().flatMap((x) => {
    const list = tripsBy.get(x.iso) ?? [];
    const a = attBy.get(x.iso);
    if (!list.length && !a) return [];
    const t = dayTimes(a, shift);
    const starts = list.map((r) => r.loadedAt ?? r.departedAt ?? r.deliveredAt!).map((v) => v.getTime());
    const ends = list.map((r) => r.returnedAt ?? r.deliveredAt!).map((v) => v.getTime());
    return [{
      date: x.iso, day: x.day, weekday: WD[dayUtc(x.iso).getUTCDay()]!,
      trips: list.map((r) => ({
        id: r.id, no: r.deliveryNoteNo, time: hm(r.deliveredAt!), customer: r.order.customer.name,
        product: [...new Set(r.order.items.map((i) => i.product.name))].join(", "),
        qtyText: totalsText(qtyRows([r])), km: Math.round(kmOf(r)), plate: r.vehicle.plate,
      })),
      tripCount: list.length, qtyText: list.length ? totalsText(qtyRows(list)) : null, km: Math.round(list.reduce((s, r) => s + kmOf(r), 0)),
      checkIn: a?.status === "PRESENT" ? a.checkIn : null, checkOut: a?.status === "PRESENT" ? a.checkOut : null,
      minutes: t.minutes, lateMin: t.lateMin, status: a?.status ?? null,
      firstAt: starts.length ? hm(new Date(Math.min(...starts))) : null, lastAt: ends.length ? hm(new Date(Math.max(...ends))) : null,
    }];
  });
  const cur = now.slice(0, 7);
  const present = out.filter((x) => x.status === "PRESENT");
  return {
    month, title: monthTitle(month), prev: shiftMonth(month, -1), next: month < cur ? shiftMonth(month, 1) : null,
    driver: { id: d.id, fullName: d.fullName, phone: d.phone, plate: d.vehicle?.plate ?? trips[0]?.vehicle.plate ?? null },
    totals: {
      trips: trips.length, qtyText: trips.length ? totalsText(qtyRows(trips)) : "0", km: out.reduce((s, x) => s + x.km, 0),
      workedDays: out.filter((x) => x.tripCount || x.status === "PRESENT").length, attDays: present.length,
      tripDays: out.filter((x) => x.tripCount).length,
      minutes: present.reduce((s, x) => s + (x.minutes ?? 0), 0),
      lateDays: present.filter((x) => x.lateMin).length, lateMinutes: present.reduce((s, x) => s + (x.lateMin ?? 0), 0),
    },
    days: out,
  };
}
