"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";

const zInt = z.coerce.number({ message: "raqam bo'lishi kerak" }).int("butun son bo'lsin").min(0).max(2_000_000_000);
const zDay = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "sana noto'g'ri").transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null));

const schema = z.object({
  name: zStr("kampaniya nomi kerak").pipe(z.string().max(120)),
  channel: z.enum(["YANDEX", "GOOGLE", "INSTAGRAM", "TELEGRAM", "OTHER"]),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "FINISHED"]),
  utmCampaign: zOpt.refine((v) => !v || /^[a-z0-9_-]{2,80}$/.test(v), "utm_campaign: faqat kichik lotin harf, raqam, _ va -"),
  budget: zDec(),
  spend: zDec(),
  impressions: zInt,
  clicks: zInt,
  startDate: zDay,
  endDate: zDay,
  note: zOpt,
});

/** Kampaniya: yangi yoki tahrir. Xarajat va kliklar reklama kabinetidan qo'lda kiritiladi. */
export async function saveCampaign(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "ads");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  if (r.data.clicks > r.data.impressions && r.data.impressions > 0) return { error: "Kliklar ko'rsatishlardan ko'p bo'lmaydi" };
  try {
    if (id) {
      const before = await db.adCampaign.findUnique({ where: { id } });
      if (!before) return { error: "Kampaniya topilmadi" };
      const after = await db.adCampaign.update({ where: { id }, data: r.data });
      await audit(db, s.userId, before.status !== after.status ? "STATUS_CHANGE" : "UPDATE", "AdCampaign", id, before, after);
    } else {
      const created = await db.adCampaign.create({ data: r.data });
      await audit(db, s.userId, "CREATE", "AdCampaign", created.id, undefined, created);
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Bu utm_campaign boshqa kampaniyada bor" };
    throw e;
  }
  revalidatePath("/marketing", "layout");
  return { ok: true };
}
