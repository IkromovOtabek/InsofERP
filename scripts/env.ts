import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Bitta `KALIT=qiymat` qatorini o'qiydi. `.env` da qiymat yonida izoh turishi mumkin:
 *   SMS_PROVIDER="ESKIZ"   # FAKE | ESKIZ
 * Qo'shtirnoqli qiymat yopiluvchi qo'shtirnoqgacha olinadi, qolgani tashlanadi.
 * Qo'shtirnoqsiz qiymatda faqat bo'sh joydan keyingi `#` izoh deb qaraladi —
 * parol ichidagi `#` yo'qolib qolmasin.
 */
function parseValue(raw: string): string {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    if (end > 0) return v.slice(1, end);
    return v.slice(1); // yopilmagan qo'shtirnoq — bor qiymatni olamiz
  }
  return v.replace(/\s+#.*$/, "").trim();
}

/** .env ni process.env ga yuklaydi (skriptlar Next runtime'idan tashqarida ishlaydi). */
export function loadEnv(file = ".env") {
  let raw: string;
  try { raw = readFileSync(resolve(process.cwd(), file), "utf8"); } catch { return; }
  const fromFile = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // Bir xil kalit ikki marta yozilgan bo'lsa oxirgisi kuchda — Next'ning yuklovchisi ham shunday,
    // aks holda skript va veb ilova bir xil .env dan boshqa-boshqa qiymat o'qib qolardi
    fromFile.set(m[1], parseValue(m[2]));
  }
  // Haqiqiy muhit o'zgaruvchisi .env dan ustun (prodda sozlama serverdan beriladi)
  for (const [k, v] of fromFile) if (process.env[k] === undefined) process.env[k] = v;
}
