import { db } from "@/lib/db";
import { tashkentDay, tashkentHour } from "@/lib/nazorat/checks";
import { saveDataHealthRun } from "@/lib/data-health";

/**
 * «Ma'lumot sog'ligi» tungi tekshiruvi: har 10 daqiqada Toshkent soatini ko'radi — 02:00 dan o'tgan va bugun hali avtomatik
 * yugurmagan bo'lsa tekshiradi va muammo bo'lsa direktorga Telegram yuboradi. Bir kunda bir marta — `DataHealthRun.day` unique
 * (ikki jarayon yoki qayta ishga tushish takror yubormaydi). `instrumentation.ts` dan (`DATA_HEALTH_WATCH=off` — o'chirish).
 */
export const DATA_HEALTH_HOUR = 2;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function dataHealthTick(now: Date = new Date()) {
  if (tashkentHour(now) < DATA_HEALTH_HOUR) return null;
  const done = await db.dataHealthRun.findUnique({ where: { day: tashkentDay(now) }, select: { id: true } });
  if (done) return null;
  return saveDataHealthRun({ manual: false, now, notify: true });
}

export function startDataHealthWatch(intervalMs = 10 * 60_000) {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    dataHealthTick().then((r) => { if (r) console.log(`[data-health] tekshirildi: ${r.problems} ta muammo, ${r.notified} ta xabar`); })
      .catch((e) => console.error("[data-health]", e)).finally(() => { running = false; });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 90_000).unref?.();
}
