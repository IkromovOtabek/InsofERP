/**
 * SMM rejalashtiruvchisi — korxona jarayonida (`instrumentation.ts`), GPS kuzatuvi kabi.
 *   har daqiqada: vaqti kelgan tasdiqlangan postlarni chiqarish;
 *   har 30 daqiqada: nashr statistikasi va faol reklamalar natijasi; chala yuklashlarni tozalash;
 *   har 6 soatda: profil statistikasi, profildagi postlar, raqobatchilar, Meta tokenlarini yangilash;
 *   alohida navbat: AI studiya video montaji (uzun ish — nashrni to'sib qo'ymasin).
 * Ikki jarayon bir bazada ishlasa ham post ikki marta chiqmaydi (nashr yozuvi shartli egallanadi).
 * `SMM_WATCH=off` — o'chirish; test rejimida sukut bo'yicha o'chiq (`SMM_WATCH=on` — yoqish).
 */
let timer: ReturnType<typeof setInterval> | null = null;
let lastSlow = 0;
let running = false;
let lastInsights = 0;
let insightsRunning = false;
let videoRunning = false;

export async function smmTick(now = new Date()): Promise<{ published: number; stats?: number; boosts?: number }> {
  const { publishDue, syncPublicationStats } = await import("./publish");
  const published = await publishDue(now);
  if (now.getTime() - lastSlow < 30 * 60_000) return { published };
  lastSlow = now.getTime();
  const { syncBoosts } = await import("./boosts");
  const { cleanupStaleUploads } = await import("./media");
  const [stats, boosts] = await Promise.all([syncPublicationStats(now), syncBoosts(now), cleanupStaleUploads()]);
  if (now.getTime() - lastInsights >= 6 * 3600_000 && !insightsRunning) {
    lastInsights = now.getTime();
    insightsRunning = true;
    void syncInsights(now).finally(() => { insightsRunning = false; });
  }
  return { published, stats, boosts };
}

async function syncInsights(now: Date) {
  const { refreshMetaTokens } = await import("./accounts");
  const { syncAccountDays, syncProfilePosts, syncCompetitors } = await import("./insights");
  for (const [name, fn] of [["token", refreshMetaTokens], ["profil", syncAccountDays], ["postlar", syncProfilePosts], ["raqobatchilar", syncCompetitors]] as const) {
    try { await fn(now); } catch (e) { console.error(`[smm-watch] ${name}`, e instanceof Error ? e.message : e); }
  }
}

/** Video navbati: bitta ish tugagach keyingisi; nashr tsiklidan alohida */
async function videoTick() {
  if (videoRunning) return;
  videoRunning = true;
  try {
    const { runNextVideoJob, failStuckVideoJobs } = await import("./video");
    await failStuckVideoJobs();
    while (await runNextVideoJob()) { /* navbat bo'shaguncha */ }
  } catch (e) {
    console.error("[smm-watch] video", e);
  } finally {
    videoRunning = false;
  }
}

/** Yangi video ish qo'shilganda darhol boshlash (daqiqani kutmasdan) */
export function kickVideoQueue() { void videoTick(); }

export function startSmmWatch(intervalMs = 60_000) {
  if (timer) return;
  const run = () => {
    if (running) return; // oldingi tsikl (masalan, uzun video yuklash) tugamagan
    running = true;
    smmTick().catch((e) => console.error("[smm-watch]", e)).finally(() => { running = false; });
    void videoTick();
  };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 30_000).unref?.();
}
