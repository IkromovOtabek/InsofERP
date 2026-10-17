"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { num, str } from "@/lib/excel";
import { resolveMaterials } from "@/lib/import-materials";
import { toMaterialUnit } from "@/lib/unit";
import { createRecipeVersion as saveRecipeVersion, lockRecipe } from "@/lib/recipes";

// Retsept kiritish huquqi: production → "recipe" amali (lib/permissions.ts) — ishlab chiqarish va sklad, direktor bergan xodim

const schema = z.object({
  note: zOpt,
  returnTo: zOpt, // saqlangach qaytish manzili (Sklad bo'limidan kelganda /stock?tab=recipes)
  // Har qator xomashyo YOKI boshqa mahsulot bo'lishi mumkin: kind — "material"/"product", refId — o'sha id
  kind: z.array(z.string()),
  refId: z.array(z.string()),
  qtyPerM3: z.array(z.coerce.number({ message: "Miqdorni raqam bilan yozing" }).min(0, "Miqdor manfiy bo'lmasin").max(1_000_000, "Miqdor juda katta")),
});

/** Yangi versiya yaratadi; eskisi nofaol bo'ladi, lekin o'chirilmaydi (tarix). Qoida `lib/recipes.ts` da — mobil ilova ham shuni chaqiradi. */
export async function createRecipeVersion(productId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("production", "recipe");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const rows = r.data.kind.map((kind, i) => ({ kind, refId: r.data.refId[i], qtyPerM3: r.data.qtyPerM3[i] }));
  const res = await saveRecipeVersion(productId, rows, r.data.note, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath(`/recipes/${productId}`); revalidatePath("/recipes"); revalidatePath("/stock"); revalidatePath("/production");
  // Faqat ichki yo'l: "//evil.uz" yoki "/\evil.uz" brauzerda tashqi saytga olib chiqadi
  const back = r.data.returnTo;
  redirect(back && /^\/(?![\/\\])/.test(back) ? back : `/recipes/${productId}`);
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
  const s = await requireAction("production", "recipe");
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
      const mat = result.get(str(x.material).toLowerCase().trim())!;
      // Fayldagi birlik (masalan "t") spravochnikdagidan ("kg") farq qilsa — norma o'giriladi:
      // aks holda 0.35 t sement 0.35 kg bo'lib, sarf va imkoniyat 1000 barobar xato chiqardi
      const conv = toMaterialUnit(num(x.qty), 0, x.unit, mat.unit);
      if (!conv) throw new Error(`"${mat.name}": faylda birlik «${str(x.unit)}», spravochnikda «${mat.unit}» — o'girib bo'lmaydi`);
      const m = byProduct.get(pid) ?? new Map<string, number>();
      m.set(mat.id, (m.get(mat.id) ?? 0) + conv.qty);
      byProduct.set(pid, m);
    }
    for (const [productId, items] of byProduct) {
      await lockRecipe(tx, productId);
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
