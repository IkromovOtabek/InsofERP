/**
 * amoCRM tsikli — korxona jarayonida (`instrumentation.ts`), har daqiqada (`sync.ts` → `amoTick`):
 * navbatdagi sayt arizalari, «ERP'ga» bosqichidagi sdelkalar (5 daqiqada), zayavka holatlari.
 * Ikki jarayon bitta bazada ishlasa ham ariza ikki marta ketmaydi (yuborish shartli egallanadi).
 * `AMOCRM_WATCH=off` — o'chirish; test rejimida sukut bo'yicha o'chiq (`AMOCRM_WATCH=on` — yoqish).
 */
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startAmoWatch(intervalMs = 60_000) {
  if (timer) return;
  const run = () => {
    if (running) return;
    running = true;
    import("./sync").then((m) => m.amoTick()).catch((e) => console.error("[amocrm-watch]", e)).finally(() => { running = false; });
  };
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 45_000).unref?.();
}
