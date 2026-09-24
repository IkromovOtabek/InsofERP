"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity, ArrowRight, Award, BadgeCheck, Boxes, Building2, CheckCheck, ClipboardList,
  Cog, Factory, FileSignature, FlaskConical, Gauge, Handshake, Hammer, Landmark, Layers,
  Leaf, MapPin, Package, Rocket, Ruler, ShieldCheck, Target, Thermometer,
  Timer, TrendingUp, Truck, Users, Waves, Wrench,
} from "lucide-react";

/**
 * INSOF taqdimoti — 23 ta slayd, PPT faylidan ko'chirilgan.
 *
 * Har bir slayd faqat o'z ichki qismini beradi; ramka, fon, sarlavha va
 * animatsiya `deck.tsx` da. Matnlar JSX ichida emas, ma'lumot massivlarida
 * turadi — apostrof (o') bilan bog'liq eslint qoidasi ham shu sababli tinch.
 */

export type DeckCompany = {
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
};

export type Slide = {
  n: number;
  tone: "dark" | "light";
  /** Sarlavha qatori — slaydning tepasida va ro'yxat (overview) ichida */
  title: string;
  sub?: string;
  /** To'liq kadr fon surati */
  bg?: string;
  /** Sarlavha bloki chizilmaydi — slayd o'zi to'liq kadr (muqova, yakun) */
  bare?: boolean;
  /** Ma'ruzachi izohi — PPT dagi "Notes" */
  notes: string;
  body: React.ReactNode;
};

/* ───────────────────────── Yordamchi bloklar ───────────────────────── */

/** Ketma-ket chiqish kechikishi — PPT dagi animatsiya tartibi */
const step = (i: number, base = 120) => ({ animationDelay: `${base + i * 90}ms` });

/** Raqam nolda emas, sanab chiqadi. Slayd har ochilganda qaytadan sanaydi. */
function Count({ to, prefix = "", suffix = "", ms = 1100, sep = false }: { to: number; prefix?: string; suffix?: string; ms?: number; sep?: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  // Katta raqam bo'sh joy bilan ajratiladi: 45 000
  return <span className="tabular-nums">{prefix}{sep ? v.toLocaleString("ru-RU").replace(/\u00a0/g, " ") : v}{suffix}</span>;
}

/** PPT da bo'sh qolgan katak — sayt "tayyor emas" ko'rinmasin uchun bitta uslubda */
function Tbd({ label = "to'ldiriladi" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-current/35 px-2 py-0.5 font-mono text-[11px] tracking-wide opacity-55">
      {label}
    </span>
  );
}

/** Katta raqamli katak (RAQAMLARDA INSOF, ZAVOD VA QUVVAT) */
function Cell({ value, label, i, tone, accent }: { value: React.ReactNode; label: string; i: number; tone: "dark" | "light"; accent?: boolean }) {
  const dark = tone === "dark";
  return (
    <div
      className={`deck-up group relative overflow-hidden rounded-lg p-5 sm:p-6 ${
        dark ? "bg-white/[0.045] ring-1 ring-white/10" : "bg-white ring-1 ring-beton-200"
      }`}
      style={step(i)}
    >
      <span className={`absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100 ${accent ? "bg-signal" : dark ? "bg-white/40" : "bg-insof-500"}`} />
      <div className={`font-display text-[clamp(1.6rem,3.6vw,2.6rem)] leading-none font-extrabold ${accent ? "text-signal" : dark ? "text-white" : "text-insof-700"}`}>
        {value}
      </div>
      <div className={`mt-3 text-[13px] leading-snug sm:text-sm ${dark ? "text-white/55" : "text-beton-600"}`}>{label}</div>
    </div>
  );
}

/** Ikonkali kartochka (NEGA INSOF, SIFAT NAZORATI, HAMKORGA NIMA BERADI) */
function IconCard({
  icon: Icon, title, text, i, tone,
}: { icon: typeof ShieldCheck; title: string; text: string; i: number; tone: "dark" | "light" }) {
  const dark = tone === "dark";
  return (
    <div
      className={`deck-up flex gap-4 rounded-lg p-5 transition-colors sm:gap-5 sm:p-6 ${
        dark ? "bg-white/[0.045] ring-1 ring-white/10 hover:bg-white/[0.08]" : "bg-white ring-1 ring-beton-200 hover:ring-insof-400"
      }`}
      style={step(i)}
    >
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md sm:h-12 sm:w-12 ${dark ? "bg-signal text-white" : "bg-insof-900 text-signal"}`}>
        <Icon size={20} />
      </span>
      <div>
        <h3 className={`font-display text-[15px] leading-tight font-bold sm:text-lg ${dark ? "text-white" : "text-beton-900"}`}>{title}</h3>
        <p className={`mt-1.5 text-[13px] leading-relaxed sm:text-[15px] ${dark ? "text-white/60" : "text-beton-600"}`}>{text}</p>
      </div>
    </div>
  );
}

/** Raqamlangan qadam (ISHLAB CHIQARISH JARAYONI, JARAYON) */
function Step({ n, title, text, i, tone }: { n: string; title: string; text: string; i: number; tone: "dark" | "light" }) {
  const dark = tone === "dark";
  return (
    <li className={`deck-up relative rounded-lg p-5 ${dark ? "bg-white/[0.045] ring-1 ring-white/10" : "bg-white ring-1 ring-beton-200"}`} style={step(i)}>
      <span className="font-mono text-[13px] font-semibold text-signal">{n}</span>
      <h3 className={`mt-2 font-display text-[15px] leading-tight font-bold sm:text-lg ${dark ? "text-white" : "text-beton-900"}`}>{title}</h3>
      <p className={`mt-2 text-[13px] leading-relaxed sm:text-[14px] ${dark ? "text-white/60" : "text-beton-600"}`}>{text}</p>
    </li>
  );
}

/** Surat — ochilishda sekin yaqinlashadi (ken-burns) */
function Shot({ src, alt, caption, i, ratio = "aspect-4/3" }: { src: string; alt: string; caption?: string; i: number; ratio?: string }) {
  return (
    <figure className="deck-up group" style={step(i, 160)}>
      <div className={`relative overflow-hidden rounded-lg bg-beton-200 ${ratio}`}>
        <Image src={src} alt={alt} fill sizes="(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw" className="deck-kadr object-cover transition-transform duration-700 group-hover:scale-105" />
      </div>
      {caption && <figcaption className="mt-2.5 text-[12px] leading-snug font-medium sm:text-[13px]">{caption}</figcaption>}
    </figure>
  );
}

/* ───────────────────────── Slayd matnlari ───────────────────────── */

const T = {
  kompaniya: [
    "«INSOF TEMIR BETON» MChJ — 2000-yildan buyon temir-beton buyumlari va tovar beton ishlab chiqarish sohasida faoliyat yuritib kelayotgan ishonchli korxona.",
    "Korxonamiz nafaqat Toshkent viloyatida, balki Toshkent shahrida ham zamonaviy beton ishlab chiqarish zavodlariga ega.",
    "Biz FBS bloklari, PK va PB trosli plitalar, temir-beton konstruksiyalari hamda tovar beton ishlab chiqaramiz va mahsulotlarni Toshkent shahri, Toshkent viloyati, Sirdaryo hamda Jizzax viloyatlariga tezkor yetkazib beramiz.",
  ],
  kompaniyaFakt: [
    ["TASHKIL ETILGAN", "2000-yil", null],
    ["ZAVODLAR", "4 ta zavod", "2 ta beton · 1 ta JBI · 1 ta beton va PB plita"],
    ["TAYYOR BETON", "M200 dan M600 gacha", null],
    ["ASOSIY TAMOYIL", "100% halollik va aniq hajm", null],
    ["KAFOLAT", "Davlat standarti va laboratoriya", null],
  ] as const,

  nega: [
    { icon: ShieldCheck, title: "Seysmik xavfsizlik", text: "Markaziy Osiyo iqlimi va faol seysmik hududlar uchun 9+ ballgacha bardoshli muhandislik yechimlari." },
    { icon: BadgeCheck, title: "GOST standartlari", text: "Davlat va xalqaro sifat standartlariga to'liq muvofiqlik hamda qat'iy laboratoriya nazorati." },
    { icon: Timer, title: "Aniq yetkazib berish", text: "Shaxsiy og'ir yuk tashish parki qurilish jarayonlarini to'xtatmasdan o'z vaqtida yetkazishni ta'minlaydi." },
    { icon: Leaf, title: "Ekologik yechim", text: "Suvni qayta ishlash tizimi va CO2 chiqindilarini kamaytiruvchi bug'lash kameralari." },
  ],

  baza: [
    "Asosiy sanoat, logistika va ishlab chiqarish bazamiz Toshkent viloyati, Yangiyo'l tumanining eng qulay sanoat zonasida joylashgan.",
    "Keng maydon va avtomobil logistikasiga mo'ljallangan infratuzilma mahsulotlarni tezkor qabul qilish, saqlash va yetkazib berish imkonini yaratadi.",
  ],
  bazaChip: [
    { icon: Ruler, text: "12 gektardan ortiq sanoat hududi" },
    { icon: Cog, text: "Avtomatlashtirilgan xomashyo qabuli" },
    { icon: Thermometer, text: "Iqlim nazoratidagi yopiq sexlar" },
    { icon: Truck, text: "Zamonaviy avtomobil logistikasi" },
  ],

  lavha: [
    { src: "/media/maydon.mp4", poster: "/media/maydon.jpg", title: "Tayyor mahsulot ombori", meta: "Plita · FBS · kran maydoni" },
    { src: "/media/xomashyo.mp4", poster: "/media/xomashyo.jpg", title: "Ishlab chiqarish liniyasi", meta: "Inert material · qoliplash" },
    { src: "/media/zavod.mp4", poster: "/media/zavod.jpg", title: "Tovar beton avtoparki", meta: "Beton tuguni · mikserlar" },
  ],

  markalar: [
    ["M100", "Tayyorgarlik qatlami, podbeton"],
    ["M150", "Yo'lka va maydonchalar"],
    ["M200", "Poydevor va pol qoplamalari"],
    ["M250", "Monolit plitalar, zinapoyalar"],
    ["M300", "Ko'p qavatli bino qismlari"],
    ["M350", "Kolonna, rigel, yuk ko'taruvchi"],
    ["M400", "Temir-beton buyum, tayanch ustun"],
    ["M450-M600", "Maxsus zo'riqishli konstruksiya"],
  ] as const,

  katalog: [
    { src: "/taqdimot/mahsulot-1.jpg", name: "Bo'shliqli qavat plitalari", code: "PK plitalar" },
    { src: "/taqdimot/mahsulot-2.jpg", name: "Elektr tayanch ustunlari", code: "Opora SV 110-3,5" },
    { src: "/taqdimot/mahsulot-3.jpg", name: "Suv o'tkazgich lotoklari", code: "Lotok L-5" },
    { src: "/taqdimot/mahsulot-4.jpg", name: "Poydevor bloklari", code: "FBS 24-4-6" },
    { src: "/taqdimot/mahsulot-5.jpg", name: "Yo'l bordyurlari", code: "Bordyur 30x18x30" },
    { src: "/taqdimot/mahsulot-6.jpg", name: "Quduq halqalari va qopqoqlari", code: "Koltso 1,5" },
    { src: "/taqdimot/mahsulot-7.jpg", name: "Devor bloklari", code: "Gazoblok" },
    { src: "/taqdimot/mahsulot-8.jpg", name: "Zinapoya marshlari", code: "2 LM 57-12-17" },
  ],

  texnik: [
    { name: "PK qavat plitalari", klass: "PK 59-12-8", olcham: null, ogirlik: null },
    { name: "PB trosli plitalar", klass: null, olcham: null, ogirlik: null },
    { name: "Opora SV 110-3,5", klass: "M400", olcham: "uzunligi 11 000 mm", ogirlik: "1125 kg" },
    { name: "FBS poydevor bloklari", klass: "24-4-6 / 12-4-6 / 09-4-6", olcham: null, ogirlik: null },
    { name: "Lotok", klass: "L-5", olcham: null, ogirlik: null },
    { name: "Bordyur", klass: "30x18x30", olcham: null, ogirlik: null },
    { name: "Quduq halqasi (koltso)", klass: "KS 1,5", olcham: "diametri 1,5 m", ogirlik: null },
    { name: "Quduq qopqog'i (krishka)", klass: "1,5", olcham: "diametri 1,5 m", ogirlik: null },
    { name: "Zinapoya marshi", klass: "2 LM 57-12-17", olcham: null, ogirlik: null },
    { name: "Gazoblok", klass: null, olcham: null, ogirlik: null },
  ],

  hamkorlar: [
    { logo: "/taqdimot/hamkor-yangiyol.jpg", name: "Yangiyo'l City" },
    { logo: "/taqdimot/hamkor-mbg.jpg", name: "MBG House" },
    { logo: null, name: "MPMK-33" },
    { logo: "/taqdimot/hamkor-sergeli.jpg", name: "Sergeli City" },
  ],

  jarayon4: [
    { n: "01", title: "Armaturalash", text: "Yuqori mustahkamlikka ega sovuq cho'zilgan po'lat simlar yordamida kuchaytirilgan karkas tayyorlash." },
    { n: "02", title: "Aralashma tayyorlash", text: "Kompyuter nazorati ostida qum, shag'al, sement va maxsus kimyoviy qo'shimchalarni o'lchash." },
    { n: "03", title: "Qoliplash va zichlash", text: "Yuqori chastotali tebranish stollari yordamida aralashmadagi havo pufakchalarini to'liq yo'qotish." },
    { n: "04", title: "Issiqlik bilan ishlov", text: "Maxsus bug'lash kameralarida 18 soat ichida betonning 75% loyihaviy mustahkamligiga erishish." },
  ],

  nazorat: [
    { icon: Gauge, title: "Gidravlik press", text: "Beton namunalarini press ostida sindirish sinovlari." },
    { icon: Activity, title: "Ultratovush", text: "Beton ichki qatlamlaridagi bo'shliqlarni aniqlash." },
    { icon: CheckCheck, title: "F va W darajasi", text: "Sovuqqa chidamlilik (F) va suv o'tkazmaslik (W) o'lchovlari." },
  ],

  hududlar: ["Toshkent shahri", "Toshkent viloyati", "Sirdaryo viloyati", "Jizzax viloyati"],
  logistika: [
    { icon: Truck, text: "Shaxsiy og'ir yuk tashish va samosval parki" },
    { icon: Hammer, text: "Mahsulotlar maxsus kranlar bilan xavfsiz yuklanadi" },
    { icon: Timer, text: "Belgilangan hajmda va o'z vaqtida yetkazish" },
  ],

  foyda: [
    { icon: Boxes, title: "Bitta manbadan ta'minot", text: "Tayyor beton, temir-beton buyumlar va inert materiallar — bitta yetkazib beruvchidan." },
    { icon: FlaskConical, title: "O'z laboratoriyamiz", text: "Har bir partiya davlat standarti bo'yicha sinovdan o'tadi — sifat dalil bilan." },
    { icon: Truck, title: "O'z transport parki", text: "Yetkazish uchinchi tomonga bog'liq emas — grafik buzilmaydi." },
    { icon: Target, title: "Aniq hajm, halol o'lchov", text: "Belgilangan hajmdan kamaytirmasdan yetkaziladi — asosiy tamoyilimiz." },
    { icon: Rocket, title: "Muddatni qisqartirish", text: "Zamonaviy texnologiyalar ob'ekt qurilish davrini 35% gacha qisqartiradi." },
    { icon: Award, title: "26 yillik tajriba", text: "2000-yildan buyon yirik qurilish loyihalarida sinalgan hamkor." },
  ],

  kimlar: [
    { icon: Landmark, title: "Davlat va hokimlik loyihalari", text: "Ijtimoiy ob'ektlar, yo'l va muhandislik infratuzilmasi uchun davlat standartlari bo'yicha sinovdan o'tgan temir-beton." },
    { icon: Building2, title: "Quruvchi kompaniyalar", text: "Turar-joy va tijorat majmualari uchun uzluksiz hajm hamda grafik bo'yicha yetkazib berish." },
    { icon: Factory, title: "Sanoat buyurtmachilari", text: "Maxsus konstruksiyalar, tayanch ustunlari va yuqori markali tayyor beton bo'yicha buyurtmalar." },
    { icon: FlaskConical, title: "Laboratoriya kafolati", text: "Har bir mahsulot davlat standartlari asosida sinovdan o'tkaziladi — hajm va sifat tasdiqlanadi." },
  ],

  shakllar: [
    { icon: FileSignature, title: "Uzoq muddatli shartnoma", text: "Ob'ekt davomiyligiga mo'ljallangan grafik va barqaror hajm." },
    { icon: Package, title: "Bir martalik yirik buyurtma", text: "Aniq ob'ekt uchun hisob-kitob va bir martalik ta'minot." },
    { icon: Layers, title: "Kompleks ta'minot", text: "Beton, temir-beton buyum va inert material bitta paketda." },
    { icon: Wrench, title: "Maxsus buyurtma", text: "Loyiha talabiga ko'ra o'lcham va marka bo'yicha ishlab chiqarish." },
  ],

  qadamlar: [
    { n: "01", title: "So'rov", text: "Ob'ekt, hajm va muddat haqida ma'lumot yuborasiz." },
    { n: "02", title: "Texnik hisob", text: "Muhandislar marka va nomenklaturani aniqlaydi." },
    { n: "03", title: "Tijorat taklifi", text: "Hajm, grafik va shartlar bo'yicha taklif beriladi." },
    { n: "04", title: "Shartnoma", text: "Shartlar kelishilgach shartnoma imzolanadi." },
    { n: "05", title: "Yetkazib berish", text: "Grafik bo'yicha yetkazish va sifat hujjatlari." },
  ],
};

/* ───────────────────────── Slaydlar ───────────────────────── */

export function buildSlides(c: DeckCompany): Slide[] {
  const phone = c.phone?.trim() || "+998 33 000 14 18";
  const email = c.email?.trim() || "grppuzbekistan@gmail.com";
  const address = c.address?.trim() || "Yangiyo'l tumani, Toshkent viloyati";
  const hududlar = "Toshkent shahri · Toshkent viloyati · Sirdaryo · Jizzax";
  // Tashkil etilgan yil taqdimotning o'zidan: korxona 2000-yildan buyon ishlaydi.
  const founded = 2000;
  const years = new Date().getFullYear() - founded;

  return [
    /* 01 ─ Muqova */
    {
      n: 1,
      tone: "light",
      bare: true,
      // Taqdimotdagi muqova kadri to'liq fon bo'lib turadi (logotip suratning o'zida)
      bg: "/taqdimot/muqova.jpg",
      title: "INSOF.JBI — TEMIR BETON MAHSULOTLARI",
      sub: "Muqova",
      notes: "Ochilish: logotip ekranda turibdi, shuning uchun kompaniya nomini takrorlamang. O'zingizni tanishtiring va bir jumlada nima taklif qilayotganingizni ayting.",
      body: (
        <div className="max-w-2xl">
          {/* Keng ekranda logotip fon suratining o'zida ko'rinadi; telefonda kadr
              kesilgani uchun uni alohida chizamiz */}
          <Image
            src="/media/logo.png"
            alt="INSOF.JBI — temir beton mahsulotlari"
            width={940}
            height={172}
            priority
            className="deck-up h-10 w-auto sm:h-12 lg:hidden"
            style={step(0, 40)}
          />
          <div className="deck-line mt-6 h-0.5 w-14 bg-signal" style={step(1, 40)} />
          <p className="deck-up mt-5 font-display text-[clamp(1.35rem,3.6vw,2.7rem)] leading-[1.12] font-bold text-beton-900 sm:mt-6" style={step(2, 40)}>
            {years} yillik tajriba — {founded}-yildan buyon O&apos;zbekiston qurilishining mustahkam poydevori.
          </p>
          <p className="deck-up mt-5 text-[14px] font-semibold text-insof-600 sm:text-lg" style={step(3, 40)}>
            {hududlar}
          </p>
          <p className="deck-up mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-beton-600 sm:text-[13px]" style={step(4, 40)}>
            <span className="inline-flex items-center gap-2"><MapPin size={13} className="text-signal-dim" />{address}</span>
            <span className="hidden text-beton-400 sm:inline">|</span>
            <span className="tabular-nums">{phone}</span>
          </p>
        </div>
      ),
    },

    /* 02 ─ Kompaniya haqida */
    {
      n: 2,
      tone: "light",
      title: "KOMPANIYA HAQIDA",
      sub: "Ishonch, sifat va mustahkamlik timsoli",
      notes: "Asosiy xabar: korxona bitta zavod emas — Toshkent shahri va viloyatida ishlab chiqarish quvvatlariga ega, to'liq nomenklatura bilan ishlaydi.",
      body: (
        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-14">
          <div className="space-y-4 sm:space-y-5">
            {T.kompaniya.map((p, i) => (
              <p key={i} className="deck-up text-[14px] leading-relaxed text-beton-700 sm:text-[17px]" style={step(i)}>{p}</p>
            ))}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-beton-200">
            {T.kompaniyaFakt.map(([k, v, note], i) => (
              <div key={k} className="deck-up rounded-lg bg-white p-4 ring-1 ring-beton-200 lg:rounded-none lg:bg-transparent lg:px-0 lg:py-3.5 lg:ring-0" style={step(i + 3)}>
                <dt className="font-mono text-[10px] tracking-[0.16em] text-signal-dim uppercase">{k}</dt>
                <dd className="mt-1 font-display text-[17px] font-bold text-beton-900 sm:text-xl">{v}</dd>
                {note && <dd className="mt-0.5 text-[13px] text-beton-500">{note}</dd>}
              </div>
            ))}
          </dl>
        </div>
      ),
    },

    /* 03 ─ Raqamlarda */
    {
      n: 3,
      tone: "dark",
      title: "RAQAMLARDA INSOF",
      sub: "Salohiyat va ko'lam",
      notes: "Bu slayd — hokimlik va buyurtmachi uchun asosiy raqamlar. Oltita ko'rsatkich ketma-ket chiqadi, har birini qisqa izohlab o'ting.",
      body: (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <Cell i={0} tone="dark" value={<Count to={years} />} label={`yillik tajriba — ${founded}-yildan buyon`} />
          <Cell i={1} tone="dark" value={<Count to={12} suffix="+ ga" />} label="kengaytirilgan sanoat hududi" />
          <Cell i={2} tone="dark" accent value={<Count to={9} suffix=" ball" />} label="seysmik bardoshlilik darajasi" />
          <Cell i={3} tone="dark" value="M100-M600" label="beton markalari qamrovi" />
          <Cell i={4} tone="dark" value={<Count to={4} suffix=" hudud" />} label="Toshkent sh., Toshkent v., Sirdaryo, Jizzax" />
          <Cell i={5} tone="dark" value={<Count to={18} suffix=" soat" />} label="ichida 75% loyihaviy mustahkamlik" />
        </div>
      ),
    },

    /* 04 ─ Nega INSOF */
    {
      n: 4,
      tone: "light",
      title: "NEGA INSOF",
      sub: "Davlat va yirik loyihalar uchun to'rtta kafolat",
      notes: "To'rt kafolat birin-ketin chiqadi: xavfsizlik, standart, muddat, ekologiya — davlat buyurtmachisi uchun eng muhim to'rt mezon.",
      body: (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          {T.nega.map((a, i) => <IconCard key={a.title} {...a} i={i} tone="light" />)}
        </div>
      ),
    },

    /* 05 ─ Ishlab chiqarish bazasi */
    {
      n: 5,
      tone: "dark",
      title: "ISHLAB CHIQARISH BAZASI",
      sub: "Yangiyo'l ishlab chiqarish markazi",
      notes: "Mahsulotlar maxsus kranlar yordamida tartibli saqlanadi va yuk avtomobillariga xavfsiz yuklanadi.",
      body: (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
          <div className="deck-up relative aspect-16/10 overflow-hidden rounded-lg ring-1 ring-white/10" style={step(0)}>
            <Image src="/taqdimot/ombor.jpg" alt="Tayyor mahsulot ombori va kran maydoni" fill sizes="(min-width:1024px) 50vw, 100vw" className="deck-kadr object-cover" />
          </div>
          <div>
            {T.baza.map((p, i) => (
              <p key={i} className="deck-up mb-4 text-[14px] leading-relaxed text-white/70 sm:text-[17px]" style={step(i + 1)}>{p}</p>
            ))}
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {T.bazaChip.map((b, i) => (
                <li key={b.text} className="deck-up flex items-center gap-3 rounded-md bg-white/[0.045] px-4 py-3 text-[13px] text-white/85 ring-1 ring-white/10 sm:text-sm" style={step(i + 3)}>
                  <b.icon size={16} className="shrink-0 text-signal" />
                  {b.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ),
    },

    /* 06 ─ Zavod va quvvat */
    {
      n: 6,
      tone: "dark",
      title: "ZAVOD VA QUVVAT",
      sub: "Ishlab chiqarish salohiyatimiz",
      notes: "Eng kuchli raqam — oyiga 45 000 m3 tayyor beton. Hokimlik auditoriyasi uchun buni yirik ob'ekt hajmi bilan solishtirib bering. 120 nafar xodim — ish o'rni masalasida muhim dalil.",
      body: (
        <div>
          <p className="deck-up mb-5 text-[13px] text-white/60 sm:text-[15px]" style={step(0, 60)}>
            4 ta zavod · 5 ta sanoat hududi · {founded}-yildan buyon uzluksiz ishlab chiqarish
          </p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <Cell i={0} tone="dark" value={<Count to={70} />} label="m³/soat — tayyor beton quvvati" />
            <Cell i={1} tone="dark" value="1000-1500" label="m³/kun — tayyor beton" />
            <Cell i={2} tone="dark" accent value={<Count to={45000} sep />} label="m³/oy — tayyor beton" />
            <Cell i={3} tone="dark" value={<Count to={150} />} label="dona/kun — har bir turdagi temir-beton buyum" />
            <Cell i={4} tone="dark" value={<Count to={4650} sep />} label="dona/oy — har bir turdagi temir-beton buyum" />
            <Cell i={5} tone="dark" value={<Count to={120} />} label="nafar xodim zavodda ishlaydi" />
          </div>
        </div>
      ),
    },

    /* 07 ─ Zavod ishda (video) */
    {
      n: 7,
      tone: "dark",
      title: "ZAVOD ISHDA",
      sub: "Ishlab chiqarish va logistika — jonli lavhalar",
      notes: "Uchala lavha avtomatik, ovozsiz va takrorlanib o'ynaydi. Lavhaga bosish orqali to'xtatish yoki qayta ishga tushirish mumkin.",
      body: (
        <div className="grid gap-4 sm:grid-cols-3">
          {T.lavha.map((v, i) => (
            <figure key={v.src} className="deck-up overflow-hidden rounded-lg bg-white/[0.045] ring-1 ring-white/10" style={step(i, 160)}>
              <video
                src={v.src}
                poster={v.poster}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                onClick={(e) => { const el = e.currentTarget; if (el.paused) void el.play(); else el.pause(); }}
                className="aspect-9/16 w-full cursor-pointer object-cover sm:aspect-4/5"
              />
              <figcaption className="px-4 py-3.5">
                <div className="font-display text-[15px] font-bold text-white sm:text-base">{v.title}</div>
                <div className="mt-1 font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">{v.meta}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      ),
    },

    /* 08 ─ Tovar beton */
    {
      n: 8,
      tone: "light",
      title: "TOVAR BETON",
      sub: "Qaysi marka qayerda ishlatiladi",
      notes: "Zavod liniyasi M100 dan M600 gacha markalarni qamrab oladi. Aniq marka loyiha hisobiga ko'ra tanlanadi.",
      body: (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
          <div>
            <div className="overflow-hidden rounded-lg ring-1 ring-beton-200">
              {T.markalar.map(([m, use], i) => (
                <div
                  key={m}
                  className={`deck-right grid grid-cols-[86px_1fr] items-center gap-3 px-4 py-2.5 text-[13px] sm:grid-cols-[120px_1fr] sm:py-3 sm:text-[15px] ${i % 2 ? "bg-beton-50" : "bg-white"}`}
                  style={step(i, 100)}
                >
                  <span className="font-display font-bold text-insof-700">{m}</span>
                  <span className="text-beton-700">{use}</span>
                </div>
              ))}
            </div>
            <p className="deck-up mt-4 text-[13px] text-beton-500 sm:text-sm" style={step(9)}>
              Aniq marka loyiha hisobiga ko&apos;ra tanlanadi — laboratoriyamiz maslahat beradi.
            </p>
          </div>
          <div className="deck-up relative hidden aspect-4/3 overflow-hidden rounded-lg ring-1 ring-beton-200 lg:block" style={step(2)}>
            <Image src="/taqdimot/markalar.jpg" alt="INSOF beton markalari va mikser avtomobili" fill sizes="33vw" className="deck-kadr object-cover" />
          </div>
        </div>
      ),
    },

    /* 09 ─ Katalog */
    {
      n: 9,
      tone: "light",
      title: "MAHSULOTLAR KATALOGI",
      sub: "Bitta zavod — to'liq nomenklatura",
      notes: "Sakkiz surat ketma-ket chiqadi. Mahsulot nomlari va markalari rasmlarning o'zida ko'rsatilgan.",
      body: (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {T.katalog.map((p, i) => (
            <Shot
              key={p.src}
              src={p.src}
              alt={p.name}
              i={i}
              caption={p.name}
              ratio="aspect-4/3"
            />
          ))}
        </div>
      ),
    },

    /* 10 ─ Texnik xususiyatlar */
    {
      n: 10,
      tone: "light",
      title: "TEXNIK XUSUSIYATLAR",
      sub: "Mahsulot klasslari va o'lchamlari",
      notes: "TO'LDIRISH KERAK: har bir pozitsiya uchun aniq klass, o'lcham (mm) va og'irlik. Hozircha faqat hujjatlashtirilgan qiymatlar kiritilgan.",
      body: (
        <div>
          <div className="overflow-hidden rounded-lg ring-1 ring-beton-200">
            <div className="hidden grid-cols-[1.4fr_1.2fr_1.1fr_0.7fr] gap-3 bg-insof-900 px-4 py-2.5 font-mono text-[10px] tracking-[0.14em] text-white/70 uppercase sm:grid">
              <span>Mahsulot</span><span>Klass / marka</span><span>O&apos;lcham</span><span>Og&apos;irlik</span>
            </div>
            {T.texnik.map((r, i) => (
              <div
                key={r.name}
                className={`deck-right grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[1.4fr_1.2fr_1.1fr_0.7fr] sm:gap-3 sm:text-[14px] ${i % 2 ? "bg-beton-50" : "bg-white"}`}
                style={step(i, 90)}
              >
                <span className="font-semibold text-beton-900">{r.name}</span>
                <span className="text-insof-700">{r.klass ?? <Tbd />}</span>
                <span className="text-beton-600">{r.olcham ?? <Tbd />}</span>
                <span className="text-beton-600 tabular-nums">{r.ogirlik ?? <Tbd />}</span>
              </div>
            ))}
          </div>
          <p className="deck-up mt-4 text-[13px] text-beton-500 sm:text-sm" style={step(10)}>
            To&apos;liq texnik pasport va sertifikatlar har bir pozitsiya bo&apos;yicha taqdim etiladi.
          </p>
        </div>
      ),
    },

    /* 11 ─ Opora SV 110-3,5 */
    {
      n: 11,
      tone: "dark",
      title: "TEXNIK TAHLIL — OPORA SV 110-3,5",
      sub: "Muhandislik ko'rsatkichlari",
      notes: "To'rt ko'rsatkich ketma-ket chiqadi, oxirgisi — seysmik barqarorlik. Hokimlik auditoriyasi uchun shunga urg'u bering.",
      body: (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Cell i={0} tone="dark" value={<Count to={11} suffix=" m" />} label="uzunligi" />
            <Cell i={1} tone="dark" value={<Count to={35} suffix=" kNm" />} label="hisobiy eguvchi momenti (3,5 t·m)" />
            <Cell i={2} tone="dark" value={<Count to={1125} suffix=" kg" />} label="og'irligi" />
            <Cell i={3} tone="dark" accent value={<Count to={9} suffix=" ball" />} label="seysmik barqarorlik darajasi" />
          </div>
          <div className="flex flex-col justify-center gap-5">
            <div className="deck-up relative aspect-16/10 overflow-hidden rounded-lg ring-1 ring-white/10" style={step(4)}>
              <Image src="/taqdimot/mahsulot-2.jpg" alt="Opora SV 110-3,5 tayanch ustunlari" fill sizes="(min-width:1024px) 45vw, 100vw" className="deck-kadr object-cover" />
            </div>
            <p className="deck-up text-[14px] leading-relaxed text-white/70 sm:text-base" style={step(5)}>
              Maxsus plitalar eng yuqori navli M450-M500 beton turlari va zo&apos;riqtirilgan (prednapryajenniy) metall armaturalar yordamida quyiladi.
              Tayanch ustunlari esa M400 og&apos;ir beton sinfidan tayyorlanadi.
            </p>
          </div>
        </div>
      ),
    },

    /* 12 ─ Inert materiallar */
    {
      n: 12,
      tone: "light",
      title: "INERT MATERIALLAR",
      sub: "Tosh va qum turlari",
      notes: "Inert materiallar bo'yicha asosiy savol — hajm. «Aniq hajm» tamoyilini shu yerda ta'kidlang.",
      body: (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
          <div className="deck-up relative aspect-16/10 overflow-hidden rounded-lg ring-1 ring-beton-200" style={step(0)}>
            <Image src="/taqdimot/inert.jpg" alt="Inert materiallar ombori: shag'al va qum" fill sizes="(min-width:1024px) 50vw, 100vw" className="deck-kadr object-cover" />
          </div>
          <div className="space-y-4">
            <div className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(1)}>
              <h3 className="flex items-center gap-2.5 font-display text-[17px] font-bold text-beton-900 sm:text-xl">
                <Boxes size={18} className="text-signal-dim" /> Klinets va shcheben
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                Beton mustahkamligini oshiruvchi granulalangan tosh to&apos;ldiruvchilar. Sement sarfini tejaydi va bosimga chidamlilikni 2 barobar oshiradi.
              </p>
            </div>
            <div className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(2)}>
              <h3 className="flex items-center gap-2.5 font-display text-[17px] font-bold text-beton-900 sm:text-xl">
                <Waves size={18} className="text-signal-dim" /> Finskiy va oddiy qum
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                Tarkibida loy aralashmalari bo&apos;lmagan, maxsus tebranuvchi elaklardan o&apos;tkazilgan toza qum. Sifatli suvoq va pishiq qorishmalar uchun zarur.
              </p>
            </div>
            <p className="deck-up flex items-start gap-3 rounded-lg border-l-4 border-signal bg-beton-100 p-4 text-[13px] leading-relaxed text-beton-700 sm:text-[15px]" style={step(3)}>
              <Truck size={18} className="mt-0.5 shrink-0 text-insof-700" />
              Katta logistik yuk mashinalari orqali inert mahsulotlar ob&apos;ektga o&apos;z vaqtida, belgilangan hajmdan kamaytirmasdan yetkaziladi.
            </p>
          </div>
        </div>
      ),
    },

    /* 13 ─ Ishlab chiqarish jarayoni */
    {
      n: 13,
      tone: "light",
      title: "ISHLAB CHIQARISH JARAYONI",
      sub: "To'rt bosqichli texnologik sikl",
      notes: "Bosqichlar chapdan o'ngga ketma-ket suriladi — siklni shu tartibda so'zlab bering.",
      body: (
        <ol className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {T.jarayon4.map((s, i) => <Step key={s.n} {...s} i={i} tone="light" />)}
        </ol>
      ),
    },

    /* 14 ─ Sifat nazorati */
    {
      n: 14,
      tone: "dark",
      title: "SIFAT NAZORATI",
      sub: "Mutlaqo benuqson nazorat tizimi",
      notes: "Davlat buyurtmachisi uchun eng kuchli dalil — akkreditatsiyalangan o'z laboratoriyasi. Har bir partiya bo'yicha natija taqdim etiladi.",
      body: (
        <div>
          <p className="deck-up max-w-4xl text-[14px] leading-relaxed text-white/75 sm:text-[17px]" style={step(0)}>
            «INSOF» zavodi qoshida eng zamonaviy sinov uskunalariga ega bo&apos;lgan, davlat akkreditatsiyasidan o&apos;tgan maxsus laboratoriya faoliyat ko&apos;rsatadi.
            Har bir partiya betonning siqilishga va egilishga chidamliligi gidravlik press yordamida sinovdan o&apos;tkaziladi.
          </p>
          <div className="mt-6 grid gap-3 sm:gap-4 lg:grid-cols-3">
            {T.nazorat.map((a, i) => <IconCard key={a.title} {...a} i={i + 1} tone="dark" />)}
          </div>
        </div>
      ),
    },

    /* 15 ─ Logistika */
    {
      n: 15,
      tone: "light",
      title: "LOGISTIKA",
      sub: "Yetkazib berish geografiyasi",
      notes: "To'rt hudud birin-ketin paydo bo'ladi, so'ng logistika imkoniyatlari qatori chiqadi.",
      body: (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {T.hududlar.map((h, i) => (
              <div key={h} className="deck-pop flex items-center gap-3 rounded-lg bg-insof-900 px-4 py-5 sm:px-5" style={step(i)}>
                <MapPin size={18} className="shrink-0 text-signal" />
                <span className="font-display text-[14px] leading-tight font-bold text-white sm:text-[17px]">{h}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 sm:gap-4 lg:grid-cols-3">
            {T.logistika.map((l, i) => (
              <div key={l.text} className="deck-up flex items-start gap-3 rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(i + 4)}>
                <l.icon size={18} className="mt-0.5 shrink-0 text-insof-700" />
                <span className="text-[14px] leading-relaxed text-beton-700 sm:text-[15px]">{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },

    /* 16 ─ Hamkorlar */
    {
      n: 16,
      tone: "light",
      title: "HAMKORLARIMIZ",
      sub: "Biz bilan ishlagan kompaniyalar",
      notes: "Logotiplar ketma-ket chiqadi. Har biri haqida bir jumla ayting: qanday ob'ekt, qancha hajm, qaysi yil. Nomlar va logotiplarni ishlatishdan oldin hamkorlardan rozilik olish tavsiya etiladi.",
      body: (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {T.hamkorlar.map((h, i) => (
              <div key={h.name} className="deck-pop flex flex-col items-center justify-center rounded-lg bg-white p-4 ring-1 ring-beton-200 sm:p-5" style={step(i)}>
                <div className="relative flex h-20 w-full items-center justify-center sm:h-24">
                  {h.logo ? (
                    <Image src={h.logo} alt={h.name} fill sizes="(min-width:1024px) 22vw, 45vw" className="object-contain" />
                  ) : (
                    <span className="font-display text-[22px] font-extrabold text-insof-700 sm:text-3xl">{h.name}</span>
                  )}
                </div>
                {/* Logotipsiz kartochkada nom allaqachon katta yozilgan — takrorlanmaydi */}
                {h.logo && <div className="mt-3 text-center font-display text-[13px] font-bold text-beton-900 sm:text-[15px]">{h.name}</div>}
              </div>
            ))}
          </div>
          <div className="deck-up mt-6 flex items-start gap-3 rounded-lg border-l-4 border-signal bg-white p-5 ring-1 ring-beton-200" style={step(4)}>
            <Handshake size={18} className="mt-0.5 shrink-0 text-insof-700" />
            <div>
              <p className="text-[14px] leading-relaxed font-semibold text-beton-900 sm:text-[15px]">
                Yirik shahar qurilish loyihalari va ixtisoslashgan qurilish tashkilotlari bilan ishlaymiz.
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-beton-600 sm:text-[14px]">
                To&apos;liq hamkorlar ro&apos;yxati, bajarilgan ishlar hajmi va tavsiyanomalar so&apos;rov bo&apos;yicha taqdim etiladi.
              </p>
            </div>
          </div>
        </div>
      ),
    },

    /* 17 ─ Hamkorga nima beradi */
    {
      n: 17,
      tone: "light",
      title: "HAMKORGA NIMA BERADI",
      sub: "Nega aynan INSOF bilan hamkorlik qilish kerak",
      notes: "Bu — taqdimotning savdo yuragi. Har bir blok buyurtmachining bitta og'rig'ini yopadi.",
      body: (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
          {T.foyda.map((a, i) => <IconCard key={a.title} {...a} i={i} tone="light" />)}
        </div>
      ),
    },

    /* 18 ─ Kimlar uchun */
    {
      n: 18,
      tone: "dark",
      title: "KIMLAR UCHUN",
      sub: "Davlat loyihalari va yirik qurilish uchun hamkor",
      notes: "Bu slayd — taqdimotning asosiy so'rovi. Kim bilan va qanday shartlarda ishlashga tayyor ekanimizni aniq ayting.",
      body: (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          {T.kimlar.map((a, i) => <IconCard key={a.title} {...a} i={i} tone="dark" />)}
        </div>
      ),
    },

    /* 19 ─ Hamkorlik shakllari */
    {
      n: 19,
      tone: "light",
      title: "TADBIRKORLAR UCHUN",
      sub: "Hamkorlik shakllari",
      notes: "Tadbirkor bilan suhbatda shu to'rt shakldan qaysi biri mos kelishini so'rang — keyingi slaydda jarayon ko'rsatiladi.",
      body: (
        <div>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {T.shakllar.map((a, i) => (
              <div key={a.title} className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(i)}>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-insof-900 text-signal">
                  <a.icon size={19} />
                </span>
                <h3 className="mt-4 font-display text-[15px] leading-tight font-bold text-beton-900 sm:text-lg">{a.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-beton-600 sm:text-[14px]">{a.text}</p>
              </div>
            ))}
          </div>
          <p className="deck-up mt-6 text-[14px] text-beton-600 sm:text-[15px]" style={step(4)}>
            Hajm, muddat va to&apos;lov shartlari har bir loyiha bo&apos;yicha alohida kelishiladi.
          </p>
        </div>
      ),
    },

    /* 20 ─ Jarayon */
    {
      n: 20,
      tone: "dark",
      title: "JARAYON",
      sub: "Hamkorlik qanday boshlanadi",
      notes: "Besh qadam ketma-ket suriladi. Yakunda telefon raqamini ovoz chiqarib ayting — bu slayd suhbatni harakatga aylantiradi.",
      body: (
        <div>
          <ol className="grid gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            {T.qadamlar.map((s, i) => <Step key={s.n} {...s} i={i} tone="dark" />)}
          </ol>
          <p className="deck-up mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-signal px-5 py-4 text-[14px] font-semibold text-white sm:text-[17px]" style={step(5)}>
            <ClipboardList size={18} />
            Birinchi qadam — ob&apos;ektingiz bo&apos;yicha so&apos;rov:
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-display tabular-nums underline-offset-4 hover:underline">{phone}</a>
          </p>
        </div>
      ),
    },

    /* 21 ─ Davlat qo'llab-quvvatlashi */
    {
      n: 21,
      tone: "light",
      title: "DAVLAT QO'LLAB-QUVVATLASHI",
      sub: "Hokimlik va vazirlikdan uchta aniq taklif",
      notes: "Bu slayd hokim yoki vazirlik oldida aytiladigan aniq so'rov. Uchala taklifni birma-bir ayting, oxirida sariq qatordagi natijani ovoz chiqarib o'qing: 50 ta yangi ish o'rni — eng ta'sirli raqam.",
      body: (
        <div>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
            <div className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200 sm:p-6" style={step(0)}>
              <span className="font-mono text-[13px] font-semibold text-signal-dim">01</span>
              <h3 className="mt-2 font-display text-[17px] leading-tight font-bold text-beton-900 sm:text-xl">Davlat buyurtmasi va shartnoma</h3>
              <p className="mt-2.5 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                Ijtimoiy ob&apos;ektlar, yo&apos;l va muhandislik infratuzilmasi loyihalariga mahalliy ishlab chiqaruvchi sifatida kiritilish.
                Quvvatimiz — <span className="font-semibold text-insof-700 tabular-nums">kuniga 1000-1500 m³</span>, <span className="font-semibold text-insof-700 tabular-nums">oyiga 45 000 m³</span>.
              </p>
            </div>
            <div className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200 sm:p-6" style={step(1)}>
              <span className="font-mono text-[13px] font-semibold text-signal-dim">02</span>
              <h3 className="mt-2 font-display text-[17px] leading-tight font-bold text-beton-900 sm:text-xl">Investitsiya yoki imtiyozli kredit</h3>
              <p className="mt-2.5 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                <span className="font-semibold text-insof-700">25-35 mlrd so&apos;m</span> hajmidagi moliyaviy qo&apos;llab-quvvatlash yangi zamonaviy liniya o&apos;rnatish imkonini beradi.
              </p>
            </div>
            <div className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200 sm:p-6" style={step(2)}>
              <span className="font-mono text-[13px] font-semibold text-signal-dim">03</span>
              <h3 className="mt-2 font-display text-[17px] leading-tight font-bold text-beton-900 sm:text-xl">Gazoblok zavodiga amaliy yordam</h3>
              <p className="mt-2.5 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                Yangi gazoblok zavodini yo&apos;lga qo&apos;yishda amaliy ko&apos;mak so&apos;raymiz — hujjatlar, infratuzilma va ruxsatnomalar bo&apos;yicha.
              </p>
            </div>
          </div>

          {/* Natija — slaydning eng kuchli qatori, shuning uchun sariq */}
          <div className="deck-pop mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-signal px-5 py-4 text-white sm:mt-5" style={step(3)}>
            <span className="font-mono text-[11px] tracking-[0.16em] uppercase">Natija</span>
            <span className="flex items-center gap-2 text-[14px] font-semibold sm:text-[16px]"><TrendingUp size={17} /> kuniga 2 000 m³ beton</span>
            <span className="flex items-center gap-2 text-[14px] font-semibold sm:text-[16px]"><Layers size={17} /> har bir turdagi JBI mahsulotidan 200 dona</span>
            <span className="flex items-center gap-2 text-[14px] font-semibold sm:text-[16px]"><Users size={17} /> 50 ta yangi ish o&apos;rni (120 → 170 nafar)</span>
          </div>
        </div>
      ),
    },

    /* 22 ─ Missiya va vizyon */
    {
      n: 22,
      tone: "dark",
      title: "MISSIYA VA VIZYON",
      sub: "Nimaga intilamiz",
      notes: "Avval missiya, keyin vizyon chiqadi; oxirida 35% haqidagi blok qalqib chiqadi — shu yerda to'xtab, raqamni ta'kidlang.",
      body: (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
          <div className="deck-up" style={step(0)}>
            <p className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">Bizning missiyamiz</p>
            <blockquote className="mt-4 font-display text-[clamp(1.15rem,2.6vw,2rem)] leading-snug font-bold text-white">
              «Ekologik toza va energiya tejamkor muhandislik yechimlarini qo&apos;llagan holda, O&apos;zbekistonning jadal urbanizatsiyasi va
              infratuzilmasi uchun eng mustahkam poydevorni ta&apos;minlash.»
            </blockquote>
          </div>
          <div className="flex flex-col justify-center gap-4">
            <div className="deck-up rounded-lg bg-white/[0.045] p-5 ring-1 ring-white/10" style={step(1)}>
              <p className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">Bizning vizyonimiz</p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-white/75 sm:text-base">
                Markaziy Osiyoda raqamlashtirilgan va to&apos;liq avtomatlashtirilgan eng yirik temir-beton ishlab chiqaruvchisiga aylanish.
              </p>
            </div>
            <div className="deck-pop rounded-lg bg-signal p-5" style={step(2)}>
              <div className="font-display text-[clamp(1.8rem,4vw,2.8rem)] leading-none font-extrabold text-white">
                <Count to={35} suffix="%" />
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-white/90 sm:text-[15px]">
                gacha — ob&apos;ektni barpo etish davrini qisqartirish imkoniyati.
              </p>
            </div>
          </div>
        </div>
      ),
    },

    /* 23 ─ Yakun */
    {
      n: 23,
      tone: "dark",
      bare: true,
      bg: "/taqdimot/avtopark.jpg",
      title: "E'TIBORINGIZ UCHUN RAHMAT",
      sub: "Aloqa",
      notes: "Yakunda aniq keyingi qadamni taklif qiling: ob'ekt bo'yicha hisob-kitob, zavodga tashrif yoki sinov partiyasi.",
      body: (
        <div className="w-full">
          <h2 className="deck-up font-display text-[clamp(1.8rem,5.4vw,3.6rem)] leading-[1.05] font-extrabold text-white" style={step(0, 60)}>
            E&apos;tiboringiz uchun rahmat!
          </h2>
          <p className="deck-up mt-4 text-[15px] text-white/80 sm:text-xl" style={step(1, 60)}>
            Ob&apos;ektingiz bo&apos;yicha hisob-kitobni bugun boshlaymiz.
          </p>
          <div className="deck-line mt-6 h-0.5 w-56 max-w-full bg-signal" style={step(2, 60)} />
          <dl className="mt-7 grid gap-4 sm:grid-cols-3">
            {[
              ["TELEFON", phone, `tel:${phone.replace(/[^\d+]/g, "")}`],
              ["ELEKTRON POCHTA", email, `mailto:${email}`],
              ["MANZIL", address, null],
            ].map(([k, v, href], i) => (
              <div key={k as string} className="deck-up rounded-lg bg-white/[0.06] p-4 ring-1 ring-white/10 backdrop-blur-xs" style={step(i + 3, 60)}>
                <dt className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">{k}</dt>
                <dd className="mt-1.5 text-[15px] font-semibold break-words text-white sm:text-[17px]">
                  {href ? <a href={href as string} className="underline-offset-4 hover:underline">{v}</a> : v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="deck-up mt-7 flex flex-wrap gap-3" style={step(6, 60)}>
            <Link href="/#ariza" className="inline-flex h-12 items-center gap-2.5 rounded-md bg-signal px-6 text-[15px] font-semibold text-white transition-colors hover:bg-signal-600">
              Narx-taklif olish <ArrowRight size={17} />
            </Link>
            <Link href="/#mahsulotlar" className="inline-flex h-12 items-center rounded-md border border-white/30 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">
              Mahsulotlar ro&apos;yxati
            </Link>
          </div>
          <p className="deck-up mt-7 font-mono text-[11px] tracking-[0.14em] text-white/45 uppercase" style={step(7, 60)}>
            INSOF TEMIR BETON MAHSULOTLARI — sifatli qurilish uchun ishonchli hamkoringiz
          </p>
        </div>
      ),
    },
  ];
}
