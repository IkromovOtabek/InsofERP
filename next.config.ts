import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy. Next inline skriptlari (tema, hydration) va Tailwind uchun 'unsafe-inline' kerak;
 * dev'da HMR uchun 'unsafe-eval' va ws:. Asosiy foydasi: begona sahifaga joylash (frame-ancestors),
 * plugin/obyekt (object-src), <base> almashtirish va formani chetga yuborish (form-action) yopiladi.
 * Tashqi manbalar: Leaflet (cdnjs), xarita plitkalari (Yandex/OSM — img), Google shriftlari next/font orqali o'zimizda.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} https://cdnjs.cloudflare.com`,
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  `connect-src 'self' https:${isProd ? "" : " ws: wss:"}`,
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  // HTTPS majburiy (brauzer 1 yil eslab qoladi); HTTP javobda brauzer e'tiborsiz qoldiradi
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Yuklangan faylni brauzer boshqa turga "taxmin" qilmaydi (rasm sifatida berilgan narsa skript bo'lib ketmaydi)
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Sahifani begona sayt iframe'iga joylab clickjacking qilib bo'lmaydi
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Tashqi havolaga o'tganda ERP'dagi to'liq URL (id'lar) oshkor bo'lmaydi
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Kamera — nakladnoy skaneri, geolokatsiya — xarita; qolgani yopiq
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // "X-Powered-By: Next.js" — texnologiyani oshkor qilmaymiz
  experimental: { serverActions: { bodySizeLimit: "16mb" } }, // imzolangan shartnoma fayli (15 MB gacha) server action orqali yuklanadi
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
