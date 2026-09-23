"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, zDec, type ActionState } from "@/lib/action";

const ROLES = ["DIRECTOR", "SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "FINANCE", "HR", "CASHIER"] as const;
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
});

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

export async function saveCashAccount(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = parseForm(accSchema, fd);
  if ("error" in r) return { error: r.error };
  if (id) {
    await db.cashAccount.update({ where: { id }, data: r.data });
    await audit(db, s.userId, "UPDATE", "CashAccount", id, undefined, r.data);
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
  password: z.string().min(6, "Parol kamida 6 belgi"),
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

export async function toggleUser(id: string) {
  const s = await requireSession(["DIRECTOR"]);
  if (s.userId === id) return;
  const u = await db.user.findUniqueOrThrow({ where: { id } });
  await db.user.update({ where: { id }, data: { isActive: !u.isActive } });
  await audit(db, s.userId, "UPDATE", "User", id, { isActive: u.isActive }, { isActive: !u.isActive });
  refresh();
}

export async function resetPassword(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const pw = String(fd.get("password") ?? "");
  if (pw.length < 6) return { error: "Parol kamida 6 belgi" };
  await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(pw) } });
  await audit(db, s.userId, "UPDATE", "User", id, undefined, { passwordReset: true });
  refresh();
  return { ok: true };
}

/** Zavod nuqtasi — Sozlamalardagi xaritadan belgilanadi; masofalar shundan hisoblanadi. */
export async function savePlantLocation(lat: number, lng: number) {
  await requireSession(["DIRECTOR"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Nuqta noto'g'ri");
  await db.companySettings.upsert({
    where: { id: "main" },
    update: { lat, lng },
    create: { id: "main", lat, lng },
  });
  revalidatePath("/settings");
}
