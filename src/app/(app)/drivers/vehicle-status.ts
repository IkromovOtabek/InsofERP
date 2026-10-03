"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/lib/action";
import type { VehicleStatus } from "@/generated/prisma";

/** Texnika holati — logistika va mexanik belgilaydi; egasi dashbordidagi "Transport" bloki shundan o'qiydi. */
export async function setVehicleStatus(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "service");
  const status = String(fd.get("status") ?? "");
  if (!["ACTIVE", "REPAIR", "IDLE"].includes(status)) return { error: "Holat noto'g'ri" };
  const note = String(fd.get("note") ?? "").trim() || null;
  const before = await db.vehicle.findUnique({ where: { id: vehicleId } });
  if (!before) return { error: "Texnika topilmadi" };
  if (status !== "ACTIVE" && !note) return { error: "Sababini yozing (ta'mir turi / nega bekor turibdi)" };
  const after = await db.vehicle.update({
    where: { id: vehicleId },
    data: { status: status as VehicleStatus, statusNote: status === "ACTIVE" ? null : note, statusSince: status === before.status ? before.statusSince : new Date() },
  });
  await audit(db, s.userId, "UPDATE", "Vehicle", vehicleId, { status: before.status, note: before.statusNote }, { status: after.status, note: after.statusNote });
  revalidatePath("/drivers"); revalidatePath("/dashboard"); revalidatePath("/logistika", "layout"); revalidatePath(`/logistika/transport/${vehicleId}`);
  return { ok: true };
}
