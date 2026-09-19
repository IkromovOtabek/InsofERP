"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  name: zStr("Brigada nomi kerak"),
  leaderId: zOpt,
  phone: zOpt,
  note: zOpt,
});

export async function saveBrigade(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "HR"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.brigade.findUniqueOrThrow({ where: { id } });
      const after = await tx.brigade.update({ where: { id }, data: d });
      await audit(tx, s.userId, "UPDATE", "Brigade", id, before, after);
    } else {
      const b = await tx.brigade.create({ data: d });
      await audit(tx, s.userId, "CREATE", "Brigade", b.id, undefined, b);
    }
  });
  revalidatePath("/brigades"); revalidatePath("/orders/new");
  return { ok: true };
}

export async function toggleBrigade(id: string) {
  const s = await requireSession(["PRODUCTION", "HR"]);
  const b = await db.brigade.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.brigade.update({ where: { id }, data: { isActive: !b.isActive } });
    await audit(tx, s.userId, "UPDATE", "Brigade", id, { isActive: b.isActive }, { isActive: !b.isActive });
  });
  revalidatePath("/brigades"); revalidatePath("/orders/new");
}
