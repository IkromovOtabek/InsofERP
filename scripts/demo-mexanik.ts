/**
 * Mexanik kabineti uchun sun'iy ma'lumot (lokal sinov):
 *  - 5 ta transport (2 mikser, nasos — ta'mirda, 2 bort yuk mashina), hujjat muddati yaqin/o'tgani bilan;
 *  - oxirgi 35 kun: yetkazilgan reyslar (beton — mikserda, dona — bort mashinada), dastavka haqi, zapravka,
 *    ta'mir/zapchast/yuvish/jarima xarajatlari, texnik xizmat jurnali (biri muddati o'tgan, biri yaqin);
 *  - bugungi zayavkalar (m³, dona, aralash): biri yetkazilgan, biri yo'lda, biri yuklangan, qolgani kutilmoqda;
 *    kechagi jo'natilmagan (kechikkan) va ertangi zayavkalar;
 *  - mexanik so'rovlari (yangi/tasdiqlangan/rad) va snabjenetsga «Texnika» zayavkalari.
 *
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-mexanik.ts            → avvalgisini o'chirib, qaytadan yaratadi
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-mexanik.ts --remove   → faqat o'chiradi
 *
 * Har yozuv `[demo-mexanik]` belgisi bilan (izoh / transport izohi) — o'chirish shu bo'yicha. Sklad harakati yozilmaydi.
 */
import { PrismaClient, Prisma } from "../src/generated/prisma";
import { guardDemo } from "./demo-guard";

guardDemo("scripts/demo-mexanik.ts");
const db = new PrismaClient();
const TAG = "[demo-mexanik]";

let seed = 20261029;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
const D = (n: number, f = 2) => new Prisma.Decimal(n.toFixed(f));
const dayAt = (offset: number, h = 0, m = 0) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset, h, m); };

async function remove() {
  const vIds = (await db.vehicle.findMany({ where: { note: TAG }, select: { id: true } })).map((v) => v.id);
  const oIds = (await db.order.findMany({ where: { note: { startsWith: TAG } }, select: { id: true } })).map((o) => o.id);
  const tIds = (await db.trip.findMany({ where: { OR: [{ orderId: { in: oIds } }, { vehicleId: { in: vIds } }] }, select: { id: true } })).map((t) => t.id);
  const r = await db.$transaction([
    db.fuelLog.deleteMany({ where: { OR: [{ note: TAG }, { tripId: { in: tIds } }, { vehicleId: { in: vIds } }] } }),
    db.transportExpense.deleteMany({ where: { OR: [{ note: { startsWith: TAG } }, { tripId: { in: tIds } }, { vehicleId: { in: vIds } }] } }),
    db.mechanicRequest.deleteMany({ where: { OR: [{ note: { startsWith: TAG } }, { vehicleId: { in: vIds } }] } }),
    db.supplyRequest.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.vehicleService.deleteMany({ where: { vehicleId: { in: vIds } } }),
    db.trip.deleteMany({ where: { id: { in: tIds } } }),
    db.order.deleteMany({ where: { id: { in: oIds } } }),
    db.vehicle.deleteMany({ where: { id: { in: vIds } } }),
  ]);
  console.log(`O'chirildi: zapravka ${r[0].count}, xarajat ${r[1].count}, mexanik so'rovi ${r[2].count}, ta'minot ${r[3].count}, xizmat ${r[4].count}, reys ${r[5].count}, zayavka ${r[6].count}, transport ${r[7].count}`);
}

async function main() {
  await remove();
  if (process.argv.includes("--remove")) return;

  const [mexanik, sotuv, warehouse] = await Promise.all([
    db.user.findFirst({ where: { role: "MECHANIC", isActive: true }, orderBy: { createdAt: "asc" } }).then((u) => u ?? db.user.findFirstOrThrow({ where: { role: "DIRECTOR" } })),
    db.user.findFirst({ where: { role: "SALES", isActive: true }, orderBy: { createdAt: "asc" } }).then((u) => u ?? db.user.findFirstOrThrow({ where: { role: "DIRECTOR" } })),
    db.warehouse.findFirstOrThrow({ orderBy: { name: "asc" } }),
  ]);
  const drivers = await db.employee.findMany({ where: { isActive: true, position: { contains: "aydovchi" } }, orderBy: { fullName: "asc" }, take: 5 });
  if (drivers.length < 2) throw new Error("Kamida 2 ta haydovchi xodim kerak (lavozimi «Haydovchi»)");
  const customers = await db.customer.findMany({ where: { isInternal: false, isActive: true }, take: 8, orderBy: { name: "asc" } });
  const concrete = await db.product.findMany({ where: { isActive: true, unit: "m3", code: { startsWith: "M" }, price: { gt: 0 } }, orderBy: { code: "asc" } });
  const pieces = await db.product.findMany({ where: { isActive: true, unit: "dona", code: { in: ["FBS12", "FBS24", "KS10", "BR100", "USTUN", "2PB17", "PK60"] } } });
  if (!customers.length || !concrete.length || !pieces.length) throw new Error("Mijoz, beton (M200…) va dona mahsulot (FBS, KS, BR…) kerak");

  const inDays = (n: number) => dayAt(n, 12);
  const mixerD = await db.vehicle.create({ data: { plate: "01M601MX", type: "MIXER", capacityM3: 10, brand: "Howo", model: "A7", year: 2021, fuelType: "DIESEL", fuelNormL100: 38, idleNormPerHour: 3, odometerKm: 112400, hasGps: true, inspectionUntil: inDays(12), insuranceUntil: inDays(140), note: TAG } });
  const mixerG = await db.vehicle.create({ data: { plate: "01M602MX", type: "MIXER", capacityM3: 9, brand: "Shacman", model: "X3000 CNG", year: 2023, fuelType: "METHANE", fuelNormL100: 60, idleNormPerHour: 5, odometerKm: 64800, hasGps: true, inspectionUntil: inDays(200), insuranceUntil: inDays(-3), note: TAG } });
  const pump = await db.vehicle.create({ data: { plate: "01M603MX", type: "PUMP", capacityM3: null, brand: "Putzmeister", model: "M42", year: 2019, fuelType: "DIESEL", fuelNormL100: 32, odometerKm: 58200, status: "REPAIR", statusNote: "Gidronasos sizib chiqyapti — zapchast kutilmoqda", statusSince: dayAt(-2, 9), note: TAG } });
  const truckBig = await db.vehicle.create({ data: { plate: "01M604MX", type: "TRUCK", capacityM3: 20, capacityUnit: "TON", brand: "Kamaz", model: "65117 bort", year: 2020, fuelType: "DIESEL", fuelNormL100: 34, odometerKm: 201300, hasGps: false, inspectionUntil: inDays(25), note: TAG } });
  const truckSmall = await db.vehicle.create({ data: { plate: "01M605MX", type: "TRUCK", capacityM3: 10, capacityUnit: "TON", brand: "Isuzu", model: "NQR bort", year: 2022, fuelType: "DIESEL", fuelNormL100: 22, odometerKm: 87500, hasGps: false, note: TAG } });
  const fleet = [mixerD, mixerG, truckBig, truckSmall];
  const crew = new Map(fleet.map((v, i) => [v.id, drivers[i % drivers.length]!]));

  const year = new Date().getFullYear();
  const lastNo = async (p: "Z" | "N") => {
    const last = p === "Z"
      ? (await db.order.findFirst({ where: { orderNo: { startsWith: `Z-${year}-` } }, orderBy: { orderNo: "desc" } }))?.orderNo
      : (await db.trip.findFirst({ where: { deliveryNoteNo: { startsWith: `N-${year}-` } }, orderBy: { deliveryNoteNo: "desc" } }))?.deliveryNoteNo;
    return Math.max(100, Number(last?.slice(-5) ?? 0) + 1);
  };
  let orderN = await lastNo("Z"), tripN = await lastNo("N");
  const no = (p: string, n: number) => `${p}-${year}-${String(n).padStart(5, "0")}`;
  const addr = ["Toshkent, Chilonzor 9-kvartal", "Toshkent, Sergeli 7", "Yangiyo'l, Qovunchi", "Zangiota tumani, Eshonguzar", "Toshkent, Olmazor, Qorasaroy", "Qibray tumani, Bektemir yo'li", "Toshkent, Yunusobod 14-mavze"];

  let trips = 0, fuels = 0, exps = 0, orders = 0;
  /** Zayavka + (ixtiyoriy) reyslar. `stage` — reys holati; mikser beton, bort mashina dona tashiydi. */
  async function makeOrder(o: {
    when: Date; time?: string; status: Prisma.OrderCreateInput["status"]; items: { productId: string; qty: number; price: Prisma.Decimal }[];
    fee: number; pump?: boolean; trips?: { veh: typeof mixerD; qty: number; stage: "PLANNED" | "LOADED" | "ON_ROAD" | "DELIVERED"; at: Date }[]; note: string;
  }) {
    const km = int(8, 48);
    const order = await db.order.create({ data: {
      orderNo: no("Z", orderN++), date: addMin(o.when, -24 * 60), customerId: pick(customers).id, status: o.status,
      deliveryDate: o.when, deliveryTime: o.time, deliveryAddress: pick(addr), distanceKm: D(km), distanceSource: "ROUTE",
      needsPump: !!o.pump, deliveryFee: D(o.fee), note: `${TAG} ${o.note}`, createdById: sotuv.id,
      items: { create: o.items.map((i) => ({ productId: i.productId, qtyM3: D(i.qty, 3), price: i.price })) },
    } });
    orders++;
    for (const t of o.trips ?? []) {
      const drv = crew.get(t.veh.id)!;
      const loaded = t.at, departed = addMin(loaded, int(10, 20)), arrived = addMin(departed, Math.round(km * 1.6) + int(5, 15));
      const delivered = addMin(arrived, int(25, 70));
      const gpsKm = Math.round(km * (0.95 + rnd() * 0.15) * 10) / 10;
      const done = t.stage === "DELIVERED";
      const trip = await db.trip.create({ data: {
        deliveryNoteNo: no("N", tripN++), orderId: order.id, vehicleId: t.veh.id, driverId: drv.id, qtyM3: D(t.qty, 3), status: t.stage, plannedAt: loaded,
        ...(t.stage !== "PLANNED" ? { loadedAt: loaded } : {}),
        ...(t.stage === "ON_ROAD" || done ? { departedAt: departed } : {}),
        ...(done ? { arrivedAt: arrived, deliveredAt: delivered, receiverName: "Prorab", distanceKm: gpsKm, movingSec: Math.round(km * 1.6 * 60), totalSec: Math.round((delivered.getTime() - departed.getTime()) / 1000), summaryAt: delivered, workHours: t.veh.type === "MIXER" ? D((delivered.getTime() - loaded.getTime()) / 3_600_000, 1) : undefined, payAmount: D(Math.round((60_000 + gpsKm * 2 * 1_500) / 5000) * 5000), ecoStatus: "COMPLETED" } : {}),
        note: TAG,
      } });
      trips++;
      if (done && rnd() < 0.35) {
        const gas = t.veh.fuelType === "METHANE";
        const liters = gas ? int(110, 190) : int(50, 120), price = gas ? 3_600 : 10_800;
        await db.fuelLog.create({ data: { date: addMin(loaded, -40), vehicleId: t.veh.id, driverId: drv.id, tripId: trip.id, fuelType: gas ? "METHANE" : "DIESEL", liters: D(liters), pricePerL: D(price), amount: D(liters * price), station: gas ? "Metan AGZS №3" : "UzGasOil №12", note: TAG, createdById: mexanik.id } });
        fuels++;
      }
      if (done && rnd() < 0.12) {
        await db.transportExpense.create({ data: { date: delivered, kind: pick(["ROAD", "WASH", "PARKING"] as const), vehicleId: t.veh.id, driverId: drv.id, tripId: trip.id, amount: D(pick([20_000, 30_000, 50_000])), note: `${TAG} reys`, createdById: mexanik.id } });
        exps++;
      }
    }
    return order;
  }
  const beton = () => pick(concrete);
  const dona = () => pick(pieces);
  const pieceQty = (code: string) => (code.startsWith("FBS") || code.startsWith("PK") ? int(12, 30) : code === "KS10" ? int(8, 20) : int(40, 120));

  // ── Oxirgi 35 kun: yetkazilgan reyslar ──
  for (let d = -35; d <= -1; d++) {
    if (dayAt(d).getDay() === 0) continue;
    for (const veh of fleet) {
      const n = veh.type === "MIXER" ? int(0, 3) : int(0, 2);
      let clock = dayAt(d, int(7, 9), pick([0, 15, 30, 45]));
      for (let k = 0; k < n; k++) {
        if (veh.type === "MIXER") {
          const cap = Number(veh.capacityM3 ?? 8), qty = pick([cap, cap, cap - 2, cap * 2]);
          const p = beton(), parts = Math.ceil(qty / cap - 1e-9);
          await makeOrder({ when: clock, status: "CLOSED", items: [{ productId: p.id, qty, price: p.price }], fee: pick([650_000, 900_000, 1_300_000, 1_950_000]), note: "beton",
            trips: Array.from({ length: parts }, (_, i) => ({ veh, qty: Math.min(cap, qty - i * cap), stage: "DELIVERED" as const, at: addMin(clock, i * 95) })) });
          clock = addMin(clock, parts * 95 + int(20, 60));
        } else {
          const p = dona(), q = pieceQty(p.code);
          await makeOrder({ when: clock, status: "CLOSED", items: [{ productId: p.id, qty: q, price: p.price }], fee: pick([400_000, 550_000, 800_000, 1_200_000]), note: "dona", trips: [{ veh, qty: q, stage: "DELIVERED", at: clock }] });
          clock = addMin(clock, int(150, 240));
        }
        if (clock.getHours() >= 19) break;
      }
    }
  }

  // ── Kecha: jo'natilmay qolgan (kechikkan) zayavka ──
  { const p = dona(); await makeOrder({ when: dayAt(-1), time: "15:00", status: "CONFIRMED", items: [{ productId: p.id, qty: pieceQty(p.code), price: p.price }], fee: 600_000, note: "kechikkan dona" }); }

  // ── Bugun ──
  const b1 = beton(), b2 = beton(), b3 = beton(), d1 = dona(), d2 = dona(), d3 = dona();
  await makeOrder({ when: dayAt(0), time: "08:00", status: "IN_PRODUCTION", items: [{ productId: b1.id, qty: 20, price: b1.price }], fee: 1_950_000, note: "bugun beton",
    trips: [{ veh: mixerD, qty: 10, stage: "DELIVERED", at: dayAt(0, 7, 40) }, { veh: mixerG, qty: 9, stage: "ON_ROAD", at: dayAt(0, 9, 20) }] });
  await makeOrder({ when: dayAt(0), time: "10:30", status: "CONFIRMED", items: [{ productId: b2.id, qty: 16, price: b2.price }], fee: 1_300_000, pump: true, note: "bugun beton nasos",
    trips: [{ veh: mixerD, qty: 10, stage: "LOADED", at: dayAt(0, 10, 0) }] });
  await makeOrder({ when: dayAt(0), time: "14:00", status: "CONFIRMED", items: [{ productId: b3.id, qty: 12.5, price: b3.price }], fee: 900_000, note: "bugun beton" });
  await makeOrder({ when: dayAt(0), time: "09:00", status: "CONFIRMED", items: [{ productId: d1.id, qty: pieceQty(d1.code), price: d1.price }], fee: 800_000, note: "bugun dona",
    trips: [{ veh: truckBig, qty: pieceQty(d1.code), stage: "PLANNED", at: dayAt(0, 11, 0) }] });
  await makeOrder({ when: dayAt(0), time: "13:00", status: "CONFIRMED", items: [{ productId: d2.id, qty: pieceQty(d2.code), price: d2.price }, { productId: d3.id, qty: pieceQty(d3.code), price: d3.price }], fee: 1_100_000, note: "bugun dona aralash" });
  await makeOrder({ when: dayAt(0), time: "16:00", status: "DRAFT", items: [{ productId: b1.id, qty: 6, price: b1.price }, { productId: d1.id, qty: 40, price: d1.price }], fee: 700_000, note: "bugun aralash (tasdiqlanmagan)" });

  // ── Ertaga ──
  for (const [t, kind] of [["08:00", "m3"], ["11:00", "m3"], ["10:00", "dona"]] as const) {
    const p = kind === "m3" ? beton() : dona();
    await makeOrder({ when: dayAt(1), time: t, status: "CONFIRMED", items: [{ productId: p.id, qty: kind === "m3" ? pick([18, 24, 30]) : pieceQty(p.code), price: p.price }], fee: 1_000_000, note: `ertaga ${kind}` });
  }

  // ── Katta xarajatlar (reysga bog'lanmagan) va texnik xizmat ──
  const big = [
    { d: -30, veh: mixerD, kind: "PARTS" as const, amount: 2_400_000, note: "Zapchast: yoqilg'i filtri, remen" },
    { d: -21, veh: mixerG, kind: "REPAIR" as const, amount: 1_200_000, note: "Usta: baraban podshipnigi" },
    { d: -14, veh: truckBig, kind: "PARTS" as const, amount: 3_100_000, note: "Shina 2 dona" },
    { d: -9, veh: truckSmall, kind: "FINE" as const, amount: 375_000, note: "Tezlik jarimasi" },
    { d: -6, veh: mixerD, kind: "REPAIR" as const, amount: 850_000, note: "Usta: gidravlika shlangi" },
    { d: -2, veh: pump, kind: "PARTS" as const, amount: 4_600_000, note: "Gidronasos zichlagichlari" },
    { d: -1, veh: mixerG, kind: "WASH" as const, amount: 80_000, note: "Yuvish" },
  ];
  for (const b of big) {
    await db.transportExpense.create({ data: { date: dayAt(b.d, 9), kind: b.kind, vehicleId: b.veh.id, amount: D(b.amount), note: `${TAG} ${b.note}`, createdById: mexanik.id } });
    exps++;
  }
  const services = [
    { veh: mixerD, d: -40, kind: "Moy almashtirish", km: 104_400, cost: 1_150_000, nextKm: 112_900, note: "Motor moyi 15W-40, filtr" },
    { veh: mixerG, d: -25, kind: "Filtrlar", km: 61_200, cost: 420_000, nextAt: dayAt(5, 9), note: "Havo va gaz filtri" },
    { veh: truckBig, d: -75, kind: "Texnik ko'rik", km: 196_000, cost: 300_000, nextAt: dayAt(-4, 9), note: "Davriy ko'rik" },
    { veh: truckSmall, d: -12, kind: "Tormoz tizimi", km: 86_900, cost: 950_000, nextKm: 96_900, note: "Old kolodkalar" },
    { veh: pump, d: -2, kind: "Ta'mir", km: 58_200, cost: null, note: "Gidronasos — ta'mirga qo'yildi" },
  ];
  for (const s of services) {
    await db.vehicleService.create({ data: { vehicleId: s.veh.id, date: dayAt(s.d, 10), kind: s.kind, odometerKm: s.km, cost: s.cost != null ? D(s.cost) : null, nextDueAt: s.nextAt, nextDueKm: s.nextKm, note: s.note, createdById: mexanik.id } });
  }

  // ── Mexanik so'rovlari (pul) va snabjenetsga «Texnika» zayavkalari ──
  const lastMx = (await db.mechanicRequest.findFirst({ where: { docNo: { startsWith: `MX-${year}-` } }, orderBy: { docNo: "desc" } }))?.docNo;
  let mxN = Number(lastMx?.slice(-5) ?? 0) + 1;
  const mx = [
    { veh: pump, problem: "Ehtiyot qism", amount: 4_600_000, status: "APPROVED" as const, urgent: true, note: "Gidronasos zichlagich to'plami" },
    { veh: mixerG, problem: "Shina", amount: 2_800_000, status: "NEW" as const, urgent: false, note: "Orqa shina yeyilgan, 2 dona" },
    { veh: truckBig, problem: "Ta'mir", amount: 650_000, status: "NEW" as const, urgent: true, note: "Kuzov qulfi singan" },
    { veh: mixerD, problem: "Moy", amount: 900_000, status: "REJECTED" as const, urgent: false, note: "Skladda moy bor — skladdan olinsin" },
  ];
  for (const m of mx) {
    await db.mechanicRequest.create({ data: {
      docNo: `MX-${year}-${String(mxN++).padStart(5, "0")}`, target: "TRANSPORT", vehicleId: m.veh.id, problem: m.problem, amount: D(m.amount), urgent: m.urgent,
      status: m.status, note: `${TAG} ${m.note}`, createdById: mexanik.id, createdAt: dayAt(-int(0, 3), int(8, 17)),
      ...(m.status !== "NEW" ? { decidedAt: dayAt(0, 9), ...(m.status === "REJECTED" ? { rejectReason: "Skladda bor" } : {}) } : {}),
    } });
  }
  const lastTz = (await db.supplyRequest.findFirst({ where: { docNo: { startsWith: `TZ-${year}-` } }, orderBy: { docNo: "desc" } }))?.docNo;
  let tzN = Number(lastTz?.slice(-5) ?? 0) + 1;
  const supply = [
    { status: "NEW" as const, need: 2, items: [["Gidronasos zichlagich to'plami", "dona", 1], ["Gidravlika moyi HVLP 46", "l", 40]] as const },
    { status: "PRICED" as const, need: 5, items: [["Shina 315/80 R22.5", "dona", 2], ["Tormoz kolodkasi (orqa)", "dona", 4]] as const },
    { status: "FUNDED" as const, need: 1, items: [["Motor moyi 15W-40", "l", 60], ["Yoqilg'i filtri", "dona", 4]] as const },
  ];
  for (const s of supply) {
    await db.supplyRequest.create({ data: {
      docNo: `TZ-${year}-${String(tzN++).padStart(5, "0")}`, date: dayAt(-int(0, 2), 10), status: s.status, warehouseId: warehouse.id, needBy: dayAt(s.need, 18),
      department: "Texnika", priority: s.need <= 2 ? "HIGH" : "NORMAL", note: `${TAG} texnika ehtiyoji`, createdById: mexanik.id,
      items: { create: s.items.map(([name, unit, qty], i) => ({ name, unit, qty: D(qty, 3), price: s.status === "NEW" ? D(0) : D(pick([180_000, 450_000, 1_400_000])), sortOrder: i })) },
    } });
  }

  console.log(`Yaratildi: transport 5 (${[...fleet, pump].map((v) => v.plate).join(", ")}), zayavka ${orders}, reys ${trips}, zapravka ${fuels}, xarajat ${exps}, xizmat ${services.length}, mexanik so'rovi ${mx.length}, ta'minot ${supply.length}`);
  console.log("Ko'rish: /dashboard (mexanik), /logistika/transport, Tahlil → Mexanik");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
