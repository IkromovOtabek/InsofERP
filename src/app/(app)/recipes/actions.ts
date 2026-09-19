"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { num, str } from "@/lib/excel";
import { resolveMaterials } from "@/lib/import-materials";

/** Retsept kiritish huquqi: ishlab chiqarish va sklad (Sklad bo'limidan ham qo'shiladi). */
const RECIPE_ROLES = ["PRODUCTION", "WAREHOUSE", "PROCUREMENT"] as const;

const schema = z.object({
  note: zOpt,
  returnTo: zOpt, // saqlangach qaytish manzili (Sklad bo'limidan kelganda /stock?tab=recipes)
  materialId: z.array(z.string()).min(1, "Kamida bitta xomashyo"),
  qtyPerM3: z.array(z.coerce.number().min(0)),
});

/** Yangi versiya yaratadi; eskisi nofaol bo'ladi, lekin o'chirilmaydi (tarix). */
export async function createRecipeVersion(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...RECIPE_ROLES]);
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
  revalidatePath(`/recipes/${productId}`); revalidatePath("/recipes"); revalidatePath("/stock");
  redirect(r.data.returnTo?.startsWith("/") ? r.data.returnTo : `/recipes/${productId}`);
}

const importSchema = z.object({
  rows: z.string(),
  createMissing: z.string().optional().transform((v) => v === "on"),
});
type ImportRow = { product?: unknown; material?: unknown; qty?: unknown; unit?: unknown };

/**
 * Excel'dan retseptlar: har qator = mahsulot + xomashyo + 1 birlikka miqdor. Bir faylda bir nechta mahsulot bo'lishi mumkin —
 * har biri uchun yangi faol versiya yaratiladi (eskisi arxivga). Mahsulot kodi yoki nomi bo'yicha topiladi.
 */
export async function importRecipesFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...RECIPE_ROLES]);
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  let rows: ImportRow[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  rows = rows.filter((x) => str(x.product) || str(x.material));
  if (!rows.length) return { error: "Faylda qator yo'q" };
  for (const [i, x] of rows.entries()) {
    if (!str(x.product)) return { error: `${i + 1}-qator: mahsulot ko'rsatilmagan` };
    if (!str(x.material)) return { error: `${i + 1}-qator: xomashyo ko'rsatilmagan` };
    const q = num(x.qty); if (!(q > 0)) return { error: `${i + 1}-qator (${str(x.material)}): miqdor 0 dan katta raqam bo'lsin` };
  }

  const products = await db.product.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } });
  const pKey = new Map<string, string>();
  for (const p of products) { pKey.set(p.code.toLowerCase(), p.id); pKey.set(p.name.toLowerCase().trim(), p.id); }
  const unknownProducts = [...new Set(rows.map((x) => str(x.product)).filter((n) => !pKey.get(n.toLowerCase())))];
  if (unknownProducts.length) return { error: `Bunday mahsulot yo'q (Sozlamalar → Beton markalari da yarating): ${unknownProducts.join(", ")}` };

  const count = await db.$transaction(async (tx) => {
    const { result, missing } = await resolveMaterials(tx, rows.map((x) => ({ name: str(x.material), unit: str(x.unit) })), r.data.createMissing);
    if (missing.length) throw new Error(`Bunday xomashyo yo'q: ${missing.join(", ")}. "Yo'q xomashyolarni yaratish" ni belgilang yoki Sozlamalar da qo'shing.`);
    // Mahsulot bo'yicha guruhlash; bir xomashyo takrorlansa miqdorlar qo'shiladi
    const byProduct = new Map<string, Map<string, number>>();
    for (const x of rows) {
      const pid = pKey.get(str(x.product).toLowerCase())!;
      const mid = result.get(str(x.material).toLowerCase().trim())!.id;
      const m = byProduct.get(pid) ?? new Map<string, number>();
      m.set(mid, (m.get(mid) ?? 0) + num(x.qty));
      byProduct.set(pid, m);
    }
    for (const [productId, items] of byProduct) {
      const last = await tx.recipe.findFirst({ where: { productId }, orderBy: { version: "desc" } });
      await tx.recipe.updateMany({ where: { productId, isActive: true }, data: { isActive: false } });
      const rec = await tx.recipe.create({ data: { productId, version: (last?.version ?? 0) + 1, note: "Excel'dan import", items: { create: [...items].map(([materialId, qtyPerM3]) => ({ materialId, qtyPerM3 })) } } });
      await audit(tx, s.userId, "CREATE", "Recipe", rec.id, undefined, { ...rec, items: [...items], via: "excel" });
    }
    return byProduct.size;
  }).catch((e: Error) => ({ error: e.message }));
  if (typeof count === "object") return count;
  revalidatePath("/recipes"); revalidatePath("/stock"); revalidatePath("/settings");
  redirect(`/recipes?imported=${count}`);
}
