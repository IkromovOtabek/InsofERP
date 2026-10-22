import { db } from "./db";
import { audit } from "./audit";
import { getCompany } from "./company";

/**
 * Arenda — ijaraga beruvchi (Арендодатель) rekvizitlari: ijara shartnomasi va dalolatnomalar uchun.
 * `CompanySettings.rentLessor` (JSON) da saqlanadi; bo'sh maydon korxona rekvizitlaridan olinadi (nomi, INN, bank…).
 * Ijaraga beruvchi jismoniy shaxs bo'lsa — `basis` da pasport ma'lumoti, `taxPercent` — ijarachi ushlab qoladigan
 * jismoniy shaxs daromad solig'i (shartnomada alohida band); tashkilot bo'lsa — «direktor …, Ustav asosida».
 */
export type RentLessor = {
  kind: "person" | "company";
  /** F.I.O. yoki tashkilot nomi */
  name: string;
  /** Jismoniy shaxs: «паспорт серии … выдан … от …»; tashkilot: «в лице директора …, действующего на основании Устава» */
  basis: string;
  /** O'zbekcha nusxa uchun asos matni (bo'sh — ruschasi ishlatiladi) */
  basisUz: string;
  address: string; inn: string; bank: string; mfo: string; account: string; card: string; phone: string;
  /** Shartnoma tuziladigan shahar */
  city: string;
  /** Jismoniy shaxs daromad solig'i, % (ijarachi ushlab qoladi); 0 — band chiqmaydi */
  taxPercent: number;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Saqlangan rekvizitlar (korxona ma'lumoti bilan to'ldirilgan). */
export async function getRentLessor(): Promise<RentLessor & { saved: Partial<RentLessor> }> {
  const c = await getCompany();
  const raw = (c.rentLessor && typeof c.rentLessor === "object" && !Array.isArray(c.rentLessor) ? c.rentLessor : {}) as Record<string, unknown>;
  const kind = raw.kind === "person" ? "person" : "company";
  const or = (k: string, d: string | null | undefined) => str(raw[k]) || (d ?? "");
  const tax = Number(raw.taxPercent);
  return {
    kind,
    name: or("name", c.legalName ?? c.name),
    basis: or("basis", kind === "company" && c.directorName ? `в лице директора ${c.directorName}, действующего на основании Устава` : ""),
    basisUz: or("basisUz", kind === "company" && c.directorName ? `direktor ${c.directorName} shaxsida, Ustav asosida ish yurituvchi` : ""),
    address: or("address", c.address), inn: or("inn", c.inn), bank: or("bank", c.bankName), mfo: or("mfo", c.mfo),
    account: or("account", c.bankAccount), card: or("card", ""), phone: or("phone", c.phone), city: or("city", "Ташкент"),
    taxPercent: Number.isFinite(tax) && tax >= 0 && tax <= 100 ? tax : 0,
    saved: raw as Partial<RentLessor>,
  };
}

/** Rekvizitlarni saqlash (audit bilan). */
export async function saveRentLessor(data: RentLessor, userId: string) {
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { rentLessor: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: { rentLessor: data }, create: { id: "main", rentLessor: data } });
  await audit(db, userId, "UPDATE", "CompanySettings", "main", before ?? undefined, { rentLessor: data });
}
