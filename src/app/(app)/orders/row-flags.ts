import { canDo } from "@/lib/permissions";
import { isEditable } from "@/lib/orders";

/** Qator tugmalari uchun zayavkadan olinadigan maydonlar (Prisma `select`/`include` ga qo'shiladi) */
export const ROW_FLAGS_SELECT = { kind: true, status: true, batches: { select: { id: true } }, trips: { select: { status: true } } } as const;

export type OrderRowFlags = { edit: boolean; cancel: boolean };

/**
 * Ro'yxat qatoridagi «Tahrirlash» (qalam) va «Bekor qilish» — zayavka kartasidagi (`orders/[id]/page.tsx`) shart bilan aynan bir xil:
 * tahrir — ishlab chiqarish boshlanmagan (`isEditable`), bekor — qoralama/blok/tasdiqlangan, zames yo'q, reyslar bekor.
 * Mijoz zayavkasi «edit»/«cancel», sklad zayavkasi «stock» ruxsati bilan. Server amallari ham shu qoidani qayta tekshiradi.
 */
export function orderRowFlags(
  s: Parameters<typeof canDo>[0],
  o: { kind: string; status: string; batches: unknown[]; trips: { status: string }[] },
): OrderRowFlags {
  const can = (a: string) => canDo(s, "orders", o.kind === "STOCK" ? "stock" : a);
  return {
    edit: isEditable(o) && can("edit"),
    cancel: ["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status) && can("cancel") && o.batches.length === 0 && o.trips.every((t) => t.status === "CANCELLED"),
  };
}
