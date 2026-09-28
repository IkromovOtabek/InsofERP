// Do'kon surati turlari — brauzer komponentlari ham ishlatadi, shuning uchun fs'siz alohida faylda
// (uploads.ts fs/promises import qiladi va "use client" fayldan chaqirilsa build yiqiladi).
export const SHOP_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const SHOP_PHOTO_ACCEPT = Object.keys(SHOP_TYPES).join(",");
export const SHOP_PHOTO_MAX_MB = 5;
