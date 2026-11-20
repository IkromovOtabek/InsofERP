/**
 * NDS (QQS) hisobi — zayavkadagi mahsulot narxi yonidagi "NDS 12%" tugmasi uchun.
 *
 * Kelishuv: `OrderItem.price` da **NDS qo'shilgan** narx turadi (shuning uchun limit,
 * bosh to'lov, schyot va qarz hisobi avvalgidek `miqdor × narx` bo'yicha ishlaydi),
 * `OrderItem.nds` esa shu narxga soliq qo'shilganini eslatib turadi — hujjatda
 * "shundan NDS 12%" qatorini ko'rsatish uchun.
 */

/** Soliq stavkasi — O'zbekistonda QQS 12%. */
export const NDS_RATE = 0.12;
export const NDS_LABEL = "NDS 12%";

/** Tiyinga yaxlitlash (Decimal(18,2) ga mos). */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** NDS'siz narxga soliqni qo'shadi: 1 000 000 → 1 120 000. */
export const withNds = (price: number) => r2(price * (1 + NDS_RATE));

/** NDS'siz narxdan soliq summasi: 1 000 000 → 120 000. */
export const ndsOf = (price: number) => r2(price * NDS_RATE);

/** NDS qo'shilgan narxdan soliq qismini ajratadi: 1 120 000 → 120 000. */
export const ndsPart = (priceWithNds: number) => r2((priceWithNds * NDS_RATE) / (1 + NDS_RATE));

/** NDS qo'shilgan narxdan soliqsiz qismini ajratadi: 1 120 000 → 1 000 000. */
export const withoutNds = (priceWithNds: number) => r2(priceWithNds / (1 + NDS_RATE));

/** QQS bilan summani QQS'siz qismi va QQS'iga bo'ladi, yig'indisi aynan asl summa: 1 120 000 → 1 000 000 + 120 000. */
export function splitNds(gross: number) {
  const net = withoutNds(gross);
  return { net, vat: r2(gross - net) };
}

/**
 * Zayavka dastavkasi (`Order.deliveryFee`) QQS bilanmi. Alohida belgi yo'q: zayavka formasida va Excel ko'rinishda dastavka
 * QQS'i mahsulot qatorlari bilan birga yoqiladi (perechisleniyeda — doim) va summa QQS qo'shilib saqlanadi.
 * Shuning uchun qatorlardan birida «NDS 12%» bo'lsa — dastavka ham QQS bilan.
 */
export const feeHasNds = (items: { nds: boolean }[]) => items.some((i) => i.nds);

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Realizatsiya reestrining qo'lda / Excel qatori (`RealizationEntry`) QQS'i: narx va dastavka QQS'siz kiritiladi,
 * perechisleniyeda 12% — mahsulotdan (miqdor × narx) ham, dastavkadan ham; naqd va qarzga — QQS yo'q. Summalar 3 xonagacha.
 */
export function entryNds(payGroup: string, qty: number, price: number, delivery: number) {
  if (payGroup !== "BANK") return { goods: 0, delivery: 0, total: 0 };
  const goods = r3(qty * price * NDS_RATE), fee = r3(delivery * NDS_RATE);
  return { goods, delivery: fee, total: r3(goods + fee) };
}
