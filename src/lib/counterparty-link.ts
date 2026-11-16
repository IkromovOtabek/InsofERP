import { db } from "./db";
import { matchKey } from "./excel";
import { isStaffSettleCategory } from "./cash-categories";

/**
 * Kontragent matni → mijoz / yetkazuvchi (kassa Excel importi va `scripts/kontragent-boglash.ts`).
 * Kassa yozuvi qarzga faqat `customerId` / `supplierId` bilan tushadi (`lib/receivables.ts`, `fin-report/balance.ts`);
 * «Kontragent» matnining o'zi hisobga kirmaydi — shu modul nomi aniq mos kelganini bog'laydi:
 *  · kirim — mijoz (qarz to'lovi); mijoz topilmasa — yetkazuvchi (undan qaytgan pul);
 *  · chiqim — yetkazuvchi (unga to'lov); manba «Sotib oluvchi pulini qaytarish» (CUSTOMER_REFUND) bo'lsa — mijoz;
 *  · xodim bilan hisob-kitob manbalari bog'lanmaydi.
 * Nom yoki boshqa nomi (alias) bo'yicha, kirill/lotin farqsiz (`matchKey`). Bir xil kalitli ikki yozuv — noaniq, bog'lanmaydi.
 */

export type Party = { id: string; name: string };
/** kalit → yozuv; `null` — bir nechta mos keladi (noaniq). */
export type PartyMap = Map<string, Party | null>;
export type PartyIndex = { customers: PartyMap; suppliers: PartyMap };

function index(list: { id: string; name: string; aliases?: string[] }[]): PartyMap {
  const m: PartyMap = new Map();
  for (const x of list) {
    for (const n of [x.name, ...(x.aliases ?? [])]) {
      const k = matchKey(n);
      if (!k) continue;
      m.set(k, m.has(k) && m.get(k)?.id !== x.id ? null : { id: x.id, name: x.name });
    }
  }
  return m;
}

export async function loadPartyIndex(): Promise<PartyIndex> {
  const [customers, suppliers] = await Promise.all([
    db.customer.findMany({ where: { isInternal: false }, select: { id: true, name: true, aliases: true } }),
    db.supplier.findMany({ select: { id: true, name: true } }),
  ]);
  return { customers: index(customers), suppliers: index(suppliers) };
}

/** `undefined` — topilmadi, `null` — noaniq (bir nechta). */
export const findParty = (m: PartyMap, raw: string | null | undefined): Party | null | undefined => {
  const k = raw ? matchKey(raw) : "";
  return k ? m.get(k) : undefined;
};

export type AutoLink = { customerId: string; supplierId?: undefined } | { supplierId: string; customerId?: undefined };

/** Kontragent matnidan avtomatik bog'lash qoidasi (yuqoridagi izoh). Mos kelmasa — null. */
export function autoLink(idx: PartyIndex, t: { type: "INCOME" | "EXPENSE"; counterparty: string | null | undefined; category: string; refund: boolean }): AutoLink | null {
  if (!t.counterparty?.trim() || isStaffSettleCategory(t.category)) return null;
  const cust = findParty(idx.customers, t.counterparty);
  const sup = findParty(idx.suppliers, t.counterparty);
  if (t.type === "INCOME") {
    if (cust) return { customerId: cust.id };
    if (cust === undefined && sup) return { supplierId: sup.id };
    return null;
  }
  if (t.refund) return cust ? { customerId: cust.id } : null;
  return sup ? { supplierId: sup.id } : null;
}
