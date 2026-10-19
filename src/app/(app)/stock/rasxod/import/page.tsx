import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { issueTargetOptions } from "@/lib/stock-recipients";
import { Callout, Card, PageHeader } from "@/components/ui";
import { IssueImport } from "./issue-import";

/**
 * Sklad → «Chiqim» → Excel orqali: Kirim bilan bir xil ustunli fayl (Sana, Tovar, O'lchov, Miqdor, Kimga…).
 * Qatorlar «sana + kimga» bo'yicha alohida chiqim hujjatlariga bo'linadi (`lib/issue-journal.ts`), narx skladdan.
 */
export default async function RasxodImportPage() {
  const s = await requireRoles(["WAREHOUSE", "PROCUREMENT"], { module: "stock", actions: ["issue"] });
  if (!canDo(s, "stock", "issue")) redirect("/stock/rasxod");
  const [warehouses, targets, materials, sums] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    issueTargetOptions(),
    db.material.findMany({ select: { id: true, code: true, name: true, unit: true } }),
    db.stockMove.groupBy({ by: ["materialId", "warehouseId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  // Har xomashyoning sklad bo'yicha joriy qoldig'i (kirim − chiqim) — fayldagi chiqim shundan ayirilib oldindan ko'rsatiladi
  const bal = new Map<string, Record<string, number>>();
  for (const x of sums) {
    const m = bal.get(x.materialId!) ?? {};
    m[x.warehouseId] = Number(x._sum.qty ?? 0);
    bal.set(x.materialId!, m);
  }

  return (
    <div>
      <PageHeader back={{ href: "/stock/rasxod", label: "Chiqim" }} title="Excel orqali chiqim"
        subtitle="Kirimdagi kabi ustunli faylni yuklang: qatorlar sana va «Kimga» bo'yicha alohida chiqimlarga bo'linadi. Saqlashdan oldin hammasini tekshirasiz." />
      {warehouses.length === 0 ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <Card className="max-w-6xl">
          <IssueImport warehouses={warehouses} targets={targets}
            materials={materials.map((m) => ({ id: m.id, code: m.code.toLowerCase(), name: m.name.trim(), unit: m.unit, balance: bal.get(m.id) ?? {} }))} />
        </Card>
      )}
    </div>
  );
}
