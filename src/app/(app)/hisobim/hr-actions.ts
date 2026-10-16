"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { cancelHrRequest, createHrRequest, employeeOfUser } from "@/lib/hr/requests";
import { REQUEST_KINDS } from "@/lib/hr/labels";
import { saveMyChecklist } from "@/lib/hr/checklists";
import type { HrRequestKind } from "@/generated/prisma";

/* Xodimning o'z arizalari ("Mening hisobim") — har qanday rol, faqat o'z kartasi nomidan. */

export async function sendMyRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession();
  const emp = await employeeOfUser(s.userId);
  if (!emp || !emp.isActive) return { error: "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling" };
  const kind = String(fd.get("kind") ?? "") as HrRequestKind;
  if (!REQUEST_KINDS.includes(kind)) return { error: "Ariza turini tanlang" };
  const str = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
  const amount = str("amount");
  const r = await createHrRequest({
    employeeId: emp.id, kind, dateFrom: str("dateFrom"), dateTo: str("dateTo"),
    amount: amount ? Number(amount.replace(/\s/g, "")) : null, reason: str("reason"), clientToken: str("clientToken"),
  }, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/hisobim"); revalidatePath("/otdel-kadr");
  return { ok: true, note: r.existed ? `${r.docNo} allaqachon yuborilgan` : r.note };
}

export async function cancelMyRequest(id: string): Promise<ActionState> {
  const s = await requireSession();
  const r = await cancelHrRequest(id, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/hisobim"); revalidatePath("/otdel-kadr");
  return { ok: true, note: r.note };
}

/** Bugungi cheklistni belgilash: `item` — belgilangan bandlar kalitlari (to'liq ro'yxat). */
export async function saveMyChecklistAction(templateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession();
  const emp = await employeeOfUser(s.userId);
  if (!emp || !emp.isActive) return { error: "Loginingiz xodim kartasiga bog'lanmagan" };
  const r = await saveMyChecklist(emp, templateId, fd.getAll("item").map(String), s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/hisobim"); revalidatePath("/otdel-kadr");
  return { ok: true, note: r.note };
}
