/**
 * SMM rejalashtiruvchisi — korxona jarayonida (`instrumentation.ts`), GPS kuzatuvi kabi.
 *   har daqiqada: vaqti kelgan tasdiqlangan postlarni chiqarish;
 *   har 30 daqiqada: nashr statistikasi va faol reklamalar natijasi; chala yuklashlarni tozalash.
 * Ikki jarayon bir bazada ishlasa ham post ikki marta chiqmaydi (nashr yozuvi shartli egallanadi).
 * `SMM_WATCH=off` — o'chirish; test rejimida sukut bo'yicha o'chiq (`SMM_WATCH=on` — yoqish).
 */
let timer: ReturnType<typeof setInterval> | null = null;
let lastSlow = 0;
let running = false;

export async function smmTick(now = new Date()): Promise<{ published: number; stats?: number; boosts?: number }> {
  const { publishDue, syncPublicationStats } = await import("./publish");
  const published = await publishDue(now);
  if (now.getTime() - lastSlow < 30 * 60_000) return { published };
  lastSlow = now.getTime();
  const { syncBoosts } = await import("./boosts");
  const { cleanupStaleUploads } = await import("./media");
  const [stats, boosts] = await Promise.all([syncPublicationStats(now), syncBoosts(now), cleanupStaleUploads()]);
  return { published, stats, boosts };
}

export function startSmmWatch(intervalMs = 60_000) {
  if (timer) return;
  const run = () => {
    if (running) return; // oldingi tsikl (masalan, uzun video yuklash) tugamagan
    running = true;
    smmTick().catch((e) => console.error("[smm-watch]", e)).finally(() => { running = false; });
  };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 30_000).unref?.();
}
