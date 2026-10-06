import type { Viewport } from "next";
import { Outfit } from "next/font/google";
import "./_ui/panel.css";

/**
 * IT panelning umumiy ildizi (login + panel): «Status Board» dizayn tizimi.
 * Tokenlar `.sa` elementiga bog'langan (_ui/panel.css) — ERP sahifalariga ta'sir qilmaydi.
 * Outfit faqat shu yerda yuklanadi (next/font — o'z serverimizdan, CSP font-src 'self').
 */
const outfit = Outfit({ subsets: ["latin", "latin-ext"], variable: "--font-outfit", display: "swap" });

// viewportFit=cover — telefonda env(safe-area-inset-*) ishlashi uchun (pastki tab bar, varaqlar)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9ecf0" },
    { media: "(prefers-color-scheme: dark)", color: "#07090c" },
  ],
};

/**
 * Panel rang rejimi birinchi bo'yoqdan oldin: localStorage "insof-sa-theme" (light|dark), bo'lmasa tizim.
 * `data-theme` panel tokenlarini, `.dark` esa ERP komponentlaridagi qorong'i tuzatishlarni yoqadi — ikkalasi mos turadi.
 */
const SA_THEME = `(function(){try{var d=document.documentElement,t=localStorage.getItem("insof-sa-theme");if(t!=="light"&&t!=="dark"){d.removeAttribute("data-theme");t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}else d.setAttribute("data-theme",t);d.classList.toggle("dark",t==="dark")}catch(e){}})();`;

export default function SuperadminRoot({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sa ${outfit.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: SA_THEME }} />
      {children}
    </div>
  );
}
