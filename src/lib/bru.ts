import { db } from "@/lib/db";

/**
 * Zayavkaning beton (m³) qatori qaysi BRU dan (Brigade.isBru) — `OrderItem.bruId`. Qator ro'yxatini joyida to'g'rilaydi:
 *   · dona mahsulot qatorida BRU bo'lmaydi (null);
 *   · beton qatorida tanlangan BRU faol BRU bo'lsin (`keep` — tahrirda shu qatorda avval saqlangan, nofaol bo'lib qolgan BRU);
 *   · tanlanmagan: yagona faol BRU bo'lsa — o'sha; bir nechta bo'lsa `required` (veb formalar) — xato, aks holda (mobil, import) bo'sh.
 * `bruId: undefined` tahrirda — forma yubormagan, qator BRU si o'zgarmaydi. Xato matni o'zbekcha, aks holda null.
 */
export async function applyBru(
  items: { productId: string; bruId?: string | null }[],
  opts: { required: boolean; editing?: boolean; keep?: Set<string> },
): Promise<string | null> {
  if (!items.length) return null;
  const [products, brus] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...new Set(items.map((i) => i.productId))] } }, select: { id: true, unit: true, name: true } }),
    db.brigade.findMany({ where: { isBru: true, isActive: true }, select: { id: true } }),
  ]);
  const prod = new Map(products.map((p) => [p.id, p]));
  const active = new Set(brus.map((b) => b.id));
  for (const i of items) {
    const p = prod.get(i.productId);
    if (!p) continue; // mahsulot tekshiruvi chaqiruvchida
    if (p.unit !== "m3") { if (i.bruId !== undefined || !opts.editing) i.bruId = null; continue; }
    if (opts.editing && i.bruId === undefined) continue;
    if (i.bruId) {
      if (!active.has(i.bruId) && !opts.keep?.has(i.bruId)) return `${p.name}: tanlangan BRU topilmadi yoki nofaol — qayta tanlang`;
      continue;
    }
    if (opts.required && active.size > 1) return `${p.name}: beton qaysi BRU dan olinishini tanlang`;
    i.bruId = active.size === 1 ? [...active][0]! : null;
  }
  return null;
}
