import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma";
import { categoryNameTaken, normCat, resetCategoryCache } from "./categories";

type Tx = Prisma.TransactionClient;
type Cat = { id: string; name: string; parentId: string | null };

/**
 * Manba / sub manbani qayta nomlash va o'chirish — Kirim-Chiqim formasidagi qalam / savatcha ham,
 * Moliya → Kategoriyalar sahifasi ham shu qoidada.
 *
 * Kassa yozuvi kategoriyaga NOM orqali bog'langan (`CashTransaction.category` / `subCategory`), shuning uchun
 * nom o'zgarsa yozuvlardagi nom ham yangisiga o'tadi (jurnal va filtrlarda eski nom qolib ketmasin), eski nom esa
 * alias bo'lib qoladi (mobil ilova, Excel importi va eski fayllar uni yozsa ham shu kategoriyaga tushadi).
 */

/** Nom o'zgarganda unga NOM bilan bog'langan yozuvlarni yangi nomga ko'chirish. Qaytaradi: nechta kassa yozuvi ko'chdi. */
export async function moveCategoryRefs(tx: Tx, c: Cat, name: string): Promise<number> {
  if (c.parentId) {
    const m = await tx.cashTransaction.updateMany({ where: { subCategory: c.name }, data: { subCategory: name } });
    return m.count;
  }
  const m = await tx.cashTransaction.updateMany({ where: { category: c.name }, data: { category: name } });
  await tx.recurringPayment.updateMany({ where: { category: c.name }, data: { category: name } });
  await tx.plannedFlow.updateMany({ where: { category: c.name }, data: { category: name } });
  // Byudjet (yil, oy, kategoriya) — unique: o'sha oyda yangi nom bilan qator bo'lsa, eski qator o'z nomida qoladi
  const taken = new Set((await tx.expenseBudget.findMany({ where: { category: name }, select: { year: true, month: true } })).map((b) => `${b.year}-${b.month}`));
  for (const b of await tx.expenseBudget.findMany({ where: { category: c.name }, select: { id: true, year: true, month: true } })) {
    if (!taken.has(`${b.year}-${b.month}`)) await tx.expenseBudget.update({ where: { id: b.id }, data: { category: name } });
  }
  return m.count;
}

export async function renameCashCategory(id: string, raw: string, userId: string, via?: string): Promise<{ id: string; name: string; moved: number } | { error: string }> {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { error: "Nomi kerak" };
  if (name.length > 80) return { error: "Nomi juda uzun" };
  const c = await db.cashCategory.findUnique({ where: { id } });
  if (!c) return { error: "Kategoriya topilmadi — sahifani yangilang" };
  if (name === c.name) return { id: c.id, name, moved: 0 };
  if (c.isSystem) return { error: "Tizim kategoriyasining nomini o'zgartirib bo'lmaydi — kerak bo'lsa Moliya → Kategoriyalarda alias qo'shing" };
  if (await categoryNameTaken(name, c.id)) return { error: "Bunday nom (yoki alias) allaqachon bor" };
  const oldKey = normCat(c.name);
  const aliases = [...new Set([...c.aliases, oldKey])].filter((a) => a !== normCat(name));
  try {
    const moved = await db.$transaction(async (tx) => {
      const u = await tx.cashCategory.update({ where: { id: c.id }, data: { name, aliases } });
      const moved = await moveCategoryRefs(tx, c, name);
      await audit(tx, userId, "UPDATE", "CashCategory", c.id, { name: c.name, aliases: c.aliases }, { name: u.name, aliases: u.aliases, moved, ...(via ? { via } : {}) });
      return moved;
    });
    resetCategoryCache();
    return { id: c.id, name, moved };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { error: "Bunday nom allaqachon bor" };
    throw e;
  }
}

/** Kategoriya nomlari (nomi + aliaslari) bo'yicha kassa yozuvi filtri — katta-kichik harf farqisiz. */
const nameWhere = (field: "category" | "subCategory", names: string[]): Prisma.CashTransactionWhereInput[] =>
  names.map((n) => ({ [field]: { equals: n, mode: "insensitive" } }));

/**
 * O'chirish: hech qayerda ishlatilmagan bo'lsa — butunlay (manba sub manbalari bilan); kassa yozuvi, to'lov rejasi yoki
 * byudjetda ishlatilgan bo'lsa — o'chirilmaydi, nofaol qilinadi: formalarda ko'rinmaydi, eski yozuvlar hisobotda joyida qoladi
 * (Moliya → Kategoriyalarda qayta faollashtiriladi). Tizim kategoriyasi (kod nomiga tayanadi) o'chirilmaydi.
 */
export async function removeCashCategory(id: string, userId: string, via?: string): Promise<{ kind: "deleted" | "archived"; name: string; used: number; subs: number } | { error: string }> {
  const c = await db.cashCategory.findUnique({ where: { id }, include: { children: true } });
  if (!c) return { error: "Kategoriya topilmadi — sahifani yangilang" };
  if (c.isSystem || c.children.some((x) => x.isSystem)) return { error: `«${c.name}» — tizim kategoriyasi, o'chirib bo'lmaydi${c.isSystem ? "" : " (ichida tizim sub manbasi bor)"}` };
  const own = [c.name, ...c.aliases];
  const subNames = c.children.flatMap((x) => [x.name, ...x.aliases]);
  const txWhere: Prisma.CashTransactionWhereInput = c.parentId
    ? { OR: [...nameWhere("subCategory", own), ...nameWhere("category", own)] }
    : { OR: [...nameWhere("category", own), ...nameWhere("subCategory", subNames)] };
  const planNames = c.parentId ? [] : own;
  const [txs, plans, flows, budgets] = await Promise.all([
    db.cashTransaction.count({ where: txWhere }),
    planNames.length ? db.recurringPayment.count({ where: { category: { in: planNames } } }) : 0,
    planNames.length ? db.plannedFlow.count({ where: { category: { in: planNames } } }) : 0,
    planNames.length ? db.expenseBudget.count({ where: { category: { in: planNames } } }) : 0,
  ]);
  const used = txs + plans + flows + budgets;
  if (used === 0) {
    await db.$transaction(async (tx) => {
      for (const x of c.children) {
        await tx.cashCategory.delete({ where: { id: x.id } });
        await audit(tx, userId, "DELETE", "CashCategory", x.id, x, via ? { via } : undefined);
      }
      const { children: _kids, ...self } = c;
      void _kids;
      await tx.cashCategory.delete({ where: { id: c.id } });
      await audit(tx, userId, "DELETE", "CashCategory", c.id, self, via ? { via } : undefined);
    });
    resetCategoryCache();
    return { kind: "deleted", name: c.name, used: 0, subs: c.children.length };
  }
  await db.$transaction(async (tx) => {
    const u = await tx.cashCategory.updateMany({ where: { id: c.id, isActive: true }, data: { isActive: false } });
    if (u.count) await audit(tx, userId, "STATUS_CHANGE", "CashCategory", c.id, { isActive: true }, { isActive: false, used: { txs, plans, flows, budgets }, ...(via ? { via } : {}) });
  });
  resetCategoryCache();
  return { kind: "archived", name: c.name, used, subs: c.children.length };
}

/** Foydalanuvchiga xabar — o'chirildi yoki ro'yxatdan olindi (nega). */
export function removeNote(r: { kind: "deleted" | "archived"; name: string; used: number; subs: number }, top: boolean): string {
  if (r.kind === "deleted") return `«${r.name}» o'chirildi${r.subs ? ` (${r.subs} ta sub manbasi bilan)` : ""}`;
  return `«${r.name}» ${r.used} ta yozuvda ishlatilgan — butunlay o'chirilmadi, ${top ? "manba" : "sub manba"} ro'yxatdan olindi (nofaol). Eski yozuvlar hisobotda joyida; qaytarish — Moliya → Kategoriyalar`;
}
