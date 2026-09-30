/**
 * E-commerce vitrinasiga yangi mahsulotlarni qo'shish (production uchun xavfsiz):
 * faqat guruh, mahsulot va vitrina kartasi — buyurtma (Lead) ham, reklama banneri ham YARATILMAYDI.
 *
 * Mavjud narsaga tegmaydi: shu kodli mahsulot bo'lsa o'tkazib yuboriladi, vitrina kartasi bo'lsa
 * (panelda tahrirlangan bo'lishi mumkin) o'zgartirilmaydi. Surat `uploads/shop/demo-<code>.png`
 * bo'lsagina qo'yiladi (Mac'da `python3 scripts/shop-demo-photos.py` chizadi, serverga scp qilinadi).
 *   npx tsx scripts/shop-products.ts
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

// code, nom, birlik, narx, guruh, mustahkamlik, vitrina: tartib, eng kam buyurtma, belgi, tavsif
const PRODUCTS: [string, string, string, number, string, string | null, number, number, string | null, string][] = [
  ["M100", "Beton M100 (B7.5)", "m3", 450000, "SHOP-BETON", "B7.5", 7, 2, null, "Tayyorlov (podbetonka) qatlami va yuk tushmaydigan joylar uchun eng arzon beton."],
  ["RM100", "Qurilish qorishmasi M100", "m3", 420000, "SHOP-BETON", null, 8, 1, null, "G'isht va blok terish, suvoq uchun tayyor qorishma. Mikserda yetkaziladi, 2 soat ichida ishlatish tavsiya etiladi."],
  ["FBS12", "FBS blok 12.4.6", "dona", 140000, "SHOP-BLOK", null, 12, 10, null, "FBS 12.4.6 — yarim o'lchamli poydevor bloki: burchak va to'ldirish qatorlari uchun."],
  ["BB390", "Beton blok 390x190x188 (kovak)", "dona", 6500, "SHOP-BLOK", null, 13, 500, "Top", "Kovak beton blok 390x190x188: devor, to'siq va xo'jalik binolari uchun arzon yechim."],
  ["KZ390", "Keramzitoblok 390x190x188", "dona", 7500, "SHOP-BLOK", null, 14, 500, null, "Keramzitoblok — yengil, issiqlikni yaxshi saqlaydi. Uy va dala hovli devorlari uchun."],
  ["PK60", "Kovak plita PK 60.12", "dona", 2100000, "SHOP-JBI", null, 24, 2, null, "PK 60.12 kovak yopma plitasi (6 m). Kran bilan tushirish va montaj xizmati bor."],
  ["2PB17", "Peremichka 2PB 17-2", "dona", 65000, "SHOP-JBI", null, 25, 10, null, "2PB 17-2 peremichka — eshik va deraza o'rinlari ustiga. Armaturali, yuk ko'taruvchi."],
  ["1PP10", "Quduq qopqog'i 1PP 10-1", "dona", 280000, "SHOP-JBI", null, 26, 1, "Yangi", "KS 10 halqasi uchun 1PP 10-1 qopqoq plitasi, lyuk teshigi bilan."],
  ["BR80", "Bog' bordyuri BR 100.20.8", "dona", 28000, "SHOP-OBOD", null, 32, 50, null, "Bog' bordyuri BR 100.20.8: gulzor, yo'lak va maysazor chetlari uchun."],
  ["TP6", "Brusschatka 6 sm", "m2", 82000, "SHOP-OBOD", null, 33, 20, "Yangi", "6 sm brusschatka: piyoda yo'laklari va hovlilar uchun. Kulrang, qizil, jigarrang."],
  ["LT50", "Suv lotogi 500x160", "dona", 38000, "SHOP-OBOD", null, 34, 20, null, "Yomg'ir suvi uchun beton lotok 500x160: hovli, yo'l va avtoturargoh chetlariga."],
];

async function main() {
  const { db } = await import("@/lib/db");
  const groupId: Record<string, string> = {};
  for (const g of GROUPS) {
    const row = await db.productGroup.upsert({ where: { code: g.code }, create: g, update: {} });
    groupId[g.code] = row.id;
  }

  const photoDir = path.join(process.cwd(), "uploads", "shop");
  let products = 0, items = 0, photos = 0;
  for (const [code, name, unit, price, g, strengthClass, sortOrder, minQty, badge, description] of PRODUCTS) {
    let p = await db.product.findUnique({ where: { code } });
    if (!p) {
      p = await db.product.create({ data: { code, name, unit, price, groupId: groupId[g], strengthClass, kind: "Tayyor mahsulot" } });
      products++;
    }
    if (await db.shopItem.findUnique({ where: { productId: p.id } })) continue;
    const file = `demo-${code}.png`;
    const photo = existsSync(path.join(photoDir, file)) ? file : null;
    if (photo) photos++;
    await db.shopItem.create({ data: { productId: p.id, isPublished: true, description, badge, minQty, sortOrder, photo } });
    items++;
  }
  console.log(`Yangi mahsulot: ${products}, yangi vitrina kartasi: ${items} (surati bilan: ${photos}), jami ro'yxatda: ${PRODUCTS.length}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
