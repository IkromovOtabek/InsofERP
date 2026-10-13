import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { avgUnitCosts } from "@/lib/stock";
import { activeRecipients } from "@/lib/stock-recipients";
import { ISSUE_BACK_DAYS } from "@/lib/stock-issue";
import { isoDate } from "@/lib/format";
import { Callout, Card, PageHeader } from "@/components/ui";
import { RasxodForm } from "../rasxod-form";

/**
 * Sklad → «Расход» → Новый расход (ekran ruscha): skladdan oluvchiga yoki brigadaga xomashyo berish.
 * Narx — «Дона сўм» (Snabjeniye belgilagan; bo'lmasa o'rtacha tannarx, «≈»). Qoldiq — tanlangan sklad bo'yicha.
 */
export default async function NewRasxodPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const s = await requireRoles(["WAREHOUSE", "PROCUREMENT"], { module: "stock", actions: ["issue"] });
  // Rol mos, lekin direktor bu amalni olib qo'ygan bo'lsa — forma ochilmaydi (saqlashda baribir rad bo'lardi)
  if (!canDo(s, "stock", "issue")) redirect("/stock/rasxod");
  const sp = await searchParams;

  const [warehouses, recipients, brigades, materials, groups, sums, avg] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    activeRecipients(),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, groupId: true, unitPrice: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    db.stockMove.groupBy({ by: ["warehouseId", "materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    avgUnitCosts(),
  ]);
  const balances: Record<string, Record<string, number>> = {};
  for (const x of sums) {
    const q = Math.round(Number(x._sum.qty ?? 0) * 1000) / 1000;
    if (!x.materialId || Math.abs(q) < 0.0005) continue;
    (balances[x.warehouseId] ??= {})[x.materialId] = q;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);
  const defaultTo = sp.to && /^[rb]:.+$/.test(sp.to)
    && (sp.to.startsWith("r:") ? recipients.some((r) => r.id === sp.to!.slice(2)) : brigades.some((b) => b.id === sp.to!.slice(2)))
    ? sp.to : "";

  return (
    <div lang="ru">
      <PageHeader back={{ href: "/stock/rasxod", label: "Расход" }} title="Новый расход"
        subtitle="Выдача сырья со склада. Остаток уменьшается сразу; цена — «Дона сўм», заданная снабжением." />
      {warehouses.length === 0 ? (
        <Callout tone="warning" title="Нет склада">Сначала откройте склад в Настройках.</Callout>
      ) : (
        <Card>
          <RasxodForm
            warehouses={warehouses}
            recipients={recipients}
            brigades={brigades}
            materials={materials.map((m) => {
              const own = m.unitPrice == null ? null : Number(m.unitPrice);
              const fallback = avg.get(m.id) ?? null;
              return { id: m.id, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId, price: own ?? fallback, approx: own == null && fallback != null };
            })}
            groups={groups}
            balances={balances}
            clientToken={crypto.randomUUID()}
            today={isoDate(today)}
            minDate={isoDate(min)}
            defaultTo={defaultTo}
          />
        </Card>
      )}
    </div>
  );
}
