import { headers } from "next/headers";
import { db } from "@/lib/db";
import { ipFromHeaders } from "@/lib/login-guard";
import { parseUserAgent, VISIT_KEEP_DAYS, type LoginMethod } from "@/lib/visit-info";

/**
 * Tashriflar jurnali (`VisitLog`). IT panel korxona sahifasining «Tashriflar» tabi uni korxona bazasidan jonli o'qiydi
 * (`lib/control/visits.ts`) — control bazaga korxona ma'lumoti yozilmaydi.
 *  · PAGE — ERP qobig'i (`AppShell`) yo'l o'zgarganda `/api/visit` ga yuboradi; sahifaning o'zi yangilanishi hisoblanmaydi.
 *  · LOGIN — muvaffaqiyatli kirish (veb parol/kod/ECO/SSO, vaqtinchalik paroldan keyin, mobil ilova). Token yangilash emas.
 * Jurnal kirishni ham, sahifani ham to'xtatmaydi: yozib bo'lmasa faqat logga chiqadi.
 */

const UA_MAX = 400;
/** Shu vaqt ichida bir xil sahifa qayta yozilmaydi (dev'dagi ikki marta effekt, tez orqaga-oldinga) */
const PAGE_DEDUPE_MS = 60_000;

function client(h: Headers, app = false) {
  const userAgent = h.get("user-agent")?.slice(0, UA_MAX) || null;
  const ip = ipFromHeaders(h);
  return { userAgent, ip: ip === "unknown" ? null : ip, ...parseUserAgent(userAgent, app) };
}

export async function recordLogin(userId: string, method: LoginMethod, opts: { app?: boolean; superadmin?: boolean } = {}): Promise<void> {
  try {
    const h = await headers();
    await db.visitLog.create({ data: { userId, kind: "LOGIN", method, superadmin: !!opts.superadmin, ...client(h, opts.app) } });
  } catch (e) {
    console.error("[visits] kirish yozilmadi", e instanceof Error ? e.message : e);
  }
}

export async function recordPage(s: { userId: string; superadmin?: boolean }, path: string, h: Headers): Promise<boolean> {
  const recent = await db.visitLog.findFirst({
    where: { userId: s.userId, kind: "PAGE", path, createdAt: { gt: new Date(Date.now() - PAGE_DEDUPE_MS) } }, select: { id: true },
  });
  if (recent) return false;
  await db.visitLog.create({ data: { userId: s.userId, kind: "PAGE", path, superadmin: !!s.superadmin, ...client(h) } });
  return true;
}

/** Eski yozuvlar (`VISIT_KEEP_DAYS`) — eslatmalar aylanishida (`lib/reminders.ts`). */
export async function pruneVisits(now = new Date()): Promise<number> {
  const r = await db.visitLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - VISIT_KEEP_DAYS * 86_400_000) } } });
  return r.count;
}
