// QA (B) — Logistika moliya (alohida hisob, 2026-11-12): faqat direktor, ish boshqaruvchi va mexanik ko'radi; logistika
// hisobidagi pul zavod kassasiga tushmaydi, zavod hisobidan berilgani kassada hujjatga bog'langan qator bo'ladi; o'tkazma
// zavod → logistika; logistika so'rovining (transport, reys haqi) pulini kassir emas, ish boshqaruvchi beradi (manba tanlab);
// oylik reys haqi logistika hisobidan to'lansa zavod vedomostiga tushmaydi, bekor qilinsa qaytadi.
// Ishga tushirish: npx tsx scripts/qa/b-logi-moliya.mts (b-all.sh ichida)
import { as, check, summary, fd, q, q1, n1, token } from "./b-client.mjs";

const LM = "(app)/logistika/moliya/actions";
const MX = "(app)/mexanik-sorovlar/actions";
const P = "/logistika/moliya?tab=jurnal";
const prorab = await as("prorab"), mexanik = await as("mexanik"), disp = await as("dispetcher"), logist = await as("logistika");
const kassa = await as("kassa"), buh = await as("buh");
const { tripPayByDriver } = await import("../../src/lib/driver-trip-pay");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
const from = new Date(now.getFullYear(), now.getMonth(), 1), to = new Date(now.getFullYear(), now.getMonth() + 1, 1);

const LACC = q1(`select id from "LogisticsAccount" where "isActive" order by "createdAt" limit 1`);
check(!!LACC, "sukut logistika hisobi bor (migratsiya)");
const L = `L:${LACC}`;
const cashAcc = q1(`select id from "CashAccount" where type='CASH' and "isActive" order by name limit 1`)!;
const userId = (login: string) => q1(`select id from "User" where login=${lit(login)}`)!;
const prorabId = userId("test.prorab"), mexId = userId("test.mexanik");
const veh = q1(`select id from "Vehicle" where "isActive" and not external order by plate limit 1`)!;
// Zavod kassasiga yetarli pul (o'tkazma va chiqim qoldiqdan oshmasin)
q(`insert into "CashTransaction" (id, date, type, "cashAccountId", amount, category, "createdById", "createdAt") values ('qa_lm_seed_${tag}', now(), 'INCOME', ${lit(cashAcc)}, 50000000, 'Boshqa tushum', ${lit(prorabId)}, now())`);
const cashBal = () => n1(`select coalesce(sum(case when type='INCOME' then amount else -amount end),0) from "CashTransaction" where "cashAccountId"=${lit(cashAcc)} and "cancelledAt" is null`)
  + n1(`select coalesce(sum(amount),0) from "Payment" where "cashAccountId"=${lit(cashAcc)}`);
const logiBal = () => n1(`select coalesce(sum(case when type='INCOME' then amount else -amount end),0) from "LogisticsTx" where "accountId"=${lit(LACC!)} and "cancelledAt" is null`);
const lastLm = () => q1(`select id from "LogisticsTx" order by "createdAt" desc limit 1`)!;
const tx = (o: Record<string, string | number>) => fd({ date: today, clientToken: token(), ...o });

// ── Kim ko'radi ──
for (const [c, name, ok] of [[prorab, "ish boshqaruvchi", true], [mexanik, "mexanik", true], [disp, "dispetcher", false], [logist, "logistika", false], [buh, "buxgalteriya", false], [kassa, "kassir", false]] as const) {
  const g = await c.get("/logistika/moliya?tab=jurnal");
  const seen = g.status === 200 && g.text.includes("Chiqim — logistika hisobidan");
  check(seen === ok, `${name}: Logistika moliya ${ok ? "ochiladi" : "yopiq"}`, g.status);
}

// ── O'tkazma: zavod kassasidan logistika hisobiga ──
let c0 = cashBal(), l0 = logiBal();
let r = await prorab.action(`${LM}#addTx`, [undefined, tx({ type: "INCOME", category: "Zavod hisobidan o'tkazma", source: L, fromCashAccountId: cashAcc, amount: 1000000 })], P);
check(r.ok, "o'tkazma: zavod → logistika yozildi", r.error ?? r.text.slice(0, 200));
const tr = lastLm();
check(logiBal() - l0 === 1000000 && c0 - cashBal() === 1000000, "o'tkazma: logistika +1 mln, zavod kassasi −1 mln");
check(n1(`select count(*) from "CashTransaction" where "refType"='LogisticsTx' and "refId"=${lit(tr)} and type='EXPENSE'`) === 1, "o'tkazma: kassada hujjatga bog'langan bitta qator");

// ── Logistika hisobidan chiqim: kassaga tushmaydi, mashina ta'miri Foydaga (transport xarajati) ──
c0 = cashBal(); l0 = logiBal();
r = await prorab.action(`${LM}#addTx`, [undefined, tx({ type: "EXPENSE", category: "Ta'mir", source: L, vehicleId: veh, counterparty: "QA usta", amount: 300000 })], P);
check(r.ok, "chiqim: logistika hisobidan yozildi", r.error ?? r.text.slice(0, 200));
const ex1 = lastLm();
check(l0 - logiBal() === 300000 && cashBal() === c0, "chiqim: logistika −300 ming, zavod kassasi o'zgarmadi");
check(n1(`select count(*) from "CashTransaction" where "refId"=${lit(ex1)}`) === 0, "chiqim: kassaga qator yozilmadi");
const te1 = q1(`select "transportExpenseId" from "LogisticsTx" where id=${lit(ex1)}`);
check(!!te1 && n1(`select count(*) from "TransportExpense" where id=${lit(te1 ?? "")} and kind='REPAIR' and "cancelledAt" is null`) === 1, "chiqim: mashina ta'miri transport xarajatiga tushdi");
check(/^LM-\d{4}-\d{5}$/.test(q1(`select "docNo" from "LogisticsTx" where id=${lit(ex1)}`) ?? ""), "hujjat raqami LM-YYYY-00001");
check(n1(`select count(*) from "AuditLog" where entity='LogisticsTx' and "entityId"=${lit(ex1)}`) >= 1, "yozuv AuditLog'da");

r = await prorab.action(`${LM}#addTx`, [undefined, tx({ type: "EXPENSE", category: "Boshqa chiqim", source: L, amount: 999999999 })], P);
check(/yetarli pul yo'q/.test(r.error ?? ""), "chiqim: logistika qoldig'idan oshsa rad etildi", r.error);

// ── Zavod kassasidan chiqim: kassada qisqa qator, logistika hisobi o'zgarmaydi ──
c0 = cashBal(); l0 = logiBal();
r = await prorab.action(`${LM}#addTx`, [undefined, tx({ type: "EXPENSE", category: "Yoqilg'i", source: cashAcc, amount: 200000 })], P);
check(r.ok, "chiqim: zavod kassasidan yozildi", r.error ?? r.text.slice(0, 200));
const ex2 = lastLm();
check(c0 - cashBal() === 200000 && logiBal() === l0, "zavod chiqimi: kassa −200 ming, logistika hisobi o'zgarmadi");
check(q1(`select category from "CashTransaction" where "refType"='LogisticsTx' and "refId"=${lit(ex2)}`) === "Transport", "zavod chiqimi: kassada «Transport» qatori, hujjatga bog'langan");

// ── Huquq: dispetcher va kassir yoza olmaydi ──
r = await disp.action(`${LM}#addTx`, [undefined, tx({ type: "EXPENSE", category: "Ta'mir", source: L, amount: 1000 })], P);
check(!r.ok, "dispetcher logistika moliyaga yoza olmaydi");
r = await kassa.action(`${LM}#addTx`, [undefined, tx({ type: "EXPENSE", category: "Ta'mir", source: cashAcc, amount: 1000 })], P);
check(!r.ok, "kassir logistika moliyaga yoza olmaydi");

// ── Bekor qilish: pul qaytadi, transport xarajati ham bekor ──
l0 = logiBal();
r = await prorab.action(`${LM}#cancelTx`, [ex1, undefined, fd({ reason: "QA xato yozuv" })], P);
check(r.ok, "chiqim bekor qilindi", r.error ?? r.text.slice(0, 200));
check(logiBal() - l0 === 300000, "bekor: logistika hisobiga 300 ming qaytdi");
check(n1(`select count(*) from "TransportExpense" where id=${lit(te1 ?? "")} and "cancelledAt" is not null`) === 1, "bekor: transport xarajati ham bekor");
c0 = cashBal();
r = await prorab.action(`${LM}#cancelTx`, [ex2, undefined, fd({ reason: "QA xato yozuv" })], P);
check(r.ok && cashBal() - c0 === 200000, "zavod chiqimi bekor: kassaga 200 ming qaytdi", r.error);

// ── Mexanik so'rovi: logistika so'rovini ish boshqaruvchi beradi, kassir emas ──
const MR = `qa_lm_mx_${tag}`, MF = `qa_lm_mf_${tag}`;
q(`insert into "MechanicRequest" (id, "docNo", target, "vehicleId", problem, amount, note, status, "createdById", "decidedById", "decidedAt", "createdAt")
   values (${lit(MR)}, 'MX-QA-${tag}', 'TRANSPORT', ${lit(veh)}, 'Ta''mir', 100000, 'QA transport ta''miri', 'APPROVED', ${lit(mexId)}, ${lit(prorabId)}, now(), now())`);
q(`insert into "MechanicRequest" (id, "docNo", target, object, problem, amount, note, status, "createdById", "decidedById", "decidedAt", "createdAt")
   values (${lit(MF)}, 'MX-QF-${tag}', 'FACTORY', 'Kompressor', 'Ta''mir', 70000, 'QA zavod ta''miri', 'APPROVED', ${lit(mexId)}, ${lit(prorabId)}, now(), now())`);
let g = await kassa.get("/mexanik-sorovlar?tab=APPROVED");
check(g.status === 200 && !g.text.includes(`MX-QA-${tag}`) && g.text.includes(`MX-QF-${tag}`), "kassir ro'yxatida faqat zavod so'rovi (logistika so'rovi yo'q)");
r = await kassa.action(`${MX}#pay`, [MR, undefined, fd({ cashAccountId: cashAcc })], `/mexanik-sorovlar/${MR}`);
check(!r.ok, "kassir logistika so'rovini to'lay olmaydi", r.error);
r = await prorab.action(`${MX}#payLogi`, [MF, undefined, fd({ cashAccountId: L })], `/mexanik-sorovlar/${MF}`);
check(!r.ok, "zavod so'rovi logistika hisobidan to'lanmaydi", r.error);
l0 = logiBal(); c0 = cashBal();
r = await prorab.action(`${MX}#payLogi`, [MR, undefined, fd({ cashAccountId: L })], `/mexanik-sorovlar/${MR}`);
check(r.ok, "ish boshqaruvchi logistika so'rovini logistika hisobidan berdi", r.error ?? r.text.slice(0, 200));
check(q1(`select status from "MechanicRequest" where id=${lit(MR)}`) === "PAID" && !!q1(`select "logisticsTxId" from "MechanicRequest" where id=${lit(MR)}`) && !q1(`select "cashTxId" from "MechanicRequest" where id=${lit(MR)}`), "so'rov PAID, logistika yozuviga bog'langan, kassa qatori yo'q");
check(l0 - logiBal() === 100000 && cashBal() === c0, "so'rov puli: logistika −100 ming, zavod kassasi o'zgarmadi");
check(n1(`select count(*) from "TransportExpense" where note like 'MX-QA-${tag}%'`) === 1, "so'rov: transport xarajati bir marta yozildi");
r = await kassa.action(`${MX}#pay`, [MF, undefined, fd({ cashAccountId: cashAcc })], `/mexanik-sorovlar/${MF}`);
check(r.ok && !!q1(`select "cashTxId" from "MechanicRequest" where id=${lit(MF)}`), "kassir zavod so'rovini kassadan berdi (avvalgidek)", r.error);

// ── Jurnal: qayerdan bo'lmasin — hammasi; zavod so'rovi jurnalga kirmaydi ──
g = await prorab.get(P);
const doc = (id: string) => q1(`select "docNo" from "LogisticsTx" where id=${lit(id)}`)!;
check(g.status === 200 && g.text.includes(doc(tr)) && g.text.includes(`MX-QA-${tag}`) && !g.text.includes(`MX-QF-${tag}`), "jurnal: o'tkazma va logistika so'rovi bor, zavod so'rovi yo'q");

// ── Oylik reys haqi: logistika hisobidan to'lansa vedomostga tushmaydi, bekor qilinsa qaytadi ──
const pos = q1(`select name from "WorkPosition" where "isDriver" and "isActive" order by name limit 1`) ?? "Haydovchi";
const DRV = `qa_lm_drv_${tag}`;
q(`insert into "Employee" (id, "fullName", position, "isActive", "createdAt") values (${lit(DRV)}, 'QA LM Haydovchi ${tag}', ${lit(pos)}, true, now())`);
q(`insert into "LogisticsEntry" (id, "docNo", date, "driverId", "vehicleId", trips, "payAmount", "payType", "payApprovedAt", "payApprovedById", note, "createdById", "createdAt")
   values ('qa_lm_e_${tag}', 'QY-QA-${tag}', now(), ${lit(DRV)}, ${lit(veh)}, 1, 250000, 'PAYROLL', now(), ${lit(prorabId)}, 'QA oylik haq', ${lit(prorabId)}, now())`);
const inPayroll = async () => (await tripPayByDriver(from, to, [DRV])).get(DRV)?.sum ?? 0;
check((await inPayroll()) === 250000, "oylik haq vedomostga tushadi (to'lanmagan)");
const locked = n1(`select count(*) from "PayrollRun" where month=${lit(month)} and kind='FINAL' and status in ('SUBMITTED','APPROVED','PAID')`) > 0;
if (!locked) {
  r = await prorab.action(`${LM}#payMonth`, [month, DRV, undefined, fd({ source: L })], "/logistika/moliya?tab=tolov");
  check(r.ok, "oylik reys haqi logistika hisobidan to'landi", r.error ?? r.text.slice(0, 200));
  const mp = q1(`select "payLogiTxId" from "LogisticsEntry" where id='qa_lm_e_${tag}'`);
  check(!!mp && (await inPayroll()) === 0, "to'langan haq zavod vedomostiga tushmaydi");
  r = await prorab.action(`${LM}#cancelTx`, [mp!, undefined, fd({ reason: "QA qaytarish" })], P);
  check(r.ok && (await inPayroll()) === 250000, "bekor qilinsa haq yana vedomostga qaytadi", r.error);
} else check(true, "shu oy vedomosti tasdiqlangan — oylik to'lov tekshiruvi o'tkazib yuborildi");

// ── Boshqa sahifalar: dispetcherga jami xarajat / foyda ko'rinmaydi, ish boshqaruvchiga ko'rinadi ──
g = await disp.get(`/logistika/transport/${veh}`);
check(g.status === 200 && !g.text.includes("Jami xarajat"), "transport kartasi: dispetcherga jami xarajat va foyda yo'q", g.status);
g = await logist.get("/logistika/transport");
check(g.status === 200 && !g.text.includes(">Foyda<"), "transport ro'yxati: logistikaga foyda ustuni yo'q", g.status);
g = await buh.get("/bi-tahlil/logistika/avtotransport");
check(g.status !== 200 || !g.text.includes("Avtotransport tahlili"), "Tahlil → Avtotransport buxgalteriyaga yopiq", g.status);

summary("b-logi-moliya");
