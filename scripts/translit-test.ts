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
