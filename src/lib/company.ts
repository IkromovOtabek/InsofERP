import { db } from "./db";
import { audit } from "./audit";

/** Zavod rekvizitlari — bitta qator, yo'q bo'lsa standart bilan yaratiladi. */
export async function getCompany() {
  return (await db.companySettings.findUnique({ where: { id: "main" } })) ?? (await db.companySettings.create({ data: { id: "main" } }));
}

/**
 * Kunlik zayavka limiti va quvvat (direktor sozlamasi: Sozlamalar → Limitlar yoki Zayavkalar taqvimi):
 *  · `capacityM3` / `capacityPcs` — kunlik ishlab chiqarish quvvati, m³ va dona (yumshoq): Zayavkalar taqvimi
 *    shu chegaraga qarab rang beradi;
 *  · `maxM3`/`maxCount` — bir yetkazish kuniga tasdiqlanadigan SALE zayavkalarning eng ko'p hajmi (m³) va soni
 *    (qattiq): qabul qilish va blokdan chiqarishda `lib/orders.ts` tekshiradi.
 * `null` — cheklov yo'q (m³ quvvati uchun — taqvim standart 200 m³ ni oladi). Berilmagan kalit o'zgarmaydi
 * (taqvim faqat quvvatni yuboradi). Ruxsat (DIRECTOR) chaqiruvchida tekshiriladi; shu yerda yozuv + audit
 * jurnali (faqat o'zgargan maydonlar).
 */
export async function saveDailyOrderLimits(userId: string, v: { capacityM3?: number | null; capacityPcs?: number | null; maxM3?: number | null; maxCount?: number | null }) {
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true, dailyCapacityPcs: true, dailyOrderMaxM3: true, dailyOrderMaxCount: true } });
  const num = (d: unknown) => (d == null ? null : Number(d));
  const was = {
    dailyCapacityM3: num(before?.dailyCapacityM3), dailyCapacityPcs: before?.dailyCapacityPcs ?? null,
    dailyOrderMaxM3: num(before?.dailyOrderMaxM3), dailyOrderMaxCount: before?.dailyOrderMaxCount ?? null,
  };
  const next = {
    dailyCapacityM3: v.capacityM3, dailyCapacityPcs: v.capacityPcs, dailyOrderMaxM3: v.maxM3, dailyOrderMaxCount: v.maxCount,
  };
  const data = Object.fromEntries(Object.entries(next).filter(([k, x]) => x !== undefined && (!before || was[k as keyof typeof was] !== x))) as Partial<Record<keyof typeof was, number | null>>;
  if (Object.keys(data).length === 0) return false;
  await db.companySettings.upsert({ where: { id: "main" }, update: data, create: { id: "main", ...data } });
  const old = Object.fromEntries(Object.keys(data).map((k) => [k, was[k as keyof typeof was]]));
  await audit(db, userId, "UPDATE", "CompanySettings", "main", before ? old : undefined, data);
  return true;
}
