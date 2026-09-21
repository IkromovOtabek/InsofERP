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
  isUrgent: boolean;
  items: { task: { status: string } | null }[];
};

/** Hamma qatorga brigada topshirig'i yuborilganmi. */
export const assigned = (o: ProdOrder) => o.items.length > 0 && o.items.every((i) => !!i.task);
/** Bir qismiga topshiriq yuborilgan. */
export const partlyAssigned = (o: ProdOrder) => !assigned(o) && o.items.some((i) => !!i.task);
export const isOpen = (o: ProdOrder) => OPEN.includes(o.status);
/** Yopilgan: yetkazilgan/yopilgan yoki barcha topshiriqlari bajarilgan. */
export const isDone = (o: ProdOrder) => o.status === "DELIVERED" || o.status === "CLOSED" || (assigned(o) && o.items.every((i) => i.task?.status === "DONE"));
/** Muddati yaqin — ochiq va yetkazishgacha 2 kundan kam qolgan (kechikkanlar ham). */
export const isSoon = (o: ProdOrder) => isOpen(o) && daysLeft(o.deliveryDate) <= 2;

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
