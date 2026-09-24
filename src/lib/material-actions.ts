"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { codeFromName, flatName } from "@/lib/excel";
import { nextMaterialGroupCode } from "@/lib/material-groups";
import { normalizeUnit, UNIT_FALLBACK } from "@/lib/unit";
import type { Prisma } from "@/generated/prisma";

/**
 * Xomashyo spravochnigi — Sklad, ta'minot va retseptlarda "..." tugmasidan ochiladigan
 * ro'yxat oynasi (mahsulot spravochnigining aynan o'zi, faqat xomashyo uchun).
 * Papka va xomashyo shu oynadan qo'shiladi.
 */
const MATERIAL_ROLES = ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "DIRECTOR"] as const;

/** Xomashyo kodi nomdan yasaladi; band bo'lsa oxiriga raqam qo'shiladi. */
async function freeCode(tx: Prisma.TransactionClient, want: string, name: string): Promise<string> {
  const base = (want || codeFromName(name)).toUpperCase();
  let code = base;
  for (let n = 2; await tx.material.findUnique({ where: { code } }); n++) code = `${base.slice(0, 13)}-${n}`;
  return code;
}

const groupSchema = z.object({ name: zStr("Papka nomi kerak"), parentId: zOpt, code: zOpt });

/** Yangi xomashyo papkasi. `parentId` — ochiq turgan papka. */
export async function createMaterialGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...MATERIAL_ROLES]);
  const r = parseForm(groupSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  try {
    await db.$transaction(async (tx) => {
      const g = await tx.materialGroup.create({ data: { name: d.name, parentId: d.parentId, code: d.code ?? (await nextMaterialGroupCode(tx)) } });
      await audit(tx, s.userId, "CREATE", "MaterialGroup", g.id, undefined, g);
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu kod band" };
    throw e;
  }
  refresh();
  return { ok: true };
}

const materialSchema = z.object({
  name: zStr("Xomashyo nomi kerak"),
  code: zOpt,
  unit: zStr("O'lchov birligi kerak"),
  minStock: z.coerce.number().min(0, "manfiy bo'lmasin").default(0),
  groupId: zOpt,
});

/**
 * Yangi xomashyo — oynadagi "Yangi" tugmasi. Ochiq papka ichiga tushadi.
 * Shu nomli xomashyo bo'lsa dublikat ochilmaydi: mavjudi yangilanadi (papkasi va minimal qoldiq).
 */
export async function createCatalogMaterial(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...MATERIAL_ROLES]);
  const r = parseForm(materialSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const unit = normalizeUnit(d.unit) ?? UNIT_FALLBACK;
  let merged = false;
  await db.$transaction(async (tx) => {
    const all = await tx.material.findMany({ select: { id: true, code: true, name: true } });
    const found = all.find((m) => flatName(m.name) === flatName(d.name))
      ?? (d.code ? all.find((m) => m.code.toUpperCase() === d.code!.toUpperCase()) : undefined);
    if (found) {
      const before = await tx.material.findUniqueOrThrow({ where: { id: found.id } });
      const after = await tx.material.update({
        where: { id: found.id },
        data: { name: d.name, isActive: true, minStock: d.minStock, ...(d.groupId ? { groupId: d.groupId } : {}) },
      });
      await audit(tx, s.userId, "UPDATE", "Material", found.id, before, after);
      merged = true;
      return;
    }
    const m = await tx.material.create({
      data: { code: await freeCode(tx, d.code ?? "", d.name), name: d.name, unit, minStock: d.minStock, groupId: d.groupId },
    });
    await audit(tx, s.userId, "CREATE", "Material", m.id, undefined, m);
  });
  refresh();
  return merged
    ? { ok: true, note: `«${d.name}» ro'yxatda bor edi — yangisi ochilmadi, mavjudi yangilandi.` }
    : { ok: true };
}

/** Xomashyo ro'yxati ko'rinadigan sahifalar. */
function refresh() {
  revalidatePath("/stock");
  revalidatePath("/stock/materials/new");
  revalidatePath("/stock/supply/new");
  revalidatePath("/receipts/new");
  revalidatePath("/recipes");
  revalidatePath("/settings");
}
