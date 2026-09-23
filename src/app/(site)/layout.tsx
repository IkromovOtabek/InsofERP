import type { Metadata } from "next";
import { Saira, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { getCompany } from "@/lib/company";

/**
 * Ommaviy sayt (landing) qobig'i.
 *
 * Sayt ERP'dan mustaqil ko'rinadi: `.site` sinfi slate tokenlarini asl (ochiq)
 * qiymatiga qaytaradi, shuning uchun xodimning dark rejimi bu sahifaga ta'sir
 * qilmaydi. Fon — beton kulrangi; qorong'i faqat hero, zavod lentasi va
 * poydevorda ishlatiladi, ya'ni sahifa ritmida.
 *
 * Shriftlar shu yerda ulanadi (butun ERP'ga emas) va soha ohangida tanlangan:
 *  · Saira — sarlavhalar. Kvadratsimon, keng grotesk: logotipdagi "INSOF"
 *    harflariga eng yaqin shakl;
 *  · IBM Plex Sans — matn. Muhandislik hujjatlari uchun chizilgan, quruq va
 *    aniq — beton zavodiga startap shriftidan ko'ra mosroq;
 *  · IBM Plex Mono — marka, kod, raqam: nakladnoy va pult yozuvi.
 */

const saira = Saira({ subsets: ["latin", "latin-ext"], variable: "--font-saira", display: "swap" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const c = await getCompany();
  const title = `${c.name} — temir beton mahsulotlari`;
  const description = c.about ?? "Tayyor beton va temir-beton mahsulotlari ishlab chiqarish. Obyektga o'z transportimizda yetkazib beramiz.";
  return {
    title: { absolute: title },
    description,
    openGraph: { title, description, type: "website", images: ["/media/zavod.jpg"], locale: "uz_UZ" },
  };
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`site ${saira.variable} ${plexSans.variable} ${plexMono.variable} min-h-screen bg-beton-100 text-beton-900`}>
      {children}
    </div>
  );
}
