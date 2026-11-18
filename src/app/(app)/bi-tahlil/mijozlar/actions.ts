"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, validDate, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { requireDebtWriter } from "@/lib/opening-balances";
import { cancelDebtTransfer, createDebtTransfer, setDebtBalance, setOpeningTotal, updateDebtTransfer } from "@/lib/debt-transfer";
import { updateCustomerNameKind } from "@/lib/customer-admin";
import { syncCustomerLater } from "@/lib/eco/customers";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { flatName } from "@/lib/excel";
import { toLatin } from "@/lib/translit";
import { DEBT_EPOCH } from "@/lib/fin-report/debts";

/**
 * Qarz varaqlaridagi qo'lda amallar — qoldiqni tuzatish va «Qarzni boshqa mijoz to'ladi». Huquq «Qarzlarni kiritish» bilan
 * bir xil: Tahlil → debitorka / kreditorka amali yoki «opening» yozish huquqi — `lib/opening-balances.ts → canEnterDebts`.
 */

function refresh() {
  revalidatePath("/bi-tahlil/mijozlar", "layout");
  for (const p of ["/customers", "/suppliers", "/payments", "/sales", "/dashboard"]) revalidatePath(p);
}

const day = zStr("Sana kerak").refine(validDate, "Sana noto'g'ri");

const fixSchema = z.object({
  date: day,
  // Qarzdorlik — ular bizga qarz (+), haqdorlik — biz ularga qarzmiz (−); ta'minotchida ishora teskari (`supplierPositions`)
  side: z.enum(["qarz", "haq"]),
  amount: zDec(0),
  note: zOpt,
});

/** Qatordagi qalam: tanlangan kun oxiridagi qoldiqni kiritilgan summaga tenglash. */
export async function fixDebtBalanceAction(who: "customer" | "supplier", id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireDebtWriter(who);
  const r = parseForm(fixSchema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const d = r.data;
  const owesUs = d.side === "qarz" ? d.amount : -d.amount;
  const target = who === "customer" ? owesUs : -owesUs;
  const res = await setDebtBalance(who === "customer" ? "CUSTOMER" : "SUPPLIER", id, new Date(`${d.date}T00:00:00`), target, d.note, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: res.changed ? "Qoldiq tuzatildi" : "Qoldiq allaqachon shu summada — o'zgarish yo'q" };
}

const isoDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && validDate(v) ? new Date(`${v}T00:00:00`) : null);

/**
 * «Davr boshi» ustunidagi qalam: boshlang'ich qoldiqni (davrdagi boshlang'ich qoldiq yozuvlari bilan) kiritilgan summaga
 * tenglash — `lib/debt-transfer.ts → setOpeningTotal`. `from` / `to` — varaqdagi davr (`dan`, `sana`; boshidan — 2000-01-01).
 */
export async function fixOpeningAction(who: "customer" | "supplier", id: string, from: string, to: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireDebtWriter(who);
  const r = parseForm(fixSchema.omit({ date: true }), fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const a = isoDay(from) ?? DEBT_EPOCH, b = isoDay(to);
  if (!b || a > b) return { error: "Davr noto'g'ri — sahifani yangilang" };
  const d = r.data;
  const owesUs = d.side === "qarz" ? d.amount : -d.amount;
  const target = who === "customer" ? owesUs : -owesUs;
  const res = await setOpeningTotal(who === "customer" ? "CUSTOMER" : "SUPPLIER", id, a, b, target, d.note, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: res.changed ? "Boshlang'ich qoldiq tuzatildi" : "Boshlang'ich qoldiq allaqachon shu summada — o'zgarish yo'q" };
}

const partySchema = z.object({
  name: zStr("Nomi to'ldirilishi shart").max(200, "Nomi juda uzun"),
  // Mijoz turi: CASH — naqd, BANK — perechisleniye, bo'sh — oxirgi zayavka bo'yicha (o'zgartirilmagan)
  payKind: z.enum(["CASH", "BANK", ""]).optional(),
});

/**
 * Nom ustunidagi qalam: mijoz — nomi va turi (naqd / perechisleniye), ta'minotchi — nomi. Huquq kartadagi bilan bir xil:
 * mijoz — «customers → edit», ta'minotchi — «stock → suppliers». Bir xil nomli ikkinchi karta bo'lmaydi.
 */
export async function editPartyAction(who: "customer" | "supplier", id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(partySchema, fd);
  if (who === "customer") {
    const s = await requireAction("customers", "edit");
    if ("error" in r) return { error: r.error, field: r.field };
    const res = await updateCustomerNameKind(id, { name: r.data.name, payKind: r.data.payKind || null }, s.userId);
    if (!res.ok) return { error: res.error };
    syncCustomerLater(id); // ilovadagi tashkilot nomi ham yangilansin
    refresh();
    return { ok: true, note: res.note };
  }
  const s = await requireAction("stock", "suppliers");
  if ("error" in r) return { error: r.error, field: r.field };
  const name = r.data.name.replace(/\s+/g, " ").trim();
  const key = (v: string) => flatName(toLatin(v));
  const before = await db.supplier.findUnique({ where: { id } });
  if (!before) return { error: "Ta'minotchi topilmadi" };
  if (before.name === name) return { ok: true, note: "O'zgarish yo'q" };
  if (key(before.name) !== key(name)) {
    const others = await db.supplier.findMany({ where: { id: { not: id } }, select: { name: true, isActive: true } });
    const same = others.find((x) => key(x.name) === key(name));
    if (same) return { error: `«${same.name}» nomli ta'minotchi allaqachon bor${same.isActive ? "" : " (nofaol)"} — bir xil nomli ikkinchi karta bo'lmaydi` };
  }
  const after = await db.supplier.update({ where: { id }, data: { name } });
  await audit(db, s.userId, "UPDATE", "Supplier", id, { name: before.name }, { name: after.name, via: "debt-sheet" });
  refresh();
  return { ok: true, note: "Saqlandi" };
}

const transferSchema = z.object({
  date: day,
  debtorId: zStr("Qarzdor mijozni tanlang"),
  payerId: zStr("To'lovchi mijozni tanlang"),
  amount: zDec(0).refine((n) => n > 0, "Summa 0 dan katta bo'lsin"),
  note: zOpt,
});

function transferInput(fd: FormData) {
  const r = parseForm(transferSchema, fd);
  if ("error" in r) return r;
  const d = r.data;
  return { data: { date: new Date(`${d.date}T12:00:00`), debtorId: d.debtorId, payerId: d.payerId, amount: d.amount, note: d.note } };
}

/** «Qarzni boshqa mijoz to'ladi» — yangi hujjat. */
export async function createDebtTransferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireDebtWriter("customer");
  const r = transferInput(fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const res = await createDebtTransfer(r.data, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: `${res.docNo} yozildi` };
}

export async function updateDebtTransferAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireDebtWriter("customer");
  const r = transferInput(fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const res = await updateDebtTransfer(id, r.data, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "Saqlandi" };
}

export async function cancelDebtTransferAction(id: string, reason: string): Promise<ActionState> {
  const s = await requireDebtWriter("customer");
  const res = await cancelDebtTransfer(id, reason, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true };
}
