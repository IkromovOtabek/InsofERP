"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { deleteCustomerSite, saveCustomerSite } from "@/lib/customer-sites";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { numIn } from "@/lib/logistics-admin";

/** Obyekt (Site) qo'shish/tahrirlash — mijoz kartasidagi kabi rol: SALES, ACCOUNTING, FINANCE (+DIRECTOR). */

const schema = z.object({
  name: zStr("Obyekt nomi to'ldirilishi shart"),
  address: zStr("Manzil to'ldirilishi shart"),
  lat: numIn(-90, 90),
  lng: numIn(-180, 180),
  contactName: zOpt,
  contactPhone: zOpt,
  deliveryHours: zOpt,
  instructions: zOpt,
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveSite(customerId: string, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("customers", "sites");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  // Qoida `lib/customer-sites.ts` da — mobil ilova (mijoz kartasi) ham shuni chaqiradi
  const res = await saveCustomerSite(customerId, id, r.data, s.userId);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}

export async function deleteSite(customerId: string, id: string): Promise<ActionState> {
  const s = await requireAction("customers", "sites");
  const res = await deleteCustomerSite(customerId, id, s.userId);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
