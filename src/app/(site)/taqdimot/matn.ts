/**
 * Taqdimot matnlari — uch tilda (uz / ru / en).
 *
 * Bitta qoida: `uz` — asl nusxa, uning tuzilmasi `DeckText` tipini beradi;
 * `ru` va `en` shu tipga mos bo'lishi shart — biror kalit tushib qolsa
 * TypeScript darrov ko'rsatadi. Ikonkalar, suratlar va tartib `slides.tsx` da,
 * bu yerda faqat so'zlar.
 *
 * Raqamli ma'lumot (marka, o'lcham, kod) tarjima qilinmaydi — u hamma tilda bir xil.
 */

export type Lang = "uz" | "ru" | "en";

export const LANGS: readonly { code: Lang; label: string; name: string }[] = [
  { code: "uz", label: "UZ", name: "O'zbekcha" },
  { code: "ru", label: "RU", name: "Русский" },
  { code: "en", label: "EN", name: "English" },
];

export const DEFAULT_LANG: Lang = "uz";

export function isLang(v: unknown): v is Lang {
  return v === "uz" || v === "ru" || v === "en";
}

/** Ichida qalin bo'lak bo'lgan matn: oddiy satr yoki { b: "qalin" } */
export type Rich = (string | { b: string })[];

type Card = { title: string; text: string };
type Stepx = { n: string; title: string; text: string };
type Row = { name: string; klass: string | null; olcham: string | null; ogirlik: string | null };

const uz = {
  ui: {
    home: "Bosh sahifa",
    homeAria: "Bosh sahifaga qaytish",
    autoOn: "Avtomatik o'ynatish",
    autoOff: "Avtomatik o'ynatishni to'xtatish",
    notes: "Ma'ruzachi izohi",
    all: "Barcha slaydlar",
    fullOn: "To'liq ekran",
    fullOff: "To'liq ekrandan chiqish",
    closeNote: "Izohni yopish",
    back: "Orqaga",
    next: "Keyingi",
    prevSlide: "Oldingi slayd",
    nextSlide: "Keyingi slayd",
    slideN: (n: number, t: string) => `${n}-slayd: ${t}`,
    slides: "Slaydlar",
    count: (n: number) => `${n} ta`,
    close: "Yopish",
    lang: "Taqdimot tili",
  },
  tbd: "to'ldiriladi",
  addressDefault: "Yangiyo'l tumani, Toshkent viloyati",
  regions: "Toshkent shahri · Toshkent viloyati · Sirdaryo · Jizzax",

  s1: {
    title: "INSOF.JBI — TEMIR BETON MAHSULOTLARI",
    sub: "Muqova",
    notes: "Ochilish: logotip ekranda turibdi, shuning uchun kompaniya nomini takrorlamang. O'zingizni tanishtiring va bir jumlada nima taklif qilayotganingizni ayting.",
    logoAlt: "INSOF.JBI — temir beton mahsulotlari",
    tagline: (years: number, founded: number) => `${years} yillik tajriba — ${founded}-yildan buyon O'zbekiston qurilishining mustahkam poydevori.`,
  },

  s2: {
    title: "KOMPANIYA HAQIDA",
    sub: "Ishonch, sifat va mustahkamlik timsoli",
    notes: "Asosiy xabar: korxona bitta zavod emas — Toshkent shahri va viloyatida ishlab chiqarish quvvatlariga ega, to'liq nomenklatura bilan ishlaydi.",
    paras: [
      "«INSOF TEMIR BETON» MChJ — 2000-yildan buyon temir-beton buyumlari va tovar beton ishlab chiqarish sohasida faoliyat yuritib kelayotgan ishonchli korxona.",
      "Korxonamiz nafaqat Toshkent viloyatida, balki Toshkent shahrida ham zamonaviy beton ishlab chiqarish zavodlariga ega.",
      "Biz FBS bloklari, PK va PB trosli plitalar, temir-beton konstruksiyalari hamda tovar beton ishlab chiqaramiz va mahsulotlarni Toshkent shahri, Toshkent viloyati, Sirdaryo hamda Jizzax viloyatlariga tezkor yetkazib beramiz.",
    ],
    facts: [
      ["TASHKIL ETILGAN", "2000-yil", null],
      ["ZAVODLAR", "4 ta zavod", "2 ta beton · 1 ta JBI · 1 ta beton va PB plita"],
      ["TAYYOR BETON", "M200 dan M600 gacha", null],
      ["ASOSIY TAMOYIL", "100% halollik va aniq hajm", null],
      ["KAFOLAT", "Davlat standarti va laboratoriya", null],
    ] as [string, string, string | null][],
  },

  s3: {
    title: "RAQAMLARDA INSOF",
    sub: "Salohiyat va ko'lam",
    notes: "Bu slayd — hokimlik va buyurtmachi uchun asosiy raqamlar. Oltita ko'rsatkich ketma-ket chiqadi, har birini qisqa izohlab o'ting.",
    years: (founded: number) => `yillik tajriba — ${founded}-yildan buyon`,
    areaSuf: "+ ga",
    area: "kengaytirilgan sanoat hududi",
    ballSuf: " ball",
    seismic: "seysmik bardoshlilik darajasi",
    marks: "beton markalari qamrovi",
    regSuf: " hudud",
    regions: "Toshkent sh., Toshkent v., Sirdaryo, Jizzax",
    hourSuf: " soat",
    hours: "ichida 75% loyihaviy mustahkamlik",
  },

  s4: {
    title: "NEGA INSOF",
    sub: "Davlat va yirik loyihalar uchun to'rtta kafolat",
    notes: "To'rt kafolat birin-ketin chiqadi: xavfsizlik, standart, muddat, ekologiya — davlat buyurtmachisi uchun eng muhim to'rt mezon.",
    items: [
      { title: "Seysmik xavfsizlik", text: "Markaziy Osiyo iqlimi va faol seysmik hududlar uchun 9+ ballgacha bardoshli muhandislik yechimlari." },
      { title: "GOST standartlari", text: "Davlat va xalqaro sifat standartlariga to'liq muvofiqlik hamda qat'iy laboratoriya nazorati." },
      { title: "Aniq yetkazib berish", text: "Shaxsiy og'ir yuk tashish parki qurilish jarayonlarini to'xtatmasdan o'z vaqtida yetkazishni ta'minlaydi." },
      { title: "Ekologik yechim", text: "Suvni qayta ishlash tizimi va CO2 chiqindilarini kamaytiruvchi bug'lash kameralari." },
    ] as Card[],
  },

  s5: {
    title: "ISHLAB CHIQARISH BAZASI",
    sub: "Yangiyo'l ishlab chiqarish markazi",
    notes: "Mahsulotlar maxsus kranlar yordamida tartibli saqlanadi va yuk avtomobillariga xavfsiz yuklanadi.",
    imgAlt: "Tayyor mahsulot ombori va kran maydoni",
    paras: [
      "Asosiy sanoat, logistika va ishlab chiqarish bazamiz Toshkent viloyati, Yangiyo'l tumanining eng qulay sanoat zonasida joylashgan.",
      "Keng maydon va avtomobil logistikasiga mo'ljallangan infratuzilma mahsulotlarni tezkor qabul qilish, saqlash va yetkazib berish imkonini yaratadi.",
    ],
    chips: [
      "12 gektardan ortiq sanoat hududi",
      "Avtomatlashtirilgan xomashyo qabuli",
      "Iqlim nazoratidagi yopiq sexlar",
      "Zamonaviy avtomobil logistikasi",
    ],
  },

  s6: {
    title: "ZAVOD VA QUVVAT",
    sub: "Ishlab chiqarish salohiyatimiz",
    notes: "Eng kuchli raqam — oyiga 45 000 m3 tayyor beton. Hokimlik auditoriyasi uchun buni yirik ob'ekt hajmi bilan solishtirib bering. 120 nafar xodim — ish o'rni masalasida muhim dalil.",
    intro: (founded: number) => `4 ta zavod · 5 ta sanoat hududi · ${founded}-yildan buyon uzluksiz ishlab chiqarish`,
    cells: [
      "m³/soat — tayyor beton quvvati",
      "m³/kun — tayyor beton",
      "m³/oy — tayyor beton",
      "dona/kun — har bir turdagi temir-beton buyum",
      "dona/oy — har bir turdagi temir-beton buyum",
      "nafar xodim zavodda ishlaydi",
    ],
  },

  s7: {
    title: "ZAVOD ISHDA",
    sub: "Ishlab chiqarish va logistika — jonli lavhalar",
    notes: "Uchala lavha avtomatik, ovozsiz va takrorlanib o'ynaydi. Lavhaga bosish orqali to'xtatish yoki qayta ishga tushirish mumkin.",
    clips: [
      { title: "Tayyor mahsulot ombori", meta: "Plita · FBS · kran maydoni" },
      { title: "Ishlab chiqarish liniyasi", meta: "Inert material · qoliplash" },
      { title: "Tovar beton avtoparki", meta: "Beton tuguni · mikserlar" },
    ],
  },

  s8: {
    title: "TOVAR BETON",
    sub: "Qaysi marka qayerda ishlatiladi",
    notes: "Zavod liniyasi M100 dan M600 gacha markalarni qamrab oladi. Aniq marka loyiha hisobiga ko'ra tanlanadi.",
    marks: [
      ["M100", "Tayyorgarlik qatlami, podbeton"],
      ["M150", "Yo'lka va maydonchalar"],
      ["M200", "Poydevor va pol qoplamalari"],
      ["M250", "Monolit plitalar, zinapoyalar"],
      ["M300", "Ko'p qavatli bino qismlari"],
      ["M350", "Kolonna, rigel, yuk ko'taruvchi"],
      ["M400", "Temir-beton buyum, tayanch ustun"],
      ["M450-M600", "Maxsus zo'riqishli konstruksiya"],
    ] as [string, string][],
    note: "Aniq marka loyiha hisobiga ko'ra tanlanadi — laboratoriyamiz maslahat beradi.",
    imgAlt: "INSOF beton markalari va mikser avtomobili",
  },

  s9: {
    title: "MAHSULOTLAR KATALOGI",
    sub: "Bitta zavod — to'liq nomenklatura",
    notes: "Sakkiz surat ketma-ket chiqadi. Mahsulot nomlari va markalari rasmlarning o'zida ko'rsatilgan.",
    items: [
      "Bo'shliqli qavat plitalari",
      "Elektr tayanch ustunlari",
      "Suv o'tkazgich lotoklari",
      "Poydevor bloklari",
      "Yo'l bordyurlari",
      "Quduq halqalari va qopqoqlari",
      "Devor bloklari",
      "Zinapoya marshlari",
    ],
  },

  s10: {
    title: "TEXNIK XUSUSIYATLAR",
    sub: "Mahsulot klasslari va o'lchamlari",
    notes: "TO'LDIRISH KERAK: har bir pozitsiya uchun aniq klass, o'lcham (mm) va og'irlik. Hozircha faqat hujjatlashtirilgan qiymatlar kiritilgan.",
    head: ["Mahsulot", "Klass / marka", "O'lcham", "Og'irlik"],
    rows: [
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
    ] as Row[],
    note: "To'liq texnik pasport va sertifikatlar har bir pozitsiya bo'yicha taqdim etiladi.",
  },

  s11: {
    title: "TEXNIK TAHLIL — OPORA SV 110-3,5",
    sub: "Muhandislik ko'rsatkichlari",
    notes: "To'rt ko'rsatkich ketma-ket chiqadi, oxirgisi — seysmik barqarorlik. Hokimlik auditoriyasi uchun shunga urg'u bering.",
    mSuf: " m",
    length: "uzunligi",
    kNmSuf: " kNm",
    moment: "hisobiy eguvchi momenti (3,5 t·m)",
    kgSuf: " kg",
    weight: "og'irligi",
    ballSuf: " ball",
    seismic: "seysmik barqarorlik darajasi",
    imgAlt: "Opora SV 110-3,5 tayanch ustunlari",
    text: "Maxsus plitalar eng yuqori navli M450-M500 beton turlari va zo'riqtirilgan (prednapryajenniy) metall armaturalar yordamida quyiladi. Tayanch ustunlari esa M400 og'ir beton sinfidan tayyorlanadi.",
  },

  s12: {
    title: "INERT MATERIALLAR",
    sub: "Tosh va qum turlari",
    notes: "Inert materiallar bo'yicha asosiy savol — hajm. «Aniq hajm» tamoyilini shu yerda ta'kidlang.",
    imgAlt: "Inert materiallar ombori: shag'al va qum",
    stone: {
      h: "Klinets va shcheben",
      p: "Beton mustahkamligini oshiruvchi granulalangan tosh to'ldiruvchilar. Sement sarfini tejaydi va bosimga chidamlilikni 2 barobar oshiradi.",
    },
    sand: {
      h: "Finskiy va oddiy qum",
      p: "Tarkibida loy aralashmalari bo'lmagan, maxsus tebranuvchi elaklardan o'tkazilgan toza qum. Sifatli suvoq va pishiq qorishmalar uchun zarur.",
    },
    callout: "Katta logistik yuk mashinalari orqali inert mahsulotlar ob'ektga o'z vaqtida, belgilangan hajmdan kamaytirmasdan yetkaziladi.",
  },

  s13: {
    title: "ISHLAB CHIQARISH JARAYONI",
    sub: "To'rt bosqichli texnologik sikl",
    notes: "Bosqichlar chapdan o'ngga ketma-ket suriladi — siklni shu tartibda so'zlab bering.",
    steps: [
      { n: "01", title: "Armaturalash", text: "Yuqori mustahkamlikka ega sovuq cho'zilgan po'lat simlar yordamida kuchaytirilgan karkas tayyorlash." },
      { n: "02", title: "Aralashma tayyorlash", text: "Kompyuter nazorati ostida qum, shag'al, sement va maxsus kimyoviy qo'shimchalarni o'lchash." },
      { n: "03", title: "Qoliplash va zichlash", text: "Yuqori chastotali tebranish stollari yordamida aralashmadagi havo pufakchalarini to'liq yo'qotish." },
      { n: "04", title: "Issiqlik bilan ishlov", text: "Maxsus bug'lash kameralarida 18 soat ichida betonning 75% loyihaviy mustahkamligiga erishish." },
    ] as Stepx[],
  },

  s14: {
    title: "SIFAT NAZORATI",
    sub: "Mutlaqo benuqson nazorat tizimi",
    notes: "Davlat buyurtmachisi uchun eng kuchli dalil — akkreditatsiyalangan o'z laboratoriyasi. Har bir partiya bo'yicha natija taqdim etiladi.",
    intro: "«INSOF» zavodi qoshida eng zamonaviy sinov uskunalariga ega bo'lgan, davlat akkreditatsiyasidan o'tgan maxsus laboratoriya faoliyat ko'rsatadi. Har bir partiya betonning siqilishga va egilishga chidamliligi gidravlik press yordamida sinovdan o'tkaziladi.",
    items: [
      { title: "Gidravlik press", text: "Beton namunalarini press ostida sindirish sinovlari." },
      { title: "Ultratovush", text: "Beton ichki qatlamlaridagi bo'shliqlarni aniqlash." },
      { title: "F va W darajasi", text: "Sovuqqa chidamlilik (F) va suv o'tkazmaslik (W) o'lchovlari." },
    ] as Card[],
  },

  s15: {
    title: "LOGISTIKA",
    sub: "Yetkazib berish geografiyasi",
    notes: "To'rt hudud birin-ketin paydo bo'ladi, so'ng logistika imkoniyatlari qatori chiqadi.",
    regions: ["Toshkent shahri", "Toshkent viloyati", "Sirdaryo viloyati", "Jizzax viloyati"],
    items: [
      "Shaxsiy og'ir yuk tashish va samosval parki",
      "Mahsulotlar maxsus kranlar bilan xavfsiz yuklanadi",
      "Belgilangan hajmda va o'z vaqtida yetkazish",
    ],
  },

  s16: {
    title: "HAMKORLARIMIZ",
    sub: "Biz bilan ishlagan kompaniyalar",
    notes: "Logotiplar ketma-ket chiqadi. Har biri haqida bir jumla ayting: qanday ob'ekt, qancha hajm, qaysi yil. Nomlar va logotiplarni ishlatishdan oldin hamkorlardan rozilik olish tavsiya etiladi.",
    p1: "Yirik shahar qurilish loyihalari va ixtisoslashgan qurilish tashkilotlari bilan ishlaymiz.",
    p2: "To'liq hamkorlar ro'yxati, bajarilgan ishlar hajmi va tavsiyanomalar so'rov bo'yicha taqdim etiladi.",
  },

  s17: {
    title: "HAMKORGA NIMA BERADI",
    sub: "Nega aynan INSOF bilan hamkorlik qilish kerak",
    notes: "Bu — taqdimotning savdo yuragi. Har bir blok buyurtmachining bitta og'rig'ini yopadi.",
    items: [
      { title: "Bitta manbadan ta'minot", text: "Tayyor beton, temir-beton buyumlar va inert materiallar — bitta yetkazib beruvchidan." },
      { title: "O'z laboratoriyamiz", text: "Har bir partiya davlat standarti bo'yicha sinovdan o'tadi — sifat dalil bilan." },
      { title: "O'z transport parki", text: "Yetkazish uchinchi tomonga bog'liq emas — grafik buzilmaydi." },
      { title: "Aniq hajm, halol o'lchov", text: "Belgilangan hajmdan kamaytirmasdan yetkaziladi — asosiy tamoyilimiz." },
      { title: "Muddatni qisqartirish", text: "Zamonaviy texnologiyalar ob'ekt qurilish davrini 35% gacha qisqartiradi." },
      { title: "26 yillik tajriba", text: "2000-yildan buyon yirik qurilish loyihalarida sinalgan hamkor." },
    ] as Card[],
  },

  s18: {
    title: "KIMLAR UCHUN",
    sub: "Davlat loyihalari va yirik qurilish uchun hamkor",
    notes: "Bu slayd — taqdimotning asosiy so'rovi. Kim bilan va qanday shartlarda ishlashga tayyor ekanimizni aniq ayting.",
    items: [
      { title: "Davlat va hokimlik loyihalari", text: "Ijtimoiy ob'ektlar, yo'l va muhandislik infratuzilmasi uchun davlat standartlari bo'yicha sinovdan o'tgan temir-beton." },
      { title: "Quruvchi kompaniyalar", text: "Turar-joy va tijorat majmualari uchun uzluksiz hajm hamda grafik bo'yicha yetkazib berish." },
      { title: "Sanoat buyurtmachilari", text: "Maxsus konstruksiyalar, tayanch ustunlari va yuqori markali tayyor beton bo'yicha buyurtmalar." },
      { title: "Laboratoriya kafolati", text: "Har bir mahsulot davlat standartlari asosida sinovdan o'tkaziladi — hajm va sifat tasdiqlanadi." },
    ] as Card[],
  },

  s19: {
    title: "TADBIRKORLAR UCHUN",
    sub: "Hamkorlik shakllari",
    notes: "Tadbirkor bilan suhbatda shu to'rt shakldan qaysi biri mos kelishini so'rang — keyingi slaydda jarayon ko'rsatiladi.",
    items: [
      { title: "Uzoq muddatli shartnoma", text: "Ob'ekt davomiyligiga mo'ljallangan grafik va barqaror hajm." },
      { title: "Bir martalik yirik buyurtma", text: "Aniq ob'ekt uchun hisob-kitob va bir martalik ta'minot." },
      { title: "Kompleks ta'minot", text: "Beton, temir-beton buyum va inert material bitta paketda." },
      { title: "Maxsus buyurtma", text: "Loyiha talabiga ko'ra o'lcham va marka bo'yicha ishlab chiqarish." },
    ] as Card[],
    note: "Hajm, muddat va to'lov shartlari har bir loyiha bo'yicha alohida kelishiladi.",
  },

  s20: {
    title: "JARAYON",
    sub: "Hamkorlik qanday boshlanadi",
    notes: "Besh qadam ketma-ket suriladi. Yakunda telefon raqamini ovoz chiqarib ayting — bu slayd suhbatni harakatga aylantiradi.",
    steps: [
      { n: "01", title: "So'rov", text: "Ob'ekt, hajm va muddat haqida ma'lumot yuborasiz." },
      { n: "02", title: "Texnik hisob", text: "Muhandislar marka va nomenklaturani aniqlaydi." },
      { n: "03", title: "Tijorat taklifi", text: "Hajm, grafik va shartlar bo'yicha taklif beriladi." },
      { n: "04", title: "Shartnoma", text: "Shartlar kelishilgach shartnoma imzolanadi." },
      { n: "05", title: "Yetkazib berish", text: "Grafik bo'yicha yetkazish va sifat hujjatlari." },
    ] as Stepx[],
    cta: "Birinchi qadam — ob'ektingiz bo'yicha so'rov:",
  },

  s21: {
    title: "DAVLAT QO'LLAB-QUVVATLASHI",
    sub: "Hokimlik va vazirlikdan uchta aniq taklif",
    notes: "Bu slayd hokim yoki vazirlik oldida aytiladigan aniq so'rov. Uchala taklifni birma-bir ayting, oxirida sariq qatordagi natijani ovoz chiqarib o'qing: 50 ta yangi ish o'rni — eng ta'sirli raqam.",
    cards: [
      {
        title: "Davlat buyurtmasi va shartnoma",
        text: [
          "Ijtimoiy ob'ektlar, yo'l va muhandislik infratuzilmasi loyihalariga mahalliy ishlab chiqaruvchi sifatida kiritilish. Quvvatimiz — ",
          { b: "kuniga 1000-1500 m³" }, ", ", { b: "oyiga 45 000 m³" }, ".",
        ],
      },
      {
        title: "Investitsiya yoki imtiyozli kredit",
        text: [{ b: "25-35 mlrd so'm" }, " hajmidagi moliyaviy qo'llab-quvvatlash yangi zamonaviy liniya o'rnatish imkonini beradi."],
      },
      {
        title: "Gazoblok zavodiga amaliy yordam",
        text: ["Yangi gazoblok zavodini yo'lga qo'yishda amaliy ko'mak so'raymiz — hujjatlar, infratuzilma va ruxsatnomalar bo'yicha."],
      },
    ] as { title: string; text: Rich }[],
    resultLabel: "Natija",
    results: [
      "kuniga 2 000 m³ beton",
      "har bir turdagi JBI mahsulotidan 200 dona",
      "50 ta yangi ish o'rni (120 → 170 nafar)",
    ],
  },

  s22: {
    title: "MISSIYA VA VIZYON",
    sub: "Nimaga intilamiz",
    notes: "Avval missiya, keyin vizyon chiqadi; oxirida 35% haqidagi blok qalqib chiqadi — shu yerda to'xtab, raqamni ta'kidlang.",
    missionLabel: "Bizning missiyamiz",
    mission: "«Ekologik toza va energiya tejamkor muhandislik yechimlarini qo'llagan holda, O'zbekistonning jadal urbanizatsiyasi va infratuzilmasi uchun eng mustahkam poydevorni ta'minlash.»",
    visionLabel: "Bizning vizyonimiz",
    vision: "Markaziy Osiyoda raqamlashtirilgan va to'liq avtomatlashtirilgan eng yirik temir-beton ishlab chiqaruvchisiga aylanish.",
    /** Katta «35%» raqamidan oldin va keyin turadigan so'zlar */
    pctPrefix: "",
    pct: "gacha — ob'ektni barpo etish davrini qisqartirish imkoniyati.",
  },

  s23: {
    title: "E'TIBORINGIZ UCHUN RAHMAT",
    sub: "Aloqa",
    notes: "Yakunda aniq keyingi qadamni taklif qiling: ob'ekt bo'yicha hisob-kitob, zavodga tashrif yoki sinov partiyasi.",
    h: "E'tiboringiz uchun rahmat!",
    p: "Ob'ektingiz bo'yicha hisob-kitobni bugun boshlaymiz.",
    phone: "TELEFON",
    email: "ELEKTRON POCHTA",
    address: "MANZIL",
    cta1: "Narx-taklif olish",
    cta2: "Mahsulotlar ro'yxati",
    footer: "INSOF TEMIR BETON MAHSULOTLARI — sifatli qurilish uchun ishonchli hamkoringiz",
  },
};

export type DeckText = typeof uz;

const ru: DeckText = {
  ui: {
    home: "Главная",
    homeAria: "Вернуться на главную",
    autoOn: "Автопоказ",
    autoOff: "Остановить автопоказ",
    notes: "Заметки докладчика",
    all: "Все слайды",
    fullOn: "Полный экран",
    fullOff: "Выйти из полного экрана",
    closeNote: "Закрыть заметку",
    back: "Назад",
    next: "Далее",
    prevSlide: "Предыдущий слайд",
    nextSlide: "Следующий слайд",
    slideN: (n, t) => `Слайд ${n}: ${t}`,
    slides: "Слайды",
    count: (n) => `${n} шт.`,
    close: "Закрыть",
    lang: "Язык презентации",
  },
  tbd: "уточняется",
  addressDefault: "Янгиюльский район, Ташкентская область",
  regions: "Ташкент · Ташкентская область · Сырдарья · Джизак",

  s1: {
    title: "INSOF.ЖБИ — ЖЕЛЕЗОБЕТОННЫЕ ИЗДЕЛИЯ",
    sub: "Обложка",
    notes: "Открытие: логотип уже на экране, поэтому не повторяйте название компании. Представьтесь и одной фразой скажите, что вы предлагаете.",
    logoAlt: "INSOF.ЖБИ — железобетонные изделия",
    tagline: (years, founded) => `${years} лет опыта — с ${founded} года надёжный фундамент строительства Узбекистана.`,
  },

  s2: {
    title: "О КОМПАНИИ",
    sub: "Символ доверия, качества и прочности",
    notes: "Главный посыл: предприятие — это не один завод, а производственные мощности в Ташкенте и области с полной номенклатурой.",
    paras: [
      "ООО «INSOF TEMIR BETON» — надёжное предприятие, с 2000 года работающее в сфере производства железобетонных изделий и товарного бетона.",
      "Наши современные бетонные заводы расположены не только в Ташкентской области, но и в городе Ташкенте.",
      "Мы производим блоки ФБС, плиты ПК и преднапряжённые плиты ПБ, железобетонные конструкции и товарный бетон и оперативно доставляем продукцию в Ташкент, Ташкентскую, Сырдарьинскую и Джизакскую области.",
    ],
    facts: [
      ["ОСНОВАНА", "2000 год", null],
      ["ЗАВОДЫ", "4 завода", "2 бетонных · 1 ЖБИ · 1 бетон и плиты ПБ"],
      ["ТОВАРНЫЙ БЕТОН", "от M200 до M600", null],
      ["ГЛАВНЫЙ ПРИНЦИП", "100% честность и точный объём", null],
      ["ГАРАНТИЯ", "Госстандарт и лаборатория", null],
    ],
  },

  s3: {
    title: "INSOF В ЦИФРАХ",
    sub: "Потенциал и масштаб",
    notes: "Этот слайд — ключевые цифры для хокимията и заказчика. Шесть показателей появляются по очереди, кратко прокомментируйте каждый.",
    years: (founded) => `лет опыта — с ${founded} года`,
    areaSuf: "+ га",
    area: "расширенная промышленная территория",
    ballSuf: " баллов",
    seismic: "сейсмостойкость",
    marks: "диапазон марок бетона",
    regSuf: " региона",
    regions: "Ташкент, Ташкентская обл., Сырдарья, Джизак",
    hourSuf: " часов",
    hours: "до 75% проектной прочности",
  },

  s4: {
    title: "ПОЧЕМУ INSOF",
    sub: "Четыре гарантии для государственных и крупных проектов",
    notes: "Четыре гарантии появляются по очереди: безопасность, стандарт, сроки, экология — четыре главных критерия для госзаказчика.",
    items: [
      { title: "Сейсмическая безопасность", text: "Инженерные решения, рассчитанные на 9+ баллов для климата Центральной Азии и сейсмоактивных зон." },
      { title: "Стандарты ГОСТ", text: "Полное соответствие государственным и международным стандартам качества и строгий лабораторный контроль." },
      { title: "Точная доставка", text: "Собственный парк тяжёлой техники обеспечивает поставку точно в срок, не останавливая стройку." },
      { title: "Экологичное решение", text: "Система оборотного водоснабжения и пропарочные камеры, снижающие выбросы CO2." },
    ],
  },

  s5: {
    title: "ПРОИЗВОДСТВЕННАЯ БАЗА",
    sub: "Производственный центр в Янгиюле",
    notes: "Продукция хранится в порядке с помощью специальных кранов и безопасно грузится на автотранспорт.",
    imgAlt: "Склад готовой продукции и крановая площадка",
    paras: [
      "Наша основная промышленная, логистическая и производственная база расположена в удобной промзоне Янгиюльского района Ташкентской области.",
      "Большая территория и инфраструктура, рассчитанная на автомобильную логистику, позволяют быстро принимать, хранить и отгружать продукцию.",
    ],
    chips: [
      "Более 12 гектаров промышленной территории",
      "Автоматизированная приёмка сырья",
      "Закрытые цеха с климат-контролем",
      "Современная автомобильная логистика",
    ],
  },

  s6: {
    title: "ЗАВОД И МОЩНОСТЬ",
    sub: "Наш производственный потенциал",
    notes: "Самая сильная цифра — 45 000 м³ товарного бетона в месяц. Для хокимията сравните её с объёмом крупного объекта. 120 сотрудников — важный аргумент по рабочим местам.",
    intro: (founded) => `4 завода · 5 промышленных площадок · непрерывное производство с ${founded} года`,
    cells: [
      "м³/час — мощность по товарному бетону",
      "м³/сутки — товарный бетон",
      "м³/месяц — товарный бетон",
      "шт./сутки — каждый вид ЖБИ",
      "шт./месяц — каждый вид ЖБИ",
      "сотрудников работают на заводе",
    ],
  },

  s7: {
    title: "ЗАВОД В РАБОТЕ",
    sub: "Производство и логистика — живые кадры",
    notes: "Все три ролика играют автоматически, без звука и по кругу. Клик по ролику ставит на паузу или запускает снова.",
    clips: [
      { title: "Склад готовой продукции", meta: "Плиты · ФБС · крановая площадка" },
      { title: "Производственная линия", meta: "Инертные материалы · формовка" },
      { title: "Автопарк товарного бетона", meta: "Бетонный узел · миксеры" },
    ],
  },

  s8: {
    title: "ТОВАРНЫЙ БЕТОН",
    sub: "Какая марка где применяется",
    notes: "Линия завода охватывает марки от M100 до M600. Точная марка выбирается по проектному расчёту.",
    marks: [
      ["M100", "Подготовительный слой, подбетонка"],
      ["M150", "Дорожки и площадки"],
      ["M200", "Фундаменты и стяжки полов"],
      ["M250", "Монолитные плиты, лестницы"],
      ["M300", "Элементы многоэтажных зданий"],
      ["M350", "Колонны, ригели, несущие элементы"],
      ["M400", "ЖБИ, опоры"],
      ["M450-M600", "Конструкции особой нагрузки"],
    ],
    note: "Точная марка выбирается по проектному расчёту — наша лаборатория проконсультирует.",
    imgAlt: "Марки бетона INSOF и автобетоносмеситель",
  },

  s9: {
    title: "КАТАЛОГ ПРОДУКЦИИ",
    sub: "Один завод — полная номенклатура",
    notes: "Восемь фото появляются по очереди. Названия и марки продукции указаны на самих изображениях.",
    items: [
      "Многопустотные плиты перекрытия",
      "Опоры ЛЭП",
      "Водоотводные лотки",
      "Фундаментные блоки",
      "Дорожные бордюры",
      "Кольца и крышки колодцев",
      "Стеновые блоки",
      "Лестничные марши",
    ],
  },

  s10: {
    title: "ТЕХНИЧЕСКИЕ ХАРАКТЕРИСТИКИ",
    sub: "Классы и размеры продукции",
    notes: "НУЖНО ЗАПОЛНИТЬ: точный класс, размер (мм) и вес для каждой позиции. Пока указаны только задокументированные значения.",
    head: ["Продукция", "Класс / марка", "Размер", "Вес"],
    rows: [
      { name: "Плиты перекрытия ПК", klass: "ПК 59-12-8", olcham: null, ogirlik: null },
      { name: "Преднапряжённые плиты ПБ", klass: null, olcham: null, ogirlik: null },
      { name: "Опора СВ 110-3,5", klass: "M400", olcham: "длина 11 000 мм", ogirlik: "1125 кг" },
      { name: "Фундаментные блоки ФБС", klass: "24-4-6 / 12-4-6 / 09-4-6", olcham: null, ogirlik: null },
      { name: "Лоток", klass: "Л-5", olcham: null, ogirlik: null },
      { name: "Бордюр", klass: "30x18x30", olcham: null, ogirlik: null },
      { name: "Кольцо колодца", klass: "КС 1,5", olcham: "диаметр 1,5 м", ogirlik: null },
      { name: "Крышка колодца", klass: "1,5", olcham: "диаметр 1,5 м", ogirlik: null },
      { name: "Лестничный марш", klass: "2 ЛМ 57-12-17", olcham: null, ogirlik: null },
      { name: "Газоблок", klass: null, olcham: null, ogirlik: null },
    ],
    note: "Полный технический паспорт и сертификаты предоставляются по каждой позиции.",
  },

  s11: {
    title: "ТЕХНИЧЕСКИЙ АНАЛИЗ — ОПОРА СВ 110-3,5",
    sub: "Инженерные показатели",
    notes: "Четыре показателя появляются по очереди, последний — сейсмостойкость. Для хокимията сделайте на этом акцент.",
    mSuf: " м",
    length: "длина",
    kNmSuf: " кНм",
    moment: "расчётный изгибающий момент (3,5 т·м)",
    kgSuf: " кг",
    weight: "вес",
    ballSuf: " баллов",
    seismic: "сейсмостойкость",
    imgAlt: "Опоры СВ 110-3,5",
    text: "Специальные плиты отливаются из бетона высших марок M450-M500 с преднапряжённой металлической арматурой. Опоры изготавливаются из тяжёлого бетона класса M400.",
  },

  s12: {
    title: "ИНЕРТНЫЕ МАТЕРИАЛЫ",
    sub: "Виды щебня и песка",
    notes: "Главный вопрос по инертным материалам — объём. Здесь подчеркните принцип «точный объём».",
    imgAlt: "Склад инертных материалов: щебень и песок",
    stone: {
      h: "Клинец и щебень",
      p: "Гранулированные каменные заполнители, повышающие прочность бетона. Экономят расход цемента и вдвое повышают стойкость к нагрузке.",
    },
    sand: {
      h: "Финский и обычный песок",
      p: "Чистый песок без глинистых примесей, просеянный через специальные вибросита. Необходим для качественной штукатурки и прочных растворов.",
    },
    callout: "Крупнотоннажный транспорт доставляет инертные материалы на объект вовремя и в полном объёме, без недовеса.",
  },

  s13: {
    title: "ПРОИЗВОДСТВЕННЫЙ ПРОЦЕСС",
    sub: "Четырёхэтапный технологический цикл",
    notes: "Этапы выдвигаются слева направо по очереди — рассказывайте цикл в этом порядке.",
    steps: [
      { n: "01", title: "Армирование", text: "Изготовление усиленного каркаса из высокопрочной холоднотянутой стальной проволоки." },
      { n: "02", title: "Приготовление смеси", text: "Дозирование песка, щебня, цемента и специальных химических добавок под компьютерным контролем." },
      { n: "03", title: "Формовка и уплотнение", text: "Полное удаление воздушных пузырьков из смеси на высокочастотных вибростолах." },
      { n: "04", title: "Тепловая обработка", text: "Достижение 75% проектной прочности бетона за 18 часов в специальных пропарочных камерах." },
    ],
  },

  s14: {
    title: "КОНТРОЛЬ КАЧЕСТВА",
    sub: "Абсолютно безупречная система контроля",
    notes: "Самый сильный аргумент для госзаказчика — собственная аккредитованная лаборатория. Результаты предоставляются по каждой партии.",
    intro: "При заводе «INSOF» работает специальная лаборатория с самым современным испытательным оборудованием, прошедшая государственную аккредитацию. Каждая партия бетона испытывается на сжатие и изгиб на гидравлическом прессе.",
    items: [
      { title: "Гидравлический пресс", text: "Испытания образцов бетона на разрушение под прессом." },
      { title: "Ультразвук", text: "Выявление пустот во внутренних слоях бетона." },
      { title: "Классы F и W", text: "Измерение морозостойкости (F) и водонепроницаемости (W)." },
    ],
  },

  s15: {
    title: "ЛОГИСТИКА",
    sub: "География поставок",
    notes: "Четыре региона появляются по очереди, затем — строка логистических возможностей.",
    regions: ["Город Ташкент", "Ташкентская область", "Сырдарьинская область", "Джизакская область"],
    items: [
      "Собственный парк тяжёлой техники и самосвалов",
      "Продукция безопасно грузится специальными кранами",
      "Доставка в заданном объёме и точно в срок",
    ],
  },

  s16: {
    title: "НАШИ ПАРТНЁРЫ",
    sub: "Компании, которые работали с нами",
    notes: "Логотипы появляются по очереди. О каждом скажите одну фразу: какой объект, какой объём, в каком году. Перед использованием названий и логотипов рекомендуется получить согласие партнёров.",
    p1: "Мы работаем с крупными городскими строительными проектами и специализированными строительными организациями.",
    p2: "Полный список партнёров, объёмы выполненных работ и рекомендации предоставляются по запросу.",
  },

  s17: {
    title: "ЧТО ПОЛУЧАЕТ ПАРТНЁР",
    sub: "Почему стоит сотрудничать именно с INSOF",
    notes: "Это — коммерческое сердце презентации. Каждый блок закрывает одну боль заказчика.",
    items: [
      { title: "Поставка из одного источника", text: "Товарный бетон, ЖБИ и инертные материалы — от одного поставщика." },
      { title: "Собственная лаборатория", text: "Каждая партия испытывается по госстандарту — качество с доказательством." },
      { title: "Собственный автопарк", text: "Доставка не зависит от третьих лиц — график не срывается." },
      { title: "Точный объём, честный учёт", text: "Поставляем без недовеса от заданного объёма — наш главный принцип." },
      { title: "Сокращение сроков", text: "Современные технологии сокращают срок строительства объекта до 35%." },
      { title: "26 лет опыта", text: "Партнёр, проверенный крупными строительными проектами с 2000 года." },
    ],
  },

  s18: {
    title: "ДЛЯ КОГО",
    sub: "Партнёр для государственных проектов и крупного строительства",
    notes: "Этот слайд — главный запрос презентации. Чётко скажите, с кем и на каких условиях мы готовы работать.",
    items: [
      { title: "Государственные проекты и хокимияты", text: "Железобетон, испытанный по госстандартам, для социальных объектов, дорог и инженерной инфраструктуры." },
      { title: "Строительные компании", text: "Бесперебойные объёмы и поставка по графику для жилых и коммерческих комплексов." },
      { title: "Промышленные заказчики", text: "Заказы на специальные конструкции, опоры и товарный бетон высоких марок." },
      { title: "Лабораторная гарантия", text: "Каждое изделие испытывается по госстандартам — объём и качество подтверждаются." },
    ],
  },

  s19: {
    title: "ДЛЯ ПРЕДПРИНИМАТЕЛЕЙ",
    sub: "Формы сотрудничества",
    notes: "В разговоре с предпринимателем спросите, какая из четырёх форм подходит — на следующем слайде показан процесс.",
    items: [
      { title: "Долгосрочный договор", text: "График на весь срок объекта и стабильный объём." },
      { title: "Разовый крупный заказ", text: "Расчёт под конкретный объект и разовая поставка." },
      { title: "Комплексная поставка", text: "Бетон, ЖБИ и инертные материалы в одном пакете." },
      { title: "Специальный заказ", text: "Производство по размерам и марке согласно требованиям проекта." },
    ],
    note: "Объём, сроки и условия оплаты согласовываются отдельно по каждому проекту.",
  },

  s20: {
    title: "ПРОЦЕСС",
    sub: "Как начинается сотрудничество",
    notes: "Пять шагов выдвигаются по очереди. В конце произнесите номер телефона вслух — этот слайд превращает разговор в действие.",
    steps: [
      { n: "01", title: "Запрос", text: "Вы отправляете данные об объекте, объёме и сроках." },
      { n: "02", title: "Технический расчёт", text: "Инженеры определяют марку и номенклатуру." },
      { n: "03", title: "Коммерческое предложение", text: "Предложение по объёму, графику и условиям." },
      { n: "04", title: "Договор", text: "После согласования условий подписывается договор." },
      { n: "05", title: "Поставка", text: "Доставка по графику и документы о качестве." },
    ],
    cta: "Первый шаг — запрос по вашему объекту:",
  },

  s21: {
    title: "ГОСУДАРСТВЕННАЯ ПОДДЕРЖКА",
    sub: "Три конкретных предложения хокимияту и министерству",
    notes: "Этот слайд — конкретный запрос перед хокимом или министерством. Назовите все три предложения по очереди, в конце прочитайте вслух результат в оранжевой строке: 50 новых рабочих мест — самая сильная цифра.",
    cards: [
      {
        title: "Государственный заказ и договор",
        text: [
          "Включение в проекты социальных объектов, дорог и инженерной инфраструктуры как местного производителя. Наша мощность — ",
          { b: "1000-1500 м³ в сутки" }, ", ", { b: "45 000 м³ в месяц" }, ".",
        ],
      },
      {
        title: "Инвестиции или льготный кредит",
        text: ["Финансовая поддержка в размере ", { b: "25-35 млрд сумов" }, " позволит установить новую современную линию."],
      },
      {
        title: "Практическая помощь заводу газоблоков",
        text: ["Просим практического содействия в запуске нового завода газоблоков — по документам, инфраструктуре и разрешениям."],
      },
    ],
    resultLabel: "Результат",
    results: [
      "2 000 м³ бетона в сутки",
      "200 шт. каждого вида ЖБИ",
      "50 новых рабочих мест (120 → 170 человек)",
    ],
  },

  s22: {
    title: "МИССИЯ И ВИДЕНИЕ",
    sub: "К чему мы стремимся",
    notes: "Сначала появляется миссия, затем видение; в конце всплывает блок о 35% — остановитесь здесь и подчеркните цифру.",
    missionLabel: "Наша миссия",
    mission: "«Обеспечивать самый прочный фундамент для стремительной урбанизации и инфраструктуры Узбекистана, применяя экологически чистые и энергоэффективные инженерные решения.»",
    visionLabel: "Наше видение",
    vision: "Стать крупнейшим цифровым и полностью автоматизированным производителем железобетона в Центральной Азии.",
    pctPrefix: "до ",
    pct: "— возможное сокращение срока возведения объекта.",
  },

  s23: {
    title: "СПАСИБО ЗА ВНИМАНИЕ",
    sub: "Контакты",
    notes: "В конце предложите конкретный следующий шаг: расчёт по объекту, визит на завод или пробную партию.",
    h: "Спасибо за внимание!",
    p: "Начнём расчёт по вашему объекту уже сегодня.",
    phone: "ТЕЛЕФОН",
    email: "ЭЛ. ПОЧТА",
    address: "АДРЕС",
    cta1: "Получить предложение",
    cta2: "Список продукции",
    footer: "INSOF ЖЕЛЕЗОБЕТОННЫЕ ИЗДЕЛИЯ — ваш надёжный партнёр для качественного строительства",
  },
};

const en: DeckText = {
  ui: {
    home: "Home",
    homeAria: "Back to home page",
    autoOn: "Autoplay",
    autoOff: "Stop autoplay",
    notes: "Speaker notes",
    all: "All slides",
    fullOn: "Full screen",
    fullOff: "Exit full screen",
    closeNote: "Close notes",
    back: "Back",
    next: "Next",
    prevSlide: "Previous slide",
    nextSlide: "Next slide",
    slideN: (n, t) => `Slide ${n}: ${t}`,
    slides: "Slides",
    count: (n) => `${n} total`,
    close: "Close",
    lang: "Presentation language",
  },
  tbd: "to be filled",
  addressDefault: "Yangiyul district, Tashkent region",
  regions: "Tashkent city · Tashkent region · Syrdarya · Jizzakh",

  s1: {
    title: "INSOF.JBI — REINFORCED CONCRETE PRODUCTS",
    sub: "Cover",
    notes: "Opening: the logo is already on screen, so do not repeat the company name. Introduce yourself and say in one sentence what you are offering.",
    logoAlt: "INSOF.JBI — reinforced concrete products",
    tagline: (years, founded) => `${years} years of experience — a solid foundation for Uzbekistan's construction industry since ${founded}.`,
  },

  s2: {
    title: "ABOUT THE COMPANY",
    sub: "A symbol of trust, quality and durability",
    notes: "Key message: this is not a single plant — we have production capacity in Tashkent city and region and work with a full product range.",
    paras: [
      "INSOF TEMIR BETON LLC is a reliable company that has been producing reinforced concrete products and ready-mix concrete since 2000.",
      "Our modern concrete plants are located not only in Tashkent region but also in Tashkent city.",
      "We manufacture FBS blocks, PK and prestressed PB slabs, reinforced concrete structures and ready-mix concrete, and deliver promptly to Tashkent city, Tashkent, Syrdarya and Jizzakh regions.",
    ],
    facts: [
      ["FOUNDED", "2000", null],
      ["PLANTS", "4 plants", "2 concrete · 1 precast · 1 concrete and PB slabs"],
      ["READY-MIX CONCRETE", "M200 to M600", null],
      ["CORE PRINCIPLE", "100% honesty and exact volume", null],
      ["GUARANTEE", "State standards and own laboratory", null],
    ],
  },

  s3: {
    title: "INSOF IN NUMBERS",
    sub: "Capacity and scale",
    notes: "This slide holds the key figures for government and client audiences. Six indicators appear one by one; comment briefly on each.",
    years: (founded) => `years of experience — since ${founded}`,
    areaSuf: "+ ha",
    area: "industrial site area",
    ballSuf: " points",
    seismic: "seismic resistance rating",
    marks: "range of concrete grades",
    regSuf: " regions",
    regions: "Tashkent city, Tashkent region, Syrdarya, Jizzakh",
    hourSuf: " hours",
    hours: "to reach 75% of design strength",
  },

  s4: {
    title: "WHY INSOF",
    sub: "Four guarantees for government and large-scale projects",
    notes: "Four guarantees appear in sequence: safety, standards, deadlines, ecology — the four key criteria for a government client.",
    items: [
      { title: "Seismic safety", text: "Engineering solutions rated for 9+ points, designed for the Central Asian climate and active seismic zones." },
      { title: "GOST standards", text: "Full compliance with national and international quality standards and strict laboratory control." },
      { title: "On-time delivery", text: "Our own heavy-truck fleet delivers on schedule without halting the construction process." },
      { title: "Eco-friendly solution", text: "Water recycling system and steam-curing chambers that reduce CO2 emissions." },
    ],
  },

  s5: {
    title: "PRODUCTION BASE",
    sub: "Yangiyul production centre",
    notes: "Products are stored in order with dedicated cranes and loaded safely onto trucks.",
    imgAlt: "Finished goods yard and crane area",
    paras: [
      "Our main industrial, logistics and production base is located in a convenient industrial zone of Yangiyul district, Tashkent region.",
      "A large site and infrastructure built for road logistics allow us to receive, store and ship products quickly.",
    ],
    chips: [
      "Over 12 hectares of industrial land",
      "Automated raw material intake",
      "Climate-controlled indoor workshops",
      "Modern road logistics",
    ],
  },

  s6: {
    title: "PLANT AND CAPACITY",
    sub: "Our production capacity",
    notes: "The strongest number is 45,000 m³ of ready-mix concrete per month. For government audiences, compare it with the volume of a large project. 120 employees is a key argument for job creation.",
    intro: (founded) => `4 plants · 5 industrial sites · continuous production since ${founded}`,
    cells: [
      "m³/hour — ready-mix concrete capacity",
      "m³/day — ready-mix concrete",
      "m³/month — ready-mix concrete",
      "pcs/day — each type of precast product",
      "pcs/month — each type of precast product",
      "employees work at the plant",
    ],
  },

  s7: {
    title: "THE PLANT AT WORK",
    sub: "Production and logistics — live footage",
    notes: "All three clips play automatically, muted and on loop. Click a clip to pause or restart it.",
    clips: [
      { title: "Finished goods yard", meta: "Slabs · FBS · crane area" },
      { title: "Production line", meta: "Aggregates · moulding" },
      { title: "Ready-mix truck fleet", meta: "Batching plant · mixers" },
    ],
  },

  s8: {
    title: "READY-MIX CONCRETE",
    sub: "Which grade is used where",
    notes: "The plant line covers grades M100 to M600. The exact grade is chosen according to the project calculation.",
    marks: [
      ["M100", "Blinding layer, lean concrete"],
      ["M150", "Paths and paved areas"],
      ["M200", "Foundations and floor screeds"],
      ["M250", "Monolithic slabs, staircases"],
      ["M300", "Multi-storey building elements"],
      ["M350", "Columns, girders, load-bearing elements"],
      ["M400", "Precast products, support poles"],
      ["M450-M600", "Heavy-duty structures"],
    ],
    note: "The exact grade is chosen according to the project calculation — our laboratory will advise.",
    imgAlt: "INSOF concrete grades and a mixer truck",
  },

  s9: {
    title: "PRODUCT CATALOGUE",
    sub: "One plant — a complete product range",
    notes: "Eight photos appear in sequence. Product names and grades are shown on the images themselves.",
    items: [
      "Hollow-core floor slabs",
      "Power line poles",
      "Drainage channels",
      "Foundation blocks",
      "Road kerbs",
      "Manhole rings and covers",
      "Wall blocks",
      "Stair flights",
    ],
  },

  s10: {
    title: "TECHNICAL SPECIFICATIONS",
    sub: "Product classes and dimensions",
    notes: "TO BE FILLED: exact class, dimensions (mm) and weight for each item. Only documented values are shown for now.",
    head: ["Product", "Class / grade", "Dimensions", "Weight"],
    rows: [
      { name: "PK floor slabs", klass: "PK 59-12-8", olcham: null, ogirlik: null },
      { name: "PB prestressed slabs", klass: null, olcham: null, ogirlik: null },
      { name: "SV 110-3.5 pole", klass: "M400", olcham: "length 11,000 mm", ogirlik: "1,125 kg" },
      { name: "FBS foundation blocks", klass: "24-4-6 / 12-4-6 / 09-4-6", olcham: null, ogirlik: null },
      { name: "Channel", klass: "L-5", olcham: null, ogirlik: null },
      { name: "Kerb", klass: "30x18x30", olcham: null, ogirlik: null },
      { name: "Manhole ring", klass: "KS 1.5", olcham: "diameter 1.5 m", ogirlik: null },
      { name: "Manhole cover", klass: "1.5", olcham: "diameter 1.5 m", ogirlik: null },
      { name: "Stair flight", klass: "2 LM 57-12-17", olcham: null, ogirlik: null },
      { name: "Aerated block", klass: null, olcham: null, ogirlik: null },
    ],
    note: "A full technical passport and certificates are provided for every item.",
  },

  s11: {
    title: "TECHNICAL ANALYSIS — SV 110-3.5 POLE",
    sub: "Engineering parameters",
    notes: "Four parameters appear in sequence, the last is seismic resistance. Emphasise it for government audiences.",
    mSuf: " m",
    length: "length",
    kNmSuf: " kNm",
    moment: "design bending moment (3.5 t·m)",
    kgSuf: " kg",
    weight: "weight",
    ballSuf: " points",
    seismic: "seismic resistance rating",
    imgAlt: "SV 110-3.5 support poles",
    text: "Special slabs are cast from top-grade M450-M500 concrete with prestressed steel reinforcement. Poles are made from M400 heavy concrete.",
  },

  s12: {
    title: "AGGREGATES",
    sub: "Types of crushed stone and sand",
    notes: "The key question about aggregates is volume. Emphasise the “exact volume” principle here.",
    imgAlt: "Aggregate yard: crushed stone and sand",
    stone: {
      h: "Crushed stone and gravel",
      p: "Granulated stone fillers that increase concrete strength. They save cement and double resistance to load.",
    },
    sand: {
      h: "Fine and standard sand",
      p: "Clean sand free of clay, sieved through special vibrating screens. Essential for quality plaster and strong mortars.",
    },
    callout: "Heavy trucks deliver aggregates to the site on time and in full, with no shortfall in volume.",
  },

  s13: {
    title: "PRODUCTION PROCESS",
    sub: "A four-stage technological cycle",
    notes: "The stages slide in from left to right — describe the cycle in that order.",
    steps: [
      { n: "01", title: "Reinforcement", text: "Building a reinforced cage from high-strength cold-drawn steel wire." },
      { n: "02", title: "Mix preparation", text: "Computer-controlled dosing of sand, gravel, cement and special chemical admixtures." },
      { n: "03", title: "Moulding and compaction", text: "Complete removal of air bubbles from the mix on high-frequency vibrating tables." },
      { n: "04", title: "Heat treatment", text: "Reaching 75% of design strength within 18 hours in dedicated steam-curing chambers." },
    ],
  },

  s14: {
    title: "QUALITY CONTROL",
    sub: "A flawless control system",
    notes: "The strongest argument for a government client is our own accredited laboratory. Results are provided for every batch.",
    intro: "A dedicated state-accredited laboratory with the most modern testing equipment operates at the INSOF plant. Every batch of concrete is tested for compressive and flexural strength on a hydraulic press.",
    items: [
      { title: "Hydraulic press", text: "Destructive testing of concrete samples under the press." },
      { title: "Ultrasound", text: "Detecting voids in the inner layers of concrete." },
      { title: "F and W classes", text: "Measuring frost resistance (F) and water impermeability (W)." },
    ],
  },

  s15: {
    title: "LOGISTICS",
    sub: "Delivery geography",
    notes: "Four regions appear in sequence, followed by the row of logistics capabilities.",
    regions: ["Tashkent city", "Tashkent region", "Syrdarya region", "Jizzakh region"],
    items: [
      "Our own fleet of heavy trucks and dump trucks",
      "Products are loaded safely with dedicated cranes",
      "Delivery in the agreed volume and on time",
    ],
  },

  s16: {
    title: "OUR PARTNERS",
    sub: "Companies that have worked with us",
    notes: "Logos appear in sequence. Say one sentence about each: which project, what volume, which year. It is recommended to obtain partners' consent before using names and logos.",
    p1: "We work with major urban construction projects and specialised construction companies.",
    p2: "A full list of partners, completed volumes and references are available on request.",
  },

  s17: {
    title: "WHAT THE PARTNER GETS",
    sub: "Why partner with INSOF",
    notes: "This is the sales heart of the deck. Each block addresses one client pain point.",
    items: [
      { title: "Single-source supply", text: "Ready-mix concrete, precast products and aggregates — from one supplier." },
      { title: "Our own laboratory", text: "Every batch is tested to state standards — quality with proof." },
      { title: "Our own truck fleet", text: "Delivery does not depend on third parties — the schedule holds." },
      { title: "Exact volume, honest measurement", text: "Delivered without shortfall from the agreed volume — our core principle." },
      { title: "Shorter timelines", text: "Modern technology cuts project construction time by up to 35%." },
      { title: "26 years of experience", text: "A partner proven in major construction projects since 2000." },
    ],
  },

  s18: {
    title: "WHO IT IS FOR",
    sub: "A partner for government projects and large-scale construction",
    notes: "This slide is the deck's main ask. State clearly who we are ready to work with and on what terms.",
    items: [
      { title: "Government and municipal projects", text: "Reinforced concrete tested to state standards for social facilities, roads and engineering infrastructure." },
      { title: "Construction companies", text: "Uninterrupted volumes and scheduled delivery for residential and commercial complexes." },
      { title: "Industrial clients", text: "Orders for special structures, support poles and high-grade ready-mix concrete." },
      { title: "Laboratory guarantee", text: "Every product is tested to state standards — volume and quality are confirmed." },
    ],
  },

  s19: {
    title: "FOR BUSINESSES",
    sub: "Forms of cooperation",
    notes: "When talking to a business owner, ask which of the four forms suits them — the next slide shows the process.",
    items: [
      { title: "Long-term contract", text: "A schedule for the whole project duration and a stable volume." },
      { title: "One-off large order", text: "Calculation for a specific project and a single delivery." },
      { title: "Comprehensive supply", text: "Concrete, precast products and aggregates in one package." },
      { title: "Custom order", text: "Production to project-specified dimensions and grade." },
    ],
    note: "Volume, deadlines and payment terms are agreed separately for each project.",
  },

  s20: {
    title: "THE PROCESS",
    sub: "How cooperation begins",
    notes: "Five steps slide in one by one. At the end, say the phone number aloud — this slide turns the conversation into action.",
    steps: [
      { n: "01", title: "Enquiry", text: "You send details about the project, volume and deadlines." },
      { n: "02", title: "Technical calculation", text: "Engineers determine the grade and product list." },
      { n: "03", title: "Commercial offer", text: "An offer on volume, schedule and terms." },
      { n: "04", title: "Contract", text: "Once terms are agreed, the contract is signed." },
      { n: "05", title: "Delivery", text: "Scheduled delivery with quality documents." },
    ],
    cta: "The first step is an enquiry about your project:",
  },

  s21: {
    title: "GOVERNMENT SUPPORT",
    sub: "Three specific proposals to the regional administration and ministry",
    notes: "This slide is the specific request to the governor or ministry. Present all three proposals one by one, then read the result in the orange bar aloud: 50 new jobs is the most impactful figure.",
    cards: [
      {
        title: "State order and contract",
        text: [
          "Inclusion in social facility, road and engineering infrastructure projects as a local manufacturer. Our capacity is ",
          { b: "1,000-1,500 m³ per day" }, ", ", { b: "45,000 m³ per month" }, ".",
        ],
      },
      {
        title: "Investment or preferential loan",
        text: ["Financial support of ", { b: "25-35 billion UZS" }, " would allow us to install a new modern production line."],
      },
      {
        title: "Practical help for the aerated block plant",
        text: ["We ask for practical assistance in launching a new aerated concrete block plant — with documents, infrastructure and permits."],
      },
    ],
    resultLabel: "Result",
    results: [
      "2,000 m³ of concrete per day",
      "200 pcs of each precast product type",
      "50 new jobs (120 → 170 employees)",
    ],
  },

  s22: {
    title: "MISSION AND VISION",
    sub: "What we strive for",
    notes: "The mission appears first, then the vision; finally the 35% block pops up — pause here and emphasise the figure.",
    missionLabel: "Our mission",
    mission: "“To provide the strongest foundation for Uzbekistan's rapid urbanisation and infrastructure, using environmentally clean and energy-efficient engineering solutions.”",
    visionLabel: "Our vision",
    vision: "To become the largest digitalised and fully automated reinforced concrete manufacturer in Central Asia.",
    pctPrefix: "up to ",
    pct: "— potential reduction in project construction time.",
  },

  s23: {
    title: "THANK YOU FOR YOUR ATTENTION",
    sub: "Contacts",
    notes: "Finish by proposing a specific next step: a project calculation, a plant visit or a trial batch.",
    h: "Thank you for your attention!",
    p: "Let's start the calculation for your project today.",
    phone: "PHONE",
    email: "EMAIL",
    address: "ADDRESS",
    cta1: "Request a quote",
    cta2: "Product list",
    footer: "INSOF REINFORCED CONCRETE PRODUCTS — your reliable partner for quality construction",
  },
};

export const MATN: Record<Lang, DeckText> = { uz, ru, en };
