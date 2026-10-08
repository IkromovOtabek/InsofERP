import { apkResponse } from "@/lib/apk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/public/app/android — mobil ilovaning APK fayli, ommaviy saytdagi (`/`) tugma uchun.
 *
 * Login talab qilmaydi: Insof ECO — mijozlar ilovasi ham (do'kon, buyurtma, yetkazib berishni
 * kuzatish), sayt mehmoni hali tizimda emas. APK ichida maxfiy narsa yo'q — kirish ilovaning
 * o'zida (telefon + kod). `/api/public` middleware'da ochiq.
 */
export function GET() {
  return apkResponse();
}
