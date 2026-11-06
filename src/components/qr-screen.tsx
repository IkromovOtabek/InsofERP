import type { CSSProperties, ReactNode } from "react";
import { Boxes, Check, Clock, Hourglass, RefreshCw, Truck, X } from "lucide-react";
import { LogoMark } from "@/components/logo";

/**
 * QR skanerlanganda ochiladigan ommaviy sahifalar (nakladnoy, zayavka, tijorat taklifi, ijara kvitansiyasi) uchun
 * umumiy qobiq — Claude artifakti «QR ochilish ekrani» dizayni: rangli sarlavha, animatsiyali belgi, ustiga
 * chiqib turgan kartochkalar. Ranglar qat'iy hex: sahifa doim ochiq rangda (telefon dark rejimida ham —
 * qog'oz bilan solishtiriladigan hujjat), `.dark` da tokenlar teskari bo'ladi. Server komponent — JS yo'q.
 */
const CSS = `
.vf-ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,.9);animation:vf-ring 2.4s cubic-bezier(.2,.7,.3,1) .5s infinite both}
.vf-r2{animation-delay:1.3s}.vf-r3{animation-delay:2.1s}
.vf-badge{animation:vf-pop .7s cubic-bezier(.3,1.6,.5,1) .15s both}
.vf-tick path{stroke-dasharray:30;stroke-dashoffset:30;animation:vf-draw .45s ease-out .7s forwards}
.vf-x path{stroke-dasharray:20;stroke-dashoffset:20;animation:vf-draw .3s ease-out .65s forwards}.vf-x path:nth-child(2){animation-delay:.9s}
.vf-hand polyline{transform-origin:12px 12px;animation:vf-spin 2.4s linear .8s infinite}
.vf-glass{animation:vf-flip 2.6s cubic-bezier(.6,0,.3,1) .9s infinite}
.vf-spark{position:absolute;width:8px;height:8px;border-radius:2px;left:50%;top:50%;margin:-4px;animation:vf-spark 1s ease-out .75s both}
.vf-conf{position:absolute;left:50%;top:50%;width:9px;height:14px;border-radius:2px;margin:-7px -4px;animation:vf-conf 1.6s cubic-bezier(.15,.7,.4,1) .75s both}
.vf-up{animation:vf-up .6s cubic-bezier(.2,.8,.2,1) both}
.vf-d1{animation-delay:.55s}.vf-d2{animation-delay:.7s}.vf-d3{animation-delay:.85s}.vf-d4{animation-delay:1s}.vf-d5{animation-delay:1.15s}.vf-d6{animation-delay:1.3s}.vf-d7{animation-delay:1.45s}
.vf-row{animation:vf-slide .55s cubic-bezier(.2,.8,.2,1) both}
.vf-fill{animation:vf-fill 1.2s cubic-bezier(.3,.9,.3,1) 1.1s both}
.vf-st{animation:vf-pop .45s cubic-bezier(.3,1.6,.5,1) both}
.vf-dot{animation:vf-pulse 1.6s ease-in-out infinite}
.vf-dotc{animation:vf-pulsec 1.6s ease-in-out infinite}
.vf-scan{position:absolute;top:0;bottom:0;width:30%;background:#fbbf24;border-radius:999px;animation:vf-scan 1.6s ease-in-out 1s infinite alternate}
.vf-dots span{display:inline-block;animation:vf-blink 1.2s ease-in-out infinite}.vf-dots span:nth-child(2){animation-delay:.2s}.vf-dots span:nth-child(3){animation-delay:.4s}
.vf-shine{position:relative;overflow:hidden}
.vf-shine::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:0;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);animation:vf-shine 2.6s ease-in-out 1.8s infinite}
.vf-breathe{animation:vf-breathe 2.4s ease-in-out 2.2s infinite}
.vf-strike{position:relative;display:inline-block}
.vf-strike::after{content:"";position:absolute;left:-4px;right:-4px;top:52%;height:3px;border-radius:2px;background:#e7000b;transform-origin:left;animation:vf-strike .5s ease-out 1.5s both}
.vf-arc{stroke-dasharray:201;stroke-dashoffset:201;animation:vf-arc 1.4s cubic-bezier(.3,.9,.3,1) 1s forwards}
.vf-drain{stroke-dasharray:201;stroke-dashoffset:0;animation:vf-drain 1.4s cubic-bezier(.5,0,.3,1) 1s forwards}
.vf-line{transform-origin:top;animation:vf-grow 1.4s cubic-bezier(.3,.9,.3,1) 1.1s both}
.vf-print{animation:vf-print .9s cubic-bezier(.2,.8,.2,1) .7s both}
.vf-stamp{animation:vf-stamp .55s cubic-bezier(.5,0,.6,1.4) 1.6s both}
.vf-zig{height:12px;background:radial-gradient(circle at 9px 0,transparent 8px,#ffffff 8.5px) 0 0/18px 12px repeat-x}
.vf-stop{animation:vf-stopk 1.4s ease-in-out 1.4s infinite}
.vf-road{background-image:linear-gradient(90deg,#155dfc 50%,transparent 50%);background-size:14px 3px;background-repeat:repeat-x;background-position:0 50%;animation:vf-road .6s linear infinite}
.vf-truck{position:absolute;top:50%;margin-top:-21px;left:4%;animation:vf-drive 1.8s cubic-bezier(.4,.1,.3,1) 1s both}
.vf-arrived{left:calc(100% - 92px);animation:vf-arrive 1.6s cubic-bezier(.4,.1,.3,1) 1s both}
.vf-bob{animation:vf-bob .5s ease-in-out 2.8s infinite}
.vf-idle{animation:vf-bob .35s ease-in-out 1s infinite}
.vf-vol{animation:vf-vol .9s cubic-bezier(.3,1.5,.5,1) 1.2s both}
.vf-puff{position:absolute;left:-10px;bottom:6px;width:10px;height:10px;border-radius:50%;background:#cad5e2;animation:vf-puff 1.4s ease-out 1s infinite}
.vf-p2{animation-delay:1.7s}
.vf-load{animation:vf-load 2.2s cubic-bezier(.4,0,.2,1) 1.2s infinite}
.vf-trail{animation:vf-trail 1.6s cubic-bezier(.4,.1,.3,1) 1s both}
.vf-pin{animation:vf-pin .55s cubic-bezier(.3,1.6,.5,1) 2.5s both}
@keyframes vf-ring{0%{transform:scale(.7);opacity:.85}100%{transform:scale(2.5);opacity:0}}
@keyframes vf-pop{0%{transform:scale(0) rotate(-20deg)}60%{transform:scale(1.14) rotate(4deg)}100%{transform:scale(1) rotate(0)}}
@keyframes vf-draw{to{stroke-dashoffset:0}}
@keyframes vf-spin{to{transform:rotate(360deg)}}
@keyframes vf-flip{0%,70%{transform:rotate(0)}100%{transform:rotate(180deg)}}
@keyframes vf-spark{0%{opacity:0;transform:translate(0,0) scale(.3)}30%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(1) rotate(90deg)}}
@keyframes vf-conf{0%{opacity:0;transform:translate(0,0) rotate(0)}15%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--r))}}
@keyframes vf-up{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes vf-slide{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
@keyframes vf-fill{from{width:0}}
@keyframes vf-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,.8)}60%{box-shadow:0 0 0 8px rgba(255,255,255,0)}}
@keyframes vf-pulsec{0%,100%{box-shadow:0 0 0 0 var(--pc)}60%{box-shadow:0 0 0 8px transparent}}
@keyframes vf-scan{from{left:0}to{left:70%}}
@keyframes vf-blink{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes vf-shine{0%{transform:translateX(-120%)}55%,100%{transform:translateX(320%)}}
@keyframes vf-breathe{0%,100%{box-shadow:0 10px 24px -10px rgba(245,158,11,.7)}50%{box-shadow:0 14px 34px -8px rgba(245,158,11,.95)}}
@keyframes vf-strike{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes vf-arc{to{stroke-dashoffset:var(--arc-end,58)}}
@keyframes vf-drain{to{stroke-dashoffset:201}}
@keyframes vf-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes vf-print{from{opacity:0;transform:translateY(-40px);clip-path:inset(0 0 100% 0)}to{opacity:1;transform:none;clip-path:inset(0 0 0 0)}}
@keyframes vf-stamp{0%{opacity:0;transform:rotate(-14deg) scale(2.6)}70%{opacity:1;transform:rotate(-14deg) scale(.92)}100%{opacity:1;transform:rotate(-14deg) scale(1)}}
@keyframes vf-stopk{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes vf-road{to{background-position:-14px 50%}}
@keyframes vf-drive{from{left:4%}to{left:56%}}
@keyframes vf-arrive{from{left:0}to{left:calc(100% - 92px)}}
@keyframes vf-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes vf-vol{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@keyframes vf-puff{0%{opacity:.9;transform:translate(0,0) scale(.6)}100%{opacity:0;transform:translate(-26px,-18px) scale(2)}}
@keyframes vf-load{0%{width:0}70%,100%{width:100%}}
@keyframes vf-trail{from{width:0}}
@keyframes vf-pin{0%{opacity:0;transform:translateY(-26px) scale(.6)}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vf *,.vf *::after{animation:none!important}.vf-tick path,.vf-x path{stroke-dashoffset:0}.vf-arc{stroke-dashoffset:var(--arc-end,58)}.vf-drain{stroke-dashoffset:201}.vf-truck{left:56%}.vf-arrived{left:calc(100% - 92px)}.vf-stamp{transform:rotate(-14deg)}}
@media print{.vf *{animation:none!important}.vf-noprint{display:none!important}}
`;

/** Sarlavha rangi: ko'k — nakladnoy, amber — zayavka, binafsha — taklif, yashil — kvitansiya, qizil — bekor qilingan */
export type QrTone = "blue" | "amber" | "violet" | "green" | "red";
const TONE: Record<QrTone, { bg: string; dark: boolean }> = {
  blue: { bg: "bg-[#155dfc]", dark: true },
  amber: { bg: "bg-[#f59e0b]", dark: false },
  violet: { bg: "bg-[#7c3aed]", dark: true },
  green: { bg: "bg-[#047857]", dark: true },
  red: { bg: "bg-[#e7000b]", dark: true },
};

export type QrBadge = "check" | "x" | "clock" | "hourglass";
const SPARKS = [
  { dx: -62, dy: -30, c: "#ffffff" }, { dx: 58, dy: -44, c: "#f59e0b" }, { dx: 66, dy: 26, c: "#ffffff" },
  { dx: -54, dy: 40, c: "#34d399" }, { dx: 4, dy: -70, c: "#ffffff" },
];
const CONFETTI = [
  { dx: -120, dy: -60, r: 220, c: "#ffffff" }, { dx: -90, dy: 30, r: -160, c: "#009966" }, { dx: -60, dy: -95, r: 300, c: "#155dfc" },
  { dx: 0, dy: -110, r: 180, c: "#ffffff" }, { dx: 70, dy: -90, r: -240, c: "#7c3aed" }, { dx: 118, dy: -40, r: 200, c: "#0f172b" },
  { dx: 100, dy: 40, r: -200, c: "#ffffff" }, { dx: 40, dy: 80, r: 260, c: "#e7000b" }, { dx: -30, dy: 85, r: -280, c: "#ffffff" },
];

export const qrCard = "rounded-[18px] bg-[#ffffff] p-[18px] shadow-[0_1px_3px_rgba(15,23,42,.08)]";
export const qrMuted = "text-[12px] font-medium text-[#5f7088]";
/** Kartochka ichidagi kichik sarlavha (MAHSULOTLAR, MASHINA…) — artifaktdagidek */
export const qrCaption = "text-[11px] font-bold tracking-[.12em] text-[#5f7088]";
export const qrBtnDark = "flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] bg-[#0f172b] px-3 text-[14px] font-extrabold text-[#ffffff] no-underline";
export const qrBtnLight = "flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] bg-[#ffffff] px-3 text-[14px] font-bold text-[#0f172b] no-underline shadow-[inset_0_0_0_1.5px_#e2e8f0]";
export const qrBtnAmber = "flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] bg-[#f59e0b] px-3 text-[14px] font-extrabold text-[#0f172b] no-underline";
export const qrBtnTelegram = "flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] bg-[#229ed9] px-3 text-[14px] font-extrabold text-[#ffffff] no-underline";

/** Kartochkalar ketma-ket paydo bo'ladi: 1 → .vf-d1 … 7 */
export const qrUp = (n: number) => `vf-up vf-d${Math.min(7, Math.max(1, n))}`;

export function QrField({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 flex-col gap-0.5 ${className}`}><span className={qrMuted}>{label}</span><span className="text-[15px] font-bold break-words">{value}</span></div>;
}

export function QrPill({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`inline-flex shrink-0 items-center gap-[7px] rounded-full px-3 py-1.5 text-[13px] font-bold ${className}`}>{children}</span>;
}

/** Mahsulot plitkasi: beton markasi (M300) yoki FBS — matn, boshqasi — ikonka. Rangi: amber — zayavka, binafsha — taklif, kulrang — bekor/eskirgan */
const TILE = { amber: "bg-[#fff7ed] text-[#ca3500]", violet: "bg-[#f5f3ff] text-[#7008e7]", gray: "bg-[#f1f5f9] text-[#45556c]" };
export function QrItemTile({ name, tone }: { name: string; tone: keyof typeof TILE }) {
  const m = name.match(/\bM\d{3}\b/i) ?? name.match(/\b(FBS|ФБС)\b/i);
  return <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[12px] font-extrabold ${TILE[tone]}`}>{m ? m[0].toUpperCase() : /dostavka|yetkaz|доставк/i.test(name) ? <Truck size={22} aria-hidden /> : <Boxes size={22} aria-hidden />}</div>;
}

/** Telegram havolasi: "@kanal" yoki to'liq URL */
export const telegramUrl = (v: string | null | undefined) => (v ? (v.startsWith("http") ? v : `https://t.me/${v.replace(/^@/, "")}`) : null);
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function BadgeIcon({ kind, label }: { kind: QrBadge; label: string }) {
  if (kind === "x") return <X size={54} strokeWidth={2.6} color="#e7000b" className="vf-x" role="img" aria-label={label} />;
  if (kind === "clock") return <Clock size={54} strokeWidth={2.4} color="#e17100" className="vf-hand" role="img" aria-label={label} />;
  if (kind === "hourglass") return <Hourglass size={50} strokeWidth={2.2} color="#7c3aed" className="vf-glass" role="img" aria-label={label} />;
  return <Check size={54} strokeWidth={2.6} color="#009966" className="vf-tick" role="img" aria-label={label} />;
}

export type QrHead = {
  tone: QrTone;
  brand: string;
  brandSub?: string | null;
  /** Yuqori o'ng burchak: til tugmasi yoki «Jonli» belgisi */
  corner?: ReactNode;
  eyebrow: string;
  title: string;
  sub: string;
  badge: QrBadge;
  badgeLabel: string;
  effect?: "sparks" | "confetti";
};

/** Sahifa qobig'i: rangli sarlavha + ustiga chiqib turgan kartochkalar ustuni (telefon kengligi, kompyuterda markazda) */
export function QrScreen({ head, children, lang = "uz" }: { head: QrHead; children: ReactNode; lang?: string }) {
  const tone = TONE[head.tone];
  return (
    <main lang={lang} className="vf min-h-screen bg-[#f5f6f8] font-sans text-[#0f172b] print:bg-[#ffffff]">
      <style>{CSS}</style>
      <header className={`relative overflow-hidden px-5 pb-16 pt-[22px] ${tone.bg} ${tone.dark ? "text-[#ffffff]" : "text-[#0f172b]"}`}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-[22px]">
          <div className="vf-up flex items-center gap-2.5">
            <LogoMark className={`h-[38px] w-[38px] shrink-0 ${tone.dark ? "[--logo-blue:#f59e0b]" : "[--logo-blue:#0f172b]"}`} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-extrabold tracking-[.02em]">{head.brand}</span>
              {head.brandSub && <span className="truncate text-[12px] font-medium opacity-85">{head.brandSub}</span>}
            </div>
            {head.corner}
          </div>
          <div className="flex flex-col items-center gap-3.5 text-center">
            <div className="relative h-[104px] w-[104px]">
              <span className="vf-ring" /><span className="vf-ring vf-r2" />{head.tone !== "red" && <span className="vf-ring vf-r3" />}
              {head.effect === "sparks" && SPARKS.map((s) => <span key={`${s.dx}${s.dy}`} className="vf-spark" style={{ "--dx": `${s.dx}px`, "--dy": `${s.dy}px`, background: s.c } as CSSProperties} />)}
              {head.effect === "confetti" && CONFETTI.map((s) => <span key={`${s.dx}${s.dy}`} className="vf-conf" style={{ "--dx": `${s.dx}px`, "--dy": `${s.dy}px`, "--r": `${s.r}deg`, background: s.c } as CSSProperties} />)}
              <div className={`vf-badge absolute inset-0 grid place-items-center rounded-full bg-[#ffffff] ${head.tone === "red" ? "shadow-[0_14px_30px_-10px_rgba(80,0,0,.6)]" : head.tone === "amber" ? "shadow-[0_14px_30px_-10px_rgba(120,53,15,.55)]" : "shadow-[0_14px_30px_-10px_rgba(10,30,90,.6)]"}`}>
                <BadgeIcon kind={head.badge} label={head.badgeLabel} />
              </div>
            </div>
            <div className="vf-up vf-d1 flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-[.14em] opacity-90">{head.eyebrow}</span>
              <h1 className="m-0 text-[32px] leading-9 font-extrabold tracking-[-.02em]">{head.title}</h1>
              <p className="m-0 text-[14px] leading-5 font-medium">{head.sub}</p>
            </div>
          </div>
        </div>
      </header>
      <div className="relative -mt-[34px] rounded-t-[28px] bg-[#f5f6f8] px-4 pb-5 pt-[18px] print:bg-[#ffffff]">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3">{children}</div>
      </div>
    </main>
  );
}

/** Sarlavhadagi til almashtirish tugmasi */
export function QrLangLink({ href, label, dark }: { href: string; label: string; dark: boolean }) {
  return <a href={href} className={`vf-noprint shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold no-underline ${dark ? "bg-[rgba(255,255,255,.18)] text-[#ffffff]" : "bg-[rgba(255,255,255,.55)] text-[#0f172b]"}`}>{label}</a>;
}

/** Pastki qator: tekshirilgan vaqt va «Qayta tekshirish» (sahifani yangilaydi — holat jonli) + xodim uchun ERP havolasi */
export function QrFooter({ step = 7, checked, refresh, href, color = "#1447e6", staff }: { step?: number; checked: string; refresh: string; href: string; color?: string; staff?: { href: string; label: string } }) {
  return (
    <div className={`${qrUp(step)} vf-noprint flex flex-col items-center gap-1 text-[12px] text-[#5f7088]`}>
      <div className="flex flex-wrap items-center justify-center gap-x-2">
        <span>{checked}</span><span aria-hidden>·</span>
        <a href={href} className="inline-flex items-center gap-[5px] px-1 py-1.5 font-bold no-underline" style={{ color }}><RefreshCw size={13} strokeWidth={2.4} aria-hidden />{refresh}</a>
      </div>
      {/* Xodim uchun — login talab qilinadi, ruxsat sahifa himoyasida tekshiriladi */}
      {staff && <a href={staff.href} className="text-[11px] text-[#5f7088] underline">{staff.label}</a>}
    </div>
  );
}
