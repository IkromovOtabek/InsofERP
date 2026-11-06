import { History } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";
import type { ActivityRow } from "@/lib/activity";

/** «Amallar tarixi» kartasi — kim, qachon, nima qildi (`lib/activity.ts`). Eng yangisi tepada. */
export function ActivityLog({ rows, className }: { rows: ActivityRow[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader icon={History} title="Amallar tarixi" description="Kim, qachon va nima qildi" />
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Hali amal yozilmagan</p>
      ) : (
        <ol className="max-h-96 space-y-0 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li key={r.id} className="relative border-l border-slate-200 py-1.5 pl-4 last:pb-0">
              <span className="absolute -left-[4.5px] top-3 h-2 w-2 rounded-full bg-slate-300" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-medium text-slate-900">{r.text}</span>
                <span className="tabular text-xs text-slate-500">{dateTime(r.at)}</span>
              </div>
              <div className="text-xs text-slate-600">{r.by}</div>
              {r.details.length > 0 && (
                <ul className="mt-0.5 space-y-px text-xs text-slate-500">
                  {r.details.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
