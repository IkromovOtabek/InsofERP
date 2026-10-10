"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogIn, Moon, Sun } from "lucide-react";
import type { World } from "./insof-world";
import { MODES, STN, THEMES, type Mode, type ThemeName } from "./content";
import "./tour.css";

/**
 * Bosh sahifa tepasi — zavod bo'ylab skroll bilan boshqariladigan 3D tur (dizayn: design_handoff_insof_landing, README).
 *
 *   · sahna (`insof-world.js`, three.js) `position:fixed` — kamera skroll bo'yicha 7 bekat bo'ylab uchadi;
 *   · ustida: 3D belgi (sahna har kadr uni faol qadam nuqtasiga siljitadi), bekat kartasi, "pastga aylantiring";
 *   · 950vh bo'sh "trek" skrollni beradi; undan keyin `children` (saytning haqiqiy bo'limlari) sahna ustidan chiqadi.
 *
 * Skroll → kamera xaritasi README'dagidek aniq (DW — ofis ichida qo'shimcha skroll). Holat faqat bekat almashganda,
 * ofis qadamida va 250 ms dagi faza so'rovida yangilanadi — har kadrda setState yo'q (sahna o'z rAF'ida aylanadi).
 * WebGL yo'q bo'lsa — sahna o'rnida statik zavod surati, qolgan hammasi ishlayveradi.
 *
 * Telefonda (≤ 767px) 3D tur umuman yo'q: three.js yuklanmaydi, o'rniga oddiy statik hero (`MobileHero`).
 * Qaysi biri ko'rinishi CSS media so'rovida (`.it-3d` / `.it-mhero`) — server chizgan HTML'da ham telefonda bir lahza
 * 3D tartib chiqib qolmaydi.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const LS = "insof-theme-v3";
const DW = 2.5, TOTAL = 6 + DW;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** tour.css dagi `.it-3d` / `.it-mhero` chegarasi bilan bir xil */
const MOBILE_Q = "(max-width: 767px)";

type Scroll = { active: number; p: number; f: number; ostep: number; ofrac: number; ui: number; vw: number; vh: number };

export function FactoryTour({ fontFamily, children }: { fontFamily: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);

  const [sc, setSc] = useState<Scroll>({ active: 0, p: 0, f: 0, ostep: 0, ofrac: 0, ui: 1, vw: 1400, vh: 900 });
  const scRef = useRef(sc); scRef.current = sc;
  const [shown, setShown] = useState(0);
  const [cardOn, setCardOn] = useState(true);
  const [phase, setPhase] = useState({ step: 0, frac: 0 });
  const phaseRef = useRef(phase); phaseRef.current = phase;
  // Rang tanlovi olib tashlangan — sayt doim brend rangida; foydalanuvchi faqat yorug'/qorong'i rejimni tanlaydi
  const theme: ThemeName = "Insof";
  const [mode, setMode] = useState<Mode>("light");
  const [noGl, setNoGl] = useState(false);

  // Saqlangan mavzu (Kun/Tun va rang) — birinchi chizishdan keyin
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || "{}") as { mode?: Mode };
      if (saved.mode === "light" || saved.mode === "dark") setMode(saved.mode);
    } catch { /* shaxsiy rejimda localStorage yopiq bo'lishi mumkin */ }
  }, []);

  // Mavzu → CSS o'zgaruvchilari (faqat shu ildizda) va sahna rangi/kayfiyati
  useEffect(() => {
    const t = THEMES[theme], m = MODES[mode], r = rootRef.current?.style;
    if (r) {
      r.setProperty("--acc", t.acc); r.setProperty("--acc-ink", t.ink); r.setProperty("--acc-text", mode === "dark" ? t.light : t.acc);
      for (const [k, v] of Object.entries(m)) r.setProperty(`--${k}`, v);
    }
    worldRef.current?.setAccent(t.acc);
    worldRef.current?.setMood(mode === "dark" ? "night" : "day");
    try { localStorage.setItem(LS, JSON.stringify({ mode })); } catch { /* yuqoridagidek */ }
  }, [theme, mode]);

  const range = useCallback(() => Math.max(1, (trackRef.current?.offsetHeight ?? innerHeight * 9.5) - innerHeight), []);

  const swapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollNow = useCallback(() => {
    const R = range(), y = window.scrollY;
    const p = clamp01(y / R) * TOTAL;
    const f = p < 1 ? p : p < 1 + DW ? 1 : p - DW;
    const ou = p < 1 ? 0 : p < 1 + DW ? (p - 1) / DW : 1;
    const ostep = Math.min(4, Math.floor(ou * 5)), ofrac = clamp01(ou * 5 - ostep);
    const ui = 1 - clamp01((y - R) / (innerHeight * 0.35));
    worldRef.current?.setProgress(f);
    worldRef.current?.setOffice(ou);
    const active = Math.round(f), s = scRef.current, vw = innerWidth, vh = innerHeight;
    if (active !== s.active) {
      if (swapRef.current) clearTimeout(swapRef.current);
      setCardOn(false);
      swapRef.current = setTimeout(() => { setShown(scRef.current.active); setCardOn(true); }, 320);
    }
    if (active !== s.active || Math.abs(p - s.p) > 0.02 || ostep !== s.ostep || Math.abs(ofrac - s.ofrac) > 0.04 || Math.abs(ui - s.ui) > 0.02 || (ui === 0) !== (s.ui === 0) || vw !== s.vw || vh !== s.vh) {
      const next = { active, p, f, ostep, ofrac, ui, vw, vh };
      scRef.current = next;
      setSc(next);
    }
  }, [range]);

  useEffect(() => {
    let raf = 0, dead = false;
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; scrollNow(); }); };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    const ro = new ResizeObserver(onScroll); ro.observe(document.documentElement);
    scrollNow(); // birinchi o'lchov darhol (rAF kutmasdan) — telefonda bir lahza kompyuter tartibi chiqmasin

    // Sahna — faqat brauzerda, alohida chunk (three.js ~600 KB faqat bosh sahifada yuklanadi).
    // Telefonda yaratilmaydi; ekran kengaysa (planshetni burish, oynani kattalashtirish) o'shanda yaratiladi.
    const mq = matchMedia(MOBILE_Q);
    let mounting = false;
    const mount = async () => {
      if (mounting || mq.matches) return;
      mounting = true;
      mq.removeEventListener("change", mount);
      try {
        // Kanvas yozuvlari Archivo bilan chizilsin — shrift yuklanib bo'lgach
        await document.fonts?.load(`700 32px ${fontFamily}`).catch(() => undefined);
        const m = await import("./insof-world");
        if (dead || !stageRef.current) return;
        const w = m.mountWorld(stageRef.current, { font: fontFamily });
        worldRef.current = w;
        w.setMarker(markerRef.current);
        w.setAccent(THEMES[theme].acc);
        w.setMood(mode === "dark" ? "night" : "day");
        onScroll();
      } catch (e) {
        console.error("[tur] 3D sahna ishga tushmadi:", e);
        if (!dead) setNoGl(true);
      }
    };
    if (mq.matches) mq.addEventListener("change", mount);
    else void mount();

    const poll = setInterval(() => {
      const w = worldRef.current;
      if (!w) return;
      const ph = w.getPhase(), cur = phaseRef.current;
      if (ph.step !== cur.step || Math.abs(ph.frac - cur.frac) > 0.1) setPhase(ph);
    }, 250);

    return () => {
      dead = true;
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      mq.removeEventListener("change", mount);
      ro.disconnect(); cancelAnimationFrame(raf); clearInterval(poll);
      if (swapRef.current) clearTimeout(swapRef.current);
      worldRef.current?.dispose(); worldRef.current = null;
    };
    // Sahna bir marta yaratiladi; mavzu alohida effektda qo'llanadi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNow, fontFamily]);

  const goTo = (i: number) => {
    const p = i <= 1 ? i : i + DW;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: (range() * p) / TOTAL, behavior: reduce ? "auto" : "smooth" });
  };

  // ── Ko'rsatish qiymatlari (dizayndagi renderVals) ──
  const { active, ui, vw, vh } = sc;
  const step = active === 1 ? sc.ostep : phase.step, frac = active === 1 ? sc.ofrac : phase.frac;
  const c = STN[shown]!, live = STN[active]!;
  // wide — dizayndagi 4 bo'lim havolasi; xwide — qo'shimcha "Taqdimot" (sig'magan joyda yashirin). Kirish — doim ikonka
  const compact = vh < 620, tall = vh >= 760, wide = vw >= 1240, xwide = vw >= 1520;
  // Telefon: sarlavha bitta qatorda (logo + "Narx so'rash"), karta tavsifsiz — sarlavha bilan ustma-ust tushmasin
  const narrow = vw < 640;
  const markerLabel = (live.steps[step] ?? live.steps[0]!)[0];
  const h1Size = vh < 620 ? "24px" : vh < 760 ? "clamp(26px,2.8vw,34px)" : "clamp(32px,3.5vw,50px)";
  const isLast = shown === STN.length - 1;
  const mono: CSSProperties = { fontFamily: "var(--font-jet-mono), 'JetBrains Mono', monospace" };
  const pill: CSSProperties = { background: "var(--surface)", borderRadius: 12, boxShadow: "0 6px 24px var(--shadow)" };
  const iconBtn: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: narrow ? 36 : 40, height: narrow ? 36 : 40, borderRadius: 8, color: "var(--ink)" };

  return (
    <div ref={rootRef} className="it-root">
      <div className="it-ui">
        <div className="it-3d">
        {/* Sahna */}
        {/* Sayt bo'limlari sahnani to'liq yopganda (ui = 0) sahna yashiriladi: o'lchami 0 bo'lgan konteynerda
            `insof-world.js` chizmaydi — GPU bo'shaydi va pastdagi bo'limlar skroll paytida "yo'qolib" qolmaydi */}
        <div ref={stageRef} aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, background: "var(--bg)", display: ui === 0 ? "none" : "block" }}>
          {noGl && <Image src="/media/hero.jpg" alt="" fill priority sizes="100vw" style={{ objectFit: "cover" }} />}
        </div>
        <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", background: "radial-gradient(ellipse 85% 80% at 55% 45%, rgba(8,12,18,0) 60%, rgba(8,12,18,0.2) 100%)" }} />

        {/* 3D belgi — sahna har kadr siljitadi */}
        <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden", opacity: ui }}>
          <div ref={markerRef} style={{ position: "absolute", left: 0, top: 0, willChange: "transform", opacity: 0, transition: "opacity .3s" }}>
            <div className="it-pulse" style={{ position: "absolute", left: -9, top: -9, width: 18, height: 18, borderRadius: "50%", background: "var(--acc)", opacity: 0.5 }} />
            <div style={{ position: "absolute", left: -6, top: -6, width: 12, height: 12, borderRadius: "50%", background: "var(--acc)", border: "2px solid #ffffff", boxSizing: "border-box" }} />
            <div style={{ position: "absolute", left: 14, top: -15, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", color: "var(--ink)", padding: "2px 0", fontSize: 13, fontWeight: 700, textShadow: "var(--halo)" }}>
              <span style={{ ...mono, fontSize: 10, color: "var(--acc)" }}>{pad(step + 1)}</span>
              <span>{markerLabel}</span>
            </div>
          </div>
        </div>

        </div>

        {/* Sarlavha — butun sahifada yuqorida turadi */}
        <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px clamp(14px,3vw,32px)", pointerEvents: "none", flexWrap: "wrap" }}>
          <a href="#" aria-label="INSOF.JBI — bosh sahifa" style={{ ...pill, pointerEvents: "auto", display: "flex", alignItems: "center", padding: narrow ? "12px 12px" : "10px 16px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- logotip kichik, o'lchami CSS da (balandlik 32px) */}
            <img src={mode === "dark" ? "/media/tour/insof-logo-dark.png" : "/media/tour/insof-logo.png"} alt="INSOF.JBI — Temir beton mahsulotlari" style={{ height: narrow ? 20 : 32, width: "auto", display: "block" }} />
          </a>
          <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <nav aria-label="Asosiy menyu" style={{ ...pill, display: "flex", alignItems: "center", gap: 2, padding: 6 }}>
              {wide && NAV.map(([href, label]) => (
                <a key={href} href={href} style={{ padding: "9px 13px", fontSize: 14, fontWeight: 500, borderRadius: 8, whiteSpace: "nowrap" }}>{label}</a>
              ))}
              {xwide && <Link href="/taqdimot" style={{ padding: "9px 13px", fontSize: 14, fontWeight: 500, borderRadius: 8, whiteSpace: "nowrap" }}>Taqdimot</Link>}
              {/* Kirish va yorug'/qorong'i rejim — ikonka tugmalar, har qanday ekranda (telefonda ham) menyu ichida */}
              <Link href="/login" aria-label="Tizimga kirish" title="Tizimga kirish" style={iconBtn}>
                <LogIn size={18} aria-hidden />
              </Link>
              <button type="button" onClick={() => setMode(mode === "dark" ? "light" : "dark")}
                aria-label={mode === "dark" ? "Yorug' rejimga o'tish" : "Qorong'i rejimga o'tish"} title={mode === "dark" ? "Yorug' rejim" : "Qorong'i rejim"}
                style={{ ...iconBtn, border: 0, background: "transparent", padding: 0, cursor: "pointer" }}>
                {mode === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
              </button>
              <a href="#ariza" className="it-cta" style={{ padding: narrow ? "9px 11px" : "10px 15px", fontSize: narrow ? 13 : 14, fontWeight: 600, borderRadius: 8, background: "var(--acc)", whiteSpace: "nowrap" }}>Narx so&apos;rash</a>
            </nav>
          </div>
        </header>

        <div className="it-3d">
        {/* Bekat kartasi */}
        <div style={{ position: "fixed", left: "clamp(14px,3vw,32px)", bottom: "clamp(14px,3vw,26px)", zIndex: 10, display: "flex", flexDirection: "column", gap: 10, width: "min(470px, calc(100vw - 28px))", opacity: ui, pointerEvents: ui > 0.2 ? "auto" : "none", visibility: ui <= 0.01 ? "hidden" : "visible" }}>
          <div className="it-card" aria-live="polite" style={{
            display: "flex", flexDirection: "column", gap: 14, padding: "0 4px 6px", maxHeight: narrow ? "calc(100svh - 300px)" : "calc(100vh - 230px)", overflowY: "auto", boxSizing: "border-box", minHeight: 0, textShadow: "var(--halo)",
            transition: "opacity .5s cubic-bezier(.22,.61,.36,1), transform .7s cubic-bezier(.22,.61,.36,1), filter .5s ease",
            opacity: cardOn ? 1 : 0, transform: cardOn ? "translateY(0)" : "translateY(14px)", filter: cardOn ? "blur(0px)" : "blur(5px)", willChange: "opacity, transform, filter",
          }}>
            {tall ? (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                <span style={{ fontSize: "clamp(56px,6vw,84px)", lineHeight: 0.78, fontWeight: 800, letterSpacing: "-.06em", color: "var(--acc-text)" }}>{pad(shown + 1)}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4 }}>
                  <span style={{ ...mono, fontSize: 11, letterSpacing: ".14em", color: "var(--ink)", opacity: 0.7 }}>/ 07</span>
                  <span style={{ ...mono, fontSize: 11.5, fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink)", whiteSpace: "nowrap" }}>{c.label}</span>
                </div>
              </div>
            ) : (
              <span style={{ ...mono, fontSize: 11, fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink)", whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--acc-text)" }}>{pad(shown + 1)}</span> / 07 · {c.label}
              </span>
            )}
            {/* Sahifaning asosiy sarlavhasi — birinchi bekatda kompaniya tavsifi */}
            <h1 style={{ margin: 0, fontSize: h1Size, lineHeight: 0.98, fontWeight: 800, letterSpacing: "-.04em", color: "var(--ink)", textWrap: "balance" }}>{c.title}</h1>
            {tall && !narrow && <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, fontWeight: 500, color: "var(--ink)", opacity: 0.88, maxWidth: 400, textWrap: "pretty" }}>{c.text}</p>}
            {!!c.quote && vh >= 760 && (
              <figure style={{ margin: 0, display: "flex", gap: 10, maxWidth: 400 }}>
                <span style={{ fontSize: 44, lineHeight: 0.8, fontWeight: 800, color: "var(--acc-text)" }}>“</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <blockquote style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontStyle: "italic", fontWeight: 500, color: "var(--ink)" }}>{c.quote}</blockquote>
                  <figcaption style={{ ...mono, fontSize: 10.5, letterSpacing: ".08em", color: "var(--ink)", opacity: 0.75 }}>{c.author}</figcaption>
                </div>
              </figure>
            )}
            <div style={{ display: "flex", flexDirection: "column", paddingTop: 6 }}>
              {tall && <span style={{ ...mono, fontSize: 10.5, letterSpacing: ".16em", color: "var(--acc-text)", fontWeight: 500, paddingBottom: 8 }}>{c.processTitle}</span>}
              {c.steps.map(([name, text], i) => {
                const on = i === step;
                return (
                  <div key={name} style={{ display: "flex", gap: 14, padding: compact ? "2px 0" : "5px 0" }}>
                    <div style={{ width: 3, flex: "0 0 auto", borderRadius: 2, background: "var(--line)", overflow: "hidden", position: "relative" }}>
                      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${i < step ? 100 : on ? Math.round(frac * 100) : 0}%`, background: "var(--acc)", transition: "height .5s linear" }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                        <span style={{ ...mono, fontSize: 11, fontWeight: 500, color: on || i < step ? "var(--acc-text)" : "var(--ink)" }}>{pad(i + 1)}</span>
                        <span style={{ fontSize: on ? (compact ? 16 : 19) : (compact ? 13 : 15), fontWeight: on ? 800 : 600, letterSpacing: "-.015em", color: "var(--ink)", opacity: on ? 1 : 0.72, whiteSpace: "nowrap", transition: "font-size .25s" }}>{name}</span>
                      </div>
                      {on && !compact && <span style={{ fontSize: 14, lineHeight: 1.45, fontWeight: 500, color: "var(--ink)", opacity: 0.85, paddingLeft: 27, maxWidth: 360 }}>{text}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "0 0 auto", textShadow: "none" }}>
            {isLast ? (
              <a href="#ariza" className="it-cta" style={{ padding: "12px 18px", borderRadius: 999, background: "var(--acc)", fontSize: 14, fontWeight: 700, boxShadow: "0 8px 24px var(--shadow)" }}>Narx so&apos;rash →</a>
            ) : (
              <button type="button" onClick={() => goTo(Math.min(active + 1, STN.length - 1))} style={{ border: 0, cursor: "pointer", padding: "12px 18px", borderRadius: 999, background: "var(--acc)", color: "var(--acc-ink)", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", boxShadow: "0 8px 24px var(--shadow)" }}>
                Keyingi: {STN[Math.min(shown + 1, STN.length - 1)]!.short} →
              </button>
            )}
            <a href="#mahsulotlar" style={{ padding: "12px 18px", borderRadius: 999, border: "1.5px solid var(--ink)", color: "var(--ink)", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>Mahsulotlar</a>
          </div>
          <div className="it-chips" style={{ display: "flex", gap: 4, overflowX: "auto", padding: 4, background: "var(--glass)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderRadius: 12, boxShadow: "0 6px 24px var(--shadow)" }}>
            {STN.map((s, i) => (
              <button key={s.short} type="button" aria-current={i === active ? "step" : undefined} onClick={() => goTo(i)}
                style={{ flex: "0 0 auto", border: 0, cursor: "pointer", padding: "8px 11px", borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: i === active ? "var(--acc)" : "transparent", color: i === active ? "var(--acc-ink)" : "var(--ink)" }}>{s.short}</button>
            ))}
          </div>
        </div>

        {/* "Pastga aylantiring" + jarayon chizig'i (tor ekranda karta bilan ustma-ust tushmasin — yashirin) */}
        {vw >= 760 && (
          <div aria-hidden style={{ ...pill, position: "fixed", right: "clamp(14px,3vw,32px)", bottom: "clamp(14px,3vw,26px)", zIndex: 10, display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", opacity: ui, visibility: ui <= 0.01 ? "hidden" : "visible" }}>
            <span style={{ ...mono, fontSize: 11, letterSpacing: ".08em", color: "var(--muted)", whiteSpace: "nowrap" }}>PASTGA AYLANTIRING</span>
            <div style={{ width: 90, height: 3, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--acc)", width: `${(sc.p / TOTAL) * 100}%`, transition: "width .3s ease-out" }} />
            </div>
          </div>
        )}

        {/* Skroll treki — kamerani boshqaradi */}
        <div id="top" ref={trackRef} style={{ height: "950vh", position: "relative", zIndex: 1, pointerEvents: "none" }} />
        </div>

        <MobileHero />
      </div>

      {/* Saytning qolgan qismi sahna ustidan chiqadi */}
      {/* `overflow: hidden` YO'Q: ~9000px balandlikdagi blokni yumaloq burchak bilan qirqish butun blokni GPU niqobiga
          aylantiradi — orqada 3D sahna chizilayotganda skroll paytida bo'limlar bir lahza bo'sh chiqardi.
          Yumaloq tepa — birinchi bo'limning o'zida (page.tsx: yugurma lenta). */}
      <main style={{ position: "relative", zIndex: 5, borderRadius: "28px 28px 0 0", boxShadow: "0 -20px 60px var(--shadow)" }}>
        {children}
      </main>
    </div>
  );
}

const NAV: [string, string][] = [
  ["#top", "Ishlab chiqarish"],
  ["#partners", "Hamkorlik"],
  ["#mahsulotlar", "Mahsulotlar"],
  ["#aloqa", "Aloqa"],
];

/**
 * Telefon uchun hero — animatsiyasiz: sarlavha, qisqa tavsif, zavod surati, ikki tugma va
 * «buyurtmadan obyektgacha» to'rt qadami. Ranglar tur mavzusidan (Kun/Tun almashtirgichi bunga ham ta'sir qiladi).
 */
function MobileHero() {
  const c = STN[0]!;
  const mono: CSSProperties = { fontFamily: "var(--font-jet-mono), 'JetBrains Mono', monospace" };
  return (
    <section className="it-mhero" style={{ position: "relative", zIndex: 1, background: "var(--bg)", padding: "92px 16px 40px" }}>
      <span style={{ ...mono, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 500, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--acc-text)" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--acc)" }} />{c.label}
      </span>
      <h1 style={{ margin: "14px 0 0", fontSize: 34, lineHeight: 1.02, fontWeight: 800, letterSpacing: "-.035em", color: "var(--ink)", textWrap: "balance" }}>{c.title}</h1>
      <p style={{ margin: "14px 0 0", fontSize: 16, lineHeight: 1.5, fontWeight: 500, color: "var(--muted)", textWrap: "pretty" }}>{c.text}</p>

      <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
        <a href="#ariza" className="it-cta" style={{ flex: 1, textAlign: "center", padding: "14px 16px", borderRadius: 999, background: "var(--acc)", fontSize: 15, fontWeight: 700, boxShadow: "0 8px 24px var(--shadow)" }}>Narx so&apos;rash</a>
        <a href="#mahsulotlar" style={{ flex: 1, textAlign: "center", padding: "14px 16px", borderRadius: 999, border: "1.5px solid var(--ink)", fontSize: 15, fontWeight: 700 }}>Mahsulotlar</a>
      </div>

      <div style={{ position: "relative", marginTop: 24, aspectRatio: "4 / 3", borderRadius: 20, overflow: "hidden", boxShadow: "0 16px 40px var(--shadow)" }}>
        <Image src="/media/hero.jpg" alt="Insof zavodi" fill priority sizes="100vw" style={{ objectFit: "cover" }} />
      </div>

      <div style={{ marginTop: 28, padding: "18px 18px 8px", background: "var(--surface)", borderRadius: 20, boxShadow: "0 6px 24px var(--shadow)" }}>
        <span style={{ ...mono, fontSize: 10.5, fontWeight: 500, letterSpacing: ".16em", color: "var(--acc-text)" }}>{c.processTitle}</span>
        <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
          {c.steps.map(([name, text], i) => (
            <li key={name} style={{ display: "flex", gap: 14, padding: "12px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <span style={{ ...mono, fontSize: 12, fontWeight: 600, color: "var(--acc-text)", paddingTop: 2 }}>{pad(i + 1)}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{name}</div>
                <div style={{ marginTop: 3, fontSize: 14, lineHeight: 1.45, color: "var(--muted)" }}>{text}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
