import { requirePage } from "@/lib/page-guard";
import { canAdvance, listAdvanceSheets } from "@/lib/hr/advance-sheet";
import { Callout, LinkButton, PageHeader } from "@/components/ui";
import { AdvanceSheetList } from "./sheet-list";

/** Avans varaqalari: menga jo'natilganlari (avans beraman) va men tuzganlari. Sekretarning asosiy oynasi — Ish haqi → Avans. */
export default async function AdvanceSheetsPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const s = await requirePage("/avans");
  const sp = await searchParams;
  const editor = canAdvance(s);
  const [mine, made] = await Promise.all([
    listAdvanceSheets({ recipientId: s.userId, status: { not: "DRAFT" } }, 60),
    editor ? Promise.resolve([]) : listAdvanceSheets({ OR: [{ createdById: s.userId }, { sentById: s.userId }] }, 30),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Avans varaqalari" info="Sizga jo'natilgan avans varaqalari: ochib, kassani tanlang va har xodimga «Berildi» belgilang — kassadan chiqim o'zi yoziladi. Excel'ni varaqa sahifasidan yuklab olasiz"
        action={editor ? <LinkButton href="/ish-haqi?tab=avans" variant="secondary" size="sm">Ish haqi → Avans</LinkButton> : undefined} />
      {sp.denied && <Callout tone="warning" title="Ruxsat yo'q">Bu varaqa sizga jo&apos;natilmagan.</Callout>}
      <AdvanceSheetList rows={mine} empty="Sizga jo'natilgan avans varaqasi yo'q" />
      {made.length > 0 && <><h2 className="pt-2 text-sm font-semibold text-slate-900">Men tuzgan varaqalar</h2><AdvanceSheetList rows={made} empty="" /></>}
    </div>
  );
}
