// Debitorka sotuv va kassaga ulangan (2026-11-14; 2026-11-17 — Realizatsiyaning BARCHA qatorlari, Naqd ham, «Sotib olgan»ga
// tushadi, ro'yxatda yo'q xaridor mijozlarga qo'shiladi), kassa kirimi «Mijoz qarziga» (yoki Kontragent nomi mos) bilan qarzni kamaytiradi, «Qarzni boshqa mijoz to'ladi» ikki mijoz o'rtasida o'tkazadi,
// «Qoldiqni tuzatish» — kun oxiridagi qoldiqni tenglaydi; 4 ustunli varaq (boshi + sotib olgan − to'lagan = oxiri),
// tafsilot tablari, akt sverka, aging va kredit limiti bir raqam. Realizatsiya Sotuv bo'limida, eski manzil yo'naltiriladi.
// Ishga tushirish (server ishlab turgan, .next build bor papkada):
//   QA_BASE=http://localhost:3210 QA_DATABASE_URL=postgresql://…/insof_test_x DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/debitorka-ulash.mts
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, eq2, summary } from "./client.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!/\/insof_test[^/]*$/.test(url.split("?")[0]) || /insof_test_golden/.test(url)) { console.error("DATABASE_URL test bazasi emas"); process.exit(2); }

const { db } = await import("../../src/lib/db");
const { customerBalance, receivablesReport } = await import("../../src/lib/receivables");
const { customerCredit } = await import("../../src/lib/finance");
const { createCashEntry } = await import("../../src/lib/cash-entry");
const { createOpening } = await import("../../src/lib/opening-balances");
const { customerStatement } = await import("../../src/lib/invoices");
const { customerDebtSheet, parseDebtDay } = await import("../../src/lib/fin-report/debts");

const T = Date.now().toString(36).slice(-6);
const DAY = 86_400_000;
const iso = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const dir = new Client(), buh = new Client(), sotuv = new Client(), logist = new Client();
await Promise.all([dir.login("test.direktor"), buh.login("test.buh"), sotuv.login("test.sotuv"), logist.login("test.logistika")]);
const buhU = await db.user.findFirstOrThrow({ where: { login: "test.buh" } });
const kassa = await db.cashAccount.findFirstOrThrow({ where: { type: "CASH", isActive: true }, orderBy: { name: "asc" } });

const A = await db.customer.create({ data: { name: `QA Qarz A ${T}`, creditLimit: 50_000_000 } });
const B = await db.customer.create({ data: { name: `QA Qarz B ${T}` } });
const bal = async (id: string) => (await customerBalance(id)).balance;

console.log("\n── Boshlang'ich qoldiq va Realizatsiya (Sotuv → Realizatsiya)");
const op = await createOpening({ kind: "CUSTOMER", customerId: A.id, date: new Date(iso(20)), amount: 3_000_000, note: "QA Excel" }, buhU.id);
check("D1 boshlang'ich qarz 3 000 000 (20 kun oldin)", !op.error && eq2(await bal(A.id), 3_000_000), op.error);
const RA = "sales/realizatsiya/actions";
const entry = (payGroup: string, qty: string, price: string, n: number) => logist.action(`${RA}#createRealizationAction`, [undefined, fd({ clientToken: crypto.randomUUID(), date: iso(n), payGroup, customerName: A.name, productName: `QA Beton ${T}`, unit: "m3", qty, price })], "/sales/realizatsiya");
let r = await entry("DEBT", "4", "500000", 10);
check("D2 «Qarz» qator (4 m³ × 500 000) → qarz +2 000 000", r.result?.ok === true && eq2(await bal(A.id), 5_000_000), r.result);
r = await entry("CASH", "2", "500000", 9);
check("D3 «Naqd» qator ham sotuvga tushadi (+1 000 000) — to'lovi kassada bog'lanmaguncha qarz", r.result?.ok === true && eq2(await bal(A.id), 6_000_000), r.result);
const newName = `QA Yangi xaridor ${T}`;
r = await logist.action(`${RA}#createRealizationAction`, [undefined, fd({ clientToken: crypto.randomUUID(), date: iso(3), payGroup: "BANK", customerName: newName, productName: `QA Beton ${T}`, unit: "m3", qty: "1", price: "100000" })], "/sales/realizatsiya");
const C = await db.customer.findFirst({ where: { name: newName } });
check("D3b ro'yxatda yo'q xaridor mijozlarga qo'shildi va sotuvi (QQS bilan 112 000) debitorkada", r.result?.ok === true && !!C && eq2(await bal(C.id), 112_000), [r.result, C?.id]);
r = await sotuv.action(`${RA}#createRealizationAction`, [undefined, fd({ clientToken: crypto.randomUUID(), date: iso(1), payGroup: "DEBT", customerName: A.name, productName: "x", unit: "m3", qty: "1", price: "1" })], "/sales/realizatsiya");
check("D4 sotuv bo'limi qo'lda qator kiritolmaydi (logistika.real_manual)", !r.result?.ok, r.result);

console.log("\n── Kassa: «Mijoz qarziga» va boshqa mijoz to'lovi");
const c1 = await createCashEntry({ type: "INCOME", date: new Date(iso(5)), cashAccountId: kassa.id, amount: 700_000, category: "Savdo", customerId: A.id, counterparty: B.name }, buhU.id);
check("D5 kassa kirimi (kimdan: B) A qarzidan ayirildi", !!c1.id && eq2(await bal(A.id), 5_300_000) && eq2(await bal(B.id), 0), c1);
const auto = await createCashEntry({ type: "INCOME", date: new Date(iso(5)), cashAccountId: kassa.id, amount: 1_000_000, category: "Savdo", counterparty: A.name }, buhU.id);
const autoTx = auto.id ? await db.cashTransaction.findUnique({ where: { id: auto.id }, select: { customerId: true } }) : null;
check("D6 mijoz tanlanmagan, Kimdan = A nomi → o'zi bog'landi, qarzdan ayirildi", autoTx?.customerId === A.id && eq2(await bal(A.id), 4_300_000), auto);
const chak = await createCashEntry({ type: "INCOME", date: new Date(iso(5)), cashAccountId: kassa.id, amount: 111_000, category: "Savdo", counterparty: `Noma'lum ${T}` }, buhU.id);
check("D6b nomi hech kimga mos kelmagan kirim qarzga tegmaydi", !!chak.id && eq2(await bal(A.id), 4_300_000), chak);
const QA_ = "bi-tahlil/mijozlar/actions";
r = await sotuv.action(`${QA_}#createDebtTransferAction`, [undefined, fd({ date: iso(2), debtorId: A.id, payerId: B.id, amount: "300000" })], "/bi-tahlil/mijozlar/xaridorlar");
check("D7 sotuv qarz o'tkazmasi yozolmaydi", !r.result?.ok, r.status);
r = await buh.action(`${QA_}#createDebtTransferAction`, [undefined, fd({ date: iso(2), debtorId: A.id, payerId: A.id, amount: "300000" })], "/bi-tahlil/mijozlar/xaridorlar");
check("D8 qarzdor = to'lovchi — rad", /bitta mijoz/.test(r.result?.error ?? ""), r.result);
r = await buh.action(`${QA_}#createDebtTransferAction`, [undefined, fd({ date: iso(2), debtorId: A.id, payerId: B.id, amount: "300000", note: "QA" })], "/bi-tahlil/mijozlar/xaridorlar");
const tr = await db.customerDebtTransfer.findFirst({ where: { debtorId: A.id }, orderBy: { createdAt: "desc" } });
check("D9 B A ning 300 000 qarzini to'ladi: A 4 000 000, B +300 000", r.result?.ok === true && !!tr?.docNo.startsWith("QO-") && eq2(await bal(A.id), 4_000_000) && eq2(await bal(B.id), 300_000), r.result);

console.log("\n── Varaq, tafsilot, akt, aging, limit — bir raqam");
const sheet = await customerDebtSheet(parseDebtDay());
const rA = sheet.rows.find((x) => x.id === A.id), rB = sheet.rows.find((x) => x.id === B.id);
check("D10 varaq A: boshlang'ich 3 mln, sotib olgan 3 mln, to'lagan 2 mln, oxiri 4 mln", !!rA && eq2(rA.open.debt, 3_000_000) && eq2(rA.sold, 3_000_000) && eq2(rA.paid, 2_000_000) && eq2(rA.now.debt, 4_000_000), rA);
check("D11 varaq B: to'lagan −300 000 (boshqa qarzi), qarzdorlik 300 000", !!rB && eq2(rB.paid, -300_000) && eq2(rB.now.debt, 300_000), rB);
const rC = sheet.rows.find((x) => x.id === C?.id);
check("D11b zayavkasiz mijoz turi — Realizatsiyadagi oxirgi Naqd/Perech. qatoridan (A Naqd, C Perech.), qatorsiz B — Perech.",
  rA?.kind === "CASH" && rC?.kind === "BANK" && rB?.kind === "BANK" && (await customerDebtSheet(parseDebtDay(), "CASH")).rows.some((x) => x.id === A.id), [rA?.kind, rC?.kind, rB?.kind]);
check("D12 varaqda hamma qator: boshi + sotib olgan − to'lagan = oxiri", sheet.rows.every((x) => eq2((x.open.debt - x.open.advance) + x.sold - x.paid, x.now.debt - x.now.advance)));
const st = await customerStatement(A.id, new Date(iso(30)), new Date());
check("D13 akt sverka yakuniy = balans", eq2(st.closing, 4_000_000) && st.lines.some((l) => l.kind === "SALE") && st.lines.some((l) => l.kind === "CASH") && st.lines.some((l) => l.kind === "TRANSFER"), st.lines.map((l) => l.kind));
const rep = await receivablesReport({ ids: [A.id] });
check("D14 aging qismlari = qarz", eq2((rep.byCustomer.get(A.id)?.items ?? []).reduce((s, x) => s + x.left, 0), 4_000_000), rep.byCustomer.get(A.id)?.items);
const cr = await customerCredit(A.id);
check("D15 kredit limiti: qarz 4 mln (ikki marta emas)", eq2(cr.debt, 4_000_000) && eq2(cr.used, 4_000_000), cr);

console.log("\n── Qoldiqni tuzatish va bekor qilish");
r = await sotuv.action(`${QA_}#fixDebtBalanceAction`, ["customer", A.id, undefined, fd({ date: iso(0), side: "qarz", amount: "1000000" })], "/bi-tahlil/mijozlar/xaridorlar");
check("D16 sotuv qoldiqni tuzatolmaydi", !r.result?.ok && eq2(await bal(A.id), 4_000_000), r.status);
r = await buh.action(`${QA_}#fixDebtBalanceAction`, ["customer", A.id, undefined, fd({ date: iso(0), side: "qarz", amount: "2500000", note: "QA sverka" })], "/bi-tahlil/mijozlar/xaridorlar");
check("D17 buxgalter: bugun oxiriga qarzdorlik 2 500 000", r.result?.ok === true && eq2(await bal(A.id), 2_500_000), r.result);
r = await buh.action(`${QA_}#fixDebtBalanceAction`, ["customer", B.id, undefined, fd({ date: iso(0), side: "haq", amount: "100000" })], "/bi-tahlil/mijozlar/xaridorlar");
check("D18 B: haqdorlik 100 000 (avans)", r.result?.ok === true && eq2(await bal(B.id), -100_000), r.result);
r = await buh.action(`${QA_}#cancelDebtTransferAction`, [tr!.id, "QA bekor"], "/bi-tahlil/mijozlar/xaridorlar");
check("D19 o'tkazma bekor: A +300 000, B −300 000", r.result?.ok === true && eq2(await bal(A.id), 2_800_000) && eq2(await bal(B.id), -400_000), r.result);

console.log("\n── Sahifalar");
const page = async (c: typeof dir, p: string) => { const x = await c.get(p); return { status: x.status, html: x.text as string, location: x.location as string | null }; };
const flat = (h: string) => h.replace(/[\s  ]/g, "");
let pg = await page(buh, `/bi-tahlil/mijozlar/xaridorlar?q=${encodeURIComponent(A.name)}`);
check("D20 xaridorlar varag'i: 4 ustun, A qatori", pg.status === 200 && pg.html.includes("Sotib olgan") && pg.html.includes("To&#x27;lagan") && pg.html.includes(A.name), pg.status);
for (const tab of ["sotuv", "tolov", "qoldiq", "akt"]) {
  pg = await page(buh, `/bi-tahlil/mijozlar/xaridorlar/${A.id}?tab=${tab}`);
  check(`D21 tafsilot «${tab}» → 200`, pg.status === 200 && (tab !== "sotuv" || pg.html.includes(`QA Beton ${T}`)) && (tab !== "tolov" || flat(pg.html).includes("700000")), pg.status);
}
pg = await page(buh, `/bi-tahlil/mijozlar/taminotchilar`);
check("D22 ta'minotchilar varag'i → 200", pg.status === 200 && pg.html.includes("Bizga bergan"), pg.status);
pg = await page(logist, "/sales/realizatsiya");
check("D23 logistika → Sotuv → Realizatsiya 200", pg.status === 200, pg.status);
pg = await page(logist, "/logistika/realizatsiya?from=2026-11-01");
check("D24 eski manzil /logistika/realizatsiya → /sales/realizatsiya", [303, 307, 308].includes(pg.status) && (pg.location ?? "").includes("/sales/realizatsiya?from=2026-11-01"), [pg.status, pg.location]);
pg = await page(sotuv, "/sales/realizatsiya");
check("D25 sotuv → Realizatsiya 200", pg.status === 200, pg.status);

await db.$disconnect();
summary("Debitorka ↔ sotuv/kassa:");
