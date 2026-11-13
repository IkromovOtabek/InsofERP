import { CalendarCheck, FileSpreadsheet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { LinkButton, PageHeader } from "@/components/ui";
import { AccountMatrix, KassaDateBar, KassaJurnalTab, kassaRange } from "./kassa-jurnal";
import { canDo } from "@/lib/permissions";

/**
 * Kassa / bank — tepada sana, ostida hisoblar matritsasi (shu davr boshidagi qoldiq, kirim/chiqim, davr oxiridagi
 * qoldiq) va Kassa jurnali — kassa va bank hisoblari bo'yicha barcha kirim/chiqim (Google jadvalidagi «Kassa» varag'i kabi).
 * «Excel orqali qo'shish» — Kassa jurnali ustunlaridagi fayl kirim/chiqim bo'lib yoziladi (`payments/import`).
 * Ilgari bu yerda «To'lovlar» va «Realizatsiya jurnali» tablari ham bor edi — olib tashlandi (2026-11-13).
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; kind?: string; manba?: string; q?: string; import?: string }> }) {
  const sp = await searchParams;
  const s = await requirePage("/payments");
  const canImport = canDo(s, "payments", "import");
  const canBalance = !!s && canDo(s, "payments", "balance");
  // Qator tafsilotidagi «Tahrirlash» — tugmalarni server har qator uchun alohida hal qiladi (`row-detail.ts`),
  // bu yerda faqat tahrir oynasi ro'yxatlari yuklanadimi
  const canEdit = !!s && canDo(s, "cashflow", "edit");
  // Tahrirdagi sub manba yonida «+» — Kirim-Chiqim formasidagi qoida (`lib/quick-add-actions.ts` → canCashAdd)
  const canAddSub = !!s && (canDo(s, "cashflow", "create") || canDo(s, "moliya", "categories"));

  const accounts = await db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } });

  return (
    <div>
      <PageHeader
        title="Kassa / bank"
        action={canImport || canBalance ? (
          <div className="flex flex-wrap gap-2">
            {canBalance && <LinkButton href="/payments/qoldiq" variant="secondary"><CalendarCheck size={15} /> Oy oxiri qoldiqlari</LinkButton>}
            {canImport && <LinkButton href="/payments/import" variant="secondary"><FileSpreadsheet size={15} /> Excel orqali qo&apos;shish</LinkButton>}
          </div>
        ) : undefined}
      />

      {/* Sana — eng tepada: matritsa ham, jurnal ham shu davr bo'yicha */}
      <KassaDateBar sp={sp} />

      {/* Hisob ustuni nomi bosilsa — kassa jurnali shu hisob bo'yicha; to'liq hisob ko'chirmasi — Kirim-Chiqimda */}
      <AccountMatrix accounts={accounts} range={kassaRange(sp)} />

      <KassaJurnalTab accounts={accounts} sp={sp} canEdit={canEdit} canAddSub={canAddSub} />
    </div>
  );
}
