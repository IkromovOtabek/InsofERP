import { NextResponse } from "next/server";
import { isControlMode } from "@/lib/tenant";
import { releaseVersion } from "@/lib/control/release";

/**
 * Jarayon holati — deploy.sh (yangi relizni tekshirish / avtomatik qaytarish) va scripts/health-watch.sh (cron) uchun.
 *   200 {"ok":true,"version":"<qisqa sha>"}  — jarayon tirik va baza `SELECT 1` ga javob beradi
 *   503 {"ok":false,...}                     — baza javob bermadi (sabab tafsiloti chiqarilmaydi)
 * Login talab qilinmaydi (middleware'da ochiq), maxfiy ma'lumot qaytarmaydi: na baza nomi, na xato matni.
 * nginx shablonlarida tashqaridan yopiq (faqat 127.0.0.1). Panel rejimida (INSOF_MODE=control) control bazasi tekshiriladi.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = 3000;

async function pingDb(): Promise<void> {
  const client = isControlMode() ? (await import("@/lib/control/db")).control : (await import("@/lib/db")).db;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const headers = { "cache-control": "no-store" };
  try {
    await pingDb();
    return NextResponse.json({ ok: true, version: releaseVersion() }, { headers });
  } catch {
    return NextResponse.json({ ok: false, version: releaseVersion(), db: "down" }, { status: 503, headers });
  }
}

export const HEAD = GET;
