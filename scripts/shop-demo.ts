/**
 * E-commerce (ilovadagi do'kon) uchun sun'iy (demo) ma'lumotlar:
 * mahsulot guruhlari, qo'shimcha mahsulotlar, vitrina kartalari (tavsif, narx, belgi, surat)
 * va ilovadan tushgandek buyurtmalar (Lead, source "eco-shop").
 *
 * Qayta ishga tushirilsa takrorlanmaydi (kod / telefon bo'yicha). Suratlar avval:
 *   python3 scripts/shop-demo-photos.py && npx tsx scripts/shop-demo.ts
 * Demo buyurtmalarni o'chirish: npx tsx scripts/shop-demo.ts -- --clean
 */
import { existsSync } from "fs";
import path from "path";
import { loadEnv } from "./env";
loadEnv();

const GROUPS = [
  { code: "SHOP-BETON", name: "Tovar beton", sortOrder: 1 },
  { code: "SHOP-JBI", name: "Temir-beton buyumlar", sortOrder: 2 },
  { code: "SHOP-OBOD", name: "Obodonlashtirish", sortOrder: 3 },
  { code: "SHOP-BLOK", name: "Devor bloklari", sortOrder: 4 },
];

// code, nom, birlik, narx, guruh, mustahkamlik
const NEW_PRODUCTS: [string, string, string, number, string, string | null][] = [
  ["M150", "Beton M150 (B12.5)", "m3", 500000, "SHOP-BETON", "B12.5"],
  ["M400", "Beton M400 (B30)", "m3", 760000, "SHOP-BETON", "B30"],
  ["BR100", "Bordyur BR 100.30.15", "dona", 45000, "SHOP-OBOD", null],
  ["TP8", "Trotuar plitkasi 8 sm", "m2", 95000, "SHOP-OBOD", null],
  ["KS10", "Quduq halqasi KS 10-9", "dona", 420000, "SHOP-JBI", null],
  ["KB600", "Gazoblok 600x300x200 (D500)", "dona", 16000, "SHOP-BLOK", null],
  ["SV6", "Svaya S 60.30", "dona", 1350000, "SHOP-JBI", null],
  ["M100", "Beton M100 (B7.5)", "m3", 450000, "SHOP-BETON", "B7.5"],
  ["RM100", "Qurilish qorishmasi M100", "m3", 420000, "SHOP-BETON", null],
  ["PK60", "Kovak plita PK 60.12", "dona", 2100000, "SHOP-JBI", null],
  ["2PB17", "Peremichka 2PB 17-2", "dona", 65000, "SHOP-JBI", null],
  ["1PP10", "Quduq qopqog'i 1PP 10-1", "dona", 280000, "SHOP-JBI", null],
  ["BR80", "Bog' bordyuri BR 100.20.8", "dona", 28000, "SHOP-OBOD", null],
  ["TP6", "Brusschatka 6 sm", "m2", 82000, "SHOP-OBOD", null],
  ["LT50", "Suv lotogi 500x160", "dona", 38000, "SHOP-OBOD", null],
  ["FBS12", "FBS blok 12.4.6", "dona", 140000, "SHOP-BLOK", null],
  ["BB390", "Beton blok 390x190x188 (kovak)", "dona", 6500, "SHOP-BLOK", null],
  ["KZ390", "Keramzitoblok 390x190x188", "dona", 7500, "SHOP-BLOK", null],
];
const EXISTING_GROUP: Record<string, string> = { M200: "SHOP-BETON", M250: "SHOP-BETON", M300: "SHOP-BETON", M350: "SHOP-BETON", USTUN: "SHOP-JBI", FBS24: "SHOP-BLOK", "085": "SHOP-JBI" };

// Vitrina kartasi: tavsif, belgi, eng kam buyurtma, tartib, do'kon narxi (bo'sh — mahsulot narxi)
const SHOP: Record<string, { d: string; badge?: string; min?: number; sort: number; price?: number }> = {
  M300: { sort: 1, badge: "Top", min: 3, d: "Eng ko'p olinadigan marka: monolit karkas, poydevor, qoplama plitalari. Mikserda yetkaziladi, nasos bilan quyish mumkin. Laboratoriya pasporti bilan." },
  M250: { sort: 2, min: 3, d: "Uy-joy poydevori, lenta poydevor va pol styajkasi uchun. Xususiy qurilishda eng qulay narx/sifat nisbati." },
  M350: { sort: 3, badge: "Yangi", min: 5, d: "Ko'p qavatli binolar karkasi, ko'priklar va yuk ko'taruvchi konstruksiyalar uchun. Suvga chidamli W6." },
  M200: { sort: 4, min: 2, price: 530000, badge: "Chegirma", d: "Yo'lka, garaj poli, zinapoya va yengil poydevor uchun. Shu oy chegirmali narxda." },
  M150: { sort: 5, min: 2, d: "Tayyorlov qatlami, bordyur ostiga va yengil ishlar uchun iqtisodiy variant." },
  M400: { sort: 6, min: 5, d: "Yuqori mustahkamlik: sanoat pollari, ko'p qavatli karkas, gidrotexnik inshootlar. Buyurtma 1 kun oldin." },
  FBS24: { sort: 10, badge: "Top", min: 10, d: "Yig'ma poydevor va yerto'la devorlari uchun FBS 24.4.6 bloki. Kran bilan tushirish xizmati bor." },
  KB600: { sort: 11, badge: "Yangi", min: 200, d: "Yengil va issiq devor bloki (D500). Bir blok ~6 dona g'ishtni almashtiradi, yelimga teriladi." },
  USTUN: { sort: 20, min: 10, d: "2,5 m temir-beton ustun: tokzor, panjara va yengil to'siqlar uchun. Armaturali, uzoq xizmat qiladi." },
  "085": { sort: 21, min: 20, d: "Kovak yopma plita (2PK) — tez montaj, yaxshi issiqlik va tovush izolyatsiyasi." },
  KS10: { sort: 22, min: 2, d: "Quduq va kanalizatsiya uchun KS 10-9 halqasi, ichki diametri 1 m. Qopqoq alohida buyuriladi." },
  SV6: { sort: 23, min: 4, d: "Qoziq (svaya) poydevori uchun S 60.30 — zaif gruntlarda ishonchli asos." },
  BR100: { sort: 30, badge: "Top", min: 50, d: "Yo'l va yo'lka chetiga BR 100.30.15 bordyuri. Vibropresslangan, ayozga chidamli." },
  M100: { sort: 7, min: 2, d: "Tayyorlov (podbetonka) qatlami va yuk tushmaydigan joylar uchun eng arzon beton." },
  RM100: { sort: 8, min: 1, d: "G'isht va blok terish, suvoq uchun tayyor qorishma. Mikserda yetkaziladi, 2 soat ichida ishlatish tavsiya etiladi." },
  FBS12: { sort: 12, min: 10, d: "FBS 12.4.6 — yarim o'lchamli poydevor bloki: burchak va to'ldirish qatorlari uchun." },
  BB390: { sort: 13, badge: "Top", min: 500, d: "Kovak beton blok 390x190x188: devor, to'siq va xo'jalik binolari uchun arzon yechim." },
  KZ390: { sort: 14, min: 500, d: "Keramzitoblok — yengil, issiqlikni yaxshi saqlaydi. Uy va dala hovli devorlari uchun." },
  PK60: { sort: 24, min: 2, d: "PK 60.12 kovak yopma plitasi (6 m). Kran bilan tushirish va montaj xizmati bor." },
  "2PB17": { sort: 25, min: 10, d: "2PB 17-2 peremichka — eshik va deraza o'rinlari ustiga. Armaturali, yuk ko'taruvchi." },
  "1PP10": { sort: 26, badge: "Yangi", min: 1, d: "KS 10 halqasi uchun 1PP 10-1 qopqoq plitasi, lyuk teshigi bilan." },
  BR80: { sort: 32, min: 50, d: "Bog' bordyuri BR 100.20.8: gulzor, yo'lak va maysazor chetlari uchun." },
  TP6: { sort: 33, badge: "Yangi", min: 20, d: "6 sm brusschatka: piyoda yo'laklari va hovlilar uchun. Kulrang, qizil, jigarrang." },
  LT50: { sort: 34, min: 20, d: "Yomg'ir suvi uchun beton lotok 500x160: hovli, yo'l va avtoturargoh chetlariga." },
  TP8: { sort: 31, min: 20, price: 89000, badge: "Chegirma", d: "8 sm qalinlikdagi trotuar plitkasi: hovli, avtoturargoh va yo'laklar uchun. Kulrang va qizil rang." },
};

// Ilovadan tushgan demo buyurtmalar (Lead): ism, telefon, mahsulot, hajm, manzil, izoh, holat, necha soat oldin
const ORDERS: [string, string, string, number, string, string, "NEW" | "IN_PROGRESS" | "REJECTED", number][] = [
  ["Jasur Toshmatov", "+998901112201", "M300", 12, "Yunusobod t., 19-kvartal, 7-uy", "Ertaga 9:00 da, nasos kerak", "NEW", 1],
  ["Dilnoza Karimova", "+998935552202", "FBS24", 40, "Chilonzor t., Bunyodkor 12", "Kran bilan tushirish kerakmi?", "NEW", 3],
  ["Sardor Qurilish MChJ", "+998977772203", "M350", 60, "Sergeli, Yangi Sergeli ko'chasi 4", "Hafta davomida 3 bo'lib", "IN_PROGRESS", 20],
  ["Bekzod Aliyev", "+998909992204", "TP8", 180, "Qibray t., Bog'ishamol 3", "Qizil rang, yetkazish bilan", "NEW", 6],
  ["Nodira Rahimova", "+998946662205", "KB600", 1500, "Zangiota t., Eshonguzar", "Narxi ulgurjiga tushadimi?", "IN_PROGRESS", 30],
  ["Farrux Usmonov", "+998931232206", "BR100", 120, "Mirzo Ulug'bek t., Buyuk Ipak yo'li 88", null as unknown as string, "NEW", 9],
  ["Oybek Xolmatov", "+998998882207", "KS10", 6, "Olmazor t., Qorasaroy 15", "Qopqoq ham kerak", "NEW", 26],
  ["Umid Ergashev", "+998950002208", "M250", 8, "Yashnobod t., Aviasozlar 2", "Uy poydevori", "REJECTED", 50],
];

async function main() {
  const { db } = await import("@/lib/db");
  if (process.argv.includes("--clean")) {
    const r = await db.lead.deleteMany({ where: { source: "eco-shop", phone: { in: ORDERS.map((o) => o[1]) } } });
    console.log(`Demo buyurtmalar o'chirildi: ${r.count}`);
    return;
  }

  const groupId: Record<string, string> = {};
  for (const g of GROUPS) {
    const row = await db.productGroup.upsert({ where: { code: g.code }, create: g, update: { name: g.name, sortOrder: g.sortOrder } });
    groupId[g.code] = row.id;
  }

  let created = 0;
  for (const [code, name, unit, price, g, strengthClass] of NEW_PRODUCTS) {
    const ex = await db.product.findUnique({ where: { code } });
    if (!ex) { await db.product.create({ data: { code, name, unit, price, groupId: groupId[g], strengthClass, kind: "Tayyor mahsulot", note: "E-commerce demo" } }); created++; }
  }
  // Mavjud mahsulotlar — faqat papkasi bo'lmasa guruhga qo'yiladi (qo'lda qo'yilgani o'zgarmaydi)
  for (const [code, g] of Object.entries(EXISTING_GROUP)) await db.product.updateMany({ where: { code, groupId: null }, data: { groupId: groupId[g] } });

  const photoDir = path.join(process.cwd(), "uploads", "shop");
  let items = 0;
  for (const [code, s] of Object.entries(SHOP)) {
    const p = await db.product.findUnique({ where: { code } });
    if (!p) continue;
    const file = `demo-${code}.png`;
    const photo = existsSync(path.join(photoDir, file)) ? file : null;
    const cur = await db.shopItem.findUnique({ where: { productId: p.id } });
    const data = {
      isPublished: true, description: s.d, badge: s.badge ?? null, minQty: s.min ?? null, sortOrder: s.sort,
      price: s.price ?? null,
      // Qo'lda yuklangan haqiqiy surat bo'lsa — demo bilan almashtirilmaydi
      ...(cur?.photo && !cur.photo.startsWith("demo-") ? {} : { photo }),
    };
    await db.shopItem.upsert({ where: { productId: p.id }, create: { productId: p.id, ...data }, update: data });
    items++;
  }

  // Reklama (ADS) — bosh sahifa swiper'i; sarlavha bo'yicha takrorlanmaydi
  const BANNERS: [string, string, string, string | null, string, number][] = [
    ["M200 beton — chegirma", "Shu oy 530 000 so'm / m³", "demo-banner-m200.png", "M200", "Buyurtma berish", 1],
    ["Yangi: Gazoblok D500", "Issiq va yengil devor bloki", "demo-banner-gazoblok.png", "KB600", "Batafsil", 2],
    ["Bepul yetkazish", "10 m³ dan ortiq buyurtmaga, 15 km gacha", "demo-banner-yetkazish.png", null, "Katalog", 3],
  ];
  let banners = 0;
  for (const [title, subtitle, image, code, buttonText, sortOrder] of BANNERS) {
    if (await db.shopBanner.findFirst({ where: { title } })) continue;
    const p = code ? await db.product.findUnique({ where: { code } }) : null;
    await db.shopBanner.create({ data: { title, subtitle, image: existsSync(path.join(photoDir, image)) ? image : null, productId: p?.id ?? null, buttonText, sortOrder } });
    banners++;
  }

  let leads = 0;
  for (const [name, phone, code, qty, address, message, status, hoursAgo] of ORDERS) {
    if (await db.lead.findFirst({ where: { phone, source: "eco-shop" } })) continue;
    const p = await db.product.findUnique({ where: { code } });
    await db.lead.create({
      data: {
        name, phone, productId: p?.id, qty, address, message: message ?? null, source: "eco-shop", status,
        createdAt: new Date(Date.now() - hoursAgo * 3600_000),
        ...(status !== "NEW" ? { handledAt: new Date(Date.now() - (hoursAgo - 1) * 3600_000), note: status === "REJECTED" ? "Narx to'g'ri kelmadi" : "Qo'ng'iroq qilindi, hisob-kitob yuborildi" } : {}),
      },
    });
    leads++;
  }
  console.log(`Guruhlar: ${GROUPS.length}, yangi mahsulot: ${created}, vitrina kartasi: ${items}, reklama: ${banners}, demo buyurtma: ${leads}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
