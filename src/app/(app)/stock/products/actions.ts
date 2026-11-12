"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { addProductStockLines } from "@/lib/product-stock";
import { transferProductOwner, transferProductOwnerLines } from "@/lib/brigade-products";

const schema = z.object({
  warehouseId: zStr("Sklad tanlanmagan"),
  // Kirim sanasi (YYYY-MM-DD); bo'sh — bugun. Qoidasi `lib/product-stock.ts` da
  date: zOpt,
  productId: z.array(z.string()).min(1, "Kamida bitta mahsulot qatori kerak"),
  qty: z.array(z.coerce.number({ message: "Miqdor raqam bo'lsin" }).int("Miqdor butun son bo'lsin").positive("Miqdor 0 dan katta bo'lsin").max(MAX_AMOUNT, "Qiymat juda katta")),
  // Har qator qaysi brigada omboriga; bo'sh — umumiy hovli (`lib/brigade-products.ts`)
  brigadeId: z.array(z.string()).optional(),
  note: zOpt,
});

/**
 * Hovliga tayyor mahsulotni qo'lda kirim qilish (retseptsiz) — bir nechta qator, tanlangan sana bilan; har qator — brigada omboriga.
 * Qoida `lib/product-stock.ts` da (mobil ilova ham shundan): skladda harakati bor mahsulotga ham qo'shiladi.
 */
export async function addStock(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "products");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const raw = fd.get("clientToken");
  // Brigada majburiy tanlanadi (formada); «umumiy» — umumiy hovli, ombor belgisiz
  if (d.brigadeId && d.brigadeId.some((b) => !b)) return { error: "Har qatorda qaysi brigadaga ekanini tanlang (yoki «Umumiy hovli»)" };
  const lines = d.productId.map((productId, i) => { const b = d.brigadeId?.[i]; return { productId, qty: d.qty[i] ?? 0, brigadeId: b && b !== "umumiy" ? b : null }; });
  const res = await addProductStockLines({ lines, warehouseId: d.warehouseId, date: d.date, note: d.note, clientToken: typeof raw === "string" ? raw : null }, { userId: s.userId, role: s.role });
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock");
  for (const id of new Set(d.productId)) revalidatePath(`/stock/products/${id}`);
  // Sklad sahifasida yashil xabar: nechta mahsulot, jami necha dona (takror yuborilgan forma — «allaqachon saqlangan»)
  const total = lines.reduce((a, l) => a + l.qty, 0);
  redirect(`/stock?tab=capacity&qoshildi=${new Set(d.productId).size}&jami=${total}${res.dup ? "&takror=1" : ""}`);
}

const transferSchema = z.object({
  productId: zStr("Mahsulot tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  // «umumiy» — umumiy hovli (ombor belgisiz)
  from: zStr("Qayerdan tanlanmagan").transform((v) => (v === "umumiy" ? null : v)),
  to: zStr("Qayerga ko'chirishni tanlang").transform((v) => (v === "umumiy" ? null : v)),
  qty: zDec(0),
  note: zOpt,
});

/**
 * Tayyor mahsulotni brigada omborlari orasida ko'chirish (umumiy hovli ↔ brigada, brigada → brigada).
 * Ruxsat — «Tayyor mahsulot qo'shish» bilan bir xil (`stock` → `products`): sklad, ishlab chiqarish, ish boshqaruvchi.
 */
export async function transferOwner(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "products");
  const r = parseForm(transferSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const raw = fd.get("clientToken");
  const res = await transferProductOwner({ ...d, clientToken: typeof raw === "string" ? raw : null }, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock");
  revalidatePath(`/stock/products/${d.productId}`);
  return { ok: true, note: res.dup ? "Avval yozilgan" : `Ko'chirildi: ${res.text}` };
}

const distributeSchema = z.object({
  warehouseId: zStr("Sklad tanlanmagan"),
  from: zStr("Qayerdan tanlanmagan").transform((v) => (v === "umumiy" ? null : v)),
  to: zStr("Qaysi brigadaga ajratishni tanlang").transform((v) => (v === "umumiy" ? null : v)),
  productId: z.array(z.string()).default([]),
  // Bo'sh katak — shu mahsulot ajratilmaydi
  qty: z.array(z.string()).default([]),
  note: zOpt,
});

/**
 * Sklad → Hovli → «Brigadalarga ajratish»: tanlangan ombordagi (odatda umumiy hovli) bir nechta mahsulotni bir yo'la
 * brigada omboriga. Ruxsat — «Tayyor mahsulot qo'shish» bilan bir xil (`stock` → `products`).
 */
export async function distributeOwner(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "products");
  const r = parseForm(distributeSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const lines: { productId: string; qty: number }[] = [];
  for (const [i, productId] of d.productId.entries()) {
    const raw = (d.qty[i] ?? "").replace(/\s/g, "").replace(",", ".");
    if (!raw) continue;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0 || qty > MAX_AMOUNT) return { error: `${i + 1}-qator: miqdor noto'g'ri` };
    if (qty > 0) lines.push({ productId, qty });
  }
  const tok = fd.get("clientToken");
  const res = await transferProductOwnerLines({ warehouseId: d.warehouseId, from: d.from, to: d.to, lines, note: d.note, clientToken: typeof tok === "string" ? tok : null }, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock");
  for (const l of lines) revalidatePath(`/stock/products/${l.productId}`);
  redirect(`/stock?bolim=hovli&ombor=${d.to ?? "umumiy"}#hovli`);
}
