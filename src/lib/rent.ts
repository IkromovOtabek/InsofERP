import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, type RentMethod, type RentPeriod, type RentShop, type RentTxType } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { date, money } from "./format";
import { notifyAfter } from "./notify";

/**
 * Arenda (do'konlar ijarasi) — sekretar yuritadi, Excel'dagi «Аренда» daftarining o'rnini bosadi.
 *
 *  · RentShop   — do'kon/joy, `location` bo'yicha guruh (Texno siti bozor, Makro, Gulbozor ...);
 *  · RentLease  — ijara shartnomasi (bitta ijarachi bilan davr): oy hisoblari va kirimlar shunga bog'lanadi, ijarachi
 *                 almashsa eskisining qarzi o'z shartnomasida qoladi. Do'konda bir vaqtda bitta amaldagi (ACTIVE);
 *                 ijara oylik yoki kunlik (`period`): kunlikda oy hisobi = kunlik summa × kunlar, kirim — «qaysi kun uchun»;
 *  · RentCharge — oylik hisob (oy varag'ining qatori): perechisleniye + naqd = jami to'lashi kerak;
 *                 svet — do'konda «svetni ijarachi to'laydi» bo'lsa qarzga qo'shiladi (`elecDue`), aks holda ma'lumot uchun;
 *                 biz to'laydigan soliq — ma'lumot uchun, qoldiqqa ta'sir qilmaydi (Excel'dagidek);
 *  · RentTx     — arenda kassasi jurnali: kirim (ijarachidan, qaysi oy uchun) va chiqim. O'chirilmaydi, faqat storno.
 *
 * Qoldiq (oy) = jami to'lashi kerak − shu oy uchun tushgan kirim. Arenda kassasi = kirimlar − chiqimlar (usul bo'yicha).
 * Arenda kassasi zavodning asosiy Kassa/bank hisobidan alohida — u yerga topshirilgan pul «Kassaga topshirildi» chiqimi.
 */

type Tx = Prisma.TransactionClient;

export const RENT_METHOD_LABEL: Record<RentMethod, string> = { CASH: "Naqd", BANK: "Perechisleniye" };
export const RENT_PERIOD_LABEL: Record<RentPeriod, string> = { MONTHLY: "Oylik", DAILY: "Kunlik" };
export const RENT_INCOME_CATEGORY = "Arenda to'lovi";
export const RENT_EXPENSE_CATEGORIES = ["Kassaga topshirildi", "Svet", "Soliq", "Ta'mirlash", "Qaytarildi (ijarachiga)", "Boshqa"] as const;

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];

/** "2026-10" → oyning 1-kuni (UTC yarim tun — `@db.Date` ustuni shunday saqlaydi). Noto'g'ri bo'lsa — null. */
export function parseMonth(v: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(v ?? "");
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null;
  return new Date(Date.UTC(y, mo - 1, 1));
}
export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const monthLabel = (d: Date) => `${d.getUTCFullYear()}-yil ${MONTHS[d.getUTCMonth()].toLowerCase()}`;
export const shiftMonth = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
/** Zavod vaqti bo'yicha joriy oy (server UTC da bo'lsa ham oy boshida adashmasin). */
export function currentMonth(): Date {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}
/** Oyning sana oralig'i (jurnal filtri): [boshi, keyingi oy boshi). Sana formadan "yyyy-mm-dd" — UTC yarim tun bo'lib yoziladi. */
export const monthRange = (month: Date) => ({ gte: month, lt: shiftMonth(month, 1) });
/** Kirim qaysi davr uchun: kunlik ijarada — kun, aks holda — oy (kvitansiya, xabar, jurnal). */
export function rentFor(tx: { day: Date | null; month: Date | null }): { label: string; value: string } | null {
  if (tx.day) return { label: "Qaysi kun uchun", value: date(tx.day) };
  return tx.month ? { label: "Qaysi oy uchun", value: monthLabel(tx.month) } : null;
}
/** Oydagi kunlar soni (kunlik ijara hisobi uchun). */
export const daysInMonth = (month: Date) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
/** Sananing oyi (oyning 1-kuni, UTC). */
export const monthOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
/** Zavod vaqti bo'yicha bugungi sana (UTC yarim tun — `@db.Date` kabi). */
export function today(): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Oy hisobi bo'yicha jami to'lashi kerak: perechisleniye + naqd + ijarachidan undiriladigan svet. */
export const chargeDue = (c: { bankDue: Prisma.Decimal | number; cashDue: Prisma.Decimal | number; elecDue?: Prisma.Decimal | number | null }) =>
  r2(n(c.bankDue) + n(c.cashDue) + n(c.elecDue));

// ───────────────────────── Shartnomalar (ijara davrlari) ─────────────────────────

export type LeaseRef = { id: string; shopId: string; status: "ACTIVE" | "ENDED"; startDate: Date; createdAt: Date };

/**
 * Do'konning «joriy» shartnomasi: amaldagisi, bo'lmasa (bo'sh joy) — eng oxirgisi. Do'kon kartasi, qarz va eslatma shu
 * shartnoma bo'yicha; oldingi ijarachilar qarzi o'z shartnomasida alohida qoladi.
 */
export async function currentLeases(shopIds?: string[], tx: Tx | typeof db = db): Promise<Map<string, LeaseRef>> {
  const all = await tx.rentLease.findMany({
    where: shopIds ? { shopId: { in: shopIds } } : {},
    select: { id: true, shopId: true, status: true, startDate: true, createdAt: true },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
  const m = new Map<string, LeaseRef>();
  for (const l of all) {
    const cur = m.get(l.shopId);
    if (!cur || (cur.status !== "ACTIVE" && l.status === "ACTIVE")) m.set(l.shopId, l);
  }
  return m;
}

/** Shartnomalar bo'yicha qarz (barcha oylar): hisoblangan − tushgan. Musbat — qarz, manfiy — avans. */
export async function leaseDebts(leaseIds?: string[]): Promise<Map<string, number>> {
  const where = leaseIds ? { leaseId: { in: leaseIds } } : {};
  const [due, paid] = await Promise.all([
    db.rentCharge.groupBy({ by: ["leaseId"], where, _sum: { bankDue: true, cashDue: true, elecDue: true } }),
    db.rentTx.groupBy({ by: ["leaseId"], where: { ...where, type: "INCOME", cancelledAt: null, leaseId: leaseIds ? { in: leaseIds } : { not: null } }, _sum: { amount: true } }),
  ]);
  const m = new Map<string, number>();
  for (const d of due) m.set(d.leaseId, chargeDue({ bankDue: n(d._sum.bankDue), cashDue: n(d._sum.cashDue), elecDue: n(d._sum.elecDue) }));
  for (const p of paid) m.set(p.leaseId!, r2((m.get(p.leaseId!) ?? 0) - n(p._sum.amount)));
  return m;
}

export type SheetRow = {
  shopId: string; leaseId: string; chargeId: string | null; name: string; location: string; isActive: boolean;
  /** Shu hisob qaysi ijarachiniki (oy o'rtasida ijarachi almashsa do'kon ikki qatorda chiqadi) */
  tenantName: string | null; former: boolean;
  /** Kunlik ijara: hisoblangan kunlar va bir kunlik summa (andoza) — jadvalda kun o'zgarsa summa qayta hisoblanadi */
  period: RentPeriod; days: number | null; bankRate: number; cashRate: number;
  /** Svet: hisoblagich ko'rsatkichlari va ijarachidan undiriladimi */
  meterStart: number | null; meterEnd: number | null; elecBilled: boolean;
  bankDue: number; cashDue: number; elecDue: number; due: number; electricity: number; tax: number;
  bankPaid: number; cashPaid: number; paid: number; left: number; note: string | null;
};
type SumKey = "bankDue" | "cashDue" | "elecDue" | "due" | "electricity" | "tax" | "bankPaid" | "cashPaid" | "paid" | "left";
export type SheetGroup = { location: string; rows: SheetRow[]; total: Record<SumKey, number> };

const ZERO: Record<SumKey, number> = { bankDue: 0, cashDue: 0, elecDue: 0, due: 0, electricity: 0, tax: 0, bankPaid: 0, cashPaid: 0, paid: 0, left: 0 };
function sum(rows: SheetRow[]) {
  const t = { ...ZERO };
  for (const r of rows) for (const k of Object.keys(t) as SumKey[]) t[k] += r[k];
  return t;
}

/** Oy varag'i: bozor bo'yicha guruhlar, har guruhda «Umumiy», oxirida jami. Qator — shartnomaning shu oy hisobi. */
export async function monthSheet(month: Date) {
  const [charges, paid] = await Promise.all([
    db.rentCharge.findMany({ where: { month }, include: { shop: true, lease: { select: { tenantName: true, status: true } } } }),
    db.rentTx.groupBy({ by: ["leaseId", "method"], where: { type: "INCOME", month, cancelledAt: null, leaseId: { not: null } }, _sum: { amount: true } }),
  ]);
  const paidMap = new Map<string, { CASH: number; BANK: number }>();
  for (const p of paid) {
    const cur = paidMap.get(p.leaseId!) ?? { CASH: 0, BANK: 0 };
    cur[p.method] += n(p._sum.amount);
    paidMap.set(p.leaseId!, cur);
  }
  // Hisobi ochilmagan, lekin shu oy uchun pul tushgan shartnoma ham jadvalda ko'rinsin (to'lashi kerak 0)
  const missing = [...paidMap.keys()].filter((id) => !charges.some((c) => c.leaseId === id));
  const extra = missing.length ? await db.rentLease.findMany({ where: { id: { in: missing } }, include: { shop: true } }) : [];

  const rows: SheetRow[] = [
    ...charges.map((c) => ({ shop: c.shop, leaseId: c.leaseId, lease: c.lease, c })),
    ...extra.map((l) => ({ shop: l.shop, leaseId: l.id, lease: { tenantName: l.tenantName, status: l.status }, c: null })),
  ].sort((a, b) => a.shop.sortOrder - b.shop.sortOrder || a.shop.createdAt.getTime() - b.shop.createdAt.getTime() || Number(a.lease.status === "ACTIVE") - Number(b.lease.status === "ACTIVE"))
    .map(({ shop, leaseId, lease, c }) => {
      const p = paidMap.get(leaseId) ?? { CASH: 0, BANK: 0 };
      const bankDue = n(c?.bankDue), cashDue = n(c?.cashDue), elecDue = n(c?.elecDue), due = r2(bankDue + cashDue + elecDue), paidAll = p.BANK + p.CASH;
      return {
        shopId: shop.id, leaseId, chargeId: c?.id ?? null, name: shop.name, location: shop.location, isActive: shop.isActive,
        tenantName: lease.tenantName, former: lease.status !== "ACTIVE",
        period: shop.period, days: c?.days ?? null, bankRate: n(shop.bankAmount), cashRate: n(shop.cashAmount),
        meterStart: c?.meterStart != null ? n(c.meterStart) : null, meterEnd: c?.meterEnd != null ? n(c.meterEnd) : null,
        elecBilled: c ? n(c.elecDue) > 0 || shop.electricityBilled : shop.electricityBilled,
        bankDue, cashDue, elecDue, due, electricity: n(c?.electricity), tax: n(c?.tax),
        bankPaid: p.BANK, cashPaid: p.CASH, paid: paidAll, left: r2(due - paidAll), note: c?.note ?? null,
      };
    });

  // Guruhlar tartibi — guruhdagi birinchi do'kon tartibi bo'yicha (Excel'dagidek, qo'shilgan tartibda)
  const groups: SheetGroup[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.location === r.location);
    if (!g) { g = { location: r.location, rows: [], total: { ...ZERO } }; groups.push(g); }
    g.rows.push(r);
  }
  for (const g of groups) g.total = sum(g.rows);
  return { groups, total: sum(groups.flatMap((g) => g.rows)), opened: charges.length > 0 };
}

/** Arenda kassasi qoldig'i (butun davr): kirim − chiqim, usul bo'yicha. Storno qilinganlar hisobga kirmaydi. */
export async function rentBalance(tx: Tx | typeof db = db) {
  const g = await tx.rentTx.groupBy({ by: ["type", "method"], where: { cancelledAt: null }, _sum: { amount: true } });
  const b = { CASH: 0, BANK: 0 };
  for (const x of g) b[x.method] += (x.type === "INCOME" ? 1 : -1) * n(x._sum.amount);
  return { cash: r2(b.CASH), bank: r2(b.BANK), total: r2(b.CASH + b.BANK) };
}

/** Do'konlar bo'yicha qarz — joriy shartnoma (hozirgi yoki oxirgi ijarachi) bo'yicha. Musbat — qarz, manfiy — avans. */
export async function shopDebts(): Promise<Map<string, number>> {
  const [cur, debts] = await Promise.all([currentLeases(), leaseDebts()]);
  const m = new Map<string, number>();
  for (const [shopId, l] of cur) m.set(shopId, debts.get(l.id) ?? 0);
  return m;
}

/* ───────────────────────── Yozuvchi amallar ───────────────────────── */

class RentError extends Error {}

/** Arenda kassasi bo'yicha qulf: parallel chiqimlar qoldiqni ikki marta «ko'rib» minusga tushirmasin. */
const lockKassa = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rent:kassa'))`;
/** Do'kon shartnomalari bo'yicha qulf: bir vaqtda ikki «ijaraga berish» ikkita amaldagi shartnoma ochmasin. */
const lockShop = (tx: Tx, shopId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rent:shop:${shopId}`}))`;

async function outflowError(tx: Tx, method: RentMethod, amount: number): Promise<string | null> {
  const b = await rentBalance(tx);
  const have = method === "CASH" ? b.cash : b.bank;
  return amount > have + 0.005 ? `Arenda kassasida ${RENT_METHOD_LABEL[method].toLowerCase()} qoldiq ${money(have)} — ${money(amount)} chiqim qilib bo'lmaydi` : null;
}

/** «Necha oyga» to'lovda eng ko'p oylar soni. */
export const RENT_MAX_MONTHS = 12;

export type RentTxInput = {
  type: RentTxType; method: RentMethod; date: Date; month: Date | null; shopId: string | null;
  amount: number; category: string; note: string | null; clientToken: string | null;
  /** Kunlik ijara kirimi — qaysi kun uchun (oy shu kundan olinadi) */
  day?: Date | null;
  /** Kirim qaysi shartnoma (ijarachi) qarzi uchun; berilmasa — do'konning joriy shartnomasi */
  leaseId?: string | null;
  /** Oylik ijarada bir necha oyga to'lov: summa `month` dan boshlab shuncha oyga teng bo'linadi (bitta kvitansiya) */
  months?: number;
};

/** `amount` ni `k` ta teng bo'lakka (tiyin qoldig'i oxirgisiga). */
function splitEven(amount: number, k: number): number[] {
  const base = Math.floor((amount / k) * 100) / 100;
  return Array.from({ length: k }, (_, i) => (i === k - 1 ? r2(amount - base * (k - 1)) : base));
}

/**
 * Kirim/chiqim yozish. Kirim bo'lsa — ijarachi Telegram'ga ulangan bo'lsa unga «to'lov qabul qilindi» xabari (javobdan keyin).
 * Kunlik ijarali do'kon kirimida «qaysi kun uchun» shart, oy shu kundan olinadi; o'sha kunga avval ham kirim bo'lsa — `sameDay` (ogohlantirish).
 * Kirim shartnomaga bog'lanadi (sukut — do'konning joriy shartnomasi). «Necha oyga» (`months` > 1) — summa oylarga bo'linib,
 * bir guruh (`batchId`) bo'lib yoziladi; kvitansiya va storno guruh bo'yicha.
 */
export async function createRentTx(input: RentTxInput, userId: string): Promise<{ error?: string; duplicate?: boolean; id?: string; sameDay?: number }> {
  const amount = r2(input.amount);
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  const shop = input.shopId ? await db.rentShop.findUnique({ where: { id: input.shopId }, select: { id: true, period: true } }) : null;
  if (input.shopId && !shop) return { error: "Do'kon topilmadi" };
  const months = Math.max(1, Math.min(RENT_MAX_MONTHS, Math.trunc(input.months ?? 1)));
  let day: Date | null = null;
  let leaseId: string | null = null;
  if (input.type === "INCOME") {
    if (shop?.period === "DAILY") {
      if (!input.day) return { error: "Kunlik ijara — qaysi kun uchun to'lov ekanini tanlang" };
      if (months > 1) return { error: "Kunlik ijarada «necha oyga» to'lov yo'q — har kun alohida yoziladi" };
      day = input.day;
      input = { ...input, month: monthOf(day) };
    }
    if (!input.shopId || !input.month) return { error: "Kirim uchun do'kon va oyni tanlang" };
    if (input.leaseId) {
      const l = await db.rentLease.findUnique({ where: { id: input.leaseId }, select: { shopId: true } });
      if (!l || l.shopId !== input.shopId) return { error: "Shartnoma topilmadi" };
      leaseId = input.leaseId;
    } else {
      leaseId = (await currentLeases([input.shopId])).get(input.shopId)?.id ?? null;
      if (!leaseId) return { error: "Bu joy hali ijaraga berilmagan — avval do'kon kartasida «Ijaraga berish» ni bosing" };
    }
  }
  const dup = input.clientToken ? await db.rentTx.findUnique({ where: { clientToken: input.clientToken }, select: { id: true } }) : null;
  if (dup) return { duplicate: true, id: dup.id };
  const parts = months > 1 ? splitEven(amount, months) : [amount];
  if (parts.some((x) => !(x > 0))) return { error: "Summa oylarga bo'linganda har biri 0 dan katta bo'lsin" };
  const batchId = parts.length > 1 ? randomUUID() : null;
  try {
    const id = await db.$transaction(async (tx) => {
      await lockKassa(tx);
      if (input.type === "EXPENSE") {
        const err = await outflowError(tx, input.method, amount);
        if (err) throw new RentError(err);
      }
      let first = "";
      for (let i = 0; i < parts.length; i++) {
        const t = await tx.rentTx.create({
          data: {
            type: input.type, method: input.method, date: input.date, shopId: input.shopId, category: input.category, note: input.note,
            day, leaseId, batchId, amount: parts[i], createdById: userId,
            month: i && input.month ? shiftMonth(input.month, i) : input.month,
            clientToken: input.clientToken && i ? `${input.clientToken}-${i}` : input.clientToken,
          },
        });
        await audit(tx, userId, "CREATE", "RentTx", t.id, undefined, t);
        if (!i) first = t.id;
      }
      return first;
    });
    // Modul aylanmasin (rent-receipt → rent-tenant → rent): xabar moduli kerak bo'lganda yuklanadi
    if (input.type === "INCOME") notifyAfter(async () => (await import("./rent-receipt")).notifyRentPayment(id));
    const sameDay = day ? await db.rentTx.count({ where: { shopId: input.shopId, day, type: "INCOME", cancelledAt: null, id: { not: id } } }) : 0;
    return { id, sameDay };
  } catch (e) {
    if (e instanceof RentError) return { error: e.message };
    // Bir xil kalit bilan ikki so'rov birga kelsa — ikkinchisi unique xatosi oladi: birinchisi saqlangan
    if (input.clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { duplicate: true };
    throw e;
  }
}

/** Storno: «necha oyga» to'lovning bitta yozuvi bekor qilinsa — butun guruh (bitta kvitansiya) bekor bo'ladi. */
export async function cancelRentTx(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  const why = reason.trim();
  if (why.length < 3) return { error: "Bekor qilish sababini yozing" };
  try {
    await db.$transaction(async (tx) => {
      await lockKassa(tx);
      const t = await tx.rentTx.findUnique({ where: { id } });
      if (!t) throw new RentError("Yozuv topilmadi");
      const group = t.batchId ? await tx.rentTx.findMany({ where: { batchId: t.batchId, cancelledAt: null } }) : t.cancelledAt ? [] : [t];
      if (!group.length) return; // allaqachon storno (ikki marta bosilgan)
      // Kirimni bekor qilish ham kassani minusga tushirishi mumkin (pul allaqachon chiqim qilingan bo'lsa)
      if (t.type === "INCOME") {
        for (const method of ["CASH", "BANK"] as const) {
          const sumM = group.filter((g) => g.method === method).reduce((a, g) => a + n(g.amount), 0);
          const err = sumM > 0 ? await outflowError(tx, method, sumM) : null;
          if (err) throw new RentError(`Bu kirim bekor qilinsa kassa minusga tushadi. ${err}`);
        }
      }
      for (const g of group) {
        const ok = await tx.rentTx.updateMany({ where: { id: g.id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: why } });
        if (ok.count) await audit(tx, userId, "STATUS_CHANGE", "RentTx", g.id, { cancelledAt: null }, { cancelledAt: new Date(), cancelReason: why });
      }
    });
    return {};
  } catch (e) {
    if (e instanceof RentError) return { error: e.message };
    throw e;
  }
}

/** Svet: hisoblagich ko'rsatkichidan summa (tarif 0 yoki ko'rsatkich to'liq bo'lmasa — null, summa qo'lda). */
export function meterAmount(start: number | null | undefined, end: number | null | undefined, kwhPrice: number): number | null {
  if (start == null || end == null || !(kwhPrice > 0) || end < start) return null;
  return Math.round((end - start) * kwhPrice);
}

type PrevCharge = { bankDue: Prisma.Decimal; cashDue: Prisma.Decimal; electricity: Prisma.Decimal; tax: Prisma.Decimal } | null;
type ChargeShop = Pick<RentShop, "id" | "period" | "bankAmount" | "cashAmount" | "electricity" | "tax" | "electricityBilled">;

/**
 * Shartnomaning yangi oy hisobi. Oylik: shu shartnomaning o'tgan oy hisobidan nusxa (bo'lmasa andoza).
 * Kunlik: kunlik summa (andoza) × oydagi kunlar — oylar uzunligi har xil, shuning uchun o'tgan oy jami ko'chirilmaydi;
 * svet va soliq oylik bo'lgani uchun o'tgan oydan olinadi. Svet hisoblagichi: oy boshi = o'tgan oy oxiri (`meterStart`).
 * Joriy oy o'rtasida qo'shilgan / ijaraga berilgan kunlik joy — bugundan oy oxirigacha hisoblanadi (`fromToday`).
 * `price` — shu oydan kuchga kirgan yangi narx (o'tgan oy summasi o'rniga).
 */
function chargeData(s: ChargeShop, leaseId: string, p: PrevCharge, month: Date, opts: { fromToday?: boolean; meterStart?: Prisma.Decimal | null; price?: { bankAmount: Prisma.Decimal; cashAmount: Prisma.Decimal } } = {}) {
  const electricity = p?.electricity ?? s.electricity;
  const extra = { electricity, tax: p?.tax ?? s.tax, elecDue: s.electricityBilled ? electricity : 0, meterStart: opts.meterStart ?? null };
  const rate = opts.price ?? s;
  if (s.period === "DAILY") {
    const t = today();
    const from = opts.fromToday && monthKey(month) === monthKey(monthOf(t)) ? t.getUTCDate() : 1;
    const days = daysInMonth(month) - from + 1;
    return { shopId: s.id, leaseId, month, days, bankDue: r2(n(rate.bankAmount) * days), cashDue: r2(n(rate.cashAmount) * days), ...extra };
  }
  const copy = !opts.price && p;
  return { shopId: s.id, leaseId, month, bankDue: copy ? p.bankDue : rate.bankAmount, cashDue: copy ? p.cashDue : rate.cashAmount, ...extra };
}

/** Do'konning eng oxirgi svet ko'rsatkichi (shartnomadan qat'i nazar — hisoblagich joyda qoladi). */
async function lastMeter(tx: Tx | typeof db, shopId: string, before: Date) {
  const c = await tx.rentCharge.findFirst({ where: { shopId, month: { lt: before }, meterEnd: { not: null } }, orderBy: { month: "desc" }, select: { meterEnd: true } });
  return c?.meterEnd ?? null;
}

/**
 * Oyni ochish: amaldagi shartnomalar uchun oylik hisob — shu shartnomaning o'tgan oy hisobidan nusxa (bo'lmasa do'kon
 * andozasi), kunlikda — kun × summa. Shu oydan kuchga kirgan narx o'zgarishi (`RentPriceChange`) avval qo'llanadi:
 * do'kon andozasi yangilanadi va hisob yangi narxdan ochiladi. Takror chaqirilsa faqat yetishmaganlar qo'shiladi.
 */
export async function openMonth(month: Date, userId: string): Promise<{ created: number; priced: number }> {
  const leases = await db.rentLease.findMany({ where: { status: "ACTIVE", startDate: { lt: shiftMonth(month, 1) } }, include: { shop: true } });
  const existing = new Set((await db.rentCharge.findMany({ where: { month, leaseId: { in: leases.map((l) => l.id) } }, select: { leaseId: true } })).map((c) => c.leaseId));
  const todo = leases.filter((l) => !existing.has(l.id));
  if (!todo.length) return { created: 0, priced: 0 };
  const [prev, meters, changes] = await Promise.all([
    db.rentCharge.findMany({ where: { leaseId: { in: todo.map((l) => l.id) }, month: { lt: month } }, orderBy: { month: "desc" }, distinct: ["leaseId"] }),
    db.rentCharge.findMany({ where: { shopId: { in: todo.map((l) => l.shopId) }, month: { lt: month }, meterEnd: { not: null } }, orderBy: { month: "desc" }, distinct: ["shopId"], select: { shopId: true, meterEnd: true } }),
    db.rentPriceChange.findMany({ where: { shopId: { in: todo.map((l) => l.shopId) }, appliedAt: null, cancelledAt: null, fromMonth: { lte: month } }, orderBy: [{ fromMonth: "desc" }, { createdAt: "desc" }] }),
  ]);
  const last = new Map(prev.map((c) => [c.leaseId, c]));
  const meter = new Map(meters.map((c) => [c.shopId, c.meterEnd]));
  let created = 0, priced = 0;
  await db.$transaction(async (tx) => {
    for (const l of todo) {
      const change = changes.find((c) => c.shopId === l.shopId);
      let shop = l.shop;
      if (change) {
        // Eng so'nggi o'zgarish qo'llanadi; undan oldingi qo'llanmaganlari ham «qo'llangan» bo'ladi (eskirgan)
        shop = await tx.rentShop.update({ where: { id: l.shopId }, data: { bankAmount: change.bankAmount, cashAmount: change.cashAmount } });
        await tx.rentPriceChange.updateMany({ where: { shopId: l.shopId, appliedAt: null, cancelledAt: null, fromMonth: { lte: month } }, data: { appliedAt: new Date() } });
        await audit(tx, userId, "UPDATE", "RentShop", l.shopId, { bankAmount: l.shop.bankAmount, cashAmount: l.shop.cashAmount }, { bankAmount: change.bankAmount, cashAmount: change.cashAmount, priceChange: change.id });
        priced++;
      }
      const r = await tx.rentCharge.createMany({
        data: [chargeData(shop, l.id, last.get(l.id) ?? null, month, { meterStart: meter.get(l.shopId) ?? null, price: change ?? undefined })],
        skipDuplicates: true,
      });
      created += r.count;
    }
    if (created) await audit(tx, userId, "CREATE", "RentCharge", monthKey(month), undefined, { month: monthKey(month), created, priced });
  }, { timeout: 60_000 });
  return { created, priced };
}

// ───────────────────────── Do'kon kartasi ─────────────────────────

/** `isActive` — joy ijarada (amaldagi shartnoma bor, pul olinadi); `false` — bo'sh joy, oy hisobiga tushmaydi. */
export const RENT_SHOP_STATUS = { on: "Ijarada", off: "Bo'sh" } as const;

/** Do'kon maydoni (m²) chegarasi — veb va mobil forma bir xil tekshiradi */
export const RENT_AREA_MAX = 100_000;

/** 1 m² ijara narxi (oylik yoki kunlik — `period` bo'yicha); maydon kiritilmagan bo'lsa — null */
export function rentPerM2(s: { area: Prisma.Decimal | number | null; bankAmount: Prisma.Decimal | number; cashAmount: Prisma.Decimal | number }): number | null {
  const a = Number(s.area ?? 0);
  return a > 0 ? Math.round(((Number(s.bankAmount) + Number(s.cashAmount)) / a) * 100) / 100 : null;
}

/** Shartnoma (ijarachi) ma'lumoti: ijaraga berish, ijarachini almashtirish, tahrirlash. */
export type RentLeaseInput = {
  tenantName?: string | null; phone?: string | null; inn?: string | null;
  no?: string | null; startDate?: Date | null; endDate?: Date | null; deposit?: number | null; leaseNote?: string | null;
};

/** Ijarachi rekvizitlari va shartnoma maydonlari ixtiyoriy: berilmasa (mobil forma) — o'zgarmaydi. */
export type RentShopInput = RentLeaseInput & {
  name: string; location: string; bankAmount: number; cashAmount: number; electricity: number; tax: number; note: string | null;
  /** Maydoni, m²; berilmasa (eski mobil ilova) — o'zgarmaydi */
  area?: number | null;
  /** Faqat yangi joy qo'shilganda: `false` — bo'sh joy (hali ijaraga berilmagan, shartnoma ochilmaydi) */
  isActive?: boolean;
  /** Oylik yoki kunlik; berilmasa (eski mobil forma) — o'zgarmaydi / oylik */
  period?: RentPeriod;
  /** Oylik ijarada to'lov kuni (1–31); berilmasa — o'zgarmaydi */
  payDay?: number | null;
  /** Svetni ijarachi to'laydi (qarzga qo'shiladi); berilmasa — o'zgarmaydi */
  electricityBilled?: boolean;
};

const leaseFields = (d: RentLeaseInput) => {
  const o: Prisma.RentLeaseUncheckedUpdateInput = {};
  if (d.tenantName !== undefined) o.tenantName = d.tenantName;
  if (d.phone !== undefined) o.phone = d.phone;
  if (d.inn !== undefined) o.inn = d.inn;
  if (d.no !== undefined) o.no = d.no;
  if (d.startDate) o.startDate = d.startDate;
  if (d.endDate !== undefined) o.endDate = d.endDate;
  if (d.deposit !== undefined && d.deposit !== null) o.deposit = d.deposit;
  if (d.leaseNote !== undefined) o.note = d.leaseNote;
  return o;
};
const shopTenant = (d: RentLeaseInput) => ({
  ...(d.tenantName !== undefined ? { tenantName: d.tenantName } : {}),
  ...(d.phone !== undefined ? { phone: d.phone } : {}),
  ...(d.inn !== undefined ? { inn: d.inn } : {}),
});

/** Shartnoma muddati sanalari to'g'rimi (tugash boshlanishdan keyin). */
function leaseDatesError(d: RentLeaseInput): string | null {
  if (d.startDate && d.endDate && d.endDate < d.startDate) return "Shartnoma tugash sanasi boshlanishidan oldin bo'lmasin";
  return null;
}

/**
 * Do'konni qo'shish (`id` yo'q) yoki tahrirlash — veb `/arenda` formasi va mobil do'kon kartochkasi shu yerdan.
 * Qo'shilganda (bo'sh joy bo'lmasa) amaldagi shartnoma ochiladi; shu oy (`month`) hisobi ochilgan bo'lsa — yangi do'kon
 * ham shu oyga tushadi. Tahrirlashda amaldagi shartnoma (ijarachi, muddat, zaklad) ham tuzatiladi.
 * «Svetni ijarachi to'laydi» o'zgarsa — joriy va keyingi oylar hisobidagi undiriladigan svet qayta hisoblanadi.
 * Bir joyda bir xil nomli ikkinchi do'kon bo'lmaydi (unique).
 */
export async function saveRentShopData(id: string | null, data: RentShopInput, month: Date | null, userId: string): Promise<{ error?: string; id?: string }> {
  const dErr = leaseDatesError(data);
  if (dErr) return { error: dErr };
  const { tenantName, phone, inn, no, startDate, endDate, deposit, leaseNote, isActive, ...shopData } = data;
  const lease: RentLeaseInput = { tenantName, phone, inn, no, startDate, endDate, deposit, leaseNote };
  try {
    if (id) {
      const before = await db.rentShop.findUnique({ where: { id } });
      if (!before) return { error: "Do'kon topilmadi" };
      await db.$transaction(async (tx) => {
        await lockShop(tx, id);
        const after = await tx.rentShop.update({ where: { id }, data: { ...shopData, ...shopTenant(lease) } });
        await audit(tx, userId, "UPDATE", "RentShop", id, before, after);
        const active = await tx.rentLease.findFirst({ where: { shopId: id, status: "ACTIVE" } });
        if (active) {
          const up = leaseFields(lease);
          // Muddat uzaytirilsa — ogohlantirish qaytadan boshlanadi
          if (lease.endDate !== undefined && (lease.endDate?.getTime() ?? null) !== (active.endDate?.getTime() ?? null)) up.expiryNotice = null;
          if (Object.keys(up).length) {
            const l = await tx.rentLease.update({ where: { id: active.id }, data: up });
            await audit(tx, userId, "UPDATE", "RentLease", l.id, active, l);
          }
          if (data.electricityBilled !== undefined && data.electricityBilled !== before.electricityBilled) {
            const cs = await tx.rentCharge.findMany({ where: { leaseId: active.id, month: { gte: currentMonth() } } });
            for (const c of cs) await tx.rentCharge.update({ where: { id: c.id }, data: { elecDue: data.electricityBilled ? c.electricity : 0 } });
          }
        }
      });
      return { id };
    }
    const shop = await db.$transaction(async (tx) => {
      const shop = await tx.rentShop.create({ data: { ...shopData, ...shopTenant(lease), isActive: isActive ?? true } });
      await audit(tx, userId, "CREATE", "RentShop", shop.id, undefined, shop);
      if (shop.isActive) {
        const l = await tx.rentLease.create({ data: { ...(leaseFields(lease) as Prisma.RentLeaseUncheckedCreateInput), shopId: shop.id, startDate: data.startDate ?? today(), createdById: userId } });
        await audit(tx, userId, "CREATE", "RentLease", l.id, undefined, l);
        if (month && (await tx.rentCharge.count({ where: { month } }))) {
          await tx.rentCharge.create({ data: chargeData(shop, l.id, null, month, { fromToday: true }) });
        }
      }
      return shop;
    });
    return { id: shop.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: `«${data.location}» da «${data.name}» nomli do'kon allaqachon bor` };
    throw e;
  }
}

/**
 * Ijaraga berish / ijarachini almashtirish: amaldagi shartnoma bo'lsa — yangi ijarachi kelishidan bir kun oldingi sana bilan
 * yopiladi (eski ijarachi qarzi o'z shartnomasida qoladi), yangi shartnoma ochiladi. Telegram ulanishi eski ijarachiniki —
 * uziladi, QR kaliti yangilanadi. Joriy oy hisobi ochilgan va ijara shu oyda boshlansa — yangi ijarachi ham shu oyga tushadi
 * (oylikda to'liq andoza: eski ijarachining shu oy hisobini jadvalda tuzatish kerak).
 */
export async function startRentLease(shopId: string, data: RentLeaseInput & { bankAmount?: number; cashAmount?: number; payDay?: number | null }, userId: string): Promise<{ error?: string; id?: string; charged?: boolean; replaced?: boolean }> {
  const dErr = leaseDatesError(data);
  if (dErr) return { error: dErr };
  const start = data.startDate ?? today();
  const res = await db.$transaction(async (tx) => {
    await lockShop(tx, shopId);
    const shop = await tx.rentShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new RentError("Do'kon topilmadi");
    const old = await tx.rentLease.findFirst({ where: { shopId, status: "ACTIVE" } });
    if (old) {
      if (start <= old.startDate) throw new RentError(`Yangi ijara ${date(old.startDate)} dan keyin boshlansin — amaldagi shartnoma shu sanada boshlangan`);
      const endedAt = new Date(start.getTime() - 86_400_000);
      await tx.rentLease.update({ where: { id: old.id }, data: { status: "ENDED", endedAt, endReason: "Ijarachi almashdi" } });
      await audit(tx, userId, "STATUS_CHANGE", "RentLease", old.id, { status: "ACTIVE" }, { status: "ENDED", endedAt, endReason: "Ijarachi almashdi" });
    }
    const l = await tx.rentLease.create({
      data: { ...(leaseFields(data) as Prisma.RentLeaseUncheckedCreateInput), shopId, startDate: start, createdById: userId },
    });
    await audit(tx, userId, "CREATE", "RentLease", l.id, undefined, l);
    const price = {
      ...(data.bankAmount !== undefined ? { bankAmount: data.bankAmount } : {}),
      ...(data.cashAmount !== undefined ? { cashAmount: data.cashAmount } : {}),
      ...(data.payDay !== undefined && shop.period === "MONTHLY" ? { payDay: data.payDay } : {}),
    };
    const after = await tx.rentShop.update({
      where: { id: shopId },
      data: {
        isActive: true, tenantName: data.tenantName ?? null, phone: data.phone ?? null, inn: data.inn ?? null, ...price,
        ...(old || shop.tgChatId ? { tgChatId: null, tgLinkedAt: null, tgLinkToken: randomBytes(12).toString("base64url") } : {}),
      },
    });
    await audit(tx, userId, "UPDATE", "RentShop", shopId, { isActive: shop.isActive, tenantName: shop.tenantName, phone: shop.phone }, { isActive: true, tenantName: after.tenantName, phone: after.phone, lease: l.id });
    const month = currentMonth();
    let charged = false;
    if (monthKey(monthOf(start)) <= monthKey(month) && (await tx.rentCharge.count({ where: { month } }))) {
      const meter = await lastMeter(tx, shopId, shiftMonth(month, 1));
      charged = (await tx.rentCharge.createMany({ data: [chargeData(after, l.id, null, month, { fromToday: true, meterStart: meter })], skipDuplicates: true })).count > 0;
    }
    return { id: l.id, charged, replaced: !!old };
  }).catch((e) => { if (e instanceof RentError) return { error: e.message }; throw e; });
  return res;
}

/**
 * Joyni bo'shatish: amaldagi shartnoma yopiladi (qarzi bo'lsa — «sobiq ijarachi» bo'lib qoladi), joy keyingi oylar
 * hisobiga tushmaydi. Ijarachi rekvizitlari va Telegram ulanishi do'kondan olinadi (shartnomada saqlanadi).
 */
export async function endRentLease(shopId: string, opts: { endedAt?: Date | null; reason?: string | null }, userId: string): Promise<{ error?: string }> {
  return db.$transaction(async (tx) => {
    await lockShop(tx, shopId);
    const shop = await tx.rentShop.findUnique({ where: { id: shopId } });
    if (!shop) throw new RentError("Do'kon topilmadi");
    const l = await tx.rentLease.findFirst({ where: { shopId, status: "ACTIVE" } });
    const endedAt = opts.endedAt ?? today();
    if (l) {
      if (endedAt < l.startDate) throw new RentError(`Chiqish sanasi shartnoma boshlanishidan (${date(l.startDate)}) oldin bo'lmasin`);
      const reason = opts.reason?.trim() || "Joy bo'shatildi";
      await tx.rentLease.update({ where: { id: l.id }, data: { status: "ENDED", endedAt, endReason: reason } });
      await audit(tx, userId, "STATUS_CHANGE", "RentLease", l.id, { status: "ACTIVE" }, { status: "ENDED", endedAt, endReason: reason });
    }
    await tx.rentShop.update({ where: { id: shopId }, data: { isActive: false, tenantName: null, phone: null, inn: null, tgChatId: null, tgLinkedAt: null, tgLinkToken: randomBytes(12).toString("base64url") } });
    await audit(tx, userId, "STATUS_CHANGE", "RentShop", shopId, { isActive: shop.isActive }, { isActive: false });
    return {};
  }).catch((e) => { if (e instanceof RentError) return { error: e.message }; throw e; });
}

/**
 * Mobil ilova tugmasi «Ijarada» ↔ «Bo'sh»: ijaradagi joy bo'shatiladi, bo'sh joyga bugundan shartnoma ochiladi
 * (ijarachi ma'lumotini keyin tahrirlash orqali kiritadi). Vebda — do'kon kartasidagi «Ijaraga berish» formasi.
 */
export async function toggleRentShopActive(id: string, userId: string): Promise<{ error?: string; active?: boolean; charged?: boolean }> {
  const shop = await db.rentShop.findUnique({ where: { id }, select: { isActive: true } });
  if (!shop) return { error: "Do'kon topilmadi" };
  if (shop.isActive) {
    const r = await endRentLease(id, {}, userId);
    return r.error ? r : { active: false };
  }
  const r = await startRentLease(id, {}, userId);
  return r.error ? { error: r.error } : { active: true, charged: r.charged };
}

// ───────────────────────── Kunlik ijara: kunlar bo'yicha to'lov ─────────────────────────

export type RentDay = { day: Date; paid: number; due: number; future: boolean; /** ijara hali boshlanmagan kun (oy o'rtasida qo'shilgan joy) */ before: boolean };

/**
 * Kunlik ijarali do'konning oy kalendari (shartnoma bo'yicha): har kun uchun tushgan pul va kunlik summa (andoza).
 * Kelgusi kunlar qarz hisoblanmaydi; `day` belgilanmagan eski kirimlar kalendarda ko'rinmaydi (oy jamida bor).
 */
export async function rentDays(shop: Pick<RentShop, "id" | "bankAmount" | "cashAmount">, leaseId: string, month: Date): Promise<RentDay[]> {
  const [g, charge] = await Promise.all([
    db.rentTx.groupBy({ by: ["day"], where: { leaseId, type: "INCOME", cancelledAt: null, day: monthRange(month) }, _sum: { amount: true } }),
    db.rentCharge.findUnique({ where: { leaseId_month: { leaseId, month } }, select: { days: true } }),
  ]);
  // Oy o'rtasida boshlangan ijara: hisob oxirgi `days` kunga ochilgan — undan oldingi kunlar qarz emas
  const dim = daysInMonth(month), from = charge?.days != null ? dim - charge.days + 1 : 1;
  const paid = new Map(g.map((x) => [x.day!.getTime(), n(x._sum.amount)]));
  const rate = n(shop.bankAmount) + n(shop.cashAmount), now = today().getTime();
  return Array.from({ length: dim }, (_, i) => {
    const day = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1));
    return { day, paid: paid.get(day.getTime()) ?? 0, due: rate, future: day.getTime() > now, before: i + 1 < from };
  });
}

// ───────────────────────── To'lov holati (bugun / muddati o'tgan / to'lagan) ─────────────────────────

export type RentPayStatus = "VACANT" | "OVERDUE" | "TODAY" | "PAID" | "WAITING";
export const RENT_PAY_STATUS_LABEL: Record<RentPayStatus, string> = {
  VACANT: "Bo'sh joy", OVERDUE: "Muddati o'tgan", TODAY: "Bugun to'lov kuni", PAID: "To'lagan", WAITING: "To'lov kuni kelmagan",
};

export type RentShopState = {
  status: RentPayStatus;
  /** Jami qarz (joriy shartnoma, barcha oylar, joriy oy to'liq) — musbat qarz, manfiy avans */
  debt: number;
  /** Muddati o'tgan qarz: o'tgan oylar + joriy oyning to'lov kuni o'tgan qismi */
  overdue: number;
  /** Joriy oy: hali to'lanmagan qoldiq (manfiy bo'lmaydi) */
  monthLeft: number;
  /** Oylikda — shu oydagi to'lov sanasi; kunlikda — bugun */
  dueDate: Date | null;
};

/**
 * Har do'konning shu kungi to'lov holati (joriy shartnoma bo'yicha). Oylik ijara: to'lov kuni (`payDay`, kiritilmagan
 * bo'lsa — oy oxiri) kelguncha joriy oy qoldig'i muddati o'tgan hisoblanmaydi. Kunlik ijara: kechagacha bo'lgan kunlar
 * summasi to'lanmagan bo'lsa — muddati o'tgan, bugungi kun to'lanmagan bo'lsa — «bugun». Joriy oy hisobi ochilmagan
 * bo'lsa, faqat o'tgan oylar qarzi hisobga olinadi.
 */
export async function rentShopStates(shops: Pick<RentShop, "id" | "isActive" | "period" | "payDay" | "bankAmount" | "cashAmount">[]): Promise<Map<string, RentShopState>> {
  const month = currentMonth(), now = today(), d = now.getUTCDate(), dim = daysInMonth(month);
  const cur = await currentLeases(shops.map((s) => s.id));
  const ids = [...cur.values()].map((l) => l.id);
  const [debts, charges, paid, paidToday] = await Promise.all([
    leaseDebts(ids),
    db.rentCharge.findMany({ where: { month, leaseId: { in: ids } }, select: { leaseId: true, bankDue: true, cashDue: true, elecDue: true } }),
    db.rentTx.groupBy({ by: ["leaseId"], where: { type: "INCOME", month, cancelledAt: null, leaseId: { in: ids } }, _sum: { amount: true } }),
    db.rentTx.groupBy({ by: ["leaseId"], where: { type: "INCOME", day: now, cancelledAt: null, leaseId: { in: ids } }, _sum: { amount: true } }),
  ]);
  const due = new Map(charges.map((c) => [c.leaseId, chargeDue(c)]));
  const got = new Map(paid.map((p) => [p.leaseId!, n(p._sum.amount)]));
  const gotToday = new Map(paidToday.map((p) => [p.leaseId!, n(p._sum.amount)]));
  const res = new Map<string, RentShopState>();
  for (const s of shops) {
    const lid = cur.get(s.id)?.id ?? "";
    const debt = debts.get(lid) ?? 0;
    const curDue = due.get(lid) ?? 0, curPaid = got.get(lid) ?? 0;
    const monthLeft = Math.max(0, r2(curDue - curPaid));
    let notYet: number, dueToday: boolean, dueDate: Date | null;
    if (s.period === "DAILY") {
      const rate = n(s.bankAmount) + n(s.cashAmount);
      // Bugundan oy oxirigacha bo'lgan kunlar summasi hali muddati kelmagan
      notYet = Math.min(monthLeft, curDue, rate * (dim - d + 1));
      dueToday = rate > 0.005 && (gotToday.get(lid) ?? 0) < rate - 0.005;
      dueDate = now;
    } else {
      const pd = Math.min(s.payDay ?? dim, dim);
      notYet = d <= pd ? monthLeft : 0;
      dueToday = d === pd && monthLeft > 0.005;
      dueDate = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), pd));
    }
    const overdue = Math.max(0, r2(debt - notYet));
    const status: RentPayStatus = !s.isActive ? "VACANT"
      : overdue > 0.005 ? "OVERDUE"
      : dueToday ? "TODAY"
      // Kunlikda: qarz yo'q va bugungi kun to'langan; oylikda: shu oy hisobi to'liq yopilgan
      : s.period === "DAILY" || monthLeft <= 0.005 ? "PAID"
      : "WAITING";
    res.set(s.id, { status, debt, overdue, monthLeft, dueDate });
  }
  return res;
}

/** Oy hisobini yozish (veb jadval qatori, mobil kartochka): shartnomaning shu oy hisobi, bo'lmasa — ochiladi.
 *  Svet hisoblagichi ikkala ko'rsatkichi bo'lsa va tarif kiritilgan bo'lsa — svet summasi hisoblanadi;
 *  «svetni ijarachi to'laydi» belgisi bo'lsa — qarzga qo'shiladi. */
export async function saveRentChargeData(leaseId: string, month: Date, data: {
  bankDue: number; cashDue: number; electricity: number; tax: number; note: string | null; days?: number | null;
  meterStart?: number | null; meterEnd?: number | null;
}, userId: string): Promise<{ error?: string }> {
  const lease = await db.rentLease.findUnique({ where: { id: leaseId }, include: { shop: true } });
  if (!lease) return { error: "Shartnoma topilmadi" };
  if (data.meterStart != null && data.meterEnd != null && data.meterEnd < data.meterStart) return { error: "Svet: oy oxiri ko'rsatkichi boshidan kichik bo'lmasin" };
  const kwh = n((await db.companySettings.findUnique({ where: { id: "main" }, select: { rentKwhPrice: true } }))?.rentKwhPrice);
  const byMeter = meterAmount(data.meterStart, data.meterEnd, kwh);
  const electricity = byMeter ?? data.electricity;
  const before = await db.rentCharge.findUnique({ where: { leaseId_month: { leaseId, month } } });
  const billed = before ? n(before.elecDue) > 0 || lease.shop.electricityBilled : lease.shop.electricityBilled;
  const row = { ...data, electricity, elecDue: billed ? electricity : 0 };
  const c = await db.rentCharge.upsert({
    where: { leaseId_month: { leaseId, month } },
    create: { shopId: lease.shopId, leaseId, month, ...row },
    update: row,
  });
  await audit(db, userId, before ? "UPDATE" : "CREATE", "RentCharge", c.id, before ?? undefined, c);
  return {};
}
