import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Ishlayotgan reliz versiyasi (git sha): GIT_COMMIT muhit o'zgaruvchisi yoki scripts/deploy.sh
 * relizning ildiziga yozgan `RELEASE` fayli (jarayon ishchi papkasi — /var/www/insof-erp/current).
 * Bir marta o'qiladi va eslab qolinadi. Topilmasa — null.
 */
let cached: string | null | undefined;

export function releaseVersion(): string | null {
  if (cached !== undefined) return cached;
  const fromEnv = process.env.GIT_COMMIT?.trim();
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) return (cached = fromEnv.slice(0, 12));
  try {
    const raw = readFileSync(path.join(process.cwd(), "RELEASE"), "utf8").trim();
    cached = /^[0-9a-f]{7,40}$/i.test(raw) ? raw.slice(0, 12) : null;
  } catch {
    cached = null;
  }
  return cached;
}
