"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, type ActionState } from "@/lib/action";
import { num, str, codeFromName } from "@/lib/excel";
import { MATERIAL_UNITS } from "@/lib/unit";


const schema = z.object({
  warehouseId: zStr("Sklad tanlanmagan"),
  rows: z.string(),
});
type Row = { name?: unknown; code?: unknown; unit?: unknown; qty?: unknown; price?: unknown; minStock?: unknown };

/**
 * Sklad → Xomashyo qo'shish (Excel yoki qo'lda, ko'p qator birdan).
 * Har qator: nomi (majburiy), kodi (bo'sh bo'lsa nomdan), birlik, boshlang'ich qoldiq, narx, minimal qoldiq.
 * Nomi/kodi bo'yicha mavjud xomashyo topilsa — yangilanadi (birlik o'zgarmaydi), qoldiq ustiga qo'shiladi.
 * Boshlang'ich qoldiq StockMove ADJUSTMENT ("Qo'lda") bo'lib yoziladi — Harakat jurnalida ko'rinadi.
 */
export async function importMaterials(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  let rows: Row[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Ma'lumotlar o'qilmadi" }; }
  rows = rows.filter((x) => str(x.name));
  if (!rows.length) return { error: "Kamida bitta xomashyo nomi kerak" };
  for (const [i, x] of rows.entries()) {
    const q = str(x.qty) === "" ? 0 : num(x.qty);
    if (!(q >= 0)) return { error: `${i + 1}-qator (${str(x.name)}): qoldiq raqam bo'lsin` };
    if (str(x.price) !== "" && !(num(x.price) >= 0)) return { error: `${i + 1}-qator (${str(x.name)}): narx noto'g'ri` };
    if (str(x.minStock) !== "" && !(num(x.minStock) >= 0)) return { error: `${i + 1}-qator (${str(x.name)}): minimal qoldiq noto'g'ri` };
    const u = str(x.unit).toLowerCase();
    if (u && !(MATERIAL_UNITS as readonly string[]).includes(u)) return { error: `${i + 1}-qator (${str(x.name)}): birlik "${str(x.unit)}" noma'lum (${MATERIAL_UNITS.join(", ")})` };
  }
  const wh = await db.warehouse.findUnique({ where: { id: r.data.warehouseId } });
  if (!wh) return { error: "Sklad topilmadi" };

  const out = await db.$transaction(async (tx) => {
    const all = await tx.material.findMany();
    const byKey = new Map<string, (typeof all)[number]>();
    for (const m of all) { byKey.set(m.code.toLowerCase(), m); byKey.set(m.name.toLowerCase().trim(), m); }
    let created = 0, updated = 0, moved = 0;
    const seen = new Set<string>();
    for (const x of rows) {
      const name = str(x.name);
      const key = name.toLowerCase();
      if (seen.has(key)) continue; // faylda takror — birinchisi
      seen.add(key);
      const qty = str(x.qty) === "" ? 0 : num(x.qty);
      const price = str(x.price) === "" ? null : num(x.price);
      const minStock = str(x.minStock) === "" ? null : num(x.minStock);
      const unit = str(x.unit).toLowerCase() || "kg";
      let m = byKey.get(str(x.code).toLowerCase()) ?? byKey.get(key);
      if (m) {
        if (minStock != null && Number(m.minStock) !== minStock) { m = await tx.material.update({ where: { id: m.id }, data: { minStock, isActive: true } }); updated++; }
      } else {
        let code = str(x.code).toUpperCase() || codeFromName(name);
        for (let n = 2; all.some((a) => a.code === code); n++) code = `${(str(x.code).toUpperCase() || codeFromName(name)).slice(0, 13)}-${n}`;
        m = await tx.material.create({ data: { code, name, unit, minStock: minStock ?? 0, isActive: true } });
        all.push(m); byKey.set(code.toLowerCase(), m); byKey.set(key, m);
        await audit(tx, s.userId, "CREATE", "Material", m.id, undefined, { ...m, via: "stock-add" });
        created++;
      }
      if (qty > 0) {
        await tx.stockMove.create({ data: { type: "ADJUSTMENT", warehouseId: wh.id, materialId: m.id, qty, unitCost: price, refType: "Manual", note: "Boshlang'ich qoldiq (Sklad → Xomashyo qo'shish)", createdById: s.userId } });
        moved++;
      }
    }
    return { created, updated, moved };
  });
  revalidatePath("/stock"); revalidatePath("/settings"); revalidatePath("/receipts/new"); revalidatePath("/recipes"); revalidatePath("/dashboard");
  redirect(`/stock?tab=balance&added=${out.created}&updated=${out.updated}&moved=${out.moved}`);
}
