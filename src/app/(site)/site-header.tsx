"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { LogIn, Mail, Menu, Phone, Presentation, X } from "lucide-react";

const LINKS = [
  ["mahsulotlar", "Mahsulotlar"],
  ["zavod", "Zavod"],
  ["nega-biz", "Nega biz"],
  ["jarayon", "Ish tartibi"],
  ["aloqa", "Aloqa"],
] as const;

/**
 * Sayt sarlavhasi — logotip oq fonda turadi, xuddi brend kitobidagidek.
 *
 *  · Tepada ko'k xizmat qatori: telefon, pochta, ish vaqti va xodimlar kirishi.
 *    Sahifa siljiganda u yig'iladi, faqat oq panel qoladi.
 *  · Qaysi bo'limda turganimiz kuzatiladi (IntersectionObserver) va menyuda
 *    to'q sariq chiziq bilan belgilanadi — uzun sahifada o'quvchi yo'qolmaydi.
 */
export function SiteHeader({ phone, email, hours }: { phone: string | null; email: string | null; hours: string | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Ekran o'rtasidan o'tgan oxirgi bo'lim — shu band yoniq turadi
  useEffect(() => {
    const els = LINKS.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => { for (const e of entries) if (e.isIntersecting) setActive(e.target.id); },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  // Menyu ochiq turganda orqa fon siljimasin
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const tel = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <header className="sticky top-0 z-50">
      {/* Xizmat qatori — siljiganda yig'iladi, shunda ekranda mahsulot qoladi */}
      <div className={`overflow-hidden bg-insof-900 transition-[height] duration-300 ${scrolled ? "h-0" : "h-10"}`}>
        <div className="mx-auto flex h-10 max-w-[1440px] items-center gap-6 px-4 text-[13px] text-white/65 sm:px-6 lg:px-8">
          {tel && (
            <a href={tel} className="inline-flex items-center gap-2 transition-colors hover:text-white">
              <Phone size={13} className="text-signal" />
              <span className="font-mono tabular-nums">{phone}</span>
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`} className="hidden items-center gap-2 transition-colors hover:text-white sm:inline-flex">
              <Mail size={13} className="text-signal" />
              {email}
            </a>
          )}
          {hours && <span className="ml-auto hidden lg:inline">{hours}</span>}
        </div>
      </div>

      <div className={`border-b border-beton-200 bg-white transition-shadow ${scrolled ? "shadow-[0_1px_16px_rgba(23,35,61,0.10)]" : ""}`}>
        <div className={`mx-auto flex max-w-[1440px] items-center gap-4 px-4 transition-all duration-300 sm:px-6 lg:gap-6 lg:px-8 ${scrolled ? "h-16" : "h-20"}`}>
          <Link href="/" className="shrink-0" aria-label="INSOF JBI — bosh sahifa">
            <Image
              src="/media/logo.png"
              alt="INSOF JBI — temir beton mahsulotlari"
              width={940}
              height={172}
              priority
              className={`w-auto transition-all duration-300 ${scrolled ? "h-9" : "h-10 lg:h-12"}`}
            />
          </Link>

          <nav className="ml-auto hidden items-center gap-6 lg:flex xl:gap-8">
            {LINKS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className={`relative py-2 text-[15px] font-medium whitespace-nowrap transition-colors ${active === id ? "text-insof-700" : "text-beton-700 hover:text-insof-600"}`}
              >
                {label}
                {active === id && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute -bottom-px left-0 h-0.5 w-full bg-signal"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
              </a>
            ))}

            {/* Taqdimot — PPT ning veb ko'rinishi, alohida sahifa */}
            <Link
              href="/taqdimot"
              className="inline-flex items-center gap-1.5 py-2 text-[15px] font-medium whitespace-nowrap text-beton-700 transition-colors hover:text-insof-600"
            >
              <Presentation size={15} className="text-signal-dim" /> Taqdimot
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3 lg:ml-0">
            {tel && (
              <a href={tel} className="hidden text-[15px] font-semibold whitespace-nowrap text-beton-900 tabular-nums xl:inline-flex">{phone}</a>
            )}
            {tel && (
              <a href={tel} aria-label={`Qo'ng'iroq: ${phone}`} className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-insof-900 text-white xl:hidden">
                <Phone size={16} />
              </a>
            )}
            <Link
              href="/login"
              className="hidden h-11 items-center gap-2 rounded-md border border-beton-300 px-5 text-sm font-semibold whitespace-nowrap text-beton-800 transition-colors hover:border-insof-500 hover:text-insof-700 lg:inline-flex"
            >
              <LogIn size={16} /> Kirish
            </Link>
            <a
              href="#ariza"
              className="hidden h-11 items-center rounded-md bg-signal px-5 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-signal-600 sm:inline-flex xl:px-6"
            >
              Narx so&apos;rash
            </a>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-beton-300 text-beton-800 lg:hidden"
              aria-label={open ? "Menyuni yopish" : "Menyu"}
              aria-expanded={open}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-b border-beton-200 bg-white lg:hidden"
          >
            <div className="px-4 pt-2 pb-8 sm:px-6">
              {LINKS.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  onClick={() => setOpen(false)}
                  className="block border-b border-beton-200 py-4 text-lg font-semibold text-beton-900"
                >
                  {label}
                </a>
              ))}
              <Link
                href="/taqdimot"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 border-b border-beton-200 py-4 text-lg font-semibold text-beton-900"
              >
                <Presentation size={18} className="text-signal-dim" /> Taqdimot (PPT)
              </Link>
              <a
                href="#ariza"
                onClick={() => setOpen(false)}
                className="mt-6 flex h-12 items-center justify-center rounded-md bg-signal text-sm font-semibold text-white"
              >
                Narx so&apos;rash
              </a>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="mt-3 flex h-12 items-center justify-center gap-2 rounded-md border border-beton-300 text-sm font-semibold text-beton-800"
              >
                <LogIn size={16} /> Kirish
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
