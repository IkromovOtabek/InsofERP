/**
 * amoCRM API v4 klienti — kutubxonasiz fetch.
 *  - token: uzoq muddatli (TOKEN) yoki OAuth (access ~24 soat; tugashiga 10 daqiqa qolganda refresh bilan yangilanadi,
 *    refresh token bir martalik — yangisi darhol bazaga yoziladi);
 *  - cheklov: amoCRM sekundiga 7 so'rovdan ko'pini 429 bilan qaytaradi — jarayon ichida so'rovlar orasida 160 ms;
 *  - 401 — OAuth bo'lsa bir marta yangilab qayta urinadi, aks holda ulanish ERROR holatiga o'tadi.
 * Test rejimida faqat lokal stub (`externalAllowed`).
 */
import type { AmoConnection } from "@/generated/prisma";
import { db } from "@/lib/db";
import { externalAllowed } from "@/lib/test-mode";
import { AMO_ID, baseUrl, getConnection, oauthRedirectUri, vault } from "./store";

export class AmoError extends Error {
  constructor(message: string, readonly status = 0, readonly auth = false) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;
const GAP_MS = 160;
let lastAt = 0;
let chain: Promise<void> = Promise.resolve();

/** So'rovlarni ketma-ket, oralig'i bilan chiqarish (jarayon bo'yicha umumiy) */
function slot(): Promise<void> {
  const next = chain.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  });
  chain = next.catch(() => undefined);
  return next;
}

type TokenResp = { access_token: string; refresh_token: string; expires_in: number };

async function tokenRequest(domain: string, body: Record<string, string>): Promise<TokenResp> {
  const url = `${baseUrl(domain)}/oauth2/access_token`;
  if (!externalAllowed(url)) throw new AmoError("Test rejimida tashqi amoCRM'ga so'rov yuborilmaydi");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const j = (await r.json().catch(() => null)) as (TokenResp & { hint?: string; detail?: string }) | null;
  if (!r.ok || !j?.access_token) throw new AmoError(`amoCRM tokenni bermadi (${r.status})${j?.hint ? `: ${j.hint}` : j?.detail ? `: ${j.detail}` : ""}`, r.status, true);
  return j;
}

/** OAuth: ruxsat oynasidan qaytgan `code` → tokenlar */
export async function exchangeCode(domain: string, clientId: string, clientSecret: string, code: string): Promise<{ access: string; refresh: string; expiresAt: Date }> {
  const t = await tokenRequest(domain, { client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: oauthRedirectUri() });
  return { access: t.access_token, refresh: t.refresh_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
}

let refreshing: Promise<string> | null = null;

/** Access tokenni yangilash. Bir jarayonda bir vaqtda bitta (refresh token bir martalik). */
async function refreshToken(c: AmoConnection): Promise<string> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const secret = vault.unseal(c.clientSecretEnc);
    const refresh = vault.unseal(c.refreshTokenEnc);
    if (!c.clientId || !secret || !refresh) throw new AmoError("amoCRM ulanishini qayta ulang: refresh token yo'q", 401, true);
    try {
      const t = await tokenRequest(c.domain, { client_id: c.clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: refresh, redirect_uri: oauthRedirectUri() });
      await db.amoConnection.update({
        where: { id: AMO_ID },
        data: { accessTokenEnc: vault.seal(t.access_token), refreshTokenEnc: vault.seal(t.refresh_token), tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), status: "ACTIVE", lastError: null },
      });
      return t.access_token;
    } catch (e) {
      // Boshqa jarayon shu orada yangilab qo'ygan bo'lishi mumkin (eski refresh endi yaroqsiz) — bazadan qayta o'qiymiz
      const fresh = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
      if (fresh?.refreshTokenEnc && fresh.refreshTokenEnc !== c.refreshTokenEnc && fresh.tokenExpiresAt && fresh.tokenExpiresAt.getTime() > Date.now() + 60_000) {
        const a = vault.unseal(fresh.accessTokenEnc);
        if (a) return a;
      }
      throw e;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function accessToken(c: AmoConnection, force = false): Promise<string> {
  if (c.method === "OAUTH" && (force || !c.tokenExpiresAt || c.tokenExpiresAt.getTime() < Date.now() + 10 * 60_000)) {
    return refreshToken(c);
  }
  const t = vault.unseal(c.accessTokenEnc);
  if (!t) throw new AmoError("amoCRM tokeni o'qilmadi — ulanishni qayta kiriting", 401, true);
  return t;
}

async function markError(message: string) {
  await db.amoConnection.updateMany({ where: { id: AMO_ID }, data: { status: "ERROR", lastError: message.slice(0, 500) } }).catch(() => undefined);
}

export type AmoInit = {
  method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: Record<string, string | number>;
  /** Yangi tokenni sinash (qayta ulash): xato saqlangan ulanishni ERROR qilmasin */
  probe?: boolean;
};

/**
 * amoCRM so'rovi. `conn` berilmasa — bazadagi ulanish. 204 — null.
 * Xato: AmoError (status bilan). Avtorizatsiya xatosida ulanish ERROR holatiga o'tadi.
 */
export async function amo<T = unknown>(path: string, init: AmoInit = {}, conn?: AmoConnection | null): Promise<T> {
  const c = conn ?? (await getConnection());
  if (!c) throw new AmoError("amoCRM ulanmagan");
  const url = new URL(`${baseUrl(c.domain)}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, String(v));
  if (!externalAllowed(url)) throw new AmoError("Test rejimida tashqi amoCRM'ga so'rov yuborilmaydi");

  let token: string;
  try {
    token = await accessToken(c);
  } catch (e) {
    if (e instanceof AmoError && e.auth && !init.probe) await markError(e.message);
    throw e;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await slot();
    let r: Response;
    try {
      r = await fetch(url, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new AmoError(`amoCRM javob bermadi: ${e instanceof Error ? e.message : e}`);
    }
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 1100 * (attempt + 1))); continue; }
    if (r.status === 401) {
      if (c.method === "OAUTH" && attempt === 0) {
        try { token = await accessToken(c, true); continue; } catch { /* pastda xato */ }
      }
      const msg = "amoCRM tokeni yaroqsiz yoki muddati tugagan — Sozlamalarda qayta ulang";
      if (!init.probe) await markError(msg);
      throw new AmoError(msg, 401, true);
    }
    if (r.status === 204) return null as T;
    const text = await r.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
    if (!r.ok) {
      const detail = json?.detail || json?.title || (json?.["validation-errors"] ? JSON.stringify(json["validation-errors"]).slice(0, 300) : "") || text.slice(0, 200);
      throw new AmoError(`amoCRM xatosi ${r.status}${detail ? `: ${detail}` : ""}`, r.status);
    }
    return json as T;
  }
  throw new AmoError("amoCRM so'rovlar cheklovi (429) — keyinroq qayta urinadi", 429);
}
