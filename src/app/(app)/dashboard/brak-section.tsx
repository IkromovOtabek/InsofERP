import { dateTime, fmtNum, pct, qty } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { DEFECT_REASONS, type ProductionDay } from "@/lib/production-day";
import { Card, Td, Th, Tr } from "@/components/ui";
import { DefectForm, DeleteDefectButton } from "./production-forms";

/**
 * Brak: yozish formasi, oyning brak yozuvlari (summa bilan), mahsulot bo'yicha brak ulushi va sabablar.
 * Bosh sahifadagi «Brak» kartasi bosilganda ochiladigan `/dashboard/brak` sahifasida turadi.
 * O'chirish: direktor — har doim, boshqalar — bugun o'zi yozganini (`lib/defects.ts` → canDeleteDefect bilan bir xil).
 */
export function BrakSection({ d, brigades, userId, isDirector }: { d: ProductionDay; brigades: { id: string; name: string }[]; userId: string; isDirector: boolean }) {
  return (
    <Card padded={false}>
      <div className="px-5 py-4">
        <DefectForm products={d.products} brigades={brigades} reasons={DEFECT_REASONS} />
      </div>
      {d.defects.month.length > 0 && (
        <div className="grid grid-cols-1 border-t border-slate-100 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:divide-x xl:divide-slate-100 [&>*]:min-w-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr><Th>Vaqt</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th right>Summa</Th><Th>Sabab</Th><Th>Brigada</Th><Th>Kim</Th><Th /></tr></thead>
              <tbody>
                {d.defects.month.map((r) => {
                  const canDelete = isDirector || (r.createdById === userId && r.date >= d.from);
                  return (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap tabular text-slate-500">{dateTime(r.date)}</Td>
                      <Td><span className="font-medium">{r.product.code}</span></Td>
                      <Td right className="font-medium text-red-600">{qty(r.qty)} {unitLabel(r.product.unit)}</Td>
                      <Td right className="whitespace-nowrap tabular text-slate-600">{fmtNum(r.amount)}</Td>
                      <Td>{r.reason}{r.note && <div className="text-xs text-slate-400">{r.note}</div>}</Td>
                      <Td className="text-slate-500">{r.brigade ?? "—"}</Td>
                      <Td className="text-slate-500">{r.by}</Td>
                      <Td right>{canDelete && <DeleteDefectButton id={r.id} />}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-4 text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Oy bo&apos;yicha brak ulushi</div>
            <ul className="space-y-1.5">
              {d.produced.filter((r) => r.defectMonth > 0).map((r) => (
                <li key={r.product.id} className="flex justify-between gap-2">
                  <span>{r.product.code}</span>
                  <span className="tabular"><span className="text-red-600">{qty(r.defectMonth)}</span> / {qty(r.month)} {unitLabel(r.product.unit)} · <b>{r.month > 0 ? pct((r.defectMonth / r.month) * 100) : "—"}</b></span>
                </li>
              ))}
            </ul>
            <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Sabablar</div>
            <ul className="space-y-1">
              {d.defects.byReason.map(([r, n]) => <li key={r} className="flex justify-between"><span className="text-slate-600">{r}</span><span className="tabular">{n}</span></li>)}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
