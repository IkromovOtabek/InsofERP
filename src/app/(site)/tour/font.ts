import { Archivo } from "next/font/google";

/**
 * Zavod turi shrifti (dizayn: Archivo 300–800). O'zgaruvchan shrift — og'irliklar alohida yuklanmaydi.
 * Sayt qobig'ida (`(site)/layout.tsx`) `--font-archivo` o'zgaruvchisi ulanadi; `fontFamily` esa 3D sahnaga
 * (kanvas yozuvlari) beriladi — `next/font` oilasi nomi "Archivo" emas, xeshlangan.
 */
export const archivo = Archivo({ subsets: ["latin", "latin-ext"], variable: "--font-archivo", display: "swap" });
