/**
 * Haydovchi tabeli «Hisob varag'i» uchun sun'iy ma'lumot (lokal sinov) — joriy oyning 1-kunidan kechagacha:
 * 2 ta mikser (metan va dizel), mavjud haydovchilar, yetkazilgan reyslar (km, baraban soati, kutish, reys haqi),
 * zapravkalar, ta'mir/zapchast/boshqa xarajat, zayavkada dastavka haqi (P/R va N/L).
 *
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-tabel.ts            → avvalgisini o'chirib, qaytadan yaratadi
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-tabel.ts --remove   → faqat o'chiradi
 *
 * Har yozuv `[demo-tabel]` belgisi bilan (izoh / transport izohi) — o'chirish shu bo'yicha. Sklad harakati yozilmaydi.
 */
import { PrismaClient, Prisma } from "../src/generated/prisma";
import { guardDemo } from "./demo-guard";

guardDemo("scripts/demo-tabel.ts");
const db = new PrismaClient();
const TAG = "[demo-tabel]";

let seed = 20261029;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
const D = (n: number, f = 2) => new Prisma.Decimal(n.toFixed(f));

async function remove() {
  const vehicles = await db.vehicle.findMany({ where: { note: TAG }, select: { id: true } });
  const vIds = vehicles.map((v) => v.id);
  const orders = await db.order.findMany({ where: { note: { startsWith: TAG } }, select: { id: true } });
  const oIds = orders.map((o) => o.id);
  const trips = await db.trip.findMany({ where: { OR: [{ orderId: { in: oIds } }, { vehicleId: { in: vIds } }] }, select: { id: true } });
  const tIds = trips.map((t) => t.id);
  const r = await db.$transaction([
    db.fuelLog.deleteMany({ where: { OR: [{ note: TAG }, { tripId: { in: tIds } }, { vehicleId: { in: vIds } }] } }),
    db.transportExpense.deleteMany({ where: { OR: [{ note: { startsWith: TAG } }, { tripId: { in: tIds } }, { vehicleId: { in: vIds } }] } }),
    db.trip.deleteMany({ where: { id: { in: tIds } } }),
    db.order.deleteMany({ where: { id: { in: oIds } } }),
    db.employee.updateMany({ where: { vehicleId: { in: vIds } }, data: { vehicleId: null } }),
    db.vehicle.deleteMany({ where: { id: { in: vIds } } }),
  ]);
  console.log(`O'chirildi: zapravka ${r[0].count}, xarajat ${r[1].count}, reys ${r[2].count}, zayavka ${r[3].count}, transport ${r[5].count}`);
}

async function main() {
  await remove();
  if (process.argv.includes("--remove")) return;

  const [mexanik, dispetcher] = await Promise.all([
    db.user.findFirst({ where: { role: "MECHANIC", isActive: true } }).then((u) => u ?? db.user.findFirstOrThrow({ where: { role: "DIRECTOR" } })),
    db.user.findFirst({ where: { role: "DISPATCHER", isActive: true } }).then((u) => u ?? db.user.findFirstOrThrow({ where: { role: "DIRECTOR" } })),
  ]);
  const drivers = await db.employee.findMany({ where: { isActive: true, position: { contains: "aydovchi" } }, orderBy: { fullName: "asc" }, take: 4 });
  if (drivers.length < 2) throw new Error("Kamida 2 ta haydovchi xodim kerak (lavozimi «Haydovchi»)");
  const customers = await db.customer.findMany({ where: { isInternal: false, isActive: true }, take: 8, orderBy: { name: "asc" } });
  const concrete = await db.product.findMany({ where: { isActive: true, unit: "m3", code: { startsWith: "M" }, price: { gt: 0 } }, orderBy: { code: "asc" } });
  if (!customers.length || !concrete.length) throw new Error("Mijoz va beton mahsuloti (M200…) kerak");

  // Transport: Excel'dagidek metan mikser (0,6 m³/km + baraban 5 m³/soat) va dizel mikser
  const gasMixer = await db.vehicle.create({ data: {
    plate: "01T501DT", type: "MIXER", capacityM3: 10, brand: "Shacman", model: "X3000 CNG", year: 2022, fuelType: "METHANE",
    fuelNormL100: 60, idleNormPerHour: 5, odometerKm: 152000, hasGps: true, note: TAG,
  } });
  const dtMixer = await db.vehicle.create({ data: {
    plate: "01T502DT", type: "MIXER", capacityM3: 9, brand: "Howo", model: "A7", year: 2021, fuelType: "DIESEL",
    fuelNormL100: 38, idleNormPerHour: 3, odometerKm: 98000, hasGps: true, note: TAG,
  } });
  // Bir mashinada smenadosh haydovchilar (Excel'dagidek)
  const crew = new Map([[gasMixer.id, drivers.slice(0, Math.max(2, drivers.length - 1))], [dtMixer.id, drivers.slice(-2)]]);

  const year = new Date().getFullYear();
  const lastOrder = await db.order.findFirst({ where: { orderNo: { startsWith: `Z-${year}-` } }, orderBy: { orderNo: "desc" } });
  let orderN = Math.max(100, Number(lastOrder?.orderNo.slice(-5) ?? 0) + 1);
  const lastTrip = await db.trip.findFirst({ where: { deliveryNoteNo: { startsWith: `N-${year}-` } }, orderBy: { deliveryNoteNo: "desc" } });
  let tripN = Math.max(100, Number(lastTrip?.deliveryNoteNo.slice(-5) ?? 0) + 1);
  const no = (p: string, n: number) => `${p}-${year}-${String(n).padStart(5, "0")}`;

  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = now.getDate() - 1;
  let trips = 0, fuels = 0, exps = 0;
  const places = ["Insof zavodi", "Yangi zavod"];
  const addr = ["Toshkent, Chilonzor 9-kvartal", "Yangiyo'l, Qovunchi", "Toshkent, Sergeli 7", "Zangiota tumani", "Yangiyo'l, Bozor ko'ch.", "Toshkent, Olmazor"];

  for (let day = 1; day <= lastDay; day++) {
    const base = new Date(first.getFullYear(), first.getMonth(), day);
    if (base.getDay() === 0) continue;
    for (const veh of [gasMixer, dtMixer]) {
      const n = veh === gasMixer ? int(1, 3) : int(0, 2);
      let clock = addMin(base, int(7 * 60, 9 * 60));
      for (let k = 0; k < n; k++) {
        const cust = pick(customers), prod = pick(concrete);
        const qty = pick([4, 6, 8, 10]);
        const oneWay = int(6, 55);
        const pay = pick(["BANK", "CASH", "BANK", null] as const);
        const order = await db.order.create({ data: {
          orderNo: no("Z", orderN++), date: addMin(clock, -24 * 60), customerId: cust.id, status: "CLOSED",
          deliveryDate: clock, deliveryAddress: pick(addr), distanceKm: D(oneWay), distanceSource: "ROUTE",
          deliveryFee: D(pick([650_000, 750_000, 1_300_000, 1_950_000, 3_250_000])), payMethod: pay ?? undefined,
          note: `${TAG} beton`, createdById: dispetcher.id,
          items: { create: [{ productId: prod.id, qtyM3: D(qty, 3), price: prod.price }] },
        } });
        const drv = pick(crew.get(veh.id)!);
        const loaded = clock;
        const departed = addMin(loaded, int(10, 20));
        const arrived = addMin(departed, Math.round(oneWay * 1.6) + int(5, 20));
        const unloading = addMin(arrived, int(5, 60));
        const delivered = addMin(unloading, int(15, 40));
        const gpsKm = Math.round(oneWay * (0.95 + rnd() * 0.15) * 10) / 10;
        const drumH = Math.round(((delivered.getTime() - loaded.getTime()) / 3_600_000) * 10) / 10;
        const priced = rnd() < 0.8;
        const amount = Math.round((65_000 + gpsKm * 2 * 1_500) / 5000) * 5000;
        const trip = await db.trip.create({ data: {
          deliveryNoteNo: no("N", tripN++), orderId: order.id, vehicleId: veh.id, driverId: drv.id, qtyM3: D(qty, 3), status: "DELIVERED",
          loadedAt: loaded, departedAt: departed, arrivedAt: arrived, unloadingAt: unloading, deliveredAt: delivered,
          pickupAddress: pick(places), receiverName: "Prorab", note: TAG,
          distanceKm: gpsKm, movingSec: Math.round(oneWay * 1.6 * 60), totalSec: Math.round((delivered.getTime() - departed.getTime()) / 1000), summaryAt: delivered,
          drumTurns: int(1, 4), workHours: D(drumH), waitMin: Math.round((unloading.getTime() - arrived.getTime()) / 60000),
          payKm: D(gpsKm * 2, 1), paySuggested: D(amount),
          ...(priced ? { payAmount: D(amount), pricedAt: addMin(delivered, 120), pricedById: dispetcher.id } : {}),
          ecoStatus: "COMPLETED",
        } });
        trips++;
        // Zapravka: metan — har 2–3 reysda, dizel — kamroq
        if (rnd() < (veh === gasMixer ? 0.4 : 0.3)) {
          const gas = veh.fuelType === "METHANE";
          const liters = gas ? int(120, 200) : int(60, 120);
          const price = gas ? 3_500 : 10_500;
          await db.fuelLog.create({ data: {
            date: addMin(loaded, -30), vehicleId: veh.id, driverId: drv.id, fuelType: gas ? "METHANE" : "DIESEL",
            liters: D(liters), pricePerL: D(price), amount: D(liters * price), station: gas ? "Metan AGZS №3" : "UzGasOil №12", note: TAG, createdById: mexanik.id,
          } });
          fuels++;
        }
        // Reysga bog'langan mayda xarajat (yo'l, yuvish)
        if (rnd() < 0.12) {
          await db.transportExpense.create({ data: { date: delivered, kind: pick(["ROAD", "WASH"] as const), vehicleId: veh.id, driverId: drv.id, tripId: trip.id, amount: D(pick([20_000, 30_000, 50_000])), note: `${TAG} reys`, createdById: mexanik.id } });
          exps++;
        }
        clock = addMin(delivered, int(30, 90));
        if (clock.getHours() >= 21) break;
      }
    }
  }
  // Ta'mir, zapchast, vulkanizatsiya — reysga bog'lanmagan (keyingi reys qatoriga tushadi)
  const big = [
    { day: 9, veh: gasMixer, kind: "PARTS" as const, amount: 2_160_000, note: "Zapchast: filtr va remen" },
    { day: 14, veh: gasMixer, kind: "REPAIR" as const, amount: 1_000_000, note: "Usta: baraban podshipnigi" },
    { day: 17, veh: dtMixer, kind: "PARTS" as const, amount: 1_500_000, note: "Zapchast: tormoz kolodkasi" },
    { day: 22, veh: gasMixer, kind: "OTHER" as const, amount: 500_000, note: "Vulkanizatsiya" },
    { day: 26, veh: dtMixer, kind: "REPAIR" as const, amount: 800_000, note: "Usta: gidravlika" },
  ];
  for (const b of big.filter((x) => x.day <= lastDay)) {
    await db.transportExpense.create({ data: { date: new Date(first.getFullYear(), first.getMonth(), b.day, 8), kind: b.kind, vehicleId: b.veh.id, amount: D(b.amount), note: `${TAG} ${b.note}`, createdById: mexanik.id } });
    exps++;
  }
  console.log(`Yaratildi: transport 2 (${gasMixer.plate} metan, ${dtMixer.plate} dizel), reys ${trips}, zapravka ${fuels}, xarajat ${exps}`);
  console.log(`Ko'rish: /logistika/tabel?view=hisob  (haydovchilar: ${drivers.map((d) => d.fullName).join(", ")})`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
