import { db } from "./db";
import { audit } from "./audit";

/** Zavod rekvizitlari — bitta qator, yo'q bo'lsa standart bilan yaratiladi. */
export async function getCompany() {
  return (await db.companySettings.findUnique({ where: { id: "main" } })) ?? (await db.companySettings.create({ data: { id: "main" } }));
}

/**
 * Kunlik zayavka limiti (direktor sozlamasi): bir yetkazish kuniga tasdiqlanadigan SALE zayavkalarning
 * eng ko'p hajmi (m³) va soni. `null`/0 — cheklov yo'q. Qabul qilishda `lib/orders.ts` tekshiradi.
 * Ruxsat (DIRECTOR) va audit userId — chaqiruvchida tekshiriladi; shu yerda yozuv + audit jurnali.
 */
export async function saveDailyOrderLimits(userId: string, maxM3: number | null, maxCount: number | null) {
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { dailyOrderMaxM3: true, dailyOrderMaxCount: true } });
  await db.companySettings.upsert({
    where: { id: "main" },
    update: { dailyOrderMaxM3: maxM3, dailyOrderMaxCount: maxCount },
    create: { id: "main", dailyOrderMaxM3: maxM3, dailyOrderMaxCount: maxCount },
  });
  await audit(db, userId, "UPDATE", "CompanySettings", "main",
    before ? { dailyOrderMaxM3: before.dailyOrderMaxM3 ? Number(before.dailyOrderMaxM3) : null, dailyOrderMaxCount: before.dailyOrderMaxCount } : undefined,
    { dailyOrderMaxM3: maxM3, dailyOrderMaxCount: maxCount });
}
