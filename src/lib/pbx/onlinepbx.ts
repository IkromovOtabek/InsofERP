/**
 * onlinePBX HTTP API (https://api2.onlinepbx.ru/documentation) — bizga kerakli qismi:
 *   auth.json            — API kaliti → `key_id:key` (oxirgi ishlatilgandan 3 kun yashaydi; `isNotAuth` kelsa qayta olinadi)
 *   call/now.json        — avval `from` (operator ichki raqami), keyin `to` (mijoz) chaqiriladi; javob `uuid`
 *   mongo_history/search — qo'ng'iroqlar tarixi (bir so'rovda ≤ 1 hafta), `download=1` — yozuv havolasi (mp3)
 *   user/get.json        — ichki raqamlar ro'yxati
 * Sozlama — korxona env'ida: ONLINEPBX_DOMAIN (masalan insof.onpbx.ru), ONLINEPBX_API_KEY. Test rejimida tashqi so'rov yo'q.
 */
import { externalAllowed } from "@/lib/test-mode";

const BASE = "https://api2.onlinepbx.ru";
const TIMEOUT_MS = 20_000;

export class PbxError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export type PbxConfig = { domain: string; apiKey: string };

/** Sozlama: domen faqat `*.onpbx.ru` (kalit boshqa manzilga ketmasin) */
export function pbxConfig(): PbxConfig | null {
  const domain = (process.env.ONLINEPBX_DOMAIN ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const apiKey = (process.env.ONLINEPBX_API_KEY ?? "").trim();
  if (!domain || !apiKey || !/^[a-z0-9][a-z0-9-]{0,62}\.onpbx\.ru$/.test(domain)) return null;
  return { domain, apiKey };
}
export const pbxEnabled = () => pbxConfig() !== null;

const g = globalThis as { __pbxKey?: { domain: string; value: string } | null; __pbxAuth?: Promise<string> | null };

type Resp<T> = { status: string | number; data?: T; comment?: string; isNotAuth?: boolean; errorCode?: string };

const ERRORS: Record<string, string> = {
  WRONG_DOMAIN: "onlinePBX domeni noto'g'ri",
  DISABLED_DOMAIN: "onlinePBX domeni faol emas (balansni tekshiring)",
  TOO_MANY_REQUESTS: "onlinePBX: so'rovlar juda ko'p, birozdan keyin qayta urinib ko'ring",
  WRONG_API_KEY: "onlinePBX API kaliti noto'g'ri",
  API_KEY_CHECK_FAILED: "onlinePBX API kaliti noto'g'ri",
  FORBIDDEN_IP: "onlinePBX: server IP manzili ruxsat ro'yxatida yo'q (onlinePBX kabinetida API → ruxsat etilgan IP)",
  WRONG_GATEWAY: "onlinePBX: tashqi raqam (trunk) topilmadi",
};
const errText = (r: Resp<unknown>) => (r.errorCode && ERRORS[r.errorCode]) || `onlinePBX xatosi: ${r.comment || r.errorCode || "noma'lum"}`;

async function post<T>(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Resp<T>> {
  if (!externalAllowed(url)) throw new PbxError("Test rejimida onlinePBX'ga so'rov yuborilmaydi");
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new PbxError(`onlinePBX javob bermadi: ${e instanceof Error ? e.message : e}`);
  }
  const j = (await r.json().catch(() => null)) as Resp<T> | null;
  if (!j) throw new PbxError(`onlinePBX javobi o'qilmadi (${r.status})`);
  return j;
}

async function authKey(c: PbxConfig, force = false): Promise<string> {
  if (!force && g.__pbxKey?.domain === c.domain) return g.__pbxKey.value;
  if (g.__pbxAuth) return g.__pbxAuth;
  g.__pbxAuth = (async () => {
    const r = await post<{ key: string; key_id: string }>(`${BASE}/${c.domain}/auth.json`, { auth_key: c.apiKey, new: "true" });
    if (String(r.status) !== "1" || !r.data?.key) throw new PbxError(errText(r), r.errorCode);
    const value = `${r.data.key_id}:${r.data.key}`;
    g.__pbxKey = { domain: c.domain, value };
    return value;
  })().finally(() => { g.__pbxAuth = null; });
  return g.__pbxAuth;
}

/** Imzolangan so'rov; kalit eskirgan bo'lsa bir marta yangilab qayta yuboradi */
export async function pbx<T>(method: string, form: Record<string, string> = {}): Promise<T> {
  const c = pbxConfig();
  if (!c) throw new PbxError("onlinePBX sozlanmagan (ONLINEPBX_DOMAIN, ONLINEPBX_API_KEY)");
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = await authKey(c, attempt > 0);
    const r = await post<T>(`${BASE}/${c.domain}/${method}`, form, { "x-pbx-authentication": key });
    if (r.isNotAuth || r.errorCode === "WRONG_AUTH_DATA") { g.__pbxKey = null; continue; }
    if (String(r.status) !== "1") throw new PbxError(errText(r), r.errorCode);
    return r.data as T;
  }
  throw new PbxError("onlinePBX: avtorizatsiya o'tmadi — API kalitini tekshiring");
}

/** onlinePBX raqam ko'rinishi: faqat raqamlar (998XXXXXXXXX) */
export const pbxNumber = (phone: string) => phone.replace(/[^\d]/g, "");

/** Click-to-call: avval operator (`ext`), keyin mijoz. Javob — qo'ng'iroq uuid'i */
export async function callNow(ext: string, phone: string, clientName?: string): Promise<string> {
  const form: Record<string, string> = { from: ext, to: pbxNumber(phone), from_orig_number: pbxNumber(phone) };
  const name = (clientName ?? "").replace(/[^\p{L}\d\s.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (name) form.from_orig_name = name;
  const d = await pbx<{ uuid: string }>("call/now.json", form);
  return d.uuid;
}

export type PbxCall = {
  uuid: string;
  caller_id_number?: string | number;
  caller_id_name?: string;
  destination_number?: string | number;
  start_stamp: number;
  end_stamp?: number;
  duration?: number;
  user_talk_time?: number;
  hangup_cause?: string;
  accountcode?: string; // inbound | outbound | missed | local
  gateway?: string;
  events?: { type?: string; number?: string | number; answered_stamp?: number }[];
};

/** Qo'ng'iroqlar (oraliq ≤ 7 kun — chaqiruvchi bo'lib beradi) */
export async function history(fromUnix: number, toUnix: number): Promise<PbxCall[]> {
  const d = await pbx<PbxCall[] | null>("mongo_history/search.json", { start_stamp_from: String(fromUnix), start_stamp_to: String(toUnix) });
  return Array.isArray(d) ? d : [];
}

/** Yozuvning vaqtinchalik yuklab olish havolasi (mp3) yoki null */
export async function recordUrl(uuid: string): Promise<string | null> {
  try {
    const d = await pbx<string>("mongo_history/search.json", { uuid, download: "1" });
    return typeof d === "string" && /^https:\/\//.test(d) ? d : null;
  } catch {
    return null;
  }
}

/** Ichki raqamlar (sozlamalar sahifasi uchun) */
export async function extensions(): Promise<{ num: string; name: string }[]> {
  const d = await pbx<{ num: string | number; name?: string }[] | (string | number)[]>("user/get.json", {});
  return (Array.isArray(d) ? d : []).map((x) => (typeof x === "object" ? { num: String(x.num), name: x.name ?? "" } : { num: String(x), name: "" }));
}
