import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { orderCancel } from "@/lib/orders";
import { removeContractFile, saveContractFile } from "@/lib/uploads";

/**
 * Zayavka hujjatlari va holat amallari — veb (`orders/actions.ts`) va mobil ilova (`lib/mobile/sotuv-extra.ts`)
 * uchun bitta qoida: sabab bilan bekor qilish, sklad zayavkasini yopish, kafolat xati belgisi, shartnoma.
 * Ruxsat (`requireAction` / mobil `can`) chaqiruvchida tekshiriladi.
 */

export type OrderDocResult = { ok: true; note?: string } | { ok: false; error: string };

/** Bekor qilish — sabab majburiy (kamida 3 belgi) va auditga yoziladi; qoida `orderCancel` da. */
export async function cancelOrderWithReason(id: string, reason: string, userId: string): Promise<OrderDocResult> {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { ok: false, error: "Bekor qilish sababini yozing" };
  const r = await orderCancel(id, userId);
  if (r.error) return { ok: false, error: r.error };
  await audit(db, userId, "UPDATE", "Order", id, undefined, { cancelReason: why });
  return { ok: true, note: "Zayavka bekor qilindi" };
}

/**
 * Sklad zayavkasini yopish: so'ralgan zaxira hovliga chiqarib qo'yilgan.
 * Mijoz zayavkasi bunday yopilmaydi — u schyot/to'lov bo'yicha yopiladi.
 */
export async function closeStockOrderLib(id: string, userId: string): Promise<OrderDocResult> {
  const o = await db.order.findUnique({ where: { id }, select: { kind: true, status: true } });
  if (!o) return { ok: false, error: "Zayavka topilmadi" };
  if (o.kind !== "STOCK") return { ok: false, error: "Bu tugma faqat sklad zayavkasi uchun" };
  if (!["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { ok: false, error: "Faqat qabul qilingan sklad zayavkasi yopiladi" };
  const done = await db.$transaction(async (tx) => {
    // Holat sharti bilan: ikki marta bosilsa ikkinchisi hech narsa yozmaydi
    const r = await tx.order.updateMany({ where: { id, status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, data: { status: "CLOSED" } });
    if (!r.count) return false;
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CLOSED", kind: "STOCK" });
    return true;
  });
  if (!done) return { ok: false, error: "Zayavka shu payt o'zgardi — sahifani yangilang" };
  return { ok: true, note: "Sklad zayavkasi yopildi — zaxira tayyor" };
}

/**
 * Mijoz imzolagan kafolat xati qabul qilindi (`on`) / belgi olib tashlandi.
 * Shartli yozuv: shu orada boshqa xodim xuddi shu belgini qo'ygan bo'lsa — qayta yozilmaydi.
 */
export async function setGuarantee(id: string, on: boolean, userId: string): Promise<OrderDocResult> {
  const o = await db.order.findUnique({ where: { id }, select: { guaranteeAt: true } });
  if (!o) return { ok: false, error: "Zayavka topilmadi" };
  const guaranteeAt = on ? new Date() : null;
  const done = await db.$transaction(async (tx) => {
    const r = await tx.order.updateMany({ where: { id, guaranteeAt: on ? null : { not: null } }, data: { guaranteeAt } });
    if (!r.count) return false;
    await audit(tx, userId, "UPDATE", "Order", id, { guaranteeAt: o.guaranteeAt }, { guaranteeAt });
    return true;
  });
  if (!done) return { ok: true, note: on ? "Kafolat xati allaqachon qabul qilingan" : "Belgi allaqachon olib tashlangan" };
  return { ok: true, note: on ? "Imzolangan kafolat xati qabul qilindi" : "Kafolat xati belgisi olib tashlandi" };
}

/**
 * Mavjud zayavkaga shartnoma qo'shish / summasini o'zgartirish / Didox'da imzolangan faylni yuklash (almashtirish).
 * Raqam bir marta beriladi. Fayl `uploads/contracts/` ga yoziladi — isbot uchun tizimda saqlanadi.
 */
export async function setOrderContract(id: string, contractAmount: number, file: FormDataEntryValue | null, userId: string): Promise<OrderDocResult> {
  if (!(Number.isFinite(contractAmount) && contractAmount > 0)) return { ok: false, error: "Shartnoma summasi 0 dan katta bo'lsin" };
  const o = await db.order.findUnique({ where: { id } });
  if (!o) return { ok: false, error: "Zayavka topilmadi" };
  if (o.status === "CANCELLED") return { ok: false, error: "Bekor qilingan zayavkaga shartnoma qo'shib bo'lmaydi" };
  const saved = await saveContractFile(id, file);
  if (saved && "error" in saved) return { ok: false, error: saved.error };
  const no = await db.$transaction(async (tx) => {
    const data = {
      contractAmount, contractAt: o.contractAt ?? new Date(), contractNo: o.contractNo ?? (await nextNo(tx, "contract", "SH")),
      ...(saved ? { contractFile: saved.stored, contractFileName: saved.name, contractFileType: saved.type, contractFileAt: new Date() } : {}),
    };
    await tx.order.update({ where: { id }, data });
    await audit(tx, userId, "UPDATE", "Order", id, { contractAmount: o.contractAmount, contractNo: o.contractNo, contractFile: o.contractFile }, data);
    return data.contractNo;
  });
  if (saved && o.contractFile && o.contractFile !== saved.stored) await removeContractFile(o.contractFile); // almashtirilgan eski fayl
  return { ok: true, note: `Shartnoma ${no} saqlandi${saved ? " — imzolangan fayl yuklandi" : ""}` };
}
