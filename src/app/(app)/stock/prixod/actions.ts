"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { isoDate } from "@/lib/format";
import { createGoodsReceipt, receiptTokenOf } from "@/lib/receipts";
import type { VatRate } from "@/lib/receipt-vat";

/** Xato matnlari o'zbekcha — «Рус» rejimida lug'atdan o'giriladi. */
const req = (msg: string) => z.string().trim().min(1, msg);
const opt = z.string().trim().optional().transform((v) => (v ? v : null));
const numStr = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").replace(",", ".") : v);

const schema = z.object({
  supplierId: req("Yetkazuvchini tanlang («Kimdan»)"),
  warehouseId: req("Skladni tanlang"),
  date: req("Sanani kiriting"),
  payment: z.enum(["BANK", "CASH"], { message: "To'lov turini tanlang: bank o'tkazma yoki naqd pul" }),
  waybillNo: opt,
  recipientId: opt,
  address: opt,
  buyerId: opt,
  purpose: opt,
  note: opt,
  cashAccountId: opt,
  // Xomashyosiz qatorlarni forma yubormaydi; bo'sh ro'yxat — pastda tekshiriladi (o'z xabari bilan)
  materialId: z.array(z.string()).optional(),
  qty: z.array(z.preprocess(numStr, z.coerce.number({ message: "Miqdor son bo'lishi kerak" }).positive("Miqdor 0 dan katta bo'lishi kerak").max(MAX_AMOUNT, "Qiymat juda katta"))).optional(),
  price: z.array(z.preprocess(numStr, z.coerce.number({ message: "Narx son bo'lishi kerak" }).min(0, "Narx manfiy bo'lmasin").max(MAX_AMOUNT, "Qiymat juda katta"))).optional(),
  deliveryCost: z.array(z.string()).optional(),
  vatRate: z.array(z.string()).optional(),
});

const LIMITS: [keyof z.infer<typeof schema>, number, string][] = [
  ["waybillNo", 60, "TTN"], ["address", 300, "Manzil"], ["purpose", 300, "Maqsad"], ["note", 1000, "Izoh"],
];

/**
 * Sklad → «Kirim»: yangi kirim (GoodsReceipt) — `lib/receipts.ts#createGoodsReceipt` (Kirim formasi bilan bitta qoida).
 * Muvaffaqiyatda jurnalga (kirim sanasi oyi → bugun) «Kirim saqlandi» xabari bilan qaytadi.
 */
export async function createPrixod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "receipt");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  for (const [k, max, label] of LIMITS) {
    const v = d[k];
    if (typeof v === "string" && v.length > max) return { error: `«${label}»: ${max} belgidan oshmasin` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return { error: "Sana noto'g'ri" };
  const mats = d.materialId ?? [], qtys = d.qty ?? [], prices = d.price ?? [], deliveries = d.deliveryCost ?? [], rates = d.vatRate ?? [];
  const items: { materialId: string; qty: number; price: number; deliveryCost: number; vatRate: VatRate | null }[] = [];
  for (const [i, materialId] of mats.entries()) {
    if (!materialId) continue;
    if (qtys[i] == null || prices[i] == null) return { error: `${i + 1}-qator: miqdor va narxni kiriting` };
    const raw = String(numStr(deliveries[i] ?? "") ?? "");
    const delivery = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(delivery) || delivery < 0) return { error: `${i + 1}-qator: yetkazib berish summasi noto'g'ri` };
    const rate = rates[i];
    items.push({ materialId, qty: qtys[i], price: prices[i], deliveryCost: delivery, vatRate: rate != null && rate !== "" ? (Number(rate) as VatRate) : null });
  }
  if (!items.length) return { error: "Kamida bitta qatorda xomashyoni tanlang" };

  let res: Awaited<ReturnType<typeof createGoodsReceipt>>;
  try {
    res = await createGoodsReceipt({
      supplierId: d.supplierId, warehouseId: d.warehouseId, date: d.date, payment: d.payment,
      waybillNo: d.waybillNo, recipientId: d.recipientId, address: d.address, buyerId: d.buyerId, purpose: d.purpose, note: d.note,
      cashAccountId: d.cashAccountId, clientToken: receiptTokenOf(fd.get("clientToken")), items,
    }, { userId: s.userId, role: s.role });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Kirim saqlanmadi" };
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
