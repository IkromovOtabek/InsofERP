/**
 * Brauzer ko'radigan (ommaviy) manzil bo'yicha absolyut URL — redirect'lar uchun.
 *
 * Prodda jarayon `next start -H 127.0.0.1` bilan nginx ortida ishlaydi: Next `req.url` ni ichki manzildan
 * (`https://localhost:3100/...`) yasaydi va `new URL("/login", req.url)` brauzerni localhost'ga yuborib qo'yardi.
 * nginx `Host` va `X-Forwarded-Proto` ni uzatadi (docs/deploy/nginx-*.conf) — manzil shulardan olinadi.
 * Sarlavha bo'lmasa (lokal ishga tushirish) — avvalgidek `req.url`.
 *
 * Edge (middleware) va Node marshrutlarida ishlaydi.
 */
export function redirectUrl(req: Request, path: string): URL {
  const h = req.headers;
  const first = (v: string | null) => (v ?? "").split(",")[0].trim();
  const host = first(h.get("x-forwarded-host")) || first(h.get("host"));
  // Host sarlavhasi faqat oddiy domen[:port] bo'lsin — g'alati qiymat bilan redirect yasalmasin
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return new URL(path, req.url);
  const proto = first(h.get("x-forwarded-proto")) || new URL(req.url).protocol.replace(":", "");
  return new URL(path, `${proto === "https" ? "https" : "http"}://${host}`);
}
