import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { flatName } from "@/lib/excel";
import { toLatin } from "@/lib/translit";

/**
 * Bir xil nomli mijoz bo'lmasin (Otabek, 2026-11-17): yangi mijoz qo'shish (veb karta, zayavka formasi, mobil), nomini
 * o'zgartirish va Realizatsiyadan avtomatik qo'shish shu kalit bilan tekshiriladi. Og'ir importlarsiz — `realization-log`
 * ham ishlatadi (finance bilan aylanma import bo'lmasin).
 */

/**
 * Mijoz nomi kaliti — takrorni aniqlash uchun: kirill → lotin, katta-kichik harf, bo'shliq va tinish belgilarisiz
 * («Кирпичный дом» = «KIRPICHNIY  DOM.» = «Kirpichniy dom»). Bo'sh kalit — tekshirilmaydi.
 */
export const customerNameKey = (s: string) => flatName(toLatin(String(s ?? "").normalize("NFKC")));

export type SameNameCustomer = { id: string; name: string; isActive: boolean; viaAlias: boolean };

/**
 * Shu nomli mijoz — asosiy nomi yoki boshqa nomi (`aliases`) kaliti bir xil; `exceptId` (tahrirdagi karta) va ichki
 * kartalar hisobga olinmaydi. Faol karta nofaoldan oldin. Bir xil nomli ikkinchi mijoz ochilmasin (Otabek, 2026-11-17).
 */
export async function findSameNameCustomer(name: string, exceptId?: string | null, client: Prisma.TransactionClient | typeof db = db): Promise<SameNameCustomer | null> {
  const key = customerNameKey(name);
  if (!key) return null;
  const list = await client.customer.findMany({
    where: { isInternal: false, ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, aliases: true, isActive: true },
  });
  const byName = list.find((c) => customerNameKey(c.name) === key);
  if (byName) return { id: byName.id, name: byName.name, isActive: byName.isActive, viaAlias: false };
  const byAlias = list.find((c) => c.aliases.some((a) => customerNameKey(a) === key));
  return byAlias ? { id: byAlias.id, name: byAlias.name, isActive: byAlias.isActive, viaAlias: true } : null;
}

/** Bir xil nom kalitli mijoz ochish / nomini o'zgartirish navbati (tranzaksiya oxirigacha). */
export async function lockCustomerName(tx: Prisma.TransactionClient, name: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"customer-name:" + customerNameKey(name)}))`;
}

export class NameTaken extends Error {}

/**
 * Foydalanuvchiga xato matni: qaysi karta band qilgan, nofaol bo'lsa — shuni ham. `rename` — mavjud kartaning nomini
 * o'zgartirishda (bitta mijoz ikki karta bo'lib qolgan bo'lsa — kartadagi «Birlashtirish»).
 */
export function sameNameError(c: SameNameCustomer, entered: string, rename = false): string {
  const what = c.viaAlias ? `«${entered}» — «${c.name}» mijozining boshqa nomi` : `«${c.name}» nomli mijoz allaqachon bor`;
  const hint = rename
    ? "bitta mijoz bo'lsa, mijoz kartasidagi «Birlashtirish» bilan qo'shing"
    : `ro'yxatdan o'shani tanlang${c.isActive ? "" : " yoki uni faollashtiring"}`;
  return `${what}${c.isActive ? "" : " (nofaol)"}. Bir xil nomli ikkinchi mijoz bo'lmaydi — ${hint}`;
}
