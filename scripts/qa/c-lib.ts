/**
 * QA (C) — mobil API va integratsiyalar testlari uchun umumiy yordamchilar.
 * Faqat lokal test serveri (BASE, standart http://localhost:3203) va insof_test… bazasi bilan ishlaydi.
 *
 *   npx tsx scripts/qa/c-<nom>.ts
 */
import { loadEnv } from "../env";
loadEnv();
import { isTestDbUrl } from "@/lib/test-mode";

if (!isTestDbUrl(process.env.DATABASE_URL)) {
  console.error("QA: DATABASE_URL lokal insof_test… bazasi emas — to'xtatildi");
  process.exit(2);
}

export const BASE = process.env.QA_BASE ?? "http://localhost:3203";
export const PASSWORD = "Test2026";

let pass = 0, fail = 0;
const failures: string[] = [];

export function check(name: string, ok: boolean, info?: unknown) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${info !== undefined ? ` — ${typeof info === "string" ? info : JSON.stringify(info).slice(0, 200)}` : ""}`); }
}

export function section(t: string) { console.log(`\n── ${t}`); }

export function done(): never {
  console.log(`\nNatija: ${pass} o'tdi, ${fail} yiqildi`);
  if (failures.length) console.log("Yiqilganlar:\n  - " + failures.join("\n  - "));
  process.exit(fail ? 1 : 0);
}

export type Res = { status: number; json: any; text: string; headers: Headers }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Har bir so'rov o'z IP'si bilan — login-guard qulflari testlar orasida aralashmasin. */
let ipSeq = 0;
export const freshIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

export async function api(method: string, path: string, opts: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string>; ip?: string; cookie?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? freshIp(), ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: string | undefined;
  if (opts.raw !== undefined) body = opts.raw;
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  const r = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("spreadsheet")) {
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, json: buf, text: "", headers: r.headers };
  }
  const text = await r.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* matn */ }
  return { status: r.status, json, text, headers: r.headers };
}

const tokens = new Map<string, { accessToken: string; refreshToken: string }>();

/** test.<rol> sifatida mobil kirish (natija keshlanadi). */
export async function login(loginName: string) {
  const c = tokens.get(loginName);
  if (c) return c;
  const r = await api("POST", "/api/mobile/auth/login", { body: { login: loginName, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${loginName}: ${r.status} ${r.text}`);
  tokens.set(loginName, r.json);
  return r.json as { accessToken: string; refreshToken: string };
}
export const tok = async (l: string) => (await login(l)).accessToken;
export const forgetToken = (l: string) => tokens.delete(l);

/** Veb sessiya cookie'si (getSession bilan himoyalangan /api/geo, /api/ai uchun) — lib/auth.ts issueSession bilan bir xil. */
export async function webCookie(user: { id: string; login: string; fullName: string; role: string; sessionVersion: number }) {
  const { SignJWT } = await import("jose");
  const t = await new SignJWT({ userId: user.id, login: user.login, fullName: user.fullName, role: user.role, sv: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" }).setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET!.trim()));
  return `insof_session=${t}`;
}

export const ROLES = ["direktor", "sotuv", "ishlab", "prorab", "logistika", "sklad", "snab", "buh", "finance", "kadr", "kassa", "haydovchi", "brigadir", "mexanik"] as const;
