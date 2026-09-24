/**
 * Bazani tozalash — namunaviy (seed) ma'lumotlarni o'chirib, haqiqiy ma'lumot
 * kiritish uchun bo'sh baza qoldiradi.
 *
 *   npx tsx scripts/reset-data.ts --yes          (yoki: npm run db:reset -- --yes)
 *
 * HAMMASI o'chadi: mijoz, yetkazuvchi, zayavka, reys, kirim, zames, schyot,
 * to'lov, kassa, xomashyo, mahsulot, retsept, xodim, texnika, audit, SMS,
 * Telegram bog'lanishlari, foydalanuvchilar — barchasi.
 *
 * Qayta yaratiladigan minimum (aks holda tizimga kirib bo'lmaydi):
 *   · direktor logini — ADMIN_LOGIN / ADMIN_PASSWORD / ADMIN_NAME muhit o'zgaruvchilari
 *   · "Asosiy sklad" — lib/trips.ts faol sklad bo'lishini talab qiladi
 * Kompaniya sozlamalari birinchi murojaatda o'zi yaratiladi (lib/company.ts),
 * kassa/bank hisoblarini Sozlamalar sahifasidan qo'lda qo'shasiz.
 */
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const KEEP_TABLES = ["_prisma_migrations"];

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_NAME = process.env.ADMIN_NAME || "Direktor";

/** Prodda ERP bazasi ECO Postgres'i ichida boshqa sxemada turishi mumkin (?schema=erp). */
function targetInfo() {
  try {
    const u = new URL(process.env.DATABASE_URL || "");
    return {
      where: `${u.hostname}:${u.port || 5432}${u.pathname}`,
      schema: u.searchParams.get("schema") || "public",
    };
  } catch {
    return { where: "(DATABASE_URL o'qilmadi)", schema: "public" };
  }
}

async function main() {
  const confirmed = process.argv.includes("--yes");

  const { where, schema } = targetInfo();

  const tables = (
    await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = ${schema} ORDER BY tablename
    `
  )
    .map((t) => t.tablename)
    .filter((t) => !KEEP_TABLES.includes(t));

  const counts: { table: string; rows: number }[] = [];
  for (const t of tables) {
    const r = await db.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*)::bigint AS c FROM "${schema}"."${t}"`);
    counts.push({ table: t, rows: Number(r[0].c) });
  }
  const total = counts.reduce((s, c) => s + c.rows, 0);

  console.log(`\nBaza: ${where}  (sxema: ${schema})`);
  console.log(`Jadval: ${tables.length} ta, yozuv: ${total} ta\n`);
  for (const c of counts.filter((c) => c.rows > 0).sort((a, b) => b.rows - a.rows)) {
    console.log(`  ${c.table.padEnd(22)} ${c.rows}`);
  }

  if (tables.length === 0) {
    console.log(`"${schema}" sxemasida jadval topilmadi — DATABASE_URL to'g'rimi?`);
    process.exitCode = 1;
    return;
  }

  if (!confirmed) {
    console.log(`\nHech narsa o'chirilmadi. Rostdan tozalash uchun --yes bilan ishga tushiring:`);
    console.log(`  npx tsx scripts/reset-data.ts --yes\n`);
    return;
  }

  console.log(`\nTozalanmoqda...`);
  const list = tables.map((t) => `"${schema}"."${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  await db.user.create({
    data: {
      login: ADMIN_LOGIN,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10),
      fullName: ADMIN_NAME,
      role: "DIRECTOR",
    },
  });
  await db.warehouse.create({ data: { id: "main", name: "Asosiy sklad" } });

  console.log(`Baza bo'sh. Login: ${ADMIN_LOGIN}`);
  if (ADMIN_PASSWORD === "admin123") {
    console.log(`DIQQAT: parol standart "admin123" — kirgach darhol o'zgartiring`);
    console.log(`(yoki skriptni ADMIN_PASSWORD='...' bilan ishga tushiring).`);
  }
  console.log(`Keyingi qadam: Sozlamalar → kompaniya ma'lumotlari, zavod nuqtasi, kassa/bank hisoblari.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
