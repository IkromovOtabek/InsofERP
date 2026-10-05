// QA uchun bazaga to'g'ridan-to'g'ri so'rov (psql orqali). FAQAT test bazasi: nomi `insof_test…` bo'lmasa to'xtaydi.
import { execFileSync } from "node:child_process";

export const DB_URL = process.env.QA_DATABASE_URL ?? "postgresql://otabek@localhost:5432/insof_test_a";
const name = new URL(DB_URL).pathname.slice(1);
if (!/^insof_test/.test(name) || name === "insof_test_golden") {
  console.error(`QA: "${name}" test bazasi emas — to'xtatildi (QA_DATABASE_URL=postgresql://…/insof_test_x)`);
  process.exit(2);
}

/** SELECT natijasi — obyektlar massivi. */
export function q(sql) {
  const out = execFileSync("psql", [DB_URL, "-At", "-v", "ON_ERROR_STOP=1", "-c", `select coalesce(json_agg(t), '[]') from (${sql}) t`], { encoding: "utf8" });
  return JSON.parse(out.trim());
}
export const q1 = (sql) => q(sql)[0];
/** O'zgartiruvchi so'rov (simulyatsiya: masalan reysni yetkazildi qilish — logistika moduli boshqa test'da). */
export function exec(sql) {
  execFileSync("psql", [DB_URL, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
}
export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
