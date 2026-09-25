import type { SVGProps } from "react";

/**
 * Saytning o'z ikonkalari — beton zavodiga xos tushunchalar lucide'da yo'q.
 * Uslub lucide bilan bir xil (24×24, 1.5 chiziq, yumaloq uchlar), shuning uchun
 * bir qatorda turganda ajralib qolmaydi.
 */

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...rest }: P) {
  return {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...rest,
  };
}

/** Beton mikseri — kabina, qiya baraban, ikki g'ildirak. */
export function MixerIcon(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M3 16v-4.5L5.5 8H9v8" />
      <rect x="9.5" y="6" width="10.5" height="7" rx="3.5" transform="rotate(-10 14.75 9.5)" />
      <path d="M11.5 10.2 18 9.1" />
      <path d="M20 13.5 21.5 16" />
      <path d="M2 16h20" />
      <circle cx="6.5" cy="18.5" r="1.75" />
      <circle cx="16.5" cy="18.5" r="1.75" />
    </svg>
  );
}

/** Ko'p bo'shliqli plita (PK) kesimi — qurilishchi darrov taniydi. */
export function SlabIcon(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="2" y="7.5" width="20" height="9" rx="1" />
      <circle cx="6.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="17.5" cy="12" r="1.6" />
      <path d="M2 19.5h20" strokeDasharray="2 2.5" />
    </svg>
  );
}

/** Qum/shag'al uyumi — ustida uchta tosh. */
export function AggregateIcon(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 19c3.5-8.5 7-11 9.5-11s6 2.5 9.5 11H2.5Z" />
      <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="16.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="16.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Beton kubi — mustahkamlik sinovi namunasi (marka shu bilan tekshiriladi). */
export function CubeIcon(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M4 7.5 12 12l8-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

/**
 * Ikonka plitkasi. `tone`:
 *  · solid — brend ko'k gradient, oq ikonka (asosiy ro'yxatlar);
 *  · soft  — ochiq ko'k, to'q ikonka (oq karta ichida);
 *  · glass — surat ustida (hero, yo'nalish kartalari).
 * `dot` — burchakdagi to'q sariq nuqta, faol/muhim degan ishora.
 */
export function IconTile({
  children, tone = "solid", size = "md", dot = false, className = "",
}: { children: React.ReactNode; tone?: "solid" | "soft" | "glass"; size?: "sm" | "md" | "lg"; dot?: boolean; className?: string }) {
  const dims = size === "lg" ? "h-14 w-14 rounded-2xl" : size === "sm" ? "h-9 w-9 rounded-xl" : "h-12 w-12 rounded-2xl";
  const look = tone === "solid" ? "icon-tile text-white" : tone === "soft" ? "icon-tile-soft text-insof-700" : "glass-dark text-white";
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${dims} ${look} ${className}`}>
      {children}
      {dot && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-signal ring-2 ring-white" />}
    </span>
  );
}
