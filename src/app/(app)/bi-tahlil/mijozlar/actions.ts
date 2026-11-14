"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireModuleWrite } from "@/lib/auth";
import { parseForm, validDate, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { OPENING_WRITERS } from "@/lib/opening-balances";
import { cancelDebtTransfer, createDebtTransfer, setDebtBalance, updateDebtTransfer } from "@/lib/debt-transfer";

/**
 * Qarz varaqlaridagi qo'lda amallar — qoldiqni tuzatish va «Qarzni boshqa mijoz to'ladi». Huquq «Qarzlarni kiritish» bilan
 * bir xil: direktor va buxgalteriya (yoki direktor bergan «opening» ruxsati) — `kiritish.tsx → canEnterDebts`.
 */
const writer = () => requireModuleWrite("opening", OPENING_WRITERS);

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
  const s = await writer();
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
  const s = await writer();
  const r = transferInput(fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const res = await createDebtTransfer(r.data, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: `${res.docNo} yozildi` };
}

export async function updateDebtTransferAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = transferInput(fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const res = await updateDebtTransfer(id, r.data, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: "Saqlandi" };
}

export async function cancelDebtTransferAction(id: string, reason: string): Promise<ActionState> {
  const s = await writer();
  const res = await cancelDebtTransfer(id, reason, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true };
}
