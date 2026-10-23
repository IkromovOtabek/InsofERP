import type { Role } from "@/generated/prisma";

/**
 * Logistika kabineti (ilova) — ro'yxat, kartochka va amallar kimga ochiq. Jadvallar alohida faylda
 * (`hr-access.ts` kabi): `list.ts` / `detail.ts` ularni modul yuklanishida yoyadi, `logistika-extra.ts`
 * esa o'sha fayllarni import qiladi — aylanma import sababli qiymat `undefined` bo'lib qolmasin.
 *
 * Rollar veb ERP bilan bir xil: ro'yxat — `lib/nav.ts` (sahifa `requireRoles` + `logistika` moduli),
 * amal — `lib/permissions.ts` katalogi (`PERM` — modul + amal, direktor ruxsati ham shu orqali).
 */

/** Ro'yxatlar (`list.ts` ACCESS). Tartib — bosh ekrandagi "Tezkor amallar" to'ri. */
export const LOGI_ACCESS: Record<string, { title: string; roles: Role[]; menuHide?: Role[] }> = {
  // Veb «Logistika → Buyurtmalar»: dastavkali zayavkalar logistika holati bilan (`orderLogistics`)
  "logi-orders": { title: "Buyurtmalar", roles: ["LOGISTICS"] },
  // Veb «Dispetcher kalendari» — ro'yxat ko'rinishida: kun bo'yicha reja, soatsiz va oldingi kundan qolganlar
  "logi-day": { title: "Dispetcher kalendari", roles: ["LOGISTICS"] },
  // Veb «Transport» — logistika, mexanik va dispetcher
  vehicles: { title: "Transport", roles: ["LOGISTICS", "MECHANIC", "DISPATCHER"] },
  // Veb Transport ⇢ «Yoqilg'i», «Transport xarajatlari» va Reyslar ⇢ «Nakladnoylar», «Yetkazib berish» —
  // logistika va buxgalteriya (TZ 15: logistika buxgalteri). Vebda bo'lim tablaridan ochiladi, ilovada to'rda
  fuel: { title: "Yoqilg'i", roles: ["LOGISTICS", "ACCOUNTING"] },
  expenses: { title: "Transport xarajatlari", roles: ["LOGISTICS", "ACCOUNTING"] },
  waybills: { title: "Nakladnoylar", roles: ["LOGISTICS", "ACCOUNTING"] },
  deliveries: { title: "Yetkazib berish", roles: ["LOGISTICS", "ACCOUNTING"] },
  // Veb «Hisobotlar» / «Analitika» — davr bo'yicha xulosa kartasi (Excel'siz); buxgalteriya menyusida yo'q (vebdagidek)
  "logi-report": { title: "Logistika hisobotlari", roles: ["LOGISTICS", "ACCOUNTING"], menuHide: ["ACCOUNTING"] },
  // Veb «Obyektlar» — sotuvda menyuda yo'q (mijoz kartasidan ochiladi), ruxsat qoladi
  sites: { title: "Obyektlar", roles: ["LOGISTICS", "SALES"], menuHide: ["SALES"] },
};

/** Ro'yxat/kartochka kaliti → veb modul (direktor "yo'q" qilsa ochilmaydi). */
export const LOGI_KEY_MODULE: Record<string, string> = Object.fromEntries(
  [...Object.keys(LOGI_ACCESS), "fuel", "expenses"].map((k) => [k, "logistika"]),
);

/** Ro'yxat qatori → kartochka kaliti (zayavka / reys kartochkasi ochiladi). */
export const LOGI_DETAIL_KEY: Record<string, string> = { "logi-orders": "orders", "logi-day": "orders", waybills: "trips", deliveries: "trips" };

/** Maxfiy kartochkalar (id bilan so'ralsa ham) — veb sahifa rollari bilan bir xil. */
export const LOGI_DETAIL_ROLES: Record<string, Role[]> = {
  vehicles: ["LOGISTICS", "MECHANIC", "DISPATCHER"],
  fuel: ["LOGISTICS", "ACCOUNTING"],
  expenses: ["LOGISTICS", "ACCOUNTING"],
  sites: ["LOGISTICS", "SALES"],
  "logi-report": ["LOGISTICS", "ACCOUNTING"],
};

/** Amal → veb katalogdagi modul va amal (`lib/permissions.ts`). */
export const LOGI_PERM: Record<string, { module: string; action: string }> = {
  "trip.dispatch.onroad": { module: "trips", action: "move" },
  "trip.dispatch.delivered": { module: "trips", action: "move" },
  "trip.pickup": { module: "trips", action: "create" },
  "trip.cost": { module: "trips", action: "cost" },
  "trip.pull": { module: "trips", action: "create" },
  "order.trip": { module: "trips", action: "create" },
  "vehicle.edit": { module: "logistika", action: "vehicle" },
  "vehicle.status": { module: "logistika", action: "service" },
  "vehicle.service": { module: "logistika", action: "service" },
  "vehicle.service.cancel": { module: "logistika", action: "service" },
  "vehicle.fuel": { module: "logistika", action: "fuel" },
  "vehicle.expense": { module: "logistika", action: "expense" },
  // Xato yozuvni bekor qilish (o'chirilmaydi) — vebda ham `fuel` amali bilan (`cancelFuel` / `cancelExpense`)
  "fuel.cancel": { module: "logistika", action: "fuel" },
  "expense.cancel": { module: "logistika", action: "fuel" },
  "site.save": { module: "logistika", action: "sites" },
  "driver.card": { module: "logistika", action: "drivers" },
  "driver.link": { module: "trips", action: "drivers" },
  "driver.approve": { module: "trips", action: "drivers" },
};

/**
 * Kim tugmani ko'radi (rol bo'yicha, direktor ruxsat bermagan holatda) — katalogdagi `roles` bilan bir xil.
 * Direktor bu yerda yo'q: mobil ilovada u nazorat qiladi, tugma — mas'ul xodimniki (`detail.ts` `can` izohi).
 */
export const LOGI_ACTION_ROLES: Record<string, Role[]> = {
  "trip.dispatch.onroad": ["LOGISTICS"],
  "trip.dispatch.delivered": ["LOGISTICS"],
  "trip.pickup": ["LOGISTICS", "PRODUCTION"],
  "trip.cost": ["LOGISTICS", "ACCOUNTING"],
  "trip.pull": ["LOGISTICS", "PRODUCTION"],
  // Nakladnoyning ommaviy tekshiruv sahifasi (QR) — ilova ichida havola, holat o'zgarmaydi
  "trip.waybill": ["LOGISTICS", "PRODUCTION", "SUPERVISOR", "MECHANIC", "ACCOUNTING", "DRIVER", "DIRECTOR"],
  "order.trip": ["LOGISTICS", "PRODUCTION"],
  "vehicle.edit": ["LOGISTICS", "DISPATCHER"],
  "vehicle.status": ["LOGISTICS", "MECHANIC", "DISPATCHER"],
  "vehicle.service": ["LOGISTICS", "MECHANIC", "DISPATCHER"],
  "vehicle.service.cancel": ["LOGISTICS", "MECHANIC", "DISPATCHER"],
  "vehicle.fuel": ["LOGISTICS", "ACCOUNTING"],
  "vehicle.expense": ["LOGISTICS", "ACCOUNTING", "MECHANIC"],
  "fuel.cancel": ["LOGISTICS", "ACCOUNTING"],
  "expense.cancel": ["LOGISTICS", "ACCOUNTING"],
  "site.save": ["LOGISTICS", "SALES"],
  "driver.card": ["LOGISTICS", "DISPATCHER"],
  "driver.link": ["LOGISTICS", "HR", "DISPATCHER"],
  "driver.approve": ["LOGISTICS", "HR", "DISPATCHER"],
};

/** Yangi hujjat formalari (`create.ts` CREATE_ROLES / CREATE_PERM) — kalit ro'yxat kaliti bilan bir xil ("+" tugmasi). */
export const LOGI_CREATE: Record<string, { roles: Role[]; title: string; label: string; perm: { module: string; action: string } }> = {
  vehicles: { roles: ["LOGISTICS", "DISPATCHER"], title: "Yangi transport", label: "Transport qo'shish", perm: { module: "logistika", action: "vehicle" } },
  fuel: { roles: ["LOGISTICS", "ACCOUNTING"], title: "Zapravka", label: "Zapravka qo'shish", perm: { module: "logistika", action: "fuel" } },
  expenses: { roles: ["LOGISTICS", "ACCOUNTING"], title: "Transport xarajati", label: "Xarajat qo'shish", perm: { module: "logistika", action: "expense" } },
  sites: { roles: ["LOGISTICS", "SALES"], title: "Yangi obyekt", label: "Obyekt qo'shish", perm: { module: "logistika", action: "sites" } },
};
