import { botUsername } from "@/lib/telegram/api";
import { ResetForm } from "./reset-form";

/**
 * Parolni tiklash sahifasi. Bot nomi serverda aniqlanadi: forma "kod botga keladi" deb
 * yozishi va botga havola berishi uchun (bot sozlanmagan bo'lsa — eski, SMS ko'rinishi).
 */
export default async function ResetPage() {
  return <ResetForm botUsername={await botUsername()} />;
}
