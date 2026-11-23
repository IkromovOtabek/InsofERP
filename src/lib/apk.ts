import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";

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

/** Insof ECO'ning App Store sahifasi (ASC app id 6819408076, O'zbekiston do'koni). */
export const IOS_APP_STORE_URL = "https://apps.apple.com/uz/app/insof-eco/id6819408076";

/**
 * iPhone ilovasi havolasi — doim App Store sahifasi.
 *
 * iOS ilovani fayldan o'rnatmaydi (APK kabi serverga qo'yib bo'lmaydi). Ilova App Store'ga chiqqan, shuning uchun
 * TestFlight havolasi endi ishlatilmaydi: serverda eski `IOS_APP_URL` (testflight…) qolgan bo'lsa ham e'tiborsiz qoladi.
 * `IOS_APP_URL` faqat boshqa App Store manzili (`https://apps.apple.com/…`) bilan almashtirish uchun.
 */
export function iosAppUrl(): string {
  const raw = process.env.IOS_APP_URL?.trim();
  if (!raw) return IOS_APP_STORE_URL;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "apps.apple.com" ? u.toString() : IOS_APP_STORE_URL;
  } catch {
    return IOS_APP_STORE_URL;
  }
}

/**
 * APK faylini yuklab olish javobi — `/api/app/android` (xodim) va `/api/public/app/android` (sayt) uchun umumiy.
 * Fayl oqim bilan uzatiladi: 35 MB ni xotiraga to'liq yuklash serverni band qilardi.
 */
export async function apkResponse(): Promise<Response> {
  const info = await apkInfo();
  if (!info.exists) {
    return Response.json({ error: "Ilova fayli serverga hali yuklanmagan" }, { status: 404 });
  }
  const name = `insof-eco-${info.updatedAt.toISOString().slice(0, 10)}.apk`;
  const stream = Readable.toWeb(createReadStream(APK_PATH)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** 36700160 → "35 MB" */
export const apkSize = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;
