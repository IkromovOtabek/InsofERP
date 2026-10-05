/**
 * QA (C) — mobil pul ko'rsatkichlari va kunlik Excel hisobot:
 *  · Kreditorka = Σ supplierLedger(debt) (veb yetkazuvchi kartochkasi) + tasdiqlangan ta'minot;
 *  · kassa qoldig'i boshlang'ich qoldiqni (OPENING, txSign) qo'shadi;
 *  · storno qilingan kirim kreditorkaga kirmaydi;
 *  · /api/mobile/report/daily — .xlsx ochiladi, xulosa summalari bazaga teng.
 */
import * as XLSX from "xlsx";
import { api, check, done, section, tok } from "./c-lib";
import { db } from "@/lib/db";
import { supplierLedger } from "@/lib/receipt-payables";
import { createOpening } from "@/lib/opening-balances";
import { totalPlanned } from "@/lib/supply";
import { txSign } from "@/lib/cash-tx";

const digits = (s: unknown) => Number(String(s ?? "").replace(/[^\d-−]/g, "").replace("−", "-"));
const field = (j: { fields?: { label: string; value: string }[] } | null, label: string) => j?.fields?.find((f) => f.label === label)?.value;

async function expectedPayable() {
  const suppliers = await db.supplier.findMany({ select: { id: true } });
  let debt = 0;
  for (const s of suppliers) debt += (await supplierLedger(s.id)).debt;
  const approved = await db.supplyRequest.findMany({ where: { status: "APPROVED" }, include: { items: true } });
  return Math.round(debt + approved.reduce((a, x) => a + totalPlanned(x), 0));
}

async function main() {
  const buh = await tok("test.buh");
  const director = await db.user.findUniqueOrThrow({ where: { login: "test.direktor" } });

  section("Kreditorka (buxgalteriya dashboardi)");
  // Boshlang'ich qoldiq — yetkazuvchiga qarzimiz (test ma'lumotida yo'q edi)
  const sup = await db.supplier.findFirstOrThrow({ orderBy: { name: "asc" } });
  const exists = await db.openingBalance.findFirst({ where: { kind: "SUPPLIER", supplierId: sup.id, cancelledAt: null } });
  if (!exists) {
    const r = await createOpening({ kind: "SUPPLIER", supplierId: sup.id, date: new Date("2026-09-01T00:00:00+05:00"), amount: 7_000_000, note: "QA (C) sinov" }, director.id);
    check("yetkazuvchi boshlang'ich qoldig'i yaratildi", !r.error, r.error);
  }
  let d = await api("GET", "/api/mobile/detail?key=dash&id=payable.month", { token: buh });
  check("kreditorka kartochkasi → 200", d.status === 200, d.json);
  let exp = await expectedPayable();
  check(`jami = Σ supplierLedger.debt + tasdiqlangan ta'minot (${exp})`, Math.abs(digits(field(d.json, "Jami")) - exp) <= 1, field(d.json, "Jami"));
  check("boshlang'ich qoldiq kartochkada ko'rinadi", digits(field(d.json, "Boshlang'ich qoldiq (qolgan)")) >= 7_000_000, field(d.json, "Boshlang'ich qoldiq (qolgan)"));
  const home = await api("GET", "/api/mobile/home?period=month", { token: buh });
  const tile = JSON.stringify(home.json).match(/"key":"payable","label":"([^"]+)","value":"([^"]+)"/);
  check("bosh sahifada kreditorka kartasi bor", !!tile, JSON.stringify(home.json).slice(0, 200));

  // Storno qilingan kirim kreditorkadan chiqadi
  const unpaidRec = await db.goodsReceipt.findFirst({ where: { cancelledAt: null, supply: { is: null }, createdAt: { gte: new Date("2026-09-30T00:00:00+05:00") } }, include: { items: true } });
  if (unpaidRec) {
    const before = digits(field(d.json, "Jami"));
    // Kirim summasi QQS bilan (20261005 dan): qty × price + vatAmount
    const total = unpaidRec.items.reduce((s, i) => s + Number(i.qty) * Number(i.price) + Number(i.vatAmount), 0);
    const paid = Number((await db.cashTransaction.aggregate({ where: { type: "EXPENSE", refType: "GoodsReceipt", refId: unpaidRec.id }, _sum: { amount: true } }))._sum.amount ?? 0);
    await db.goodsReceipt.update({ where: { id: unpaidRec.id }, data: { cancelledAt: new Date(), cancelReason: "QA (C) storno sinovi" } });
    try {
      d = await api("GET", "/api/mobile/detail?key=dash&id=payable.month", { token: buh });
      const after = digits(field(d.json, "Jami"));
      const left = Math.max(0, total - paid);
      check(`storno qilingan kirim (${Math.round(left)}) kreditorkadan chiqdi`, Math.abs(before - after - left) <= 1, { before, after, left });
      exp = await expectedPayable();
      check("storno'dan keyin ham veb hisobi bilan teng", Math.abs(after - exp) <= 1, { after, exp });
    } finally {
      await db.goodsReceipt.update({ where: { id: unpaidRec.id }, data: { cancelledAt: null, cancelReason: null } });
    }
  } else check("to'lanmagan kirim yo'q — storno sinovi o'tkazib yuborildi", true);

  section("Kassa qoldig'i (OPENING kiradi)");
  const kassa = await tok("test.kassa");
  const balOf = async () => digits(field((await api("GET", "/api/mobile/detail?key=dash&id=balance.month", { token: kassa })).json, "Jami"));
  const expectedBalance = async () => {
    const [pay, tx] = await Promise.all([
      db.payment.aggregate({ where: { cashAccount: { isActive: true } }, _sum: { amount: true } }),
      db.cashTransaction.groupBy({ by: ["type"], where: { cashAccount: { isActive: true } }, _sum: { amount: true } }),
    ]);
    return Math.round(Number(pay._sum.amount ?? 0) + tx.reduce((s, t) => s + txSign(t.type) * Number(t._sum.amount ?? 0), 0));
  };
  const b0 = await balOf();
  check("qoldiq = to'lovlar + Σ txSign(tur)·summa", Math.abs(b0 - (await expectedBalance())) <= 1, { b0 });
  const acc = await db.cashAccount.findFirstOrThrow({ where: { type: "BANK", isActive: true } });
  const hasCashOpening = await db.openingBalance.findFirst({ where: { kind: "CASH", cashAccountId: acc.id, cancelledAt: null } });
  if (!hasCashOpening) {
    const r = await createOpening({ kind: "CASH", cashAccountId: acc.id, date: new Date("2026-09-01T00:00:00+05:00"), amount: 3_000_000, note: "QA (C) sinov" }, director.id);
    check("bank boshlang'ich qoldig'i yaratildi", !r.error, r.error);
    const b1 = await balOf();
    check("OPENING +3 mln qoldiqqa qo'shildi (chiqim emas)", Math.abs(b1 - b0 - 3_000_000) <= 1, { b0, b1 });
  }
  const homeK = await api("GET", "/api/mobile/home", { token: kassa });
  check("kassir bosh sahifasi → 200", homeK.status === 200, homeK.status);
  const dirTok = await tok("test.direktor");
  const owner = await api("GET", "/api/mobile/home?period=month", { token: dirTok });
  check("direktor bosh sahifasi → 200", owner.status === 200, owner.status);

  section("Kunlik Excel hisobot");
  const dates = await db.$queryRaw<{ d: string }[]>`SELECT to_char(date AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') d FROM "Order" WHERE kind = 'SALE' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`;
  const day = dates[0]?.d ?? new Date().toISOString().slice(0, 10);
  const r = await api("GET", `/api/mobile/report/daily?date=${day}`, { token: dirTok });
  check(`${day} → 200 xlsx`, r.status === 200 && Buffer.isBuffer(r.json), r.status);
  check("content-disposition fayl nomi bilan", /kunlik-hisobot-\d{4}-\d{2}-\d{2}\.xlsx/.test(r.headers.get("content-disposition") ?? ""), r.headers.get("content-disposition"));
  if (Buffer.isBuffer(r.json)) {
    const wb = XLSX.read(r.json, { type: "buffer" });
    check("varaqlar: Xulosa, Sotuv, Ishlab chiqarish, Reyslar, To'lovlar, Kirim-chiqim, Muammolar", ["Xulosa", "Sotuv", "Ishlab chiqarish", "Reyslar", "To'lovlar", "Kirim-chiqim", "Muammolar"].every((n) => wb.SheetNames.includes(n)), wb.SheetNames);
    const sum = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets["Xulosa"], { header: 1 });
    const val = (label: string) => Number(sum.find((row) => row[0] === label)?.[1] ?? NaN);
    const from = new Date(`${day}T00:00:00+05:00`), to = new Date(from.getTime() + 86400_000);
    const orders = await db.order.findMany({ where: { kind: "SALE", date: { gte: from, lt: to }, status: { notIn: ["CANCELLED", "DRAFT"] } }, include: { items: true } });
    const sales = Math.round(orders.reduce((s, o) => s + o.items.reduce((x, i) => x + Number(i.qtyM3) * Number(i.price), 0), 0));
    check(`zayavkalar soni = ${orders.length}`, val("Zayavkalar soni") === orders.length, val("Zayavkalar soni"));
    check(`sotuv summasi = ${sales}`, val("Sotuv summasi, so'm") === sales, val("Sotuv summasi, so'm"));
    const pays = await db.payment.aggregate({ where: { date: { gte: from, lt: to } }, _sum: { amount: true }, _count: true });
    check(`mijoz to'lovlari = ${Math.round(Number(pays._sum.amount ?? 0))}`, val("Mijoz to'lovlari, so'm") === Math.round(Number(pays._sum.amount ?? 0)), val("Mijoz to'lovlari, so'm"));
    const tx = await db.cashTransaction.groupBy({ by: ["type"], where: { date: { gte: from, lt: to } }, _sum: { amount: true } });
    const inc = Math.round(Number(tx.find((t) => t.type === "INCOME")?._sum.amount ?? 0)), out = Math.round(Number(tx.find((t) => t.type === "EXPENSE")?._sum.amount ?? 0));
    check(`boshqa kirim = ${inc}`, val("Boshqa kirim, so'm") === inc, val("Boshqa kirim, so'm"));
    check(`chiqim = ${out} (OPENING kirmaydi)`, val("Chiqim, so'm") === out, val("Chiqim, so'm"));
    const delivered = await db.trip.count({ where: { status: "DELIVERED", deliveredAt: { gte: from, lt: to } } });
    check(`yetkazilgan reyslar = ${delivered}`, val("Yetkazilgan reyslar") === delivered, val("Yetkazilgan reyslar"));
    const batches = await db.productionBatch.count({ where: { cancelledAt: null, date: { gte: from, lt: to } } });
    check(`zameslar (storno'siz) = ${batches}`, val("Zameslar soni") === batches, val("Zameslar soni"));
    const sales2 = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets["Sotuv"], { header: 1 });
    const totalRow = sales2.find((row) => row[0] === "Jami (faol)");
    check("Sotuv varag'i jami = xulosa", !totalRow || Number(totalRow[7]) === sales, totalRow);
  }
  for (const [q, want] of [["date=2026-02-31", 400], ["date=2999-01-01", 400], ["date=abc", 400], ["", 200]] as const) {
    const x = await api("GET", `/api/mobile/report/daily${q ? `?${q}` : ""}`, { token: dirTok });
    check(`report ${q || "(bugun)"} → ${want}`, x.status === want, x.status);
  }
  const deny = await api("GET", "/api/mobile/report/daily", { token: buh });
  check("buxgalter → 403 (faqat direktor)", deny.status === 403, deny.status);

  await db.$disconnect();
  done();
}
void main();
