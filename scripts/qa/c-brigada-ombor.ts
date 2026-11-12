/**
 * QA (C) — Brigada ombori: tayyor dona mahsulot qaysi brigada javobgarligida (`lib/brigade-products.ts`, StockMove.ownerBrigadeId).
 *  1) «Tayyor mahsulot qo'shish» — bitta mahsulot bir nechta brigadaga bo'linadi, umumiy hovli ham;
 *  2) brigada topshiriqni bajardi — o'z omboriga;
 *  3) reys yuklash — avval zayavkani ishlagan brigada, keyin umumiy, keyin boshqalar (bir necha qator);
 *     obyektdan qaytgani — yuklangan omborlarga;
 *  4) brak — brigada omboridan, bekor qilinsa qaytadi;
 *  5) ko'chirish — juft yozuv, sklad jami o'zgarmaydi, yetmasa rad, ikki marta bosish bitta yozuv.
 * Server kerak emas. Faqat lokal insof_test… bazasi (c-lib tekshiradi).
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-brigada-ombor.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { addProductStockLines } from "@/lib/product-stock";
import { taskProgress } from "@/lib/tasks";
import { tripLoaded, tripDelivered } from "@/lib/trips";
import { addProductDefect, deleteProductDefect } from "@/lib/defects";
import { brigadeProducts, ownerOverview, ownerTurnover, splitByOwners, transferProductOwner, transferProductOwnerLines } from "@/lib/brigade-products";
import { defaultWarehouse } from "@/lib/warehouse";

async function main() {
  const tag = Date.now() % 1_000_000;
  const dir = await db.user.findFirst({ where: { role: "DIRECTOR" }, select: { id: true } })
    ?? await db.user.create({ data: { login: `qa.bo.${tag}`, passwordHash: "x", fullName: "QA Direktor", role: "DIRECTOR" } });
  const U = dir.id;
  const actor = { userId: U, role: "WAREHOUSE" as const };

  section("0. splitByOwners (sof funksiya)");
  const bal = new Map<string | null, number>([["A", 5], ["B", 8], [null, 3], ["C", -2]]);
  const s1 = splitByOwners(bal, 7, ["A"]);
  check("avval tanlangan brigada, keyin umumiy hovli", JSON.stringify(s1) === JSON.stringify([{ owner: "A", qty: 5 }, { owner: null, qty: 2 }]), s1);
  const s2 = splitByOwners(bal, 12, []);
  check("tanlovsiz: umumiy → qoldig'i ko'p brigada", JSON.stringify(s2) === JSON.stringify([{ owner: null, qty: 3 }, { owner: "B", qty: 8 }, { owner: "A", qty: 1 }]), s2);
  const s3 = splitByOwners(bal, 20, ["B"]);
  check("yetmasa qolgani birinchi tanlangan omborga (minus faqat o'sha yerda)", s3.reduce((s, p) => s + p.qty, 0) === 20 && s3.find((p) => p.owner === "B")?.qty === 12, s3);

  section("1. Ma'lumot");
  const wh = await defaultWarehouse() ?? await db.warehouse.create({ data: { name: `QA sklad ${tag}`, isDefault: true } });
  const plita = await db.product.create({ data: { code: `QABO${tag}`, name: `QA Plita BO ${tag}`, unit: "dona", price: 100_000 } });
  const A = await db.brigade.create({ data: { name: `QA A-brigada ${tag}` } });
  const B = await db.brigade.create({ data: { name: `QA B-brigada ${tag}` } });
  const C = await db.brigade.create({ data: { name: `QA C-brigada ${tag}` } });
  const own = async () => {
    const o = await ownerOverview({ productId: plita.id, warehouseId: wh.id });
    const r = o.rows[0];
    return { a: r?.byOwner[A.id] ?? 0, b: r?.byOwner[B.id] ?? 0, c: r?.byOwner[C.id] ?? 0, u: r?.byOwner[""] ?? 0, total: r?.total ?? 0 };
  };

  section("2. Tayyor mahsulot qo'shish — brigadalarga bo'lib");
  let r = await addProductStockLines({ warehouseId: wh.id, lines: [{ productId: plita.id, qty: 10, brigadeId: A.id }, { productId: plita.id, qty: 5, brigadeId: B.id }, { productId: plita.id, qty: 3 }, { productId: plita.id, qty: 2, brigadeId: A.id }] }, actor);
  let o = await own();
  check("A 12 (ikki qator qo'shildi), B 5, umumiy 3, jami 20", "ok" in r && o.a === 12 && o.b === 5 && o.u === 3 && o.total === 20, { r, o });
  // Harakati bor mahsulotga ham (direktor emas) qo'shiladi — cheklov 2026-11-12 da olindi
  const qayta = await db.product.create({ data: { code: `QABQ${tag}`, name: `QA Qayta BO ${tag}`, unit: "dona" } });
  await addProductStockLines({ warehouseId: wh.id, lines: [{ productId: qayta.id, qty: 2 }] }, actor);
  r = await addProductStockLines({ warehouseId: wh.id, lines: [{ productId: qayta.id, qty: 3, brigadeId: C.id }] }, actor);
  const qaytaSum = Number((await db.stockMove.aggregate({ where: { productId: qayta.id }, _sum: { qty: true } }))._sum.qty ?? 0);
  check("harakati bor mahsulotga sklad roli ham qo'shadi (2 + 3 = 5)", "ok" in r && qaytaSum === 5, { r, qaytaSum });
  const nofaol = await db.brigade.create({ data: { name: `QA nofaol ${tag}`, isActive: false } });
  r = await addProductStockLines({ warehouseId: wh.id, lines: [{ productId: plita.id, qty: 1, brigadeId: nofaol.id }] }, { userId: U, role: "DIRECTOR" });
  check("nofaol brigadaga qo'shib bo'lmaydi", "error" in r && /Brigada/.test(r.error), r);
  check("brigada kartasi: A omborida 12 dona", (await brigadeProducts(A.id)).some((p) => p.productId === plita.id && p.qty === 12));

  section("3. Brigada topshiriqni bajardi — o'z omboriga");
  const cust = await db.customer.create({ data: { name: `QA mijoz BO ${tag}` } });
  const order = await db.order.create({ data: { orderNo: `QA-BO-${tag}`, customerId: cust.id, status: "CONFIRMED", deliveryDate: new Date(), deliveryAddress: "QA", createdById: U, items: { create: [{ productId: plita.id, qtyM3: 30, price: 100_000 }] } }, include: { items: true } });
  const item = order.items[0]!;
  const task = await db.brigadeTask.create({ data: { taskNo: `QA-T-BO-${tag}`, orderId: order.id, orderItemId: item.id, brigadeId: C.id, qty: 6, dueDate: new Date(), createdById: U } });
  const tp = await taskProgress(task.id, 6, U);
  o = await own();
  check("C brigada 6 dona chiqardi → C omborida 6", !tp.error && o.c === 6 && o.total === 26, { tp, o });
  check("PRODUCTION_OUTPUT C ombori belgisi bilan", (await db.stockMove.count({ where: { refType: "BrigadeTask", refId: task.id, type: "PRODUCTION_OUTPUT", ownerBrigadeId: C.id } })) === 1);

  section("4. Reys yuklash — zayavka brigadasidan, keyin umumiy, keyin boshqalar");
  const veh = await db.vehicle.create({ data: { plate: `QA${tag}BO`, type: "TRUCK" } });
  const drv = await db.employee.create({ data: { fullName: `QA haydovchi BO ${tag}`, position: "Haydovchi" } });
  const trip = await db.trip.create({ data: { deliveryNoteNo: `QA-N-BO-${tag}`, orderId: order.id, vehicleId: veh.id, driverId: drv.id, qtyM3: 11 } });
  const tl = await tripLoaded(trip.id, U);
  const ship = await db.stockMove.findMany({ where: { refType: "Trip", refId: trip.id, type: "SHIPMENT" }, select: { ownerBrigadeId: true, qty: true } });
  o = await own();
  const shipBy = new Map(ship.map((m) => [m.ownerBrigadeId, Number(m.qty)]));
  check("11 dona: C 6 (zayavka brigadasi) + umumiy 3 + A 2 (qoldig'i ko'p)", !tl.error && shipBy.get(C.id) === -6 && shipBy.get(null) === -3 && shipBy.get(A.id) === -2 && ship.length === 3, { tl, ship });
  check("omborlar: A 10, B 5, C 0, umumiy 0; jami 15", o.a === 10 && o.b === 5 && o.c === 0 && o.u === 0 && o.total === 15, o);
  const td = await tripDelivered(trip.id, U, "QA qabul", undefined, { acceptedQty: 7, returnedQty: 4 });
  o = await own();
  check("obyektdan 4 dona qaytdi → yuklash tartibida: C ga 4", !td.error && o.c === 4 && o.total === 19, { td, o });

  section("5. Brak — brigada omboridan, bekor qilinsa qaytadi");
  const d1 = await addProductDefect({ productId: plita.id, qty: 3, reason: "Yoriq", brigadeId: B.id }, U);
  o = await own();
  check("B brigada braki 3 → B omboridan", "ok" in d1 && o.b === 2 && o.total === 16, { d1, o });
  const d2 = await addProductDefect({ productId: plita.id, qty: 4, reason: "Yoriq", brigadeId: B.id }, U);
  o = await own();
  check("B da 2 qolgan, brak 4 → B 2 + qolgani boshqa ombordan", "ok" in d2 && o.b === 0 && o.total === 12, { d2, o });
  if ("ok" in d2) await deleteProductDefect(d2.id, { userId: U, role: "DIRECTOR" });
  o = await own();
  check("brak bekor qilindi → o'sha omborlarga qaytdi (B 2)", o.b === 2 && o.total === 16, o);

  section("6. Ko'chirish");
  const before = await db.stockMove.aggregate({ where: { productId: plita.id, warehouseId: wh.id }, _sum: { qty: true } });
  const token = `qa-bo-transfer-${tag}-000001`;
  let t = await transferProductOwner({ productId: plita.id, warehouseId: wh.id, from: A.id, to: B.id, qty: 4, clientToken: token }, U);
  o = await own();
  check("A → B 4 dona", "ok" in t && o.a === 6 && o.b === 6, { t, o });
  t = await transferProductOwner({ productId: plita.id, warehouseId: wh.id, from: A.id, to: B.id, qty: 4, clientToken: token }, U);
  o = await own();
  check("o'sha kalit bilan qayta — yozilmadi", "ok" in t && t.dup === true && o.a === 6 && o.b === 6, { t, o });
  const after = await db.stockMove.aggregate({ where: { productId: plita.id, warehouseId: wh.id }, _sum: { qty: true } });
  check("sklad jami o'zgarmadi", Number(before._sum.qty) === Number(after._sum.qty), [before._sum.qty, after._sum.qty]);
  t = await transferProductOwner({ productId: plita.id, warehouseId: wh.id, from: A.id, to: null, qty: 50 }, U);
  check("omborda yetmasa — rad", "error" in t && /6 dona bor, 50 so'ralgan/.test(t.error), t);
  t = await transferProductOwner({ productId: plita.id, warehouseId: wh.id, from: B.id, to: B.id, qty: 1 }, U);
  check("bir xil ombor — rad", "error" in t, t);
  t = await transferProductOwner({ productId: plita.id, warehouseId: wh.id, from: C.id, to: null, qty: 4 }, U);
  o = await own();
  check("C → umumiy hovli 4", "ok" in t && o.c === 0 && o.u === 4, { t, o });
  t = await transferProductOwner({ productId: plita.id, warehouseId: wh.id, from: null, to: nofaol.id, qty: 1 }, U);
  check("nofaol brigadaga ko'chirib bo'lmaydi", "error" in t, t);
  const pairs = await db.stockMove.groupBy({ by: ["refId"], where: { productId: plita.id, type: "OWNER_TRANSFER" }, _sum: { qty: true }, _count: { _all: true } });
  check("har ko'chirish — juft yozuv, yig'indisi 0", pairs.length === 2 && pairs.every((p) => p._count._all === 2 && Number(p._sum.qty) === 0), pairs);

  section("7. Brigadalarga ajratish — bir nechta mahsulot bir yo'la");
  const blok = await db.product.create({ data: { code: `QABK${tag}`, name: `QA Blok BO ${tag}`, unit: "dona" } });
  await addProductStockLines({ warehouseId: wh.id, lines: [{ productId: blok.id, qty: 8 }] }, actor);
  let m = await transferProductOwnerLines({ warehouseId: wh.id, from: null, to: A.id, lines: [{ productId: plita.id, qty: 3 }, { productId: blok.id, qty: 9 }] }, U);
  o = await own();
  check("bittasida yetmasa — hech biri ko'chmaydi", "error" in m && /QA Blok BO/.test(m.error) && o.u === 4 && o.a === 6, { m, o });
  m = await transferProductOwnerLines({ warehouseId: wh.id, from: null, to: A.id, lines: [{ productId: plita.id, qty: 3 }, { productId: blok.id, qty: 5 }, { productId: blok.id, qty: 1 }, { productId: plita.id, qty: 0 }] }, U);
  o = await own();
  const blokA = (await brigadeProducts(A.id)).find((p) => p.productId === blok.id)?.qty;
  check("plita 3 + blok 6 (ikki qator qo'shildi, 0 lisi tashlandi) → A", "ok" in m && m.count === 2 && o.u === 1 && o.a === 9 && blokA === 6, { m, o, blokA });

  section("8. Hovli Excel jadvali — brigada × kirim / chiqim / qoldiq");
  const from = new Date(); from.setDate(from.getDate() - 1);
  const to = new Date(); to.setDate(to.getDate() + 1);
  const tv = await ownerTurnover({ from, to });
  const row = tv.rows.find((x) => x.productId === plita.id);
  const ovRow = (await ownerOverview({ productId: plita.id })).rows[0];
  check("qoldiq ombor bo'yicha «Brigada omborlari» bilan bir xil", !!row && !!ovRow && Object.entries(ovRow.byOwner).every(([k, q]) => Math.abs((row.byOwner[k]?.close ?? 0) - q) < 0.001) && Math.abs(row.total.close - ovRow.total) < 0.001, { row, ovRow });
  check("har omborda qoldiq = kirim − chiqim (hamma harakat davr ichida)", !!row && Object.values(row.byOwner).every((c) => Math.abs(c.close - (c.in - c.out)) < 0.001), row);
  const realIn = Number((await db.stockMove.aggregate({ where: { productId: plita.id, qty: { gt: 0 }, type: { not: "OWNER_TRANSFER" } }, _sum: { qty: true } }))._sum.qty ?? 0);
  check("Jami kirim — ko'chirishsiz, brigada kirimida esa ko'chirish bor", !!row && Math.abs(row.total.in - realIn) < 0.001 && Object.values(row.byOwner).reduce((a, c) => a + c.in, 0) > realIn, { total: row?.total, realIn });
  check("ustunlar: brigadalar, oxirida umumiy hovli", tv.columns.at(-1)?.owner === null && [A.id, B.id, C.id].every((id) => tv.columns.some((c) => c.owner === id)), tv.columns.map((c) => c.name));
  const old = await ownerTurnover({ from: new Date("2000-01-01T00:00:00"), to: from });
  check("davrdan oldin — plita qatori yo'q", !old.rows.some((x) => x.productId === plita.id), old.rows.length);

  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
