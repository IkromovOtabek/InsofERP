import { db } from "./db";
import { audit } from "./audit";

/** Zavod rekvizitlari — bitta qator, yo'q bo'lsa standart bilan yaratiladi. */
export async function getCompany() {
  return (await db.companySettings.findUnique({ where: { id: "main" } })) ?? (await db.companySettings.create({ data: { id: "main" } }));
}

/**
 * Kunlik zayavka limiti va quvvat (direktor sozlamasi, Sozlamalar → Limitlar):
 *  · `capacityM3` — kunlik ishlab chiqarish quvvati (yumshoq): Zayavkalar taqvimi shu chegaraga qarab rang beradi;
 *  · `maxM3`/`maxCount` — bir yetkazish kuniga tasdiqlanadigan SALE zayavkalarning eng ko'p hajmi (m³) va soni
 *    (qattiq): qabul qilish va blokdan chiqarishda `lib/orders.ts` tekshiradi.
 * `null` — cheklov yo'q (quvvat uchun — taqvim standart 200 m³ ni oladi).
 * Ruxsat (DIRECTOR) chaqiruvchida tekshiriladi; shu yerda yozuv + audit jurnali (faqat o'zgargan maydonlar).
 */
export async function saveDailyOrderLimits(userId: string, v: { capacityM3: number | null; maxM3: number | null; maxCount: number | null }) {
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true, dailyOrderMaxM3: true, dailyOrderMaxCount: true } });
  const data = { dailyCapacityM3: v.capacityM3, dailyOrderMaxM3: v.maxM3, dailyOrderMaxCount: v.maxCount };
  const num = (d: unknown) => (d == null ? null : Number(d));
  const was = { dailyCapacityM3: num(before?.dailyCapacityM3), dailyOrderMaxM3: num(before?.dailyOrderMaxM3), dailyOrderMaxCount: before?.dailyOrderMaxCount ?? null };
  if (before && was.dailyCapacityM3 === data.dailyCapacityM3 && was.dailyOrderMaxM3 === data.dailyOrderMaxM3 && was.dailyOrderMaxCount === data.dailyOrderMaxCount) return false;
  await db.companySettings.upsert({ where: { id: "main" }, update: data, create: { id: "main", ...data } });
  await audit(db, userId, "UPDATE", "CompanySettings", "main", before ? was : undefined, data);
  return true;
}
