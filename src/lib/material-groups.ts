import { flatName } from "@/lib/excel";
import type { Prisma } from "@/generated/prisma";

/**
 * Xomashyo papkalari bilan ishlash — spravochnik oynasi ham, Excel importi ham shu yerdan foydalanadi
 * (papka nomi bo'yicha topiladi, bo'lmasa yaratiladi).
 */

/** Papka kodi mahsulot papkasidagidek raqamli, xomashyo kodlari bilan urishmasin uchun "X" old qo'shimchasi bilan. */
export async function nextMaterialGroupCode(tx: Prisma.TransactionClient): Promise<string> {
  const groups = await tx.materialGroup.findMany({ select: { code: true } });
  const max = groups
    .map((g) => Number(g.code.replace(/^X/i, "")))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `X${max + 1}`;
}

/**
 * Papka nomi (yoki "Inertlar / Qum" kabi yo'l) → papka id. Topilmasa yaratiladi.
 * `parentId` — qaysi papka ichida izlash kerak (ochiq papka yoki ro'yxat ildizi).
 */
export async function ensureMaterialGroup(tx: Prisma.TransactionClient, path: string, parentId: string | null = null): Promise<string | null> {
  let parent = parentId;
  for (const seg of path.split(/[\/>|\\]|→/).map((x) => x.trim()).filter(Boolean)) {
    const siblings = await tx.materialGroup.findMany({ where: { parentId: parent }, select: { id: true, name: true } });
    const found = siblings.find((g) => flatName(g.name) === flatName(seg));
    if (found) { parent = found.id; continue; }
    const g = await tx.materialGroup.create({ data: { name: seg, parentId: parent, code: await nextMaterialGroupCode(tx) } });
    parent = g.id;
  }
  return parent;
}
