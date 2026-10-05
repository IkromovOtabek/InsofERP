import type { Metadata } from "next";
import Link from "next/link";
import { getCompany } from "@/lib/company";

/**
 * Maxfiylik siyosati — App Store va Google Play uchun majburiy ommaviy sahifa.
 * Do'konlarda "Privacy Policy URL" sifatida `https://<sayt>/maxfiylik` ko'rsatiladi.
 *
 * Matn Insof ECO mobil ilovasi haqiqatda yig'adigan ma'lumotlarga mos yozilgan:
 * telefon + ism (kirish), joylashuv (faol reys davomida fonda ham), push manzili,
 * qurilma ma'lumoti. Reklama, tahlil SDK'lari va sotish yo'q. Ilova yangi
 * ma'lumot yig'a boshlasa, shu ro'yxat ham yangilanishi shart — do'kon
 * anketasi ("Data safety" / "App Privacy") shu sahifaga tayanadi.
 */

const YANGILANGAN = "2026-09-28";

export const metadata: Metadata = {
  title: { absolute: "Maxfiylik siyosati — Insof ECO" },
  description:
    "Insof ECO mobil ilovasi va Insof ERP tizimi qanday shaxsiy ma'lumotlarni yig'adi, nima uchun ishlatadi va ularni qanday himoya qiladi.",
  alternates: { canonical: "/maxfiylik" },
  robots: { index: true, follow: true },
};

function Bolim({ sarlavha, children }: { sarlavha: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-[family-name:var(--font-unbounded)] text-lg font-semibold text-beton-900 sm:text-xl">{sarlavha}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-beton-700">{children}</div>
    </section>
  );
}

export default async function MaxfiylikPage() {
  const c = await getCompany();
  const email = c.email?.trim() || null;
  const phone = c.phone?.trim() || null;

  return (
    <main className="font-[family-name:var(--font-onest)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <p className="mb-6">
          <Link href="/" className="font-[family-name:var(--font-jet-mono)] text-xs uppercase tracking-widest text-beton-500 hover:text-beton-900">
            ← {c.name}
          </Link>
        </p>
        <h1 className="font-[family-name:var(--font-unbounded)] text-2xl font-bold text-beton-900 sm:text-4xl">Maxfiylik siyosati</h1>
        <p className="mt-3 font-[family-name:var(--font-jet-mono)] text-xs uppercase tracking-widest text-beton-500">
          Insof ECO mobil ilovasi · yangilangan {YANGILANGAN}
        </p>

        <div className="mt-10 space-y-10">
          <Bolim sarlavha="1. Kim ma'lumot yig'adi">
            <p>
              Ushbu siyosat <strong>Insof ECO</strong> mobil ilovasiga (iOS va Android) va u ulanadigan Insof ERP tizimiga
              tegishli. Ma'lumotlarning egasi va ishlovchisi — <strong>{c.name}</strong>
              {c.address?.trim() ? <> ({c.address.trim()})</> : null}.
            </p>
            <p>
              Ilova beton zavodi xodimlari (haydovchi, brigadir, logist, sotuv va boshqa bo'limlar), zavod mijozlari va
              hamkorlari uchun mo'ljallangan. Foydalanuvchi hisoblari zavod ma'muriyati tomonidan yaratiladi yoki telefon
              raqami orqali ro'yxatdan o'tiladi.
            </p>
          </Bolim>

          <Bolim sarlavha="2. Qanday ma'lumotlar yig'iladi">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Hisob ma'lumotlari:</strong> telefon raqami, ism-familiya, lavozim yoki rol, tashkilot nomi. Kirish
                uchun bir martalik kod telefon raqamining Telegram hisobiga yuboriladi.
              </li>
              <li>
                <strong>Joylashuv:</strong> haydovchi uchun — faqat faol reys davomida mashinaning joylashuvi, shu jumladan
                ilova fonda bo'lganida ham. Reys yakunlangach fon kuzatuv to'xtaydi. Boshqa rollarda joylashuv faqat ilova
                ochiq bo'lganda, obyekt manzilini aniqlash uchun ishlatiladi.
              </li>
              <li>
                <strong>Ish ma'lumotlari:</strong> zayavkalar, reyslar, nakladnoylar, topshiriqlar va ularga tegishli
                izohlar — ya'ni xodim o'z ishini bajarish jarayonida kiritgan ma'lumotlar.
              </li>
              <li>
                <strong>Qurilma ma'lumotlari:</strong> qurilma modeli, operatsion tizim versiyasi, ilova versiyasi va push
                bildirishnomalar uchun qurilma manzili (token).
              </li>
            </ul>
            <p>
              Ilova kontaktlar, galereya, mikrofon yoki reklama identifikatorlarini yig'maydi. Reklama va tahliliy
              kuzatuv (analytics) SDK'lari ishlatilmaydi.
            </p>
          </Bolim>

          <Bolim sarlavha="3. Nima uchun ishlatiladi">
            <ul className="list-disc space-y-2 pl-5">
              <li>Xodimni tizimga kiritish va uning roliga mos bo'limlarni ko'rsatish.</li>
              <li>Reys davomida mashina qayerdaligini dispetcher va buyurtmachiga ko'rsatish, yetkazish vaqtini taxminlash.</li>
              <li>Yetkazish faktini tasdiqlash (mashina obyektga yetib kelganini aniqlash).</li>
              <li>Yangi topshiriq, reys yoki tasdiq haqida push bildirishnoma yuborish.</li>
              <li>Ilova ishidagi xatolarni aniqlash va xavfsizlikni ta'minlash.</li>
            </ul>
          </Bolim>

          <Bolim sarlavha="4. Kimga beriladi">
            <p>
              Ma'lumotlar sotilmaydi va reklama maqsadida hech kimga berilmaydi. Reys davomidagi joylashuv faqat shu
              reysga aloqador shaxslarga — zavod dispetcheri va buyurtmachiga — ko'rinadi.
            </p>
            <p>Ilova ishlashi uchun quyidagi texnik xizmatlar ishlatiladi:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Apple Push Notification service va Firebase Cloud Messaging</strong> (Expo push xizmati orqali) —
                bildirishnoma yetkazish uchun; ularga faqat qurilma manzili beriladi.
              </li>
              <li>
                <strong>Google Maps (Android) va Apple Maps (iOS)</strong> — xaritani chizish uchun; xarita provayderi
                ko'rsatilayotgan hududni oladi.
              </li>
              <li>
                <strong>Telegram</strong> (Telegram Gateway va Insof ERP boti) — bir martalik kirish kodini yetkazish uchun;
                unga faqat telefon raqami va kod beriladi.
              </li>
              <li>Marshrut hisoblash uchun o'z serverimizdagi xizmat — koordinatalar tashqi kompaniyaga yuborilmaydi.</li>
            </ul>
            <p>Ma'lumotlar {c.name} boshqaruvidagi serverlarda saqlanadi.</p>
          </Bolim>

          <Bolim sarlavha="5. Qancha vaqt saqlanadi">
            <p>
              Hisob va ish ma'lumotlari xodim yoki mijoz zavod bilan hamkorlik qilgan davr mobaynida, shuningdek
              buxgalteriya va shartnoma hujjatlari uchun qonunda belgilangan muddat saqlanadi. Reys marshruti reys
              tarixining bir qismi sifatida saqlanadi. Push manzili ilovadan chiqilganda o'chiriladi.
            </p>
          </Bolim>

          <Bolim sarlavha="6. Sizning huquqlaringiz va hisobni o'chirish">
            <p>
              Siz o'zingiz haqingizdagi ma'lumotlarni ko'rish, tuzatish yoki o'chirishni so'rashingiz mumkin.
              Hisobni o'chirish uchun ilovadagi profil bo'limidagi &quot;Hisobni o'chirish&quot; tugmasidan foydalaning.
              Ilovani o'chirib tashlagan bo'lsangiz —{" "}
              <Link href="/maxfiylik/hisobni-ochirish" className="underline hover:text-beton-900">shu sahifada so'rov qoldiring</Link>{" "}
              yoki quyidagi manzillar orqali murojaat qiling — so'rov 30 kun ichida bajariladi. Hisob o'chirilganda shaxsiy ma'lumotlar o'chiriladi;
              qonun talab qiladigan moliyaviy hujjatlar shaxssizlantirilgan holda saqlanib qolishi mumkin.
            </p>
            <p>
              Joylashuvga ruxsatni istalgan vaqt telefon sozlamalaridan bekor qilishingiz mumkin; bu holda reys kuzatuvi
              ishlamaydi.
            </p>
          </Bolim>

          <Bolim sarlavha="7. Xavfsizlik">
            <p>
              Ilova server bilan faqat shifrlangan (HTTPS) aloqa qiladi. Kirish kodi va sessiya qurilmaning himoyalangan
              xotirasida saqlanadi. Serverga kirish rol asosida cheklangan va jurnalga yoziladi.
            </p>
          </Bolim>

          <Bolim sarlavha="8. Bolalar">
            <p>Ilova 18 yoshdan kichiklar uchun mo'ljallanmagan va ular haqida ataylab ma'lumot yig'maydi.</p>
          </Bolim>

          <Bolim sarlavha="9. O'zgarishlar">
            <p>
              Siyosat o'zgarsa, shu sahifada yangi sana bilan e'lon qilinadi. Muhim o'zgarishlar haqida ilova orqali ham
              xabar beramiz.
            </p>
          </Bolim>

          <Bolim sarlavha="10. Aloqa">
            <p>Savol va so'rovlar uchun:</p>
            <ul className="list-none space-y-1 font-[family-name:var(--font-jet-mono)] text-sm">
              {email ? (
                <li>
                  E-mail: <a className="underline hover:text-beton-900" href={`mailto:${email}`}>{email}</a>
                </li>
              ) : null}
              {phone ? (
                <li>
                  Telefon: <a className="underline hover:text-beton-900" href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>
                </li>
              ) : null}
              {c.address?.trim() ? <li>Manzil: {c.address.trim()}</li> : null}
            </ul>
          </Bolim>
        </div>
      </div>
    </main>
  );
}
