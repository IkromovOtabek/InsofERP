/**
 * Zavod bo'ylab 3D tur — matnlar va mavzular. Dizayn paketidan so'zma-so'z (README: "Use it verbatim").
 * `STN` — 7 bekat (`insof-world.js` dagi STATIONS bilan bir tartibda), `PROMISES` — «Hamkorlik» bo'limi.
 */

export type Station = {
  short: string; label: string; title: string; text: string; processTitle: string;
  steps: [string, string][]; quote?: string; author?: string;
};
export type ThemeName = "Insof" | "Olov" | "Signal" | "Qahrabo" | "Zumrad";
export type Mode = "light" | "dark";

export const STN: Station[] = [
  { short: "Umumiy ko'rinish", label: 'Insof sanoat majmuasi', title: "Beton va metall bo'yicha ishonchli hamkoringiz.", text: "Insof tayyor beton, temir-beton buyumlari va metall konstruksiyalarni bir hududda ishlab chiqaradi. Loyihangiz uchun bitta yetkazib beruvchi, bitta shartnoma va yagona sifat standarti.", processTitle: 'BUYURTMADAN OBYEKTGACHA',
    steps: [['Ofis', "Buyurtma qabul qilinadi, muhandislar texnik yechimni tasdiqlaydi."], ['Ishlab chiqarish', "Beton, temir-beton va metall bitta hududda, yagona jadval asosida tayyorlanadi."], ['Logistika', "Yuk tekshiriladi, hujjatlashtiriladi va jo'natiladi."], ['Mijoz obyekti', "Mahsulot o'z vaqtida obyektga yetib boradi va o'rnatiladi."]] },
  { short: 'Ofis va laboratoriya', label: 'Uch qavatli bosh ofis', title: 'Har bir buyurtma ofisdan boshlanadi.', text: "Savdo, muhandislik, laboratoriya va rahbariyat uch qavatli bitta binoda ishlaydi. Shuning uchun so'rovingizga tez va aniq javob beramiz.", processTitle: 'KIRISHDAN QAVATLARGACHA',
    steps: [['Kirish va avtoturargoh', "Xodimlar va mijozlar ko'chadan shlagbaum orqali kiradi, qo'riqchi har bir avtomobilni kutib oladi. Xodimlar avtomobillari ofis oldidagi avtoturargohda turadi."], ['1-qavat · Qabulxona', "Mijozlar kutib olinadi va buyurtmalar qabul qilinadi. Shu qavatdagi laboratoriyada beton namunalari pressda sinaladi."], ['2-qavat · Muhandislar', "Muhandislar chizmalarni ko'rib chiqadi va har bir buyurtma uchun texnik yechim tayyorlaydi."], ['3-qavat · Rahbariyat', "Majlis xonasi va direktor kabinetida narx, muddat va yetkazib berish shartlari kelishiladi."], ['Butun ofis', "Uch qavatdagi yagona jamoa buyurtmangizni birinchi so'rovdan yetkazib berishgacha kuzatib boradi."]] },
  { short: 'Beton zavodi', label: 'Beton zavodi', title: 'Har bir partiyada talabga mos beton.', text: "Avtomatik dozalash va laboratoriya nazorati har bir yetkazib berishni bir xil sifatda ushlab turadi.", processTitle: 'ISHLAB CHIQARISH JARAYONI',
    steps: [['Inert materiallar', "Qum va shag'al fraksiyalar bo'yicha saqlanadi va konveyer orqali minoraga uzatiladi."], ['Dozalash', "Sement, suv va qo'shimchalar har bir qorishma uchun avtomatik tortiladi."], ['Aralashtirish', "Qorishma belgilangan markada aralashtiriladi va mikserga quyiladi."], ['Yetkazib berish', "Mikser barabani obyektingizgacha to'xtovsiz aylanib boradi."]] },
  { short: 'Metall sexi', label: 'Metall sexi', title: 'Chizmalaringizga aniq mos metall konstruksiyalar.', text: "Kesish, payvandlash va bo'yash bitta sexda bajariladi. Bu muddatlarni qisqartiradi va nazoratni osonlashtiradi.", processTitle: 'ISHLAB CHIQARISH JARAYONI',
    steps: [['Metall qabul qilish', "Sertifikatlangan prokat tekshiriladi va ko'prik kran bilan liniyaga uzatiladi."], ['CNC kesish', "Profillar chizma bo'yicha o'lchamga kesiladi va teshiladi."], ["Payvandlash va yig'ish", "Malakali payvandchilar va robotlar rama hamda fermalarni yig'adi."], ["Bo'yash", "Gruntlash metallni jo'natishdan oldin korroziyadan himoya qiladi."]] },
  { short: 'Temir-beton', label: 'Temir-beton buyumlari sexi', title: "O'rnatishga tayyor temir-beton buyumlari.", text: "Zavod sharoitida quyish va qotirish aniq o'lchamlarni ta'minlaydi va qurilishni tezlashtiradi.", processTitle: 'ISHLAB CHIQARISH JARAYONI',
    steps: [['Armaturalash', "Armatura karkaslari po'lat qoliplarga joylashtiriladi."], ['Quyish', "Beton qolipga quyiladi va vibratsiya bilan zichlanadi."], ["Bug'da qotirish", "Nazoratli bug'lash buyumlarga tez mustahkamlik beradi."], ['Omborga joylash', "Tayyor buyumlar markalanadi, tekshiriladi va taxlanadi."]] },
  { short: 'Logistika', label: 'Logistika va eksport', title: "O'z vaqtida, eksport hujjatlari bilan.", text: "Tekshiruv, hujjatlar va transportni o'zimiz tashkil qilamiz, yuk chegaradan kechikishsiz o'tadi.", processTitle: "JO'NATISH JARAYONI",
    steps: [['Yakuniy tekshiruv', "Har bir yuk buyurtma va texnik talablar bilan solishtiriladi."], ['Hujjatlar', "Sertifikatlar, qadoqlash varaqalari va bojxona hujjatlari tayyorlanadi."], ['Yuklash', "Mahsulot yuk mashinasi, platforma yoki konteynerga mahkamlanadi."], ["Jo'natish", "Avtomobil va temir yo'l orqali hamkorlarga yo'lga chiqadi."]] },
  { short: 'Mijoz obyekti', label: 'Mijoz qurilish maydoni', title: "Mahsulotimiz mijoz obyektida ishlamoqda.", text: "Yetkazib berish obyektda tugamaydi: montaj jadvaliga moslashamiz va qurilish oxirigacha aloqada bo'lamiz.", processTitle: 'OBYEKTDA',
    quote: "Panellar jadval bo'yicha keldi, montaj bir kun ham to'xtamadi. Keyingi bosqichni ham Insof bilan qilamiz.", author: "BOSH MUHANDIS · TURAR JOY MAJMUASI (NAMUNA)",
    steps: [['Yetkazib berish', "Yuk montaj jadvaliga mos vaqtda obyektga yetib keladi."], ['Montaj', "Panellar to'g'ridan-to'g'ri mashinadan kran bilan o'rnatiladi."], ['Beton quyish', "Tayyor beton nasos orqali qavatlarga uzatiladi."], ['Qabul qilish', "Haydovchi yuk hujjatlarini topshiradi, mijoz buyurtmani qabul qilib, mamnunligini bildiradi."]] },
];

export const PROMISES: [string, string][] = [
  ['Beton va metall bitta yetkazib beruvchidan', "Tayyor beton, temir-beton va metall konstruksiyalar bitta shartnoma, bitta jadval va bitta mas'uliyat asosida."],
  ["Tekshirsa bo'ladigan sifat", "Har bir partiya laboratoriyada sinovdan o'tadi va har bir yuk sertifikat bilan yuboriladi."],
  ["Sizning standartlaringiz bo'yicha", "Texnik talablar va chizmalaringiz asosida ishlab chiqaramiz, tafsilotlarni oldindan kelishamiz."],
  ['Aniq muddatlar', "Ishlab chiqarish qurilish jadvalingizga moslab rejalashtiriladi, doimiy hamkorlar uchun quvvat zaxiralanadi."],
  ['Eksportni biz hal qilamiz', "Bojxona hujjatlari, qadoqlash va transportni logistika bo'limimiz tashkil qiladi."],
  ['Shaxsiy menejer', "Bitta menejer buyurtmangizni birinchi so'rovdan yakuniy yetkazib berishgacha kuzatib boradi."],
];


export const THEMES: Record<ThemeName, { acc: string; ink: string; light: string }> = {
  Insof: { acc: '#2a4aa7', ink: '#ffffff', light: '#8fa8ff' },
  Olov: { acc: '#e8622a', ink: '#ffffff', light: '#ff9a6b' },
  Signal: { acc: '#d23a2e', ink: '#ffffff', light: '#ff8277' },
  Qahrabo: { acc: '#e0a100', ink: '#16181a', light: '#ffc940' },
  Zumrad: { acc: '#178a6e', ink: '#ffffff', light: '#4fd1ad' },
};
export const MODES: Record<Mode, Record<string, string>> = {
  light: { bg: '#eceee9', surface: '#ffffff', surface2: '#f2f3ef', ink: '#16181a', muted: '#50555a', line: '#d9dbd5', glass: 'rgba(255,255,255,.86)', shadow: 'rgba(20,24,28,.12)', halo: '0 0 2px rgba(255,255,255,.55)' },
  dark: { bg: '#0e1114', surface: '#171b1f', surface2: '#21262b', ink: '#eef0ec', muted: '#a2a8ad', line: '#2c3237', glass: 'rgba(23,27,31,.86)', shadow: 'rgba(0,0,0,.45)', halo: '0 0 2px rgba(0,0,0,.6)' },
};