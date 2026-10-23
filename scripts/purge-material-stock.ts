/**
 * Xomashyo kirim/chiqimini BUTUNLAY o'chirish — ma'lumotlarni boshidan qayta kiritish uchun.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/purge-material-stock.ts          (faqat hisobot)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/purge-material-stock.ts --yes    (o'chirish)
 *
 * O'chadi:
 *   · barcha kirim hujjatlari (GoodsReceipt + qatorlari), bekor qilinganlari ham
 *   · xomashyo sklad harakatlari: kirim, chiqim («Кому», xodimga), brigadaga berish/qaytarish
 *     va ularning bekor qilish (storno) qatorlari
 *   · shu harakatlarga bog'langan brigada qoldig'i yozuvlari (BrigadeMove ISSUE/RETURN)
 * Qoladi (tegilmaydi):
 *   · spravochniklar (xomashyo, sklad, yetkazuvchi, oluvchilar, brigadalar), boshlang'ich qoldiqlar
 *   · zames sarfi, inventarizatsiya, spisaniye, topshiriq uchun avtomatik brigadaga berish, tayyor mahsulot
 *   · kassa: kirimga bog'langan to'lovlar qoladi, faqat kirimga havolasi uziladi (yetkazuvchi bilan bog'i qoladi)
 * Ta'minot zayavkasidan kelgan kirim bo'lsa — to'xtaydi; --with-supply bilan zayavka kirimdan uziladi.
 * Hammasi bitta tranzaksiyada: xato bo'lsa hech narsa o'zgarmaydi. Oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

const CHUNK = 5000;
const MOVE_TYPES = ["RECEIPT", "ISSUE", "BRIGADE_ISSUE", "BRIGADE_RETURN"] as const;
// Shu hujjatlardan tug'ilgan harakatlar kirim/chiqim emas — qoladi
const KEEP_REFS = ["BrigadeTask", "ProductionBatch", "OpeningBalance", "StockIn", "Inventory", "ProductDefect", "Trip"];

function chunks<T>(a: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += CHUNK) out.push(a.slice(i, i + CHUNK));
  return out;
}

async function main() {
  const { db } = await import("@/lib/db");
  const { lockStock } = await import("@/lib/stock-lock");
  const { audit } = await import("@/lib/audit");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");
  const withSupply = process.argv.includes("--with-supply");

  const moveWhere = {
    materialId: { not: null },
    opening: null,
    OR: [
      { refType: { in: ["GoodsReceipt", "Issue", "IssueStorno"] } },
      { AND: [{ type: { in: [...MOVE_TYPES] } }, { OR: [{ refType: null }, { refType: { notIn: KEEP_REFS } }] }] },
    ],
  };

  const [receipts, cancelled, supplyLinked, moves, paid] = await Promise.all([
    db.goodsReceipt.count(),
    db.goodsReceipt.count({ where: { cancelledAt: { not: null } } }),
    db.supplyRequest.count({ where: { receiptId: { not: null } } }),
    db.stockMove.findMany({ where: moveWhere, select: { id: true, type: true } }),
    db.cashTransaction.count({ where: { refType: "GoodsReceipt" } }),
  ]);
  const moveIds = moves.map((m) => m.id);
  let brigadeMoves = 0;
  for (const part of chunks(moveIds)) brigadeMoves += await db.brigadeMove.count({ where: { refType: "StockMove", refId: { in: part } } });
  const byType = new Map<string, number>();
  for (const m of moves) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
  const all = await db.stockMove.groupBy({ by: ["type"], where: { materialId: { not: null } }, _count: { _all: true } });
  const kept = all.map((a) => ({ type: a.type, n: a._count._all - (byType.get(a.type) ?? 0) })).filter((k) => k.n > 0);

  console.log(`\nBaza: ${dbLabel()}\n`);
  console.log(`O'chadi:`);
  console.log(`  Kirim hujjatlari          ${receipts}  (shundan bekor qilingan: ${cancelled})`);
  console.log(`  Xomashyo sklad harakatlari ${moveIds.length}`);
  for (const [t, c] of byType) console.log(`    ${t.padEnd(16)} ${c}`);
  console.log(`  Brigada qoldig'i yozuvlari ${brigadeMoves}`);
  console.log(`Kirimdan uziladi (o'chmaydi):`);
  console.log(`  Kassa to'lovlari          ${paid}`);
  console.log(`  Ta'minot zayavkalari      ${supplyLinked}`);
  console.log(`Qoladigan xomashyo harakatlari (zames, inventarizatsiya, spisaniye, boshlang'ich qoldiq...):`);
  for (const k of kept) console.log(`    ${k.type.padEnd(16)} ${k.n}`);

  if (supplyLinked > 0 && !withSupply) {
    console.log(`\nTa'minot zayavkasidan kelgan ${supplyLinked} ta kirim bor. Ular ham o'chsin desangiz --with-supply qo'shing.`);
    if (confirmed) { process.exitCode = 1; return; }
  }
  if (!confirmed) {
    console.log(`\nHech narsa o'chirilmadi. O'chirish uchun --yes bilan ishga tushiring (oldin pg_dump!).\n`);
    return;
  }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — audit yozuvi uchun kerak");

  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    let bm = 0, sm = 0;
    for (const part of chunks(moveIds)) {
      bm += (await tx.brigadeMove.deleteMany({ where: { refType: "StockMove", refId: { in: part } } })).count;
      sm += (await tx.stockMove.deleteMany({ where: { id: { in: part } } })).count;
    }
    const cash = (await tx.cashTransaction.updateMany({ where: { refType: "GoodsReceipt" }, data: { refType: null, refId: null } })).count;
    const sup = (await tx.supplyRequest.updateMany({ where: { receiptId: { not: null } }, data: { receiptId: null } })).count;
    const rec = (await tx.goodsReceipt.deleteMany({})).count; // qatorlari Cascade bilan
    const after = { receipts: rec, stockMoves: sm, brigadeMoves: bm, cashUnlinked: cash, supplyUnlinked: sup };
    await audit(tx, director.id, "DELETE", "StockMove", "purge-material-stock", { byType: Object.fromEntries(byType) }, after);
    return after;
  }, { timeout: 300_000, maxWait: 30_000 });

  console.log(`\nO'chirildi: kirim ${res.receipts}, sklad harakati ${res.stockMoves}, brigada yozuvi ${res.brigadeMoves}.`);
  console.log(`Kirimdan uzildi: kassa to'lovi ${res.cashUnlinked}, ta'minot zayavkasi ${res.supplyUnlinked}.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { const { db } = await import("@/lib/db"); await db.$disconnect(); });
