import type { Prisma, StockMoveType } from "@/generated/prisma";
import { db } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { DRILL_LIMIT, sortDrill, type Drill, type DrillItem } from "@/lib/drill";

/**
 * Sklad raqamining manbasi (drill-down): material yoki mahsulot qatoridagi son qaysi sklad harakatlaridan (`StockMove`)
 * yig'ilgani. Tahlil → Ombor (Xom-ashyo balansi, Tayyor mahsulot) jadvallari bilan bir xil qoida:
 *   material — kirim = RECEIPT va musbat inventarizatsiya, sarf = qolgan hamma harakat (`lib/stock-turnover.ts`);
 *   mahsulot — ishlab chiqarildi = PRODUCTION_OUTPUT, jo'natildi = SHIPMENT, boshqa = qolgani (`lib/fin-report/sklad.ts`);
 *   oy boshi / oxiri qoldig'i — shu sanagacha barcha harakatlar, tur bo'yicha yig'ib (yozuvlar ko'p — butun tarix).
 */
export type StockDrillKind = "in" | "out" | "open" | "close" | "produced" | "shipped" | "other";
export const STOCK_DRILL_KINDS: readonly StockDrillKind[] = ["in", "out", "open", "close", "produced", "shipped", "other"];

/** Harakat turi yorlig'i; yangi tur qo'shilsa (yorlig'i yo'q) — tur nomi ko'rinadi (`moveLabel`). */
const MOVE_LABEL: Partial<Record<StockMoveType, string>> = {
  RECEIPT: "Kirim", PRODUCTION_CONSUME: "Ishlab chiqarishga sarf", PRODUCTION_OUTPUT: "Ishlab chiqarildi", SHIPMENT: "Jo'natildi",
  ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Spisaniye / brak", BRIGADE_ISSUE: "Brigadaga berildi", BRIGADE_RETURN: "Brigadadan qaytdi",
  ISSUE: "Chiqim (oluvchiga)", OWNER_TRANSFER: "Brigada omboriga ko'chdi",
};
export const moveLabel = (t: StockMoveType) => MOVE_LABEL[t] ?? ((t as string) === "TRANSFER" ? "Skladlararo ko'chirish" : t);

const KIND_LABEL: Record<StockDrillKind, string> = {
  in: "Kirim", out: "Haqiqiy sarf (chiqim)", open: "Oy boshi qoldig'i", close: "Oy oxiri qoldig'i",
  produced: "Ishlab chiqarildi", shipped: "Jo'natildi", other: "Brak / tuzatish",
};

/** Hujjatga havola (bo'lsa), aks holda material / mahsulot sahifasi. */
function moveHref(m: { refType: string | null; refId: string | null; productId: string | null }): string {
  if (m.refId && m.refType === "GoodsReceipt") return `/receipts/${m.refId}`;
  if (m.refId && m.refType === "Trip") return `/trips/${m.refId}`;
  if (m.refType === "ProductionBatch") return "/production";
  return m.productId ? `/stock/products/${m.productId}` : "/stock/rasxod";
}

export async function stockDrill(o: { materialId?: string; productId?: string; from: Date; to: Date; kind: StockDrillKind; period: string }): Promise<Drill | null> {
  const subject = o.materialId
    ? await db.material.findUnique({ where: { id: o.materialId }, select: { name: true, unit: true } })
    : o.productId ? await db.product.findUnique({ where: { id: o.productId }, select: { name: true, unit: true } }) : null;
  if (!subject) return null;
  const own: Prisma.StockMoveWhereInput = o.materialId ? { materialId: o.materialId } : { productId: o.productId };
  const title = `${subject.name} — ${KIND_LABEL[o.kind]}`;

  // Qoldiq — butun tarix, tur bo'yicha (har yozuv emas)
  if (o.kind === "open" || o.kind === "close") {
    const g = await db.stockMove.groupBy({ by: ["type"], where: { ...own, date: { lt: o.kind === "open" ? o.from : o.to } }, _sum: { qty: true }, _count: { _all: true } });
    const items: DrillItem[] = g.map((x) => ({ date: null, title: moveLabel(x.type), sub: `${x._count._all} ta harakat`, amount: Number(x._sum.qty ?? 0) }));
    const value = Math.round(items.reduce((s, i) => s + i.amount, 0) * 1000) / 1000;
    return { title, period: o.period, value, isQty: true, unit: subject.unit, parts: [], items: sortDrill(items), note: `Qoldiq — shu sanagacha bo'lgan barcha harakatlar yig'indisi (${subject.unit}).` };
  }

  const period = { gte: o.from, lt: o.to };
  const where: Prisma.StockMoveWhereInput =
    o.kind === "in" ? { ...own, date: period, OR: [{ type: "RECEIPT" }, { type: "ADJUSTMENT", qty: { gt: 0 } }] }
    : o.kind === "out" ? { ...own, date: period, NOT: { OR: [{ type: "RECEIPT" }, { type: "ADJUSTMENT", qty: { gt: 0 } }] } }
    : o.kind === "produced" ? { ...own, date: period, type: "PRODUCTION_OUTPUT" }
    : o.kind === "shipped" ? { ...own, date: period, type: "SHIPMENT" }
    : { ...own, date: period, type: { notIn: ["PRODUCTION_OUTPUT", "SHIPMENT"] } };
  // Jami — barcha harakatlardan (bazada yig'iladi), ro'yxat — eng so'nggi DRILL_LIMIT tasi
  const [agg, moves] = await Promise.all([db.stockMove.aggregate({ where, _sum: { qty: true }, _count: { _all: true } }), db.stockMove.findMany({
    where, orderBy: { date: "desc" }, take: DRILL_LIMIT,
    select: {
      date: true, type: true, qty: true, unitCost: true, refType: true, refId: true, note: true, productId: true,
      warehouse: { select: { name: true } }, brigade: { select: { name: true } }, recipient: { select: { name: true } }, employee: { select: { fullName: true } },
    },
  })]);
  // Sarf va jo'natish jadvalda musbat (chiqim), kirim va ishlab chiqarish — o'z ishorasi bilan
  const sign = o.kind === "out" || o.kind === "shipped" ? -1 : 1;
  const items: DrillItem[] = moves.map((m) => {
    const who = m.brigade?.name ?? m.recipient?.name ?? m.employee?.fullName;
    const q = Number(m.qty);
    return {
      date: m.date, title: `${moveLabel(m.type)}${who ? ` — ${who}` : ""}`,
      sub: [m.warehouse.name, `${fmtNum(Math.abs(q), 3)} ${subject.unit}${m.unitCost != null ? ` × ${fmtNum(Number(m.unitCost))}` : ""}`, m.note?.trim()].filter(Boolean).join(" · "),
      amount: sign * q, href: moveHref(m),
    };
  });
  const value = Math.round(sign * Number(agg._sum.qty ?? 0) * 1000) / 1000, total = agg._count._all;
  return {
    title, period: o.period, value, isQty: true, unit: subject.unit, parts: [], items: sortDrill(items),
    note: total > DRILL_LIMIT ? `${total} ta harakatdan eng so'nggi ${DRILL_LIMIT} tasi ko'rsatildi — jami songa hammasi kirgan.` : `Miqdor, ${subject.unit}.`,
  };
}

/** Kirim qatori — panelda bitta bo'lak: «05.11.2026 · KR-… · Ta'minotchi · TTN … · 4 dona × 85 000». */
type ReceiptPick = { qty: number; price: number; vat: number; receipt: { id: string; docNo: string; date: Date; waybillNo: string | null; supplier: { name: string } } };
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

/**
 * Skladdan transportga berilgan zapchast (sklad chiqim hujjati `ref`) — Logistika moliya jurnalidagi summa bosilganda:
 * har zapchast qatori (miqdor × sklad narxi = summa, jami = Logistika moliyadagi chiqim) va u skladga qachon, kimdan,
 * qanday narxda kirim bo'lgani: chiqim sanasigacha bo'lgan eng so'nggi kirimlar (bekor qilinmagan), chiqim miqdorini
 * qoplaguncha, ko'pi bilan 3 ta. `receiptHref` — kirim hujjatini ocha oladigan foydalanuvchiga havola.
 */
export async function stockIssueDrill(ref: string, o: { receiptHref: boolean }): Promise<Drill | null> {
  const moves = await db.stockMove.findMany({
    where: { refType: "Issue", refId: ref, materialId: { not: null } }, orderBy: { createdAt: "asc" },
    select: { date: true, materialId: true, qty: true, unitCost: true, warehouse: { select: { name: true } }, vehicle: { select: { plate: true } }, material: { select: { name: true, unit: true } } },
  });
  const first = moves[0];
  if (!first) return null;
  const ids = [...new Set(moves.map((m) => m.materialId!))];
  const recs = await db.goodsReceiptItem.findMany({
    where: { materialId: { in: ids }, receipt: { cancelledAt: null, date: { lte: first.date } } },
    orderBy: [{ receipt: { date: "desc" } }, { receipt: { createdAt: "desc" } }], take: 60 * ids.length,
    select: { materialId: true, qty: true, price: true, vatAmount: true, receipt: { select: { id: true, docNo: true, date: true, waybillNo: true, supplier: { select: { name: true } } } } },
  });
  const byMat = new Map<string, ReceiptPick[]>();
  for (const r of recs) {
    const list = byMat.get(r.materialId) ?? [];
    list.push({ qty: Number(r.qty), price: Number(r.price), vat: Number(r.vatAmount), receipt: r.receipt });
    byMat.set(r.materialId, list);
  }
  const items: DrillItem[] = moves.map((m) => {
    const out = -Number(m.qty), cost = m.unitCost == null ? null : Number(m.unitCost), u = m.material?.unit ?? "";
    // Oxirgi kirimlar — chiqim miqdorini qoplaguncha (ko'pi bilan 3 ta)
    const picks: ReceiptPick[] = [];
    let covered = 0;
    for (const r of byMat.get(m.materialId!) ?? []) {
      if (picks.length >= 3 || covered >= out - 1e-6) break;
      picks.push(r); covered += r.qty;
    }
    const sub = picks.length
      ? picks.map((r) => [
          `Kirim ${dmy(r.receipt.date)}`, r.receipt.docNo, r.receipt.supplier.name,
          r.receipt.waybillNo ? (/^ttn/i.test(r.receipt.waybillNo) ? r.receipt.waybillNo : `TTN ${r.receipt.waybillNo}`) : null,
          `${fmtNum(r.qty, 3)} ${u} × ${fmtNum(r.price)}${r.vat > 0 ? " + QQS" : ""}`,
        ].filter(Boolean).join(" · ")).join("; ")
      : "Kirim topilmadi — boshlang'ich qoldiq yoki inventarizatsiyadan kelgan";
    return {
      date: m.date, title: `${m.material?.name ?? "?"} — ${fmtNum(out, 3)} ${u}${cost != null ? ` × ${fmtNum(cost)}` : " (narx yo'q)"}`,
      sub, amount: Math.round(out * (cost ?? 0) * 100) / 100, href: o.receiptHref && picks[0] ? `/receipts/${picks[0].receipt.id}` : undefined,
    };
  });
  const value = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  return {
    title: `Skladdan zapchast — ${first.vehicle?.plate ?? "transport"}`, period: `${dmy(first.date)} · ${first.warehouse.name}`, value, parts: [], items,
    note: "Har qatorda: berilgan zapchast, miqdori va sklad narxi («Dona narxi» yoki o'rtacha tannarx), pastida — u skladga qachon, kimdan va qanday narxda kirim bo'lgani (chiqimgacha bo'lgan oxirgi kirimlar).",
  };
}
