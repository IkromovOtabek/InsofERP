"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { num, str, codeFromName } from "@/lib/excel";
import { normalizeUnit, UNIT_FALLBACK } from "@/lib/unit";


const schema = z.object({
  warehouseId: zStr("Sklad tanlanmagan"),
  cashAccountId: zOpt, // qaysi hisobdan to'landi (bo'sh — chiqim yozilmaydi)
  rows: z.string(),
});
type Row = { name?: unknown; code?: unknown; unit?: unknown; qty?: unknown; price?: unknown; minStock?: unknown };

/** Excel'dan kelgan manfiy bo'lmagan raqam; bo'sh yoki xato bo'lsa `null` (qator baribir qo'shiladi). */
const dec = (v: unknown) => { const n = num(v); return Number.isFinite(n) && n >= 0 ? n : null; };

/**
 * Sklad → Xomashyo qo'shish (Excel yoki qo'lda, ko'p qator birdan).
 * Har qator: nomi (majburiy), kodi (bo'sh bo'lsa nomdan), birlik, boshlang'ich qoldiq, narx, minimal qoldiq.
 * Nomi/kodi bo'yicha mavjud xomashyo topilsa — yangilanadi (birlik o'zgarmaydi), qoldiq ustiga qo'shiladi.
 * Faylda bir nom bir necha marta kelsa (turli narx yoki partiya) — xomashyo bitta yaratiladi, har qator alohida
 * qoldiq harakati bo'lib yoziladi; bir xil qatorlarni oldindan ko'rishda birlashtirib yuborsa ham bo'ladi.
 * Boshlang'ich qoldiq StockMove ADJUSTMENT ("Qo'lda") bo'lib yoziladi — Harakat jurnalida ko'rinadi.
 * Fayl qancha qator bo'lsa ham to'xtatmaydi: birlik tanilmasa (`letr`, `тн`, `pachka`… tarjima qilinadi, baribir
 * tanilmasa "dona"), raqam xato bo'lsa 0/bo'sh olinadi — faqat nomi bo'sh qatorlar tashlanadi.
 */
export async function importMaterials(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  let rows: Row[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Ma'lumotlar o'qilmadi" }; }
  rows = rows.filter((x) => str(x.name));
  if (!rows.length) return { error: "Kamida bitta xomashyo nomi kerak" };
  const wh = await db.warehouse.findUnique({ where: { id: r.data.warehouseId } });
  if (!wh) return { error: "Sklad topilmadi" };

  const out = await db.$transaction(async (tx) => {
    const all = await tx.material.findMany();
    const byKey = new Map<string, (typeof all)[number]>();
    for (const m of all) { byKey.set(m.code.toLowerCase(), m); byKey.set(m.name.toLowerCase().trim(), m); }
    let created = 0, updated = 0, moved = 0, guessed = 0, cost = 0;
    // Bitta qo'shish seansi — bitta hujjat: Kirim-Chiqimdan shu partiyaga o'tiladi
    const batchId = crypto.randomUUID();
    for (const x of rows) {
      const name = str(x.name);
      const key = name.toLowerCase();
      const qty = dec(x.qty) ?? 0;
      const price = dec(x.price);
      const minStock = dec(x.minStock);
      const u = normalizeUnit(x.unit);
      const unit = u ?? UNIT_FALLBACK;
      // Bir nom bir marta yaratiladi; shu nomdagi qolgan qatorlar (boshqa narx/partiya) qoldiq bo'lib qo'shiladi
      let m = byKey.get(str(x.code).toLowerCase()) ?? byKey.get(key);
      if (m) {
        if (minStock != null && Number(m.minStock) !== minStock) { m = await tx.material.update({ where: { id: m.id }, data: { minStock, isActive: true } }); updated++; }
      } else {
        if (!u && str(x.unit) !== "") guessed++; // birlik tanilmadi — "dona" qo'yiladi
        let code = str(x.code).toUpperCase() || codeFromName(name);
        for (let n = 2; all.some((a) => a.code === code); n++) code = `${(str(x.code).toUpperCase() || codeFromName(name)).slice(0, 13)}-${n}`;
        m = await tx.material.create({ data: { code, name, unit, minStock: minStock ?? 0, isActive: true } });
        all.push(m); byKey.set(code.toLowerCase(), m); byKey.set(key, m);
        await audit(tx, s.userId, "CREATE", "Material", m.id, undefined, { ...m, via: "stock-add" });
        created++;
      }
      if (qty > 0) {
        await tx.stockMove.create({ data: { type: "ADJUSTMENT", warehouseId: wh.id, materialId: m.id, qty, unitCost: price, refType: "StockIn", refId: batchId, note: "Boshlang'ich qoldiq (Sklad → Xomashyo qo'shish)", createdById: s.userId } });
        moved++;
        cost += qty * (price ?? 0);
      }
    }

    // Qo'shilgan xomashyo summasi — hisobdan chiqim bo'lib Kirim-Chiqimga tushadi
    if (cost > 0 && r.data.cashAccountId) {
      const ct = await tx.cashTransaction.create({
        data: {
          type: "EXPENSE", cashAccountId: r.data.cashAccountId, amount: cost, category: "Xomashyo",
          counterparty: wh.name, note: `Sklad → Xomashyo qo'shish · ${moved} qator`,
          refType: "StockIn", refId: batchId, createdById: s.userId,
        },
      });
      await audit(tx, s.userId, "CREATE", "CashTransaction", ct.id, undefined, ct);
    }
    return { created, updated, moved, guessed };
  }, { timeout: 120_000, maxWait: 20_000 });
  revalidatePath("/stock"); revalidatePath("/settings"); revalidatePath("/receipts/new"); revalidatePath("/recipes"); revalidatePath("/cashflow"); revalidatePath("/dashboard");
  redirect(`/stock?tab=balance&added=${out.created}&updated=${out.updated}&moved=${out.moved}&guessed=${out.guessed}`);
}
