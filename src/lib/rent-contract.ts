import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { fmtNum } from "./format";
import { notifyRoles } from "./notify";
import { UPLOADS_DIR, readUpload, type SavedFile } from "./uploads";
import { RENT_PAID, currentMonth, monthKey, monthLabel, shiftMonth, today } from "./rent";

/**
 * Arenda — shartnoma atrofidagi ishlar (`lib/rent.ts` dagi hisobga qo'shimcha):
 *
 *  · Shartnoma muddati: tugashiga 30 / 7 kun qolganda va tugagan kuni sekretarga bildirishnoma (bir martadan),
 *    «Filter» da «Muddati tugayapti / tugagan» ro'yxati.
 *  · Narx o'zgarishi (`RentPriceChange`): «X oydan yangi narx» — do'kon yoki butun bozor (% bilan). Oy ochilganda
 *    (`openMonth`) o'zi qo'llanadi; hali ochilmagan oy uchungina kiritiladi.
 *  · Hujjat va suratlar (`RentFile`): shartnoma skani, pasport nusxasi, do'kon rasmi — `uploads/rent/`, faqat login bilan.
 *  · Bandlik tahlili: bozorlar bo'yicha m², bo'sh maydon, 1 m² daromad va bo'sh joy sababli yo'qotilayotgan pul.
 */

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const DAY = 86_400_000;

// ───────────────────────── Shartnoma muddati ─────────────────────────

/** Ogohlantirish bosqichlari: shuncha kun (yoki kamroq) qolganda bir marta. */
const EXPIRY_STEPS = [30, 7, 0] as const;
export const LEASE_SOON_DAYS = 30;

/** Shartnoma tugashiga necha kun qoldi (manfiy — o'tib ketgan); muddatsiz — null. */
export function leaseDaysLeft(endDate: Date | null | undefined, now = today()): number | null {
  return endDate ? Math.round((endDate.getTime() - now.getTime()) / DAY) : null;
}

export type LeaseTerm = "none" | "ok" | "soon" | "expired";
export function leaseTerm(endDate: Date | null | undefined, now = today()): LeaseTerm {
  const d = leaseDaysLeft(endDate, now);
  return d === null ? "none" : d < 0 ? "expired" : d <= LEASE_SOON_DAYS ? "soon" : "ok";
}

/**
 * Muddat ogohlantirishlari (`lib/reminders.ts` aylanishidan): amaldagi shartnoma tugashiga 30 / 7 kun qolganda va
 * tugagan kuni (yoki undan keyin) sekretarga bildirishnoma — har bosqich bir marta (`RentLease.expiryNotice`).
 */
export async function runLeaseExpiry(now = today()): Promise<number> {
  const leases = await db.rentLease.findMany({
    where: { status: "ACTIVE", endDate: { not: null, lte: new Date(now.getTime() + LEASE_SOON_DAYS * DAY) } },
    include: { shop: { select: { name: true, location: true } } },
  });
  let sent = 0;
  for (const l of leases) {
    const left = leaseDaysLeft(l.endDate, now)!;
    const step = EXPIRY_STEPS.filter((s) => left <= s).at(-1)!;
    if (l.expiryNotice !== null && l.expiryNotice <= step) continue;
    // Shartli yozuv: parallel aylanma ikkinchi marta yubormasin
    const ok = await db.rentLease.updateMany({ where: { id: l.id, OR: [{ expiryNotice: null }, { expiryNotice: { gt: step } }] }, data: { expiryNotice: step } });
    if (!ok.count) continue;
    const who = `${l.shop.name} (${l.shop.location})${l.tenantName ? ` — ${l.tenantName}` : ""}`;
    await notifyRoles(["SECRETARY"], {
      type: "RENT_LEASE_EXPIRY",
      title: left < 0 ? "Ijara shartnomasi muddati tugagan" : left === 0 ? "Ijara shartnomasi bugun tugaydi" : `Ijara shartnomasi ${left} kundan keyin tugaydi`,
      body: `${who}. Shartnomani uzaytiring (do'kon kartasida tugash sanasini o'zgartiring) yoki joyni bo'shatish/ijarachini almashtirishni rejalashtiring.`,
      channel: "oddiy",
    });
    sent++;
  }
  return sent;
}

// ───────────────────────── Narx o'zgarishi ─────────────────────────

/** Yangi narx shu oy uchun kiritilsa bo'ladimi: do'konning shu oy hisobi hali ochilmagan bo'lsin. */
async function priceMonthError(tx: Prisma.TransactionClient | typeof db, shopId: string, fromMonth: Date): Promise<string | null> {
  if (fromMonth < currentMonth()) return "O'tgan oy uchun narx o'zgartirilmaydi — oy hisobini jadvalda tuzating";
  const opened = await tx.rentCharge.findFirst({ where: { shopId, month: { gte: fromMonth }, lease: { status: "ACTIVE" } }, select: { month: true } });
  return opened ? `${monthLabel(opened.month)} hisobi allaqachon ochilgan — keyingi oyni tanlang yoki shu oy summasini jadvalda tuzating` : null;
}

/** Bitta do'kon uchun «X oydan yangi narx». Shu oy uchun avval kiritilgan (qo'llanmagan) o'zgarish bo'lsa — almashtiriladi. */
export async function addPriceChange(shopId: string, d: { fromMonth: Date; bankAmount: number; cashAmount: number; note: string | null }, userId: string): Promise<{ error?: string }> {
  const shop = await db.rentShop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) return { error: "Do'kon topilmadi" };
  const err = await priceMonthError(db, shopId, d.fromMonth);
  if (err) return { error: err };
  await db.$transaction(async (tx) => {
    const old = await tx.rentPriceChange.findMany({ where: { shopId, fromMonth: d.fromMonth, appliedAt: null, cancelledAt: null } });
    if (old.length) await tx.rentPriceChange.updateMany({ where: { id: { in: old.map((o) => o.id) } }, data: { cancelledAt: new Date() } });
    const c = await tx.rentPriceChange.create({ data: { shopId, ...d, createdById: userId } });
    await audit(tx, userId, "CREATE", "RentPriceChange", c.id, undefined, c);
  });
  return {};
}

/**
 * Butun bozor (joy) bo'yicha narxni % ga o'zgartirish: ijaradagi har do'kon uchun yangi narx = hozirgi andoza × (1 + % / 100),
 * 1000 so'mga yaxlitlanadi. Shu oy hisobi ochilgan do'konlar o'tkazib yuboriladi (soni qaytariladi).
 */
export async function addPriceChangeBulk(location: string, d: { fromMonth: Date; percent: number; note: string | null }, userId: string): Promise<{ error?: string; created?: number; skipped?: number }> {
  if (!(d.percent > -100) || d.percent === 0) return { error: "Foizni kiriting (masalan 10 yoki −5)" };
  const shops = await db.rentShop.findMany({ where: { location, isActive: true } });
  if (!shops.length) return { error: "Bu joyda ijaradagi do'kon yo'q" };
  const k = 1 + d.percent / 100;
  const round = (v: number) => (v >= 1000 ? Math.round(v / 1000) * 1000 : r2(v));
  let created = 0, skipped = 0;
  for (const s of shops) {
    const r = await addPriceChange(s.id, { fromMonth: d.fromMonth, bankAmount: round(n(s.bankAmount) * k), cashAmount: round(n(s.cashAmount) * k), note: d.note ?? `${location}: ${d.percent > 0 ? "+" : ""}${fmtNum(d.percent, 2)}%` }, userId);
    if (r.error) skipped++; else created++;
  }
  return { created, skipped };
}

/** Qo'llanmagan narx o'zgarishini bekor qilish. */
export async function cancelPriceChange(id: string, userId: string): Promise<{ error?: string; shopId?: string }> {
  const c = await db.rentPriceChange.findUnique({ where: { id } });
  if (!c) return { error: "Topilmadi" };
  const ok = await db.rentPriceChange.updateMany({ where: { id, appliedAt: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
  if (!ok.count) return { error: "Bu o'zgarish allaqachon qo'llangan yoki bekor qilingan" };
  await audit(db, userId, "STATUS_CHANGE", "RentPriceChange", id, { cancelledAt: null }, { cancelledAt: new Date() });
  return { shopId: c.shopId };
}

// ───────────────────────── Hujjat va suratlar ─────────────────────────

export const RENT_FILE_KINDS = ["Shartnoma", "Pasport nusxasi", "Do'kon rasmi", "Dalolatnoma", "Boshqa"] as const;
export const RENT_FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
export const RENT_FILE_MAX_MB = 15;

async function saveRentUpload(shopId: string, file: File): Promise<SavedFile | { error: string }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shopId)) return { error: "Do'kon topilmadi" };
  if (file.size > RENT_FILE_MAX_MB * 1024 * 1024) return { error: `"${file.name}" — ${RENT_FILE_MAX_MB} MB dan katta` };
  const f = await readUpload(file, ["pdf", "jpg", "png", "webp"]);
  if (!f) return { error: `"${file.name}" — PDF yoki rasm (JPG, PNG, WEBP) bo'lishi kerak` };
  const dir = path.join(UPLOADS_DIR, "rent");
  await mkdir(dir, { recursive: true });
  const stored = `${shopId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${f.ext}`;
  await writeFile(path.join(dir, stored), f.buf);
  return { stored, name: file.name || `hujjat.${f.ext}`, type: f.mime };
}

/** Saqlangan nomdan diskdagi yo'l — faqat bizning nomlash sxemamiz (yo'l bo'ylab yurish yo'q). */
export function rentFilePath(stored: string) {
  if (!/^[\w-]+\.(pdf|jpg|png|webp)$/.test(stored)) return null;
  return path.join(UPLOADS_DIR, "rent", stored);
}

/** Do'kon kartasiga hujjat/surat qo'shish (bir nechta fayl). Joriy shartnomaga bog'lanadi (bo'lsa). */
export async function addRentFiles(shopId: string, kind: string, files: File[], userId: string): Promise<{ error?: string; count?: number }> {
  if (!(RENT_FILE_KINDS as readonly string[]).includes(kind)) return { error: "Hujjat turini tanlang" };
  const real = files.filter((f) => f.size > 0);
  if (!real.length) return { error: "Faylni tanlang" };
  if (real.length > 10) return { error: "Bir martada 10 tadan ko'p fayl yuklanmaydi" };
  const shop = await db.rentShop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) return { error: "Do'kon topilmadi" };
  const lease = await db.rentLease.findFirst({ where: { shopId, status: "ACTIVE" }, select: { id: true } });
  let count = 0;
  for (const file of real) {
    const saved = await saveRentUpload(shopId, file);
    if ("error" in saved) return { error: saved.error, count };
    const f = await db.rentFile.create({ data: { shopId, leaseId: lease?.id ?? null, kind, file: saved.stored, fileName: saved.name.slice(0, 200), fileType: saved.type, createdById: userId } });
    await audit(db, userId, "CREATE", "RentFile", f.id, undefined, f);
    count++;
  }
  return { count };
}

/** Faylni ro'yxatdan olib tashlash — diskda qoladi (audit uchun), kartada ko'rinmaydi. */
export async function removeRentFile(id: string, userId: string): Promise<{ error?: string; shopId?: string }> {
  const f = await db.rentFile.findUnique({ where: { id } });
  if (!f) return { error: "Fayl topilmadi" };
  const ok = await db.rentFile.updateMany({ where: { id, removedAt: null }, data: { removedAt: new Date(), removedById: userId } });
  if (ok.count) await audit(db, userId, "STATUS_CHANGE", "RentFile", id, { removedAt: null }, { removedAt: new Date() });
  return { shopId: f.shopId };
}

// ───────────────────────── Bandlik tahlili ─────────────────────────

export type RentLocationStat = {
  location: string; total: number; on: number; off: number;
  /** Maydon (m²): jami, ijarada, bo'sh; maydoni kiritilmagan joylar soni */
  area: number; areaOn: number; areaOff: number; noArea: number;
  /** Oylik daromad (andoza bo'yicha; kunlik ijara — kunlik × 30) */
  monthly: number;
  /** Ijaradagi 1 m² o'rtacha oylik narx */
  perM2: number | null;
  /** Bo'sh maydon shu bozorning o'rtacha narxida ijaraga berilsa — oyiga */
  lost: number | null;
};

const monthlyRate = (s: { period: string; bankAmount: Prisma.Decimal; cashAmount: Prisma.Decimal }) =>
  (n(s.bankAmount) + n(s.cashAmount)) * (s.period === "DAILY" ? 30 : 1);

/** Bozorlar bo'yicha bandlik va daromad (do'kon andozalaridan). */
export async function rentOccupancy(): Promise<{ rows: RentLocationStat[]; total: RentLocationStat }> {
  const shops = await db.rentShop.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const locs = [...new Set(shops.map((s) => s.location))];
  const stat = (location: string, xs: typeof shops): RentLocationStat => {
    const on = xs.filter((x) => x.isActive), off = xs.filter((x) => !x.isActive);
    const area = (ys: typeof shops) => r2(ys.reduce((a, y) => a + n(y.area), 0));
    const areaOn = area(on), areaOff = area(off);
    const monthly = r2(on.reduce((a, x) => a + monthlyRate(x), 0));
    // 1 m² narxi — faqat maydoni kiritilgan ijaradagi joylardan
    const priced = on.filter((x) => n(x.area) > 0);
    const pricedArea = area(priced);
    const perM2 = pricedArea > 0 ? r2(priced.reduce((a, x) => a + monthlyRate(x), 0) / pricedArea) : null;
    return {
      location, total: xs.length, on: on.length, off: off.length, area: area(xs), areaOn, areaOff, noArea: xs.filter((x) => !(n(x.area) > 0)).length,
      monthly, perM2, lost: perM2 !== null && areaOff > 0 ? Math.round(perM2 * areaOff) : null,
    };
  };
  const rows = locs.map((l) => stat(l, shops.filter((s) => s.location === l)));
  const total = stat("Jami", shops);
  // Jami yo'qotish — har bozor o'z narxida (umumiy o'rtacha emas)
  total.lost = rows.some((r) => r.lost !== null) ? rows.reduce((a, r) => a + (r.lost ?? 0), 0) : null;
  return { rows, total };
}

export type RentMonthStat = { key: string; label: string; due: number; paid: number; rate: number | null };

/** Oxirgi oylar bo'yicha yig'im: hisoblangan, shu oy uchun tushgan va foizi. */
export async function rentCollection(count = 6): Promise<RentMonthStat[]> {
  const now = currentMonth();
  const from = shiftMonth(now, -(count - 1));
  const [charges, paid] = await Promise.all([
    db.rentCharge.groupBy({ by: ["month"], where: { month: { gte: from, lte: now } }, _sum: { bankDue: true, cashDue: true } }),
    db.rentTx.groupBy({ by: ["month"], where: { ...RENT_PAID, month: { gte: from, lte: now } }, _sum: { amount: true } }),
  ]);
  return Array.from({ length: count }, (_, i) => {
    const m = shiftMonth(from, i), key = monthKey(m);
    const c = charges.find((x) => monthKey(x.month) === key);
    const due = r2(n(c?._sum.bankDue) + n(c?._sum.cashDue));
    const p = r2(n(paid.find((x) => x.month && monthKey(x.month) === key)?._sum.amount));
    return { key, label: monthLabel(m), due, paid: p, rate: due > 0 ? Math.round((p / due) * 100) : null };
  });
}
