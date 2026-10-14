/** Saytdagi maqolalar (SEO): `/maqolalar/<slug>` va `/ru/stati/<slug>`. Yangi maqola — ro'yxatga obyekt (sitemap avtomatik).
 *  `{brand}` — korxona nomi, sahifada almashtiriladi. */
import type { L } from "./lang";
import type { ProductSlug } from "./products";

export type Block = { h2: string } | { p: string } | { ul: string[] };

export type Article = {
  slug: string;
  date: string;
  minutes: number;
  product: ProductSlug;
  title: L;
  description: L;
  body: L<Block[]>;
};

export const ARTICLES: Article[] = [
  {
    slug: "markirovka-plit-pk",
    date: "2026-10-14",
    minutes: 4,
    product: "plity-perekrytiya",
    title: {
      ru: "Маркировка плит перекрытия: что значит ПК 63-12-8",
      uz: "Yopma plita belgisi: PK 63-12-8 nimani bildiradi",
    },
    description: {
      ru: "Разбираем маркировку пустотных плит ПК: длина, ширина, нагрузка. Как подобрать плиту под пролёт и не переплатить.",
      uz: "PK kovak plitalari belgisini tahlil qilamiz: uzunlik, eni, yuklama. Oraliqqa plitani qanday tanlash va ortiqcha to'lamaslik.",
    },
    body: {
      ru: [
        { p: "Маркировка плиты перекрытия — это паспорт в трёх числах. Если научиться её читать, вы закажете ровно то, что нужно проекту, и не будете платить за лишние сантиметры и запас прочности." },
        { h2: "Буквы: тип плиты" },
        { p: "ПК — плита круглопустотная. Круглые пустоты внутри снижают вес плиты примерно на треть, при этом она хорошо работает на изгиб и дополнительно гасит звук и держит тепло." },
        { h2: "Первое число: длина" },
        { p: "63 — номинальная длина в дециметрах, то есть 6,3 м. Фактическая длина меньше на зазор под монтаж: 6280 мм. Плита должна опираться на стену минимум на 90–120 мм с каждой стороны, поэтому её длину берут на 20–25 см больше пролёта в свету." },
        { h2: "Второе число: ширина" },
        { p: "12 — ширина 1,2 м (фактически 1190 мм). Чаще всего встречаются плиты шириной 1,0, 1,2 и 1,5 м. Широкие плиты быстрее монтировать, узкие удобнее добирать по ширине помещения." },
        { h2: "Третье число: нагрузка" },
        { p: "8 — расчётная нагрузка 800 кгс/м² без учёта собственного веса. Для жилых домов это нагрузка с запасом: мебель, люди, стяжка и перегородки укладываются в неё с хорошим резервом." },
        { h2: "Как подобрать плиту" },
        { ul: [
          "Измерьте пролёт между несущими стенами в свету.",
          "Прибавьте 0,2–0,25 м на опирание — это нужная длина плиты.",
          "Разделите длину стены, вдоль которой кладут плиты, на ширину плиты — получите количество.",
          "Узкий остаток закрывают монолитным участком или плитой меньшей ширины.",
        ] },
        { p: "Посчитать количество можно в нашем онлайн-калькуляторе, а инженер {brand} проверит подбор по вашему плану бесплатно." },
      ],
      uz: [
        { p: "Yopma plita belgisi — uchta raqamdagi pasport. Uni o'qishni o'rgansangiz, loyihaga aynan kerakli plitani buyurtma qilasiz va ortiqcha santimetr va mustahkamlik zaxirasi uchun pul to'lamaysiz." },
        { h2: "Harflar: plita turi" },
        { p: "PK — dumaloq kovakli plita. Ichidagi dumaloq kovaklar plita og'irligini taxminan uchdan biriga kamaytiradi, u egilishga yaxshi ishlaydi, tovushni so'ndiradi va issiqlikni saqlaydi." },
        { h2: "Birinchi raqam: uzunlik" },
        { p: "63 — detsimetrdagi nominal uzunlik, ya'ni 6,3 m. Haqiqiy uzunlik montaj oralig'i hisobiga kamroq: 6280 mm. Plita devorga har tomondan kamida 90–120 mm tayanishi kerak, shuning uchun uzunligi oraliqdan 20–25 sm ko'proq olinadi." },
        { h2: "Ikkinchi raqam: eni" },
        { p: "12 — eni 1,2 m (aslida 1190 mm). Ko'pincha 1,0, 1,2 va 1,5 m enli plitalar uchraydi. Enlisini tez montaj qilinadi, torrog'i bilan xona enini to'ldirish qulay." },
        { h2: "Uchinchi raqam: yuklama" },
        { p: "8 — o'z og'irligidan tashqari 800 kgs/m² hisobiy yuklama. Turar-joy uchun bu zaxirali yuklama: mebel, odamlar, styajka va to'siqlar bemalol sig'adi." },
        { h2: "Plitani qanday tanlash kerak" },
        { ul: [
          "Ko'taruvchi devorlar orasidagi ichki oraliqni o'lchang.",
          "Tayanish uchun 0,2–0,25 m qo'shing — bu kerakli plita uzunligi.",
          "Plitalar teriladigan devor uzunligini plita eniga bo'ling — sonini olasiz.",
          "Tor qoldiq monolit qism yoki torroq plita bilan yopiladi.",
        ] },
        { p: "Sonini onlayn kalkulyatorimizda hisoblang, {brand} muhandisi esa rejangiz bo'yicha tanlovni bepul tekshiradi." },
      ],
    },
  },
  {
    slug: "kakoj-beton-dlya-fundamenta",
    date: "2026-10-14",
    minutes: 5,
    product: "beton",
    title: {
      ru: "Какой бетон нужен для фундамента: марки М200–М400",
      uz: "Poydevor uchun qanday beton kerak: M200–M400 markalari",
    },
    description: {
      ru: "Какую марку бетона выбрать для фундамента частного дома и многоэтажки. Чем отличаются М и B, и как проверить, что привезли нужную марку.",
      uz: "Xususiy uy va ko'p qavatli bino poydevori uchun qaysi beton markasini tanlash kerak. M va B farqi, kerakli marka kelganini qanday tekshirish.",
    },
    body: {
      ru: [
        { p: "Самая частая ошибка — экономить на марке бетона для фундамента. Переделать фундамент нельзя, поэтому разберёмся, что заказывать." },
        { h2: "Марка М и класс B" },
        { p: "Марка М показывает среднюю прочность на сжатие в кгс/см², класс B — гарантированную прочность в МПа. В проектах обычно пишут класс: B15 ≈ М200, B20 ≈ М250, B22,5 ≈ М300, B25 ≈ М350, B30 ≈ М400." },
        { h2: "Что выбрать" },
        { ul: [
          "Частный дом в 1–2 этажа на нормальном грунте — М250–М300.",
          "Дом из кирпича или блоков в 2–3 этажа, подвал — М300–М350.",
          "Многоэтажный каркас, плитный фундамент — по проекту, чаще М350–М400.",
          "Подбетонка, отмостка, стяжка — М150–М200.",
        ] },
        { h2: "Сколько бетона заказывать" },
        { p: "Объём ленточного фундамента = длина всех лент × ширина × высота. Добавьте 3–5% на неровности опалубки и потери. Для плиты — длина × ширина × толщина." },
        { h2: "Как проверить, что привезли" },
        { p: "На каждой накладной {brand} есть QR-код. Отсканируйте его — увидите марку, объём, номер миксера и время отгрузки." },
      ],
      uz: [
        { p: "Eng ko'p uchraydigan xato — poydevor uchun beton markasini tejash. Poydevorni qayta qilib bo'lmaydi, shuning uchun nimani buyurtma qilishni ko'rib chiqamiz." },
        { h2: "M markasi va B sinfi" },
        { p: "M markasi kgs/sm² dagi o'rtacha siqilish mustahkamligini, B sinfi esa MPa dagi kafolatlangan mustahkamlikni ko'rsatadi. Loyihalarda odatda sinf yoziladi: B15 ≈ M200, B20 ≈ M250, B22,5 ≈ M300, B25 ≈ M350, B30 ≈ M400." },
        { h2: "Nimani tanlash kerak" },
        { ul: [
          "Oddiy gruntdagi 1–2 qavatli xususiy uy — M250–M300.",
          "G'isht yoki blokdan 2–3 qavatli uy, yerto'la — M300–M350.",
          "Ko'p qavatli karkas, plitali poydevor — loyiha bo'yicha, ko'pincha M350–M400.",
          "Tayyorlov qatlami, otmostka, styajka — M150–M200.",
        ] },
        { h2: "Qancha beton buyurtma qilish kerak" },
        { p: "Lentali poydevor hajmi = barcha lentalar uzunligi × eni × balandligi. Qolip notekisligi va yo'qotishlar uchun 3–5% qo'shing. Plita uchun — uzunlik × eni × qalinlik." },
        { h2: "Kelganini qanday tekshirish" },
        { p: "{brand}ning har bir nakladnoyida QR-kod bor. Skanerlang — marka, hajm, mikser raqami va yuklash vaqtini ko'rasiz." },
      ],
    },
  },
  {
    slug: "skolko-blokov-fbs-na-fundament",
    date: "2026-10-14",
    minutes: 4,
    product: "fbs-bloki",
    title: {
      ru: "Сколько блоков ФБС нужно на фундамент: расчёт на примере",
      uz: "Poydevorga nechta FBS blok kerak: misolda hisob",
    },
    description: {
      ru: "Пошаговый расчёт блоков ФБС для ленточного фундамента дома 10×12 м: ряды, длина, добор блоками ФБС 12, вес и количество машин.",
      uz: "10×12 m uy lentali poydevori uchun FBS bloklarni bosqichma-bosqich hisoblash: qatorlar, uzunlik, FBS 12 bilan to'ldirish, og'irlik va mashinalar soni.",
    },
    body: {
      ru: [
        { p: "Возьмём дом 10×12 м с одной внутренней несущей стеной 10 м. Высота фундамента — 1,8 м, ширина блока — 500 мм." },
        { h2: "1. Длина всех стен" },
        { p: "Периметр: (10 + 12) × 2 = 44 м. Плюс внутренняя стена 10 м. Итого 54 м ленты." },
        { h2: "2. Количество рядов" },
        { p: "Высота блока 580 мм плюс шов 20 мм — 0,6 м на ряд. 1,8 / 0,6 = 3 ряда." },
        { h2: "3. Блоки в одном ряду" },
        { p: "54 / 2,4 = 22 целых блока ФБС 24 (52,8 м). Остаток 1,2 м закрываем одним блоком ФБС 12. В ряду: 22 + 1." },
        { h2: "4. Итог" },
        { ul: [
          "ФБС 24.5.6 — 66 шт (по 1,63 т)",
          "ФБС 12.5.6 — 3 шт (по 0,79 т)",
          "Общий вес — около 110 т, это 6 рейсов длинномера по 20 т",
        ] },
        { p: "На углах и пересечениях блоки укладывают с перевязкой, поэтому точную схему раскладки лучше доверить инженеру. Наш калькулятор считает количество за минуту, а менеджер {brand} назовёт цену с доставкой." },
      ],
      uz: [
        { p: "Bitta 10 m ichki ko'taruvchi devori bor 10×12 m uyni olamiz. Poydevor balandligi — 1,8 m, blok eni — 500 mm." },
        { h2: "1. Barcha devorlar uzunligi" },
        { p: "Perimetr: (10 + 12) × 2 = 44 m. Yana ichki devor 10 m. Jami 54 m lenta." },
        { h2: "2. Qatorlar soni" },
        { p: "Blok balandligi 580 mm va 20 mm chok — bir qatorga 0,6 m. 1,8 / 0,6 = 3 qator." },
        { h2: "3. Bir qatordagi bloklar" },
        { p: "54 / 2,4 = 22 ta butun FBS 24 (52,8 m). Qolgan 1,2 m bitta FBS 12 bilan yopiladi. Qatorda: 22 + 1." },
        { h2: "4. Natija" },
        { ul: [
          "FBS 24.5.6 — 66 dona (har biri 1,63 t)",
          "FBS 12.5.6 — 3 dona (har biri 0,79 t)",
          "Umumiy og'irlik — taxminan 110 t, bu 20 tonnalik uzun yuk mashinasining 6 reysi",
        ] },
        { p: "Burchak va kesishmalarda bloklar bog'lab teriladi, shuning uchun terish sxemasini muhandisga ishonib topshirgan ma'qul. Kalkulyatorimiz sonini bir daqiqada hisoblaydi, {brand} menejeri esa yetkazish bilan narxini aytadi." },
      ],
    },
  },
];

export function getArticle(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
