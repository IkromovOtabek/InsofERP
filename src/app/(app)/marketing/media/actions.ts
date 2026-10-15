"use server";

import { unlink } from "node:fs/promises";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { mediaPath } from "@/lib/smm/media";

export async function updateMedia(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const r = parseForm(z.object({ title: zStr("nom kerak").pipe(z.string().max(120)), tags: z.string().trim().max(300).optional() }), fd);
  if ("error" in r) return { error: r.error };
  const tags = [...new Set((r.data.tags ?? "").split(/[,#\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 15);
  const before = await db.smmMedia.findUnique({ where: { id } });
  if (!before) return { error: "Media topilmadi" };
  const after = await db.smmMedia.update({ where: { id }, data: { title: r.data.title, tags } });
  await audit(db, s.userId, "UPDATE", "SmmMedia", id, { title: before.title, tags: before.tags }, { title: after.title, tags: after.tags });
  revalidatePath("/marketing/media");
  return { ok: true };
}

/** Faqat hech bir postga biriktirilmagan fayl o'chiriladi (chiqqan post tarixi buzilmasin) */
export async function deleteMedia(id: string): Promise<ActionState> {
  const s = await requireAction("marketing", "content");
  const m = await db.smmMedia.findUnique({ where: { id }, include: { _count: { select: { contents: true } } } });
  if (!m) return { error: "Media topilmadi" };
  if (m._count.contents > 0) return { error: `Bu fayl ${m._count.contents} ta postda ishlatilgan — avval postdan olib tashlang` };
  try {
    await db.smmMedia.delete({ where: { id } });
  } catch (e) {
    // Tekshiruv va o'chirish orasida postga biriktirilgan (FK Restrict) — xato sahifasi o'rniga tushunarli javob
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") return { error: "Fayl shu orada postga biriktirildi — avval postdan olib tashlang" };
    throw e;
  }
  const file = mediaPath(m.fileName);
  if (file) await unlink(file).catch(() => null);
  await audit(db, s.userId, "DELETE", "SmmMedia", id, { title: m.title, kind: m.kind, size: m.size }, undefined);
  revalidatePath("/marketing/media");
  return { ok: true };
}
