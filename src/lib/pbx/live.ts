import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { findDuplicates } from "@/lib/crm/clients";
import { pbxConfig } from "./onlinepbx";
import { ingestCall, type ParsedCall } from "./sync";

/**
 * onlinePBX webhooklari (kabinet → Интеграция → Webhooks, manzil `/api/crm/pbx?k=<kalit>`) — qo'ng'iroq jonli holati.
 * Hodisalar: call_start, call_user_start (operator jiringlayapti), call_answered, call_missed, call_end. Maydonlar:
 * uuid, direction (inbound | outbound | local), caller, callee, date, call_duration, dialog_duration, hangup_cause.
 * Boshlanishida `CrmCall` qatori RINGING/TALKING holatida ochiladi (kiruvchi qo'ng'iroq oynasi shuni ko'rsatadi), call_end
 * uni `ingestCall` orqali yakunlaydi. Webhook yo'qolsa ham har daqiqalik tarix sinxroni qatorni yakunlab qo'yadi.
 */

export type PbxHook = Record<string, string | undefined>;

const digits = (v?: string) => (v ?? "").replace(/[^\d]/g, "");
const isExt = (v: string) => /^\d{2,5}$/.test(v);
const num = (v?: string) => Math.max(0, Math.round(Number(v ?? 0) || 0));

function stamp(v?: string): Date | null {
  if (!v) return null;
  if (/^\d{9,13}$/.test(v)) return new Date(Number(v) * (v.length > 10 ? 1 : 1000));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Webhook kaliti (sozlamadagi bilan, vaqt bo'yicha teng solishtirish) */
export async function hookKeyOk(k: string | null): Promise<boolean> {
  if (!k) return false;
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { pbxWebhookKey: true } });
  if (!s?.pbxWebhookKey) return false;
  const a = Buffer.from(k), b = Buffer.from(s.pbxWebhookKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Yangi webhook kaliti (eski manzil darhol ishlamay qoladi) */
export async function rotateHookKey(): Promise<string> {
  const key = randomBytes(18).toString("base64url");
  await db.companySettings.upsert({ where: { id: "main" }, create: { id: "main", pbxWebhookKey: key }, update: { pbxWebhookKey: key } });
  return key;
}

export async function handleHook(h: PbxHook): Promise<"ok" | "skip"> {
  const uuid = (h.uuid ?? "").trim();
  const event = (h.event ?? "").trim().toLowerCase();
  if (!uuid || !event) return "skip";
  // Boshqa domen hodisasi bizga tegishli emas
  const cfg = pbxConfig();
  if (h.domain && cfg && h.domain.toLowerCase() !== cfg.domain) return "skip";

  const caller = digits(h.caller), callee = digits(h.callee);
  const dir = (h.direction ?? "").toLowerCase();
  if (dir === "local" || (isExt(caller) && isExt(callee))) return "skip"; // ichki qo'ng'iroq — tarix sinxroni yozadi
  const inbound = dir ? dir === "inbound" : !isExt(caller);
  const ext = inbound ? (isExt(callee) ? callee : null) : (isExt(caller) ? caller : null);
  const raw = inbound ? caller : callee;
  const phone = raw ? normalizePhone(raw) ?? `+${raw}` : null;
  const at = stamp(h.date) ?? new Date();

  await db.companySettings.updateMany({ where: { id: "main", OR: [{ pbxWebhookAt: null }, { pbxWebhookAt: { lt: new Date(Date.now() - 60_000) } }] }, data: { pbxWebhookAt: new Date() } });

  if (event === "call_end" || event === "call_missed") {
    const talk = event === "call_missed" ? 0 : num(h.dialog_duration);
    const dur = num(h.call_duration);
    const p: ParsedCall = {
      uuid, direction: inbound ? (talk > 0 ? "IN" : "MISSED") : "OUT", ext, phone,
      startedAt: dur ? new Date(at.getTime() - dur * 1000) : at, durationSec: dur, talkSec: talk, hangupCause: h.hangup_cause ?? null,
    };
    await ingestCall(p, true);
    return "ok";
  }

  const state = event === "call_answered" ? "TALKING" : "RINGING";
  const ex = await db.crmCall.findUnique({ where: { uuid }, select: { id: true, state: true } });
  const user = ext ? await db.user.findUnique({ where: { pbxExt: ext }, select: { id: true } }) : null;
  if (ex) {
    if (ex.state === "ENDED") return "skip";
    // Operator aniqlansa (jiringlayotgan / ko'targan) — qatorga yoziladi; TALKING dan RINGING ga qaytmaydi
    await db.crmCall.updateMany({
      where: { id: ex.id, state: { not: "ENDED" } },
      data: { ...(ext ? { ext, userId: user?.id ?? null } : {}), ...(state === "TALKING" || ex.state !== "TALKING" ? { state } : {}) },
    });
    return "ok";
  }
  let customerId: string | null = null;
  if (phone) {
    const dups = await findDuplicates({ phone });
    customerId = (dups.find((d) => d.inCrm) ?? dups[0])?.id ?? null;
  }
  try {
    await db.crmCall.create({
      data: { uuid, direction: inbound ? "IN" : "OUT", ext, phone, userId: user?.id ?? null, customerId, startedAt: at, state },
    });
  } catch (e) {
    if (!String(e).includes("Unique constraint")) throw e; // parallel hodisa
  }
  return "ok";
}

export type LiveCall = {
  uuid: string; direction: "IN" | "OUT"; state: "RINGING" | "TALKING"; phone: string | null; ext: string | null; mine: boolean; startedAt: string;
  customer: { id: string; name: string; status: string | null; owner: string | null; lastNote: string | null } | null;
};

/**
 * Hozir davom etayotgan qo'ng'iroqlar (oyna uchun): kiruvchilar — hamma operatorga (kim ko'tarsa), chiquvchilar — faqat o'ziniki.
 * 30 daqiqadan eski «osilib qolgan» qatorlar ko'rsatilmaydi (sinxron ularni yakunlaydi).
 */
export async function liveCalls(userId: string): Promise<LiveCall[]> {
  const me = await db.user.findUnique({ where: { id: userId }, select: { pbxExt: true } });
  const rows = await db.crmCall.findMany({
    where: {
      state: { in: ["RINGING", "TALKING"] }, startedAt: { gte: new Date(Date.now() - 30 * 60_000) },
      OR: [{ direction: "IN" }, ...(me?.pbxExt ? [{ ext: me.pbxExt }] : []), { userId }],
    },
    orderBy: { startedAt: "desc" }, take: 5,
    select: {
      uuid: true, direction: true, state: true, phone: true, ext: true, userId: true, startedAt: true,
      customer: {
        select: {
          id: true, name: true, crmStatus: true, owner: { select: { fullName: true } },
          crmContacts: { where: { cancelledAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1, select: { note: true, result: { select: { label: true } } } },
        },
      },
    },
  });
  return rows.map((r) => ({
    uuid: r.uuid, direction: r.direction === "OUT" ? "OUT" : "IN", state: r.state === "TALKING" ? "TALKING" : "RINGING",
    phone: r.phone, ext: r.ext, mine: r.userId === userId || (!!me?.pbxExt && r.ext === me.pbxExt), startedAt: r.startedAt.toISOString(),
    customer: r.customer ? {
      id: r.customer.id, name: r.customer.name, status: r.customer.crmStatus, owner: r.customer.owner?.fullName ?? null,
      lastNote: [r.customer.crmContacts[0]?.result?.label, r.customer.crmContacts[0]?.note].filter(Boolean).join(" — ") || null,
    } : null,
  }));
}
