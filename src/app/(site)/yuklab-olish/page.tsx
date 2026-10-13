import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Download, KeyRound, LogIn, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { getCompany } from "@/lib/company";
import { apkInfo, apkSize, iosAppUrl } from "@/lib/apk";

/**
 * Xodimlar uchun Insof ECO o'rnatish qo'llanmasi — `/yuklab-olish`.
 *
 * Havola Telegram guruhiga tashlanadi; o'quvchi telefonni yaxshi bilmasligi mumkin, shuning uchun
 * har qadam bitta harakat, tugma nomi «…» ichida. Login talab qilmaydi (middleware'da ochiq):
 * sahifada maxfiy narsa yo'q, login va parolni xodimga rahbar alohida beradi.
 *
 * Telefon turi User-Agent'dan aniqlanadi — o'sha bo'lim birinchi turadi; ikkalasi ham doim ko'rinadi.
 */

export const metadata: Metadata = {
  title: { absolute: "Insof ECO ilovasini o'rnatish — qo'llanma" },
  description: "Android va iPhone telefoniga Insof ECO ilovasini o'rnatish va login-parol bilan kirish bo'yicha oddiy qo'llanma.",
  alternates: { canonical: "/yuklab-olish" },
  robots: { index: false, follow: false },
};

type Qadam = { sarlavha: React.ReactNode; matn?: React.ReactNode };

/** Ekrandagi tugma nomi — xodim telefonda aynan shu yozuvni qidiradi. */
function T({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-block rounded-md border border-beton-300 bg-white px-1.5 py-px font-semibold whitespace-nowrap text-beton-900">
      {children}
    </span>
  );
}

function Qadamlar({ items }: { items: Qadam[] }) {
  return (
    <ol className="space-y-3">
      {items.map((q, i) => (
        <li key={i} className="flex gap-4 rounded-2xl border border-beton-200 bg-white p-4 sm:p-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-insof-600 text-base font-bold text-white">{i + 1}</span>
          <div className="min-w-0 space-y-1.5 pt-1">
            <p className="text-[17px] leading-snug font-semibold text-beton-900">{q.sarlavha}</p>
            {q.matn ? <div className="text-[15px] leading-relaxed text-beton-700">{q.matn}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Eslatma({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-signal/40 bg-signal/10 p-4 text-[15px] leading-relaxed text-beton-800">
      <TriangleAlert size={20} className="mt-0.5 shrink-0 text-signal-dim" />
      <div>{children}</div>
    </div>
  );
}

function Bolim({ id, icon, sarlavha, izoh, children }: { id: string; icon: React.ReactNode; sarlavha: string; izoh: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-insof-900 text-white">{icon}</span>
        <div>
          <h2 className="font-[family-name:var(--font-unbounded)] text-xl font-bold text-beton-900 sm:text-2xl">{sarlavha}</h2>
          <p className="text-sm text-beton-600">{izoh}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default async function YuklabOlishPage() {
  const [c, apk, h] = await Promise.all([getCompany(), apkInfo(), headers()]);
  const iosUrl = iosAppUrl();
  const testFlight = iosUrl?.includes("testflight.apple.com") ?? false;
  const ua = h.get("user-agent") ?? "";
  const iphone = /iPhone|iPad|iPod/i.test(ua);
  const phone = c.phone?.trim() || null;

  const android = (
    <Bolim key="android" id="android" icon={<Smartphone size={22} />} sarlavha="Android telefon" izoh="Samsung, Redmi, Xiaomi, Honor, Tecno va boshqalar">
      {apk.exists ? (
        <a
          href="/api/public/app/android"
          download
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-signal text-lg font-semibold text-white active:scale-[0.98]"
        >
          <Download size={22} /> Android uchun yuklab olish
          <span className="text-sm font-normal text-white/80">· {apkSize(apk.size)}</span>
        </a>
      ) : (
        <Eslatma>Android fayli hozircha tayyor emas. Birozdan keyin qayta oching yoki rahbaringizga ayting.</Eslatma>
      )}
      <Qadamlar
        items={[
          {
            sarlavha: <>Yuqoridagi to&apos;q sariq <T>Android uchun yuklab olish</T> tugmasini bosing</>,
            matn: (
              <>
                Fayl yuklana boshlaydi ({apk.exists ? apkSize(apk.size) : "40 MB"} atrofida, Wi-Fi yoki yaxshi internet bo&apos;lsin). Agar hech narsa bo&apos;lmasa —
                sahifani Telegram ichida ochgansiz: yuqori o&apos;ng burchakdagi uch nuqta <T>⋮</T> ni bosing va
                <T>Brauzerda ochish</T> ni tanlang, so&apos;ng tugmani qayta bosing.
              </>
            ),
          },
          {
            sarlavha: <>Telefon «fayl xavfli bo&apos;lishi mumkin» desa — <T>Baribir yuklab olish</T> ni bosing</>,
            matn: <>Bu oddiy ogohlantirish: ilova Play Market&apos;dan emas, zavodning o&apos;z saytidan yuklanmoqda.</>,
          },
          {
            sarlavha: <>Yuklab bo&apos;lgach <T>Ochish</T> ni bosing</>,
            matn: (
              <>
                Tugma ko&apos;rinmasa: ekranni yuqoridan pastga torting, bildirishnomalar ichidan <b>insof-eco…apk</b> faylini bosing.
                Yoki <b>Fayllar</b> → <b>Yuklanmalar</b> papkasidan oching.
              </>
            ),
          },
          {
            sarlavha: <>«Noma&apos;lum manbadan o&apos;rnatish» so&apos;ralsa — <T>Sozlamalar</T> ni bosing</>,
            matn: (
              <>
                Ochilgan oynada <T>Shu manbadan ruxsat berish</T> yonidagi tugmachani yoqing (ko&apos;k/yashil bo&apos;ladi), keyin
                telefonning <b>orqaga</b> tugmasini bosing. Bu faqat bir marta so&apos;raladi.
              </>
            ),
          },
          {
            sarlavha: <><T>O&apos;rnatish</T> ni bosing</>,
            matn: (
              <>
                «Play Protect» oynasi chiqsa: <T>Batafsil</T> → <T>Baribir o&apos;rnatish</T>. Skanerlashni taklif qilsa ham
                o&apos;rnatishni tanlang — ilova xavfsiz.
              </>
            ),
          },
          {
            sarlavha: <>Tayyor! <T>Ochish</T> ni bosing</>,
            matn: <>Ekranda <b>Insof ECO</b> belgisi paydo bo&apos;ladi — keyingi safar shu belgidan ochasiz. Endi pastdagi «Ilovaga kirish» bo&apos;limiga o&apos;ting.</>,
          },
        ]}
      />
    </Bolim>
  );

  const ios = (
    <Bolim key="iphone" id="iphone" icon={<Smartphone size={22} />} sarlavha="iPhone" izoh="Apple'ning bepul TestFlight ilovasi orqali o'rnatiladi">
      {iosUrl ? (
        <a
          href={iosUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-beton-900 text-lg font-semibold text-white active:scale-[0.98]"
        >
          <Download size={22} /> iPhone uchun yuklab olish
        </a>
      ) : (
        <Eslatma>iPhone ilovasi tez orada chiqadi. Hozircha rahbaringizdan so&apos;rang.</Eslatma>
      )}
      {iosUrl && testFlight ? (
        <Qadamlar
          items={[
            {
              sarlavha: <>Yuqoridagi qora <T>iPhone uchun yuklab olish</T> tugmasini bosing</>,
              matn: <>«TestFlight» sahifasi ochiladi. Unda ikki qadam yozilgan — biz ularni quyida tushuntiramiz.</>,
            },
            {
              sarlavha: <>Avval <b>TestFlight</b> ilovasini o&apos;rnating</>,
              matn: (
                <>
                  Sahifadagi 1-qadam ostidagi <T>View in App Store</T> ni bosing → App Store ochiladi → <T>Yuklash</T> (yoki bulut
                  belgisi) ni bosing. Face ID yoki Apple ID paroli so&apos;ralishi mumkin — bu sizning telefoningiz paroli.
                  TestFlight — Apple&apos;ning o&apos;z bepul ilovasi.
                </>
              ),
            },
            {
              sarlavha: <>TestFlight o&apos;rnatilgach, <b>shu sahifaga qayting</b> va qora tugmani yana bosing</>,
              matn: (
                <>
                  Endi 2-qadam ostidagi <T>Start Testing</T> (Testni boshlash) ni bosing. TestFlight ochiladi — unda <T>Accept</T>
                  (Qabul qilish), so&apos;ng <T>Install</T> (O&apos;rnatish) ni bosing.
                </>
              ),
            },
            {
              sarlavha: <>O&apos;rnatilgach <T>Open</T> (Ochish) ni bosing</>,
              matn: (
                <>
                  Birinchi ochilishda kichik tushuntirish oynasi chiqadi — <T>Next</T> va <T>Start Testing</T> ni bosing.
                  Ekranda <b>Insof ECO</b> belgisi paydo bo&apos;ladi. Endi pastdagi «Ilovaga kirish» bo&apos;limiga o&apos;ting.
                </>
              ),
            },
          ]}
        />
      ) : null}
      {iosUrl && testFlight ? (
        <Eslatma>
          Yangi versiya chiqqanda TestFlight&apos;dan xabar keladi — <b>TestFlight</b> ilovasini ochib, Insof ECO yonidagi <T>Update</T> ni bosing.
          TestFlight&apos;ni o&apos;chirib yubormang.
        </Eslatma>
      ) : null}
    </Bolim>
  );

  return (
    <main className="min-h-screen bg-beton-100 font-[family-name:var(--font-onest)]">
      <div className="mx-auto max-w-2xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
        <header className="space-y-4">
          <p>
            <Link href="/" className="font-[family-name:var(--font-jet-mono)] text-xs tracking-widest text-beton-500 uppercase hover:text-beton-900">
              ← {c.name}
            </Link>
          </p>
          <h1 className="font-[family-name:var(--font-unbounded)] text-2xl leading-tight font-bold text-beton-900 sm:text-3xl">
            Insof ECO ilovasini telefonga o&apos;rnatish
          </h1>
          <p className="text-[16px] leading-relaxed text-beton-700">
            Qadamlarni tartib bilan, birma-bir bajaring. Hammasi 5–10 daqiqa oladi. Sizga kerak: telefon, internet va rahbaringiz
            bergan <b>login</b> hamda <b>parol</b>.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <a href="#android" className="flex h-14 items-center justify-center rounded-2xl border border-beton-300 bg-white text-base font-semibold text-beton-900">
              Menda Android
            </a>
            <a href="#iphone" className="flex h-14 items-center justify-center rounded-2xl border border-beton-300 bg-white text-base font-semibold text-beton-900">
              Menda iPhone
            </a>
          </div>
          <p className="hidden text-sm text-beton-600 sm:block">Bu sahifani telefoningizda oching — kompyuterga ilova o&apos;rnatilmaydi.</p>
        </header>

        {iphone ? [ios, android] : [android, ios]}

        <Bolim id="kirish" icon={<LogIn size={22} />} sarlavha="Ilovaga kirish" izoh="Android va iPhone uchun bir xil">
          <Qadamlar
            items={[
              {
                sarlavha: <><b>Insof ECO</b> ilovasini oching</>,
                matn: <>Avval do&apos;kon sahifasi (mahsulotlar) ochiladi — bu normal holat.</>,
              },
              {
                sarlavha: <>Pastki o&apos;ng burchakdagi <T>Profil</T> ni bosing, so&apos;ng <T>Kirish</T> ni bosing</>,
              },
              {
                sarlavha: <>Yuqoridan <T>Login va parol</T> ni tanlang</>,
                matn: <>«Telefon raqam» emas — xodimlar login va parol bilan kiradi.</>,
              },
              {
                sarlavha: <><T>Login yoki telefon</T> qatoriga sizga berilgan <b>loginni</b> yozing</>,
                matn: <>Harfma-harf, bo&apos;sh joysiz yozing. Katta va kichik harf farq qiladi.</>,
              },
              {
                sarlavha: <><T>Parol</T> qatoriga <b>parolingizni</b> yozing</>,
                matn: <>Parol yulduzcha bo&apos;lib ko&apos;rinadi. To&apos;g&apos;ri yozganingizni tekshirish uchun o&apos;ngdagi ko&apos;z belgisini bosing.</>,
              },
              {
                sarlavha: <><T>Kirish</T> tugmasini bosing</>,
                matn: (
                  <>
                    Ilova <b>PIN kod</b> o&apos;rnatishni taklif qilsa — o&apos;zingiz eslab qoladigan 4 ta raqam kiriting va takrorlang.
                    Keyingi safar parolsiz, shu 4 raqam bilan kirasiz. Xohlamasangiz <T>Keyinroq sozlayman</T> ni bosing.
                  </>
                ),
              },
              {
                sarlavha: <>Ilova ruxsat so&apos;rasa — <T>Ruxsat berish</T> ni bosing</>,
                matn: <>Joylashuv, kamera va bildirishnomalar davomat (ishga kelish) va ish xabarlari uchun kerak.</>,
              },
            ]}
          />
          <Eslatma>
            <p className="font-semibold">«Login yoki parol noto&apos;g&apos;ri» chiqsa:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li><T>Login va parol</T> tanlanganini tekshiring.</li>
              <li>Boshida yoki oxirida bo&apos;sh joy qolmaganini, katta-kichik harfni tekshiring.</li>
              <li>5 marta xato kiritilsa, kirish bir muddat yopiladi — biroz kutib, qayta urinib ko&apos;ring.</li>
              <li>Baribir kira olmasangiz — rahbaringizga murojaat qiling, u parolni yangilab beradi.</li>
            </ul>
          </Eslatma>
        </Bolim>

        <section className="flex gap-3 rounded-2xl bg-insof-900 p-5 text-[15px] leading-relaxed text-white/85">
          <ShieldCheck size={22} className="mt-0.5 shrink-0 text-white" />
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-semibold text-white"><KeyRound size={16} /> Login va parolingiz — faqat sizniki</p>
            <p>Uni hech kimga bermang va guruhga yozmang. Telefoningiz yo&apos;qolsa yoki boshqa telefonga o&apos;tsangiz, rahbaringizga ayting.</p>
            {phone ? <p>Savol bo&apos;lsa: <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-white underline">{phone}</a></p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
