/**
 * QA (C) — mobil kassa: kassir ilovadan to'lov qabul qiladi va kirim/chiqim yozadi (veb bilan bir xil qoida).
 *  · forma va bosh sahifa: kassirda "To'lov qabul qilish", "Kirim / chiqim", "Kassa ⇄ bank";
 *  · to'lov: boshlang'ich qarz (BQ-…) schyotiga bog'langan, avans (bog'lanmagan), ortiqcha, boshqa mijoz schyoti;
 *  · ikki marta bosish → bitta yozuv (to'lov, chiqim, o'tkazma);
 *  · naqd kassa qoldig'idan oshgan chiqim rad etiladi; kirim/chiqim yoziladi; kategoriya tekshiriladi;
 *  · ruxsat: boshqa rollar 403, Moliya — to'lov 403 (veb `payments:create` kabi), direktor "faqat ko'rish" bergan kassir — 403.
 *
 *   DATABASE_URL=… npx tsx scripts/qa/c-mobile-cash.ts   (server: QA_BASE, standart http://localhost:3203)
 */
import { api, check, done, section, tok } from "./c-lib";
import { db } from "@/lib/db";
import { createOpening } from "@/lib/opening-balances";
import { accountBalances } from "@/lib/payments";
import { unpaidReceipts } from "@/lib/receipt-payables";
import { Prisma } from "@/generated/prisma";

const stamp = Date.now().toString(36);
const create = (token: string, key: string, payload: Record<string, unknown>) => api("POST", "/api/mobile/create", { token, body: { key, payload } });
type Field = { name: string; dependsOn?: string; options?: { value: string; extra?: Record<string, string> }[] };

async function main() {
  const kassa = await tok("test.kassa");
  const director = await db.user.findUniqueOrThrow({ where: { login: "test.direktor" } });
  const kassaUser = await db.user.findUniqueOrThrow({ where: { login: "test.kassa" }, select: { id: true, perms: true } });

  section("Bosh sahifa va formalar");
  const home = await api("GET", "/api/mobile/home", { token: kassa });
  const newKeys = (home.json?.quick ?? []).filter((q: { kind: string }) => q.kind === "new").map((q: { key: string }) => q.key);
  check("kassir bosh sahifasida: payments, cashflow, transfer", ["payments", "cashflow", "transfer"].every((k) => newKeys.includes(k)), newKeys);
  check("asosiy \"+\" — To'lov qabul qilish", home.json?.create?.key === "payments", home.json?.create);
  const form = await api("GET", "/api/mobile/form?key=payments", { token: kassa });
  check("to'lov formasi → 200", form.status === 200, form.status);
  const fields: Field[] = form.json?.fields ?? [];
  check("maydonlar: mijoz, schyot/zayavka, summa, hisob, usul, sana", ["customerId", "link", "amount", "cashAccountId", "method", "date"].every((n) => fields.some((f) => f.name === n)), fields.map((f) => f.name));
  check("schyot tanlovi mijozga bog'liq (dependsOn)", fields.find((f) => f.name === "link")?.dependsOn === "customerId");
  const cf = await api("GET", "/api/mobile/form?key=cashflow", { token: kassa });
  check("kirim/chiqim formasi → 200", cf.status === 200 && (cf.json?.fields ?? []).some((f: Field) => f.name === "categoryExpense"), cf.status);
  check("o'tkazma formasi → 200", (await api("GET", "/api/mobile/form?key=transfer", { token: kassa })).status === 200);

  // Sinov ma'lumotlari: yangi mijoz + boshlang'ich qarz (BQ schyot), bo'sh naqd kassa, bank
  const cust = await db.customer.create({ data: { name: `QA kassa mijoz ${stamp}` } });
  const other = await db.customer.create({ data: { name: `QA boshqa mijoz ${stamp}` } });
  const op = await createOpening({ kind: "CUSTOMER", customerId: cust.id, date: new Date("2026-09-01T00:00:00+05:00"), amount: 1_000_000, note: "QA mobil kassa" }, director.id);
  check("boshlang'ich qarz (BQ schyot) ochildi", !op.error, op.error);
  const opOther = await createOpening({ kind: "CUSTOMER", customerId: other.id, date: new Date("2026-09-01T00:00:00+05:00"), amount: 500_000, note: "QA mobil kassa" }, director.id);
  check("boshqa mijozga ham BQ schyot", !opOther.error, opOther.error);
  const bq = await db.invoice.findFirstOrThrow({ where: { customerId: cust.id, isOpening: true } });
  const bqOther = await db.invoice.findFirstOrThrow({ where: { customerId: other.id, isOpening: true } });
  const cash = await db.cashAccount.create({ data: { name: `QA kassa ${stamp}`, type: "CASH" } });
  const bank = (await db.cashAccount.findFirst({ where: { type: "BANK", isActive: true } })) ?? (await db.cashAccount.create({ data: { name: `QA bank ${stamp}`, type: "BANK" } }));

  const form2 = await api("GET", "/api/mobile/form?key=payments", { token: kassa });
  const link = (form2.json?.fields ?? []).find((f: Field) => f.name === "link") as Field | undefined;
  const bqOpt = link?.options?.find((o) => o.value === `inv:${bq.id}`);
  check("formada BQ schyot bor, extra.customerId mijozniki", bqOpt?.extra?.customerId === cust.id, bqOpt);

  section("To'lov qabul qilish");
  const paysOf = (where: Prisma.PaymentWhereInput) => db.payment.count({ where: { customerId: { in: [cust.id, other.id] }, ...where } });
  let r = await create(kassa, "payments", { customerId: cust.id, link: `inv:${bq.id}`, amount: "400 000", cashAccountId: cash.id, method: "Naqd", note: "QA" });
  check("schyotga bog'langan to'lov → 200", r.status === 200 && r.json?.key === "payments", r.json);
  const p1 = r.json?.id ? await db.payment.findUnique({ where: { id: r.json.id } }) : null;
  check("to'lov BQ schyotga yozildi, 400 000", p1?.invoiceId === bq.id && Number(p1?.amount) === 400_000, p1);
  check("izohda usul", p1?.note?.includes("Usul: Naqd") ?? false, p1?.note);
  check("schyot holati PARTIAL", (await db.invoice.findUnique({ where: { id: bq.id } }))?.status === "PARTIAL");
  if (r.json?.id) check("to'lov kartochkasi ochiladi", (await api("GET", `/api/mobile/detail?key=payments&id=${r.json.id}`, { token: kassa })).status === 200);

  const before = await paysOf({});
  r = await create(kassa, "payments", { customerId: cust.id, link: `inv:${bq.id}`, amount: "400000", cashAccountId: cash.id, method: "Naqd", note: "QA" });
  check("ikki marta bosish → 400", r.status === 400, r.json);
  check("ikki marta bosish → bitta yozuv", (await paysOf({})) === before);

  r = await create(kassa, "payments", { customerId: cust.id, link: `inv:${bq.id}`, amount: 700_000, cashAccountId: cash.id });
  check("schyot qoldig'idan ko'p → 400", r.status === 400 && /Qoldiqdan ko'p/.test(r.json?.message ?? r.text), r.json);
  r = await create(kassa, "payments", { customerId: cust.id, link: `inv:${bqOther.id}`, amount: 100_000, cashAccountId: cash.id });
  check("boshqa mijozning schyoti → 400", r.status === 400 && /boshqa mijozniki/.test(r.text), r.json);
  r = await create(kassa, "payments", { customerId: cust.id, link: "xyz", amount: 100_000, cashAccountId: cash.id });
  check("noto'g'ri bog'lanish → 400", r.status === 400, r.json);
  r = await create(kassa, "payments", { customerId: cust.id, amount: 0, cashAccountId: cash.id });
  check("summa 0 → 400", r.status === 400, r.json);

  r = await create(kassa, "payments", { customerId: cust.id, amount: 250_000, cashAccountId: cash.id });
  check("avans (bog'lanmagan) → 200", r.status === 200, r.json);
  const adv = r.json?.id ? await db.payment.findUnique({ where: { id: r.json.id } }) : null;
  check("avans: schyotsiz va zayavkasiz", !!adv && adv.invoiceId === null && adv.orderId === null && Number(adv.amount) === 250_000, adv);

  r = await create(kassa, "payments", { customerId: cust.id, link: `inv:${bq.id}`, amount: 600_000, cashAccountId: cash.id });
  check("qolgan 600 000 → schyot yopildi", r.status === 200 && /schyot yopildi/.test(r.json?.message ?? ""), r.json);
  check("schyot holati PAID", (await db.invoice.findUnique({ where: { id: bq.id } }))?.status === "PAID");

  section("To'lov: mijoz tekshiruvi");
  const looksInternal = (s: string) => /prisma|invocation|constraint|foreign key|P20\d\d|\.js:\d/i.test(s);
  const ghost = `nope-${stamp}`;
  r = await create(kassa, "payments", { customerId: ghost, amount: 1000, cashAccountId: cash.id });
  check("mavjud bo'lmagan mijoz → 400 «Mijoz topilmadi»", r.status === 400 && r.json?.message === "Mijoz topilmadi", r.json);
  check("javobda Prisma/ichki tafsilot yo'q", !looksInternal(r.text), r.text.slice(0, 200));
  check("yozuv yaratilmadi", (await db.payment.count({ where: { customerId: ghost } })) === 0);
  const internalCust = await db.customer.create({ data: { name: `QA ichki ${stamp}`, isInternal: true } });
  r = await create(kassa, "payments", { customerId: internalCust.id, amount: 1000, cashAccountId: cash.id });
  check("ichki (tizim) mijoz → 400, yozuv yo'q", r.status === 400 && /Ichki/.test(r.json?.message ?? "") && (await db.payment.count({ where: { customerId: internalCust.id } })) === 0, r.json);
  const inactiveCust = await db.customer.create({ data: { name: `QA nofaol ${stamp}`, isActive: false } });
  r = await create(kassa, "payments", { customerId: inactiveCust.id, amount: 1500, cashAccountId: cash.id });
  check("nofaol mijozdan to'lov qabul qilinadi (eski qarz) → 200", r.status === 200 && (await db.payment.count({ where: { customerId: inactiveCust.id } })) === 1, r.json);
  // Prisma xatosi (bu yerda — mavjud bo'lmagan yetkazuvchi, foreign key) mijozga umumiy xabar bilan qaytadi
  r = await create(kassa, "cashflow", { type: "EXPENSE", cashAccountId: cash.id, amount: 1_234, categoryExpense: "Xomashyo", supplierId: `nope-${stamp}` });
  check("Prisma xatosi → 400 «Saqlanmadi», tafsilot yo'q", r.status === 400 && /^Saqlanmadi/.test(r.json?.message ?? "") && !looksInternal(r.text), r.json);

  section("Kirim / chiqim");
  const bal = async () => (await accountBalances(undefined, [cash.id])).get(cash.id) ?? 0;
  const b0 = await bal();
  const txCount = () => db.cashTransaction.count({ where: { cashAccountId: cash.id } });
  const t0 = await txCount();
  r = await create(kassa, "cashflow", { type: "EXPENSE", cashAccountId: cash.id, amount: b0 + 100_000, categoryExpense: "Ofis / xo'jalik" });
  check("qoldiqdan ko'p chiqim → 400 (kassa minusga tushmaydi)", r.status === 400 && /yetarli pul yo'q/.test(r.text), r.json);
  check("rad etilgan chiqim yozilmadi", (await txCount()) === t0);
  r = await create(kassa, "cashflow", { type: "INCOME", cashAccountId: cash.id, amount: 500_000, categoryIncome: "Boshqa tushum", counterparty: "QA" });
  check("kirim → 200", r.status === 200 && r.json?.key === "cashflow", r.json);
  const inc = r.json?.id ? await db.cashTransaction.findUnique({ where: { id: r.json.id } }) : null;
  check("kirim: INCOME, kategoriya, kassir yozgan", inc?.type === "INCOME" && inc.category === "Boshqa tushum" && inc.createdById === kassaUser.id, inc);
  r = await create(kassa, "cashflow", { type: "EXPENSE", cashAccountId: cash.id, amount: 200_000, categoryExpense: "Ofis / xo'jalik", note: "QA" });
  check("chiqim → 200", r.status === 200, r.json);
  check(`qoldiq = ${b0} + 500 000 − 200 000`, Math.abs((await bal()) - (b0 + 300_000)) < 0.01, await bal());
  const t1 = await txCount();
  r = await create(kassa, "cashflow", { type: "EXPENSE", cashAccountId: cash.id, amount: 200_000, categoryExpense: "Ofis / xo'jalik", note: "QA" });
  check("chiqim ikki marta bosildi → 400, bitta yozuv", r.status === 400 && (await txCount()) === t1, r.json);
  r = await create(kassa, "cashflow", { type: "EXPENSE", cashAccountId: cash.id, amount: 1000, categoryExpense: "Yo'q kategoriya" });
  check("noma'lum kategoriya → 400", r.status === 400, r.json);
  r = await create(kassa, "cashflow", { type: "INCOME", cashAccountId: cash.id, amount: 1000, categoryIncome: "Boshqa tushum", receiptId: "x" });
  check("kirimga kirim hujjati bog'lanmaydi (e'tiborsiz) → 200", r.status === 200, r.json);
  const unpaid = (await unpaidReceipts()).find((x) => x.left > 1);
  if (unpaid) {
    r = await create(kassa, "cashflow", { type: "EXPENSE", cashAccountId: cash.id, amount: unpaid.left + 1000, categoryExpense: "Xomashyo", supplierId: unpaid.supplierId, receiptId: unpaid.id });
    check("kirim hujjati qoldig'idan ko'p to'lov → 400", r.status === 400 && /ortiqcha/.test(r.text), r.json);
  } else check("to'lanmagan kirim yo'q — bog'lash sinovi o'tkazib yuborildi", true);

  section("Kassa ⇄ bank o'tkazma");
  r = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 100_000, note: "QA" });
  check("o'tkazma → 200", r.status === 200 && r.json?.key === "cashflow", r.json);
  const trCount = () => db.cashTransfer.count({ where: { fromAccountId: cash.id } });
  const tr0 = await trCount();
  r = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 100_000, note: "QA" });
  check("o'tkazma ikki marta bosildi → 400, bitta hujjat", r.status === 400 && (await trCount()) === tr0, r.json);
  r = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 50_000_000_000 });
  check("kassa qoldig'idan katta o'tkazma → 400", r.status === 400, r.json);
  r = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: cash.id, amount: 1000 });
  check("bir xil hisob → 400", r.status === 400, r.json);

  // Regressiya: dublikat tekshiruvi qulfdan tashqarida edi — 5 parallel bir xil o'tkazma 5 ta OT hujjat ochardi
  const trAll = () => db.cashTransfer.count({ where: { fromAccountId: cash.id, toAccountId: bank.id } });
  let n0 = await trAll();
  const par = await Promise.all(Array.from({ length: 5 }, () => create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 7_000, note: "QA parallel" })));
  const parOk = par.filter((x) => x.status === 200).length;
  check("5 parallel bir xil o'tkazma → bitta hujjat", (await trAll()) === n0 + 1, { docs: (await trAll()) - n0 });
  check("5 parallel: bittasi 200, qolganlari 400 «hozirgina saqlandi»", parOk === 1 && par.filter((x) => x.status === 400 && /hozirgina saqlandi/.test(x.text)).length === 4, par.map((x) => x.status));

  // clientToken: tarmoq uzilib qayta yuborilgan so'rov o'sha hujjatni qaytaradi (yangisini ochmaydi)
  const ctok = crypto.randomUUID();
  n0 = await trAll();
  const same = await Promise.all(Array.from({ length: 3 }, () => create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 8_000, clientToken: ctok })));
  const again = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 8_000, clientToken: ctok });
  check("clientToken bilan 3 parallel + 1 takror → bitta hujjat", (await trAll()) === n0 + 1, { docs: (await trAll()) - n0 });
  check("clientToken takrorlari hammasi 200, bitta id", [...same, again].every((x) => x.status === 200) && new Set([...same, again].map((x) => x.json?.id)).size === 1, [...same, again].map((x) => x.status));
  check("takror javobida «allaqachon saqlangan»", /allaqachon saqlangan/.test(again.json?.message ?? ""), again.json);
  const tdoc = await db.cashTransfer.findUnique({ where: { clientToken: ctok } });
  check("hujjatda clientToken saqlandi", !!tdoc && Number(tdoc.amount) === 8_000, tdoc);
  r = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 8_000, clientToken: crypto.randomUUID() });
  check("boshqa kalit, lekin 60 s ichida aynan shu o'tkazma → 400 (oyna)", r.status === 400 && /hozirgina saqlandi/.test(r.text) && (await trAll()) === n0 + 1, r.json);
  r = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 9_000, clientToken: "<script>" });
  check("g'alati clientToken e'tiborsiz → 200 (kalitsiz saqlanadi)", r.status === 200, r.json);

  section("Ruxsatlar");
  for (const [login, key] of [["test.sotuv", "payments"], ["test.haydovchi", "payments"], ["test.sklad", "cashflow"], ["test.snab", "transfer"], ["test.direktor", "payments"]] as const) {
    const t = await tok(login);
    const x = await create(t, key, { customerId: cust.id, amount: 1000, cashAccountId: cash.id, type: "INCOME", categoryIncome: "Boshqa tushum", fromAccountId: cash.id, toAccountId: bank.id });
    check(`${login} → ${key}: 403`, x.status === 403, x.status);
    check(`${login} → ${key} formasi: 403`, (await api("GET", `/api/mobile/form?key=${key}`, { token: t })).status === 403);
  }
  const fin = await tok("test.finance");
  check("Moliya → to'lov formasi 403 (vebda ham payments:create yo'q)", (await api("GET", "/api/mobile/form?key=payments", { token: fin })).status === 403);
  check("Moliya → kirim/chiqim formasi 200", (await api("GET", "/api/mobile/form?key=cashflow", { token: fin })).status === 200);
  check("Buxgalteriya → to'lov formasi 200", (await api("GET", "/api/mobile/form?key=payments", { token: await tok("test.buh") })).status === 200);
  check("noma'lum forma → 404", (await api("GET", "/api/mobile/form?key=constructor", { token: kassa })).status === 404);

  // Direktor kassirga "faqat ko'rish" berdi — veb kabi ilovada ham yozib bo'lmaydi
  try {
    await db.user.update({ where: { id: kassaUser.id }, data: { perms: { payments: "view", cashflow: "view" } } });
    r = await create(kassa, "payments", { customerId: cust.id, amount: 1000, cashAccountId: cash.id });
    check("payments: view → to'lov 403", r.status === 403, r.status);
    r = await create(kassa, "cashflow", { type: "INCOME", cashAccountId: cash.id, amount: 1000, categoryIncome: "Boshqa tushum" });
    check("cashflow: view → kirim 403", r.status === 403, r.status);
    const h = await api("GET", "/api/mobile/home", { token: kassa });
    check("bosh sahifada yaratish tugmalari yo'q", !(h.json?.quick ?? []).some((q: { kind: string }) => q.kind === "new"), h.json?.quick);
    await db.user.update({ where: { id: kassaUser.id }, data: { perms: { cashflow: ["create"] } } });
    r = await create(kassa, "transfer", { fromAccountId: cash.id, toAccountId: bank.id, amount: 1000 });
    check("cashflow: [create] → o'tkazma 403 (transfer berilmagan)", r.status === 403, r.status);
  } finally {
    await db.user.update({ where: { id: kassaUser.id }, data: { perms: kassaUser.perms === null ? Prisma.DbNull : (kassaUser.perms as Prisma.InputJsonValue) } });
  }

  await db.$disconnect();
  done();
}
void main();
