import { apkResponse } from "@/lib/apk";
import { hit } from "@/lib/rate-limit";
import { ipFromHeaders } from "@/lib/login-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bitta IP soatiga shuncha marta yuklab oladi (uzilib qayta boshlash va bir ofisdagi bir necha telefon uchun zaxira bilan). */
const PER_IP_HOUR = 10;
/** Butun sayt bo'yicha soatiga — 35 MB × 300 ≈ 10 GB: kanalni bitta botnet to'ldirib qo'ymasin. */
const ALL_HOUR = 300;

/**
 * GET /api/public/app/android — mobil ilovaning APK fayli, ommaviy saytdagi (`/`) tugma uchun.
 *
 * Login talab qilmaydi: Insof ECO — mijozlar ilovasi ham (do'kon, buyurtma, yetkazib berishni
 * kuzatish), sayt mehmoni hali tizimda emas. APK ichida maxfiy narsa yo'q — kirish ilovaning
 * o'zida (telefon + kod). `/api/public` middleware'da ochiq.
 *
 * Fayl 35 MB — cheksiz qayta so'rov trafikni va diskni band qilardi: IP bo'yicha va umumiy chegara
 * (jarayon xotirasida, `lib/rate-limit.ts`). Birinchi qatlam — nginx `limit_req` (docs/deploy/nginx-tenant.conf).
 */
export function GET(req: Request) {
  if (!hit(`apk:ip:${ipFromHeaders(req.headers)}`, PER_IP_HOUR, 3_600_000) || !hit("apk:all", ALL_HOUR, 3_600_000)) {
    return Response.json({ error: "Juda ko'p yuklab olish. Birozdan keyin qayta urinib ko'ring." }, { status: 429, headers: { "Retry-After": "600" } });
  }
  return apkResponse();
}
