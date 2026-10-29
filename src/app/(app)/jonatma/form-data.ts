import { db } from "@/lib/db";
import { avgUnitCosts } from "@/lib/stock";
import type { ShipmentMaterial } from "./shipment-form";

/** Jo'natma formasi spravochniklari: yetkazuvchi, sklad, mahsulot (kategoriyasi va o'rtacha narxi bilan), papkalar. */
export async function shipmentFormData() {
  const [suppliers, warehouses, materials, groups, costs] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, groupId: true, category: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    avgUnitCosts(),
  ]);
  const mats: ShipmentMaterial[] = materials.map((m) => ({ ...m, price: costs.get(m.id) ?? 0 }));
  return { suppliers, warehouses, materials: mats, groups };
}
