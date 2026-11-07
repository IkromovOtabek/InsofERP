// QA (B) — Haydovchilar tabeli: dispetcherning qo'lda yozuvi (reys tizimga tushmagan ish, haq, kirim) va «Oylik hisoblash»
// da BARCHA haydovchi/transport (ECO'ga ulanmagan, reysi yo'q). Oqim: dispetcher yozadi → ish boshqaruvchi tasdiqlaydi
// (oylik — vedomostga `tripPayByDriver`, naqd — kassaga mexanik so'rovi «Reys haqi», transport xarajatiga qayta yozilmaydi) yoki
// rad etadi; bekor qilish sababi bilan, naqdi kassaga o'tgani bekor qilinmaydi; kirim/haq Avtotransport tahliliga tushadi;
// dispetcher transport chiqimini yoza oladi. Ishga tushirish: npx tsx scripts/qa/b-logi-entry.mts (b-all.sh ichida)
import { as, check, summary, fd, q, q1, n1, token } from "./b-client.mjs";

const LA = "(app)/logistika/actions";
const P = "/logistika/tabel?bolim=qolda";
const disp = await as("dispetcher"), prorab = await as("prorab"), sklad = await as("sklad"), kassa = await as("kassa");
const { tripPayByDriver } = await import("../../src/lib/driver-trip-pay");
const { avtoReport } = await import("../../src/lib/fin-report/avto");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);

// ECO'ga ulanmagan, shu oyda reysi yo'q haydovchi (haydovchi lavozimida)
const pos = q1(`select name from "WorkPosition" where "isDriver" and "isActive" order by name limit 1`) ?? "Haydovchi";
const DRV = `qa_drv_${tag}`, NAME = `QA Qolda Haydovchi ${tag}`;
q(`insert into "Employee" (id, "fullName", position, "isActive", "createdAt") values (${lit(DRV)}, ${lit(NAME)}, ${lit(pos)}, true, now())`);
const veh = q1(`select id from "Vehicle" where "isActive" and not external order by plate limit 1`)!;
const plate = q1(`select plate from "Vehicle" where id=${lit(veh)}`)!;
const avtoRow = async () => (await avtoReport(from, to, { vehicleId: veh })).rows[0]!;
const base = await avtoRow();

// ── «Oylik hisoblash»: reysi yo'q, ECO'siz haydovchi ham ro'yxatda; transport kesimi ──
let g = await disp.get("/logistika/tabel?bolim=oylik");
check(g.status === 200 && g.text.includes(NAME), "oylik hisoblash: reysi yo'q ECO'siz haydovchi ham ko'rinadi", g.status);
g = await disp.get("/logistika/tabel?bolim=oylik&kesim=transport");
check(g.status === 200 && g.text.includes(plate), "oylik hisoblash: transport kesimi (kirim/chiqim/foyda) ochildi", g.status);

// ── Tekshiruvlar ──
const entry = (o: Record<string, string | number> = {}) => fd({ date: today, driverId: DRV, vehicleId: veh, note: "QA zavoddan tashqari ish", clientToken: token(), ...o });
let r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ payAmount: "", revenue: "" })], P);
check(/haqi yoki kirim/.test(r.error ?? ""), "summasiz yozuv rad etildi", r.error);
r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ driverId: "", payAmount: 100000, payType: "PAYROLL" })], P);
check(/haydovchini tanlang/.test(r.error ?? ""), "haq haydovchisiz rad etildi", r.error);
r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ payAmount: 100000 })], P);
check(/To'lov turini/.test(r.error ?? ""), "haq to'lov turisiz rad etildi", r.error);
r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ vehicleId: "", revenue: 100000 })], P);
check(/transportni tanlang/.test(r.error ?? ""), "kirim transportsiz rad etildi", r.error);
r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ payAmount: 100000, payType: "PAYROLL", note: "" })], P);
check(!!r.error, "izohsiz rad etildi", r.error);
r = await sklad.action(`${LA}#createEntryAction`, [undefined, entry({ payAmount: 100000, payType: "PAYROLL" })], P);
check(!r.ok && (r.forbidden || !!r.error), "sklad qo'lda yozuv qila olmaydi");

// ── Yozuvlar: oylik haq (ikki marta yuborilsa bitta), naqd haq + kirim, faqat kirim, rad etiladigan ──
const tk = token();
r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ trips: 2, km: 80, payAmount: 300000, payType: "PAYROLL", clientToken: tk })], P);
check(r.ok, "dispetcher oylik haq yozdi (2 reys, 80 km)", r.error ?? r.text.slice(0, 200));
await disp.action(`${LA}#createEntryAction`, [undefined, entry({ trips: 2, km: 80, payAmount: 300000, payType: "PAYROLL", clientToken: tk })], P);
const ePay = q1(`select id from "LogisticsEntry" where "clientToken"=${lit(tk)}`)!;
check(n1(`select count(*) from "LogisticsEntry" where "driverId"=${lit(DRV)} and "payType"='PAYROLL'`) === 1, "bir kalit bilan ikki marta — bitta yozuv");
check(/^QY-\d{4}-\d{5}$/.test(q1(`select "docNo" from "LogisticsEntry" where id=${lit(ePay)}`) ?? ""), "hujjat raqami QY-YYYY-00001");
check(n1(`select count(*) from "AuditLog" where entity='LogisticsEntry' and "entityId"=${lit(ePay)} and action='CREATE'`) === 1, "yozuv AuditLog'da");
const tc = token();
r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ payAmount: 150000, payType: "CASH", revenue: 500000, clientToken: tc })], P);
check(r.ok, "naqd haq + kirim yozildi", r.error);
const eCash = q1(`select id from "LogisticsEntry" where "clientToken"=${lit(tc)}`)!;
const tr = token();
r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ driverId: "", revenue: 200000, note: "QA ijaraga berildi", clientToken: tr })], P);
check(r.ok, "faqat kirim (haydovchisiz) yozildi", r.error);
const eRev = q1(`select id from "LogisticsEntry" where "clientToken"=${lit(tr)}`)!;
const tj = token();
await disp.action(`${LA}#createEntryAction`, [undefined, entry({ payAmount: 99000, payType: "PAYROLL", clientToken: tj })], P);
const eRej = q1(`select id from "LogisticsEntry" where "clientToken"=${lit(tj)}`)!;

// Tasdiqdan oldin: vedomostga tushmaydi, «kutmoqda» ogohlantirishi bor; naqd hisoblanmaydi
let tp = (await tripPayByDriver(from, to, [DRV])).get(DRV);
check(!tp?.sum && tp?.unpriced === 2, "tasdiqsiz oylik haq vedomostga tushmadi (2 ta kutmoqda)", tp);
g = await prorab.get("/logistika/tabel?bolim=tasdiq");
check(g.status === 200 && g.text.includes("Qo&#x27;lda yozilgan haq") && g.text.includes(NAME), "ish boshqaruvchi tasdiq ro'yxatida qo'lda haq", g.status);

// ── Tasdiq / rad: faqat ish boshqaruvchi ──
r = await disp.action(`${LA}#approveEntriesAction`, [[ePay]], P);
check(!r.ok && !q1(`select "payApprovedAt" from "LogisticsEntry" where id=${lit(ePay)}`), "dispetcher o'zi tasdiqlay olmaydi", r.error);
r = await prorab.action(`${LA}#rejectEntryAction`, [eRej, undefined, fd({ reason: "x" })], "/logistika/tabel?bolim=tasdiq");
check(/sababini/.test(r.error ?? ""), "rad etish sababsiz bo'lmaydi", r.error);
r = await prorab.action(`${LA}#rejectEntryAction`, [eRej, undefined, fd({ reason: "QA ikki marta yozilgan" })], "/logistika/tabel?bolim=tasdiq");
check(r.ok && /^Rad etildi: QA ikki marta/.test(q1(`select "cancelReason" from "LogisticsEntry" where id=${lit(eRej)} and "cancelledAt" is not null`) ?? ""), "ish boshqaruvchi rad etdi — yozuv sababi bilan bekor", r.error);
r = await prorab.action(`${LA}#approveEntriesAction`, [[ePay, eCash]], "/logistika/tabel?bolim=tasdiq");
check(r.ok, "ish boshqaruvchi oylik va naqd haqni tasdiqladi", r.error);
const mech = q(`select m.status, m.problem, m.amount::int, m."vehicleId", m.payee from "MechanicRequest" m join "LogisticsEntry" e on e."mechanicRequestId"=m.id where e.id=${lit(eCash)}`)[0];
check(mech?.[0] === "APPROVED" && mech[1] === "Reys haqi" && mech[2] === "150000" && mech[3] === veh && mech[4] === NAME, "naqd haq kassaga o'tdi (mexanik so'rovi, tasdiqlangan)", mech);
check(!q1(`select "mechanicRequestId" from "LogisticsEntry" where id=${lit(ePay)}`), "oylik haq kassaga o'tmaydi");
tp = (await tripPayByDriver(from, to, [DRV])).get(DRV);
check(tp?.sum === 300000 && tp.trips === 2 && tp.km === 80 && tp.unpriced === 0, "vedomost: oylik haq 300 000 (2 reys, 80 km), naqdi kirmaydi", tp);
r = await prorab.action(`${LA}#approveEntriesAction`, [[ePay]], "/logistika/tabel?bolim=tasdiq");
check(!r.ok, "ikkinchi marta tasdiqlanmaydi", r.error);

// ── Avtotransport tahlili: haq ish haqiga, kirim daromadga (rad etilgani kirmaydi) ──
let a = await avtoRow();
check(Math.round(a.pay - base.pay) === 450000 && Math.round(a.revenue - base.revenue) === 700000, "avtotransport: haq +450 000, kirim +700 000", [a.pay - base.pay, a.revenue - base.revenue]);
check(Math.abs(a.total - (a.fuelSum + a.pay + a.repair + a.other)) < 0.01 && Math.abs(a.profit - (a.revenue - a.total)) < 0.01, "avtotransport: chiqim va foyda formulasi saqlandi");

// ── Bekor qilish: sababi bilan; naqdi kassaga o'tgani bekor qilinmaydi ──
r = await disp.action(`${LA}#cancelEntryAction`, [eCash, "QA xato"], P);
check(/kassaga o'tgan/.test(r.error ?? ""), "kassaga o'tgan naqd haq bekor qilinmaydi", r.error);
r = await disp.action(`${LA}#cancelEntryAction`, [eRev, ""], P);
check(/sababini/.test(r.error ?? ""), "sababsiz bekor qilinmaydi", r.error);
r = await disp.action(`${LA}#cancelEntryAction`, [eRev, "QA ijara bo'lmadi"], P);
check(r.ok && !!q1(`select "cancelledAt" from "LogisticsEntry" where id=${lit(eRev)}`), "kirim yozuvi bekor qilindi (o'chirilmadi)", r.error);
check(n1(`select count(*) from "AuditLog" where entity='LogisticsEntry' and "entityId"=${lit(eRev)} and action='STATUS_CHANGE'`) === 1, "bekor qilish AuditLog'da");
r = await disp.action(`${LA}#cancelEntryAction`, [eRev, "yana"], P);
check(/allaqachon/.test(r.error ?? ""), "ikkinchi marta bekor qilinmaydi", r.error);
a = await avtoRow();
check(Math.round(a.revenue - base.revenue) === 500000, "bekor qilingan kirim avtotransportdan chiqdi", a.revenue - base.revenue);

// ── Kassa naqd haqni beradi: kategoriya «Ish haqi», transport xarajatiga qayta yozilmaydi ──
const mechId = q1(`select "mechanicRequestId" from "LogisticsEntry" where id=${lit(eCash)}`)!;
const bank = q(`select id, "allowOverdraft" from "CashAccount" where type='BANK' and "isActive" order by name limit 1`)[0];
if (bank) {
  q(`update "CashAccount" set "allowOverdraft"=true where id=${lit(bank[0]!)}`);
  r = await kassa.action("(app)/mexanik-sorovlar/actions#pay", [mechId, undefined, fd({ cashAccountId: bank[0]! })], `/mexanik-sorovlar/${mechId}`);
  q(`update "CashAccount" set "allowOverdraft"=${bank[1] === "t"} where id=${lit(bank[0]!)}`);
  const paid = q(`select m.status, c.category, m."transportExpenseId" from "MechanicRequest" m left join "CashTransaction" c on c.id=m."cashTxId" where m.id=${lit(mechId)}`)[0];
  check(paid?.[0] === "PAID" && paid[1] === "Ish haqi" && !paid[2], "kassa berdi: chiqim «Ish haqi», transport xarajati yozilmadi", [r.error, paid]);
  a = await avtoRow();
  check(Math.round(a.pay - base.pay) === 450000, "to'langandan keyin ham haq bir marta sanaladi", a.pay - base.pay);
}

// ── Oylikka yozib bo'lmaydigan oy: ish haqi vedomosti tasdiqlangan ──
const locked = q1(`select month from "PayrollRun" where kind='FINAL' and status in ('APPROVED','PAID') order by month desc limit 1`);
if (locked) {
  r = await disp.action(`${LA}#createEntryAction`, [undefined, entry({ date: `${locked}-10`, payAmount: 100000, payType: "PAYROLL" })], P);
  check(/vedomosti tasdiqlangan/.test(r.error ?? ""), `vedomosti yopilgan oyga (${locked}) oylik haq yozilmaydi`, r.error);
}

// ── Dispetcher transport chiqimini yozadi (Transport xarajatlari bilan bitta manba) ──
r = await disp.action(`${LA}#addExpense`, [undefined, fd({ kind: "ROAD", amount: "25000", date: today, vehicleId: veh, note: `QA dispetcher yo'l ${tag}` })], P);
check(r.ok && n1(`select count(*) from "TransportExpense" where note=${lit(`QA dispetcher yo'l ${tag}`)} and "vehicleId"=${lit(veh)}`) === 1, "dispetcher transport chiqimini yozdi", r.error);
a = await avtoRow();
check(Math.round(a.other - base.other) === 25000, "chiqim avtotransportga tushdi (boshqa)", a.other - base.other);

// ── Tahrirlash (qalam): kassaga o'tgan naqd / bekor qilingan rad; tasdiqlangan oylik haq summasi o'zgarsa — qayta tasdiq ──
const upd = (o: Record<string, string | number> = {}) => fd({ date: today, driverId: DRV, vehicleId: veh, trips: 2, km: 80, payAmount: 300000, payType: "PAYROLL", note: "QA zavoddan tashqari ish", ...o });
r = await disp.action(`${LA}#updateEntryAction`, [eCash, undefined, upd({ payAmount: 160000, payType: "CASH" })], P);
check(/kassaga o'tgan/.test(r.error ?? ""), "kassaga o'tgan naqd haq tahrirlanmaydi", r.error);
r = await disp.action(`${LA}#updateEntryAction`, [eRev, undefined, upd()], P);
check(/Bekor qilingan/.test(r.error ?? ""), "bekor qilingan yozuv tahrirlanmaydi", r.error);
r = await sklad.action(`${LA}#updateEntryAction`, [ePay, undefined, upd({ note: "QA sklad" })], P);
check(!r.ok && q1(`select note from "LogisticsEntry" where id=${lit(ePay)}`) !== "QA sklad", "sklad qo'lda yozuvni tahrirlay olmaydi");
r = await disp.action(`${LA}#updateEntryAction`, [ePay, undefined, upd({ payType: "" })], P);
check(/To'lov turini/.test(r.error ?? ""), "tahrirda haq to'lov turisiz rad etildi", r.error);
r = await disp.action(`${LA}#updateEntryAction`, [ePay, undefined, upd({ km: 95, note: `QA tuzatilgan izoh ${tag}` })], P);
check(r.ok && q1(`select note from "LogisticsEntry" where id=${lit(ePay)}`) === `QA tuzatilgan izoh ${tag}` && n1(`select km::int from "LogisticsEntry" where id=${lit(ePay)}`) === 95
  && !!q1(`select "payApprovedAt" from "LogisticsEntry" where id=${lit(ePay)}`), "izoh va km tahrirlandi — haq o'zgarmagani uchun tasdiq saqlandi", r.error);
check(n1(`select count(*) from "AuditLog" where entity='LogisticsEntry' and "entityId"=${lit(ePay)} and action='UPDATE'`) === 1, "tahrir AuditLog'da (UPDATE)");
r = await disp.action(`${LA}#updateEntryAction`, [ePay, undefined, upd({ km: 95, payAmount: 320000 })], P);
check(r.ok && n1(`select "payAmount"::int from "LogisticsEntry" where id=${lit(ePay)}`) === 320000 && !q1(`select "payApprovedAt" from "LogisticsEntry" where id=${lit(ePay)}`),
  "tasdiqlangan oylik haq summasi o'zgardi — qayta ish boshqaruvchi tasdig'iga qaytdi", r.error);
tp = (await tripPayByDriver(from, to, [DRV])).get(DRV);
check(!tp?.sum && tp?.unpriced === 1, "qayta tasdiqgacha vedomostga tushmaydi (1 ta kutmoqda)", tp);
r = await prorab.action(`${LA}#approveEntriesAction`, [[ePay]], "/logistika/tabel?bolim=tasdiq");
tp = (await tripPayByDriver(from, to, [DRV])).get(DRV);
check(r.ok && tp?.sum === 320000, "qayta tasdiqdan keyin vedomost: 320 000", [r.error, tp]);

// ── Sahifalar ──
g = await disp.get(P);
check(g.status === 200 && g.text.includes('aria-label="Tahrirlash"'), "«Qo'lda yozuvlar»: qatorda tahrirlash tugmasi", g.status);
check(g.status === 200 && g.text.includes(q1(`select "docNo" from "LogisticsEntry" where id=${lit(ePay)}`)!) && g.text.includes("Bekor qilingan"), "«Qo'lda yozuvlar» sahifasi: yozuvlar va bekor qilingani", g.status);
g = await disp.get(`/logistika/tabel?bolim=oylik&driver=${DRV}`);
check(g.status === 200 && g.text.includes("Qo&#x27;lda yozilgan haq"), "haydovchi oyligi: qo'lda yozilgan haq ko'rinadi", g.status);
g = await sklad.get(P);
check(g.status !== 200 || !g.text.includes(NAME), "sklad tabelni ko'rmaydi", g.status);

summary("b-logi-entry");
process.exit();
