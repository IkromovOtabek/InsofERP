import path from "path";
import { stat } from "fs/promises";

/**
 * Android ilovasining o'rnatish fayli (APK).
 *
 * Git'ga qo'shilmaydi — 35 MB lik binar har versiyada repo hajmini oshirardi va
 * yangilash uchun qayta deploy talab qilardi. O'rniga fayl serverdagi `uploads/app/`
 * papkasida turadi: yangi versiyani nusxalab qo'yish kifoya, deploy shart emas.
 *
 * Yo'lni `APK_PATH` bilan boshqa joyga o'zgartirish mumkin.
 */
export const APK_PATH = process.env.APK_PATH || path.join(process.cwd(), "uploads", "app", "insof-eco.apk");

export type ApkInfo = { exists: true; size: number; updatedAt: Date } | { exists: false };

/** Fayl bormi, qanchalik katta va qachon yangilangan — tugmani ko'rsatish uchun. */
export async function apkInfo(): Promise<ApkInfo> {
  try {
    const s = await stat(APK_PATH);
    if (!s.isFile()) return { exists: false };
    return { exists: true, size: s.size, updatedAt: s.mtime };
  } catch {
    return { exists: false };
  }
}

/** 36700160 → "35 MB" */
export const apkSize = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
