import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { defaultCreditLimit } from "@/lib/finance";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { refreshClient } from "@/lib/crm/contacts";
import { isoToDb, todayIso } from "@/lib/crm/dates";
import { findDuplicates } from "@/lib/crm/clients";
import { createClient } from "@/lib/crm/import/apply";
import { history, pbxEnabled, type PbxCall } from "./onlinepbx";

/**
 * onlinePBX qo'ng'iroqlari tarixi → CRM (`CrmCall`). Har daqiqada (`watch.ts`) yoki sozlamalardagi tugmadan.
 *   — xodim ichki raqam (`User.pbxExt`), mijoz telefon (oxirgi 9 raqam) bo'yicha bog'lanadi;
 *   — o'tkazib yuborilgan kiruvchi qo'ng'iroq → aloqa «Kiruvchi qo'ng'iroq», keyingi aloqa bugun (noma'lum raqam — yangi lid);
 *   — javob berilgan noma'lum kiruvchi raqam → yangi CRM mijozi (natijani operator yozadi);
 *   — chiquvchi qo'ng'iroq faqat bog'lanadi: natijani operator aloqa formasida tanlaydi (javobsiz bo'lsa forma
 *     «Telefon ko'tarmadi» ni o'zi tanlab turadi). Operatorning o'zi ko'tarmagan holatni API'dan ajratib bo'lmaydi.
 * Takror sinxron uuid bo'yicha dublikat ochmaydi; oraliq 15 daqiqa ustma-ust (onlinePBX tarixi ~1 daqiqa kechikadi).
 */

const WEEK = 7 * 86_400;
const OVERLAP = 15 * 60;
const isExt = (v: string) => /^\d{2,5}$/.test(v);

export const PBX_LOGIN = "onlinepbx";

async function systemUserId(): Promise<string> {
  const u = await db.user.findUnique({ where: { login: PBX_LOGIN }, select: { id: true } });
  if (u) return u.id;
  try {
    return (await db.user.create({
      data: { login: PBX_LOGIN, fullName: "onlinePBX", role: "SALES", isActive: false, passwordHash: await hashPassword(randomBytes(24).toString("hex")) },
      select: { id: true },
    })).id;
  } catch {
    return (await db.user.findUniqueOrThrow({ where: { login: PBX_LOGIN }, select: { id: true } })).id;
  }
}

export type ParsedCall = { uuid: string; direction: "OUT" | "IN" | "MISSED" | "INTERNAL"; ext: string | null; phone: string | null; startedAt: Date; durationSec: number; talkSec: number; hangupCause: string | null };

/** Tarix qatoridan: yo'nalish, operator ichki raqami va mijoz raqami */
export function parseCall(c: PbxCall): ParsedCall {
  const caller = String(c.caller_id_number ?? "").replace(/[^\d]/g, "");
  const dest = String(c.destination_number ?? "").replace(/[^\d]/g, "");
  const userEvents = (c.events ?? []).filter((e) => e.type === "user" && e.number != null).map((e) => ({ num: String(e.number), answered: !!e.answered_stamp }));
  const answeredExt = userEvents.find((e) => e.answered)?.num ?? null;
  const anyExt = userEvents[0]?.num ?? null;
  const talk = Math.max(0, Number(c.user_talk_time ?? 0) || 0);
  const code = (c.accountcode ?? "").toLowerCase();
  let direction: ParsedCall["direction"];
  let ext: string | null;
  let phone: string | null;
  if (code === "outbound" || (isExt(caller) && !isExt(dest) && dest.length >= 9)) {
    direction = "OUT";
    ext = isExt(caller) ? caller : answeredExt ?? anyExt;
    phone = !isExt(dest) ? dest : !isExt(caller) ? caller : null;
  } else if (code === "local" || (isExt(caller) && isExt(dest))) {
    direction = "INTERNAL";
    ext = isExt(caller) ? caller : null;
    phone = null;
  } else {
    direction = talk > 0 && code !== "missed" ? "IN" : "MISSED";
    ext = answeredExt ?? (isExt(dest) ? dest : anyExt);
    phone = caller || null;
  }
  return {
    uuid: c.uuid, direction, ext, phone: phone ? normalizePhone(phone) ?? `+${phone}` : null,
    startedAt: new Date(c.start_stamp * 1000), durationSec: Math.max(0, Number(c.duration ?? 0) || 0), talkSec: talk,
    hangupCause: c.hangup_cause ?? null,
  };
}

const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }).format(d);

/** Bitta qo'ng'iroqni yozish. Yangi bo'lsa true */
/** `live` — jonli sinxron: yangi lid va «qayta qo'ng'iroq» aloqasi faqat shunda (eski tarixni olishda «Bugun» to'lib ketmasin) */
export async function ingestCall(p: ParsedCall, live = true): Promise<boolean> {
  if (await db.crmCall.findUnique({ where: { uuid: p.uuid }, select: { id: true } })) return false;
  const user = p.ext ? await db.user.findUnique({ where: { pbxExt: p.ext }, select: { id: true } }) : null;

  let customerId: string | null = null;
  if (p.phone && p.direction !== "INTERNAL") {
    const dups = await findDuplicates({ phone: p.phone });
    customerId = (dups.find((d) => d.inCrm) ?? dups[0])?.id ?? null;
    // Noma'lum raqamdan kiruvchi (javob berilgan yoki o'tkazib yuborilgan) — yangi lid; faqat O'zbekiston raqami
    if (live && !customerId && (p.direction === "IN" || p.direction === "MISSED") && normalizePhone(p.phone)) {
      const source = await db.crmOption.findUnique({ where: { kind_code: { kind: "SOURCE", code: "inbound" } }, select: { id: true } });
      customerId = await createClient(
        { key: "", name: `Kiruvchi ${formatPhone(p.phone)}`, inn: null, phone: p.phone, rawPhone: p.phone, contactPerson: null, region: null, district: null,
          objectType: null, foremanName: null, foremanPhone: null, clientType: null, source: null, ownerId: null, link: null, note: null },
        { sourceId: source?.id ?? null, ownerId: user?.id ?? null, crmNote: "onlinePBX: kiruvchi qo'ng'iroqdan" },
        await defaultCreditLimit(), user?.id ?? (await systemUserId()),
      );
    }
  }

  try {
    const call = await db.crmCall.create({
      data: { uuid: p.uuid, direction: p.direction, ext: p.ext, phone: p.phone, userId: user?.id ?? null, customerId, startedAt: p.startedAt, durationSec: p.durationSec, talkSec: p.talkSec, hangupCause: p.hangupCause },
    });
    // O'tkazib yuborilgan — qayta qo'ng'iroq qilish uchun «Bugun»ga tushsin
    if (live && p.direction === "MISSED" && customerId) {
      const channel = await db.crmOption.findUnique({ where: { kind_code: { kind: "CHANNEL", code: "incoming" } }, select: { id: true } });
      const owner = (await db.customer.findUnique({ where: { id: customerId }, select: { ownerId: true } }))?.ownerId;
      const userId = user?.id ?? owner ?? (await systemUserId());
      await db.$transaction(async (tx) => {
        const c = await tx.crmContact.create({
          data: {
            customerId: customerId!, date: isoToDb(todayIso(p.startedAt)), channelId: channel?.id ?? null, resultId: null, userId,
            nextContactDate: isoToDb(todayIso()), note: `O'tkazib yuborilgan qo'ng'iroq ${hhmm(p.startedAt)} — qayta qo'ng'iroq qiling`,
            importKey: `pbx:${p.uuid}`,
          },
        });
        await tx.crmCall.update({ where: { id: call.id }, data: { contactId: c.id } });
        await refreshClient(tx, customerId!);
      });
    } else if (customerId && live) {
      await db.$transaction((tx) => refreshClient(tx, customerId!)); // yangi lid — CRM'ga kiritilsin
    }
    return true;
  } catch (e) {
    if (String(e).includes("Unique constraint")) return false; // parallel sinxron
    throw e;
  }
}

const g = globalThis as { __pbxSyncing?: boolean };

/** Oxirgi sinxrondan beri (≤ 7 kun) tarixni olib yozish */
export async function syncCalls(opts: { sinceUnix?: number; userId?: string } = {}): Promise<{ fetched: number; added: number }> {
  if (!pbxEnabled()) return { fetched: 0, added: 0 };
  if (g.__pbxSyncing) return { fetched: 0, added: 0 };
  g.__pbxSyncing = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { pbxSyncedAt: true } });
    const last = s?.pbxSyncedAt ? Math.floor(s.pbxSyncedAt.getTime() / 1000) : now - 3_600;
    const from = Math.max(opts.sinceUnix ?? last - OVERLAP, now - WEEK);
    const rows = await history(from, now);
    let added = 0;
    for (const r of rows.sort((a, b) => a.start_stamp - b.start_stamp)) {
      if (!r.uuid || !r.start_stamp) continue;
      if (await ingestCall(parseCall(r), opts.sinceUnix === undefined)) added++;
    }
    // Qo'lda olingan eski tarix jonli sinxron belgisini orqaga surmasin
    if (opts.sinceUnix === undefined || !s?.pbxSyncedAt) await db.companySettings.updateMany({ where: { id: "main" }, data: { pbxSyncedAt: new Date(now * 1000) } });
    if (opts.userId && added) await audit(db, opts.userId, "CREATE", "CrmCallSync", "main", undefined, { fetched: rows.length, added });
    return { fetched: rows.length, added };
  } finally {
    g.__pbxSyncing = false;
  }
}
