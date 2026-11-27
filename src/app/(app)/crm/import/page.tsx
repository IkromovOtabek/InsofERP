import { notFound } from "next/navigation";
import { PageHeader, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { crmOptions } from "@/lib/crm/clients";
import { AmoImport, SheetsImport } from "./import-ui";

/** CRM importi (CRM_SPEC 6): Google Sheets fayli yoki amoCRM. Avval quruq ishga tushirish, keyin tasdiq. */
export default async function CrmImportPage({ searchParams }: { searchParams: Promise<{ manba?: string }> }) {
  const s = await requirePage("/crm/import");
  if (!canDo(s, "crm", "import")) notFound();
  const { manba } = await searchParams;
  const tab = manba === "amo" ? "amo" : "sheets";
  const [opts, results, users] = await Promise.all([
    crmOptions(),
    db.crmResult.findMany({ where: { isActive: true }, orderBy: { sort: "asc" }, select: { id: true, label: true } }),
    db.user.findMany({ where: { isActive: true, role: { notIn: ["DRIVER", "BRIGADIER", "SUPERADMIN"] } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="CRM importi" back={{ href: "/crm/mijozlar", label: "Mijozlar" }}
        info="Avval «Tekshirish» — hech narsa yozilmaydi, faqat hisobot: nechta yangi mijoz, nechtasi mavjud kartaga bog'lanadi, nechta aloqa, qaysi qatorlarda muammo. Keyin «Import qilish». Qayta ishga tushirilsa dublikat yaratmaydi. Mavjud mijozda faqat bo'sh CRM maydonlari to'ldiriladi." />
      <Tabs current={tab} items={[
        { key: "sheets", label: "Google Sheets", href: "/crm/import" },
        { key: "amo", label: "amoCRM", href: "/crm/import?manba=amo" },
      ]} />
      {tab === "sheets" ? <SheetsImport /> : <AmoImport sources={opts.SOURCE} results={results} users={users.map((u) => ({ id: u.id, label: u.fullName }))} />}
    </div>
  );
}
