"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, Navigation, RefreshCw, Satellite, TriangleAlert } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui";
import { ECO_STATUS } from "@/lib/eco/labels";
import type { EcoLiveTrip } from "@/lib/eco/client";

/** Xaritani har necha soniyada yangilash. Haydovchi ilovasi GPS'ni ~15 s da bir yuboradi. */
const POLL_MS = 15_000;
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
/** Toshkent markazi — hali hech kim GPS yubormaganda xarita shu yerdan boshlanadi. */
const FALLBACK_CENTER: [number, number] = [41.2995, 69.2401];

// Leaflet CDN'dan keladi (npm paketi qo'shilmagan) — kerakli qismi shu.
type LMap = { setView: (c: [number, number], z: number) => LMap; removeLayer: (l: unknown) => void; fitBounds: (b: unknown, o?: unknown) => void };
type LMarker = { addTo: (m: LMap) => LMarker; bindPopup: (html: string) => LMarker; setLatLng: (c: [number, number]) => LMarker };
type Leaflet = {
  map: (el: HTMLElement, o?: unknown) => LMap;
  tileLayer: (url: string, o?: unknown) => { addTo: (m: LMap) => unknown };
  marker: (c: [number, number], o?: unknown) => LMarker;
  divIcon: (o: unknown) => unknown;
  latLngBounds: (cs: [number, number][]) => unknown;
};

declare global {
  interface Window { L?: Leaflet }
}

let leafletPromise: Promise<Leaflet | null> | null = null;
/** Leaflet'ni bir marta yuklaydi. Internet bo'lmasa null — xarita o'rniga faqat ro'yxat qoladi. */
function loadLeaflet(): Promise<Leaflet | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ??= new Promise<Leaflet | null>((resolve) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const s = document.createElement("script");
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => resolve(window.L ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return leafletPromise;
}

const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
function ago(iso: string) {
  const m = minutesAgo(iso);
  if (m < 1) return "hozir";
  if (m < 60) return `${m} daq oldin`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} soat oldin` : `${Math.floor(h / 24)} kun oldin`;
}

/**
 * Yo'lga chiqqan haydovchilar — jonli ro'yxat va xarita.
 * Ma'lumot Insof ECO haydovchi ilovasidan keladi; ECO o'chiq bo'lsa blok sokin qoladi.
 */
export function LiveDrivers() {
  const [trips, setTrips] = useState<EcoLiveTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const markers = useRef<Map<string, LMarker>>(new Map());

  // ── ma'lumotni davriy olish ──
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/eco/positions", { cache: "no-store" });
        const j = (await res.json()) as { trips: EcoLiveTrip[]; error: string | null };
        if (!alive) return;
        setTrips(j.trips);
        setError(j.error);
        setUpdatedAt(new Date());
      } catch {
        if (alive) setError("Joylashuvni olib bo'lmadi");
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const located = useMemo(() => (trips ?? []).filter((t) => t.position), [trips]);

  // ── xaritani qurish va belgilarni yangilash ──
  useEffect(() => {
    if (located.length === 0) return;
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !L || !mapEl.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(mapEl.current, { scrollWheelZoom: false }).setView(FALLBACK_CENTER, 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap",
          maxZoom: 19,
        }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      const seen = new Set<string>();
      for (const t of located) {
        const pos: [number, number] = [t.position!.lat, t.position!.lng];
        seen.add(t.ref);
        const existing = markers.current.get(t.ref);
        const popup = `<b>${t.plate ?? "—"}</b><br>${t.driver ?? "haydovchi yo'q"}<br>${t.customer}<br>${
          t.position!.etaMin != null ? `~${t.position!.etaMin} daq qoldi` : ECO_STATUS[t.status]?.label ?? t.status
        }`;
        if (existing) existing.setLatLng(pos).bindPopup(popup);
        else {
          const icon = L.divIcon({
            className: "",
            html: `<div style="background:#0f172a;color:#fff;border-radius:9999px;padding:2px 7px;font:600 11px/1.6 ui-sans-serif,system-ui;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)">${t.plate ?? "🚚"}</div>`,
            iconSize: [0, 0],
            iconAnchor: [20, 10],
          });
          markers.current.set(t.ref, L.marker(pos, { icon }).addTo(map).bindPopup(popup));
        }
      }
      // Yo'lda qolmagan reyslarning belgisi olib tashlanadi
      for (const [ref, m] of markers.current) {
        if (!seen.has(ref)) { map.removeLayer(m); markers.current.delete(ref); }
      }
      const pts = located.map((t) => [t.position!.lat, t.position!.lng] as [number, number]);
      if (pts.length === 1) map.setView(pts[0], 13);
      else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    });
    return () => { cancelled = true; };
  }, [located]);

  // Hech narsa yo'q va xato ham yo'q — sahifani bezovta qilmaymiz
  if (trips !== null && trips.length === 0 && !error) return null;

  return (
    <Card className="mb-5">
      <CardHeader
        icon={Navigation}
        title="Yo'lga chiqqan haydovchilar"
        description={
          trips === null ? "Yuklanmoqda…"
            : `${trips.length} ta reys yo'lda · ${located.length} tasida GPS bor${updatedAt ? ` · yangilandi ${updatedAt.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}`
        }
        action={<RefreshCw size={14} className="text-slate-400" />}
      />

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ul className="space-y-2">
          {(trips ?? []).map((t) => {
            const st = ECO_STATUS[t.status];
            const p = t.position;
            const active = selected === t.ref;
            return (
              <li key={t.ref}>
                <button
                  type="button"
                  onClick={() => setSelected(active ? null : t.ref)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${active ? "border-slate-400 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{t.plate ?? "—"}</span>
                    <span className="text-sm text-slate-600">{t.driver ?? "haydovchi biriktirilmagan"}</span>
                    {st && <Badge color={st.color}>{st.label}</Badge>}
                    {t.slaBreached && <Badge color="red">SLA buzildi</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><MapPin size={12} />{t.customer}</span>
                    <span>{t.address}</span>
                    {p ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-emerald-700"><Satellite size={12} />{ago(p.at)}</span>
                        {p.speedKmh != null && <span>{Math.round(p.speedKmh)} km/soat</span>}
                        {p.etaMin != null && <span className="font-medium text-slate-700">~{p.etaMin} daq qoldi</span>}
                      </>
                    ) : (
                      <span className="text-slate-400">GPS yo&apos;q — ilova yopiq yoki ruxsat berilmagan</span>
                    )}
                  </div>
                  {active && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <Link href={`/trips?q=${encodeURIComponent(t.ref)}`} className="text-slate-700 underline">{t.ref}</Link>
                      {t.driverPhone && <a href={`tel:${t.driverPhone}`} className="text-slate-700 underline">{t.driverPhone}</a>}
                      {p && (
                        <a
                          href={`https://yandex.uz/maps/?pt=${p.lng},${p.lat}&z=16&l=map`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-700 underline"
                        >
                          Yandex xaritada ochish
                        </a>
                      )}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="min-h-[260px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {located.length > 0 ? (
            <div ref={mapEl} className="h-full min-h-[260px] w-full" />
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center px-6 text-center text-xs text-slate-500">
              Hozircha birorta haydovchidan GPS kelmayapti. Haydovchi ilovada reysni qabul qilib yo&apos;lga chiqsa,
              mikser shu xaritada harakatlanadi.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
