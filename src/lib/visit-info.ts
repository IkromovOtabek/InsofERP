/**
 * Tashriflar jurnali (`VisitLog`) uchun sof yordamchilar — korxona jarayoni ham (yozish, `lib/visits.ts`),
 * IT panel ham (o'qish, `lib/control/visits.ts`) ishlatadi. Prisma/Node yo'q.
 */

export const LOGIN_METHODS = {
  parol: "Parol",
  kod: "Telegram kod",
  eco: "ECO ilova paroli",
  sso: "IT panel (SSO)",
  yangi_parol: "Vaqtinchalik paroldan keyin",
  mobil: "Mobil ilova · parol",
  mobil_kod: "Mobil ilova · kod",
} as const;
export type LoginMethod = keyof typeof LOGIN_METHODS;

export const DEVICES = { desktop: "Kompyuter", mobile: "Telefon", tablet: "Planshet", app: "Mobil ilova", unknown: "Noma'lum" } as const;
export type Device = keyof typeof DEVICES;

/** Jurnal shuncha kun saqlanadi (`pruneVisits`, eslatmalar aylanishida). */
export const VISIT_KEEP_DAYS = 90;

/** Sahifa yo'li: faqat ERP ichki yo'li, so'rov parametrlarisiz. Boshqasi — null (yozilmaydi). */
export function cleanVisitPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.split(/[?#]/)[0];
  return /^\/[A-Za-z0-9\-._~%/]{0,299}$/.test(p) && !p.startsWith("/api/") ? p : null;
}

const ver = (ua: string, re: RegExp) => ua.match(re)?.[1]?.split(".")[0];

/**
 * User-Agent → qurilma, OS, brauzer (taxminiy, kutubxonasiz). `app` — so'rov mobil ilova API'sidan kelgan.
 * iPadOS Safari o'zini Mac deb ko'rsatadi — u kompyuter bo'lib qoladi (UA'da boshqa belgi yo'q).
 */
export function parseUserAgent(raw: string | null | undefined, app = false): { device: Device; os: string | null; browser: string | null } {
  const ua = raw ?? "";
  const os = /iPad/.test(ua) ? "iPadOS"
    : /iPhone|iPod/.test(ua) || (app && /Darwin|CFNetwork/.test(ua)) ? "iOS"
    : /Android/.test(ua) || (app && /okhttp/i.test(ua)) ? "Android"
    : /Windows NT/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Macintosh|Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : null;
  if (app) return { device: "app", os, browser: null };
  if (!ua) return { device: "unknown", os: null, browser: null };
  const tablet = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua));
  const device: Device = tablet ? "tablet" : /Mobi|iPhone|iPod|Android/.test(ua) ? "mobile" : os ? "desktop" : "unknown";
  const b: [string, RegExp][] = [
    ["Yandex", /YaBrowser\/([\d.]+)/], ["Edge", /Edg(?:A|iOS)?\/([\d.]+)/], ["Opera", /OPR\/([\d.]+)/], ["Samsung", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/], ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/], ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  const hit = b.find(([, re]) => re.test(ua));
  const browser = hit ? `${hit[0]} ${ver(ua, hit[1]) ?? ""}`.trim() : null;
  return { device, os, browser };
}
