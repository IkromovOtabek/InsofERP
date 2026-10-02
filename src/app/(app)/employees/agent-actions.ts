"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/lib/action";

/**
 * Mijozni sotuv agentiga biriktirish / biriktirishni bekor qilish (Customer.agentId).
 *
 * Direktor, otdel kadr yoki sotuv bo'limi bajaradi. Mijozlar sahifasi boshqa modul — shuning uchun
 * biriktirish shu yerda (agent kabinetidan chaqiriladi), `customers/**` ga tegilmaydi.
 * `agentId` bo'sh ("") — biriktirish uziladi. Tanlangan agent aynan AGENT rolli faol foydalanuvchi bo'lishi shart.
 */
export async function assignCustomerAgent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR", "HR", "SALES"]);
  const customerId = String(fd.get("customerId") ?? "").trim();
  const agentId = String(fd.get("agentId") ?? "").trim();
  if (!customerId) return { error: "Mijoz tanlanmagan" };

  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, agentId: true } });
  if (!customer) return { error: "Mijoz topilmadi" };

  let newAgentId: string | null = null;
  if (agentId) {
    const agent = await db.user.findUnique({ where: { id: agentId }, select: { id: true, role: true, isActive: true, fullName: true } });
    if (!agent || !agent.isActive) return { error: "Agent topilmadi yoki nofaol" };
    if (agent.role !== "AGENT") return { error: "Tanlangan foydalanuvchi sotuv agenti emas" };
    newAgentId = agent.id;
  }
  if (customer.agentId === newAgentId) return { ok: true, note: "O'zgarish yo'q" };

  await db.customer.update({ where: { id: customerId }, data: { agentId: newAgentId } });
  await audit(db, s.userId, "UPDATE", "Customer", customerId, { agentId: customer.agentId }, { agentId: newAgentId, mijoz: customer.name });
  revalidatePath("/agent"); revalidatePath("/employees"); revalidatePath("/customers");
  return { ok: true, note: newAgentId ? `${customer.name} agentga biriktirildi` : `${customer.name} agentdan uzildi` };
}
