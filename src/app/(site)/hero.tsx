import Image from "next/image";
import Link from "next/link";
// Statik import: o'lcham va xira oldindan-ko'rinish (blur) build paytida — surat yuklanguncha to'q fon emas, xira zavod ko'rinadi
import heroImg from "../../../public/media/hero.jpg";

/**
 * Bosh sahifa hero — «Kinematografik foto» (2026-11-27): zavodning katta surati butun ekranda, ulkan sarlavha pastda.
 * Birinchi taassurot — «bu haqiqiy zavod». Server komponent, animatsiyasiz: tez yuklanadi, sarlavha (h1) SEO uchun HTML'da.
 * Avvalgi 3D zavod turi (`tour/factory-tour.tsx`) shu bilan almashtirildi — fayllari joyida qoldi.
 */
const NAV: [string, string][] = [
  ["#mahsulotlar", "Mahsulotlar"],
  ["#zavod", "Zavod"],
  ["#jarayon", "Yetkazish"],
  ["#aloqa", "Aloqa"],
];

export function CinematicHero({ region = "Yangiyo'l · Toshkent viloyati" }: { region?: string }) {
  return (
    <div className="bg-beton-100 p-2 sm:p-3">
      <section id="top" className="relative isolate flex min-h-[calc(100svh-16px)] flex-col overflow-hidden rounded-[22px] bg-insof-900 text-white sm:min-h-[calc(100svh-24px)] sm:rounded-[28px] lg:max-h-[1000px]">
        <Image src={heroImg} placeholder="blur" alt="Insof zavodi: tayyor mahsulot maydoni, ko'prik kran va sexlar" fill priority sizes="100vw"
          className="-z-20 object-cover object-[68%_50%] sm:object-center" />
        {/* O'qilish uchun: chap-pastdan qoraytirish (rasmning o'ng tomoni — kran va sex — ochiq qoladi) */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-t from-insof-900/85 via-insof-900/20 to-insof-900/30" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-linear-to-r from-insof-900/45 via-insof-900/5 to-transparent" />

        {/* Tepa menyu */}
        <header className="flex items-center justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7 lg:px-12 lg:pt-9">
          <Link href="/" className="flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight sm:text-2xl" aria-label="Insof — bosh sahifa">
            <span aria-hidden className="h-3.5 w-3.5 rounded-[3px] bg-signal sm:h-4 sm:w-4" />INSOF
          </Link>
          <nav aria-label="Bo'limlar" className="hidden items-center gap-8 text-[15px] font-medium text-white/85 md:flex">
            {NAV.map(([href, label]) => <a key={href} href={href} className="transition hover:text-white">{label}</a>)}
          </nav>
          <Link href="/login" className="rounded-xl border-2 border-white/90 px-4 py-2 text-[15px] font-semibold transition hover:bg-white hover:text-insof-900 sm:px-5">Kirish</Link>
        </header>

        {/* Sarlavha — pastda, ulkan */}
        <div className="mt-auto px-5 pb-6 sm:px-8 sm:pb-9 lg:px-12 lg:pb-12">
          <p className="font-mono text-[11px] font-medium tracking-[0.32em] text-signal uppercase sm:text-[13px]">{region}</p>
          {/* Kompyuterda maketdagidek 3 qator; telefonda o'zi o'raladi */}
          <h1 className="mt-4 font-display text-[clamp(28px,8.6vw,56px)] sm:text-[clamp(56px,7.2vw,132px)] leading-[0.9] font-extrabold tracking-[-0.045em] sm:mt-6">
            Beton <span className="sm:block">zavoddan to&apos;g&apos;ri</span> <span className="sm:block">obyektingizga</span>
          </h1>
          <div className="mt-6 flex flex-col gap-6 sm:mt-8 lg:flex-row lg:items-end lg:justify-between">
            <p className="max-w-xl text-[15px] leading-relaxed text-white/85 sm:text-lg">
              Tayyor beton, temir-beton konstruksiyalar va xomashyo. O&apos;z mikser parki, laboratoriya nazorati, QR-nakladnoy.
            </p>
            <div className="flex gap-3">
              <a href="#ariza" className="flex-1 rounded-2xl bg-signal px-6 py-3.5 text-center text-[15px] font-semibold text-insof-900 shadow-lg shadow-black/20 transition hover:bg-signal-600 sm:flex-none sm:px-8 sm:py-4 sm:text-base">Narx so&apos;rash</a>
              <a href="#zavod" className="flex-1 rounded-2xl border-2 border-white/90 px-6 py-3.5 text-center text-[15px] font-semibold transition hover:bg-white hover:text-insof-900 sm:flex-none sm:px-8 sm:py-4 sm:text-base">Zavodni ko&apos;rish</a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
