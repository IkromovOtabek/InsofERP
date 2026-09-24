import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight, ClipboardList, Factory, FileCheck2, FlaskConical, LogIn,
  Mail, MapPin, Phone, Presentation, QrCode, Truck, Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { fmtNum } from "@/lib/format";
import { SiteHeader } from "./site-header";
import { LeadForm } from "./lead-form";
import { Showreel, type Clip } from "./showreel";
import { Catalog, type CatalogGroup, type CatalogProduct } from "./catalog";
import { PlantLocation } from "./plant-map";

/** Narxlar saytda ko'rsatilmaydi — mijoz hajm va manzilga qarab narx so'raydi.
 *  Ko'rsatish kerak bo'lsa shu yerni `true` qilish kifoya. */
const SHOW_PRICES = false;

/** Hero banneri. Suratni almashtirish uchun shu fayl ustiga yozish kifoya —
 *  kodga tegilmaydi: `public/media/hero.jpg`. */
const HERO_IMAGE = "/media/hero.jpg";

const CLIPS: Clip[] = [
  { src: "/media/zavod.mp4", poster: "/media/zavod.jpg", title: "Zavod va mikser parki", text: "Avtomatlashtirilgan tugun, o'z transportimiz", meta: "Tugun · mikser parki" },
  { src: "/media/maydon.mp4", poster: "/media/maydon.jpg", title: "Tayyor mahsulot maydoni", text: "Yig'ma plitalar, ustun va rigellar", meta: "Tayyor mahsulot · kran" },
  { src: "/media/xomashyo.mp4", poster: "/media/xomashyo.jpg", title: "Xomashyo bazasi", text: "Qum, shag'al — o'z bazamizdan", meta: "Qum · shag'al · sement" },
];

const DIRECTIONS = [
  { img: "/media/zavod.jpg", tag: "Tayyor beton", title: "Mikserlarda obyektga", text: "Turli markadagi beton. Hajm va soat oldindan kelishiladi, quyish uzilmaydi." },
  { img: "/media/maydon.jpg", tag: "Temir-beton", title: "Yig'ma konstruksiyalar", text: "Plita, ustun, rigel va boshqalar — kran bilan yuklab beriladi." },
  { img: "/media/xomashyo.jpg", tag: "Xomashyo", title: "Qum va shag'al", text: "Baza o'zimizda, yuk transporti ham o'zimizniki — muddat cho'zilmaydi." },
];

const ADVANTAGES = [
  { icon: Factory, title: "O'z zavodimiz", text: "Vositachisiz — mahsulot zavoddan to'g'ridan-to'g'ri obyektingizga ketadi." },
  { icon: FlaskConical, title: "Retsept va laboratoriya", text: "Har bir partiya tasdiqlangan retsept bo'yicha tayyorlanadi va nazoratdan o'tadi." },
  { icon: Truck, title: "O'z transport parki", text: "Mikserlar va yuk mashinalari — yetkazib berishni boshqa firmaga bog'lab qo'ymaymiz." },
  { icon: QrCode, title: "QR-nakladnoy", text: "Har bir yuk hujjatidagi QR kodni telefoningizdan tekshirasiz: hajm, marka, sana." },
  { icon: FileCheck2, title: "Rasmiy shartnoma", text: "Shartnoma, schyot-faktura, bank orqali hisob-kitob — yuridik shaxslar bilan to'liq rasmiy." },
  { icon: Wallet, title: "To'lov muddati", text: "Doimiy mijozlar uchun kelishilgan limit va to'lov muddati beriladi." },
];

const STEPS = [
  { title: "Ariza", text: "Telefon yoki saytdagi forma orqali hajm, marka va manzilni aytasiz." },
  { title: "Hisob-kitob", text: "Narx, muddat va yetkazib berish sharti kelishiladi, shartnoma rasmiylashtiriladi." },
  { title: "Ishlab chiqarish", text: "Partiya rejaga qo'yiladi, xomashyo ajratiladi va sifat nazoratidan o'tadi." },
  { title: "Yetkazib berish", text: "Belgilangan vaqtda obyektga chiqamiz, QR-nakladnoy bilan topshiramiz." },
];

export default async function LandingPage() {
  const [company, groups, products] = await Promise.all([
    getCompany(),
    db.productGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.product.findMany({
      where: { isActive: true },
      orderBy: [{ groupId: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, unit: true, strengthClass: true, price: true, groupId: true },
    }),
  ]);

  const phone = company.phone?.trim() || null;
  const email = company.email?.trim() || null;
  const hours = company.workingHours?.trim() || null;
  const years = company.foundedYear ? new Date().getFullYear() - company.foundedYear : null;
  const capacity = company.dailyCapacityM3 ? fmtNum(company.dailyCapacityM3) : null;

  // Hero lentasidagi markalar — tayyor beton (m³) kodlari; bo'lmasa umumiy ro'yxat
  const markalar = (products.filter((p) => p.unit === "m3").length > 0 ? products.filter((p) => p.unit === "m3") : products)
    .map((p) => p.code)
    .slice(0, 5);

  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const catalogProducts: CatalogProduct[] = products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    strengthClass: p.strengthClass,
    price: String(p.price),
    groupId: p.groupId ?? "root",
    groupName: (p.groupId && groupName.get(p.groupId)) || "Boshqa mahsulotlar",
  }));
  const catalogGroups: CatalogGroup[] = [
    ...groups.map((g) => ({ id: g.id, name: g.name, count: catalogProducts.filter((p) => p.groupId === g.id).length })),
    { id: "root", name: "Boshqa mahsulotlar", count: catalogProducts.filter((p) => p.groupId === "root").length },
  ].filter((g) => g.count > 0);

  return (
    <>
      <SiteHeader phone={phone} email={email} hours={hours} />

      {/* ───────── Hero banneri ───────── */}
      {/* Balandlik: ekran bo'yi minus sarlavha (xizmat qatori 2.5rem + panel 5rem).
          `svh` — telefon brauzerining pastki paneli hisobga olinadi. */}
      <section className="relative isolate flex min-h-[calc(100svh-7.5rem)] items-center overflow-hidden bg-insof-900">
        {/* Surat markazidagi INSOF logotipi sarlavha bilan ustma-ust tushmasin uchun
           kadr chapdan boshlanadi (`object-left`). Sifat 100 — manba allaqachon
           cho'zilgan, Next uni qayta siqib yana yumshatmasin. */}
        <Image src={HERO_IMAGE} alt="" fill priority quality={100} sizes="100vw" className="-z-20 object-cover object-left" />
        {/* Soya faqat matn ostida quyuq: chapda sarlavha o'qilsin, o'rtadan o'ngga
           qarab tezda so'nadi — banner va mikserlar tiniq ko'rinib tursin. */}
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-insof-900/95 via-insof-900/35 via-45% to-transparent to-75%" />
        <div className="absolute inset-0 -z-10 bg-linear-to-t from-insof-900/45 via-transparent to-transparent" />

        <div className="mx-auto w-full max-w-[1440px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <div className="max-w-2xl">
            <p className="flex items-center gap-3 font-mono text-[11px] tracking-[0.18em] text-white/60 uppercase">
              <span className="h-px w-8 bg-signal" />
              {company.legalName ?? company.name}
            </p>

            <h1 className="mt-4 font-display text-[2rem] leading-[1.06] font-extrabold text-white sm:mt-5 sm:text-5xl lg:text-[3.5rem]">
              Tayyor beton va temir-beton mahsulotlari
            </h1>

            {/* Marka lentasi — mijoz birinchi bo'lib shuni qidiradi */}
            {markalar.length > 0 && (
              <div className="mt-5 inline-flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-signal px-4 py-2 sm:mt-6 sm:px-5 sm:py-2.5">
                {markalar.map((m, i) => (
                  <span key={m} className="flex items-center gap-2 sm:gap-4">
                    {/* Ajratgich faqat keng ekranda: telefonda qator ko'chganda
                        "|" belgisi satr boshida osilib qolardi */}
                    {i > 0 && <span className="hidden text-white/45 sm:inline">|</span>}
                    <span className="font-display text-lg font-bold text-white sm:text-xl">{m}</span>
                  </span>
                ))}
              </div>
            )}

            <p className="mt-4 text-base text-white/85 sm:mt-5 sm:text-lg lg:text-xl">
              {capacity && <>Kunlik quvvat: <span className="font-semibold text-white tabular-nums">{capacity} m³</span> <span className="mx-2 text-white/35">|</span></>}
              Yetkazish: <span className="font-semibold text-white">o&apos;z mikserlarimizda</span>
            </p>

            <div className="mt-5 h-px w-64 max-w-full bg-signal sm:mt-6" />

            <ul className="mt-5 space-y-3 sm:mt-6 sm:space-y-3.5">
              <HeroPoint icon={FileCheck2} text="Rasmiy shartnoma, schyot-faktura va bank orqali hisob-kitob" />
              <HeroPoint icon={QrCode} text="Har bir yukda QR-nakladnoy — hajm va markani telefondan tekshirasiz" />
              <HeroPoint icon={FlaskConical} text="Har partiya tasdiqlangan retsept bo'yicha, laboratoriya nazorati bilan" />
            </ul>

            <div className="mt-7 flex flex-wrap gap-3 sm:mt-9">
              <a href="#ariza" className="inline-flex h-13 items-center gap-3 rounded-md bg-signal px-7 text-base font-semibold text-white transition-colors hover:bg-signal-600 sm:h-14 sm:px-8">
                Narx-taklif olish <ArrowRight size={18} />
              </a>
              <a href="#mahsulotlar" className="inline-flex h-13 items-center rounded-md border border-white/30 px-7 text-base font-semibold text-white transition-colors hover:bg-white/10 sm:h-14 sm:px-8">
                Mahsulotlar ro&apos;yxati
              </a>
              {/* Taqdimot — PPT ning veb ko'rinishi (23 slayd, animatsiya bilan) */}
              <Link href="/taqdimot" className="inline-flex h-13 items-center gap-2.5 rounded-md border border-white/30 px-7 text-base font-semibold text-white transition-colors hover:border-signal hover:bg-signal sm:h-14 sm:px-8">
                <Presentation size={18} /> Taqdimot
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Raqamlar ───────── */}
      <section className="border-b border-beton-200 bg-white">
        <dl className="mx-auto grid max-w-[1440px] grid-cols-2 divide-beton-200 px-4 sm:px-6 lg:grid-cols-4 lg:divide-x lg:px-8">
          <Stat value={capacity ? `${capacity} m³` : "Katta hajm"} label="Kunlik ishlab chiqarish quvvati" />
          <Stat value={years && years > 0 ? `${years} yil` : "Tajriba"} label={company.foundedYear ? `${company.foundedYear} yildan beri ishlaymiz` : "Sanoat qurilishi tajribasi"} />
          <Stat value={`${products.length}`} label="Marka va mahsulot turi" />
          <Stat value="QR" label="Har bir nakladnoyni tekshirish mumkin" />
        </dl>
      </section>

      {/* ───────── Yo'nalishlar ───────── */}
      <Section id="mahsulotlar" eyebrow="Nima ishlab chiqaramiz" title="Uch yo'nalish — bitta zavod">
        <div className="grid gap-5 lg:grid-cols-3">
          {DIRECTIONS.map((d) => (
            <article key={d.tag} className="group relative isolate min-h-72 overflow-hidden rounded-lg bg-insof-900">
              <Image src={d.img} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" className="-z-20 object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 -z-10 bg-linear-to-t from-insof-900 via-insof-900/70 to-insof-900/10" />
              <div className="flex h-full flex-col justify-end p-6">
                <span className="font-mono text-[11px] tracking-[0.16em] text-signal uppercase">{d.tag}</span>
                <h3 className="mt-2 font-display text-2xl font-bold text-white">{d.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-white/70">{d.text}</p>
              </div>
            </article>
          ))}
        </div>

        {catalogProducts.length > 0 && (
          <div className="mt-14">
            <h3 className="mb-6 font-display text-xl font-bold text-beton-900">Mahsulotlar ro&apos;yxati</h3>
            <Catalog products={catalogProducts} groups={catalogGroups} showPrices={SHOW_PRICES} />
          </div>
        )}
      </Section>

      {/* ───────── Zavod videolari ───────── */}
      <section id="zavod" className="scroll-mt-24 bg-insof-900 py-20 lg:py-24">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <Heading
            eyebrow="Zavod"
            title="Ishimizni o'z ko'zingiz bilan ko'ring"
            text="Tugun, tayyor mahsulot maydoni va xomashyo bazasi — hammasi bitta hududda."
            dark
          />
          <div className="mt-12">
            <Showreel clips={CLIPS} />
          </div>
        </div>
      </section>

      {/* ───────── Nega biz ───────── */}
      <Section id="nega-biz" eyebrow="Nega Insof" title="Qurilishchi nimaga e'tibor beradi — shuning ustida ishlaymiz" tone="white">
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
          {ADVANTAGES.map((a) => (
            <div key={a.title} className="flex gap-5 border-b border-beton-200 pb-8">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-insof-900 text-signal">
                <a.icon size={20} />
              </span>
              <div>
                <h3 className="font-display text-lg font-bold text-beton-900">{a.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-beton-600">{a.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-5 rounded-lg border-l-4 border-signal bg-beton-100 p-6 sm:flex-row sm:items-center">
          <QrCode size={28} className="shrink-0 text-insof-700" />
          <p className="text-[15px] leading-relaxed text-beton-700">
            <span className="font-semibold text-beton-900">Hujjatni tekshirib ko&apos;ring.</span> Bizdan mahsulot olgan bo&apos;lsangiz,
            nakladnoydagi QR kodni telefon kamerasida oching — hajm, marka va sana bevosita zavod tizimidan chiqadi.
          </p>
        </div>
      </Section>

      {/* ───────── Ish tartibi ───────── */}
      <Section id="jarayon" eyebrow="Ish tartibi" title="Arizadan yetkazib berishgacha — to'rt qadam">
        <ol className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Qadamlarni bog'lovchi chiziq — faqat keng ekranda, raqamlar markazidan o'tadi */}
          <span aria-hidden className="absolute top-7 right-0 left-0 hidden h-px bg-beton-300 lg:block" />
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <span className="relative z-10 inline-flex h-14 w-14 items-center justify-center rounded-full bg-insof-900 font-display text-lg font-bold text-white ring-8 ring-beton-100">
                {i + 1}
              </span>
              <h3 className="mt-5 font-display text-lg font-bold text-beton-900">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-beton-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ───────── Aloqa va ariza ───────── */}
      <section id="aloqa" className="scroll-mt-24 bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <Heading eyebrow="Aloqa" title="Hajmni ayting — narx va muddatni aytamiz" text="Ish vaqtida qo'ng'iroq qiling yoki formani to'ldiring. Sotuv bo'limi bog'lanib, hisob-kitobni tayyorlaydi." />

          <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
            <div>
              <dl className="divide-y divide-beton-200 border-y border-beton-200">
                {phone && (
                  <Contact icon={Phone} label="Telefon">
                    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-display text-2xl font-bold text-beton-900 tabular-nums hover:text-insof-600">{phone}</a>
                    {company.phone2 && (
                      <a href={`tel:${company.phone2.replace(/[^\d+]/g, "")}`} className="mt-1 block text-beton-500 tabular-nums hover:text-insof-600">{company.phone2}</a>
                    )}
                  </Contact>
                )}
                {email && (
                  <Contact icon={Mail} label="Elektron pochta">
                    <a href={`mailto:${email}`} className="text-lg text-beton-900 hover:text-insof-600">{email}</a>
                  </Contact>
                )}
                {company.address && (
                  <Contact icon={MapPin} label="Manzil">
                    <span className="text-lg text-beton-900">{company.address}</span>
                  </Contact>
                )}
                {hours && <Contact icon={ClipboardList} label="Ish vaqti"><span className="text-lg text-beton-900">{hours}</span></Contact>}
                {company.legalName && (
                  <Contact icon={FileCheck2} label="Rekvizitlar">
                    <span className="text-beton-900">{company.legalName}</span>
                    {company.inn && <span className="text-beton-500"> · INN {company.inn}</span>}
                  </Contact>
                )}
              </dl>
            </div>

            <div id="ariza" className="scroll-mt-28 rounded-lg border border-beton-200 bg-beton-50 p-6 sm:p-8">
              <h3 className="font-display text-2xl font-bold text-beton-900">Ariza qoldirish</h3>
              <p className="mt-1 mb-8 text-[15px] text-beton-500">Yulduzcha bilan belgilangan maydonlar to&apos;ldirilishi shart.</p>
              <LeadForm products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))} />
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Joylashuv ───────── */}
      <section className="border-t border-beton-200 bg-beton-100 py-20 lg:py-24">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <Heading eyebrow="Joylashuv" title="Zavodimiz shu yerda" text="Mahsulotni o'zingiz olib ketmoqchi bo'lsangiz manzil shu — yetkazib berish masofasi ham shu nuqtadan hisoblanadi." />
          <div className="mt-12">
            <PlantLocation
              lat={company.lat}
              lng={company.lng}
              title={company.name}
              address={company.address}
              hours={hours}
              phone={phone}
            />
          </div>
        </div>
      </section>

      {/* ───────── Poydevor ───────── */}
      <footer className="bg-insof-900 pt-14 pb-10 text-white/60">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-10 border-b border-white/10 pb-10 lg:flex-row lg:justify-between">
            <div>
              <Image src="/media/logo-light.png" alt="INSOF JBI — temir beton mahsulotlari" width={940} height={172} className="h-14 w-auto" />
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed">
                {company.about ?? "Tayyor beton va temir-beton mahsulotlari ishlab chiqaramiz."}
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:gap-16">
              <div>
                <h4 className="font-mono text-[11px] tracking-[0.16em] text-white/35 uppercase">Bo&apos;limlar</h4>
                <div className="mt-4 space-y-2.5 text-[15px]">
                  <a href="#mahsulotlar" className="block transition-colors hover:text-white">Mahsulotlar</a>
                  <a href="#zavod" className="block transition-colors hover:text-white">Zavod</a>
                  <a href="#jarayon" className="block transition-colors hover:text-white">Ish tartibi</a>
                  <a href="#aloqa" className="block transition-colors hover:text-white">Aloqa</a>
                </div>
              </div>
              <div>
                <h4 className="font-mono text-[11px] tracking-[0.16em] text-white/35 uppercase">Bog&apos;lanish</h4>
                <div className="mt-4 space-y-2.5 text-[15px]">
                  {phone && <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="block text-white tabular-nums transition-colors hover:text-signal">{phone}</a>}
                  {email && <a href={`mailto:${email}`} className="block transition-colors hover:text-white">{email}</a>}
                  {company.address && <p>{company.address}</p>}
                  <Link href="/login" className="inline-flex items-center gap-1.5 pt-2 transition-colors hover:text-white">
                    <LogIn size={14} /> Xodimlar kirishi
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <p className="pt-8 text-center text-[13px] text-white/35">
            © {new Date().getFullYear()} {company.legalName ?? company.name}. Barcha huquqlar himoyalangan.
          </p>
        </div>
      </footer>
    </>
  );
}

/* ───────── Kichik bo'laklar ───────── */

function HeroPoint({ icon: Icon, text }: { icon: typeof QrCode; text: string }) {
  return (
    <li className="flex gap-3.5 text-[15px] leading-relaxed text-white/85 sm:text-base">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-white/10 text-signal">
        <Icon size={14} />
      </span>
      {text}
    </li>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-b border-beton-200 px-2 py-7 last:border-b-0 sm:px-6 lg:border-b-0">
      <dt className="font-display text-3xl font-extrabold text-beton-900 tabular-nums sm:text-4xl">{value}</dt>
      <dd className="mt-1.5 text-sm leading-snug text-beton-500">{label}</dd>
    </div>
  );
}

function Heading({ eyebrow, title, text, dark = false }: { eyebrow: string; title: string; text?: string; dark?: boolean }) {
  return (
    <div className="max-w-3xl">
      <p className={`flex items-center gap-3 font-mono text-[11px] tracking-[0.18em] uppercase ${dark ? "text-white/55" : "text-signal-dim"}`}>
        <span className="h-px w-8 bg-signal" />
        {eyebrow}
      </p>
      <h2 className={`mt-4 font-display text-3xl leading-tight font-extrabold sm:text-4xl ${dark ? "text-white" : "text-beton-900"}`}>{title}</h2>
      {text && <p className={`mt-4 text-lg ${dark ? "text-white/60" : "text-beton-600"}`}>{text}</p>}
    </div>
  );
}

function Section({ id, eyebrow, title, text, children, tone = "light" }: {
  id: string; eyebrow: string; title: string; text?: string; children: React.ReactNode; tone?: "light" | "white";
}) {
  return (
    <section id={id} className={`scroll-mt-24 py-20 lg:py-24 ${tone === "white" ? "bg-white" : "bg-beton-100"}`}>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <Heading eyebrow={eyebrow} title={title} text={text} />
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function Contact({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-5 py-6">
      <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-beton-100 text-insof-700">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <dt className="font-mono text-[10px] tracking-[0.16em] text-beton-500 uppercase">{label}</dt>
        <dd className="mt-1.5">{children}</dd>
      </div>
    </div>
  );
}
