import Link from "next/link";
import { History, X } from "lucide-react";
import { dateTime } from "@/lib/format";
import type { ShopHistoryEntry } from "@/lib/shop-history";
import { Badge, Card, Empty } from "@/components/ui";

const ACTION = {
  CREATE: { label: "Qo'shdi", color: "green" },
  UPDATE: { label: "O'zgartirdi", color: "blue" },
  STATUS_CHANGE: { label: "Holatini o'zgartirdi", color: "amber" },
  DELETE: { label: "O'chirdi", color: "red" },
} as const;

/**
 * E-commerce tarixi: kim, qachon, qaysi mahsulot/reklamada nimani nimaga o'zgartirdi.
 * `filter` berilsa — bitta mahsulot tarixi (vitrinadagi "Tarix" havolasidan).
 */
export function ShopHistoryList({ entries, filter }: { entries: ShopHistoryEntry[]; filter?: { subject: string } }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{filter ? `Tarix: ${filter.subject}` : "O'zgarishlar tarixi"}</h2>
          <p className="text-xs text-slate-500">Vitrina va reklamadagi har bir tahrir yoziladi — kim, qachon, nima edi va nima bo'ldi. Tarixni o'chirib bo'lmaydi.</p>
        </div>
        {filter && (
          <Link href="/e-commerce?tab=tarix" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"><X size={14} /> Hammasi</Link>
        )}
      </div>
      {entries.length === 0 ? (
        <Empty text="Hali o'zgarish yo'q" icon={History} />
      ) : (
        <ol className="divide-y divide-slate-100">
          {entries.map((e) => {
            const a = ACTION[e.action as keyof typeof ACTION] ?? ACTION.UPDATE;
            return (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="whitespace-nowrap font-mono text-xs text-slate-500">{dateTime(e.at)}</span>
                  <span className="font-medium text-slate-900">{e.user}</span>
                  <Badge color={a.color} dot={false}>{a.label}</Badge>
                  {filter ? null : e.entity === "ShopItem"
                    ? <Link href={`/e-commerce?tab=tarix&p=${e.entityId}`} className="text-slate-700 hover:underline">{e.subject}</Link>
                    : <span className="text-slate-700">{e.subject}</span>}
                </div>
                {e.changes.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-sm">
                    {e.changes.map((c, i) => (
                      <li key={i} className="flex flex-wrap gap-x-1.5 text-slate-600">
                        <span className="text-slate-500">{c.field}:</span>
                        {c.from !== null && <span className="max-w-md truncate text-slate-400 line-through">{c.from}</span>}
                        {c.from !== null && <span className="text-slate-400">→</span>}
                        <span className="max-w-md truncate font-medium text-slate-800">{c.to ?? "bo'sh"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
