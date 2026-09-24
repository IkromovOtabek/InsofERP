"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MapPin } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { addTiles, loadLeaflet, TASHKENT, type LMap, type LMarker } from "@/lib/leaflet";
import { savePlantLocation } from "./actions";

/**
 * Zavod joyi — barcha masofa shu nuqtadan hisoblanadi.
 * Bir marta belgilanadi: zayavkadagi "zavoddan N km" va haydovchi marshruti shunga tayanadi.
 */
export function PlantLocation({ lat, lng }: { lat: number | null; lng: number | null }) {
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(lat != null && lng != null ? { lat, lng } : null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LMap | null>(null);
  const marker = useRef<LMarker | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !L || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false }).setView(point ? [point.lat, point.lng] : TASHKENT, point ? 16 : 11);
      addTiles(L, m);
      m.on("click", (e) => { setPoint({ lat: e.latlng.lat, lng: e.latlng.lng }); setSaved(false); });
      map.current = m;
      if (point) marker.current = L.marker([point.lat, point.lng]).addTo(m);
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current, L = typeof window !== "undefined" ? window.L : null;
    if (!m || !L || !point) return;
    const pos: [number, number] = [point.lat, point.lng];
    if (marker.current) marker.current.setLatLng(pos);
    else marker.current = L.marker(pos).addTo(m);
  }, [point]);

  const save = async () => {
    if (!point) return;
    setSaving(true);
    try {
      await savePlantLocation(point.lat, point.lng);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-1 font-semibold">Zavod joyi</h2>
      <p className="mb-3 text-sm text-slate-500">
        Xaritadan zavod turgan joyni bosib belgilang. Zayavkadagi &quot;zavoddan necha km&quot; va
        haydovchining marshruti shu nuqtadan hisoblanadi.
      </p>
      <div className="isolate overflow-hidden rounded-lg border border-slate-200">
        <div ref={el} className="h-[260px] w-full bg-slate-50" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {point ? (
          <span className="inline-flex items-center gap-1 text-slate-600">
            <MapPin size={12} className="text-emerald-600" />
            {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
          </span>
        ) : (
          <span className="text-amber-700">Hali belgilanmagan — masofa hisoblanmaydi</span>
        )}
        <Button type="button" onClick={save} disabled={!point || saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? "Saqlandi" : "Saqlash"}
        </Button>
      </div>
    </Card>
  );
}
