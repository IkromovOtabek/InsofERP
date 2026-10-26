"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { loadCategories, makeResolver } from "@/lib/fin-report/categories";

/** To'lov rejasi — moliya (`moliya.plan`), direktor doim. Yozuvlar o'chirilmaydi: nofaol / bekor / bajarildi. */
const writer = () => requireAction("moliya", "plan");
const refresh = () => { for (const p of ["/moliya/tolov-rejasi", "/moliya/kalendar", "/dashboard"]) revalidatePath(p); };

const settingsSchema = z.object({
  supplierPaymentDays: z.coerce.number({ message: "Muddat raqam bo'lsin" }).int("Butun son bo'lsin").min(0, "Manfiy bo'lmasin").max(365, "Juda katta"),
  cashPlanFactor: z.string().trim().transform((v) => Number(v.replace(",", "."))).refine((v) => Number.isFinite(v) && v > 0 && v <= 5, "Koeffitsiyent 0 dan katta, 5 dan kichik bo'lsin"),
  dividendPct: z.coerce.number({ message: "Foiz raqam bo'lsin" }).min(0, "Manfiy bo'lmasin").max(100, "100% dan oshmasin"),
});

export async function saveCashPlanSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(settingsSchema, fd);
  if ("error" in r) return { error: r.error };
  await db.$transaction(async (tx) => {
    const before = await tx.companySettings.findUnique({ where: { id: "main" }, select: { supplierPaymentDays: true, cashPlanFactor: true, dividendPct: true } });
    const after = await tx.companySettings.upsert({ where: { id: "main" }, update: r.data, create: { id: "main", ...r.data }, select: { supplierPaymentDays: true, cashPlanFactor: true, dividendPct: true } });
    await audit(tx, s.userId, "UPDATE", "CompanySettings", "main", before, after);
  });
  refresh();
  return { ok: true };
}

const recurringSchema = z.object({
  name: zStr("Nomi kerak").pipe(z.string().max(120, "Nomi juda uzun")),
  category: zStr("Kategoriya tanlanmagan"),
  dayOfMonth: z.coerce.number({ message: "Kun raqam bo'lsin" }).int().min(1, "Kun 1–31").max(31, "Kun 1–31"),
  amount: zDec(1),
  loanId: zOpt,
  note: zOpt,
});

export async function createRecurringAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(recurringSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = makeResolver(await loadCategories())(r.data.category);
  if (!res || res.top.type !== "EXPENSE") return { error: "Chiqim kategoriyasini tanlang" };
  await db.$transaction(async (tx) => {
    const x = await tx.recurringPayment.create({ data: { ...r.data, category: res.top.name, loanId: res.top.needs === "LOAN" ? r.data.loanId : null, createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "RecurringPayment", x.id, undefined, x);
  });
  refresh();
  return { ok: true };
}

const idSchema = z.object({ id: zStr(), reason: zOpt });

/** Faol / nofaol (vaqtincha to'xtatish) — qayta yoqsa bo'ladi. */
export async function toggleRecurringAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(idSchema, fd);
  if ("error" in r) return { error: r.error };
  const x = await db.recurringPayment.findFirst({ where: { id: r.data.id, cancelledAt: null } });
  if (!x) return { error: "To'lov topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.recurringPayment.update({ where: { id: x.id }, data: { isActive: !x.isActive } });
    await audit(tx, s.userId, "STATUS_CHANGE", "RecurringPayment", x.id, { isActive: x.isActive }, { isActive: !x.isActive });
  });
  refresh();
  return { ok: true };
}

export async function cancelRecurringAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(idSchema, fd);
  if ("error" in r) return { error: r.error };
  if (!r.data.reason) return { error: "Bekor qilish sababini yozing" };
  const n = await db.$transaction(async (tx) => {
    const u = await tx.recurringPayment.updateMany({ where: { id: r.data.id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: s.userId, cancelReason: r.data.reason, isActive: false } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "RecurringPayment", r.data.id, { cancelledAt: null }, { cancelledAt: new Date(), reason: r.data.reason });
    return u.count;
  });
  if (!n) return { error: "To'lov topilmadi yoki allaqachon bekor qilingan" };
  refresh();
  return { ok: true };
}

const plannedSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"], { message: "Turi tanlanmagan" }),
  date: zStr("Sana kerak").refine((v) => Number.isFinite(new Date(v).getTime()), "Sana noto'g'ri"),
  amount: zDec(1),
  counterparty: zStr("Kimga / kimdan kerak").pipe(z.string().max(160)),
  category: zOpt,
  note: zOpt,
});

export async function createPlannedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(plannedSchema, fd);
  if ("error" in r) return { error: r.error };
  const date = new Date(r.data.date);
  if (date.getTime() > Date.now() + 366 * 86_400_000) return { error: "Sana bir yildan uzoq bo'lmasin" };
  await db.$transaction(async (tx) => {
    const x = await tx.plannedFlow.create({ data: { ...r.data, date, createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "PlannedFlow", x.id, undefined, x);
  });
  refresh();
  return { ok: true };
}

const closeSchema = z.object({ id: zStr(), status: z.enum(["DONE", "CANCELLED"]) });

/** Bajarildi (pul keldi / to'landi — kassaga alohida yoziladi) yoki bekor — kalendardan chiqadi. */
export async function closePlannedAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(closeSchema, fd);
  if ("error" in r) return { error: r.error };
  const n = await db.$transaction(async (tx) => {
    const u = await tx.plannedFlow.updateMany({ where: { id: r.data.id, status: "PLANNED" }, data: { status: r.data.status, closedAt: new Date(), closedById: s.userId } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "PlannedFlow", r.data.id, { status: "PLANNED" }, { status: r.data.status });
    return u.count;
  });
  if (!n) return { error: "Yozuv topilmadi yoki allaqachon yopilgan" };
  refresh();
  return { ok: true };
}

const termSchema = z.object({ supplierId: zStr(), days: z.string().trim().optional() });

/** Ta'minotchining to'lov muddati (kun); bo'sh — umumiy muddat. */
export async function saveSupplierTermAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(termSchema, fd);
  if ("error" in r) return { error: r.error };
  const days = r.data.days ? Number(r.data.days) : null;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 365)) return { error: "Muddat 0–365 kun" };
  const sup = await db.supplier.findUnique({ where: { id: r.data.supplierId }, select: { id: true, paymentTermDays: true } });
  if (!sup) return { error: "Ta'minotchi topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.supplier.update({ where: { id: sup.id }, data: { paymentTermDays: days } });
    await audit(tx, s.userId, "UPDATE", "Supplier", sup.id, { paymentTermDays: sup.paymentTermDays }, { paymentTermDays: days });
  });
  refresh();
  return { ok: true };
}
