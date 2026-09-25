"use client";

import { useEffect, useRef } from "react";
import { addTiles, loadLeaflet, TASHKENT, type LLayer, type LMap, type LMarker } from "@/lib/leaflet";
import { MapLocateButton } from "@/components/map-locate-button";

/** Xaritadagi bitta mashina. */
export type MapTrip = {
  ref: string;
  lat: number;
  lng: number;
  /** Belgi ustidagi yozuv — davlat raqami */
  label: string;
  /** Bosilganda chiqadigan oyna (HTML) */
  popup: string;
};

const TRACK_COLOR = "#009ef5";
const START_COLOR = "#00b34d";

/** Yo'ldagi mashinalar va tanlangan reysning izi. Tayl manbai `lib/leaflet.ts` da. */
export function LiveMap({ trips, track }: { trips: MapTrip[]; track: [number, number][] | null }) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LMap | null>(null);
  const marks = useRef<Map<string, LMarker>>(new Map());
  const lines = useRef<LLayer[]>([]);

  // ── xaritani bir marta qurish ──
  useEffect(() => {
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !L || !el.current || map.current) return;
      map.current = L.map(el.current, { scrollWheelZoom: false }).setView(TASHKENT, 11);
      addTiles(L, map.current);
    });
    return () => { cancelled = true; };
  }, []);

  // ── mashina belgilari ──
  useEffect(() => {
    const m = map.current, L = typeof window !== "undefined" ? window.L : null;
    if (!m || !L) return;
    const seen = new Set<string>();
    for (const t of trips) {
      seen.add(t.ref);
      const pos: [number, number] = [t.lat, t.lng];
      const existing = marks.current.get(t.ref);
      if (existing) { existing.setLatLng(pos).bindPopup(t.popup); continue; }
      const icon = L.divIcon({
        className: "",
        html: `<div style="background:#0f172a;color:#fff;border-radius:9999px;padding:2px 7px;font:600 11px/1.6 ui-sans-serif,system-ui;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)">${t.label}</div>`,
        iconSize: [0, 0],
        iconAnchor: [20, 10],
      });
      marks.current.set(t.ref, L.marker(pos, { icon }).addTo(m).bindPopup(t.popup));
    }
    // Yo'lda qolmagan reyslarning belgisi olib tashlanadi
    for (const [ref, mk] of marks.current) {
      if (!seen.has(ref)) { m.removeLayer(mk); marks.current.delete(ref); }
    }
    if (track) return; // iz ochiq — ko'rinishni surmaymiz
    const pts = trips.map((t) => [t.lat, t.lng] as [number, number]);
    if (pts.length === 1) m.setView(pts[0], 13);
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }, [trips, track]);

  // ── yo'l chizig'i ──
  useEffect(() => {
    const m = map.current, L = typeof window !== "undefined" ? window.L : null;
    if (!m || !L) return;
    for (const l of lines.current) m.removeLayer(l);
    lines.current = [];
    if (!track || track.length < 2) return;
    lines.current.push(
      // ostidagi oq chiziq — yo'l xaritaning o'zidan ajralib tursin
      L.polyline(track, { color: "#fff", weight: 7, opacity: 0.9 }).addTo(m),
      L.polyline(track, { color: TRACK_COLOR, weight: 4, opacity: 0.95 }).addTo(m),
      L.circleMarker(track[0], { radius: 5, color: START_COLOR, fillColor: START_COLOR, fillOpacity: 1, weight: 2 }).addTo(m),
    );
    m.fitBounds(L.latLngBounds(track), { padding: [40, 40] });
  }, [track]);

  return (
    // Balandlik o'rovchida (`min-h`): ichki xarita `absolute inset-0` bilan uni
    // to'ldiradi — `h-full` bo'lsa ota-element balandligi "auto" bo'lgani uchun
    // xarita nol balandlikka tushib qolardi.
    <div className="relative isolate h-full min-h-[260px] w-full">
      <div ref={el} className="absolute inset-0" />
      <MapLocateButton getMap={() => map.current} />
    </div>
  );
}
