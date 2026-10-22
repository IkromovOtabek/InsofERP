import { Prisma, type RentMethod, type RentPeriod, type RentShop, type RentTxType } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { date, money } from "./format";
import { notifyAfter } from "./notify";

/**
 * Arenda (do'konlar ijarasi) — sekretar yuritadi, Excel'dagi «Аренда» daftarining o'rnini bosadi.
 *
 *  · RentShop   — do'kon/joy, `location` bo'yicha guruh (Texno siti bozor, Makro, Gulbozor ...);
 *                 ijara oylik yoki kunlik (`period`): kunlikda oy hisobi = kunlik summa × kunlar, kirim — «qaysi kun uchun»;
 *  · RentCharge — oylik hisob (oy varag'ining qatori): perechisleniye + naqd = jami to'lashi kerak;
 *                 svet va biz to'laydigan soliq — ma'lumot uchun, qoldiqqa ta'sir qilmaydi (Excel'dagidek);
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

export type SheetRow = {
  shopId: string; chargeId: string | null; name: string; location: string; isActive: boolean;
  /** Kunlik ijara: hisoblangan kunlar va bir kunlik summa (andoza) — jadvalda kun o'zgarsa summa qayta hisoblanadi */
  period: RentPeriod; days: number | null; bankRate: number; cashRate: number;
  bankDue: number; cashDue: number; due: number; electricity: number; tax: number;
  bankPaid: number; cashPaid: number; paid: number; left: number; note: string | null;
};
export type SheetGroup = { location: string; rows: SheetRow[]; total: Omit<SheetRow, "shopId" | "chargeId" | "name" | "location" | "isActive" | "note" | "period" | "days" | "bankRate" | "cashRate"> };

const ZERO = { bankDue: 0, cashDue: 0, due: 0, electricity: 0, tax: 0, bankPaid: 0, cashPaid: 0, paid: 0, left: 0 };
function sum(rows: SheetRow[]) {
  const t = { ...ZERO };
  for (const r of rows) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r[k];
  return t;
}

/** Oy varag'i: bozor bo'yicha guruhlar, har guruhda «Umumiy», oxirida jami. */
export async function monthSheet(month: Date) {
  const [charges, paid] = await Promise.all([
    db.rentCharge.findMany({ where: { month }, include: { shop: true } }),
    db.rentTx.groupBy({ by: ["shopId", "method"], where: { type: "INCOME", month, cancelledAt: null, shopId: { not: null } }, _sum: { amount: true } }),
  ]);
  const paidMap = new Map<string, { CASH: number; BANK: number }>();
  for (const p of paid) {
    const cur = paidMap.get(p.shopId!) ?? { CASH: 0, BANK: 0 };
    cur[p.method] += n(p._sum.amount);
    paidMap.set(p.shopId!, cur);
  }
  // Hisobi ochilmagan, lekin shu oy uchun pul tushgan do'kon ham jadvalda ko'rinsin (to'lashi kerak 0)
  const missing = [...paidMap.keys()].filter((id) => !charges.some((c) => c.shopId === id));
  const extra = missing.length ? await db.rentShop.findMany({ where: { id: { in: missing } } }) : [];

  const rows: SheetRow[] = [
    ...charges.map((c) => ({ shop: c.shop, c })),
    ...extra.map((shop) => ({ shop, c: null })),
  ].sort((a, b) => a.shop.sortOrder - b.shop.sortOrder || a.shop.createdAt.getTime() - b.shop.createdAt.getTime()).map(({ shop, c }) => {
    const p = paidMap.get(shop.id) ?? { CASH: 0, BANK: 0 };
    const bankDue = n(c?.bankDue), cashDue = n(c?.cashDue), due = bankDue + cashDue, paidAll = p.BANK + p.CASH;
    return {
      shopId: shop.id, chargeId: c?.id ?? null, name: shop.name, location: shop.location, isActive: shop.isActive,
      period: shop.period, days: c?.days ?? null, bankRate: n(shop.bankAmount), cashRate: n(shop.cashAmount),
      bankDue, cashDue, due, electricity: n(c?.electricity), tax: n(c?.tax),
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

/** Do'konlar bo'yicha umumiy qarz (barcha oylar): hisoblangan − tushgan. Musbat — qarz, manfiy — avans. */
export async function shopDebts(): Promise<Map<string, number>> {
  const [due, paid] = await Promise.all([
    db.rentCharge.groupBy({ by: ["shopId"], _sum: { bankDue: true, cashDue: true } }),
    db.rentTx.groupBy({ by: ["shopId"], where: { type: "INCOME", cancelledAt: null, shopId: { not: null } }, _sum: { amount: true } }),
  ]);
  const m = new Map<string, number>();
  for (const d of due) m.set(d.shopId, n(d._sum.bankDue) + n(d._sum.cashDue));
  for (const p of paid) m.set(p.shopId!, r2((m.get(p.shopId!) ?? 0) - n(p._sum.amount)));
  return m;
}

/* ───────────────────────── Yozuvchi amallar ───────────────────────── */

class RentError extends Error {}

/** Arenda kassasi bo'yicha qulf: parallel chiqimlar qoldiqni ikki marta «ko'rib» minusga tushirmasin. */
const lockKassa = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rent:kassa'))`;

async function outflowError(tx: Tx, method: RentMethod, amount: number): Promise<string | null> {
  const b = await rentBalance(tx);
  const have = method === "CASH" ? b.cash : b.bank;
  return amount > have + 0.005 ? `Arenda kassasida ${RENT_METHOD_LABEL[method].toLowerCase()} qoldiq ${money(have)} — ${money(amount)} chiqim qilib bo'lmaydi` : null;
}

export type RentTxInput = {
  type: RentTxType; method: RentMethod; date: Date; month: Date | null; shopId: string | null;
  amount: number; category: string; note: string | null; clientToken: string | null;
  /** Kunlik ijara kirimi — qaysi kun uchun (oy shu kundan olinadi) */
  day?: Date | null;
};

/**
 * Kirim/chiqim yozish. Kirim bo'lsa — ijarachi Telegram'ga ulangan bo'lsa unga «to'lov qabul qilindi» xabari (javobdan keyin).
 * Kunlik ijarali do'kon kirimida «qaysi kun uchun» shart, oy shu kundan olinadi; o'sha kunga avval ham kirim bo'lsa — `sameDay` (ogohlantirish).
 */
export async function createRentTx(input: RentTxInput, userId: string): Promise<{ error?: string; duplicate?: boolean; id?: string; sameDay?: number }> {
  const amount = r2(input.amount);
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  const shop = input.shopId ? await db.rentShop.findUnique({ where: { id: input.shopId }, select: { id: true, period: true } }) : null;
  if (input.shopId && !shop) return { error: "Do'kon topilmadi" };
  let day: Date | null = null;
  if (input.type === "INCOME" && shop?.period === "DAILY") {
    if (!input.day) return { error: "Kunlik ijara — qaysi kun uchun to'lov ekanini tanlang" };
    day = input.day;
    input = { ...input, month: monthOf(day) };
  }
  if (input.type === "INCOME" && (!input.shopId || !input.month)) return { error: "Kirim uchun do'kon va oyni tanlang" };
  const dup = input.clientToken ? await db.rentTx.findUnique({ where: { clientToken: input.clientToken }, select: { id: true } }) : null;
  if (dup) return { duplicate: true, id: dup.id };
  try {
    const id = await db.$transaction(async (tx) => {
      await lockKassa(tx);
      if (input.type === "EXPENSE") {
        const err = await outflowError(tx, input.method, amount);
        if (err) throw new RentError(err);
      }
      const t = await tx.rentTx.create({ data: { ...input, day, amount, createdById: userId } });
      await audit(tx, userId, "CREATE", "RentTx", t.id, undefined, t);
      return t.id;
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

export async function cancelRentTx(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  const why = reason.trim();
  if (why.length < 3) return { error: "Bekor qilish sababini yozing" };
  try {
    await db.$transaction(async (tx) => {
      await lockKassa(tx);
      const t = await tx.rentTx.findUnique({ where: { id } });
      if (!t) throw new RentError("Yozuv topilmadi");
      if (t.cancelledAt) return; // allaqachon storno (ikki marta bosilgan)
      // Kirimni bekor qilish ham kassani minusga tushirishi mumkin (pul allaqachon chiqim qilingan bo'lsa)
      if (t.type === "INCOME") {
        const err = await outflowError(tx, t.method, n(t.amount));
        if (err) throw new RentError(`Bu kirim bekor qilinsa kassa minusga tushadi. ${err}`);
      }
      const ok = await tx.rentTx.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: why } });
      if (ok.count) await audit(tx, userId, "STATUS_CHANGE", "RentTx", id, { cancelledAt: null }, { cancelledAt: new Date(), cancelReason: why });
    });
    return {};
  } catch (e) {
    if (e instanceof RentError) return { error: e.message };
    throw e;
  }
}

type PrevCharge = { bankDue: Prisma.Decimal; cashDue: Prisma.Decimal; electricity: Prisma.Decimal; tax: Prisma.Decimal } | null;

/**
 * Do'konning yangi oy hisobi. Oylik: o'tgan oy hisobidan nusxa (bo'lmasa andoza).
 * Kunlik: kunlik summa (andoza) × oydagi kunlar — oylar uzunligi har xil, shuning uchun o'tgan oy jami ko'chirilmaydi;
 * svet va soliq oylik bo'lgani uchun o'tgan oydan olinadi.
 * Joriy oy o'rtasida qo'shilgan / ijaraga berilgan kunlik joy — bugundan oy oxirigacha hisoblanadi (`fromToday`).
 */
function chargeData(s: Pick<RentShop, "id" | "period" | "bankAmount" | "cashAmount" | "electricity" | "tax">, p: PrevCharge, month: Date, fromToday = false) {
  const extra = { electricity: p?.electricity ?? s.electricity, tax: p?.tax ?? s.tax };
  if (s.period === "DAILY") {
    const t = today();
    const from = fromToday && monthKey(month) === monthKey(monthOf(t)) ? t.getUTCDate() : 1;
    const days = daysInMonth(month) - from + 1;
    return { shopId: s.id, month, days, bankDue: r2(n(s.bankAmount) * days), cashDue: r2(n(s.cashAmount) * days), ...extra };
  }
  return { shopId: s.id, month, bankDue: p?.bankDue ?? s.bankAmount, cashDue: p?.cashDue ?? s.cashAmount, ...extra };
}

/**
 * Oyni ochish: faol do'konlar uchun oylik hisob — o'tgan oy hisobidan nusxa (bo'lmasa do'kon andozasi), kunlikda — kun × summa.
 * Takror chaqirilsa faqat yetishmagan do'konlar qo'shiladi (unique [shopId, month]).
 */
export async function openMonth(month: Date, userId: string): Promise<{ created: number }> {
  const shops = await db.rentShop.findMany({ where: { isActive: true } });
  const prev = await db.rentCharge.findMany({
    where: { shopId: { in: shops.map((s) => s.id) }, month: { lt: month } },
    orderBy: { month: "desc" }, distinct: ["shopId"],
  });
  const last = new Map(prev.map((c) => [c.shopId, c]));
  const data = shops.map((s) => chargeData(s, last.get(s.id) ?? null, month));
  const res = await db.rentCharge.createMany({ data, skipDuplicates: true });
  if (res.count) await audit(db, userId, "CREATE", "RentCharge", monthKey(month), undefined, { month: monthKey(month), created: res.count });
  return { created: res.count };
}

// ───────────────────────── Do'kon kartasi ─────────────────────────

/** `isActive` — joy ijarada (pul olinadi); `false` — bo'sh joy (ijarachi topilmagan yoki chiqib ketgan), oy hisobiga tushmaydi. */
export const RENT_SHOP_STATUS = { on: "Ijarada", off: "Bo'sh" } as const;

/**
 * Joyni «Ijarada» ↔ «Bo'sh» qilish (veb va mobil). Ijaraga berilganda joriy oy hisobi ochilgan bo'lsa —
 * joy shu oyga ham tushadi (o'tgan hisobdan, bo'lmasa andozadan), summani jadvalda tuzatsa bo'ladi. Tarix joyida qoladi.
 */
export async function toggleRentShopActive(id: string, userId: string): Promise<{ error?: string; active?: boolean; charged?: boolean }> {
  const shop = await db.rentShop.findUnique({ where: { id } });
  if (!shop) return { error: "Do'kon topilmadi" };
  const active = !shop.isActive;
  let charged = false;
  await db.$transaction(async (tx) => {
    const ok = await tx.rentShop.updateMany({ where: { id, isActive: shop.isActive }, data: { isActive: active } });
    if (!ok.count) return; // parallel bosilgan — boshqa so'rov allaqachon o'zgartirdi
    await audit(tx, userId, "STATUS_CHANGE", "RentShop", id, { isActive: shop.isActive }, { isActive: active });
    const month = currentMonth();
    if (!active || !(await tx.rentCharge.count({ where: { month } }))) return;
    const p = await tx.rentCharge.findFirst({ where: { shopId: id, month: { lt: month } }, orderBy: { month: "desc" } });
    charged = (await tx.rentCharge.createMany({ data: [chargeData(shop, p, month, true)], skipDuplicates: true })).count > 0;
  });
  return { active, charged };
}

/** Do'kon maydoni (m²) chegarasi — veb va mobil forma bir xil tekshiradi */
export const RENT_AREA_MAX = 100_000;

/** 1 m² ijara narxi (oylik yoki kunlik — `period` bo'yicha); maydon kiritilmagan bo'lsa — null */
export function rentPerM2(s: { area: Prisma.Decimal | number | null; bankAmount: Prisma.Decimal | number; cashAmount: Prisma.Decimal | number }): number | null {
  const a = Number(s.area ?? 0);
  return a > 0 ? Math.round(((Number(s.bankAmount) + Number(s.cashAmount)) / a) * 100) / 100 : null;
}

/** Ijarachi rekvizitlari (`tenantName`, `phone`, `inn`) ixtiyoriy: berilmasa (mobil forma) — o'zgarmaydi. */
export type RentShopInput = {
  name: string; location: string; bankAmount: number; cashAmount: number; electricity: number; tax: number; note: string | null;
  /** Maydoni, m²; berilmasa (eski mobil ilova) — o'zgarmaydi */
  area?: number | null;
  tenantName?: string | null; phone?: string | null; inn?: string | null;
  /** Faqat yangi joy qo'shilganda: `false` — bo'sh joy (hali ijaraga berilmagan) */
  isActive?: boolean;
  /** Oylik yoki kunlik; berilmasa (eski mobil forma) — o'zgarmaydi / oylik */
  period?: RentPeriod;
  /** Oylik ijarada to'lov kuni (1–31); berilmasa — o'zgarmaydi */
  payDay?: number | null;
};

/**
 * Do'konni qo'shish (`id` yo'q) yoki tahrirlash — veb `/arenda` formasi (`arenda/actions.ts` → `saveRentShop`) va mobil
 * do'kon kartochkasi shu yerdan. Qo'shilganda shu oy (`month`) hisobi ochilgan bo'lsa — yangi do'kon ham shu oyga tushadi.
 * Bir joyda bir xil nomli ikkinchi do'kon bo'lmaydi (unique).
 */
export async function saveRentShopData(id: string | null, data: RentShopInput, month: Date | null, userId: string): Promise<{ error?: string; id?: string }> {
  try {
    if (id) {
      const before = await db.rentShop.findUnique({ where: { id } });
      if (!before) return { error: "Do'kon topilmadi" };
      const after = await db.rentShop.update({ where: { id }, data });
      await audit(db, userId, "UPDATE", "RentShop", id, before, after);
      return { id };
    }
    const shop = await db.$transaction(async (tx) => {
      const shop = await tx.rentShop.create({ data });
      await audit(tx, userId, "CREATE", "RentShop", shop.id, undefined, shop);
      if (shop.isActive && month && (await tx.rentCharge.count({ where: { month } }))) {
        await tx.rentCharge.create({ data: chargeData(shop, null, month, true) });
      }
      return shop;
    });
    return { id: shop.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: `«${data.location}» da «${data.name}» nomli do'kon allaqachon bor` };
    throw e;
  }
}

// ───────────────────────── Kunlik ijara: kunlar bo'yicha to'lov ─────────────────────────

export type RentDay = { day: Date; paid: number; due: number; future: boolean; /** ijara hali boshlanmagan kun (oy o'rtasida qo'shilgan joy) */ before: boolean };

/**
 * Kunlik ijarali do'konning oy kalendari: har kun uchun tushgan pul va kunlik summa (andoza).
 * Kelgusi kunlar qarz hisoblanmaydi; `day` belgilanmagan eski kirimlar kalendarda ko'rinmaydi (oy jamida bor).
 */
export async function rentDays(shop: Pick<RentShop, "id" | "bankAmount" | "cashAmount">, month: Date): Promise<RentDay[]> {
  const [g, charge] = await Promise.all([
    db.rentTx.groupBy({ by: ["day"], where: { shopId: shop.id, type: "INCOME", cancelledAt: null, day: monthRange(month) }, _sum: { amount: true } }),
    db.rentCharge.findUnique({ where: { shopId_month: { shopId: shop.id, month } }, select: { days: true } }),
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
  /** Jami qarz (barcha oylar, joriy oy to'liq) — musbat qarz, manfiy avans */
  debt: number;
  /** Muddati o'tgan qarz: o'tgan oylar + joriy oyning to'lov kuni o'tgan qismi */
  overdue: number;
  /** Joriy oy: hali to'lanmagan qoldiq (manfiy bo'lmaydi) */
  monthLeft: number;
  /** Oylikda — shu oydagi to'lov sanasi; kunlikda — bugun */
  dueDate: Date | null;
};

/**
 * Har do'konning shu kungi to'lov holati. Oylik ijara: to'lov kuni (`payDay`, kiritilmagan bo'lsa — oy oxiri) kelguncha
 * joriy oy qoldig'i muddati o'tgan hisoblanmaydi. Kunlik ijara: kechagacha bo'lgan kunlar summasi to'lanmagan bo'lsa — muddati o'tgan,
 * bugungi kun to'lanmagan bo'lsa — «bugun». Joriy oy hisobi ochilmagan bo'lsa, faqat o'tgan oylar qarzi hisobga olinadi.
 */
export async function rentShopStates(shops: Pick<RentShop, "id" | "isActive" | "period" | "payDay" | "bankAmount" | "cashAmount">[]): Promise<Map<string, RentShopState>> {
  const month = currentMonth(), now = today(), d = now.getUTCDate(), dim = daysInMonth(month);
  const [debts, charges, paid, paidToday] = await Promise.all([
    shopDebts(),
    db.rentCharge.findMany({ where: { month }, select: { shopId: true, bankDue: true, cashDue: true } }),
    db.rentTx.groupBy({ by: ["shopId"], where: { type: "INCOME", month, cancelledAt: null, shopId: { not: null } }, _sum: { amount: true } }),
    db.rentTx.groupBy({ by: ["shopId"], where: { type: "INCOME", day: now, cancelledAt: null, shopId: { not: null } }, _sum: { amount: true } }),
  ]);
  const due = new Map(charges.map((c) => [c.shopId, n(c.bankDue) + n(c.cashDue)]));
  const got = new Map(paid.map((p) => [p.shopId!, n(p._sum.amount)]));
  const gotToday = new Map(paidToday.map((p) => [p.shopId!, n(p._sum.amount)]));
  const res = new Map<string, RentShopState>();
  for (const s of shops) {
    const debt = debts.get(s.id) ?? 0;
    const curDue = due.get(s.id) ?? 0, curPaid = got.get(s.id) ?? 0;
    const monthLeft = Math.max(0, r2(curDue - curPaid));
    let notYet: number, dueToday: boolean, dueDate: Date | null;
    if (s.period === "DAILY") {
      const rate = n(s.bankAmount) + n(s.cashAmount);
      // Bugundan oy oxirigacha bo'lgan kunlar summasi hali muddati kelmagan
      notYet = Math.min(monthLeft, curDue, rate * (dim - d + 1));
      dueToday = rate > 0.005 && (gotToday.get(s.id) ?? 0) < rate - 0.005;
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
