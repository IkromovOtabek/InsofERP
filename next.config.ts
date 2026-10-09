import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy. Next inline skriptlari (tema, hydration) va Tailwind uchun 'unsafe-inline' kerak;
 * dev'da HMR uchun 'unsafe-eval' va ws:. Asosiy foydasi: begona sahifaga joylash (frame-ancestors),
 * plugin/obyekt (object-src), <base> almashtirish va formani chetga yuborish (form-action) yopiladi.
 * Tashqi manbalar: Leaflet (cdnjs), xarita plitkalari (Yandex/OSM — img), Google shriftlari next/font orqali o'zimizda.
 */
const cspWith = (formAction: string) => [
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
  `form-action ${formAction}`,
].join("; ");
const CSP = cspWith("'self'");
// IT panel (/superadmin): «Kirish (IT)» tugmasi SSO tokenni korxona domeniga POST forma bilan yuboradi
// (`/api/control/sso`). `form-action 'self'` buni brauzerda bloklardi — faqat panel sahifalarida korxona
// domenlariga (https) forma yuborishga ruxsat. Korxona sahifalarida qoida o'zgarmaydi.
const CSP_CONTROL = cspWith("'self' https:");

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
  // Serverdagi Face ID vektori (`lib/face-descriptor.ts`): bundle qilinmaydi — tfjs WASM fayli va face-api modellari
  // node_modules'dagi joyidan o'qiladi
  serverExternalPackages: ["@vladmandic/face-api", "@tensorflow/tfjs", "@tensorflow/tfjs-backend-wasm"],
  experimental: {
    serverActions: { bodySizeLimit: "16mb" }, // imzolangan shartnoma fayli (15 MB gacha) server action orqali yuklanadi
    // Middleware so'rov tanasini sukut bo'yicha 10 MB da kesadi — 10–15 MB fayl server action'ga
    // chala yetib 500 berardi. Chegara server action chegarasi bilan bir xil (Next 15.5 da mavjud opsiya).
    middlewareClientMaxBodySize: "16mb",
    // Ruxsat yo'q / sessiya tugagan (lib/access-denied.ts) — 500 xato o'rniga 403/401 va
    // `(app)/forbidden.tsx`, `(app)/unauthorized.tsx` sahifalari
    authInterrupts: true,
  },
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      // Bir xil kalitda keyingi qoida ustun (Next hujjati) — panelda faqat CSP almashadi
      { source: "/superadmin/:path*", headers: [{ key: "Content-Security-Policy", value: CSP_CONTROL }] },
    ];
  },
};

export default nextConfig;
