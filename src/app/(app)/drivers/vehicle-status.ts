"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { setVehicleStatusRecord } from "@/lib/logistics-admin";

/** Texnika holati — logistika va mexanik belgilaydi; qoida `lib/logistics-admin.ts` (mobil ilova ham shundan). */
export async function setVehicleStatus(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "service");
  const r = await setVehicleStatusRecord(vehicleId, String(fd.get("status") ?? ""), String(fd.get("note") ?? ""), s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/drivers"); revalidatePath("/dashboard"); revalidatePath("/logistika", "layout"); revalidatePath(`/logistika/transport/${vehicleId}`);
  return { ok: true };
}
