"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { assignCustomerAgentLib } from "@/lib/customer-admin";
import type { ActionState } from "@/lib/action";

/**
 * Mijozni sotuv agentiga biriktirish / biriktirishni bekor qilish (Customer.agentId).
 *
 * Direktor, otdel kadr yoki sotuv bo'limi bajaradi. Mijozlar sahifasi boshqa modul — shuning uchun
 * biriktirish shu yerda (agent kabinetidan chaqiriladi), `customers/**` ga tegilmaydi.
 * `agentId` bo'sh ("") — biriktirish uziladi. Tanlangan agent aynan AGENT rolli faol foydalanuvchi bo'lishi shart.
 */
export async function assignCustomerAgent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("customers", "agent");
  const customerId = String(fd.get("customerId") ?? "").trim();
  const agentId = String(fd.get("agentId") ?? "").trim();
  // Qoida `lib/customer-admin.ts` da — mobil ilova (mijoz kartasi) ham shuni chaqiradi
  const r = await assignCustomerAgentLib(customerId, agentId, s.userId);
  if (!r.ok) return { error: r.error };
  revalidatePath("/agent"); revalidatePath("/employees"); revalidatePath("/customers");
  return { ok: true, note: r.note };
}
