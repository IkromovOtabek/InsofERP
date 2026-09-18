"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({ name: zStr("Nomi kerak"), inn: zOpt, phone: zOpt });

export async function createSupplier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PROCUREMENT", "ACCOUNTING"]);
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
  const s = await requireSession(["PROCUREMENT"]);
  const cur = await db.supplier.findUniqueOrThrow({ where: { id } });
  await db.supplier.update({ where: { id }, data: { isActive: !cur.isActive } });
  await audit(db, s.userId, "UPDATE", "Supplier", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  revalidatePath("/suppliers");
}
