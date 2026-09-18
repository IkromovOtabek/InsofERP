import { db } from "./db";

/** Zavod rekvizitlari — bitta qator, yo'q bo'lsa standart bilan yaratiladi. */
export async function getCompany() {
  return (await db.companySettings.findUnique({ where: { id: "main" } })) ?? (await db.companySettings.create({ data: { id: "main" } }));
}
