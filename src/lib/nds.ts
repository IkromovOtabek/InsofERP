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
