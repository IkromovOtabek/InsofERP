/**
 * Zayavka qabul qilinayotganda «necha reys, nechta mashina» hisobi — beton (mikser) va dona mahsulot (bort mashina).
 * Toza funksiyalar: brauzerdagi forma ham, server ham shu yerdan hisoblaydi. Kunlik transport bandligi — `trip-plan-day.ts`.
 *
 * Beton modeli (dispetcher amaliyoti, GOST 7473 / ASTM C94):
 *   aylanish T = yuklash + yo'l (yuklangan) + obyektda kirish + tushirish + yuvish + qaytish (bo'sh);
 *   quyish tezligi R (m³/soat) — nasos/tarnov chegarasi ichida, smenaga sig'adigan eng past tezlik;
 *   mikserlar orasidagi interval I = V / R — sovuq choc bo'lmasligi uchun ≤ 30 daq;
 *   aylanishda turishi kerak bo'lgan mikser soni N = ⌈T / I⌉.
 * Dona modeli: bitta reysga sig'adigani = yuk ko'tarish ÷ dona og'irligi; aylanish ko'tarishlar soniga bog'liq.
 * Barcha vaqtlar — daqiqa. Qiymatlar o'rtacha: dispetcher xronometraji bilan `PLAN` dagi sonlar aniqlashtiriladi.
 */

import { fmtNum } from "./format";

const fmt = (n: number) => fmtNum(n, 1);

export const PLAN = {
  // ── Beton ──
  loadMin: 15, // zavodda navbat, dozalash, nakladnoy
  siteMin: 10, // obyektga kirish, manevr, hujjat
  washMin: 10, // obyektda yuvish + zavodga qayta kirish
  speedLoaded: 30, // km/soat — yuklangan, shahar ichi
  speedEmpty: 40, // km/soat — bo'sh qaytish
  chuteRate: 20, // m³/soat — tarnov bilan to'g'ridan-to'g'ri quyish
  pumpRate: 30, // m³/soat — avtonasos amaliy tezligi (pasportdagi 90–150 nazariy)
  pumpMax: 40, // m³/soat — bitta nasosning amaliy chegarasi
  hiredMixerM3: 9, // yollanma mikser bir reysda
  defaultMixerM3: 8, // sig'imi kiritilmagan mikser
  coldJointMin: 30, // ikki mikser orasidagi eng uzoq tanaffus
  drumMaxMin: 90, // yuklangandan to'kib bo'linguncha (GOST 7473, P3–P5, 20–30 °C)
  drumHotMin: 60, // iyun–avgust issiqda
  minLoadM3: 3, // bundan kam yuk — «kam yuk»
  defaultKm: 15, // manzil belgilanmagan bo'lsa
  // ── Dona (bort mashina) ──
  truckLoadBase: 10, truckLoadPerLift: 2, // zavodda kran/pogruzchik
  truckUnloadBase: 15, truckUnloadPerLift: 3, // obyektda manipulyator/avtokran
  truckDocsMin: 10,
  truckReserveMin: 60, // smenadan: tushlik, yoqilg'i, ko'rik
  hiredTruckT: 20, // yollanma treyler, tonna
  defaultTruckT: 15, // yuk ko'tarishi kiritilmagan bort mashina
  craneKg: 500, // shundan og'ir dona — tushirishga kran kerak
} as const;

export type FleetVehicle = {
  id: string; plate: string; type: "MIXER" | "TRUCK" | "PUMP";
  cap: number | null; unit: "M3" | "TON" | "PIECE";
  status: "ACTIVE" | "REPAIR" | "IDLE";
  /** Shu kuni smena ichida boshqa reyslar bilan band daqiqalar. */
  busyMin: number;
  /** Band bo'lsa — kimning reysi (qisqa). */
  busyNote: string | null;
};

export type DayFleet = {
  date: string;
  shiftMin: number;
  vehicles: FleetVehicle[];
  /** Shu kungi boshqa zayavkalarning hali reys biriktirilmagan qismi — transportni shular ham talab qiladi. */
  other: { orders: number; m3: number; tons: number; mixerMin: number; truckMin: number; pumps: number };
  dailyCapacityM3: number | null;
};

export type VehicleUse = {
  id: string; plate: string; cap: string;
  state: "use" | "partial" | "busy" | "repair" | "reserved" | "spare";
  trips: number; amount: number; note: string;
};

export type PlanWarn = { tone: "warning" | "danger" | "info"; text: string };

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Smenadagi bo'sh daqiqalar; boshqa zayavkalar talabini kichik mashinalardan boshlab band qiladi (kattalari yirik zayavkaga qolsin). */
function freeMinutes(list: FleetVehicle[], shiftMin: number, reserveMin: number, capOf: (v: FleetVehicle) => number) {
  const out = new Map<string, { free: number; reserved: number }>();
  let left = reserveMin;
  for (const v of [...list].sort((a, b) => capOf(a) - capOf(b))) {
    const free = Math.max(0, shiftMin - v.busyMin);
    const take = Math.min(free, left);
    left -= take;
    out.set(v.id, { free: free - take, reserved: take });
  }
  return out;
}

// ───────────────────────── Beton ─────────────────────────

export type ConcretePlan = {
  m3: number; km: number; kmAssumed: boolean;
  days: number; dayM3: number;
  rate: number; pumps: number; pourMin: number;
  /** Aylanish bosqichlari, daqiqa: yuklash, yo'l, obyekt, tushirish, yuvish, qaytish. */
  cycle: { load: number; out: number; site: number; unload: number; wash: number; back: number; total: number };
  arriveMin: number; intervalMin: number;
  mixersNeeded: number; trips: number; lastLoad: number;
  own: VehicleUse[]; ownUsed: number; ownM3: number; ownTrips: number;
  hired: number; hiredTrips: number; hiredM3: number;
  warns: PlanWarn[];
};

export function concretePlan(input: { m3: number; km: number | null; pump: boolean; fleet: DayFleet | null; month?: number }): ConcretePlan {
  const { m3, pump, fleet } = input;
  const km = input.km ?? PLAN.defaultKm;
  const warns: PlanWarn[] = [];
  const shiftMin = fleet?.shiftMin ?? 600;

  const mixers = (fleet?.vehicles ?? []).filter((v) => v.type === "MIXER");
  const capOf = (v: FleetVehicle) => (v.cap && v.cap > 0 ? v.cap : PLAN.defaultMixerM3);
  const working = mixers.filter((v) => v.status !== "REPAIR");
  const V = working.length ? working.reduce((s, v) => s + capOf(v), 0) / working.length : PLAN.hiredMixerM3;

  const out = (km / PLAN.speedLoaded) * 60;
  const back = (km / PLAN.speedEmpty) * 60;
  const arriveMin = PLAN.loadMin + out + PLAN.siteMin;
  const window = Math.max(60, shiftMin - arriveMin); // birinchi mikser kelgandan smena oxirigacha

  // Quyish tezligi: tarnov yoki nasos chegarasi; kun sig'masa — bir necha kunga bo'linadi
  const capRate = pump ? PLAN.pumpMax * 2 : PLAN.chuteRate;
  const days = Math.max(1, Math.ceil(m3 / ((capRate * window) / 60) - 1e-9));
  const dayM3 = m3 / days;
  const need = (dayM3 / window) * 60;
  const minRate = Math.min(capRate, (V / PLAN.coldJointMin) * 60); // sovuq chocsiz eng past tezlik
  const rate = Math.min(capRate, Math.max(ceil5(need), pump ? Math.min(PLAN.pumpRate, ceil5(minRate)) : ceil5(minRate)));
  const pumps = pump ? Math.max(1, Math.ceil(rate / PLAN.pumpMax - 1e-9)) : 0;
  const pourMin = (dayM3 / rate) * 60;

  const unload = (V / rate) * 60;
  const total = PLAN.loadMin + out + PLAN.siteMin + unload + PLAN.washMin + back;
  const intervalMin = (V / rate) * 60;
  const single = dayM3 <= V + 1e-9;
  const mixersNeeded = single ? 1 : Math.max(1, Math.ceil(total / intervalMin - 1e-9));
  // Bitta mikser quyish davomida necha marta aylanadi (smenadan oshmaydi)
  const perMixer = Math.max(1, Math.min(Math.floor(shiftMin / total), Math.ceil(pourMin / total)));

  // O'z mikserlarimiz: kattasidan boshlab, faqat aylanishga kerakli soni
  const free = freeMinutes(working, shiftMin, fleet?.other.mixerMin ?? 0, capOf);
  const own: VehicleUse[] = [];
  let ownM3 = 0, ownTrips = 0, ownUsed = 0;
  for (const v of [...working].sort((a, b) => capOf(b) - capOf(a) || b.busyMin - a.busyMin)) {
    const f = free.get(v.id)!;
    const can = Math.min(perMixer, Math.floor(f.free / total));
    const cap = capOf(v);
    const capText = `${fmt(cap)} m³${v.cap ? "" : " (taxminiy)"}`;
    if (can <= 0) {
      own.push({ id: v.id, plate: v.plate, cap: capText, state: f.reserved > 0 && v.busyMin < shiftMin - total ? "reserved" : "busy", trips: 0, amount: 0,
        note: f.reserved > 0 && v.busyMin < shiftMin - total ? "shu kungi boshqa zayavkalarga kerak" : v.busyNote ? `band: ${v.busyNote}` : "smena band" });
      continue;
    }
    if (ownUsed >= mixersNeeded || ownM3 >= dayM3 - 1e-9) {
      own.push({ id: v.id, plate: v.plate, cap: capText, state: "spare", trips: 0, amount: 0, note: "bo'sh — zaxira" });
      continue;
    }
    const trips = Math.min(can, Math.ceil((dayM3 - ownM3) / cap - 1e-9));
    const amount = Math.min(trips * cap, dayM3 - ownM3);
    ownM3 += amount; ownTrips += trips; ownUsed++;
    const partial = v.busyMin > 0 || f.reserved > 0;
    own.push({ id: v.id, plate: v.plate, cap: capText, state: partial ? "partial" : "use", trips, amount,
      note: partial ? `qisman band${v.busyNote ? `: ${v.busyNote}` : ""}` : "bo'sh" });
  }
  for (const v of mixers.filter((x) => x.status === "REPAIR"))
    own.push({ id: v.id, plate: v.plate, cap: `${fmt(capOf(v))} m³`, state: "repair", trips: 0, amount: 0, note: "ta'mirda" });

  const rest = Math.max(0, dayM3 - ownM3);
  const hiredTrips = rest > 1e-9 ? Math.ceil(rest / PLAN.hiredMixerM3 - 1e-9) : 0;
  const hired = hiredTrips ? Math.max(Math.ceil(hiredTrips / perMixer), Math.min(mixersNeeded - ownUsed, hiredTrips)) : 0;
  const trips = (ownTrips + hiredTrips) * days;
  const lastLoad = r1(dayM3 - Math.floor((dayM3 - 1e-9) / V) * V);

  // ── Ogohlantirishlar ──
  if (input.km == null) warns.push({ tone: "info", text: `Obyekt xaritada belgilanmagan — masofa ${PLAN.defaultKm} km deb olindi.` });
  if (!pump && need > PLAN.chuteRate) warns.push({ tone: "warning", text: `Kuniga ${fmt(r1(dayM3))} m³ tarnov bilan quyishga ${fmt(ceil5(need))} m³/soat kerak — nasos tavsiya qilinadi.` });
  if (!pump && m3 > 40) warns.push({ tone: "info", text: "40 m³ dan katta quyishda odatda nasos ishlatiladi." });
  if (days > 1) warns.push({ tone: "warning", text: `Bir smenaga sig'maydi: ${days} kunga bo'lish kerak (kuniga ~${fmt(r1(dayM3))} m³). Monolitni bo'lish faqat konstruktiv choc bilan.` });
  const drum = arriveMin + unload;
  const hot = input.month != null && input.month >= 5 && input.month <= 7;
  const drumLimit = hot ? PLAN.drumHotMin : PLAN.drumMaxMin;
  if (drum > drumLimit) warns.push({ tone: "danger", text: `Beton yuklangandan ${fmt(Math.round(drum))} daqiqada to'kib bo'linadi — ${hot ? "issiqda " : ""}${drumLimit} daqiqadan oshadi. Sekinlatuvchi qo'shimcha (retarder) kerak.` });
  if (trips > 1 && lastLoad > 0 && lastLoad < PLAN.minLoadM3) warns.push({ tone: "info", text: `Oxirgi reysda ${fmt(lastLoad)} m³ qoladi — oxirgi ikki reysni teng bo'lgan ma'qul.` });
  if (fleet?.dailyCapacityM3 && fleet.other.m3 + dayM3 > fleet.dailyCapacityM3)
    warns.push({ tone: "warning", text: `Shu kuni zavod yuklamasi ${fmt(r1(fleet.other.m3 + dayM3))} m³ — kunlik quvvat ${fmt(fleet.dailyCapacityM3)} m³ dan oshadi.` });
  if (pump && fleet && pumps > fleet.vehicles.filter((v) => v.type === "PUMP" && v.status !== "REPAIR").length)
    warns.push({ tone: "warning", text: `${pumps} ta nasos kerak — o'zimizda yetarli emas.` });

  return {
    m3, km, kmAssumed: input.km == null, days, dayM3, rate, pumps, pourMin,
    cycle: { load: PLAN.loadMin, out, site: PLAN.siteMin, unload, wash: PLAN.washMin, back, total },
    arriveMin, intervalMin, mixersNeeded, trips, lastLoad,
    own, ownUsed, ownM3, ownTrips, hired, hiredTrips, hiredM3: rest, warns,
  };
}

// ───────────────────────── Dona mahsulot ─────────────────────────

/**
 * Dona og'irligi — GOST va katalog qiymatlari (kod yoki nomdagi markirovka bo'yicha). Taxminiy:
 * zavod pasporti yoki bitta donani tortib aniqlashtiriladi. `perLift` — bir ko'tarishda (paddon/bog'lam) necha dona.
 */
const WEIGHTS: { re: RegExp; kg: number; perLift?: number; longM?: number }[] = [
  { re: /FBS\s*24[.\s-]*4[.\s-]*6/i, kg: 1300 }, { re: /FBS\s*24[.\s-]*5[.\s-]*6/i, kg: 1630 }, { re: /FBS\s*24[.\s-]*6[.\s-]*6/i, kg: 1960 },
  { re: /FBS\s*12[.\s-]*4[.\s-]*6/i, kg: 640 }, { re: /FBS\s*12[.\s-]*5[.\s-]*6/i, kg: 790 }, { re: /FBS\s*12[.\s-]*6[.\s-]*6/i, kg: 960 },
  { re: /FBS\s*9[.\s-]*4[.\s-]*6/i, kg: 470 }, { re: /FBS\s*9[.\s-]*5[.\s-]*6/i, kg: 590 }, { re: /FBS\s*9[.\s-]*6[.\s-]*6/i, kg: 700 },
  { re: /FBS\s*24/i, kg: 1300 }, { re: /FBS\s*12/i, kg: 640 },
  { re: /PK\s*62/i, kg: 2500, longM: 6.2 }, { re: /PK\s*60/i, kg: 2400, longM: 6 },
  { re: /BR\s*100[.\s-]*30[.\s-]*15/i, kg: 110, perLift: 10 }, { re: /BR\s*100[.\s-]*20[.\s-]*8/i, kg: 40, perLift: 25 },
  { re: /KS\s*20/i, kg: 1500 }, { re: /KS\s*15/i, kg: 1000 }, { re: /KS\s*10/i, kg: 600 }, { re: /KS\s*7/i, kg: 460 },
  { re: /1\s*PP\s*10/i, kg: 250 }, { re: /2\s*PB\s*17/i, kg: 71, perLift: 10 },
  { re: /S\s*60[.\s-]*30|Svaya/i, kg: 1380, longM: 6 },
  { re: /Gazoblok|D500/i, kg: 22, perLift: 50 }, { re: /Keramzit/i, kg: 13, perLift: 80 }, { re: /390\s*x\s*190|Beton blok/i, kg: 18, perLift: 72 },
  { re: /Brus+chatka|TP\s*6/i, kg: 135, perLift: 11 }, { re: /Trotuar|TP\s*8/i, kg: 180, perLift: 10 },
  { re: /lotok|LT\s*50/i, kg: 60, perLift: 10 }, { re: /ustun/i, kg: 60, perLift: 20 },
];

export function refWeight(code: string, name: string): { kg: number; perLift: number; longM: number | null } | null {
  const text = `${code} ${name}`;
  const hit = WEIGHTS.find((w) => w.re.test(text));
  return hit ? { kg: hit.kg, perLift: hit.perLift ?? 1, longM: hit.longM ?? null } : null;
}

export type PieceItem = { code: string; name: string; unit: string; qty: number };
export type PieceLoad = { plate: string; hired: boolean; kg: number; capKg: number; lines: { name: string; qty: number; unit: string }[] };
export type PiecePlan = {
  tons: number; unknown: string[]; km: number; kmAssumed: boolean;
  trips: number; loads: PieceLoad[];
  own: VehicleUse[]; ownUsed: number; ownTrips: number;
  hired: number; hiredTrips: number; tripsPerHired: number;
  /** Faqat o'z mashinalarimiz bilan necha kunda tashib bo'linadi (0 — o'z mashina yo'q). */
  ownDays: number;
  cycleMin: number; crane: boolean;
  warns: PlanWarn[];
};

export function piecePlan(input: { items: PieceItem[]; km: number | null; fleet: DayFleet | null }): PiecePlan {
  const km = input.km ?? PLAN.defaultKm;
  const warns: PlanWarn[] = [];
  const shiftMin = (input.fleet?.shiftMin ?? 600) - PLAN.truckReserveMin;
  const unknown: string[] = [];
  const goods: { name: string; unit: string; kg: number; perLift: number; left: number; longM: number | null }[] = [];
  for (const it of input.items) {
    if (!(it.qty > 0)) continue;
    const w = refWeight(it.code, it.name);
    if (!w) { unknown.push(it.name); continue; }
    goods.push({ name: it.name, unit: it.unit, kg: w.kg, perLift: w.perLift, left: Math.ceil(it.qty - 1e-9), longM: w.longM });
  }
  goods.sort((a, b) => (b.longM ?? 0) - (a.longM ?? 0) || b.kg - a.kg); // uzun va og'iri — avval, polga
  const totalKg = goods.reduce((s, g) => s + g.kg * g.left, 0);
  const totalLifts = goods.reduce((s, g) => s + Math.ceil(g.left / g.perLift), 0);
  const avgLiftKg = totalLifts ? totalKg / totalLifts : 1000;

  const cycleFor = (capKg: number) => {
    const lifts = Math.max(1, Math.min(totalLifts, Math.ceil(capKg / avgLiftKg)));
    return PLAN.truckLoadBase + lifts * PLAN.truckLoadPerLift + (km / PLAN.speedLoaded) * 60
      + PLAN.truckUnloadBase + lifts * PLAN.truckUnloadPerLift + (km / PLAN.speedEmpty) * 60 + PLAN.truckDocsMin;
  };

  const trucks = (input.fleet?.vehicles ?? []).filter((v) => v.type === "TRUCK");
  const working = trucks.filter((v) => v.status !== "REPAIR");
  // Yuk ko'tarishi: TON — tonna; PIECE — dona soni (og'irlik cheklanmaydi); kiritilmagan — taxminiy
  const capKgOf = (v: FleetVehicle) => (v.unit === "TON" && v.cap ? v.cap * 1000 : v.unit === "PIECE" ? Infinity : PLAN.defaultTruckT * 1000);
  const free = freeMinutes(working, shiftMin, input.fleet?.other.truckMin ?? 0, (v) => (Number.isFinite(capKgOf(v)) ? capKgOf(v) : 1e9));

  /** Bitta reysni to'ldiradi: og'ir/uzun yukdan boshlab, sig'guncha. */
  const fill = (capKg: number, capPcs: number) => {
    const lines: PieceLoad["lines"] = [];
    let kg = 0, pcs = 0;
    for (const g of goods) {
      if (!g.left) continue;
      const byKg = Number.isFinite(capKg) ? Math.floor((capKg - kg) / g.kg + 1e-9) : Infinity;
      const take = Math.min(g.left, byKg, capPcs - pcs);
      if (take <= 0) continue;
      g.left -= take; kg += take * g.kg; pcs += take;
      lines.push({ name: g.name, qty: take, unit: g.unit });
    }
    return { kg, lines };
  };
  const remaining = () => goods.some((g) => g.left > 0);

  const loads: PieceLoad[] = [];
  const own: VehicleUse[] = [];
  let ownTrips = 0, ownUsed = 0, ownPerDay = 0;
  const ownSorted = [...working].sort((a, b) => capKgOf(b) - capKgOf(a));
  for (const v of ownSorted) {
    const capKg = capKgOf(v);
    const capPcs = v.unit === "PIECE" && v.cap ? Math.floor(v.cap) : Infinity;
    const T = cycleFor(Number.isFinite(capKg) ? capKg : totalKg);
    const f = free.get(v.id)!;
    const can = Math.floor(f.free / T);
    ownPerDay += Math.floor(shiftMin / T);
    const capText = v.unit === "PIECE" && v.cap ? `${fmt(v.cap)} dona` : `${fmt(r1(capKg / 1000))} t${v.unit === "TON" && v.cap ? "" : " (taxminiy)"}`;
    if (can <= 0) {
      own.push({ id: v.id, plate: v.plate, cap: capText, state: f.reserved > 0 ? "reserved" : "busy", trips: 0, amount: 0,
        note: f.reserved > 0 ? "shu kungi boshqa zayavkalarga kerak" : v.busyNote ? `band: ${v.busyNote}` : "smena band" });
      continue;
    }
    if (!remaining()) { own.push({ id: v.id, plate: v.plate, cap: capText, state: "spare", trips: 0, amount: 0, note: "bo'sh — zaxira" }); continue; }
    let trips = 0, kgSum = 0;
    while (trips < can && remaining()) {
      const l = fill(capKg, capPcs);
      if (!l.lines.length) break; // bir donasi ham sig'maydi
      loads.push({ plate: v.plate, hired: false, kg: l.kg, capKg: Number.isFinite(capKg) ? capKg : l.kg, lines: l.lines });
      trips++; kgSum += l.kg;
    }
    ownTrips += trips; if (trips) ownUsed++;
    own.push({ id: v.id, plate: v.plate, cap: capText, state: v.busyMin > 0 || f.reserved > 0 ? "partial" : "use", trips, amount: kgSum / 1000,
      note: trips ? (v.busyMin > 0 ? `qisman band${v.busyNote ? `: ${v.busyNote}` : ""}` : "bo'sh") : "yuk sig'maydi" });
  }
  for (const v of trucks.filter((x) => x.status === "REPAIR"))
    own.push({ id: v.id, plate: v.plate, cap: v.cap ? `${fmt(v.cap)} ${v.unit === "PIECE" ? "dona" : "t"}` : "—", state: "repair", trips: 0, amount: 0, note: "ta'mirda" });

  // Qolgani — yollanma treyler (20 t)
  const hiredCap = PLAN.hiredTruckT * 1000;
  const tripsPerHired = Math.max(1, Math.floor(shiftMin / cycleFor(hiredCap)));
  let hiredTrips = 0;
  while (remaining()) {
    const l = fill(hiredCap, Infinity);
    if (!l.lines.length) break;
    hiredTrips++;
    loads.push({ plate: `Yollanma ${Math.ceil(hiredTrips / tripsPerHired)}`, hired: true, kg: l.kg, capKg: hiredCap, lines: l.lines });
  }
  const hired = hiredTrips ? Math.ceil(hiredTrips / tripsPerHired) : 0;
  const trips = ownTrips + hiredTrips;
  const ownDays = ownPerDay > 0 ? Math.ceil(trips / ownPerDay - 1e-9) : 0;

  const heavy = goods.some((g) => g.kg >= PLAN.craneKg);
  if (input.km == null && goods.length) warns.push({ tone: "info", text: `Obyekt xaritada belgilanmagan — masofa ${PLAN.defaultKm} km deb olindi.` });
  if (unknown.length) warns.push({ tone: "warning", text: `Og'irligi noma'lum, hisobga kirmadi: ${unknown.join(", ")}.` });
  if (heavy) warns.push({ tone: "warning", text: `Dona og'irligi ${PLAN.craneKg} kg dan oshadi — obyektda tushirish uchun avtokran yoki manipulyator kerak.` });
  const long = goods.find((g) => g.longM);
  if (long) warns.push({ tone: "info", text: `Uzun yuk (${long.name}, ${fmt(long.longM!)} m) — kuzov uzunligi kamida ${fmt(long.longM! + 0.5)} m bo'lsin.` });
  if (hired && ownDays > 1) warns.push({ tone: "info", text: `Yollanmasiz faqat o'z mashinalarimiz bilan ${ownDays} kunda tashib bo'linadi.` });

  return {
    tons: totalKg / 1000, unknown, km, kmAssumed: input.km == null, trips, loads,
    own, ownUsed, ownTrips, hired, hiredTrips, tripsPerHired, ownDays,
    cycleMin: cycleFor(ownSorted[0] ? (Number.isFinite(capKgOf(ownSorted[0])) ? capKgOf(ownSorted[0]) : totalKg) : hiredCap),
    crane: heavy, warns,
  };
}
