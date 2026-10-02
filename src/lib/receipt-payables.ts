import { db } from "./db";

/**
 * To'lanmagan kirimlar — sklad/snabjeniye yozgan, lekin hali kassadan pul chiqmagan kirim hujjatlari.
 *
 * Alohida holat ustuni yo'q: kirim to'langanini unga bog'langan chiqim (`CashTransaction`,
 * refType = "GoodsReceipt") ko'rsatadi. Ta'minot zanjiridan kelgan kirimning chiqimi moliya
 * pul ajratganda yozilgan va qabulda shu kirimga bog'lanadi — shuning uchun u bu ro'yxatga tushmaydi.
 */
export type UnpaidReceipt = { id: string; docNo: string; date: Date; supplier: string; supplierId: string; total: number; lines: number };

/**
 * Shu sanadan oldingi kirimlar ro'yxatga kirmaydi: ilgari kirim bilan birga chiqim darhol yozilardi,
 * chiqimsiz eski kirimlar (Excel import, dastlabki ma'lumot) esa to'lov kutmaydi.
 */
const PAYABLES_SINCE = new Date("2026-09-30T00:00:00+05:00");

export async function unpaidReceipts(): Promise<UnpaidReceipt[]> {
  const recs = await db.goodsReceipt.findMany({
    // Ta'minot zanjiridan kelgan kirim bu yerga tushmaydi — uning puli zanjirda ajratilgan
    where: { createdAt: { gte: PAYABLES_SINCE }, supply: { is: null } },
    orderBy: { date: "asc" },
    include: { supplier: { select: { name: true } }, items: { select: { qty: true, price: true } } },
  });
  if (!recs.length) return [];
  const paid = await db.cashTransaction.findMany({
    where: { refType: "GoodsReceipt", refId: { in: recs.map((r) => r.id) } },
    select: { refId: true },
  });
  const paidIds = new Set(paid.map((p) => p.refId));
  return recs
    .filter((r) => !paidIds.has(r.id))
    .map((r) => ({
      id: r.id, docNo: r.docNo, date: r.date, supplier: r.supplier.name, supplierId: r.supplierId,
      total: r.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0), lines: r.items.length,
    }))
    .filter((r) => r.total > 0.005);
}

// ───────────────────────── Yetkazuvchi hisob-kitobi (kartochka) ─────────────────────────

export type SupplierLedger = {
  received: number; // jami kirim summasi (barcha kirim hujjatlari)
  paid: number; // shu yetkazuvchiga yozilgan chiqimlar − kirimlar (qaytgan pul)
  unpaid: UnpaidReceipt[]; // to'lanmagan kirimlar — qarzimiz
  debt: number; // to'lanmagan kirimlar jami
  advance: number; // pul ajratilgan, mol hali qabul qilinmagan ta'minotlar (avans)
  refundDue: number; // bekor qilingan, lekin puli ajratilgan ta'minotlar — yetkazuvchi qaytarishi kerak
};

/**
 * Yetkazuvchi bo'yicha: qancha mol oldik, qancha to'ladik, qancha qarzmiz.
 * Qarz — to'lanmagan kirimlar (`unpaidReceipts` qoidasi bilan bir xil); avans va qaytarilishi kerak
 * bo'lgan pul ta'minot zayavkalarining chiqimlaridan (`SupplyRequest.cashTxId`) olinadi.
 */
export async function supplierLedger(supplierId: string): Promise<SupplierLedger> {
  const [items, txs, unpaidAll, supply] = await Promise.all([
    db.goodsReceiptItem.findMany({ where: { receipt: { supplierId } }, select: { qty: true, price: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { supplierId }, _sum: { amount: true } }),
    unpaidReceipts(),
    db.supplyRequest.findMany({
      where: { supplierId, cashTxId: { not: null }, status: { in: ["PRICED", "APPROVED", "FUNDED", "REJECTED"] } },
      select: { status: true, cashTxId: true },
    }),
  ]);
  const cash = supply.length
    ? new Map((await db.cashTransaction.findMany({ where: { id: { in: supply.map((s) => s.cashTxId!) } }, select: { id: true, amount: true } })).map((c) => [c.id, Number(c.amount)]))
    : new Map<string, number>();
  const sumOf = (t: "INCOME" | "EXPENSE") => Number(txs.find((x) => x.type === t)?._sum.amount ?? 0);
  const unpaid = unpaidAll.filter((r) => r.supplierId === supplierId);
  return {
    received: items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0),
    paid: sumOf("EXPENSE") - sumOf("INCOME"),
    unpaid,
    debt: unpaid.reduce((s, r) => s + r.total, 0),
    advance: supply.filter((s) => s.status !== "REJECTED").reduce((s, r) => s + (cash.get(r.cashTxId!) ?? 0), 0),
    refundDue: supply.filter((s) => s.status === "REJECTED").reduce((s, r) => s + (cash.get(r.cashTxId!) ?? 0), 0),
  };
}

export type SupplierPrice = { materialId: string; name: string; unit: string; price: number; prev: number | null; date: Date; qty: number; receipts: number };

/** Yetkazuvchidan olingan har xomashyoning oxirgi narxi va undan oldingisi (narx tarixi). */
export async function supplierPrices(supplierId: string): Promise<SupplierPrice[]> {
  const rows = await db.goodsReceiptItem.findMany({
    where: { receipt: { supplierId } },
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
