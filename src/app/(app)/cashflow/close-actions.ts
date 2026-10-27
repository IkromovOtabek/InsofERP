"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { MAX_AMOUNT, parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { accountBalance, tashkentDay } from "@/lib/nazorat/checks";
import { money } from "@/lib/format";

const schema = z.object({
  cashAccountId: zStr("Kassa tanlanmagan"),
  counted: z.coerce.number({ message: "Summa raqam bo'lsin" }).min(0, "Manfiy bo'lmasin").max(MAX_AMOUNT, "Summa juda katta"),
  note: zOpt,
});

/**
 * Kassani yopish: kassir kun oxirida naqdni sanab kiritadi, tizimdagi qoldiq (shu payt) bilan farqi saqlanadi.
 * Bir kunda qayta sanalsa — yozuv yangilanadi (AuditLog'da oldingi qiymat). Faqat naqd kassa; ruxsat `cashflow.close`.
 */
export async function closeCashAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "close");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const acc = await db.cashAccount.findFirst({ where: { id: r.data.cashAccountId, type: "CASH", isActive: true }, select: { id: true } });
  if (!acc) return { error: "Naqd kassa topilmadi" };
  const day = tashkentDay();
  const system = await accountBalance(acc.id);
  const diff = Math.round((r.data.counted - system) * 100) / 100;
  if (Math.abs(diff) >= 1 && !r.data.note) return { error: `Farq ${money(diff)} — sababini izohga yozing` };
  await db.$transaction(async (tx) => {
    const before = await tx.cashCount.findUnique({ where: { cashAccountId_day: { cashAccountId: acc.id, day } } });
    const after = await tx.cashCount.upsert({
      where: { cashAccountId_day: { cashAccountId: acc.id, day } },
      update: { counted: r.data.counted, system, diff, note: r.data.note, createdById: s.userId },
      create: { cashAccountId: acc.id, day, counted: r.data.counted, system, diff, note: r.data.note, createdById: s.userId },
    });
    await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "CashCount", after.id, before ?? undefined, after);
  });
  revalidatePath("/cashflow"); revalidatePath("/dashboard");
  return { ok: true, note: Math.abs(diff) < 1 ? "Kassa yopildi — farq yo'q" : `Kassa yopildi — farq ${money(diff)}` };
}
