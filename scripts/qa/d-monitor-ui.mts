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
 * takror, chastota chegarasi, jurnal); ack/resolve; barcha sahifalar 200 va server logida xato yo'q; bo'sh holat.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../src/generated/control/index.js";

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
    ["RESTART_UNIT", { unit: "insof-control" }, null, null],
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
    ["/superadmin/amallar", ["Amallar", "Challenge failed", "oq ro&#x27;yxatda yo&#x27;q"]],
    ["/superadmin/amallar?status=FAILED", ["SSL yangilash"]],
  ];
  for (const [p, needles] of pages) {
    const r = await req(p, jar);
    const miss = needles.filter((n) => !r.text.includes(n));
    check(r.status === 200 && miss.length === 0, `sahifa ${p}`, `${r.status} yo'q: ${miss.join(", ")}`);
  }
  const xs = await req("/superadmin/xavfsizlik", jar);
  check(!xs.text.includes("198.51.100.8"), "blokdan chiqarilgan IP ro'yxatda yo'q");

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
  }

  // Keyingi qo'lda ko'rish uchun ma'lumotni qaytaramiz
  spawnSync("npx", ["tsx", path.join(HERE, "d-monitor-seed.mts")], { env: process.env, encoding: "utf8" });
  console.log(`\n${ok} OK, ${fail} FAIL`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
