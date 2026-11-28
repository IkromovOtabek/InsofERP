"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import type { ActionState } from "@/lib/action";
import { findDuplicates } from "@/lib/crm/clients";

/** «Men olaman»: navbatdagi raqam (shu raqamning barcha ochiq qo'ng'iroqlari) operatorga biriktiriladi. Boshqasi olgan bo'lsa — rad */
export async function takeCallAction(ids: string[]): Promise<ActionState> {
  const s = await requireAction("crm", "calls");
  if (!ids.length) return { error: "Qo'ng'iroq tanlanmagan" };
  const r = await db.crmCall.updateMany({
    where: { id: { in: ids }, direction: "MISSED", handledAt: null, OR: [{ takenById: null }, { takenById: s.userId }] },
    data: { takenById: s.userId, takenAt: new Date() },
  });
  if (r.count === 0) return { error: "Bu qo'ng'iroqni boshqa operator olgan yoki u hal bo'lgan" };
  await audit(db, s.userId, "UPDATE", "CrmCall", ids[0], undefined, { take: ids.length });
  revalidatePath("/crm/callcenter");
  return { ok: true, note: "Sizga biriktirildi" };
}

/** Qo'lda «Hal qilindi» (masalan, raqam xato yoki boshqa kanal orqali gaplashildi) */
export async function handleCallAction(ids: string[]): Promise<ActionState> {
  const s = await requireAction("crm", "calls");
  if (!ids.length) return { error: "Qo'ng'iroq tanlanmagan" };
  const r = await db.crmCall.updateMany({
    where: { id: { in: ids }, direction: "MISSED", handledAt: null },
    data: { handledAt: new Date(), handledById: s.userId },
  });
  if (r.count === 0) return { error: "Qo'ng'iroq allaqachon hal qilingan" };
  await audit(db, s.userId, "STATUS_CHANGE", "CrmCall", ids[0], undefined, { handled: ids.length });
  revalidatePath("/crm/callcenter");
  return { ok: true, note: "Navbatdan olindi" };
}

/** Raqam terish: istalgan raqamga onlinePBX orqali (avval operatorning ichki raqami jiringlaydi) */
export async function dialAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("crm", "calls");
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (!phone) return { error: "Raqam noto'g'ri — masalan 90 123 45 67", field: "phone" };
  const { pbxEnabled, callNow, PbxError } = await import("@/lib/pbx/onlinepbx");
  if (!pbxEnabled()) return { error: "Telefoniya ulanmagan" };
  const me = await db.user.findUnique({ where: { id: s.userId }, select: { pbxExt: true } });
  if (!me?.pbxExt) return { error: "Sizga onlinePBX ichki raqami biriktirilmagan (CRM → Sozlamalar → Telefoniya)" };
  const cust = (await findDuplicates({ phone }))[0];
  try {
    await callNow(me.pbxExt, phone, cust?.name);
    return { ok: true, note: `Telefoningiz (${me.pbxExt}) jiringlaydi — ko'taring, keyin ${cust ? cust.name : "raqam"}ga ulanadi` };
  } catch (e) {
    return { error: e instanceof PbxError ? e.message : "Qo'ng'iroq boshlanmadi" };
  }
}

/** Kiritilgan raqam bazada bormi (terish panelida oldindan ko'rsatish) */
export async function lookupPhoneAction(raw: string): Promise<{ id: string; name: string } | null> {
  await requireAction("crm", "calls");
  const phone = normalizePhone(raw);
  if (!phone) return null;
  const d = (await findDuplicates({ phone }))[0];
  return d ? { id: d.id, name: d.name } : null;
}
