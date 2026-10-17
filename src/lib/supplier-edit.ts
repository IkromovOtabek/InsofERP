import { db } from "./db";
import { audit } from "./audit";
import { parseInn } from "./inn";

/**
 * Yetkazuvchi rekvizitlarini tahrirlash (nomi, INN, telefon, manzil, mas'ul shaxs, QQS to'lovchisi) — har o'zgarish auditda.
 * Veb (`suppliers/actions.ts#updateSupplier`) va mobil ilova (`lib/mobile/sklad-extra.ts`) shu yerdan chaqiradi.
 * Ruxsat (stock → "suppliers") va `revalidatePath` — chaqiruvchida.
 * `vatPayer`: null — o'zgarmaydi. Bo'sh matn maydonlari null bo'lib yoziladi.
 */
export type SupplierEditInput = {
  name: string;
  inn: string | null;
  phone: string | null;
  address: string | null;
  contactPerson: string | null;
  vatPayer: boolean | null;
};

export async function updateSupplierRequisites(id: string, input: SupplierEditInput, userId: string): Promise<{ ok: true; note: string } | { error: string }> {
  const cur = await db.supplier.findUnique({ where: { id } });
  if (!cur) return { error: "Yetkazuvchi topilmadi" };
  if (!input.name?.trim()) return { error: "Nomi kerak" };
  const data = { name: input.name, inn: input.inn, phone: input.phone, address: input.address, contactPerson: input.contactPerson, vatPayer: input.vatPayer == null ? cur.vatPayer : input.vatPayer };
  // INN tekshiruvi faqat o'zgartirilganda — eski (noto'g'ri) qiymatli kartaning boshqa maydonlarini saqlash to'silmasin
  if (data.inn !== cur.inn) {
    const inn = parseInn(data.inn);
    if (inn.error !== undefined) return { error: inn.error };
    data.inn = inn.inn;
  }
  if (data.name === cur.name && data.inn === cur.inn && data.phone === cur.phone && data.address === cur.address && data.contactPerson === cur.contactPerson && data.vatPayer === cur.vatPayer) return { ok: true, note: "O'zgarish yo'q" };
  if (data.inn) {
    const dup = await db.supplier.findFirst({ where: { inn: data.inn, id: { not: id } }, select: { name: true } });
    if (dup) return { error: `Bu INN «${dup.name}» da bor` };
  }
  try {
    const after = await db.supplier.update({ where: { id }, data });
    await audit(db, userId, "UPDATE", "Supplier", id, { name: cur.name, inn: cur.inn, phone: cur.phone, address: cur.address, contactPerson: cur.contactPerson, vatPayer: cur.vatPayer }, { name: after.name, inn: after.inn, phone: after.phone, address: after.address, contactPerson: after.contactPerson, vatPayer: after.vatPayer });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan yetkazuvchi bor" };
    throw e;
  }
  return { ok: true, note: "Saqlandi" };
}
