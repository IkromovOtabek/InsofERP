/**
 * Infra: sof (side-effect'siz) parserlar va hisoblar — scripts/qa/d-infra.mts sinaydi.
 * Fayl/jarayon bilan ishlash scripts/agent/infra.ts da.
 */
import { KEEP_RELEASES, type DiskForecast, type RunLog } from "./contract";

const TS_RE = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/;

/** server-backup.sh / restore-test.sh log qatoridagi vaqt ([YYYY-MM-DD HH:MM:SS], server mahalliy vaqti). */
export function logLineTime(line: string): string | null {
  const m = TS_RE.exec(line);
  return m ? `${m[1]}T${m[2]}` : null;
}

/**
 * Log faylining oxiridan oxirgi ishga tushishni ajratadi. Har ishga tushish yakuniy qator bilan tugaydi:
 * `ok` — muvaffaqiyat, `fail` — xato. Oldingi yakuniy qatordan keyingi qatorlar — shu ishga tushish.
 * Yakuniy qator topilmasa (ishlayapti yoki log bo'sh) — UNKNOWN, oxirgi qatorlar bilan.
 */
export function lastRun(text: string, ok: RegExp, fail: RegExp, maxTail = 40): RunLog {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const isEnd = (l: string) => ok.test(l) || fail.test(l);
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (isEnd(lines[i])) { end = i; break; }
  if (end < 0) return { status: "UNKNOWN", at: lines.length ? logLineTime(lines[lines.length - 1]) : null, summary: lines.at(-1) ?? null, tail: lines.slice(-maxTail) };
  let start = 0;
  for (let i = end - 1; i >= 0; i--) if (isEnd(lines[i])) { start = i + 1; break; }
  const run = lines.slice(start, end + 1);
  return {
    status: ok.test(lines[end]) ? "OK" : "FAILED",
    at: logLineTime(lines[end]),
    summary: lines[end].slice(0, 300),
    tail: run.slice(-maxTail).map((l) => l.slice(0, 400)),
  };
}

export const BACKUP_OK_RE = /✓ Zaxira nusxa tugadi/;
export const BACKUP_FAIL_RE = /✗ Zaxira nusxa XATO|Boshqa zaxira jarayoni ishlayapti/;
export const RESTORE_OK_RE = /✓ Barcha dump'lar tiklandi/;
export const RESTORE_FAIL_RE = /✗ Tiklash sinovi XATO/;

/** Zaxira papkasi nomi (YYYY-MM-DD_HHMM[-n]) → ISO mahalliy vaqt. */
export function stampToIso(name: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00` : null;
}

/** /etc/os-release → PRETTY_NAME. */
export function parseOsRelease(text: string): string | null {
  const m = /^PRETTY_NAME=(?:"([^"]*)"|(.*))$/m.exec(text);
  return (m?.[1] ?? m?.[2] ?? "").trim() || null;
}

/** Yadro versiyalarini solishtirish (5.15.0-122-generic > 5.15.0-91-generic). */
export function compareKernel(a: string, b: string): number {
  const pa = a.split(/[.-]/), pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "", y = pb[i] ?? "";
    const nx = Number(x), ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "" ? nx - ny : x.localeCompare(y);
    if (c !== 0) return c > 0 ? 1 : -1;
  }
  return 0;
}

/** /boot fayllari → eng yangi yadro; ishlayotgandan yangi bo'lsa qaytaradi (kutilayotgan yadro), aks holda null. */
export function pendingKernel(bootFiles: string[], running: string): string | null {
  const vers = bootFiles.map((f) => /^vmlinuz-(.+)$/.exec(f)?.[1]).filter((v): v is string => !!v && !v.endsWith(".old"));
  if (!vers.length) return null;
  const newest = vers.sort(compareKernel).at(-1)!;
  return compareKernel(newest, running) > 0 ? newest : null;
}

/** `journalctl --disk-usage` → bayt ("Archived and active journals take up 1.2G in the file system."). */
export function parseJournalDiskUsage(text: string): number | null {
  const m = /take up ([\d.]+)\s*([KMGTP]?)B?\b/i.exec(text);
  if (!m) return null;
  const mult: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 };
  return Math.round(Number(m[1]) * (mult[m[2].toUpperCase()] ?? 1));
}

/** `du -sb a b c` → { yo'l: bayt } (ruxsat xatolari qatorlari tashlanadi). */
export function parseDu(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^(\d+)\s+(\/.*)$/.exec(line.trim());
    if (m) out.set(m[2], Number(m[1]));
  }
  return out;
}

/** /run/systemd/shutdown/scheduled (USEC=..., MODE=reboot) → vaqt va rejim. */
export function parseShutdownScheduled(text: string): { at: string; mode: string } | null {
  const usec = /^USEC=(\d+)$/m.exec(text)?.[1];
  if (!usec) return null;
  const mode = /^MODE=(\S+)$/m.exec(text)?.[1] ?? "unknown";
  const ms = Number(BigInt(usec) / 1000n);
  return Number.isFinite(ms) ? { at: new Date(ms).toISOString(), mode } : null;
}

/** /etc/apt/apt.conf.d/20auto-upgrades → Unattended-Upgrade yoqilganmi. */
export function parseAutoUpgrades(text: string): boolean | null {
  const m = /APT::Periodic::Unattended-Upgrade\s+"(\d+)"/.exec(text);
  return m ? m[1] !== "0" : null;
}

/** `rclone lsf --dirs-only` → zaxira papkalari (YYYY-MM-DD_HHMM), saralangan. */
export function parseRcloneLsf(text: string): string[] {
  return text.split("\n").map((l) => l.trim().replace(/\/$/, "")).filter((n) => /^20\d{2}-\d{2}-\d{2}_\d{4}(-\d+)?$/.test(n)).sort();
}

/** `rclone about --json` → hajm (bayt). Ba'zi masofalar (S3) about'ni qo'llamaydi — null. */
export function parseRcloneAbout(text: string): { total: number | null; used: number | null; free: number | null; trashed: number | null } | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const r = { total: n(j.total), used: n(j.used), free: n(j.free), trashed: n(j.trashed) };
    return r.total == null && r.used == null && r.free == null ? null : r;
  } catch { return null; }
}

/**
 * Disk prognozi: hozirgi bo'sh joy, nusxalarning barqaror hajmi (KEEP_DAYS × o'rtacha) va disk o'sish sur'ati
 * (HostSnapshot: eng eski va eng yangi nuqta, kamida 12 soat oralig'i bo'lsa).
 */
export function forecastDisk(input: {
  mount: string; total: number; used: number; avail: number;
  copies: { bytes: number }[]; keepDays: number;
  history: { at: number; used: number }[];
}): DiskForecast {
  const backupsBytes = input.copies.reduce((s, c) => s + c.bytes, 0);
  const recent = input.copies.slice(0, 7);
  const avg = recent.length ? Math.round(recent.reduce((s, c) => s + c.bytes, 0) / recent.length) : null;
  const steady = avg != null ? avg * input.keepDays : null;
  const pct = input.used + input.avail > 0 ? Math.round((input.used / (input.used + input.avail)) * 1000) / 10 : null;
  let growth: number | null = null, sampleDays: number | null = null;
  const h = [...input.history].sort((a, b) => a.at - b.at);
  if (h.length >= 2) {
    const span = (h[h.length - 1].at - h[0].at) / 864e5;
    if (span >= 0.5) { growth = Math.round((h[h.length - 1].used - h[0].used) / span); sampleDays = Math.round(span * 10) / 10; }
  }
  // Nusxalar barqaror holatga yetguncha qo'shimcha egallaydigan joy ham hisobga olinadi
  const extra = steady != null ? Math.max(0, steady - backupsBytes) : 0;
  const availAfter = input.avail - extra;
  let daysToFull: number | null = null;
  if (availAfter <= 0) daysToFull = 0;
  else if (growth != null && growth > 0) daysToFull = Math.round((availAfter / growth) * 10) / 10;
  return {
    mount: input.mount, total: input.total, used: input.used, avail: input.avail, pct,
    backupsBytes, avgCopyBytes: avg, keepDays: input.keepDays, steadyStateBytes: steady,
    growthPerDay: growth, daysToFull, sampleDays,
  };
}

/**
 * CLEAN_RELEASES: o'chiriladigan relizlar. Eng yangi `keep` tasi (mtime) va current saqlanadi;
 * `.tmp` (deploy build jarayoni) — faqat 2 soatdan eski bo'lsa.
 */
export function releasesToClean(list: { name: string; mtimeMs: number }[], current: string | null, now: number, keep = KEEP_RELEASES): string[] {
  const full = list.filter((r) => !r.name.endsWith(".tmp")).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = new Set(full.slice(0, keep).map((r) => r.name));
  if (current) kept.add(current);
  const del = full.filter((r) => !kept.has(r.name)).map((r) => r.name);
  const tmp = list.filter((r) => r.name.endsWith(".tmp") && now - r.mtimeMs > 2 * 3600_000).map((r) => r.name);
  return [...del, ...tmp];
}

/** Reliz papka nomi (git sha yoki shunga o'xshash) — o'chirishdan oldin qat'iy tekshiruv. */
export const RELEASE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/** `insof-tenant-up` yakuniy qatori: "RESULT systemd=active health=200 nginx=ok certbot=ok". */
export function parseTenantUpResult(text: string): Record<string, string> | null {
  const line = text.split("\n").reverse().find((l) => l.startsWith("RESULT "));
  if (!line) return null;
  const out: Record<string, string> = {};
  for (const m of line.slice(7).matchAll(/([a-z]+)=(\S+)/g)) out[m[1]] = m[2];
  return out;
}
