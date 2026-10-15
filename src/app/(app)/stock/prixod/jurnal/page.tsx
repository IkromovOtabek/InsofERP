import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { JournalImport } from "./journal-import";

/**
 * Sklad → Kirim → «Excel jurnal»: bir necha oylik kirim daftari (har qatorda o'z sanasi, yetkazuvchisi, TTN, to'lov turi)
 * bitta yuklashda kirim hujjatlariga bo'linib saqlanadi. Bitta nakladnoy uchun — «Excel'dan yuklash» (`../import`).
 * Brigadalarga chiqim keyin Sklad → «Brigadalar» oynasida taqsimlanadi.
 */
export default async function PrixodJournalPage() {
  const s = await requireRoles(["PROCUREMENT", "WAREHOUSE"], { module: "stock", actions: ["receipt"] });
  if (!canDo(s, "stock", "receipt")) redirect("/stock/prixod");
  const [warehouses, materials, suppliers] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.material.findMany({ select: { name: true, unit: true } }),
    db.supplier.findMany({ select: { name: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/stock/prixod", label: "Kirim" }} title="Excel jurnal"
        subtitle="Bir necha kunlik yoki oylik kirim daftarini yuklang: qatorlar sana, yetkazuvchi va TTN bo'yicha alohida kirim hujjatlariga bo'linadi. Saqlashdan oldin hammasini tekshirasiz." />
      <Card className="max-w-6xl">
        <JournalImport
          warehouses={warehouses}
          materials={materials.map((m) => [m.name.trim().toLowerCase(), m.unit])}
          suppliers={suppliers.map((x) => x.name.trim().toLowerCase())}
          canAddSuppliers={canDo(s, "stock", "suppliers")}
          canDistribute={canDo(s, "stock", "brigade")}
        />
      </Card>
    </div>
  );
}
