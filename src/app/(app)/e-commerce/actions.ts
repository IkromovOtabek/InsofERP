"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { removeShopPhoto, saveShopPhoto } from "@/lib/uploads";
import { audit } from "@/lib/audit";

const ROLES = ["SALES", "DIRECTOR"] as const;

const schema = z.object({
  isPublished: z.string().optional().transform((v) => v === "on"),
  title: zOpt,
  description: zOpt,
  badge: zOpt,
  price: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0) { ctx.addIssue({ code: "custom", message: "narx raqam bo'lishi kerak" }); return z.NEVER; }
    return n;
  }),
  minQty: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) { ctx.addIssue({ code: "custom", message: "eng kam hajm 0 dan katta bo'lsin" }); return z.NEVER; }
    return n;
  }),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

/** Vitrina qatori: chiqarish, nom/narx/tavsif, surat. Product'ning o'zi o'zgarmaydi. */
export async function saveShopItem(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...ROLES]);
  const parsed = parseForm(schema, fd);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
  if (!product) return { error: "Mahsulot topilmadi" };

  const saved = await saveShopPhoto(productId, fd.get("photo"));
  if (saved && "error" in saved) return { error: saved.error };

  const prev = await db.shopItem.findUnique({ where: { productId } });
  const data = {
    isPublished: d.isPublished,
    title: d.title,
    description: d.description,
    badge: d.badge,
    price: d.price,
    minQty: d.minQty,
    sortOrder: d.sortOrder,
    ...(saved ? { photo: saved.stored } : {}),
  };
  const item = await db.shopItem.upsert({ where: { productId }, create: { productId, ...data }, update: data });
  if (saved && prev?.photo) await removeShopPhoto(prev.photo);

  await audit(db, s.userId, prev ? "UPDATE" : "CREATE", "ShopItem", item.id, prev, { product: product.name, ...data });
  revalidatePath("/e-commerce");
  return { ok: true };
}

/** Bitta tugma bilan chiqarish/yashirish — ro'yxatda tez ishlash uchun. */
export async function toggleShopItem(productId: string, on: boolean) {
  const s = await requireSession([...ROLES]);
  const item = await db.shopItem.upsert({ where: { productId }, create: { productId, isPublished: on }, update: { isPublished: on } });
  await audit(db, s.userId, "STATUS_CHANGE", "ShopItem", item.id, { isPublished: !on }, { isPublished: on });
  revalidatePath("/e-commerce");
}

/** Suratni olib tashlash — ilovada ikonka ko'rinadi. */
export async function deleteShopPhoto(productId: string) {
  await requireSession([...ROLES]);
  const item = await db.shopItem.findUnique({ where: { productId }, select: { photo: true } });
  if (!item?.photo) return;
  await db.shopItem.update({ where: { productId }, data: { photo: null } });
  await removeShopPhoto(item.photo);
  revalidatePath("/e-commerce");
}
