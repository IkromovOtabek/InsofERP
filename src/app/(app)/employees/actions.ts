"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { roleForPosition } from "@/lib/positions";
import { pushEmployeeSilently, isDriverPosition } from "@/lib/eco/people";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import type { Prisma } from "@/generated/prisma";

const schema = z.object({
  fullName: zStr("F.I.O. kerak"),
  position: zStr("Lavozim kerak"),
  phone: zOpt,
  login: zOpt,
  password: zOpt,
});

/** Rolli lavozim uchun User yaratadi (tranzaksiya ichida). */
async function createLoginFor(tx: Prisma.TransactionClient, fullName: string, position: string, login: string, password: string) {
  const role = roleForPosition(position);
  if (!role) throw new Error("Bu lavozim uchun tizim roli yo'q");
  if (login.length < 3) throw new Error("Login kamida 3 belgi");
  if (password.length < 6) throw new Error("Parol kamida 6 belgi");
  return tx.user.create({ data: { login: login.toLowerCase(), fullName, role, passwordHash: await hashPassword(password) } });
}

export async function createEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR", "LOGISTICS"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const role = roleForPosition(d.position);
  if (role && (!d.login || !d.password)) return { error: `"${d.position}" lavozimi tizimga kiradi — login va parol kiriting` };
  if (role && !["HR", "DIRECTOR"].includes(s.role)) return { error: "Tizimga kiradigan xodimni faqat Otdel kadr yoki direktor qo'sha oladi" };

  let createdId: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const user = role ? await createLoginFor(tx, d.fullName, d.position, d.login!, d.password!) : null;
      const e = await tx.employee.create({ data: { fullName: d.fullName, position: d.position, phone: d.phone, userId: user?.id } });
      createdId = e.id;
      await audit(tx, s.userId, "CREATE", "Employee", e.id, undefined, { ...e, login: user?.login, role });
    });
  } catch (e) {
    const m = String(e);
    if (m.includes("Unique constraint")) return { error: "Bu login band" };
    if (e instanceof Error && !m.includes("prisma")) return { error: e.message };
    throw e;
  }
  // Haydovchi — haydovchi ilovasida ham paydo bo'lsin (ECO o'chiq bo'lsa jim o'tadi)
  if (createdId && isDriverPosition(d.position)) pushEmployeeSilently(createdId);
  revalidatePath("/employees"); revalidatePath("/settings"); revalidatePath("/drivers");
  return { ok: true };
}

/** Mavjud xodimga login berish. */
export async function grantLogin(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR"]);
  const login = String(fd.get("login") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (e.userId) return { error: "Bu xodimda login bor" };
  try {
    await db.$transaction(async (tx) => {
      const u = await createLoginFor(tx, e.fullName, e.position, login, password);
      await tx.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
      await audit(tx, s.userId, "UPDATE", "Employee", employeeId, undefined, { login: u.login, role: u.role });
    });
  } catch (err) {
    const m = String(err);
    if (m.includes("Unique constraint")) return { error: "Bu login band" };
    if (err instanceof Error && !m.includes("prisma")) return { error: err.message };
    throw err;
  }
  revalidatePath("/employees"); revalidatePath("/settings");
  return { ok: true };
}

/** Xodimni o'chirish/yoqish — bog'langan login ham birga bloklanadi/ochiladi. */
export async function toggleEmployee(id: string) {
  const s = await requireSession(["HR"]);
  const cur = await db.employee.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: { isActive: !cur.isActive } });
    if (cur.userId) await tx.user.update({ where: { id: cur.userId }, data: { isActive: !cur.isActive } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  // O'chirilgan haydovchi ilovaga ham kira olmasin; qayta yoqilsa a'zoligi tiklanadi
  if (isDriverPosition(cur.position)) pushEmployeeSilently(id);
  revalidatePath("/employees"); revalidatePath("/settings"); revalidatePath("/drivers");
}
