"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

const zInt = z.coerce.number({ message: "raqam bo'lishi kerak" }).int("butun son bo'lsin").min(0).max(1_000_000_000);

const schema = z.object({
  title: zStr("sarlavha kerak").pipe(z.string().max(160)),
  type: z.enum(["REELS", "POST", "STORIES", "ARTICLE"]),
  rubric: zOpt,
  status: z.enum(["IDEA", "SCRIPT", "FILMED", "EDITING", "PUBLISHED", "CANCELLED"]),
  publishDate: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "sana noto'g'ri"),
  hook: zOpt,
  script: z.string().trim().max(20_000).optional().transform((v) => (v ? v : null)),
  caption: zOpt,
  url: zOpt.refine((v) => !v || /^https?:\/\//.test(v), "havola http(s):// bilan boshlansin"),
  views: zInt,
  likes: zInt,
  saves: zInt,
  leads: zInt,
});

/** Kontentni saqlash (yangi yoki mavjud). O'chirilmaydi — kerak bo'lmasa holati «Bekor». */
export async function saveContent(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const { publishDate, ...d } = r.data;
  const data = { ...d, publishDate: publishDate ? new Date(`${publishDate}T00:00:00Z`) : null };

  if (id) {
    const before = await db.marketingContent.findUnique({ where: { id } });
    if (!before) return { error: "Kontent topilmadi" };
    const after = await db.marketingContent.update({ where: { id }, data });
    await audit(db, s.userId, before.status !== after.status ? "STATUS_CHANGE" : "UPDATE", "MarketingContent", id, before, after);
  } else {
    const created = await db.marketingContent.create({ data: { ...data, createdBy: s.fullName } });
    await audit(db, s.userId, "CREATE", "MarketingContent", created.id, undefined, created);
  }
  revalidatePath("/marketing", "layout");
  redirect("/marketing/kontent");
}
