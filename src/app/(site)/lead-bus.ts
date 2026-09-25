/**
 * Katalog, kalkulyator va ariza formasi orasidagi kichik ko'prik.
 *
 * Mahsulot qatoridagi "So'rash" bosilganda forma shu mahsulotni o'zi tanlab
 * qo'yadi — mijoz ro'yxatdan qayta izlab o'tirmaydi. Kalkulyator esa hisoblab
 * chiqqan hajmni formaga uzatadi. Hammasi mustaqil klient komponent bo'lgani
 * uchun oddiy DOM hodisasi yetarli: umumiy holat kutubxonasi shu ikki narsa
 * uchun ortiqcha.
 */

const PRODUCT = "insof:lead-product";
const QTY = "insof:lead-qty";

export function pickProduct(id: string) {
  window.dispatchEvent(new CustomEvent<string>(PRODUCT, { detail: id }));
}

export function onPickProduct(cb: (id: string) => void) {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(PRODUCT, handler);
  return () => window.removeEventListener(PRODUCT, handler);
}

export function pickQty(qty: string) {
  window.dispatchEvent(new CustomEvent<string>(QTY, { detail: qty }));
}

export function onPickQty(cb: (qty: string) => void) {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(QTY, handler);
  return () => window.removeEventListener(QTY, handler);
}

/** Formaga sirg'alib borish — katalog va kalkulyator bitta yo'ldan yuradi. */
export function scrollToForm() {
  document.getElementById("ariza")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
