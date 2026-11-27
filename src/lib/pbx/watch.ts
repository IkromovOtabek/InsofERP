/**
 * onlinePBX sinxroni — korxona jarayonida har daqiqada (`sync.ts` → `syncCalls`). Sozlanmagan korxonada hech narsa qilmaydi.
 * `ONLINEPBX_WATCH=off` — o'chirish; test rejimida sukut bo'yicha o'chiq.
 */
let timer: ReturnType<typeof setInterval> | null = null;

export function startPbxWatch(intervalMs = 60_000) {
  if (timer) return;
  const run = () => { import("./sync").then((m) => m.syncCalls()).catch((e) => console.error("[pbx-watch]", e instanceof Error ? e.message : e)); };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 50_000).unref?.();
}
