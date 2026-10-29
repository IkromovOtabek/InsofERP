import { db } from "@/lib/db";
import { PAY_SINCE, payTrips, type PayTripRow } from "@/lib/driver-trip-pay";
import { fmtNum } from "@/lib/format";

/**
 * Haydovchi tabelining «hisob varag'i» (dispetcher Excel'i ko'rinishida): har yetkazilgan reys bir qator —
 * qayerdan/qayerga, yuk, probeg, baraban soati, gaz (qoldiq → zapravka → sarf → qoldiq), yoqilg'i summasi,
 * haydovchi haqi, ta'mir/zapchast/boshqa xarajat, jami xarajat, dastavka daromadi (P/R, N/L) va foyda.
 *
 * Hammasi reys yetkazilganda o'zi to'ladi: km — ECO/ERP GPS izi (bo'lmasa zayavka masofasi), baraban soati —
 * haydovchi yoki reys vaqtlari (`autoDrumHours`), sarf — transport kartasidagi norma × km + soat (`tripFuelNorm`).
 * Pul ko'rsatkichlari `avtoReport` bilan bir xil: daromad — zayavka dastavka haqi reyslarga hajm ulushida.
 *
 * Gaz qoldig'i — transport bo'yicha (bir mashinada bir necha haydovchi): `PAY_SINCE` dan beri zapravkalar − norma sarfi.
 * Zapravka va reysga bog'lanmagan transport xarajati shu mashinaning keyingi reysi qatoriga tushadi
 * (davrda keyingi reys bo'lmasa — oxirgisiga), reysga bog'langani — o'sha reysga.
 */

/** Qoldiq yuritiladigan yoqilg'i: metan (m³) yoki dizel (l). «Dizel + metan» da — metan; dizel sarfi faqat summaga. */
type Tracked = "gas" | "dt";
const trackedOf = (fuelType: string | null | undefined): Tracked => (fuelType === "METHANE" || fuelType === "DIESEL_METHANE" ? "gas" : "dt");
const kindOfLog = (fuelType: string): Tracked => (fuelType === "METHANE" || fuelType === "PROPANE" ? "gas" : "dt");

export type LedgerRow = PayTripRow & {
  vehicleId: string;
  pickup: string; dropoff: string; address: string | null; cargo: string;
  /** Kuzatiladigan yoqilg'i birligi (m³ yoki l) */
  unit: string;
  balBefore: number; refuel: number; use: number | null; balAfter: number;
  /** Ikkinchi yoqilg'i («Dizel + metan» dagi dizel), l — faqat summada */
  useExtra: number | null;
  fuelSum: number; fuelPriceMissing: boolean;
  pay: number; repair: number; parts: number; other: number; total: number;
  revBank: number; revCash: number; revOther: number; revenue: number; profit: number;
  remarks: string[];
};

export type LedgerTotals = Pick<LedgerRow, "km" | "refuel" | "fuelSum" | "pay" | "repair" | "parts" | "other" | "total" | "revBank" | "revCash" | "revOther" | "revenue" | "profit"> & {
  trips: number; hours: number; useGas: number; useDt: number;
};

const r1 = (v: number) => Math.round(v * 10) / 10 || 0;
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;

/** Narx sana bo'yicha: shu sanagacha bo'lgan oxirgi zapravka narxi (bo'lmasa — keyingi birinchisi). */
function priceAt(list: { at: number; p: number }[], at: number): number | null {
  if (!list.length) return null;
  let best: number | null = null;
  for (const x of list) { if (x.at <= at) best = x.p; else break; }
  return best ?? list[0]!.p;
}

export async function driverLedger(from: Date, to: Date, opts: { driverId?: string; vehicleId?: string } = {}): Promise<{ rows: LedgerRow[]; total: LedgerTotals }> {
  // Gaz qoldig'i mashina bo'yicha — davrdagi shu mashinalarning hamma reysi kerak (filtr keyin)
  const period = { gte: from, lt: to };
  const base = await payTrips({ status: "DELIVERED", deliveredAt: period, ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}) }, 5000);
  const tripIds = base.map((r) => r.id);
  const extra = tripIds.length ? await db.trip.findMany({
    where: { id: { in: tripIds } },
    select: {
      id: true, vehicleId: true, orderId: true, qtyM3: true, pickupAddress: true, deliveryComment: true,
      order: { select: { deliveryAddress: true, deliveryFee: true, payMethod: true, site: { select: { name: true } }, items: { select: { product: { select: { code: true, unit: true } } } } } },
    },
  }) : [];
  const vehicleIds = [...new Set(extra.map((t) => t.vehicleId))];

  const [vehicles, fuelLogs, expenses, openFuel, openTrips, prices] = await Promise.all([
    db.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, fuelType: true, fuelNormL100: true, idleNormPerHour: true, gasNormPer100: true, gasIdlePerHour: true } }),
    db.fuelLog.findMany({ where: { cancelledAt: null, vehicleId: { in: vehicleIds }, date: period }, orderBy: { date: "asc" }, select: { vehicleId: true, tripId: true, date: true, fuelType: true, liters: true } }),
    db.transportExpense.findMany({ where: { cancelledAt: null, kind: { not: "DRIVER_PAY" }, date: period, OR: [{ vehicleId: { in: vehicleIds } }, { tripId: { in: tripIds } }] }, orderBy: { date: "asc" }, select: { vehicleId: true, tripId: true, date: true, kind: true, amount: true } }),
    // Davr boshidagi qoldiq: PAY_SINCE dan davr boshigacha zapravka − norma (norma chiziqli: Σkm va Σsoat yetadi)
    from > PAY_SINCE
      ? db.fuelLog.groupBy({ by: ["vehicleId", "fuelType"], where: { cancelledAt: null, vehicleId: { in: vehicleIds }, date: { gte: PAY_SINCE, lt: from } }, _sum: { liters: true } })
      : Promise.resolve([]),
    from > PAY_SINCE
      ? db.trip.groupBy({ by: ["vehicleId"], where: { status: "DELIVERED", vehicleId: { in: vehicleIds }, deliveredAt: { gte: PAY_SINCE, lt: from } }, _sum: { payKm: true, workHours: true } })
      : Promise.resolve([]),
    // Narx: zapravkalardan (hamma mashina), davr oxirigacha — oxirgi yozuvlar
    db.fuelLog.findMany({ where: { cancelledAt: null, date: { lt: to }, pricePerL: { gt: 0 } }, orderBy: { date: "desc" }, select: { date: true, fuelType: true, pricePerL: true }, take: 5000 }),
  ]);

  const ex = new Map(extra.map((t) => [t.id, t]));
  // Kartada yoqilg'i turi yo'q — qoldiq shu mashina zapravkalari turida (ko'prog'i)
  for (const v of vehicles) {
    if (v.fuelType) continue;
    const gas = fuelLogs.filter((f) => f.vehicleId === v.id && kindOfLog(f.fuelType) === "gas").length;
    if (gas * 2 > fuelLogs.filter((f) => f.vehicleId === v.id).length) v.fuelType = "METHANE";
  }
  const vById = new Map(vehicles.map((v) => [v.id, v]));
  const priceList: Record<Tracked, { at: number; p: number }[]> = { gas: [], dt: [] };
  for (const p of prices.reverse()) priceList[kindOfLog(p.fuelType)].push({ at: p.date.getTime(), p: Number(p.pricePerL) });

  // Dastavka haqi zayavkaning barcha reyslariga hajm ulushida (avtoReport'dagidek)
  const orderIds = [...new Set(extra.map((t) => t.orderId))];
  const orderQty = new Map((orderIds.length
    ? await db.trip.groupBy({ by: ["orderId"], where: { orderId: { in: orderIds }, status: { not: "CANCELLED" } }, _sum: { qtyM3: true }, _count: true })
    : []).map((g) => [g.orderId, { qty: Number(g._sum.qtyM3 ?? 0), n: g._count }]));

  // Ochilish qoldig'i
  const balance = new Map<string, number>();
  for (const v of vehicles) {
    const tr = trackedOf(v.fuelType);
    const given = openFuel.filter((f) => f.vehicleId === v.id && kindOfLog(f.fuelType) === tr).reduce((a, f) => a + Number(f._sum.liters ?? 0), 0);
    const ot = openTrips.find((t) => t.vehicleId === v.id);
    const km = Number(ot?._sum.payKm ?? 0), h = Number(ot?._sum.workHours ?? 0);
    const per100 = Number((v.fuelType === "DIESEL_METHANE" ? v.gasNormPer100 : v.fuelNormL100) ?? 0);
    const idle = Number((v.fuelType === "DIESEL_METHANE" ? v.gasIdlePerHour : v.idleNormPerHour) ?? 0);
    balance.set(v.id, given - ((km * per100) / 100 + h * idle));
  }

  // Mashina bo'yicha reyslar tartibi — zapravka/xarajatni qaysi qatorga qo'yish uchun
  const byVehicle = new Map<string, PayTripRow[]>();
  for (const r of base) {
    const vid = ex.get(r.id)?.vehicleId; if (!vid) continue;
    const list = byVehicle.get(vid) ?? []; list.push(r); byVehicle.set(vid, list);
  }
  /** Reysga bog'lanmagan yozuv → shu mashinaning shu vaqtdan keyingi birinchi reysi (bo'lmasa oxirgisi). */
  const targetTrip = (vehicleId: string | null, tripId: string | null, at: Date): string | null => {
    if (tripId && ex.has(tripId)) return tripId;
    const list = vehicleId ? byVehicle.get(vehicleId) : undefined;
    if (!list?.length) return null;
    return (list.find((r) => r.deliveredAt >= at) ?? list[list.length - 1]!).id;
  };
  const refuelOf = new Map<string, number>();
  for (const f of fuelLogs) {
    const v = vById.get(f.vehicleId); if (!v || kindOfLog(f.fuelType) !== trackedOf(v.fuelType)) continue;
    const id = targetTrip(f.vehicleId, f.tripId, f.date); if (!id) continue;
    refuelOf.set(id, (refuelOf.get(id) ?? 0) + Number(f.liters));
  }
  const expOf = new Map<string, { repair: number; parts: number; other: number }>();
  for (const e of expenses) {
    const id = targetTrip(e.vehicleId, e.tripId, e.date); if (!id) continue;
    const x = expOf.get(id) ?? { repair: 0, parts: 0, other: 0 };
    const a = Number(e.amount);
    if (e.kind === "REPAIR") x.repair += a; else if (e.kind === "PARTS") x.parts += a; else x.other += a;
    expOf.set(id, x);
  }

  const all: LedgerRow[] = [];
  for (const r of base) {
    const t = ex.get(r.id); if (!t) continue;
    const v = vById.get(t.vehicleId);
    const tracked = trackedOf(v?.fuelType);
    const dual = v?.fuelType === "DIESEL_METHANE";
    // payTrips: fuelNorm — asosiy norma (metan m³ yoki dizel l), gasNorm — «Dizel + metan» dagi metan
    const use = dual ? r.gasNorm : r.fuelNorm;
    const useExtra = dual ? r.fuelNorm : null;
    const at = r.deliveredAt.getTime();
    const pMain = priceAt(priceList[tracked], at), pDt = dual ? priceAt(priceList.dt, at) : null;
    const fuelSum = (use != null && pMain != null ? use * pMain : 0) + (useExtra != null && pDt != null ? useExtra * pDt : 0);

    const balBefore = balance.get(t.vehicleId) ?? 0;
    const refuel = refuelOf.get(r.id) ?? 0;
    const balAfter = balBefore + refuel - (use ?? 0);
    balance.set(t.vehicleId, balAfter);

    const oq = orderQty.get(t.orderId);
    const fee = Number(t.order.deliveryFee ?? 0);
    const revenue = fee > 0 && oq ? (oq.qty > 0 ? (fee * Number(t.qtyM3)) / oq.qty : fee / oq.n) : 0;
    const pm = t.order.payMethod;
    const e = expOf.get(r.id) ?? { repair: 0, parts: 0, other: 0 };
    const pay = r.amount ?? r.suggested;
    const total = fuelSum + pay + e.repair + e.parts + e.other;

    const codes = [...new Set(t.order.items.map((i) => i.product.code))];
    const unit = t.order.items[0]?.product.unit === "m3" ? "m³" : t.order.items[0]?.product.unit ?? "";
    const hr = r.deliveredAt.getHours();
    const remarks = [
      hr >= 20 || hr < 6 ? `Tun ${String(hr).padStart(2, "0")}:${String(r.deliveredAt.getMinutes()).padStart(2, "0")}` : null,
      r.note, t.deliveryComment,
    ].filter((x): x is string => !!x);

    all.push({
      ...r, vehicleId: t.vehicleId,
      pickup: t.pickupAddress?.trim() || "Zavod",
      dropoff: t.order.site?.name ?? r.customer,
      address: t.order.deliveryAddress || null,
      cargo: `${codes.join(", ") || "—"} · ${fmtNum(Number(t.qtyM3), 2)} ${unit}`.trim(),
      unit: tracked === "gas" ? "m³" : "l",
      balBefore: r1(balBefore), refuel: r1(refuel), use: use != null ? r1(use) : null, balAfter: r1(balAfter), useExtra: useExtra != null ? r1(useExtra) : null,
      fuelSum: r2(fuelSum), fuelPriceMissing: (use != null && pMain == null) || (useExtra != null && pDt == null),
      pay, repair: e.repair, parts: e.parts, other: e.other, total: r2(total),
      revBank: pm === "BANK" ? revenue : 0, revCash: pm === "CASH" ? revenue : 0, revOther: pm ? 0 : revenue,
      revenue: r2(revenue), profit: r2(revenue - total), remarks,
    });
  }

  const rows = opts.driverId ? all.filter((r) => r.driverId === opts.driverId) : all;
  const total: LedgerTotals = {
    trips: rows.length, km: 0, hours: 0, useGas: 0, useDt: 0, refuel: 0, fuelSum: 0, pay: 0, repair: 0, parts: 0, other: 0, total: 0,
    revBank: 0, revCash: 0, revOther: 0, revenue: 0, profit: 0,
  };
  for (const r of rows) {
    total.km += r.km; total.hours += r.workHours ?? 0; total.refuel += r.refuel; total.fuelSum += r.fuelSum;
    if (r.unit === "m³") total.useGas += r.use ?? 0; else total.useDt += r.use ?? 0;
    total.useDt += r.useExtra ?? 0;
    total.pay += r.pay; total.repair += r.repair; total.parts += r.parts; total.other += r.other; total.total += r.total;
    total.revBank += r.revBank; total.revCash += r.revCash; total.revOther += r.revOther; total.revenue += r.revenue; total.profit += r.profit;
  }
  return { rows, total };
}

/** Transport bo'yicha yoqilg'i qoldig'i davrda: oy boshidagi, zapravka, norma sarfi, oxirgi reysdan keyingi. */
export type FuelBalance = { vehicleId: string; plate: string; unit: string; drivers: string[]; trips: number; opening: number; refuel: number; use: number; closing: number };

/** `driverLedger` qatorlaridan (filtrsiz — qoldiq butun mashina bo'yicha) transport kesimi. */
export function fuelBalances(rows: LedgerRow[]): FuelBalance[] {
  const out = new Map<string, FuelBalance>();
  for (const r of rows) {
    let b = out.get(r.vehicleId);
    if (!b) { b = { vehicleId: r.vehicleId, plate: r.plate, unit: r.unit, drivers: [], trips: 0, opening: r.balBefore, refuel: 0, use: 0, closing: r.balBefore }; out.set(r.vehicleId, b); }
    b.trips++; b.refuel = r1(b.refuel + r.refuel); b.use = r1(b.use + (r.use ?? 0)); b.closing = r.balAfter;
    if (!b.drivers.includes(r.driver)) b.drivers.push(r.driver);
  }
  return [...out.values()].sort((a, b) => a.plate.localeCompare(b.plate));
}
