/**
 * Ta'minot zanjirining klient tomoni ham ishlatadigan konstantalar.
 * `lib/supply.ts` Prisma'ga bog'langan (server), shuning uchun "use client" fayllar shu yerdan oladi.
 */

/** Molni kim olib keladi: "Ko'cha" — tashqi mashina (narxi kelishiladi), "O'zimiz" — o'z haydovchimiz. */
export const DELIVERY_KINDS = ["Ko'cha", "O'zimiz"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/** "O'zimiz" tanlansa transport maydoni haydovchilarimiz ro'yxatiga aylanadi. */
export const DELIVERY_OWN: DeliveryKind = "O'zimiz";
