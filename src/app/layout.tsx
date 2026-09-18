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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={`${jakarta.variable} ${inter.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
