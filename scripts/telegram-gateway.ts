/**
 * Telegram Gateway (OTP) sozlashni tekshirish.
 *
 *   npm run gateway                       — sozlama holati va token tekshiruvi (bepul)
 *   npm run gateway -- test 901234567     — shu raqamga haqiqiy sinov kodi (gateway hisobi egasining
 *                                           o'z raqamiga bepul, boshqa raqamga — tarif bo'yicha)
 *   npm run gateway -- holat <request_id> — xabar yetib bordimi, o'qildimi, pul qaytdimi (bepul)
 *
 * Hujjat: https://core.telegram.org/gateway/api
 */
import { loadEnv } from "./env";
loadEnv();

import { randomInt } from "crypto";
import { gatewayEnabled, gatewayToken, sendGatewayCode } from "@/lib/telegram/gateway";
import { isTestMode } from "@/lib/test-mode";

const API = "https://gatewayapi.telegram.org";

/** Gateway holatlari — o'zbekcha ko'rinsin. */
const DELIVERY: Record<string, string> = {
  sent: "yuborildi (hali yetmagan)",
  delivered: "yetib bordi",
  read: "o'qildi",
  expired: "muddati o'tdi — pul qaytariladi",
  revoked: "bekor qilindi",
};
const VERIFICATION: Record<string, string> = {
  code_valid: "kod to'g'ri kiritildi",
  code_invalid: "kod noto'g'ri kiritildi",
  code_max_attempts_exceeded: "urinishlar tugadi",
  expired: "muddati o'tdi",
};

type RequestStatus = {
  request_id: string;
  phone_number: string;
  request_cost: number;
  is_refunded?: boolean;
  remaining_balance?: number;
  delivery_status?: { status: string; updated_at: number };
  verification_status?: { status: string; updated_at: number; code_entered?: string };
  payload?: string;
};

async function call(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${gatewayToken()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as { ok: boolean; error?: string; result?: RequestStatus };
}

const time = (unix?: number) => (unix ? new Date(unix * 1000).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" }) : "—");

async function main() {
  const [cmd, arg] = process.argv.slice(2);

  if (!gatewayToken()) {
    console.error("TELEGRAM_GATEWAY_TOKEN .env da yo'q.\nOlish: gateway.telegram.org → Telegram raqamingiz bilan kiring → API → tokenni nusxalang.");
    process.exit(1);
  }
  if (isTestMode()) {
    console.error("Test rejimi (INSOF_ENV=test) — Gateway'ga so'rov yuborilmaydi.");
    process.exit(1);
  }

  // ── Token tekshiruvi ──
  // checkVerificationStatus bepul: soxta request_id bilan chaqiramiz — token yaroqsiz bo'lsa
  // ACCESS_TOKEN_INVALID qaytadi, yaroqli bo'lsa boshqa xato (request topilmadi) keladi.
  const probe = await call("checkVerificationStatus", { request_id: "0" });
  if (!probe.ok && /ACCESS_TOKEN/i.test(probe.error ?? "")) {
    console.error(`[XATO] Token qabul qilinmadi: ${probe.error}\ngateway.telegram.org → API bo'limidagi tokenni qayta nusxalang.`);
    process.exit(1);
  }
  console.log("[OK] Token qabul qilindi");
  const sender = (process.env.TELEGRAM_GATEWAY_SENDER ?? "").trim();
  console.log(`Jo'natuvchi kanal: ${sender ? `@${sender.replace(/^@/, "")}` : "yo'q (xabar «Verification Codes» rasmiy chatidan keladi)"}`);
  console.log(`Ilovada yoqilgan: ${gatewayEnabled() ? "ha" : "yo'q"}\n`);

  if (cmd === "test") {
    if (!arg) { console.error("Raqam kerak: npm run gateway -- test 901234567"); process.exit(1); }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const r = await sendGatewayCode(arg, code, { ttlSec: 300, payload: "test" });
    if (!r.ok) {
      console.error(`[XATO] Yuborilmadi: ${r.reason}${r.error ? ` — ${r.error}` : ""}`);
      if (r.reason === "BAD_PHONE") console.error("Raqam formati: 901234567 yoki +998901234567");
      process.exit(1);
    }
    console.log(`[OK] Kod ${code} yuborildi`);
    console.log(`request_id: ${r.requestId}`);
    console.log(`Narx:       ${r.cost ?? 0}$`);
    console.log(`Balans:     ${r.balance ?? "—"}$`);
    console.log(`\nYetib bordimi: npm run gateway -- holat ${r.requestId}`);
    return;
  }

  if (cmd === "holat") {
    if (!arg) { console.error("request_id kerak: npm run gateway -- holat <request_id>"); process.exit(1); }
    const r = await call("checkVerificationStatus", { request_id: arg });
    if (!r.ok || !r.result) { console.error(`[XATO] ${r.error ?? "javob yo'q"}`); process.exit(1); }
    const s = r.result;
    console.log(`Raqam:      ${s.phone_number}`);
    console.log(`Yetkazish:  ${s.delivery_status ? `${DELIVERY[s.delivery_status.status] ?? s.delivery_status.status} · ${time(s.delivery_status.updated_at)}` : "—"}`);
    console.log(`Tasdiqlash: ${s.verification_status ? VERIFICATION[s.verification_status.status] ?? s.verification_status.status : "— (kodni ERP o'zi tekshiradi)"}`);
    console.log(`Narx:       ${s.request_cost}$${s.is_refunded ? " (qaytarildi)" : ""}`);
    return;
  }

  if (cmd) { console.error(`Noma'lum buyruq: ${cmd}. Mavjud: test, holat`); process.exit(1); }
  console.log("Sinov: npm run gateway -- test 901234567");
}

main().catch((e) => { console.error(e); process.exit(1); });
