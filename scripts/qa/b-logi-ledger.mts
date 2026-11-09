// QA (B) — Haydovchilar tabeli → «Hisob varag'i» (dispetcher Excel'i, mashina bo'yicha varaq): ECO'ga tushmagan reys qo'lda
// qator bo'lib yoziladi (zapravka `FuelLog`, ta'mir/zapchast/vulkanizator `TransportExpense` shu qatorga bog'lanadi),
// bekor qilinsa ular ham bekor bo'ladi; reys qatorida ECO bermagan km / baraban soati qo'lda yoziladi; reysi yo'q mashinaning
// xarajati «reyssiz» qator bo'lib ko'rinadi. Logistika va dispetcher (`logistika.ledger`), sklad — yo'q.
// Ishga tushirish: npx tsx scripts/qa/b-logi-ledger.mts (b-all.sh ichida)
import { as, check, summary, fd, q, q1, n1, token } from "./b-client.mjs";

const LA = "(app)/logistika/actions";
const disp = await as("dispetcher"), logist = await as("logistika"), sklad = await as("sklad"), prorab = await as("prorab");
const { driverLedger } = await import("../../src/lib/driver-ledger");
const { avtoReport } = await import("../../src/lib/fin-report/avto");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);

// Metanli test mashinasi (norma: 100 km ga 50 m³, soatiga 4 m³) va haydovchi
const pos = q1(`select name from "WorkPosition" where "isDriver" and "isActive" order by name limit 1`) ?? "Haydovchi";
const DRV = `qa_ldrv_${tag}`, NAME = `QA Varaq Haydovchi ${tag}`;
q(`insert into "Employee" (id, "fullName", position, "isActive", "createdAt") values (${lit(DRV)}, ${lit(NAME)}, ${lit(pos)}, true, now())`);
const VEH = `qa_lveh_${tag}`, PLATE = `01Q${tag}`;
q(`insert into "Vehicle" (id, plate, type, "isActive", "fuelType", "fuelNormL100", "idleNormPerHour")
   values (${lit(VEH)}, ${lit(PLATE)}, 'MIXER', true, 'METHANE', 50, 4)`);
const P = `/logistika/tabel?bolim=hisob&transport=${VEH}`;
const sheet = async (vehicleId = VEH) => (await driverLedger(from, to, { vehicleId })).rows;

const row = (o: Record<string, string | number> = {}) => fd({
  date: today, vehicleId: VEH, driverId: DRV, pickup: "Zavod", dropoff: `QA Obyekt ${tag}`, cargo: "M-250 10 m³", trips: 1, clientToken: token(), ...o,
});

// ── Rad etiladiganlar ──
let r = await disp.action(`${LA}#createLedgerRowAction`, [undefined, row({ vehicleId: "", km: 10 })], P);
check(/Transportni tanlang/.test(r.error ?? ""), "transportsiz qator rad etildi", r.error);
r = await disp.action(`${LA}#createLedgerRowAction`, [undefined, row({ revenue: 100000 })], P);
check(/Kirim turini/.test(r.error ?? ""), "kirim turisiz rad etildi", r.error);
r = await disp.action(`${LA}#createLedgerRowAction`, [undefined, row({ payAmount: 50000 })], P);
check(/To'lov turini/.test(r.error ?? ""), "haq to'lov turisiz rad etildi", r.error);
r = await sklad.action(`${LA}#createLedgerRowAction`, [undefined, row({ km: 10 })], P);
check(!r.ok && (r.forbidden || !!r.error), "sklad qator qo'sha olmaydi");

// ── To'liq qator (Excel'dagidek): km, baraban, zapravka, haq (naqd), ta'mir, vulkanizator, kirim (obyekt) ──
const tk = token();
r = await disp.action(`${LA}#createLedgerRowAction`, [undefined, row({
  km: 30, drumHours: 4.5, refuel: 50, fuelPrice: 5200, payAmount: 120000, payType: "CASH", repair: 100000, vulc: 30000,
  revenue: 500000, revenueType: "OBJECT", note: "Tun 22:30", clientToken: tk,
})], P);
check(r.ok, "dispetcher to'liq qator qo'shdi", r.error ?? r.text.slice(0, 200));
await disp.action(`${LA}#createLedgerRowAction`, [undefined, row({ km: 30, clientToken: tk })], P);
check(n1(`select count(*) from "LogisticsEntry" where "clientToken"=${lit(tk)}`) === 1, "bir kalit bilan ikki marta — bitta qator");
const E = q1(`select id from "LogisticsEntry" where "clientToken"=${lit(tk)}`)!;
const e = q(`select pickup, dropoff, cargo, "drumHours"::float, km::float, "revenueType", "payType", "payAmount"::int from "LogisticsEntry" where id=${lit(E)}`)[0];
check(e?.[0] === "Zavod" && e[1] === `QA Obyekt ${tag}` && e[2] === "M-250 10 m³" && e[3] === "4.5" && e[4] === "30" && e[5] === "OBJECT" && e[6] === "CASH" && e[7] === "120000", "qator maydonlari saqlandi", e);
const fuel = q(`select liters::float, "pricePerL"::int, amount::int, "fuelType", "driverId" from "FuelLog" where "entryId"=${lit(E)} and "cancelledAt" is null`);
check(fuel.length === 1 && fuel[0]![0] === "50" && fuel[0]![1] === "5200" && fuel[0]![2] === "260000" && fuel[0]![3] === "METHANE" && fuel[0]![4] === DRV, "zapravka FuelLog'ga qatorga bog'lanib yozildi (metan)", fuel);
const costs = q(`select kind, amount::int, note from "TransportExpense" where "entryId"=${lit(E)} and "cancelledAt" is null order by kind::text`);
check(costs.length === 2 && costs[0]![0] === "OTHER" && costs[0]![1] === "30000" && /Vulkanizatsiya/.test(costs[0]![2]!) && costs[1]![0] === "REPAIR" && costs[1]![1] === "100000", "ta'mir va vulkanizator TransportExpense'ga bog'lanib yozildi", costs);
check(n1(`select count(*) from "AuditLog" where entity in ('LogisticsEntry','FuelLog','TransportExpense') and ("entityId"=${lit(E)} or "entityId" in (select id from "FuelLog" where "entryId"=${lit(E)}) or "entityId" in (select id from "TransportExpense" where "entryId"=${lit(E)})) and action='CREATE'`) === 4, "qator, zapravka va 2 xarajat AuditLog'da");

// ── Hisob varag'i: qator Excel ustunlarida ──
let rows = await sheet();
const me = rows.find((x) => x.kind === "entry" && x.id === E);
check(!!me && me.km === 30 && me.workHours === 4.5 && me.drumUse === 18 && me.use === 33 && me.refuel === 50, "varaq: km 30, baraban 4,5 soat → baraban sarfi 18, jami sarf 33 m³, zapravka 50", me && [me.km, me.workHours, me.drumUse, me.use, me.refuel]);
check(!!me && me.repair === 100000 && me.vulc === 30000 && me.revOther === 500000 && me.pay === 120000 && me.payType === "CASH", "varaq: ta'mir, vulkanizator, obyekt kirimi, naqd haq", me && [me.repair, me.vulc, me.revOther, me.pay, me.payType]);
check(!!me && Math.abs(me.balAfter - (me.balBefore + 50 - 33)) < 0.11, "varaq: gaz qoldig'i = oldingi + zapravka − sarf", me && [me.balBefore, me.balAfter]);
check(!!me && Math.abs(me.profit - (me.revenue - me.total)) < 0.01 && Math.abs(me.total - (me.fuelSum + me.pay + me.repair + me.parts + me.vulc + me.other)) < 0.01, "varaq: jami xarajat va foyda formulasi");

// Faqat km (haqsiz, kirimsiz) qator ham yoziladi — ECO'siz reys; logistika ham qo'sha oladi
r = await logist.action(`${LA}#createLedgerRowAction`, [undefined, row({ km: 12, drumHours: 2, driverId: "", dropoff: `QA Logist ${tag}` })], P);
check(r.ok, "logistika faqat km/baraban qatorini qo'shdi", r.error);
const E2 = q1(`select id from "LogisticsEntry" where dropoff=${lit(`QA Logist ${tag}`)}`)!;
rows = await sheet();
check(rows.filter((x) => x.kind === "entry").length === 2, "varaqda ikkala qo'lda qator", rows.map((x) => x.kind));

// Avtotransport tahlili ham shu qatorni ko'radi (reys, km, soat)
const a = (await avtoReport(from, to, { vehicleId: VEH })).rows[0]!;
check(a.trips === 2 && Math.round(a.km) === 42 && Math.round(a.hours * 10) === 65 && Math.round(a.pay) === 120000 && Math.round(a.revenue) === 500000, "avtotransport: 2 reys, 42 km, 6,5 soat, haq va kirim", [a.trips, a.km, a.hours, a.pay, a.revenue]);

// ── Sahifa ──
let g = await disp.get(P);
const docNo = q1(`select "docNo" from "LogisticsEntry" where id=${lit(E)}`)!;
check(g.status === 200 && g.text.includes(docNo) && g.text.includes(PLATE) && g.text.includes("Qator qo&#x27;shish"), "hisob varag'i: mashina tabi, qo'lda qator va «Qator qo'shish»", g.status);
g = await prorab.get(P);
check(g.status === 200 && !g.text.includes("Qator qo&#x27;shish"), "ish boshqaruvchi varaqni ko'radi, qator qo'shmaydi", g.status);

// ── Qatorni tahrirlash (qalam, hamma ustun): bitta yozuv — joyida, 0 — bekor, yangisi qatorga bog'lanadi; AuditLog'da ──
const LE = `${LA}#updateLedgerRowAction`;
const edit = (o: Record<string, string | number> = {}) => fd({
  date: today, vehicleId: VEH, driverId: DRV, pickup: "Zavod", dropoff: `QA Obyekt ${tag}`, cargo: "M-250 10 m³", trips: 1, km: 30, drumHours: 4.5,
  refuel: 50, fuelPrice: 5200, payAmount: 120000, payType: "CASH", repair: 100000, parts: "", vulc: 30000, other: "", revenue: 500000, revenueType: "OBJECT", note: "Tun 22:30", ...o,
});
const fuelId = q1(`select id from "FuelLog" where "entryId"=${lit(E)} and "cancelledAt" is null`)!;
r = await sklad.action(LE, ["entry", E, undefined, edit({ km: 31 })], P);
check(!r.ok && n1(`select km::int from "LogisticsEntry" where id=${lit(E)}`) === 30, "sklad varaq qatorini tahrirlay olmaydi");
const changed = { km: 40, pickup: "Sklad-2", cargo: "M-300 8 m³", refuel: 60, repair: 0, parts: 70000, other: 15000 };
r = await disp.action(LE, ["entry", E, undefined, edit(changed)], P);
check(r.ok, "dispetcher qo'lda qatorni tahrirladi (km, joy, yuk, zapravka, xarajatlar)", r.error ?? r.text.slice(0, 200));
const e2 = q(`select km::int, pickup, cargo from "LogisticsEntry" where id=${lit(E)}`)[0];
check(e2?.[0] === "40" && e2[1] === "Sklad-2" && e2[2] === "M-300 8 m³", "qator: km, yuklash joyi va yuk yangilandi", e2);
const f2 = q(`select id, liters::float, amount::int from "FuelLog" where "entryId"=${lit(E)} and "cancelledAt" is null`);
check(f2.length === 1 && f2[0]![0] === fuelId && f2[0]![1] === "60" && f2[0]![2] === "312000", "zapravka o'sha yozuvda 60 ga o'zgardi (summa 312 000)", f2);
const c2 = q(`select kind, amount::int, note from "TransportExpense" where "entryId"=${lit(E)} and "cancelledAt" is null order by kind::text, amount`);
check(c2.length === 3 && c2[0]![1] === "15000" && /Boshqa/.test(c2[0]![2]!) && c2[1]![1] === "30000" && /Vulkaniz/.test(c2[1]![2]!) && c2[2]![0] === "PARTS" && c2[2]![1] === "70000",
  "xarajat: ta'mir bekor, zapchast va boshqa xarajat yangi, vulkanizator o'zgarmadi", c2);
check(/Hisob varag'ida tahrirlandi/.test(q1(`select "cancelReason" from "TransportExpense" where "entryId"=${lit(E)} and kind='REPAIR'`) ?? ""), "bekor qilingan ta'mir sababi — varaqdagi tahrir");
check(n1(`select count(*) from "AuditLog" where entity='FuelLog' and "entityId"=${lit(fuelId)} and action='UPDATE'`) === 1, "zapravka o'zgarishi AuditLog'da");
rows = await sheet();
const me2 = rows.find((x) => x.kind === "entry" && x.id === E);
check(!!me2 && me2.km === 40 && me2.refuel === 60 && me2.repair === 0 && me2.parts === 70000 && me2.vulc === 30000 && me2.other === 15000 && me2.pickup === "Sklad-2",
  "varaq yangi qiymatlarni ko'rsatadi", me2 && [me2.km, me2.refuel, me2.repair, me2.parts, me2.vulc, me2.other, me2.pickup]);
const expN = n1(`select count(*) from "TransportExpense" where "entryId"=${lit(E)}`);
r = await disp.action(LE, ["entry", E, undefined, edit(changed)], P);
check(r.ok && n1(`select count(*) from "TransportExpense" where "entryId"=${lit(E)}`) === expN && n1(`select count(*) from "AuditLog" where entity='FuelLog' and "entityId"=${lit(fuelId)} and action='UPDATE'`) === 1,
  "o'zgarishsiz qayta saqlash — zapravka va xarajat yozuvlariga tegilmadi", r.error);
r = await disp.action(LE, ["entry", E, undefined, edit({ ...changed, revenueType: "" })], P);
check(/Kirim turini/.test(r.error ?? ""), "tahrirda kirim turisiz rad etildi", r.error);

// ── Bekor qilish: zapravka va xarajat ham bekor bo'ladi ──
r = await logist.action(`${LA}#cancelEntryAction`, [E2, "QA xato yozildi"], P);
check(r.ok && !!q1(`select "cancelledAt" from "LogisticsEntry" where id=${lit(E2)}`), "logistika o'z qatorini bekor qildi", r.error);
r = await disp.action(`${LA}#cancelEntryAction`, [E, "QA qayta yoziladi"], P);
check(r.ok, "dispetcher to'liq qatorni bekor qildi", r.error);
check(n1(`select count(*) from "FuelLog" where "entryId"=${lit(E)} and "cancelledAt" is null`) === 0 && n1(`select count(*) from "TransportExpense" where "entryId"=${lit(E)} and "cancelledAt" is null`) === 0, "qator bilan zapravka va xarajatlar ham bekor qilindi");
check(/QY-.*bekor qilindi: QA qayta/.test(q1(`select "cancelReason" from "FuelLog" where "entryId"=${lit(E)}`) ?? ""), "zapravka bekor sababi qatorga ishora qiladi");
rows = await sheet();
check(!rows.some((x) => x.kind === "entry"), "bekor qilingan qatorlar varaqdan chiqdi", rows.map((x) => x.kind));

// ── Reysi ham, qatori ham yo'q mashina: xarajati «reyssiz» qator bo'lib ko'rinadi ──
r = await disp.action(`${LA}#addExpense`, [undefined, fd({ kind: "REPAIR", amount: "45000", date: today, vehicleId: VEH, note: `QA reyssiz ta'mir ${tag}` })], P);
check(r.ok, "reysi yo'q mashinaga ta'mir yozildi", r.error);
rows = await sheet();
const cost = rows.find((x) => x.kind === "cost");
check(!!cost && cost.repair === 45000 && cost.remarks.some((t) => t.includes(`QA reyssiz ta'mir ${tag}`)), "reyssiz kun qatori: ta'mir va izohi", rows.map((x) => [x.kind, x.repair]));
// Reyssiz kunni tahrirlash: ta'mir summasi o'sha yozuvda, zapravka — mashinaga yangi yozuv
r = await disp.action(LE, ["cost", cost!.id, undefined, fd({ refuel: 20, fuelPrice: 5000, repair: 50000 })], P);
check(r.ok, "reyssiz kun qatori tahrirlandi", r.error);
rows = await sheet();
const cost2 = rows.find((x) => x.kind === "cost");
check(!!cost2 && cost2.repair === 50000 && cost2.refuel === 20, "reyssiz kun: ta'mir 50 000, zapravka 20", cost2 && [cost2.repair, cost2.refuel]);
check(n1(`select count(*) from "TransportExpense" where "vehicleId"=${lit(VEH)} and note=${lit(`QA reyssiz ta'mir ${tag}`)} and "cancelledAt" is null and amount=50000`) === 1
  && n1(`select count(*) from "FuelLog" where "vehicleId"=${lit(VEH)} and "cancelledAt" is null and "entryId" is null and "tripId" is null and liters=20 and amount=100000`) === 1,
  "ta'mir yozuvi joyida o'zgardi, zapravka mashinaga yozildi");

// ── Reys qatorida km / baraban soatini qo'lda yozish ──
const trip = q1(`select id from "Trip" where status='DELIVERED' order by "deliveredAt" desc limit 1`);
if (trip) {
  const before = q(`select "payKm"::float, "workHours"::float from "Trip" where id=${lit(trip)}`)[0];
  r = await sklad.action(`${LA}#fixTripKmAction`, [trip, undefined, fd({ km: "77", hours: "3" })], P);
  check(!r.ok, "sklad reys km'ini o'zgartira olmaydi");
  r = await disp.action(`${LA}#fixTripKmAction`, [trip, undefined, fd({ km: "", hours: "" })], P);
  check(/Km yoki baraban/.test(r.error ?? ""), "bo'sh km va soat rad etildi", r.error);
  r = await disp.action(`${LA}#fixTripKmAction`, [trip, undefined, fd({ km: "77", hours: "3" })], P);
  const after = q(`select "payKm"::float, "workHours"::float from "Trip" where id=${lit(trip)}`)[0];
  check(r.ok && after?.[0] === "77" && after[1] === "3", "dispetcher reysga km 77 va baraban 3 soat yozdi", [r.error, after]);
  check(n1(`select count(*) from "AuditLog" where entity='Trip' and "entityId"=${lit(trip)} and action='UPDATE' and after::text like '%Hisob varag%'`) >= 1, "km tuzatish AuditLog'da (oldingi qiymat bilan)", before);

  // Reys qatorini tahrirlash: yuklash joyi, km, izoh; zapravka/xarajat va haq o'zgarmasa — tegilmaydi
  const [tv, td] = q(`select "vehicleId", "deliveredAt" from "Trip" where id=${lit(trip)}`)[0]!;
  const at = new Date(td!);
  const tr = (await driverLedger(new Date(at.getFullYear(), at.getMonth(), 1), new Date(at.getFullYear(), at.getMonth() + 1, 1), { vehicleId: tv! })).rows.find((x) => x.kind === "trip" && x.id === trip)!;
  const costN = n1(`select (select count(*) from "FuelLog" where "vehicleId"=${lit(tv!)}) + (select count(*) from "TransportExpense" where "vehicleId"=${lit(tv!)} or "tripId"=${lit(trip)})`);
  const tripEdit = fd({
    pickup: `QA BRU ${tag}`, km: "78", drumHours: "3", note: `QA reys izohi ${tag}`, payAmount: "",
    refuel: tr.refuel, fuelPrice: tr.refuelPrice ?? "", repair: tr.repair, parts: tr.parts, vulc: tr.vulc, other: tr.other,
  });
  r = await sklad.action(LE, ["trip", trip, undefined, tripEdit], P);
  check(!r.ok, "sklad reys qatorini tahrirlay olmaydi");
  r = await disp.action(LE, ["trip", trip, undefined, tripEdit], P);
  const t2 = q(`select "pickupAddress", "payKm"::float, "deliveryComment" from "Trip" where id=${lit(trip)}`)[0];
  check(r.ok && t2?.[0] === `QA BRU ${tag}` && t2[1] === "78" && t2[2] === `QA reys izohi ${tag}`, "reys qatori: yuklash joyi, km 78 va izoh yozildi", [r.error, t2]);
  check(n1(`select (select count(*) from "FuelLog" where "vehicleId"=${lit(tv!)}) + (select count(*) from "TransportExpense" where "vehicleId"=${lit(tv!)} or "tripId"=${lit(trip)})`) === costN,
    "reys tahririda o'zgarmagan zapravka/xarajatga yangi yozuv qo'shilmadi");
} else check(true, "yetkazilgan reys yo'q — km tuzatish o'tkazib yuborildi");
const notDelivered = q1(`select id from "Trip" where status<>'DELIVERED' limit 1`);
if (notDelivered) {
  r = await disp.action(`${LA}#fixTripKmAction`, [notDelivered, undefined, fd({ km: "10" })], P);
  check(/yetkazilgan reys/.test(r.error ?? ""), "yetkazilmagan reys km'i tuzatilmaydi", r.error);
  r = await disp.action(LE, ["trip", notDelivered, undefined, fd({ km: "10" })], P);
  check(/yetkazilgan reys/.test(r.error ?? ""), "yetkazilmagan reys qatori tahrirlanmaydi", r.error);
}

summary("b-logi-ledger");
process.exit();
