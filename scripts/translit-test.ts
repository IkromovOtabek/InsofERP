/**
 * Lotin → kirill transliteratsiya testlari.
 * Ishga tushirish: npx tsx scripts/translit-test.ts
 */
import { toCyrillic } from "../src/lib/translit";

const CASES: [string, string][] = [
  ["O'zbekiston", "Ўзбекистон"],
  ["Oʻzbekiston", "Ўзбекистон"],
  ["O‘zbekiston", "Ўзбекистон"],
  ["O`zbekiston", "Ўзбекистон"],
  ["Sho'rva", "Шўрва"],
  ["yetkazuvchi", "етказувчи"],
  ["Yetkazuvchi", "Етказувчи"],
  ["Ekskavator", "Экскаватор"],
  ["ma'lumot", "маълумот"],
  ["Qabul qilish", "Қабул қилиш"],
  ["Yangi", "Янги"],
  ["shahar", "шаҳар"],
  ["G'alaba", "Ғалаба"],
  ["Toshkent", "Тошкент"],
  ["Sherali", "Шерали"],
  ["elektr", "электр"],
  ["yo'l", "йўл"],
  ["Yangiyo'l", "Янгийўл"],
  ["tayyor", "тайёр"],
  ["dunyo", "дунё"],
  ["Yuk", "Юк"],
  ["SHAHAR", "ШАҲАР"],
  ["TOSHKENT", "ТОШКЕНТ"],
  ["Chiqim", "Чиқим"],
  ["tog'", "тоғ"],
  ["Is'hoq", "Исҳоқ"],
  ["mas'ul", "масъул"],
  ["aeroport", "аэропорт"],
  ["obyekt", "объект"],
  ["Stansiya", "Стансия"],
  ["konstruktsiya", "конструкция"],
  ["1 200 000 so'm", "1 200 000 сўм"],
  ["50 kg", "50 кг"],
  ["12 m³", "12 м³"],
  ["2026-yil 5-sentyabr", "2026-йил 5-сентябрь"],
  ["Sentyabr", "Сентябрь"],
  ["30-sentabr, dushanba", "30-сентябрь, душанба"],
  ["\"Qurilish\" MChJ", "\"Қурилиш\" МЧЖ"],
  ["Zayavka Z-2026-00153 tasdiqlandi", "Заявка Z-2026-00153 тасдиқланди"],
  // Hisoblararo o'tkazma hujjat raqami lotincha qoladi
  ["O'tkazma OT-2026-00001 saqlandi", "Ўтказма OT-2026-00001 сақланди"],
  ["OT-2026-00001", "OT-2026-00001"],
  ["Beton B25 M300", "Бетон B25 M300"],
  ["Mashina 01A123BC", "Машина 01A123BC"],
  ["Mashina 01 A 123 BC keldi", "Машина 01 A 123 BC келди"],
  ["Email: info@insof.uz", "Эмаил: info@insof.uz"],
  ["Sayt https://insof.uz/login", "Сайт https://insof.uz/login"],
  ["Login: test.direktor", "Логин: test.direktor"],
  ["QR kod va PDF", "QR код ва PDF"],
  ["QR-nakladnoy", "QR-накладной"],
  ["INN", "ИНН"],
  ["'Yangi' holat", "'Янги' ҳолат"],
  ["Xodimlar (jami)", "Ходимлар (жами)"],
  ["Ishlab chiqarish", "Ишлаб чиқариш"],
  ["Ro'yxatdan o'tish", "Рўйхатдан ўтиш"],
  ["Qo'shimcha ma'lumot", "Қўшимча маълумот"],
  ["Mening reyslarim", "Менинг рейсларим"],
  ["Yo'q", "Йўқ"],
  ["Ёзув уже кирилл", "Ёзув уже кирилл"],
  // Qisqartma faqat katta harfda lotinda qoladi; kichik harfli o'zbekcha so'z o'giriladi
  ["Bu it emas", "Бу ит эмас"],
  ["ip va arqon", "ип ва арқон"],
  ["IT bo'limi, IP manzil", "IT бўлими, IP манзил"],
  ["ML tahlil", "ML таҳлил"],
  // Brend nomlari — registrdan qat'i nazar, chiziqcha bilan ham
  ["Excel-fayl yuklash", "Excel-файл юклаш"],
  ["Excel fayl", "Excel файл"],
  ["E-commerce", "E-commerce"],
  ["Click orqali", "Click орқали"],
  ["Finance (eski bo'lim)", "Finance (эски бўлим)"],
  // Rol kodlari (katta harfda) — texnik nom
  ["Sotuvchi (SALES)", "Сотувчи (SALES)"],
  ["DIRECTOR", "DIRECTOR"],
  ["Insof ECO ilovasi", "Инсоф ECO иловаси"],
  // Raqamdan keyingi qo'shimcha
  ["tushumning 80%ini beradi", "тушумнинг 80%ини беради"],
  ["5ta mashina", "5та машина"],
  ["10%dan ko'p", "10%дан кўп"],
  ["B25 va 2GIS", "B25 ва 2GIS"],
  ["267/dona, 0/kun", "267/дона, 0/кун"],
  // "ц" bilan yoziladigan o'zlashma o'zaklar
  ["Retseptlar", "Рецептлар"],
  ["Sement M400", "Цемент M400"],
  ["sementning narxi", "цементнинг нархи"],
  ["3-sexda", "3-цехда"],
  ["Sexlar", "Цехлар"],
  ["seksiya va aksiya", "секция ва акция"],
  ["Produksiya", "Продукция"],
  ["SEMENT", "ЦЕМЕНТ"],
  ["ketsa aytsa", "кетса айтса"],
  // Marketing qisqartmalari va brendlar
  ["Google Ads kuchli — ROAS 25,62x", "Google Ads кучли — ROAS 25,62х"],
  ["VIP mijozlar, ABC tahlil", "VIP мижозлар, ABC таҳлил"],
  // Bosh harflar nuqta bilan — o'giriladi, login/domen — yo'q
  ["Nomi / F.I.O.", "Номи / Ф.И.О."],
  ["A.Karimov va h.k.", "А.Каримов ва ҳ.к."],
  ["Sayt insof.uz", "Сайт insof.uz"],
  ["", ""],
];

let fail = 0;
for (const [src, want] of CASES) {
  const got = toCyrillic(src);
  if (got !== want) {
    fail++;
    console.log(`✗ ${JSON.stringify(src)} → ${JSON.stringify(got)} (kutilgan ${JSON.stringify(want)})`);
  }
}
console.log(`${CASES.length - fail}/${CASES.length} o'tdi`);
if (fail) process.exit(1);
