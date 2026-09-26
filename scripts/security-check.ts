/**
 * Xavfsizlik tekshiruvi — serverga qo'yishdan oldin va vaqti-vaqti bilan:
 *   npm run security:check
 *
 * Nimani tekshiradi:
 *  · .env dagi sirlar (AUTH_SECRET kuchi, webhook sirlari, NODE_ENV);
 *  · faol hisoblarda seed'dagi standart parollar (admin123, parol123) qolib ketmaganmi;
 *  · direktor hisobi bitta emasmi va kim.
 * Muammo topilsa exit code 1 — CI/deploy skriptida to'xtatish uchun.
 */
import { loadEnv } from "./env";
loadEnv();

import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { DEFAULT_PASSWORDS } from "../src/lib/password-policy";

const problems: string[] = [];
const warnings: string[] = [];

function checkEnv() {
  const secret = (process.env.AUTH_SECRET ?? "").trim();
  if (secret.length < 32 || ["dev-secret", "change-me-to-a-long-random-string"].includes(secret)) {
    problems.push("AUTH_SECRET yo'q yoki zaif (kamida 32 belgi). Yarating: openssl rand -base64 48");
  }
  if (!process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_BOT_TOKEN) {
    problems.push("TELEGRAM_WEBHOOK_SECRET yo'q — Telegram webhook ishlamaydi (503). Yarating: openssl rand -hex 24, so'ng `npm run bot:webhook -- https://...`");
  }
  if (process.env.ECO_API_URL && !process.env.ECO_WEBHOOK_SECRET) {
    problems.push("ECO_WEBHOOK_SECRET yo'q — ECO webhook qabul qilinmaydi");
  }
  if (process.env.NODE_ENV !== "production") {
    warnings.push(`NODE_ENV=${process.env.NODE_ENV ?? "(bo'sh)"} — serverda "production" bo'lishi shart (cookie secure, AUTH_SECRET majburiy)`);
  }
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (/:\/\/[^:@/]+:(postgres|insof|password|123456)@/.test(dbUrl)) warnings.push("DATABASE_URL da standart parol ishlatilgan");
}

async function checkUsers() {
  const users = await db.user.findMany({ where: { isActive: true }, select: { login: true, fullName: true, role: true, passwordHash: true } });
  for (const u of users) {
    for (const pw of DEFAULT_PASSWORDS) {
      if (await bcrypt.compare(pw, u.passwordHash)) {
        problems.push(`"${u.login}" (${u.fullName}, ${u.role}) standart parol bilan turibdi — darhol almashtiring`);
        break;
      }
    }
  }
  const directors = users.filter((u) => u.role === "DIRECTOR");
  if (directors.length === 0) problems.push("Faol DIRECTOR hisobi yo'q");
  if (directors.length > 1) warnings.push(`DIRECTOR huquqi ${directors.length} ta hisobda: ${directors.map((d) => d.login).join(", ")}`);
  console.log(`Faol hisoblar: ${users.length}, tekshirildi.`);
}

async function main() {
  checkEnv();
  await checkUsers();
  for (const w of warnings) console.log(`[!]  ${w}`);
  for (const p of problems) console.log(`[XATO]  ${p}`);
  if (problems.length === 0) console.log("[OK]  Jiddiy muammo topilmadi.");
  await db.$disconnect();
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
