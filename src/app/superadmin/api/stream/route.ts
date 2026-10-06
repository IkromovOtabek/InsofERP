import { requireAdmin } from "@/lib/control/auth";
import { loadMonitorSnapshot, snapshotHash } from "@/lib/control/monitor/snapshot";

/**
 * Monitoring jonli oqimi (Server-Sent Events) — IT panel sahifalari useLiveMonitor() orqali tinglaydi.
 *
 *  - Har 3 s bazadan ixcham surat (snapshot.ts) olinadi; o'zgargan bo'lsa (sha1) `data:` yuboriladi,
 *    aks holda `: hb` izohi (proksi ulanishni uzib qo'ymasin, brauzer esa hech narsa qilmaydi).
 *  - Mijoz uzilsa (req.signal) taymer to'xtaydi. Ulanish 10 daqiqadan keyin server tomonidan yopiladi —
 *    EventSource o'zi qayta ulanadi va sessiya (requireAdmin) yana tekshiriladi.
 *  - `?once=1` — oqimsiz bitta JSON (EventSource ishlamagan tarmoqlar uchun zaxira so'rov).
 *  - nginx bufer qilmasin: `X-Accel-Buffering: no`.
 * Middleware /superadmin/* ni cookie bo'yicha himoyalaydi; bu yerda to'liq tekshiruv (bazadagi hisob holati).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TICK_MS = 3000;
const MAX_LIFE_MS = 10 * 60_000;

export async function GET(req: Request) {
  await requireAdmin();

  if (new URL(req.url).searchParams.get("once") === "1") {
    const snap = await loadMonitorSnapshot();
    return Response.json({ at: new Date().toISOString(), data: snap }, { headers: { "cache-control": "no-store" } });
  }

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const started = Date.now();
  let lastHash = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(s)); } catch { stop(); }
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        req.signal.removeEventListener("abort", stop);
        try { controller.close(); } catch { /* allaqachon yopilgan */ }
      };
      req.signal.addEventListener("abort", stop);

      const tick = async () => {
        if (closed) return;
        if (Date.now() - started > MAX_LIFE_MS) return stop();
        try {
          const snap = await loadMonitorSnapshot();
          const json = JSON.stringify(snap);
          const h = snapshotHash(json);
          if (h !== lastHash) {
            lastHash = h;
            send(`id: ${h}\ndata: {"at":"${new Date().toISOString()}","data":${json}}\n\n`);
          } else send(`: hb ${Date.now()}\n\n`);
        } catch (e) {
          // Baza vaqtincha yo'q — mijozga xabar, oqim davom etadi
          send(`event: problem\ndata: ${JSON.stringify({ error: (e as Error).message.slice(0, 200) })}\n\n`);
        }
        if (!closed) timer = setTimeout(tick, TICK_MS);
      };
      send(`retry: 3000\n\n`);
      void tick();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
