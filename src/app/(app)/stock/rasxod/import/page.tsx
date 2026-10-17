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
  const [warehouses, targets, materials] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    issueTargetOptions(),
    db.material.findMany({ select: { name: true } }),
  ]);

  return (
    <div>
      <PageHeader back={{ href: "/stock/rasxod", label: "Chiqim" }} title="Excel orqali chiqim"
        subtitle="Kirimdagi kabi ustunli faylni yuklang: qatorlar sana va «Kimga» bo'yicha alohida chiqimlarga bo'linadi. Saqlashdan oldin hammasini tekshirasiz." />
      {warehouses.length === 0 ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <Card className="max-w-6xl">
          <IssueImport warehouses={warehouses} targets={targets} materials={materials.map((m) => m.name.trim().toLowerCase())} />
        </Card>
      )}
    </div>
  );
}
