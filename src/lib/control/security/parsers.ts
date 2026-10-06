/**
 * Sof parserlar (tizimga tegmaydi) — QA fixture'lari bilan sinaladi (scripts/qa/d-security.mts).
 */
import { IPV4_RE } from "../monitor/contract";

/* ───────────────────────── IP yordamchilari ───────────────────────── */

export function isIPv4(ip: string): boolean {
  return IPV4_RE.test(ip);
}

/** Lokal/xususiy manzil — bloklash taklif qilinmaydi (o'zimizni bloklab qo'ymaslik uchun). */
export function isPrivateIp(ip: string): boolean {
  if (!isIPv4(ip)) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** BLOCK_IP taklif qilsa bo'ladimi: faqat ommaviy IPv4 (contract.ts IPV4_RE — agent shuni qabul qiladi). */
export function blockable(ip: string): boolean {
  return isIPv4(ip) && !isPrivateIp(ip);
}

/* ───────────────────────── SSH jurnali (journalctl -o short-unix) ───────────────────────── */

export type SshEvent =
  | { kind: "fail"; ts: number | null; ip: string; invalidUser: boolean }
  | { kind: "accept"; ts: number | null; ip: string; method: string; user: string };

const RE_FAIL = /Failed (?:password|keyboard-interactive\/pam) for (invalid user )?\S* ?from (\S+) port \d+/;
const RE_INVALID = /^(?:.*: )?Invalid user \S* ?from (\S+)(?: port \d+)?/;
const RE_ACCEPT = /Accepted (\S+) for (\S+) from (\S+) port \d+/;

/** Har qator: "1696600000.123456 host sshd[123]: Failed password for root from 1.2.3.4 port 22 ssh2" yoki `-o cat` matni. */
export function parseSshJournal(text: string): SshEvent[] {
  const out: SshEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const tsm = /^(\d{9,11}(?:\.\d+)?)\s/.exec(line);
    const ts = tsm ? Math.round(Number(tsm[1]) * 1000) : null;
    let m = RE_FAIL.exec(line);
    if (m) { out.push({ kind: "fail", ts, ip: m[2], invalidUser: !!m[1] }); continue; }
    // "Invalid user X from IP" alohida qator (parol so'ralishidan oldin) — shu ham urinish
    const msg = line.replace(/^\d{9,11}(?:\.\d+)?\s+\S+\s+\S+:\s*/, "");
    m = RE_INVALID.exec(msg);
    if (m) { out.push({ kind: "fail", ts, ip: m[1], invalidUser: true }); continue; }
    m = RE_ACCEPT.exec(line);
    if (m) out.push({ kind: "accept", ts, ip: m[3], method: m[1], user: m[2] });
  }
  return out;
}

export function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) { const k = key(it); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

export function topN(m: Map<string, number>, n: number): { key: string; count: number }[] {
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([key, count]) => ({ key, count }));
}

/* ───────────────────────── sshd_config ───────────────────────── */

/**
 * sshd_config matnlari (asosiy + Include qilinganlar, ochilish tartibida) → samarali qiymatlar.
 * OpenSSH qoidasi: kalitning BIRINCHI qiymati amal qiladi; `Match` blokidan keyingilar global emas.
 * `files` — [{name, text}] tartib bilan; Include qatorlari chaqiruvchi tomonidan joyida ochiladi (expandSshdIncludes).
 */
export function parseSshdConfig(texts: string[]): Record<string, string> {
  const eff: Record<string, string> = {};
  for (const text of texts) {
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*/, "").trim();
      if (!line) continue;
      const m = /^(\S+)\s*(?:=\s*|\s+)(.*)$/.exec(line);
      if (!m) continue;
      const k = m[1].toLowerCase();
      if (k === "match") return eff; // shu fayl va keyingilar — shartli blok
      if (k === "include") continue;
      if (!(k in eff)) eff[k] = m[2].trim().toLowerCase();
    }
  }
  return eff;
}

/** `sshd -T` chiqishi (har qator "kalit qiymat", kichik harf). */
export function parseSshdT(text: string): Record<string, string> {
  const eff: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^(\S+)\s+(.*)$/.exec(line.trim());
    if (m && !(m[1] in eff)) eff[m[1].toLowerCase()] = m[2].trim().toLowerCase();
  }
  return eff;
}

export type SshdIssue = { key: string; severity: "HIGH" | "MEDIUM" | "LOW"; text: string };

export function sshdIssues(eff: Record<string, string>): SshdIssue[] {
  const issues: SshdIssue[] = [];
  const root = eff.permitrootlogin ?? "prohibit-password"; // OpenSSH 7+ standarti
  if (root === "yes") issues.push({ key: "PermitRootLogin", severity: "HIGH", text: "root parol bilan SSH orqali kira oladi (PermitRootLogin yes)" });
  const pass = eff.passwordauthentication ?? "yes"; // standart: yes
  if (pass === "yes") {
    issues.push({
      key: "PasswordAuthentication",
      severity: "MEDIUM",
      text: "SSH parol bilan kirishga ruxsat beradi — parolni taxmin qilish hujumiga ochiq. Tavsiya: kalit bilan kirish + fail2ban, keyin PasswordAuthentication no (docs/server-xavfsizlik.md 3.2)",
    });
  }
  if (eff.permitemptypasswords === "yes") issues.push({ key: "PermitEmptyPasswords", severity: "HIGH", text: "bo'sh parolga ruxsat (PermitEmptyPasswords yes)" });
  if (!("maxauthtries" in eff)) issues.push({ key: "MaxAuthTries", severity: "LOW", text: "MaxAuthTries berilmagan (standart 6) — 3 tavsiya etiladi" });
  else if (Number(eff.maxauthtries) > 6) issues.push({ key: "MaxAuthTries", severity: "LOW", text: `MaxAuthTries ${eff.maxauthtries} — 3 tavsiya etiladi` });
  return issues;
}

/* ───────────────────────── ufw ───────────────────────── */

export function parseUfwStatus(text: string): "active" | "inactive" | null {
  const m = /^Status:\s*(\w+)/m.exec(text);
  if (!m) return null;
  return m[1].toLowerCase() === "active" ? "active" : "inactive";
}

/** /etc/ufw/ufw.conf — hammaga o'qiladi; ENABLED=yes — yoqilgan deb sozlangan (root'siz zaxira dalil). */
export function parseUfwConf(text: string): boolean | null {
  const m = /^\s*ENABLED\s*=\s*(\w+)/m.exec(text);
  return m ? m[1].toLowerCase() === "yes" : null;
}

/* ───────────────────────── ss -Htlnp ───────────────────────── */

export type Listener = { addr: string; port: number; process: string; public: boolean };

/** Lokal manzil (ss formatida): "0.0.0.0:22", "[::]:443", "*:80", "127.0.0.1:5432", "127.0.0.53%lo:53", "[::1]:6379". */
export function splitHostPort(local: string): { host: string; port: number } | null {
  const m = /^(.*):(\d+|\*)$/.exec(local);
  if (!m || m[2] === "*") return null;
  return { host: m[1].replace(/^\[|\]$/g, "").replace(/%.*$/, ""), port: Number(m[2]) };
}

export function isLoopbackHost(host: string): boolean {
  return host.startsWith("127.") || host === "::1" || host === "localhost" || host.startsWith("::ffff:127.");
}

export function parseSs(text: string): Listener[] {
  const out: Listener[] = [];
  for (const line of text.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    // -H: sarlavhasiz. Ustunlar: State Recv-Q Send-Q Local Peer [Process]
    const hp = splitHostPort(cols[3]);
    if (!hp) continue;
    const proc = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? "";
    out.push({ addr: hp.host, port: hp.port, process: proc, public: !isLoopbackHost(hp.host) });
  }
  return out;
}

export const PUBLIC_OK_PORTS = new Set([22, 80, 443]);
/** Ichki xizmatlar — faqat 127.0.0.1 da tinglashi shart */
export function isInternalPort(p: number): boolean {
  return (p >= 3000 && p <= 3199) || p === 5432 || p === 6379;
}

/** Internetga ochiq, lekin ochiq bo'lmasligi kerak bo'lgan tinglovchilar (port bo'yicha birlashtirilgan). */
export function exposedListeners(ls: Listener[]): { port: number; addrs: string[]; process: string; internal: boolean }[] {
  const by = new Map<number, { port: number; addrs: string[]; process: string; internal: boolean }>();
  for (const l of ls) {
    if (!l.public || PUBLIC_OK_PORTS.has(l.port)) continue;
    const e = by.get(l.port) ?? { port: l.port, addrs: [], process: l.process, internal: isInternalPort(l.port) };
    if (!e.addrs.includes(l.addr)) e.addrs.push(l.addr);
    e.process ||= l.process;
    by.set(l.port, e);
  }
  return [...by.values()].sort((a, b) => a.port - b.port);
}

/* ───────────────────────── .env fayllari ───────────────────────── */

/** KEY=qiymat (qo'shtirnoqli ham). Qiymatlar faqat ichkarida ishlatiladi — topilmaga hech qachon chiqmaydi. */
export function parseEnv(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const r = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(raw);
    if (!r) continue;
    let v = r[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    m.set(r[1], v);
  }
  return m;
}

/** Ruxsat etilgan rejim: 600/640/400/440 — guruhga yozish va boshqalarga hech narsa yo'q. */
export function modeTooOpen(mode: number): boolean {
  return (mode & 0o777 & ~0o640) !== 0;
}

export const fmtMode = (mode: number) => (mode & 0o777).toString(8).padStart(3, "0");

/* ───────────────────────── nginx access.log (combined) ───────────────────────── */

export type NginxLine = { ip: string; ts: string; method: string; path: string; status: number; ua: string };

const RE_NGINX = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:(\S+) (\S+)(?: [^"]*)?|[^"]*)" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;

export function parseNginxLog(text: string): NginxLine[] {
  const out: NginxLine[] = [];
  for (const line of text.split("\n")) {
    const m = RE_NGINX.exec(line);
    if (!m) continue;
    out.push({ ip: m[1], ts: m[2], method: m[3] ?? "", path: m[4] ?? "", status: Number(m[5]), ua: m[6] ?? "" });
  }
  return out;
}

/** Skaner/zaif joy qidiruvchilar so'raydigan yo'llar (bizda bunday sahifa yo'q). */
export const SCANNER_PATH_RE =
  /(?:^|\/)(?:wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|\.env(?:\.\w+)?|\.git(?:\/|$)|phpmyadmin|pma|myadmin|phpinfo\.php|vendor\/phpunit|cgi-bin|\.aws|\.ssh|actuator|boaform|server-status|HNAP1|shell\.php|config\.php|\.DS_Store|admin\.php|solr|owa\/|autodiscover)/i;

export type NginxSummary = {
  total: number;
  s5xx: number;
  s4xx: number;
  s429: number;
  rate5xx: number;
  top4xx: { ip: string; count: number }[];
  scanners: { ip: string; hits: number; samplePaths: string[] }[];
  from: string | null;
  to: string | null;
};

export function summarizeNginx(lines: NginxLine[]): NginxSummary {
  const s5xx = lines.filter((l) => l.status >= 500).length;
  const l4 = lines.filter((l) => l.status >= 400 && l.status < 500);
  const scanHits = lines.filter((l) => SCANNER_PATH_RE.test(l.path.split("?")[0]));
  const byIp = new Map<string, { hits: number; paths: Set<string> }>();
  for (const l of scanHits) {
    const e = byIp.get(l.ip) ?? { hits: 0, paths: new Set<string>() };
    e.hits++;
    if (e.paths.size < 3) e.paths.add(l.path.split("?")[0].slice(0, 60));
    byIp.set(l.ip, e);
  }
  return {
    total: lines.length,
    s5xx,
    s4xx: l4.length,
    s429: lines.filter((l) => l.status === 429).length,
    rate5xx: lines.length ? s5xx / lines.length : 0,
    top4xx: topN(countBy(l4, (l) => l.ip), 5).map((x) => ({ ip: x.key, count: x.count })),
    scanners: [...byIp]
      .sort((a, b) => b[1].hits - a[1].hits)
      .slice(0, 10)
      .map(([ip, e]) => ({ ip, hits: e.hits, samplePaths: [...e.paths] })),
    from: lines[0]?.ts ?? null,
    to: lines.at(-1)?.ts ?? null,
  };
}

/* ───────────────────────── apt list --upgradable ───────────────────────── */

export type AptSummary = { total: number; security: number; securityPkgs: string[]; critical: string[] };

/** Muhim paketlar — xavfsizlik yangilanishi bo'lsa HIGH */
const CRITICAL_PKG_RE = /^(openssh-server|openssh-client|openssl|libssl3|linux-image|linux-generic|sudo|nginx|postgresql|libc6|systemd|nodejs|curl|libcurl)/;

export function parseAptUpgradable(text: string): AptSummary {
  const lines = text.split("\n").filter((l) => /^\S+\/\S+\s/.test(l));
  const sec = lines.filter((l) => /-security/.test(l.split(/\s/)[0]));
  const pkgs = sec.map((l) => l.split("/")[0]);
  return { total: lines.length, security: sec.length, securityPkgs: pkgs.slice(0, 30), critical: pkgs.filter((p) => CRITICAL_PKG_RE.test(p)).slice(0, 15) };
}

/* ───────────────────────── npm audit --json ───────────────────────── */

/** Ataylab qotirilgan paketlar — qabul qilingan xavf (sharp 0.33.5: serverdagi eski CPU uchun, libvips yangi versiyasi ishlamaydi). */
export const ACCEPTED_RISK: Record<string, string> = {
  sharp:
    "sharp 0.33.5 ataylab qotirilgan (serverning CPU'si yangi libvips'ni qo'llamaydi). Yumshatish: sharp faqat ichki yuklangan rasmlarni o'lchaydi, " +
    "fayl hajmi chegaralangan, tashqi URL'dan rasm olinmaydi; CPU almashtirilganda yangilanadi.",
};

export type AuditSummary = {
  counts: Record<"info" | "low" | "moderate" | "high" | "critical", number>;
  /** Qabul qilingan xavflarni chiqarib tashlagandagi high/critical */
  effective: { high: number; critical: number; moderate: number };
  packages: { name: string; severity: string; fix: boolean }[];
  accepted: { name: string; severity: string }[];
};

type AuditVuln = { severity?: string; via?: unknown[]; fixAvailable?: unknown };

export function parseNpmAudit(json: string): AuditSummary | null {
  let j: { metadata?: { vulnerabilities?: Record<string, number> }; vulnerabilities?: Record<string, AuditVuln> };
  try { j = JSON.parse(json); } catch { return null; }
  if (!j || typeof j !== "object" || !j.metadata) return null;
  const mv = j.metadata.vulnerabilities ?? {};
  const counts = { info: mv.info ?? 0, low: mv.low ?? 0, moderate: mv.moderate ?? 0, high: mv.high ?? 0, critical: mv.critical ?? 0 };
  const vulns = j.vulnerabilities ?? {};
  const isAccepted = (name: string, v: AuditVuln): boolean => {
    if (name in ACCEPTED_RISK) return true;
    // Faqat qabul qilingan paket orqali kelgan (via — paket nomlari satr sifatida)
    const via = v.via ?? [];
    return via.length > 0 && via.every((x) => typeof x === "string" && x in ACCEPTED_RISK);
  };
  const effective = { high: 0, critical: 0, moderate: 0 };
  const packages: AuditSummary["packages"] = [];
  const accepted: AuditSummary["accepted"] = [];
  for (const [name, v] of Object.entries(vulns)) {
    const sev = String(v.severity ?? "info");
    if (isAccepted(name, v)) { accepted.push({ name, severity: sev }); continue; }
    if (sev === "high" || sev === "critical" || sev === "moderate") effective[sev]++;
    packages.push({ name, severity: sev, fix: !!v.fixAvailable });
  }
  const rank: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  packages.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.name.localeCompare(b.name));
  return { counts, effective, packages: packages.slice(0, 20), accepted };
}

/* ───────────────────────── Ish vaqti (Toshkent) ───────────────────────── */

/** Toshkent vaqti bo'yicha soat (0–23). Ish vaqti: 08:00–20:00. */
export function tashkentHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", hour12: false }).format(d)) % 24;
}

export function offHours(d: Date): boolean {
  const h = tashkentHour(d);
  return h < 8 || h >= 20;
}

/* ───────────────────────── login-guard jurnali ───────────────────────── */

/** "[login-guard] qulf: l:<login> (15 daqiqa)" / "ip:<ip>" — loginlar soni, IP'lar (login nomlari chiqarilmaydi). */
export function parseLoginGuardLocks(text: string): { loginLocks: number; ipLocks: string[] } {
  let loginLocks = 0;
  const ips: string[] = [];
  for (const line of text.split("\n")) {
    const m = /\[login-guard\] qulf: (l|ip):(\S+)/.exec(line);
    if (!m) continue;
    if (m[1] === "l") loginLocks++;
    else ips.push(m[2]);
  }
  return { loginLocks, ipLocks: ips };
}
