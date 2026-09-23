"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Navigation, Phone, Smartphone, X } from "lucide-react";
import { addTiles, loadLeaflet } from "@/lib/leaflet";

/**
 * "Joylashuv" bo'limi: xarita + manzil kartasi.
 *
 * Ikkalasi bitta klient komponentda, chunki ikkalasidan ham bitta oyna ochiladi —
 * mijoz zavodni o'z telefonidagi xarita ilovasida ochadi (quyida `AppPicker`).
 *
 * Nuqta Sozlamalar → "Zavod joyi" dan olinadi (zayavkadagi masofa ham shundan
 * hisoblanadi) — sayt uchun alohida koordinata saqlanmaydi.
 */
export function PlantLocation({
  lat, lng, title, address, hours, phone,
}: {
  lat: number | null; lng: number | null; title: string; address: string | null; hours: string | null; phone: string | null;
}) {
  const [picker, setPicker] = useState(false);
  const hasPoint = lat != null && lng != null;
  const label = address ?? title;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      {hasPoint ? (
        <MapBox lat={lat} lng={lng} onPick={() => setPicker(true)} />
      ) : (
        <MapMissing address={label} />
      )}

      <div className="flex flex-col justify-center rounded-lg bg-insof-900 p-8">
        <span className="font-mono text-[11px] tracking-[0.16em] text-signal uppercase">Manzil</span>
        <p className="mt-3 font-display text-2xl font-bold text-white">{label}</p>
        {hours && <p className="mt-4 text-white/60">{hours}</p>}
        <div className="mt-8 flex flex-col gap-3">
          {hasPoint && (
            <button
              type="button"
              onClick={() => setPicker(true)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal px-6 text-sm font-semibold text-white transition-colors hover:bg-signal-600"
            >
              <Navigation size={16} /> Yo&apos;l ko&apos;rsatish
            </button>
          )}
          {phone && (
            <a
              href={`tel:${phone.replace(/[^\d+]/g, "")}`}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-white/25 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              <Phone size={16} /> {phone}
            </a>
          )}
        </div>
      </div>

      {picker && hasPoint && <AppPicker lat={lat} lng={lng} label={label} onClose={() => setPicker(false)} />}
    </div>
  );
}

/* ───────── Xarita ───────── */

function MapBox({ lat, lng, onPick }: { lat: number; lng: number; onPick: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  // Leaflet hodisasi eski `onPick` ni ushlab qolmasligi uchun ref orqali chaqiramiz
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let map: { remove?: () => void } | null = null;
    let cancelled = false;

    const start = () => {
      void loadLeaflet().then((L) => {
        if (cancelled || !L || !box.current || map) return;
        const m = L.map(box.current, { scrollWheelZoom: false });
        m.setView([lat, lng], 16);
        addTiles(L, m);

        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html: `<span style="display:block;width:22px;height:22px;border-radius:9999px;background:#ef7a1a;border:4px solid #fff;box-shadow:0 2px 10px rgba(23,35,61,.45)"></span>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        }).addTo(m);

        // Xaritani yoki nishonni bosish — ilova tanlash oynasi.
        // Leaflet `click` ni surish (drag) paytida chiqarmaydi, shuning uchun
        // xaritani odatdagidek surish va kattalashtirish ishlayveradi.
        m.on("click", () => pick.current());
        marker.on("click", () => pick.current());

        map = m as unknown as { remove?: () => void };
        setReady(true);
      });
    };

    // Ekranga yaqinlashguncha kutamiz — Leaflet CDN'dan keladi
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: "300px" });
    io.observe(el);

    return () => { cancelled = true; io.disconnect(); map?.remove?.(); };
  }, [lat, lng]);

  return (
    <div className="relative h-full min-h-[380px] w-full overflow-hidden rounded-lg border border-beton-200 bg-beton-100">
      <div ref={box} className="absolute inset-0 z-0 cursor-pointer" />
      {!ready ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-beton-500">Xarita yuklanmoqda…</div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          className="absolute top-4 right-4 z-10 inline-flex items-center gap-2 rounded-md bg-white/95 px-3.5 py-2 text-xs font-semibold text-beton-800 shadow-[0_2px_12px_rgba(23,35,61,0.18)] backdrop-blur-xs transition-colors hover:bg-white"
        >
          <Smartphone size={14} className="text-signal-dim" /> Xarita ilovasida ochish
        </button>
      )}
    </div>
  );
}

/** Nuqta belgilanmagan holat — mehmonga ERP ko'rsatmasi ko'rsatilmaydi. */
function MapMissing({ address }: { address: string }) {
  return (
    <div className="flex h-full min-h-[380px] flex-col items-center justify-center rounded-lg border border-beton-200 bg-beton-50 p-10 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-insof-900 text-signal">
        <MapPin size={24} />
      </span>
      <p className="mt-6 max-w-sm font-display text-xl font-bold text-beton-900">{address}</p>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-beton-500">
        Zavodga kelishdan oldin qo&apos;ng&apos;iroq qilib oling — yuk olib ketish tartibi va navbat aytiladi.
      </p>
      <a
        href={`https://yandex.uz/maps/?text=${encodeURIComponent(address)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-md bg-insof-900 px-6 text-sm font-semibold text-white transition-colors hover:bg-insof-700"
      >
        <MapPin size={16} /> Xaritada ochish
      </a>
    </div>
  );
}

/* ───────── Ilova tanlash ───────── */

type MapApp = { id: string; name: string; note: string; href: string; external: boolean };

/**
 * Qurilmada qaysi xarita ilovasi borligini brauzer aytmaydi, shuning uchun
 * ro'yxat tizimga qarab tuziladi:
 *  · Android — `geo:` sxemasi. Uni operatsion tizimning o'zi ushlaydi va
 *    o'rnatilgan barcha xarita ilovalarini ro'yxat qilib ko'rsatadi;
 *  · iPhone/Mac — Apple Kartalar (`maps.apple.com` ilovaga o'tkazadi);
 *  · qolganlari — veb havolalar. Telefonda ilova o'rnatilgan bo'lsa,
 *    Yandex/Google/2GIS havolalari o'zi ilovada ochiladi.
 */
function mapApps(lat: number, lng: number, label: string, os: "android" | "apple" | "other"): MapApp[] {
  const point = `${lat},${lng}`;
  const apps: MapApp[] = [];

  if (os === "android") {
    apps.push({
      id: "device",
      name: "Qurilmadagi xarita ilovasi",
      note: "Telefon o'zidagi ilovalar ro'yxatini beradi",
      href: `geo:${point}?q=${point}(${encodeURIComponent(label)})`,
      external: false,
    });
  }
  if (os === "apple") {
    apps.push({
      id: "apple",
      name: "Apple Kartalar",
      note: "Marshrut bilan ochiladi",
      href: `https://maps.apple.com/?daddr=${point}&dirflg=d`,
      external: false,
    });
  }

  apps.push(
    { id: "yandex", name: "Yandex Karta", note: "Marshrut bilan ochiladi", href: `https://yandex.uz/maps/?rtext=~${point}&rtt=auto`, external: true },
    { id: "google", name: "Google Xaritalar", note: "Marshrut bilan ochiladi", href: `https://www.google.com/maps/dir/?api=1&destination=${point}`, external: true },
    { id: "2gis", name: "2GIS", note: "Marshrut bilan ochiladi", href: `https://2gis.uz/directions/points/%7C${lng}%2C${lat}`, external: true },
  );
  return apps;
}

function AppPicker({ lat, lng, label, onClose }: { lat: number; lng: number; label: string; onClose: () => void }) {
  const [os, setOs] = useState<"android" | "apple" | "other">("other");
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Android/i.test(ua) ? "android" : /iPhone|iPad|iPod|Macintosh/i.test(ua) ? "apple" : "other");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const apps = mapApps(lat, lng, label, os);

  return (
    <div
      className="fixed inset-0 z-60 flex items-end justify-center bg-insof-900/60 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Xarita ilovasini tanlang"
        className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-[0_-8px_40px_rgba(23,35,61,0.25)] outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-bold text-beton-900">Qayerda ochamiz?</h3>
            <p className="mt-1 text-sm text-beton-500">{label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Yopish"
            className="-mt-1 -mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-beton-500 transition-colors hover:bg-beton-100 hover:text-beton-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {apps.map((a) => (
            <a
              key={a.id}
              href={a.href}
              {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={onClose}
              className="flex items-center gap-4 rounded-md border border-beton-200 px-4 py-3.5 transition-colors hover:border-insof-500 hover:bg-beton-50"
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-insof-900 text-signal">
                {a.id === "device" ? <Smartphone size={18} /> : <Navigation size={18} />}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-beton-900">{a.name}</span>
                <span className="block text-sm text-beton-500">{a.note}</span>
              </span>
            </a>
          ))}
        </div>

        <p className="mt-4 font-mono text-[11px] tracking-wide text-beton-400 tabular-nums">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </p>
      </div>
    </div>
  );
}
