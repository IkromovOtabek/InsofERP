import { db } from "./db";
import type { Prisma } from "@/generated/prisma";

/**
 * Har bir yangi mijozga ajratiladigan standart kredit limiti (so'm) — direktor Sozlamalar → Limitlar'da belgilaydi
 * (`CompanySettings.defaultCreditLimit`). 0 — yangi mijoz qarzga olmaydi, naqd/avans bilan ishlaydi; qarz berish
 * kerak bo'lsa direktor/moliya mijoz kartasida limitni oshiradi. Faqat YANGI mijozga qo'llanadi.
 * Mijoz yaratiladigan har joy (forma, Excel, zayavka/ariza/realizatsiyadan yangi mijoz, mobil) shu yerdan oladi.
 * Ichki "Sklad" kartochkasi (`stock-orders.ts`) bundan mustasno — unga doim 0.
 * Alohida modul: `realization-log.ts` (debitorka hisobiga kiradi) `finance.ts` ni tortmasin — aylanma import bo'lmasin.
 */
export async function defaultCreditLimit(client: Pick<Prisma.TransactionClient, "companySettings"> = db): Promise<number> {
  const s = await client.companySettings.findUnique({ where: { id: "main" }, select: { defaultCreditLimit: true } });
  return s ? Number(s.defaultCreditLimit) : 0;
}
