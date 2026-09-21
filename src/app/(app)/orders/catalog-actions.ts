"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import type { Prisma } from "@/generated/prisma";

/**
 * Mahsulot spravochnigi — zayavka ochayotganda "..." tugmasidan ochiladigan tanlagich.
 * Papka va mahsulot shu yerdan qo'shiladi, shuning uchun sotuvchiga ham ruxsat bor
 * (Sozlamalardagi "Beton markalari" avvalgidek faqat direktorda).
 */
const CATALOG_ROLES = ["SALES", "PRODUCTION", "DIRECTOR"] as const;

/** Kod berilmasa — ro'yxatdagi eng katta raqamli koddan keyingisi (1C dagidek). */
async function nextCatalogCode(tx: Prisma.TransactionClient): Promise<string> {
  const [products, groups] = await Promise.all([
    tx.product.findMany({ select: { code: true } }),
    tx.productGroup.findMany({ select: { code: true } }),
  ]);
  const max = [...products, ...groups]
    .map((x) => Number(x.code))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return String(max + 1);
}

const groupSchema = z.object({
  name: zStr("Papka nomi kerak"),
  parentId: zOpt,
  code: zOpt,
});

/** Yangi papka (guruh). `parentId` — ochiq turgan papka. */
export async function createProductGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(groupSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  try {
    await db.$transaction(async (tx) => {
      const g = await tx.productGroup.create({
        data: { name: d.name, parentId: d.parentId, code: d.code ?? (await nextCatalogCode(tx)) },
      });
      await audit(tx, s.userId, "CREATE", "ProductGroup", g.id, undefined, g);
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu kod band" };
    throw e;
  }
  refresh();
  return { ok: true };
}

const productSchema = z.object({
  name: zStr("Mahsulot nomi kerak"),
  code: zOpt,
  kind: zOpt,
  unit: zStr("O'lchov birligi kerak"),
  price: z.coerce.number().min(0, "narx manfiy bo'lmasin").default(0),
  groupId: zOpt,
  note: zOpt,
});

/** Yangi mahsulot — tanlagichdagi "Yangi" tugmasi. Ochiq papka ichiga tushadi. */
export async function createCatalogProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(productSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  try {
    await db.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          name: d.name, kind: d.kind, unit: d.unit, price: d.price, groupId: d.groupId, note: d.note,
          code: (d.code ?? (await nextCatalogCode(tx))).toUpperCase(),
        },
      });
      await audit(tx, s.userId, "CREATE", "Product", p.id, undefined, p);
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu kod bilan mahsulot bor" };
    throw e;
  }
  refresh();
  return { ok: true };
}

function refresh() {
  revalidatePath("/orders/new");
  revalidatePath("/settings");
  revalidatePath("/stock");
  revalidatePath("/recipes");
}
