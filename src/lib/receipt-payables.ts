import { db } from "./db";
import type { Prisma } from "@/generated/prisma";
import { supplierOpeningDues } from "./opening-balances";

type Client = Prisma.TransactionClient | typeof db;

/**
 * To'lanmagan kirimlar — sklad/snabjeniye yozgan, lekin hali to'liq to'lanmagan kirim hujjatlari.
 *
 * Alohida holat ustuni yo'q: kirimga qancha to'langanini unga bog'langan chiqimlar (`CashTransaction`,
 * type = EXPENSE, refType = "GoodsReceipt", refId = kirim) yig'indisi ko'rsatadi. To'lov qismlarga
 * bo'linishi mumkin: moliya "To'lash" bilan (qolgan summa) yoki Kirim-Chiqimda qo'lda chiqim yozib,
 * "Kirim hujjati" ni tanlab. Ta'minot zanjiridan kelgan kirimning chiqimi moliya pul ajratganda
 * yozilgan va qabulda shu kirimga bog'lanadi — shuning uchun u bu ro'yxatga tushmaydi.
 * Storno qilingan kirim to'lov kutmaydi.
 */
export type UnpaidReceipt = { id: string; docNo: string; date: Date; supplier: string; supplierId: string; total: number; paid: number; left: number; lines: number };

/**
 * Standart sana: shundan oldingi kirimlar ro'yxatga kirmaydi — ilgari kirim bilan birga chiqim darhol
 * yozilardi, chiqimsiz eski kirimlar (Excel import, dastlabki ma'lumot) esa to'lov kutmaydi.
 * Direktor Sozlamalarda o'zgartiradi (`CompanySettings.payablesSince`).
 */
export const DEFAULT_PAYABLES_SINCE = new Date("2026-09-30T00:00:00+05:00");

export async function payablesSince(client: Client = db): Promise<Date> {
  const c = await client.companySettings.findUnique({ where: { id: "main" }, select: { payablesSince: true } });
  return c?.payablesSince ?? DEFAULT_PAYABLES_SINCE;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Kirim(lar)ga bog'langan chiqimlar yig'indisi (kirim id → to'langan). */
export async function receiptPaidMap(client: Client, receiptIds: string[]): Promise<Map<string, number>> {
  if (!receiptIds.length) return new Map();
  const g = await client.cashTransaction.groupBy({
    by: ["refId"],
    where: { type: "EXPENSE", refType: "GoodsReceipt", refId: { in: receiptIds } },
    _sum: { amount: true },
  });
  return new Map(g.map((x) => [x.refId!, Number(x._sum.amount ?? 0)]));
}

export type ReceiptPayState = { id: string; docNo: string; supplierId: string; supplierName: string; total: number; paid: number; left: number; cancelled: boolean; fromSupply: boolean; lines: number };

/** Bitta kirimning to'lov holati — to'lash/bog'lash tranzaksiyasi ichida (kirim qulfidan keyin) chaqiriladi. */
export async function receiptPayState(client: Client, receiptId: string): Promise<ReceiptPayState | null> {
  const rec = await client.goodsReceipt.findUnique({
    where: { id: receiptId },
    select: { id: true, docNo: true, supplierId: true, cancelledAt: true, supplier: { select: { name: true } }, items: { select: { qty: true, price: true } }, supply: { select: { id: true } } },
  });
  if (!rec) return null;
  const total = r2(rec.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0));
  const paid = r2((await receiptPaidMap(client, [rec.id])).get(rec.id) ?? 0);
  return { id: rec.id, docNo: rec.docNo, supplierId: rec.supplierId, supplierName: rec.supplier.name, total, paid, left: r2(Math.max(0, total - paid)), cancelled: !!rec.cancelledAt, fromSupply: !!rec.supply, lines: rec.items.length };
}

/** Kirim bo'yicha qulf — to'lash, qo'lda chiqimni bog'lash va storno navbat bilan bajarilsin. */
export async function lockReceipt(tx: Prisma.TransactionClient, receiptId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receiptId}))`;
}

export async function unpaidReceipts(): Promise<UnpaidReceipt[]> {
  const since = await payablesSince();
  const recs = await db.goodsReceipt.findMany({
    // Ta'minot zanjiridan kelgan kirim bu yerga tushmaydi — uning puli zanjirda ajratilgan
    where: { createdAt: { gte: since }, supply: { is: null }, cancelledAt: null },
    orderBy: { date: "asc" },
    include: { supplier: { select: { name: true } }, items: { select: { qty: true, price: true } } },
  });
  if (!recs.length) return [];
  const paid = await receiptPaidMap(db, recs.map((r) => r.id));
  return recs
    .map((r) => {
      const total = r2(r.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0));
      const p = r2(paid.get(r.id) ?? 0);
      return { id: r.id, docNo: r.docNo, date: r.date, supplier: r.supplier.name, supplierId: r.supplierId, total, paid: p, left: r2(Math.max(0, total - p)), lines: r.items.length };
    })
    .filter((r) => r.left > 0.005);
}

// ───────────────────────── Yetkazuvchi hisob-kitobi (kartochka) ─────────────────────────

export type SupplierLedger = {
  received: number; // jami kirim summasi (barcha kirim hujjatlari)
  paid: number; // shu yetkazuvchiga yozilgan chiqimlar − kirimlar (qaytgan pul)
  unpaid: UnpaidReceipt[]; // to'lanmagan kirimlar — qarzimiz
  debt: number; // to'lanmagan kirimlar jami + boshlang'ich qoldiqdan qolgan qarz
  /** Boshlang'ich qoldiq (tizimga o'tish sanasidagi qarzimiz) — to'lanmagan qismi; manfiy — bergan avansimiz */
  opening: number;
  advance: number; // pul ajratilgan, mol hali qabul qilinmagan ta'minotlar (avans)
  refundDue: number; // bekor qilingan, lekin puli ajratilgan ta'minotlar — yetkazuvchi qaytarishi kerak
};

/**
 * Yetkazuvchi bo'yicha: qancha mol oldik, qancha to'ladik, qancha qarzmiz.
 * Qarz — to'lanmagan kirimlar (`unpaidReceipts` qoidasi bilan bir xil); avans va qaytarilishi kerak
 * bo'lgan pul ta'minot zayavkalarining chiqimlaridan (`SupplyRequest.cashTxId`) olinadi.
 */
export async function supplierLedger(supplierId: string): Promise<SupplierLedger> {
  const [items, txs, unpaidAll, supply, openings] = await Promise.all([
    db.goodsReceiptItem.findMany({ where: { receipt: { supplierId, cancelledAt: null } }, select: { qty: true, price: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { supplierId }, _sum: { amount: true } }),
    unpaidReceipts(),
    db.supplyRequest.findMany({
      where: { supplierId, cashTxId: { not: null }, status: { in: ["PRICED", "APPROVED", "FUNDED", "REJECTED"] } },
      select: { status: true, cashTxId: true },
    }),
    supplierOpeningDues(supplierId),
  ]);
  const opening = openings.reduce((s, o) => s + o.left, 0);
  const cash = supply.length
    ? new Map((await db.cashTransaction.findMany({ where: { id: { in: supply.map((s) => s.cashTxId!) } }, select: { id: true, amount: true } })).map((c) => [c.id, Number(c.amount)]))
    : new Map<string, number>();
  const sumOf = (t: "INCOME" | "EXPENSE") => Number(txs.find((x) => x.type === t)?._sum.amount ?? 0);
  const unpaid = unpaidAll.filter((r) => r.supplierId === supplierId);
  return {
    received: items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0),
    paid: sumOf("EXPENSE") - sumOf("INCOME"),
    unpaid,
    debt: unpaid.reduce((s, r) => s + r.left, 0) + Math.max(0, opening),
    opening,
    advance: supply.filter((s) => s.status !== "REJECTED").reduce((s, r) => s + (cash.get(r.cashTxId!) ?? 0), 0) + Math.max(0, -opening),
    refundDue: supply.filter((s) => s.status === "REJECTED").reduce((s, r) => s + (cash.get(r.cashTxId!) ?? 0), 0),
  };
}

export type SupplierPrice = { materialId: string; name: string; unit: string; price: number; prev: number | null; date: Date; qty: number; receipts: number };

/** Yetkazuvchidan olingan har xomashyoning oxirgi narxi va undan oldingisi (narx tarixi). */
export async function supplierPrices(supplierId: string): Promise<SupplierPrice[]> {
  const rows = await db.goodsReceiptItem.findMany({
    where: { receipt: { supplierId, cancelledAt: null } },
    orderBy: { receipt: { date: "desc" } },
    take: 2000,
    select: { materialId: true, qty: true, price: true, receipt: { select: { date: true } }, material: { select: { name: true, unit: true } } },
  });
  const out = new Map<string, SupplierPrice>();
  for (const r of rows) {
    const cur = out.get(r.materialId);
    if (!cur) {
      out.set(r.materialId, { materialId: r.materialId, name: r.material.name, unit: r.material.unit, price: Number(r.price), prev: null, date: r.receipt.date, qty: Number(r.qty), receipts: 1 });
    } else {
      cur.receipts++;
      if (cur.prev == null && Math.abs(Number(r.price) - cur.price) > 0.005) cur.prev = Number(r.price);
    }
  }
  return [...out.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}
