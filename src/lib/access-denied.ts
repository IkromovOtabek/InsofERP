/**
 * Ruxsat yo'q (403) yoki sessiya tugagan (401) — server action / sahifa / route guard'lari shuni tashlaydi.
 *
 * Ilgari oddiy `Error("FORBIDDEN")` tashlanardi: production'da u 500 + "digest" kodi bo'lib, foydalanuvchi
 * "Tizimda kutilmagan xatolik" sahifasini ko'rardi (masalan, kassir zayavka ochishga, sklad kirimni storno
 * qilishga urinsa), server jurnaliga esa xato bo'lib tushardi. Endi `digest` Next.js'ning `forbidden()` /
 * `unauthorized()` belgisi bilan bir xil — Next uni 403/401 deb taniydi va `(app)/forbidden.tsx` /
 * `(app)/unauthorized.tsx` ni ko'rsatadi (next.config → `experimental.authInterrupts`).
 *
 * `message` o'zbekcha qoladi: xatoni ushlab `{ error: e.message }` qaytaradigan joylar uni o'zicha ko'rsatadi.
 */
export class AccessDenied extends Error {
  readonly digest: string;
  readonly status: 401 | 403;
  constructor(message = "Bu amal uchun sizda ruxsat yo'q — direktordan ruxsat so'rang", status: 401 | 403 = 403) {
    super(message);
    this.name = "AccessDenied";
    this.status = status;
    this.digest = `NEXT_HTTP_ERROR_FALLBACK;${status}`;
  }
}

/** Sessiya yo'q / eskirgan. */
export const notSignedIn = () => new AccessDenied("Sessiya tugagan — qaytadan kiring", 401);

/** Xato ruxsat xatosimi (action ichida ushlab, `{ error }` qilib qaytarish uchun). */
export function isAccessDenied(e: unknown): e is AccessDenied {
  return e instanceof AccessDenied || (typeof e === "object" && e !== null && /^NEXT_HTTP_ERROR_FALLBACK;40[13]$/.test(String((e as { digest?: unknown }).digest)));
}
