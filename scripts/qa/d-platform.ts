/**
 * QA (agent D): ko'p korxonali platformaning HTTP sinovi — ishlayotgan panel (3204) va korxonalar (3205, 3206).
 *   D_ROOT=... npx tsx scripts/qa/d-platform.ts
 * Oldin: d-setup.sh (control baza, admin, alfa) + d-deploy-test.sh first (build, panel + alfa ishlayapti).
 *
 * Sinovlar: panel login (to'g'ri/xato/qulf), korxonalar ro'yxati, «beta» ni panel formasi orqali yaratish,
 * SSO (panel → alfa; takror token, boshqa korxona tokeni, muddati o'tgan, soxta aud — rad), direktor IT hisobini
 * ko'rmaydi/bera olmaydi, alfa ↔ beta ma'lumot va fayl izolyatsiyasi, to'xtatish/qayta yoqish, statistika.
 * Formalar brauzersiz yuboriladi (Next server action'ning JS'siz «progressive» formasi — yashirin $ACTION_* maydonlar).
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SignJWT } from "jose";

const ROOT = process.env.D_ROOT ?? "";
if (!ROOT) throw new Error("D_ROOT kerak");
const APP = path.join(ROOT, "app");
const PANEL = "http://127.0.0.1:3204";
const REPO = path.resolve(__dirname, "../..");

/* ───────── kichik yordamchilar ───────── */
function envOf(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const ctlEnv = envOf(path.join(APP, "control.env"));
const tenantEnv = (slug: string) => envOf(path.join(APP, "tenants", `${slug}.env`));
const urlOf = (slug: string) => `http://127.0.0.1:${tenantEnv(slug).PORT}`;

let fails = 0;
const results: string[] = [];
function check(ok: unknown, name: string, extra = "") {
  const line = `${ok ? "\x1b[1;32mPASS\x1b[0m" : "\x1b[1;31mFAIL\x1b[0m"} ${name}${!ok && extra ? ` — ${extra}` : ""}`;
  console.log(line);
  results.push(line);
  if (!ok) fails++;
}

class Jar {
  c = new Map<string, string>();
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
  take(r: Response) {
    for (const sc of r.headers.getSetCookie()) {
      const [kv] = sc.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (!v || /max-age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v);
    }
  }
}

async function req(url: string, jar: Jar | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jar?.c.size) headers.set("cookie", jar.header());
  const r = await fetch(url, { ...init, headers, redirect: "manual" });
  jar?.take(r);
  const text = await r.text();
  return { status: r.status, location: r.headers.get("location") ?? "", text, headers: r.headers };
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Sahifadagi `marker` bor formaning yashirin maydonlari (Next server action). */
function hiddenFields(html: string, marker: string): Record<string, string> {
  for (const m of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
    if (!m[1].includes(marker)) continue;
    const out: Record<string, string> = {};
    for (const h of m[1].matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/?>/g)) out[unescape(h[1])] = unescape(h[2] ?? "");
    return out;
  }
  throw new Error(`forma topilmadi: ${marker}`);
}

/** Formani JS'siz yuborish: sahifani ochadi, yashirin maydonlarni oladi, POST qiladi. */
async function submit(base: string, page: string, marker: string, fields: Record<string, string>, jar: Jar) {
  const g = await req(base + page, jar);
  if (g.status !== 200) throw new Error(`${page}: HTTP ${g.status}`);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...hiddenFields(g.text, marker), ...fields })) fd.append(k, v);
  return req(base + page, jar, { method: "POST", body: fd, headers: { origin: base } });
}

/** Klient JS chaqiradigan server action (masalan ssoAction) — id build'dagi klient bo'lagidan topiladi. */
function actionId(name: string): string {
  const dir = path.join(APP, "current", ".next", "static", "chunks");
  const re = new RegExp(`"([0-9a-f]{40,})",\\w+\\.callServer,void 0,\\w+\\.findSourceMapURL,"${name}"`);
  const walk = (d: string): string | null => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { const r = walk(p); if (r) return r; continue; }
      if (!e.name.endsWith(".js")) continue;
      const m = re.exec(readFileSync(p, "utf8"));
      if (m) return m[1];
    }
    return null;
  };
  const id = walk(dir);
  if (!id) throw new Error(`action id topilmadi: ${name}`);
  return id;
}

async function callAction(page: string, name: string, args: unknown[], jar: Jar) {
  const r = await req(PANEL + page, jar, {
    method: "POST",
    body: JSON.stringify(args),
    headers: { "next-action": actionId(name), "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: PANEL },
  });
  return r;
}

function svc(cmd: string, unit: string) {
  const r = spawnSync("/bin/bash", [path.join(REPO, "scripts/qa/d-svc.sh"), cmd, unit], { env: process.env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`d-svc ${cmd} ${unit}: ${r.stderr}${r.stdout}`);
}
async function waitHealth(base: string, sec = 60) {
  for (let i = 0; i < sec; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* hali yo'q */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function tenantLogin(slug: string, login: string, password: string) {
  const jar = new Jar();
  const r = await submit(urlOf(slug), "/login", 'name="password"', { login, password }, jar);
  return { jar, r };
}

async function postSso(slug: string, token: string) {
  const fd = new URLSearchParams({ token });
  const jar = new Jar();
  const r = await req(`${urlOf(slug)}/api/control/sso`, jar, { method: "POST", body: fd, headers: { "content-type": "application/x-www-form-urlencoded" } });
  return { r, jar };
}

async function main() {
  // Panel va korxona bazalari (to'g'ridan-to'g'ri tekshiruv uchun)
  process.env.CONTROL_DATABASE_URL = ctlEnv.CONTROL_DATABASE_URL;
  const { PrismaClient: CtlClient } = await import("@/generated/control");
  const { PrismaClient: TenantClient } = await import("@/generated/prisma");
  const ctl = new CtlClient({ datasourceUrl: ctlEnv.CONTROL_DATABASE_URL });
  const tdb = (slug: string) => new TenantClient({ datasourceUrl: tenantEnv(slug).DATABASE_URL });

  /* ═════════ 1. Panel: kirish ═════════ */
  console.log("\n── 1. Panel login ──");
  let r = await req(`${PANEL}/superadmin`, null);
  check(r.status === 307 && r.location.includes("/superadmin/login"), "cookie'siz /superadmin → /superadmin/login", `${r.status} ${r.location}`);
  r = await req(`${PANEL}/dashboard`, null);
  check(r.status === 307 && r.location.includes("/superadmin"), "panelda korxona sahifalari yo'q (/dashboard → /superadmin)", `${r.status} ${r.location}`);
  r = await req(`${PANEL}/api/control/sso`, null, { method: "POST" });
  check(r.status === 307 || r.status === 404, "panelda /api/control/sso ishlamaydi", `${r.status}`);

  const bad = new Jar();
  r = await submit(PANEL, "/superadmin/login", 'name="password"', { login: "qa.admin", password: "NotRight123" }, bad);
  check(r.status === 200 && r.text.includes("Login yoki parol noto"), "xato parol → «Login yoki parol noto'g'ri»", `${r.status}`);
  check(!bad.c.has("insof_admin"), "xato parolda cookie berilmaydi");

  // Qulf: qa.lock — 5 ta xato, keyin TO'G'RI parol ham rad
  const lk = new Jar();
  for (let i = 0; i < 5; i++) await submit(PANEL, "/superadmin/login", 'name="password"', { login: "qa.lock", password: `Wrong${i}x123` }, lk);
  r = await submit(PANEL, "/superadmin/login", 'name="password"', { login: "qa.lock", password: "QaLock2026x" }, lk);
  check(r.text.includes("Juda ko") && !lk.c.has("insof_admin"), "5 xatodan keyin qulf (to'g'ri parol ham rad)", r.text.match(/text-red[^>]*>([^<]{0,120})/)?.[1] ?? `${r.status}`);

  const admin = new Jar();
  r = await submit(PANEL, "/superadmin/login", 'name="password"', { login: "qa.admin", password: "QaAdmin2026x" }, admin);
  check(r.status === 303 && admin.c.has("insof_admin"), "to'g'ri parol → 303 + insof_admin cookie", `${r.status} ${r.location}`);
  r = await req(`${PANEL}/superadmin`, admin);
  check(r.status === 200 && r.text.includes("QA alfa beton"), "korxonalar ro'yxati (alfa ko'rinadi)", `${r.status}`);
  check((r.headers.get("content-security-policy") ?? "").includes("form-action 'self' https:"), "panel CSP: form-action https: (SSO forma korxona domeniga)");

  /* ═════════ 2. «beta» — panel formasi orqali ═════════ */
  console.log("\n── 2. Panelda korxona yaratish ──");
  const newForm = (o: Record<string, string>) => submit(PANEL, "/superadmin/korxonalar/yangi", 'name="slug"', {
    name: "QA beta beton", slug: "beta", domain: "beta.insof.test", plan: "standard",
    directorName: "Direktor beta", directorLogin: "beta.direktor", directorPassword: "BetaDir2026x", ...o,
  }, admin);
  r = await newForm({ slug: "admin" });
  check(r.status === 200 && r.text.includes("band"), "band nom (admin) rad etiladi");
  r = await newForm({ directorPassword: "parol123" });
  check(r.status === 200 && /oddiy|harf ham/.test(r.text), "zaif direktor paroli rad etiladi");
  r = await newForm({ slug: "alfa" });
  check(r.status === 200 && r.text.includes("Bu qisqa nomli korxona bor"), "takror slug rad etiladi");
  r = await newForm({});
  check(r.status === 303 && r.location.includes("/superadmin/korxonalar/beta"), "beta yaratildi → 303 korxona sahifasiga", `${r.status} ${r.location} ${r.text.match(/text-red[^>]*>([^<]{0,200})/)?.[1] ?? ""}`);
  const beta = await ctl.tenant.findUnique({ where: { slug: "beta" } });
  check(beta?.dbName === "insof_test_t_beta" && beta.port === 3206 && beta.status === "PROVISIONING", "beta: baza insof_test_t_beta, port 3206, PROVISIONING", JSON.stringify(beta));
  const benv = tenantEnv("beta"), aenv = tenantEnv("alfa");
  check(benv.CONTROL_SSO_KEY?.length === 64 && benv.CONTROL_SSO_KEY !== aenv.CONTROL_SSO_KEY, "beta.env: o'z CONTROL_SSO_KEY (alfa'nikidan farqli)");
  check(!("CONTROL_SECRET" in benv), "beta.env da global CONTROL_SECRET yo'q");
  check((benv.TELEGRAM_WEBHOOK_SECRET?.length ?? 0) >= 32 && (benv.ECO_WEBHOOK_SECRET?.length ?? 0) >= 32 && benv.ECO_WEBHOOK_SECRET !== aenv.ECO_WEBHOOK_SECRET, "webhook sirlari yaratildi va korxonaga xos");
  check(benv.AUTH_SECRET !== aenv.AUTH_SECRET, "AUTH_SECRET korxonaga xos");
  const { deriveTenantSsoKey } = await import("@/lib/control/token");
  check(deriveTenantSsoKey(ctlEnv.CONTROL_SECRET, "beta") === benv.CONTROL_SSO_KEY, "CONTROL_SSO_KEY = HMAC(CONTROL_SECRET, slug)");
  const bdb = tdb("beta");
  const busers = await bdb.user.findMany({ select: { login: true, role: true } });
  const bwh = await bdb.warehouse.findMany({ select: { name: true, isActive: true } });
  check(busers.length === 1 && busers[0].login === "beta.direktor" && busers[0].role === "DIRECTOR", "beta bazasida birinchi DIRECTOR", JSON.stringify(busers));
  check(bwh.length === 1 && bwh[0].name === "Asosiy sklad" && bwh[0].isActive, "beta: «Asosiy sklad»");
  check(benv.UPLOADS_DIR === path.join(ROOT, "data", "beta", "uploads"), "beta UPLOADS_DIR = TENANT_DATA_ROOT/beta/uploads", benv.UPLOADS_DIR);

  svc("start", "insof-erp@beta");
  check(await waitHealth(urlOf("beta")), "beta jarayoni ishga tushdi (/api/health 200)");

  /* ═════════ 3. SSO ═════════ */
  console.log("\n── 3. SSO ──");
  const sso = async (slug: string) => {
    const x = await callAction(`/superadmin/korxonalar/${slug}`, "ssoAction", [slug], admin);
    const token = /"token":"([^"]+)"/.exec(x.text)?.[1] ?? "";
    const url = /"url":"([^"]+)"/.exec(x.text)?.[1] ?? "";
    return { token, url, raw: x };
  };
  const s1 = await sso("alfa");
  check(s1.token && s1.url === "https://alfa.insof.test/api/control/sso", "panel ssoAction → token + korxona manzili", `${s1.raw.status} ${s1.raw.text.slice(0, 200)}`);
  let p = await postSso("alfa", s1.token);
  check(p.r.status === 303 && p.r.location.endsWith("/dashboard") && p.jar.c.has("insof_session"), "alfa SSO qabul qildi → /dashboard + sessiya", `${p.r.status} ${p.r.text.slice(0, 120)}`);
  const it = p.jar;
  r = await req(`${urlOf("alfa")}/dashboard`, it);
  check(r.status === 200 && r.text.includes("IT superadmin"), "IT ichkarida (rol yorlig'i «IT superadmin»)", `${r.status}`);
  const adb = tdb("alfa");
  const itUser = await adb.user.findUnique({ where: { login: "it.qa.admin" } });
  check(itUser?.role === "SUPERADMIN", "alfa bazasida it.qa.admin (SUPERADMIN)");
  check((await adb.auditLog.count({ where: { userId: itUser?.id, entity: "User" } })) >= 1, "IT kirishi korxona audit jurnalida");
  p = await postSso("alfa", s1.token);
  check(p.r.status === 401, "takroriy token (replay) rad", `${p.r.status}`);
  const s2 = await sso("alfa");
  p = await postSso("beta", s2.token);
  check(p.r.status === 401, "alfa tokeni beta'da rad (hosila kalit izolyatsiyasi)", `${p.r.status}`);
  // alfa .env i sizib chiqqan bo'lsa ham beta uchun token yasab bo'lmaydi
  const forge = await new SignJWT({ typ: "sso", adminId: "x", adminLogin: "hacker", adminName: "h" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("insof-control").setAudience("beta").setJti(crypto.randomUUID())
    .setIssuedAt().setExpirationTime("60s").sign(new TextEncoder().encode(aenv.CONTROL_SSO_KEY));
  p = await postSso("beta", forge);
  check(p.r.status === 401, "alfa kaliti bilan aud=beta soxta token rad", `${p.r.status}`);
  const expired = await new SignJWT({ typ: "sso", adminId: "x", adminLogin: "qa.admin", adminName: "QA" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("insof-control").setAudience("alfa").setJti(crypto.randomUUID())
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 300)
    .sign(new TextEncoder().encode(aenv.CONTROL_SSO_KEY));
  p = await postSso("alfa", expired);
  check(p.r.status === 401, "muddati o'tgan token rad", `${p.r.status}`);
  p = await postSso("alfa", "");
  check(p.r.status === 401, "bo'sh token rad", `${p.r.status}`);
  const s3 = await sso("beta");
  p = await postSso("alfa", s3.token);
  check(p.r.status === 401, "beta tokeni alfa'da rad", `${p.r.status}`);
  p = await postSso("beta", s3.token);
  check(p.r.status === 303, "beta tokeni beta'da qabul", `${p.r.status}`);
  check((await ctl.controlEvent.count({ where: { action: "SSO" } })) >= 3, "panel jurnalida SSO yozuvlari");

  /* ═════════ 4. Direktor va IT hisobi ═════════ */
  console.log("\n── 4. Direktor ──");
  const ad = await tenantLogin("alfa", "alfa.direktor", "AlfaDir2026x");
  check(ad.r.status === 303 && ad.jar.c.has("insof_session"), "alfa direktori kirdi", `${ad.r.status}`);
  r = await req(`${urlOf("alfa")}/settings?tab=users`, ad.jar);
  check(r.status === 200 && r.text.includes("alfa.direktor"), "direktor foydalanuvchilar ro'yxatini ochdi", `${r.status}`);
  check(!r.text.includes("it.qa.admin"), "IT hisobi direktor ro'yxatida ko'rinmaydi");
  check(!r.text.includes('value="SUPERADMIN"'), "rol tanlovida SUPERADMIN yo'q");
  r = await req(`${urlOf("alfa")}/settings?tab=permissions`, ad.jar);
  check(r.status === 200 && !r.text.includes("it.qa.admin") && !r.text.includes("IT: QA Admin"), "ruxsatlar sahifasida IT yo'q");
  const before = await adb.user.count({ where: { role: "SUPERADMIN" } });
  r = await submit(urlOf("alfa"), "/settings?tab=users", 'name="role"', { login: "hack.it", fullName: "Hack IT", password: "Hack2026xx", role: "SUPERADMIN" }, ad.jar);
  check((await adb.user.count({ where: { role: "SUPERADMIN" } })) === before && !(await adb.user.findUnique({ where: { login: "hack.it" } })), "direktor SUPERADMIN rolini bera olmaydi (forma rad etdi)", `${r.status}`);
  const itLogin = await tenantLogin("alfa", "it.qa.admin", "anything123");
  check(itLogin.r.status === 200 && !itLogin.jar.c.has("insof_session"), "IT hisobiga parol bilan kirib bo'lmaydi");

  /* ═════════ 5. Izolyatsiya ═════════ */
  console.log("\n── 5. alfa ↔ beta izolyatsiyasi ──");
  const marker = `QA-ALFA-${Date.now()}`;
  const dir = await adb.user.findUniqueOrThrow({ where: { login: "alfa.direktor" } });
  const cust = await adb.customer.create({ data: { name: marker } });
  await adb.order.create({ data: { orderNo: marker, customerId: cust.id, deliveryDate: new Date(), deliveryAddress: "QA manzil", createdById: dir.id } });
  const bd = await tenantLogin("beta", "beta.direktor", "BetaDir2026x");
  check(bd.r.status === 303, "beta direktori kirdi", `${bd.r.status}`);
  r = await req(`${urlOf("alfa")}/customers`, ad.jar);
  check(r.status === 200 && r.text.includes(marker), "alfa mijozlar sahifasida yozuv bor (nazorat)", `${r.status}`);
  r = await req(`${urlOf("beta")}/customers`, bd.jar);
  check(r.status === 200 && !r.text.includes(marker), "beta mijozlar sahifasida alfa yozuvi YO'Q", `${r.status}`);
  r = await req(`${urlOf("beta")}/orders`, bd.jar);
  check(r.status === 200 && !r.text.includes(marker), "beta zayavkalarida alfa zayavkasi YO'Q", `${r.status}`);
  check((await bdb.order.count()) === 0 && (await bdb.customer.count({ where: { name: marker } })) === 0, "beta bazasida alfa ma'lumoti yo'q");
  r = await req(`${urlOf("beta")}/dashboard`, ad.jar);
  check(r.status === 307 && r.location.includes("/login"), "alfa sessiya cookie'si beta'da yaroqsiz (AUTH_SECRET alohida)", `${r.status} ${r.location}`);
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const shopDir = path.join(aenv.UPLOADS_DIR, "shop");
  mkdirSync(shopDir, { recursive: true });
  writeFileSync(path.join(shopDir, "qa-iso.png"), png);
  r = await req(`${urlOf("alfa")}/api/public/shop/photo/qa-iso.png`, null);
  check(r.status === 200, "alfa fayli alfa'dan beriladi", `${r.status}`);
  r = await req(`${urlOf("beta")}/api/public/shop/photo/qa-iso.png`, null);
  check(r.status === 404, "alfa fayli beta'dan berilmaydi (UPLOADS_DIR alohida)", `${r.status}`);
  r = await req(`${urlOf("alfa")}/superadmin`, null);
  check(r.status === 404, "korxona jarayonida /superadmin yo'q (404)", `${r.status}`);
  const tcsp = (await req(`${urlOf("alfa")}/login`, null)).headers.get("content-security-policy") ?? "";
  check(tcsp.endsWith("form-action 'self'"), "korxona CSP: form-action 'self' (o'zgarmagan)", tcsp.slice(-40));

  /* ═════════ 6. To'xtatish / qayta yoqish ═════════ */
  console.log("\n── 6. To'xtatish ──");
  r = await submit(PANEL, "/superadmin/korxonalar/alfa", 'name="reason"', { reason: "QA sinov: to'lov kechikdi" }, admin);
  check(r.status === 200 || r.status === 303, "panel: alfa to'xtatildi", `${r.status}`);
  check((await ctl.tenant.findUniqueOrThrow({ where: { slug: "alfa" } })).status === "SUSPENDED", "control: alfa SUSPENDED");
  r = await req(`${urlOf("alfa")}/dashboard`, ad.jar);
  check(r.status !== 200 || !r.text.includes("alfa.direktor"), "direktorning ochiq sessiyasi ishlamay qoldi", `${r.status} ${r.location}`);
  const sus = await tenantLogin("alfa", "alfa.direktor", "AlfaDir2026x");
  check(sus.r.status === 200 && sus.r.text.includes("vaqtincha to") && !sus.jar.c.has("insof_session"), "to'xtatilgan korxonaga direktor kira olmaydi (sabab ko'rsatiladi)", `${sus.r.status}`);
  const mob = await req(`${urlOf("alfa")}/api/mobile/auth/login`, null, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "alfa.direktor", password: "AlfaDir2026x" }) });
  check(mob.status >= 400 && mob.status < 500, "mobil login ham rad", `${mob.status} ${mob.text.slice(0, 120)}`);
  const s4 = await sso("alfa");
  p = await postSso("alfa", s4.token);
  r = await req(`${urlOf("alfa")}/dashboard`, p.jar);
  check(p.r.status === 303 && r.status === 200, "IT to'xtatilgan korxonaga kira oladi", `${p.r.status} ${r.status}`);
  const bOk = await tenantLogin("beta", "beta.direktor", "BetaDir2026x");
  check(bOk.r.status === 303, "beta ta'sirlanmadi");
  r = await submit(PANEL, "/superadmin/korxonalar/alfa", "Qayta yoqish", {}, admin);
  check((await ctl.tenant.findUniqueOrThrow({ where: { slug: "alfa" } })).status === "ACTIVE", "panel: alfa qayta yoqildi", `${r.status}`);
  const back = await tenantLogin("alfa", "alfa.direktor", "AlfaDir2026x");
  check(back.r.status === 303, "qayta yoqilgach direktor kiradi", `${back.r.status}`);

  /* ═════════ 7. Statistika ═════════ */
  console.log("\n── 7. Statistika ──");
  r = await submit(PANEL, "/superadmin/korxonalar/beta", "Tekshirish", {}, admin);
  const bt = await ctl.tenant.findUniqueOrThrow({ where: { slug: "beta" } });
  const bs = bt.lastStats as { web?: { up: boolean }; db?: { ok: boolean }; users?: { active: number } } | null;
  check(bt.status === "ACTIVE" && bs?.web?.up && bs.db?.ok, "beta «Tekshirish» → ACTIVE, web/db ok", JSON.stringify({ s: bt.status, e: bt.lastError }));
  check(bs?.users?.active === 1, "statistikada IT hisobi sanalmaydi (faqat direktor)", JSON.stringify(bs?.users));
  r = await req(`${PANEL}/superadmin`, admin);
  check(r.text.includes("QA beta beton") && r.text.includes("QA alfa beton"), "bosh sahifada ikkala korxona");
  r = await req(`${PANEL}/superadmin/jurnal`, admin);
  check(r.status === 200 && r.text.includes("Korxona to"), "jurnal sahifasi (to'xtatish yozuvi)", `${r.status}`);

  await Promise.all([ctl.$disconnect(), adb.$disconnect(), bdb.$disconnect()]);
  console.log(`\n${fails ? `\x1b[1;31m${fails} ta FAIL\x1b[0m` : "\x1b[1;32mHammasi o'tdi\x1b[0m"} (${results.length} tekshiruv)`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
