/* eslint-disable @typescript-eslint/no-explicit-any -- oqim/RSC JSON erkin tuzilishda */
/**
 * QA: IT panel — monitoring va kiberxavfsizlik UI (SSE oqimi, amallar navbati, hodisalar, sahifalar).
 *
 *   CONTROL_DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_ctl_ui \
 *   QA_PANEL=http://127.0.0.1:3260 QA_APP=<build qilingan nusxa> QA_ADMIN_LOGIN=qa.mon QA_ADMIN_PASSWORD=... \
 *   [QA_SERVER_LOG=<server log>] npx tsx scripts/qa/d-monitor-ui.mts
 *
 * Panel INSOF_MODE=control INSOF_ENV=test bilan ishlayotgan bo'lishi kerak (shu control baza bilan).
 * Skript boshida d-monitor-seed.mts ni ishga tushiradi (monitoring jadvallari qayta yoziladi).
 * Sinovlar: login'siz oqim/amal → rad; login → SSE text/event-stream + ma'lumot; yangi HostSnapshot oqimda ≤10 s
 * ichida ko'rinadi; ?once=1 JSON; enqueueAction tekshiruvlari (tur, unit, IP, qat'iy parametr, yozma tasdiq,
 * takror, chastota chegarasi, jurnal); ack/resolve; mavzu (uiPrefs: faqat o'z prefs'i, qat'iy tekshiruv, jurnal, layout atributlari);
 * barcha sahifalar 200 va server logida xato yo'q; bo'sh holat. Xavfsizlik regressiyalari: insof-control/insof-eco
 * qayta ishga tushirish tasdiqsiz rad; PENDING amalni navbatdan olish (cancelAction: faqat PENDING, jurnal);
 * bloklangan admin sahifalardan va ochiq SSE oqimidan chiqariladi (event: logout ≤ ~35 s); korxona bazasi yo'q
 * (P1003) — «baza mavjud emas», server logida prisma:error yo'q.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "../../src/generated/control/index.js";
import { decodeUiCookie, readUiPrefs } from "../../src/lib/control/ui-prefs";

const PANEL = (process.env.QA_PANEL ?? "http://127.0.0.1:3260").replace(/\/$/, "");
const APP = process.env.QA_APP ?? process.cwd();
const LOGIN = process.env.QA_ADMIN_LOGIN ?? "qa.mon";
const PASSWORD = process.env.QA_ADMIN_PASSWORD ?? "";
const CTL = process.env.CONTROL_DATABASE_URL ?? "";
const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!/\/insof_test(_[a-z0-9]+)+(\?|$)/.test(CTL)) { console.error("CONTROL_DATABASE_URL insof_test_… bo'lsin"); process.exit(2); }
if (!PASSWORD) { console.error("QA_ADMIN_PASSWORD kerak"); process.exit(2); }
const db = new PrismaClient({ datasourceUrl: CTL });

let ok = 0, fail = 0;
function check(cond: unknown, name: string, extra = "") {
  if (cond) { ok++; console.log(`\x1b[32mPASS\x1b[0m ${name}`); } else { fail++; console.log(`\x1b[31mFAIL\x1b[0m ${name}${extra ? ` — ${extra}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────── HTTP yordamchilar (d-platform.ts bilan bir xil uslub) ───────── */
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
async function req(p: string, jar: Jar | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jar?.c.size) headers.set("cookie", jar.header());
  const r = await fetch(PANEL + p, { ...init, headers, redirect: "manual" });
  jar?.take(r);
  return { status: r.status, location: r.headers.get("location") ?? "", text: await r.text(), headers: r.headers };
}
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function hiddenFields(html: string, marker: string): Record<string, string> {
  for (const m of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
    if (!m[1].includes(marker)) continue;
    const out: Record<string, string> = {};
    for (const h of m[1].matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/?>/g)) out[unescape(h[1])] = unescape(h[2] ?? "");
    return out;
  }
  throw new Error(`forma topilmadi: ${marker}`);
}

/** Klient chaqiradigan server action id'si — build'dagi klient bo'laklaridan (createServerReference(..., "nom")). */
const idCache = new Map<string, string>();
function actionId(name: string): string {
  if (idCache.has(name)) return idCache.get(name)!;
  const dir = path.join(APP, ".next", "static", "chunks");
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
  idCache.set(name, id);
  return id;
}
type ActRes = { ok?: boolean; id?: string; error?: string; http: number; raw: string };
async function call(name: string, args: unknown[], jar: Jar | null, page = "/superadmin/monitoring"): Promise<ActRes> {
  const r = await req(page, jar, {
    method: "POST", body: JSON.stringify(args),
    headers: { "next-action": actionId(name), "content-type": "text/plain;charset=UTF-8", accept: "text/x-component", origin: PANEL },
  });
  // RSC javobi: "1:{...}" qatori — server action qaytargan obyekt
  let out: Record<string, unknown> = {};
  for (const line of r.text.split("\n")) {
    const m = /^\d+:(\{.*\})$/.exec(line.trim());
    if (!m) continue;
    try { const o = JSON.parse(m[1]); if ("ok" in o || "error" in o) out = o; } catch { /* */ }
  }
  return { ...(out as object), http: r.status, raw: r.text.slice(0, 300) } as ActRes;
}

/** SSE: `data:` hodisalarini o'qish — predicate rost bo'lguncha (yoki vaqt tugaguncha). */
async function readStream(jar: Jar, until: (ev: { at: string; data: Record<string, any> }) => boolean, timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const r = await fetch(`${PANEL}/superadmin/api/stream`, { headers: { cookie: jar.header(), accept: "text/event-stream" }, signal: ac.signal, redirect: "manual" });
  const res = { status: r.status, type: r.headers.get("content-type") ?? "", accel: r.headers.get("x-accel-buffering"), events: 0, comments: 0, matched: null as null | { at: string; data: Record<string, any> } };
  if (r.status !== 200 || !r.body) { clearTimeout(t); ac.abort(); return res; }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k: number;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, k); buf = buf.slice(k + 2);
        if (block.startsWith(":")) { res.comments++; continue; }
        const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
        if (!data) continue;
        res.events++;
        const ev = JSON.parse(data);
        if (until(ev)) { res.matched = ev; ac.abort(); clearTimeout(t); return res; }
      }
    }
  } catch { /* abort — vaqt tugadi */ }
  clearTimeout(t);
  return res;
}

/** SSE: `event: logout` kelguncha (yoki oqim yopilguncha / vaqt tugaguncha) o'qish. */
async function readUntilLogout(jar: Jar, timeoutMs: number, onOpen?: () => Promise<void>) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  const r = await fetch(`${PANEL}/superadmin/api/stream`, { headers: { cookie: jar.header(), accept: "text/event-stream" }, signal: ac.signal, redirect: "manual" });
  const res = { status: r.status, logout: false, ended: false, ms: 0, events: 0 };
  if (r.status !== 200 || !r.body) { clearTimeout(t); ac.abort(); return res; }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let opened = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { res.ended = true; break; }
      buf += dec.decode(value, { stream: true });
      let k: number;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, k); buf = buf.slice(k + 2);
        if (block.split("\n").some((l) => l.startsWith("data: ") && l !== "data: {}")) { res.events++; if (!opened && onOpen) { opened = true; await onOpen(); } }
        if (block.split("\n").includes("event: logout")) res.logout = true;
      }
    }
  } catch { /* abort — vaqt tugadi */ }
  clearTimeout(t);
  res.ms = Date.now() - t0;
  return res;
}

async function loginJar(login: string, password: string): Promise<Jar> {
  const j = new Jar();
  const lp = await req("/superadmin/login", j);
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...hiddenFields(lp.text, 'name="password"'), login, password })) f.append(k, v);
  await req("/superadmin/login", j, { method: "POST", body: f, headers: { origin: PANEL } });
  return j;
}

async function main() {
  // 0. Seed
  const seed = spawnSync("npx", ["tsx", path.join(HERE, "d-monitor-seed.mts")], { env: process.env, encoding: "utf8" });
  check(seed.status === 0, "seed", seed.stderr.slice(-400));
  const logStart = process.env.QA_SERVER_LOG && existsSync(process.env.QA_SERVER_LOG) ? readFileSync(process.env.QA_SERVER_LOG, "utf8").length : 0;

  // 1. Login'siz
  const anon = await req("/superadmin/api/stream", null);
  check([307, 302, 303, 401].includes(anon.status) && (anon.status === 401 || anon.location.includes("/superadmin/login")), "login'siz oqim → login'ga yo'naltirish", `${anon.status} ${anon.location}`);
  const forged = await req("/superadmin/api/stream", null, { headers: { cookie: "insof_admin=eyJhbGciOiJIUzI1NiJ9.e30.xxx" } });
  check(forged.status !== 200, "soxta cookie bilan oqim → rad", String(forged.status));
  const anonOnce = await req("/superadmin/api/stream?once=1", null);
  check(anonOnce.status !== 200 || !anonOnce.text.includes("hostname"), "login'siz ?once=1 ma'lumot bermaydi");
  const before = await db.agentAction.count();
  const anonAct = await call("enqueueAction", ["RUN_HEALTH_CHECK", {}, null, null], null);
  check((await db.agentAction.count()) === before && anonAct.ok !== true, "login'siz enqueueAction → yozilmaydi", `${anonAct.http}`);

  // 2. Login (JS'siz forma — server action)
  const jar = new Jar();
  const lp = await req("/superadmin/login", jar);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...hiddenFields(lp.text, 'name="password"'), login: LOGIN, password: PASSWORD })) fd.append(k, v);
  const lr = await req("/superadmin/login", jar, { method: "POST", body: fd, headers: { origin: PANEL } });
  check(jar.c.has("insof_admin"), "login → insof_admin cookie", `${lr.status}`);

  // 3. SSE oqimi (agent "tirik" bo'lib tursin — sinov davomida stale bo'lib qolmasin)
  await db.agentHeartbeat.update({ where: { id: "main" }, data: { lastSeenAt: new Date(Date.now() + 60_000) } });
  const s1 = await readStream(jar, () => true, 8000);
  check(s1.status === 200 && s1.type.startsWith("text/event-stream"), "oqim: 200 text/event-stream", `${s1.status} ${s1.type}`);
  check(s1.accel === "no", "oqim: X-Accel-Buffering: no");
  const d = s1.matched?.data;
  check(d?.host?.hostname === "insof-vps" && d.series?.cpu?.length === 60, "oqim: host + 60 nuqtali seriya", JSON.stringify(d?.series?.cpu?.length));
  check(d?.checks?.length === 18 && d.checks.some((c: any) => c.key === "unit:insof-erp@beta" && c.status === "CRIT"), "oqim: barcha ServiceCheck");
  check(d?.incidents?.length === 7 && d.incidents[0].severity === "CRITICAL", "oqim: ochiq/ko'rilgan hodisalar, kritik birinchi", `${d?.incidents?.length}`);
  check(d?.counts?.critical === 1 && d.counts.high === 2, "oqim: CRIT/HIGH hisobi", JSON.stringify(d?.counts));
  check(d?.actions?.length === 8 && d?.agent?.stale === false && d?.report?.grade === "B", "oqim: amallar, agent (tirik), hisobot sarlavhasi");
  check(d?.tenants?.some((t: any) => t.slug === "alfa" && t.version === "d12a016"), "oqim: korxona versiyasi");

  // Jonli yangilanish: yangi HostSnapshot → oqimda ko'rinadi; o'zgarmasa faqat izoh (hb)
  const live = readStream(jar, (ev) => ev.data?.host?.cpuPct === 77.7, 12000);
  await sleep(4000);
  const last = await db.hostSnapshot.findFirst({ orderBy: { takenAt: "desc" } });
  await db.hostSnapshot.create({ data: { ...last!, id: undefined, takenAt: new Date(), cpuPct: 77.7 } });
  const s2 = await live;
  check(!!s2.matched, "jonli: yangi HostSnapshot ≤10 s ichida oqimda", `events=${s2.events}`);
  check(s2.comments >= 1 && s2.events === 2, "jonli: o'zgarmaganda faqat `: hb` izohi (hash)", `events=${s2.events} hb=${s2.comments}`);
  check(s2.matched?.data?.series?.cpu?.at(-1) === 77.7, "jonli: seriyaning oxirgi nuqtasi yangilandi");

  const once = await req("/superadmin/api/stream?once=1", jar);
  check(once.status === 200 && once.headers.get("content-type")?.includes("json") && JSON.parse(once.text).data.host.cpuPct === 77.7, "?once=1 zaxira JSON");

  // 4. enqueueAction tekshiruvlari
  const n0 = await db.agentAction.count();
  const bad = [
    ["noma'lum tur", ["RM_RF", {}]],
    ["RESTART_UNIT sshd", ["RESTART_UNIT", { unit: "sshd" }]],
    ["RESTART_UNIT in'yeksiya", ["RESTART_UNIT", { unit: "insof-erp@alfa;rm -rf /" }]],
    ["RESTART_UNIT parametrsiz", ["RESTART_UNIT", {}]],
    ["BLOCK_IP 999.1.1.1", ["BLOCK_IP", { ip: "999.1.1.1" }, null, "999.1.1.1"]],
    ["BLOCK_IP ortiqcha maydon", ["BLOCK_IP", { ip: "203.0.113.9", cmd: "x" }, null, "203.0.113.9"]],
    ["BLOCK_IP 127.0.0.1", ["BLOCK_IP", { ip: "127.0.0.1" }, null, "127.0.0.1"]],
    ["BLOCK_IP tasdiqsiz", ["BLOCK_IP", { ip: "203.0.113.45" }]],
    ["BLOCK_IP noto'g'ri tasdiq", ["BLOCK_IP", { ip: "203.0.113.45" }, null, "203.0.113.4"]],
    ["RENEW_CERT tasdiqsiz", ["RENEW_CERT", {}]],
    ["RESTART_UNIT korxona tasdiqsiz", ["RESTART_UNIT", { unit: "insof-erp@beta" }]],
    ["RESTART_UNIT insof-control tasdiqsiz", ["RESTART_UNIT", { unit: "insof-control" }]],
    ["RESTART_UNIT insof-eco tasdiqsiz", ["RESTART_UNIT", { unit: "insof-eco" }]],
    ["RESTART_UNIT insof-eco noto'g'ri tasdiq", ["RESTART_UNIT", { unit: "insof-eco" }, null, "eco"]],
    ["CLEAN_RELEASES tasdiqsiz", ["CLEAN_RELEASES", {}]],
    ["RUN_BACKUP parametr bilan", ["RUN_BACKUP", { x: 1 }]],
    ["yo'q hodisa", ["RUN_HEALTH_CHECK", {}, "ckzzzzzzzzzzzzzzzzzzzzzzz"]],
    ["takror (seed PENDING RUN_SECURITY_SCAN)", ["RUN_SECURITY_SCAN", {}]],
    ["takror (RUNNING RUN_BACKUP)", ["RUN_BACKUP", {}]],
  ] as const;
  for (const [name, args] of bad) {
    const r = await call("enqueueAction", [...args], jar);
    check(!!r.error && !r.ok, `rad: ${name}`, r.error ?? r.raw);
  }
  check((await db.agentAction.count()) === n0, "rad etilganlar yozilmadi");

  const beta = await db.incident.findFirst({ where: { key: "http:tenant:beta" } });
  const good = [
    ["RUN_HEALTH_CHECK", {}, null, null],
    ["BLOCK_IP", { ip: "203.0.113.45" }, null, "203.0.113.45"],
    ["RESTART_UNIT", { unit: "insof-erp@beta" }, beta!.id, "beta"],
    ["RESTART_UNIT", { unit: "insof-control" }, null, "insof-control"],
    ["RENEW_CERT", {}, null, "SSL"],
  ] as const;
  for (const args of good) {
    const r = await call("enqueueAction", [...args], jar);
    const row = r.id ? await db.agentAction.findUnique({ where: { id: r.id } }) : null;
    check(r.ok && row?.status === "PENDING" && row.type === args[0] && row.requestedById, `qabul: ${args[0]} ${JSON.stringify(args[1])} → PENDING`, r.error ?? r.raw);
    if (args[2]) check(row?.incidentId === args[2], "qabul: hodisaga bog'landi");
  }
  const dup = await call("enqueueAction", ["RUN_HEALTH_CHECK", {}, null, null], jar);
  check(!!dup.error && /navbatda/.test(dup.error), "takror RUN_HEALTH_CHECK rad", dup.error);
  const ev = await db.controlEvent.count({ where: { action: "AGENT_ACTION" } });
  check(ev === good.length, "ControlEvent AGENT_ACTION har qabul uchun", String(ev));

  // Chastota: daqiqada 10 ta (yuqorida 5 ta qabul) → yana 5 tasi o'tadi, 11-chisi rad
  let accepted = 0, limited: ActRes | null = null;
  for (let k = 1; k <= 6; k++) {
    const r = await call("enqueueAction", ["UNBLOCK_IP", { ip: `192.0.2.${k}` }, null, null], jar);
    if (r.ok) accepted++; else { limited = r; break; }
  }
  check(accepted === 5 && !!limited?.error && /Juda ko'p/.test(limited.error), "chastota chegarasi: 10/daqiqa", `accepted=${accepted} ${limited?.error}`);

  // 4b. Navbatdan olish (cancelAction): faqat PENDING, jurnal, login'siz rad
  const cert = await db.agentAction.findFirst({ where: { type: "RENEW_CERT", status: "PENDING" }, orderBy: { requestedAt: "desc" } });
  const anonCancel = await call("cancelAction", [cert!.id], null, "/superadmin/amallar");
  check(anonCancel.ok !== true && (await db.agentAction.findUnique({ where: { id: cert!.id } }))?.status === "PENDING", "login'siz cancelAction → o'zgarmaydi", `${anonCancel.http}`);
  const cev0 = await db.controlEvent.count({ where: { action: "AGENT_ACTION_CANCEL" } });
  const cancel = await call("cancelAction", [cert!.id], jar, "/superadmin/amallar");
  const certRow = await db.agentAction.findUnique({ where: { id: cert!.id } });
  check(cancel.ok && certRow?.status === "CANCELLED" && !!certRow.finishedAt && /navbatdan olindi/.test(certRow.output ?? ""), "cancelAction: PENDING → CANCELLED", cancel.error ?? cancel.raw);
  const cev = await db.controlEvent.findMany({ where: { action: "AGENT_ACTION_CANCEL" } });
  check(cev.length === cev0 + 1 && (cev.at(-1)?.detail as any)?.actionId === cert!.id && (cev.at(-1)?.detail as any)?.type === "RENEW_CERT" && !!cev.at(-1)?.adminId, "cancelAction: jurnal AGENT_ACTION_CANCEL");
  const cancel2 = await call("cancelAction", [cert!.id], jar, "/superadmin/amallar");
  check(!!cancel2.error && !cancel2.ok, "bekor qilinganni qayta bekor qilib bo'lmaydi", cancel2.error);
  const running = await db.agentAction.findFirst({ where: { status: "RUNNING" } });
  const cancelRun = await call("cancelAction", [running!.id], jar, "/superadmin/amallar");
  check(!!cancelRun.error && /boshlagan/.test(cancelRun.error) && (await db.agentAction.findUnique({ where: { id: running!.id } }))?.status === "RUNNING", "RUNNING amalni bekor qilib bo'lmaydi", cancelRun.error);
  const cancelBad = await call("cancelAction", ["x'; DROP"], jar, "/superadmin/amallar");
  check(!!cancelBad.error, "cancelAction: noto'g'ri id rad", cancelBad.error);

  // 5. Hodisa: ko'rdim / yopish
  const sec = await db.incident.findFirst({ where: { key: "security:ssh-bruteforce" } });
  const ack = await call("ackIncident", [sec!.id], jar, "/superadmin/hodisalar");
  const sec2 = await db.incident.findUnique({ where: { id: sec!.id } });
  check(ack.ok && sec2?.status === "ACKED" && !!sec2.ackedById && !!sec2.ackedAt, "ackIncident → ACKED", ack.error ?? ack.raw);
  const short = await call("resolveIncident", [sec!.id, "ok"], jar, "/superadmin/hodisalar");
  check(!!short.error, "resolveIncident qisqa izoh rad");
  const res = await call("resolveIncident", [sec!.id, "IP bloklandi, SSH faqat kalit bilan"], jar, "/superadmin/hodisalar");
  const sec3 = await db.incident.findUnique({ where: { id: sec!.id } });
  check(res.ok && sec3?.status === "RESOLVED" && !!sec3.resolvedAt && (sec3.detail as any)?.resolution?.note === "IP bloklandi, SSH faqat kalit bilan" && (sec3.detail as any)?.ip === "203.0.113.45", "resolveIncident → RESOLVED, izoh detail'da (eski detail saqlangan)");
  const again = await call("ackIncident", [sec!.id], jar, "/superadmin/hodisalar");
  check(!!again.error, "yopilgan hodisani ack qilib bo'lmaydi");
  const evs = await db.controlEvent.count({ where: { action: { in: ["INCIDENT_ACK", "INCIDENT_RESOLVE"] } } });
  check(evs === 2, "ControlEvent INCIDENT_ACK/RESOLVE", String(evs));

  // 5b. Mavzu (Sozlamalar → Mavzu, SuperAdmin.uiPrefs): faqat O'Z prefs'i, zod qat'iy tekshiruv, jurnal, layout atributlari
  check(readUiPrefs({ mobileLayout: "matrix", colorMode: 1 }).mobileLayout === "widgets" && readUiPrefs(null).colorMode === "system", "uiPrefs: buzuq Json → standart");
  check(decodeUiCookie("pro.dark").mobileLayout === "pro" && decodeUiCookie("pro.dark").colorMode === "dark" && decodeUiCookie("<x>.y").mobileLayout === "widgets", "uiPrefs cookie: o'qish va buzuq qiymat");
  const meRow = await db.superAdmin.findUniqueOrThrow({ where: { login: LOGIN } });
  await db.superAdmin.update({ where: { id: meRow.id }, data: { uiPrefs: Prisma.DbNull } });
  const otherPrefs = { mobileLayout: "widgets", colorMode: "light" };
  const other = await db.superAdmin.upsert({
    where: { login: "qa.other.prefs" }, update: { uiPrefs: otherPrefs },
    create: { login: "qa.other.prefs", fullName: "QA Boshqa admin", passwordHash: "-", isActive: true, uiPrefs: otherPrefs },
  });
  // JSONB kalit tartibini o'zgartiradi — qiymatlar bo'yicha solishtiramiz
  const samePrefs = (v: unknown, m: string, c: string) => { const o = (v ?? {}) as Record<string, unknown>; return Object.keys(o).length === 2 && o.mobileLayout === m && o.colorMode === c; };
  const pe0 = await db.controlEvent.count({ where: { action: "ADMIN_PREFS" } });
  const anonPrefs = await call("saveUiPrefs", [{ mobileLayout: "pro" }], null, "/superadmin/sozlamalar");
  check(anonPrefs.ok !== true && (await db.superAdmin.findUniqueOrThrow({ where: { id: meRow.id } })).uiPrefs === null, "login'siz saveUiPrefs → yozilmaydi", `${anonPrefs.http}`);
  const badPrefs: [string, unknown][] = [
    ["noma'lum ko'rinish", { mobileLayout: "matrix" }],
    ["noma'lum rang rejimi", { colorMode: "blue" }],
    ["bo'sh obyekt", {}],
    ["boshqa admin (adminId)", { mobileLayout: "pro", adminId: other.id }],
    ["boshqa admin (id)", { colorMode: "dark", id: other.id }],
    ["ortiqcha kalit", { mobileLayout: "pro", isActive: false }],
    ["massiv", ["pro"]],
    ["satr", "pro"],
  ];
  for (const [name, input] of badPrefs) {
    const r = await call("saveUiPrefs", [input], jar, "/superadmin/sozlamalar");
    check(!!r.error && !r.ok, `uiPrefs rad: ${name}`, r.error ?? r.raw);
  }
  const meAfterBad = await db.superAdmin.findUniqueOrThrow({ where: { id: meRow.id } });
  check(meAfterBad.uiPrefs === null, "rad etilganlar o'z prefs'ini ham o'zgartirmadi");
  const okPrefs = await call("saveUiPrefs", [{ mobileLayout: "pro", colorMode: "dark" }], jar, "/superadmin/sozlamalar");
  const meP = await db.superAdmin.findUniqueOrThrow({ where: { id: meRow.id } });
  const otherP = await db.superAdmin.findUniqueOrThrow({ where: { id: other.id } });
  check(!okPrefs.error && samePrefs(meP.uiPrefs, "pro", "dark"), "saveUiPrefs → o'z prefs'i yozildi", okPrefs.error ?? okPrefs.raw);
  check(samePrefs(otherP.uiPrefs, "widgets", "light"), "boshqa adminning prefs'i o'zgarmadi");
  check((await db.controlEvent.count({ where: { action: "ADMIN_PREFS", adminId: meRow.id } })) === pe0 + 1, "ControlEvent ADMIN_PREFS yozildi");
  await call("saveUiPrefs", [{ colorMode: "dark" }], jar, "/superadmin/sozlamalar");
  check((await db.controlEvent.count({ where: { action: "ADMIN_PREFS" } })) === pe0 + 1, "o'zgarishsiz saqlash jurnalga yozilmaydi");
  const homeP = await req("/superadmin", jar);
  check(homeP.status === 200 && homeP.text.includes('data-mobile="pro"') && homeP.text.includes('data-theme="dark"'), "layout: .sa[data-mobile=pro][data-theme=dark] serverda (miltillamaydi)");
  const merge = await call("saveUiPrefs", [{ mobileLayout: "widgets" }], jar, "/superadmin/sozlamalar");
  const meM = await db.superAdmin.findUniqueOrThrow({ where: { id: meRow.id } });
  check(!merge.error && samePrefs(meM.uiPrefs, "widgets", "dark"), "qisman yangilash: rang rejimi saqlanib qoldi");
  const st = await req("/superadmin/sozlamalar", jar);
  check(st.status === 200 && ["Mavzu", "Vidjetlar", "Zich Pro", "Rang rejimi", "Qorong"].every((n) => st.text.includes(n)), "sahifa /superadmin/sozlamalar");
  await db.superAdmin.update({ where: { id: meRow.id }, data: { uiPrefs: Prisma.DbNull } });
  await db.superAdmin.delete({ where: { id: other.id } });

  // 6. Sahifalar
  const ip7 = "198.51.100.7";
  const pages: [string, string[]][] = [
    ["/superadmin", ["Muammo bor", "Server va xizmatlar →"]], // bosh sahifa: holat qatori (beta CRIT)
    ["/superadmin/monitoring", ["Server va xizmatlar", "insof-erp@beta", "Qayta ishga tushirish", "Alfa Beton MChJ", "d12a016", "kun qoldi"]],
    ["/superadmin/hodisalar", ["Beta Qurilish: veb javob bermayapti", "Hodisalar"]],
    ["/superadmin/hodisalar?status=all&severity=HIGH", ["Zaxira 30 soatdan beri olinmagan"]],
    ["/superadmin/hodisalar?source=ai", ["SSH parol bilan kirish"]],
    [`/superadmin/hodisalar?id=${beta!.id}`, ["Vaqt chizig", "Bog&#x27;liq amallar", "Job failed"]],
    ["/superadmin/xavfsizlik", ["Kiberxavfsizlik", "AI tahlilni hozir boshlash", "Xavfsizlik skanerini ishga tushirish", ip7, "Hisobotlar tarixi"]],
    ["/superadmin/amallar", ["Amallar", "Challenge failed", "oq ro&#x27;yxatda yo&#x27;q", "Navbatdan olish", "Bekor qilindi"]],
    ["/superadmin/amallar?status=CANCELLED", ["SSL yangilash", "navbatdan olindi"]],
    ["/superadmin/amallar?status=FAILED", ["SSL yangilash"]],
  ];
  for (const [p, needles] of pages) {
    const r = await req(p, jar);
    const miss = needles.filter((n) => !r.text.includes(n));
    check(r.status === 200 && miss.length === 0, `sahifa ${p}`, `${r.status} yo'q: ${miss.join(", ")}`);
  }
  const xs = await req("/superadmin/xavfsizlik", jar);
  check(!xs.text.includes("198.51.100.8"), "blokdan chiqarilgan IP ro'yxatda yo'q");

  // 6b. Yordam tugmalari («?») — har sahifada; «Bu sahifa haqida»; hodisa tafsilotida oddiy tildagi yordam
  const helpPages = ["/superadmin", "/superadmin/monitoring", "/superadmin/hodisalar", "/superadmin/xavfsizlik", "/superadmin/amallar",
    "/superadmin/adminlar", "/superadmin/jurnal", "/superadmin/korxonalar/yangi", "/superadmin/korxonalar/beta", "/superadmin/baza",
    "/superadmin/trafik", "/superadmin/zaxira", "/superadmin/server", "/superadmin/relizlar", "/superadmin/loglar", "/superadmin/sozlamalar"];
  for (const p of helpPages) {
    const r = await req(p, jar);
    const n = (r.text.match(/aria-label="Yordam: /g) ?? []).length;
    check(r.status === 200 && n > 0 && r.text.includes("Bu sahifa haqida"), `yordam tugmalari: ${p}`, `${r.status}, ${n} ta`);
  }
  const mon = await req("/superadmin/monitoring", jar);
  check(/aria-label="Yordam: Korxona xizmati: beta"/.test(mon.text) && mon.text.includes('aria-label="Yordam: Xizmatni qayta ishga tushirish"'),
    "monitoring: xizmat kartasi va amal tugmasi yonida «?»");
  const det = await req(`/superadmin/hodisalar?id=${beta!.id}`, jar);
  check(det.text.includes("Oddiy tilda") && det.text.includes("Qanday tuzatiladi?"), "hodisa tafsilotida oddiy tildagi yordam");
  const yd = await req("/superadmin/yordam", jar);
  check(yd.status === 200 && yd.text.includes("Atamalar lug") && yd.text.includes("IP bloklash"), "«Yordam» sahifasi (lug'at)", String(yd.status));
  const home = await req("/superadmin", jar);
  check(!home.text.includes("window.confirm") && home.text.includes("Plitka ranglari") && home.text.includes("Vidjetlar nimani"), "bosh sahifa: holat qatori yordam bilan");

  // 6c. Korxona bazasi yo'q (seed: alfa/beta bazasiz) — bosh sahifa jimgina «baza mavjud emas» (P1003, prisma:error yo'q)
  const alfaT = await db.tenant.findUnique({ where: { slug: "alfa" } });
  check(/mavjud emas/.test(alfaT?.lastError ?? "") && (alfaT?.lastStats as any)?.db?.ok === false, "yo'q korxona bazasi → «baza mavjud emas»", alfaT?.lastError ?? "");

  // 6d. Bloklangan admin: har panel sahifasidan va OCHIQ SSE oqimidan chiqariladi
  const BL_PASS = "QaBlock-2026-x9";
  const bl = await db.superAdmin.upsert({
    where: { login: "qa.block" }, update: { isActive: true, passwordHash: await bcrypt.hash(BL_PASS, 4) },
    create: { login: "qa.block", fullName: "QA Bloklanadigan", passwordHash: await bcrypt.hash(BL_PASS, 4), isActive: true },
  });
  const bj = await loginJar("qa.block", BL_PASS);
  check(bj.c.has("insof_admin"), "qa.block login");
  const blPages = ["/superadmin", "/superadmin/monitoring", "/superadmin/hodisalar", "/superadmin/xavfsizlik", "/superadmin/amallar",
    "/superadmin/jurnal", "/superadmin/yordam", "/superadmin/korxonalar/yangi", "/superadmin/korxonalar/beta", "/superadmin/adminlar"];
  const okBefore = await req("/superadmin/jurnal", bj);
  check(okBefore.status === 200, "qa.block: blokdan oldin sahifa ochiladi", String(okBefore.status));
  // Oqim ochiq turganda bloklaymiz → ≤ 30 s qayta tekshiruv + 3 s tik ichida `event: logout` va oqim yopiladi
  const sse = await readUntilLogout(bj, 50_000, async () => {
    await db.superAdmin.update({ where: { id: bl.id }, data: { isActive: false, sessionVersion: { increment: 1 } } });
  });
  check(sse.status === 200 && sse.logout && sse.ended && sse.ms < 45_000, "bloklangan admin: ochiq SSE oqimi `event: logout` bilan yopildi", JSON.stringify(sse));
  for (const p of blPages) {
    const r = await req(p, bj);
    check([307, 302, 303].includes(r.status) && r.location.includes("/superadmin/login"), `bloklangan admin: ${p} → login`, `${r.status} ${r.location}`);
  }
  const blAct = await call("enqueueAction", ["RUN_HEALTH_CHECK", {}, null, null], bj);
  check(blAct.ok !== true, "bloklangan admin: amal qo'yolmaydi");
  const blSse = await req("/superadmin/api/stream", bj);
  check(blSse.status !== 200, "bloklangan admin: oqimga qayta ulanib bo'lmaydi", String(blSse.status));
  await db.controlEvent.deleteMany({ where: { adminId: bl.id } });
  await db.superAdmin.delete({ where: { id: bl.id } });

  // 7. Bo'sh holat (agent hech ishlamagan)
  spawnSync("npx", ["tsx", path.join(HERE, "d-monitor-seed.mts"), "--empty"], { env: process.env, encoding: "utf8" });
  await sleep(3000); // snapshot keshi (2.5 s)
  const em = await req("/superadmin/monitoring", jar);
  check(em.status === 200 && em.text.includes("insof-agent o") && em.text.includes("PLATFORMA.md"), "bo'sh holat: o'rnatish ko'rsatmasi");
  for (const p of ["/superadmin/hodisalar", "/superadmin/xavfsizlik", "/superadmin/amallar", "/superadmin"]) {
    const r = await req(p, jar);
    check(r.status === 200, `bo'sh holat: ${p} 200`, String(r.status));
  }
  const s3 = await readStream(jar, () => true, 6000);
  check(s3.matched?.data?.host === null && s3.matched.data.agent === null, "bo'sh holat: oqim host=null, agent=null");

  // 8. Server logi
  if (process.env.QA_SERVER_LOG && existsSync(process.env.QA_SERVER_LOG)) {
    const log = readFileSync(process.env.QA_SERVER_LOG, "utf8").slice(logStart);
    const bad = log.split("\n").filter((l) => /⨯|Unhandled|\[monitoring\]|TypeError|ReferenceError|Hydration/.test(l));
    check(bad.length === 0, "server logida xato yo'q", bad.slice(0, 3).join(" | "));
    const prismaErr = log.split("\n").filter((l) => /prisma:error/.test(l));
    check(prismaErr.length === 0, "server logida prisma:error yo'q (yo'q korxona bazasi — jim)", `${prismaErr.length} ta: ${prismaErr.slice(0, 2).join(" | ")}`);
  }

  // Keyingi qo'lda ko'rish uchun ma'lumotni qaytaramiz
  spawnSync("npx", ["tsx", path.join(HERE, "d-monitor-seed.mts")], { env: process.env, encoding: "utf8" });
  console.log(`\n${ok} OK, ${fail} FAIL`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
