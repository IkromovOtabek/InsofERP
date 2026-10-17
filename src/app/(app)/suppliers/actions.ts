"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { importParties, type PartyRow } from "@/lib/import-parties";
import { parseInn } from "@/lib/inn";
import { updateSupplierRequisites } from "@/lib/supplier-edit";

// vatPayer: "1" — QQS to'lovchisi (kirimga 12% QQS), "0" — yo'q; berilmasa: yangi kartada "1", tahrirda o'zgarmaydi
const schema = z.object({ name: zStr("Nomi kerak"), inn: zOpt, phone: zOpt, address: zOpt, contactPerson: zOpt, vatPayer: z.enum(["0", "1"]).optional() });

export async function createSupplier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "suppliers");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  // INN: 9 (STIR) yoki 14 (JSHSHIR) raqam
  const inn = parseInn(r.data.inn);
  if (inn.error !== undefined) return { error: inn.error };
  try {
    const { vatPayer, ...rest } = r.data;
    const sup = await db.supplier.create({ data: { ...rest, inn: inn.inn, vatPayer: vatPayer !== "0" } });
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

/** Yetkazuvchi rekvizitlarini tahrirlash (nomi, INN, telefon) — qoida `lib/supplier-edit.ts` da (mobil ilova ham shundan). */
export async function updateSupplier(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "suppliers");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const res = await updateSupplierRequisites(id, {
    name: r.data.name, inn: r.data.inn, phone: r.data.phone, address: r.data.address, contactPerson: r.data.contactPerson,
    vatPayer: r.data.vatPayer == null ? null : r.data.vatPayer === "1",
  }, s.userId);
  if ("error" in res) return { error: res.error };
  if (res.note === "O'zgarish yo'q") return { ok: true, note: res.note };
  revalidatePath("/suppliers"); revalidatePath(`/suppliers/${id}`); revalidatePath("/receipts/new"); revalidatePath("/receipts/import");
  return { ok: true, note: res.note };
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
