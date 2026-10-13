// Sozlamalar → Limitlar (faqat direktor) — /settings?tab=limits:
//  · ruxsat: direktor bo'lmagan rol limit action'larini chaqira olmaydi (403), sahifa unga ochilmaydi (redirect);
//  · standart kredit limiti (CompanySettings.defaultCreditLimit): yangi mijozga — sotuvchi formadan nima yuborsa ham;
//  · kunlik quvvat + kunlik zayavka limiti (hajm/son): bo'sh → null, kasr m³, manfiy → xato, "O'zgarish yo'q";
//    regressiya: Zavod rekvizitlari (saveCompany) saqlanganda quvvat va davomat radiusi o'zgarmaydi;
//  · davomat radiusi 50–5000 m;
//  · mijozlar kredit limiti jadvali (saveCustomerLimits): bir nechta mijoz, audit, expected bo'yicha konflikt,
//    ichki "Sklad" kartochkasi o'zgarmaydi, manfiy / noto'g'ri JSON → xato;
//  · kunlik limit blokdan chiqarishda ham tekshiriladi (orderUnblock), qabul qilishda — chegarada teng bo'lsa ruxsat;
//  · Byudjet → "Holat chegaralari" (saveThresholds) katta xarid chegarasiga tegmaydi (yagona joyi — Limitlar).
// Har test o'z ma'lumotini T qo'shimchasi bilan ochadi; oxirida sozlamalar dastlabki holatga qaytariladi.
// Ishga tushirish: npx tsx scripts/qa/limits.mts  (QA_BASE, QA_DATABASE_URL — README.md)
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, eq2, summary } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q, q1, exec, lit } from "./db.mjs";

const T = Date.now().toString(36).slice(-5);
const DAY = 86_400_000;
const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
// Kunlik limit testi uchun noyob yetkazish kuni (120–319 kun keyin): boshqa testlarning zayavkalari sanoqqa aralashmasin
const D = new Date(Date.now() + (120 + (parseInt(T, 36) % 200)) * DAY).toISOString().slice(0, 10);

const dir = new Client("direktor"), sotuv = new Client("sotuv"), buh = new Client("buh");
await Promise.all([dir.login("test.direktor"), sotuv.login("test.sotuv"), buh.login("test.buh")]);
type C = typeof dir;

const n = (sql: string) => Number(q1(`select count(*)::int as n from (${sql}) x`).n);
const num = (v: unknown) => (v == null ? null : Number(v));
const settings = () => q1(`select "dailyCapacityM3" as cap, "dailyOrderMaxM3" as m3, "dailyOrderMaxCount" as cnt, "attendanceRadiusM" as radius,
  "defaultCreditLimit" as def, "supplyDirectorLimit" as supply, "alertWarnPct", "alertCritPct", "stockWarnDays", "stockCritDays", "overdueDays"
  from "CompanySettings" where id='main'`);
const snap = () => JSON.stringify(Object.fromEntries(Object.entries(settings() ?? {}).map(([k, v]) => [k, num(v)])));
const orig = settings();
if (!orig) { console.error("CompanySettings 'main' qatori yo'q — test bazasi tayyor emas"); process.exit(2); }
const origSnap = snap();
const dirId = q1(`select id from "User" where login='test.direktor'`).id;
const P: Record<string, string> = Object.fromEntries(q(`select code, id from "Product"`).map((p: { code: string; id: string }) => [p.code, p.id]));
const cust = (name: string) => q1(`select id, "creditLimit" from "Customer" where name=${lit(name)}`);
const limitOf = (id: string) => Number(q1(`select "creditLimit" from "Customer" where id=${lit(id)}`).creditLimit);
const statusOf = (id: string) => q1(`select status from "Order" where id=${lit(id)}`)?.status;
const settingsAudits = (key: string) => n(`select id from "AuditLog" where entity='CompanySettings' and "entityId"='main' and after ? ${lit(key)}`);

// ── Action chaqiruvlari (forma maydonlari — limits-forms.tsx dagi kabi) ──
const LIMITS = "/settings?tab=limits";
const v = (x: unknown) => (x == null ? "" : String(x));
const saveDaily = (c: C, x: { cap?: unknown; m3?: unknown; cnt?: unknown }, page = LIMITS) =>
  c.action("settings/actions#saveDailyOrderLimits", [undefined, fd({ dailyCapacityM3: v(x.cap), dailyOrderMaxM3: v(x.m3), dailyOrderMaxCount: v(x.cnt) })], page);
const saveDefault = (c: C, value: unknown, page = LIMITS) =>
  c.action("settings/actions#saveDefaultCreditLimit", [undefined, fd({ defaultCreditLimit: v(value) })], page);
const saveRadius = (c: C, value: unknown, page = LIMITS) =>
  c.action("settings/actions#saveAttendanceRadius", [undefined, fd({ attendanceRadiusM: v(value) })], page);
const saveLimits = (c: C, changes: unknown, page = LIMITS) =>
  c.action("settings/actions#saveCustomerLimits", [undefined, fd({ changes: typeof changes === "string" ? changes : JSON.stringify(changes) })], page);
const thresholds = (x: { alertWarnPct: unknown; alertCritPct: unknown; stockWarnDays: unknown; stockCritDays: unknown; overdueDays: unknown }) =>
  ({ alertWarnPct: v(x.alertWarnPct), alertCritPct: v(x.alertCritPct), stockWarnDays: v(x.stockWarnDays), stockCritDays: v(x.stockCritDays), overdueDays: v(x.overdueDays) });
const saveCustomer = (c: C, name: string, creditLimit: unknown) =>
  c.action("customers/actions#saveCustomer", [null, undefined, fd({ name, inn: "", creditLimit: v(creditLimit), isActive: "on" })], "/customers/new");

const orderForm = (o: { customerId?: string; newName?: string; payment: "credit" | "prepay"; prepay?: number; code: string; qty: number; price: number; date: string }) => fd({
  customerMode: o.customerId ? "existing" : "new", customerId: o.customerId, newName: o.newName,
  deliveryDate: o.date, deliveryAddress: `LT obyekt ${T}`, needsDelivery: "on", payment: o.payment, prepayAmount: o.prepay ?? 0,
  "productId[]": [P[o.code]], "qtyM3[]": [o.qty], "price[]": [o.price], "nds[]": ["0"],
});
const orderIdFrom = (r: { redirect?: string | null }) => r.redirect?.match(/\/orders\/([^?;]+)/)?.[1];
const createdOrders: string[] = [];
async function newOrder(o: Parameters<typeof orderForm>[0]): Promise<string | undefined> {
  const r = await sotuv.action("orders/actions#createOrder", [undefined, orderForm(o)], "/orders/new");
  const id = orderIdFrom(r);
  if (id) createdOrders.push(id);
  else console.log("    createOrder:", JSON.stringify(r.result ?? r.text.slice(0, 300)));
  return id;
}

/** Sozlamalarni dastlabki holatga qaytarish: avval action'lar orqali, farq qolsa — to'g'ridan (faqat test bazasi). */
async function restore() {
  for (const id of createdOrders) {
    if (["DRAFT", "BLOCKED", "CONFIRMED"].includes(statusOf(id))) {
      await dir.action("orders/actions#cancelOrder", [id, "QA: limitlar testi tugadi"], `/orders/${id}`).catch(() => null);
    }
  }
  const steps: [string, () => Promise<unknown>][] = [
    ["kunlik limit", () => saveDaily(dir, { cap: orig.cap, m3: orig.m3, cnt: orig.cnt })],
    ["radius", () => saveRadius(dir, orig.radius)],
    ["standart limit", () => saveDefault(dir, orig.def)],
    ["holat chegaralari", () => dir.action("dashboard/byudjet/actions#saveThresholds", [undefined, fd(thresholds(orig))], "/dashboard/byudjet")],
    ["katta xarid", () => dir.action("settings/actions#saveSupplyDirectorLimit", [undefined, fd({ supplyDirectorLimit: v(orig.supply) })], LIMITS)],
  ];
  for (const [name, f] of steps) { try { await f(); } catch (e) { console.log(`    tiklash (${name}):`, String(e)); } }
  if (snap() !== origSnap) {
    const s = (x: unknown) => (x == null ? "null" : String(Number(x)));
    exec(`update "CompanySettings" set "dailyCapacityM3"=${s(orig.cap)}, "dailyOrderMaxM3"=${s(orig.m3)}, "dailyOrderMaxCount"=${s(orig.cnt)},
      "attendanceRadiusM"=${s(orig.radius)}, "defaultCreditLimit"=${s(orig.def)}, "supplyDirectorLimit"=${s(orig.supply)},
      "alertWarnPct"=${s(orig.alertWarnPct)}, "alertCritPct"=${s(orig.alertCritPct)}, "stockWarnDays"=${s(orig.stockWarnDays)},
      "stockCritDays"=${s(orig.stockCritDays)}, "overdueDays"=${s(orig.overdueDays)} where id='main'`);
    console.log("    tiklash: action'lar bilan to'liq qaytmadi — bazada to'g'ridan qaytarildi");
  }
}

let r;
try {
  // ───────── 1. Ruxsat: faqat direktor ─────────
  console.log("\n1. Ruxsat: limitlar faqat direktorga");
  const anyCust = q1(`select id, "creditLimit" from "Customer" where not "isInternal" order by "createdAt" limit 1`);
  const before1 = snap(), lim1 = Number(anyCust.creditLimit);
  const denied: [string, string, FormData][] = [
    ["saveDefaultCreditLimit", "standart kredit limiti", fd({ defaultCreditLimit: "777" })],
    ["saveCustomerLimits", "mijozlar limiti jadvali", fd({ changes: JSON.stringify([{ id: anyCust.id, limit: 777, expected: lim1 }]) })],
    ["saveDailyOrderLimits", "kunlik zayavka limiti", fd({ dailyCapacityM3: "1", dailyOrderMaxM3: "1", dailyOrderMaxCount: "1" })],
    ["saveAttendanceRadius", "davomat radiusi", fd({ attendanceRadiusM: "60" })],
  ];
  let i = 0;
  for (const [name, label, form] of denied) {
    r = await sotuv.action(`settings/actions#${name}`, [undefined, form], "/dashboard");
    // Sozlamalar action'lari faqat /settings sahifasida ro'yxatda: boshqa sahifadan chaqirilsa Next uni topmaydi va
    // bajarmaydi (bo'sh javob); /settings ga esa middleware o'tkazmaydi (1.6). Ichidagi requireSession(["DIRECTOR"]) — uchinchi qatlam.
    // Asosiy dalil — 1.7: rad etilgan chaqiruvlardan keyin hech narsa o'zgarmagan.
    check(`1.${++i} sotuvchi ${label}ni saqlay olmaydi (${name} — bajarilmaydi)`, [200, 307, 403].includes(r.status) && !r.result?.ok && !r.redirect, `${r.status} ${JSON.stringify(r.result ?? "")}`);
  }
  r = await buh.action("settings/actions#saveCustomerLimits", [undefined, denied[1][2]], "/dashboard");
  check("1.5 buxgalter (kartada limitni o'zgartiradi) jadval orqali bir nechta mijozga bera olmaydi", [200, 307, 403].includes(r.status) && !r.result?.ok, `${r.status}`);
  r = await sotuv.action("settings/actions#saveDefaultCreditLimit", [undefined, fd({ defaultCreditLimit: "777" })], LIMITS);
  check("1.6 sotuvchi Limitlar sahifasidan ham chaqira olmaydi (middleware 307 yoki 403)", [307, 403].includes(r.status) && !r.result?.ok, `${r.status}`);
  check("1.7 rad etilgan chaqiruvlardan keyin sozlamalar va mijoz limiti o'zgarmagan", snap() === before1 && eq2(limitOf(anyCust.id), lim1), [before1, snap()]);

  let page = await dir.get(LIMITS);
  check("1.8 direktorga /settings?tab=limits ochiladi (200, «Mijozlar kredit limiti»)", page.status === 200 && page.text.includes("Mijozlar kredit limiti"), `${page.status} ${page.location ?? ""}`);
  check("1.9 Limitlar'da barcha formalar: standart limit, kunlik limit/quvvat, katta xarid, davomat radiusi",
    ["defaultCreditLimit", "dailyCapacityM3", "dailyOrderMaxM3", "dailyOrderMaxCount", "supplyDirectorLimit", "attendanceRadiusM"].every((k) => page.text.includes(`name="${k}"`)));
  for (const [who, c] of [["sotuvchi", sotuv], ["buxgalter", buh]] as [string, C][]) {
    page = await c.get(LIMITS);
    check(`1.10 ${who}ga Limitlar sahifasi ochilmaydi (redirect)`, [303, 307, 308].includes(page.status) && /\/dashboard/.test(page.location ?? "") && !page.text.includes("Mijozlar kredit limiti"), `${page.status} ${page.location ?? ""}`);
  }
  page = await dir.get("/settings?tab=company");
  check("1.11 Zavod rekvizitlarida kunlik quvvat va davomat radiusi maydoni yo'q (Limitlar'ga ko'chgan)",
    page.status === 200 && !page.text.includes('name="dailyCapacityM3"') && !page.text.includes('name="attendanceRadiusM"') && !page.text.includes('name="supplyDirectorLimit"'), `${page.status}`);

  // ───────── 2. Standart kredit limiti ─────────
  console.log("\n2. Yangi mijozga standart kredit limiti");
  const a2 = settingsAudits("defaultCreditLimit");
  r = await saveDefault(dir, "5000000");
  check("2.1 direktor standart limitni 5 000 000 qildi", r.result?.ok === true && eq2(settings().def, 5000000), [r.result, settings().def]);
  check("2.2 AuditLog: CompanySettings.defaultCreditLimit 0 → 5 000 000 (direktor)",
    settingsAudits("defaultCreditLimit") === a2 + 1
    && n(`select id from "AuditLog" where entity='CompanySettings' and "userId"=${lit(dirId)} and (after->>'defaultCreditLimit')::numeric = 5000000`) >= 1);
  r = await saveDefault(dir, "5 000 000");
  check("2.3 takror saqlash (probel bilan) — «O'zgarish yo'q», audit yozilmadi", r.result?.ok === true && r.result.note === "O'zgarish yo'q" && settingsAudits("defaultCreditLimit") === a2 + 1, r.result);
  r = await saveDefault(dir, "-1");
  check("2.4 manfiy standart limit — xato, qiymat o'zgarmadi", /Summa noto'g'ri/.test(r.result?.error ?? "") && eq2(settings().def, 5000000), r.result);

  const s2 = `LT Sotuv Mijoz ${T}`;
  r = await saveCustomer(sotuv, s2, 999);
  const c2 = cust(s2);
  check("2.5 sotuvchi yangi mijoz ochdi (forma redirect qiladi)", /^\/customers/.test(r.redirect ?? "") && !!c2, `${r.status} ${r.redirect} ${JSON.stringify(r.result ?? "")}`);
  check("2.6 sotuvchi limitga 999 yozgan bo'lsa ham — standart 5 000 000 berildi", c2 && eq2(c2.creditLimit, 5000000), c2);
  const d2 = `LT Direktor Mijoz ${T}`;
  r = await saveCustomer(dir, d2, "1234567.5");
  check("2.7 direktor ochgan mijozga — o'zi yozgan limit (1 234 567,5)", /^\/customers/.test(r.redirect ?? "") && eq2(cust(d2)?.creditLimit, 1234567.5), cust(d2));
  const z2 = `LT Zayavka Mijoz ${T}`;
  const oz = await newOrder({ newName: z2, payment: "prepay", prepay: 550000, code: "M200", qty: 1, price: 550000, date: tomorrow });
  check("2.8 zayavka formasidan ochilgan yangi mijozga ham standart 5 000 000", !!oz && eq2(cust(z2)?.creditLimit, 5000000), cust(z2));
  r = await saveDefault(dir, "0");
  check("2.9 standart limit 0 ga qaytarildi", r.result?.ok === true && eq2(settings().def, 0), r.result);
  const s2b = `LT Sotuv Mijoz 0 ${T}`;
  await saveCustomer(sotuv, s2b, 999);
  check("2.10 standart 0 — sotuvchi ochgan yangi mijoz limiti 0", eq2(cust(s2b)?.creditLimit, 0), cust(s2b));

  // ───────── 3. Kunlik zayavka limiti va quvvat ─────────
  console.log("\n3. Kunlik quvvat va kunlik zayavka limiti");
  const a3 = settingsAudits("dailyCapacityM3");
  r = await saveDaily(dir, { cap: "345.5", m3: "12,5", cnt: "4" });
  let st = settings();
  check("3.1 quvvat 345,5 / hajm 12,5 m³ (vergul bilan) / son 4 saqlandi", r.result?.ok === true && r.result.note === "Saqlandi"
    && eq2(st.cap, 345.5) && eq2(st.m3, 12.5) && Number(st.cnt) === 4, [r.result, st]);
  check("3.2 AuditLog: kunlik limit yozuvi (uchala maydon)", settingsAudits("dailyCapacityM3") === a3 + 1
    && n(`select id from "AuditLog" where entity='CompanySettings' and after ? 'dailyOrderMaxCount' and (after->>'dailyOrderMaxCount')::int = 4 and (after->>'dailyOrderMaxM3')::numeric = 12.5`) >= 1);
  r = await saveDaily(dir, { cap: "345.50", m3: "12.5", cnt: "4" });
  check("3.3 bir xil qiymatlar — «O'zgarish yo'q», audit yozilmadi", r.result?.ok === true && r.result.note === "O'zgarish yo'q" && settingsAudits("dailyCapacityM3") === a3 + 1, r.result);
  r = await saveDaily(dir, { cap: "345.5", m3: "-5", cnt: "4" });
  check("3.4 manfiy hajm — xato, qiymatlar o'zgarmadi", /Kunlik hajm chegarasi/.test(r.result?.error ?? "") && eq2(settings().m3, 12.5), r.result);
  r = await saveDaily(dir, { cap: "-1", m3: "12.5", cnt: "4" });
  check("3.5 manfiy quvvat — xato", /Kunlik quvvat/.test(r.result?.error ?? "") && eq2(settings().cap, 345.5), r.result);
  r = await saveDaily(dir, { cap: "345.5", m3: "12.5", cnt: "2.5" });
  check("3.6 kasr zayavka soni — xato (butun son)", /Kunlik zayavka soni.*butun/.test(r.result?.error ?? "") && Number(settings().cnt) === 4, r.result);

  // Regressiya: Zavod rekvizitlari formasida bu maydonlar yo'q — saqlanganda null/standartga tushib qolmasin
  r = await saveRadius(dir, "777");
  check("3.7 (tayyorlov) davomat radiusi 777 m", r.result?.ok === true && Number(settings().radius) === 777, r.result);
  const co = q1(`select name, "legalName", inn, address, phone, phone2, email, "bankName", "bankAccount", mfo, "directorName", about, "workingHours",
    "foundedYear", "openHour", "closeHour", "sameDayCutoffHour", "workSunday", telegram from "CompanySettings" where id='main'`);
  const { workSunday, ...rest } = co;
  const auditCo = n(`select id from "AuditLog" where entity='CompanySettings' and after ? 'legalName'`);
  r = await dir.action("settings/actions#saveCompany", [undefined, fd({ ...rest, workSunday: workSunday ? "on" : undefined })], "/settings?tab=company");
  st = settings();
  check("3.8 Zavod rekvizitlari (to'liq forma) saqlandi", r.result?.ok === true && n(`select id from "AuditLog" where entity='CompanySettings' and after ? 'legalName'`) === auditCo + 1, r.result ?? r.status);
  check("3.9 saveCompany'dan keyin kunlik quvvat, hajm/son limiti va davomat radiusi O'ZGARMAGAN",
    eq2(st.cap, 345.5) && eq2(st.m3, 12.5) && Number(st.cnt) === 4 && Number(st.radius) === 777, st);
  r = await saveDaily(dir, { cap: "", m3: "", cnt: "0" });
  st = settings();
  check("3.10 bo'sh / 0 — cheklov yo'q (uchalasi null)", r.result?.ok === true && st.cap == null && st.m3 == null && st.cnt == null, [r.result, st]);

  // ───────── 4. Davomat radiusi ─────────
  console.log("\n4. Davomat radiusi (50–5000 m)");
  r = await saveRadius(dir, "49");
  check("4.1 49 m — xato (kamida 50)", /kamida 50/.test(r.result?.error ?? "") && Number(settings().radius) === 777, r.result);
  r = await saveRadius(dir, "5001");
  check("4.2 5001 m — xato (ko'pi bilan 5000)", /ko'pi bilan 5000/.test(r.result?.error ?? "") && Number(settings().radius) === 777, r.result);
  r = await saveRadius(dir, "120.5");
  check("4.3 kasr radius — xato (butun son)", /butun son/.test(r.result?.error ?? ""), r.result);
  const a4 = settingsAudits("attendanceRadiusM");
  r = await saveRadius(dir, "350");
  check("4.4 350 m saqlandi + audit", r.result?.ok === true && Number(settings().radius) === 350 && settingsAudits("attendanceRadiusM") === a4 + 1, [r.result, settings().radius]);
  r = await saveRadius(dir, "350");
  check("4.5 takror 350 — «O'zgarish yo'q»", r.result?.note === "O'zgarish yo'q" && settingsAudits("attendanceRadiusM") === a4 + 1, r.result);

  // ───────── 5. Mijozlar kredit limiti jadvali ─────────
  console.log("\n5. Mijozlar kredit limiti — bir nechta mijozga birdan");
  const nA = `LT Limit A ${T}`, nB = `LT Limit B ${T}`;
  await saveCustomer(dir, nA, 100000);
  await saveCustomer(dir, nB, 200000);
  const cA = cust(nA).id as string, cB = cust(nB).id as string;
  const viaSettings = () => n(`select id from "AuditLog" where entity='CustomerCreditLimit' and "entityId" in (${lit(cA)}, ${lit(cB)}) and after->>'via'='settings'`);
  r = await saveLimits(dir, [{ id: cA, limit: 1500000, expected: 100000 }, { id: cB, limit: 2500000.5, expected: 200000 }]);
  check("5.1 ikki mijoz limiti birdan o'zgardi (1 500 000 va 2 500 000,5)", r.result?.ok === true && /2 ta mijoz limiti yangilandi/.test(r.result.note ?? "")
    && eq2(limitOf(cA), 1500000) && eq2(limitOf(cB), 2500000.5), r.result);
  check("5.2 AuditLog: har mijozga CustomerCreditLimit yozuvi (via settings) — 2 ta", viaSettings() === 2
    && n(`select id from "AuditLog" where entity='CustomerCreditLimit' and "entityId"=${lit(cA)} and (before->>'creditLimit')::numeric = 100000 and (after->>'creditLimit')::numeric = 1500000`) === 1, viaSettings());
  r = await saveLimits(dir, [{ id: cA, limit: 3000000, expected: 999 }]);
  check("5.3 expected noto'g'ri (shu orada o'zgargan) — konflikt xatosi, limit o'zgarmadi",
    /shu orada boshqa joyda o'zgartirilgan/.test(r.result?.error ?? "") && (r.result?.error ?? "").includes(nA) && eq2(limitOf(cA), 1500000) && viaSettings() === 2, r.result);
  r = await saveLimits(dir, [{ id: cA, limit: 3000000, expected: 999 }, { id: cB, limit: 2600000, expected: 2500000.5 }]);
  check("5.4 aralash: konfliktli qator saqlanmadi, to'g'risi saqlandi va xatoda aytildi",
    /shu orada boshqa joyda/.test(r.result?.error ?? "") && /1 ta mijoz limiti yangilandi/.test(r.result?.error ?? "") && eq2(limitOf(cA), 1500000) && eq2(limitOf(cB), 2600000), r.result);
  r = await saveLimits(dir, [{ id: cA, limit: 1500000, expected: 1500000 }]);
  check("5.5 o'zgarmagan qiymat — «1 ta o'zgarmagan»", r.result?.ok === true && /1 ta o'zgarmagan/.test(r.result.note ?? ""), r.result);

  let sklad = q1(`select id, "creditLimit" from "Customer" where "isInternal" limit 1`);
  if (!sklad) {
    // Ichki "Sklad" kartochkasi birinchi sklad zayavkasida ochiladi — zayavka darhol bekor qilinadi
    r = await dir.action("orders/actions#createStockOrder", [undefined, fd({ dueDate: tomorrow, "productId[]": [P.M300], "qty[]": [1] })], "/orders/new");
    const so = orderIdFrom(r);
    if (so) await dir.action("orders/actions#cancelOrder", [so, "QA: Sklad kartochkasi uchun"], `/orders/${so}`);
    sklad = q1(`select id, "creditLimit" from "Customer" where "isInternal" limit 1`);
  }
  const skladLim = Number(sklad?.creditLimit ?? 0);
  r = await saveLimits(dir, [{ id: sklad?.id ?? "yoq", limit: 9000000, expected: skladLim }]);
  check("5.6 ichki «Sklad» kartochkasi limiti o'zgarmaydi («topilmadi»)", !!sklad && r.result?.ok === true && /1 ta topilmadi/.test(r.result.note ?? "") && eq2(limitOf(sklad.id), skladLim), [r.result, sklad]);
  r = await saveLimits(dir, [{ id: cA, limit: -5, expected: 1500000 }]);
  check("5.7 manfiy limit — xato, o'zgarmadi", /manfiy/.test(r.result?.error ?? "") && eq2(limitOf(cA), 1500000), r.result);
  r = await saveLimits(dir, "{oops");
  check("5.8 noto'g'ri JSON — xato", /Ma'lumot noto'g'ri/.test(r.result?.error ?? ""), r.result);
  r = await saveLimits(dir, []);
  check("5.9 bo'sh ro'yxat — «O'zgarish yo'q» xatosi", /O'zgarish yo'q/.test(r.result?.error ?? ""), r.result);

  // ───────── 6. Kunlik limit: qabul qilish va blokdan chiqarish ─────────
  console.log(`\n6. Kunlik zayavka limiti — blokdan chiqarishda ham (yetkazish kuni ${D})`);
  const dayWhere = `o.kind='SALE' and o.status in ('CONFIRMED','IN_PRODUCTION','DELIVERED','CLOSED') and o."deliveryDate" >= ${lit(D)}::date and o."deliveryDate" < ${lit(D)}::date + 1`;
  const confirmedOn = () => n(`select o.id from "Order" o where ${dayWhere}`);
  const m3On = () => Number(q1(`select coalesce(sum(i."qtyM3"), 0) as s from "Order" o join "OrderItem" i on i."orderId"=o.id join "Product" p on p.id=i."productId" where ${dayWhere} and p.unit='m3'`).s);
  const unblocks = (id: string) => n(`select id from "AuditLog" where entity='Order' and "entityId"=${lit(id)} and after->>'by'='director'`);
  r = await saveDaily(dir, {});
  check("6.0 kunlik limitlar bo'sh (tayyorlov)", r.result?.ok === true && settings().cnt == null && settings().m3 == null, r.result);
  const n6 = `LT Kunlik ${T}`;
  await saveCustomer(dir, n6, 1000000);
  const c6 = cust(n6)?.id as string;
  const o1 = await newOrder({ customerId: c6, payment: "credit", code: "M250", qty: 1, price: 600000, date: D });
  if (o1) await sotuv.action("orders/actions#confirmOrder", [o1], `/orders/${o1}`);
  check("6.1 limit ichidagi qarzga zayavka (0,6 mln ≤ 1 mln) qabul qilindi", !!o1 && statusOf(o1) === "CONFIRMED", o1 && statusOf(o1));
  const o2 = await newOrder({ customerId: c6, payment: "credit", code: "M250", qty: 10, price: 600000, date: D });
  if (o2) r = await sotuv.action("orders/actions#confirmOrder", [o2], `/orders/${o2}`);
  check("6.2 kredit limitidan oshgan zayavka (6 mln) BLOCKED", !!o2 && statusOf(o2) === "BLOCKED", [o2 && statusOf(o2), r?.result]);
  if (!o1 || !o2) throw new Error("6-test zayavkalari ochilmadi — qolgan tekshiruvlar ma'nosiz");

  const cnt6 = confirmedOn();
  r = await saveDaily(dir, { cnt: cnt6 });
  check(`6.3 kunlik zayavka soni limiti = shu kunga tasdiqlanganlar soni (${cnt6})`, r.result?.ok === true && Number(settings().cnt) === cnt6 && cnt6 >= 1, [r.result, cnt6]);
  r = await dir.action("orders/actions#unblockOrder", [o2], `/orders/${o2}`);
  check("6.4 direktor blokni ocholmadi: «Blok ochilmadi — … kunlik zayavka soni limiti to'lgan»",
    /^Blok ochilmadi — .*kunlik zayavka soni limiti to'lgan: limit \d+ ta/.test(r.result?.error ?? "") && /Limitni Sozlamalar/.test(r.result?.error ?? ""), r.result);
  check("6.5 zayavka BLOCKED qoldi, blok ochilgani auditga yozilmadi", statusOf(o2) === "BLOCKED" && unblocks(o2) === 0, statusOf(o2));
  const m3a = m3On();
  r = await saveDaily(dir, { m3: m3a + 9.5 });
  r = await dir.action("orders/actions#unblockOrder", [o2], `/orders/${o2}`);
  check(`6.6 hajm limiti (${m3a + 9.5} m³ < ${m3a} + 10) — «Blok ochilmadi — … kunlik hajm limiti oshib ketadi», BLOCKED`,
    /^Blok ochilmadi — .*kunlik hajm limiti oshib ketadi/.test(r.result?.error ?? "") && statusOf(o2) === "BLOCKED", r.result);
  r = await saveDaily(dir, {});
  r = await dir.action("orders/actions#unblockOrder", [o2], `/orders/${o2}`);
  check("6.7 limitlar bo'shatilgach blok ochildi — CONFIRMED (+audit)", r.result?.ok === true && statusOf(o2) === "CONFIRMED" && unblocks(o2) === 1, r.result);

  // Qabul qilishda (sotuvchi): son limiti to'lgan — rad; chegarada aynan teng — ruxsat
  const o3 = await newOrder({ newName: `LT Kunlik Naqd ${T}`, payment: "prepay", prepay: 550000, code: "M200", qty: 1, price: 550000, date: D });
  await saveDaily(dir, { cnt: confirmedOn() });
  r = o3 ? await sotuv.action("orders/actions#confirmOrder", [o3], `/orders/${o3}`) : null;
  check("6.8 sotuvchi qabul qila olmadi: kunlik son limiti to'lgan (maslahat — boshqa kun), DRAFT qoldi",
    !!o3 && /kunlik zayavka soni limiti to'lgan/.test(r?.result?.error ?? "") && /Boshqa yetkazish kuniga/.test(r?.result?.error ?? "") && statusOf(o3) === "DRAFT", r?.result);
  await saveDaily(dir, { cnt: confirmedOn() + 1, m3: m3On() + 1 });
  r = o3 ? await sotuv.action("orders/actions#confirmOrder", [o3], `/orders/${o3}`) : null;
  check("6.9 son va hajm limitiga aynan teng — qabul qilindi (CONFIRMED)", !!o3 && r?.result?.ok === true && statusOf(o3) === "CONFIRMED", r?.result);
  r = await saveDaily(dir, {});
  check("6.10 kunlik limitlar null ga qaytarildi", r.result?.ok === true && settings().cnt == null && settings().m3 == null, r.result);

  // ───────── 7. Byudjet chegaralari katta xarid chegarasiga tegmaydi ─────────
  console.log("\n7. Byudjet → Holat chegaralari va katta xarid chegarasi");
  const before7 = settings();
  r = await dir.action("dashboard/byudjet/actions#saveThresholds",
    [undefined, fd({ ...thresholds(before7), overdueDays: String(Number(before7.overdueDays) + 1), supplyDirectorLimit: "1" })], "/dashboard/byudjet");
  const after7 = settings();
  check("7.1 saveThresholds saqlandi (muddati o'tgan qarz kuni +1)", r.result?.ok === true && Number(after7.overdueDays) === Number(before7.overdueDays) + 1, [r.result, after7.overdueDays]);
  check("7.2 formaga supplyDirectorLimit=1 qo'shilsa ham katta xarid chegarasi o'zgarmadi", eq2(after7.supply, before7.supply), [before7.supply, after7.supply]);
  page = await dir.get("/dashboard/byudjet");
  check("7.3 Byudjet sahifasida katta xarid maydoni yo'q (yagona joyi — Limitlar)", page.status === 200 && !page.text.includes('name="supplyDirectorLimit"'), `${page.status}`);
  r = await dir.action("settings/actions#saveSupplyDirectorLimit", [undefined, fd({ supplyDirectorLimit: String(Number(before7.supply) + 1000) })], LIMITS);
  check("7.4 Limitlar'dagi katta xarid formasi ishlaydi", r.result?.ok === true && eq2(settings().supply, Number(before7.supply) + 1000), r.result);
} catch (e) {
  check("kutilmagan xato — test to'xtadi", false, String((e as Error)?.stack ?? e));
} finally {
  await restore();
}
check("8. sozlamalar dastlabki holatga qaytdi (boshqa testlarga ta'sir yo'q)", snap() === origSnap, [origSnap, snap()]);

summary("limits:");
