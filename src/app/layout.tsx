import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";
import { ScriptProvider } from "@/components/script-provider";
import { YOZUV_SCRIPT, YOZUV_STYLE } from "@/lib/translit";

// Asosiy shrift — geometrik, keng, sarlavhalarda kuchli
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-jakarta", display: "swap" });
// Kirill matnlar uchun zaxira (Jakarta kirillni qo'llab-quvvatlamaydi); cyrillic-ext — ў қ ғ ҳ uchun
const inter = Inter({ subsets: ["cyrillic", "cyrillic-ext", "latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Insof ERP", template: "%s · Insof ERP" },
  description: "Beton zavodi boshqaruv tizimi",
};

// Telefon brauzerining manzil satri sahifa foni bilan bir xil rangda bo'ladi
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#111418" },
  ],
};

// localStorage'dagi tanlov, bo'lmasa tizim sozlamasi. Fon (palitra) va sidebar holati ham shu yerda —
// ikkalasi ham birinchi bo'yoqdan oldin qo'llanishi kerak, aks holda sahifa sakrab ochiladi.
const THEME_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("insof-theme");if(t!=="dark"&&t!=="light"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(t==="dark")d.classList.add("dark");var p=localStorage.getItem("insof-palette");if(p==="safir")d.setAttribute("data-palette",p);if(localStorage.getItem("insof-sidebar")==="1")d.classList.add("sb-collapsed")}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={`${jakarta.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Rejimni birinchi bo'yoqdan oldin qo'llash — oq "flash" bo'lmasligi uchun */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Yozuv (lotin/kirill) — tanlov cookie'da; kirillda body birinchi o'tishgacha yashirin */}
        <style dangerouslySetInnerHTML={{ __html: YOZUV_STYLE }} />
        <script dangerouslySetInnerHTML={{ __html: YOZUV_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased"><ScriptProvider>{children}</ScriptProvider></body>
    </html>
  );
}
