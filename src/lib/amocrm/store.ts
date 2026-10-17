/**
 * amoCRM ulanishi: hisob manzili, tokenlar (shifrlangan) va voronka moslamasi — korxona bazasida bitta qator.
 * Korxonaga xos sozlama control bazaga yozilmaydi: har korxona o'z amoCRM hisobini o'zi ulaydi.
 */
import { randomBytes } from "node:crypto";
import type { AmoConnection } from "@/generated/prisma";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { SITE_URL } from "@/lib/site";
import { isTestMode } from "@/lib/test-mode";
import { makeVault } from "@/lib/smm/vault";

export const vault = makeVault("insof-amocrm", "amocrm-token-vault-v1");

export const AMO_ID = "main";

/** Faqat amoCRM/Kommo hisoblari: tokenni boshqa manzilga yuborib bo'lmasin. Test rejimida lokal stub (http://127.0.0.1:…). */
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,62}\.(amocrm\.(ru|com)|kommo\.com)$/;

/** «https://insof.amocrm.ru/leads/» → «insof.amocrm.ru». Noto'g'ri bo'lsa — null. */
export function normalizeDomain(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (isTestMode() && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v.replace(/\/+$/, ""))) return v.replace(/\/+$/, "");
  const host = v.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return DOMAIN_RE.test(host) ? host : null;
}

export const baseUrl = (domain: string) => (domain.startsWith("http://") ? domain : `https://${domain}`);

/** OAuth ruxsat oynasi: amoCRM — www.amocrm.ru, Kommo — www.kommo.com */
export const oauthHost = (domain: string) => (domain.endsWith("kommo.com") ? "https://www.kommo.com" : domain.startsWith("http://") ? domain : "https://www.amocrm.ru");

const appUrl = () => SITE_URL.replace(/\/$/, "");
/** amoCRM integratsiyasidagi «Redirect URI» shu bo'lishi shart */
export const oauthRedirectUri = () => `${appUrl()}/api/amocrm/oauth`;
export const webhookUrl = (key: string) => `${appUrl()}/api/amocrm/webhook/${key}`;

export const newWebhookKey = () => randomBytes(24).toString("base64url");

export async function getConnection(): Promise<AmoConnection | null> {
  const c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  return c && c.status !== "DISCONNECTED" ? c : null;
}

/** Ulangan va ishlashga tayyor (token bor) */
export const isReady = (c: AmoConnection | null): c is AmoConnection => !!c && !!c.accessTokenEnc && c.status !== "DISCONNECTED";

/** Sdelka havolasi amoCRM'da */
export const dealUrl = (domain: string, amoLeadId: number) => `${baseUrl(domain)}/leads/detail/${amoLeadId}`;

export const AMO_SYSTEM_LOGIN = "amocrm-integration";

/** amoCRM'dan kelgan o'zgarishlar audit jurnalida shu foydalanuvchi nomidan yoziladi (tizimga kira olmaydi). */
export async function amoSystemUserId(): Promise<string> {
  const u = await db.user.findUnique({ where: { login: AMO_SYSTEM_LOGIN }, select: { id: true } });
  if (u) return u.id;
  try {
    const created = await db.user.create({
      data: { login: AMO_SYSTEM_LOGIN, fullName: "amoCRM integratsiyasi", role: "SALES", isActive: false, passwordHash: await hashPassword(randomBytes(24).toString("hex")) },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Ikki jarayon bir vaqtda yaratdi (unique login) — boriga qaytamiz
    const again = await db.user.findUnique({ where: { login: AMO_SYSTEM_LOGIN }, select: { id: true } });
    if (again) return again.id;
    throw new Error("amoCRM tizim foydalanuvchisi yaratilmadi");
  }
}
