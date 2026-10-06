/**
 * QA (agent D): IT panelga Insof ECO ilovasi orqali kirish (src/lib/control/eco-login.ts).
 *   npx tsx scripts/qa/d-eco-login.mts
 *
 * Soxta ECO — lokal http server (127.0.0.1, tasodifiy port): `POST /v1/erp/auth/verify` (X-Api-Key tekshiriladi).
 * Sinovlar: to'g'ri kirish (lastLoginAt, jurnal via=eco), xato parol, bog'lanmagan hisob (xabar bir xil + jurnal),
 * bloklangan admin, qulf (5 xato → 6-chi ECO'ga bormaydi), ECO o'chiq / javob bermaydi (timeout ≤ 8 s) / sozlanmagan,
 * bog'lash va uzish reauth bilan, boshqa admin ecoUserId'ini olib bo'lmaslik, unique cheklov.
 *
 * Baza: faqat vaqtinchalik `insof_test_ctl_eco` (lokal, joriy foydalanuvchi) — migrate deploy, oxirida o'chiriladi.
 * Real ECO, .env va boshqa bazalarga tegilmaydi (INSOF_ENV=test — ECO faqat localhost).
 */
import { spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PGUSER = process.env.D_PGUSER || os.userInfo().username;
const PG = `postgresql://${PGUSER}@127.0.0.1:5432`;
const DB = "insof_test_ctl_eco";
const API_KEY = "test-eco-key";

/* ───────── soxta ECO ───────── */
const ECO_USERS: Record<string, { password: string; userId: string; fullName: string }> = {
  "+998901112233": { password: "eco-pass-A1", userId: "eco_user_a", fullName: "Admin A" },
  "+998904445566": { password: "eco-pass-B2", userId: "eco_user_b", fullName: "Admin B" },
  "+998907778899": { password: "eco-pass-X3", userId: "eco_user_x", fullName: "Begona" },
  "+998900000001": { password: "eco-pass-L4", userId: "eco_user_l", fullName: "Qulf" },
};
const HANG_PHONE = "+998909999999";
const LIMIT_PHONE = "+998908888888";
let verifyHits = 0;
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.headers["x-api-key"] !== API_KEY) return send(401, { code: "AUTH_TOKEN_INVALID", message: "API kalit yaroqsiz" });
    if (req.method === "POST" && req.url === "/v1/erp/auth/verify") {
      verifyHits++;
      const { phone, password } = JSON.parse(body || "{}") as { phone: string; password: string };
      if (phone === HANG_PHONE) return; // javob bermaydi — timeout sinovi
      if (phone === LIMIT_PHONE) return send(429, { code: "RATE_LIMIT", message: "Juda ko'p urinish" });
      const u = ECO_USERS[phone];
      if (!u || u.password !== password) return send(401, { code: "AUTH_BAD_CREDENTIALS", message: "Telefon yoki parol noto'g'ri" });
      return send(200, { userId: u.userId, phone, fullName: u.fullName });
    }
    send(404, { code: "NOT_FOUND" });
  });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
const STUB_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;

// Test muhiti — modullar import qilinishidan OLDIN (db.ts import paytida tekshiradi)
Object.assign(process.env, {
  INSOF_ENV: "test",
  CONTROL_DATABASE_URL: `${PG}/${DB}?connection_limit=3`,
  TENANT_DATABASE_URL: `${PG}/{db}`,
  ECO_API_URL: STUB_URL,
  ECO_API_KEY: API_KEY,
});

let fails = 0, oks = 0;
function check(ok: unknown, name: string, extra: unknown = "") {
  if (ok) { oks++; console.log(`\x1b[1;32mPASS\x1b[0m ${name}`); }
  else { fails++; console.log(`\x1b[1;31mFAIL\x1b[0m ${name}${extra !== "" ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`); }
}
const psql = (sql: string) => spawnSync("psql", [`${PG}/postgres`, "-qAtc", sql], { encoding: "utf8" });

psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
const cr = psql(`CREATE DATABASE ${DB}`);
if (cr.status !== 0) { console.error(`createdb ${DB}: ${cr.stderr}`); process.exit(1); }

const { control } = await import("../../src/lib/control/db");
try {
  const mig = spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/control/schema.prisma"], {
    cwd: REPO, encoding: "utf8", env: { ...process.env, CONTROL_DATABASE_URL: `${PG}/${DB}` },
  });
  check(mig.status === 0, "control baza: migrate deploy (superadmin_eco migratsiyasi bilan)", mig.stderr.slice(-300));

  const E = await import("../../src/lib/control/eco-login");
  const { ecoEnabled } = await import("../../src/lib/eco/client");
  const hash = await bcrypt.hash("panel-pass-1", 4);
  const A = await control.superAdmin.create({ data: { login: "qa.a", fullName: "QA A", passwordHash: hash } });
  const B = await control.superAdmin.create({ data: { login: "qa.b", fullName: "QA B", passwordHash: hash } });
  const C = await control.superAdmin.create({ data: { login: "qa.c", fullName: "QA C", passwordHash: hash, isActive: false } });
  const events = (action: string) => control.controlEvent.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
  const adminA = () => control.superAdmin.findUniqueOrThrow({ where: { id: A.id } });

  check(E.maskPhone("+998901112233") === "+998 90 *** ** 33", "maskPhone", E.maskPhone("+998901112233"));
  check(ecoEnabled() && E.adminEcoEnabled(), "ECO yoqilgan (lokal stub, test rejimi)");

  /* ── bog'lash ── */
  let r = await E.linkOwnEco(A.id, { phone: "90 111 22 33", ecoPassword: "eco-pass-A1", currentPassword: "noto'g'ri" }, "10.1.0.1");
  check(r.error === "Joriy panel paroli noto'g'ri" && !(await adminA()).ecoUserId, "bog'lash: joriy panel paroli xato → rad, yozilmaydi", r);
  r = await E.linkOwnEco(A.id, { phone: "90 111 22 33", ecoPassword: "eco-pass-A1", currentPassword: "" }, "10.1.0.1");
  check(!!r.error && !(await adminA()).ecoUserId, "bog'lash: joriy parolsiz → rad", r);
  r = await E.linkOwnEco(A.id, { phone: "90 111 22 33", ecoPassword: "xato", currentPassword: "panel-pass-1" }, "10.1.0.1");
  check(r.error === "ECO telefoni yoki paroli noto'g'ri" && !(await adminA()).ecoUserId, "bog'lash: ECO paroli xato → rad", r);
  r = await E.linkOwnEco(A.id, { phone: "+998 (90) 111-22-33", ecoPassword: "eco-pass-A1", currentPassword: "panel-pass-1" }, "10.1.0.1");
  let a = await adminA();
  check(!r.error && a.ecoUserId === "eco_user_a" && a.ecoPhone === "+998 90 *** ** 33", "bog'lash: to'g'ri → ecoUserId + maskalangan telefon", { r, a: { e: a.ecoUserId, p: a.ecoPhone } });
  const linkEv = await events("ADMIN_ECO_LINK");
  check(linkEv.length === 1 && linkEv[0].adminId === A.id && !JSON.stringify(linkEv[0].detail).includes("eco-pass") && !JSON.stringify(linkEv[0].detail).includes("901112233"),
    "bog'lash: jurnal ADMIN_ECO_LINK (parolsiz, telefon maskalangan)", linkEv.map((e) => e.detail));

  // B admin A ning ECO hisobini (A telefoni + A ECO paroli bilan) o'ziga ulay olmaydi
  r = await E.linkOwnEco(B.id, { phone: "+998901112233", ecoPassword: "eco-pass-A1", currentPassword: "panel-pass-1" }, "10.1.0.2");
  const b = await control.superAdmin.findUniqueOrThrow({ where: { id: B.id } });
  check(r.error === "Bu ECO hisobi boshqa administratorga ulangan" && !b.ecoUserId && (await adminA()).ecoUserId === "eco_user_a",
    "boshqa admin ecoUserId'ini olib bo'lmaydi (A da qoladi, B ga yozilmaydi)", r);
  check((await events("ADMIN_ECO_LINK_DENIED")).length === 1, "rad etilgan ulash jurnalda");
  let dup = false;
  try { await control.superAdmin.update({ where: { id: B.id }, data: { ecoUserId: "eco_user_a" } }); } catch { dup = true; }
  check(dup, "baza: ecoUserId @unique — bitta ECO hisobi bitta admin");
  r = await E.linkOwnEco(B.id, { phone: "+998904445566", ecoPassword: "eco-pass-B2", currentPassword: "panel-pass-1" }, "10.1.0.2");
  check(!r.error, "B o'z ECO hisobini ulaydi", r);

  /* ── kirish ── */
  let L = await E.ecoAdminLogin("90 111 22 33", "eco-pass-A1", "10.2.0.1");
  a = await adminA();
  check(L.ok && L.admin.id === A.id && !!a.lastLoginAt, "kirish: to'g'ri telefon + ECO paroli → A, lastLoginAt", L);
  const loginEv = (await events("ADMIN_LOGIN")).at(-1);
  check(loginEv?.adminId === A.id && (loginEv?.detail as { via?: string })?.via === "eco", "kirish: jurnal ADMIN_LOGIN { via: eco }", loginEv?.detail);

  L = await E.ecoAdminLogin("+998901112233", "noto'g'ri", "10.2.0.2");
  const msgBad = !L.ok ? L.error : "";
  check(msgBad === E.ECO_LOGIN_FAIL, "kirish: xato parol → «Telefon yoki parol noto'g'ri»", L);

  const t0 = Date.now();
  L = await E.ecoAdminLogin("+998907778899", "eco-pass-X3", "10.2.0.3");
  const msgUnlinked = !L.ok ? L.error : "";
  check(!L.ok && msgUnlinked === msgBad && Date.now() - t0 >= 450, "bog'lanmagan ECO hisobi (parol to'g'ri) → xabar AYNAN bir xil + kechikish", L);
  const unl = await events("ADMIN_LOGIN_ECO_FAIL");
  check(unl.some((e) => (e.detail as { reason?: string })?.reason === "bog'lanmagan ECO hisobi bilan urinish"), "bog'lanmagan urinish jurnalda", unl.map((e) => e.detail));
  check(!(await control.superAdmin.findFirst({ where: { ecoUserId: "eco_user_x" } })), "hisob avtomatik yaratilmaydi");

  // Bloklangan admin: C ga ECO hisobi ulangan (to'g'ridan bazada), lekin isActive=false
  await control.superAdmin.update({ where: { id: C.id }, data: { ecoUserId: "eco_user_l2" } });
  ECO_USERS["+998900000002"] = { password: "eco-pass-C5", userId: "eco_user_l2", fullName: "C" };
  L = await E.ecoAdminLogin("+998900000002", "eco-pass-C5", "10.2.0.4");
  check(!L.ok && L.error === msgBad, "bloklangan admin → kira olmaydi, xabar bir xil", L);
  check((await events("ADMIN_LOGIN_ECO_FAIL")).some((e) => (e.detail as { reason?: string })?.reason === "bloklangan admin"), "bloklangan admin urinishi jurnalda");

  // Qulf: 5 xato → 6-chi (hatto to'g'ri parol bilan) ECO'ga bormaydi
  for (let i = 0; i < 5; i++) await E.ecoAdminLogin("+998900000001", `xato-${i}`, `10.3.0.${i + 1}`);
  const hits = verifyHits;
  L = await E.ecoAdminLogin("+998900000001", "eco-pass-L4", "10.3.0.99");
  check(!L.ok && /Juda ko'p noto'g'ri urinish/.test(L.error) && verifyHits === hits, "qulf: 5 xato → qulf, ECO'ga so'rov ketmaydi", { L, hits, verifyHits });
  L = await E.ecoAdminLogin("+998 90 111 22 33", "eco-pass-A1", "10.3.0.100");
  check(L.ok, "qulf faqat shu telefonga — boshqa admin kiradi");

  // Noto'g'ri telefon formati — ECO'ga bormaydi
  const h2 = verifyHits;
  L = await E.ecoAdminLogin("12345", "x", "10.4.0.1");
  check(!L.ok && verifyHits === h2, "noto'g'ri telefon formati → ECO'ga bormaydi", L);

  /* ── ECO javob bermaydi / o'chiq / sozlanmagan ── */
  const t1 = Date.now();
  L = await E.ecoAdminLogin(HANG_PHONE, "x", "10.5.0.1");
  const took = Date.now() - t1;
  check(!L.ok && L.error === E.ECO_UNAVAILABLE && took < 8_900 && took >= 7_500, `ECO javob bermaydi → timeout ≤ 8 s (${took} ms), aniq xabar`, L);

  process.env.ECO_API_KEY = "boshqa-kalit";
  L = await E.ecoAdminLogin("+998901112233", "eco-pass-A1", "10.5.0.2");
  check(!L.ok && L.error === E.ECO_UNAVAILABLE, "ECO_API_KEY yaroqsiz (401 AUTH_TOKEN_INVALID) → «ECO javob bermayapti», parol xatosi deb sanalmaydi", L);
  process.env.ECO_API_KEY = API_KEY;
  L = await E.ecoAdminLogin(LIMIT_PHONE, "x", "10.5.0.5");
  check(!L.ok && L.error === E.ECO_RATE_LIMITED, "ECO limiti (429) → «Juda ko'p urinish»", L);

  process.env.ECO_API_URL = "http://127.0.0.1:9";
  L = await E.ecoAdminLogin("+998904445566", "eco-pass-B2", "10.5.0.3");
  check(!L.ok && L.error === E.ECO_UNAVAILABLE, "ECO o'chiq (port yopiq) → «ECO serveri javob bermayapti»", L);
  r = await E.linkOwnEco(B.id, { phone: "+998904445566", ecoPassword: "eco-pass-B2", currentPassword: "panel-pass-1" }, "10.5.0.3");
  check(!!r.error && /javob bermayapti/.test(r.error), "ECO o'chiq → ulash ham aniq xabar", r);

  process.env.ECO_API_URL = "";
  check(!E.adminEcoEnabled(), "ECO sozlanmagan → adminEcoEnabled=false (login sahifasida tab yo'q)");
  L = await E.ecoAdminLogin("+998904445566", "eco-pass-B2", "10.5.0.4");
  check(!L.ok && /sozlanmagan/.test(L.error), "ECO sozlanmagan → telefon bilan kirish rad", L);
  // Login/parol bilan kirish ECO'ga bog'liq emas
  const { default: bc } = await import("bcryptjs");
  check(await bc.compare("panel-pass-1", (await adminA()).passwordHash), "login/parol yo'li ECO'siz ham ishlaydi (hash joyida)");

  // Test rejimi: real (lokal bo'lmagan) ECO manziliga so'rov ketmaydi
  process.env.ECO_API_URL = "https://eco.example.uz";
  check(!E.adminEcoEnabled(), "test rejimi: lokal bo'lmagan ECO_API_URL → o'chiq");
  process.env.ECO_API_URL = STUB_URL;

  /* ── uzish ── */
  let u = await E.unlinkOwnEco(A.id, "noto'g'ri", "10.6.0.1");
  check(u.error === "Joriy panel paroli noto'g'ri" && (await adminA()).ecoUserId === "eco_user_a", "uzish: joriy parol xato → rad", u);
  u = await E.unlinkOwnEco(A.id, "panel-pass-1", "10.6.0.1");
  a = await adminA();
  check(!u.error && !a.ecoUserId && !a.ecoPhone, "uzish: to'g'ri joriy parol → ecoUserId tozalandi", u);
  check((await events("ADMIN_ECO_UNLINK")).length === 1, "uzish jurnalda (ADMIN_ECO_UNLINK)");
  L = await E.ecoAdminLogin("+998901112233", "eco-pass-A1", "10.6.0.2");
  check(!L.ok && L.error === msgBad, "uzilgandan keyin ECO bilan kira olmaydi (xabar bir xil)", L);
  u = await E.unlinkOwnEco(A.id, "panel-pass-1", "10.6.0.1");
  check(u.error === "ECO hisobi ulanmagan", "ulanmagan hisobni uzish → xato", u);
  // Endi A ning eski ECO hisobini B ham ulay olmaydi (B da o'z hisobi bor) — lekin A qayta ulay oladi
  r = await E.linkOwnEco(A.id, { phone: "+998901112233", ecoPassword: "eco-pass-A1", currentPassword: "panel-pass-1" }, "10.6.0.3");
  check(!r.error && (await adminA()).ecoUserId === "eco_user_a", "uzilgandan keyin qayta ulash ishlaydi", r);

  // Reauth qulfi umumiy: admin:<login> — 5 xato reauth → keyin to'g'ri parol ham rad
  for (let i = 0; i < 5; i++) await E.unlinkOwnEco(B.id, `xato-${i}`, `10.7.0.${i + 1}`);
  u = await E.unlinkOwnEco(B.id, "panel-pass-1", "10.7.0.50");
  check(!!u.error && /Juda ko'p/.test(u.error), "uzish: reauth 5 xato → qulf (login bilan umumiy)", u);

  // Jurnalda hech qayerda parol yo'q
  const all = await control.controlEvent.findMany();
  const blob = JSON.stringify(all);
  check(!/eco-pass|panel-pass|xato-\d/.test(blob), "jurnalda parollar yo'q", blob.slice(0, 200));
} catch (e) {
  fails++;
  console.log(`\x1b[1;31mFAIL\x1b[0m kutilmagan xato — ${(e as Error).stack}`);
} finally {
  await control.$disconnect().catch(() => {});
  stub.close();
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
}

console.log(`\n${oks} OK, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
