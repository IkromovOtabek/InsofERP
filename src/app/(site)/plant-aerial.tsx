"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

/**
 * "Zavod tepadan" — hududning sun'iy yo'ldosh suratidan olingan joylashuv asosidagi
 * stilizatsiyalangan reja: temir yo'l chap tepada, markazda halqa yo'l bilan o'ralgan
 * tayyor mahsulot maydoni (ko'prik kran), atrofida sexlar, tugun, xomashyo va mikser parki.
 *
 * Harakat: poyezd, yo'ldagi mikser/panelovozlar (SVG `animateMotion`), kran, konveyer,
 * yuklagich (CSS). Ekrandan chiqqanda va `prefers-reduced-motion` da hammasi to'xtaydi.
 */

type Box = [x: number, y: number, w: number, h: number];
type Zone = { id: string; title: string; text: string; spot: [number, number]; boxes: Box[] };

const ZONES: Zone[] = [
  { id: "tugun", title: "Beton tuguni", text: "Sement siloslari, dozatorlar va konveyer — avtomatlashtirilgan qorish.", spot: [952, 50], boxes: [[874, 64, 160, 174]] },
  { id: "sex", title: "JBI sexlari", text: "Plita, ustun va rigellar qoliplarda quyilib, bug'lash kameralarida qotadi.", spot: [650, 115], boxes: [[458, 48, 384, 134], [188, 288, 164, 144], [848, 288, 304, 144]] },
  { id: "maydon", title: "Tayyor mahsulot maydoni", text: "Ko'prik kran mahsulotni saralaydi va transportga yuklab beradi.", spot: [600, 392], boxes: [[420, 240, 360, 300]] },
  { id: "xomashyo", title: "Xomashyo bazasi", text: "Qum va shag'al uyumlari — yuklagich bunkerlarga tashiydi.", spot: [1118, 146], boxes: [[1040, 36, 154, 206]] },
  { id: "park", title: "Mikser parki", text: "O'z mikserlarimiz — beton zavoddan to'g'ridan-to'g'ri obyektga.", spot: [868, 508], boxes: [[846, 492, 340, 206]] },
  { id: "lab", title: "Laboratoriya va ofis", text: "Har bir partiyadan namuna olinib, sinovdan o'tkaziladi.", spot: [132, 472], boxes: [[104, 456, 252, 196]] },
  { id: "temir", title: "Temir yo'l tarmog'i", text: "Sement va armatura vagonlarda to'g'ridan-to'g'ri hududga keladi.", spot: [144, 212], boxes: [] },
];

const RING = "M 460 220 H 740 A 60 60 0 0 1 800 280 V 500 A 60 60 0 0 1 740 560 H 460 A 60 60 0 0 1 400 500 V 280 A 60 60 0 0 1 460 220 Z";
const ROADS = [RING, "M 600 560 V 760", "M 800 260 H 1240", "M 800 460 H 1240", "M 400 534 H 326", "M 400 360 H 340"];

/** Transport yo'nalishlari (ko'rinmaydi, faqat `animateMotion` uchun) */
const ROUTES = {
  a: "M 600 760 V 580 Q 600 560 620 560 H 740 A 60 60 0 0 0 800 500 V 280 Q 800 260 820 260 H 1240",
  b: "M 600 760 V 580 Q 600 560 580 560 H 460 A 60 60 0 0 1 400 500 V 280 A 60 60 0 0 1 460 220 H 740 A 60 60 0 0 1 800 280 V 500 A 60 60 0 0 1 740 560 H 620 Q 600 560 600 580 V 760",
  c: "M 1240 460 H 820 Q 800 460 800 480 V 500 A 60 60 0 0 1 740 560 H 620 Q 600 560 600 580 V 760",
};

const TREES: [number, number, number][] = [
  [60, 660, 16], [96, 702, 13], [146, 684, 15], [372, 652, 14], [384, 704, 12], [470, 640, 13], [520, 692, 15],
  [700, 652, 14], [744, 702, 12], [782, 640, 13], [40, 520, 14], [58, 566, 11], [362, 108, 14], [400, 142, 12],
  [430, 186, 10], [830, 200, 9], [1186, 300, 12], [1180, 410, 10],
];

/** Tayyor mahsulot maydonidagi shtabellar: plita taxlamlari va quduq halqalari */
const STACKS = Array.from({ length: 7 * 6 }, (_, k) => {
  const i = k % 7, j = Math.floor(k / 7);
  return { x: 448 + i * 48, y: 276 + j * 42, skip: (i * 7 + j * 3) % 5 === 0, rings: (i + j) % 4 === 0 };
}).filter((s) => !s.skip);

const PARKED: [number, number, boolean][] = [
  [892, 532, true], [972, 532, false], [1052, 532, true], [1132, 532, false],
  [892, 596, false], [972, 596, true], [1052, 596, false], [1132, 596, true],
  [892, 660, true], [972, 660, false], [1052, 660, false],
];

const CSS = `
.pa-paused *, .pa-paused *::before { animation-play-state: paused !important; }
.pa-drum { animation: pa-dash 0.9s linear infinite; }
.pa-belt { animation: pa-dash 0.7s linear infinite; }
.pa-march { animation: pa-dash 1.2s linear infinite; }
@keyframes pa-dash { to { stroke-dashoffset: -28; } }
.pa-train { animation: pa-train 32s linear infinite; }
@keyframes pa-train { 0% { transform: translateX(-140px); } 60%, 100% { transform: translateX(920px); } }
.pa-crane { animation: pa-crane 18s ease-in-out infinite; }
@keyframes pa-crane { 0%, 100% { transform: translateX(0); } 25%, 40% { transform: translateX(140px); } 65%, 80% { transform: translateX(270px); } }
.pa-trolley { animation: pa-trolley 18s ease-in-out infinite; }
@keyframes pa-trolley { 0%, 100% { transform: translateY(0); } 25%, 40% { transform: translateY(150px); } 65%, 80% { transform: translateY(60px); } }
.pa-loader { animation: pa-loader 9s ease-in-out infinite; }
@keyframes pa-loader { 0%, 100% { transform: translate(0, 0); } 40%, 55% { transform: translate(44px, -48px); } }
.pa-glow { animation: pa-glow 3.2s ease-in-out infinite; }
@keyframes pa-glow { 0%, 100% { opacity: .25; } 50% { opacity: .7; } }
.pa-puff, .pa-pulse { transform-box: fill-box; transform-origin: center; }
.pa-puff { animation: pa-puff 3s ease-out infinite; }
@keyframes pa-puff { from { transform: scale(1); opacity: .45; } to { transform: scale(3); opacity: 0; } }
.pa-pulse { animation: pa-pulse 2s ease-out infinite; }
@keyframes pa-pulse { from { transform: scale(1); opacity: .7; } to { transform: scale(2.4); opacity: 0; } }
.pa-barrier { transform-box: fill-box; transform-origin: left center; animation: pa-barrier 11s ease-in-out infinite; }
@keyframes pa-barrier { 0%, 30%, 70%, 100% { transform: rotate(0); } 40%, 60% { transform: rotate(-80deg); } }
`;

export function PlantAerial() {
  const wrap = useRef<HTMLDivElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const inView = useInView(wrap, { margin: "200px 0px" });
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  /** Foydalanuvchi o'zi tanlasa — avtomatik sayohat bir muddat to'xtaydi */
  const [holdUntil, setHoldUntil] = useState(0);
  const running = inView && !reduce;

  // SMIL (`animateMotion`) CSS bilan to'xtamaydi — SVG API orqali
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    if (running) el.unpauseAnimations();
    else el.pauseAnimations();
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (Date.now() < holdUntil) return;
      setActive((a) => (a + 1) % ZONES.length);
    }, 4500);
    return () => clearInterval(t);
  }, [running, holdUntil]);

  const pick = (i: number) => {
    setActive(i);
    setHoldUntil(Date.now() + 12000);
  };

  const zone = ZONES[active];

  return (
    <div ref={wrap} className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <style>{CSS}</style>
      <div className={`relative overflow-hidden rounded-3xl bg-[#15213b] ring-1 ring-white/10 ${running ? "" : "pa-paused"}`}>
        <svg ref={svg} viewBox="0 0 1200 720" className="block h-auto w-full" role="img" aria-label="Insof JBI zavodi hududining tepadan ko'rinishi">
          <defs>
            <pattern id="pa-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 H 0 V 40" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
            </pattern>
            <radialGradient id="pa-silo" cx="35%" cy="35%" r="70%">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#9aa1b1" />
            </radialGradient>
            <radialGradient id="pa-sand" cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#ecd0a0" />
              <stop offset="1" stopColor="#a8834c" />
            </radialGradient>
            <radialGradient id="pa-gravel" cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#c3beb3" />
              <stop offset="1" stopColor="#6f6a61" />
            </radialGradient>
            <radialGradient id="pa-vignette" cx="50%" cy="50%" r="75%">
              <stop offset="0.6" stopColor="#0b1222" stopOpacity="0" />
              <stop offset="1" stopColor="#0b1222" stopOpacity="0.75" />
            </radialGradient>
            {Object.entries(ROUTES).map(([k, d]) => <path key={k} id={`pa-route-${k}`} d={d} fill="none" />)}
          </defs>

          {/* Yer */}
          <rect width="1200" height="720" fill="#15213b" />
          <path d="M -17 405 L 443 -15 L 1200 -15 L 1200 720 L 0 720 Z" fill="#1a2846" />
          <rect width="1200" height="720" fill="url(#pa-grid)" />

          {/* Temir yo'l */}
          <g transform="translate(-40 380) rotate(-42.4)">
            <rect x="-60" y="-34" width="760" height="68" fill="#202c49" />
            {[-18, 0, 18].map((y) => (
              <g key={y}>
                <line x1="-60" x2="700" y1={y} y2={y} stroke="#3a4665" strokeWidth="11" strokeDasharray="2.5 6" />
                <line x1="-60" x2="700" y1={y - 3.5} y2={y - 3.5} stroke="#8d96ab" strokeWidth="1.3" />
                <line x1="-60" x2="700" y1={y + 3.5} y2={y + 3.5} stroke="#8d96ab" strokeWidth="1.3" />
              </g>
            ))}
            {active === 6 && <rect x="-60" y="-34" width="760" height="68" rx="14" fill="rgba(255,138,31,0.08)" stroke="#ff8a1f" strokeWidth="2" strokeDasharray="8 6" className="pa-march" />}
            <g className="pa-train">
              <rect x="0" y="-8" width="46" height="16" rx="3" fill="#e4e7ee" />
              <rect x="30" y="-8" width="16" height="16" rx="3" fill="#ff8a1f" />
              {Array.from({ length: 5 }, (_, i) => (
                <g key={i} transform={`translate(${-46 * (i + 1)} 0)`}>
                  <rect x="0" y="-7.5" width="42" height="15" rx="2" fill="#6d7690" />
                  <circle cx="11" cy="0" r="5" fill="#8f98ae" />
                  <circle cx="31" cy="0" r="5" fill="#8f98ae" />
                </g>
              ))}
            </g>
          </g>
          {/* Shoxobcha armatura sexiga */}
          <path d="M 90 261 Q 150 300 200 332" fill="none" stroke="#8d96ab" strokeWidth="1.3" strokeDasharray="3 3" />
          {/* To'siq */}
          <line x1="-17" y1="405" x2="443" y2="-15" stroke="#5b6789" strokeWidth="1.5" strokeDasharray="6 5" />

          {/* Yo'llar */}
          {ROADS.map((d, i) => <path key={`r${i}`} d={d} fill="none" stroke="#2c3b5f" strokeWidth="28" strokeLinejoin="round" />)}
          {ROADS.map((d, i) => <path key={`c${i}`} d={d} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" strokeDasharray="10 10" />)}
          {/* Avtotarozi va KPP */}
          <rect x="586" y="610" width="28" height="44" rx="2" fill="#3c4b70" stroke="#56658c" />
          <rect x="626" y="672" width="28" height="22" rx="3" fill="#dfe3ea" />
          <line x1="586" y1="700" x2="615" y2="700" stroke="#ff8a1f" strokeWidth="3" strokeLinecap="round" className="pa-barrier" />

          {/* Daraxtlar */}
          {TREES.map(([x, y, r], i) => (
            <g key={i}>
              <circle cx={x + 3} cy={y + 4} r={r} fill="rgba(0,0,0,0.3)" />
              <circle cx={x} cy={y} r={r} fill="#2d5641" />
              <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.55} fill="#3c7052" />
            </g>
          ))}

          {/* JBI sexlari: asosiy angar, armatura sexi, o'ng angar */}
          <Hall x={470} y={60} w={360} h={110} />
          <Hall x={200} y={300} w={140} h={120} />
          <Hall x={860} y={300} w={280} h={120} />

          {/* Tayyor mahsulot maydoni */}
          <rect x="425" y="245" width="350" height="290" rx="26" fill="#25324f" />
          <line x1="432" x2="768" y1="258" y2="258" stroke="#8d96ab" strokeWidth="2" />
          <line x1="432" x2="768" y1="522" y2="522" stroke="#8d96ab" strokeWidth="2" />
          {STACKS.map((s, i) => (
            <g key={i} transform={`translate(${s.x} ${s.y})`}>
              <rect x="3" y="4" width="36" height="24" rx="2" fill="rgba(0,0,0,0.35)" />
              {s.rings ? (
                <>
                  <circle cx="9" cy="12" r="8" fill="none" stroke="#c9cdd5" strokeWidth="4" />
                  <circle cx="27" cy="12" r="8" fill="none" stroke="#c9cdd5" strokeWidth="4" />
                </>
              ) : (
                <>
                  <rect width="36" height="24" rx="2" fill="#b7bcc6" />
                  {[6, 12, 18].map((ly) => <line key={ly} x1="1" x2="35" y1={ly} y2={ly} stroke="#99a0ad" strokeWidth="1" />)}
                </>
              )}
            </g>
          ))}
          {/* Ko'prik kran */}
          <g transform="translate(470 0)">
            <g className="pa-crane">
              <rect x="-4" y="254" width="12" height="276" fill="rgba(0,0,0,0.3)" />
              <rect x="-8" y="250" width="12" height="276" fill="#ff8a1f" />
              <rect x="-15" y="250" width="26" height="12" rx="2" fill="#c75f00" />
              <rect x="-15" y="516" width="26" height="12" rx="2" fill="#c75f00" />
              <g className="pa-trolley">
                <rect x="-22" y="296" width="40" height="18" rx="2" fill="#d6dae2" stroke="#ffffff" strokeWidth="1" />
                <rect x="-13" y="282" width="22" height="22" rx="2" fill="#ffd08a" />
              </g>
            </g>
          </g>

          {/* Beton tuguni */}
          {[898, 934, 970, 1006].map((x) => (
            <g key={x}>
              <circle cx={x + 3} cy={96} r="15" fill="rgba(0,0,0,0.35)" />
              <circle cx={x} cy={92} r="15" fill="url(#pa-silo)" stroke="#7e8699" />
              <circle cx={x} cy={92} r="3" fill="#7e8699" />
            </g>
          ))}
          <rect x="929" y="146" width="50" height="50" fill="rgba(0,0,0,0.35)" />
          <rect x="925" y="140" width="50" height="50" rx="2" fill="#e8eaee" />
          <rect x="937" y="152" width="26" height="26" fill="#46516e" />
          <circle cx="950" cy="165" r="9" fill="#ffffff" className="pa-puff" />
          <rect x="936" y="190" width="28" height="40" fill="#3a4870" stroke="#56658c" />
          <line x1="1062" y1="198" x2="975" y2="162" stroke="#56628a" strokeWidth="7" strokeLinecap="round" />
          <line x1="1062" y1="198" x2="975" y2="162" stroke="#ff8a1f" strokeOpacity="0.75" strokeWidth="2.5" strokeDasharray="6 8" className="pa-belt" />

          {/* Xomashyo bazasi */}
          <ellipse cx="1094" cy="92" rx="42" ry="34" fill="url(#pa-sand)" />
          <ellipse cx="1162" cy="104" rx="32" ry="28" fill="url(#pa-gravel)" />
          <ellipse cx="1150" cy="182" rx="36" ry="26" fill="url(#pa-sand)" opacity="0.85" />
          {[0, 1, 2, 3].map((i) => <rect key={i} x={1050 + i * 16} y="196" width="13" height="32" rx="1" fill="#46516e" stroke="#6b7799" />)}
          <g transform="translate(1076 168)">
            <g className="pa-loader">
              <rect x="-11" y="-7" width="22" height="14" rx="2" fill="#ffc23d" />
              <rect x="-15" y="-8" width="4" height="16" rx="1" fill="#e0a520" />
              <rect x="2" y="-5" width="7" height="10" rx="1" fill="#2a3350" />
            </g>
          </g>

          {/* Laboratoriya va ofis */}
          <rect x="130" y="492" width="200" height="96" fill="rgba(0,0,0,0.35)" />
          <rect x="124" y="486" width="200" height="96" rx="3" fill="#e6e8ec" />
          <rect x="140" y="500" width="70" height="68" rx="2" fill="#d2d6de" />
          <rect x="226" y="500" width="84" height="30" rx="2" fill="#d2d6de" />
          {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={136 + i * 30} y="604" width="20" height="11" rx="3" fill={i % 3 === 0 ? "#ff8a1f" : i % 2 ? "#cfd4dd" : "#6d7690"} />)}

          {/* Mikser parki */}
          <rect x="850" y="496" width="332" height="198" rx="14" fill="#223050" />
          {[564, 628].map((y) => <line key={y} x1="862" x2="1170" y1={y} y2={y} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 6" />)}
          {PARKED.map(([x, y, spin], i) => <g key={i} transform={`translate(${x} ${y})`}><Mixer spin={spin} /></g>)}

          {/* Harakatdagi transport */}
          <Vehicle route="a" dur={22} begin={0}><Mixer spin /></Vehicle>
          <Vehicle route="a" dur={22} begin={-11}><Mixer spin /></Vehicle>
          <Vehicle route="b" dur={30} begin={-4}><Flatbed /></Vehicle>
          <Vehicle route="c" dur={20} begin={-8}><Mixer spin /></Vehicle>

          {/* Faol hudud */}
          {zone.boxes.map(([x, y, w, h], i) => (
            <rect key={`${zone.id}${i}`} x={x} y={y} width={w} height={h} rx="16" fill="rgba(255,138,31,0.07)" stroke="#ff8a1f" strokeWidth="2" strokeDasharray="8 6" className="pa-march" />
          ))}

          <rect width="1200" height="720" fill="url(#pa-vignette)" pointerEvents="none" />

          {/* Belgilar */}
          {ZONES.map((z, i) => (
            <g key={z.id} transform={`translate(${z.spot[0]} ${z.spot[1]})`} className="cursor-pointer" onMouseEnter={() => pick(i)} onClick={() => pick(i)}>
              {i === active && <circle r="16" fill="#ff8a1f" className="pa-pulse" />}
              <circle r="16" fill={i === active ? "#ff8a1f" : "#1b2a4c"} stroke="#ff8a1f" strokeWidth="2.5" />
              <text textAnchor="middle" dy="5.5" fontSize="15" fontWeight="700" fill="#ffffff">{i + 1}</text>
            </g>
          ))}
          <Pill zone={zone} />
        </svg>

        <div className="pointer-events-none absolute top-3 left-3 hidden rounded-full sm:block bg-black/40 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-white/80 uppercase backdrop-blur sm:top-5 sm:left-5 sm:text-[11px]">
          Insof JBI · tepadan ko&apos;rinish
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 hidden size-9 sm:grid place-items-center rounded-full bg-black/40 text-white/80 backdrop-blur sm:bottom-5 sm:left-5 sm:size-11" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-5 sm:size-6"><path d="M12 3 L16 13 H8 Z" fill="#ff8a1f" /><path d="M12 21 L8 13 H16 Z" fill="currentColor" opacity=".5" /></svg>
        </div>
      </div>

      {/* Mobil: bitta karta — balandligi o'zgarmaydi, sahifa sakramaydi */}
      <div className="flex min-h-[9rem] items-start gap-3 rounded-2xl bg-white/10 px-4 py-4 ring-1 ring-signal/60 lg:hidden" aria-live="polite">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-signal text-xs font-bold text-white">{active + 1}</span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-white">{zone.title}</span>
          <span className="mt-1 block text-sm leading-relaxed text-white/60">{zone.text}</span>
          <span className="mt-2 -ml-1.5 flex">
            {ZONES.map((z, i) => (
              <button key={z.id} type="button" aria-label={z.title} onClick={() => pick(i)} className="p-1.5">
                <span className={`block size-2 rounded-full ${i === active ? "bg-signal" : "bg-white/25"}`} />
              </button>
            ))}
          </span>
        </span>
      </div>

      <ol className="hidden content-start gap-2 lg:grid">
        {ZONES.map((z, i) => {
          const on = i === active;
          return (
            <li key={z.id}>
              <button
                type="button"
                onMouseEnter={() => pick(i)}
                onFocus={() => pick(i)}
                onClick={() => pick(i)}
                className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${on ? "bg-white/10 ring-1 ring-signal/60" : "hover:bg-white/5"}`}
              >
                <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${on ? "bg-signal text-white" : "bg-white/10 text-white/70"}`}>{i + 1}</span>
                <span>
                  <span className={`block text-sm font-semibold ${on ? "text-white" : "text-white/75"}`}>{z.title}</span>
                  {on && <span className="mt-1 block text-sm leading-relaxed text-white/60">{z.text}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Hall({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const ribs = Array.from({ length: Math.floor(w / 16) - 1 }, (_, i) => x + 16 * (i + 1));
  return (
    <g>
      <rect x={x + 8} y={y + 10} width={w} height={h} fill="rgba(0,0,0,0.35)" />
      <rect x={x} y={y} width={w} height={h} rx="3" fill="#cfd4dd" />
      {ribs.map((rx) => <line key={rx} x1={rx} x2={rx} y1={y + 2} y2={y + h - 2} stroke="#b4bac7" strokeWidth="1" />)}
      <rect x={x} y={y + h / 2 - 5} width={w} height="10" fill="#ff8a1f" className="pa-glow" />
      <rect x={x} y={y} width={w} height={h} rx="3" fill="none" stroke="#e9ecf1" strokeWidth="1.5" />
    </g>
  );
}

/** Mikser (tepadan), +x yo'nalishiga qaragan */
function Mixer({ spin = false }: { spin?: boolean }) {
  return (
    <g>
      <rect x="-23" y="-5" width="50" height="16" rx="3" fill="rgba(0,0,0,0.35)" />
      <rect x="-26" y="-8" width="38" height="16" rx="2" fill="#3b4560" />
      <ellipse cx="-8" cy="0" rx="17" ry="7.5" fill="#ff8a1f" />
      <line x1="-22" x2="6" y1="0" y2="0" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="3" strokeDasharray="4 5" className={spin ? "pa-drum" : undefined} />
      <rect x="12" y="-8" width="13" height="16" rx="3" fill="#f4f5f7" />
      <rect x="20" y="-6" width="4" height="12" rx="1" fill="#2a3350" />
    </g>
  );
}

/** Panelovoz — plita ortilgan */
function Flatbed() {
  return (
    <g>
      <rect x="-27" y="-5" width="58" height="16" rx="3" fill="rgba(0,0,0,0.35)" />
      <rect x="-30" y="-8" width="44" height="16" rx="2" fill="#46516e" />
      <rect x="-27" y="-6" width="38" height="12" fill="#c4c8d0" />
      <line x1="-14" x2="-14" y1="-6" y2="6" stroke="#9aa0ac" />
      <line x1="-1" x2="-1" y1="-6" y2="6" stroke="#9aa0ac" />
      <rect x="16" y="-8" width="13" height="16" rx="3" fill="#f4f5f7" />
      <rect x="24" y="-6" width="4" height="12" rx="1" fill="#2a3350" />
    </g>
  );
}

function Vehicle({ route, dur, begin, children }: { route: keyof typeof ROUTES; dur: number; begin: number; children: React.ReactNode }) {
  return (
    <g>
      {children}
      <animateMotion dur={`${dur}s`} begin={`${begin}s`} repeatCount="indefinite" rotate="auto">
        <mpath href={`#pa-route-${route}`} />
      </animateMotion>
    </g>
  );
}

function Pill({ zone }: { zone: Zone }) {
  const [sx, sy] = zone.spot;
  const w = zone.title.length * 8.4 + 28;
  const left = sx > 900;
  const x = left ? sx - 26 - w : sx + 26;
  const y = Math.max(8, sy - 17);
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height="34" rx="17" fill="#0f1a30" fillOpacity="0.92" stroke="#ff8a1f" strokeOpacity="0.6" />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" fontSize="15" fontWeight="600" fill="#ffffff">{zone.title}</text>
    </g>
  );
}
