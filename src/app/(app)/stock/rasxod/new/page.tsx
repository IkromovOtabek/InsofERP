import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { avgUnitCosts } from "@/lib/stock";
import { issueTargetOptions } from "@/lib/stock-recipients";
import { ISSUE_BACK_DAYS, issueHints, parseIssueTarget } from "@/lib/stock-issue";
import { isoDate } from "@/lib/format";
import { Callout, Card, PageHeader } from "@/components/ui";
import { HoldingsPanel } from "@/components/holdings-panel";
import { holdingsOverview } from "@/lib/holdings";
import { RasxodForm } from "../rasxod-form";

/**
 * Sklad → «Chiqim» → Yangi chiqim: skladdan oluvchiga yoki brigadaga xomashyo berish.
 * Narx — «Dona narxi» («Дона сўм») (Snabjeniye belgilagan; bo'lmasa o'rtacha tannarx, «≈»). Qoldiq — tanlangan sklad bo'yicha.
 */
export default async function NewRasxodPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const s = await requireRoles(["WAREHOUSE", "PROCUREMENT"], { module: "stock", actions: ["issue"] });
  // Rol mos, lekin direktor bu amalni olib qo'ygan bo'lsa — forma ochilmaydi (saqlashda baribir rad bo'lardi)
  if (!canDo(s, "stock", "issue")) redirect("/stock/rasxod");
  const sp = await searchParams;

  const [warehouses, targets, hints, materials, groups, sums, avg, holdings] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    issueTargetOptions(),
    issueHints(),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, groupId: true, unitPrice: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    db.stockMove.groupBy({ by: ["warehouseId", "materialId", "type"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    avgUnitCosts(),
    holdingsOverview(),
  ]);
  // Qoldiq — barcha harakatlar yig'indisi; «Kirim» / «Chiqim» — nom tanlashda ko'rsatish uchun (shu sklad, butun davr):
  // kirim = RECEIPT, chiqim = oluvchi/xodimga (ISSUE) + brigadaga (BRIGADE_ISSUE − BRIGADE_RETURN), stornolar ichida netlanadi
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const balances: Record<string, Record<string, number>> = {};
  const flows: Record<string, Record<string, { received: number; issued: number }>> = {};
  for (const x of sums) {
    if (!x.materialId) continue;
    const q = Number(x._sum.qty ?? 0);
    const b = (balances[x.warehouseId] ??= {});
    b[x.materialId] = r3((b[x.materialId] ?? 0) + q);
    const f = ((flows[x.warehouseId] ??= {})[x.materialId] ??= { received: 0, issued: 0 });
    if (x.type === "RECEIPT") f.received = r3(f.received + q);
    else if (x.type === "ISSUE" || x.type === "BRIGADE_ISSUE" || x.type === "BRIGADE_RETURN") f.issued = r3(f.issued - q);
  }
  for (const b of Object.values(balances)) for (const [id, q] of Object.entries(b)) if (Math.abs(q) < 0.0005) delete b[id];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);
  // ?to=b:<id> | e:<id> | r:<id> (oluvchi kartasidan «Shu oluvchiga chiqim») — faqat ro'yxatda bor bo'lsa
  const t = parseIssueTarget(sp.to);
  const known = t && (t.kind === "brigade" ? targets.brigades : t.kind === "employee" ? targets.employees : targets.recipients).some((x) => x.id === t.id);
  const defaultTo = known ? sp.to! : "";

  return (
    <div>
      <PageHeader back={{ href: "/stock/rasxod", label: "Chiqim" }} title="Yangi chiqim"
        subtitle="Skladdan xomashyo berish. Qoldiq darhol kamayadi; narx — ta'minot belgilagan «Dona narxi»." />
      {warehouses.length === 0 ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <Card>
          <RasxodForm
            warehouses={warehouses}
            targets={targets}
            hints={hints}
            materials={materials.map((m) => {
              const own = m.unitPrice == null ? null : Number(m.unitPrice);
              const fallback = avg.get(m.id) ?? null;
              return { id: m.id, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId, price: own ?? fallback, approx: own == null && fallback != null };
            })}
            groups={groups}
            balances={balances}
            flows={flows}
            holdings={holdings}
            clientToken={crypto.randomUUID()}
            today={isoDate(today)}
            minDate={isoDate(min)}
            defaultTo={defaultTo}
          />
        </Card>
      )}
      <div className="mt-6"><HoldingsPanel holdings={holdings} collapsible /></div>
    </div>
  );
}
