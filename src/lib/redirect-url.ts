/**
 * Brauzer ko'radigan (ommaviy) manzil bo'yicha absolyut URL — redirect'lar uchun.
 *
 * Prodda jarayon `next start -H 127.0.0.1` bilan nginx ortida ishlaydi: Next `req.url` ni ichki manzildan
 * (`https://localhost:3100/...`) yasaydi va `new URL("/login", req.url)` brauzerni localhost'ga yuborib qo'yardi.
 * nginx `Host`, `X-Forwarded-Host` va `X-Forwarded-Proto` ni uzatadi (docs/deploy/nginx-*.conf) — manzil shulardan olinadi.
 * Sarlavha bo'lmasa (lokal ishga tushirish) — avvalgidek `req.url`.
 *
 * `X-Forwarded-Host` ga ko'r-ko'rona ishonilmaydi: nginx'siz (yoki uni o'tkazib yuboradigan) so'rovda mijoz istalgan
 * domenni yozib, login/chiqish redirect'ini begona saytga burishi mumkin edi (open redirect). U faqat ruxsat etilgan
 * hostlardan biri bo'lsa ishlatiladi: `Host` sarlavhasining o'zi (nginx `server_name` bo'yicha tanlangan), `APP_URL`
 * hosti (korxona domeni — provision.ts har korxonaga yozadi), `CONTROL_DOMAIN` (IT panel) va ixtiyoriy
 * `ALLOWED_HOSTS` (vergul bilan). Aks holda `Host` olinadi.
 *
 * Edge (middleware) va Node marshrutlarida ishlaydi.
 */
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** URL yoki "domen[:port]" dan kichik harfli host. Yaroqsiz bo'lsa — null. */
function hostOf(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  try {
    return (s.includes("://") ? new URL(s).host : s).toLowerCase();
  } catch {
    return null;
  }
}

/** Sozlamalardagi ruxsat etilgan hostlar (har chaqiruvda o'qiladi — env runtime'da beriladi). */
function allowedHosts(): Set<string> {
  const list = [process.env.APP_URL, process.env.CONTROL_DOMAIN, ...(process.env.ALLOWED_HOSTS ?? "").split(",")];
  return new Set(list.map(hostOf).filter((h): h is string => !!h));
}

export function redirectUrl(req: Request, path: string): URL {
  const h = req.headers;
  const first = (v: string | null) => (v ?? "").split(",")[0].trim();
  const direct = first(h.get("host")).toLowerCase();
  const fwd = first(h.get("x-forwarded-host")).toLowerCase();
  const host = fwd && HOST_RE.test(fwd) && (fwd === direct || allowedHosts().has(fwd)) ? fwd : direct;
  // Host sarlavhasi faqat oddiy domen[:port] bo'lsin — g'alati qiymat bilan redirect yasalmasin
  if (!host || !HOST_RE.test(host)) return new URL(path, req.url);
  const proto = first(h.get("x-forwarded-proto")) || new URL(req.url).protocol.replace(":", "");
  return new URL(path, `${proto === "https" ? "https" : "http"}://${host}`);
}
