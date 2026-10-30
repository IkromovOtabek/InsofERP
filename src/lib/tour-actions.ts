"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * Instruksiya kartasidagi «Qayta ko'rsatilmasin»: foydalanuvchi uchun bir umrga (`User.tourHidden`) —
 * keyingi kirishlarda va boshqa qurilmada ham avtomatik chiqmaydi. Tepadagi instruksiya tugmasi ishlayveradi.
 */
export async function hideTourForever(): Promise<void> {
  const s = await getSession();
  if (!s) return;
  await db.user.update({ where: { id: s.userId }, data: { tourHidden: true } });
}
