"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { removeShopPhoto, saveShopPhoto, saveShopTemplatePhoto } from "@/lib/uploads";
import { audit } from "@/lib/audit";
import { shopDiff, shopItemSnapshot } from "@/lib/shop-history";


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
  const s = await requireAction("sales", "ecommerce");
  const parsed = parseForm(schema, fd);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
  if (!product) return { error: "Mahsulot topilmadi" };

  // Yuklangan fayl ustun; bo'lmasa tanlangan tayyor shablon (lib/shop-templates.ts)
  const saved = (await saveShopPhoto(productId, fd.get("photo"))) ?? (await saveShopTemplatePhoto(productId, fd.get("template")));
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

  // Tarix: faqat haqiqatan o'zgargan saqlash yoziladi (bo'sh "Saqlash" bosish shovqin qilmaydi)
  const before = shopItemSnapshot(prev);
  const after = { ...data, price: d.price, minQty: d.minQty };
  if (!prev || shopDiff("ShopItem", before, after).length) {
    await audit(db, s.userId, prev ? "UPDATE" : "CREATE", "ShopItem", item.id, before && { product: product.name, ...before }, { product: product.name, ...after });
  }
  revalidatePath("/e-commerce");
  return { ok: true };
}

/** Bitta tugma bilan chiqarish/yashirish — ro'yxatda tez ishlash uchun. */
export async function toggleShopItem(productId: string, on: boolean) {
  const s = await requireAction("sales", "ecommerce");
  const prev = await db.shopItem.findUnique({ where: { productId }, select: { isPublished: true, product: { select: { name: true } } } });
  if (prev?.isPublished === on) return;
  const item = await db.shopItem.upsert({ where: { productId }, create: { productId, isPublished: on }, update: { isPublished: on }, include: { product: { select: { name: true } } } });
  await audit(db, s.userId, "STATUS_CHANGE", "ShopItem", item.id, { product: item.product.name, isPublished: prev?.isPublished ?? false }, { product: item.product.name, isPublished: on });
  revalidatePath("/e-commerce");
}

/** Suratni olib tashlash — ilovada ikonka ko'rinadi. */
export async function deleteShopPhoto(productId: string) {
  const s = await requireAction("sales", "ecommerce");
  const item = await db.shopItem.findUnique({ where: { productId }, select: { id: true, photo: true, product: { select: { name: true } } } });
  if (!item?.photo) return;
  await db.shopItem.update({ where: { productId }, data: { photo: null } });
  await removeShopPhoto(item.photo);
  await audit(db, s.userId, "UPDATE", "ShopItem", item.id, { product: item.product.name, photo: item.photo }, { product: item.product.name, photo: null });
  revalidatePath("/e-commerce");
}

// ───────────────────────── Reklama (ADS) — ilova bosh sahifasi swiper'i ─────────────────────────

const bannerSchema = z.object({
  title: z.string().trim().min(2, "sarlavha kerak").max(80),
  subtitle: zOpt,
  buttonText: zOpt,
  productId: zOpt,
  isActive: z.string().optional().transform((v) => v === "on"),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  startsAt: z.string().trim().optional().transform((v) => (v ? new Date(`${v}T00:00:00`) : null)),
  endsAt: z.string().trim().optional().transform((v) => (v ? new Date(`${v}T23:59:59`) : null)),
});

/** Banner saqlash (id bo'lmasa — yangi). Surat ixtiyoriy: bo'lmasa ilovada brend rangli fon. */
export async function saveBanner(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("sales", "ecommerce");
  const parsed = parseForm(bannerSchema, fd);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) return { error: "Tugash sanasi boshlanishdan oldin" };
  const saved = await saveShopPhoto(`banner-${id ?? "new"}`, fd.get("image"));
  if (saved && "error" in saved) return { error: saved.error };
  const prev = id ? await db.shopBanner.findUnique({ where: { id } }) : null;
  const data = { ...d, ...(saved ? { image: saved.stored } : {}) };
  const b = id ? await db.shopBanner.update({ where: { id }, data }) : await db.shopBanner.create({ data });
  if (saved && prev?.image) await removeShopPhoto(prev.image);
  if (!prev || shopDiff("ShopBanner", prev, data).length) await audit(db, s.userId, prev ? "UPDATE" : "CREATE", "ShopBanner", b.id, prev, data);
  revalidatePath("/e-commerce");
  return { ok: true };
}

export async function toggleBanner(id: string, on: boolean) {
  const s = await requireAction("sales", "ecommerce");
  const b = await db.shopBanner.update({ where: { id }, data: { isActive: on } });
  await audit(db, s.userId, "STATUS_CHANGE", "ShopBanner", id, { title: b.title, isActive: !on }, { title: b.title, isActive: on });
  revalidatePath("/e-commerce");
}

export async function deleteBanner(id: string): Promise<ActionState> {
  const s = await requireAction("sales", "ecommerce");
  const b = await db.shopBanner.findUnique({ where: { id } });
  if (!b) return { error: "Topilmadi" };
  await db.shopBanner.delete({ where: { id } });
  if (b.image) await removeShopPhoto(b.image);
  await audit(db, s.userId, "DELETE", "ShopBanner", id, b, undefined);
  revalidatePath("/e-commerce");
  return { ok: true };
}
