"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { cancelTransfer, createTransfer } from "@/lib/cash-transfer";

/** Pul maydoni: bo'sh joy / vergul bilan yozilgan summani ham qabul qiladi ("1 000 000,50"). */
const zMoney = (msg: string) => z.preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "").replace(",", ".") : v), z.coerce.number({ message: msg }));

const schema = z.object({
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  fromAccountId: zStr("Qayerdan — hisob tanlanmagan"),
  toAccountId: zStr("Qayerga — hisob tanlanmagan"),
  amount: zMoney("summa raqam bo'lsin").pipe(z.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta")),
  fee: z.preprocess((v) => (v === "" || v == null ? undefined : v), zMoney("komissiya raqam bo'lsin").pipe(z.number().min(0, "komissiya manfiy bo'lolmaydi").max(MAX_AMOUNT, "komissiya juda katta")).optional()),
  feeAccountId: zOpt,
  note: zOpt,
  clientToken: zOpt,
}).refine((d) => d.fromAccountId !== d.toAccountId, { message: "Qayerdan va qayerga — bir xil hisob bo'lolmaydi", path: ["toAccountId"] });

/** Formadagi bir martalik kalit (sahifa beradi): bo'sh yoki g'alati bo'lsa — e'tiborga olinmaydi. */
const tokenOf = (t: string | null) => (t && /^[A-Za-z0-9-]{16,64}$/.test(t) ? t : null);

/** Hisoblararo o'tkazma: kassa → bank (inkassatsiya), bank → kassa (naqdlashtirish), kassa → kassa. */
export async function createTransferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "transfer");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await createTransfer({ date: new Date(d.date), fromAccountId: d.fromAccountId, toAccountId: d.toAccountId, amount: d.amount, fee: d.fee ?? null, feeAccountId: d.feeAccountId, note: d.note, clientToken: tokenOf(d.clientToken) }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
  return { ok: true, note: res.duplicate ? `${res.docNo} allaqachon saqlangan (qayta bosildi)` : `${res.docNo} saqlandi` };
}

/** O'tkazmani storno qilish — faqat direktor, sabab bilan. */
export async function cancelTransferAction(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("cashflow", "transfer_storno");
  const res = await cancelTransfer(id, String(reason ?? ""), s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
  return { ok: true, note: "Storno qilindi" };
}
