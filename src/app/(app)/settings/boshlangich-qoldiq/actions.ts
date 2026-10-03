"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction, requireSession } from "@/lib/auth";
import { parseForm, zOpt, zStr, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { cancelOpening, createOpening, paySupplierOpening, updateOpening } from "@/lib/opening-balances";
import { importOpenings, type OpeningRow } from "@/lib/import-openings";
import type { OpeningKind } from "@/generated/prisma";

/** Kiritish va import — direktor va buxgalteriya. */
const writer = () => requireSession(["ACCOUNTING"]);

/** Tahrir va bekor qilish — faqat direktor: tasdiqlangan boshlang'ich holat jimgina o'zgarmasin. */
async function director() {
  const s = await requireSession();
  if (s.role !== "DIRECTOR") throw new Error("Boshlang'ich qoldiqni faqat direktor o'zgartira yoki bekor qila oladi");
  return s;
}

const KINDS = ["CUSTOMER", "SUPPLIER", "CASH", "STOCK"] as const;

function refresh() {
  for (const p of ["/settings/boshlangich-qoldiq", "/customers", "/suppliers", "/payments", "/cashflow", "/invoices", "/stock", "/"]) revalidatePath(p);
}

const money = z.coerce.number({ message: "Summa raqam bo'lsin" }).refine((n) => n !== 0, "Summa 0 bo'lmasin").refine((n) => Math.abs(n) <= MAX_AMOUNT, "Summa juda katta");
const optNum = z.string().trim().optional().transform((v) => (v ? Number(v.replace(/\s+/g, "").replace(",", ".")) : null))
  .refine((v) => v == null || Number.isFinite(v), "raqam bo'lsin");

/** Ishora: MoneyInput faqat musbat qabul qiladi — yo'nalish alohida tanlanadi (qarz / avans, overdraft). */
const zSign = z.enum(["1", "-1"]).optional().transform((v) => (v === "-1" ? -1 : 1));
const signed = (amount: number | null, sign: number) => (amount == null ? undefined : amount * sign);

const createSchema = z.object({
  kind: z.enum(KINDS),
  sign: zSign,
  date: zStr("Sana kerak").refine(validDate, "Sana noto'g'ri"),
  entityId: zStr("Tanlanmagan"),
  warehouseId: zOpt,
  amount: optNum,
  qty: optNum,
  unitCost: optNum,
  note: zOpt,
});

export async function createOpeningAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(createSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.kind !== "STOCK") {
    const m = money.safeParse(d.amount);
    if (!m.success) return { error: m.error.issues[0]?.message ?? "Summa noto'g'ri" };
  }
  const res = await createOpening({
    kind: d.kind, date: new Date(d.date), note: d.note,
    amount: signed(d.amount, d.sign), qty: d.qty, unitCost: d.unitCost,
    customerId: d.kind === "CUSTOMER" ? d.entityId : null,
    supplierId: d.kind === "SUPPLIER" ? d.entityId : null,
    cashAccountId: d.kind === "CASH" ? d.entityId : null,
    productId: d.kind === "STOCK" ? d.entityId : null,
    warehouseId: d.kind === "STOCK" ? d.warehouseId : null,
  }, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "Boshlang'ich qoldiq saqlandi" };
}

const importSchema = z.object({
  rows: z.string(),
  date: zStr("Qaysi sana holatiga — sanani kiriting").refine(validDate, "Sana noto'g'ri"),
  createMissing: z.string().optional().transform((v) => v === "on"),
  warehouseId: zOpt,
});

export async function importOpeningsAction(kind: OpeningKind, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  let rows: OpeningRow[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };
  let res;
  try {
    res = await importOpenings(kind, rows, { date: new Date(r.data.date), createMissing: r.data.createMissing, warehouseId: r.data.warehouseId }, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  refresh();
  const list = (l: string[], n = 5) => `${l.slice(0, n).join(", ")}${l.length > n ? "…" : ""}`;
  return {
    ok: true,
    note: [
      `${res.created} ta boshlang'ich qoldiq yozildi`,
      res.createdEntities.length ? `bazada yo'q ${res.createdEntities.length} ta yangi karta ochildi: ${list(res.createdEntities)}` : "",
      res.skipped.length ? `${res.skipped.length} tasiga qoldiq oldin kiritilgan — o'tkazib yuborildi (${list(res.skipped)})` : "",
    ].filter(Boolean).join(" · "),
  };
}

const updateSchema = z.object({
  sign: zSign,
  date: zStr("Sana kerak").refine(validDate, "Sana noto'g'ri"),
  amount: optNum,
  qty: optNum,
  unitCost: optNum,
  note: zOpt,
});

export async function updateOpeningAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await director();
  const r = parseForm(updateSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await updateOpening(id, { date: new Date(d.date), amount: signed(d.amount, d.sign), qty: d.qty, unitCost: d.unitCost, note: d.note }, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "Saqlandi" };
}

export async function cancelOpeningAction(id: string, reason: string): Promise<ActionState> {
  const s = await director();
  if (reason.trim().length < 3) return { error: "Sababini yozing" };
  const res = await cancelOpening(id, reason.trim(), s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "Bekor qilindi" };
}

const paySchema = z.object({
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number({ message: "Summa raqam bo'lsin" }).positive("Summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "Summa juda katta"),
});

/** Yetkazuvchiga boshlang'ich qarzni to'lash — moliyaning "Yetkazuvchiga to'lash" huquqi bilan. */
export async function paySupplierOpeningAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "pay");
  const r = parseForm(paySchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await paySupplierOpening(id, r.data.cashAccountId, r.data.amount, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "To'lov yozildi" };
}
