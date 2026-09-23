"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { formatPhone } from "@/lib/sms/phone";

const ROLES = ["SALES", "DIRECTOR"] as const;

/** Holatni almashtirish (bog'landim / bekor). Kim ko'targani ham yoziladi. */
export async function setLeadStatus(leadId: string, status: "NEW" | "IN_PROGRESS" | "REJECTED") {
  const s = await requireSession([...ROLES]);
  const before = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  const after = await db.lead.update({
    where: { id: leadId },
    data: { status, handledById: s.userId, handledAt: new Date() },
  });
  await audit(db, s.userId, "STATUS_CHANGE", "Lead", leadId, before, after);
  revalidatePath("/leads");
}

/** Sotuvchining ichki izohi. */
export async function saveLeadNote(leadId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireSession([...ROLES]);
  const r = parseForm(z.object({ note: zOpt }), fd);
  if ("error" in r) return { error: r.error };
  await db.lead.update({ where: { id: leadId }, data: { note: r.data.note } });
  revalidatePath("/leads");
  return { ok: true };
}

/**
 * Arizani mijozga aylantirish. Shu raqamli mijoz allaqachon bo'lsa — yangisini
 * yaratmaymiz, borini bog'laymiz (bir mijoz ikki marta ariza qoldirishi normal).
 */
export async function convertLead(leadId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...ROLES]);
  const r = parseForm(z.object({ name: z.string().trim().min(2, "nomi to'liq yozilsin"), inn: zOpt }), fd);
  if ("error" in r) return { error: r.error };

  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.status === "CONVERTED") return { error: "Bu ariza allaqachon mijozga aylantirilgan" };

  if (r.data.inn) {
    const busy = await db.customer.findUnique({ where: { inn: r.data.inn } });
    if (busy && busy.name !== r.data.name) return { error: `Bu INN allaqachon "${busy.name}" mijozida` };
  }

  const existing = await db.customer.findFirst({ where: { phone: lead.phone } });
  const customer = existing
    ? existing
    : await db.customer.create({ data: { name: r.data.name, phone: lead.phone, inn: r.data.inn, address: lead.address } });

  const after = await db.lead.update({
    where: { id: leadId },
    data: { status: "CONVERTED", customerId: customer.id, handledById: s.userId, handledAt: new Date() },
  });
  await audit(db, s.userId, "STATUS_CHANGE", "Lead", leadId, lead, after);
  if (!existing) await audit(db, s.userId, "CREATE", "Customer", customer.id, undefined, customer);

  revalidatePath("/leads"); revalidatePath("/customers");
  return { ok: true, note: existing ? `Mavjud mijozga bog'landi: ${existing.name} (${formatPhone(lead.phone)})` : "Mijoz yaratildi" };
}
