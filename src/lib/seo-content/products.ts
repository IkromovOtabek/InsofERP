/**
 * Saytdagi mahsulot sahifalari (SEO): `/mahsulot/<slug>` (uz) va `/ru/produkciya/<slug>` (ru).
 * Texnik qiymatlar — GOST bo'yicha ma'lumotnoma; korxonaga xos da'vo (marka, seysmiklik, muddat) yozilmaydi —
 * mavjud o'lcham va narxni menejer aytadi. `{brand}` — korxona nomi (CompanySettings.name), sahifada almashtiriladi.
 */
import type { L } from "./lang";

export type ProductSlug = "plity-perekrytiya" | "fbs-bloki" | "beton" | "zhbi" | "inertnye";

export type Product = {
  slug: ProductSlug;
  code: string;
  image: string;
  name: L;
  short: L;
  title: L;
  description: L;
  h1: L;
  intro: L;
  facts: { value: string; label: L }[];
  table?: { caption: L; head: L<string[]>; rows: (string | L)[][] };
  uses: L<string[]>;
  faq: { q: L; a: L }[];
};

export const PRODUCTS: Product[] = [
  {
    slug: "plity-perekrytiya",
    code: "ПК",
    image: "/media/maydon.jpg",
    name: { ru: "Плиты перекрытия ПК", uz: "PK yopma plitalari" },
    short: {
      ru: "Пустотные плиты перекрытия ПК по ГОСТ 9561 — под пролёт вашего дома или здания.",
      uz: "GOST 9561 bo'yicha PK kovak yopma plitalari — uyingiz yoki binongiz oralig'iga.",
    },
    title: {
      ru: "Плиты перекрытия ПК — цена от завода | {brand}",
      uz: "PK yopma plitalari — zavod narxida | {brand}",
    },
    description: {
      ru: "Пустотные плиты перекрытия ПК от завода {brand}: ГОСТ 9561, маркировка по длине, ширине и нагрузке, контроль партии. Доставка длинномерами с разгрузкой.",
      uz: "{brand} zavodidan PK kovak yopma plitalari: GOST 9561, uzunlik, eni va yuklama bo'yicha belgi, partiya nazorati. Uzun yuk mashinalarida yetkazish.",
    },
    h1: { ru: "Плиты перекрытия ПК", uz: "PK yopma plitalari" },
    intro: {
      ru: "Пустотные плиты перекрытия для жилых домов, каркасных зданий и складов. Подберём длину и ширину под ваш план и привезём длинномером в согласованное время. Наличие размеров и цену уточняйте у менеджера.",
      uz: "Turar-joy, karkas bino va omborlar uchun kovak yopma plitalar. Uzunlik va enini rejangizga qarab tanlaymiz, kelishilgan vaqtda uzun yuk mashinasida olib boramiz. O'lcham mavjudligi va narxini menejerdan so'rang.",
    },
    facts: [
      { value: "ГОСТ 9561", label: { ru: "пустотные плиты", uz: "kovak plitalar" } },
      { value: "1,0–1,5 м", label: { ru: "ширина плиты", uz: "plita eni" } },
      { value: "800", label: { ru: "кгс/м² нагрузка (…-8)", uz: "kgs/m² yuklama (…-8)" } },
      { value: "QR", label: { ru: "накладная на рейс", uz: "reysga nakladnoy" } },
    ],
    table: {
      caption: { ru: "Как читать маркировку плиты", uz: "Plita belgisini qanday o'qish kerak" },
      head: {
        ru: ["Маркировка", "Длина", "Ширина", "Нагрузка"],
        uz: ["Belgi", "Uzunligi", "Eni", "Yuklama"],
      },
      rows: [
        ["ПК 63-12-8", "6,28 м", "1,19 м", "800 кгс/м²"],
        ["ПК 60-15-8", "5,98 м", "1,49 м", "800 кгс/м²"],
        ["ПК 48-12-8", "4,78 м", "1,19 м", "800 кгс/м²"],
        ["ПК 72-12-8", "7,18 м", "1,19 м", "800 кгс/м²"],
      ],
    },
    uses: {
      ru: ["Жилые дома и коттеджи", "Многоэтажные каркасные здания", "Склады и производственные цеха", "Перекрытия подвалов и гаражей"],
      uz: ["Turar-joy uylari va kottejlar", "Ko'p qavatli karkas binolar", "Omborlar va ishlab chiqarish sexlari", "Yerto'la va garaj yopmalari"],
    },
    faq: [
      {
        q: { ru: "Что значит ПК 63-12-8?", uz: "PK 63-12-8 nimani bildiradi?" },
        a: {
          ru: "ПК — плита круглопустотная. 63 — длина 6,3 м (фактически 6280 мм), 12 — ширина 1,2 м (1190 мм), 8 — допустимая нагрузка 800 кгс/м² без учёта собственного веса.",
          uz: "PK — dumaloq kovakli plita. 63 — uzunligi 6,3 m (aslida 6280 mm), 12 — eni 1,2 m (1190 mm), 8 — o'z og'irligidan tashqari 800 kgs/m² ruxsat etilgan yuklama.",
        },
      },
      {
        q: { ru: "Сколько плита должна опираться на стену?", uz: "Plita devorga qancha tayanishi kerak?" },
        a: {
          ru: "Обычно не меньше 90–120 мм с каждой стороны на кирпич или бетон. Поэтому длину плиты берут на 20–25 см больше пролёта. Точный подбор сделает наш инженер по вашему плану.",
          uz: "Odatda g'isht yoki betonga har tomondan kamida 90–120 mm. Shuning uchun plita uzunligi oraliqdan 20–25 sm uzunroq olinadi. Aniq tanlovni muhandisimiz rejangiz bo'yicha qiladi.",
        },
      },
      {
        q: { ru: "Когда привезёте плиты?", uz: "Plitalarni qachon olib kelasizlar?" },
        a: {
          ru: "Время доставки согласуем заранее — под график вашего крана и бригады. Уточните у менеджера.",
          uz: "Yetkazish vaqti oldindan kelishiladi — kraningiz va brigadangiz grafigiga qarab. Menejerdan aniqlang.",
        },
      },
    ],
  },
  {
    slug: "fbs-bloki",
    code: "ФБС",
    image: "/media/zavod.jpg",
    name: { ru: "Блоки ФБС", uz: "FBS bloklari" },
    short: {
      ru: "Фундаментные блоки по ГОСТ 13579 — 24, 12 и 9 длины, ширина 400–600 мм.",
      uz: "GOST 13579 bo'yicha poydevor bloklari — 24, 12 va 9 uzunlik, eni 400–600 mm.",
    },
    title: {
      ru: "Блоки ФБС — купить от производителя | {brand}",
      uz: "FBS bloklari — ishlab chiqaruvchidan | {brand}",
    },
    description: {
      ru: "Фундаментные блоки ФБС 24, 12, 9 от завода {brand} по ГОСТ 13579. Размеры и вес, расчёт количества блоков онлайн, доставка с разгрузкой.",
      uz: "{brand} zavodidan GOST 13579 bo'yicha FBS 24, 12, 9 poydevor bloklari. O'lcham va og'irlik, bloklar sonini onlayn hisoblash, yetkazib berish.",
    },
    h1: { ru: "Фундаментные блоки ФБС", uz: "FBS poydevor bloklari" },
    intro: {
      ru: "Сплошные фундаментные блоки для ленточных фундаментов, подвалов и подпорных стен. Делаем по ГОСТ 13579 из тяжёлого бетона.",
      uz: "Lentali poydevor, yerto'la va tirgak devorlar uchun yaxlit poydevor bloklari. GOST 13579 bo'yicha og'ir betondan tayyorlaymiz.",
    },
    facts: [
      { value: "ГОСТ", label: { ru: "13579 — по стандарту", uz: "13579 — standart bo'yicha" } },
      { value: "580", label: { ru: "мм высота блока", uz: "mm blok balandligi" } },
      { value: "3", label: { ru: "длины: 2,4 / 1,2 / 0,9 м", uz: "uzunlik: 2,4 / 1,2 / 0,9 m" } },
      { value: "QR", label: { ru: "накладная на рейс", uz: "reysga nakladnoy" } },
    ],
    table: {
      caption: { ru: "Размеры и вес блоков ФБС (ГОСТ 13579)", uz: "FBS bloklari o'lchami va og'irligi (GOST 13579)" },
      head: {
        ru: ["Блок", "Д×Ш×В, мм", "Объём, м³", "Вес, т"],
        uz: ["Blok", "U×E×B, mm", "Hajm, m³", "Og'irlik, t"],
      },
      rows: [
        ["ФБС 24.4.6", "2380×400×580", "0,543", "1,30"],
        ["ФБС 24.5.6", "2380×500×580", "0,679", "1,63"],
        ["ФБС 24.6.6", "2380×600×580", "0,815", "1,96"],
        ["ФБС 12.4.6", "1180×400×580", "0,265", "0,64"],
        ["ФБС 12.5.6", "1180×500×580", "0,331", "0,79"],
        ["ФБС 12.6.6", "1180×600×580", "0,398", "0,96"],
        ["ФБС 9.4.6", "880×400×580", "0,195", "0,47"],
      ],
    },
    uses: {
      ru: ["Ленточные фундаменты домов", "Стены подвалов и цокольных этажей", "Подпорные стены и ограждения", "Быстровозводимые склады"],
      uz: ["Uylarning lentali poydevori", "Yerto'la va sokol devorlari", "Tirgak devorlar va to'siqlar", "Tez quriladigan omborlar"],
    },
    faq: [
      {
        q: { ru: "Сколько блоков ФБС нужно на фундамент?", uz: "Poydevorga nechta FBS blok kerak?" },
        a: {
          ru: "Длина всех стен фундамента делится на длину блока, умножается на число рядов (высота / 0,6 м). Остаток добирают блоками 12 и 9. Посчитайте в нашем калькуляторе — это займёт минуту.",
          uz: "Poydevor devorlari umumiy uzunligi blok uzunligiga bo'linadi va qatorlar soniga (balandlik / 0,6 m) ko'paytiriladi. Qoldiq 12 va 9 bloklar bilan to'ldiriladi. Kalkulyatorimizda bir daqiqada hisoblang.",
        },
      },
      {
        q: { ru: "Какую ширину блока выбрать?", uz: "Blokning qaysi enini tanlash kerak?" },
        a: {
          ru: "Ширину блока берут не меньше толщины стены над ним. Для дома в 1–2 этажа обычно 400–500 мм, для тяжёлых стен и подвалов — 600 мм.",
          uz: "Blok eni ustidagi devor qalinligidan kam bo'lmasligi kerak. 1–2 qavatli uy uchun odatda 400–500 mm, og'ir devor va yerto'la uchun — 600 mm.",
        },
      },
    ],
  },
  {
    slug: "beton",
    code: "М",
    image: "/media/hero.jpg",
    name: { ru: "Товарный бетон", uz: "Tovar beton" },
    short: {
      ru: "Бетон разных марок с доставкой миксерами. QR-накладная на каждый рейс.",
      uz: "Turli markadagi beton, mikserlarda yetkazish. Har reysga QR-nakladnoy.",
    },
    title: {
      ru: "Товарный бетон с доставкой миксером | {brand}",
      uz: "Tovar beton mikserda yetkazib berish | {brand}",
    },
    description: {
      ru: "Товарный бетон от завода {brand}: компьютерная дозировка, утверждённый рецепт, доставка миксерами. QR-накладная на каждый рейс — объём и марка проверяются с телефона.",
      uz: "{brand} zavodidan tovar beton: kompyuterli dozalash, tasdiqlangan retsept, mikserlarda yetkazish. Har reysga QR-nakladnoy — hajm va markani telefonda tekshirasiz.",
    },
    h1: { ru: "Товарный бетон", uz: "Tovar beton" },
    intro: {
      ru: "Бетон готовим на автоматическом узле: песок, щебень, цемент и добавки дозируются компьютером. Каждый рейс — с QR-накладной: отсканируйте код и проверьте объём, марку и время отгрузки.",
      uz: "Betonni avtomatik tugunda tayyorlaymiz: qum, shag'al, sement va qo'shimchalar kompyuter bilan o'lchanadi. Har reys QR-nakladnoy bilan: kodni skanerlang va hajm, marka va yuklash vaqtini tekshiring.",
    },
    facts: [
      { value: "М · B", label: { ru: "марка и класс по проекту", uz: "loyiha bo'yicha marka va sinf" } },
      { value: "QR", label: { ru: "накладная на каждый рейс", uz: "har reysga nakladnoy" } },
      { value: "F · W", label: { ru: "морозостойкость и водонепроницаемость", uz: "sovuqqa va suvga chidamlilik" } },
      { value: "ГОСТ", label: { ru: "7473 — бетонные смеси", uz: "7473 — beton aralashmalari" } },
    ],
    table: {
      caption: { ru: "Какую марку бетона выбрать", uz: "Qaysi beton markasini tanlash kerak" },
      head: {
        ru: ["Марка", "Класс", "Где применяют"],
        uz: ["Marka", "Sinf", "Qayerda ishlatiladi"],
      },
      rows: [
        ["М200", "B15", { ru: "Стяжка, отмостка, подбетонка", uz: "Styajka, otmostka, tayyorlov qatlami" }],
        ["М250", "B20", { ru: "Фундаменты частных домов", uz: "Xususiy uy poydevori" }],
        ["М300", "B22,5", { ru: "Фундаменты, перекрытия, лестницы", uz: "Poydevor, yopma, zinalar" }],
        ["М350", "B25", { ru: "Каркас, колонны, монолит", uz: "Karkas, ustunlar, monolit" }],
        ["М400", "B30", { ru: "Многоэтажки, мосты, нагруженные узлы", uz: "Ko'p qavatli uylar, ko'priklar, og'ir tugunlar" }],
        ["М450–М600", "B35–B45", { ru: "Спецконструкции, ЖБИ", uz: "Maxsus konstruksiyalar, temir-beton buyumlar" }],
      ],
    },
    uses: {
      ru: ["Фундаменты и монолитные плиты", "Каркасы многоэтажных домов", "Дороги, площадки, отмостки", "Промышленные полы"],
      uz: ["Poydevor va monolit plitalar", "Ko'p qavatli uylar karkasi", "Yo'llar, maydonchalar, otmostka", "Sanoat pollari"],
    },
    faq: [
      {
        q: { ru: "Какой бетон нужен для фундамента дома?", uz: "Uy poydevori uchun qanday beton kerak?" },
        a: {
          ru: "Для частного дома в 1–2 этажа обычно М250–М300 (B20–B22,5). Для тяжёлых и многоэтажных зданий — по проекту, чаще М350–М400.",
          uz: "1–2 qavatli xususiy uy uchun odatda M250–M300 (B20–B22,5). Og'ir va ko'p qavatli binolar uchun — loyiha bo'yicha, ko'pincha M350–M400.",
        },
      },
      {
        q: { ru: "Как проверить, что привезли нужный объём и марку?", uz: "Kerakli hajm va marka kelganini qanday tekshirish mumkin?" },
        a: {
          ru: "На каждой накладной {brand} есть QR-код. Отсканируйте его телефоном — увидите объём, марку, номер миксера и время отгрузки из нашей системы.",
          uz: "{brand}ning har bir nakladnoyida QR-kod bor. Telefoningiz bilan skanerlang — tizimimizdan hajm, marka, mikser raqami va yuklash vaqtini ko'rasiz.",
        },
      },
    ],
  },
  {
    slug: "zhbi",
    code: "ЖБИ",
    image: "/media/maydon.jpg",
    name: { ru: "ЖБИ изделия", uz: "Temir-beton buyumlar" },
    short: {
      ru: "Кольца, бордюры, лотки, перемычки, сваи и столбы — с одного завода.",
      uz: "Halqalar, bordyurlar, lotoklar, peremichkalar, svayalar va ustunlar — bitta zavoddan.",
    },
    title: {
      ru: "ЖБИ: кольца, бордюры, перемычки, сваи | {brand}",
      uz: "Temir-beton buyumlar: halqa, bordyur, svaya | {brand}",
    },
    description: {
      ru: "Железобетонные изделия от завода {brand}: колодезные кольца КС, бордюры, лотки, перемычки, сваи, столбы. Комплект под объект и доставка.",
      uz: "{brand} zavodidan temir-beton buyumlar: KS quduq halqalari, bordyurlar, lotoklar, peremichkalar, svayalar, ustunlar. Obyekt uchun to'plam va yetkazish.",
    },
    h1: { ru: "Железобетонные изделия", uz: "Temir-beton buyumlar" },
    intro: {
      ru: "Всё, что нужно объекту кроме плит и блоков: инженерные сети, благоустройство, проёмы и опоры. Собираем комплект под объект и отгружаем одной машиной.",
      uz: "Plita va bloklardan tashqari obyektga kerak bo'lgan hamma narsa: muhandislik tarmoqlari, obodonlashtirish, o'yiqlar va tayanchlar. Obyekt uchun to'plam yig'ib, bitta mashinada jo'natamiz.",
    },
    facts: [
      { value: "КС", label: { ru: "колодезные кольца", uz: "quduq halqalari" } },
      { value: "БР", label: { ru: "бордюры", uz: "bordyurlar" } },
      { value: "ПБ", label: { ru: "перемычки", uz: "peremichkalar" } },
      { value: "С", label: { ru: "сваи и столбы", uz: "svaya va ustunlar" } },
    ],
    uses: {
      ru: ["Колодцы и канализация", "Дороги, тротуары, парки", "Проёмы в стенах", "Опоры и ограждения"],
      uz: ["Quduqlar va kanalizatsiya", "Yo'llar, trotuarlar, bog'lar", "Devordagi o'yiqlar", "Tayanchlar va to'siqlar"],
    },
    faq: [
      {
        q: { ru: "Можно заказать нестандартное изделие?", uz: "Nostandart buyum buyurtma qilsa bo'ladimi?" },
        a: {
          ru: "Да, по чертежу. Пришлите проект — инженер оценит срок изготовления и цену.",
          uz: "Ha, chizma bo'yicha. Loyihani yuboring — muhandis tayyorlash muddati va narxini baholaydi.",
        },
      },
    ],
  },
  {
    slug: "inertnye",
    code: "ЩП",
    image: "/media/xomashyo.jpg",
    name: { ru: "Щебень и песок", uz: "Shag'al va qum" },
    short: {
      ru: "Клинец, щебень, мытый «финский» и обычный песок — самосвалами на объект.",
      uz: "Klinets, shag'al, yuvilgan «finskiy» va oddiy qum — samosvallarda obyektga.",
    },
    title: {
      ru: "Щебень и песок с доставкой | {brand}",
      uz: "Shag'al va qum yetkazib berish | {brand}",
    },
    description: {
      ru: "Щебень, клинец, мытый песок с доставкой самосвалами {brand}. Объём — по накладной.",
      uz: "Shag'al, klinets, yuvilgan qum — {brand} samosvallarida. Hajm — nakladnoy bo'yicha.",
    },
    h1: { ru: "Щебень и песок", uz: "Shag'al va qum" },
    intro: {
      ru: "Инертные материалы с нашей базы: те же, на которых мы делаем бетон. Объём — ровно по накладной.",
      uz: "Bazamizdagi inert materiallar: betonni ham shulardan tayyorlaymiz. Hajm — aynan nakladnoy bo'yicha.",
    },
    facts: [
      { value: "Щ", label: { ru: "щебень и клинец", uz: "shag'al va klinets" } },
      { value: "П", label: { ru: "мытый и обычный песок", uz: "yuvilgan va oddiy qum" } },
      { value: "QR", label: { ru: "накладная на рейс", uz: "reysga nakladnoy" } },
      { value: "м³", label: { ru: "объём по накладной", uz: "hajm nakladnoy bo'yicha" } },
    ],
    uses: {
      ru: ["Бетон и растворы", "Штукатурка и стяжка", "Подсыпка и дренаж", "Дороги и площадки"],
      uz: ["Beton va qorishmalar", "Suvoq va styajka", "To'kma va drenaj", "Yo'llar va maydonchalar"],
    },
    faq: [
      {
        q: { ru: "Чем мытый песок лучше обычного?", uz: "Yuvilgan qum oddiysidan nimasi bilan yaxshi?" },
        a: {
          ru: "В нём нет глины и пыли, поэтому штукатурка и раствор не трескаются и набирают прочность.",
          uz: "Unda loy va chang yo'q, shuning uchun suvoq va qorishma yorilmaydi va mustahkamlik oladi.",
        },
      },
    ],
  },
];

export function getProduct(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}
