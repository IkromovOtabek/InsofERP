import { Prisma, type RentMethod, type RentTxType } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { money } from "./format";

/**
 * Arenda (do'konlar ijarasi) — sekretar yuritadi, Excel'dagi «Аренда» daftarining o'rnini bosadi.
 *
 *  · RentShop   — do'kon/joy, `location` bo'yicha guruh (Texno siti bozor, Makro, Gulbozor ...);
 *  · RentCharge — oylik hisob (oy varag'ining qatori): perechisleniye + naqd = jami to'lashi kerak;
 *                 svet va biz to'laydigan soliq — ma'lumot uchun, qoldiqqa ta'sir qilmaydi (Excel'dagidek);
 *  · RentTx     — arenda kassasi jurnali: kirim (ijarachidan, qaysi oy uchun) va chiqim. O'chirilmaydi, faqat storno.
 *
 * Qoldiq (oy) = jami to'lashi kerak − shu oy uchun tushgan kirim. Arenda kassasi = kirimlar − chiqimlar (usul bo'yicha).
 * Arenda kassasi zavodning asosiy Kassa/bank hisobidan alohida — u yerga topshirilgan pul «Kassaga topshirildi» chiqimi.
 */

type Tx = Prisma.TransactionClient;

export const RENT_METHOD_LABEL: Record<RentMethod, string> = { CASH: "Naqd", BANK: "Perechisleniye" };
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

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export type SheetRow = {
  shopId: string; chargeId: string | null; name: string; location: string; isActive: boolean;
  bankDue: number; cashDue: number; due: number; electricity: number; tax: number;
  bankPaid: number; cashPaid: number; paid: number; left: number; note: string | null;
};
export type SheetGroup = { location: string; rows: SheetRow[]; total: Omit<SheetRow, "shopId" | "chargeId" | "name" | "location" | "isActive" | "note"> };

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
};

export async function createRentTx(input: RentTxInput, userId: string): Promise<{ error?: string; duplicate?: boolean }> {
  const amount = r2(input.amount);
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (input.type === "INCOME" && (!input.shopId || !input.month)) return { error: "Kirim uchun do'kon va oyni tanlang" };
  if (input.shopId && !(await db.rentShop.findUnique({ where: { id: input.shopId }, select: { id: true } }))) return { error: "Do'kon topilmadi" };
  if (input.clientToken && (await db.rentTx.findUnique({ where: { clientToken: input.clientToken }, select: { id: true } }))) return { duplicate: true };
  try {
    await db.$transaction(async (tx) => {
      await lockKassa(tx);
      if (input.type === "EXPENSE") {
        const err = await outflowError(tx, input.method, amount);
        if (err) throw new RentError(err);
      }
      const t = await tx.rentTx.create({ data: { ...input, amount, createdById: userId } });
      await audit(tx, userId, "CREATE", "RentTx", t.id, undefined, t);
    });
    return {};
  } catch (e) {
    if (e instanceof RentError) return { error: e.message };
    // Bir xil kalit bilan ikki so'rov birga kelsa — ikkinchisi unique xatosi oladi: birinchisi saqlangan
    if (input.clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { duplicate: true };
    throw e;
  }
}

export async function cancelRentTx(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  const why = reason.trim();
  if (why.length < 3) return { error: "Storno sababini yozing" };
  try {
    await db.$transaction(async (tx) => {
      await lockKassa(tx);
      const t = await tx.rentTx.findUnique({ where: { id } });
      if (!t) throw new RentError("Yozuv topilmadi");
      if (t.cancelledAt) return; // allaqachon storno (ikki marta bosilgan)
      // Kirimni bekor qilish ham kassani minusga tushirishi mumkin (pul allaqachon chiqim qilingan bo'lsa)
      if (t.type === "INCOME") {
        const err = await outflowError(tx, t.method, n(t.amount));
        if (err) throw new RentError(`Bu kirim storno qilinsa kassa minusga tushadi. ${err}`);
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

/**
 * Oyni ochish: faol do'konlar uchun oylik hisob — o'tgan oy hisobidan nusxa (bo'lmasa do'kon andozasi).
 * Takror chaqirilsa faqat yetishmagan do'konlar qo'shiladi (unique [shopId, month]).
 */
export async function openMonth(month: Date, userId: string): Promise<{ created: number }> {
  const shops = await db.rentShop.findMany({ where: { isActive: true } });
  const prev = await db.rentCharge.findMany({
    where: { shopId: { in: shops.map((s) => s.id) }, month: { lt: month } },
    orderBy: { month: "desc" }, distinct: ["shopId"],
  });
  const last = new Map(prev.map((c) => [c.shopId, c]));
  const data = shops.map((s) => {
    const p = last.get(s.id);
    return p
      ? { shopId: s.id, month, bankDue: p.bankDue, cashDue: p.cashDue, electricity: p.electricity, tax: p.tax }
      : { shopId: s.id, month, bankDue: s.bankAmount, cashDue: s.cashAmount, electricity: s.electricity, tax: s.tax };
  });
  const res = await db.rentCharge.createMany({ data, skipDuplicates: true });
  if (res.count) await audit(db, userId, "CREATE", "RentCharge", monthKey(month), undefined, { month: monthKey(month), created: res.count });
  return { created: res.count };
}

// ───────────────────────── Do'kon kartasi ─────────────────────────

export type RentShopInput = { name: string; location: string; bankAmount: number; cashAmount: number; electricity: number; tax: number; note: string | null };

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
      if (month && (await tx.rentCharge.count({ where: { month } }))) {
        await tx.rentCharge.create({ data: { shopId: shop.id, month, bankDue: data.bankAmount, cashDue: data.cashAmount, electricity: data.electricity, tax: data.tax } });
      }
      return shop;
    });
    return { id: shop.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: `«${data.location}» da «${data.name}» nomli do'kon allaqachon bor` };
    throw e;
  }
}
