"use client";

import { useEffect, useRef } from "react";
import { addTiles, loadLeaflet, TASHKENT, type LLayer, type LMap } from "@/lib/leaflet";

/**
 * Reys qaysi yo'ldan yurgani — haydovchi ilovasidan kelgan GPS nuqtalari bo'yicha.
 *
 * Nega kerak: logistika "necha km yurdi" degan raqamni ko'radi-yu, "qaysi yo'ldan"
 * degan savolga javob topolmasdi. Yo'l chizig'i kelishilgan marshrutdan chetga
 * chiqilganini ham, obyektda qancha turganini ham ko'rsatadi.
 */
const TRACK = "#009ef5";

export function TripTrackMap({ track, start, finish }: {
  /** Haydovchi bosib o'tgan nuqtalar, vaqt bo'yicha tartibda. */
  track: [number, number][];
  /** Qayerdan qo'zg'algani — yuk olingan joy, bo'lmasa izning birinchi nuqtasi. */
  start: [number, number] | null;
  /** Obyekt manzili. Zayavkada nuqta belgilanmagan bo'lsa — null. */
  finish: [number, number] | null;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !L || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false }).setView(TASHKENT, 11);
      map.current = m;
      addTiles(L, m);

      const layers: LLayer[] = [];
      if (track.length > 1) {
        // Ostidagi oq chiziq — ko'k yo'l xaritaning o'zidan ajralib tursin
        layers.push(L.polyline(track, { color: "#fff", weight: 8, opacity: 0.9 }).addTo(m));
        layers.push(L.polyline(track, { color: TRACK, weight: 4, opacity: 0.95 }).addTo(m));
      }

      /** Belgi — emoji doira ichida. Rasm fayli kerak emas, har qanday zichlikda aniq chiqadi. */
      const pin = (at: [number, number], emoji: string, title: string, ring: string) =>
        L.marker(at, {
          icon: L.divIcon({
            className: "",
            html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:#fff;border:2px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.3);font-size:17px;line-height:1">${emoji}</div>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
        }).addTo(m).bindPopup(title);

      const from = start ?? (track.length ? track[0]! : null);
      if (from) pin(from, "🚩", "Qo'zg'algan joy", "#00b34d");
      if (finish) pin(finish, "🏁", "Obyekt", "#1f2937");
      // Iz tugagan, lekin obyekt nuqtasi yo'q bo'lsa — oxirgi joylashuvni ko'rsatamiz
      if (!finish && track.length > 1) pin(track[track.length - 1]!, "📍", "Oxirgi joylashuv", "#009ef5");

      const all = [...track, ...(from ? [from] : []), ...(finish ? [finish] : [])];
      if (all.length > 1) m.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
      else if (all.length === 1) m.setView(all[0]!, 14);
      void layers;
    });
    return () => { cancelled = true; };
  }, [track, start, finish]);

  return (
    // Balandlik o'rovchida: ichki xarita `absolute inset-0` bilan uni to'ldiradi
    <div className="relative min-h-[340px] overflow-hidden rounded-xl border border-slate-200">
      <div ref={el} className="absolute inset-0" />
    </div>
  );
}
