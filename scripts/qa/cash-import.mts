// Kassa / bank → Excel import (`lib/cash-import.ts`): tizimda yo'q manba / sub manba qo'shiladi, «Savdo tushumi» To'lovlarda
// bo'lmasa «Savdo» kirimi, «99999-Xisob raqam almashinuvi» juft qatorlari (±1 kun) o'tkazma hujjati, qayta yuklash — takrorsiz,
// juftsiz perekit — hech narsa yozilmaydi. Kassa jurnalida tahrirlash (`updateCashEntry`) va Kirim-Chiqim formasidagi «+».
// Ishga tushirish (server ishlab turgan, .next build bor papkada):
//   QA_BASE=http://localhost:3210 QA_DATABASE_URL=postgresql://…/insof_test_x DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/cash-import.mts
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, summary } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q1, lit } from "./db.mjs"; // test bazasi himoyasi (nomi insof_test… bo'lmasa to'xtaydi)

const url = process.env.DATABASE_URL ?? "";
if (!/\/insof_test[^/]*$/.test(url.split("?")[0]) || /insof_test_golden/.test(url)) { console.error("DATABASE_URL test bazasi emas"); process.exit(2); }

const { db } = await import("../../src/lib/db");
const { cashEntrySig } = await import("../../src/lib/cash-entry");

const T = Date.now().toString(36).slice(-6);
// Toshkent sanasi (tungi soatlarda UTC bir kun orqada qoladi)
const day = (back: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date(Date.now() - back * 86_400_000));
const d1 = day(2), d2 = day(1);
const dir = new Client(), buh = new Client(), kassa = new Client(), sotuv = new Client();
await Promise.all([dir.login("test.direktor"), buh.login("test.buh"), kassa.login("test.kassa"), sotuv.login("test.sotuv")]);

const accId = (name: string) => q1(`select id from "CashAccount" where name=${lit(name)}`).id as string;
const K = accId("Kassa"), B = accId("Asosiy hisob raqam");
const n = (sql: string) => Number(q1(sql).c);
// Qoldiq yetsin: kassaga va bankka boshlang'ich kirim
for (const id of [K, B]) await dir.action("cashflow/actions#createCashTx", [undefined, fd({ type: "INCOME", date: d1, cashAccountId: id, amount: "1000000", category: "Boshqa tushum", note: `QA ${T} qoldiq` })], "/cashflow");

type Row = Record<string, string>;
const imp = (c: typeof dir, rows: Row[]) => c.action("payments/actions#importCashJournalFromExcel", [undefined, fd({ rows: JSON.stringify(rows), valueMaps: "{}", cashAccountId: K })], "/payments/import");
const sub = `QA ovqat ${T}`;
const rows: Row[] = [
  { date: d1, account: "Kassa", exp: "15000", manba: "Oziq-ovqat xarajatlari", sub, note: `QA ${T} A` },
  { date: d1, account: "Kassa", inc: "25000", manba: "Savdo tushumi", who: "QA xaridor", note: `QA ${T} B` },
  { date: d1, account: "Asosiy hisob raqam", exp: "7000", manba: "99999-Xisob raqam almashinuvi", note: `QA ${T} naqd yechildi` },
  { date: d2, account: "Kassa", inc: "7000", manba: "99999-Xisob raqam almashinuvi", note: `QA ${T} naqd yechildi` },
  { date: d1, account: "Kassa", exp: "3000", manba: "Avtotransport", sub: "Remont xarajatlari", note: `QA ${T} E` },
  { date: d1, account: "Kassa", exp: "2000", manba: "Zavod xarajatlari", sub: "Remont xarajatlari", note: `QA ${T} F` },
];
const transfers0 = n(`select count(*)::int c from "CashTransfer"`);

// ───────── Import ─────────
let r = await imp(kassa, rows);
check("C1 import o'tdi: 4 qator, 1 perekit, 2 yangi sub manba", /import=4-0-1-2/.test(r.redirect ?? ""), r.redirect ?? r.result);
check("C2 yangi sub manba Pitaniya ostida", n(`select count(*)::int c from "CashCategory" c join "CashCategory" p on p.id=c."parentId" where c.name=${lit(sub)} and p.name='Pitaniya' and c.type='EXPENSE'`) === 1);
check("C3 boshqa manbada band nom — «Nom (Manba)» bo'lib qo'shildi", n(`select count(*)::int c from "CashCategory" c join "CashCategory" p on p.id=c."parentId" where c.name='Remont xarajatlari (Ta''mirlash / ehtiyot qism)' and p.name='Ta''mirlash / ehtiyot qism'`) === 1);
check("C4 sub manba alias'i o'z manbasida — mavjud sub manba ishlatildi", n(`select count(*)::int c from "CashTransaction" where note=${lit(`QA ${T} E`)} and category='Transport' and "subCategory"='Transport ta''miri va zapchast'`) === 1);
check("C5 «Savdo tushumi» To'lovlarda yo'q — «Savdo» kirimi, kontragent bilan", n(`select count(*)::int c from "CashTransaction" where note=${lit(`QA ${T} B`)} and type='INCOME' and category='Savdo' and counterparty='QA xaridor'`) === 1);
// Ustun nomlari `t` bo'lmasin — `q` so'rovni `(…) t` ichiga oladi va json_agg(t) qator o'rniga ustunni olib qo'yadi
const tr = q1(`select "fromAccountId" src, "toAccountId" dst, amount, to_char(date,'YYYY-MM-DD') dt from "CashTransfer" order by "createdAt" desc limit 1`);
check("C6 juft perekit (±1 kun) — bankdan kassaga o'tkazma, chiqim kuni bilan", n(`select count(*)::int c from "CashTransfer"`) === transfers0 + 1 && tr.src === B && tr.dst === K && Number(tr.amount) === 7000 && tr.dt === d1, tr);
check("C7 perekit oddiy kirim/chiqim bo'lib yozilmadi", n(`select count(*)::int c from "CashTransaction" where note like ${lit(`QA ${T} naqd%`)} and type in ('INCOME','EXPENSE')`) === 0);

r = await imp(kassa, rows);
check("C8 shu faylni qayta yuklash — yangi qator yo'q (takrorsiz)", /Yangi qator yo'q/.test(r.result?.error ?? ""), r.result);
const before = n(`select count(*)::int c from "CashTransaction"`);
r = await imp(kassa, [{ date: d1, account: "Kassa", exp: "9999", manba: "99999-Xisob raqam almashinuvi" }, { date: d1, account: "Kassa", exp: "1111", manba: "Pitaniya" }]);
check("C9 juftsiz perekit — xato, hech narsa yozilmadi", /jufti yo'q/.test(r.result?.error ?? "") && n(`select count(*)::int c from "CashTransaction"`) === before, r.result);
const yangi = `QA yangi manba ${T}`;
r = await imp(kassa, [{ date: d1, account: "Kassa", exp: "4000", manba: yangi, sub: `QA yangi sub ${T}`, note: `QA ${T} G` }, { date: d1, account: "Kassa", exp: "1000", manba: yangi, note: `QA ${T} H` }]);
check("C9a tizimda yo'q manba — chiqim manbasi bo'lib qo'shildi (sub manbasi bilan), qatorlar yozildi", /import=2-0-0-1-1/.test(r.redirect ?? "")
  && n(`select count(*)::int c from "CashCategory" where name=${lit(yangi)} and type='EXPENSE' and "parentId" is null and flow='OPERATING' and "pnlLine"='PRODUCTION'`) === 1
  && n(`select count(*)::int c from "CashCategory" c join "CashCategory" p on p.id=c."parentId" where c.name=${lit(`QA yangi sub ${T}`)} and p.name=${lit(yangi)}`) === 1
  && n(`select count(*)::int c from "CashTransaction" where note like ${lit(`QA ${T} _`)} and category=${lit(yangi)}`) === 2, r.redirect ?? r.result);
r = await imp(sotuv, rows);
check("C10 sotuv importni ishlata olmaydi", !r.redirect && !r.result?.ok);

// ───────── Kassa jurnalida tahrirlash ─────────
const a = await db.cashTransaction.findFirstOrThrow({ where: { note: `QA ${T} A` } });
const form = (o: Row = {}) => fd({ date: d1, cashAccountId: K, amount: "16000", category: "Pitaniya", subCategory: sub, counterparty: "QA oshxona", note: `QA ${T} A`, sig: cashEntrySig(a), ...o });
r = await kassa.action("cashflow/actions#updateCashTx", [a.id, undefined, form()], "/payments");
check("C11 kassir tahrirlay olmaydi (cashflow.edit — buxgalteriya)", !r.result?.ok && n(`select count(*)::int c from "CashTransaction" where id=${lit(a.id)} and amount=15000`) === 1, r.result);
r = await buh.action("cashflow/actions#updateCashTx", [a.id, undefined, form()], "/payments");
check("C12 buxgalter summa va kontragentni tuzatdi", r.result?.ok === true && n(`select count(*)::int c from "CashTransaction" where id=${lit(a.id)} and amount=16000 and counterparty='QA oshxona'`) === 1, r.result);
check("C13 AuditLog'da UPDATE (avvalgi summa bilan)", n(`select count(*)::int c from "AuditLog" where entity='CashTransaction' and "entityId"=${lit(a.id)} and action='UPDATE' and before->>'amount' = '15000'`) === 1);
r = await buh.action("cashflow/actions#updateCashTx", [a.id, undefined, form({ amount: "17000" })], "/payments");
check("C14 eski holat bilan saqlash — «boshqa joyda o'zgartirildi»", /boshqa joyda/.test(r.result?.error ?? ""), r.result);
const leg = await db.cashTransaction.findFirstOrThrow({ where: { type: "TRANSFER_IN", note: { contains: `QA ${T}` } } });
r = await buh.action("cashflow/actions#updateCashTx", [leg.id, undefined, fd({ date: d1, cashAccountId: K, amount: "1", category: "Pitaniya", sig: cashEntrySig(leg) })], "/payments");
check("C15 perekit oyog'i tahrirlanmaydi", /O'tkazma/.test(r.result?.error ?? ""), r.result);
const page = await buh.get("/payments?tab=kassa");
check("C16 Kassa jurnalida «Yozuvni tahrirlash» tugmasi (buxgalter)", page.status === 200 && page.text.includes("Yozuvni tahrirlash"), page.status);

// ───────── Kirim-Chiqim: «+» ─────────
const QA = "lib/quick-add-actions";
const manba = `QA manba ${T}`;
r = await kassa.action(`${QA}#quickAddCashCategory`, [fd({ name: manba, type: "EXPENSE", pnlLine: "ADMIN" })], "/cashflow");
check("C17 kassir «+» bilan yangi chiqim manbasi qo'shdi (PNL qatori bilan)", !!r.result?.id && n(`select count(*)::int c from "CashCategory" where name=${lit(manba)} and type='EXPENSE' and "pnlLine"='ADMIN' and flow='OPERATING' and "parentId" is null`) === 1, r.result);
r = await kassa.action(`${QA}#quickAddCashCategory`, [fd({ name: manba, type: "EXPENSE" })], "/cashflow");
check("C18 bir xil nom — rad", /allaqachon/.test(r.result?.error ?? ""), r.result);
r = await kassa.action(`${QA}#quickAddCashCategory`, [fd({ name: `QA sub ${T}`, parent: manba })], "/cashflow");
check("C19 shu manba ostiga sub manba", !!r.result?.id && n(`select count(*)::int c from "CashCategory" c join "CashCategory" p on p.id=c."parentId" where c.name=${lit(`QA sub ${T}`)} and p.name=${lit(manba)} and c."pnlLine"='ADMIN'`) === 1, r.result);
r = await kassa.action(`${QA}#quickAddSupplier`, [fd({ name: `QA yetkazuvchi ${T}`, vatPayer: "0" })], "/cashflow");
check("C20 kassir Kirim-Chiqimdan yangi yetkazuvchi qo'shdi", !!r.result?.id && n(`select count(*)::int c from "Supplier" where name=${lit(`QA yetkazuvchi ${T}`)}`) === 1, r.result);
r = await sotuv.action(`${QA}#quickAddCashCategory`, [fd({ name: `QA sotuv ${T}`, type: "EXPENSE" })], "/cashflow");
check("C21 sotuv kategoriya qo'sha olmaydi", /ruxsat/.test(r.result?.error ?? "") && n(`select count(*)::int c from "CashCategory" where name=${lit(`QA sotuv ${T}`)}`) === 0, r.result);
r = await buh.action(`${QA}#quickAddProject`, [fd({ name: `QA loyiha ${T}` })], "/cashflow");
check("C22 «+» bilan yangi loyiha", !!r.result?.id && n(`select count(*)::int c from "Project" where name=${lit(`QA loyiha ${T}`)}`) === 1, r.result);

await db.$disconnect();
summary("Kassa importi va tahrir:");
