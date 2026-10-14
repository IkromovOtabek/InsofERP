"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canDo } from "@/lib/permissions";
import { parseInn } from "@/lib/inn";
import { upsertRecipient } from "@/lib/stock-recipients";

/**
 * Formadagi tanlash maydoni ichidagi «+» tugmasi (`components/quick-add.tsx`): ro'yxatda yo'q yozuvni
 * forma ichidan qo'shish. Natija — yangi tanlov (`id`, `name`), forma uni darhol tanlab qo'yadi.
 */
export type QuickAddResult = { error: string } | { id: string; name: string; vatPayer?: boolean };

const text = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Yangi yetkazuvchi («Kimdan»): nomi, ixtiyoriy INN, QQS to'lovchisimi. Huquq — Yetkazuvchilar bo'limi bilan bir xil. */
export async function quickAddSupplier(fd: FormData): Promise<QuickAddResult> {
  const s = await requireAction("stock", "suppliers");
  const name = text(fd, "name", 200);
  if (!name) return { error: "Yetkazuvchi nomini kiriting" };
  const inn = parseInn(fd.get("inn"));
  if (inn.error !== undefined) return { error: inn.error };
  const dup = await db.supplier.findFirst({
    where: inn.inn ? { OR: [{ inn: inn.inn }, { name: { equals: name, mode: "insensitive" } }] } : { name: { equals: name, mode: "insensitive" } },
    select: { name: true, inn: true, isActive: true },
  });
  if (dup) return { error: `«${dup.name}» yetkazuvchisi allaqachon bor${dup.isActive ? " — ro'yxatdan tanlang" : " (yopilgan — Yetkazuvchilar bo'limida faollashtiring)"}` };
  try {
    const sup = await db.supplier.create({ data: { name, inn: inn.inn, vatPayer: fd.get("vatPayer") !== "0" } });
    await audit(db, s.userId, "CREATE", "Supplier", sup.id, undefined, { ...sup, via: "quick-add" });
    revalidatePath("/suppliers");
    return { id: sup.id, name: sup.name, vatPayer: sup.vatPayer };
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan yetkazuvchi bor" };
    throw e;
  }
}

/**
 * Yangi oluvchi («Kimga» ro'yxati — kirimda ham, chiqimda ham bitta ro'yxat). Kirim yoki chiqim yozuvchi qo'sha oladi.
 * Qoida `lib/stock-recipients.ts#upsertRecipient` da (nom takrorlanmaydi).
 */
export async function quickAddRecipient(fd: FormData): Promise<QuickAddResult> {
  const s = await getSession();
  if (!s || !(canDo(s, "stock", "issue") || canDo(s, "stock", "receipt"))) return { error: "Bu amal uchun sizda ruxsat yo'q — direktordan ruxsat so'rang" };
  const name = text(fd, "name", 80);
  const res = await upsertRecipient({ name, note: text(fd, "note", 200) || null }, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock/rasxod");
  return { id: res.id, name };
}
