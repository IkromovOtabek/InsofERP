import type { CrmOptionKind } from "@/generated/prisma";
import { db } from "@/lib/db";
import { flatName } from "@/lib/excel";
import { normalizePhone } from "@/lib/phone";
import { customerNameKey } from "@/lib/customer-name";

/**
 * CRM importi (CRM_SPEC 6) — umumiy reja: manba (Google Sheets fayli yoki amoCRM) avval shu ko'rinishga keltiriladi,
 * keyin quruq ishga tushirish hisoboti chiqadi va tasdiq bilan `applyPlan` yozadi. Qayta ishga tushirilsa dublikat yo'q:
 * mijoz mavjud kartaga STIR / telefon / nom bo'yicha bog'lanadi, aloqa `importKey` bo'yicha o'tkazib yuboriladi.
 */

export type PlanClient = {
  key: string;
  name: string;
  inn: string | null;
  phone: string | null; // +998XXXXXXXXX yoki null
  rawPhone: string | null;
  contactPerson: string | null;
  region: string | null;
  district: string | null;
  objectType: string | null;
  foremanName: string | null;
  foremanPhone: string | null;
  clientType: string | null; // ro'yxat qiymati (matn)
  source: string | null; // ro'yxat qiymati (matn)
  ownerId: string | null;
  link: string | null;
  note: string | null;
  /** Bazadagi mavjud mijoz (quruq ishga tushirishda topilgan) */
  matchId?: string;
  matchBy?: "inn" | "phone" | "name";
};

export type PlanContact = {
  importKey: string;
  clientKey: string;
  date: string; // yyyy-mm-dd
  channel: string | null;
  resultId: string | null;
  product: string | null;
  offeredPrice: number | null;
  next: string | null;
  userId: string | null;
  leadSource: string | null;
  objectName: string | null;
  objectArea: string | null;
  note: string | null;
};

export type Plan = {
  clients: PlanClient[];
  contacts: PlanContact[];
  /** Hisobot uchun: xatolar (yozilmaydi) va ogohlantirishlar */
  errors: string[];
  warnings: string[];
  /** Qo'shimcha ma'lumot (ustunlar moslamasi, varaqlar) */
  info: string[];
};

export type ImportReport = {
  dryRun: boolean;
  clientsNew: number;
  clientsMatched: number;
  contactsNew: number;
  contactsExisting: number;
  newOptions: string[];
  errors: string[];
  warnings: string[];
  info: string[];
  sample: { name: string; phone: string | null; source: string | null; match: string | null }[];
};

/* ───────────────────────── Ro'yxatlar va xodimlar ───────────────────────── */

const SOURCE_ALIASES: Record<string, string> = {
  tendersayti: "tender_mc", tendermcuz: "tender_mc", tendermc: "tender_mc", mcuz: "tender_mc",
  uztender: "uztender", uztendercom: "uztender", uztenderuztendercom: "uztender",
  reklama: "ads", realizator: "realizator", realizatorkochada: "realizator", olx: "olx",
  telegram: "telegram", telegramkanal: "telegram", instagram: "social", facebook: "social",
  google: "maps", "2gis": "maps", googlegis: "maps", ozsaytimiz: "site", sayt: "site",
  boshqasayt: "other_site", tavsiya: "referral", ozimurojaatqildi: "inbound", eskimijoz: "old_client",
};

export type OptionIndex = {
  /** Matn → ro'yxat id; topilmasa — yangi qiymat (tasdiqda yaratiladi) */
  resolve(kind: CrmOptionKind, label: string | null | undefined): { id: string | null; label: string | null; isNew: boolean };
  newOnes: () => string[];
};

const KIND_LABEL: Record<CrmOptionKind, string> = { SOURCE: "Manba", CLIENT_TYPE: "Mijoz turi", PRODUCT: "Mahsulot", CHANNEL: "Aloqa turi" };

export async function optionIndex(): Promise<OptionIndex> {
  const all = await db.crmOption.findMany();
  const byKind = new Map<string, { id: string; code: string; label: string }>();
  for (const o of all) {
    byKind.set(`${o.kind}:${flatName(o.label)}`, o);
    byKind.set(`${o.kind}:code:${o.code}`, o);
  }
  const fresh = new Map<string, string>();
  return {
    resolve(kind, label) {
      const l = (label ?? "").replace(/\s+/g, " ").trim();
      if (!l) return { id: null, label: null, isNew: false };
      const f = flatName(l);
      const hit = byKind.get(`${kind}:${f}`) ?? (kind === "SOURCE" && SOURCE_ALIASES[f] ? byKind.get(`${kind}:code:${SOURCE_ALIASES[f]}`) : undefined)
        // «UzTender (uztender.com)» kabi qisman yozilganlar: boshlanishi mos kelsa
        ?? [...byKind.entries()].find(([k]) => k.startsWith(`${kind}:`) && !k.includes(":code:") && f.length >= 3 && (k.slice(kind.length + 1).startsWith(f) || f.startsWith(k.slice(kind.length + 1))))?.[1];
      if (hit) return { id: hit.id, label: hit.label, isNew: false };
      fresh.set(`${kind}:${f}`, `${KIND_LABEL[kind]}: ${l}`);
      return { id: null, label: l, isNew: true };
    },
    newOnes: () => [...fresh.values()],
  };
}

/** Natija matni → CrmResult id («Telefon raqam notogri» ham «noto'g'ri» ga mos keladi) */
export async function resultIndex(): Promise<(label: string | null | undefined) => string | null> {
  const rs = await db.crmResult.findMany({ select: { id: true, label: true, code: true } });
  const m = new Map<string, string>();
  for (const r of rs) { m.set(flatName(r.label), r.id); m.set(flatName(r.code), r.id); }
  return (label) => {
    const f = flatName(label ?? "");
    if (!f) return null;
    return m.get(f) ?? [...m.entries()].find(([k]) => k.length >= 6 && (k.startsWith(f) || f.startsWith(k)))?.[1] ?? null;
  };
}

/** Xodim ismi → foydalanuvchi: to'liq yoki bitta so'z bo'yicha («Mushtariy» → «Normirzayeva Mushtariy») */
export async function userIndex(): Promise<(name: string | null | undefined) => string | null> {
  const us = await db.user.findMany({ where: { role: { notIn: ["DRIVER", "BRIGADIER"] } }, select: { id: true, fullName: true, login: true, isActive: true }, orderBy: { isActive: "desc" } });
  return (name) => {
    const f = flatName(name ?? "");
    if (!f) return null;
    const exact = us.find((u) => flatName(u.fullName) === f || flatName(u.login) === f);
    if (exact) return exact.id;
    const words = (name ?? "").toLowerCase().split(/\s+/).map(flatName).filter((w) => w.length >= 3);
    const hits = us.filter((u) => { const uw = u.fullName.toLowerCase().split(/\s+/).map(flatName); return words.some((w) => uw.includes(w)); });
    return hits.length === 1 ? hits[0].id : hits[0]?.id ?? null;
  };
}

/* ───────────────────────── Mavjud mijozlarga moslash ───────────────────────── */

/** Har reja mijozini bazadagi kartaga bog'lash: STIR → telefon (oxirgi 9 raqam) → nom (va boshqa nomlari). */
export async function matchExisting(clients: PlanClient[], opts: { byName: boolean }): Promise<void> {
  const rows = await db.customer.findMany({ where: { isInternal: false }, select: { id: true, name: true, inn: true, phone: true, aliases: true } });
  const byInn = new Map<string, string>(), byPhone = new Map<string, string>(), byName = new Map<string, string>();
  for (const r of rows) {
    if (r.inn) byInn.set(r.inn, r.id);
    const p = normalizePhone(r.phone);
    if (p && !byPhone.has(p)) byPhone.set(p, r.id);
    for (const n of [r.name, ...r.aliases]) { const k = customerNameKey(n); if (k && !byName.has(k)) byName.set(k, r.id); }
  }
  for (const c of clients) {
    const inn = c.inn ? byInn.get(c.inn) : undefined;
    const ph = c.phone ? byPhone.get(c.phone) : undefined;
    const nm = opts.byName ? byName.get(customerNameKey(c.name)) : undefined;
    if (inn) { c.matchId = inn; c.matchBy = "inn"; }
    else if (ph) { c.matchId = ph; c.matchBy = "phone"; }
    else if (nm) { c.matchId = nm; c.matchBy = "name"; }
  }
}

export const cleanText = (v: unknown, max = 500): string | null => {
  const s = (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
export const cleanInn = (v: unknown): string | null => {
  const d = String(v ?? "").replace(/\D+/g, "");
  return d.length === 9 || d.length === 14 ? d : null;
};
