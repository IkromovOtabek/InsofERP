"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";

const optInt = z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number({ message: "raqam bo'lishi kerak" }).int().min(0).max(10_000_000).nullable());

/** Chastota (Wordstat) va pozitsiyalar (Webmaster / Search Console) — haftalik yozuv. */
export async function savePositions(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAction("marketing", "seo");
  const r = parseForm(z.object({ frequency: optInt, posYandex: optInt, posGoogle: optInt }), fd);
  if ("error" in r) return { error: r.error };
  await db.seoKeyword.update({ where: { id }, data: { ...r.data, checkedAt: new Date() } });
  revalidatePath("/marketing/seo");
  return { ok: true };
}

const create = z.object({
  phrase: zStr("so'rov kerak").pipe(z.string().max(150)),
  cluster: zStr("klaster kerak").pipe(z.string().max(80)),
  lang: z.enum(["ru", "uz"]),
  url: zOpt,
});

export async function addKeyword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "seo");
  const r = parseForm(create, fd);
  if ("error" in r) return { error: r.error };
  try {
    const k = await db.seoKeyword.create({ data: { ...r.data, phrase: r.data.phrase.toLowerCase() } });
    await audit(db, s.userId, "CREATE", "SeoKeyword", k.id, undefined, k);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Bu so'rov allaqachon bor" };
    throw e;
  }
  revalidatePath("/marketing/seo");
  return { ok: true };
}
