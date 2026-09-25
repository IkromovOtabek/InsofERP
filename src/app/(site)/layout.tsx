import type { Metadata } from "next";
import { Unbounded, Onest, JetBrains_Mono } from "next/font/google";
import { getCompany } from "@/lib/company";

/**
 * Ommaviy sayt (landing) qobig'i.
 *
 * Sayt ERP'dan mustaqil ko'rinadi: `.site` sinfi slate tokenlarini asl (ochiq)
 * qiymatiga qaytaradi, shuning uchun xodimning dark rejimi bu sahifaga ta'sir
 * qilmaydi. Fon — beton kulrangi; qorong'i faqat hero, zavod lentasi va
 * poydevorda ishlatiladi, ya'ni sahifa ritmida.
 *
 * Shriftlar shu yerda ulanadi (butun ERP'ga emas):
 *  · Unbounded — sarlavhalar. Keng, geometrik grotesk — logotipdagi
 *    kvadratsimon "INSOF" harflariga eng yaqin shakl. O'zgaruvchan shrift,
 *    og'irlik alohida yuklanmaydi;
 *  · Onest — matn. Zamonaviy neytral sans, ekranda tekis o'qiladi;
 *  · JetBrains Mono — marka, raqam, teg: nakladnoy va pult yozuvi.
 * Uchalasi ham kirillni qo'llab-quvvatlaydi — ruscha taqdimot uchun alohida
 * shrift kerak emas.
 */

const unbounded = Unbounded({ subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"], variable: "--font-unbounded", display: "swap" });
const onest = Onest({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-onest", display: "swap" });
const jetMono = JetBrains_Mono({ subsets: ["latin", "latin-ext", "cyrillic"], weight: ["400", "500", "600"], variable: "--font-jet-mono", display: "swap" });

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
    <div className={`site ${unbounded.variable} ${onest.variable} ${jetMono.variable} min-h-screen bg-beton-100 text-beton-900`}>
      {children}
    </div>
  );
}
