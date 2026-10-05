"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { importParties, type PartyRow } from "@/lib/import-parties";
import { parseInn } from "@/lib/inn";

const schema = z.object({ name: zStr("Nomi kerak"), inn: zOpt, phone: zOpt, address: zOpt, contactPerson: zOpt });

export async function createSupplier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "suppliers");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  // INN: 9 (STIR) yoki 14 (JSHSHIR) raqam
  const inn = parseInn(r.data.inn);
  if (inn.error !== undefined) return { error: inn.error };
  try {
    const sup = await db.supplier.create({ data: { ...r.data, inn: inn.inn } });
    await audit(db, s.userId, "CREATE", "Supplier", sup.id, undefined, sup);
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan yetkazuvchi bor" };
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true };
}

export async function toggleSupplier(id: string) {
  const s = await requireAction("stock", "suppliers");
  const cur = await db.supplier.findUniqueOrThrow({ where: { id } });
  await db.supplier.update({ where: { id }, data: { isActive: !cur.isActive } });
  await audit(db, s.userId, "UPDATE", "Supplier", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  revalidatePath("/suppliers"); revalidatePath(`/suppliers/${id}`);
}

/** Yetkazuvchi rekvizitlarini tahrirlash (nomi, INN, telefon) — har o'zgarish auditda. */
export async function updateSupplier(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "suppliers");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const cur = await db.supplier.findUnique({ where: { id } });
  if (!cur) return { error: "Yetkazuvchi topilmadi" };
  const data = { name: r.data.name, inn: r.data.inn, phone: r.data.phone, address: r.data.address, contactPerson: r.data.contactPerson };
  // INN tekshiruvi faqat o'zgartirilganda — eski (noto'g'ri) qiymatli kartaning boshqa maydonlarini saqlash to'silmasin
  if (data.inn !== cur.inn) {
    const inn = parseInn(data.inn);
    if (inn.error !== undefined) return { error: inn.error };
    data.inn = inn.inn;
  }
  if (data.name === cur.name && data.inn === cur.inn && data.phone === cur.phone && data.address === cur.address && data.contactPerson === cur.contactPerson) return { ok: true, note: "O'zgarish yo'q" };
  if (data.inn) {
    const dup = await db.supplier.findFirst({ where: { inn: data.inn, id: { not: id } }, select: { name: true } });
    if (dup) return { error: `Bu INN «${dup.name}» da bor` };
  }
  try {
    const after = await db.supplier.update({ where: { id }, data });
    await audit(db, s.userId, "UPDATE", "Supplier", id, { name: cur.name, inn: cur.inn, phone: cur.phone, address: cur.address, contactPerson: cur.contactPerson }, { name: after.name, inn: after.inn, phone: after.phone, address: after.address, contactPerson: after.contactPerson });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan yetkazuvchi bor" };
    throw e;
  }
  revalidatePath("/suppliers"); revalidatePath(`/suppliers/${id}`);
  return { ok: true, note: "Saqlandi" };
}

// ───────────────────────── Excel'dan yetkazuvchilar ro'yxati ─────────────────────────

const importSchema = z.object({
  rows: z.string(),
  updateExisting: z.string().optional().transform((v) => v === "on"),
});

/** Yetkazuvchilar → "Excel import": Nomi, INN, Telefon, Manzil, Mas'ul shaxs. Dedupe — INN → telefon → nom. */
export async function importSuppliersFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "suppliers");
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  let rows: PartyRow[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };
  let res;
  try {
    res = await importParties("supplier", rows, { updateExisting: r.data.updateExisting, canSetLimit: false }, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/suppliers");
  return {
    ok: true,
    note: [
      `${res.created} ta yangi yetkazuvchi qo'shildi, ${res.updated} tasi yangilandi`,
      res.skipped ? `${res.skipped} tasi bazada bor — o'tkazib yuborildi${res.samples.length ? ` (${res.samples.join("; ")})` : ""}` : "",
      res.dupInFile ? `faylda ${res.dupInFile} ta takroriy qator bitta kartaga birlashdi` : "",
    ].filter(Boolean).join(" · "),
  };
}
