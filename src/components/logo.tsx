/* Insof logotipi — SVG. Matn `currentColor` oladi, shuning uchun ochiq/qorong'i
   fonda ota-element rangiga moslashadi. Plitka rangi --logo-blue tokenidan. */

/** Belgi: ko'k plitka + ichidagi oq nishon. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 121 121" className={className} role="img" aria-label="Insof">
      <rect width="121" height="121" rx="10" fill="var(--logo-blue, #4f6ebe)" />
      <path d="M25 25H96V47H61V54L70 59.5V74H96V96H25V74H48.5V47H25Z" fill="#fff" />
    </svg>
  );
}

/** To'liq lokap: belgi + INSOF. + tagline. */
export function Logo({ className = "h-10", tagline = true }: { className?: string; tagline?: boolean }) {
  return (
    <svg viewBox={tagline ? "0 0 669 121" : "0 0 669 96"} className={className} role="img" aria-label="INSOF — temir beton maxsulotlari">
      <rect width="121" height="121" rx="10" fill="var(--logo-blue, #4f6ebe)" />
      <path d="M25 25H96V47H61V54L70 59.5V74H96V96H25V74H48.5V47H25Z" fill="#fff" />

      <g fill="currentColor">
        {/* I */}
        <path d="M179 1H206V86H179Z" />
        {/* N */}
        <path d="M217 1H247L290 48V1H316V86H290L243 38V86H217Z" />
        {/* S */}
        <path d="M337 1H428V22H354V34H428V77A9 9 0 0 1 419 86H328V66H402V54H328V10A9 9 0 0 1 337 1Z" />
        {/* O */}
        <path
          fillRule="evenodd"
          d="M453 1H526A13 13 0 0 1 539 14V73A13 13 0 0 1 526 86H453A13 13 0 0 1 440 73V14A13 13 0 0 1 453 1ZM469 23H510A3 3 0 0 1 513 26V62A3 3 0 0 1 510 65H469A3 3 0 0 1 466 62V26A3 3 0 0 1 469 23Z"
        />
        {/* F — gorizontal elementlari nishondagi kabi qiya kesilgan */}
        <path d="M551 1H639L620 22H577V38H610L589 61H577V86H551Z" />
      </g>

      {/* Nuqta */}
      <rect x="616" y="60" width="26" height="26" fill="var(--logo-blue, #4f6ebe)" />

      {tagline && (
        <text
          x="180"
          y="120"
          textLength="488"
          lengthAdjust="spacing"
          fill="currentColor"
          fontSize="21.5"
          fontWeight="800"
          fontFamily="var(--font-inter, Inter), system-ui, sans-serif"
        >
          TEMIR BETON MAXSULOTLARI
        </text>
      )}
    </svg>
  );
}
