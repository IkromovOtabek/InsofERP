"use client";

import { useRef, useState } from "react";
import { Loader2, LocateFixed } from "lucide-react";
import type { LLayer, LMap } from "@/lib/leaflet";

/**
 * "Men qayerdaman?" — xaritadagi joriy joylashuv tugmasi.
 *
 * Xarita ishlatadigan hamma joyda bitta shu komponent qo'yiladi: brauzerdan
 * joylashuvni so'raydi, ko'k nuqta va aniqlik doirasini chizadi, xaritani o'sha
 * joyga suradi.
 *
 * Tugma xaritaning o'zida emas, ustidagi qatlamda turadi — shuning uchun
 * xaritaning `click` hodisasi (masalan, nuqta belgilash) ishga tushmaydi.
 * Joylashtirish uchun o'rovchi element `relative` bo'lishi kerak.
 *
 * Eslatma: brauzer geolokatsiyasi faqat xavfsiz manbada (HTTPS yoki localhost)
 * ishlaydi — VPS'da sayt HTTPS'da bo'lgani uchun muammo yo'q, lekin telefondan
 * `http://IP:3000` orqali ochilganda tugma ruxsat so'ray olmaydi va buni
 * foydalanuvchiga aytib qo'yamiz.
 */

const DOT_COLOR = "#009ef5";

export function MapLocateButton({
  getMap,
  onLocated,
  label = "Men qayerdaman",
  className = "absolute top-3 right-3 z-[1000]",
}: {
  /** Xarita hali qurilmagan bo'lishi mumkin — shuning uchun qiymat emas, funksiya */
  getMap: () => LMap | null;
  /** Joylashuv topilganda — masalan, nuqtani shu yerga qo'yish uchun */
  onLocated?: (p: { lat: number; lng: number; accuracy: number }) => void;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Oldingi chaqiruvdan qolgan nuqta va doira — qaytadan bosilganda almashtiriladi */
  const layers = useRef<LLayer[]>([]);

  const locate = () => {
    const m = getMap();
    const L = typeof window !== "undefined" ? window.L : null;
    if (!m || !L) return;

    if (!navigator.geolocation) {
      setError("Brauzer joylashuvni qo'llab-quvvatlamaydi");
      return;
    }
    if (!window.isSecureContext) {
      setError("Joylashuv faqat HTTPS orqali ochilganda ishlaydi");
      return;
    }

    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const { latitude, longitude, accuracy } = pos.coords;
        const at: [number, number] = [latitude, longitude];

        for (const l of layers.current) m.removeLayer(l);
        layers.current = [
          // Aniqlik doirasi metrda — shahar ichida bir necha o'n metr bo'ladi
          L.circle(at, { radius: Math.max(accuracy, 15), color: DOT_COLOR, weight: 1, fillColor: DOT_COLOR, fillOpacity: 0.12 }).addTo(m),
          L.circleMarker(at, { radius: 7, color: "#fff", weight: 3, fillColor: DOT_COLOR, fillOpacity: 1 })
            .addTo(m)
            .bindTooltip("Siz shu yerdasiz"),
        ];

        // Juda aniq bo'lmasa ortiqcha yaqinlashtirmaymiz — aks holda nuqta
        // "aniq" tuyuladi, aslida esa bir necha yuz metr xato bo'lishi mumkin
        m.setView(at, accuracy > 500 ? 13 : 16);
        onLocated?.({ lat: latitude, lng: longitude, accuracy });
      },
      (err) => {
        setBusy(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Joylashuvga ruxsat berilmadi — brauzer sozlamasidan ruxsat bering"
            : err.code === err.TIMEOUT
              ? "Joylashuv topilmadi — qayta urinib ko'ring"
              : "Joylashuvni aniqlab bo'lmadi",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={locate}
        disabled={busy}
        title="Joriy joylashuvimni ko'rsatish"
        aria-label="Joriy joylashuvimni ko'rsatish"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-[0_2px_10px_rgba(15,23,42,0.16)] transition-colors hover:bg-slate-50 disabled:opacity-70"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} className="text-sky-600" />}
        <span>{label}</span>
      </button>

      {error && (
        <p className="mt-1.5 max-w-52 rounded-md bg-white px-2 py-1.5 text-[11px] leading-snug text-amber-700 shadow-[0_2px_10px_rgba(15,23,42,0.16)]">
          {error}
        </p>
      )}
    </div>
  );
}
