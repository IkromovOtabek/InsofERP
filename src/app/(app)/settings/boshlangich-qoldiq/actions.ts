"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction, requireModuleWrite, requireSession } from "@/lib/auth";
import { AccessDenied } from "@/lib/access-denied";
import { parseForm, zOpt, zStr, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { cancelOpening, createOpening, OPENING_WRITERS, paySupplierOpening, reduceOpening, reverseSupplierOpeningPayment, updateOpening } from "@/lib/opening-balances";
import { importDebtBalances, importOpenings, type OpeningRow } from "@/lib/import-openings";
import type { OpeningKind } from "@/generated/prisma";

/**
 * Kiritish va import — direktor va buxgalteriya; direktor bergan modul ruxsati ("opening") ham hisobga olinadi.
 * Finance sahifani ko'radi (yetkazuvchi qarzini to'lash uchun), lekin qoldiq kiritmaydi. Sahifa ham shu ro'yxatdan.
 */
const writer = () => requireModuleWrite("opening", OPENING_WRITERS);

/**
 * Ta'minotchi qoldig'iga yozilgan to'lovni storno qilish — faqat direktor (kassaga pul qaytadi).
 * Qoldiqni tahrirlash, kamaytirish va o'chirish — kirituvchilarga (`writer`): har o'zgarish auditda.
 */
async function director() {
  const s = await requireSession();
  if (s.role !== "DIRECTOR") throw new AccessDenied("Boshlang'ich qoldiqni faqat direktor o'zgartira yoki bekor qila oladi");
  return s;
}

const KINDS = ["CUSTOMER", "SUPPLIER", "CASH", "STOCK"] as const;

function refresh() {
  for (const p of ["/settings/boshlangich-qoldiq", "/customers", "/suppliers", "/payments", "/cashflow", "/invoices", "/stock", "/"]) revalidatePath(p);
  revalidatePath("/bi-tahlil/mijozlar", "layout"); // debitorka / kreditorka varaqlari va ulardagi «Qarzlarni kiritish»
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
  warehouseId: zOpt,
});

/** Mijoz / yetkazuvchi qarzi: sana fayldagi «Sana» ustunidan (bo'lmasa formadan), birlik va ishora formada tanlanadi. */
const debtImportSchema = z.object({
  rows: z.string(),
  date: zOpt.refine((v) => v == null || validDate(v), "Sana noto'g'ri"),
  createMissing: z.string().optional().transform((v) => v === "on"),
  unit: z.enum(["1", "1000", "1000000"]).optional().transform((v) => Number(v ?? "1")),
  sign: zSign,
});

const list = (l: string[], n = 5) => `${l.slice(0, n).join(", ")}${l.length > n ? "…" : ""}`;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export async function importOpeningsAction(kind: OpeningKind, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const debt = kind === "CUSTOMER" || kind === "SUPPLIER";
  const r = debt ? parseForm(debtImportSchema, fd) : parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  let rows: OpeningRow[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };
  if (debt) {
    const d = r.data as z.infer<typeof debtImportSchema>;
    let res;
    try {
      // sign: −1 — «Exceldagi minus — qarz» (tizimda qarz musbat)
      res = await importDebtBalances(kind, rows, { date: d.date, createMissing: d.createMissing, scale: d.unit, flip: d.sign === -1 }, s.userId);
    } catch (e) {
      return { error: (e as Error).message };
    }
    refresh();
    const who = kind === "CUSTOMER" ? "mijoz" : "yetkazuvchi";
    return {
      ok: true,
      note: [
        `${res.parties} ta ${who}: ${res.created} ta yozuv qo'shildi${res.updated ? `, ${res.updated} tasi yangilandi` : ""}${res.removed ? `, ${res.removed} tasi olib tashlandi` : ""}${res.same ? `, ${res.same} tasi o'zgarmadi` : ""}`,
        res.createdEntities.length ? `bazada yo'q ${res.createdEntities.length} ta yangi karta ochildi: ${list(res.createdEntities)}` : "",
        res.noDebt.length ? `qarzi yo'q ${res.noDebt.length} ta nom ochilmadi: ${list(res.noDebt)}` : "",
        res.future.length ? `kelajak sana o'tkazib yuborildi: ${res.future.map(dm).join(", ")}` : "",
      ].filter(Boolean).join(" · "),
    };
  }
  const d = r.data as z.infer<typeof importSchema>;
  let res;
  try {
    res = await importOpenings(kind, rows, { date: new Date(d.date), warehouseId: d.warehouseId }, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  refresh();
  return {
    ok: true,
    note: [
      `${res.created} ta boshlang'ich qoldiq yozildi`,
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
  const s = await writer();
  const r = parseForm(updateSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await updateOpening(id, { date: new Date(d.date), amount: signed(d.amount, d.sign), qty: d.qty, unitCost: d.unitCost, note: d.note }, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "Saqlandi" };
}

const reduceSchema = z.object({
  by: optNum.refine((v) => v != null && v > 0, "Summa 0 dan katta bo'lsin").refine((v) => v == null || v <= MAX_AMOUNT, "Summa juda katta"),
  reason: zOpt,
});

/** Mijoz / yetkazuvchi qoldig'ini kamaytirish (masalan kelishuv bo'yicha qisman kechildi). */
export async function reduceOpeningAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(reduceSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await reduceOpening(id, r.data.by!, r.data.reason, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "Summa kamaytirildi" };
}

export async function cancelOpeningAction(id: string, reason: string): Promise<ActionState> {
  const s = await writer();
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

/** Yetkazuvchi qoldig'iga xato yozilgan to'lovni storno qilish — faqat direktor, sabab majburiy. */
export async function reverseSupplierOpeningPaymentAction(cashTxId: string, reason: string): Promise<ActionState> {
  const s = await director();
  const res = await reverseSupplierOpeningPayment(cashTxId, String(reason ?? ""), s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "To'lov bekor qilindi" };
}

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
