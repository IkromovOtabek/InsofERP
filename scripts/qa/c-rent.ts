/**
 * QA (C) — Arenda: shartnoma (ijara davri), ijarachi almashuvi, «necha oyga» to'lov, narx o'zgarishi, svet hisobi (alohida qarz),
 * shartnoma muddati ogohlantirishi va bandlik tahlili. Server kerak emas — `lib/rent*.ts` to'g'ridan chaqiriladi.
 * Faqat lokal insof_test… bazasi (c-lib tekshiradi). Har yugurish o'z joyi (`QA Rent <tag>`) bilan — boshqa ma'lumotga
 * tegmaydi (faqat `openMonth` shu bazadagi barcha amaldagi shartnomalarga hisob ochadi — test bazasida bu kutilgan).
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-rent.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import {
  RENT_ELEC_CATEGORY, createRentTx, cancelRentTx, currentMonth, endRentLease, leaseDebts, monthKey, openMonth, saveRentShopData,
  shiftMonth, shopDebts, startRentLease, toggleRentShopActive, today,
} from "@/lib/rent";
import { rentDebtors, shopLedger } from "@/lib/rent-tenant";
import { rentReceipt } from "@/lib/rent-receipt";
import { elecSheet, leaseElecDebts, saveElecBill, saveRentElecData } from "@/lib/rent-elec";
import { addPriceChange, addPriceChangeBulk, rentOccupancy, runLeaseExpiry } from "@/lib/rent-contract";

async function main() {
  const tag = Date.now() % 1_000_000;
  const LOC = `QA Rent ${tag}`;
  const cur = currentMonth(), prev = shiftMonth(cur, -1), next = shiftMonth(cur, 1);
  const user = await db.user.findFirst({ select: { id: true } }) ?? await db.user.create({ data: { login: `qa.rent.${tag}`, passwordHash: "x", fullName: "QA Rent", role: "SECRETARY" } });
  const U = user.id;
  const setBefore = await db.companySettings.findUnique({ where: { id: "main" }, select: { rentKwhPrice: true, rentElecMarkup: true } });
  // Excel «Свет отчёт» dagi tarif: 1 kVt — 1100 so'm, ustama 8%
  await db.companySettings.upsert({ where: { id: "main" }, update: { rentKwhPrice: 1100, rentElecMarkup: 8 }, create: { id: "main", rentKwhPrice: 1100, rentElecMarkup: 8 } });
  const elecOf = async (leaseId: string) => (await leaseElecDebts([leaseId])).get(leaseId) ?? 0;
  const debtOf = async (leaseId: string) => (await leaseDebts([leaseId])).get(leaseId) ?? 0;

  try {
    section("1. Do'kon + shartnoma, oy hisobi, svet hisoblagichi");
    const a = await saveRentShopData(null, {
      name: "A-do'kon", location: LOC, bankAmount: 600_000, cashAmount: 400_000, electricity: 0, tax: 0, note: null, area: 20, payDay: 5,
      electricityBilled: true, elecFixed: 600_000, tenantName: "Ali", phone: "+998901112233", no: "1/QA", startDate: prev, endDate: new Date(today().getTime() + 5 * 86_400_000), deposit: 1_000_000,
    }, null, U);
    check("do'kon qo'shildi", !!a.id, a.error);
    const A = a.id!;
    const l1 = await db.rentLease.findFirstOrThrow({ where: { shopId: A } });
    check("amaldagi shartnoma ochildi (ijarachi, zaklad, muddat)", l1.status === "ACTIVE" && l1.tenantName === "Ali" && Number(l1.deposit) === 1_000_000 && !!l1.endDate);
    await openMonth(prev, U);
    const c1 = await db.rentCharge.findUnique({ where: { leaseId_month: { leaseId: l1.id, month: prev } } });
    check("o'tgan oy hisobi shartnomaga ochildi", !!c1 && Number(c1.bankDue) === 600_000 && Number(c1.cashDue) === 400_000);
    check("hisoblagichsiz oy: svet summasi = shartnoma bo'yicha 600 000", !!c1 && Number(c1.elecDue) === 600_000 && Number(c1.elecFixed) === 600_000, c1);
    // Excel: Parfyumeriya 3077 → 3215: farq 138, narxi 151 800, 8% 12 144, summasi 163 944
    let r = await saveRentElecData(l1.id, prev, { meterStart: 3077, meterEnd: 3215, amount: 0, paidDirect: 0, note: null }, U);
    const c1b = await db.rentCharge.findUniqueOrThrow({ where: { leaseId_month: { leaseId: l1.id, month: prev } } });
    check("svet: 138 kVt × 1100 = 151 800, +8% = 163 944", !r.error && Number(c1b.electricity) === 151_800 && Number(c1b.elecDue) === 163_944, r.error ?? c1b);
    r = await saveRentElecData(l1.id, prev, { meterStart: 3300, meterEnd: 3215, amount: 0, paidDirect: 0, note: null }, U);
    check("hozirgi < avvalgi — rad etildi", !!r.error);
    check("ijara qarzi svetsiz: 1 000 000; svet qarzi alohida: 163 944", (await debtOf(l1.id)) === 1_000_000 && (await elecOf(l1.id)) === 163_944, [await debtOf(l1.id), await elecOf(l1.id)]);
    const t1 = await createRentTx({ type: "INCOME", method: "CASH", date: today(), month: prev, shopId: A, amount: 1_000_000, category: "Arenda to'lovi", note: null, clientToken: null }, U);
    check("ijara to'lovi joriy shartnomaga yozildi, ijara qarzi 0", !t1.error && (await db.rentTx.findUnique({ where: { id: t1.id! } }))?.leaseId === l1.id && (await debtOf(l1.id)) === 0);
    const e1 = await createRentTx({ type: "INCOME", method: "BANK", date: today(), month: prev, shopId: A, amount: 600_000, category: RENT_ELEC_CATEGORY, note: "kartaga tashagan", clientToken: null }, U);
    check("svet to'lovi 600 000: svet qoldig'i −436 056 (Excel'dagidek), ijara qarziga tegmadi", !e1.error && (await elecOf(l1.id)) === -436_056 && (await debtOf(l1.id)) === 0, [await elecOf(l1.id), await debtOf(l1.id)]);
    const em = await createRentTx({ type: "INCOME", method: "CASH", date: today(), month: prev, shopId: A, amount: 1, category: RENT_ELEC_CATEGORY, note: null, clientToken: null, months: 2 }, U);
    check("svet to'lovi «necha oyga» bo'linmaydi", !!em.error);
    r = await saveRentElecData(l1.id, prev, { meterStart: 3077, meterEnd: 3215, amount: 0, paidDirect: 100_000, note: "litsevoyga tashadi" }, U);
    check("litsevoyga to'langan svet qarzini yopadi (kassaga kirmaydi)", !r.error && (await elecOf(l1.id)) === -536_056, await elecOf(l1.id));
    const sheet = (await elecSheet(prev)).groups.find((g) => g.location === LOC);
    const row = sheet?.rows.find((x) => x.leaseId === l1.id);
    check("svet varag'i: farq 138, ustama 12 144, berilgan 700 000, qoldiq −536 056", !!row && row.kwh === 138 && row.extra === 12_144 && row.paid === 700_000 && row.left === -536_056, row);
    await saveElecBill(LOC, prev, 4_100_000, null, U);
    check("joy bo'yicha «To'lashimiz kerak» saqlandi", (await elecSheet(prev)).groups.find((g) => g.location === LOC)?.bill === 4_100_000);
    await openMonth(cur, U);
    const c2 = await db.rentCharge.findUniqueOrThrow({ where: { leaseId_month: { leaseId: l1.id, month: cur } } });
    check("yangi oy: avvalgi ko'rsatkich = 3215, svet hali 0 (hisoblagich kutiladi), ijara nusxalandi", Number(c2.meterStart) === 3215 && Number(c2.elecDue) === 0 && Number(c2.bankDue) === 600_000, c2);

    section("2. Ijarachi almashuvi — eski qarz alohida");
    const sw = await startRentLease(A, { tenantName: "Vali", phone: "+998907776655", startDate: today(), bankAmount: 700_000, cashAmount: 400_000 }, U);
    check("ijarachi almashtirildi, shu oyga yangi hisob qo'shildi", !sw.error && !!sw.replaced && !!sw.charged, sw);
    const l1e = await db.rentLease.findUniqueOrThrow({ where: { id: l1.id } });
    const l2 = await db.rentLease.findUniqueOrThrow({ where: { id: sw.id! } });
    check("eski shartnoma ENDED (yangi boshlanishidan bir kun oldin)", l1e.status === "ENDED" && l1e.endedAt!.getTime() === today().getTime() - 86_400_000);
    check("do'kon: yangi ijarachi, narx yangilandi, Telegram uzildi", await db.rentShop.findUnique({ where: { id: A } }).then((s) => s?.tenantName === "Vali" && Number(s.bankAmount) === 700_000 && !s.tgChatId));
    check("eski ijarachi qarzi (shu oy) o'zida: 1 000 000", (await debtOf(l1.id)) === 1_000_000, await debtOf(l1.id));
    check("yangi ijarachi qarzi alohida: 1 100 000", (await debtOf(l2.id)) === 1_100_000, await debtOf(l2.id));
    check("do'kon kartasi qarzi = joriy (yangi) shartnoma", (await shopDebts()).get(A) === 1_100_000 && (await shopLedger(A)).leaseId === l2.id);
    const debtors = (await rentDebtors()).filter((d) => d.id === A);
    check("qarzdorlarda ikkalasi: joriy va «sobiq ijarachi»", debtors.length === 2 && debtors.some((d) => d.former && d.leaseId === l1.id) && debtors.some((d) => !d.former && d.leaseId === l2.id), debtors.map((d) => [d.former, d.debt]));
    const bad = await startRentLease(A, { tenantName: "X", phone: "+998900000000", startDate: prev }, U);
    check("amaldagi shartnomadan oldingi sana bilan almashtirish rad etildi", !!bad.error);
    const old = await createRentTx({ type: "INCOME", method: "CASH", date: today(), month: cur, shopId: A, amount: 1_000_000, category: "Arenda to'lovi", note: null, clientToken: null, leaseId: l1.id }, U);
    check("sobiq ijarachi qarzi o'z shartnomasiga to'landi", !old.error && (await debtOf(l1.id)) === 0 && (await debtOf(l2.id)) === 1_100_000);

    section("3. «Necha oyga» to'lov");
    const tok = crypto.randomUUID();
    const b = await createRentTx({ type: "INCOME", method: "BANK", date: today(), month: cur, shopId: A, amount: 3_300_000, category: "Arenda to'lovi", note: null, clientToken: tok, months: 3 }, U);
    const batch = await db.rentTx.findMany({ where: { batchId: { not: null }, shopId: A }, orderBy: { month: "asc" } });
    check("3 ta yozuv, bitta guruh, oylar ketma-ket, har biri 1 100 000", !b.error && batch.length === 3 && new Set(batch.map((x) => x.batchId)).size === 1
      && batch.map((x) => monthKey(x.month!)).join() === [cur, next, shiftMonth(cur, 2)].map(monthKey).join() && batch.every((x) => Number(x.amount) === 1_100_000), batch.map((x) => [x.month, x.amount]));
    const dup = await createRentTx({ type: "INCOME", method: "BANK", date: today(), month: cur, shopId: A, amount: 3_300_000, category: "Arenda to'lovi", note: null, clientToken: tok, months: 3 }, U);
    check("qayta bosish — takror yozilmadi", !!dup.duplicate && (await db.rentTx.count({ where: { batchId: batch[0].batchId } })) === 3);
    const rc = await rentReceipt(batch[1].id);
    check("kvitansiya bitta: jami 3 300 000, 3 oy", !!rc && rc.amount === 3_300_000 && rc.count === 3 && rc.tx.id === batch[0].id && /3 oy/.test(rc.forLabel?.label ?? ""), rc && [rc.amount, rc.count, rc.forLabel]);
    check("avans: qarz = −2 200 000", (await debtOf(l2.id)) === -2_200_000, await debtOf(l2.id));
    const odd = await createRentTx({ type: "INCOME", method: "CASH", date: today(), month: cur, shopId: A, amount: 100, category: "Arenda to'lovi", note: null, clientToken: null, months: 3 }, U);
    const oddRows = await db.rentTx.findMany({ where: { id: odd.id! } }).then(async ([f]) => db.rentTx.findMany({ where: { batchId: f.batchId! } }));
    check("bo'linmaydigan summa: 33.33 + 33.33 + 33.34 = 100", oddRows.map((x) => Number(x.amount)).sort().join() === "33.33,33.33,33.34", oddRows.map((x) => x.amount));
    const cn = await cancelRentTx(batch[2].id, "QA: xato kiritildi", U);
    check("bittasini bekor qilish — butun guruh bekor", !cn.error && (await db.rentTx.count({ where: { batchId: batch[0].batchId, cancelledAt: null } })) === 0);
    await cancelRentTx(odd.id!, "QA sinov", U);
    check("bekordan keyin qarz qaytdi: 1 100 000", (await debtOf(l2.id)) === 1_100_000, await debtOf(l2.id));

    section("4. Narx o'zgarishi");
    let pc = await addPriceChange(A, { fromMonth: cur, bankAmount: 1, cashAmount: 1, note: null }, U);
    check("ochilgan oy uchun narx rad etildi", !!pc.error, pc);
    pc = await addPriceChange(A, { fromMonth: next, bankAmount: 800_000, cashAmount: 400_000, note: "QA" }, U);
    check("keyingi oydan yangi narx rejalashtirildi", !pc.error, pc.error);
    const opened = await openMonth(next, U);
    const c3 = await db.rentCharge.findUniqueOrThrow({ where: { leaseId_month: { leaseId: l2.id, month: next } } });
    check("oy ochilganda yangi narx qo'llandi (hisob va andoza)", opened.priced >= 1 && Number(c3.bankDue) === 800_000
      && Number((await db.rentShop.findUniqueOrThrow({ where: { id: A } })).bankAmount) === 800_000
      && !!(await db.rentPriceChange.findFirst({ where: { shopId: A, fromMonth: next } }))?.appliedAt);
    const bulk = await addPriceChangeBulk(LOC, { fromMonth: shiftMonth(cur, 3), percent: 10, note: null }, U);
    const pcb = await db.rentPriceChange.findFirst({ where: { shopId: A, fromMonth: shiftMonth(cur, 3) } });
    check("bozor bo'yicha +10%: 800 000 → 880 000", !bulk.error && bulk.created === 1 && Number(pcb?.bankAmount) === 880_000, [bulk, pcb?.bankAmount]);

    section("5. Bo'shatish va qayta ijaraga berish");
    const e = await endRentLease(A, { reason: "QA" }, U);
    const sA = await db.rentShop.findUniqueOrThrow({ where: { id: A } });
    check("joy bo'shatildi: shartnoma yopildi, rekvizitlar olindi", !e.error && !sA.isActive && !sA.tenantName && (await db.rentLease.findUniqueOrThrow({ where: { id: l2.id } })).status === "ENDED");
    await openMonth(shiftMonth(cur, 2), U);
    check("bo'sh joyga keyingi oy hisobi ochilmadi", (await db.rentCharge.count({ where: { shopId: A, month: shiftMonth(cur, 2) } })) === 0);
    const tg = await toggleRentShopActive(A, U);
    check("mobil tugma: bo'sh joyga bugundan shartnoma ochildi", !tg.error && tg.active === true && (await db.rentLease.count({ where: { shopId: A, status: "ACTIVE" } })) === 1);

    section("6. Kunlik ijara");
    const d = await saveRentShopData(null, { name: "B-joy", location: LOC, period: "DAILY", bankAmount: 0, cashAmount: 10_000, electricity: 0, tax: 0, note: null, area: 4, tenantName: "Sobir", phone: "+998901234567" }, null, U);
    const dm = await createRentTx({ type: "INCOME", method: "CASH", date: today(), month: cur, shopId: d.id!, amount: 20_000, category: "Arenda to'lovi", note: null, clientToken: null, day: today(), months: 2 }, U);
    check("kunlik ijarada «necha oyga» rad etildi", !!dm.error, dm);
    const nb = (await db.rentLease.findFirstOrThrow({ where: { shopId: d.id! } })).no ?? "";
    const tg2 = (await db.rentLease.findFirstOrThrow({ where: { shopId: A, status: "ACTIVE" } })).no ?? "";
    check("shartnoma raqami avtomatik: IJ-<yil>-NNNNN, ketma-ket; qo'lda yozilgani saqlanadi", /^IJ-\d{4}-\d{5}$/.test(nb) && /^IJ-\d{4}-\d{5}$/.test(tg2)
      && Number(nb.slice(-5)) === Number(tg2.slice(-5)) + 1 && l1.no === "1/QA", [tg2, nb, l1.no]);
    const vac = await saveRentShopData(null, { name: "C-bo'sh", location: LOC, bankAmount: 500_000, cashAmount: 0, electricity: 0, tax: 0, note: null, area: 10, isActive: false }, null, U);
    const vx = await createRentTx({ type: "INCOME", method: "CASH", date: today(), month: cur, shopId: vac.id!, amount: 1000, category: "Arenda to'lovi", note: null, clientToken: null }, U);
    check("hech qachon ijaraga berilmagan joyga kirim rad etildi", !!vx.error && (await db.rentLease.count({ where: { shopId: vac.id! } })) === 0, vx);

    section("7. Tahlil va shartnoma muddati");
    const occ = (await rentOccupancy()).rows.find((x) => x.location === LOC);
    check("bandlik: 3 joy, 2 ijarada, bo'sh 10 m², yo'qotish hisoblandi", !!occ && occ.total === 3 && occ.on === 2 && occ.areaOff === 10 && occ.area === 34 && (occ.lost ?? 0) > 0, occ);
    const exp = await saveRentShopData(null, { name: "D-muddat", location: LOC, bankAmount: 100_000, cashAmount: 0, electricity: 0, tax: 0, note: null, tenantName: "Muddat", phone: "+998909998877", payDay: 1, endDate: new Date(today().getTime() + 5 * 86_400_000) }, null, U);
    const before = await db.notification.count({ where: { type: "RENT_LEASE_EXPIRY" } });
    await runLeaseExpiry();
    const lx = await db.rentLease.findFirstOrThrow({ where: { shopId: exp.id! } });
    const after1 = await db.notification.count({ where: { type: "RENT_LEASE_EXPIRY" } });
    await runLeaseExpiry();
    const after2 = await db.notification.count({ where: { type: "RENT_LEASE_EXPIRY" } });
    check("5 kun qoldi — «7 kun» bosqichi belgilandi, takror yuborilmadi", lx.expiryNotice === 7 && after2 === after1, [lx.expiryNotice, before, after1, after2]);
    await saveRentShopData(exp.id!, { name: "D-muddat", location: LOC, bankAmount: 100_000, cashAmount: 0, electricity: 0, tax: 0, note: null, endDate: new Date(today().getTime() + 400 * 86_400_000) }, null, U);
    check("muddat uzaytirilsa ogohlantirish bosqichi tozalanadi", (await db.rentLease.findUniqueOrThrow({ where: { id: lx.id } })).expiryNotice === null);
  } finally {
    await db.companySettings.update({ where: { id: "main" }, data: { rentKwhPrice: setBefore?.rentKwhPrice ?? 0, rentElecMarkup: setBefore?.rentElecMarkup ?? 0 } });
    await db.$disconnect();
  }
}

main().then(() => done(), (e) => { console.error(e); process.exit(1); });
