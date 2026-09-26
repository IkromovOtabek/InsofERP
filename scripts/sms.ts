/**
 * Eskiz sozlashni tekshirish va shablonlarni moderatsiyaga berish.
 *
 *   npm run sms              — hisob holati, balans, nickname, shablonlar ro'yxati
 *   npm run sms -- shablon   — src/lib/sms/templates.ts dagi matnlarni moderatsiyaga yuborish
 *   npm run sms -- test 901234567           — Eskiz ruxsat bergan sinov matni
 *   npm run sms -- test 901234567 haqiqiy   — bizning haqiqiy shablon matnimiz (o'tadimi-yo'qmi ko'rish uchun)\n *   npm run sms -- holat <id>               — yuborilgan SMS yetib bordimi, qancha turdi
 *
 * Hujjat: notify.eskiz.uz (Postman). Barcha so'rovlar multipart/form-data bilan.
 */
import { loadEnv } from "./env";
loadEnv();

import { eskizToken, smsSender, usingTestSender } from "@/lib/sms/eskiz";
import { TEMPLATES, TEMPLATES_FOR_MODERATION } from "@/lib/sms/templates";
import { normalizePhone, toEskiz } from "@/lib/sms/phone";

const API = "https://notify.eskiz.uz/api";

/** Eskiz statuslari — ro'yxatda o'zbekcha ko'rinsin. */
const STATUS: Record<string, string> = {
  moderation: "moderatsiyada",
  inproccess: "jarayonda",
  service: "servis (tasdiqlangan)",
  reklama: "reklama",
  rejected: "rad etilgan",
};

async function get(path: string, token: string) {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function postForm(path: string, token: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}

type Tpl = { id: number; original_text: string; status: string };

async function listTemplates(token: string): Promise<Tpl[]> {
  const j = (await get("/user/templates", token)) as { result?: Tpl[] };
  return j.result ?? [];
}

async function main() {
  const [cmd, arg, mode] = process.argv.slice(2);

  if (!process.env.ESKIZ_EMAIL || !process.env.ESKIZ_PASSWORD) {
    console.error("ESKIZ_EMAIL / ESKIZ_PASSWORD .env da yo'q.\nKabinet: my.eskiz.uz → Sozlamalar → API");
    process.exit(1);
  }

  let token: string;
  try {
    token = await eskizToken();
  } catch (e) {
    console.error(`Token olinmadi: ${e instanceof Error ? e.message : e}`);
    console.error("Eng ko'p uchraydigan sabab: kabinet paroli ishlatilgan. Kerak bo'lgani — 'Sozlamalar → API' dagi parol.");
    process.exit(1);
  }
  console.log("[OK] Token olindi\n");

  // ── Hisob ──
  const user = (await get("/auth/user", token)) as { data?: { name?: string; email?: string; status?: string; balance?: number } };
  const d = user.data ?? {};
  console.log(`Hisob:    ${d.name ?? "—"} · ${d.email ?? "—"}`);
  console.log(`Holati:   ${d.status ?? "—"}`);
  console.log(`Balans:   ${d.balance ?? 0}`);
  console.log(`Nickname: ${smsSender()}${usingTestSender() ? "  ← umumiy raqam (ESKIZ_FROM sozlanmagan): SMS yetib boradi, lekin brend ko'rinmaydi" : ""}\n`);

  // ── Shablonlarni yuborish ──
  if (cmd === "shablon") {
    const existing = await listTemplates(token);
    let failed = 0;
    for (const t of TEMPLATES_FOR_MODERATION) {
      if (existing.some((e) => e.original_text?.trim() === t.text.trim())) {
        console.log(`• ${t.key}: allaqachon yuborilgan, o'tkazib yuborildi`);
        continue;
      }
      const r = await postForm("/user/template", token, { template: t.text });
      if (!r.ok) failed++;
      console.log(`${r.ok ? "[OK]" : "[XATO]"} ${t.key}: ${r.ok ? "moderatsiyaga yuborildi" : `${r.status} ${r.body.slice(0, 200)}`}`);
    }
    if (failed) {
      // API hamma hisobda ochiq emas (masalan nickname tasdiqlanmaganda "User not found" qaytaradi).
      // Bunday holda matnlarni kabinetdan qo'lda qo'shish kerak — shuning uchun shu yerda chop etamiz.
      console.log("\nAPI orqali qo'shib bo'lmadi. Matnlarni kabinetdan qo'lda qo'shing:");
      console.log("  https://my.eskiz.uz/sms/template\n");
      for (const t of TEMPLATES_FOR_MODERATION) console.log(`  ${t.text}`);
    }
    console.log();
  }

  // ── Sinov SMS ──
  if (cmd === "test") {
    const phone = normalizePhone(arg);
    if (!phone) { console.error("Raqam noto'g'ri. Masalan: npm run sms -- test 901234567"); process.exit(1); }
    // Shartnomasiz/nickname'siz hisobda faqat Eskiz'ning o'z sinov matni o'tadi.
    // `status: active` buni bildirmaydi — o'lchov sifatida tasdiqlangan nickname ishonchliroq.
    //
    // `haqiqiy` — bizning haqiqiy shablon matnimizni joriy jo'natuvchi nomi bilan sinaydi:
    // "4546 bilan ham ishlaydimi?" degan savolga taxmin emas, Eskiz'ning o'z javobini beradi.
    const real = mode === "haqiqiy";
    const text = real
      ? TEMPLATES.reset_code.text({ code: "482174" })
      : usingTestSender() ? "Bu Eskiz dan test" : "Insof ERP: sinov xabari.";
    if (real && usingTestSender()) console.log("Sinov nomi (4546) bilan HAQIQIY matn yuborilyapti — Eskiz rad etsa, javobi quyida ko'rinadi.");
    const r = await postForm("/message/sms/send", token, { mobile_phone: toEskiz(phone), message: text, from: smsSender() });
    console.log(`${r.ok ? "[OK]" : "[XATO]"} ${phone} ← "${text}"`);
    console.log(`   ${r.body.slice(0, 300)}\n`);
  }

  // ── Bitta SMS taqdiri ──
  // Hujjatda yo'q, lekin ishlaydigan endpoint. Yetkazilganmi, qancha turgani va
  // "reklama"mi yoki "servis"mi — hammasi shu yerda ko'rinadi.
  if (cmd === "holat") {
    if (!arg) { console.error("Xabar id'si kerak: npm run sms -- holat <id>"); process.exit(1); }
    let j: { data?: Record<string, unknown> };
    try {
      j = (await get(`/message/sms/status_by_id/${arg}`, token)) as { data?: Record<string, unknown> };
    } catch {
      // Rad etilgan xabar (masalan moderatsiyadan o'tmagan matn) jurnalga umuman tushmaydi —
      // va puli ham yechilmaydi
      console.log("Bunday xabar Eskiz jurnalida yo'q: rad etilgan bo'lsa yozilmaydi va hisobdan pul yechilmaydi.\n");
      return;
    }
    const m = j.data ?? {};
    console.log(`Holat:  ${m.status ?? "—"}`);
    console.log(`Raqam:  ${m.to ?? "—"}`);
    console.log(`Matn:   ${m.message ?? "—"}`);
    console.log(`Narx:   ${m.total_price ?? "—"} so'm`);
    console.log(`Turi:   ${m.is_ad ? "REKLAMA (qimmat) — tasdiqlangan shablonsiz shunday hisoblanadi" : "servis"}`);
    console.log(`Nom:    ${m.nick ?? "—"}\n`);
  }

  // ── Shablonlar ro'yxati ──
  const tpls = await listTemplates(token);
  console.log(`Shablonlar (${tpls.length}):`);
  if (tpls.length === 0) console.log("  — hali yo'q. Yuborish: npm run sms -- shablon");
  for (const t of tpls) console.log(`  [${STATUS[t.status] ?? t.status}] ${t.original_text}`);

  const need = TEMPLATES_FOR_MODERATION.filter((t) => !tpls.some((e) => e.original_text?.trim() === t.text.trim()));
  if (need.length) console.log(`\nYuborilmagan ${need.length} ta shablon bor — "npm run sms -- shablon" bilan yuboring.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
