/**
 * Katalog bilan ariza formasi orasidagi kichik ko'prik.
 *
 * Mahsulot qatoridagi "So'rash" bosilganda forma shu mahsulotni o'zi tanlab
 * qo'yadi — mijoz ro'yxatdan qayta izlab o'tirmaydi. Ikkalasi ham mustaqil
 * klient komponent bo'lgani uchun oddiy DOM hodisasi yetarli: umumiy holat
 * kutubxonasi shu bitta narsa uchun ortiqcha.
 */

const EVENT = "insof:lead-product";

export function pickProduct(id: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }));
}

export function onPickProduct(cb: (id: string) => void) {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
