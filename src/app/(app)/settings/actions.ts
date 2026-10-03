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
import { MODULES } from "@/lib/nav";
import { parsePerms, type Perms } from "@/lib/auth";
import { actionDef, delegableActions } from "@/lib/permissions";
import { notifyAfter, notifyUsers } from "@/lib/notify";
import { Prisma } from "@/generated/prisma";

const ROLES = ["DIRECTOR", "AGENT", "SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "FINANCE", "HR", "CASHIER", "MECHANIC"] as const;
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
  // Kunlik ishlab chiqarish quvvati — Zayavkalar taqvimi shu chegaraga qarab rang beradi
  dailyCapacityM3: z.coerce.number().min(1).max(100000).optional().or(z.literal("").transform(() => undefined)),
  // Mijoz ilovasi "bugungi holat": ochiqmi, bugun yetkaziladimi
  openHour: z.coerce.number().int().min(0).max(23),
  closeHour: z.coerce.number().int().min(1).max(24),
  sameDayCutoffHour: z.coerce.number().int().min(0).max(24),
  workSunday: zBool,
  telegram: zOpt,
}).refine((v) => v.closeHour > v.openHour, { message: "Yopilish soati ochilishdan keyin bo'lsin", path: ["closeHour"] });

export async function saveCompany(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(companySchema, fd);
  if ("error" in r) return { error: r.error };
  const data = { ...r.data, foundedYear: r.data.foundedYear ?? null, dailyCapacityM3: r.data.dailyCapacityM3 ?? null };
  const before = await db.companySettings.findUnique({ where: { id: "main" } });
  const after = await db.companySettings.upsert({ where: { id: "main" }, update: data, create: { id: "main", ...data } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before, after);
  refresh(); revalidatePath("/trips");
  return { ok: true };
}

/* ───────── Beton markalari ───────── */

const productSchema = z.object({
  code: zStr("Kod kerak").transform((v) => v.toUpperCase()),
  name: zStr("Nomi kerak"), strengthClass: zOpt, unit: z.enum(["m3", "dona", "m2", "m", "t"]), price: zDec(0), isActive: zBool,
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
    } else {
      const m = await db.material.create({ data: { ...r.data, isActive: true } });
      await audit(db, s.userId, "CREATE", "Material", m.id, undefined, m);
    }
  } catch (e) { return uniq(e, "Bu kod bilan xomashyo bor") ?? (() => { throw e; })(); }
  refresh(); revalidatePath("/stock"); revalidatePath("/receipts/new");
  return { ok: true };
}

/* ───────── Skladlar ───────── */

const whSchema = z.object({ name: zStr("Nomi kerak"), isActive: zBool });

export async function saveWarehouse(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(whSchema, fd);
  if ("error" in r) return { error: r.error };
  if (id) {
    await db.warehouse.update({ where: { id }, data: r.data });
    await audit(db, s.userId, "UPDATE", "Warehouse", id, undefined, r.data);
  } else {
    const w = await db.warehouse.create({ data: { name: r.data.name } });
    await audit(db, s.userId, "CREATE", "Warehouse", w.id, undefined, w);
  }
  refresh();
  return { ok: true };
}

/* ───────── Kassa / hisoblar ───────── */

const accSchema = z.object({ name: zStr("Nomi kerak"), type: z.enum(["CASH", "BANK"]), isActive: zBool });

/** Hisob qoldig'i — mijoz to'lovlari + boshqa kirimlar − chiqimlar (Kirim-Chiqim va Egasi dashbordi bilan bir xil formula). */
async function accountBalance(id: string) {
  const [pay, tx] = await Promise.all([
    db.payment.aggregate({ where: { cashAccountId: id }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { cashAccountId: id }, _sum: { amount: true } }),
  ]);
  return Number(pay._sum.amount ?? 0) + tx.reduce((x, t) => x + (t.type === "INCOME" ? 1 : -1) * Number(t._sum.amount ?? 0), 0);
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
    const after = await db.cashAccount.update({ where: { id }, data: r.data });
    await audit(db, s.userId, "UPDATE", "CashAccount", id, before, after);
  } else {
    const a = await db.cashAccount.create({ data: { name: r.data.name, type: r.data.type } });
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
 *  Xuddi shu maydon Byudjet sahifasidagi "Holat chegaralari" formasida ham bor. */
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

/* ───────── Kunlik zayavka limiti (direktor) ───────── */

const dailyLimitSchema = z.object({
  // 0 yoki bo'sh — cheklov yo'q
  dailyOrderMaxM3: z.coerce.number().min(0).max(1_000_000).optional().or(z.literal("").transform(() => undefined)),
  dailyOrderMaxCount: z.coerce.number().int().min(0).max(100000).optional().or(z.literal("").transform(() => undefined)),
});

/** Bir yetkazish kuniga tasdiqlanadigan zayavkalarning eng ko'p hajmi (m³) va soni. 0/bo'sh — cheklov yo'q. */
export async function saveDailyOrderLimits(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(dailyLimitSchema, fd);
  if ("error" in r) return { error: r.error };
  const m3 = r.data.dailyOrderMaxM3 && r.data.dailyOrderMaxM3 > 0 ? r.data.dailyOrderMaxM3 : null;
  const count = r.data.dailyOrderMaxCount && r.data.dailyOrderMaxCount > 0 ? r.data.dailyOrderMaxCount : null;
  await saveDailyOrderLimitsDb(s.userId, m3, count);
  refresh(); revalidatePath("/orders");
  return { ok: true };
}

/* ───────── Modul va amal bo'yicha ruxsat (faqat direktor taqsimlaydi) ───────── */

const MODULE_KEYS = new Set(MODULES.map((m) => m.key));

/** Ruxsatlarni o'qiladigan matnga — audit va bildirishnoma uchun ("Zayavkalar: ochish, qabul qilish"). */
function describePerms(p: Perms): string[] {
  return Object.entries(p).map(([m, v]) => {
    const label = MODULES.find((x) => x.key === m)?.label ?? m;
    if (Array.isArray(v)) {
      const names = v.map((a) => actionDef(m, a)?.label ?? a);
      return `${label}: ko'rish${names.length ? " + " + names.join(", ") : ""}`;
    }
    return `${label}: ${v === "none" ? "yopiq" : v === "view" ? "faqat ko'rish" : "to'liq"}`;
  });
}

/** Ruxsat o'zgargach: audit + xodimga bildirishnoma (nima o'zgarganini ko'rsin). */
async function applyPerms(directorId: string, target: { id: string; fullName: string; perms: unknown }, perms: Perms) {
  const before = parsePerms(target.perms) ?? {};
  const after = Object.keys(perms).length ? perms : null;
  if (JSON.stringify(before) === JSON.stringify(after ?? {})) return;
  // Hammasi "rol bo'yicha" bo'lsa perms ustuni tozalanadi (DbNull) — rol ruxsati o'z holicha qaytadi.
  // Qayta kirish shart emas: perms tokenga yozilmaydi, `getSession` har so'rovda bazadan yangi qiymatni o'qiydi.
  await db.user.update({ where: { id: target.id }, data: { perms: after ?? Prisma.DbNull } });
  await audit(db, directorId, "UPDATE", "User", target.id, { perms: before, ruxsat: describePerms(before) }, { perms: after ?? {}, ruxsat: describePerms(after ?? {}), xodim: target.fullName });
  notifyAfter(() => notifyUsers([target.id], {
    type: "PERMS_CHANGED",
    title: "Ruxsatlaringiz yangilandi",
    body: after ? describePerms(after).join(" · ").slice(0, 300) : "Ruxsatlar rol bo'yicha holatga qaytarildi",
  }));
}

/**
 * Foydalanuvchiga modul/amal bo'yicha ruxsat belgilaydi (rol ustiga ishlaydi). Faqat direktor; har o'zgarish auditda.
 * Forma har modul uchun `perm.<modul>` = "" (rol bo'yicha) | none | view | custom | write yuboradi;
 * "custom" bo'lsa `act.<modul>` — belgilangan amallar (faqat katalogdagi, topshiriladiganlari qabul qilinadi).
 */
export async function saveUserPerms(userId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  if (s.role !== "DIRECTOR") return { error: "Faqat direktor" };
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, perms: true, fullName: true } });
  if (!target) return { error: "Foydalanuvchi topilmadi" };
  if (target.role === "DIRECTOR" || target.role === "SUPERADMIN") return { error: "Direktor ruxsatlari cheklanmaydi — u doim to'liq huquqli" };

  const perms: Perms = {};
  for (const m of MODULES) {
    if (!MODULE_KEYS.has(m.key)) continue;
    const v = String(fd.get(`perm.${m.key}`) ?? "").trim();
    if (v === "none" || v === "view" || v === "write") perms[m.key] = v;
    else if (v === "custom") {
      const allowed = new Set(delegableActions(m.key).map((a) => a.key));
      const acts = [...new Set(fd.getAll(`act.${m.key}`).map(String).filter((a) => allowed.has(a)))];
      // Birorta amal belgilanmagan "tanlangan amallar" — amalda "faqat ko'rish"
      perms[m.key] = acts.length ? acts : "view";
    }
  }
  await applyPerms(s.userId, target, perms);
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
  await applyPerms(s.userId, target, parsePerms(source.perms) ?? {});
  refresh();
  return { ok: true };
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
