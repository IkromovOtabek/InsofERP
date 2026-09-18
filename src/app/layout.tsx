import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";

// Asosiy shrift — geometrik, keng, sarlavhalarda kuchli
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-jakarta", display: "swap" });
// Kirill matnlar uchun zaxira (Jakarta kirillni qo'llab-quvvatlamaydi)
const inter = Inter({ subsets: ["cyrillic", "latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Insof ERP", template: "%s · Insof ERP" },
  description: "Beton zavodi boshqaruv tizimi",
};

// localStorage'dagi tanlov, bo'lmasa tizim sozlamasi
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("insof-theme");if(t!=="dark"&&t!=="light"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={`${jakarta.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Rejimni birinchi bo'yoqdan oldin qo'llash — oq "flash" bo'lmasligi uchun */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
