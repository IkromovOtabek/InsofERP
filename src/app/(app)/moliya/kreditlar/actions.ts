"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { MAX_AMOUNT, parseForm, zOpt, zStr, validDate, type ActionState } from "@/lib/action";
import { loadCategories, makeResolver } from "@/lib/fin-report/categories";

/** Kreditlar va qarzlar reyestri — buxgalteriya (`moliya.loans`), direktor doim. Yozuvlar o'chirilmaydi. */
const writer = () => requireAction("moliya", "loans");
const refresh = () => { revalidatePath("/moliya/kreditlar"); revalidatePath("/moliya"); revalidatePath("/cashflow"); };

const createSchema = z.object({
  kind: z.enum(["BANK", "BORROWED", "LENT"], { message: "Turi tanlanmagan" }),
  name: zStr("Nomi kerak").pipe(z.string().max(160, "Nomi juda uzun")),
  counterparty: zStr("Bank / kontragent kerak").pipe(z.string().max(160)),
  openingBalance: z.coerce.number({ message: "Qoldiq raqam bo'lsin" }).min(0, "Qoldiq manfiy bo'lmasin").max(MAX_AMOUNT, "Qoldiq juda katta"),
  openingDate: zStr("Sana kerak").refine(validDate, "Sana noto'g'ri"),
  rate: z.string().trim().optional().transform((v) => (v ? Number(v.replace(",", ".")) : null)).refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1000), "Foiz noto'g'ri"),
  note: zOpt,
});

export async function createLoanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(createSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  await db.$transaction(async (tx) => {
    const l = await tx.loan.create({ data: { ...d, openingDate: new Date(d.openingDate), createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "Loan", l.id, undefined, l);
  });
  refresh();
  return { ok: true };
}

const stateSchema = z.object({ id: zStr(), reason: zOpt });

/** Kredit yopildi (to'liq to'landi) — reyestrda qoladi, kassa formasida tanlovdan chiqadi. */
export async function closeLoanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(stateSchema, fd);
  if ("error" in r) return { error: r.error };
  const n = await db.$transaction(async (tx) => {
    const u = await tx.loan.updateMany({ where: { id: r.data.id, closedAt: null, cancelledAt: null }, data: { closedAt: new Date() } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "Loan", r.data.id, { closedAt: null }, { closedAt: new Date() });
    return u.count;
  });
  if (!n) return { error: "Kredit topilmadi yoki allaqachon yopilgan" };
  refresh();
  return { ok: true };
}

/** Xato kiritilgan kreditni bekor qilish — kassa yozuvlari bog'langan bo'lsa ruxsat yo'q (avval ularni boshqasiga bog'lang). */
export async function cancelLoanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(stateSchema, fd);
  if ("error" in r) return { error: r.error };
  if (!r.data.reason) return { error: "Bekor qilish sababini yozing" };
  const used = await db.cashTransaction.count({ where: { loanId: r.data.id, cancelledAt: null } });
  if (used) return { error: `Bu kreditga ${used} ta kassa yozuvi bog'langan — bekor qilib bo'lmaydi` };
  const n = await db.$transaction(async (tx) => {
    const u = await tx.loan.updateMany({ where: { id: r.data.id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: s.userId, cancelReason: r.data.reason } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "Loan", r.data.id, { cancelledAt: null }, { cancelledAt: new Date(), reason: r.data.reason });
    return u.count;
  });
  if (!n) return { error: "Kredit topilmadi yoki allaqachon bekor qilingan" };
  refresh();
  return { ok: true };
}

const linkSchema = z.object({ txId: zStr(), loanId: zStr("Kredit tanlanmagan") });

/**
 * Eski kassa yozuvini kreditga bog'lash (kategoriyasi kredit/qarz bo'lgan, lekin kredit tanlanmagan yozuvlar).
 * Qism (asosiy qarz / foiz) kategoriyadan olinadi. Summa, sana, hisob o'zgarmaydi — faqat bog'lanish.
 */
export async function linkLoanTxAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(linkSchema, fd);
  if ("error" in r) return { error: r.error };
  const [t, loan, nodes] = await Promise.all([
    db.cashTransaction.findUnique({ where: { id: r.data.txId }, select: { id: true, category: true, subCategory: true, loanId: true, cancelledAt: true } }),
    db.loan.findUnique({ where: { id: r.data.loanId }, select: { id: true, cancelledAt: true } }),
    loadCategories(),
  ]);
  const res = t && makeResolver(nodes)(t.category, t.subCategory);
  if (!t || t.cancelledAt || res?.top.needs !== "LOAN") return { error: "Kassa yozuvi topilmadi yoki u kredit yozuvi emas" };
  if (!loan || loan.cancelledAt) return { error: "Kredit topilmadi" };
  const part = res.top.loanPart ?? "PRINCIPAL";
  const n = await db.$transaction(async (tx) => {
    const u = await tx.cashTransaction.updateMany({ where: { id: t.id, loanId: null, cancelledAt: null }, data: { loanId: loan.id, loanPart: part } });
    if (u.count) await audit(tx, s.userId, "UPDATE", "CashTransaction", t.id, { loanId: null }, { loanId: loan.id, loanPart: part });
    return u.count;
  });
  if (!n) return { error: "Yozuv allaqachon bog'langan" };
  refresh();
  return { ok: true };
}
