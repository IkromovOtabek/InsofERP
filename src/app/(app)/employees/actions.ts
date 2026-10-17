"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import {
  changeEmployeeRoleCore, changeLoginCore, createEmployeeCore, dismissEmployeeCore, grantLoginCore, resetEmployeePasswordCore,
  restoreEmployeeCore, toggleEmployeeCore, toggleEmployeeLoginCore, updateEmployeeCore, type KadrResult,
} from "@/lib/kadr-employee";

/*
 * Xodimlar: karta, ishdan bo'shatish, login boshqaruvi. Qoidalar — `lib/kadr-employee.ts`
 * (mobil ilova ham shu funksiyalarni chaqiradi). Bu yerda — ruxsat va sahifalarni yangilash.
 */

const state = (r: KadrResult): ActionState => ("error" in r ? { error: r.error } : { ok: true, ...(r.note ? { note: r.note } : {}) });

export async function createEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "create");
  const r = await createEmployeeCore(s, fd);
  if ("error" in r) return { error: r.error };
  revalidatePath("/employees"); revalidatePath("/otdel-kadr"); revalidatePath("/settings"); revalidatePath("/drivers"); revalidatePath("/trips");
  return state(r);
}

/**
 * Mavjud xodimga login berish.
 * Bo'lim (rol) formada tanlanadi — shuning uchun ishchi lavozimdagi xodim ham
 * (masalan "Skladchi") kerakli bo'lim bilan tizimga kira oladi; kadr lavozimi o'zgarmaydi.
 * Tanlanmagan bo'lsa rol lavozimdan olinadi (bo'lim lavozimi yoki haydovchi).
 */
export async function grantLogin(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "login");
  const r = await grantLoginCore(s, employeeId, fd);
  if ("error" in r) return { error: r.error };
  revalidatePath("/employees"); revalidatePath("/settings");
  return state(r);
}

/** Xodimni o'chirish/yoqish — bog'langan login ham birga bloklanadi/ochiladi. */
export async function toggleEmployee(id: string) {
  const s = await requireAction("employees", "edit");
  const r = await toggleEmployeeCore(s, id);
  if ("error" in r) throw new Error(r.error); // UI tugmani bunday holatda ko'rsatmaydi
  revalidatePath("/employees"); revalidatePath("/settings"); revalidatePath("/drivers");
}

/* ───────── Ishdan bo'shatish ───────── */

function dismissPaths() {
  revalidatePath("/employees"); revalidatePath("/otdel-kadr"); revalidatePath("/settings");
  revalidatePath("/drivers"); revalidatePath("/trips");
}

/**
 * Xodimni ishdan bo'shatish: sana va sabab kartaga yoziladi, xodim nofaol bo'ladi,
 * logini bloklanadi va biriktirilgan texnikasi bo'shaydi (boshqa haydovchiga beriladi).
 */
export async function dismissEmployee(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "edit");
  const r = await dismissEmployeeCore(s, id, fd);
  if ("error" in r) return { error: r.error };
  dismissPaths(); revalidatePath("/brigades");
  return state(r);
}

/** Bo'shatishni bekor qilish: sana va sabab tozalanadi, xodim va logini qaytadi. */
export async function restoreEmployee(id: string): Promise<ActionState> {
  const s = await requireAction("employees", "edit");
  const r = await restoreEmployeeCore(s, id);
  if ("error" in r) return { error: r.error };
  dismissPaths();
  return state(r);
}

/** Xodim kartasi: otdel kadr F.I.O., lavozim, telefon va sanalarni tuzatadi. */
export async function updateEmployee(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "edit");
  const r = await updateEmployeeCore(s, id, fd);
  if ("error" in r) return { error: r.error };
  revalidatePath("/employees"); revalidatePath("/otdel-kadr"); revalidatePath("/drivers"); revalidatePath("/trips");
  return { ok: true };
}

/* ───────── Login boshqaruvi (otdel kadr) ───────── */

/** Login nomini almashtirish. */
export async function changeLogin(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "login");
  const r = await changeLoginCore(s, employeeId, fd);
  if ("error" in r) return { error: r.error };
  if (r.same) return { ok: true };
  revalidatePath(`/employees/${employeeId}`); revalidatePath("/employees"); revalidatePath("/settings");
}

/** Login bo'limini (rolini) almashtirish — xodimning ochiq sessiyalari tugaydi. */
export async function changeEmployeeRole(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "login");
  const r = await changeEmployeeRoleCore(s, employeeId, fd);
  if ("error" in r) return { error: r.error };
  revalidatePath(`/employees/${employeeId}`); revalidatePath("/employees"); revalidatePath("/otdel-kadr"); revalidatePath("/settings");
  return state(r);
}

/** Parolni almashtirish — eski parol so'ralmaydi, otdel kadr yangisini beradi. */
export async function resetEmployeePassword(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "login");
  const r = await resetEmployeePasswordCore(s, employeeId, fd);
  if ("error" in r) return { error: r.error };
  revalidatePath(`/employees/${employeeId}`); revalidatePath("/settings");
  return state(r);
}

/**
 * Tizimga kirishni bloklash / ochish. Xodimning o'zi faol qoladi —
 * ishdan bo'shatish uchun xodim qatoridagi "O'chirish" ishlatiladi.
 */
export async function toggleEmployeeLogin(employeeId: string) {
  const s = await requireAction("employees", "login");
  const r = await toggleEmployeeLoginCore(s, employeeId);
  if ("error" in r) throw new Error(r.error); // UI bunday holatda tugmani ko'rsatmaydi
  revalidatePath(`/employees/${employeeId}`); revalidatePath("/employees"); revalidatePath("/settings");
}
