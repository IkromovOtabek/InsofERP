import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** .env ni process.env ga yuklaydi (skriptlar Next runtime'idan tashqarida ishlaydi). */
export function loadEnv(file = ".env") {
  let raw: string;
  try { raw = readFileSync(resolve(process.cwd(), file), "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const v = m[2].trim().replace(/^["'](.*)["']$/s, "$1");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
