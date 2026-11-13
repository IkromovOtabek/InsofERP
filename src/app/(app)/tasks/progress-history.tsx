import { History, Undo2 } from "lucide-react";
import { dateTime, qty } from "@/lib/format";
import { ConfirmButton } from "../payments/confirm-button";
import { cancelProgress } from "./actions";

export type ProgressRow = { id: string; qty: number; date: Date; note: string | null; by: string };

/**
 * Topshiriq qaydlari tarixi («Qaydlar (N)») — kim, qachon, qancha. Bekor qilish faqat topshiriqda YAGONA qayd bo'lsa
 * (`taskProgressCancel`): sklad harakatlari topshiriqqa umumiy yozilgan, bir nechta qaydda ularni aniq ajratib bo'lmaydi.
 */
export function ProgressHistory({ rows, unit, product, brigade, canUndo }: {
  rows: ProgressRow[]; unit: string; product: string; brigade: string; canUndo: boolean;
}) {
  const single = rows.length === 1;
  return (
    <details className="text-left text-xs">
      <summary className="inline-flex cursor-pointer select-none items-center gap-1 font-medium text-slate-500 hover:text-slate-900">
        <History size={13} /> Qaydlar ({rows.length})
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-slate-200 pl-2.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col items-start gap-0.5">
            <span className="text-slate-600"><b className="tabular text-slate-900">{qty(r.qty)} {unit}</b> · {dateTime(r.date)} · {r.by}</span>
            {r.note && <span className="text-slate-500">{r.note}</span>}
            {canUndo && single && (
              <ConfirmButton action={cancelProgress.bind(null, r.id)} reason="required" label="Bekor qilish" icon={<Undo2 size={13} />}
                okText="Qayd bekor qilindi" className="h-7 px-2 text-xs"
                question={`${brigade}: ${qty(r.qty)} ${unit} «${product}» qaydi bekor qilinsinmi? Hovlidan chiqariladi, xomashyo brigadaga qaytadi`} />
            )}
          </li>
        ))}
      </ul>
      {canUndo && !single && <p className="mt-1.5 max-w-64 text-slate-500">Bir nechta qayd bor — bittasini bekor qilib bo&apos;lmaydi (sklad harakatlari topshiriqqa umumiy yozilgan)</p>}
    </details>
  );
}
