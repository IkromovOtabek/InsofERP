/**
 * nginx access.log / error.log parserlari va oqimli agregator (sof: fayl o'qish scripts/agent/dbtraffic.ts da).
 *
 * access.log: standart `combined` formati, ixtiyoriy ravishda boshida `vhost_combined` dagi `host:port`, oxirida
 * `insof_main` formatining qo'shimchalari (docs/deploy/nginx-log.conf):  host=$host rt=$request_time urt="$upstream_response_time"
 * Shaxsiy ma'lumot saqlanmaydi: so'rov satri (query string) tashlanadi, yo'ldagi id/raqam/uuid → :id, user-agent va referer olinmaydi.
 */
import { IPV4_RE } from "../monitor/contract";
import { DBT_THRESHOLDS, DOMAIN_RE } from "./contract";

const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "06/Oct/2026:12:00:00 +0500" → ms */
export function parseNginxTime(s: string): number | null {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s);
  if (!m || MON[m[2]] === undefined) return null;
  const utc = Date.UTC(+m[3], MON[m[2]], +m[1], +m[4], +m[5], +m[6]);
  const off = (m[7] === "-" ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60_000;
  return utc - off;
}

export type AccessRec = {
  t: number; ip: string; method: string; path: string; status: number; bytes: number;
  host: string | null; rt: number | null; urt: number | null;
};

const ACCESS_RE = /^(?:([A-Za-z0-9.-]*[A-Za-z][A-Za-z0-9.-]*):\d+ )?(\S+) \S+ \S+ \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}) (\d+|-)(?: "(?:[^"\\]|\\.)*" "(?:[^"\\]|\\.)*")?(.*)$/;

export function parseAccessLine(line: string): AccessRec | null {
  if (line.length > 16_384) return null;
  const m = ACCESS_RE.exec(line);
  if (!m) return null;
  const t = parseNginxTime(m[3]);
  if (t == null) return null;
  const req = m[4];
  const rm = /^([A-Z]{3,10}) (\S+)(?: HTTP\/[\d.]+)?$/.exec(req);
  const extra = m[7] ?? "";
  const hostX = /(?:^|\s)host=(\S+)/.exec(extra)?.[1];
  const rt = /(?:^|\s)rt=([\d.]+)/.exec(extra)?.[1];
  const urt = /(?:^|\s)urt="?([\d.]+)/.exec(extra)?.[1];
  const host = normHost(hostX ?? m[1] ?? null);
  return {
    t, ip: m[2], method: rm ? rm[1] : "-", path: rm ? normalizePath(rm[2]) : "(noto'g'ri so'rov)",
    status: Number(m[5]), bytes: m[6] === "-" ? 0 : Number(m[6]),
    host, rt: rt != null && Number.isFinite(+rt) ? +rt : null, urt: urt != null && Number.isFinite(+urt) ? +urt : null,
  };
}

export function normHost(h: string | null | undefined): string | null {
  if (!h || h === "-" || h === "_") return null;
  const v = h.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return DOMAIN_RE.test(v) ? v : null;
}

const ID_SEG = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^c[a-z0-9]{20,32}$/, // cuid
  /^[0-9a-f]{16,}$/i,
  /^(?=.*\d)[A-Za-z0-9_-]{16,}$/, // token/id ko'rinishidagi uzun bo'lak
];

/** Yo'lni guruhlash: query string tashlanadi, id/raqam/uuid → :id, statik fayllar bitta guruh. */
export function normalizePath(raw: string): string {
  let p = raw;
  if (/^https?:\/\//i.test(p)) { try { p = new URL(p).pathname; } catch { return "(noto'g'ri yo'l)"; } }
  p = p.split(/[?#]/)[0] || "/";
  if (!p.startsWith("/")) return "(noto'g'ri yo'l)";
  if (p.startsWith("/_next/static/")) return "/_next/static/*";
  if (p.startsWith("/_next/image")) return "/_next/image";
  let segs: string[];
  try { segs = p.split("/").map((s) => (s ? decodeURIComponent(s) : s)); } catch { segs = p.split("/"); }
  segs = segs.map((s) => (s && ID_SEG.some((r) => r.test(s)) ? ":id" : s.length > 40 ? ":long" : s));
  let out = segs.slice(0, 7).join("/") + (segs.length > 7 ? "/…" : "");
  out = out.replace(/[^\x20-\x7eЀ-ӿ]/g, "?");
  return out.length > 120 ? out.slice(0, 119) + "…" : out;
}

/* ───────────────────────── error.log ───────────────────────── */

export type ErrorRec = {
  t: number; level: string;
  kind: "upstream" | "limit" | "other";
  /** upstream: refused | timeout | nolive | closed | other */
  sub: string | null;
  zone: string | null;
  domain: string | null;
  upstream: string | null;
  client: string | null;
  head: string;
};

/** error.log vaqti: "2026/10/06 12:00:00" — server mahalliy vaqti (agent ham shu serverda, bir xil TZ). */
export function parseErrorLine(line: string): ErrorRec | null {
  if (line.length > 16_384) return null;
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \[(\w+)\] \d+#\d+: (?:\*\d+ )?(.*)$/.exec(line);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  const msg = m[8];
  const head = msg.split(/, client: /)[0].slice(0, 160);
  const client = /, client: ([^,\s]+)/.exec(msg)?.[1] ?? null;
  const server = /, server: ([^,\s]*)/.exec(msg)?.[1] ?? null;
  const hostH = /, host: "([^"]*)"/.exec(msg)?.[1] ?? null;
  const upUrl = /, upstream: "([^"]*)"/.exec(msg)?.[1] ?? null;
  let upstream: string | null = null;
  if (upUrl) {
    const u = /^[a-z]+:\/\/([^/]+)/i.exec(upUrl)?.[1] ?? null;
    upstream = u && /^[A-Za-z0-9.:[\]_-]{1,80}$/.test(u) ? u : null;
  }
  const domain = normHost(hostH) ?? normHost(server);
  const lim = /limiting requests, excess: [\d.]+ by zone "([A-Za-z0-9_]{1,40})"/.exec(msg);
  if (lim) return { t, level: m[7], kind: "limit", sub: null, zone: lim[1], domain, upstream: null, client, head: `limiting requests (${lim[1]})` };
  const isUp = /upstream/i.test(head) || !!upUrl;
  if (isUp) {
    const sub = /Connection refused/i.test(head) ? "refused"
      : /timed out/i.test(head) ? "timeout"
        : /no live upstreams/i.test(head) ? "nolive"
          : /prematurely closed|reset by peer/i.test(head) ? "closed" : "other";
    return { t, level: m[7], kind: "upstream", sub, zone: null, domain, upstream, client, head };
  }
  return { t, level: m[7], kind: "other", sub: null, zone: null, domain, upstream: null, client, head };
}

/* ───────────────────────── Agregator ───────────────────────── */

type Win = { total: number; s2: number; s3: number; s4: number; s5: number; s429: number; bytes: number };
const win = (): Win => ({ total: 0, s2: 0, s3: 0, s4: 0, s5: 0, s429: 0, bytes: 0 });
function addWin(w: Win, r: AccessRec) {
  w.total++; w.bytes += r.bytes;
  const c = Math.floor(r.status / 100);
  if (c === 2) w.s2++; else if (c === 3) w.s3++; else if (c === 4) w.s4++; else if (c === 5) w.s5++;
  if (r.status === 429) w.s429++;
}

type DomainAcc = { w5: Win; w60: Win; rtSum: number; rtN: number };
type IpAcc = { n: number; n5: number; e4: number; e5: number; r429: number; last: number; paths: Map<string, number> };
type PathAcc = { n: number; e5: number; rtSum: number; rtN: number; rtMax: number };
type UpAcc = { n5: number; n60: number; refused5: number; subs: Record<string, number>; upstreams: Record<string, number>; last: number; head: string };

const MAX_IPS = 20_000;
const MAX_PATHS = 5_000;

export type TrafficData = {
  windowMin: { short: 5; long: 60 };
  generatedAt: string;
  source: { access: string; error: string; accessLines: number; errorLines: number; parsedOk: number; parseFail: number; truncated: boolean; problems: string[] };
  format: { hasHost: boolean; hasRequestTime: boolean };
  w5: Win & { perMin: number; pct4xx: number | null; pct5xx: number | null };
  w60: Win & { perMin: number; pct4xx: number | null; pct5xx: number | null };
  /** daqiqalik qatorlar (eskidan yangiga, 60 ta): so'rovlar va 5xx */
  perMinute: { t: number; n: number; e5: number }[];
  domains: { domain: string; perMin5: number; perMin60: number; total60: number; pct4xx: number | null; pct5xx: number | null; s429: number; avgRtMs: number | null }[];
  topIps: { ip: string; n: number; n5: number; e4: number; e5: number; r429: number; last: string; topPath: string | null }[];
  ipOverflow: number;
  slowPaths: { path: string; n: number; avgMs: number; maxMs: number; e5: number }[];
  limitZones: { zone: string; n5: number; n60: number }[];
  upstream: { domain: string; n5: number; n60: number; refused5: number; subs: Record<string, number>; upstreams: { addr: string; n: number }[]; last: string; head: string }[];
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export class TrafficAgg {
  readonly since5: number;
  readonly since60: number;
  private w5 = win();
  private w60 = win();
  private perMin = new Map<number, { n: number; e5: number }>();
  private domains = new Map<string, DomainAcc>();
  private ips = new Map<string, IpAcc>();
  private ipOverflow = 0;
  private paths = new Map<string, PathAcc>();
  private limits = new Map<string, { n5: number; n60: number }>();
  private ups = new Map<string, UpAcc>();
  hasHost = false;
  hasRt = false;
  parsedOk = 0;
  parseFail = 0;

  constructor(readonly now: number) {
    this.since5 = now - 5 * 60_000;
    this.since60 = now - 60 * 60_000;
  }

  /** Bitta access qatori. Qaytaradi: oynadan eski bo'lsa false (o'quvchi to'xtashi mumkin). */
  access(r: AccessRec): boolean {
    if (r.t < this.since60) return false;
    if (r.t > this.now + 120_000) return true;
    const short = r.t >= this.since5;
    addWin(this.w60, r);
    if (short) addWin(this.w5, r);
    const minute = Math.floor(r.t / 60_000);
    const pm = this.perMin.get(minute) ?? { n: 0, e5: 0 };
    pm.n++; if (r.status >= 500) pm.e5++;
    this.perMin.set(minute, pm);
    if (r.host) this.hasHost = true;
    if (r.rt != null) this.hasRt = true;
    const dk = r.host ?? "(noma'lum)";
    let d = this.domains.get(dk);
    if (!d) { d = { w5: win(), w60: win(), rtSum: 0, rtN: 0 }; this.domains.set(dk, d); }
    addWin(d.w60, r); if (short) addWin(d.w5, r);
    if (r.rt != null) { d.rtSum += r.rt; d.rtN++; }

    let ip = this.ips.get(r.ip);
    if (!ip) {
      if (this.ips.size >= MAX_IPS) this.ipOverflow++;
      else { ip = { n: 0, n5: 0, e4: 0, e5: 0, r429: 0, last: 0, paths: new Map() }; this.ips.set(r.ip, ip); }
    }
    if (ip) {
      ip.n++; if (short) ip.n5++;
      if (r.status >= 400 && r.status < 500) ip.e4++;
      if (r.status >= 500) ip.e5++;
      if (r.status === 429) ip.r429++;
      if (r.t > ip.last) ip.last = r.t;
      if (ip.paths.size < 50 || ip.paths.has(r.path)) ip.paths.set(r.path, (ip.paths.get(r.path) ?? 0) + 1);
    }

    const pk = `${r.method} ${r.path}`;
    let p = this.paths.get(pk);
    if (!p && this.paths.size < MAX_PATHS) { p = { n: 0, e5: 0, rtSum: 0, rtN: 0, rtMax: 0 }; this.paths.set(pk, p); }
    if (p) {
      p.n++; if (r.status >= 500) p.e5++;
      if (r.rt != null) { p.rtSum += r.rt; p.rtN++; if (r.rt > p.rtMax) p.rtMax = r.rt; }
    }
    return true;
  }

  error(e: ErrorRec): boolean {
    if (e.t < this.since60) return false;
    const short = e.t >= this.since5;
    if (e.kind === "limit" && e.zone) {
      const l = this.limits.get(e.zone) ?? { n5: 0, n60: 0 };
      l.n60++; if (short) l.n5++;
      this.limits.set(e.zone, l);
    } else if (e.kind === "upstream") {
      const dk = e.domain ?? "(noma'lum)";
      let u = this.ups.get(dk);
      if (!u) { u = { n5: 0, n60: 0, refused5: 0, subs: {}, upstreams: {}, last: 0, head: "" }; this.ups.set(dk, u); }
      u.n60++;
      if (short) { u.n5++; if (e.sub === "refused") u.refused5++; }
      const sub = e.sub ?? "other";
      u.subs[sub] = (u.subs[sub] ?? 0) + 1;
      if (e.upstream && (Object.keys(u.upstreams).length < 10 || e.upstream in u.upstreams)) u.upstreams[e.upstream] = (u.upstreams[e.upstream] ?? 0) + 1;
      if (e.t >= u.last) { u.last = e.t; u.head = e.head; }
    }
    return true;
  }

  result(source: Omit<TrafficData["source"], "parsedOk" | "parseFail">): TrafficData {
    const fin = (w: Win, minutes: number) => ({ ...w, perMin: Math.round((w.total / minutes) * 10) / 10, pct4xx: pct(w.s4, w.total), pct5xx: pct(w.s5, w.total) });
    const firstMin = Math.floor(this.since60 / 60_000) + 1;
    const perMinute: TrafficData["perMinute"] = [];
    for (let m = firstMin; m <= Math.floor(this.now / 60_000); m++) {
      const v = this.perMin.get(m) ?? { n: 0, e5: 0 };
      perMinute.push({ t: m * 60_000, n: v.n, e5: v.e5 });
    }
    const domains = [...this.domains].map(([domain, d]) => ({
      domain, perMin5: Math.round((d.w5.total / 5) * 10) / 10, perMin60: Math.round((d.w60.total / 60) * 10) / 10, total60: d.w60.total,
      pct4xx: pct(d.w60.s4, d.w60.total), pct5xx: pct(d.w60.s5, d.w60.total), s429: d.w60.s429,
      avgRtMs: d.rtN ? Math.round((d.rtSum / d.rtN) * 1000) : null,
    })).sort((a, b) => b.total60 - a.total60).slice(0, 30);
    const topIps = [...this.ips].sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([ip, v]) => {
      let top: string | null = null, best = 0;
      for (const [p, n] of v.paths) if (n > best) { best = n; top = p; }
      return { ip, n: v.n, n5: v.n5, e4: v.e4, e5: v.e5, r429: v.r429, last: new Date(v.last).toISOString(), topPath: top };
    });
    const slowPaths = [...this.paths].filter(([, p]) => p.rtN >= 3)
      .map(([path, p]) => ({ path, n: p.n, avgMs: Math.round((p.rtSum / p.rtN) * 1000), maxMs: Math.round(p.rtMax * 1000), e5: p.e5 }))
      .sort((a, b) => b.avgMs - a.avgMs).slice(0, 10);
    const limitZones = [...this.limits].map(([zone, v]) => ({ zone, ...v })).sort((a, b) => b.n60 - a.n60);
    const upstream = [...this.ups].map(([domain, u]) => ({
      domain, n5: u.n5, n60: u.n60, refused5: u.refused5, subs: u.subs,
      upstreams: Object.entries(u.upstreams).map(([addr, n]) => ({ addr, n })).sort((a, b) => b.n - a.n),
      last: new Date(u.last).toISOString(), head: u.head,
    })).sort((a, b) => b.n5 - a.n5 || b.n60 - a.n60);
    return {
      windowMin: { short: 5, long: 60 }, generatedAt: new Date(this.now).toISOString(),
      source: { ...source, parsedOk: this.parsedOk, parseFail: this.parseFail },
      format: { hasHost: this.hasHost, hasRequestTime: this.hasRt },
      w5: fin(this.w5, 5), w60: fin(this.w60, 60), perMinute, domains, topIps, ipOverflow: this.ipOverflow, slowPaths, limitZones, upstream,
    };
  }
}

/* ───────────────────────── Holat ───────────────────────── */

type St = "OK" | "WARN" | "CRIT" | "UNKNOWN";

/** Umumiy trafik: 5xx ulushi (oxirgi 5 daq, kamida minRequests so'rov bo'lsa). */
export function trafficStatus(d: Pick<TrafficData, "w5">): St {
  const t = DBT_THRESHOLDS;
  if (d.w5.total < t.minRequests || d.w5.pct5xx == null) return "OK";
  if (d.w5.pct5xx >= t.err5xxPct.crit) return "CRIT";
  if (d.w5.pct5xx >= t.err5xxPct.warn) return "WARN";
  return "OK";
}

/** Domen upstream xatolari (5 daq): "Connection refused" ko'p bo'lsa — xizmat ishlamayapti (CRIT). */
export function upstreamStatus(u: { n5: number; refused5: number }): St {
  const t = DBT_THRESHOLDS;
  if (u.refused5 >= t.upstreamRefusedCrit || u.n5 >= t.upstream5m.crit) return "CRIT";
  if (u.n5 >= t.upstream5m.warn) return "WARN";
  return "OK";
}

export const isIpv4 = (s: string) => IPV4_RE.test(s);
