import { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";

/**
 * «Кому» — Sklad → «Расход» oluvchilari (shafyorlar, stalbachilar, svarchiklar, 1-brigada …).
 * Brigadalar bu ro'yxatda emas: ularga berish brigada qoldig'i orqali (BRIGADE_ISSUE).
 * Oluvchi o'chirilmaydi — faqat nofaol qilinadi (eski Расход qatorlari nomi bilan qoladi).
 * Ruxsat (`stock` → `issue`) va `revalidatePath` — chaqiruvchida. Xato matnlari ruscha (ekran tili).
 */

export type RecipientOption = { id: string; name: string };
export type RecipientRow = { id: string; name: string; note: string | null; sortOrder: number; isActive: boolean; moves: number };

const ORDER = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

/** Faol oluvchilar — Расход formasidagi «Кому» ro'yxati (tartib: sortOrder, nom). */
export async function activeRecipients(): Promise<RecipientOption[]> {
  return db.stockRecipient.findMany({ where: { isActive: true }, orderBy: ORDER, select: { id: true, name: true } });
}

/** Barcha oluvchilar (nofaollari ham) va har biriga yozilgan Расход qatorlari soni — boshqaruv ro'yxati uchun. */
export async function recipientList(): Promise<RecipientRow[]> {
  const list = await db.stockRecipient.findMany({
    orderBy: [{ isActive: "desc" }, ...ORDER],
    select: { id: true, name: true, note: true, sortOrder: true, isActive: true, _count: { select: { stockMoves: true } } },
  });
  return list.map(({ _count, ...r }) => ({ ...r, moves: _count.stockMoves }));
}

/** Nom: chetdagi va qo'sh bo'shliqlar olib tashlanadi («  1-brigada » → «1-brigada»). */
const cleanName = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Yangi oluvchi yoki mavjudini qayta nomlash. Nom takrorlanmaydi, katta-kichik harf farqi hisobga olinmaydi:
 * «Shafyorlar» bor bo'lsa «shafyorlar» qo'shilmaydi (nofaol bo'lsa ham — uni qayta yoqish kerak).
 */
export async function upsertRecipient(
  input: { id?: string | null; name: string; note?: string | null; sortOrder?: number | null },
  userId: string,
): Promise<{ id: string; created: boolean } | { error: string }> {
  const name = cleanName(input.name ?? "");
  if (!name) return { error: "Введите имя получателя" };
  if (name.length > 80) return { error: "Имя получателя слишком длинное (до 80 символов)" };
  const note = input.note?.trim() ? input.note.trim().slice(0, 200) : null;
  const sortOrder = input.sortOrder != null && Number.isFinite(input.sortOrder) ? Math.max(0, Math.min(9999, Math.trunc(input.sortOrder))) : null;

  const dup = await db.stockRecipient.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(input.id ? { NOT: { id: input.id } } : {}) },
    select: { name: true, isActive: true },
  });
  if (dup) return { error: `Получатель «${dup.name}» уже есть${dup.isActive ? "" : " (неактивен — включите его в списке)"}` };

  try {
    if (input.id) {
      const before = await db.stockRecipient.findUnique({ where: { id: input.id } });
      if (!before) return { error: "Получатель не найден — обновите страницу" };
      const after = await db.$transaction(async (tx) => {
        const r = await tx.stockRecipient.update({
          where: { id: before.id },
          data: { name, note, ...(sortOrder != null ? { sortOrder } : {}) },
        });
        await audit(tx, userId, "UPDATE", "StockRecipient", r.id, before, r);
        return r;
      });
      return { id: after.id, created: false };
    }
    const created = await db.$transaction(async (tx) => {
      // Yangi oluvchi ro'yxat oxiriga tushadi (sortOrder berilmagan bo'lsa)
      const last = sortOrder == null ? await tx.stockRecipient.aggregate({ _max: { sortOrder: true } }) : null;
      const r = await tx.stockRecipient.create({ data: { name, note, sortOrder: sortOrder ?? (last?._max.sortOrder ?? 0) + 10 } });
      await audit(tx, userId, "CREATE", "StockRecipient", r.id, undefined, r);
      return r;
    });
    return { id: created.id, created: true };
  } catch (e) {
    // Bir vaqtda ikki xil oynadan bir xil nom — unique indeks ushlaydi
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: `Получатель «${name}» уже есть` };
    throw e;
  }
}

/** Faol / nofaol qilish (o'chirish yo'q). Nofaol oluvchi «Кому» ro'yxatida chiqmaydi, eski qatorlarda nomi qoladi. */
export async function setRecipientActive(id: string, isActive: boolean, userId: string): Promise<{ ok: true; name: string } | { error: string }> {
  const r = await db.$transaction(async (tx) => {
    const cur = await tx.stockRecipient.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
    if (!cur) return null;
    if (cur.isActive === isActive) return cur;
    const u = await tx.stockRecipient.updateMany({ where: { id, isActive: !isActive }, data: { isActive } });
    if (u.count) await audit(tx, userId, "STATUS_CHANGE", "StockRecipient", id, { isActive: cur.isActive }, { isActive });
    return cur;
  });
  if (!r) return { error: "Получатель не найден — обновите страницу" };
  return { ok: true, name: r.name };
}
