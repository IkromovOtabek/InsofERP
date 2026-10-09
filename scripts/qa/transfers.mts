// Hisoblararo o'tkazma (CashTransfer): kassa → bank, bank komissiyasi, kassada pul yetmasa rad, overdraftli bank,
// takror bosish (clientToken), storno (faqat direktor, sabab bilan; qabul qiluvchi minusga tushsa — rad),
// P&L / kirim-chiqim o'zgarmasligi, veb va mobil qoldiqlar, ruxsatsiz rollar.
// Ishga tushirish (server ishlab turgan, .next build bor papkada):
//   QA_BASE=http://localhost:3210 QA_DATABASE_URL=postgresql://…/insof_test_x DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/transfers.mts
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, eq2, summary, BASE } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q1, lit } from "./db.mjs"; // test bazasi himoyasi (nomi insof_test… bo'lmasa to'xtaydi)

const url = process.env.DATABASE_URL ?? "";
if (!/\/insof_test[^/]*$/.test(url.split("?")[0]) || /insof_test_golden/.test(url)) { console.error("DATABASE_URL test bazasi emas"); process.exit(2); }

const { db } = await import("../../src/lib/db");
const { accountBalances } = await import("../../src/lib/payments");
const { txSign } = await import("../../src/lib/cash-tx");

const T = Date.now().toString(36).slice(-6);
const today = new Date().toISOString().slice(0, 10);
const dir = new Client(), buh = new Client(), kassa = new Client(), fin = new Client(), sotuv = new Client();
await Promise.all([dir.login("test.direktor"), buh.login("test.buh"), kassa.login("test.kassa"), fin.login("test.finance"), sotuv.login("test.sotuv")]);

const TA = "cashflow/transfer-actions";
const transfer = (c: typeof dir, o: Record<string, string | number>) => c.action(`${TA}#createTransferAction`, [undefined, fd({ date: today, ...o })], "/cashflow");
const storno = (c: typeof dir, id: string, why = "QA: xato kiritilgan") => c.action(`${TA}#cancelTransferAction`, [id, why], "/cashflow");
const cashTx = (o: Record<string, string>) => dir.action("cashflow/actions#createCashTx", [undefined, fd({ date: today, category: "Boshqa tushum", ...o })], "/cashflow");
const saveAcc = (id: string | null, o: Record<string, string>) => dir.action("settings/actions#saveCashAccount", [id, undefined, fd({ isActive: "on", ...o })], "/settings");
const accId = (name: string) => q1(`select id from "CashAccount" where name=${lit(name)}`).id as string;
const bal = async (id: string) => (await accountBalances(undefined, [id])).get(id) ?? 0;
const lastTransfer = () => q1(`select * from "CashTransfer" order by "createdAt" desc limit 1`);
const countTransfers = () => Number(q1(`select count(*)::int c from "CashTransfer"`).c);

// ── Mobil API (Bearer) ──
let ip = 0;
const mob = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { "x-forwarded-for": `10.88.0.${++ip}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { json = JSON.parse(text); } catch { /* matn */ }
  return { status: r.status, json, text };
};
const mtok = async (login: string) => (await mob("POST", "/api/mobile/auth/login", undefined, { login, password: "Test2026" })).json?.accessToken as string;
const [finTok, dirTok, kassaTok] = await Promise.all([mtok("test.finance"), mtok("test.direktor"), mtok("test.kassa")]);
const digits = (s: unknown) => Number(String(s ?? "").replace(/[^\d−-]/g, "").replace("−", "-"));
const field = (j: { fields?: { label: string; value: string }[] } | null, label: string) => j?.fields?.find((f) => f.label === label)?.value;
// P&L va pul oqimi (mobil): moliya "Sof pul oqimi" (hafta) — Kirim/Chiqim; direktor "Sof foyda" (hafta) — operatsion xarajat
const flow = async () => {
  const n = (await mob("GET", "/api/mobile/detail?key=dash&id=net.week", finTok)).json;
  const p = (await mob("GET", "/api/mobile/detail?key=dash&id=profit.week", dirTok)).json;
  return { in: digits(field(n, "Kirim")), out: digits(field(n, "Chiqim")), opex: digits(field(p, "Operatsion xarajat")) };
};
// Mobil "Kassa qoldig'i" jami = faol hisoblar: to'lovlar + Σ txSign(tur)·summa (o'tkazmalar ham)
const mobileTotal = async () => digits(field((await mob("GET", "/api/mobile/detail?key=dash&id=balance.month", kassaTok)).json, "Jami"));
const expectedTotal = async () => {
  const [pay, tx] = await Promise.all([
    db.payment.aggregate({ where: { cashAccount: { isActive: true } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { cashAccount: { isActive: true } }, _sum: { amount: true } }),
  ]);
  return Math.round(Number(pay._sum.amount ?? 0) + tx.reduce((s, t) => s + txSign(t.type) * Number(t._sum.amount ?? 0), 0));
};

// ───────── Tayyorlov: alohida test hisoblari ─────────
console.log("\nTayyorlov");
for (const [name, type] of [[`QA O Kassa ${T}`, "CASH"], [`QA O Kassa2 ${T}`, "CASH"], [`QA O Bank ${T}`, "BANK"], [`QA O Bank OD ${T}`, "BANK"]]) await saveAcc(null, { name, type });
const K = accId(`QA O Kassa ${T}`), K2 = accId(`QA O Kassa2 ${T}`), B = accId(`QA O Bank ${T}`), BOD = accId(`QA O Bank OD ${T}`);
await saveAcc(BOD, { name: `QA O Bank OD ${T}`, type: "BANK", allowOverdraft: "on" });
let r = await cashTx({ type: "INCOME", cashAccountId: K, amount: "1000000", category: "Ta'sischi kiritmasi" });
check("S1 kassaga 1 000 000 kirim", r.result?.ok === true && eq2(await bal(K), 1000000), r.result);
const f0 = await flow();
const total0 = await mobileTotal();
check("S2 mobil kassa qoldig'i = to'lovlar + Σ txSign·summa", Math.abs(total0 - (await expectedTotal())) <= 1, { total0 });

// ───────── Kassa → bank (inkassatsiya) ─────────
console.log("\nKassa → bank");
const n0 = countTransfers();
r = await transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "400000", note: "kunlik inkassatsiya" });
const t1 = lastTransfer();
check("T1 kassir: kassa → bank 400 000 saqlandi (OT-YYYY-NNNNN)", r.result?.ok === true && countTransfers() === n0 + 1 && /^OT-\d{4}-\d{5}$/.test(t1.docNo), r.result);
check("T2 qoldiqlar: kassa 600 000, bank 400 000", eq2(await bal(K), 600000) && eq2(await bal(B), 400000), { k: await bal(K), b: await bal(B) });
const legs = (id: string) => q1(`select coalesce(json_agg(json_build_object('type', type, 'acc', "cashAccountId", 'amount', amount, 'category', category) order by type), '[]') j from "CashTransaction" where "refType"='CashTransfer' and "refId"=${lit(id)}`).j as { type: string; acc: string; amount: number; category: string }[];
const l1 = legs(t1.id);
check("T3 ikki bog'langan yozuv: TRANSFER_OUT (kassa) + TRANSFER_IN (bank)", l1.length === 2 && l1.some((l) => l.type === "TRANSFER_OUT" && l.acc === K) && l1.some((l) => l.type === "TRANSFER_IN" && l.acc === B), l1);
let f1 = await flow();
check("T4 P&L va kirim/chiqim o'zgarmadi (o'tkazma oqim emas)", f1.in === f0.in && f1.out === f0.out && f1.opex === f0.opex, { f0, f1 });
check("T5 mobil jami qoldiq o'zgarmadi (pul kompaniya ichida)", (await mobileTotal()) === total0);
const audit1 = q1(`select count(*)::int c from "AuditLog" where entity='CashTransfer' and "entityId"=${lit(t1.id)} and action='CREATE'`).c;
check("T6 audit jurnali yozildi", audit1 === 1);
// Veb: hisob ko'chirmasi (hisob tanlangan Kirim-Chiqim) — o'tkazma o'z qatori bilan
let page = await kassa.get(`/cashflow?account=${K}&from=${today}&to=${today}`);
check("T7 veb hisob ko'chirmasida o'tkazma qatori va hujjat raqami", page.status === 200 && page.text.includes(t1.docNo) && page.text.includes("ko&#x27;chirmasi"), page.status);
page = await kassa.get(`/cashflow?tab=TRANSFER&from=${today}&to=${today}`);
check("T8 «O'tkazma» bo'limi ochiladi", page.status === 200 && page.text.includes(t1.docNo), page.status);

// ───────── Kassada pul yetmaydi ─────────
console.log("\nCheklovlar");
r = await transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "700000" });
check("T10 kassada 600 000 bor — 700 000 o'tkazma rad", /yetarli pul yo'q/.test(r.result?.error ?? "") && countTransfers() === n0 + 1, r.result);
r = await transfer(kassa, { fromAccountId: K, toAccountId: K, amount: "1000" });
check("T11 bir xil hisob — rad", /bir xil hisob/.test(r.result?.error ?? ""), r.result);
r = await transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "0" });
check("T12 summa 0 — rad", /0 dan katta/.test(r.result?.error ?? ""), r.result);
const off = `QA O Yopiq ${T}`;
await saveAcc(null, { name: off, type: "CASH" });
const OFF = accId(off);
await dir.action("settings/actions#saveCashAccount", [OFF, undefined, fd({ name: off, type: "CASH" })], "/settings"); // isActive yo'q → nofaol
r = await transfer(kassa, { fromAccountId: K, toAccountId: OFF, amount: "1000" });
check("T13 yopilgan hisobga — rad", /topilmadi yoki yopilgan/.test(r.result?.error ?? ""), r.result);
// /cashflow sotuvchiga yopiq (middleware 307 yoki action guard 403) — har holda o'tkazma yozilmaydi
r = await transfer(sotuv, { fromAccountId: K, toAccountId: B, amount: "1000" });
check("T14 sotuvchi o'tkazma qila olmaydi (307/403, yozuv yo'q)", [307, 403].includes(r.status) && !r.result?.ok && countTransfers() === n0 + 1, `${r.status}`);
r = await transfer(buh, { fromAccountId: B, toAccountId: K, amount: "1000000" });
check("T15 overdraftsiz bankdan qoldiqdan ortiq — rad", /yetarli pul yo'q/.test(r.result?.error ?? ""), r.result);

{
  const { canDo } = await import("../../src/lib/permissions");
  const can = (role: string, a: string) => canDo({ role: role as never }, "cashflow", a);
  check("T16 ruxsat katalogi: o'tkazma — kassir, buxgalter, moliya, direktor; sotuv/sklad — yo'q", can("CASHIER", "transfer") && can("ACCOUNTING", "transfer") && can("FINANCE", "transfer") && can("DIRECTOR", "transfer") && !can("SALES", "transfer") && !can("WAREHOUSE", "transfer"));
  check("T17 storno — faqat direktor (topshirib bo'lmaydi, 'write' ruxsati bilan ham)", can("DIRECTOR", "transfer_storno") && !can("FINANCE", "transfer_storno") && !canDo({ role: "ACCOUNTING", perms: { cashflow: "write" } as never }, "cashflow", "transfer_storno"));
}

// ───────── Bank komissiyasi ─────────
console.log("\nBank → kassa (naqdlashtirish) + komissiya");
r = await transfer(buh, { fromAccountId: B, toAccountId: K, amount: "100000", fee: "5000" });
const t2 = lastTransfer();
const fee = q1(`select * from "CashTransaction" where "refType"='CashTransfer' and "refId"=${lit(t2.id)} and type='EXPENSE'`);
check("T20 buxgalter: bank → kassa 100 000, komissiya 5 000 bankdan", r.result?.ok === true && fee && fee.cashAccountId === B && eq2(fee.amount, 5000) && fee.category === "Bank xizmati", { r: r.result, fee });
check("T21 qoldiqlar: bank 295 000, kassa 700 000", eq2(await bal(B), 295000) && eq2(await bal(K), 700000), { b: await bal(B), k: await bal(K) });
f1 = await flow();
check("T22 kirim o'zgarmadi, chiqim va operatsion xarajat faqat komissiyaga (+5 000) oshdi", f1.in === f0.in && f1.out === f0.out + 5000 && f1.opex === f0.opex + 5000, { f0, f1 });
check("T23 mobil jami faqat komissiyaga kamaydi", (await mobileTotal()) === total0 - 5000);

// ───────── Overdraftli bank ─────────
console.log("\nOverdraftli bank");
r = await transfer(fin, { fromAccountId: BOD, toAccountId: K2, amount: "50000" });
const t3 = lastTransfer();
check("T30 overdraftli bank (0 qoldiq) → kassa2 50 000 o'tdi (moliya)", r.result?.ok === true && eq2(await bal(BOD), -50000) && eq2(await bal(K2), 50000), r.result);

// ───────── Takror bosish (idempotentlik) ─────────
console.log("\nTakror bosish");
const token = crypto.randomUUID();
const nBefore = countTransfers();
const [a1, a2] = await Promise.all([transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "10000", clientToken: token }), transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "10000", clientToken: token })]);
const a3 = await transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "10000", clientToken: token });
check("T40 bir kalit bilan 3 marta (2 tasi parallel) — bitta o'tkazma", countTransfers() === nBefore + 1 && a1.result?.ok && a2.result?.ok && a3.result?.ok, { a1: a1.result, a2: a2.result, a3: a3.result });
check("T41 qayta yuborilganda «allaqachon saqlangan» deydi", /allaqachon/.test(a3.result?.note ?? ""), a3.result);
check("T42 kassa faqat bir marta kamaydi (690 000)", eq2(await bal(K), 690000), await bal(K));

// ───────── Storno ─────────
console.log("\nStorno");
r = await storno(kassa, t2.id);
check("T50 kassir storno qila olmaydi (403)", r.status === 403, `${r.status}`);
r = await storno(buh, t2.id);
check("T51 buxgalter ham storno qila olmaydi (faqat direktor)", r.status === 403, `${r.status}`);
r = await storno(dir, t2.id, "");
check("T52 sababsiz storno — rad", /sabab/.test(r.result?.error ?? ""), r.result);
// Kassa2 dagi 50 000 dan 30 000 sarflanadi — overdraftli bankdan kelgan o'tkazmani storno qilish kassa2 ni minusga tushiradi
await cashTx({ type: "EXPENSE", cashAccountId: K2, amount: "30000", category: "Ofis / xo'jalik" });
r = await storno(dir, t3.id);
check("T53 qabul qiluvchi (kassa2) minusga tushsa — storno rad", /minusga tushadi/.test(r.result?.error ?? "") && !q1(`select "cancelledAt" from "CashTransfer" where id=${lit(t3.id)}`).cancelledAt, r.result);
const fBefore = await flow();
r = await storno(dir, t2.id, "QA: noto'g'ri summa");
const t2after = q1(`select * from "CashTransfer" where id=${lit(t2.id)}`);
check("T54 direktor storno: hujjat sabab bilan qoldi, yozuvlar (2 + komissiya) o'chdi", r.result?.ok === true && t2after.cancelledAt && t2after.cancelReason === "QA: noto'g'ri summa" && legs(t2.id).length === 0, { r: r.result, legs: legs(t2.id) });
check("T55 storno'dan keyin: bank 410 000 (295 000 + 10 000 + 100 000 + komissiya 5 000), kassa 590 000", eq2(await bal(B), 410000) && eq2(await bal(K), 590000), { b: await bal(B), k: await bal(K) });
const fAfter = await flow();
check("T56 komissiya chiqimi ham qaytdi (chiqim −5 000), kirim o'zgarmadi", fAfter.out === fBefore.out - 5000 && fAfter.in === fBefore.in && fAfter.opex === fBefore.opex - 5000, { fBefore, fAfter });
r = await storno(dir, t2.id);
check("T57 ikkinchi storno — rad", /allaqachon storno/.test(r.result?.error ?? ""), r.result);
check("T58 mobil jami qoldiq = DB formulasi (o'tkazmalar bilan)", Math.abs((await mobileTotal()) - (await expectedTotal())) <= 1);

// ───────── Dublikat oynasi (qulf ichida, veb va mobil uchun bitta joy: createTransfer) ─────────
console.log("\nDublikat oynasi");
{
  const n = countTransfers();
  const par = await Promise.all([1, 2, 3].map(() => transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "11000" })));
  check("T70 kalitsiz 3 parallel bir xil o'tkazma — bitta hujjat, qolganlari «hozirgina saqlandi»", countTransfers() === n + 1 && par.filter((x) => x.result?.ok).length === 1 && par.filter((x) => /hozirgina saqlandi/.test(x.result?.error ?? "")).length === 2, par.map((x) => x.result));
  const tk = crypto.randomUUID();
  const [b1, b2] = await Promise.all([transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "12000", clientToken: tk }), transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "12000", clientToken: tk })]);
  check("T71 kalit bilan parallel — ikkalasi ok, bittasi «allaqachon saqlangan» (veb clientToken mantig'i o'zgarmadi)", countTransfers() === n + 2 && b1.result?.ok && b2.result?.ok && [b1, b2].some((x) => /allaqachon/.test(x.result?.note ?? "")), { b1: b1.result, b2: b2.result });
  r = await transfer(kassa, { fromAccountId: K, toAccountId: B, amount: "12000", clientToken: crypto.randomUUID() });
  check("T72 yangi kalit, lekin 60 s ichida aynan shu o'tkazma — rad", /hozirgina saqlandi/.test(r.result?.error ?? "") && countTransfers() === n + 2, r.result);
  r = await transfer(buh, { fromAccountId: K, toAccountId: B, amount: "12000" });
  check("T73 boshqa foydalanuvchining aynan shunday o'tkazmasi — dublikat emas (saqlandi)", r.result?.ok === true && countTransfers() === n + 3, r.result);
}

// ───────── Mobil ro'yxat ─────────
const ml = await mob("GET", "/api/mobile/list?key=cashflow&q=O'tkazma", finTok);
check("T60 mobil Kirim-Chiqim ro'yxatida o'tkazma qatorlari", ml.status === 200 && ml.text.includes("O'tkazma"), ml.status);

await db.$disconnect();
summary("Kassa o'tkazmalari:");
