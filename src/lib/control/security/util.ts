import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkKey } from "../monitor/contract";
import type { Finding, Severity, SuggestedAction } from "./types";

export const SEV_RANK: Record<Severity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export const maxSev = (a: Severity, b: Severity): Severity => (SEV_RANK[a] >= SEV_RANK[b] ? a : b);

export function finding(
  name: string,
  category: Finding["category"],
  severity: Severity,
  title: string,
  detail: Record<string, unknown> = {},
  suggestedActions?: SuggestedAction[],
): Finding {
  const status = detail.status ?? (severity === "INFO" ? "OK" : "WARN");
  return { key: checkKey.security(name), category, severity, title, detail: { ...detail, status }, ...(suggestedActions?.length ? { suggestedActions } : {}) };
}

/** Tekshirib bo'lmadi: vosita/fayl yo'q yoki huquq yetmadi. Hodisa ochmaydi (INFO), sababi aniq yoziladi. */
export function unknown(name: string, category: Finding["category"], title: string, reason: string, extra: Record<string, unknown> = {}): Finding {
  return finding(name, category, "INFO", `${title}: tekshirib bo'lmadi`, { ...extra, status: "UNKNOWN", reason });
}

export function blockIpAction(ip: string, why: string): SuggestedAction {
  return { type: "BLOCK_IP", params: { ip }, label: `${ip} ni bloklash (${why})` };
}

/** Promise'ga vaqt chegarasi (har tekshiruv alohida — bittasi osilib qolsa boshqalar ishlayveradi). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: ${Math.round(ms / 1000)} s da tugamadi`)), ms); }),
  ]);
}

/* ───────── Kesh (apt — soatiga, npm audit — kuniga bir marta) ───────── */

type CacheEntry<T> = { at: number; value: T };
const mem = new Map<string, CacheEntry<unknown>>();

function cacheDir(): string | null {
  const d = process.env.INSOF_SECURITY_CACHE_DIR || path.join(os.tmpdir(), "insof-security-cache");
  try { mkdirSync(d, { recursive: true, mode: 0o700 }); return d; } catch { return null; }
}

/** Xotirada + (yozish mumkin bo'lsa) faylda kesh: agent qayta ishga tushsa ham apt/npm har safar yugurmaydi. */
export async function cached<T>(key: string, ttlMs: number, now: number, fn: () => Promise<T>): Promise<{ value: T; cachedAt: number; fromCache: boolean }> {
  const m = mem.get(key) as CacheEntry<T> | undefined;
  if (m && now - m.at < ttlMs) return { value: m.value, cachedAt: m.at, fromCache: true };
  const dir = cacheDir();
  const file = dir ? path.join(dir, `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`) : null;
  if (file) {
    try {
      const e = JSON.parse(readFileSync(file, "utf8")) as CacheEntry<T>;
      if (typeof e.at === "number" && now - e.at < ttlMs && e.at <= now) { mem.set(key, e); return { value: e.value, cachedAt: e.at, fromCache: true }; }
    } catch { /* kesh yo'q */ }
  }
  const value = await fn();
  const e = { at: now, value };
  mem.set(key, e);
  if (file) { try { writeFileSync(file, JSON.stringify(e), { mode: 0o600 }); } catch { /* yozib bo'lmadi — faqat xotirada */ } }
  return { value, cachedAt: now, fromCache: false };
}

/** Xato matnining mazmunli qatori (Prisma xabari "\nInvalid ... invocation" bilan boshlanadi — sabab oxirgi qatorda). */
export function errMsg(e: unknown, max = 160): string {
  const lines = String((e as Error)?.message ?? e).split("\n").map((l) => l.trim()).filter(Boolean);
  const line = /^Invalid `/.test(lines[0] ?? "") ? lines.at(-1)! : lines[0];
  return (line || "noma'lum xato").slice(0, max);
}

/** Faqat testlar uchun */
export function _clearCache() { mem.clear(); }
