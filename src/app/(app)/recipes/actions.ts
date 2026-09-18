"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  note: zOpt,
  materialId: z.array(z.string()).min(1, "Kamida bitta xomashyo"),
  qtyPerM3: z.array(z.coerce.number().min(0)),
});

/** Yangi versiya yaratadi; eskisi nofaol bo'ladi, lekin o'chirilmaydi (tarix). */
export async function createRecipeVersion(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const items = r.data.materialId.map((materialId, i) => ({ materialId, qtyPerM3: r.data.qtyPerM3[i] })).filter((i) => i.materialId && i.qtyPerM3 > 0);
  if (items.length === 0) return { error: "Kamida bitta xomashyo 0 dan katta bo'lsin" };
  if (new Set(items.map((i) => i.materialId)).size !== items.length) return { error: "Bir xomashyo ikki marta kiritilgan" };

  await db.$transaction(async (tx) => {
    const last = await tx.recipe.findFirst({ where: { productId }, orderBy: { version: "desc" } });
    await tx.recipe.updateMany({ where: { productId, isActive: true }, data: { isActive: false } });
    const rec = await tx.recipe.create({
      data: { productId, version: (last?.version ?? 0) + 1, note: r.data.note, items: { create: items } },
    });
    await audit(tx, s.userId, "CREATE", "Recipe", rec.id, undefined, { ...rec, items });
  });
  revalidatePath(`/recipes/${productId}`);
  redirect(`/recipes/${productId}`);
}
