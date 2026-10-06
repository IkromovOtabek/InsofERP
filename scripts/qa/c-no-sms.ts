/**
 * QA (C) — SMS kanali olib tashlangan: bir martalik kodlar FAQAT Telegram (bot / Gateway) orqali.
 * Statik tekshiruv (server kerak emas): manba kodida SMS provayderi (Eskiz), SMS yuborish funksiyasi,
 * `SmsLog` jadvaliga yozish/o'qish, SMS env kalitlari va `npm run sms` qaytib kelmasin.
 *
 *   npx tsx scripts/qa/c-no-sms.ts
 *
 * Eslatma: prisma/schema.prisma dagi `SmsLog` modeli hozircha qoldirilgan (alohida tozalash migratsiyasi),
 * shuning uchun schema va src/generated tekshirilmaydi.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { check, done, section } from "./c-lib";

const ROOT = join(__dirname, "..", "..");
const SELF = relative(ROOT, __filename);

/** Taqiqlangan izlar: kod yo'li (funksiya, modul, jadval, env kaliti, provayder). */
const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "Eskiz provayderi", re: /eskiz/i },
  { name: "sendSms / smsNote", re: /\bsendSms\w*\b|\bsmsNote\b/ },
  { name: "SmsLog jadvali (db.smsLog)", re: /\.smsLog\b/ },
  { name: "lib/sms moduli", re: /lib\/sms\b|["']\.\/sms["'/]|sms-login/ },
  { name: "SMS_PROVIDER / RESET_SMS_FALLBACK", re: /SMS_PROVIDER|RESET_SMS_FALLBACK|SMS_FALLBACK/ },
  { name: "via: \"sms\" kanali", re: /["']sms["']/ },
];

const SKIP_DIRS = new Set(["node_modules", "generated", ".next", ".git"]);
const EXT = /\.(ts|tsx|js|mjs|mts|cjs|sh)$/;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
}

section("SMS kanali olib tashlangan (statik)");

const files: string[] = [];
walk(join(ROOT, "src"), files);
walk(join(ROOT, "scripts"), files);
// platform-init-env.sh eski SMS kalitlarini .env nusxasidan OLIB TASHLAYDI (grep -v) — bu iz emas, tozalash
const ALLOW = new Set([SELF, "scripts/platform-init-env.sh"]);
const targets = files.filter((f) => !ALLOW.has(relative(ROOT, f)));
// Env namunalari ham — server .env ga eski kalitlar qaytib yozilmasin
for (const f of [".env.example", ".env.test.example", "build.env.example", "docs/deploy/control.env.example"]) {
  if (existsSync(join(ROOT, f))) targets.push(join(ROOT, f));
}

for (const { name, re } of FORBIDDEN) {
  const hits = targets.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  check(`manbada yo'q: ${name}`, hits.length === 0, hits.join(", "));
}

check("src/lib/sms papkasi yo'q", !existsSync(join(ROOT, "src/lib/sms")));
check("scripts/sms.ts yo'q", !existsSync(join(ROOT, "scripts/sms.ts")));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
check("package.json da `sms` skripti yo'q", !pkg.scripts?.sms && !Object.values(pkg.scripts ?? {}).some((v) => /sms/i.test(v)));

// Kod yetkazish moduli faqat Telegram kanallarini biladi
const codeLogin = readFileSync(join(ROOT, "src/lib/code-login.ts"), "utf8");
const reset = readFileSync(join(ROOT, "src/lib/password-reset.ts"), "utf8");
check("code-login: faqat Telegram bot + Gateway", /sendGatewayCode/.test(codeLogin) && /sendCodeToBot/.test(codeLogin));
check("password-reset: faqat Telegram bot + Gateway", /sendGatewayCode/.test(reset) && /sendResetCodeToBot/.test(reset));

done();
