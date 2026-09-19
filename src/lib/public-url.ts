import { headers } from "next/headers";

/**
 * Tashqaridan (telefon, mijoz) ochiladigan havolalar uchun manzil.
 * `APP_URL` berilgan bo'lsa — shu (serverda domen, lokalda kompyuterning LAN IP'si).
 * Bo'lmasa so'rov sarlavhasidagi host: brauzerdan ochilganda "localhost" bo'lib qoladi,
 * telefon uni ocha olmaydi — shuning uchun QR uchun APP_URL sozlanishi shart.
 */
export async function publicOrigin(): Promise<{ origin: string; fromEnv: boolean }> {
  const env = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return { origin: env, fromEnv: true };
  const h = await headers();
  return { origin: `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`, fromEnv: false };
}
