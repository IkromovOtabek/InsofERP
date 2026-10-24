/**
 * Zayavka summasi — yagona qoida: mahsulot qatorlari (miqdor × narx, narxda NDS bor) + dastavka summasi.
 * Limit, bosh to'lov, schyot, qarz va hisobotlar shu funksiya bilan hisoblanadi.
 * Server importlari yo'q — brauzerdagi forma ham ishlatadi.
 */
type Num = number | string | { toString(): string } | null | undefined;

/** Faqat mahsulot qatorlari (dastavkasiz). */
export function itemsTotal(items: readonly { qtyM3: Num; price: Num }[]): number {
  return items.reduce((s, i) => s + Number(i.qtyM3 ?? 0) * Number(i.price ?? 0), 0);
}

/** Zayavka jami = mahsulot qatorlari + dastavka. */
export function orderTotal(o: { items: readonly { qtyM3: Num; price: Num }[]; deliveryFee: Num }): number {
  return itemsTotal(o.items) + Number(o.deliveryFee ?? 0);
}
