// Oy yopish (Moliya → Oy yopish): ruxsatlar (yopish — buxgalteriya, ochish — faqat direktor, sabab majburiy),
// yopiq oyga kassa yozuvi rad etiladi (veb action va mobil API), ochiq oyga yoziladi, joriy oyni yopib bo'lmaydi,
// baza trigger'ining ustun qoidalari (schyot holati erkin, reysning GPS ustuni erkin — hisob ustuni yopiq), chetlab o'tish.
// Ishga tushirish (server ishlab turgan, .next build bor papkada):
//   QA_BASE=http://localhost:3210 DATABASE_URL=postgresql://…/insof_test_x npx tsx scripts/qa/period-close.mts
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, summary, BASE } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q1, lit } from "./db.mjs"; // test bazasi himoyasi (nomi insof_test… bo'lmasa to'xtaydi)

const url = process.env.DATABASE_URL ?? "";
if (!/\/insof_test[^/]*$/.test(url.split("?")[0]) || /insof_test_golden/.test(url)) { console.error("DATABASE_URL test bazasi emas"); process.exit(2); }

const { db } = await import("../../src/lib/db");
const { PeriodClosedError } = await import("../../src/lib/period-sections");
const { monthKeyOf, addMonths } = await import("../../src/lib/fin-report/period");

const cur = monthKeyOf(new Date());
const prev = addMonths(cur, -1);
const prevDay = `${prev}-15`;
// Mobil kassa faqat oxirgi 30 kun ichidagi sanani qabul qiladi — o'tgan oyning oxirgi kuni
const prevLast = (() => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const today = new Date().toISOString().slice(0, 10);
const dir = new Client(), buh = new Client(), kassa = new Client();
await Promise.all([dir.login("test.direktor"), buh.login("test.buh"), kassa.login("test.kassa")]);

// Veb formada sub manba majburiy — seed'dagi «Ta'sischi kiritmasi» da sub manba yo'q, «+» bilan qo'shiladi
const SUB = `QA oy yopish ${Date.now().toString(36).slice(-5)}`;
await dir.action("lib/quick-add-actions#quickAddCashCategory", [fd({ name: SUB, parent: "Ta'sischi kiritmasi" })], "/cashflow");

const PA = "moliya/oy-yopish/actions";
const close = (c: typeof dir, section: string, month: string) => c.action(`${PA}#closePeriodAction`, [section, month], "/moliya/oy-yopish");
const reopen = (c: typeof dir, section: string, month: string, why: string) => c.action(`${PA}#reopenPeriodAction`, [section, month, why], "/moliya/oy-yopish");
const cashTx = (date: string, note: string) => dir.action("cashflow/actions#createCashTx", [undefined, fd({ date, type: "INCOME", category: "Ta'sischi kiritmasi", subCategory: SUB, amount: "1234", note, cashAccountId: q1(`select id from "CashAccount" where "isActive" order by name limit 1`).id })], "/cashflow");
const isClosed = (section: string, month: string) => Boolean(q1(`select 1 as x from "PeriodClose" where section=${lit(section)} and month=${lit(month)}`)?.x);
const txCount = (note: string) => Number(q1(`select count(*)::int c from "CashTransaction" where note=${lit(note)}`).c);
const rejected = (r: { text: string; result: unknown }) => r.text.includes("INSOF_PERIOD_CLOSED") || JSON.stringify(r.result ?? "").includes("yopilgan");
const denied = (r: { status: number; text: string; result: unknown }) => r.status === 403 || /ruxsat/i.test(JSON.stringify(r.result ?? "")) || r.text.includes("NEXT_HTTP_ERROR_FALLBACK;403");

// Toza boshlanish
await db.periodClose.deleteMany({});

// ── 1. Ruxsatlar ──
const k1 = await close(kassa, "kassa", prev);
check("Kassir oyni yopa olmaydi", denied(k1) && !isClosed("kassa", prev), `status=${k1.status}`);
const cNow = await close(buh, "kassa", cur);
check("Joriy oyni yopib bo'lmaydi", !isClosed("kassa", cur) && JSON.stringify(cNow.result ?? "").includes("Joriy"));
const b1 = await close(buh, "kassa", prev);
check("Buxgalter o'tgan oyni yopadi", isClosed("kassa", prev), JSON.stringify(b1.result));
const audit1 = q1(`select count(*)::int c from "AuditLog" where entity='PeriodClose' and "entityId"=${lit(`kassa:${prev}`)}`).c;
check("Yopish AuditLog'ga yozildi", Number(audit1) >= 1);

// ── 2. Yopiq oyga yozish rad, ochiq oyga yoziladi ──
const N1 = `QA oy yopish ${Date.now()}`;
const r1 = await cashTx(prevDay, N1);
check("Yopiq oyga kassa kirimi rad etildi", txCount(N1) === 0 && rejected(r1), r1.text.slice(0, 200));
const N2 = `QA ochiq oy ${Date.now()}`;
await cashTx(today, N2);
check("Joriy oyga kassa kirimi yoziladi", txCount(N2) === 1);

// Mobil API: yopiq oy xatosi aniq kod va matn bilan (500 emas)
let ip = 0;
const mob = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(BASE + path, { method, headers: { "x-forwarded-for": `10.89.0.${++ip}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: { code?: string; message?: string; accessToken?: string } | null = null;
  try { json = JSON.parse(text); } catch { /* matn */ }
  return { status: r.status, json };
};
// Mobil kassa formasi faqat kassa/buxgalteriya/moliyaga (direktor ham emas — `strict`)
const mtok = (await mob("POST", "/api/mobile/auth/login", undefined, { login: "test.kassa", password: "Test2026" })).json?.accessToken;
const acc = q1(`select id from "CashAccount" where "isActive" order by name limit 1`).id as string;
const N3 = `QA mobil yopiq ${Date.now()}`;
const m1 = await mob("POST", "/api/mobile/create", mtok, { key: "cashflow", payload: { date: prevLast, type: "INCOME", categoryIncome: "Ta'sischi kiritmasi", amount: 777, note: N3, cashAccountId: acc } });
check("Mobil: yopiq oyga yozuv rad, aniq matn bilan (400, «yopilgan»)", txCount(N3) === 0 && m1.status === 400 && /yopilgan/.test(m1.json?.message ?? ""), `status=${m1.status} ${JSON.stringify(m1.json).slice(0, 160)}`);

// ── 3. Ochish: buxgalter ocholmaydi, direktor sababsiz ocholmaydi, sabab bilan ochadi ──
const b2 = await reopen(buh, "kassa", prev, "QA sinov");
check("Buxgalter yopiq oyni ocholmaydi (ruxsat berilmagan)", denied(b2) && isClosed("kassa", prev), `status=${b2.status}`);
const d1 = await reopen(dir, "kassa", prev, "  ");
check("Direktor sababsiz ocholmaydi", isClosed("kassa", prev) && JSON.stringify(d1.result ?? "").includes("sabab"));
await reopen(dir, "kassa", prev, "QA: xato topildi");
check("Direktor sabab bilan ochadi", !isClosed("kassa", prev));
const reason = q1(`select after->>'reason' r from "AuditLog" where entity='PeriodClose' and "entityId"=${lit(`kassa:${prev}`)} order by "createdAt" desc limit 1`)?.r;
check("Ochish sababi AuditLog'da", reason === "QA: xato topildi", String(reason));
const N4 = `QA ochilgan oy ${Date.now()}`;
await cashTx(prevDay, N4);
check("Ochilgan oyga yana yoziladi", txCount(N4) === 1);

// ── 4. «Hammasini yopish» ──
await close(buh, "all", prev);
const n = Number(q1(`select count(*)::int c from "PeriodClose" where month=${lit(prev)}`).c);
check("Hammasini yopish — 7 bo'lim", n === 7, String(n));

// ── 5. Trigger qoidalari (bazada) ──
// Schyot: holat ustuni erkin (keyingi oydagi to'lov), summa yopiq
const inv = await db.invoice.findFirst({ select: { id: true, date: true, status: true, amount: true } });
if (inv) {
  const m = monthKeyOf(inv.date);
  await db.periodClose.upsert({ where: { section_month: { section: "sotuv", month: m } }, create: { section: "sotuv", month: m, closedById: "qa" }, update: {} });
  let okStatus = true;
  try { await db.invoice.update({ where: { id: inv.id }, data: { status: inv.status } }); } catch { okStatus = false; }
  check("Yopiq oy schyotining holati o'zgaradi (to'lov keyingi oyda)", okStatus);
  let blocked = false;
  try { await db.invoice.update({ where: { id: inv.id }, data: { amount: Number(inv.amount) + 1 } }); } catch (e) { blocked = e instanceof PeriodClosedError; }
  check("Yopiq oy schyotining summasi o'zgarmaydi (PeriodClosedError)", blocked);
  await db.periodClose.deleteMany({ where: { section: "sotuv", month: m } });
} else console.log("  (schyot yo'q — schyot tekshiruvi o'tkazib yuborildi)");

// Reys: GPS ustuni erkin, hisob ustuni (payAmount) yopiq
const trip = await db.trip.findFirst({ where: { deliveredAt: { not: null } }, select: { id: true, deliveredAt: true, payAmount: true, lastSpeedKmh: true } });
if (trip?.deliveredAt) {
  const m = monthKeyOf(trip.deliveredAt);
  await db.periodClose.upsert({ where: { section_month: { section: "logistika", month: m } }, create: { section: "logistika", month: m, closedById: "qa" }, update: {} });
  let gps = true;
  try { await db.trip.update({ where: { id: trip.id }, data: { lastSpeedKmh: trip.lastSpeedKmh ?? 0 } }); } catch { gps = false; }
  check("Yopiq oy reysi: GPS ustuni yangilanadi", gps);
  let blocked = false;
  try { await db.trip.update({ where: { id: trip.id }, data: { payAmount: Number(trip.payAmount ?? 0) + 1 } }); } catch (e) { blocked = e instanceof PeriodClosedError; }
  check("Yopiq oy reysi: reys haqi o'zgarmaydi", blocked);
  await db.periodClose.deleteMany({ where: { section: "logistika", month: m } });
} else console.log("  (yetkazilgan reys yo'q — reys tekshiruvi o'tkazib yuborildi)");

// Chetlab o'tish (nazorat ostidagi skript): tranzaksiya ichida set_config
const N5 = `QA bypass ${Date.now()}`;
await db.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SELECT set_config('insof.period_bypass', 'on', true)`);
  await tx.cashTransaction.create({ data: { date: new Date(prevDay), type: "INCOME", cashAccountId: acc, amount: 1, category: "Ta'sischi kiritmasi", note: N5, createdById: q1(`select id from "User" where login='test.direktor'`).id } });
});
check("Chetlab o'tish faqat shu tranzaksiyada ishlaydi", txCount(N5) === 1);
let after = false;
try { await db.cashTransaction.create({ data: { date: new Date(prevDay), type: "INCOME", cashAccountId: acc, amount: 1, category: "Ta'sischi kiritmasi", note: N5, createdById: q1(`select id from "User" where login='test.direktor'`).id } }); } catch (e) { after = e instanceof PeriodClosedError; }
check("Tranzaksiyadan keyin himoya yana yoqiq", after);

await db.periodClose.deleteMany({});
await db.$disconnect();
summary("Oy yopish");
