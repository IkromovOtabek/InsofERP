"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio, WifiOff, RefreshCw, LogIn } from "lucide-react";
import type { MonitorSnapshot } from "@/lib/control/monitor/shared";

/**
 * Monitoring jonli ma'lumoti — panel qobig'ida BITTA EventSource (/superadmin/api/stream), barcha sahifalar
 * va menyu hisoblagichi shu ulanishdan o'qiydi.
 *  - uzilsa: 1 → 2 → 4 … 30 s oraliq bilan qayta ulanadi;
 *  - 3 marta ketma-ket uzilsa: zaxira — har 5 s `?once=1` JSON so'rovi (SSE'ni proksi yoki tarmoq bo'g'sa ham ishlaydi),
 *    SSE har 30 s qayta sinab ko'riladi;
 *  - sessiya tugagan bo'lsa (login sahifasiga yo'naltirish) — to'xtaydi va "qayta kiring" deydi.
 */
export type Conn = "connecting" | "live" | "polling" | "offline" | "auth";
type Live = { data: MonitorSnapshot | null; conn: Conn; at: string | null; problem: string | null };

const Ctx = createContext<Live | null>(null);
const URL_ = "/superadmin/api/stream";

export function LiveMonitorProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Live>({ data: null, conn: "connecting", at: null, problem: null });

  useEffect(() => {
    let es: EventSource | null = null;
    let fails = 0;
    let stopped = false;
    let reconnectT: ReturnType<typeof setTimeout> | undefined;
    let pollT: ReturnType<typeof setInterval> | undefined;

    const apply = (raw: string) => {
      try {
        const m = JSON.parse(raw) as { at: string; data: MonitorSnapshot };
        if (m?.data) setState((s) => ({ ...s, data: m.data, at: m.at, problem: null }));
      } catch { /* buzuq bo'lak — keyingisini kutamiz */ }
    };

    const poll = async () => {
      try {
        const r = await fetch(`${URL_}?once=1`, { cache: "no-store", credentials: "same-origin" });
        if (r.redirected || r.status === 401 || !(r.headers.get("content-type") ?? "").includes("json")) {
          if (r.redirected || r.status === 401 || r.url.includes("/superadmin/login")) return stopAll("auth");
          throw new Error(`HTTP ${r.status}`);
        }
        apply(await r.text());
        setState((s) => ({ ...s, conn: s.conn === "live" ? "live" : "polling" }));
      } catch {
        setState((s) => (s.conn === "live" ? s : { ...s, conn: "offline" }));
      }
    };

    const stopAll = (conn: Conn) => {
      stopped = true;
      es?.close(); es = null;
      clearTimeout(reconnectT); clearInterval(pollT); pollT = undefined;
      setState((s) => ({ ...s, conn }));
    };

    const connect = () => {
      if (stopped) return;
      es?.close();
      es = new EventSource(URL_);
      es.onopen = () => {
        fails = 0;
        clearInterval(pollT); pollT = undefined;
        setState((s) => ({ ...s, conn: "live" }));
      };
      es.onmessage = (e) => apply(e.data);
      es.addEventListener("problem", (e) => {
        try { setState((s) => ({ ...s, problem: (JSON.parse((e as MessageEvent).data) as { error: string }).error })); } catch { /* */ }
      });
      es.onerror = () => {
        // Brauzer o'zi qayta ulanadi (CONNECTING) — faqat yopilib qolsa o'zimiz boshqaramiz
        if (es && es.readyState !== EventSource.CLOSED) { setState((s) => ({ ...s, conn: s.conn === "live" ? "connecting" : s.conn })); return; }
        es = null;
        fails++;
        if (fails >= 3 && !pollT) { void poll(); pollT = setInterval(poll, 5000); }
        else if (fails < 3) setState((s) => ({ ...s, conn: "connecting" }));
        clearTimeout(reconnectT);
        reconnectT = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(fails, 5)));
      };
    };

    // Oyna qayta ko'rinsa va ulanish yo'q bo'lsa — darhol ulanish
    const onVis = () => { if (document.visibilityState === "visible" && !es && !stopped) { clearTimeout(reconnectT); connect(); } };
    document.addEventListener("visibilitychange", onVis);
    connect();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      es?.close(); clearTimeout(reconnectT); clearInterval(pollT);
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/** Jonli surat. `initial` — sahifa serverda chizgan birinchi holat (oqim kelguncha shu ko'rinadi). */
export function useLiveMonitor(initial?: MonitorSnapshot | null): Live {
  const c = useContext(Ctx);
  if (!c) return { data: initial ?? null, conn: "offline", at: null, problem: null };
  return { ...c, data: c.data ?? initial ?? null };
}

/**
 * Server sahifa (hodisalar, amallar, xavfsizlik) — jonli oqimda tegishli qism o'zgarsa router.refresh().
 * `pick` qaytargan satr o'zgarganda (birinchi kelishidan tashqari) sahifa qayta so'raladi.
 */
export function useRefreshOn(pick: (s: MonitorSnapshot) => string) {
  const { data } = useLiveMonitor();
  const router = useRouter();
  const prev = useRef<string | null>(null);
  const sig = data ? pick(data) : null;
  useEffect(() => {
    if (sig == null) return;
    if (prev.current != null && prev.current !== sig) router.refresh();
    prev.current = sig;
  }, [sig, router]);
}

export function RefreshOn({ what }: { what: "incidents" | "actions" | "security" }) {
  useRefreshOn((s) =>
    what === "actions" ? s.actions.map((a) => `${a.id}:${a.status}`).join(",")
      : what === "incidents" ? `${s.counts.open}/${s.counts.acked}/` + s.incidents.map((i) => `${i.id}:${i.status}:${i.count}`).join(",")
        : `${s.report?.id}|` + s.actions.filter((a) => a.type.endsWith("_IP") || a.type.startsWith("RUN_")).map((a) => `${a.id}:${a.status}`).join(",") + "|" + s.incidents.filter((i) => i.source !== "monitor").map((i) => `${i.id}:${i.status}:${i.count}`).join(","),
  );
  return null;
}

/**
 * Ulanish holati — Status Board «pill»: nuqta (jonli bo'lsa miltillaydi) + matn.
 * `compact` — shapkada telefonda faqat nuqta va qisqa yozuv.
 */
export function ConnBadge({ compact }: { compact?: boolean }) {
  const { conn, at, problem } = useLiveMonitor();
  const map = {
    live: { t: "Jonli", short: "Jonli", tone: "ok", I: Radio },
    connecting: { t: "Ulanmoqda…", short: "…", tone: "unk", I: RefreshCw },
    polling: { t: "Har 5 s yangilanadi", short: "5 s", tone: "warn", I: RefreshCw },
    offline: { t: "Aloqa yo'q", short: "Aloqa yo'q", tone: "crit", I: WifiOff },
    auth: { t: "Sessiya tugadi — qayta kiring", short: "Qayta kiring", tone: "crit", I: LogIn },
  }[conn];
  const text = compact ? map.short : map.t;
  return (
    <span role="status" aria-live="polite" title={at ? `Oxirgi yangilanish: ${new Date(at).toLocaleTimeString()}` : map.t}
      className={`sa-pill ${map.tone === "crit" ? "crit" : map.tone === "warn" ? "warn" : ""}`} style={{ fontSize: 13 }}>
      {map.tone === "ok" || map.tone === "unk"
        ? <span className={`sa-dot ${map.tone === "ok" ? "ok sa-live" : ""}`} aria-hidden />
        : <map.I size={14} aria-hidden />}
      {conn === "auth" ? <a href="/superadmin/login" className="underline">{text}</a> : text}
      {compact && text !== map.t && <span className="sa-sr">{map.t}</span>}
      {problem && <span className="sa-sr">Baza xatosi: {problem}</span>}
    </span>
  );
}
