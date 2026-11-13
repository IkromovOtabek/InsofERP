"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAction, requireModuleWrite } from "@/lib/auth";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { MECH_ROLES, approveMechanicRequest, cancelMechanicRequest, payMechanicRequest, rejectMechanicRequest } from "@/lib/mechanic-requests";

/**
 * Mexanik so'rovi amallari (veb). Qoida `lib/mechanic-requests.ts` da — mobil ilova ham shuni chaqiradi.
 * Tasdiq/rad — ish boshqaruvchi, pul — kassa, bekor va tahrir (tasdiqdan oldin) — so'rov egasi (mexanik);
 * direktor `requireModuleWrite` dan har doim o'tadi.
 */
function refresh(id: string) {
  revalidatePath("/mexanik-sorovlar"); revalidatePath(`/mexanik-sorovlar/${id}`);
  revalidatePath("/cashflow"); revalidatePath("/dashboard"); revalidatePath("/logistika/xarajatlar"); revalidatePath("/logistika/moliya");
}

export async function approve(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.decide);
  const r = await approveMechanicRequest(id, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

const RejectSchema = z.object({ reason: zStr("Rad etish sababini yozing") });
export async function reject(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.decide);
  const p = parseForm(RejectSchema, fd);
  if ("error" in p) return { error: p.error };
  const r = await rejectMechanicRequest(id, p.data.reason, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

const PaySchema = z.object({ cashAccountId: zStr("Kassa / hisob tanlanmagan"), note: zOpt });
export async function pay(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.pay);
  const p = parseForm(PaySchema, fd);
  if ("error" in p) return { error: p.error };
  const r = await payMechanicRequest(id, { cashAccountId: p.data.cashAccountId, note: p.data.note }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

/** Logistika so'rovi (transport, reys haqi) — ish boshqaruvchi beradi: zavod kassa/banki yoki logistika hisobidan (`L:<id>`). */
export async function payLogi(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "fin_pay");
  const p = parseForm(PaySchema, fd);
  if ("error" in p) return { error: p.error };
  const r = await payMechanicRequest(id, { cashAccountId: p.data.cashAccountId, note: p.data.note }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

const EditSchema = z.object({
  amount: zDec(0),
  note: zStr("Muammo tavsifini yozing — nima buzildi, nima kerak").pipe(z.string().min(3, "Muammo tavsifini yozing — nima buzildi, nima kerak")),
});

/**
 * So'rov egasi summa va tavsifni tuzatadi — faqat tasdiqdan oldin (NEW). Shartli `updateMany` (holat + egasi): tasdiq
 * bilan bir vaqtda kelsa ikkinchisi «boshqa joyda o'zgartirildi» deb to'xtaydi. Eski va yangi qiymat AuditLog'da.
 */
export async function update(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.create);
  const p = parseForm(EditSchema, fd);
  if ("error" in p) return { error: p.error, field: p.field };
  const amount = Math.round(p.data.amount * 100) / 100;
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin", field: "amount" };
  const note = p.data.note.slice(0, 500);
  const r = await db.mechanicRequest.findUnique({ where: { id }, select: { docNo: true, status: true, createdById: true, amount: true, note: true } });
  if (!r) return { error: "So'rov topilmadi" };
  if (r.createdById !== s.userId) return { error: "Faqat o'z so'rovingizni tahrirlay olasiz" };
  if (r.status !== "NEW") return { error: "So'rov tasdiqlangan yoki yopilgan — tahrirlab bo'lmaydi, sahifani yangilang" };
  if (Number(r.amount) === amount && (r.note ?? "") === note) return { ok: true, note: "O'zgarish yo'q" };
  const saved = await db.$transaction(async (tx) => {
    const u = await tx.mechanicRequest.updateMany({ where: { id, status: "NEW", createdById: s.userId }, data: { amount, note } });
    if (u.count !== 1) return false;
    await audit(tx, s.userId, "UPDATE", "MechanicRequest", id, { amount: Number(r.amount), note: r.note }, { amount, note, docNo: r.docNo });
    return true;
  });
  if (!saved) return { error: "So'rov boshqa joyda o'zgartirildi — sahifani yangilang" };
  refresh(id);
  return { ok: true, note: "So'rov yangilandi" };
}

export async function cancel(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("mexanik", MECH_ROLES.create);
  // Egalik va holat `cancelMechanicRequest` ichida: faqat o'z so'rovi, faqat tasdiqdan oldin
  const r = await cancelMechanicRequest(id, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}
