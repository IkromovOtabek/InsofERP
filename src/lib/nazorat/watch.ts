import { db } from "@/lib/db";
import { tashkentDay, tashkentHour } from "./checks";
import { sendControlReport } from "./report";

/**
 * Kunlik Nazorat hisobotining kuzatuvchisi: har 5 daqiqada Toshkent soatini tekshiradi — belgilangan soatdan
 * (`controlReportHour`, sukut 19:00) o'tgan va bugun hali yuborilmagan bo'lsa yuboradi. Takrorlanmasligi
 * `ControlReport.day` unique bilan kafolatlanadi. `instrumentation.ts` dan ishga tushadi (`NAZORAT_WATCH=off` — o'chirish).
 */
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function nazoratTick(now: Date = new Date()) {
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { controlReportEnabled: true, controlReportHour: true } });
  if (s?.controlReportEnabled === false) return null;
  if (tashkentHour(now) < (s?.controlReportHour ?? 19)) return null;
  // Qo'lda yuborilgani hisobga olinmaydi — kechki avtomatik hisobot baribir ketadi
  const done = await db.controlReport.findFirst({ where: { day: tashkentDay(now), manual: false }, select: { id: true } });
  if (done) return null;
  return sendControlReport({ now });
}

export function startNazoratWatch(intervalMs = 5 * 60_000) {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    nazoratTick().then((r) => { if (r && !r.skipped) console.log(`[nazorat] hisobot yuborildi: ${r.sent}/${r.planned}${r.noBot ? " (bot ulanmagan)" : ""}`); })
      .catch((e) => console.error("[nazorat]", e)).finally(() => { running = false; });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 60_000).unref?.();
}
