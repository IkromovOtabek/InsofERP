// Tashriflar jurnali (`VisitLog`, `lib/visits.ts`) va IT panel o'qishi (`lib/control/visits.ts`):
//  · veb parol bilan kirish va mobil ilova kirishi LOGIN bo'lib yoziladi (usul, qurilma), token yangilash — yo'q;
//  · `/api/visit`: faqat kirgan xodim, faqat ERP ichki yo'li (so'rov parametrlarisiz), bir sahifa 60 s da bir marta;
//  · panel xulosasi: bugun kirganlar, qurilma, bo'lim nomi, jurnal filtri, IT (SSO) yozuvlari sukut bo'yicha yashirin.
// Ishga tushirish: QA_BASE=… QA_DATABASE_URL=…/insof_test_x TENANT_DATABASE_URL=postgresql://…/{db} npx tsx scripts/qa/visits.mts
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, check, summary, BASE } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q, q1, exec, lit, DB_URL } from "./db.mjs";
import { parseUserAgent } from "../../src/lib/visit-info";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

// ───────── 0. User-Agent ajratish (sof funksiya) ─────────
console.log("\n0. Qurilma aniqlash");
let d = parseUserAgent(ANDROID);
check("0.1 Android telefon, Chrome", d.device === "mobile" && d.os === "Android" && d.browser === "Chrome 130", d);
d = parseUserAgent(IPHONE);
check("0.2 iPhone, Safari", d.device === "mobile" && d.os === "iOS" && d.browser === "Safari 18", d);
d = parseUserAgent(WIN);
check("0.3 Windows kompyuter, Edge", d.device === "desktop" && d.os === "Windows" && d.browser === "Edge 131", d);
d = parseUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1");
check("0.4 iPad — planshet", d.device === "tablet" && d.os === "iPadOS", d);
d = parseUserAgent("okhttp/4.12.0", true);
check("0.5 mobil ilova (okhttp) — Android ilova", d.device === "app" && d.os === "Android", d);

const dir = new Client("direktor");
const since = new Date(Date.now() - 2000).toISOString();
await dir.login("test.direktor");
const me = q1(`select id from "User" where login='test.direktor'`);
const rows = (where = "") => q(`select kind, path, method, device, os, browser, superadmin from "VisitLog" where "userId"=${lit(me.id)} and "createdAt" >= ${lit(since)} ${where} order by "createdAt"`);

// ───────── 1. Kirish ─────────
console.log("\n1. Kirish yoziladi");
let r = rows(`and kind='LOGIN'`);
check("1.1 veb parol bilan kirish — LOGIN «parol»", r.length === 1 && r[0].method === "parol" && r[0].superadmin === false, r);

const post = (body: unknown, opts: { cookie?: string; ua?: string } = {}) => fetch(BASE + "/api/visit", {
  method: "POST", redirect: "manual", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": opts.ua ?? ANDROID, ...(opts.cookie !== undefined ? { cookie: opts.cookie } : { cookie: dir.cookieHeader() }) },
});

// ───────── 2. Sahifa ─────────
console.log("\n2. Sahifa ochilishi");
let res = await post({ path: "/orders" });
r = rows(`and kind='PAGE' and path='/orders'`);
check("2.1 /orders — 204, PAGE yozildi (Android telefon)", res.status === 204 && r.length === 1 && r[0].device === "mobile" && r[0].os === "Android", [res.status, r]);
res = await post({ path: "/orders" });
check("2.2 60 s ichida shu sahifa — yangi yozuv yo'q", res.status === 204 && rows(`and kind='PAGE' and path='/orders'`).length === 1, res.status);
res = await post({ path: "/stock?tab=kirim#x" }, { ua: WIN });
r = rows(`and kind='PAGE' and path like '/stock%'`);
check("2.3 so'rov parametrlari olib tashlanadi, Windows kompyuter", res.status === 204 && r.length === 1 && r[0].path === "/stock" && r[0].device === "desktop", r);
for (const bad of [{ path: "https://evil.example/x" }, { path: "/api/mobile/me" }, { path: "" }, { path: 42 }, "buzuq{json"]) {
  res = await post(bad);
  check(`2.4 noto'g'ri yo'l rad etiladi: ${JSON.stringify(bad)}`, res.status === 400, res.status);
}
check("2.5 noto'g'ri yo'llardan yozuv yo'q", rows(`and kind='PAGE'`).length === 2, rows(`and kind='PAGE'`));
res = await post({ path: "/orders/anon" }, { cookie: "" });
check("2.6 kirmagan — yozilmaydi", res.status !== 204 && !q1(`select id from "VisitLog" where path='/orders/anon'`), res.status);

// ───────── 3. Mobil ilova ─────────
console.log("\n3. Mobil ilova kirishi");
const mob = await fetch(BASE + "/api/mobile/auth/login", {
  method: "POST", headers: { "content-type": "application/json", "user-agent": "okhttp/4.12.0", "x-forwarded-for": "10.88.1.7" },
  body: JSON.stringify({ login: "test.sotuv", password: "Test2026" }),
});
const mj = await mob.json().catch(() => null);
const sotuv = q1(`select id from "User" where login='test.sotuv'`);
const ml = q(`select method, device, os, ip from "VisitLog" where "userId"=${lit(sotuv.id)} and kind='LOGIN' and "createdAt" >= ${lit(since)}`);
check("3.1 mobil parol bilan kirish — «mobil», ilova, Android, IP", mob.status === 200 && ml.length === 1 && ml[0].method === "mobil" && ml[0].device === "app" && ml[0].os === "Android" && ml[0].ip === "10.88.1.7", [mob.status, ml]);
const ref = await fetch(BASE + "/api/mobile/auth/refresh", {
  method: "POST", headers: { "content-type": "application/json", "user-agent": "okhttp/4.12.0" }, body: JSON.stringify({ refreshToken: mj?.refreshToken }),
});
check("3.2 token yangilash — kirish bo'lib yozilmaydi", ref.status === 200 && q(`select id from "VisitLog" where "userId"=${lit(sotuv.id)} and kind='LOGIN' and "createdAt" >= ${lit(since)}`).length === 1, ref.status);

// ───────── 4. IT panel o'qishi ─────────
console.log("\n4. IT panel xulosasi");
// IT (SSO) yozuvi — sukut bo'yicha ko'rinmaydi
// Ustun zonasiz UTC (Prisma yozadi) — `CURRENT_TIMESTAMP` sessiya zonasida bo'lardi, shuning uchun vaqt aniq beriladi
exec(`insert into "VisitLog" (id, "userId", kind, path, device, superadmin, "createdAt") values ('qavisit_it_${Date.now().toString(36)}', ${lit(me.id)}, 'PAGE', '/settings', 'desktop', true, now() at time zone 'utc')`);
const dbName = new URL(DB_URL).pathname.slice(1);
const { tenantVisits, visitFilter, sectionLabel } = await import("../../src/lib/control/visits");
check("4.0 bo'lim nomi: /orders/123 → Zayavkalar", sectionLabel("/orders/abc123") === "Zayavkalar", sectionLabel("/orders/abc123"));
let v = await tenantVisits(dbName, visitFilter({ kun: "1" }));
const vOk = v.ok ? v : null;
const meRow = vOk?.users.find((u) => u.id === me.id);
check("4.1 bugun kirganlar ichida direktor va sotuvchi", !!vOk && vOk.usersToday >= 2 && !!meRow && vOk.users.some((u) => u.id === sotuv.id), v.ok ? { usersToday: v.usersToday } : v);
check("4.2 direktor: oxirgi sahifa /stock, Windows · Edge, kirish usuli «parol»", meRow?.lastLogin?.method === "parol" && meRow.visits >= 2 && meRow.lastPath === "/stock" && meRow.device === "desktop" && meRow.browser === "Edge 131", meRow);
check("4.3 bo'limlar: Zayavkalar va Sklad", !!vOk?.sections.some((s) => s.label === "Zayavkalar") && !!vOk?.sections.some((s) => s.label === "Sklad"), vOk?.sections);
check("4.4 IT yozuvi sukut bo'yicha yashirin", !!vOk && !vOk.journal.some((j) => j.superadmin) && !vOk.sections.some((s) => s.label.startsWith("Sozlamalar")), vOk?.sections);
v = await tenantVisits(dbName, visitFilter({ kun: "1", it: "1", u: me.id }));
check("4.5 «IT ham» + xodim filtri — IT yozuvi ko'rinadi, jurnal faqat shu xodimniki", v.ok && v.journal.some((j) => j.superadmin) && v.journal.every((j) => j.userId === me.id), v.ok ? v.journal.length : v);
v = await tenantVisits(dbName, visitFilter({ kun: "1", qurilma: "app" }));
check("4.6 qurilma filtri «Mobil ilova» — faqat ilova yozuvlari", v.ok && v.journal.length >= 1 && v.journal.every((j) => j.device === "app"), v.ok ? v.journal.map((j) => j.device) : v);
check("4.7 noto'g'ri filtr qiymatlari — sukut", JSON.stringify(visitFilter({ kun: "5", qurilma: "x", tur: "DROP", bet: "-3", u: "'; drop" })) === JSON.stringify({ days: 7, userId: undefined, device: undefined, kind: undefined, it: false, page: 0 }), visitFilter({ kun: "5" }));
v = await tenantVisits("insof_test_yoq_baza", visitFilter({}));
check("4.8 baza yo'q — xato emas, «missing»", !v.ok && v.reason === "missing", v);

summary("Tashriflar jurnali:");
process.exit(process.exitCode ?? 0); // panel klientining ulanishi ochiq qoladi
