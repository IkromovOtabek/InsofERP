import type { Metadata } from "next";
import Link from "next/link";
import { getCompany } from "@/lib/company";
import { DeletionForm } from "./deletion-form";

/**
 * Hisobni o'chirish so'rovi — Google Play talabi: ilovasiz ham so'rov berish yo'li bo'lishi kerak
 * (Play Console "Data safety" da shu manzil ko'rsatiladi). Ilova ichida esa profil bo'limida tugma bor.
 * Shaxs bu yerda tekshirilmaydi — so'rov direktorga tushadi, u telefon qilib tasdiqlaydi.
 */

export const metadata: Metadata = {
  title: { absolute: "Hisobni o'chirish — Insof ECO" },
  description: "Insof ECO ilovasidagi hisobingizni va shaxsiy ma'lumotlaringizni o'chirish so'rovi.",
  alternates: { canonical: "/maxfiylik/hisobni-ochirish" },
  robots: { index: true, follow: true },
};

export default async function HisobniOchirishPage() {
  const c = await getCompany();
  return (
    <main className="font-[family-name:var(--font-onest)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <p className="mb-6">
          <Link href="/maxfiylik" className="font-[family-name:var(--font-jet-mono)] text-xs uppercase tracking-widest text-beton-500 hover:text-beton-900">
            ← Maxfiylik siyosati
          </Link>
        </p>
        <h1 className="font-[family-name:var(--font-unbounded)] text-2xl font-bold text-beton-900 sm:text-4xl">Hisobni o'chirish</h1>
        <p className="mt-3 font-[family-name:var(--font-jet-mono)] text-xs uppercase tracking-widest text-beton-500">Insof ECO mobil ilovasi</p>

        <div className="mt-8 space-y-3 text-[15px] leading-relaxed text-beton-700">
          <p>
            <strong>Eng tez yo'li — ilovaning o'zida:</strong> Profil → &quot;Hisobni o'chirish&quot;. Mijoz hisobi darhol o'chiriladi.
            Zavod xodimining hisobini rahbariyat bergan, shuning uchun uning so'rovi direktor tasdig'idan keyin bajariladi.
          </p>
          <p>
            Ilovani o'chirib tashlagan bo'lsangiz, quyidagi formani to'ldiring. Shaxsingizni tasdiqlash uchun ko'rsatilgan
            raqamga qo'ng'iroq qilamiz, so'ng hisob 30 kun ichida o'chiriladi.
          </p>
          <p>
            Nima o'chiriladi: telefon raqami, ism, parol, qurilma va bildirishnoma ma'lumotlari, ilovaga kirish. Nima qoladi:
            qonun talab qiladigan buxgalteriya va mehnat hujjatlari (nakladnoy, to'lov, tabel) — ular shaxsga bog'lanmagan holda saqlanadi.
          </p>
        </div>

        <div className="mt-10 rounded-2xl bg-white p-6 ring-1 ring-beton-200 sm:p-8">
          <DeletionForm />
        </div>

        <p className="mt-8 text-sm text-beton-500">
          Savollar uchun: {c.email?.trim() ? <a className="underline" href={`mailto:${c.email.trim()}`}>{c.email.trim()}</a> : null}
          {c.email?.trim() && c.phone?.trim() ? " · " : null}
          {c.phone?.trim() ? <a className="underline" href={`tel:${c.phone.trim().replace(/\s+/g, "")}`}>{c.phone.trim()}</a> : null}
        </p>
      </div>
    </main>
  );
}
