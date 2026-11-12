import { redirect } from "next/navigation";

/**
 * «Bekor qilingan zayavkalar» tahlili olib tashlandi: bekor qilingan zayavka bazadan o'chiriladi (`lib/purge-cancelled.ts`),
 * sahifa doim 0 ko'rsatardi. Eski havola va xatcho'plar Sotuvlarga olib boradi.
 */
export default function Page() {
  redirect("/bi-tahlil/sotuvlar");
}
