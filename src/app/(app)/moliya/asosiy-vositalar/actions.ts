"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, zStr, validDate, type ActionState } from "@/lib/action";
import { loadCategories, makeResolver } from "@/lib/fin-report/categories";
import { ASSET_COST_CASH_LOCK, assetValueLock } from "@/lib/fin-report/assets";

/** Asosiy vositalar kartochkasi — buxgalteriya (`moliya.assets`), direktor doim. O'chirilmaydi: chiqarish yoki bekor qilish. */
const writer = () => requireAction("moliya", "assets");
const refresh = () => { revalidatePath("/moliya/asosiy-vositalar"); revalidatePath("/moliya"); };

const createSchema = z.object({
  name: zStr("Nomi kerak").pipe(z.string().max(160, "Nomi juda uzun")),
  group: zStr("Guruh tanlanmagan"),
  acquiredAt: zStr("Sana kerak").refine(validDate, "Sana noto'g'ri"),
  cost: zDec(1),
  lifeYears: z.coerce.number({ message: "Muddat raqam bo'lsin" }).min(0.25, "Muddat kamida 3 oy").max(100, "Muddat juda katta"),
  cashTxId: zOpt,
  note: zOpt,
});

export async function createAssetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(createSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.cashTxId) {
    // Faqat «Asosiy vosita xaridi» kategoriyasidagi, bekor qilinmagan va hali kartochkasi yo'q chiqim
    const tx = await db.cashTransaction.findUnique({ where: { id: d.cashTxId }, select: { type: true, category: true, subCategory: true, cancelledAt: true, fixedAsset: { select: { id: true } } } });
    const res = tx && makeResolver(await loadCategories())(tx.category, tx.subCategory);
    if (!tx || tx.cancelledAt || tx.type !== "EXPENSE" || res?.top.needs !== "ASSET") return { error: "Kassa yozuvi topilmadi yoki u asosiy vosita xaridi emas" };
    if (tx.fixedAsset) return { error: "Bu kassa yozuviga kartochka allaqachon ochilgan" };
  }
  try {
    await db.$transaction(async (tx) => {
      const a = await tx.fixedAsset.create({
        data: { name: d.name, group: d.group, acquiredAt: new Date(d.acquiredAt), cost: d.cost, lifeMonths: Math.round(d.lifeYears * 12), cashTxId: d.cashTxId, note: d.note, createdById: s.userId },
      });
      await audit(tx, s.userId, "CREATE", "FixedAsset", a.id, undefined, a);
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { error: "Bu kassa yozuviga kartochka allaqachon ochilgan" };
    throw e;
  }
  refresh();
  return { ok: true };
}

const stateSchema = z.object({ id: zStr(), date: zOpt, reason: zOpt });

/** Sotildi / hisobdan chiqarildi: shu oydan keyin amortizatsiya va balans qiymati yo'q. */
export async function disposeAssetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(stateSchema, fd);
  if ("error" in r) return { error: r.error };
  if (!r.data.date || !validDate(r.data.date)) return { error: "Chiqarish sanasini kiriting" };
  const at = new Date(r.data.date);
  const n = await db.$transaction(async (tx) => {
    const a = await tx.fixedAsset.findUnique({ where: { id: r.data.id } });
    if (!a || a.cancelledAt || a.disposedAt) return 0;
    if (at < a.acquiredAt) return -1;
    const u = await tx.fixedAsset.updateMany({ where: { id: a.id, disposedAt: null, cancelledAt: null }, data: { disposedAt: at, note: r.data.reason ? [a.note, `Chiqarildi: ${r.data.reason}`].filter(Boolean).join(" · ") : a.note } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "FixedAsset", a.id, { disposedAt: null }, { disposedAt: at, reason: r.data.reason });
    return u.count;
  });
  if (n === -1) return { error: "Chiqarish sanasi olingan sanadan oldin bo'lmasin" };
  if (!n) return { error: "Vosita topilmadi yoki allaqachon chiqarilgan" };
  refresh();
  return { ok: true };
}

/** Xato kiritilgan kartochkani bekor qilish (sabab bilan) — hech qaysi hisobotga kirmaydi, kassa yozuvi bo'shaydi. */
export async function cancelAssetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(stateSchema, fd);
  if ("error" in r) return { error: r.error };
  if (!r.data.reason) return { error: "Bekor qilish sababini yozing" };
  const n = await db.$transaction(async (tx) => {
    const u = await tx.fixedAsset.updateMany({ where: { id: r.data.id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: s.userId, cancelReason: r.data.reason, cashTxId: null } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "FixedAsset", r.data.id, { cancelledAt: null }, { cancelledAt: new Date(), reason: r.data.reason });
    return u.count;
  });
  if (!n) return { error: "Vosita topilmadi yoki allaqachon bekor qilingan" };
  refresh();
  return { ok: true };
}

const updateSchema = z.object({
  id: zStr(),
  name: zStr("Nomi kerak").pipe(z.string().max(160, "Nomi juda uzun")),
  group: zStr("Guruh tanlanmagan"),
  note: zOpt,
  // Qulflangan maydonlar formada `disabled` — yuborilmaydi (o'zgarmaydi)
  acquiredAt: zStr("Sana kerak").refine(validDate, "Sana noto'g'ri").optional(),
  cost: zDec(1).optional(),
  lifeYears: z.coerce.number({ message: "Muddat raqam bo'lsin" }).min(0.25, "Muddat kamida 3 oy").max(100, "Muddat juda katta").optional(),
});

/**
 * Kartochkani tuzatish: nomi, guruh, izoh — doim; qiymat, olingan sana va muddat — amortizatsiya hali boshlanmagan va
 * chiqarilmagan bo'lsa (`assetValueLock`), qiymat esa kassa chiqimiga bog'lanmagan bo'lsa ham (`ASSET_COST_CASH_LOCK`).
 */
export async function updateAssetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(updateSchema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const d = r.data;
  const res = await db.$transaction(async (tx) => {
    const a = await tx.fixedAsset.findUnique({ where: { id: d.id } });
    if (!a || a.cancelledAt) return { error: "Vosita topilmadi yoki bekor qilingan" };
    const acquiredAt = d.acquiredAt ? new Date(d.acquiredAt) : a.acquiredAt;
    const lifeMonths = d.lifeYears !== undefined ? Math.round(d.lifeYears * 12) : a.lifeMonths;
    const cost = d.cost !== undefined ? Math.round(d.cost * 100) / 100 : Number(a.cost);
    const costChanged = Math.abs(cost - Number(a.cost)) >= 0.005;
    const valueChanged = costChanged || acquiredAt.getTime() !== a.acquiredAt.getTime() || lifeMonths !== a.lifeMonths;
    if (valueChanged) {
      const lock = assetValueLock(a);
      if (lock) return { error: lock };
      if (costChanged && a.cashTxId) return { error: ASSET_COST_CASH_LOCK, field: "cost" };
    }
    const before = { name: a.name, group: a.group, note: a.note, acquiredAt: a.acquiredAt, cost: Number(a.cost), lifeMonths: a.lifeMonths };
    const after = { name: d.name, group: d.group, note: d.note, acquiredAt, cost, lifeMonths };
    if (!valueChanged && before.name === after.name && before.group === after.group && before.note === after.note) return { same: true };
    // Shart bilan: o'qilgandan keyin boshqa xodim o'zgartirmagan / chiqarmagan / bekor qilmagan bo'lsin
    const u = await tx.fixedAsset.updateMany({
      where: { id: a.id, cancelledAt: null, updatedAt: a.updatedAt, ...(valueChanged ? { disposedAt: null } : {}) },
      data: { name: d.name, group: d.group, note: d.note, ...(valueChanged ? { acquiredAt, cost, lifeMonths } : {}) },
    });
    if (!u.count) return { error: "Kartochka hozirgina o'zgardi — sahifani yangilab qayta urining" };
    await audit(tx, s.userId, "UPDATE", "FixedAsset", a.id, before, after);
    return {};
  });
  if ("error" in res && res.error) return { error: res.error, field: "field" in res ? res.field : undefined };
  refresh();
  return { ok: true, note: "same" in res ? "O'zgarish yo'q" : "Saqlandi" };
}

/**
 * Chiqarishni bekor qilish (xato chiqarilgan vosita): chiqarish faqat holat va sana — pul harakati yo'q, shuning uchun
 * `disposedAt` tozalanadi; chiqarishda izohga qo'shilgan «Chiqarildi: …» qismi olib tashlanadi. Amortizatsiya davom etadi.
 */
export async function undisposeAssetAction(id: string, reason: string): Promise<ActionState> {
  const s = await writer();
  const n = await db.$transaction(async (tx) => {
    const a = await tx.fixedAsset.findUnique({ where: { id } });
    if (!a || a.cancelledAt || !a.disposedAt) return 0;
    const note = a.note?.replace(/(?:^| · )Chiqarildi: [^·]*$/, "").trim() || null;
    const u = await tx.fixedAsset.updateMany({ where: { id, cancelledAt: null, disposedAt: a.disposedAt }, data: { disposedAt: null, note } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "FixedAsset", id, { disposedAt: a.disposedAt, note: a.note }, { disposedAt: null, note, reason: reason.trim() || undefined });
    return u.count;
  });
  if (!n) return { error: "Vosita topilmadi yoki chiqarilmagan" };
  refresh();
  return { ok: true, note: "Chiqarish bekor qilindi" };
}
