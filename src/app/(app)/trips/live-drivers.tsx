"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Navigation, RefreshCw, Route, Satellite, TriangleAlert } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui";
import { ECO_STATUS } from "@/lib/eco/labels";
import type { EcoLiveTrip, EcoTrack } from "@/lib/eco/client";
import { LiveMap, type MapTrip } from "./live-map";

/** Xaritani har necha soniyada yangilash. Haydovchi ilovasi GPS'ni ~15 s da bir yuboradi. */
const POLL_MS = 15_000;

/** 840 m → "840 m", 12400 m → "12.4 km" */
function km(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** 95 daq → "1 s 35 daq" */
function dur(minutes: number) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} s ${minutes % 60} daq` : `${minutes} daq`;
}

const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
function ago(iso: string) {
  const m = minutesAgo(iso);
  if (m < 1) return "hozir";
  if (m < 60) return `${m} daq oldin`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} soat oldin` : `${Math.floor(h / 24)} kun oldin`;
}

export type LiveDriversProps = {
  /** Faqat shu zayavkaning reyslari (zayavka kartochkasi uchun). Server ham shu bo'yicha filtrlaydi. */
  orderRef?: string;
  /** Blok sarlavhasi — sahifaga qarab o'zgaradi. */
  title?: string;
  /** Bosh sahifa uchun: past xarita, ro'yxat xarita ostida. */
  compact?: boolean;
};

/**
 * Yo'lga chiqqan haydovchilar — jonli ro'yxat va xarita.
 * Ma'lumot Insof ECO haydovchi ilovasidan keladi; ECO o'chiq bo'lsa blok sokin qoladi.
 * Kim qaysi reysni ko'rishi serverda hal bo'ladi (`lib/eco/visibility.ts`) — bu komponent
 * nima kelsa shuni chizadi.
 */
export function LiveDrivers({ orderRef, title, compact }: LiveDriversProps = {}) {
  const [trips, setTrips] = useState<EcoLiveTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [track, setTrack] = useState<EcoTrack | null>(null);

  // ── ma'lumotni davriy olish ──
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(orderRef ? `/api/eco/positions?orderRef=${encodeURIComponent(orderRef)}` : "/api/eco/positions", { cache: "no-store" });
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
  }, [orderRef]);

  // ── tanlangan reysning to'liq izi (yuzlab nuqta bo'lishi mumkin — faqat so'ralganda) ──
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

  const located = useMemo(() => (trips ?? []).filter((t) => t.position), [trips]);

  const mapTrips = useMemo<MapTrip[]>(
    () =>
      located.map((t) => ({
        ref: t.ref,
        lat: t.position!.lat,
        lng: t.position!.lng,
        label: t.plate ?? "—",
        popup: `<b>${t.plate ?? "—"}</b><br>${t.driver ?? "haydovchi yo'q"}<br>${t.customer}<br>${km(t.odometer.meters)} yurdi${
          t.position!.etaMin != null ? ` · ~${t.position!.etaMin} daq qoldi` : ""
        }`,
      })),
    [located],
  );

  const mapTrack = useMemo<[number, number][] | null>(
    () => (track && track.points.length >= 2 ? track.points.map((p) => [p.lat, p.lng] as [number, number]) : null),
    [track],
  );

  const totalMeters = (trips ?? []).reduce((sum, t) => sum + t.odometer.meters, 0);

  // Hech narsa yo'q va xato ham yo'q — sahifani bezovta qilmaymiz
  if (trips !== null && trips.length === 0 && !error) return null;

  return (
    <Card className="mb-5">
      <CardHeader
        icon={Navigation}
        title={title ?? "Yo'lga chiqqan haydovchilar"}
        description={
          trips === null
            ? "Yuklanmoqda…"
            : `${trips.length} ta reys yo'lda · ${located.length} tasida GPS bor · jami ${km(totalMeters)}${
                updatedAt ? ` · yangilandi ${updatedAt.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""
              }`
        }
        action={<RefreshCw size={14} className="text-slate-400" />}
      />

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className={compact ? "flex flex-col-reverse gap-3" : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"}>
        <ul className="space-y-2">
          {(trips ?? []).map((t) => {
            const st = ECO_STATUS[t.status];
            const p = t.position;
            const active = selected === t.ref;
            const odo = t.odometer;
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
                        {odo.meters > 0 && (
                          <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                            <Route size={12} />{km(odo.meters)} yurdi
                          </span>
                        )}
                        {p.etaMin != null && <span className="font-medium text-slate-700">~{p.etaMin} daq qoldi</span>}
                      </>
                    ) : (
                      <span className="text-slate-400">GPS yo&apos;q — ilova yopiq yoki ruxsat berilmagan</span>
                    )}
                  </div>

                  {active && (
                    <>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-white px-3 py-2 text-xs sm:grid-cols-4">
                        <div>
                          <dt className="text-slate-500">Yurilgan yo&apos;l</dt>
                          <dd className="font-semibold text-slate-900">{km(odo.meters)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Yo&apos;lda</dt>
                          <dd className="font-semibold text-slate-900">{dur(odo.movingMinutes)}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">O&apos;rtacha</dt>
                          <dd className="font-semibold text-slate-900">{odo.avgSpeedKmh != null ? `${odo.avgSpeedKmh} km/soat` : "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Eng yuqori</dt>
                          <dd className="font-semibold text-slate-900">{odo.maxSpeedKmh != null ? `${odo.maxSpeedKmh} km/soat` : "—"}</dd>
                        </div>
                      </dl>
                      {track?.ref === t.ref && track.points.length < 2 && (
                        <p className="mt-1 text-xs text-slate-400">Yo&apos;l chizig&apos;i uchun kamida ikkita GPS nuqtasi kerak.</p>
                      )}
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
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className={`overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${compact ? "min-h-[200px]" : "min-h-[260px]"}`}>
          {located.length > 0 ? (
            <LiveMap trips={mapTrips} track={mapTrack} />
          ) : (
            <div className={`flex h-full items-center justify-center px-6 text-center text-xs text-slate-500 ${compact ? "min-h-[200px]" : "min-h-[260px]"}`}>
              Hozircha birorta haydovchidan GPS kelmayapti. Haydovchi ilovada reysni qabul qilib yo&apos;lga chiqsa,
              mikser shu xaritada harakatlanadi.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
