import type { OrderStatus } from "@/generated/prisma";

/**
 * Ishlab chiqarish oynasining zayavka filtrlari — yagona joy:
 * veb "/production" sahifasi ham, mobil "Zayavkalar" ro'yxati ham shu qoidalardan foydalanadi,
 * shunda ikkala ekranda bir xil raqam chiqadi.
 */
const DAY = 86400000;
const OPEN: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PRODUCTION"];

/** Yetkazish kuniga necha kun qoldi (bugun = 0, o'tgan = manfiy). */
export const daysLeft = (d: Date) => {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return Math.round((x.getTime() - t.getTime()) / DAY);
};

/** "Bugun", "Ertaga", "3 kun qoldi", "2 kun kechikdi". */
export const dueLabel = (d: Date) => {
  const left = daysLeft(d);
  return left < 0 ? `${-left} kun kechikdi` : left === 0 ? "Bugun" : left === 1 ? "Ertaga" : `${left} kun qoldi`;
};

/** Filtrlar uchun kerak bo'lgani — zayavkaning qatorlari va topshiriq holati. */
export type ProdOrder = {
  status: OrderStatus;
  deliveryDate: Date;
  /** Sana aniq emas (qoralama) — muddat hisoblanmaydi */
  dateUnknown?: boolean;
  isUrgent: boolean;
  items: { qtyM3: unknown; tasks: { status: string; qty: unknown; doneQty: unknown }[] }[];
};

export type ItemTask = { status: string; qty?: unknown; doneQty?: unknown };

/**
 * Zayavka qatorining topshiriqlari bo'yicha holat. Qator bir nechta brigadaga bo'lib berilishi mumkin:
 * tayinlangan = faol topshiriqlar miqdori + bekor qilinganlarda bajarib ulgurilgani (u hovlida turibdi).
 * `left` — hali hech bir brigadaga berilmagan qism, «Brigada tayinlash» shuni taklif qiladi.
 */
export function itemTasks(itemQty: unknown, tasks: ItemTask[]) {
  const qty = Number(itemQty);
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  const given = live.reduce((s, t) => s + Number(t.qty ?? 0), 0) + tasks.filter((t) => t.status === "CANCELLED").reduce((s, t) => s + Number(t.doneQty ?? 0), 0);
  const full = given >= qty - 0.0005;
  return {
    given, left: Math.max(0, qty - given), full, any: live.length > 0,
    /** Hammasi brigadalarga berilgan va hamma faol topshiriq bajarilgan */
    done: full && live.length > 0 && live.every((t) => t.status === "DONE"),
    /** Faol topshiriqlarda bajarilgani (bekor qilinganlar hisobga olinmaydi — avvalgi qoida) */
    doneQty: live.reduce((s, t) => s + Number(t.doneQty ?? 0), 0),
  };
}

/** Hamma qatorning to'liq miqdori brigadalarga berilgan (bir qator bir nechta brigadaga bo'lingan bo'lishi mumkin). */
export const assigned = (o: ProdOrder) => o.items.length > 0 && o.items.every((i) => itemTasks(i.qtyM3, i.tasks).full);
/** Bir qismi brigadaga berilgan. */
export const partlyAssigned = (o: ProdOrder) => !assigned(o) && o.items.some((i) => itemTasks(i.qtyM3, i.tasks).given > 0);
export const isOpen = (o: ProdOrder) => OPEN.includes(o.status);
/** Yopilgan: yetkazilgan/yopilgan yoki hammasi brigadalarga berilib, barcha topshiriqlari bajarilgan. */
export const isDone = (o: ProdOrder) => o.status === "DELIVERED" || o.status === "CLOSED" || (o.items.length > 0 && o.items.every((i) => itemTasks(i.qtyM3, i.tasks).done));
/** Muddati yaqin — ochiq va yetkazishgacha 2 kundan kam qolgan (kechikkanlar ham). */
export const isSoon = (o: ProdOrder) => isOpen(o) && !o.dateUnknown && daysLeft(o.deliveryDate) <= 2;

export type ProdFilter = { key: string; label: string; test: (o: ProdOrder) => boolean };

export const PRODUCTION_FILTERS: ProdFilter[] = [
  { key: "open", label: "Ochiq", test: (o) => isOpen(o) && !isDone(o) },
  { key: "today", label: "Bugungilar", test: (o) => daysLeft(o.deliveryDate) === 0 },
  { key: "soon", label: "Muddati yaqin", test: isSoon },
  { key: "unassigned", label: "Brigada kutayotgan", test: (o) => isOpen(o) && !assigned(o) },
  { key: "urgent", label: "Zarur", test: (o) => isOpen(o) && o.isUrgent },
  { key: "done", label: "Tugallanganlar", test: isDone },
  { key: "all", label: "Hammasi", test: () => true },
];

export const prodFilter = (key?: string) => PRODUCTION_FILTERS.find((f) => f.key === key) ?? PRODUCTION_FILTERS[0];

/** Muddati yaqinlar eng tepada, keyin zarurlar, keyin yetkazish sanasi bo'yicha. */
export const prodRank = (o: ProdOrder) => (isSoon(o) ? 0 : 1) * 10 + (o.isUrgent ? 0 : 1);
export const prodSort = <T extends ProdOrder>(list: T[]) =>
  [...list].sort((a, b) => prodRank(a) - prodRank(b) || a.deliveryDate.getTime() - b.deliveryDate.getTime());
