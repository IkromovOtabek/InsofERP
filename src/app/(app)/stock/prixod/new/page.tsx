import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canEditMaterials } from "@/lib/catalog";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { issuePrices } from "@/lib/stock-price";
import { companyVatPayer } from "@/lib/receipt-vat";
import { isoDate } from "@/lib/format";
import { visionEnabled } from "@/lib/ai/vision";
import { PageHeader } from "@/components/ui";
import { PrixodForm } from "../prixod-form";

/** Sklad → «Kirim» → yangi kirim (Excel jurnali ustunlari bilan). `?scan=1` — nakladnoy skaneri darhol ochiladi. */
export default async function NewPrixodPage({ searchParams }: { searchParams: Promise<{ scan?: string }> }) {
  const s = await requireRoles(["PROCUREMENT", "WAREHOUSE"], { module: "stock", actions: ["receipt"] });
  // Rol mos, lekin direktor bu amalni olib qo'ygan bo'lsa — forma ochilmaydi (saqlashda baribir rad bo'lardi)
  if (!canDo(s, "stock", "receipt")) redirect("/stock/prixod");
  const [suppliers, warehouses, materials, groups, accounts, balances, recipients, vatPayer] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, vatPayer: true } }),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, groupId: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    s.role === "DIRECTOR" ? db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }) : Promise.resolve([]),
    // Qoldiq — spravochnikda ko'rinadi
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockRecipient.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    companyVatPayer(),
  ]);
  // Tanlanganda qatorga tushadigan narx: «Dona narxi» (Snabjeniye belgilagan), bo'lmasa o'rtacha tannarx
  const prices = await issuePrices(materials.map((m) => m.id));
  const bal = new Map(balances.map((b) => [b.materialId, Number(b._sum.qty ?? 0)]));
  return (
    <div>
      <PageHeader back={{ href: "/stock/prixod", label: "Kirim" }} title="Yangi kirim" subtitle="Saqlangandan keyin skladdagi qoldiq darhol oshadi" />
      <PrixodForm
        today={isoDate()}
        suppliers={suppliers}
        warehouses={warehouses}
        materials={materials.map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId, price: prices.get(m.id) ?? 0, balance: bal.get(m.id) ?? 0 }))}
        groups={groups}
        canCreate={canEditMaterials(s.role)}
        canAddSupplier={canDo(s, "stock", "suppliers")}
        recipients={recipients}
        // «Ta'minotchi» (xaridni qilgan snabjenets) — formada alohida maydon yo'q: Snabjeniye kiritsa o'zi yoziladi
        defaultBuyerId={s.role === "PROCUREMENT" ? s.userId : ""}
        accounts={accounts}
        clientToken={crypto.randomUUID()}
        companyVatPayer={vatPayer}
        scan={{ enabled: visionEnabled(), autoOpen: (await searchParams).scan === "1" }}
      />
    </div>
  );
}
