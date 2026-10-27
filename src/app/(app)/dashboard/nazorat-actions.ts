"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { AccessDenied } from "@/lib/access-denied";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { sendControlReport } from "@/lib/nazorat/report";

/** Nazorat sozlamalari va qo'lda yuborish — faqat direktor (hisobot unga keladi, kimga yuborishni u hal qiladi). */
async function director() {
  const s = await requireSession();
  if (s.role !== "DIRECTOR") throw new AccessDenied("Nazorat sozlamasini faqat direktor o'zgartiradi");
  return s;
}

const schema = z.object({
  controlReportEnabled: z.enum(["1", "0"]).transform((v) => v === "1"),
  controlReportHour: z.coerce.number({ message: "Soat raqam bo'lsin" }).int().min(0, "Soat 0–23").max(23, "Soat 0–23"),
  controlNotifyOwners: z.enum(["1", "0"]).transform((v) => v === "1"),
  fuelMaterialId: zOpt,
});

export async function saveNazoratSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await director();
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  if (r.data.fuelMaterialId && !(await db.material.findUnique({ where: { id: r.data.fuelMaterialId }, select: { id: true } }))) return { error: "Xomashyo topilmadi" };
  const sel = { controlReportEnabled: true, controlReportHour: true, controlNotifyOwners: true, fuelMaterialId: true } as const;
  await db.$transaction(async (tx) => {
    const before = await tx.companySettings.findUnique({ where: { id: "main" }, select: sel });
    const after = await tx.companySettings.upsert({ where: { id: "main" }, update: r.data, create: { id: "main", ...r.data }, select: sel });
    await audit(tx, s.userId, "UPDATE", "CompanySettings", "main", before, after);
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

/** «Hozir yuborish» — bugungi hisobotni darhol yuboradi (19:00 dagisi yuborilgan bo'lsa ham qayta). */
export async function sendNazoratNowAction(): Promise<ActionState> {
  await director();
  const r = await sendControlReport({ manual: true });
  revalidatePath("/dashboard");
  if (r.noBot) return { ok: true, note: `Bot ulanmagan — ${r.planned} ta xabar tayyorlandi, lekin yuborilmadi` };
  return { ok: true, note: r.planned ? `${r.sent} / ${r.planned} ta xabar yuborildi` : "Telegram ulangan qabul qiluvchi yo'q — xodimlar «Mening hisobim» da botni ulasin" };
}
