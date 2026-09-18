"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, type ActionState } from "@/lib/action";

const schema = z.object({
  plate: zStr("Davlat raqami kerak").transform((v) => v.toUpperCase().replace(/\s+/g, "")),
  type: z.enum(["MIXER", "PUMP", "TRUCK"]),
  capacityM3: z.coerce.number().min(0).optional(),
});

export async function createVehicle(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  try {
    const v = await db.vehicle.create({ data: { ...r.data, capacityM3: r.data.capacityM3 || null } });
    await audit(db, s.userId, "CREATE", "Vehicle", v.id, undefined, v);
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu raqamli texnika allaqachon bor" };
    throw e;
  }
  revalidatePath("/vehicles");
  return { ok: true };
}

export async function toggleVehicle(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const cur = await db.vehicle.findUniqueOrThrow({ where: { id } });
  await db.vehicle.update({ where: { id }, data: { isActive: !cur.isActive } });
  await audit(db, s.userId, "UPDATE", "Vehicle", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  revalidatePath("/vehicles");
}
