import { db } from "@/lib/db";
import type { DriverPayType, LedgerRevenueType } from "@/generated/prisma";
import { PAY_SINCE, payTrips, tripFuelNorm } from "@/lib/driver-trip-pay";
import { fmtNum } from "@/lib/format";

/**
 * Haydovchi tabelining «hisob varag'i» (dispetcher Excel'i ko'rinishida, mashina bo'yicha varaq): har qator —
 * qayerdan/qayerga, yuk, probeg, baraban soati, gaz (qoldiq → zapravka → sarf → qoldiq), yoqilg'i summasi,
 * haydovchi haqi, ta'mir/zapchast/vulkanizator/boshqa xarajat, jami xarajat, bajarilgan ish (dostavka va usluga — naqd / perech., «Obyekt» — zavodning o'zi uchun ish) va foyda.
 *
 * Qator uch xil:
 *  - `trip` — yetkazilgan reys, o'zi tushadi: km — ECO/ERP GPS izi (bo'lmasa zayavka masofasi), baraban soati —
 *    haydovchi yoki reys vaqtlari (`autoDrumHours`); ECO bermagan bo'lsa dispetcher tuzatadi (`fixTripKmHours`);
 *  - `entry` — dispetcherning qo'lda qatori (`LogisticsEntry`): ECO'ga tushmagan reys, o'z zapravka va xarajati bilan;
 *  - `cost` — reysi ham, qo'lda qatori ham yo'q mashinaning shu kungi zapravka/xarajati (yo'qolib qolmasin).
 * Sarf — transport kartasidagi norma × km + soat (`tripFuelNorm`). Pul ko'rsatkichlari `avtoReport` bilan bir xil:
 * daromad — zayavka dastavka haqi reyslarga hajm ulushida.
 *
 * Gaz qoldig'i — transport bo'yicha (bir mashinada bir necha haydovchi): `PAY_SINCE` dan beri zapravkalar − norma sarfi.
 * Qo'lda qator bilan yozilgan zapravka/xarajat — o'sha qatorga, reysga bog'langani — o'sha reysga, qolgani shu
 * mashinaning keyingi qatoriga tushadi (davrda keyingisi bo'lmasa — oxirgisiga).
 */

/** Qoldiq yuritiladigan yoqilg'i: metan (m³) yoki dizel (l). «Dizel + metan» da — metan; dizel sarfi faqat summaga. */
type Tracked = "gas" | "dt";
const trackedOf = (fuelType: string | null | undefined): Tracked => (fuelType === "METHANE" || fuelType === "DIESEL_METHANE" ? "gas" : "dt");
const kindOfLog = (fuelType: string): Tracked => (fuelType === "METHANE" || fuelType === "PROPANE" ? "gas" : "dt");
/** Vulkanizatsiya alohida tur emas (`OTHER`) — mexanik so'rovi va qo'lda qator izohida shu so'z bo'ladi. */
const isVulc = (note: string | null) => !!note && /vulkaniz/i.test(note);

export type LedgerKind = "trip" | "entry" | "cost";

/** Qatorga tushgan zapravka va xarajat yozuvlari (id) — tahrirda shular o'zgaradi (`lib/ledger-edit.ts`). */
export type LedgerRefs = { fuel: string[]; repair: string[]; parts: string[]; vulc: string[]; other: string[] };

export type LedgerRow = {
  kind: LedgerKind;
  /** Reys yoki qo'lda yozuv id; `cost` — `<mashina>:<kun>` */
  id: string;
  /** Nakladnoy yoki QY-raqam */
  no: string;
  at: Date;
  driverId: string | null; driver: string | null;
  vehicleId: string; plate: string;
  pickup: string; dropoff: string; address: string | null; cargo: string;
  trips: number; km: number; workHours: number | null;
  /** Kuzatiladigan yoqilg'i birligi (m³ yoki l) */
  unit: string;
  balBefore: number; refuel: number; use: number | null;
  /** Sarfning baraban (turib ishlash) qismi: soat × soat normasi — Excel'dagi «час + 4 м³» */
  drumUse: number | null;
  balAfter: number;
  /** Ikkinchi yoqilg'i («Dizel + metan» dagi dizel), l — faqat summada */
  useExtra: number | null;
  fuelSum: number; fuelPriceMissing: boolean;
  /** Haydovchi haqi: narxlangan / qo'lda yozilgan, bo'lmasa taklif */
  pay: number; amount: number | null; suggestText: string | null; payType: DriverPayType | null; approvedAt: Date | null;
  repair: number; parts: number; vulc: number; other: number; total: number;
  /**
   * Bajarilgan ish (summada): dostavka — perechisleniye (`revBank`), naqd (`revCash`), qarzga (`revDebt`: zayavkada to'lov turi
   * yo'q — mijoz keyin to'laydi); usluga prixodi — perechisleniye / naqd (`svcBank`, `svcCash`); «Obyekt» — zavodning o'zi uchun
   * ish (`revOther`, zavodga olib kelingan narsa). Hammasi logistika daromadi — foydaga kiradi.
   */
  revBank: number; revCash: number; revDebt: number; svcBank: number; svcCash: number; revOther: number; revenue: number; profit: number;
  remarks: string[];
  /** Tahrir oynasi uchun xom qiymatlar (ko'rinishdagi «—» va yig'ma izohsiz) */
  src: { pickup: string | null; dropoff: string | null; cargo: string | null; note: string | null; revenueType: LedgerRevenueType | null; priced: boolean; suggested: number | null };
  refs: LedgerRefs;
  /** Zapravka narxi (qatordagi zapravkalar o'rtachasi) */
  refuelPrice: number | null;
  /** Qo'lda qatorning o'zi bilan yozilgan zapravka/xarajat bor — transporti o'zgarmaydi */
  ownCosts: boolean;
};

export type LedgerTotals = Pick<LedgerRow, "km" | "refuel" | "fuelSum" | "pay" | "repair" | "parts" | "vulc" | "other" | "total" | "revBank" | "revCash" | "revDebt" | "svcBank" | "svcCash" | "revOther" | "revenue" | "profit"> & {
  rows: number; trips: number; hours: number; useGas: number; useDt: number; drumUse: number;
};

const r1 = (v: number) => Math.round(v * 10) / 10 || 0;
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const DAY = 86_400_000;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + DAY - 1000;

/** Narx sana bo'yicha: shu sanagacha bo'lgan oxirgi zapravka narxi (bo'lmasa — keyingi birinchisi). */
function priceAt(list: { at: number; p: number }[], at: number): number | null {
  if (!list.length) return null;
  let best: number | null = null;
  for (const x of list) { if (x.at <= at) best = x.p; else break; }
  return best ?? list[0]!.p;
}

type Norms = { fuelType: string | null; fuelNormL100: unknown; idleNormPerHour: unknown; gasNormPer100: unknown; gasIdlePerHour: unknown };
/** Kuzatiladigan yoqilg'i normasi (metan yoki dizel) va «Dizel + metan» dagi dizel normasi. */
const mainNorm = (v: Norms) => (v.fuelType === "DIESEL_METHANE" ? { fuelNormL100: v.gasNormPer100, idleNormPerHour: v.gasIdlePerHour } : v);
const idleOf = (v: Norms) => Number(mainNorm(v).idleNormPerHour ?? 0);

/** Qatorni yig'ish uchun «o'rin»: vaqt bo'yicha tartib, zapravka va xarajat shunga biriktiriladi. */
type Slot = { kind: LedgerKind; id: string; vehicleId: string; sortAt: number };

export async function driverLedger(from: Date, to: Date, opts: { driverId?: string; vehicleId?: string } = {}): Promise<{ rows: LedgerRow[]; total: LedgerTotals }> {
  // Gaz qoldig'i mashina bo'yicha — davrdagi shu mashinalarning hamma qatori kerak (haydovchi filtri keyin)
  const period = { gte: from, lt: to };
  const vf = opts.vehicleId ? { vehicleId: opts.vehicleId } : {};
  const [base, entries, fuelLogs, expenses] = await Promise.all([
    payTrips({ status: "DELIVERED", deliveredAt: period, ...vf }, 5000),
    db.logisticsEntry.findMany({
      where: { cancelledAt: null, date: period, vehicleId: opts.vehicleId ?? { not: null } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, docNo: true, date: true, driverId: true, vehicleId: true, trips: true, km: true, drumHours: true, payAmount: true, payType: true, payApprovedAt: true,
        revenue: true, revenueType: true, pickup: true, dropoff: true, cargo: true, note: true, driver: { select: { fullName: true } },
      },
    }),
    db.fuelLog.findMany({ where: { cancelledAt: null, date: period, ...vf }, orderBy: { date: "asc" }, select: { id: true, vehicleId: true, tripId: true, entryId: true, date: true, fuelType: true, liters: true, amount: true } }),
    db.transportExpense.findMany({
      where: { cancelledAt: null, kind: { not: "DRIVER_PAY" }, date: period, ...(opts.vehicleId ? { OR: [{ vehicleId: opts.vehicleId }, { trip: { vehicleId: opts.vehicleId } }] } : {}) },
      orderBy: { date: "asc" }, select: { id: true, vehicleId: true, tripId: true, entryId: true, date: true, kind: true, amount: true, note: true, trip: { select: { vehicleId: true } } },
    }),
  ]);
  const tripIds = base.map((r) => r.id);
  const extra = tripIds.length ? await db.trip.findMany({
    where: { id: { in: tripIds } },
    select: {
      id: true, vehicleId: true, orderId: true, qtyM3: true, pickupAddress: true, deliveryComment: true,
      order: { select: { deliveryAddress: true, deliveryFee: true, payMethod: true, site: { select: { name: true } }, items: { select: { product: { select: { name: true, unit: true } } } } } },
    },
  }) : [];
  const ex = new Map(extra.map((t) => [t.id, t]));
  const expVehicle = (e: (typeof expenses)[number]) => e.vehicleId ?? e.trip?.vehicleId ?? null;
  const vehicleIds = [...new Set([
    ...extra.map((t) => t.vehicleId), ...entries.map((e) => e.vehicleId!), ...fuelLogs.map((f) => f.vehicleId),
    ...expenses.map(expVehicle).filter((x): x is string => !!x),
  ])];

  const [vehicles, openFuel, openTrips, openEntries, prices] = await Promise.all([
    db.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, plate: true, fuelType: true, fuelNormL100: true, idleNormPerHour: true, gasNormPer100: true, gasIdlePerHour: true } }),
    // Davr boshidagi qoldiq: PAY_SINCE dan davr boshigacha zapravka − norma (norma chiziqli: Σkm va Σsoat yetadi)
    from > PAY_SINCE
      ? db.fuelLog.groupBy({ by: ["vehicleId", "fuelType"], where: { cancelledAt: null, vehicleId: { in: vehicleIds }, date: { gte: PAY_SINCE, lt: from } }, _sum: { liters: true } })
      : Promise.resolve([]),
    from > PAY_SINCE
      ? db.trip.groupBy({ by: ["vehicleId"], where: { status: "DELIVERED", vehicleId: { in: vehicleIds }, deliveredAt: { gte: PAY_SINCE, lt: from } }, _sum: { payKm: true, workHours: true } })
      : Promise.resolve([]),
    from > PAY_SINCE
      ? db.logisticsEntry.groupBy({ by: ["vehicleId"], where: { cancelledAt: null, vehicleId: { in: vehicleIds }, date: { gte: PAY_SINCE, lt: from } }, _sum: { km: true, drumHours: true } })
      : Promise.resolve([]),
    // Narx: zapravkalardan (hamma mashina), davr oxirigacha — oxirgi yozuvlar
    db.fuelLog.findMany({ where: { cancelledAt: null, date: { lt: to }, pricePerL: { gt: 0 } }, orderBy: { date: "desc" }, select: { date: true, fuelType: true, pricePerL: true }, take: 5000 }),
  ]);

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
    const ot = openTrips.find((t) => t.vehicleId === v.id), oe = openEntries.find((e) => e.vehicleId === v.id);
    const km = Number(ot?._sum.payKm ?? 0) + Number(oe?._sum.km ?? 0), h = Number(ot?._sum.workHours ?? 0) + Number(oe?._sum.drumHours ?? 0);
    const n = mainNorm(v);
    balance.set(v.id, given - ((km * Number(n.fuelNormL100 ?? 0)) / 100 + h * Number(n.idleNormPerHour ?? 0)));
  }

  // O'rinlar: reyslar va qo'lda qatorlar (qo'lda qator — kun oxirida); qatori yo'q mashinaga — xarajat kunlari
  const slots: Slot[] = [];
  for (const r of base) { const t = ex.get(r.id); if (t) slots.push({ kind: "trip", id: r.id, vehicleId: t.vehicleId, sortAt: r.deliveredAt.getTime() }); }
  for (const e of entries) slots.push({ kind: "entry", id: e.id, vehicleId: e.vehicleId!, sortAt: dayEnd(e.date) });
  const hasRows = new Set(slots.map((s) => s.vehicleId));
  const costSlot = (vehicleId: string, at: Date) => {
    const id = `${vehicleId}:${dayKey(at)}`;
    if (!slots.some((s) => s.id === id)) slots.push({ kind: "cost", id, vehicleId, sortAt: dayEnd(at) });
    return id;
  };
  for (const f of fuelLogs) if (!hasRows.has(f.vehicleId)) costSlot(f.vehicleId, f.date);
  for (const e of expenses) { const vid = expVehicle(e); if (vid && !hasRows.has(vid)) costSlot(vid, e.date); }
  slots.sort((a, b) => a.sortAt - b.sortAt);
  const slotIds = new Set(slots.map((s) => s.id));
  const byVehicle = new Map<string, Slot[]>();
  for (const s of slots) { const list = byVehicle.get(s.vehicleId) ?? []; list.push(s); byVehicle.set(s.vehicleId, list); }

  /** Yozuv qaysi qatorga: qo'lda qatori → reysi → shu mashinaning shu vaqtdan keyingi birinchi qatori (bo'lmasa oxirgisi). */
  const target = (vehicleId: string | null, tripId: string | null, entryId: string | null, at: Date): string | null => {
    if (entryId && slotIds.has(entryId)) return entryId;
    if (tripId && slotIds.has(tripId)) return tripId;
    const list = vehicleId ? byVehicle.get(vehicleId) : undefined;
    if (!list?.length) return null;
    return (list.find((s) => s.sortAt >= at.getTime()) ?? list[list.length - 1]!).id;
  };
  const refuelOf = new Map<string, number>();
  const refuelSumOf = new Map<string, number>();
  const refsOf = new Map<string, LedgerRefs>();
  const refs = (id: string) => { let x = refsOf.get(id); if (!x) refsOf.set(id, (x = { fuel: [], repair: [], parts: [], vulc: [], other: [] })); return x; };
  // Qo'lda qatorning o'z zapravka/xarajati (entryId bilan) — tahrirda transporti o'zgarmaydi
  const ownCosts = new Set<string>();
  for (const f of fuelLogs) {
    const v = vById.get(f.vehicleId); if (!v || kindOfLog(f.fuelType) !== trackedOf(v.fuelType)) continue;
    const id = target(f.vehicleId, f.tripId, f.entryId, f.date); if (!id) continue;
    refuelOf.set(id, (refuelOf.get(id) ?? 0) + Number(f.liters));
    refuelSumOf.set(id, (refuelSumOf.get(id) ?? 0) + Number(f.amount));
    refs(id).fuel.push(f.id);
    if (f.entryId === id) ownCosts.add(id);
  }
  const expOf = new Map<string, { repair: number; parts: number; vulc: number; other: number; notes: string[] }>();
  for (const e of expenses) {
    const id = target(expVehicle(e), e.tripId, e.entryId, e.date); if (!id) continue;
    const x = expOf.get(id) ?? { repair: 0, parts: 0, vulc: 0, other: 0, notes: [] };
    const a = Number(e.amount);
    const cat = isVulc(e.note) ? "vulc" : e.kind === "REPAIR" ? "repair" : e.kind === "PARTS" ? "parts" : "other";
    x[cat] += a;
    refs(id)[cat].push(e.id);
    if (e.entryId === id) ownCosts.add(id);
    // Qo'lda qatorning o'z xarajati izohi qatorning o'zida bor — takrorlanmasin
    if (e.note && !e.entryId) x.notes.push(e.note);
    expOf.set(id, x);
  }

  const tripRow = new Map(base.map((r) => [r.id, r]));
  const entryRow = new Map(entries.map((e) => [e.id, e]));
  const all: LedgerRow[] = [];
  for (const s of slots) {
    const v = vById.get(s.vehicleId); if (!v) continue;
    const tracked = trackedOf(v.fuelType);
    const dual = v.fuelType === "DIESEL_METHANE";
    const e = expOf.get(s.id) ?? { repair: 0, parts: 0, vulc: 0, other: 0, notes: [] };

    // Qator turiga qarab: km, soat, haq, daromad va matnlar
    let row: Omit<LedgerRow, "unit" | "balBefore" | "refuel" | "use" | "drumUse" | "balAfter" | "useExtra" | "fuelSum" | "fuelPriceMissing" | "repair" | "parts" | "vulc" | "other" | "total" | "profit" | "refs" | "refuelPrice" | "ownCosts">;
    let use: number | null, useExtra: number | null;
    if (s.kind === "trip") {
      const r = tripRow.get(s.id)!, t = ex.get(s.id)!;
      // payTrips: fuelNorm — asosiy norma (metan m³ yoki dizel l), gasNorm — «Dizel + metan» dagi metan
      use = dual ? r.gasNorm : r.fuelNorm;
      useExtra = dual ? r.fuelNorm : null;
      const oq = orderQty.get(t.orderId);
      const fee = Number(t.order.deliveryFee ?? 0);
      const revenue = fee > 0 && oq ? (oq.qty > 0 ? (fee * Number(t.qtyM3)) / oq.qty : fee / oq.n) : 0;
      const pm = t.order.payMethod;
      const names = [...new Set(t.order.items.map((i) => i.product.name))];
      const unit = t.order.items[0]?.product.unit === "m3" ? "m³" : t.order.items[0]?.product.unit ?? "";
      const hr = r.deliveredAt.getHours();
      row = {
        kind: "trip", id: r.id, no: r.no, at: r.deliveredAt, driverId: r.driverId, driver: r.driver, vehicleId: t.vehicleId, plate: r.plate,
        pickup: t.pickupAddress?.trim() || "Zavod", dropoff: t.order.site?.name ?? r.customer, address: t.order.deliveryAddress || null,
        cargo: `${names.join(", ") || "—"} · ${fmtNum(Number(t.qtyM3), 2)} ${unit}`.trim(),
        trips: 1, km: r.km, workHours: r.workHours,
        pay: r.amount ?? r.suggested, amount: r.amount, suggestText: r.suggestText, payType: r.payType, approvedAt: r.approvedAt,
        revBank: pm === "BANK" ? revenue : 0, revCash: pm === "CASH" ? revenue : 0, revDebt: pm ? 0 : revenue, svcBank: 0, svcCash: 0, revOther: 0, revenue: r2(revenue),
        remarks: [hr >= 20 || hr < 6 ? `Tun ${String(hr).padStart(2, "0")}:${String(r.deliveredAt.getMinutes()).padStart(2, "0")}` : null, r.note, t.deliveryComment, ...e.notes].filter((x): x is string => !!x),
        src: { pickup: t.pickupAddress?.trim() || null, dropoff: null, cargo: null, note: t.deliveryComment, revenueType: null, priced: !!r.pricedAt, suggested: r.suggested },
      };
    } else if (s.kind === "entry") {
      const q = entryRow.get(s.id)!;
      const km = Number(q.km ?? 0), hours = q.drumHours != null ? Number(q.drumHours) : null;
      use = tripFuelNorm(mainNorm(v), km, hours);
      useExtra = dual ? tripFuelNorm(v, km, hours) : null;
      const rev = Number(q.revenue ?? 0), pay = Number(q.payAmount ?? 0);
      row = {
        kind: "entry", id: q.id, no: q.docNo, at: q.date, driverId: q.driverId, driver: q.driver?.fullName ?? null, vehicleId: v.id, plate: v.plate,
        pickup: q.pickup || "—", dropoff: q.dropoff || q.note, address: null, cargo: q.cargo || "—",
        trips: q.trips, km, workHours: hours,
        pay, amount: pay > 0 ? pay : null, suggestText: null, payType: q.payType, approvedAt: q.payApprovedAt,
        // Turi yozilmagan eski qator — «Obyekt» (avvalgi qoida)
        revBank: q.revenueType === "BANK" ? rev : 0, revCash: q.revenueType === "CASH" ? rev : 0, revDebt: 0,
        svcBank: q.revenueType === "SERVICE_BANK" ? rev : 0, svcCash: q.revenueType === "SERVICE_CASH" ? rev : 0,
        revOther: q.revenueType === "OBJECT" || !q.revenueType ? rev : 0, revenue: rev,
        // Izoh yozilmagan qatorda `note` = «yuklash → tushirish» (logistics-entry) — takrorlanmasin
        remarks: [q.dropoff && q.note !== [q.pickup, q.dropoff].filter(Boolean).join(" → ") ? q.note : null, ...e.notes].filter((x): x is string => !!x),
        src: { pickup: q.pickup, dropoff: q.dropoff, cargo: q.cargo, note: q.note, revenueType: q.revenueType, priced: pay > 0, suggested: null },
      };
    } else {
      const at = new Date(s.sortAt - DAY + 1000);
      use = null; useExtra = null;
      row = {
        kind: "cost", id: s.id, no: "", at, driverId: null, driver: null, vehicleId: v.id, plate: v.plate,
        pickup: "—", dropoff: "Reyssiz kun", address: null, cargo: "—", trips: 0, km: 0, workHours: null,
        pay: 0, amount: null, suggestText: null, payType: null, approvedAt: null,
        revBank: 0, revCash: 0, revDebt: 0, svcBank: 0, svcCash: 0, revOther: 0, revenue: 0, remarks: e.notes,
        src: { pickup: null, dropoff: null, cargo: null, note: null, revenueType: null, priced: false, suggested: null },
      };
    }

    const at = row.at.getTime();
    const pMain = priceAt(priceList[tracked], at), pDt = dual ? priceAt(priceList.dt, at) : null;
    const fuelSum = (use != null && pMain != null ? use * pMain : 0) + (useExtra != null && pDt != null ? useExtra * pDt : 0);
    const idle = idleOf(v);
    const drumUse = row.workHours != null && idle > 0 ? row.workHours * idle : null;
    const balBefore = balance.get(v.id) ?? 0;
    const refuel = refuelOf.get(s.id) ?? 0;
    const balAfter = balBefore + refuel - (use ?? 0);
    balance.set(v.id, balAfter);
    const total = fuelSum + row.pay + e.repair + e.parts + e.vulc + e.other;

    all.push({
      ...row,
      unit: tracked === "gas" ? "m³" : "l",
      balBefore: r1(balBefore), refuel: r1(refuel), use: use != null ? r1(use) : null, drumUse: drumUse != null ? r1(drumUse) : null, balAfter: r1(balAfter),
      useExtra: useExtra != null ? r1(useExtra) : null,
      fuelSum: r2(fuelSum), fuelPriceMissing: (use != null && pMain == null) || (useExtra != null && pDt == null),
      repair: e.repair, parts: e.parts, vulc: e.vulc, other: e.other, total: r2(total), profit: r2(row.revenue - total),
      refs: refsOf.get(s.id) ?? { fuel: [], repair: [], parts: [], vulc: [], other: [] },
      refuelPrice: refuel > 0 ? r2((refuelSumOf.get(s.id) ?? 0) / refuel) : null, ownCosts: ownCosts.has(s.id),
    });
  }

  const rows = opts.driverId ? all.filter((r) => r.driverId === opts.driverId) : all;
  return { rows, total: ledgerTotals(rows) };
}

/** Qatorlar jami (mashina varag'i yoki hammasi uchun). */
export function ledgerTotals(rows: LedgerRow[]): LedgerTotals {
  const total: LedgerTotals = {
    rows: rows.length, trips: 0, km: 0, hours: 0, useGas: 0, useDt: 0, drumUse: 0, refuel: 0, fuelSum: 0, pay: 0, repair: 0, parts: 0, vulc: 0, other: 0, total: 0,
    revBank: 0, revCash: 0, revDebt: 0, svcBank: 0, svcCash: 0, revOther: 0, revenue: 0, profit: 0,
  };
  for (const r of rows) {
    total.trips += r.trips; total.km += r.km; total.hours += r.workHours ?? 0; total.refuel += r.refuel; total.fuelSum += r.fuelSum; total.drumUse += r.drumUse ?? 0;
    if (r.unit === "m³") total.useGas += r.use ?? 0; else total.useDt += r.use ?? 0;
    total.useDt += r.useExtra ?? 0;
    total.pay += r.pay; total.repair += r.repair; total.parts += r.parts; total.vulc += r.vulc; total.other += r.other; total.total += r.total;
    total.revBank += r.revBank; total.revCash += r.revCash; total.revDebt += r.revDebt; total.svcBank += r.svcBank; total.svcCash += r.svcCash;
    total.revOther += r.revOther; total.revenue += r.revenue; total.profit += r.profit;
  }
  return total;
}

/** Varaq ostidagi jamlanma (Excel'dagi ISMI / OYLIK / NAXT): haydovchi bo'yicha haq — oylik, naqd va hali narxsiz (taklif). */
export type DriverPaySum = { driverId: string; driver: string; payroll: number; cash: number; suggested: number; total: number };

export function driverPaySums(rows: LedgerRow[]): DriverPaySum[] {
  const out = new Map<string, DriverPaySum>();
  for (const r of rows) {
    if (!r.driverId || r.pay <= 0) continue;
    const d = out.get(r.driverId) ?? { driverId: r.driverId, driver: r.driver ?? "—", payroll: 0, cash: 0, suggested: 0, total: 0 };
    if (r.amount == null) d.suggested += r.pay; else if (r.payType === "CASH") d.cash += r.pay; else d.payroll += r.pay;
    d.total += r.pay;
    out.set(r.driverId, d);
  }
  return [...out.values()].sort((a, b) => b.total - a.total);
}

/** Transport bo'yicha yoqilg'i qoldig'i davrda: oy boshidagi, zapravka, norma sarfi, oxirgi qatordan keyingi. */
export type FuelBalance = { vehicleId: string; plate: string; unit: string; drivers: string[]; trips: number; opening: number; refuel: number; use: number; closing: number };

/** `driverLedger` qatorlaridan (filtrsiz — qoldiq butun mashina bo'yicha) transport kesimi. */
export function fuelBalances(rows: LedgerRow[]): FuelBalance[] {
  const out = new Map<string, FuelBalance>();
  for (const r of rows) {
    let b = out.get(r.vehicleId);
    if (!b) { b = { vehicleId: r.vehicleId, plate: r.plate, unit: r.unit, drivers: [], trips: 0, opening: r.balBefore, refuel: 0, use: 0, closing: r.balBefore }; out.set(r.vehicleId, b); }
    b.trips += r.trips; b.refuel = r1(b.refuel + r.refuel); b.use = r1(b.use + (r.use ?? 0)); b.closing = r.balAfter;
    if (r.driver && !b.drivers.includes(r.driver)) b.drivers.push(r.driver);
  }
  return [...out.values()].sort((a, b) => a.plate.localeCompare(b.plate));
}
