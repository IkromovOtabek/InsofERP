import { toEskiz } from "./phone";

/**
 * Eskiz.uz SMS shlyuzi — kutubxonasiz fetch.
 *
 * Sozlash (`.env`):
 *   SMS_PROVIDER=ESKIZ   — yoqish (boshqa qiymatda SMS yuborilmaydi, jurnalga yoziladi)
 *   ESKIZ_EMAIL          — kabinet emaili
 *   ESKIZ_PASSWORD       — kabinetdagi "Sozlamalar → API" bo'limidagi API paroli
 *   ESKIZ_FROM           — tasdiqlangan jo'natuvchi nomi (masalan INSOF)
 *
 * Token 30 kun yashaydi va shu yerda keshlanadi. 401 kelsa — token bekor qilingan,
 * bir marta yangilab qayta urinamiz (ECO'dagi dastlabki variantda shu yetishmayotgan edi
 * va token bekor bo'lgach servis qayta ishga tushmaguncha SMS to'xtab qolardi).
 */

const AUTH_URL = "https://notify.eskiz.uz/api/auth/login";
const SEND_URL = "https://notify.eskiz.uz/api/message/sms/send";

/** `4546` — Eskiz'ning sinov nomi: SMS "yuborildi" bo'lib ko'rinadi, lekin mijozga yetmaydi. */
const TEST_SENDER = "4546";

export const smsProvider = () => (process.env.SMS_PROVIDER?.trim().toUpperCase() === "ESKIZ" ? "eskiz" : "fake");
export const smsSender = () => process.env.ESKIZ_FROM?.trim() || TEST_SENDER;

/** Nickname hali tasdiqlanmagan — yuborilgani bilan mijozga yetib bormaydi. */
export const usingTestSender = () => smsSender() === TEST_SENDER;

export class SmsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SmsError";
  }
}

let token: { value: string; exp: number } | null = null;

async function getToken(force = false): Promise<string> {
  if (!force && token && token.exp > Date.now()) return token.value;

  const email = process.env.ESKIZ_EMAIL?.trim();
  const password = process.env.ESKIZ_PASSWORD?.trim();
  if (!email || !password) throw new SmsError("ESKIZ_EMAIL / ESKIZ_PASSWORD sozlanmagan");

  // Eskiz hujjatida so'rovlar multipart/form-data bilan: content-type'ni o'zimiz qo'ymaymiz,
  // fetch chegarani (boundary) o'zi yozadi
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  const r = await fetch(AUTH_URL, { method: "POST", body: form });
  const body = await r.text();
  if (!r.ok) throw new SmsError(`Eskiz token olinmadi (${r.status}): ${body.slice(0, 200)}`, r.status);

  let value: string | undefined;
  try {
    value = (JSON.parse(body) as { data?: { token?: string } }).data?.token;
  } catch {
    throw new SmsError(`Eskiz javobi JSON emas: ${body.slice(0, 200)}`);
  }
  if (!value) throw new SmsError(`Eskiz tokeni javobda yo'q: ${body.slice(0, 200)}`);

  // 30 kun beriladi — 25 kunda yangilaymiz, chekkaga borib qolmaslik uchun
  token = { value, exp: Date.now() + 25 * 24 * 3600_000 };
  return value;
}

/** Sozlash skripti uchun (`npm run sms`): kabinet ma'lumotlari bilan olingan joriy token. */
export const eskizToken = () => getToken();

async function post(text: string, phone: string, authToken: string) {
  const form = new FormData();
  form.set("mobile_phone", toEskiz(phone));
  form.set("message", text);
  form.set("from", smsSender());
  return fetch(SEND_URL, { method: "POST", headers: { authorization: `Bearer ${authToken}` }, body: form });
}

/**
 * Bitta SMS yuboradi. Xato bo'lsa `SmsError` TASHLAYDI — chaqiruvchi buni jurnalga
 * yozadi va kerak bo'lsa foydalanuvchiga aytadi. Jimgina yutib yuborish mumkin emas:
 * aks holda "kod yuborildi" deb ko'rsatamiz-u, odam kodni kutib o'tiraveradi.
 */
export async function eskizSend(phone: string, text: string): Promise<void> {
  let r = await post(text, phone, await getToken());
  if (r.status === 401) r = await post(text, phone, await getToken(true)); // token bekor qilingan — yangilab qayta

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new SmsError(`Eskiz ${r.status}: ${body.slice(0, 300)}`, r.status);
  }

  // Eskiz 200 qaytarib, ichida xato holat berishi mumkin (moderatsiyadan o'tmagan matn va h.k.)
  const body = await r.text().catch(() => "");
  try {
    const j = JSON.parse(body) as { status?: string; message?: string };
    if (j.status && !["waiting", "success", "ok"].includes(j.status.toLowerCase())) {
      throw new SmsError(`Eskiz rad etdi: ${j.status} — ${j.message ?? ""}`.trim());
    }
  } catch (e) {
    if (e instanceof SmsError) throw e; // JSON emas bo'lsa — muammo emas, 200 yetarli
  }
}
