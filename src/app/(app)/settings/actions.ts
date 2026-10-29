"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession, hashPassword, revokeSessions } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, zDec, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { approveRequest, rejectRequest } from "@/lib/account-deletion";
import { saveDailyOrderLimits as saveDailyOrderLimitsDb } from "@/lib/company";
import { setCustomerCreditLimits } from "@/lib/customer-limits";
import { parsePerms, type Perms } from "@/lib/auth";
import { applyAccess, applyAccessMany, permsFromForm, positionTemplates, templateRoleLabel } from "@/lib/perm-template";
import type { Role } from "@/generated/prisma";
import { txSign } from "@/lib/cash-tx";
import { fmtNum } from "@/lib/format";
import { verifyChannel } from "@/lib/telegram/channel";
import { MATERIAL_CATEGORIES } from "@/lib/material-category";
import { notifyNewAvtoParts } from "@/lib/avto-parts";

const ROLES = ["DIRECTOR", "AGENT", "SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "FINANCE", "HR", "CASHIER", "MECHANIC", "DISPATCHER", "SECRETARY"] as const;
const zBool = z.string().optional().transform((v) => v === "on");
const uniq = (e: unknown, msg: string) => (String(e).includes("Unique constraint") ? { error: msg } : null);

function refresh() {
  revalidatePath("/settings"); revalidatePath("/"); revalidatePath("/dashboard");
}

/* ───────── Zavod rekvizitlari ───────── */

const companySchema = z.object({
  name: zStr("Nomi kerak"), legalName: zOpt, inn: zOpt, address: zOpt, phone: zOpt, phone2: zOpt, email: zOpt,
  bankName: zOpt, bankAccount: zOpt, mfo: zOpt, directorName: zOpt, about: zOpt, workingHours: zOpt,
  foundedYear: z.coerce.number().int().min(1900).max(2100).optional().or(z.literal("").transform(() => undefined)),
  // Mijoz ilovasi "bugungi holat": ochiqmi, bugun yetkaziladimi
  openHour: z.coerce.number().int().min(0).max(23),
  closeHour: z.coerce.number().int().min(1).max(24),
  sameDayCutoffHour: z.coerce.number().int().min(0).max(24),
  workSunday: zBool,
  telegram: zOpt,
  // Kunlik quvvat va davomat radiusi bu formada yo'q — Sozlamalar → Limitlar'da alohida saqlanadi (saveDailyOrderLimits,
  // saveAttendanceRadius). Bu yerga qaytarilmasin: forma maydoni yo'q bo'lsa saqlashda qiymat null/standartga tushib qoladi.
}).refine((v) => v.closeHour > v.openHour, { message: "Yopilish soati ochilishdan keyin bo'lsin", path: ["closeHour"] });

export async function saveCompany(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(companySchema, fd);
  if ("error" in r) return { error: r.error };
  const data = { ...r.data, foundedYear: r.data.foundedYear ?? null };
  const before = await db.companySettings.findUnique({ where: { id: "main" } });
  const after = await db.companySettings.upsert({ where: { id: "main" }, update: data, create: { id: "main", ...data } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before, after);
  refresh(); revalidatePath("/trips");
  return { ok: true };
}

/* ───────── Beton markalari ───────── */

/** Bo'sh — null (qiymat o'chadi); aks holda musbat son (`int` — butun). */
const optPositive = (msg: string, max: number, int = false) =>
  zOpt.refine((v) => v == null || (Number(v) > 0 && Number(v) <= max && (!int || Number.isInteger(Number(v)))), msg)
    .transform((v) => (v == null ? null : Number(v)));

const productSchema = z.object({
  code: zStr("Kod kerak").transform((v) => v.toUpperCase()),
  name: zStr("Nomi kerak"), strengthClass: zOpt, unit: z.enum(["m3", "dona", "m2", "m", "t"]), price: zDec(0), isActive: zBool,
  // Reys hisobi (zayavka formasi): bo'sh qoldirilsa — GOST jadvalidan taxminiy
  weightKg: optPositive("Og'irlik 0 dan katta raqam bo'lsin", 99_999_999),
  perTrip: optPositive("Bir reysga max — 1 dan katta butun son", 100_000, true),
});

export async function saveProduct(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(productSchema, fd);
  if ("error" in r) return { error: r.error };
  try {
    if (id) {
      const before = await db.product.findUniqueOrThrow({ where: { id } });
      const after = await db.product.update({ where: { id }, data: r.data });
      await audit(db, s.userId, "UPDATE", "Product", id, before, after);
    } else {
      const p = await db.product.create({ data: { ...r.data, isActive: true } });
      await audit(db, s.userId, "CREATE", "Product", p.id, undefined, p);
    }
  } catch (e) { return uniq(e, "Bu kod bilan marka bor") ?? (() => { throw e; })(); }
  refresh(); revalidatePath("/recipes"); revalidatePath("/orders/new");
  return { ok: true };
}

/* ───────── Xomashyo ───────── */

const materialSchema = z.object({
  code: zStr("Kod kerak").transform((v) => v.toUpperCase()),
  name: zStr("Nomi kerak"), unit: zStr("Birlik kerak"), minStock: zDec(0), isActive: zBool,
  category: z.enum(MATERIAL_CATEGORIES).default("XOMASHYO"),
});

export async function saveMaterial(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(materialSchema, fd);
  if ("error" in r) return { error: r.error };
  try {
    if (id) {
      const before = await db.material.findUniqueOrThrow({ where: { id } });
      // Harakati yoki retsepti bor xomashyoning birligi almashsa butun tarix va normalar
      // boshqa birlikda o'qilib ketadi (kg → t: 1000 barobar) — shuning uchun taqiqlanadi
      if (before.unit !== r.data.unit) {
        const [moves, recipes] = await Promise.all([
          db.stockMove.count({ where: { materialId: id } }),
          db.recipeItem.count({ where: { materialId: id } }),
        ]);
        if (moves || recipes) return { error: `Birlikni o'zgartirib bo'lmaydi: ${moves} ta sklad harakati va ${recipes} ta retsept qatori «${before.unit}» da. Yangi birlik bilan alohida xomashyo oching` };
      }
      const after = await db.material.update({ where: { id }, data: r.data });
      await audit(db, s.userId, "UPDATE", "Material", id, before, after);
      if (after.category === "AVTO_ZAPCHAST" && before.category !== "AVTO_ZAPCHAST") notifyNewAvtoParts([id], s.userId);
    } else {
      const m = await db.material.create({ data: { ...r.data, isActive: true } });
      await audit(db, s.userId, "CREATE", "Material", m.id, undefined, m);
      notifyNewAvtoParts([m.id], s.userId);
    }
  } catch (e) { return uniq(e, "Bu kod bilan xomashyo bor") ?? (() => { throw e; })(); }
  refresh(); revalidatePath("/stock"); revalidatePath("/receipts/new");
  return { ok: true };
}

/* ───────── Skladlar ───────── */

const whSchema = z.object({ name: zStr("Nomi kerak"), isActive: zBool, isDefault: zBool });

/**
 * Sklad saqlash. "Asosiy sklad" bittagina bo'ladi: belgilansa qolganlaridan olinadi (reys yuklash,
 * brigada chiqargan mahsulot va brak shu skladdan boshlab ishlaydi — `lib/warehouse.ts`).
 */
export async function saveWarehouse(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(whSchema, fd);
  if ("error" in r) return { error: r.error };
  if (r.data.isDefault && id && !r.data.isActive) return { error: "Nofaol sklad asosiy bo'lolmaydi" };
  await db.$transaction(async (tx) => {
    if (r.data.isDefault) await tx.warehouse.updateMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    if (id) {
      const before = await tx.warehouse.findUnique({ where: { id } });
      await tx.warehouse.update({ where: { id }, data: r.data });
      await audit(tx, s.userId, "UPDATE", "Warehouse", id, before, r.data);
    } else {
      const w = await tx.warehouse.create({ data: { name: r.data.name, isDefault: r.data.isDefault } });
      await audit(tx, s.userId, "CREATE", "Warehouse", w.id, undefined, w);
    }
  });
  refresh();
  return { ok: true };
}

/* ───────── Kassa / hisoblar ───────── */

// allowOverdraft — faqat bank hisobi uchun: belgilansa chiqim/storno hisobni minusga tushira oladi
const accSchema = z.object({ name: zStr("Nomi kerak"), type: z.enum(["CASH", "BANK"]), isActive: zBool, allowOverdraft: zBool });

/** Hisob qoldig'i — mijoz to'lovlari + boshqa kirimlar − chiqimlar (Kirim-Chiqim va Egasi dashbordi bilan bir xil formula). */
async function accountBalance(id: string) {
  const [pay, tx] = await Promise.all([
    db.payment.aggregate({ where: { cashAccountId: id }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { cashAccountId: id, cancelledAt: null }, _sum: { amount: true } }),
  ]);
  return Number(pay._sum.amount ?? 0) + tx.reduce((x, t) => x + txSign(t.type) * Number(t._sum.amount ?? 0), 0);
}

export async function saveCashAccount(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(accSchema, fd);
  if ("error" in r) return { error: r.error };
  if (id) {
    const before = await db.cashAccount.findUniqueOrThrow({ where: { id } });
    // Qoldig'i bor hisob nofaol qilinsa pul Kirim-Chiqim va dashborddagi jami summadan "yo'qolardi",
    // tanlov ro'yxatidan ham chiqib, qoldiqni boshqa hisobga o'tkazib bo'lmay qolardi
    if (before.isActive && !r.data.isActive) {
      const bal = await accountBalance(id);
      if (Math.abs(bal) >= 1) return { error: `«${before.name}» qoldig'i ${Math.round(bal).toLocaleString("ru-RU")} so'm — avval qoldiqni boshqa hisobga o'tkazing (Kirim-Chiqim), keyin nofaol qiling` };
    }
    // Naqd kassa hech qachon minusga tushmaydi — belgi faqat bankda saqlanadi
    const after = await db.cashAccount.update({ where: { id }, data: { ...r.data, allowOverdraft: r.data.type === "BANK" && r.data.allowOverdraft } });
    await audit(db, s.userId, "UPDATE", "CashAccount", id, before, after);
  } else {
    const a = await db.cashAccount.create({ data: { name: r.data.name, type: r.data.type, allowOverdraft: r.data.type === "BANK" && r.data.allowOverdraft } });
    await audit(db, s.userId, "CREATE", "CashAccount", a.id, undefined, a);
  }
  refresh(); revalidatePath("/payments");
  return { ok: true };
}

/* ───────── Foydalanuvchilar ───────── */

const userSchema = z.object({
  login: zStr("Login kerak").transform((v) => v.toLowerCase()),
  fullName: zStr("F.I.O. kerak"),
  password: z.string().superRefine((v, ctx) => { const problem = passwordProblem(v); if (problem) ctx.addIssue({ code: "custom", message: problem }); }),
  role: z.enum(ROLES),
});

export async function createUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(userSchema, fd);
  if ("error" in r) return { error: r.error };
  try {
    const u = await db.user.create({ data: { login: r.data.login, fullName: r.data.fullName, role: r.data.role, passwordHash: await hashPassword(r.data.password) } });
    await audit(db, s.userId, "CREATE", "User", u.id, undefined, { login: u.login, role: u.role });
  } catch (e) { return uniq(e, "Bu login band") ?? (() => { throw e; })(); }
  refresh();
  return { ok: true };
}

/** Mavjud foydalanuvchining ismi va roli. DIRECTOR rolini faqat direktor beradi/oladi (sahifa faqat direktorniki);
 *  o'z rolini o'zgartirib bo'lmaydi va oxirgi faol direktor rolidan tushirilmaydi — tizim egasiz qolmasin. */
/** IT superadmin hisobi (platforma) — direktor uni o'zgartira, bloklay va parolini almashtira olmaydi. */
async function isPlatformUser(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: { role: true } });
  return u?.role === "SUPERADMIN";
}
const PLATFORM_ERR = "Bu IT (platforma) hisobi — uni faqat markaziy panel boshqaradi";

const editUserSchema = z.object({ fullName: zStr("F.I.O. kerak"), role: z.enum(ROLES) });

export async function updateUser(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (s.role !== "DIRECTOR") return { error: "Faqat direktor" };
  const r = parseForm(editUserSchema, fd);
  if ("error" in r) return { error: r.error };
  const before = await db.user.findUniqueOrThrow({ where: { id }, select: { id: true, fullName: true, role: true, isActive: true } });
  if (before.role === "SUPERADMIN") return { error: PLATFORM_ERR };
  if (before.role !== r.data.role) {
    if (id === s.userId) return { error: "O'z rolingizni o'zgartirib bo'lmaydi" };
    if (before.role === "DIRECTOR" && before.isActive) {
      const directors = await db.user.count({ where: { role: "DIRECTOR", isActive: true } });
      if (directors <= 1) return { error: "Oxirgi faol direktorning rolini o'zgartirib bo'lmaydi" };
    }
  }
  if (before.fullName === r.data.fullName && before.role === r.data.role) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { fullName: r.data.fullName, role: r.data.role } });
    // Rol o'zgarsa ochiq sessiyalar (ayniqsa mobil ilova) eski ruxsat bilan qolmasin
    if (before.role !== r.data.role) await revokeSessions(tx, id);
    await audit(tx, s.userId, "UPDATE", "User", id, { fullName: before.fullName, role: before.role }, { fullName: r.data.fullName, role: r.data.role });
  });
  refresh();
  return { ok: true };
}

export async function toggleUser(id: string) {
  const s = await requireSession(["DIRECTOR"]);
  if (s.userId === id) return;
  const u = await db.user.findUniqueOrThrow({ where: { id } });
  if (u.role === "SUPERADMIN") return;
  // Oxirgi faol direktor bloklanmasin
  if (u.isActive && u.role === "DIRECTOR" && (await db.user.count({ where: { role: "DIRECTOR", isActive: true } })) <= 1) return;
  await db.user.update({ where: { id }, data: { isActive: !u.isActive } });
  // Hisob yopilganda uning ochiq veb/mobil sessiyalari ham shu zahoti tugaydi
  if (u.isActive) await revokeSessions(db, id);
  await audit(db, s.userId, "UPDATE", "User", id, { isActive: u.isActive }, { isActive: !u.isActive });
  refresh();
}

export async function resetPassword(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (await isPlatformUser(id)) return { error: PLATFORM_ERR };
  const pw = String(fd.get("password") ?? "");
  const problem = passwordProblem(pw);
  if (problem) return { error: problem };
  await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(pw) } });
  // Eski sessiyalar kuyadi; direktor o'z parolini almashtirgan bo'lsa unga yangi cookie beriladi
  await revokeSessions(db, id, { keepCurrent: s.userId === id });
  await audit(db, s.userId, "UPDATE", "User", id, undefined, { passwordReset: true });
  refresh();
  return { ok: true };
}

/** Zavod nuqtasi — Sozlamalardagi xaritadan belgilanadi; masofalar shundan hisoblanadi. */
export async function savePlantLocation(lat: number, lng: number): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "Nuqta noto'g'ri" };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { error: "Koordinata oralig'idan tashqarida (kenglik −90…90, uzunlik −180…180)" };
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } });
  await db.companySettings.upsert({
    where: { id: "main" },
    update: { lat, lng },
    create: { id: "main", lat, lng },
  });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before ?? undefined, { lat, lng });
  revalidatePath("/settings");
  return { ok: true };
}

/** "Katta xarid" chegarasi — shundan katta ta'minot zayavkasi avval direktor tasdig'idan o'tadi (0 — cheklov yo'q).
 *  Yagona tahrir joyi — Sozlamalar → Limitlar. */
const supplyLimitSchema = z.object({
  supplyDirectorLimit: z.string().trim().transform((v) => Number(v.replace(/[\s,]/g, ""))).refine((v) => Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT, "Summa noto'g'ri"),
});

export async function saveSupplyDirectorLimit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(supplyLimitSchema, fd);
  if ("error" in r) return { error: r.error };
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { supplyDirectorLimit: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: { supplyDirectorLimit: r.data.supplyDirectorLimit }, create: { id: "main", supplyDirectorLimit: r.data.supplyDirectorLimit } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before ? { supplyDirectorLimit: Number(before.supplyDirectorLimit) } : undefined, { supplyDirectorLimit: r.data.supplyDirectorLimit });
  refresh(); revalidatePath("/dashboard/byudjet"); revalidatePath("/taminot");
  return { ok: true };
}

/* ───────── To'lanmagan kirimlar sanasi (direktor) ───────── */

const payablesSchema = z.object({
  payablesSince: zStr("Sana kerak").refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(new Date(v).getTime()), "Sana noto'g'ri"),
});

/** Shu sanadan (Toshkent vaqti) keyin kiritilgan kirimlar "To'lanmagan kirimlar" ro'yxatiga tushadi. */
export async function savePayablesSince(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(payablesSchema, fd);
  if ("error" in r) return { error: r.error };
  const since = new Date(`${r.data.payablesSince}T00:00:00+05:00`);
  if (since.getTime() > Date.now()) return { error: "Kelajakdagi sana bo'lmasin" };
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { payablesSince: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: { payablesSince: since }, create: { id: "main", payablesSince: since } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", { payablesSince: before?.payablesSince ?? null }, { payablesSince: since });
  refresh(); revalidatePath("/cashflow"); revalidatePath("/suppliers");
  return { ok: true };
}

/* ───────── QQS to'lovchisi (direktor) ───────── */

/**
 * Korxona QQS to'lovchisimi: YANGI kirimlarning sklad tannarxiga ta'sir qiladi (to'lovchi — QQS'siz,
 * aks holda QQS bilan). Oldingi kirimlarning tannarxi qayta hisoblanmaydi (`lib/receipt-vat.ts`).
 */
export async function saveVatPayer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const v = fd.get("vatPayer");
  if (v !== "1" && v !== "0") return { error: "Tanlang: QQS to'lovchisi yoki yo'q" };
  const vatPayer = v === "1";
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { vatPayer: true } });
  if (before && before.vatPayer === vatPayer) return { ok: true, note: "O'zgarish yo'q" };
  await db.companySettings.upsert({ where: { id: "main" }, update: { vatPayer }, create: { id: "main", vatPayer } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", { vatPayer: before?.vatPayer ?? true }, { vatPayer });
  refresh(); revalidatePath("/receipts/new"); revalidatePath("/kirim-qqs");
  return { ok: true, note: "Saqlandi" };
}

/**
 * Ishlab chiqarish Telegram kanali: brigada tayinlanganda ERP boti shu kanalga yozadi (`lib/telegram/channel.ts`).
 * «Tekshirish» — faqat tekshiradi; «Saqlash» — tekshirib, to'g'ri bo'lsa saqlaydi. Bo'sh saqlansa — xabar yuborish o'chadi.
 */
export async function saveProductionChannel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const raw = String(fd.get("productionTgChat") ?? "").trim();
  const checkOnly = fd.get("intent") === "check";
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { productionTgChat: true } });
  let next: string | null = null;
  let title = "";
  if (raw) {
    const r = await verifyChannel(raw);
    if (!r.ok) return { error: r.error };
    next = r.chatId;
    title = r.title;
  } else if (checkOnly) {
    return { error: "Kanal manzilini kiriting" };
  }
  if (checkOnly) return { ok: true, note: `Ulandi: «${title}» — bot xabar yoza oladi` };
  if ((before?.productionTgChat ?? null) === next) return { ok: true, note: "O'zgarish yo'q" };
  await db.companySettings.upsert({ where: { id: "main" }, update: { productionTgChat: next }, create: { id: "main", productionTgChat: next } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", { productionTgChat: before?.productionTgChat ?? null }, { productionTgChat: next });
  refresh();
  return { ok: true, note: next ? `Saqlandi: «${title}»` : "Kanal o'chirildi" };
}

/* ───────── Limitlar (direktor): kunlik zayavka va quvvat, standart va mijozlar kredit limiti, davomat radiusi ───────── */

/** Bo'sh yoki 0 — cheklov yo'q (`undefined`). Probel/vergul bilan yozilgan son ham qabul qilinadi. */
const zLimit = (max: number, label: string, int = false) =>
  z.string().optional().transform((v, ctx) => {
    const t = (v ?? "").trim().replace(/\s/g, "").replace(",", ".");
    if (!t) return undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > max || (int && !Number.isInteger(n))) {
      ctx.addIssue({ code: "custom", message: `${label}: 0 dan ${fmtNum(max)} gacha ${int ? "butun " : ""}son kiriting` });
      return z.NEVER;
    }
    return n > 0 ? Math.round(n * 100) / 100 : undefined;
  });

const dailyLimitSchema = z.object({
  dailyCapacityM3: zLimit(100_000, "Kunlik quvvat"),
  dailyCapacityPcs: zLimit(1_000_000, "Kunlik quvvat (dona)", true),
  dailyOrderMaxM3: zLimit(1_000_000, "Kunlik hajm chegarasi"),
  dailyOrderMaxCount: zLimit(100_000, "Kunlik zayavka soni", true),
});

/**
 * Kunlik ishlab chiqarish quvvati (taqvim rangi) va qattiq kunlik zayavka limiti — hajm (m³) va soni.
 * 0/bo'sh — cheklov yo'q. Hajm limiti tasdiqlashda va blokdan chiqarishda tekshiriladi (`lib/orders.ts`).
 */
export async function saveDailyOrderLimits(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(dailyLimitSchema, fd);
  if ("error" in r) return { error: r.error };
  const changed = await saveDailyOrderLimitsDb(s.userId, {
    capacityM3: r.data.dailyCapacityM3 ?? null, capacityPcs: r.data.dailyCapacityPcs ?? null, maxM3: r.data.dailyOrderMaxM3 ?? null, maxCount: r.data.dailyOrderMaxCount ?? null,
  });
  if (!changed) return { ok: true, note: "O'zgarish yo'q" };
  refresh(); revalidatePath("/orders"); revalidatePath("/orders/tarix"); revalidatePath("/orders/new");
  return { ok: true, note: "Saqlandi" };
}

const moneySchema = (field: string) => z.object({
  [field]: z.string().trim().transform((v) => Number(v.replace(/[\s,]/g, ""))).refine((v) => Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT, "Summa noto'g'ri"),
});

/**
 * Yangi mijozga standart kredit limiti (`CompanySettings.defaultCreditLimit`). Faqat bundan keyin ochiladigan
 * mijozlarga qo'llanadi — mavjud mijozlarning limiti o'zgarmaydi (ular pastdagi jadvalda alohida beriladi).
 */
export async function saveDefaultCreditLimit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(moneySchema("defaultCreditLimit"), fd);
  if ("error" in r) return { error: r.error };
  const value = Math.round(Number(r.data.defaultCreditLimit) * 100) / 100;
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { defaultCreditLimit: true } });
  if (before && Number(before.defaultCreditLimit) === value) return { ok: true, note: "O'zgarish yo'q" };
  await db.companySettings.upsert({ where: { id: "main" }, update: { defaultCreditLimit: value }, create: { id: "main", defaultCreditLimit: value } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", { defaultCreditLimit: before ? Number(before.defaultCreditLimit) : 0 }, { defaultCreditLimit: value });
  revalidatePath("/settings"); revalidatePath("/customers/new"); revalidatePath("/customers/import");
  return { ok: true, note: "Saqlandi" };
}

const radiusSchema = z.object({
  attendanceRadiusM: z.coerce.number({ message: "Radiusni kiriting" }).int("Radius butun son bo'lsin").min(50, "Davomat radiusi kamida 50 m").max(5000, "Davomat radiusi ko'pi bilan 5000 m"),
});

/** Xodim o'zi "Keldim/Ketdim" bosganda zavod nuqtasidan shu radius ichida bo'lishi shart (`lib/self-attendance.ts`). */
export async function saveAttendanceRadius(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(radiusSchema, fd);
  if ("error" in r) return { error: r.error };
  const v = r.data.attendanceRadiusM;
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { attendanceRadiusM: true } });
  if (before && before.attendanceRadiusM === v) return { ok: true, note: "O'zgarish yo'q" };
  await db.companySettings.upsert({ where: { id: "main" }, update: { attendanceRadiusM: v }, create: { id: "main", attendanceRadiusM: v } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", { attendanceRadiusM: before?.attendanceRadiusM ?? null }, { attendanceRadiusM: v });
  revalidatePath("/settings");
  return { ok: true, note: "Saqlandi" };
}

const limitChangesSchema = z.array(z.object({
  id: z.string().min(1).max(64),
  limit: z.number().finite().min(0, "Limit manfiy bo'lmasin").max(MAX_AMOUNT, "Limit juda katta"),
  expected: z.number().finite(),
})).min(1, "O'zgarish yo'q").max(5000, "Bir martada ko'pi bilan 5000 ta mijoz");

/**
 * Mijozlar kredit limiti jadvali — bir nechta mijozga birdan (faqat direktor). Har mijoz `credit:<id>` qulfi ostida,
 * jadval ochilgandan beri boshqa joyda o'zgargan limit ustidan yozilmaydi (`lib/customer-limits.ts`).
 */
export async function saveCustomerLimits(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get("changes") ?? "[]")); } catch { return { error: "Ma'lumot noto'g'ri — sahifani yangilab qayta urinib ko'ring" }; }
  const r = limitChangesSchema.safeParse(raw);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Limit noto'g'ri" };
  const res = await setCustomerCreditLimits({ userId: s.userId, role: s.role }, r.data.map((c) => ({ ...c, limit: Math.round(c.limit * 100) / 100 })));
  revalidatePath("/settings"); revalidatePath("/customers"); revalidatePath("/orders"); revalidatePath("/orders/new"); revalidatePath("/dashboard");
  const parts = [res.changed ? `${res.changed} ta mijoz limiti yangilandi` : "", res.same ? `${res.same} ta o'zgarmagan` : "", res.missing ? `${res.missing} ta topilmadi` : ""].filter(Boolean);
  if (res.conflicts.length) {
    return { error: `${res.conflicts.slice(0, 5).join(", ")}${res.conflicts.length > 5 ? ` va yana ${res.conflicts.length - 5} ta` : ""} — limit shu orada boshqa joyda o'zgartirilgan, saqlanmadi. Sahifani yangilab, qayta tekshiring.${parts.length ? ` (${parts.join(", ")})` : ""}` };
  }
  return { ok: true, note: parts.join(", ") || "O'zgarish yo'q" };
}

/* ───────── Modul va amal bo'yicha ruxsat (faqat direktor taqsimlaydi) ───────── */

/**
 * Foydalanuvchiga modul/amal bo'yicha ruxsat belgilaydi (rol ustiga ishlaydi). Faqat direktor; har o'zgarish auditda.
 * Forma — `PermsMatrix` (`permsFromForm` o'qiydi).
 */
export async function saveUserPerms(userId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (s.role !== "DIRECTOR") return { error: "Faqat direktor" };
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, perms: true, fullName: true } });
  if (!target) return { error: "Foydalanuvchi topilmadi" };
  if (target.role === "DIRECTOR" || target.role === "SUPERADMIN") return { error: "Direktor ruxsatlari cheklanmaydi — u doim to'liq huquqli" };
  await applyAccess(s.userId, target, { perms: permsFromForm(fd) }, "ruxsatlar");
  refresh();
  return { ok: true };
}

/** Bir xodimning ruxsatlarini boshqasiga ko'chirish (masalan yangi sotuvchiga tajribalinikini). */
export async function copyUserPerms(targetId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (s.role !== "DIRECTOR") return { error: "Faqat direktor" };
  const sourceId = String(fd.get("sourceId") ?? "");
  if (!sourceId || sourceId === targetId) return { error: "Kimdan nusxa olinishini tanlang" };
  const [target, source] = await Promise.all([
    db.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, perms: true, fullName: true } }),
    db.user.findUnique({ where: { id: sourceId }, select: { perms: true } }),
  ]);
  if (!target || !source) return { error: "Foydalanuvchi topilmadi" };
  if (target.role === "DIRECTOR" || target.role === "SUPERADMIN") return { error: "Direktor ruxsatlari cheklanmaydi" };
  await applyAccess(s.userId, target, { perms: parsePerms(source.perms) ?? {} }, "nusxa");
  refresh();
  return { ok: true };
}

/* ───────── Bir nechta xodimga birdan: shablon yoki ruxsatlar ───────── */

/** Belgilangan foydalanuvchilar (`ids`) — kamida bittasi. */
function pickedIds(fd: FormData): string[] {
  return [...new Set(fd.getAll("ids").map(String).filter((v) => /^[\w-]{1,64}$/.test(v)))];
}

function bulkNote(r: { changed: number; same: number; skipped: string[] }, what: string) {
  return [
    `${r.changed} ta xodimga ${what} qo'llandi`,
    r.same ? `${r.same} tasida o'zgarish yo'q edi` : "",
    r.skipped.length ? `direktor hisobi o'tkazib yuborildi: ${r.skipped.slice(0, 5).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * Shablonni qo'llash: `template` = ishchi lavozim id'si (uning ruxsatlari) yoki "role" — "rol bo'yicha"
 * (qo'shimcha ruxsatlar tozalanadi). `withRole` belgilansa shablondagi asosiy bo'lim ham beriladi — rol
 * almashgan xodimlar tizimga qayta kiradi. Faqat direktor.
 */
export async function applyPermTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (s.role !== "DIRECTOR") return { error: "Faqat direktor" };
  const ids = pickedIds(fd);
  if (!ids.length) return { error: "Kamida bitta xodimni belgilang" };
  const key = String(fd.get("template") ?? "");
  let next: { perms: Perms; role?: Role | null };
  let what: string;
  if (key === "role") {
    next = { perms: {} };
    what = "«rol bo'yicha» holat";
  } else {
    const t = (await positionTemplates()).find((x) => x.id === key);
    if (!t) return { error: "Shablonni tanlang" };
    const withRole = fd.get("withRole") === "on" && !!t.loginRole;
    next = { perms: t.perms, role: withRole ? t.loginRole : null };
    what = `«${t.name}» shabloni${withRole && t.loginRole ? ` (bo'lim: ${templateRoleLabel(t.loginRole)})` : ""}`;
  }
  const r = await applyAccessMany(s.userId, ids, next, "shablon");
  if (!r.found) return { error: "Belgilangan xodimlar topilmadi — sahifani yangilang" };
  refresh(); revalidatePath("/employees"); revalidatePath("/otdel-kadr");
  return { ok: true, note: bulkNote(r, what) };
}

/** Bir nechta xodimning ruxsatlarini bitta matritsa bilan almashtirish. Faqat direktor. */
export async function bulkSaveUserPerms(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (s.role !== "DIRECTOR") return { error: "Faqat direktor" };
  const ids = pickedIds(fd);
  if (!ids.length) return { error: "Kamida bitta xodimni belgilang" };
  const r = await applyAccessMany(s.userId, ids, { perms: permsFromForm(fd) }, "ruxsatlar-birdan");
  if (!r.found) return { error: "Belgilangan xodimlar topilmadi — sahifani yangilang" };
  refresh();
  return { ok: true, note: bulkNote(r, "ruxsatlar") };
}

/* ───────── Hisobni o'chirish so'rovlari (do'kon talabi) ───────── */

export async function approveDeletion(id: string): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = await approveRequest(id, s.userId);
  if (!r.ok) return { error: r.error };
  revalidatePath("/settings"); revalidatePath("/employees");
  return { ok: true };
}

export async function rejectDeletion(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300) || null;
  const r = await rejectRequest(id, s.userId, reason);
  if (!r.ok) return { error: r.error };
  revalidatePath("/settings");
  return { ok: true };
}
