"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({ name: zStr("Nomi kerak"), inn: zOpt, phone: zOpt });

export async function createSupplier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  try {
    const sup = await db.supplier.create({ data: r.data });
    await audit(db, s.userId, "CREATE", "Supplier", sup.id, undefined, sup);
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan yetkazuvchi bor" };
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true };
}

export async function toggleSupplier(id: string) {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT"]);
  const cur = await db.supplier.findUniqueOrThrow({ where: { id } });
  await db.supplier.update({ where: { id }, data: { isActive: !cur.isActive } });
  await audit(db, s.userId, "UPDATE", "Supplier", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  revalidatePath("/suppliers"); revalidatePath(`/suppliers/${id}`);
}

/** Yetkazuvchi rekvizitlarini tahrirlash (nomi, INN, telefon) — har o'zgarish auditda. */
export async function updateSupplier(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const cur = await db.supplier.findUnique({ where: { id } });
  if (!cur) return { error: "Yetkazuvchi topilmadi" };
  const data = { name: r.data.name, inn: r.data.inn, phone: r.data.phone };
  if (data.name === cur.name && data.inn === cur.inn && data.phone === cur.phone) return { ok: true, note: "O'zgarish yo'q" };
  if (data.inn) {
    const dup = await db.supplier.findFirst({ where: { inn: data.inn, id: { not: id } }, select: { name: true } });
    if (dup) return { error: `Bu INN «${dup.name}» da bor` };
  }
  try {
    const after = await db.supplier.update({ where: { id }, data });
    await audit(db, s.userId, "UPDATE", "Supplier", id, { name: cur.name, inn: cur.inn, phone: cur.phone }, { name: after.name, inn: after.inn, phone: after.phone });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan yetkazuvchi bor" };
    throw e;
  }
  revalidatePath("/suppliers"); revalidatePath(`/suppliers/${id}`);
  return { ok: true, note: "Saqlandi" };
}
