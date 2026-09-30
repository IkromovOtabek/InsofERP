"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, MapPinned, Satellite, TriangleAlert } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui";
import type { EcoLiveTrip, EcoTrack } from "@/lib/eco/client";
import { LiveMap, type MapTrip } from "../trips/live-map";

/** Xaritani har necha soniyada yangilash — haydovchi ilovasi GPS'ni ~15 s da bir yuboradi. */
const POLL_MS = 15_000;

type BadgeColor = NonNullable<React.ComponentProps<typeof Badge>["color"]>;

/** Serverdan keladigan faol reys — sanalar ISO satr, bosqich va kechikish tayyor matn (bu fayl faqat chizadi). */
export type FleetTrip = {
  id: string; noteNo: string; plate: string; driver: string; driverPhone: string | null;
  customer: string; address: string;
  phase: { label: string; color: BadgeColor }; onRoad: boolean;
  plannedAt: string | null;
  delay: { text: string; level: "ok" | "warn" | "crit" | null };
  openIssues: number;
  fix: { lat: number; lng: number; at: string; etaMin: number | null; remainingKm: number | null } | null;
};

type Pos = { lat: number; lng: number; at: string; etaMin: number | null; remainingKm: number | null; speedKmh: number | null };

const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
function ago(iso: string) {
  const m = minutesAgo(iso);
  if (m < 1) return "hozir";
  if (m < 60) return `${m} daq oldin`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} soat oldin` : `${Math.floor(h / 24)} kun oldin`;
}
const hm = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const LEVEL_TEXT = { ok: "text-slate-600", warn: "text-amber-700", crit: "text-red-700" } as const;

/**
 * Logistika bosh sahifasi: faol reyslar xaritada, o'ng tomonda reysdagi mashinalar jadvali.
 * Qatorni bosganda xarita shu mashinaga yaqinlashadi va uning yurgan izi chiziladi;
 * xaritadagi belgini bosganda jadvalda qator ajratiladi.
 * Ro'yxat serverdan (barcha faol reyslar — GPS'sizlari ham), joylashuv `/api/eco/positions` dan
 * davriy yangilanadi (bugungi kun uchun).
 */
export function FleetMap({ trips, isToday, gpsError }: { trips: FleetTrip[]; isToday: boolean; gpsError?: string | null }) {
  const [pos, setPos] = useState<Map<string, Pos>>(() => new Map(trips.filter((t) => t.fix).map((t) => [t.noteNo, { ...t.fix!, speedKmh: null }])));
  const [error, setError] = useState<string | null>(gpsError ?? null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [track, setTrack] = useState<EcoTrack | null>(null);

  // ── joylashuvni davriy olish (faqat bugun — o'tgan kunda jonli mashina yo'q) ──
  useEffect(() => {
    if (!isToday) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/eco/positions", { cache: "no-store" });
        const j = (await res.json()) as { trips: EcoLiveTrip[]; error: string | null };
        if (!alive) return;
        setPos((prev) => {
          const next = new Map(prev);
          for (const t of j.trips) {
            if (!t.position) continue;
            const p = t.position;
            const dest = t.destination;
            const remainingKm = dest ? Math.round(haversineKm(p.lat, p.lng, dest.lat, dest.lng) * 10) / 10 : null;
            next.set(t.ref, { lat: p.lat, lng: p.lng, at: p.at, etaMin: p.etaMin, remainingKm, speedKmh: p.speedKmh ?? null });
          }
          return next;
        });
        setError(j.error);
        setUpdatedAt(new Date());
      } catch {
        if (alive) setError("Joylashuvni olib bo'lmadi");
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [isToday]);

  // ── tanlangan reysning izi ──
  useEffect(() => {
    if (!selected) { setTrack(null); return; }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/eco/track/${encodeURIComponent(selected)}`, { cache: "no-store" });
        const j = (await res.json()) as { track: EcoTrack | null };
        if (alive) setTrack(j.track);
      } catch {
        if (alive) setTrack(null);
      }
    })();
    return () => { alive = false; };
  }, [selected]);

  const onSelect = useCallback((ref: string) => setSelected(ref), []);

  const mapTrips = useMemo<MapTrip[]>(() =>
    trips.flatMap((t) => {
      const p = pos.get(t.noteNo);
      if (!p) return [];
      return [{
        ref: t.noteNo, lat: p.lat, lng: p.lng, label: t.plate,
        popup: `<b>${t.plate}</b><br>${t.driver}<br>${t.customer}<br>${t.phase.label}${p.etaMin != null && t.onRoad ? ` · ~${p.etaMin} daq qoldi` : ""}`,
      }];
    }), [trips, pos]);

  const mapTrack = useMemo<[number, number][] | null>(
    () => (track && track.points.length >= 2 ? track.points.map((p) => [p.lat, p.lng] as [number, number]) : null),
    [track],
  );

  const located = mapTrips.length;
  const selectedTrip = selected ? trips.find((t) => t.noteNo === selected) : null;

  return (
    <Card>
      <CardHeader
        icon={MapPinned}
        title="Faol reyslar — xarita"
        description={trips.length === 0
          ? "Hozir faol reys yo'q"
          : `${trips.length} ta reys · ${located} tasida GPS bor${updatedAt ? ` · yangilandi ${updatedAt.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}${!isToday ? " · o'tgan kun — jonli joylashuv yo'q" : ""}`}
        action={<Link href="/trips" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Hammasi <ArrowRight size={14} /></Link>}
      />

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" /> ECO GPS: {error}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* ── Xarita ── */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 min-h-[320px] xl:min-h-[540px]">
          {located > 0 ? (
            <LiveMap trips={mapTrips} track={mapTrack} focus={selected} onSelect={onSelect} />
          ) : (
            <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-xs text-slate-500">
              {trips.length === 0
                ? "Faol reys yo'q — reys ochilib, haydovchi yo'lga chiqsa mashina shu xaritada ko'rinadi."
                : "Hozircha birorta haydovchidan GPS kelmayapti. Haydovchi ilovada reysni qabul qilib yo'lga chiqsa, mikser shu xaritada harakatlanadi."}
            </div>
          )}
        </div>

        {/* ── Reysdagi mashinalar ── */}
        <div className="flex max-h-[540px] flex-col overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <span>Mashina</span><span>Mijoz / bosqich</span><span className="text-right">Reja · GPS</span>
          </div>
          {trips.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">Faol reys yo&apos;q</p>}
          <ul className="divide-y divide-slate-100 overflow-y-auto">
            {trips.map((t) => {
              const p = pos.get(t.noteNo);
              const active = selected === t.noteNo;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(active ? null : t.noteNo)}
                    className={`grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-2 px-3 py-2 text-left text-sm transition ${active ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : "hover:bg-slate-50"}`}
                    aria-pressed={active}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold tabular text-slate-900">{t.plate}</div>
                      <div className="truncate text-xs text-slate-500">{t.driver}</div>
                      <Link href={`/trips/${t.id}`} onClick={(e) => e.stopPropagation()} className="text-xs tabular text-slate-500 hover:text-slate-900 hover:underline">{t.noteNo}</Link>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{t.customer}</div>
                      <div className="truncate text-xs text-slate-500">{t.address}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Badge color={t.phase.color}>{t.phase.label}</Badge>
                        {t.openIssues > 0 && <Badge color="red">muammo</Badge>}
                      </div>
                    </div>
                    <div className="min-w-0 text-right text-xs">
                      <div className="tabular text-slate-700">{hm(t.plannedAt)}</div>
                      <div className={t.delay.level ? `font-medium ${LEVEL_TEXT[t.delay.level]}` : "text-slate-400"}>{t.delay.text}</div>
                      {p ? (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-emerald-700"><Satellite size={11} />{ago(p.at)}{p.etaMin != null && t.onRoad ? ` · ~${p.etaMin} daq` : ""}</div>
                      ) : (
                        <div className="mt-0.5 text-slate-400">GPS yo&apos;q</div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {selectedTrip && (
            <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {pos.get(selectedTrip.noteNo)
                ? <>Xaritada: <b>{selectedTrip.plate}</b>{track && track.points.length >= 2 ? " · yurgan izi chizildi" : ""}{pos.get(selectedTrip.noteNo)!.speedKmh != null ? ` · ${Math.round(pos.get(selectedTrip.noteNo)!.speedKmh!)} km/soat` : ""}</>
                : <><b>{selectedTrip.plate}</b> — GPS yo&apos;q, xaritada ko&apos;rsatib bo&apos;lmaydi. {selectedTrip.driverPhone && <a href={`tel:${selectedTrip.driverPhone}`} className="underline">{selectedTrip.driverPhone}</a>}</>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** To'g'ri chiziq bo'yicha masofa, km — ETA yo'q bo'lsa hech bo'lmasa qolgan masofa ko'rinsin. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
