/**
 * ERP spravochniklarini Insof ECO'ga yuboradi (mijoz, marka, xomashyo, zayavka, schyot, to'lov).
 * Ishlatish:
 *   npm run eco:sync              — oxirgi 90 kunlik zayavka/schyot/to'lov
 *   npm run eco:sync -- --days=365
 *   npm run eco:sync -- --days=0  — hamma vaqt (birinchi to'liq yuklash)
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { syncAllToEco } = await import("@/lib/eco/master");
  const { ecoEnabled, ecoUrl } = await import("@/lib/eco/client");
  const { db } = await import("@/lib/db");

  if (!ecoEnabled()) {
    console.error("ECO ulanmagan: .env da ECO_API_URL va ECO_API_KEY yo'q");
    process.exit(1);
  }
  const arg = process.argv.find((a) => a.startsWith("--days="));
  const days = arg ? Number(arg.split("=")[1]) : 90;
  const sinceDays = Number.isFinite(days) && days > 0 ? days : 36500;

  console.log(`→ ECO: ${ecoUrl()} · oyna: ${days === 0 ? "hamma vaqt" : `${sinceDays} kun`}`);
  const r = await syncAllToEco({ sinceDays });

  console.table(
    Object.fromEntries(
      Object.entries(r.sections).map(([k, v]) => [k, { jami: v.total, yuborildi: v.ok, tashlandi: v.skipped, xato: v.failed }]),
    ),
  );
  const failed = Object.entries(r.sections).filter(([, v]) => v.failed > 0);
  for (const [name, v] of failed) {
    console.log(`\n${name} — birinchi xatolar:`);
    for (const e of v.errors) console.log("  ·", e);
  }
  const secs = (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000;
  console.log(`\nTugadi: ${secs.toFixed(1)} s${failed.length ? ` · ${failed.length} bo'limda xato bor` : " · xatosiz"}`);
  await db.$disconnect();
  process.exit(failed.length ? 1 : 0);
}
void main();
