import type { Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, JetBrains_Mono, Outfit } from "next/font/google";
import { getAdmin } from "@/lib/control/auth";
import { decodeUiCookie, UI_PREFS_COOKIE, type UiPrefs } from "@/lib/control/ui-prefs";
import { loadUiPrefs } from "@/lib/control/ui-prefs-db";
import "./_ui/panel.css";
import "./_ui/mobile.css";

/**
 * IT panelning umumiy ildizi (login + panel): «Status Board» dizayn tizimi.
 * Tokenlar `.sa` elementiga bog'langan (_ui/panel.css) — ERP sahifalariga ta'sir qilmaydi.
 * Shriftlar next/font orqali (o'z serverimizdan, CSP font-src 'self'): Outfit — asosiy; IBM Plex Sans va
 * JetBrains Mono — faqat telefondagi «Zich Pro» ko'rinishi uchun (oldindan yuklanmaydi).
 */
const outfit = Outfit({ subsets: ["latin", "latin-ext"], variable: "--font-outfit", display: "swap" });
const plex = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-plex", display: "swap", preload: false });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-jbm", display: "swap", preload: false });

// viewportFit=cover — telefonda env(safe-area-inset-*) ishlashi uchun (pastki dock, varaqlar)
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
 * Rang rejimi serverda `.sa[data-theme]` ga yoziladi (prefs: baza, sessiyasiz — cookie) — birinchi bo'yoqdayoq to'g'ri,
 * miltillamaydi. Bu skript faqat ERP komponentlaridagi `html.dark` qoidalarini panel rejimiga moslaydi (bo'yoqdan oldin).
 */
const SA_THEME = `(function(){try{var s=document.currentScript.parentNode,t=s.getAttribute("data-theme"),d=document.documentElement;var k=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);d.classList.toggle("dark",k);try{t?localStorage.setItem("insof-sa-theme",t):localStorage.removeItem("insof-sa-theme")}catch(e){}}catch(e){}})();`;

export default async function SuperadminRoot({ children }: { children: React.ReactNode }) {
  let prefs: UiPrefs;
  try {
    // Panel faqat control rejimida; boshqa rejimda (korxona jarayoni) control bazaga tegilmaydi
    const admin = process.env.INSOF_MODE === "control" ? await getAdmin() : null;
    prefs = admin ? await loadUiPrefs(admin.id) : decodeUiCookie((await cookies()).get(UI_PREFS_COOKIE)?.value);
  } catch {
    // Migratsiya hali qo'llanmagan bo'lsa ham panel ochilsin
    prefs = decodeUiCookie((await cookies()).get(UI_PREFS_COOKIE)?.value);
  }
  return (
    <div className={`sa ${outfit.variable} ${plex.variable} ${mono.variable}`}
      data-theme={prefs.colorMode === "system" ? undefined : prefs.colorMode} data-mobile={prefs.mobileLayout}>
      <script dangerouslySetInnerHTML={{ __html: SA_THEME }} />
      {children}
    </div>
  );
}
