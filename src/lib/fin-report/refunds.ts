import { cache } from "react";
import { db } from "@/lib/db";
import { FLOW_ONLY } from "@/lib/cash-tx";
import { loadCategories, makeResolver } from "./categories";

/**
 * Sotib oluvchiga qaytarilgan pul (PNL qatori CUSTOMER_REFUND) davr bo'yicha — PNL «Daromad»dan ayiradi. Tahlil yalpi foydasi ham
 * shuni ayiradi (`bi/overview`, `bi/finance`, `bi/sales`), aks holda Tahlil va PNL yalpi foydasi qaytarilgan pul miqdoriga farq
 * qiladi (Sarvar rejasi 1.2: bitta ko'rsatkich — bitta qiymat). Ishora PNL dagidek: chiqim (+), teskari yozuv (kirim) ayiriladi.
 */
export const customerRefunds = cache(async (fromMs: number, toMs: number): Promise<number> => {
  const [nodes, txs] = await Promise.all([
    loadCategories(),
    db.cashTransaction.findMany({
      where: { ...FLOW_ONLY, cancelledAt: null, date: { gte: new Date(fromMs), lt: new Date(toMs) } },
      select: { type: true, amount: true, category: true, subCategory: true },
    }),
  ]);
  const resolve = makeResolver(nodes);
  let s = 0;
  for (const t of txs) {
    const r = resolve(t.category, t.subCategory);
    if (r?.top.pnlLine !== "CUSTOMER_REFUND") continue;
    const a = Number(t.amount);
    s += (r.top.type === "INCOME") === (t.type === "INCOME") ? a : -a;
  }
  return Math.round(s * 100) / 100;
});

/** Qulay chaqiruv: `refundsIn(from, to)` — Date bilan (kesh kaliti son bo'lsin) */
export const refundsIn = (from: Date, to: Date) => customerRefunds(from.getTime(), to.getTime());
