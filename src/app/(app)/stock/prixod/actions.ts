"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { isoDate } from "@/lib/format";
import { createGoodsReceipt, receiptTokenOf } from "@/lib/receipts";
import type { VatRate } from "@/lib/receipt-vat";

/** Ruscha forma — xato matnlari ham ruscha (ekran tilida). */
const req = (msg: string) => z.string().trim().min(1, msg);
const opt = z.string().trim().optional().transform((v) => (v ? v : null));
const numStr = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").replace(",", ".") : v);

const schema = z.object({
  supplierId: req("Выберите поставщика («От Кого»)"),
  warehouseId: req("Выберите склад"),
  date: req("Укажите дату («Число»)"),
  payment: z.enum(["BANK", "CASH"], { message: "Выберите «Деньги»: П-р или Н-к" }),
  waybillNo: opt,
  recipientId: opt,
  address: opt,
  buyerId: opt,
  purpose: opt,
  note: opt,
  cashAccountId: opt,
  // Строки без материала форма не отправляет; пустой список — проверка ниже (своё сообщение)
  materialId: z.array(z.string()).optional(),
  qty: z.array(z.preprocess(numStr, z.coerce.number({ message: "Количество — число" }).positive("Количество должно быть больше 0").max(MAX_AMOUNT, "Слишком большое значение"))).optional(),
  price: z.array(z.preprocess(numStr, z.coerce.number({ message: "Цена — число" }).min(0, "Цена не может быть отрицательной").max(MAX_AMOUNT, "Слишком большое значение"))).optional(),
  deliveryCost: z.array(z.string()).optional(),
  vatRate: z.array(z.string()).optional(),
});

const LIMITS: [keyof z.infer<typeof schema>, number, string][] = [
  ["waybillNo", 60, "ТТН"], ["address", 300, "Адрес"], ["purpose", 300, "Почему"], ["note", 1000, "Примечание"],
];

/**
 * Sklad → «Приход»: yangi kirim (GoodsReceipt) — `lib/receipts.ts#createGoodsReceipt` (Kirim formasi bilan bitta qoida).
 * Muvaffaqiyatda jurnalga (kirim sanasi oyi → bugun) «сохранён» xabari bilan qaytadi.
 */
export async function createPrixod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "receipt");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  for (const [k, max, label] of LIMITS) {
    const v = d[k];
    if (typeof v === "string" && v.length > max) return { error: `«${label}»: не более ${max} символов` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { error: "Неверная дата" };
  const mats = d.materialId ?? [], qtys = d.qty ?? [], prices = d.price ?? [], deliveries = d.deliveryCost ?? [], rates = d.vatRate ?? [];
  const items: { materialId: string; qty: number; price: number; deliveryCost: number; vatRate: VatRate | null }[] = [];
  for (const [i, materialId] of mats.entries()) {
    if (!materialId) continue;
    if (qtys[i] == null || prices[i] == null) return { error: `Строка ${i + 1}: укажите количество и цену` };
    const raw = String(numStr(deliveries[i] ?? "") ?? "");
    const delivery = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(delivery) || delivery < 0) return { error: `Строка ${i + 1}: неверная сумма доставки` };
    const rate = rates[i];
    items.push({ materialId, qty: qtys[i], price: prices[i], deliveryCost: delivery, vatRate: rate != null && rate !== "" ? (Number(rate) as VatRate) : null });
  }
  if (!items.length) return { error: "Выберите материал хотя бы в одной строке" };

  let res: Awaited<ReturnType<typeof createGoodsReceipt>>;
  try {
    res = await createGoodsReceipt({
      supplierId: d.supplierId, warehouseId: d.warehouseId, date: d.date, payment: d.payment,
      waybillNo: d.waybillNo, recipientId: d.recipientId, address: d.address, buyerId: d.buyerId, purpose: d.purpose, note: d.note,
      cashAccountId: d.cashAccountId, clientToken: receiptTokenOf(fd.get("clientToken")), items,
    }, { userId: s.userId, role: s.role }, { lang: "ru" });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Приход не сохранён" };
  }
  if (!res.existed) {
    revalidatePath("/stock"); revalidatePath("/stock/prixod"); revalidatePath("/receipts"); revalidatePath("/sales"); revalidatePath("/orders/new");
    revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/"); revalidatePath("/suppliers");
  }
  // Jurnal shu kirim ko'rinadigan davrda ochiladi: kirim oyining 1-kunidan bugungacha (kirim kelajak sanada bo'lsa — o'sha kungacha)
  const today = isoDate();
  const qs = new URLSearchParams({ from: `${d.date.slice(0, 7)}-01`, to: d.date > today ? d.date : today, saved: res.docNo });
  redirect(`/stock/prixod?${qs.toString()}`);
}
