import { db } from "./db";
import { productionCapacity } from "./production-capacity";
import { dayRange, orderLogistics, parseDay } from "./logistics";
import { fmtUnitTotals, unitLabel, unitTotals, type UnitRow } from "./unit";
import { fmtNum } from "./format";

/**
 * "ERP — Sklad & Logistika Dashboard" (Mexanik bosh sahifasi):
 *   1. Bugungi nazorat — zayavka, mahsulot hajmi, jo'natilgan, qolgan, muammoli/kechikkan
 *   2. Ertangi kun — zayavka, kerak bo'ladigan mahsulot, skladda mavjud, yetishmaydi, transport ehtiyoji
 *   3. Mahsulot bo'yicha — bugun | ertaga | skladda | holat
 *   4. Avtomatik ogohlantirish — "Ertaga M150 — 500 kerak. Skladda — 320. Yetishmaydi — 180."
 *   5. Ish jarayoni — Zayavka → Qoldiq → Ehtiyoj → Transport → Jo'natish → Yetkazish
 *
 * "Skladda" qanday hisoblanadi:
 *   · dona mahsulot (hovlida turadi) — StockMove qoldig'i;
 *   · beton (m³) oldindan tayyorlanmaydi — xomashyo qoldig'i bilan retsept bo'yicha qancha chiqishi
 *     (`productionCapacity`) + zames qilingan, hali jo'natilmagani.
 * Ertangi holat bugungi jo'natilmagan qismni ayirib hisoblanadi: bugun ketadigan mol ertaga skladda bo'lmaydi.
 * Hamma raqam shu yerda — veb (`mechanic-home.tsx`) ham, ECO ilova dashboardi ham shu funksiyani chaqiradi.
 */

export const MECHANIC_HOME_ROLES = ["MECHANIC"] as const;

/** Mikser sig'imi kiritilmagan bo'lsa — bir reysga shuncha m³ deb olinadi. */
const DEFAULT_MIXER_M3 = 8;
const EPS = 0.001;
/** Yuklangandan keyin mol skladdan chiqqan hisoblanadi (SHIPMENT — LOADED bosqichida). */
const SHIPPED = ["LOADED", "ON_ROAD", "DELIVERED"];
const OPEN_ORDER = ["CONFIRMED", "IN_PRODUCTION"] as const;

export type SlTone = "danger" | "warning" | "info" | "success";
export type SlAlert = { key: string; tone: SlTone; title: string; text: string; href: string };

export type SlProduct = {
  id: string; code: string; name: string; unit: string; stocked: boolean;
  today: number; todayLeft: number; tomorrow: number;
  /** Hozir skladda (beton — xomashyodan chiqadigani bilan). */
  onHand: number;
  /** Bugungi qolgan jo'natishdan keyin ertaga uchun qoladigani. */
  forTomorrow: number;
  /** forTomorrow − ertaga; manfiy — yetishmaydi. */
  balance: number;
  /** Dona mahsulot: xomashyo qoldig'i bilan yana qancha ishlab chiqarish mumkin. */
  canMake: number | null;
};

export type SlOrder = {
  id: string; orderNo: string; customer: string; time: string | null; products: string;
  total: number; shipped: number; unit: string | null; statusLabel: string;
  late: boolean; problem: boolean; blocked: boolean; done: boolean;
};

export type SlStage = { key: string; label: string; count: number; hint: string };

export type SkladLogistika = {
  day: Date; next: Date; isToday: boolean;
  today: {
    orders: number; drafts: number; volume: string; shipped: number; left: number; problem: number;
    shippedVolume: string; leftVolume: string; overdue: number;
  };
  tomorrow: {
    orders: number; drafts: number; need: string; available: string; short: string; shortCount: number;
    trips: number; mixerTrips: number; truckTrips: number; pumps: number; assigned: number;
    vehicles: { mixer: number; truck: number; pump: number; repair: number };
  };
  products: SlProduct[];
  alerts: SlAlert[];
  flow: SlStage[];
  orders: SlOrder[];
};

const joinHint = (...p: (string | number | false | null | undefined)[]) => p.filter(Boolean).join(" · ");
const q = (v: number) => fmtNum(v, 2);
const inUnit = (v: number, unit: string) => `${q(v)} ${unitLabel(unit)}`;

type LoadedOrder = Awaited<ReturnType<typeof loadOrders>>[number];

function loadOrders(where: object) {
  return db.order.findMany({
    where,
    orderBy: [{ deliveryDate: "asc" }, { deliveryTime: "asc" }],
    include: {
      customer: { select: { name: true } },
      items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } } },
      trips: { select: { status: true, qtyM3: true, plannedAt: true, deliveredAt: true, closedAt: true, issues: { select: { resolvedAt: true } } } },
    },
  });
}

/**
 * Reys miqdori zayavka qatorlariga ulush bo'yicha taqsimlanadi (reysda mahsulot ko'rsatilmaydi —
 * bitta mahsulotli zayavkada aynan o'sha qatorga tushadi).
 */
function itemSplit(o: LoadedOrder) {
  const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const shipped = o.trips.filter((t) => SHIPPED.includes(t.status)).reduce((s, t) => s + Number(t.qtyM3), 0);
  const done = o.status === "DELIVERED" || o.status === "CLOSED" || (total > 0 && shipped >= total - EPS);
  return {
    total, shipped: Math.min(shipped, total), done,
    items: o.items.map((i) => {
      const need = Number(i.qtyM3);
      const sent = done ? need : total > 0 ? Math.min(need, shipped * (need / total)) : 0;
      const left = Math.max(0, need - sent);
      // Dona mahsulot bo'linmaydi — ulushdan chiqqan kasr yuqoriga yaxlitlanadi
      return { product: i.product, need, left: i.product.unit === "m3" ? left : Math.ceil(left - EPS) };
    }),
  };
}

/**
 * `range` — kun o'rniga davr (mobil dashboard filtri: hafta / oy / yil): "bugun" o'rnida shu davr,
 * "ertaga" o'rnida keyingi teng davr. Berilmasa — `dayParam` kuni va ertasi.
 */
export async function skladLogistika(dayParam?: string, range?: { from: Date; to: Date }): Promise<SkladLogistika> {
  const day = parseDay(dayParam);
  const { from, to } = range ?? dayRange(day);
  const next = to;
  const afterNext = range ? new Date(to.getTime() + (to.getTime() - from.getTime())) : dayRange(next).to;
  const now = new Date();
  const isToday = !range && dayRange(now).from.getTime() === from.getTime();

  // Qoralama va bloklangan ham kiradi: sklad ertangi ehtiyojni tasdiqdan oldin bilishi kerak (hisobda belgi bilan)
  const live = { status: { not: "CANCELLED" as const } };
  const [todayOrders, tomorrowOrders, overdueOrders, prodSums, capacity, vehicles, assignedTrips] = await Promise.all([
    loadOrders({ deliveryDate: { gte: from, lt: to }, ...live }),
    loadOrders({ deliveryDate: { gte: next, lt: afterNext }, ...live }),
    // Oldingi kunlardan qolib ketgan: sanasi o'tgan, hali to'liq jo'natilmagan
    loadOrders({ deliveryDate: { lt: from }, status: { in: [...OPEN_ORDER] } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    productionCapacity(),
    db.vehicle.findMany({ where: { isActive: true }, select: { type: true, status: true, capacityM3: true } }),
    db.trip.count({ where: { status: { not: "CANCELLED" }, order: { deliveryDate: { gte: next, lt: afterNext } } } }),
  ]);

  const stock = new Map(prodSums.map((x) => [x.productId!, Number(x._sum.qty ?? 0)]));
  const make = new Map(capacity.map((c) => [c.productId, c.canMake]));

  // ── Mahsulot bo'yicha ──
  type Acc = { product: LoadedOrder["items"][number]["product"]; today: number; todayLeft: number; tomorrow: number };
  const acc = new Map<string, Acc>();
  const row = (p: Acc["product"]) => {
    let a = acc.get(p.id);
    if (!a) { a = { product: p, today: 0, todayLeft: 0, tomorrow: 0 }; acc.set(p.id, a); }
    return a;
  };
  const todaySplit = todayOrders.map((o) => ({ o, s: itemSplit(o) }));
  for (const { s } of todaySplit) {
    for (const i of s.items) { const a = row(i.product); a.today += i.need; a.todayLeft += i.left; }
  }
  // Kechikkan (oldingi kun) zayavkalarning qolgani ham bugun jo'natilishi kerak
  for (const o of overdueOrders) for (const i of itemSplit(o).items) row(i.product).todayLeft += i.left;
  for (const o of tomorrowOrders) for (const i of o.items) row(i.product).tomorrow += Number(i.qtyM3);

  const products: SlProduct[] = [...acc.values()].map((a) => {
    const stocked = a.product.unit !== "m3";
    const inStock = Math.max(0, stock.get(a.product.id) ?? 0);
    const canMake = make.get(a.product.id) ?? null;
    // Beton: tayyor turgani + xomashyodan chiqadigani; dona: hovlidagi qoldiq
    const onHand = stocked ? inStock : inStock + (canMake ?? 0);
    const forTomorrow = Math.max(0, onHand - a.todayLeft);
    return {
      id: a.product.id, code: a.product.code, name: a.product.name, unit: a.product.unit, stocked,
      today: a.today, todayLeft: a.todayLeft, tomorrow: a.tomorrow,
      onHand, forTomorrow, balance: forTomorrow - a.tomorrow,
      canMake: stocked ? canMake : null,
    };
  }).sort((a, b) => a.balance - b.balance || b.tomorrow - a.tomorrow || a.code.localeCompare(b.code));

  // ── Bugungi zayavkalar ──
  const orders: SlOrder[] = [...todaySplit, ...overdueOrders.map((o) => ({ o, s: itemSplit(o) }))].map(({ o, s }) => {
    const logi = orderLogistics(o, now);
    const units = unitTotals(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));
    const overdue = o.deliveryDate < from;
    return {
      id: o.id, orderNo: o.orderNo, customer: o.customer.name,
      time: overdue ? `${String(o.deliveryDate.getDate()).padStart(2, "0")}.${String(o.deliveryDate.getMonth() + 1).padStart(2, "0")}` : o.deliveryTime,
      products: o.items.map((i) => i.product.code).join(", "),
      total: s.total, shipped: s.shipped, unit: units.length === 1 ? units[0]!.unit : null,
      statusLabel: overdue ? "Muddati o'tgan" : o.status === "BLOCKED" ? "Bloklangan" : o.status === "DRAFT" ? "Tasdiqlanmagan" : s.done ? "Jo'natildi" : logi.status === "ON_ROAD" ? "Yo'lda" : logi.status === "LOADING" ? "Yuklanmoqda" : logi.status === "ASSIGNED" ? "Transport biriktirilgan" : "Kutilmoqda",
      late: !s.done && (overdue || logi.late), problem: logi.problem, blocked: o.status === "BLOCKED", done: s.done,
    };
  }).sort((a, b) => Number(a.done) - Number(b.done) || Number(b.late || b.blocked || b.problem) - Number(a.late || a.blocked || a.problem));

  const todayIds = new Set(todayOrders.map((o) => o.id));
  const todayRows = orders.filter((o) => todayIds.has(o.id));
  const shippedCount = todayRows.filter((o) => o.done).length;
  const problemCount = orders.filter((o) => !o.done && (o.late || o.blocked || o.problem)).length;
  const volumeRows = (pick: (s: ReturnType<typeof itemSplit>["items"][number]) => number): UnitRow[] =>
    todaySplit.flatMap(({ s }) => s.items.map((i) => ({ unit: i.product.unit, qty: pick(i) })));

  // ── Ertangi kun ──
  const tomorrowNeed = products.filter((p) => p.tomorrow > 0);
  const shortProducts = tomorrowNeed.filter((p) => p.balance < -EPS);
  const mixers = vehicles.filter((v) => v.type === "MIXER");
  const caps = mixers.map((v) => Number(v.capacityM3 ?? 0)).filter((c) => c > 0);
  const mixerCap = caps.length ? caps.reduce((s, c) => s + c, 0) / caps.length : DEFAULT_MIXER_M3;
  let mixerTrips = 0, truckTrips = 0, pumps = 0;
  for (const o of tomorrowOrders) {
    if (o.needsPump) pumps++;
    if (!o.needsDelivery) continue; // mijoz o'zi olib ketadi
    const m3 = o.items.filter((i) => i.product.unit === "m3").reduce((s, i) => s + Number(i.qtyM3), 0);
    if (m3 > 0) mixerTrips += Math.ceil(m3 / mixerCap - EPS);
    // Dona mahsulot — zayavka boshiga bitta yuk mashina qatnovi (yuk sig'imi dona bilan kiritilmagan)
    if (o.items.some((i) => i.product.unit !== "m3")) truckTrips++;
  }
  const ready = (t: string) => vehicles.filter((v) => v.type === t && v.status === "ACTIVE").length;
  const fleet = { mixer: ready("MIXER"), truck: ready("TRUCK"), pump: ready("PUMP"), repair: vehicles.filter((v) => v.status === "REPAIR").length };

  // ── Avtomatik ogohlantirishlar ──
  const alerts: SlAlert[] = [];
  const dayWord = range ? "Keyingi davrda" : isToday ? "Ertaga" : "Keyingi kun";
  for (const p of shortProducts) {
    alerts.push({
      key: `short:${p.id}`, tone: "danger", href: `/stock/products/${p.id}`,
      title: `${dayWord} ${p.code} — ${inUnit(p.tomorrow, p.unit)} kerak`,
      text: `Skladda — ${inUnit(p.forTomorrow, p.unit)}${p.todayLeft > EPS ? " (bugungi jo'natishdan keyin)" : ""}. Yetishmaydi — ${inUnit(-p.balance, p.unit)}.${p.canMake ? ` Xomashyodan yana ${inUnit(p.canMake, p.unit)} chiqadi.` : ""}`,
    });
  }
  for (const p of products.filter((x) => x.todayLeft > EPS && x.onHand < x.todayLeft - EPS)) {
    alerts.push({
      key: `today:${p.id}`, tone: "danger", href: `/stock/products/${p.id}`,
      title: `${range ? "Shu davrda" : "Bugun"} ${p.code} yetmaydi`,
      text: `Jo'natilishi kerak — ${inUnit(p.todayLeft, p.unit)}, skladda — ${inUnit(p.onHand, p.unit)}. Yetishmaydi — ${inUnit(p.todayLeft - p.onHand, p.unit)}.`,
    });
  }
  const lateOrders = orders.filter((o) => o.late && !o.done);
  if (lateOrders.length) alerts.push({ key: "late", tone: "warning", href: "/trips", title: `${lateOrders.length} ta zayavka kechikmoqda`, text: lateOrders.slice(0, 5).map((o) => o.orderNo).join(", ") });
  const blocked = orders.filter((o) => o.blocked);
  if (blocked.length) alerts.push({ key: "blocked", tone: "warning", href: "/trips", title: `${blocked.length} ta zayavka bloklangan`, text: "Kredit limit — direktor ochmaguncha jo'natilmaydi" });
  const problems = orders.filter((o) => o.problem && !o.done);
  if (problems.length) alerts.push({ key: "issues", tone: "warning", href: "/trips", title: `${problems.length} ta zayavkada reys muammosi`, text: problems.slice(0, 5).map((o) => o.orderNo).join(", ") });
  if (mixerTrips > 0 && fleet.mixer === 0) alerts.push({ key: "no-mixer", tone: "danger", href: "/logistika/transport", title: `${dayWord} ${mixerTrips} ta mikser reysi kerak`, text: "Saflda mikser yo'q — ta'mirdagi texnikani tekshiring" });
  if (truckTrips > 0 && fleet.truck === 0) alerts.push({ key: "no-truck", tone: "warning", href: "/logistika/transport", title: `${dayWord} ${truckTrips} ta yuk mashina qatnovi kerak`, text: "Saflda yuk mashina yo'q" });
  if (pumps > fleet.pump) alerts.push({ key: "pump", tone: "warning", href: "/logistika/transport", title: `${dayWord} ${pumps} ta zayavkaga nasos kerak`, text: `Saflda ${fleet.pump} ta nasos` });

  // ── Ish jarayoni (bugun) ──
  const active = todaySplit;
  const covered = active.filter(({ s }) => s.items.every((i) => {
    const p = products.find((x) => x.id === i.product.id);
    return !p || p.onHand >= p.todayLeft - EPS;
  })).length;
  const withTransport = active.filter(({ o, s }) => s.done || o.trips.some((t) => t.status !== "CANCELLED")).length;
  const sent = active.filter(({ o, s }) => s.done || o.trips.some((t) => SHIPPED.includes(t.status))).length;
  const delivered = active.filter(({ o, s }) => s.done && (o.trips.every((t) => t.status === "DELIVERED" || t.status === "CANCELLED"))).length;
  const needProduct = active.length - covered;
  const draftToday = todayOrders.filter((o) => o.status === "DRAFT").length;
  const flow: SlStage[] = [
    { key: "orders", label: "Zayavka", count: todayOrders.length, hint: joinHint(blocked.length && `${blocked.length} bloklangan`, draftToday && `${draftToday} tasdiqlanmagan`) || "bugungi" },
    { key: "stock", label: "Skladdagi qoldiq", count: covered, hint: "qoldig'i yetadi" },
    { key: "need", label: "Mahsulot ehtiyoji", count: needProduct, hint: needProduct ? "yetishmaydi" : "ehtiyoj yo'q" },
    { key: "transport", label: "Transport", count: withTransport, hint: "mashina biriktirilgan" },
    { key: "ship", label: "Jo'natish", count: sent, hint: "yuklangan / yo'lda" },
    { key: "done", label: "Yetkazildi", count: delivered, hint: "to'liq" },
  ];

  const byUnit = (list: SlProduct[], v: (p: SlProduct) => number) => fmtUnitTotals(list.map((p) => ({ unit: p.unit, qty: v(p) })));
  return {
    day: from, next, isToday,
    today: {
      orders: todayOrders.length,
      drafts: todayOrders.filter((o) => o.status === "DRAFT" || o.status === "BLOCKED").length,
      volume: fmtUnitTotals(volumeRows((i) => i.need)),
      shipped: shippedCount,
      left: todayRows.length - shippedCount,
      problem: problemCount,
      shippedVolume: fmtUnitTotals(volumeRows((i) => i.need - i.left)),
      leftVolume: fmtUnitTotals(volumeRows((i) => i.left)),
      overdue: overdueOrders.length,
    },
    tomorrow: {
      orders: tomorrowOrders.length,
      drafts: tomorrowOrders.filter((o) => o.status === "DRAFT" || o.status === "BLOCKED").length,
      need: byUnit(tomorrowNeed, (p) => p.tomorrow),
      available: byUnit(tomorrowNeed, (p) => Math.min(p.forTomorrow, p.tomorrow)),
      short: shortProducts.length ? byUnit(shortProducts, (p) => -p.balance) : "0",
      shortCount: shortProducts.length,
      trips: mixerTrips + truckTrips, mixerTrips, truckTrips, pumps, assigned: assignedTrips,
      vehicles: fleet,
    },
    products, alerts, flow, orders,
  };
}
