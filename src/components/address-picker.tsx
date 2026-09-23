"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Route, Search, TriangleAlert } from "lucide-react";
import { inputCls } from "@/components/ui";
import { addTiles, loadLeaflet, TASHKENT, type LMap, type LMarker } from "@/lib/leaflet";

/**
 * Obyekt manzili — yozilganda qidiradi, xaritada nuqta qo'yadi, masofani hisoblaydi.
 *
 * Nuqta nima uchun kerak: haydovchi ilovasida navigatsiya shu koordinatadan marshrut quradi,
 * ETA aniq hisoblanadi va obyektga yetib borilganda holat avtomatik almashadi.
 * Nuqtasiz zayavka ham saqlanadi — shunda haydovchi manzilni matndan qidiradi.
 *
 * Forma bilan faqat lat/lng ketadi — masofani server qayta hisoblaydi, chunki brauzerdan
 * kelgan raqamni o'zgartirib yuborish mumkin (dastavka narxi shunga bog'lanishi mumkin).
 */

type Place = { name: string; address: string; lat: number; lng: number };
type Point = { lat: number; lng: number };
type Distance = { km: number; source: "ROUTE" | "LINE" };

export function AddressPicker({
  defaultAddress = "",
  defaultLat,
  defaultLng,
  searchEnabled,
  required,
}: {
  defaultAddress?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
  /** 2GIS kaliti sozlanganmi — yo'q bo'lsa faqat xaritadan belgilash qoladi. */
  searchEnabled: boolean;
  required?: boolean;
}) {
  const [address, setAddress] = useState(defaultAddress);
  const [point, setPoint] = useState<Point | null>(
    defaultLat != null && defaultLng != null ? { lat: defaultLat, lng: defaultLng } : null,
  );
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [distance, setDistance] = useState<Distance | null>(null);
  const [plantUnset, setPlantUnset] = useState(false);

  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LMap | null>(null);
  const marker = useRef<LMarker | null>(null);
  /** Taklif tanlangach qidiruv qayta ishga tushmasin. */
  const skipSearch = useRef(false);

  // ── manzil bo'yicha qidiruv (yozishdan keyin biroz kutib) ──
  useEffect(() => {
    if (!searchEnabled) return;
    if (skipSearch.current) { skipSearch.current = false; return; }
    const q = address.trim();
    if (q.length < 3) { setPlaces([]); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const j = (await res.json()) as { places: Place[] };
        setPlaces(j.places ?? []);
        setOpen((j.places ?? []).length > 0);
      } catch {
        setPlaces([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { clearTimeout(timer); setSearching(false); };
  }, [address, searchEnabled]);

  // ── xarita ──
  useEffect(() => {
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !L || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false }).setView(point ? [point.lat, point.lng] : TASHKENT, point ? 16 : 11);
      addTiles(L, m);
      // Xaritaning istalgan joyiga bosib nuqta qo'yish mumkin — qidiruv topa olmagan obyekt uchun
      m.on("click", (e) => setPoint({ lat: e.latlng.lat, lng: e.latlng.lng }));
      map.current = m;
      if (point) marker.current = L.marker([point.lat, point.lng]).addTo(m);
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── nuqta o'zgarsa: belgi, ko'rinish va masofa ──
  useEffect(() => {
    const m = map.current, L = typeof window !== "undefined" ? window.L : null;
    if (m && L && point) {
      const pos: [number, number] = [point.lat, point.lng];
      if (marker.current) marker.current.setLatLng(pos);
      else marker.current = L.marker(pos).addTo(m);
      m.setView(pos, 16);
    }
    if (!point) { setDistance(null); return; }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/geo/distance?lat=${point.lat}&lng=${point.lng}`, { cache: "no-store" });
        const j = (await res.json()) as { distance: Distance | null; reason?: string };
        if (!alive) return;
        setDistance(j.distance);
        setPlantUnset(j.reason === "PLANT_UNSET");
      } catch {
        if (alive) setDistance(null);
      }
    })();
    return () => { alive = false; };
  }, [point]);

  const choose = (p: Place) => {
    skipSearch.current = true;
    setAddress(p.address);
    setPoint({ lat: p.lat, lng: p.lng });
    setOpen(false);
  };

  return (
    <div className="col-span-2">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Obyekt manzili {required && "*"}</span>

      <div className="relative">
        <input
          name="deliveryAddress"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={() => places.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={searchEnabled ? "Ko'cha, mo'ljal yoki obyekt nomini yozing…" : "Ko'cha, mo'ljal, obyekt nomi"}
          required={required}
          autoComplete="off"
          className={`${inputCls} pr-9`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
          {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
        </span>

        {open && places.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {places.map((p, i) => (
              <li key={`${p.lat}-${p.lng}-${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <span>
                    <span className="block text-sm text-slate-900">{p.name}</span>
                    <span className="block text-xs text-slate-500">{p.address}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Nuqta forma bilan ketadi; masofani server o'zi qayta hisoblaydi (bu yerdagisi ko'rsatish uchun) */}
      <input type="hidden" name="lat" value={point?.lat ?? ""} />
      <input type="hidden" name="lng" value={point?.lng ?? ""} />

      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
        <div ref={el} className="h-[220px] w-full bg-slate-50" />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {point ? (
          <>
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <MapPin size={12} /> Nuqta belgilandi
            </span>
            {distance ? (
              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                <Route size={12} /> Zavoddan {distance.km} km
                <span className="font-normal text-slate-400">
                  {distance.source === "ROUTE" ? "(yo'l bo'yicha)" : "(to'g'ri chiziq — yo'l xizmati javob bermadi)"}
                </span>
              </span>
            ) : plantUnset ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <TriangleAlert size={12} /> Masofa uchun Sozlamalarda zavod joyini belgilang
              </span>
            ) : (
              <span className="text-slate-400">masofa hisoblanmoqda…</span>
            )}
            <button type="button" onClick={() => setPoint(null)} className="text-slate-500 underline hover:text-slate-900">
              nuqtani olib tashlash
            </button>
          </>
        ) : (
          <span className="text-slate-500">
            {searchEnabled ? "Manzilni yozib ro'yxatdan tanlang " : "Xaritadan obyekt joyini bosib belgilang "}
            — nuqta belgilansa haydovchida navigatsiya ishlaydi va masofa hisoblanadi.
          </span>
        )}
      </div>
    </div>
  );
}
