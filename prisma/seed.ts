import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";
import { audit } from "../src/lib/audit";
import { roleForPosition } from "../src/lib/positions";
import { nextNo } from "../src/lib/numbering";

const db = new PrismaClient();

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
const inDays = (n: number) => new Date(Date.now() + n * 86400000);

async function main() {
  const pw = await bcrypt.hash("admin123", 10);
  await db.user.upsert({
    where: { login: "admin" },
    update: {},
    create: { login: "admin", passwordHash: pw, fullName: "Direktor", role: "DIRECTOR" },
  });

  await db.companySettings.upsert({
    where: { id: "main" },
    update: {},
    create: {
      id: "main",
      name: "Insof beton zavodi",
      legalName: "INSOF BETON MChJ",
      phone: "+998 90 000 00 00",
      address: "Toshkent viloyati",
      about: "Zamonaviy avtomatlashtirilgan liniyada M100–M400 markali tayyor beton ishlab chiqaramiz. Har bir partiya laboratoriya nazoratidan o'tadi, o'z mikserlarimiz bilan obyektga yetkazib beramiz.",
      foundedYear: 2020,
    },
  });

  const wh = await db.warehouse.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main", name: "Asosiy sklad" },
  });

  const materials = [
    { code: "CEM",   name: "Sement M400",        unit: "kg", minStock: 20000 },
    { code: "SAND",  name: "Qum",                unit: "kg", minStock: 50000 },
    { code: "GR520", name: "Shag'al 5-20",       unit: "kg", minStock: 50000 },
    { code: "ADD",   name: "Plastifikator",      unit: "l",  minStock: 200 },
    { code: "WATER", name: "Suv",                unit: "l",  minStock: 0 },
  ];
  for (const m of materials) {
    await db.material.upsert({ where: { code: m.code }, update: {}, create: m });
  }

  const products = [
    { code: "M200", name: "Beton M200 (B15)",   strengthClass: "B15",   price: 550000 },
    { code: "M250", name: "Beton M250 (B20)",   strengthClass: "B20",   price: 600000 },
    { code: "M300", name: "Beton M300 (B22.5)", strengthClass: "B22.5", price: 650000 },
    { code: "M350", name: "Beton M350 (B25)",   strengthClass: "B25",   price: 700000 },
    { code: "USTUN", name: "Beton ustun 2.5 m",  strengthClass: "B22.5", price: 180000, unit: "dona" },
    { code: "FBS24", name: "FBS blok 24.4.6",    strengthClass: "B15",   price: 250000, unit: "dona" },
  ];
  for (const p of products) {
    await db.product.upsert({ where: { code: p.code }, update: {}, create: p });
  }

  const byCode = async (c: string) => (await db.material.findUniqueOrThrow({ where: { code: c } })).id;

  // Namuna retsept: M300, 1 m3 (taxminiy normalar — laborant aniqlashtiradi)
  const m300 = await db.product.findUniqueOrThrow({ where: { code: "M300" } });
  const existing = await db.recipe.findFirst({ where: { productId: m300.id } });
  if (!existing) {
    await db.recipe.create({
      data: {
        productId: m300.id,
        version: 1,
        items: {
          create: [
            { materialId: await byCode("CEM"),   qtyPerM3: 380 },
            { materialId: await byCode("SAND"),  qtyPerM3: 700 },
            { materialId: await byCode("GR520"), qtyPerM3: 1100 },
            { materialId: await byCode("WATER"), qtyPerM3: 180 },
            { materialId: await byCode("ADD"),   qtyPerM3: 3.8 },
          ],
        },
      },
    });
  }

  // Qolgan markalar uchun ham retsept (taxminiy normalar)
  const recipeDefs: Record<string, Record<string, number>> = {
    M200:  { CEM: 320, SAND: 750, GR520: 1100, WATER: 175, ADD: 2.5 },
    M250:  { CEM: 350, SAND: 720, GR520: 1100, WATER: 178, ADD: 3.0 },
    M350:  { CEM: 420, SAND: 680, GR520: 1120, WATER: 182, ADD: 4.2 },
    USTUN: { CEM: 55,  SAND: 120, GR520: 190,  WATER: 28,  ADD: 0.5 },
    FBS24: { CEM: 40,  SAND: 90,  GR520: 140,  WATER: 20,  ADD: 0.4 },
  };
  for (const [code, mix] of Object.entries(recipeDefs)) {
    const product = await db.product.findUniqueOrThrow({ where: { code } });
    if (await db.recipe.findFirst({ where: { productId: product.id } })) continue;
    await db.recipe.create({
      data: {
        productId: product.id,
        version: 1,
        items: { create: await Promise.all(Object.entries(mix).map(async ([mCode, qtyPerM3]) => ({ materialId: await byCode(mCode), qtyPerM3 }))) },
      },
    });
  }

  await db.cashAccount.createMany({
    data: [
      { name: "Kassa", type: "CASH" },
      { name: "Asosiy hisob raqam", type: "BANK" },
    ],
    skipDuplicates: true,
  });

  console.log("Asosiy ma'lumotlar tayyor. Login: admin / admin123");

  // ───────────────────────── Namunaviy (sun'iy) ma'lumotlar ─────────────────────────
  // Bazada avvaldan qo'lda kiritilgan test yozuvlar bo'lishi mumkin — ular saqlanadi,
  // bu blok faqat bitta marker-mijoz (INN bo'yicha) yo'q bo'lsa ishga tushadi.
  if (await db.customer.findFirst({ where: { inn: "301234561" } })) {
    console.log("Namunaviy ma'lumotlar allaqachon mavjud, o'tkazib yuborildi.");
    return;
  }

  const cash = await db.cashAccount.findFirstOrThrow({ where: { type: "CASH" } });
  const bank = await db.cashAccount.findFirstOrThrow({ where: { type: "BANK" } });

  // ── Xodimlar / tizim foydalanuvchilari ──
  // "Sotuv" bo'limi uchun login avvaldan bor bo'lsa (sotuv1) — o'shani ishlatamiz.
  let salesUser = await db.user.findFirst({ where: { role: "SALES" } });
  const roleUsersDef = [
    { login: "prod1",  fullName: "Bahrom Qodirov",     position: "Ishlab chiqarish" },
    { login: "log1",   fullName: "Sardor Aliyev",      position: "Logistika" },
    { login: "sklad1", fullName: "Gulnora Tosheva",    position: "Sklad" }, // kirim va yetkazuvchilar ham shu bo'limda
    { login: "prorab1", fullName: "Sanjar Ergashev",   position: "Ish boshqaruvchi" },
    { login: "buh1",   fullName: "Nodira Karimova",    position: "Buxgalteriya" },
    { login: "hr1",    fullName: "Madina Tursunova",   position: "Otdel kadr" },
    { login: "kassa1", fullName: "Shahnoza Rustamova", position: "Kassa / bank" },
  ];
  if (!salesUser) {
    salesUser = await db.user.create({ data: { login: "sotuv1", passwordHash: await bcrypt.hash("parol123", 10), fullName: "Dilnoza Yusupova", role: "SALES" } });
    await db.employee.create({ data: { fullName: salesUser.fullName, position: "Sotuv", userId: salesUser.id } });
  }
  const staffPw = await bcrypt.hash("parol123", 10);
  const roleUsers: Record<string, { userId: string }> = {};
  for (const u of roleUsersDef) {
    const role = roleForPosition(u.position)!;
    const user = await db.user.create({ data: { login: u.login, passwordHash: staffPw, fullName: u.fullName, role } });
    await db.employee.create({ data: { fullName: u.fullName, position: u.position, userId: user.id } });
    roleUsers[u.login] = { userId: user.id };
  }
  const salesId = salesUser.id, prodId = roleUsers.prod1.userId, logId = roleUsers.log1.userId, skladId = roleUsers.sklad1.userId;

  // Login'siz ishchi xodimlar — mavjud haydovchilar bilan birga ishlatiladi
  const existingDrivers = await db.employee.findMany({ where: { position: "Haydovchi" } });
  const workers = [
    { fullName: "Anvar Xolmatov",   position: "Haydovchi", phone: "+998 91 333 44 55" },
    { fullName: "Bekzod Ismoilov",  position: "Operator",  phone: "+998 91 444 55 66" },
    { fullName: "Farrux Saidov",    position: "Laborant",  phone: "+998 91 555 66 77" },
    { fullName: "Ulug'bek Nematov", position: "Skladchi",  phone: "+998 91 666 77 88" },
  ];
  const driverIds: string[] = existingDrivers.map((d) => d.id);
  for (const w of workers) {
    const e = await db.employee.create({ data: w });
    if (w.position === "Haydovchi") driverIds.push(e.id);
  }

  // ── Texnika — mavjud mikserlar bilan birga ishlatiladi ──
  const existingMixers = await db.vehicle.findMany({ where: { type: "MIXER" } });
  const [newMixer1, newMixer2] = await Promise.all([
    db.vehicle.create({ data: { plate: "01D321GH", type: "MIXER", capacityM3: 8 } }),
    db.vehicle.create({ data: { plate: "01H654JK", type: "MIXER", capacityM3: 5 } }),
  ]);
  const mixers = [...existingMixers, newMixer1, newMixer2].sort((a, b) => Number(b.capacityM3 ?? 0) - Number(a.capacityM3 ?? 0));
  const mixer3 = mixers.find((m) => Number(m.capacityM3 ?? 0) >= 8) ?? mixers[0];
  const mixer1 = mixers.find((m) => Number(m.capacityM3 ?? 0) >= 6 && m.id !== mixer3.id) ?? mixer3;
  const mixer2 = mixers.find((m) => Number(m.capacityM3 ?? 0) >= 6 && m.id !== mixer3.id && m.id !== mixer1.id) ?? mixer1;

  // ── Mijozlar ──
  const [c1, c2, c3, c4, c5, c6, c7, c8] = await Promise.all([
    db.customer.create({ data: { name: "Toshkent Qurilish Konsalting MChJ", inn: "301234561", phone: "+998 71 200 10 01", address: "Toshkent sh., Mirzo Ulug'bek t." } }),
    db.customer.create({ data: { name: "Toshkent Uy-Joy Qurilish", inn: "301234562", phone: "+998 71 200 10 02", address: "Toshkent sh., Yashnobod t." } }),
    db.customer.create({ data: { name: "AVJ Solutions MChJ", inn: "301234563", phone: "+998 71 200 10 03", address: "Toshkent sh., Chilonzor t." } }),
    db.customer.create({ data: { name: "Chilonzor Invest", inn: "301234564", phone: "+998 71 200 10 04", address: "Toshkent sh., Chilonzor t., 19-kvartal" } }),
    db.customer.create({ data: { name: "Bunyodkor Qurilish", inn: "301234565", phone: "+998 71 200 10 05", address: "Toshkent sh., Yakkasaroy t." } }),
    db.customer.create({ data: { name: "Aziz Rahimov", phone: "+998 90 123 45 67", address: "Toshkent sh., Sergeli t., shaxsiy uy" } }),
    db.customer.create({ data: { name: "Yunusobod Mega Qurilish", inn: "301234567", phone: "+998 71 200 10 07", address: "Toshkent sh., Yunusobod t." } }),
    db.customer.create({ data: { name: "Green House Construction", inn: "301234568", phone: "+998 71 200 10 08", address: "Toshkent viloyati, Qibray t." } }),
  ]);

  // ── Brigadalar ──
  const brigadir1 = await db.employee.create({ data: { fullName: "Rustam Xolmatov", position: "Master", phone: "+998 90 111 22 33" } });
  const brigadir2 = await db.employee.create({ data: { fullName: "Sherzod Mirzayev", position: "Master", phone: "+998 90 444 55 66" } });
  await db.brigade.create({ data: { name: "1-brigada (ustun, blok)", leaderId: brigadir1.id, phone: brigadir1.phone } });
  await db.brigade.create({ data: { name: "2-brigada (beton)", leaderId: brigadir2.id, phone: brigadir2.phone } });

  // ── Yetkazuvchilar ──
  const [supCem, supKar, supChem] = await Promise.all([
    db.supplier.create({ data: { name: "Qizilqum Sement MChJ", inn: "200987651", phone: "+998 71 233 00 01" } }),
    db.supplier.create({ data: { name: "Angren Karyera", inn: "200987652", phone: "+998 71 233 00 02" } }),
    db.supplier.create({ data: { name: "ChemAdd Plastifikator", inn: "200987653", phone: "+998 71 233 00 03" } }),
  ]);
  await db.supplier.create({ data: { name: "Toshkent Beton Materiallari", inn: "200987654", phone: "+998 71 233 00 04" } });

  // ── Kirim (snabjeniye): sklad to'ldiriladi ──
  async function makeReceipt(supplierId: string, date: Date, items: { code: string; qty: number; price: number }[]) {
    const rec = await db.goodsReceipt.create({
      data: {
        docNo: await nextNo(db, "goodsReceipt", "K"),
        date, supplierId, warehouseId: wh.id,
        items: { create: await Promise.all(items.map(async (i) => ({ materialId: await byCode(i.code), qty: i.qty, price: i.price }))) },
      },
    });
    await db.stockMove.createMany({
      data: await Promise.all(items.map(async (i) => ({
        type: "RECEIPT" as const, date, warehouseId: wh.id, materialId: await byCode(i.code),
        qty: i.qty, unitCost: i.price, refType: "GoodsReceipt", refId: rec.id, createdById: skladId,
      }))),
    });
    await audit(db, skladId, "CREATE", "GoodsReceipt", rec.id, undefined, rec);
    return rec;
  }
  await makeReceipt(supCem.id, daysAgo(12), [{ code: "CEM", qty: 55000, price: 950 }]);
  await makeReceipt(supKar.id, daysAgo(11), [{ code: "SAND", qty: 100000, price: 120 }, { code: "GR520", qty: 150000, price: 150 }]);
  await makeReceipt(supChem.id, daysAgo(10), [{ code: "ADD", qty: 500, price: 18000 }]);
  await makeReceipt(supCem.id, daysAgo(9), [{ code: "WATER", qty: 20000, price: 200 }]);

  // ── Zayavkalar ──
  async function makeOrder(customerId: string, status: "DRAFT" | "CONFIRMED" | "IN_PRODUCTION" | "DELIVERED" | "CLOSED" | "BLOCKED" | "CANCELLED",
    date: Date, deliveryDate: Date, deliveryAddress: string, needsPump: boolean,
    items: { code: string; qtyM3: number; price: number }[]) {
    const o = await db.order.create({
      data: {
        orderNo: await nextNo(db, "order", "Z"),
        date, status, deliveryDate, deliveryAddress, needsPump, customerId, createdById: salesId,
        items: { create: await Promise.all(items.map(async (i) => ({ productId: (await db.product.findUniqueOrThrow({ where: { code: i.code } })).id, qtyM3: i.qtyM3, price: i.price }))) },
      },
      include: { items: true },
    });
    await audit(db, salesId, "CREATE", "Order", o.id, undefined, o);
    return o;
  }

  const order1 = await makeOrder(c1.id, "DELIVERED", daysAgo(9), daysAgo(7), "Mirzo Ulug'bek t., Bobur ko'chasi 12", false, [{ code: "M300", qtyM3: 24, price: 650000 }]);
  const order2 = await makeOrder(c2.id, "DELIVERED", daysAgo(8), daysAgo(6), "Yashnobod t., Farg'ona yo'li 45", false, [{ code: "M250", qtyM3: 18, price: 600000 }]);
  const order3 = await makeOrder(c3.id, "IN_PRODUCTION", daysAgo(4), daysAgo(2), "Chilonzor t., 7-kvartal", false, [{ code: "M200", qtyM3: 16, price: 550000 }, { code: "USTUN", qtyM3: 20, price: 180000 }]);
  await makeOrder(c4.id, "CONFIRMED", daysAgo(1), inDays(2), "Chilonzor t., 19-kvartal", false, [{ code: "M300", qtyM3: 12, price: 650000 }]);
  await makeOrder(c5.id, "DRAFT", new Date(), inDays(3), "Yakkasaroy t., Mustaqillik ko'chasi 5", false, [{ code: "M350", qtyM3: 20, price: 700000 }]);
  await makeOrder(c6.id, "DRAFT", new Date(), inDays(4), "Sergeli t., shaxsiy hovli", false, [{ code: "FBS24", qtyM3: 200, price: 250000 }]);
  const order7 = await makeOrder(c7.id, "BLOCKED", daysAgo(3), daysAgo(1), "Yunusobod t., 4-kvartal", false, [{ code: "M300", qtyM3: 90, price: 650000 }]);
  await audit(db, salesId, "STATUS_CHANGE", "Order", order7.id, { status: "DRAFT" }, { status: "BLOCKED" });
  const order8 = await makeOrder(c8.id, "CANCELLED", daysAgo(10), daysAgo(8), "Qibray t., sanoat zonasi", false, [{ code: "M250", qtyM3: 25, price: 600000 }]);
  await audit(db, salesId, "STATUS_CHANGE", "Order", order8.id, { status: "DRAFT" }, { status: "CANCELLED" });
  const order9 = await makeOrder(c1.id, "DELIVERED", daysAgo(7), daysAgo(5), "Mirzo Ulug'bek t., Amir Temur ko'chasi 88", false, [{ code: "M200", qtyM3: 30, price: 550000 }]);
  await makeOrder(c2.id, "CONFIRMED", daysAgo(1), inDays(2), "Yashnobod t., Farg'ona yo'li 45", true, [{ code: "M300", qtyM3: 24, price: 650000 }]);

  // ── Ishlab chiqarish: zameslar (retsept bo'yicha xomashyo chiqimi + tayyor beton kirimi) ──
  async function makeBatch(order: { id: string; items: { productId: string; qtyM3: unknown }[] }, code: string, qtyM3: number, date: Date, shift: number) {
    const product = await db.product.findUniqueOrThrow({ where: { code } });
    const recipe = await db.recipe.findFirstOrThrow({ where: { productId: product.id, isActive: true }, include: { items: true } });
    const b = await db.productionBatch.create({
      data: { batchNo: await nextNo(db, "productionBatch", "ZM"), date, shift, orderId: order.id, productId: product.id, recipeId: recipe.id, qtyM3, createdById: prodId },
    });
    await db.stockMove.createMany({
      data: [
        ...recipe.items.map((i) => ({ type: "PRODUCTION_CONSUME" as const, date, warehouseId: wh.id, materialId: i.materialId, qty: -(Number(i.qtyPerM3) * qtyM3), refType: "ProductionBatch", refId: b.id, createdById: prodId })),
        { type: "PRODUCTION_OUTPUT" as const, date, warehouseId: wh.id, productId: product.id, qty: qtyM3, refType: "ProductionBatch", refId: b.id, createdById: prodId },
      ],
    });
    await audit(db, prodId, "CREATE", "ProductionBatch", b.id, undefined, b);
    return b;
  }
  await makeBatch(order1, "M300", 24, daysAgo(7), 1);
  await makeBatch(order2, "M250", 18, daysAgo(6), 1);
  await makeBatch(order3, "M200", 16, daysAgo(2), 2);
  await makeBatch(order9, "M200", 30, daysAgo(5), 1);

  // ── Reyslar: mikser bo'yicha yetkazib berish (skladdan chiqim) ──
  async function makeTrip(order: { id: string }, productCode: string, vehicleId: string, driverId: string, qtyM3: number, date: Date, receiverName: string) {
    const product = await db.product.findUniqueOrThrow({ where: { code: productCode } });
    const t = await db.trip.create({
      data: {
        deliveryNoteNo: await nextNo(db, "trip", "N"),
        orderId: order.id, vehicleId, driverId, qtyM3, status: "DELIVERED", loadedAt: date, deliveredAt: date, receiverName, createdAt: date,
      },
    });
    await db.stockMove.create({ data: { type: "SHIPMENT", date, warehouseId: wh.id, productId: product.id, qty: -qtyM3, refType: "Trip", refId: t.id, createdById: logId } });
    await audit(db, logId, "CREATE", "Trip", t.id, undefined, t);
    return t;
  }
  await makeTrip(order1, "M300", mixer3.id, driverIds[0], 8, daysAgo(6), "Aziz Karimov (prorab)");
  await makeTrip(order1, "M300", mixer3.id, driverIds[0], 8, daysAgo(6), "Aziz Karimov (prorab)");
  await makeTrip(order1, "M300", mixer3.id, driverIds[1], 8, daysAgo(6), "Aziz Karimov (prorab)");
  await makeTrip(order2, "M250", mixer1.id, driverIds[1], 6, daysAgo(5), "Bekzod Yusupov (prorab)");
  await makeTrip(order2, "M250", mixer1.id, driverIds[1], 6, daysAgo(5), "Bekzod Yusupov (prorab)");
  await makeTrip(order2, "M250", mixer1.id, driverIds[2], 6, daysAgo(5), "Bekzod Yusupov (prorab)");
  await makeTrip(order9, "M200", mixer2.id, driverIds[0], 6, daysAgo(4), "Sherali Nazarov (prorab)");
  await makeTrip(order9, "M200", mixer2.id, driverIds[0], 6, daysAgo(4), "Sherali Nazarov (prorab)");
  await makeTrip(order9, "M200", mixer2.id, driverIds[1], 6, daysAgo(4), "Sherali Nazarov (prorab)");
  await makeTrip(order9, "M200", mixer2.id, driverIds[2], 6, daysAgo(3), "Sherali Nazarov (prorab)");
  await makeTrip(order9, "M200", mixer2.id, driverIds[2], 6, daysAgo(3), "Sherali Nazarov (prorab)");

  // ── Schyotlar va to'lovlar ──
  async function makeInvoice(order: { id: string; customerId: string }, amount: number, date: Date) {
    const inv = await db.invoice.create({ data: { invoiceNo: await nextNo(db, "invoice", "S"), date, customerId: order.customerId, orderId: order.id, amount } });
    await audit(db, roleUsers.buh1.userId, "CREATE", "Invoice", inv.id, undefined, inv);
    return inv;
  }
  async function makePayment(customerId: string, invoiceId: string | undefined, cashAccountId: string, amount: number, date: Date, note?: string) {
    const p = await db.payment.create({ data: { customerId, invoiceId, cashAccountId, amount, date, note } });
    await audit(db, roleUsers.kassa1.userId, "CREATE", "Payment", p.id, undefined, p);
    return p;
  }

  const inv1 = await makeInvoice(order1, 24 * 650000, daysAgo(5));
  await makePayment(c1.id, inv1.id, bank.id, 24 * 650000, daysAgo(4), "To'liq to'lov");
  await db.invoice.update({ where: { id: inv1.id }, data: { status: "PAID" } });
  await db.order.update({ where: { id: order1.id }, data: { status: "CLOSED" } });

  const inv2 = await makeInvoice(order2, 18 * 600000, daysAgo(4));
  await makePayment(c2.id, inv2.id, bank.id, 6_000_000, daysAgo(3), "Qisman to'lov");
  await db.invoice.update({ where: { id: inv2.id }, data: { status: "PARTIAL" } });

  const inv9 = await makeInvoice(order9, 30 * 550000, daysAgo(3));
  await makePayment(c1.id, inv9.id, cash.id, 30 * 550000, daysAgo(2), "Naqd to'liq to'lov");
  await db.invoice.update({ where: { id: inv9.id }, data: { status: "PAID" } });
  await db.order.update({ where: { id: order9.id }, data: { status: "CLOSED" } });

  // Avans — schyotsiz, mijoz hisobiga oldindan to'lov
  await makePayment(c5.id, undefined, cash.id, 5_000_000, daysAgo(1), "Oldindan to'lov (avans)");

  console.log("Namunaviy ma'lumotlar yaratildi: 8 mijoz, 4 yetkazuvchi, 2 yangi mikser, 12 yangi xodim, 10 zayavka, 4 zames, 11 reys, 3 schyot + to'lovlar.");
}

main().finally(() => db.$disconnect());
