import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight, Boxes, Calculator, CalendarClock, ClipboardList, Factory, FileCheck2, FlaskConical, LogIn,
  Mail, MapPin, Phone, Presentation, QrCode, Ruler, ShieldCheck, Timer, Truck, Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { fmtNum } from "@/lib/format";
import { SiteHeader } from "./site-header";
import { LeadForm } from "./lead-form";
import { Showreel, type Clip } from "./showreel";
import { Catalog, type CatalogGroup, type CatalogProduct } from "./catalog";
import { PlantLocation } from "./plant-map";
import { GrowLine, Lift, Reveal, StatValue } from "./motion";
import { AggregateIcon, IconTile, MixerIcon, SlabIcon } from "./icons";
import { VolumeCalculator } from "./calculator";
import { MobileBar } from "./mobile-bar";

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
  { img: "/media/zavod.jpg", icon: MixerIcon, tag: "Tayyor beton", title: "Mikserlarda obyektga", text: "Turli markadagi beton. Hajm va soat oldindan kelishiladi, quyish uzilmaydi." },
  { img: "/media/maydon.jpg", icon: SlabIcon, tag: "Temir-beton", title: "Yig'ma konstruksiyalar", text: "Plita, ustun, rigel va boshqalar — kran bilan yuklab beriladi." },
  { img: "/media/xomashyo.jpg", icon: AggregateIcon, tag: "Xomashyo", title: "Qum va shag'al", text: "Baza o'zimizda, yuk transporti ham o'zimizniki — muddat cho'zilmaydi." },
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
  { icon: ClipboardList, title: "Ariza", text: "Telefon yoki saytdagi forma orqali hajm, marka va manzilni aytasiz." },
  { icon: Ruler, title: "Hisob-kitob", text: "Narx, muddat va yetkazib berish sharti kelishiladi, shartnoma rasmiylashtiriladi." },
  { icon: Factory, title: "Ishlab chiqarish", text: "Partiya rejaga qo'yiladi, xomashyo ajratiladi va sifat nazoratidan o'tadi." },
  { icon: Truck, title: "Yetkazib berish", text: "Belgilangan vaqtda obyektga chiqamiz, QR-nakladnoy bilan topshiramiz." },
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

  // Hero markalari — tayyor beton (m³) kodlari; bo'lmasa umumiy ro'yxat
  const markalar = (products.filter((p) => p.unit === "m3").length > 0 ? products.filter((p) => p.unit === "m3") : products)
    .map((p) => p.code)
    .slice(0, 5);

  // Yugurma lenta: marka + guruh nomlari + asosiy va'dalar
  const ticker = [
    ...markalar.map((m) => `Beton ${m}`),
    ...groups.map((g) => g.name),
    capacity ? `Kunlik ${capacity} m³` : "Katta hajm",
    "QR-nakladnoy",
    "O'z mikser parki",
    "Laboratoriya nazorati",
    "Rasmiy shartnoma",
  ];

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
      <section id="hero" className="relative isolate flex min-h-[calc(100svh-7.5rem)] items-center overflow-hidden bg-insof-900">
        {/* Surat butun bannerni to'ldiradi. Telefonda kadr o'ngroqdan olinadi —
           tor ekranda kran va ishchi ko'rinib tursin. Sifat 100 — Next uni
           qayta siqib yumshatmasin. */}
        <Image src={HERO_IMAGE} alt="" fill priority quality={100} sizes="100vw" className="-z-20 object-cover object-[78%_center] sm:object-center" />
        {/* Soya faqat matn ortida — o'rtadan o'ngga qarab butunlay so'nadi. */}
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-insof-900/85 via-insof-900/25 via-45% to-transparent to-70%" />
        <div className="absolute inset-0 -z-10 bg-linear-to-t from-insof-900/70 via-insof-900/10 via-45% to-transparent to-60%" />

        <div className="mx-auto w-full max-w-[1680px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <div className="max-w-3xl [text-shadow:0_2px_16px_rgba(6,18,42,0.7)]">
            {/* Holat tasmasi — "jonli" nuqta bilan: zavod ishlayotganini bildiradi */}
            <Reveal mode="mount" y={12}>
              <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full glass-dark px-4 py-2 text-[13px] text-white/85 [text-shadow:none]">
                <span className="live-dot relative inline-block h-2 w-2 rounded-full bg-emerald-400" />
                <span>{hours ? `Ish vaqti: ${hours}` : "Zavod ishlayapti"}</span>
                <span className="hidden text-white/35 sm:inline">·</span>
                <span className="hidden sm:inline">Yangiyo&apos;l, Toshkent viloyati</span>
              </div>
            </Reveal>

            <Reveal mode="mount" y={18} delay={0.06}>
              <h1 className="mt-6 font-display text-[1.9rem] leading-[1.1] font-bold text-balance text-white sm:text-[2.75rem] lg:text-[3.4rem]">
                Tayyor beton va temir-beton mahsulotlari
              </h1>
            </Reveal>

            {/* Markalar — mijoz birinchi bo'lib shuni qidiradi: shisha chiplar */}
            {markalar.length > 0 && (
              <Reveal mode="mount" delay={0.16}>
                <div className="mt-6 flex flex-wrap gap-2">
                  {markalar.map((m) => (
                    <span key={m} className="inline-flex h-9 items-center rounded-full glass-dark px-4 font-mono text-[15px] font-semibold text-white [text-shadow:none]">
                      {m}
                    </span>
                  ))}
                  {capacity && (
                    <span className="inline-flex h-9 items-center gap-2 rounded-full bg-signal px-4 font-mono text-[15px] font-semibold text-white [text-shadow:none]">
                      {capacity} m³<span className="text-white/70">/kun</span>
                    </span>
                  )}
                </div>
              </Reveal>
            )}

            <Reveal mode="mount" delay={0.22}>
              <ul className="mt-7 space-y-3">
                <HeroPoint icon={ShieldCheck} text="Rasmiy shartnoma, schyot-faktura va bank orqali hisob-kitob" />
                <HeroPoint icon={QrCode} text="Har bir yukda QR-nakladnoy — hajm va markani telefondan tekshirasiz" />
                <HeroPoint icon={FlaskConical} text="Har partiya tasdiqlangan retsept bo'yicha, laboratoriya nazorati bilan" />
              </ul>
            </Reveal>

            <Reveal mode="mount" delay={0.32}>
              <div className="mt-8 flex flex-wrap gap-3 sm:mt-10">
                <a href="#ariza" className="group inline-flex h-13 items-center gap-3 rounded-full bg-signal pr-2 pl-7 text-base font-semibold text-white transition-[background-color,transform] duration-200 hover:bg-signal-600 active:scale-[0.98] sm:h-14">
                  Narx-taklif olish
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 transition-transform duration-200 group-hover:translate-x-0.5">
                    <ArrowRight size={18} />
                  </span>
                </a>
                <a href="#kalkulyator" className="inline-flex h-13 items-center gap-2.5 rounded-full glass-dark px-7 text-base font-semibold text-white transition-colors duration-200 hover:bg-white/15 sm:h-14">
                  <Calculator size={18} strokeWidth={1.75} /> Hajmni hisoblash
                </a>
                {/* Taqdimot — PPT ning veb ko'rinishi (23 slayd, animatsiya bilan) */}
                <Link href="/taqdimot" className="inline-flex h-13 items-center gap-2.5 rounded-full glass-dark px-7 text-base font-semibold text-white transition-colors duration-200 hover:bg-white/15 sm:h-14">
                  <Presentation size={18} strokeWidth={1.75} /> Taqdimot
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───────── Yugurma lenta ───────── */}
      <div className="marka overflow-hidden border-y border-white/10 bg-insof-900 py-3.5" aria-hidden>
        <div className="marka-run flex w-max whitespace-nowrap font-mono text-[12px] tracking-[0.16em] text-white/55 uppercase">
          {[...ticker, ...ticker].map((t, i) => (
            <span key={i} className="flex items-center">
              <span className="px-6">{t}</span>
              <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            </span>
          ))}
        </div>
      </div>

      {/* ───────── Raqamlar — bento plitkalar ───────── */}
      <section className="relative bg-white">
        <div className="mx-auto max-w-[1680px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat accent icon={Factory} value={company.dailyCapacityM3 ? Number(company.dailyCapacityM3) : null} suffix=" m³" fallback="Katta hajm" label="Kunlik ishlab chiqarish quvvati" delay={0} />
            <Stat icon={CalendarClock} value={years && years > 0 ? years : null} suffix=" yil" fallback="Tajriba" label={company.foundedYear ? `${company.foundedYear} yildan beri ishlaymiz` : "Sanoat qurilishi tajribasi"} delay={0.08} />
            <Stat icon={Boxes} value={products.length} fallback="" label="Marka va mahsulot turi" delay={0.16} />
            <Stat icon={QrCode} value={null} fallback="QR" label="Har bir nakladnoyni tekshirish mumkin" delay={0.24} />
          </dl>
        </div>
      </section>

      {/* ───────── Yo'nalishlar ───────── */}
      <Section id="mahsulotlar" eyebrow="Nima ishlab chiqaramiz" title="Uch yo'nalish — bitta zavod" grid>
        <div className="grid gap-5 lg:grid-cols-3">
          {DIRECTIONS.map((d, i) => (
            <Reveal key={d.tag} delay={i * 0.12}>
              <Lift>
                <article className="group relative isolate min-h-80 overflow-hidden rounded-3xl bg-insof-900 ring-1 ring-black/5">
                  <Image src={d.img} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" className="-z-20 object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 -z-10 bg-linear-to-t from-insof-900 via-insof-900/65 to-insof-900/5" />
                  <div className="flex h-full flex-col justify-between p-6">
                    <IconTile tone="glass" size="lg"><d.icon size={26} /></IconTile>
                    <div>
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] tracking-[0.14em] text-white/85 uppercase ring-1 ring-white/15">
                        <span className="h-1.5 w-1.5 rounded-full bg-signal" />{d.tag}
                      </span>
                      <h3 className="mt-3 font-display text-xl font-semibold text-white sm:text-2xl">{d.title}</h3>
                      <p className="mt-2 text-[15px] leading-relaxed text-white/70">{d.text}</p>
                    </div>
                  </div>
                </article>
              </Lift>
            </Reveal>
          ))}
        </div>

        {catalogProducts.length > 0 && (
          <div className="mt-14">
            <h3 className="mb-6 font-display text-xl font-semibold text-beton-900">Mahsulotlar ro&apos;yxati</h3>
            <Catalog products={catalogProducts} groups={catalogGroups} showPrices={SHOW_PRICES} />
          </div>
        )}
      </Section>

      {/* ───────── Zavod videolari ───────── */}
      <section id="zavod" className="grain relative isolate scroll-mt-24 overflow-hidden bg-insof-900 py-20 lg:py-24">
        <div className="blueprint-dark absolute inset-0 -z-10" aria-hidden />
        <div className="absolute -top-40 left-1/2 -z-10 h-[32rem] w-[48rem] -translate-x-1/2 rounded-full bg-insof-500/25 blur-3xl" aria-hidden />
        <div className="relative z-10 mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <Heading
            eyebrow="Zavod"
            title="Ishimizni o'z ko'zingiz bilan ko'ring"
            text="Tugun, tayyor mahsulot maydoni va xomashyo bazasi — hammasi bitta hududda."
            dark
          />
          <Reveal delay={0.1} className="mt-12">
            <Showreel clips={CLIPS} />
          </Reveal>
        </div>
      </section>

      {/* ───────── Nega biz ───────── */}
      <Section id="nega-biz" eyebrow="Nega Insof" title="Qurilishchi nimaga e'tibor beradi — shuning ustida ishlaymiz" grid>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ADVANTAGES.map((a, i) => (
            <Reveal key={a.title} delay={(i % 3) * 0.08 + Math.floor(i / 3) * 0.06} y={16}>
              <div className="group relative h-full overflow-hidden rounded-2xl bg-white p-6 ring-1 ring-beton-200 transition-shadow duration-300 hover:shadow-[0_24px_48px_-24px_rgba(27,42,76,0.35)]">
                <span className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-signal transition-transform duration-500 group-hover:scale-x-100" />
                <IconTile tone="solid"><a.icon size={22} strokeWidth={1.5} /></IconTile>
                <h3 className="mt-5 font-display text-[15px] font-semibold text-beton-900">{a.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-beton-600">{a.text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.15} className="mt-6">
          <div className="flex flex-col gap-5 rounded-2xl border border-dashed border-insof-500/40 bg-white p-6 sm:flex-row sm:items-center">
            <IconTile tone="soft" size="lg" dot><QrCode size={26} strokeWidth={1.5} /></IconTile>
            <p className="text-[15px] leading-relaxed text-beton-700">
              <span className="font-semibold text-beton-900">Hujjatni tekshirib ko&apos;ring.</span> Bizdan mahsulot olgan bo&apos;lsangiz,
              nakladnoydagi QR kodni telefon kamerasida oching — hajm, marka va sana bevosita zavod tizimidan chiqadi.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* ───────── Ish tartibi ───────── */}
      <Section id="jarayon" eyebrow="Ish tartibi" title="Arizadan yetkazib berishgacha — to'rt qadam" tone="white">
        <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Qadamlarni bog'lovchi chiziq — faqat keng ekranda, ko'rinishga kirganda chapdan o'ngga chiziladi */}
          <GrowLine className="absolute top-12 right-8 left-8 hidden h-px bg-beton-300 lg:block" />
          {STEPS.map((s, i) => (
            <Reveal key={s.title} as="li" delay={i * 0.12} y={16} className="relative">
              <div className="h-full rounded-2xl bg-beton-50 p-6 ring-1 ring-beton-200">
                <div className="flex items-start justify-between">
                  <IconTile tone="solid"><s.icon size={22} strokeWidth={1.5} /></IconTile>
                  <span className="text-outline font-display text-5xl font-bold text-insof-700/50 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mt-6 font-display text-[15px] font-semibold text-beton-900">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-beton-600">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* ───────── Kalkulyator ───────── */}
      <section id="kalkulyator" className="relative scroll-mt-24 overflow-hidden bg-beton-100 py-20 lg:py-24">
        <div className="blueprint absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
            <div>
              <Heading eyebrow="Kalkulyator" title="Qancha beton kerak?" text="Bir daqiqada hisoblang: o'lchamlarni metrda kiriting — hajm kub metrda chiqadi, ustiga 5 % zaxira qo'shiladi. Natijani bir bosishda arizaga uzatasiz." />
              <ul className="mt-8 space-y-4">
                <Tip icon={Ruler} title="Aniq o'lchamlar" text="Poydevor, pol yoki plita — tayyor shablonlardan boshlang, kerak bo'lsa o'zgartiring." />
                <Tip icon={Timer} title="Mikser soatini rejalashtirish" text="Hajm ma'lum bo'lsa, sotuv bo'limi nechta reys va qaysi soatda kelishini darrov aytadi." />
                <Tip icon={ShieldCheck} title="Zaxira hisobga olingan" text="Notekis asos va to'kilish uchun 5 % — quyish o'rtasida beton yetmay qolmaydi." />
              </ul>
            </div>
            <Reveal delay={0.1}>
              <VolumeCalculator />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───────── Aloqa va ariza ───────── */}
      <section id="aloqa" className="scroll-mt-24 bg-white py-20 lg:py-24">
        <div className="mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <Heading eyebrow="Aloqa" title="Hajmni ayting — narx va muddatni aytamiz" text="Ish vaqtida qo'ng'iroq qiling yoki formani to'ldiring. Sotuv bo'limi bog'lanib, hisob-kitobni tayyorlaydi." />

          <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
            <Reveal>
              <dl className="space-y-2 rounded-3xl bg-beton-50 p-2 ring-1 ring-beton-200">
                {phone && (
                  <Contact icon={Phone} label="Telefon">
                    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-display text-xl font-semibold text-beton-900 tabular-nums hover:text-insof-600 sm:text-2xl">{phone}</a>
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
                {hours && <Contact icon={CalendarClock} label="Ish vaqti"><span className="text-lg text-beton-900">{hours}</span></Contact>}
                {company.legalName && (
                  <Contact icon={FileCheck2} label="Rekvizitlar">
                    <span className="text-beton-900">{company.legalName}</span>
                    {company.inn && <span className="text-beton-500"> · INN {company.inn}</span>}
                  </Contact>
                )}
              </dl>
            </Reveal>

            <Reveal delay={0.1}>
              <div id="ariza" className="scroll-mt-28 rounded-3xl bg-white p-6 ring-1 ring-beton-200 shadow-[0_24px_60px_-30px_rgba(27,42,76,0.35)] sm:p-8">
                <h3 className="font-display text-xl font-semibold text-beton-900 sm:text-2xl">Ariza qoldirish</h3>
                <p className="mt-1 mb-8 text-[15px] text-beton-500">Yulduzcha bilan belgilangan maydonlar to&apos;ldirilishi shart.</p>
                <LeadForm products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))} />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───────── Joylashuv ───────── */}
      <section className="relative overflow-hidden border-t border-beton-200 bg-beton-100 py-20 lg:py-24">
        <div className="blueprint absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <Heading eyebrow="Joylashuv" title="Zavodimiz shu yerda" text="Mahsulotni o'zingiz olib ketmoqchi bo'lsangiz manzil shu — yetkazib berish masofasi ham shu nuqtadan hisoblanadi." />
          <Reveal delay={0.1} className="mt-12">
            <PlantLocation
              lat={company.lat}
              lng={company.lng}
              title={company.name}
              address={company.address}
              hours={hours}
              phone={phone}
            />
          </Reveal>
        </div>
      </section>

      {/* ───────── Poydevor ───────── */}
      <footer className="relative overflow-hidden bg-insof-900 pt-14 pb-10 text-white/60">
        <div className="blueprint-dark absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
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
                  <a href="#kalkulyator" className="block transition-colors hover:text-white">Kalkulyator</a>
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

      <MobileBar phone={phone} />
    </>
  );
}

/* ───────── Kichik bo'laklar ───────── */

function HeroPoint({ icon: Icon, text }: { icon: typeof QrCode; text: string }) {
  return (
    <li className="flex items-center gap-3.5 text-[15px] leading-snug text-white sm:text-base">
      <IconTile tone="glass" size="sm" className="[text-shadow:none]"><Icon size={16} strokeWidth={1.75} /></IconTile>
      {text}
    </li>
  );
}

function Stat({ icon: Icon, value, suffix = "", fallback, label, delay = 0, accent = false }: {
  icon: typeof Factory; value: number | null; suffix?: string; fallback: string; label: string; delay?: number; accent?: boolean;
}) {
  return (
    <Reveal delay={delay} y={14} className={`relative overflow-hidden rounded-2xl p-6 ring-1 ${accent ? "bg-insof-900 text-white ring-insof-900" : "bg-beton-50 ring-beton-200"}`}>
      {accent && <div className="blueprint-dark absolute inset-0" aria-hidden />}
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <dt className={`font-display text-3xl font-bold whitespace-nowrap tabular-nums ${accent ? "text-signal" : "text-beton-900"}`}>
            {value !== null ? <StatValue value={value} suffix={suffix} /> : fallback}
          </dt>
          <dd className={`mt-2 text-sm leading-snug ${accent ? "text-white/65" : "text-beton-500"}`}>{label}</dd>
        </div>
        <IconTile tone={accent ? "glass" : "soft"} size="sm"><Icon size={18} strokeWidth={1.5} /></IconTile>
      </div>
    </Reveal>
  );
}

function Tip({ icon: Icon, title, text }: { icon: typeof Ruler; title: string; text: string }) {
  return (
    <li className="flex gap-4">
      <IconTile tone="soft"><Icon size={20} strokeWidth={1.5} /></IconTile>
      <div>
        <div className="font-display text-[15px] font-semibold text-beton-900">{title}</div>
        <p className="mt-1 text-[15px] leading-relaxed text-beton-600">{text}</p>
      </div>
    </li>
  );
}

function Heading({ eyebrow, title, text, dark = false }: { eyebrow: string; title: string; text?: string; dark?: boolean }) {
  return (
    <Reveal className="max-w-3xl">
      <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] tracking-[0.16em] uppercase ring-1 ${dark ? "bg-white/10 text-white/75 ring-white/15" : "bg-white text-insof-700 ring-beton-200"}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        {eyebrow}
      </p>
      <h2 className={`mt-5 font-display text-[1.6rem] leading-[1.15] font-bold text-balance sm:text-3xl lg:text-[2.4rem] ${dark ? "text-white" : "text-beton-900"}`}>{title}</h2>
      {text && <p className={`mt-4 text-lg ${dark ? "text-white/60" : "text-beton-600"}`}>{text}</p>}
    </Reveal>
  );
}

function Section({ id, eyebrow, title, text, children, tone = "light", grid = false }: {
  id: string; eyebrow: string; title: string; text?: string; children: React.ReactNode; tone?: "light" | "white"; grid?: boolean;
}) {
  return (
    <section id={id} className={`relative scroll-mt-24 overflow-hidden py-20 lg:py-24 ${tone === "white" ? "bg-white" : "bg-beton-100"}`}>
      {grid && <div className="blueprint absolute inset-0" aria-hidden />}
      <div className="relative mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
        <Heading eyebrow={eyebrow} title={title} text={text} />
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function Contact({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 rounded-2xl px-4 py-4 transition-colors hover:bg-white">
      <IconTile tone="soft" size="sm" className="mt-0.5"><Icon size={17} strokeWidth={1.5} /></IconTile>
      <div className="min-w-0">
        <dt className="font-mono text-[10px] tracking-[0.16em] text-beton-500 uppercase">{label}</dt>
        <dd className="mt-1">{children}</dd>
      </div>
    </div>
  );
}
