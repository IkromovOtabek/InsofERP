import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const pw = await bcrypt.hash("admin123", 10);
  await db.user.upsert({
    where: { login: "admin" },
    update: {},
    create: { login: "admin", passwordHash: pw, fullName: "Direktor", role: "DIRECTOR" },
  });

  await db.companySettings.upsert({
    where: { id: "main" },
    update: {},
    create: {
      id: "main",
      name: "Insof beton zavodi",
      legalName: "INSOF BETON MChJ",
      phone: "+998 90 000 00 00",
      address: "Toshkent viloyati",
      about: "Zamonaviy avtomatlashtirilgan liniyada M100–M400 markali tayyor beton ishlab chiqaramiz. Har bir partiya laboratoriya nazoratidan o'tadi, o'z mikserlarimiz bilan obyektga yetkazib beramiz.",
      foundedYear: 2020,
    },
  });

  const wh = await db.warehouse.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main", name: "Asosiy sklad" },
  });

  const materials = [
    { code: "CEM",   name: "Sement M400",        unit: "kg", minStock: 20000 },
    { code: "SAND",  name: "Qum",                unit: "kg", minStock: 50000 },
    { code: "GR520", name: "Shag'al 5-20",       unit: "kg", minStock: 50000 },
    { code: "ADD",   name: "Plastifikator",      unit: "l",  minStock: 200 },
    { code: "WATER", name: "Suv",                unit: "l",  minStock: 0 },
  ];
  for (const m of materials) {
    await db.material.upsert({ where: { code: m.code }, update: {}, create: m });
  }

  const products = [
    { code: "M200", name: "Beton M200 (B15)",   strengthClass: "B15",   price: 550000 },
    { code: "M250", name: "Beton M250 (B20)",   strengthClass: "B20",   price: 600000 },
    { code: "M300", name: "Beton M300 (B22.5)", strengthClass: "B22.5", price: 650000 },
    { code: "M350", name: "Beton M350 (B25)",   strengthClass: "B25",   price: 700000 },
    { code: "USTUN", name: "Beton ustun 2.5 m",  strengthClass: "B22.5", price: 180000, unit: "dona" },
    { code: "FBS24", name: "FBS blok 24.4.6",    strengthClass: "B15",   price: 250000, unit: "dona" },
  ];
  for (const p of products) {
    await db.product.upsert({ where: { code: p.code }, update: {}, create: p });
  }

  // Namuna retsept: M300, 1 m3 (taxminiy normalar — laborant aniqlashtiradi)
  const m300 = await db.product.findUniqueOrThrow({ where: { code: "M300" } });
  const byCode = async (c: string) => (await db.material.findUniqueOrThrow({ where: { code: c } })).id;
  const existing = await db.recipe.findFirst({ where: { productId: m300.id } });
  if (!existing) {
    await db.recipe.create({
      data: {
        productId: m300.id,
        version: 1,
        items: {
          create: [
            { materialId: await byCode("CEM"),   qtyPerM3: 380 },
            { materialId: await byCode("SAND"),  qtyPerM3: 700 },
            { materialId: await byCode("GR520"), qtyPerM3: 1100 },
            { materialId: await byCode("WATER"), qtyPerM3: 180 },
            { materialId: await byCode("ADD"),   qtyPerM3: 3.8 },
          ],
        },
      },
    });
  }

  await db.cashAccount.createMany({
    data: [
      { name: "Kassa", type: "CASH" },
      { name: "Asosiy hisob raqam", type: "BANK" },
    ],
    skipDuplicates: true,
  });

  console.log("Seed tayyor. Login: admin / admin123");
  console.log("Sklad:", wh.name);
}

main().finally(() => db.$disconnect());
