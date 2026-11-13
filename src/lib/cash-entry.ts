import type { CashTransaction, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isoDate, money } from "@/lib/format";
import { balanceDropError, cashOutflowError } from "@/lib/payments";
import { lockReceipt, receiptPayState } from "@/lib/receipt-payables";
import { PEREKIT_CATEGORY } from "@/lib/cash-categories";
import { MAX_AMOUNT } from "@/lib/action";
import { loadCategoriesFor, makeResolver } from "@/lib/fin-report/categories";

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
  /** Sub manba — `category` manbasining bolasi bo'lishi shart (`lib/fin-report/categories`). */
  subCategory?: string | null;
  /** Kategoriya loyiha so'rasa (Loyihalar) — qaysi loyiha. */
  projectId?: string | null;
  /** Kategoriya kredit so'rasa — qaysi kredit; asosiy qarz / foiz kategoriyadan olinadi. */
  loanId?: string | null;
  /** Veb forma: sub manba shart (`subCategoryMissing`). Mobil, Excel importi va avtomatik yozuvlarda berilmaydi. */
  requireSub?: boolean;
};

class CashError extends Error {}

/** Bir xil yozuv shu oraliqda qayta kelsa — ikki marta bosilgan deb hisoblanadi (to'lovlardagi kabi). */
const DUPLICATE_WINDOW_MS = 60_000;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Kategoriya daraxti bo'yicha tekshiruv (`CashCategory`): manba yozuv turiga mos, sub manba shu manbaniki,
 * loyiha / kredit kategoriya so'raganda faol bo'lsin. Kategoriya daraxtda bo'lmasa — eski erkin nom, o'tkaziladi
 * (avtomatik yozuvlar va eski mobil ilova); hisobotda «Manbasi aniqlanmagan» bo'lib ko'rinadi.
 */
async function categoryLinks(d: { type: "INCOME" | "EXPENSE"; category: string; subCategory?: string | null; projectId?: string | null; loanId?: string | null }) {
  const resolve = makeResolver(await loadCategoriesFor([d.category, d.subCategory]));
  const base = resolve(d.category);
  if (!base) return { data: { subCategory: null, projectId: null, loanId: null, loanPart: null } };
  if (base.top.type !== d.type) return { error: `«${base.top.name}» — ${base.top.type === "INCOME" ? "kirim" : "chiqim"} kategoriyasi` };
  // Sub manba aynan shu manbaniki bo'lsin (boshqa manbaning bolasi yozuvni jimgina boshqa manbaga o'tkazib yubormasin)
  const r = d.subCategory ? resolve(d.category, d.subCategory) : base;
  if (d.subCategory && (!r?.sub || r.top.id !== base.top.id)) return { error: `«${d.subCategory}» — «${base.top.name}» ichida bunday sub manba yo'q` };
  if (!r) return { data: { subCategory: null, projectId: null, loanId: null, loanPart: null } };
  let projectId: string | null = null, loanId: string | null = null;
  if (r.top.needs === "PROJECT" && d.projectId) {
    const p = await db.project.findFirst({ where: { id: d.projectId, isActive: true }, select: { id: true } });
    if (!p) return { error: "Loyiha topilmadi yoki yopilgan" };
    projectId = p.id;
  }
  if (r.top.needs === "LOAN" && d.loanId) {
    const l = await db.loan.findFirst({ where: { id: d.loanId, cancelledAt: null, closedAt: null }, select: { id: true } });
    if (!l) return { error: "Kredit topilmadi yoki yopilgan" };
    loanId = l.id;
  }
  return { data: { category: r.top.name, subCategory: r.sub?.name ?? null, projectId, loanId, loanPart: loanId ? r.top.loanPart ?? "PRINCIPAL" : null } };
}

/**
 * Veb formalar (Kirim-Chiqim, Kassa / bank tahriri): har bir kirim/chiqimda sub manba shart — barcha manbalarda
 * (kredit va loyiha manbalarida ham). Sub manbasi hali yo'q manbada avval «+» bilan qo'shiladi. Tekshirilmaydi faqat
 * daraxtda yo'q eski erkin nom (unga sub manba qo'shib bo'lmaydi). Forma ham shu qoidada (`tx-form.tsx`, `cash-edit.tsx`).
 */
async function subCategoryMissing(category: string): Promise<string | null> {
  const nodes = await loadCategoriesFor([category]);
  const r = makeResolver(nodes)(category);
  if (!r || r.sub) return null;
  const top = r.top;
  return nodes.some((n) => n.parentId === top.id && n.isActive)
    ? `Sub manba tanlanmagan — «${top.name}» ichidan tanlang`
    : `«${top.name}» manbasida sub manba yo'q — avval «+» bilan sub manba qo'shing (yoki Moliya → Kategoriyalar)`;
}

export async function createCashEntry(input: CashEntryInput, userId: string): Promise<{ id?: string; error?: string }> {
  const { receiptId, subCategory, projectId, loanId, ...d } = { ...input, amount: r2(input.amount) };
  if (!(d.amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (receiptId && d.type !== "EXPENSE") return { error: "Kirim hujjatiga faqat chiqim (to'lov) bog'lanadi" };
  // Perekit — o'tkazma hujjati (`lib/cash-transfer.ts`), oddiy chiqim bo'lib yozilmaydi
  if (d.category === PEREKIT_CATEGORY) return { error: "Perekit — hisoblararo o'tkazma: «Kassa ⇄ bank» orqali yozing" };
  const acc = await db.cashAccount.findFirst({ where: { id: d.cashAccountId, isActive: true }, select: { id: true } });
  if (!acc) return { error: "Kassa/hisob topilmadi yoki yopilgan" };
  const links = await categoryLinks({ type: d.type, category: d.category, subCategory, projectId, loanId });
  if ("error" in links) return { error: links.error };
  if (d.requireSub && !links.data.subCategory) {
    const miss = await subCategoryMissing(d.category);
    if (miss) return { error: miss };
  }
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
        ...links.data, ...(link ?? {}), createdById: userId,
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
    const err = await cancelCashTxIn(tx, t, why, userId);
    if (err) throw new CashError(err);
    return {};
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
}

/**
 * Bekor qilishning o'zi — chaqiruvchining tranzaksiyasi ichida: hisob navbati, kirim bo'lsa qoldiq tekshiruvi, shartli
 * yozish, AuditLog STATUS_CHANGE. `cancelCashEntry` ham, hujjat o'z chiqimini qaytarganda ham (ish haqi to'lovini bekor
 * qilish — `lib/hr/payroll.ts` → `unpayRun`) shu bilan. Qo'lda bekor qilish qulfi (`cashEntryLocked`) bu yerda
 * tekshirilmaydi — uni chaqiruvchi (hujjat egasi) hal qiladi. Qaytaradi: xato matni yoki null (xato bo'lsa — rollback qiling).
 */
export async function cancelCashTxIn(tx: Prisma.TransactionClient, t: CashTransaction, reason: string, userId: string): Promise<string | null> {
  const why = reason.trim().slice(0, 300);
  // Hisob bo'yicha navbat (yozish bilan bir xil) — qoldiq tekshiruvi parallel chiqim bilan to'qnashmasin
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + t.cashAccountId}))`;
  if (t.refType === "GoodsReceipt" && t.refId) await lockReceipt(tx, t.refId);
  // Kirimni bekor qilish ham naqd kassani minusga tushirishi mumkin
  if (t.type === "INCOME") {
    const err = await cashOutflowError(tx, t.cashAccountId, Number(t.amount));
    if (err) return `Bu kirim bekor qilinsa kassa minusga tushadi. ${err}`;
  }
  const cancelledAt = new Date();
  const r = await tx.cashTransaction.updateMany({ where: { id: t.id, cancelledAt: null }, data: { cancelledAt, cancelledById: userId, cancelReason: why } });
  if (r.count === 0) return "Bu yozuv allaqachon bekor qilingan";
  await audit(tx, userId, "STATUS_CHANGE", "CashTransaction", t.id, { cancelledAt: null, record: t }, { cancelledAt, reason: why });
  return null;
}

/**
 * Yozuvni butunlay o'chirib bo'lmasa — sababi (Kassa / bank qator tafsilotidagi «O'chirish» tugmasi shu bilan o'chadi).
 * Bekor qilishdagi qoida (hujjatga bog'langan yozuv — hujjat orqali) + yozuvga bog'langan kartochka (asosiy vosita).
 * Bekor qilingan yozuv ham o'chiriladi.
 */
export async function cashEntryDeleteBlock(t: { id: string; type: string; refType: string | null }): Promise<string | null> {
  if (t.type === "OPENING") return "Boshlang'ich qoldiq — Oy oxiri qoldiqlari / Boshlang'ich qoldiq sahifasida o'zgaradi";
  if (t.type !== "INCOME" && t.type !== "EXPENSE") return "O'tkazma (perekit) — o'tkazma hujjati bo'yicha o'chiriladi";
  const locked = await cashEntryLocked({ id: t.id, refType: t.refType });
  if (locked) return locked;
  if (await db.fixedAsset.count({ where: { cashTxId: t.id } })) return "Bu chiqimga asosiy vosita kartochkasi bog'langan — avval Moliya → Asosiy vositalarda kartochkani o'chiring";
  return null;
}

/**
 * Kirim/chiqimni butunlay o'chirish (Kassa / bank → qator tafsiloti → «O'chirish»): yozuv jurnaldan olinadi, to'liq
 * holati va sabab AuditLog'ga DELETE bo'lib yoziladi. Bekor qilishdan farqi — jurnalda kulrang qator ham qolmaydi.
 * Bekor qilinmagan kirim o'chsa hisobdan pul chiqqandek bo'ladi — naqd kassa minusga tushmasin (`cashOutflowError`).
 */
export async function deleteCashEntry(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  const why = String(reason ?? "").trim();
  if (why.length < 3) return { error: "O'chirish sababini yozing (kamida 3 belgi)" };
  const t = await db.cashTransaction.findUnique({ where: { id } });
  if (!t) return { error: "Yozuv topilmadi — allaqachon o'chirilgan bo'lishi mumkin" };
  const block = await cashEntryDeleteBlock(t);
  if (block) return { error: block };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + t.cashAccountId}))`;
    if (t.refType === "GoodsReceipt" && t.refId) await lockReceipt(tx, t.refId);
    const cur = await tx.cashTransaction.findUnique({ where: { id } });
    if (!cur) throw new CashError("Yozuv allaqachon o'chirilgan");
    if (!cur.cancelledAt && cur.type === "INCOME") {
      const err = await cashOutflowError(tx, cur.cashAccountId, Number(cur.amount));
      if (err) throw new CashError(`Bu kirim o'chirilsa kassa minusga tushadi. ${err}`);
    }
    await tx.cashTransaction.delete({ where: { id } });
    await audit(tx, userId, "DELETE", "CashTransaction", id, cur, { deleted: true, reason: why.slice(0, 300) });
    return {};
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
}

// ───────────────────────── Tahrirlash (Kassa / bank → Kassa jurnali) ─────────────────────────

/**
 * Kirim/chiqim yozuvi umuman tahrirlanmasa — sababi (jurnaldagi qalam shu bilan o'chadi): bekor qilingan yozuv va
 * perekit oyog'i (u o'tkazma hujjati bo'yicha — `updateTransfer`) — boshqa hamma yozuvda qalam bor.
 */
export function cashEntryEditBlock(t: { type: string; cancelledAt: Date | null }): string | null {
  if (t.cancelledAt) return "Bekor qilingan yozuv tahrirlanmaydi";
  if (t.type !== "INCOME" && t.type !== "EXPENSE") return "O'tkazma (perekit) — o'tkazma hujjati bo'yicha tahrirlanadi";
  return null;
}

/**
 * Qaysi ustun qulf va nega. Qo'lda yozilgan yozuvda hammasi ochiq (turi ham: chiqim ⇄ kirim). Hujjatdan yozilgan
 * (kirim to'lovi, ta'minot, mexanik so'rov, o'tkazma komissiyasi) — summa, tur va hisob hujjat bilan bog'liq;
 * kredit / loyiha yozuvi — manba va tur (bog'lanish shu manbaga tegishli).
 */
export function cashEntryLocks(t: { refType: string | null; loanId: string | null; projectId: string | null }) {
  if (t.refType) return { type: true, amount: true, account: true, category: false, why: "Hujjatga bog'langan yozuv — summa, tur va hisob hujjatning o'zida o'zgaradi" };
  if (t.loanId || t.projectId) return { type: true, amount: false, account: false, category: true, why: "Kredit / loyiha yozuvi — manba va tur o'zgarmaydi (kerak bo'lsa bekor qilib, Kirim-Chiqimda qayta kiriting)" };
  return { type: false, amount: false, account: false, category: false, why: null };
}

/** Tahrir oynasi ochilgandagi holat: saqlashda bazadagisi boshqacha bo'lsa — boshqa joyda o'zgartirilgan (ustma-ust yozilmasin). */
export const cashEntrySig = (t: { type: string; amount: unknown; date: Date; cashAccountId: string; category: string; subCategory: string | null; counterparty: string | null; note: string | null }) =>
  [t.type, Number(t.amount).toFixed(2), isoDate(t.date), t.cashAccountId, t.category, t.subCategory ?? "", t.counterparty ?? "", t.note ?? ""].join("|");

export type CashEntryEdit = {
  /** Berilmasa — turi o'zgarmaydi */
  type?: "INCOME" | "EXPENSE" | null;
  date: Date; cashAccountId: string; amount: number; category: string; subCategory?: string | null;
  counterparty?: string | null; note?: string | null; sig: string;
  /** Kassa / bank tahriri: sub manba majburiy (`subCategoryMissing`) */
  requireSub?: boolean;
};

const effect = (type: string, amount: number) => (type === "INCOME" ? amount : -amount);
const sameDay = (a: Date, b: Date) => isoDate(a) === isoDate(b);

/**
 * Kirim/chiqimni tuzatish: turi (chiqim ⇄ kirim), sana, hisob, summa, manba, sub manba, kontragent, izoh.
 * Kategoriya qoidasi yozishdagi bilan bir xil (manba yangi turga mos bo'lsin); kredit / loyiha manbasiga o'tkazilmaydi.
 * Qulflangan ustunlar — `cashEntryLocks`. Hisob bo'yicha navbat ostida: tahrirdan keyin qaysi hisob kamaysa (chiqim
 * ko'paydi, kirim kamaydi, kirim chiqimga aylandi, boshqa hisobga ko'chdi) — minusga tushmasin. AuditLog'ga UPDATE.
 */
export async function updateCashEntry(id: string, d: CashEntryEdit, userId: string): Promise<{ error?: string }> {
  const amount = r2(d.amount);
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (amount > MAX_AMOUNT) return { error: "Summa juda katta" };
  if (!Number.isFinite(d.date.getTime())) return { error: "Sana noto'g'ri" };
  if (d.date.getTime() > Date.now() + 86_400_000) return { error: "Sana kelajakda bo'lmasin" };
  const t = await db.cashTransaction.findUnique({ where: { id } });
  if (!t) return { error: "Yozuv topilmadi" };
  const block = cashEntryEditBlock(t);
  if (block) return { error: block };
  const lock = cashEntryLocks(t);
  const type = d.type ?? (t.type as "INCOME" | "EXPENSE");
  if (lock.type && type !== t.type) return { error: lock.why! };
  if (lock.amount && Math.abs(amount - Number(t.amount)) > 0.005) return { error: lock.why! };
  if (lock.account && d.cashAccountId !== t.cashAccountId) return { error: lock.why! };
  if (lock.category && d.category !== t.category) return { error: lock.why! };
  if (d.category === PEREKIT_CATEGORY) return { error: "Perekit — hisoblararo o'tkazma: «Kassa ⇄ bank» orqali yozing" };
  if (d.cashAccountId !== t.cashAccountId) {
    const acc = await db.cashAccount.findFirst({ where: { id: d.cashAccountId, isActive: true }, select: { id: true } });
    if (!acc) return { error: "Kassa/hisob topilmadi yoki yopilgan" };
  }
  const top = makeResolver(await loadCategoriesFor([d.category]))(d.category)?.top;
  // Kredit / loyiha manbasiga boshqa manbadan o'tib bo'lmaydi — bog'lanish (qaysi kredit, loyiha) so'raladi
  if ((top?.needs === "LOAN" || top?.needs === "PROJECT") && d.category !== t.category) return { error: `«${top.name}» — ${top.needs === "LOAN" ? "kredit" : "loyiha"} tanlanadi: eski yozuvni bekor qilib, Kirim-Chiqim formasida kiriting` };
  const links = await categoryLinks({ type, category: d.category, subCategory: d.subCategory || null });
  if ("error" in links) return { error: links.error };
  if (d.requireSub && !links.data.subCategory) {
    const miss = await subCategoryMissing(d.category);
    if (miss) return { error: miss };
  }
  const data = {
    type, date: d.date, cashAccountId: d.cashAccountId, amount, category: links.data.category ?? d.category, subCategory: links.data.subCategory,
    counterparty: d.counterparty?.trim() || null, note: d.note?.trim() || null,
  };
  return db.$transaction(async (tx) => {
    for (const a of [...new Set([t.cashAccountId, d.cashAccountId])].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + a}))`;
    const cur = await tx.cashTransaction.findUniqueOrThrow({ where: { id } });
    if (cur.cancelledAt || cashEntrySig(cur) !== d.sig) throw new CashError("Yozuv boshqa joyda o'zgartirildi yoki bekor qilindi — sahifani yangilang");
    const err = await balanceDropError(tx, [{ accountId: cur.cashAccountId, delta: -effect(cur.type, Number(cur.amount)) }, { accountId: d.cashAccountId, delta: effect(type, amount) }]);
    if (err) throw new CashError(type !== cur.type && type === "EXPENSE" ? `Kirim chiqimga aylansa hisob minusga tushadi. ${err}` : err);
    // Sana o'zgarmagan bo'lsa — asl vaqt (soat) qoladi: jurnal tartibi tahrirdan keyin buzilmasin
    await tx.cashTransaction.update({ where: { id }, data: { ...data, date: sameDay(d.date, cur.date) ? cur.date : d.date } });
    const before = { type: cur.type, date: cur.date, cashAccountId: cur.cashAccountId, amount: cur.amount, category: cur.category, subCategory: cur.subCategory, counterparty: cur.counterparty, note: cur.note };
    await audit(tx, userId, "UPDATE", "CashTransaction", id, before, data);
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
