import type { Role } from "@/generated/prisma";

/** Lavozim → tizim roli. Rolli lavozim egasi login oladi va faqat o'z bo'limini ko'radi. */
export const POSITIONS: { label: string; role: Role | null }[] = [
  { label: "Sotuv", role: "SALES" },
  { label: "Ishlab chiqarish", role: "PRODUCTION" },
  { label: "Logistika", role: "LOGISTICS" },
  { label: "Buxgalteriya", role: "ACCOUNTING" },
  { label: "Finance", role: "FINANCE" },
  { label: "Otdel kadr", role: "HR" },
  { label: "Sklad", role: "WAREHOUSE" },
  { label: "Snabjeniye", role: "PROCUREMENT" },
  { label: "Kassa / bank", role: "CASHIER" },
  { label: "Direktor", role: "DIRECTOR" },
  { label: "Haydovchi", role: null },
  { label: "Operator", role: null },
  { label: "Laborant", role: null },
  { label: "Skladchi", role: null },
  { label: "Master", role: null },
];

export const roleForPosition = (position: string): Role | null =>
  POSITIONS.find((p) => p.label.toLowerCase() === position.trim().toLowerCase())?.role ?? null;
