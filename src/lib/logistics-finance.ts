import type { CashTxType, MechanicTarget, Prisma, Role, TransportExpenseKind } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { MAX_AMOUNT } from "./action";
import { canDo } from "./permissions";
import type { Perms } from "./auth";
import { accountBalances, cashOutflowError } from "./payments";
import { money } from "./format";
import { monthRange } from "./brigade-pay";

/* ───────────────────────── Logistika moliya — alohida hisob ─────────────────────────
 *
 * Zavodda logistika moliyasi alohida yuritiladi (foydalanuvchi qarori, 2026-11-12):
 *  · summalar (jami xarajat, daromad, foyda, hisob qoldig'i) — faqat direktor, ish boshqaruvchi va mexanik (`money`);
 *  · logistika puli (naqd reys haqi, usta puli, transport ta'miri, oylik reys haqi) — ish boshqaruvchi beradi (`fin_pay`),
 *    har to'lovda manba tanlanadi: zavod kassa/banki yoki logistika hisobi (`LogisticsAccount`);
 *  · logistika hisobidagi kirim-chiqim zavod kassasiga umuman tushmaydi; zavod hisobidan berilgani esa kassa qoldig'i
 *    to'g'ri bo'lishi uchun kassada hujjatga bog'langan qator bo'lib turadi (`refType` = "LogisticsTx", tahrirlanmaydi);
 *  · qayerdan berilmasin — hammasi shu yerda, Logistika moliya jurnalida ko'rinadi.
 *
 * Ikki xil hisob: «Foyda» — tannarx (yoqilg'i, haydovchi haqi, ta'mir, boshqa — `avtoReport`, dastavka haqi avtomatik
 * daromad), «Kirim-chiqim» — pul harakati (shu fayldagi jurnal). Yoqilg'i va reys haqi Foydaga zapravka va reys narxidan
 * tushadi — ularning to'lovi jurnalda, xarajatga ikki marta qo'shilmaydi.
 */

type Tx = Prisma.TransactionClient;
type Who = { role: Role; perms?: Perms };

/** Logistika summalarini ko'radi (direktor — har doim; rol bo'yicha ish boshqaruvchi va mexanik). */
export const canSeeLogiMoney = (who: Who) => canDo(who, "logistika", "money");
/** Logistika pulini beradi: mexanik so'rovi (transport, reys haqi), oylik reys haqi. */
export const canLogiPay = (who: Who) => canDo(who, "logistika", "fin_pay");
/** Logistika moliyaga qo'lda kirim / chiqim / o'tkazma yozadi. */
export const canLogiWrite = (who: Who) => canDo(who, "logistika", "fin_write");

/** To'lov manbai tanlovida logistika hisobi: `L:<id>`; zavod hisobi — oddiy `CashAccount.id`. */
export const LOGI_ACC = "L:";
export const isLogiAcc = (v: string) => v.startsWith(LOGI_ACC);
const logiAccId = (v: string) => v.slice(LOGI_ACC.length);

export const LOGI_EXPENSE = ["Yoqilg'i", "Haydovchi haqi", "Ta'mir", "Ehtiyot qism", "Vulkanizator", "Yo'l kira, shtraf", "Yollanma texnika", "Boshqa chiqim"] as const;
export const LOGI_TRANSFER_IN = "Zavod hisobidan o'tkazma";
export const LOGI_INCOME = ["Transport xizmati", "Obyektda olindi (dastavka)", LOGI_TRANSFER_IN, "Boshqa kirim"] as const;

/** Mashinaga yozilsa Foydaga ham tushadigan toifalar (yoqilg'i — zapravkadan, haydovchi haqi — reys narxidan, takrorlanmasin). */
const EXPENSE_KIND: Record<string, TransportExpenseKind> = {
  "Ta'mir": "REPAIR", "Ehtiyot qism": "PARTS", "Vulkanizator": "REPAIR", "Yo'l kira, shtraf": "ROAD", "Yollanma texnika": "OTHER", "Boshqa chiqim": "OTHER",
};
/** Zavod kassasidagi qator: «Transport» manbasi va shu toifaga mos sub manba (daraxtda bo'lsa). */
const CASH_SUB: Record<string, string> = {
  "Yoqilg'i": "Yoqilg'i", "Ta'mir": "Transport ta'miri va zapchast", "Ehtiyot qism": "Transport ta'miri va zapchast", "Vulkanizator": "Transport ta'miri va zapchast",
  "Yo'l kira, shtraf": "Yo'l kira, shtraf, sug'urta", "Yollanma texnika": "Yollanma texnika",
};
const CASH_EXPENSE_CATEGORY = "Transport";
const CASH_EXPENSE_SUB_DEFAULT = "Logistika xarajatlari";
const CASH_INCOME_CATEGORY = "Xizmat (nasos, transport)";
/** Zavod kassasidagi qatorning `refType` i — kassa uni hujjatga bog'langan deb qulflaydi. */
export const LOGI_REF = "LogisticsTx";
/**
 * Kassadan biriktirilgan yozuv: zavod kassasida avval to'g'ridan yozilgan transport kirim/chiqimi logistikaga olinadi
 * (`refId` = kassa qatori id). Kassa qatori o'z joyida qoladi (qoldiq, PNL o'zgarmaydi), faqat hujjatga bog'lanadi.
 * Bekor qilinsa — kassa qatori bekor bo'lmaydi, logistikadan ajratiladi.
 */
export const CASH_LINK_REF = "CashLink";
/** Oylik reys haqi yozuvi: `refId` = «YYYY-MM:<haydovchi id>». */
export const DRIVER_MONTH_REF = "DriverMonthPay";
/** Naqd reys haqi mexanik so'rovi muammo turi (`lib/driver-trip-pay.ts` → `TRIP_PAY_PROBLEM`). */
const TRIP_PAY = "Reys haqi";

/** Mexanik so'rovi logistikanikimi: transport (ta'mir, usta puli) yoki haydovchi reys haqi. Zavod/boshqa — kassa ishi. */
export const isLogiRequest = (r: { target: MechanicTarget; problem: string; tripId?: string | null }) =>
  r.target === "TRANSPORT" || r.problem === TRIP_PAY || !!r.tripId;
/** Prisma sharti: logistika so'rovlari (yuqoridagi qoida bilan bir xil). */
export const LOGI_REQUEST_WHERE = { OR: [{ target: "TRANSPORT" as const }, { problem: TRIP_PAY }, { tripId: { not: null } }] };
/** Prisma sharti: zavod so'rovlari — kassir faqat shularni ko'radi va to'laydi. */
export const FACTORY_REQUEST_WHERE = { NOT: LOGI_REQUEST_WHERE };

export type LogiResult = { id?: string; docNo?: string; error?: string; note?: string };
/** Foydalanuvchiga ko'rinadigan xato (o'zbekcha) — sklad chiqimi ham shuni o'z xatosiga aylantiradi. */
export class LogiError extends Error {}
const r2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string | null | undefined, max = 300) => { const t = (s ?? "").trim(); return t ? t.slice(0, max) : null; };

// ───────────────────────── Hisoblar va qoldiq ─────────────────────────

/** Logistika hisoblari qoldig'i (butun davr, bekor qilinganlarsiz). */
export async function logiBalances(client: Tx | typeof db = db, ids?: string[]): Promise<Map<string, number>> {
  const g = await client.logisticsTx.groupBy({
    by: ["accountId", "type"], where: { cancelledAt: null, accountId: ids ? { in: ids } : { not: null } }, _sum: { amount: true },
  });
  const out = new Map<string, number>();
  for (const x of g) {
    if (!x.accountId) continue;
    const v = Number(x._sum.amount ?? 0) * (x.type === "INCOME" ? 1 : -1);
    out.set(x.accountId, r2((out.get(x.accountId) ?? 0) + v));
  }
  return out;
}

export async function logiAccounts() {
  const [acc, bal] = await Promise.all([
    db.logisticsAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }),
    logiBalances(),
  ]);
  return acc.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }));
}

/** Logistika hisobidan chiqim qoldiqdan oshmasin (naqd ham, bank ham — overdraft yo'q). Tranzaksiya ichida, hisob qulfi bilan. */
async function logiOutflowError(tx: Tx, accountId: string, amount: number): Promise<string | null> {
  const acc = await tx.logisticsAccount.findUnique({ where: { id: accountId }, select: { name: true, isActive: true } });
  if (!acc || !acc.isActive) return "Logistika hisobi topilmadi";
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"logi:" + accountId}))`;
  const left = (await logiBalances(tx, [accountId])).get(accountId) ?? 0;
  if (amount > left + 0.005) return `${acc.name}da yetarli pul yo'q: qoldiq ${money(left)}, chiqim ${money(amount)}`;
  return null;
}

/**
 * To'lov manbai tanlovi: zavod kassa/banki (oddiy id) va logistika hisoblari (`L:<id>`), qoldig'i bilan.
 * `logi` — logistika to'lovi (logistika hisoblari ham chiqadi, birinchi bo'lib); aks holda faqat zavod hisoblari.
 */
export async function paySources(logi: boolean) {
  const [cash, bal, la] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, allowOverdraft: true } }),
    accountBalances(),
    logi ? logiAccounts() : Promise.resolve([]),
  ]);
  return [
    ...la.map((a) => ({ id: `${LOGI_ACC}${a.id}`, name: a.name, type: a.type, group: "Logistika hisobi" as const, balance: a.balance, allowOverdraft: false })),
    ...cash.map((a) => ({ id: a.id, name: a.name, type: a.type, group: "Zavod hisobi" as const, balance: bal.get(a.id) ?? 0, allowOverdraft: a.allowOverdraft })),
  ];
}
export type PaySource = Awaited<ReturnType<typeof paySources>>[number];
export const paySourceLabel = (a: PaySource) => `${a.group}: ${a.name} (${a.type === "CASH" ? "naqd" : "bank"}) · qoldiq ${money(a.balance)}`;

/** Zavod kassasidagi sub manba — daraxtda bo'lsa (bo'lmasa bo'sh qoladi, manba «Transport»). */
async function cashSub(tx: Tx, category: string): Promise<string | null> {
  const name = CASH_SUB[category] ?? CASH_EXPENSE_SUB_DEFAULT;
  const hit = await tx.cashCategory.findFirst({ where: { name, parent: { name: CASH_EXPENSE_CATEGORY } }, select: { name: true } });
  return hit?.name ?? null;
}

// ───────────────────────── Yozish: bitta yadro ─────────────────────────

type CoreInput = {
  type: CashTxType; date: Date; amount: number; category: string;
  /** Logistika hisobi (`L:<id>`) yoki zavod kassa/banki id. Kirimda — pul qayerga tushdi, chiqimda — qayerdan chiqdi */
  source: string;
  /** Faqat «Zavod hisobidan o'tkazma» kirimi: qaysi zavod hisobidan (pul logistika hisobiga o'tadi) */
  fromCashAccountId?: string | null;
  vehicleId?: string | null; driverId?: string | null; counterparty?: string | null; note?: string | null;
  refType?: string | null; refId?: string | null; clientToken?: string | null;
  /** Mexanik so'rovi kabi o'zi transport xarajatini yozadigan oqim — bu yerda takrorlanmasin */
  skipExpense?: boolean;
  /**
   * Logistika hisobi qoldig'i tekshirilmaydi (minusga tushishi mumkin) — skladdan zapchast berilganda: sklad xodimi
   * logistika qoldig'ini ko'rmaydi va chiqim pul yetmagani uchun to'xtamasligi kerak (logistika zavodga qarzdor bo'ladi).
   */
  allowNegative?: boolean;
};

/**
 * Logistika moliya yozuvi — tranzaksiya ichida. Qoldiq tekshiruvi (logistika hisobi yoki zavod kassasi), kassa qatori
 * (zavod hisobi bo'lsa), mashinaga yoziladigan xarajat va audit shu yerda. Qaytaradi: yozuv id va raqami.
 */
export async function writeLogiTx(tx: Tx, input: CoreInput, userId: string): Promise<{ id: string; docNo: string }> {
  const amount = r2(input.amount);
  if (!(amount > 0) || amount > MAX_AMOUNT) throw new LogiError("Summa noto'g'ri");
  const logi = isLogiAcc(input.source);
  const transfer = input.type === "INCOME" && input.category === LOGI_TRANSFER_IN;
  if (transfer && (!logi || !input.fromCashAccountId)) throw new LogiError("O'tkazma: qaysi zavod hisobidan va qaysi logistika hisobiga — ikkalasini tanlang");
  const accountId = logi ? logiAccId(input.source) : null;
  const cashAccountId = transfer ? input.fromCashAccountId! : logi ? null : input.source;

  if (accountId) {
    const acc = await tx.logisticsAccount.findUnique({ where: { id: accountId }, select: { isActive: true } });
    if (!acc?.isActive) throw new LogiError("Logistika hisobi topilmadi");
    if (input.type === "EXPENSE" && !input.allowNegative) { const e = await logiOutflowError(tx, accountId, amount); if (e) throw new LogiError(e); }
  }
  // Zavod hisobidan chiqadigan pul (chiqim yoki o'tkazma) — kassa qoldig'idan oshmasin
  if (cashAccountId) {
    const acc = await tx.cashAccount.findUnique({ where: { id: cashAccountId }, select: { isActive: true } });
    if (!acc?.isActive) throw new LogiError("Zavod kassasi / hisobi topilmadi");
    if (input.type === "EXPENSE" || transfer) { const e = await cashOutflowError(tx, cashAccountId, amount); if (e) throw new LogiError(e); }
  }

  const vehicle = input.vehicleId ? await tx.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true, plate: true } }) : null;
  if (input.vehicleId && !vehicle) throw new LogiError("Transport topilmadi");
  const driver = input.driverId ? await tx.employee.findUnique({ where: { id: input.driverId }, select: { id: true, fullName: true } }) : null;
  if (input.driverId && !driver) throw new LogiError("Haydovchi topilmadi");

  const docNo = await nextNo(tx, "logisticsTx", "LM");
  const note = clean(input.note, 500);
  const counterparty = clean(input.counterparty, 200) ?? driver?.fullName ?? null;
  const lt = await tx.logisticsTx.create({
    data: {
      docNo, date: input.date, type: input.type, amount, category: input.category, accountId,
      vehicleId: vehicle?.id ?? null, driverId: driver?.id ?? null, counterparty, note,
      refType: input.refType ?? null, refId: input.refId ?? null, clientToken: input.clientToken ?? null, createdById: userId,
    },
  });

  let cashTxId: string | null = null;
  if (cashAccountId) {
    // Kassada faqat qisqa qator: summa va hujjat raqami (tafsilot — Logistika moliyada)
    const out = input.type === "EXPENSE" || transfer;
    const ct = await tx.cashTransaction.create({
      data: {
        type: out ? "EXPENSE" : "INCOME", date: input.date, cashAccountId, amount,
        category: out ? CASH_EXPENSE_CATEGORY : CASH_INCOME_CATEGORY,
        subCategory: out ? await cashSub(tx, transfer ? "" : input.category) : null,
        counterparty: transfer ? "Logistika hisobi" : counterparty, refType: LOGI_REF, refId: lt.id, createdById: userId,
        note: transfer ? `Logistika hisobiga o'tkazma ${docNo}` : `Logistika ${docNo}`,
      },
    });
    await audit(tx, userId, "CREATE", "CashTransaction", ct.id, undefined, ct);
    cashTxId = ct.id;
  }

  let teId: string | null = null;
  const kind = EXPENSE_KIND[input.category];
  if (input.type === "EXPENSE" && vehicle && kind && !input.skipExpense) {
    const te = await tx.transportExpense.create({
      data: { date: input.date, kind, vehicleId: vehicle.id, driverId: driver?.id ?? null, amount, createdById: userId,
        note: [docNo, input.category, counterparty, note].filter(Boolean).join(" · ").slice(0, 500) },
    });
    await audit(tx, userId, "CREATE", "TransportExpense", te.id, undefined, te);
    teId = te.id;
  }
  if (cashTxId || teId) await tx.logisticsTx.update({ where: { id: lt.id }, data: { cashTxId, transportExpenseId: teId } });
  await audit(tx, userId, "CREATE", "LogisticsTx", lt.id, undefined, { ...lt, cashTxId, transportExpenseId: teId });
  return { id: lt.id, docNo };
}

// ───────────────────────── Skladdan transportga zapchast ─────────────────────────

/** Skladdan transportga berilgan zapchast yozuvi: `refId` — sklad chiqim hujjati (`StockMove.refId`, refType "Issue"). */
export const STOCK_ISSUE_REF = "StockIssue";
const STOCK_ISSUE_CATEGORY = "Ehtiyot qism";

/**
 * Sklad → Chiqim: avto zapchast transportga berildi — shu tranzaksiyada Logistika moliyada chiqim (logistika kassasidan,
 * «Ehtiyot qism», mashina bilan). Mashinaga yozilgani uchun Foydada ham xarajat (`TransportExpense` PARTS) bo'ladi.
 * Zavod kassasiga tushmaydi. Qoldiq yetmasa ham yoziladi (minus = logistikaning zavodga qarzi).
 */
export async function chargeLogiStockIssue(tx: Tx, p: { ref: string; date: Date; amount: number; vehicleId: string; warehouse: string; note: string }, userId: string) {
  // Asosiy logistika kassasi (naqd), bo'lmasa birinchi faol logistika hisobi
  const acc = await tx.logisticsAccount.findFirst({ where: { isActive: true }, orderBy: [{ type: "asc" }, { createdAt: "asc" }], select: { id: true } });
  if (!acc) throw new LogiError("Logistika hisobi yo'q — zapchast summasini yozib bo'lmaydi. Direktor Logistika moliyada hisob ochsin");
  return writeLogiTx(tx, {
    type: "EXPENSE", date: p.date, amount: p.amount, category: STOCK_ISSUE_CATEGORY, source: `${LOGI_ACC}${acc.id}`,
    vehicleId: p.vehicleId, counterparty: `Sklad: ${p.warehouse}`, note: p.note, refType: STOCK_ISSUE_REF, refId: p.ref, allowNegative: true,
  }, userId);
}

/** Sklad chiqimi bekor qilindi — uning Logistika moliya yozuvi va mashina xarajati ham bekor (tranzaksiya ichida). Bekor qilingan raqamlar. */
export async function cancelLogiStockIssue(tx: Tx, ref: string, reason: string, userId: string): Promise<string[]> {
  const list = await tx.logisticsTx.findMany({ where: { refType: STOCK_ISSUE_REF, refId: ref, cancelledAt: null }, select: { id: true, docNo: true, transportExpenseId: true } });
  const now = new Date();
  const why = `Sklad chiqimi bekor: ${reason}`.slice(0, 300);
  for (const t of list) {
    const u = await tx.logisticsTx.updateMany({ where: { id: t.id, cancelledAt: null }, data: { cancelledAt: now, cancelledById: userId, cancelReason: why } });
    if (u.count !== 1) continue;
    if (t.transportExpenseId) {
      await tx.transportExpense.updateMany({ where: { id: t.transportExpenseId, cancelledAt: null }, data: { cancelledAt: now, cancelledById: userId, cancelReason: why } });
    }
    await audit(tx, userId, "STATUS_CHANGE", "LogisticsTx", t.id, { cancelledAt: null }, { cancelledAt: now, reason: why, docNo: t.docNo, stockIssue: ref });
  }
  return list.map((t) => t.docNo);
}

// ───────────────────────── Qo'lda kirim / chiqim ─────────────────────────

export type LogiTxInput = Omit<CoreInput, "refType" | "refId" | "skipExpense" | "allowNegative">;

export async function addLogiTx(input: LogiTxInput, userId: string): Promise<LogiResult> {
  const list: readonly string[] = input.type === "EXPENSE" ? LOGI_EXPENSE : LOGI_INCOME;
  if (!list.includes(input.category)) return { error: "Toifani tanlang" };
  if (!input.source) return { error: input.type === "EXPENSE" ? "Qaysi hisobdan chiqim — tanlang" : "Pul qaysi hisobga tushdi — tanlang" };
  if (input.clientToken) {
    const ex = await db.logisticsTx.findUnique({ where: { clientToken: input.clientToken }, select: { id: true, docNo: true } });
    if (ex) return { id: ex.id, docNo: ex.docNo, note: `Allaqachon yozilgan: ${ex.docNo}` };
  }
  try {
    const r = await db.$transaction((tx) => writeLogiTx(tx, input, userId));
    const what = input.type === "EXPENSE" ? "Chiqim" : input.category === LOGI_TRANSFER_IN ? "O'tkazma" : "Kirim";
    return { ...r, note: `${what} yozildi: ${r.docNo} · ${money(input.amount)}` };
  } catch (e) {
    if (e instanceof LogiError) return { error: e.message };
    if ((e as { code?: string }).code === "P2002" && input.clientToken) {
      const ex = await db.logisticsTx.findUnique({ where: { clientToken: input.clientToken }, select: { id: true, docNo: true } });
      if (ex) return { id: ex.id, docNo: ex.docNo, note: `Allaqachon yozilgan: ${ex.docNo}` };
    }
    throw e;
  }
}

/**
 * Bekor qilish (o'chirilmaydi): kassa qatori va mashina xarajati ham bekor bo'ladi. Mexanik so'rovi puli — bekor qilinmaydi
 * (so'rov «Pul berildi» holatida). Oylik reys haqi bekor qilinsa — reyslar yana vedomostga (yoki qayta to'lashga) qaytadi,
 * shu oy vedomosti tasdiqlanmagan bo'lsa.
 */
export async function cancelLogiTx(id: string, reason: string, userId: string): Promise<LogiResult> {
  const why = clean(reason, 300);
  if (!why || why.length < 3) return { error: "Bekor qilish sababini yozing" };
  const t = await db.logisticsTx.findUnique({ where: { id } });
  if (!t) return { error: "Yozuv topilmadi" };
  if (t.cancelledAt) return { error: "Allaqachon bekor qilingan" };
  if (t.refType === "MechanicRequest") return { error: "Mexanik so'rovining puli — bekor qilib bo'lmaydi" };
  if (t.refType === STOCK_ISSUE_REF) return { error: "Skladdan berilgan zapchast — Sklad → Chiqim jurnalida bekor qilinadi (zapchast skladga qaytadi)" };
  if (t.refType === DRIVER_MONTH_REF) {
    const month = (t.refId ?? "").split(":")[0] ?? "";
    const lock = await payrollMonthLock(month);
    if (lock) return { error: `${lock} — oylik haqni bekor qilib bo'lmaydi` };
  }
  const now = new Date();
  const link = t.refType === CASH_LINK_REF;
  try {
    await db.$transaction(async (tx) => {
      // Kassadan biriktirilgani — `cashTxId` bo'shatiladi (unique), shu kassa qatorini keyin qayta biriktirish mumkin bo'lsin
      const u = await tx.logisticsTx.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: now, cancelledById: userId, cancelReason: why, ...(link ? { cashTxId: null } : {}) } });
      if (u.count !== 1) throw new LogiError("Yozuv boshqa joyda o'zgartirildi — sahifani yangilang");
      // Logistika hisobiga tushgan kirim qaytsa — hisob minusga tushmasin
      if (t.accountId && t.type === "INCOME") { const e = await logiOutflowError(tx, t.accountId, Number(t.amount)); if (e) throw new LogiError(e); }
      if (link && t.cashTxId) {
        // Kassa qatori bekor qilinmaydi — faqat logistikadan ajraladi (yana oddiy kassa yozuvi)
        const c = await tx.cashTransaction.updateMany({ where: { id: t.cashTxId, refType: LOGI_REF, refId: id }, data: { refType: null, refId: null } });
        if (c.count) await audit(tx, userId, "UPDATE", "CashTransaction", t.cashTxId, { refType: LOGI_REF, refId: id }, { refType: null, refId: null, unlinkedFrom: t.docNo });
      } else if (t.cashTxId) {
        const ct = await tx.cashTransaction.findUnique({ where: { id: t.cashTxId } });
        if (ct && !ct.cancelledAt) {
          // Zavod kassasiga tushgan kirim qaytsa — kassa minusga tushmasin
          if (ct.type === "INCOME") { const e = await cashOutflowError(tx, ct.cashAccountId, Number(ct.amount)); if (e) throw new LogiError(e); }
          await tx.cashTransaction.update({ where: { id: ct.id }, data: { cancelledAt: now, cancelledById: userId, cancelReason: `Logistika ${t.docNo} bekor: ${why}`.slice(0, 300) } });
          await audit(tx, userId, "STATUS_CHANGE", "CashTransaction", ct.id, { cancelledAt: null }, { cancelledAt: now, reason: why, logisticsTx: t.docNo });
        }
      }
      if (t.transportExpenseId) {
        await tx.transportExpense.updateMany({ where: { id: t.transportExpenseId, cancelledAt: null }, data: { cancelledAt: now, cancelledById: userId, cancelReason: `Logistika ${t.docNo} bekor: ${why}`.slice(0, 300) } });
      }
      if (t.refType === DRIVER_MONTH_REF) {
        await tx.trip.updateMany({ where: { payLogiTxId: id }, data: { payLogiTxId: null } });
        await tx.logisticsEntry.updateMany({ where: { payLogiTxId: id }, data: { payLogiTxId: null } });
      }
      await audit(tx, userId, "STATUS_CHANGE", "LogisticsTx", id, { cancelledAt: null }, { cancelledAt: now, reason: why, docNo: t.docNo });
    });
  } catch (e) {
    if (e instanceof LogiError) return { error: e.message };
    throw e;
  }
  return { id, docNo: t.docNo, note: link ? `${t.docNo} logistikadan ajratildi — kassa yozuvi o'z joyida` : `${t.docNo} bekor qilindi` };
}

// ───────────────────────── Jurnal: qayerdan bo'lmasin — hammasi ─────────────────────────

export type LogiSourceKind = "LOGI" | "FACTORY" | "TRANSFER";
export type LogiJournalRow = {
  key: string; at: Date; docNo: string; kind: LogiSourceKind; account: string; type: CashTxType; category: string;
  vehicle: string | null; who: string | null; amount: number; note: string | null; href: string | null;
  /** Logistika moliya yozuvi (bekor qilish shu orqali) — kassadan to'g'ridan yozilganlarda null */
  logiTxId: string | null; cancellable: boolean;
  /** Kassadan biriktirilgan — bekor qilish = ajratish */
  linked: boolean;
  /** Skladdan transportga zapchast: sklad chiqim hujjati — summa bosilsa zapchastlar va ularning kirimi ko'rinadi */
  stockRef: string | null;
};

/**
 * Davr jurnali: (1) Logistika moliya yozuvlari — logistika hisobidan, zavod hisobidan va o'tkazmalar; (2) zavod kassasida
 * to'g'ridan yozilgan logistika pullari — «Transport» manbasi (sub manbalari bilan, PNL «Avtotransport» qatori) va
 * logistika mexanik so'rovlari (transport, reys haqi) kassadan to'langani. (1) ning kassa qatori (2) da takrorlanmaydi.
 */
export async function logiJournal(from: Date, to: Date) {
  const range = { gte: from, lt: to };
  const [own, names] = await Promise.all([
    db.logisticsTx.findMany({ where: { cancelledAt: null, date: range }, orderBy: { date: "desc" } }),
    transportCashNames(),
  ]);
  const cashRows = await db.cashTransaction.findMany({
    where: {
      // `NOT: { refType }` NULL qatorlarni ham chiqarib tashlaydi (SQL) — bog'lanmagan kassa yozuvlari shu yerda kerak
      cancelledAt: null, date: range,
      AND: [
        { OR: [{ refType: null }, { refType: { not: LOGI_REF } }] },
        { OR: [{ category: { in: names } }, { subCategory: { in: names } }, { refType: "MechanicRequest" }] },
      ],
    },
    orderBy: { date: "desc" },
    select: { id: true, date: true, type: true, amount: true, category: true, subCategory: true, counterparty: true, note: true, refType: true, refId: true, cashAccount: { select: { name: true } } },
  });
  const reqIds = cashRows.filter((c) => c.refType === "MechanicRequest" && c.refId).map((c) => c.refId!);
  const reqs = new Map((reqIds.length
    ? await db.mechanicRequest.findMany({ where: { id: { in: reqIds } }, select: { id: true, docNo: true, target: true, problem: true, tripId: true, payee: true, vehicle: { select: { plate: true } } } })
    : []).map((r) => [r.id, r]));

  const ownCashIds = own.flatMap((t) => (t.cashTxId ? [t.cashTxId] : []));
  const vehIds = [...new Set(own.flatMap((t) => (t.vehicleId ? [t.vehicleId] : [])))];
  const drvIds = [...new Set(own.flatMap((t) => (t.driverId ? [t.driverId] : [])))];
  const accIds = [...new Set(own.flatMap((t) => (t.accountId ? [t.accountId] : [])))];
  const [ownCash, vehs, drvs, accs] = await Promise.all([
    ownCashIds.length ? db.cashTransaction.findMany({ where: { id: { in: ownCashIds } }, select: { id: true, cashAccount: { select: { name: true } } } }) : Promise.resolve([]),
    vehIds.length ? db.vehicle.findMany({ where: { id: { in: vehIds } }, select: { id: true, plate: true } }) : Promise.resolve([]),
    drvIds.length ? db.employee.findMany({ where: { id: { in: drvIds } }, select: { id: true, fullName: true } }) : Promise.resolve([]),
    accIds.length ? db.logisticsAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const cashAcc = new Map(ownCash.map((c) => [c.id, c.cashAccount.name]));
  const plate = new Map(vehs.map((v) => [v.id, v.plate]));
  const drv = new Map(drvs.map((d) => [d.id, d.fullName]));
  const accName = new Map(accs.map((a) => [a.id, a.name]));

  const rows: LogiJournalRow[] = [];
  for (const t of own) {
    const kind: LogiSourceKind = t.accountId && t.cashTxId ? "TRANSFER" : t.accountId ? "LOGI" : "FACTORY";
    const la = t.accountId ? accName.get(t.accountId) ?? "Logistika hisobi" : null;
    const ca = t.cashTxId ? cashAcc.get(t.cashTxId) ?? "Zavod kassasi" : null;
    rows.push({
      key: `L${t.id}`, at: t.date, docNo: t.docNo, kind,
      account: kind === "TRANSFER" ? `${ca} → ${la}` : (la ?? ca ?? "—"),
      type: t.type, category: t.category, vehicle: t.vehicleId ? plate.get(t.vehicleId) ?? null : null,
      who: t.driverId ? drv.get(t.driverId) ?? t.counterparty : t.counterparty, amount: Number(t.amount), note: t.note,
      href: t.refType === "MechanicRequest" && t.refId ? `/mexanik-sorovlar/${t.refId}` : null,
      logiTxId: t.id, cancellable: t.refType !== "MechanicRequest" && t.refType !== STOCK_ISSUE_REF, linked: t.refType === CASH_LINK_REF,
      stockRef: t.refType === STOCK_ISSUE_REF ? t.refId : null,
    });
  }
  for (const c of cashRows) {
    const req = c.refType === "MechanicRequest" && c.refId ? reqs.get(c.refId) : null;
    if (c.refType === "MechanicRequest" && (!req || !isLogiRequest(req))) continue; // zavod ta'miri — logistika emas
    rows.push({
      key: `C${c.id}`, at: c.date, docNo: req?.docNo ?? "Kassa", kind: "FACTORY", account: c.cashAccount.name, type: c.type,
      category: req ? (req.problem === TRIP_PAY || req.tripId ? "Haydovchi haqi" : req.problem) : (c.subCategory ?? c.category),
      vehicle: req?.vehicle?.plate ?? null, who: req?.payee ?? c.counterparty, amount: Number(c.amount), note: c.note,
      href: req ? `/mexanik-sorovlar/${req.id}` : null, logiTxId: null, cancellable: false, linked: false, stockRef: null,
    });
  }
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());

  const sum = (f: (r: LogiJournalRow) => boolean) => r2(rows.filter(f).reduce((s, r) => s + r.amount, 0));
  const totals = {
    /** Logistika hisobiga tushgan kirim (o'tkazma ham) */
    income: sum((r) => r.type === "INCOME"),
    transferIn: sum((r) => r.kind === "TRANSFER"),
    expense: sum((r) => r.type === "EXPENSE"),
    expenseFactory: sum((r) => r.type === "EXPENSE" && r.kind === "FACTORY"),
    expenseLogi: sum((r) => r.type === "EXPENSE" && r.kind === "LOGI"),
  };
  return { rows, totals };
}

// ───────────────────────── Kassadan logistikaga biriktirish ─────────────────────────

/** Kassa sub manbasi → logistika toifasi (`CASH_SUB` ning teskarisi). */
const SUB_TO_LOGI: Record<string, string> = {
  "Yoqilg'i": "Yoqilg'i", "Transport ta'miri va zapchast": "Ta'mir", "Yo'l kira, shtraf, sug'urta": "Yo'l kira, shtraf", "Yollanma texnika": "Yollanma texnika",
};
/** Izoh / kimga / manba matnidan toifa (lotin va kirill). Birinchi mos kelgani olinadi. */
const LOGI_KEYWORDS: [RegExp, string][] = [
  [/vulkan|balon|ballon|shina|pokrishk|вулкан|балон|баллон|шина|покрышк/, "Vulkanizator"],
  [/zapchast|ehtiyot|запчаст|эхтиёт/, "Ehtiyot qism"],
  [/ta'?mir|remont|usta|ремонт|таъмир|уста/, "Ta'mir"],
  [/yoqil|solyar|dizel|benzin|metan|propan|zapravk|ёқил|соляр|дизел|бензин|метан|пропан|заправк/, "Yoqilg'i"],
  [/shtraf|yo'?l kira|sug'?urta|strax|штраф|йўл|суғурта|страх/, "Yo'l kira, shtraf"],
  [/yollanma|arenda|ijara|наём|аренд|ижара/, "Yollanma texnika"],
];
export function guessLogiCategory(c: { type: CashTxType; category: string; subCategory: string | null; note: string | null; counterparty: string | null }): string {
  if (c.type === "INCOME") return "Transport xizmati";
  const byName = SUB_TO_LOGI[c.subCategory ?? ""] ?? SUB_TO_LOGI[c.category];
  if (byName) return byName;
  const text = `${c.subCategory ?? ""} ${c.note ?? ""} ${c.counterparty ?? ""}`.toLowerCase().replace(/[ʻʼ‘’`]/g, "'");
  return LOGI_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? "Boshqa chiqim";
}
const plateKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");

/** Zavod kassasidagi transport yozuvlari manbalari: «Transport» va PNL «Avtotransport» qatoridagi manbalar (chiqim), transport xizmati (kirim). */
async function transportCashNames() {
  const cats = await db.cashCategory.findMany({ where: { pnlLine: "TRANSPORT" }, select: { name: true } });
  return [...new Set([CASH_EXPENSE_CATEGORY, ...cats.map((c) => c.name)])];
}

const LINK_LIMIT = 200;

/**
 * Logistikaga hali olinmagan kassa yozuvlari (butun davr, yangisi tepada): transport chiqimlari va transport xizmati kirimi.
 * Hujjatga bog'langan qatorlar (mexanik so'rovi, kirim hujjati…) — o'z hujjatida, bu yerga chiqmaydi.
 * Har qatorga taklif: toifa (sub manba / izohdan) va mashina (izohdagi davlat raqamidan).
 */
export async function cashLinkCandidates() {
  const names = await transportCashNames();
  const where: Prisma.CashTransactionWhereInput = {
    cancelledAt: null, refType: null,
    OR: [
      { type: "EXPENSE", OR: [{ category: { in: names } }, { subCategory: { in: names } }] },
      { type: "INCOME", category: CASH_INCOME_CATEGORY },
    ],
  };
  const [total, rows, vehicles] = await Promise.all([
    db.cashTransaction.count({ where }),
    db.cashTransaction.findMany({
      where, orderBy: { date: "desc" }, take: LINK_LIMIT,
      select: { id: true, date: true, type: true, amount: true, category: true, subCategory: true, counterparty: true, note: true, cashAccount: { select: { name: true } } },
    }),
    db.vehicle.findMany({ select: { id: true, plate: true } }),
  ]);
  const plates = vehicles.map((v) => ({ id: v.id, key: plateKey(v.plate) })).filter((p) => p.key.length >= 5);
  return {
    total,
    rows: rows.map((c) => {
      const text = plateKey(`${c.note ?? ""} ${c.counterparty ?? ""} ${c.subCategory ?? ""}`);
      return {
        id: c.id, date: c.date, type: c.type, amount: Number(c.amount), account: c.cashAccount.name,
        source: [c.category, c.subCategory].filter(Boolean).join(" · "), counterparty: c.counterparty, note: c.note,
        category: guessLogiCategory(c), vehicleId: (text && plates.find((p) => text.includes(p.key))?.id) || null,
      };
    }),
  };
}

export type CashLinkItem = { cashTxId: string; category: string; vehicleId?: string | null; driverId?: string | null };

/**
 * Tanlangan kassa yozuvlarini logistikaga oladi — bitta tranzaksiyada (biri o'xshamasa, hech biri yozilmaydi).
 * Har biriga LM-… yozuv: summa, sana, tur kassadagidek; kassa qatori `refType` = "LogisticsTx" bilan bog'lanadi
 * (kassada qulflanadi, qoldiq va PNL o'zgarmaydi). Mashinaga yozilgan ta'mir/zapchast/yo'l xarajati Foydaga ham tushadi.
 */
export async function linkCashToLogi(items: CashLinkItem[], userId: string): Promise<LogiResult & { count?: number }> {
  const list = items.filter((i) => i.cashTxId).slice(0, LINK_LIMIT);
  if (!list.length) return { error: "Qatorlarni belgilang" };
  const incomeCats: readonly string[] = LOGI_INCOME.filter((c) => c !== LOGI_TRANSFER_IN);
  try {
    const docs = await db.$transaction(async (tx) => {
      const out: string[] = [];
      for (const it of list) {
        const ct = await tx.cashTransaction.findUnique({ where: { id: it.cashTxId }, select: { id: true, date: true, type: true, amount: true, counterparty: true, note: true, refType: true, cancelledAt: true } });
        if (!ct || ct.cancelledAt) throw new LogiError("Kassa yozuvi topilmadi yoki bekor qilingan — sahifani yangilang");
        if (ct.refType) throw new LogiError(`Kassa yozuvi (${money(Number(ct.amount))}) allaqachon hujjatga bog'langan — sahifani yangilang`);
        if (ct.type !== "EXPENSE" && ct.type !== "INCOME") throw new LogiError("Faqat kirim yoki chiqimni olish mumkin");
        const cats: readonly string[] = ct.type === "EXPENSE" ? LOGI_EXPENSE : incomeCats;
        if (!cats.includes(it.category)) throw new LogiError(`${money(Number(ct.amount))}: toifani tanlang`);
        const vehicle = it.vehicleId ? await tx.vehicle.findUnique({ where: { id: it.vehicleId }, select: { id: true } }) : null;
        if (it.vehicleId && !vehicle) throw new LogiError("Transport topilmadi");
        const driver = it.driverId ? await tx.employee.findUnique({ where: { id: it.driverId }, select: { id: true, fullName: true } }) : null;
        if (it.driverId && !driver) throw new LogiError("Haydovchi topilmadi");

        const docNo = await nextNo(tx, "logisticsTx", "LM");
        const counterparty = ct.counterparty ?? driver?.fullName ?? null;
        const lt = await tx.logisticsTx.create({
          data: {
            docNo, date: ct.date, type: ct.type, amount: ct.amount, category: it.category, accountId: null, cashTxId: ct.id,
            vehicleId: vehicle?.id ?? null, driverId: driver?.id ?? null, counterparty, note: ct.note,
            refType: CASH_LINK_REF, refId: ct.id, createdById: userId,
          },
        });
        // Shartli: shu orada boshqa joyda bog'langan / bekor qilingan bo'lsa — hammasi qaytadi
        const u = await tx.cashTransaction.updateMany({ where: { id: ct.id, refType: null, cancelledAt: null }, data: { refType: LOGI_REF, refId: lt.id } });
        if (u.count !== 1) throw new LogiError("Kassa yozuvi boshqa joyda o'zgartirildi — sahifani yangilang");
        await audit(tx, userId, "UPDATE", "CashTransaction", ct.id, { refType: null, refId: null }, { refType: LOGI_REF, refId: lt.id, logisticsTx: docNo });

        let teId: string | null = null;
        const kind = EXPENSE_KIND[it.category];
        if (ct.type === "EXPENSE" && vehicle && kind) {
          const te = await tx.transportExpense.create({
            data: { date: ct.date, kind, vehicleId: vehicle.id, driverId: driver?.id ?? null, amount: ct.amount, createdById: userId,
              note: [docNo, it.category, counterparty, ct.note].filter(Boolean).join(" · ").slice(0, 500) },
          });
          await audit(tx, userId, "CREATE", "TransportExpense", te.id, undefined, te);
          teId = te.id;
          await tx.logisticsTx.update({ where: { id: lt.id }, data: { transportExpenseId: teId } });
        }
        await audit(tx, userId, "CREATE", "LogisticsTx", lt.id, undefined, { ...lt, transportExpenseId: teId });
        out.push(docNo);
      }
      return out;
    }, { timeout: 120_000, maxWait: 10_000 });
    return { count: docs.length, note: `Logistikaga olindi: ${docs.length} ta yozuv (${docs[0]}${docs.length > 1 ? ` … ${docs[docs.length - 1]}` : ""})` };
  } catch (e) {
    if (e instanceof LogiError) return { error: e.message };
    if ((e as { code?: string }).code === "P2002") return { error: "Kassa yozuvi allaqachon logistikaga olingan — sahifani yangilang" };
    throw e;
  }
}

// ───────────────────────── Oylik reys haqi: vedomost yoki logistika hisobi ─────────────────────────

/** Shu oy zavod vedomosti yuborilgan/tasdiqlangan bo'lsa — reys haqi vedomost orqali to'lanadi (xato matni), aks holda null. */
export async function payrollMonthLock(month: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Oy noto'g'ri";
  const run = await db.payrollRun.findFirst({ where: { month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true, status: true } });
  return run ? `Shu oy yakuniy vedomosti ${run.docNo} ${run.status === "SUBMITTED" ? "tasdiqqa yuborilgan" : "tasdiqlangan"}` : null;
}

const monthTrips = (month: string) => {
  const { from, to } = monthRange(month);
  return { status: "DELIVERED" as const, deliveredAt: { gte: from, lt: to }, payType: "PAYROLL" as const, payApprovedAt: { not: null }, payAmount: { gt: 0 } };
};
const monthEntries = (month: string) => {
  const { from, to } = monthRange(month);
  return { cancelledAt: null, date: { gte: from, lt: to }, payType: "PAYROLL" as const, payApprovedAt: { not: null }, payAmount: { gt: 0 }, driverId: { not: null } };
};

/**
 * Oy bo'yicha haydovchilarning tasdiqlangan oylik reys haqi: hali to'lanmagani (vedomostga tushadi yoki logistika hisobidan
 * beriladi) va logistika hisobidan berilgani. `draft` — vedomost qoralamasi bor (logistikadan bersangiz qayta hisoblash kerak).
 */
export async function driverMonthPays(month: string) {
  const [lock, draft, tripsDue, entriesDue, paid] = await Promise.all([
    payrollMonthLock(month),
    db.payrollRun.count({ where: { month, kind: "FINAL", status: "DRAFT" } }),
    db.trip.groupBy({ by: ["driverId"], where: { ...monthTrips(month), payLogiTxId: null }, _sum: { payAmount: true }, _count: true }),
    db.logisticsEntry.groupBy({ by: ["driverId"], where: { ...monthEntries(month), payLogiTxId: null }, _sum: { payAmount: true }, _count: true }),
    db.logisticsTx.findMany({ where: { refType: DRIVER_MONTH_REF, refId: { startsWith: `${month}:` }, cancelledAt: null }, select: { id: true, docNo: true, amount: true, driverId: true, date: true } }),
  ]);
  const by = new Map<string, { driverId: string; trips: number; entries: number; due: number; paid: number; paidDocs: string[] }>();
  const get = (id: string) => { let x = by.get(id); if (!x) by.set(id, (x = { driverId: id, trips: 0, entries: 0, due: 0, paid: 0, paidDocs: [] })); return x; };
  for (const t of tripsDue) { const x = get(t.driverId); x.trips += t._count; x.due += Number(t._sum.payAmount ?? 0); }
  for (const e of entriesDue) { if (!e.driverId) continue; const x = get(e.driverId); x.entries += e._count; x.due += Number(e._sum.payAmount ?? 0); }
  for (const p of paid) { if (!p.driverId) continue; const x = get(p.driverId); x.paid += Number(p.amount); x.paidDocs.push(p.docNo); }
  const names = new Map((by.size ? await db.employee.findMany({ where: { id: { in: [...by.keys()] } }, select: { id: true, fullName: true } }) : []).map((e) => [e.id, e.fullName]));
  const rows = [...by.values()].map((x) => ({ ...x, due: r2(x.due), paid: r2(x.paid), driver: names.get(x.driverId) ?? "—" })).sort((a, b) => a.driver.localeCompare(b.driver));
  return { lock, draft: draft > 0, rows };
}

/**
 * Haydovchining shu oydagi tasdiqlangan oylik reys haqini (reyslar + qo'lda yozuvlar) bir yozuv bilan to'laydi —
 * logistika hisobidan yoki zavod kassasidan. To'langan reyslar zavod vedomostiga tushmaydi (`payLogiTxId`).
 */
export async function payDriverMonth(month: string, driverId: string, source: string, userId: string, note?: string | null): Promise<LogiResult> {
  const lock = await payrollMonthLock(month);
  if (lock) return { error: `${lock} — reys haqi vedomost orqali to'lanadi` };
  if (!source) return { error: "Qaysi hisobdan to'lash — tanlang" };
  try {
    const r = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`logipay:${month}:${driverId}`}))`;
      const [trips, entries] = await Promise.all([
        tx.trip.findMany({ where: { ...monthTrips(month), driverId, payLogiTxId: null }, select: { id: true, payAmount: true } }),
        tx.logisticsEntry.findMany({ where: { ...monthEntries(month), driverId, payLogiTxId: null }, select: { id: true, payAmount: true } }),
      ]);
      const amount = r2([...trips, ...entries].reduce((s, x) => s + Number(x.payAmount ?? 0), 0));
      if (!(amount > 0)) throw new LogiError("To'lanadigan oylik reys haqi yo'q — sahifani yangilang");
      // Sana — to'lov kuni, qaysi oy uchun — `refId` da
      const w = await writeLogiTx(tx, {
        type: "EXPENSE", date: new Date(), amount, category: "Haydovchi haqi", source, driverId,
        note: [`Oylik reys haqi ${month}: ${trips.length} reys${entries.length ? `, ${entries.length} qo'lda yozuv` : ""}`, clean(note, 200)].filter(Boolean).join(" · "),
        refType: DRIVER_MONTH_REF, refId: `${month}:${driverId}`, skipExpense: true,
      }, userId);
      const ut = await tx.trip.updateMany({ where: { id: { in: trips.map((t) => t.id) }, payLogiTxId: null }, data: { payLogiTxId: w.id } });
      const ue = await tx.logisticsEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) }, payLogiTxId: null }, data: { payLogiTxId: w.id } });
      if (ut.count !== trips.length || ue.count !== entries.length) throw new LogiError("Reyslar boshqa joyda o'zgartirildi — sahifani yangilang");
      return { ...w, amount };
    });
    return { id: r.id, docNo: r.docNo, note: `To'landi: ${r.docNo} · ${money(r.amount)}` };
  } catch (e) {
    if (e instanceof LogiError) return { error: e.message };
    throw e;
  }
}

/** Ish boshqaruvchi berishi kerak bo'lgan (tasdiqlangan) logistika so'rovlari — Logistika moliya → «To'lovlar». */
export async function logiRequestsToPay() {
  return db.mechanicRequest.findMany({
    where: { status: "APPROVED", ...LOGI_REQUEST_WHERE }, orderBy: [{ urgent: "desc" }, { decidedAt: "asc" }], take: 200,
    select: { id: true, docNo: true, amount: true, problem: true, payee: true, decidedAt: true, urgent: true, target: true, object: true, vehicle: { select: { plate: true } }, createdBy: { select: { fullName: true } } },
  });
}
