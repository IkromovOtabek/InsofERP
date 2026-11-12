"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { addLogiTx, cancelLogiTx, payDriverMonth } from "@/lib/logistics-finance";

/**
 * Logistika moliya amallari (veb). Qoida `lib/logistics-finance.ts` da: yozish — `fin_write`, pul berish — `fin_pay`
 * (rol bo'yicha ish boshqaruvchi, direktor — har doim).
 */
function refresh() {
  revalidatePath("/logistika/moliya"); revalidatePath("/payments"); revalidatePath("/cashflow"); revalidatePath("/logistika/tabel");
}

const dayOf = (v: string | null | undefined) => {
  const m = v && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const now = new Date();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), now.getHours(), now.getMinutes());
  return Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 60_000 ? null : d;
};

const TxSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"], { message: "Kirim yoki chiqim — tanlang" }),
  date: zStr("Sanani tanlang"),
  amount: zDec(1),
  category: zStr("Toifani tanlang"),
  source: zStr("Hisobni tanlang"),
  fromCashAccountId: zOpt,
  vehicleId: zOpt,
  driverId: zOpt,
  counterparty: zOpt,
  note: zOpt,
  clientToken: zOpt,
});

export async function addTx(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "fin_write");
  const p = parseForm(TxSchema, fd);
  if ("error" in p) return { error: p.error };
  const date = dayOf(p.data.date);
  if (!date) return { error: "Sana noto'g'ri (kelajak sana bo'lmaydi)" };
  const r = await addLogiTx({ ...p.data, date, fromCashAccountId: p.data.fromCashAccountId || null }, s.userId);
  if (r.error) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}

const CancelSchema = z.object({ reason: zStr("Bekor qilish sababini yozing") });
export async function cancelTx(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "fin_write");
  const p = parseForm(CancelSchema, fd);
  if ("error" in p) return { error: p.error };
  const r = await cancelLogiTx(id, p.data.reason, s.userId);
  if (r.error) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}

const MonthPaySchema = z.object({ source: zStr("Qaysi hisobdan — tanlang"), note: zOpt });
export async function payMonth(month: string, driverId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "fin_pay");
  const p = parseForm(MonthPaySchema, fd);
  if ("error" in p) return { error: p.error };
  const r = await payDriverMonth(month, driverId, p.data.source, s.userId, p.data.note);
  if (r.error) return { error: r.error };
  refresh(); revalidatePath("/ish-haqi");
  return { ok: true, note: r.note };
}
