"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { RENT_EXPENSE_CATEGORIES, RENT_INCOME_CATEGORY, cancelRentTx, createRentTx, monthKey, openMonth, parseMonth, saveRentShopData } from "@/lib/rent";
import { RentImportError, importRentSheet, type RentImportRow } from "@/lib/rent-import";
import { canDo } from "@/lib/permissions";
import type { ValueMaps } from "@/lib/excel";

const done = () => revalidatePath("/arenda");
const token = (v: string | null) => (v && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null);

const txSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  method: z.enum(["CASH", "BANK"], { message: "To'lov usulini tanlang" }),
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  month: zOpt,
  shopId: zOpt,
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  category: zOpt,
  note: zOpt,
  clientToken: zOpt,
});

/** Arenda kassasiga kirim (ijarachidan, qaysi oy uchun) yoki chiqim. */
export async function saveRentTx(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "create");
  const r = parseForm(txSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const month = d.month ? parseMonth(d.month) : null;
  if (d.month && !month) return { error: "Oy noto'g'ri" };
  if (d.type === "INCOME" && !d.shopId) return { error: "Do'konni tanlang" };
  if (d.type === "INCOME" && !month) return { error: "Qaysi oy uchun to'lov — oyni tanlang" };
  const category = d.type === "INCOME" ? RENT_INCOME_CATEGORY : d.category;
  if (d.type === "EXPENSE" && !(RENT_EXPENSE_CATEGORIES as readonly string[]).includes(category ?? "")) return { error: "Chiqim turini tanlang" };
  if (d.type === "EXPENSE" && category === "Boshqa" && !d.note) return { error: "«Boshqa» chiqim uchun izoh yozing" };
  const res = await createRentTx({
    type: d.type, method: d.method, date: new Date(d.date), month, shopId: d.shopId, amount: d.amount,
    category: category!, note: d.note, clientToken: token(d.clientToken),
  }, s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true, note: res.duplicate ? "Allaqachon saqlangan (qayta bosildi)" : d.type === "INCOME" ? "Kirim saqlandi" : "Chiqim saqlandi" };
}

export async function stornoRentTx(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("arenda", "storno");
  const res = await cancelRentTx(id, reason, s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true, note: "Bekor qilindi" };
}

/** Oyni ochish — faol do'konlarga o'tgan oy hisobidan (bo'lmasa andozadan) nusxa. */
export async function openRentMonth(key: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const month = parseMonth(key);
  if (!month) return { error: "Oy noto'g'ri" };
  const { created } = await openMonth(month, s.userId);
  done();
  return { ok: true, note: created ? `${created} ta do'kon hisobi ochildi` : "Yangi do'kon yo'q — hisob avvaldan ochilgan" };
}

const chargeSchema = z.object({
  bankDue: zDec(), cashDue: zDec(), electricity: zDec(), tax: zDec(), note: zOpt,
});

/** Oy varag'idagi qatorni tahrirlash (do'konning shu oy hisobi). Hisob bo'lmasa — ochiladi. */
export async function saveRentCharge(shopId: string, key: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const month = parseMonth(key);
  if (!month) return { error: "Oy noto'g'ri" };
  const r = parseForm(chargeSchema, fd);
  if ("error" in r) return { error: r.error };
  const before = await db.rentCharge.findUnique({ where: { shopId_month: { shopId, month } } });
  if (!before && !(await db.rentShop.findUnique({ where: { id: shopId }, select: { id: true } }))) return { error: "Do'kon topilmadi" };
  const c = await db.rentCharge.upsert({
    where: { shopId_month: { shopId, month } },
    create: { shopId, month, ...r.data },
    update: r.data,
  });
  await audit(db, s.userId, before ? "UPDATE" : "CREATE", "RentCharge", c.id, before ?? undefined, c);
  done();
  return { ok: true };
}

const shopSchema = z.object({
  id: zOpt,
  name: zStr("Do'kon nomini yozing").max(200, "nom juda uzun"),
  location: zStr("Joy (bozor) ni yozing").max(120, "nom juda uzun"),
  bankAmount: zDec(), cashAmount: zDec(), electricity: zDec(), tax: zDec(),
  note: zOpt,
  // Qo'shilganda shu oy hisobi ochilgan bo'lsa — yangi do'kon ham shu oyga tushadi
  month: zOpt,
});

export async function saveRentShop(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(shopSchema, fd);
  if ("error" in r) return { error: r.error };
  const { id, month: key, ...data } = r.data;
  // Qoida `lib/rent.ts` da — mobil do'kon kartochkasi ham shuni chaqiradi
  const res = await saveRentShopData(id, data, id ? null : parseMonth(key), s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true, note: id ? "Do'kon saqlandi" : "Do'kon qo'shildi" };
}

/** Do'konni faolsizlantirish/qaytarish — keyingi oylar ochilganda hisobga tushmaydi, tarix joyida qoladi. */
export async function toggleRentShop(id: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const shop = await db.rentShop.findUnique({ where: { id } });
  if (!shop) return { error: "Do'kon topilmadi" };
  const ok = await db.rentShop.updateMany({ where: { id, isActive: shop.isActive }, data: { isActive: !shop.isActive } });
  if (ok.count) await audit(db, s.userId, "STATUS_CHANGE", "RentShop", id, { isActive: shop.isActive }, { isActive: !shop.isActive });
  done();
  return { ok: true, note: shop.isActive ? "Do'kon faolsizlantirildi" : "Do'kon qayta faollashtirildi" };
}

const importSchema = z.object({
  month: zStr("Oyni tanlang"),
  rows: zStr("Excel ma'lumotlari yo'q"),
  valueMaps: zOpt,
  groupRows: z.string().optional().transform((v) => v === "on"),
  withPayments: z.string().optional().transform((v) => v === "on"),
});

/** Excel'dagi oy varag'ini import: do'konlar, shu oy hisobi va (belgilansa) tushgan pul — `lib/rent-import.ts`. */
export async function importRentFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const month = parseMonth(d.month);
  if (!month) return { error: "Oy noto'g'ri" };
  if (d.withPayments && !canDo(s, "arenda", "create")) return { error: "Tushgan pulni kirim qilishga ruxsatingiz yo'q — «To'langan summalarni kirim qilish» belgisini olib tashlang" };
  let rows: unknown;
  let valueMaps: ValueMaps = {};
  try {
    rows = JSON.parse(d.rows);
    const raw: unknown = d.valueMaps ? JSON.parse(d.valueMaps) : {};
    const loc = (raw as Record<string, unknown>)?.location;
    if (loc && typeof loc === "object") valueMaps = { location: Object.fromEntries(Object.entries(loc).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "")) };
  } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };
  let res;
  try {
    res = await importRentSheet({ month, rows: rows as RentImportRow[], groupRows: d.groupRows, withPayments: d.withPayments, valueMaps }, s.userId);
  } catch (e) {
    if (e instanceof RentImportError) return { error: e.message };
    throw e;
  }
  done();
  redirect(`/arenda?oy=${monthKey(month)}&import=${res.shops}-${res.newShops}-${res.payments}-${res.replaced}-${res.skipped}`);
}
