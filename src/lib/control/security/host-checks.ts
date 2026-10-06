/**
 * Server darajasidagi tekshiruvlar (SSH, firewall, portlar, sirlar, nginx, yangilanishlar, npm audit).
 * Har biri: `evaluate*` — sof funksiya (fixture bilan sinaladi), `check*` — tizimdan yig'ib evaluate'ga beradi.
 * Hech biri xato tashlamaydi deb kutilmaydi — index.ts har birini alohida try/catch + timeout bilan o'raydi.
 */
import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync, fstatSync } from "node:fs";
import path from "node:path";
import { run, shortErr } from "./exec";
import {
  blockable, countBy, exposedListeners, fmtMode, modeTooOpen, parseAptUpgradable, parseEnv, parseNginxLog, parseNpmAudit,
  parseSs, parseSshdConfig, parseSshdT, parseSshJournal, parseUfwConf, parseUfwStatus, sshdIssues, summarizeNginx, topN,
  ACCEPTED_RISK, type AuditSummary, type Listener, type SshEvent,
} from "./parsers";
import { blockIpAction, cached, finding, maxSev, unknown } from "./util";
import type { Finding, SecurityCtx, Severity, SuggestedAction } from "./types";

const JOURNALCTL = "journalctl";
const SSH_FAIL_THRESHOLD = Number(process.env.SECURITY_SSH_FAIL_THRESHOLD ?? 10);

/* ═════════════════════════ 1. SSH brute force ═════════════════════════ */

export function evaluateSsh(events: SshEvent[], nowMs: number): Finding[] {
  const hourAgo = nowMs - 3600_000;
  const fails = events.filter((e): e is Extract<SshEvent, { kind: "fail" }> => e.kind === "fail" && (e.ts == null || e.ts >= hourAgo));
  const accepts = events.filter((e): e is Extract<SshEvent, { kind: "accept" }> => e.kind === "accept");
  const out: Finding[] = [];

  // a) Parol taxmin qilish (oxirgi 1 soat)
  const perIp = countBy(fails, (e) => e.ip);
  const offenders = topN(perIp, 50).filter((x) => x.count >= SSH_FAIL_THRESHOLD);
  const detail = {
    windowMin: 60, failedTotal: fails.length, uniqueIps: perIp.size, threshold: SSH_FAIL_THRESHOLD,
    topIps: topN(perIp, 10).map((x) => ({ ip: x.key, count: x.count })),
  };
  if (offenders.length) {
    const actions = offenders.filter((o) => blockable(o.key)).slice(0, 5).map((o) => blockIpAction(o.key, `${o.count} ta xato SSH urinishi / soat`));
    out.push(finding("ssh-bruteforce", "security", "HIGH", `SSH: ${offenders.length} ta IP dan parol taxmin qilish (1 soatda ${fails.length} ta xato urinish)`, detail, actions));
  } else {
    out.push(finding("ssh-bruteforce", "security", "INFO", `SSH: 1 soatda ${fails.length} ta xato urinish — chegaradan past`, detail));
  }

  // b) Muvaffaqiyatli kirishlar: yangi IP (oxirgi 1 soatda, 24 soat ichida oldin ko'rilmagan) va xato urinishlardan keyin kirish
  const recent = accepts.filter((a) => a.ts == null || a.ts >= hourAgo);
  const earlierIps = new Set(accepts.filter((a) => a.ts != null && a.ts < hourAgo).map((a) => a.ip));
  const failIps24 = new Set(events.filter((e) => e.kind === "fail").map((e) => e.ip));
  const newIp = recent.filter((a) => !earlierIps.has(a.ip));
  const afterBrute = recent.filter((a) => (perIp.get(a.ip) ?? 0) >= SSH_FAIL_THRESHOLD || (failIps24.has(a.ip) && a.method === "password" && !earlierIps.has(a.ip)));
  const loginDetail = {
    accepted24h: accepts.length,
    uniqueIps24h: new Set(accepts.map((a) => a.ip)).size,
    recent: recent.slice(0, 10).map((a) => ({ ip: a.ip, method: a.method, at: a.ts ? new Date(a.ts).toISOString() : null })),
  };
  if (afterBrute.length) {
    out.push(finding("ssh-login", "security", "CRITICAL",
      `SSH: xato urinishlardan keyin muvaffaqiyatli kirish (${[...new Set(afterBrute.map((a) => a.ip))].join(", ")}) — buzib kirilgan bo'lishi mumkin`,
      { ...loginDetail, suspicious: afterBrute.map((a) => ({ ip: a.ip, method: a.method })) }));
  } else if (newIp.length) {
    const viaPassword = newIp.some((a) => a.method === "password");
    out.push(finding("ssh-login", "security", viaPassword ? "MEDIUM" : "LOW",
      `SSH: yangi IP dan kirish (${[...new Set(newIp.map((a) => a.ip))].slice(0, 5).join(", ")}${viaPassword ? ", parol bilan" : ""}) — o'zingizmi, tekshiring`,
      { ...loginDetail, newIps: [...new Set(newIp.map((a) => a.ip))] }));
  } else {
    out.push(finding("ssh-login", "security", "INFO", `SSH: 24 soatda ${accepts.length} ta kirish, yangi IP yo'q`, loginDetail));
  }
  return out;
}

async function journal(units: string[], since: string, grep?: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const args = [...units.flatMap((u) => ["-u", u]), `--since=${since}`, "-o", "short-unix", "--no-pager", "-q"];
  if (grep) args.push(`--grep=${grep}`);
  let r = await run(JOURNALCTL, args, { timeoutMs: 20_000, maxBuffer: 64 * 1024 * 1024 });
  // Eski journalctl --grep ni bilmaydi (pcre2'siz) — filtrsiz qayta
  if (!r.ok && grep && !r.missing && /grep|pcre|unrecognized/i.test(r.stderr)) {
    r = await run(JOURNALCTL, args.filter((a) => !a.startsWith("--grep=")), { timeoutMs: 30_000, maxBuffer: 64 * 1024 * 1024 });
  }
  // Mos yozuv bo'lmasa journalctl --grep 1 qaytaradi
  if (!r.ok && !(r.code === 1 && !r.stderr.trim())) {
    return { ok: false, reason: r.missing ? "journalctl yo'q (systemd emas — masalan macOS)" : `journalctl: ${shortErr(r)} (deploy 'systemd-journal' guruhidami?)` };
  }
  return { ok: true, text: r.stdout };
}

export async function checkSsh(ctx: SecurityCtx): Promise<Finding[]> {
  const [h1, d1] = await Promise.all([
    journal(["ssh", "sshd"], "-1h"),
    journal(["ssh", "sshd"], "-24h", "Accepted |Failed password|Invalid user"),
  ]);
  if (!h1.ok) return [unknown("ssh-bruteforce", "security", "SSH urinishlari", h1.reason), unknown("ssh-login", "security", "SSH kirishlari", h1.reason)];
  const events = [...parseSshJournal(h1.text)];
  if (d1.ok) {
    // 24 soatlikdan faqat 1 soatdan eskilarini qo'shamiz (takrorlanmasin)
    const hourAgo = ctx.now.getTime() - 3600_000;
    events.push(...parseSshJournal(d1.text).filter((e) => e.ts != null && e.ts < hourAgo));
  }
  return evaluateSsh(events, ctx.now.getTime());
}

/* ═════════════════════════ 2. sshd sozlamasi ═════════════════════════ */

export function evaluateSshd(eff: Record<string, string>, source: string): Finding {
  const issues = sshdIssues(eff);
  const sev = issues.reduce<Severity>((s, i) => maxSev(s, i.severity), "INFO");
  const detail = {
    source,
    permitRootLogin: eff.permitrootlogin ?? "(standart: prohibit-password)",
    passwordAuthentication: eff.passwordauthentication ?? "(standart: yes)",
    maxAuthTries: eff.maxauthtries ?? "(standart: 6)",
    issues: issues.map((i) => ({ key: i.key, severity: i.severity, text: i.text })),
  };
  if (!issues.length) return finding("sshd-config", "config", "INFO", "SSH sozlamasi: root yopiq, faqat kalit bilan kirish", detail);
  const head = issues.find((i) => i.severity === sev)!;
  return finding("sshd-config", "config", sev, `SSH sozlamasi: ${head.text.split(" — ")[0]}${issues.length > 1 ? ` (+${issues.length - 1})` : ""}`, detail);
}

/** sshd_config + Include (glob faqat "<papka>/*.conf" ko'rinishida) — OpenSSH tartibida ochiladi. */
export function readSshdFiles(main = "/etc/ssh/sshd_config"): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const expand = (file: string, depth: number) => {
    if (depth > 4 || seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    let buf = "";
    for (const line of text.split("\n")) {
      const m = /^\s*Include\s+(.+)$/i.exec(line);
      if (!m) { buf += line + "\n"; continue; }
      out.push(buf); buf = "";
      for (const pat of m[1].trim().split(/\s+/)) {
        const abs = path.isAbsolute(pat) ? pat : path.join("/etc/ssh", pat);
        const g = /^(.*)\/\*(\.\w+)?$/.exec(abs);
        if (g) {
          let names: string[] = [];
          try { names = readdirSync(g[1]).filter((n) => !g[2] || n.endsWith(g[2])).sort(); } catch { /* papka yo'q */ }
          for (const n of names) { try { expand(path.join(g[1], n), depth + 1); } catch { /* o'qib bo'lmadi */ } }
        } else if (existsSync(abs)) {
          try { expand(abs, depth + 1); } catch { /* o'qib bo'lmadi */ }
        }
      }
    }
    out.push(buf);
  };
  expand(main, 0);
  return out;
}

export async function checkSshd(): Promise<Finding[]> {
  // Avval sshd -T (eng aniq; ko'pincha root talab qiladi), bo'lmasa fayllar
  for (const bin of ["/usr/sbin/sshd", "sshd"]) {
    const r = await run(bin, ["-T"], { timeoutMs: 5000 });
    if (r.ok && /permitrootlogin/i.test(r.stdout)) return [evaluateSshd(parseSshdT(r.stdout), "sshd -T")];
    if (!r.missing) break;
  }
  if (!existsSync("/etc/ssh/sshd_config")) return [unknown("sshd-config", "config", "SSH sozlamasi", "/etc/ssh/sshd_config yo'q")];
  try {
    return [evaluateSshd(parseSshdConfig(readSshdFiles()), "/etc/ssh/sshd_config (+ sshd_config.d)")];
  } catch (e) {
    return [unknown("sshd-config", "config", "SSH sozlamasi", `o'qib bo'lmadi: ${(e as Error).message.slice(0, 120)}`)];
  }
}

/* ═════════════════════════ 3. Firewall va fail2ban ═════════════════════════ */

export function evaluateFirewall(ufw: "active" | "inactive" | null, confEnabled: boolean | null, reason: string): Finding {
  if (ufw === "active") return finding("firewall", "config", "INFO", "Firewall (ufw) yoqilgan", { ufw });
  if (ufw === "inactive") return finding("firewall", "config", "HIGH", "Firewall (ufw) o'chirilgan — barcha portlar internetga ochiq bo'lishi mumkin", { ufw });
  // sudo ruxsati yo'q: ufw.conf dan bilvosita dalil
  if (confEnabled === false) return finding("firewall", "config", "HIGH", "Firewall (ufw) yoqilmagan (/etc/ufw/ufw.conf: ENABLED=no)", { ufw: "inactive", source: "ufw.conf" });
  if (confEnabled === true) return finding("firewall", "config", "INFO", "Firewall (ufw) yoqilgan deb sozlangan (ufw.conf); qoidalarni ko'rish uchun sudoers qatori kerak", { source: "ufw.conf", note: reason });
  return unknown("firewall", "config", "Firewall", reason, { hint: "docs/server-xavfsizlik.md — CyberSecurity agent: sudoers'ga `ufw status` qatori" });
}

export async function checkFirewall(): Promise<Finding[]> {
  let state: "active" | "inactive" | null = null;
  let reason = "";
  const direct = await run("ufw", ["status"], { timeoutMs: 8000 });
  state = parseUfwStatus(direct.stdout);
  if (!state) {
    const viaSudo = await run("sudo", ["-n", "ufw", "status"], { timeoutMs: 8000 });
    state = parseUfwStatus(viaSudo.stdout);
    if (!state) reason = direct.missing && viaSudo.missing ? "ufw yo'q" : `ufw status uchun root kerak, sudo -n ruxsat bermadi (${shortErr(viaSudo)})`;
  }
  let conf: boolean | null = null;
  if (!state) { try { conf = parseUfwConf(readFileSync("/etc/ufw/ufw.conf", "utf8")); } catch { /* ufw o'rnatilmagan */ } }

  const out = [evaluateFirewall(state, conf, reason || "ufw holati noma'lum")];
  const f2b = await run("systemctl", ["is-active", "fail2ban"], { timeoutMs: 5000 });
  if (f2b.missing) out.push(unknown("fail2ban", "config", "fail2ban", "systemctl yo'q (systemd emas)"));
  else if (f2b.stdout.trim() === "active") out.push(finding("fail2ban", "config", "INFO", "fail2ban ishlayapti", { state: "active" }));
  else out.push(finding("fail2ban", "config", "MEDIUM", "fail2ban o'rnatilmagan yoki ishlamayapti — SSH parol taxminiga avtomatik blok yo'q",
    { state: f2b.stdout.trim() || "unknown", fix: "sudo apt install -y fail2ban && sudo systemctl enable --now fail2ban (docs/server-xavfsizlik.md 3.2)" }));
  return out;
}

/* ═════════════════════════ 4. Tinglayotgan portlar ═════════════════════════ */

export function evaluatePorts(ls: Listener[]): Finding {
  const exposed = exposedListeners(ls);
  const detail = { listeners: ls.length, publicPorts: [...new Set(ls.filter((l) => l.public).map((l) => l.port))].sort((a, b) => a - b), exposed };
  if (!exposed.length) return finding("open-ports", "security", "INFO", "Portlar: internetga faqat 22/80/443 ochiq", detail);
  const internal = exposed.filter((e) => e.internal);
  const title = internal.length
    ? `Ichki xizmat internetga ochiq: ${internal.map((e) => e.port).join(", ")} (faqat 127.0.0.1 da tinglashi kerak)`
    : `Kutilmagan ochiq port: ${exposed.map((e) => e.port).join(", ")}`;
  return finding("open-ports", "security", "HIGH", title, detail);
}

export async function checkPorts(): Promise<Finding[]> {
  const r = await run("ss", ["-Htlnp"], { timeoutMs: 8000 });
  if (!r.ok) return [unknown("open-ports", "security", "Ochiq portlar", r.missing ? "ss yo'q (iproute2 — masalan macOS)" : shortErr(r))];
  return [evaluatePorts(parseSs(r.stdout))];
}

/* ═════════════════════════ 5. Sirlar gigiyenasi ═════════════════════════ */

export type SecretsInput = {
  files: { name: string; mode: number | null; owner?: number }[];
  rootEnvPresent: boolean;
  tenantEnvs: { name: string; authSecretLen: number | null; hasControlSecret: boolean }[];
};

export function evaluateSecrets(inp: SecretsInput): Finding[] {
  const out: Finding[] = [];
  const open = inp.files.filter((f) => f.mode != null && modeTooOpen(f.mode));
  const missing = inp.files.filter((f) => f.mode == null).map((f) => f.name);
  const permDetail = { checked: inp.files.filter((f) => f.mode != null).map((f) => ({ file: f.name, mode: fmtMode(f.mode!) })), missing, allowed: "600 / 640" };
  out.push(open.length
    ? finding("secret-perms", "config", "HIGH", `Sir fayllari ochiq: ${open.map((f) => `${f.name} (${fmtMode(f.mode!)})`).join(", ")}`,
        permDetail, [{ type: "FIX_SECRET_PERMS", label: "Sir fayllarini chmod 600 qilish" }])
    : finding("secret-perms", "config", "INFO", "Sir fayllari huquqi joyida (600/640)", permDetail));

  out.push(inp.rootEnvPresent
    ? finding("root-env", "config", "MEDIUM", "Ildizda .env hali bor — platformaga o'tish tugamagan (kalitlar har jarayonga yuklanishi mumkin)",
        { fix: "PLATFORMA.md 7-qadam: mv .env .env.pre-platform (keyin xavfsiz joyga ko'chirib o'chiring)" })
    : finding("root-env", "config", "INFO", "Ildizda .env yo'q", {}));

  const shortAuth = inp.tenantEnvs.filter((t) => t.authSecretLen != null && t.authSecretLen < 32).map((t) => t.name);
  const noAuth = inp.tenantEnvs.filter((t) => t.authSecretLen == null).map((t) => t.name);
  const ctlLeak = inp.tenantEnvs.filter((t) => t.hasControlSecret).map((t) => t.name);
  const keyDetail = { tenantEnvs: inp.tenantEnvs.length, shortAuthSecret: shortAuth, missingAuthSecret: noAuth, controlSecretInTenant: ctlLeak };
  if (ctlLeak.length || shortAuth.length || noAuth.length) {
    const parts = [
      ctlLeak.length ? `CONTROL_SECRET korxona faylida: ${ctlLeak.join(", ")} (barcha korxonalarning SSO kalitini hosil qiladi!)` : "",
      shortAuth.length ? `AUTH_SECRET 32 belgidan qisqa: ${shortAuth.join(", ")}` : "",
      noAuth.length ? `AUTH_SECRET yo'q: ${noAuth.join(", ")}` : "",
    ].filter(Boolean);
    out.push(finding("tenant-secrets", "config", "HIGH", parts.join("; "), keyDetail));
  } else {
    out.push(finding("tenant-secrets", "config", "INFO", `Korxona kalitlari joyida (${inp.tenantEnvs.length} ta fayl)`, keyDetail));
  }
  return out;
}

function modeOf(file: string): number | null {
  try { return statSync(file).mode; } catch { return null; }
}

export async function checkSecrets(ctx: SecurityCtx, backupEnv = process.env.INSOF_BACKUP_ENV || "/etc/insof/backup.env"): Promise<Finding[]> {
  if (!existsSync(ctx.appDir)) return [unknown("secret-perms", "config", "Sir fayllari", `${ctx.appDir} yo'q`)];
  const tenantsDir = path.join(ctx.appDir, "tenants");
  let tenantFiles: string[] = [];
  try { tenantFiles = readdirSync(tenantsDir).filter((n) => n.endsWith(".env")).sort(); } catch { /* papka yo'q */ }
  const files: SecretsInput["files"] = [
    { name: "control.env", mode: modeOf(path.join(ctx.appDir, "control.env")) },
    { name: "build.env", mode: modeOf(path.join(ctx.appDir, "build.env")) },
    ...tenantFiles.map((n) => ({ name: `tenants/${n}`, mode: modeOf(path.join(tenantsDir, n)) })),
    { name: backupEnv, mode: modeOf(backupEnv) },
  ];
  const tenantEnvs: SecretsInput["tenantEnvs"] = [];
  for (const n of tenantFiles) {
    try {
      const env = parseEnv(readFileSync(path.join(tenantsDir, n), "utf8"));
      // Qiymatning faqat UZUNLIGI olinadi; qiymat o'zi hech qayerga chiqmaydi
      const a = env.get("AUTH_SECRET");
      tenantEnvs.push({ name: `tenants/${n}`, authSecretLen: a ? a.length : null, hasControlSecret: !!env.get("CONTROL_SECRET") });
    } catch { /* o'qib bo'lmadi — huquq tekshiruvida ko'rinadi */ }
  }
  return evaluateSecrets({ files, rootEnvPresent: existsSync(path.join(ctx.appDir, ".env")), tenantEnvs });
}

/* ═════════════════════════ 6. HTTP xavfsizlik sarlavhalari ═════════════════════════ */

export const REQUIRED_HEADERS = ["strict-transport-security", "content-security-policy", "x-content-type-options"] as const;

export function evaluateHeaders(results: { url: string; missing: string[] | null; error?: string }[]): Finding {
  const bad = results.filter((r) => r.missing?.length);
  const errs = results.filter((r) => r.missing == null);
  const detail = { checked: results.map((r) => ({ url: r.url, missing: r.missing, error: r.error })) };
  if (!results.length) return unknown("http-headers", "security", "HTTP sarlavhalari", "tekshiriladigan domen yo'q");
  if (bad.length) {
    return finding("http-headers", "security", "MEDIUM",
      `Xavfsizlik sarlavhalari yetishmaydi: ${bad.map((b) => `${new URL(b.url).host} (${b.missing!.join(", ")})`).join("; ")}`, detail);
  }
  if (errs.length === results.length) return unknown("http-headers", "security", "HTTP sarlavhalari", errs[0].error ?? "javob yo'q", detail);
  return finding("http-headers", "security", "INFO", "Xavfsizlik sarlavhalari (HSTS, CSP, nosniff) joyida", detail);
}

export function headerTargets(ctx: SecurityCtx): string[] {
  const urls = ctx.tenants.filter((t) => t.domain && t.status === "ACTIVE").map((t) => `https://${t.domain}/login`);
  const admin = process.env.CONTROL_DOMAIN || (process.env.TENANT_BASE_DOMAIN ? `admin.${process.env.TENANT_BASE_DOMAIN}` : "");
  if (admin) urls.push(`https://${admin}/superadmin/login`);
  return [...new Set(urls)];
}

export async function checkHeaders(ctx: SecurityCtx, fetcher: typeof fetch = fetch, allow: (u: string) => boolean = () => true): Promise<Finding[]> {
  const targets = headerTargets(ctx).filter(allow);
  const results = await Promise.all(targets.map(async (url) => {
    try {
      const r = await fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "insof-agent/security" } });
      await r.body?.cancel().catch(() => {});
      return { url, missing: REQUIRED_HEADERS.filter((h) => !r.headers.get(h)) as string[] };
    } catch (e) {
      return { url, missing: null, error: (e as Error).message.slice(0, 120) };
    }
  }));
  return [evaluateHeaders(results)];
}

/* ═════════════════════════ 7. nginx access.log ═════════════════════════ */

/** Faylning oxiridan ~maxBytes o'qib, oxirgi `lines` qatorni qaytaradi (katta faylni to'liq o'qimaydi). */
export function tailFile(file: string, lines: number, maxBytes = 4 * 1024 * 1024): string {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    let text = buf.toString("utf8");
    if (len < size) text = text.slice(text.indexOf("\n") + 1); // kesilgan birinchi qator
    const arr = text.split("\n");
    return arr.slice(Math.max(0, arr.length - lines - 1)).join("\n");
  } finally {
    closeSync(fd);
  }
}

export function evaluateNginx(text: string): Finding[] {
  const s = summarizeNginx(parseNginxLog(text));
  const out: Finding[] = [];
  const base = { lines: s.total, from: s.from, to: s.to };
  const scanners = s.scanners.filter((x) => x.hits >= 3);
  if (scanners.length) {
    const actions: SuggestedAction[] = scanners.filter((x) => blockable(x.ip)).slice(0, 5).map((x) => blockIpAction(x.ip, `${x.hits} ta zaiflik qidiruvi`));
    out.push(finding("nginx-scanners", "security", "MEDIUM",
      `Zaiflik skanerlari: ${scanners.length} ta IP (/.env, /wp-admin, /.git ...) — ${scanners.reduce((a, x) => a + x.hits, 0)} so'rov`,
      { ...base, scanners }, actions));
  } else {
    out.push(finding("nginx-scanners", "security", "INFO", "nginx: sezilarli skaner faolligi yo'q", { ...base, scanners: s.scanners }));
  }
  const d = { ...base, s5xx: s.s5xx, rate5xxPct: Math.round(s.rate5xx * 1000) / 10, s4xx: s.s4xx, s429: s.s429, top4xx: s.top4xx };
  if (s.total >= 100 && s.rate5xx >= 0.05) out.push(finding("nginx-errors", "security", "MEDIUM", `nginx: 5xx ulushi ${d.rate5xxPct}% (${s.s5xx}/${s.total}) — ilova xato beryapti yoki ishlamayapti`, d));
  else if (s.s429 >= 100) out.push(finding("nginx-errors", "security", "LOW", `nginx: tezlik cheklovi ${s.s429} marta ishladi (429) — ko'p so'rov yuborayotgan IP bor`, d));
  else out.push(finding("nginx-errors", "security", "INFO", `nginx: oxirgi ${s.total} so'rov — 5xx ${d.rate5xxPct}%, 429: ${s.s429}`, d));
  return out;
}

export async function checkNginx(logFile = process.env.NGINX_ACCESS_LOG || "/var/log/nginx/access.log"): Promise<Finding[]> {
  if (!existsSync(logFile)) return [unknown("nginx-scanners", "security", "nginx jurnali", `${logFile} yo'q`)];
  try {
    return evaluateNginx(tailFile(logFile, 10_000));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return [unknown("nginx-scanners", "security", "nginx jurnali",
      code === "EACCES" ? `${logFile} ni o'qishga huquq yo'q — deploy'ni adm guruhiga qo'shing: sudo usermod -aG adm deploy` : (e as Error).message.slice(0, 120))];
  }
}

/* ═════════════════════════ 9. Tizim yangilanishlari ═════════════════════════ */

export function evaluateApt(text: string, rebootPkgs: string[] | null, cachedAt: number): Finding[] {
  const a = parseAptUpgradable(text);
  const detail = { upgradable: a.total, security: a.security, securityPkgs: a.securityPkgs, critical: a.critical, cachedAt: new Date(cachedAt).toISOString() };
  const out: Finding[] = [];
  if (a.security === 0) out.push(finding("os-updates", "update", "INFO", `Xavfsizlik yangilanishlari yo'q (jami ${a.total} ta oddiy yangilanish)`, detail));
  else {
    const sev: Severity = a.critical.length || a.security >= 10 ? "HIGH" : "MEDIUM";
    out.push(finding("os-updates", "update", sev,
      `${a.security} ta xavfsizlik yangilanishi kutilmoqda${a.critical.length ? ` (${a.critical.slice(0, 4).join(", ")})` : ""}`,
      { ...detail, fix: "sudo apt update && sudo apt upgrade (yoki unattended-upgrades — docs 3.3)" }));
  }
  out.push(rebootPkgs
    ? finding("reboot-required", "update", "LOW", "Server qayta ishga tushirishni kutmoqda (kernel/kutubxona yangilangan)", { pkgs: rebootPkgs.slice(0, 15) })
    : finding("reboot-required", "update", "INFO", "Qayta ishga tushirish kerak emas", {}));
  return out;
}

export async function checkApt(ctx: SecurityCtx): Promise<Finding[]> {
  let res: { value: string; cachedAt: number };
  try {
    res = await cached("apt-upgradable", 3600_000, ctx.now.getTime(), async () => {
      const r = await run("apt", ["list", "--upgradable"], { timeoutMs: 60_000 });
      if (!r.ok && !r.stdout) throw new Error(r.missing ? "apt yo'q (Debian/Ubuntu emas)" : shortErr(r));
      return r.stdout;
    });
  } catch (e) {
    return [unknown("os-updates", "update", "Tizim yangilanishlari", (e as Error).message)];
  }
  let reboot: string[] | null = null;
  if (existsSync("/var/run/reboot-required")) {
    try { reboot = readFileSync("/var/run/reboot-required.pkgs", "utf8").split("\n").filter(Boolean); } catch { reboot = []; }
  }
  return evaluateApt(res.value, reboot, res.cachedAt);
}

/* ═════════════════════════ 10. npm audit ═════════════════════════ */

export function evaluateAudit(a: AuditSummary | null, cachedAt: number): Finding[] {
  if (!a) return [unknown("npm-audit", "update", "npm audit", "npm audit natijasini o'qib bo'lmadi")];
  const out: Finding[] = [];
  const detail = { counts: a.counts, effective: a.effective, packages: a.packages, cachedAt: new Date(cachedAt).toISOString() };
  if (a.effective.critical) out.push(finding("npm-audit", "update", "CRITICAL", `npm audit: ${a.effective.critical} ta CRITICAL, ${a.effective.high} ta HIGH zaiflik (production paketlar)`, detail));
  else if (a.effective.high) out.push(finding("npm-audit", "update", "HIGH", `npm audit: ${a.effective.high} ta HIGH zaiflik (production paketlar)`, detail));
  else if (a.effective.moderate) out.push(finding("npm-audit", "update", "LOW", `npm audit: ${a.effective.moderate} ta o'rtacha zaiflik`, detail));
  else out.push(finding("npm-audit", "update", "INFO", "npm audit: production paketlarida jiddiy zaiflik yo'q", detail));
  if (a.accepted.length) {
    out.push(finding("npm-accepted-risk", "update", "LOW",
      `Qabul qilingan xavf: ${a.accepted.map((x) => `${x.name} (${x.severity})`).join(", ")} — ataylab qotirilgan`,
      { accepted: a.accepted, mitigation: a.accepted.map((x) => ACCEPTED_RISK[x.name]).filter(Boolean) }));
  }
  return out;
}

export async function checkNpmAudit(ctx: SecurityCtx): Promise<Finding[]> {
  const dir = path.join(ctx.appDir, "current");
  if (!existsSync(path.join(dir, "package-lock.json"))) return [unknown("npm-audit", "update", "npm audit", `${dir}/package-lock.json yo'q`)];
  try {
    const res = await cached("npm-audit", 24 * 3600_000, ctx.now.getTime(), async () => {
      // `npm audit` zaiflik topsa 1 qaytaradi — stdout JSON baribir to'liq
      const r = await run("npm", ["audit", "--omit=dev", "--json"], { cwd: dir, timeoutMs: 120_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
      const parsed = parseNpmAudit(r.stdout);
      if (!parsed) throw new Error(r.missing ? "npm yo'q" : `npm audit: ${shortErr(r)}`);
      return parsed;
    });
    return evaluateAudit(res.value, res.cachedAt);
  } catch (e) {
    return [unknown("npm-audit", "update", "npm audit", (e as Error).message)];
  }
}
