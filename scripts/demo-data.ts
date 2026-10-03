/**
 * Lokal sinov uchun demo ma'lumot — har bir rol kabineti (veb + ECO ilova) bo'sh ko'rinmasin.
 * Faqat lokal bazaga: production'da ishlamaydi.
 *
 *   npm run db:demo            → avvalgi demo yozuvlarni o'chirib, qaytadan yaratadi (so'nggi ~40 kun + yaqin kunlar)
 *   npm run db:demo -- --remove → faqat demo yozuvlarni o'chiradi
 *
 * Avval `npm run db:test-users` ishlagan bo'lishi kerak (test.* loginlar — yozuvlar ularning nomidan).
 * Har bir demo yozuv `[demo]` belgisi bilan (note / nom) — o'chirish shu belgi bo'yicha.
 */
import { PrismaClient, Prisma, type OrderStatus, type SupplyStatus, type AttendanceStatus } from "../src/generated/prisma";
import { guardDemo } from "./demo-guard";

// Faqat lokal test bazasi (insof_test…) yoki ALLOW_DEMO=yes-i-know (env shu yerda yuklanadi)
guardDemo("scripts/demo-data.ts");
const db = new PrismaClient();
const TAG = "[demo]";
const D = (n: number) => new Prisma.Decimal(n.toFixed(3));

// Takrorlanadigan tasodif — har ishga tushirishda bir xil manzara
let seed = 20260930;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

const NOW = new Date();
/** Bugundan `off` kun keyin, soat `h:m` (mahalliy vaqt). */
function at(off: number, h = 9, m = 0) { const d = new Date(NOW); d.setDate(d.getDate() + off); d.setHours(h, m, 0, 0); return d; }
/** @db.Date ustunlar uchun — UTC yarim tun */
function dateOnly(off: number) { const d = at(off); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); }
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
const year = NOW.getFullYear();
const no = (p: string, n: number) => `${p}-${year}-${String(n).padStart(5, "0")}`;

async function user(login: string) {
  const u = await db.user.findUnique({ where: { login } });
  if (!u) throw new Error(`${login} topilmadi — avval: npm run db:test-users`);
  return u;
}

// ───────────────────────── O'chirish ─────────────────────────

async function remove() {
  const orders = (await db.order.findMany({ where: { note: { startsWith: TAG } }, select: { id: true } })).map((o) => o.id);
  const trips = (await db.trip.findMany({ where: { orderId: { in: orders } }, select: { id: true } })).map((t) => t.id);
  const supply = (await db.supplyRequest.findMany({ where: { note: { startsWith: TAG } }, select: { id: true, receiptId: true } }));
  const vehicles = (await db.vehicle.findMany({ where: { note: { startsWith: TAG } }, select: { id: true } })).map((v) => v.id);
  const brigades = (await db.brigade.findMany({ select: { id: true } })).map((b) => b.id);

  await db.$transaction([
    db.salesRegister.deleteMany({ where: { batch: "demo" } }),
    db.payment.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.invoice.deleteMany({ where: { orderId: { in: orders } } }),
    db.fuelLog.deleteMany({ where: { OR: [{ note: { startsWith: TAG } }, { tripId: { in: trips } }] } }),
    db.transportExpense.deleteMany({ where: { OR: [{ note: { startsWith: TAG } }, { tripId: { in: trips } }] } }),
    db.tripIssue.deleteMany({ where: { tripId: { in: trips } } }),
    db.tripPosition.deleteMany({ where: { tripId: { in: trips } } }),
    db.trip.deleteMany({ where: { id: { in: trips } } }),
    db.brigadeIssue.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.taskProgress.deleteMany({ where: { task: { orderId: { in: orders } } } }),
    db.brigadeTask.deleteMany({ where: { orderId: { in: orders } } }),
    db.brigadeShift.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.productDefect.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.productionBatch.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.stockMove.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.order.deleteMany({ where: { id: { in: orders } } }),
    db.site.deleteMany({ where: { name: { startsWith: TAG } } }),
    db.supplyRequest.deleteMany({ where: { id: { in: supply.map((s) => s.id) } } }),
    db.goodsReceipt.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.cashTransaction.deleteMany({ where: { note: { startsWith: TAG } } }),
    db.attendance.deleteMany({ where: { note: TAG } }),
    db.productionPlan.deleteMany({ where: { note: TAG } }),
    db.productionReport.deleteMany({ where: { note: TAG } }),
    db.expenseBudget.deleteMany({ where: { note: TAG } }),
    db.salesPlan.deleteMany({ where: { note: TAG } }),
    db.marketingEntry.deleteMany({ where: { note: TAG } }),
    db.lead.deleteMany({ where: { note: TAG } }),
    db.employee.updateMany({ where: { vehicleId: { in: vehicles } }, data: { vehicleId: null } }),
    db.vehicle.deleteMany({ where: { id: { in: vehicles } } }),
    db.employee.updateMany({ where: { note: { contains: `${TAG} brigada` } }, data: { brigadeId: null, note: null } }),
  ]);
  void brigades;
  console.log("Demo yozuvlar o'chirildi.");
}

// ───────────────────────── Yaratish ─────────────────────────

async function create() {
  const [director, sotuv, sotuv1, ishlab, prorab, logist, sklad, snab, buh, kassa, haydovchi, brigadir, mexanik] = await Promise.all(
    ["test.direktor", "test.sotuv", "sotuv1", "test.ishlab", "test.prorab", "test.logistika", "test.sklad", "test.snab", "test.buh", "test.kassa", "test.haydovchi", "test.brigadir", "test.mexanik"].map((l) => user(l).catch(() => null)),
  );
  if (!director || !sotuv || !ishlab || !prorab || !logist || !sklad || !snab || !buh || !kassa || !haydovchi || !brigadir || !mexanik) throw new Error("test.* loginlar to'liq emas — avval: npm run db:test-users");
  const sellers = [sotuv, sotuv1 ?? sotuv];

  const wh = await db.warehouse.findFirstOrThrow();
  const products = await db.product.findMany({ where: { isActive: true }, include: { recipes: { where: { isActive: true }, include: { items: true } } } });
  const P = (code: string) => products.find((p) => p.code === code)!;
  const concrete = products.filter((p) => p.unit === "m3" && p.code.startsWith("M") && p.recipes.length);
  const pieces = ["USTUN", "FBS24", "FBS12", "BR100", "KS10", "2PB17"].map(P).filter(Boolean);
  const materials = await db.material.findMany();
  const M = (code: string) => materials.find((m) => m.code === code)!;
  const customers = await db.customer.findMany({ where: { isInternal: false, isActive: true } });
  const suppliers = await db.supplier.findMany();
  const S = (part: string) => suppliers.find((s) => s.name.includes(part)) ?? suppliers[0];
  const [cash, bank] = await Promise.all([db.cashAccount.findFirstOrThrow({ where: { type: "CASH" } }), db.cashAccount.findFirstOrThrow({ where: { type: "BANK" } })]);
  const brigades = await db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const testBrigade = brigades.find((b) => b.name.startsWith("Test brigada")) ?? brigades[0];

  // ── Transport: yangi mashinalar, haydovchilarga biriktirish ──
  const newVehicles = [
    { plate: "01X777DM", type: "MIXER" as const, capacityM3: 9, brand: "Shacman", model: "X3000", status: "ACTIVE" as const },
    { plate: "01X778DM", type: "MIXER" as const, capacityM3: 10, brand: "Howo", model: "A7", status: "REPAIR" as const, statusNote: "Baraban podshipnigi almashtirilmoqda" },
    { plate: "01X779DM", type: "PUMP" as const, capacityM3: null, brand: "Putzmeister", model: "M38", status: "ACTIVE" as const },
    { plate: "01X780DM", type: "TRUCK" as const, capacityM3: null, brand: "Isuzu", model: "NPR", status: "IDLE" as const },
  ];
  for (const [i, v] of newVehicles.entries()) {
    await db.vehicle.create({ data: {
      ...v, capacityM3: v.capacityM3 ?? undefined, fuelType: "DIESEL", fuelNormL100: 38, odometerKm: 84000 + i * 23000, hasGps: i !== 3,
      statusSince: v.status === "ACTIVE" ? undefined : at(-2), year: 2021 + (i % 3),
      inspectionUntil: at(i === 0 ? 9 : 120), insuranceUntil: at(i === 2 ? 5 : 200), insuranceCompany: "Kafolat", note: TAG,
    } });
  }
  const mixers = await db.vehicle.findMany({ where: { type: "MIXER", status: "ACTIVE", isActive: true }, orderBy: { plate: "asc" } });
  const driverEmps = await db.employee.findMany({ where: { isActive: true, OR: [{ position: "Haydovchi" }, { user: { role: "DRIVER" } }] }, orderBy: { fullName: "asc" } });
  for (const [i, e] of driverEmps.entries()) {
    if (!e.vehicleId) await db.employee.update({ where: { id: e.id }, data: { vehicleId: mixers[i % mixers.length].id, licenseCategory: "C", licenseNo: `AF${1234560 + i}` } });
  }
  const drivers = await db.employee.findMany({ where: { id: { in: driverEmps.map((e) => e.id) } }, include: { vehicle: true } });
  const testDriver = drivers.find((d) => d.userId === haydovchi.id)!;

  // ── Brigada tarkibi: bo'sh ishchilar brigadalarga ──
  const workers = await db.employee.findMany({ where: { isActive: true, brigadeId: null, userId: null, position: { in: ["Master", "Operator", "Laborant", "Skladchi"] } } });
  for (const [i, w] of workers.entries()) {
    await db.employee.update({ where: { id: w.id }, data: { brigadeId: brigades[i % brigades.length].id, note: `${TAG} brigada a'zosi` } });
  }

  // ── Obyektlar ──
  const sites = [];
  for (const [i, c] of customers.slice(0, 5).entries()) {
    sites.push(await db.site.create({ data: {
      customerId: c.id, name: `${TAG} ${c.name} — ${["Chilonzor 9", "Yunusobod 4", "Sergeli 7", "Olmazor", "Yashnobod"][i]} obyekti`,
      address: ["Toshkent, Chilonzor 9-kvartal", "Toshkent, Yunusobod 4-mavze", "Toshkent, Sergeli 7", "Toshkent, Olmazor, Qorasaroy ko'ch.", "Toshkent, Yashnobod, Aviasozlar"][i],
      lat: 41.28 + i * 0.02, lng: 69.2 + i * 0.03, contactName: "Prorab", contactPhone: `+99890123450${i}`, deliveryHours: "08:00–18:00",
    } }));
  }

  // ── Zayavkalar: 40 kun oldindan 5 kun keyingacha ──
  const lastOrder = await db.order.findFirst({ where: { orderNo: { startsWith: `Z-${year}-` } }, orderBy: { orderNo: "desc" } });
  let orderN = Math.max(100, Number(lastOrder?.orderNo.slice(-5) ?? 0) + 1);
  const lastTrip = await db.trip.findFirst({ where: { deliveryNoteNo: { startsWith: `N-${year}-` } }, orderBy: { deliveryNoteNo: "desc" } });
  let tripN = Math.max(100, Number(lastTrip?.deliveryNoteNo.slice(-5) ?? 0) + 1);
  let batchN = 100, taskN = 100, invN = 100;

  type Made = { id: string; off: number; status: OrderStatus; customerId: string; total: number; concrete: boolean };
  const made: Made[] = [];
  const consume = new Map<string, number>();
  const produced: { productId: string; qty: number; off: number; orderId: string | null }[] = [];

  for (let off = -40; off <= 5; off++) {
    const count = off < 0 && at(off).getDay() === 0 ? 0 : off <= 0 ? int(1, 2) : int(1, 2);
    for (let k = 0; k < count; k++) {
      const isConcrete = rnd() < 0.62;
      const cust = pick(customers);
      const site = sites.find((s) => s.customerId === cust.id);
      const status: OrderStatus =
        off < -3 ? (rnd() < 0.8 ? "CLOSED" : "DELIVERED")
        : off < 0 ? "DELIVERED"
        : off === 0 ? "IN_PRODUCTION"
        : rnd() < 0.15 ? "BLOCKED" : rnd() < 0.3 ? "DRAFT" : "CONFIRMED";
      const lines = isConcrete
        ? [{ p: pick(concrete), qty: int(2, 6) * 4 }]
        : [{ p: pick(pieces), qty: int(4, 30) * 5 }, ...(rnd() < 0.4 ? [{ p: pick(pieces), qty: int(2, 12) * 5 }] : [])];
      const uniq = lines.filter((l, i) => lines.findIndex((x) => x.p.id === l.p.id) === i);
      const order = await db.order.create({ data: {
        orderNo: no("Z", orderN++), date: at(off - int(1, 4), int(9, 17)), customerId: cust.id, status,
        deliveryDate: at(off, int(8, 15)), deliveryTime: `${int(8, 15)}:00`,
        deliveryAddress: site?.address ?? cust.address ?? "Toshkent", siteId: site?.id, lat: site?.lat, lng: site?.lng,
        distanceKm: int(6, 38), distanceSource: "osrm", needsPump: isConcrete && rnd() < 0.3, isUrgent: off >= 0 && rnd() < 0.2,
        onCredit: rnd() < 0.2, note: `${TAG} ${isConcrete ? "beton" : "tayyor mahsulot"}`, createdById: pick(sellers).id,
        items: { create: uniq.map((l) => ({ productId: l.p.id, qtyM3: D(l.qty), price: l.p.price })) },
      }, include: { items: { include: { product: { include: { recipes: { include: { items: true } } } } } } } });
      const total = order.items.reduce((s, it) => s + Number(it.qtyM3) * Number(it.price), 0);
      made.push({ id: order.id, off, status, customerId: cust.id, total, concrete: isConcrete });

      for (const it of order.items) {
        const qty = Number(it.qtyM3);
        const recipe = it.product.recipes[0];
        // Ishlab chiqarish: bajarilgan / bugungi zayavkalar zamesga tushadi
        if (recipe && (off < 0 || (off === 0 && isConcrete))) {
          const bOff = isConcrete ? off : off - 2;
          const parts = isConcrete ? Math.ceil(qty / 8) : 1;
          for (let b = 0; b < parts; b++) {
            const bq = isConcrete ? Math.min(8, qty - b * 8) : qty;
            await db.productionBatch.create({ data: { batchNo: no("ZM", batchN++), date: at(bOff, 7 + b), shift: b % 2 ? 2 : 1, orderId: order.id, productId: it.productId, recipeId: recipe.id, qtyM3: D(bq), note: TAG, createdById: ishlab.id } });
            produced.push({ productId: it.productId, qty: bq, off: bOff, orderId: order.id });
            for (const ri of recipe.items) if (ri.materialId) consume.set(ri.materialId, (consume.get(ri.materialId) ?? 0) + Number(ri.qtyPerM3) * bq);
            for (const ri of recipe.items) if (ri.materialId) {
              await db.stockMove.create({ data: { date: at(bOff, 7 + b), type: "PRODUCTION_CONSUME", warehouseId: wh.id, materialId: ri.materialId, qty: D(-Number(ri.qtyPerM3) * bq), refType: "ProductionBatch", note: TAG, createdById: ishlab.id } });
            }
          }
        }
        // Tayyor mahsulot — brigada topshirig'i
        if (!isConcrete) {
          const brigade = rnd() < 0.55 ? testBrigade : pick(brigades);
          const tStatus = off < -2 ? "DONE" : off < 2 ? (rnd() < 0.7 ? "IN_PROGRESS" : "NEW") : "NEW";
          const done = tStatus === "DONE" ? qty : tStatus === "IN_PROGRESS" ? Math.round(qty * (0.2 + rnd() * 0.5)) : 0;
          await db.orderItem.update({ where: { id: it.id }, data: { brigadeId: brigade.id } });
          const task = await db.brigadeTask.create({ data: {
            taskNo: no("T", taskN++), orderId: order.id, orderItemId: it.id, brigadeId: brigade.id, qty: D(qty), doneQty: D(done),
            status: tStatus, dueDate: at(off, 17), startedAt: tStatus === "NEW" ? null : at(off - 3, 8), note: TAG, createdById: prorab.id,
          } });
          if (done) {
            const steps = int(1, 3);
            for (let s = 0; s < steps; s++) {
              const pOff = Math.min(0, off - steps + s);
              await db.taskProgress.create({ data: { taskId: task.id, qty: D(done / steps), date: at(pOff, 16), note: TAG, createdById: brigadir.id } });
            }
            produced.push({ productId: it.productId, qty: done, off: Math.min(0, off), orderId: null });
          }
        }
      }

      // Yetkazish: beton reyslari
      if (isConcrete && off <= 1 && status !== "BLOCKED" && status !== "DRAFT") {
        const qty = Number(order.items[0].qtyM3);
        const n = Math.ceil(qty / 8);
        for (let t = 0; t < n; t++) {
          const drv = off === 0 && t === 0 ? testDriver : rnd() < 0.35 ? testDriver : pick(drivers);
          const veh = drv.vehicle ?? mixers[0];
          const tq = Math.min(8, qty - t * 8);
          const start = at(off, 8 + t * 2, int(0, 50));
          const tStatus = off < 0 ? "DELIVERED" : off === 1 ? "PLANNED" : (["DELIVERED", "ON_ROAD", "LOADED", "PLANNED"] as const)[Math.min(t, 3)];
          const past = tStatus === "DELIVERED";
          const late = rnd() < 0.2 ? int(25, 70) : int(0, 15);
          const trip = await db.trip.create({ data: {
            deliveryNoteNo: no("N", tripN++), orderId: order.id, vehicleId: veh.id, driverId: drv.id, qtyM3: D(tq), status: tStatus,
            plannedAt: addMin(start, -30), loadedAt: tStatus === "PLANNED" ? null : start,
            departedAt: ["ON_ROAD", "DELIVERED"].includes(tStatus) ? addMin(start, 12) : null,
            arrivedAt: past ? addMin(start, 45 + late) : null, unloadingAt: past ? addMin(start, 50 + late) : null,
            deliveredAt: past ? addMin(start, 75 + late) : null, returnedAt: past ? addMin(start, 120 + late) : null, closedAt: past && off < -1 ? addMin(start, 130 + late) : null,
            acceptedQty: past ? D(tq) : null, receiverName: past ? "Prorab" : null, pickupAddress: "Insof zavodi",
            note: TAG, createdAt: addMin(start, -60),
          } });
          if (tStatus !== "PLANNED") await db.stockMove.create({ data: { date: start, type: "SHIPMENT", warehouseId: wh.id, productId: order.items[0].productId, qty: D(-tq), refType: "Trip", refId: trip.id, note: TAG, createdById: logist.id } });
          if (past && rnd() < 0.35) await db.fuelLog.create({ data: { date: addMin(start, 140), vehicleId: veh.id, driverId: drv.id, tripId: trip.id, fuelType: "DIESEL", liters: int(40, 90), pricePerL: 10500, amount: 0, station: "UzGasOil №12", note: TAG, createdById: mexanik.id } });
          if (tStatus === "ON_ROAD" && rnd() < 0.6) await db.tripIssue.create({ data: { tripId: trip.id, kind: "TRAFFIC", note: "Sergeli yo'lida tirbandlik, 20 daqiqa kechikadi", source: "DRIVER", createdById: haydovchi.id } });
          if (past && late > 40) await db.tripIssue.create({ data: { tripId: trip.id, kind: "SITE_NOT_READY", note: "Obyekt tayyor emas edi, kutildi", source: "DRIVER", createdById: haydovchi.id, resolvedAt: addMin(start, 90), resolvedById: logist.id, resolution: "Prorab bilan kelishildi" } });
        }
      }
    }
  }
  // Yoqilg'i summasi = litr × narx
  await db.$executeRaw`UPDATE "FuelLog" SET amount = liters * "pricePerL" WHERE note = ${TAG}`;

  // Tayyor mahsulot kirimi (sklad qoldig'i uchun)
  for (const p of produced) {
    await db.stockMove.create({ data: { date: at(p.off, 18), type: "PRODUCTION_OUTPUT", warehouseId: wh.id, productId: p.productId, qty: D(p.qty), note: TAG, createdById: ishlab.id } });
  }
  // Omborga oldindan tayyorlab qo'yilgan bloklar
  for (const p of pieces.slice(0, 4)) await db.stockMove.create({ data: { date: at(-20), type: "ADJUSTMENT", warehouseId: wh.id, productId: p.id, qty: D(int(40, 200)), note: `${TAG} inventarizatsiya`, createdById: sklad.id } });

  // ── Hisob-faktura va to'lovlar (debitorlik qolsin) ──
  const payAccounts = [bank, bank, cash];
  for (const o of made.filter((m) => m.status === "CLOSED" || m.status === "DELIVERED")) {
    const inv = await db.invoice.create({ data: { invoiceNo: no("S", invN++), date: at(o.off, 18), customerId: o.customerId, orderId: o.id, amount: o.total, status: "OPEN" } });
    const share = o.status === "CLOSED" ? 1 : rnd() < 0.4 ? 0 : 0.5;
    if (share) {
      const amount = Math.round(o.total * share);
      await db.payment.create({ data: { date: at(o.off + int(0, 3) > 0 ? 0 : o.off + int(0, 3), 11), customerId: o.customerId, invoiceId: inv.id, orderId: o.id, cashAccountId: pick(payAccounts).id, amount, note: `${TAG} to'lov` } });
      await db.invoice.update({ where: { id: inv.id }, data: { status: share === 1 ? "PAID" : "PARTIAL" } });
    }
  }
  // Kelgusi zayavkalar uchun oldindan to'lov
  for (const o of made.filter((m) => m.off > 0 && m.status === "CONFIRMED").slice(0, 3)) {
    await db.payment.create({ data: { date: at(0, 10), customerId: o.customerId, orderId: o.id, cashAccountId: bank.id, amount: Math.round(o.total * 0.5), note: `${TAG} avans` } });
  }

  // ── Xomashyo kirimi: sarfni qoplaydi, sement minimumdan past qoladi (ogohlantirish) ──
  const current = new Map((await db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } })).map((g) => [g.materialId!, Number(g._sum.qty ?? 0)]));
  const target: Record<string, number> = { CEM: 14000, SAND: 65000, GR520: 90000, ADD: 420, WATER: 6000 };
  const supplierOf: Record<string, string> = { CEM: "Sement", SAND: "Karyera", GR520: "Karyera", ADD: "Plastifikator", WATER: "Beton" };
  const priceOf: Record<string, number> = { CEM: 1250, SAND: 95, GR520: 120, ADD: 18000, WATER: 5 };
  const lastRec = await db.goodsReceipt.findFirst({ where: { docNo: { startsWith: `K-${year}-` } }, orderBy: { docNo: "desc" } });
  let recN = Math.max(100, Number(lastRec?.docNo.slice(-5) ?? 0) + 1);
  const receipts: { id: string; code: string; qty: number; off: number }[] = [];
  for (const [code, left] of Object.entries(target)) {
    const m = M(code); if (!m) continue;
    const need = left - (current.get(m.id) ?? 0);
    if (need <= 0) continue;
    const parts = 4;
    for (let i = 0; i < parts; i++) {
      const off = -38 + i * 10 + int(0, 3);
      const qty = Math.round(need / parts);
      const sup = S(supplierOf[code]);
      const r = await db.goodsReceipt.create({ data: { docNo: no("K", recN++), date: at(off, 10), supplierId: sup.id, warehouseId: wh.id, note: TAG, createdById: sklad.id, items: { create: [{ materialId: m.id, qty: D(qty), price: priceOf[code] }] } } });
      await db.stockMove.create({ data: { date: at(off, 10), type: "RECEIPT", warehouseId: wh.id, materialId: m.id, qty: D(qty), unitCost: priceOf[code], refType: "GoodsReceipt", refId: r.id, note: TAG, createdById: sklad.id } });
      receipts.push({ id: r.id, code, qty, off });
      // Yetkazib beruvchiga to'lov
      await db.cashTransaction.create({ data: { date: at(off + 1, 12), type: "EXPENSE", cashAccountId: bank.id, amount: Math.round(qty * priceOf[code]), category: "Xomashyo", counterparty: sup.name, supplierId: sup.id, note: `${TAG} ${m.name}`, createdById: kassa.id } });
    }
  }

  // ── Snabjeniye: hamma bosqichdagi talabnomalar ──
  const lastTz = await db.supplyRequest.findFirst({ where: { docNo: { startsWith: `TZ-${year}-` } }, orderBy: { docNo: "desc" } });
  let tzN = Math.max(100, Number(lastTz?.docNo.slice(-5) ?? 0) + 1);
  const supplyPlan: { status: SupplyStatus; off: number; code: string; qty: number; dept: string; pr: "NORMAL" | "HIGH" | "CRITICAL"; delivery?: "PLANNED" | "IN_TRANSIT" | "ARRIVED" | "PROBLEM"; needBy: number; eta?: number; incident?: boolean; director?: boolean }[] = [
    { status: "NEW", off: 0, code: "CEM", qty: 30000, dept: "Ishlab chiqarish", pr: "CRITICAL", needBy: 2 },
    { status: "NEW", off: -1, code: "ADD", qty: 400, dept: "Ishlab chiqarish", pr: "NORMAL", needBy: 6 },
    { status: "PRICED", off: -2, code: "GR520", qty: 60000, dept: "Sklad", pr: "HIGH", needBy: 3 },
    { status: "PRICED", off: -3, code: "SAND", qty: 50000, dept: "Sklad", pr: "NORMAL", needBy: -1, director: true },
    { status: "APPROVED", off: -4, code: "CEM", qty: 25000, dept: "Ishlab chiqarish", pr: "HIGH", needBy: 1 },
    { status: "FUNDED", off: -6, code: "SAND", qty: 40000, dept: "Sklad", pr: "NORMAL", delivery: "IN_TRANSIT", needBy: 1, eta: 0 },
    { status: "FUNDED", off: -8, code: "ADD", qty: 300, dept: "Ishlab chiqarish", pr: "HIGH", delivery: "PLANNED", needBy: -2, eta: -1 },
    { status: "FUNDED", off: -5, code: "GR520", qty: 45000, dept: "Sklad", pr: "NORMAL", delivery: "PROBLEM", needBy: 0, eta: -1, incident: true },
    { status: "RECEIVED", off: -15, code: "CEM", qty: 20000, dept: "Ishlab chiqarish", pr: "NORMAL", needBy: -12 },
    { status: "RECEIVED", off: -25, code: "SAND", qty: 45000, dept: "Sklad", pr: "NORMAL", needBy: -22 },
    { status: "REJECTED", off: -10, code: "WATER", qty: 5000, dept: "Mexanika", pr: "NORMAL", needBy: -5 },
  ];
  const stages: SupplyStatus[] = ["NEW", "PRICED", "APPROVED", "FUNDED", "RECEIVED"];
  for (const s of supplyPlan) {
    const m = M(s.code); if (!m) continue;
    const price = priceOf[s.code] * (1 + (rnd() - 0.4) * 0.1);
    const sup = S(supplierOf[s.code]);
    const priced = s.status !== "NEW";
    const receipt = s.status === "RECEIVED" ? receipts.find((r) => r.code === s.code && !r.id.startsWith("used")) : undefined;
    const req = await db.supplyRequest.create({ data: {
      docNo: no("TZ", tzN++), date: at(s.off, 10), status: s.status, warehouseId: wh.id, needBy: at(s.needBy, 12), note: `${TAG} ${m.name} — ${s.dept.toLowerCase()} uchun`,
      supplierId: priced ? sup.id : null, deliveryKind: priced ? "supplier" : null, deliveryCost: priced ? 1500000 : 0,
      department: s.dept, priority: s.pr, responsibleId: snab.id, contractNo: priced ? `DG-${int(100, 999)}/${year}` : null,
      directorOkAt: ["APPROVED", "FUNDED", "RECEIVED"].includes(s.status) ? at(s.off + 1, 15) : null, directorOkById: ["APPROVED", "FUNDED", "RECEIVED"].includes(s.status) ? director.id : null,
      cashAccountId: ["FUNDED", "RECEIVED"].includes(s.status) ? bank.id : null,
      deliveryStatus: s.status === "RECEIVED" ? "RECEIVED" : s.delivery ?? null,
      shippedAt: s.delivery === "IN_TRANSIT" || s.delivery === "PROBLEM" ? at(s.off + 3, 9) : null, eta: s.eta != null ? at(s.eta, 14) : null,
      arrivedAt: s.status === "RECEIVED" ? at(s.needBy, 11) : null, receiptId: receipt?.id ?? null,
      createdById: s.dept === "Sklad" ? sklad.id : s.dept === "Mexanika" ? mexanik.id : ishlab.id,
      items: { create: [{ materialId: m.id, name: m.name, unit: m.unit, qty: D(s.qty), price: priced ? Math.round(price * 100) / 100 : 0, prevPrice: priceOf[s.code], factQty: s.status === "RECEIVED" ? D(s.qty) : null }] },
    } });
    if (receipt) receipt.id = `used:${receipt.id}`;
    const reached = s.status === "REJECTED" ? ["NEW", "REJECTED"] as SupplyStatus[] : stages.slice(0, stages.indexOf(s.status) + 1);
    for (const [i, st] of reached.entries()) await db.supplyEvent.create({ data: { requestId: req.id, stage: st, note: st === "REJECTED" ? "Kerak emas — suv o'z quduqdan" : null, userId: st === "APPROVED" ? director.id : st === "FUNDED" ? kassa.id : snab.id, createdAt: at(s.off + i, 11) } });
    if (priced) {
      for (const [i, alt] of [sup, pick(suppliers)].entries()) {
        await db.supplyQuote.create({ data: { requestId: req.id, supplierId: alt.id, supplierName: alt.name, amount: Math.round(s.qty * price * (1 + i * 0.07)), deliveryDays: 2 + i * 2, paymentTerms: i ? "50% oldindan" : "100% oldindan", chosen: i === 0, createdById: snab.id, createdAt: at(s.off + 1, 10) } });
      }
    }
    if (s.status === "FUNDED" || s.status === "RECEIVED") {
      await db.cashTransaction.create({ data: { date: at(s.off + 2, 16), type: "EXPENSE", cashAccountId: bank.id, amount: Math.round(s.qty * price), category: "Xomashyo", counterparty: sup.name, supplierId: sup.id, refType: "SupplyRequest", refId: req.id, note: `${TAG} ${req.docNo}`, createdById: kassa.id } });
    }
    if (s.incident) await db.supplyIncident.create({ data: { requestId: req.id, kind: "DELAY", note: "Yetkazib beruvchi mashinasi buzildi, 2 kunga kechikadi", createdById: snab.id, createdAt: at(-1, 10) } });
  }

  // ── Kassa: kundalik kirim-chiqim ──
  const expenseCats = [
    { cat: "Ish haqi", day: 5, amount: 185_000_000, acc: bank }, { cat: "Avans", day: 20, amount: 62_000_000, acc: cash },
    { cat: "Elektr energiya", day: 12, amount: 23_400_000, acc: bank }, { cat: "Gaz", day: 12, amount: 8_900_000, acc: bank },
    { cat: "Soliq", day: 15, amount: 41_000_000, acc: bank }, { cat: "Ijara", day: 1, amount: 15_000_000, acc: bank },
  ];
  // Davr boshidagi qoldiq — kassa/bank minusga tushmasin
  await db.cashTransaction.create({ data: { date: at(-41, 9), type: "INCOME", cashAccountId: bank.id, amount: 1_400_000_000, category: "Boshlang'ich qoldiq", note: TAG, createdById: buh.id } });
  await db.cashTransaction.create({ data: { date: at(-41, 9), type: "INCOME", cashAccountId: cash.id, amount: 150_000_000, category: "Boshlang'ich qoldiq", note: TAG, createdById: buh.id } });
  for (let off = -40; off <= 0; off++) {
    const d = at(off);
    for (const e of expenseCats) if (d.getDate() === e.day) await db.cashTransaction.create({ data: { date: at(off, 14), type: "EXPENSE", cashAccountId: e.acc.id, amount: e.amount, category: e.cat, note: TAG, createdById: kassa.id } });
    if (d.getDay() !== 0 && rnd() < 0.5) await db.cashTransaction.create({ data: { date: at(off, int(9, 17)), type: "EXPENSE", cashAccountId: cash.id, amount: int(3, 25) * 100_000, category: pick(["Xo'jalik", "Ehtiyot qism", "Yoqilg'i", "Transport", "Ofis"]), note: TAG, createdById: kassa.id } });
    if (d.getDay() !== 0 && rnd() < 0.25) await db.cashTransaction.create({ data: { date: at(off, int(9, 17)), type: "INCOME", cashAccountId: cash.id, amount: int(2, 12) * 500_000, category: "Chakana savdo", counterparty: "Naqd mijoz", note: TAG, createdById: kassa.id } });
  }

  // ── Transport xarajatlari (mexanik / logistika) ──
  const allVeh = await db.vehicle.findMany({ where: { isActive: true } });
  for (let i = 0; i < 12; i++) {
    const v = pick(allVeh);
    await db.transportExpense.create({ data: { date: at(-int(0, 35), int(9, 17)), kind: pick(["REPAIR", "PARTS", "WASH", "ROAD", "PARKING", "FINE"] as const), vehicleId: v.id, amount: int(2, 40) * 100_000, note: `${TAG} ${v.plate}`, createdById: mexanik.id } });
  }

  // ── Brigada: smena, muammo, brak ──
  const openTasks = await db.brigadeTask.findMany({ where: { note: TAG, status: { in: ["NEW", "IN_PROGRESS"] } }, select: { id: true, brigadeId: true } });
  for (const b of brigades) {
    for (let off = -12; off <= 0; off++) {
      if (at(off).getDay() === 0) continue;
      const closed = off < 0;
      await db.brigadeShift.create({ data: {
        brigadeId: b.id, date: dateOnly(off), openedAt: at(off, 8, int(0, 20)), openedById: brigadir.id,
        closedAt: closed ? at(off, 18, int(0, 30)) : null, closedById: closed ? brigadir.id : null,
        summary: closed ? `ishda ${int(4, 7)}/7 · bajarildi ${int(20, 80)} dona` : null, note: TAG, seenAt: closed && off < -1 ? at(off + 1, 9) : null,
      } }).catch(() => undefined); // shu kunga smena allaqachon bo'lsa
    }
  }
  const issueKinds = ["EQUIPMENT", "MATERIAL", "STAFF", "DELAY", "QUALITY"] as const;
  for (let i = 0; i < 6; i++) {
    const t = openTasks[i % Math.max(1, openTasks.length)];
    const open = i < 3;
    await db.brigadeIssue.create({ data: {
      brigadeId: t?.brigadeId ?? testBrigade.id, taskId: t?.id, kind: issueKinds[i % issueKinds.length],
      equipment: i % 5 === 0 ? "Vibrostanok №2" : null, downtimeMin: open ? null : int(20, 120),
      note: `${TAG} ${["Vibrostanok to'xtadi", "Sement tugab qoldi", "2 ishchi kelmadi", "Qolip kech keldi", "Yuzada yoriq"][i % 5]}`,
      createdById: brigadir.id, createdAt: at(-i, 10 + i), resolvedAt: open ? null : at(-i, 14), resolvedById: open ? null : prorab.id, resolution: open ? null : "Hal qilindi",
    } });
  }
  for (let i = 0; i < 7; i++) {
    const p = pick(pieces);
    await db.productDefect.create({ data: { date: at(-int(0, 25), int(9, 17)), productId: p.id, brigadeId: pick(brigades).id, qty: D(int(1, 6)), reason: pick(["Yoriq", "Qolip nuqsoni", "O'lcham mos emas", "Mustahkamlik past"]), note: TAG, createdById: pick([ishlab, brigadir]).id } });
  }

  // ── Rejalar: ishlab chiqarish, sotuv, xarajat byudjeti, marketing ──
  const months = [[year, NOW.getMonth() + 1], [NOW.getMonth() === 11 ? year + 1 : year, (NOW.getMonth() + 1) % 12 + 1]] as const;
  for (const [y, mo] of months) {
    for (const p of [...concrete, ...pieces]) {
      const monthQty = p.unit === "m3" ? int(15, 40) * 10 : int(20, 80) * 10;
      await db.productionPlan.create({ data: { year: y, month: mo, productId: p.id, monthQty: D(monthQty), dayQty: D(monthQty / 26), note: TAG, setById: director.id } }).catch(() => undefined);
    }
    await db.salesPlan.create({ data: { year: y, month: mo, sellerId: null, amount: 2_400_000_000, volumeM3: D(1500), note: TAG } }).catch(() => undefined);
    for (const s of sellers) await db.salesPlan.create({ data: { year: y, month: mo, sellerId: s.id, amount: 900_000_000, volumeM3: D(550), note: TAG } }).catch(() => undefined);
    for (const e of [...expenseCats.map((x) => ({ cat: x.cat, amount: x.amount })), { cat: "Xomashyo", amount: 900_000_000 }, { cat: "Yoqilg'i", amount: 45_000_000 }, { cat: "Ehtiyot qism", amount: 20_000_000 }]) {
      await db.expenseBudget.create({ data: { year: y, month: mo, category: e.cat, amount: e.amount, limit: Math.round(e.amount * 1.1), note: TAG, setById: director.id } }).catch(() => undefined);
    }
  }
  const [cy, cm] = months[0];
  const prevM = cm === 1 ? 12 : cm - 1, prevY = cm === 1 ? cy - 1 : cy;
  for (const [y, mo] of [[prevY, prevM], [cy, cm]]) {
    for (const ch of ["Instagram", "Telegram", "Google Ads", "OLX", "Tavsiya"]) {
      const amount = ch === "Tavsiya" ? 0 : int(5, 25) * 1_000_000;
      await db.marketingEntry.create({ data: { year: y, month: mo, kind: "BUDGET", channel: ch, amount: Math.round(amount * 1.1), note: TAG, createdById: director.id } });
      await db.marketingEntry.create({ data: { year: y, month: mo, kind: "FACT", channel: ch, amount, leads: int(8, 60), customers: int(1, 9), revenue: int(50, 400) * 1_000_000, impressions: int(5, 90) * 1000, clicks: int(200, 3000), note: TAG, createdById: director.id } });
    }
  }

  // ── Lidlar (sotuv) ──
  const leadNames = ["Akmal Qosimov", "Nilufar Hasanova", "Doston Qurilish", "Sirdaryo Invest", "Jamshid Olimov", "Samarqand Build"];
  for (const [i, n] of leadNames.entries()) {
    await db.lead.create({ data: { name: n, phone: `+99893${String(5550000 + i * 137).padStart(7, "0")}`, productId: pick([...concrete, ...pieces]).id, qty: D(int(5, 40)), address: "Toshkent", message: "Narxini bilmoqchiman", source: pick(["landing", "eco-shop", "telegram"]), status: i < 3 ? "NEW" : i < 5 ? "IN_PROGRESS" : "REJECTED", note: TAG, handledById: i < 3 ? null : sotuv.id, createdAt: at(-i, 10 + i) } });
  }

  // ── Realizatsiya jurnali (buxgalteriya) ──
  const regOrders = await db.order.findMany({ where: { id: { in: made.filter((m) => m.status === "CLOSED").slice(0, 10).map((m) => m.id) } }, include: { items: { include: { product: true } }, customer: true } });
  for (const o of regOrders) {
    const it = o.items[0];
    const sum = Number(it.qtyM3) * Number(it.price);
    await db.salesRegister.create({ data: { date: o.deliveryDate, customerId: o.customerId, productName: it.product.name, unit: it.product.unit, qty: it.qtyM3, price: it.price, sum, nds: Math.round(sum * 0.12), total: Math.round(sum * 1.12), address: o.deliveryAddress, payType: "Pul o'tkazish", batch: "demo", createdById: buh.id } });
  }

  // ── Davomat: faol xodimlar, so'nggi 30 kun (yakshanba dam) ──
  const emps = await db.employee.findMany({ where: { isActive: true }, select: { id: true } });
  const rows: Prisma.AttendanceCreateManyInput[] = [];
  for (let off = -30; off <= 0; off++) {
    const sunday = at(off).getDay() === 0;
    for (const e of emps) {
      const r = rnd();
      const status: AttendanceStatus = sunday ? "DAYOFF" : r < 0.05 ? "ABSENT" : r < 0.08 ? "SICK" : r < 0.1 ? "LEAVE" : "PRESENT";
      rows.push({ employeeId: e.id, date: dateOnly(off), status, checkIn: status === "PRESENT" ? `08:${String(int(0, 25)).padStart(2, "0")}` : null, checkOut: status === "PRESENT" && off < 0 ? `18:${String(int(0, 30)).padStart(2, "0")}` : null, note: TAG, markedById: prorab.id });
    }
  }
  const att = await db.attendance.createMany({ data: rows, skipDuplicates: true });

  // ── Ishlab chiqarish hisobotlari (direktorga) — so'nggi kunlar suratini lib'ning o'zi quradi ──
  try {
    const { buildReport, reportSummary } = await import("../src/lib/production-report");
    for (let off = -5; off <= -1; off++) {
      const d = at(off); if (d.getDay() === 0) continue;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const snap = await buildReport(iso);
      await db.productionReport.create({ data: { date: dateOnly(off), data: snap as unknown as Prisma.InputJsonValue, summary: reportSummary(snap), note: TAG, createdById: ishlab.id, createdAt: at(off, 18, 30), seenAt: off < -1 ? at(off + 1, 9) : null, seenById: off < -1 ? director.id : null } });
    }
  } catch (e) {
    console.warn("Ishlab chiqarish hisoboti o'tkazib yuborildi:", (e as Error).message);
  }

  const counts = await Promise.all([
    db.order.count({ where: { note: { startsWith: TAG } } }), db.trip.count({ where: { note: TAG } }), db.productionBatch.count({ where: { note: TAG } }),
    db.brigadeTask.count({ where: { note: TAG } }), db.supplyRequest.count({ where: { note: { startsWith: TAG } } }), db.cashTransaction.count({ where: { note: { startsWith: TAG } } }),
  ]);
  console.log(`\nDemo tayyor: ${counts[0]} zayavka, ${counts[1]} reys, ${counts[2]} zames, ${counts[3]} brigada topshirig'i, ${counts[4]} talabnoma, ${counts[5]} kassa yozuvi, ${att.count} davomat.`);
}

async function main() {
  await remove();
  if (!process.argv.includes("--remove")) await create();
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
