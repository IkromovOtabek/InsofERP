"use client";

import { useRef, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";

export type Clip = { src: string; poster: string; title: string; text: string; meta: string };

/**
 * Zavod lentasi. Sahifa ochilishi og'ir bo'lmasin uchun video bosilmaguncha
 * (yoki sichqoncha ustiga kelmaguncha) yuklanmaydi — ekranda faqat surat turadi.
 * Izohlar kadr ustiga emas, ostiga chiqarilgan: surat to'sib qo'yilmaydi va
 * matn nakladnoy yozuvidek o'qiladi.
 */
export function Showreel({ clips }: { clips: Clip[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {clips.map((c, i) => <ClipCard key={c.src} clip={c} index={i + 1} />)}
    </div>
  );
}

function ClipCard({ clip, index }: { clip: Clip; index: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const play = () => {
    const v = ref.current;
    if (!v) return;
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const pause = () => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
  };

  // Ish stolida sichqoncha ustiga kelganda ovozsiz o'ynaydi — lenta jonli ko'rinadi.
  // Harakatni kamaytirish yoqilgan bo'lsa tegmaymiz.
  const hoverPlay = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!playing && ref.current?.muted !== false) play();
  };
  const hoverStop = () => {
    if (playing && ref.current?.muted) pause();
  };

  return (
    <figure className="group overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10" onMouseEnter={hoverPlay} onMouseLeave={hoverStop}>
      <div className="relative overflow-hidden">
        <video
          ref={ref}
          src={clip.src}
          poster={clip.poster}
          preload="none"
          muted={muted}
          loop
          playsInline
          onClick={() => (playing ? pause() : play())}
          className="aspect-9/16 w-full cursor-pointer object-cover brightness-[0.92] transition duration-700 group-hover:brightness-100"
        />

        {!playing && (
          <button
            type="button"
            onClick={play}
            className="absolute inset-0 flex items-end bg-insof-900/25 p-5 transition-colors hover:bg-insof-900/10"
            aria-label={`${clip.title} — videoni ko'rish`}
          >
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-signal text-white transition-transform duration-300 group-hover:scale-105">
              <Play size={18} fill="currentColor" />
            </span>
          </button>
        )}

        {playing && (
          <button
            type="button"
            onClick={() => { const v = ref.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); }}
            className="absolute right-4 bottom-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-insof-900/70 text-white backdrop-blur-xs transition-colors hover:bg-signal hover:text-white"
            aria-label={muted ? "Ovozni yoqish" : "Ovozni o'chirish"}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        )}
      </div>

      <figcaption className="flex gap-4 px-5 py-5">
        <span className="pt-1 font-mono text-[11px] text-signal tabular-nums">{String(index).padStart(2, "0")}</span>
        <div>
          <div className="font-display text-lg font-bold text-white">{clip.title}</div>
          <div className="mt-1 text-sm leading-relaxed text-white/50">{clip.text}</div>
          <div className="mt-3 font-mono text-[10px] tracking-[0.14em] text-white/30 uppercase">{clip.meta}</div>
        </div>
      </figcaption>
    </figure>
  );
}
