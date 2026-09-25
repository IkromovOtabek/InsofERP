"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";

/**
 * Telefon uchun pastki harakat paneli: qo'ng'iroq + narx so'rash.
 *
 * Katta ekranda sarlavhadagi tugmalar yetarli, telefonda esa ular menyu ichida
 * yo'qoladi — mijoz sahifaning qayerida bo'lmasin, ikki tugma qo'l ostida
 * turadi. Ariza formasi ko'rinib turganda panel yashirinadi (formaning
 * yuborish tugmasini to'sib qo'ymasin), hero'da ham ko'rinmaydi — u yerda
 * o'z tugmalari bor.
 */
export function MobileBar({ phone }: { phone: string | null }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    const form = document.getElementById("ariza");
    let heroVisible = true, formVisible = false;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === hero) heroVisible = e.isIntersecting;
        if (e.target === form) formVisible = e.isIntersecting;
      }
      setShow(!heroVisible && !formVisible);
    }, { threshold: 0.15 });
    if (hero) io.observe(hero);
    if (form) io.observe(form);
    return () => io.disconnect();
  }, []);

  const tel = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-all duration-300 lg:hidden ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="glass flex gap-2 rounded-2xl p-2">
        {tel && (
          <a href={tel} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-insof-900 text-sm font-semibold text-white">
            <Phone size={16} strokeWidth={1.75} /> Qo&apos;ng&apos;iroq
          </a>
        )}
        <a href="#ariza" className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-signal text-sm font-semibold text-white">
          Narx so&apos;rash
        </a>
      </div>
    </div>
  );
}
