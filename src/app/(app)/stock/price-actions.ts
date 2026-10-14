"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAction } from "@/lib/auth";
import { parseForm, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { fmtNum } from "@/lib/format";
import { fillMissingPricesFromAvg, MaterialPriceError, setMaterialPrice } from "@/lib/material-price";

/**
 * Sklad → «Qoldiqlar»: «Dona narxi» (xomashyo birlik narxi) — jadval katagidagi kichik forma va «narxsizlarga o'rtacha
 * tannarx» tugmasi. Kim: stock → "price" amali (Snabjeniye, direktor va u ruxsat bergan xodim). Matnlar ruscha — ekran tili.
 */

function refresh() {
  revalidatePath("/stock"); revalidatePath("/stock/prixod"); revalidatePath("/stock/rasxod"); revalidatePath("/snabjeniye");
}

/** Bo'sh — narx olib tashlanadi (chiqim o'rtacha tannarx bilan baholanadi). Bo'sh joy va vergul (kasr) qabul qilinadi. */
const priceSchema = z.object({
  price: z.string().optional()
    .transform((v) => {
      const t = (v ?? "").replace(/\s/g, "").replace(",", ".");
      return t === "" ? null : Number(t);
    })
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT), "Narx noto'g'ri: 0 yoki undan katta son kiriting"),
});

export async function saveMaterialPrice(materialId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "price");
  if (typeof materialId !== "string" || !materialId) return { error: "Xomashyo tanlanmagan" };
  const p = parseForm(priceSchema, fd);
  if ("error" in p) return { error: p.error };
  try {
    const r = await setMaterialPrice(materialId, p.data.price, { userId: s.userId, role: s.role });
    if (!r.changed) return { ok: true, note: "O'zgarish yo'q" };
    refresh();
    return { ok: true, note: r.after == null ? "Narx olib tashlandi — chiqim o'rtacha tannarx bo'yicha" : `Narx saqlandi: ${fmtNum(r.after, 2)}` };
  } catch (e) {
    if (e instanceof MaterialPriceError) return { error: e.message };
    throw e;
  }
}

/** Narxi yo'q faol xomashyolarga o'rtacha tannarxni qo'yadi (sahifada tasdiq so'raladi). */
export async function fillPricesFromAvg(): Promise<ActionState> {
  const s = await requireAction("stock", "price");
  const r = await fillMissingPricesFromAvg({ userId: s.userId, role: s.role });
  if (r.filled) refresh();
  if (!r.filled && !r.noCost) return { ok: true, note: "Barcha xomashyoda narx allaqachon bor" };
  const parts = [r.filled ? `O'rtacha tannarx bo'yicha narx qo'yildi: ${r.filled} ta xomashyo` : "Narxlar o'zgarmadi"];
  if (r.noCost) parts.push(`tannarxsiz (kirim bo'lmagan): ${r.noCost} ta xomashyo — narxni qo'lda kiriting`);
  return { ok: true, note: parts.join(" · ") };
}
