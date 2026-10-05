/**
 * QA (C) — tashqi integratsiyalar test rejimida: ECO webhook (HMAC, replay, eskirgan vaqt, buzuq body),
 * Telegram webhook (sir, namunaviy update'lar), AI (kalitsiz — qoida javobi, rate limit), /api/geo (sozlanmagan).
 * Real tashqi servisga hech narsa ketmasligi server jurnalidan ham tekshiriladi (QA_SERVER_LOG).
 */
import { createHmac } from "crypto";
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { api, check, done, section, tok, webCookie } from "./c-lib";
import { PrismaClient } from "@/generated/prisma";

const db = new PrismaClient();
const ECO_SECRET = process.env.ECO_WEBHOOK_SECRET!;
const TG_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!;

/** AI javobi: matn yoki `{text, bullets?}` obyekt (qoida asosidagi javob). */
const hasAnswer = (a: unknown) => (typeof a === "string" && a.length > 0) || (!!a && typeof a === "object" && typeof (a as { text?: unknown }).text === "string" && (a as { text: string }).text.length > 0);

function ecoSigned(body: string, ts = Date.now(), secret = ECO_SECRET) {
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "x-eco-timestamp": String(ts), "x-eco-signature": `sha256=${sig}`, "content-type": "application/json" };
}

async function main() {
  section("ECO webhook");
  let r = await api("GET", "/api/eco/webhook");
  check("GET → configured:true", r.status === 200 && r.json?.configured === true, r.json);
  const body = JSON.stringify({ event: "unknown.event", nonce: Math.random() });
  const h = ecoSigned(body);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: h });
  check("to'g'ri HMAC → 200", r.status === 200 && r.json?.ok === true, r.json);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: h });
  check("replay (aynan shu so'rov) → 409", r.status === 409, r.json);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: { ...h, "x-eco-signature": "sha256=" + "0".repeat(64) } });
  check("noto'g'ri imzo → 401", r.status === 401, r.json);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: ecoSigned(body, Date.now(), "boshqa-sir") });
  check("boshqa sir bilan imzo → 401", r.status === 401, r.json);
  const old = ecoSigned(body, Date.now() - 10 * 60_000);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: old });
  check("10 daqiqa eski vaqt → 401", r.status === 401, r.json);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: { ...h, "x-eco-timestamp": "abc" } });
  check("raqamsiz timestamp → 401", r.status === 401, r.json);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: { "content-type": "application/json" } });
  check("imzosiz → 401", r.status === 401, r.json);
  r = await api("POST", "/api/eco/webhook", { raw: body, headers: { ...h, "x-eco-signature": "sha256=abc" } });
  check("qisqa imzo → 401 (500 emas)", r.status === 401, r.json);
  for (const [name, raw] of [["buzuq JSON", "{oops"], ["null", "null"], ["massiv", "[1,2]"], ["raqam", "42"], ["bo'sh", ""], ["satr", "\"x\""]] as const) {
    r = await api("POST", "/api/eco/webhook", { raw, headers: ecoSigned(raw) });
    check(`imzoli ${name} → 400`, r.status === 400, `${r.status} ${r.text.slice(0, 80)}`);
  }
  // Hodisalar, maydonlari yetishmaydi — e'tiborsiz (200), 500 emas
  for (const ev of [
    { event: "delivery.status_changed" },
    { event: "delivery.status_changed", externalRef: "yoq", deliveryId: "d1", to: "COMPLETED" },
    { event: "delivery.status_changed", externalRef: 123, deliveryId: {}, to: "ARRIVED" },
    { event: "driver.changed", userId: "u1" },
    { event: "driver.changed", userId: "qa-eco-u1", phone: "+998909111111", isActive: false, reason: "removed" },
    { event: "vehicle.changed", vehicleId: "v1", plateNumber: "01QA001", isActive: false },
    { event: "customer.registered", externalRef: "yoq", phone: "+998909111112" },
    { event: "driver.delete_requested", userId: "qa-eco-u2" },
    { event: 5 },
  ]) {
    const b = JSON.stringify({ ...ev, n: Math.random() });
    r = await api("POST", "/api/eco/webhook", { raw: b, headers: ecoSigned(b) });
    check(`hodisa ${JSON.stringify(ev).slice(0, 70)} → <500`, r.status < 500, `${r.status} ${r.text.slice(0, 120)}`);
  }

  section("ECO — chiquvchi so'rovlar o'chiq");
  r = await api("POST", "/api/eco/sync", {});
  check("/api/eco/sync tokensiz → 401/403/503 (500 emas)", r.status < 500 && r.status >= 400, r.status);
  r = await api("GET", "/api/eco/positions", {});
  check("/api/eco/positions → <500", r.status < 500, r.status);

  section("eco-sync skripti test rejimida");
  // Real ko'rinishdagi URL/kalit berilsa ham (masalan .env'dan o'tib qolsa) — tarmoqqa chiqmaydi, darhol to'xtaydi.
  // Manzil — ishlatilmaydigan .invalid domeni: agar himoya ishlamasa ham hech qayerga yetib bormaydi.
  const sync = spawnSync("npx", ["tsx", "scripts/eco-sync.ts", "--days=1"], {
    env: { ...process.env, INSOF_ENV: "test", ECO_API_URL: "https://eco.insof-qa.invalid", ECO_API_KEY: "qa-fake-key" }, encoding: "utf8", timeout: 60_000,
  });
  check("eco-sync test rejimida → chiqish kodi 1, 'real ECO'ga so'rov yuborilmaydi'", sync.status === 1 && /real ECO'ga so'rov yuborilmaydi/.test(sync.stderr), `${sync.status} ${sync.stderr.slice(0, 200)}`);
  check("eco-sync hech qayerga ulanmadi (ECO_UNREACHABLE yo'q)", !/ECO_UNREACHABLE|ulanib bo'lmadi/.test(sync.stdout + sync.stderr));

  section("Telegram webhook");
  const tgUrl = "/api/telegram/webhook";
  r = await api("POST", tgUrl, { body: { update_id: 1 } });
  check("sirsiz → 403", r.status === 403, r.json);
  r = await api("POST", tgUrl, { body: { update_id: 1 }, headers: { "x-telegram-bot-api-secret-token": "noto'g'ri" } });
  check("noto'g'ri sir → 403", r.status === 403, r.json);
  r = await api("POST", tgUrl, { body: { update_id: 1 }, headers: { "x-telegram-bot-api-secret-token": TG_SECRET + "x" } });
  check("uzunroq sir → 403", r.status === 403, r.json);
  const sh = { "x-telegram-bot-api-secret-token": TG_SECRET };
  const chat = 900000000 + Math.floor(Math.random() * 1000);
  const msg = (extra: object) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: "private" }, from: { id: chat, is_bot: false, first_name: "QA" }, ...extra } });
  const samples: [string, unknown][] = [
    ["/start", msg({ text: "/start" })],
    ["kontakt (o'zining raqami)", msg({ contact: { phone_number: "+998909000001", user_id: chat } })],
    ["kontakt (begona raqam)", msg({ contact: { phone_number: "+998909000002", user_id: 1 } })],
    ["noma'lum buyruq", msg({ text: "/nimadir" })],
    ["oddiy matn", msg({ text: "salom" })],
    ["6 xonali kod", msg({ text: "123456" })],
    ["/yordam", msg({ text: "/yordam" })],
    ["/uzish", msg({ text: "/uzish" })],
    ["/savollar", msg({ text: "/savollar" })],
    ["ovozli xabar", msg({ voice: { file_id: "f1", duration: 3 } })],
    ["guruh chat", { update_id: 5, message: { message_id: 1, date: 1, chat: { id: -100, type: "group" }, from: { id: 7, is_bot: false }, text: "/start" } }],
    ["edited_message", { update_id: 6, edited_message: { message_id: 1, date: 1, chat: { id: chat, type: "private" }, text: "x" } }],
    ["callback_query", { update_id: 7, callback_query: { id: "c", from: { id: chat }, data: "x" } }],
    ["bot yuborgan", msg({ from: { id: 1, is_bot: true }, text: "/start" })],
    ["chat'siz message", { update_id: 8, message: { message_id: 1, date: 1, text: "/start" } }],
  ];
  for (const [name, u] of samples) {
    r = await api("POST", tgUrl, { body: u, headers: sh });
    check(`${name} → 200`, r.status === 200, `${r.status} ${r.text.slice(0, 100)}`);
  }
  for (const [name, raw] of [["buzuq JSON", "{x"], ["null", "null"], ["massiv", "[]"]] as const) {
    r = await api("POST", tgUrl, { raw, headers: { ...sh, "content-type": "application/json" } });
    check(`${name} → 400`, r.status === 400, r.status);
  }
  await new Promise((res) => setTimeout(res, 1500)); // after() ishlovi tugasin
  const acc = await db.telegramAccount.findUnique({ where: { chatId: String(chat) } });
  check("update ishlandi (TelegramAccount yozildi)", !!acc, acc);

  section("AI — kalitsiz (test rejimi)");
  const dir = await tok("test.direktor");
  r = await api("GET", "/api/mobile/ai", { token: dir });
  check("mobil AI katalogi → 200, llm:false", r.status === 200 && r.json?.llm === false, r.json);
  const firstKey = r.json?.groups?.[0]?.questions?.[0]?.key;
  r = await api("POST", "/api/mobile/ai", { token: dir, body: { mode: "quick", key: firstKey } });
  check("tez savol → 200 javob", r.status === 200 && hasAnswer(r.json?.answer), r.json);
  r = await api("POST", "/api/mobile/ai", { token: dir, body: { mode: "chat", question: "Kecha qancha beton sotildi va kim eng ko'p qarzdor?" } });
  check("erkin savol (LLM yo'q) → 200, xabar bor", r.status === 200 && hasAnswer(r.json?.answer), r.json);
  for (const b of [null, [], { mode: "chat", question: 123 }, { mode: "quick", key: "constructor" }, { mode: "chat", history: "x", question: "salom" }, { mode: "chat", history: [null, { role: "system", text: "x" }], question: "salom" }]) {
    r = await api("POST", "/api/mobile/ai", { token: dir, body: b });
    check(`mobil AI body=${JSON.stringify(b)} → <500`, r.status < 500, `${r.status} ${r.text.slice(0, 100)}`);
  }
  r = await api("GET", "/api/mobile/ai", { token: await tok("test.sotuv") });
  check("sotuvchi → 403", r.status === 403, r.status);
  const fin = await tok("test.finance");
  const codes: number[] = [];
  for (let i = 0; i < 22; i++) codes.push((await api("POST", "/api/mobile/ai", { token: fin, body: { mode: "quick", key: firstKey } })).status);
  // Hisob daqiqalik sirpanuvchi oyna: test ketma-ket qayta yurgizilsa oldingi so'rovlar ham sanaladi — shuning uchun
  // "200 lar, keyin faqat 429" ketma-ketligi va kamida bitta 429 tekshiriladi
  const firstLimited = codes.indexOf(429);
  check("AI rate limit: 20 tadan keyin 429 (500 yo'q)", firstLimited >= 0 && firstLimited <= 20 && codes.slice(0, firstLimited).every((s) => s === 200) && codes.slice(firstLimited).every((s) => s === 429), codes.join(","));

  // Veb /api/ai (cookie sessiya)
  const dirUser = await db.user.findUniqueOrThrow({ where: { login: "test.direktor" } });
  const buhUser = await db.user.findUniqueOrThrow({ where: { login: "test.buh" } }); // direktorning AI limiti yuqorida sarflangan
  const cookie = await webCookie(buhUser);
  r = await api("GET", "/api/ai", { cookie });
  check("veb /api/ai katalog → 200", r.status === 200 && r.json?.llm === false, r.json);
  r = await api("POST", "/api/ai", { cookie, body: { mode: "chat", question: "Bugungi tushum qancha?" } });
  check("veb erkin savol → 200", r.status === 200 && hasAnswer(r.json?.answer), r.json);
  for (const b of ["null", "[]", '{"mode":"chat","question":5}', '{"mode":"quick","key":"x","sp":"abc"}', '{"mode":"quick","key":"' + firstKey + '","sp":{"period":["x"]}}']) {
    r = await api("POST", "/api/ai", { cookie, raw: b, headers: { "content-type": "application/json" } });
    check(`veb /api/ai body=${b} → <500`, r.status < 500, `${r.status} ${r.text.slice(0, 100)}`);
  }
  r = await api("POST", "/api/ai", { body: { mode: "quick" } });
  check("veb /api/ai sessiyasiz → 401 (yoki login'ga yo'naltirish)", r.status === 401 || r.status === 307, r.status);

  section("Geo — tashqi xizmat sozlanmagan");
  const logi = await db.user.findUniqueOrThrow({ where: { login: "test.logistika" } });
  const lc = await webCookie(logi);
  r = await api("GET", "/api/geo/search?q=Toshkent", { cookie: lc });
  check("geo/search → 200 (bo'sh ro'yxat)", r.status === 200 && Array.isArray(r.json?.places), r.json);
  r = await api("GET", "/api/geo/resolve?uri=ymapsbm1://geo?x&text=Toshkent", { cookie: lc });
  check("geo/resolve → 200 point:null", r.status === 200 && r.json?.point === null, r.json);
  r = await api("GET", "/api/geo/resolve", { cookie: lc });
  check("geo/resolve parametrsiz → 400", r.status === 400, r.json);
  r = await api("GET", "/api/geo/distance?lat=41.3&lng=69.2", { cookie: lc });
  check("geo/distance → 200 (to'g'ri chiziq yoki PLANT_UNSET)", r.status === 200 && (r.json?.distance === null || r.json?.distance?.source === "LINE"), r.json);
  r = await api("GET", "/api/geo/distance?lat=abc&lng=1", { cookie: lc });
  check("geo/distance noto'g'ri nuqta → 400", r.status === 400, r.json);
  r = await api("GET", "/api/geo/search?q=x");
  check("geo sessiyasiz → 401/307", r.status === 401 || r.status === 307, r.status);
  const drv = await db.user.findUniqueOrThrow({ where: { login: "test.haydovchi" } });
  r = await api("GET", "/api/geo/search?q=x", { cookie: await webCookie(drv) });
  check("geo haydovchi → 403", r.status === 403, r.status);

  section("Boshqa ochiq/integratsiya endpointlari — 500 yo'q");
  const dc = await webCookie(dirUser);
  for (const [m, p, raw, ck] of [
    ["POST", "/api/public/shop/order", "null", undefined], ["POST", "/api/public/shop/order", "[]", undefined], ["POST", "/api/public/shop/order", "{}", undefined],
    ["POST", "/api/public/shop/callback", "null", undefined], ["POST", "/api/public/shop/callback", '{"phone":123}', undefined],
    ["GET", "/api/public/shop", undefined, undefined], ["GET", "/api/public/shop/photo/yoq.jpg", undefined, undefined], ["GET", "/api/public/shop/photo/..%2F..%2F.env", undefined, undefined],
    ["POST", "/api/scan/receipt", "{}", dc], ["POST", "/api/scan/receipt", undefined, dc],
    ["GET", "/api/eco/track/yoq-ref", undefined, dc], ["GET", "/api/eco/positions", undefined, dc], ["GET", "/api/eco/positions?orderRef=x", undefined, dc],
    ["GET", "/api/eco/sync", undefined, dc], ["POST", "/api/eco/sync", undefined, dc],
    ["GET", "/api/app/android", undefined, dc],
  ] as [string, string, string | undefined, string | undefined][]) {
    const x = await api(m, p, { raw, cookie: ck, headers: raw !== undefined ? { "content-type": "application/json" } : undefined });
    check(`${m} ${p} ${raw ?? ""} → <500`, x.status < 500 || (x.status === 503 && (p === "/api/eco/sync" || p === "/api/scan/receipt")), `${x.status} ${x.text.slice(0, 120)}`);
  }
  r = await api("POST", "/api/eco/sync", { cookie: dc });
  check("eco/sync (ECO o'chiq) → 503, real so'rov yo'q", r.status === 503, r.status);

  section("Tashqi so'rovlar jurnali (server log)");
  const log = process.env.QA_SERVER_LOG;
  if (log && existsSync(log)) {
    const text = readFileSync(log, "utf8");
    check("Telegram javoblari test stub'ga tushdi", text.includes("[telegram · test]"), "jurnalda [telegram · test] yo'q");
    check("jurnalda api.telegram.org / exp.host / anthropic chaqiruvi yo'q", !/api\.telegram\.org|exp\.host|api\.anthropic\.com|api\.groq\.com/.test(text));
  } else check("QA_SERVER_LOG berilmagan — jurnal tekshiruvi o'tkazib yuborildi", true);

  await db.$disconnect();
  done();
}
void main();
