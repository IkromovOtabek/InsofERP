import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money } from "@/lib/format";
import { cashOutflowError } from "@/lib/payments";
import { lockReceipt, receiptPayState } from "@/lib/receipt-payables";
import { PEREKIT_CATEGORY } from "@/lib/cash-categories";
import { MAX_AMOUNT } from "@/lib/action";

/**
 * Qo'lda kirim/chiqim yozish — yagona joy: veb "Kirim-Chiqim" formasi ham (`cashflow/actions.ts`),
 * mobil ilovadagi kassa ham (`lib/mobile/create.ts`) shu yerdan.
 *
 * Qoidalar:
 *  · hisob bo'yicha navbat (advisory lock) — dublikat va qoldiq tekshiruvi parallel so'rovlarda ham to'g'ri;
 *  · kirim hujjatiga (GoodsReceipt) faqat chiqim bog'lanadi, qisman to'lov mumkin, qolgandan ortig'i — yo'q;
 *  · ta'minot zanjiridan kelgan / storno qilingan kirimga to'lov yozilmaydi;
 *  · naqd kassa minusga tushmaydi, bank — faqat direktor overdraft ruxsat bergan bo'lsa (`cashOutflowError`);
 *  · bir xil yozuv 60 soniya ichida qayta kelsa — ikki marta bosilgan deb rad etiladi.
 */
export type CashEntryInput = {
  type: "INCOME" | "EXPENSE";
  date: Date;
  cashAccountId: string;
  amount: number;
  category: string;
  counterparty?: string | null;
  supplierId?: string | null;
  /** Chiqim qaysi kirim hujjati (yetkazuvchidan olingan mol) uchun. */
  receiptId?: string | null;
  note?: string | null;
};

class CashError extends Error {}

/** Bir xil yozuv shu oraliqda qayta kelsa — ikki marta bosilgan deb hisoblanadi (to'lovlardagi kabi). */
const DUPLICATE_WINDOW_MS = 60_000;

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function createCashEntry(input: CashEntryInput, userId: string): Promise<{ id?: string; error?: string }> {
  const { receiptId, ...d } = { ...input, amount: r2(input.amount) };
  if (!(d.amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (receiptId && d.type !== "EXPENSE") return { error: "Kirim hujjatiga faqat chiqim (to'lov) bog'lanadi" };
  // Perekit — o'tkazma hujjati (`lib/cash-transfer.ts`), oddiy chiqim bo'lib yozilmaydi
  if (d.category === PEREKIT_CATEGORY) return { error: "Perekit — hisoblararo o'tkazma: «Kassa ⇄ bank» orqali yozing" };
  const acc = await db.cashAccount.findFirst({ where: { id: d.cashAccountId, isActive: true }, select: { id: true } });
  if (!acc) return { error: "Kassa/hisob topilmadi yoki yopilgan" };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + d.cashAccountId}))`;
    // Kirim hujjatiga bog'langan to'lov: kirim qulfi ostida qolgan summa tekshiriladi — "To'lash" tugmasi
    // va qo'lda chiqim bir kirimni ikki marta to'lab yubormasin (qisman to'lov mumkin, ortiqchasi yo'q)
    let link: { refType: string; refId: string; supplierId: string; counterparty: string } | null = null;
    if (receiptId) {
      await lockReceipt(tx, receiptId);
      const st = await receiptPayState(tx, receiptId);
      if (!st) throw new CashError("Kirim hujjati topilmadi");
      if (st.cancelled) throw new CashError(`${st.docNo} bekor qilingan — unga to'lov yozilmaydi`);
      if (st.fromSupply) throw new CashError(`${st.docNo} ta'minot zayavkasidan — uning puli ta'minot zanjirida to'langan`);
      if (d.supplierId && d.supplierId !== st.supplierId) throw new CashError(`${st.docNo} boshqa yetkazuvchiniki (${st.supplierName})`);
      if (st.left <= 0.005) throw new CashError(`${st.docNo} to'liq to'langan (${money(st.paid)})`);
      if (d.amount > st.left + 0.005) throw new CashError(`${st.docNo} bo'yicha qolgan to'lov ${money(st.left)} — ${money(d.amount)} ortiqcha`);
      link = { refType: "GoodsReceipt", refId: st.id, supplierId: st.supplierId, counterparty: d.counterparty ?? st.supplierName };
    }
    const dup = await tx.cashTransaction.findFirst({
      where: { type: d.type, cashAccountId: d.cashAccountId, amount: d.amount, category: d.category, createdById: userId, cancelledAt: null, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      select: { id: true },
    });
    if (dup) throw new CashError("Aynan shu yozuv hozirgina saqlandi — ikki marta bosilgan bo'lishi mumkin. Rostdan ikkinchisi bo'lsa, bir daqiqadan keyin qayta kiriting");
    // Naqd kassa minusga tushmasin (bank — overdraft ruxsati bo'lmasa)
    if (d.type === "EXPENSE") {
      const err = await cashOutflowError(tx, d.cashAccountId, d.amount);
      if (err) throw new CashError(err);
    }
    const t = await tx.cashTransaction.create({
      data: {
        type: d.type, date: d.date, cashAccountId: d.cashAccountId, amount: d.amount, category: d.category,
        counterparty: d.counterparty ?? null, supplierId: d.supplierId ?? null, note: d.note ?? null,
        ...(link ?? {}), createdById: userId,
      },
    });
    await audit(tx, userId, "CREATE", "CashTransaction", t.id, undefined, t);
    return { id: t.id };
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
}

/**
 * Qo'lda yozilgan kirim/chiqimni bekor qilish — veb Kirim-Chiqim jadvalidagi «Bekor qilish» tugmasi (`cashflow/actions.ts`)
 * va mobil ilovadagi kassa yozuvi kartochkasi shu yerdan. Yozuv o'chirilmaydi: `cancelledAt` + sabab bilan qoladi,
 * jurnalda «Bekor qilingan» bo'lib ko'rinadi, qoldiq, jami, hisobot va dashbordlarga kirmaydi; auditga STATUS_CHANGE.
 *
 * Hujjatga bog'langan yozuv (sklad kirimi, ta'minot to'lovi) qo'lda bekor qilinmaydi — u hujjat orqali boshqariladi.
 * Istisno — kirim hujjatiga (GoodsReceipt) to'lov: uni bekor qilish to'lovni qaytarish, kirim yana "to'lanmagan"
 * ro'yxatiga qaytadi (kirimni bekor qilishdan oldin shu kerak). Ta'minot zanjirining chiqimi zanjirda (moliya) boshqariladi.
 */
export async function cancelCashEntry(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  const why = String(reason ?? "").trim();
  if (why.length < 3) return { error: "Bekor qilish sababini yozing (kamida 3 belgi)" };
  const t = await db.cashTransaction.findUnique({ where: { id } });
  if (!t) return { error: "Yozuv topilmadi" };
  if (t.cancelledAt) return { error: "Bu yozuv allaqachon bekor qilingan" };
  const locked = await cashEntryLocked(t);
  if (locked) return { error: locked };
  return db.$transaction(async (tx) => {
    // Hisob bo'yicha navbat (yozish bilan bir xil) — qoldiq tekshiruvi parallel chiqim bilan to'qnashmasin
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + t.cashAccountId}))`;
    if (t.refType === "GoodsReceipt" && t.refId) await lockReceipt(tx, t.refId);
    // Kirimni bekor qilish ham naqd kassani minusga tushirishi mumkin
    if (t.type === "INCOME") {
      const err = await cashOutflowError(tx, t.cashAccountId, Number(t.amount));
      if (err) throw new CashError(`Bu kirim bekor qilinsa kassa minusga tushadi. ${err}`);
    }
    const cancelledAt = new Date();
    const r = await tx.cashTransaction.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt, cancelledById: userId, cancelReason: why.slice(0, 300) } });
    if (r.count === 0) throw new CashError("Bu yozuv allaqachon bekor qilingan");
    await audit(tx, userId, "STATUS_CHANGE", "CashTransaction", id, { cancelledAt: null, record: t }, { cancelledAt, reason: why.slice(0, 300) });
    return {};
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
}

/** Yozuvni qo'lda bekor qilib bo'lmasa — sababi (veb jadvalidagi va mobil kartochkadagi tugma shu bilan ko'rinadi). */
export async function cashEntryLocked(t: { id: string; refType: string | null; cancelledAt?: Date | null }): Promise<string | null> {
  if (t.cancelledAt) return "Bu yozuv allaqachon bekor qilingan";
  if (t.refType && t.refType !== "GoodsReceipt") return "Hujjatga bog'langan yozuvni bekor qilib bo'lmaydi — hujjatning o'zi orqali";
  // `count` bekor qilingan zayavkani ham ko'radi: zanjir puli zanjirda boshqariladi (xavfsiz tomon)
  if (t.refType === "GoodsReceipt" && (await db.supplyRequest.count({ where: { cashTxId: t.id } }))) return "Bu chiqim ta'minot zayavkasining puli — Ta'minot bo'limida boshqariladi";
  return null;
}

/**
 * To'lanmagan kirimni to'lash: moliya hisobni tanlaydi, kirimning QOLGAN summasi (yoki kiritilgan qismi)
 * chiqim bo'lib yoziladi. To'langan = kirimga bog'langan barcha chiqimlar (qo'lda bog'langan qisman to'lov ham).
 * Kirim bo'yicha qulf — ikki marta bosilsa ikkinchisi qolgan summani 0 ko'radi (`paid: 0`); ortiqcha to'lov rad etiladi.
 * Veb Kirim-Chiqim → «To'lanmagan kirimlar» (`cashflow/actions.ts` → `payReceipt`) va mobil kirim kartochkasi shu yerdan.
 */
export async function payReceiptEntry(receiptId: string, input: { cashAccountId: string; amount: number | null }, userId: string): Promise<{ error?: string; paid?: number; left?: number }> {
  const acc = await db.cashAccount.findFirst({ where: { id: input.cashAccountId, isActive: true } });
  if (!acc) return { error: "Kassa/hisob tanlanmagan" };
  // Bo'sh — qolgan summaning hammasi; kiritilsa — qisman to'lov
  const part = input.amount;
  if (part != null && !(Number.isFinite(part) && part > 0 && part <= MAX_AMOUNT)) return { error: "To'lov summasi noto'g'ri" };
  return db.$transaction(async (tx) => {
    await lockReceipt(tx, receiptId);
    const st = await receiptPayState(tx, receiptId);
    if (!st) throw new CashError("Kirim hujjati topilmadi");
    if (st.cancelled) throw new CashError(`${st.docNo} bekor qilingan — to'lanmaydi`);
    if (st.left <= 0.005) return { paid: 0, left: 0 }; // allaqachon to'liq to'langan (ikki marta bosilgan)
    if (part != null && part > st.left + 0.005) throw new CashError(`${st.docNo} bo'yicha qolgan to'lov ${money(st.left)} — ${money(part)} ortiqcha`);
    const amount = part ?? st.left;
    // Naqd kassadan to'lov qoldiqdan oshmasin — bankdan to'lash yoki avval kassani to'ldirish kerak
    const err = await cashOutflowError(tx, acc.id, amount);
    if (err) throw new CashError(err);
    const t = await tx.cashTransaction.create({
      data: {
        type: "EXPENSE", date: new Date(), cashAccountId: acc.id, amount, category: "Xomashyo",
        supplierId: st.supplierId, counterparty: st.supplierName,
        note: `Kirim ${st.docNo} · ${st.lines} qator (moliya to'ladi${amount < st.left - 0.005 ? `, qisman: ${money(amount)} / ${money(st.left)}` : ""})`,
        refType: "GoodsReceipt", refId: st.id, createdById: userId,
      },
    });
    await audit(tx, userId, "CREATE", "CashTransaction", t.id, undefined, t);
    return { paid: amount, left: r2(st.left - amount) };
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
}
