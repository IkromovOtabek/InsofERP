import { Bell, Car } from "lucide-react";
import type { AvtoFeedRow, AvtoPartRow } from "@/lib/avto-parts";
import { date, fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, LinkButton } from "@/components/ui";
import { cn } from "@/lib/utils";

const FRESH_DAYS = 7;

/**
 * Mexanik Sklad oynasidagi «Siz uchun» — faqat Avto zapchastlar: joriy qoldiq, oxirgi 7 kunda kelgan
 * yoki qo'shilganlari «Yangi» belgisi bilan tepada. «Yangi kelganlar» — to'liq ro'yxat (`/stock/avto-zapchast`).
 */
export function ForYouParts({ parts, feed }: { parts: AvtoPartRow[]; feed: AvtoFeedRow[] }) {
  const freshFrom = Date.now() - FRESH_DAYS * 864e5;
  const fresh = new Map<string, Date>();
  for (const f of feed) if (f.addedAt.getTime() >= freshFrom && !fresh.has(f.materialId)) fresh.set(f.materialId, f.date);
  const sorted = [...parts].sort((a, b) => (fresh.has(b.id) ? 1 : 0) - (fresh.has(a.id) ? 1 : 0) || a.name.localeCompare(b.name));
  return (
    <Card className="mb-4">
      <CardHeader icon={Car} title="Siz uchun — Avto zapchastlar"
        description={parts.length ? `${parts.length} ta avto zapchast · ${fresh.size ? `${fresh.size} tasi so'nggi ${FRESH_DAYS} kunda kelgan` : `so'nggi ${FRESH_DAYS} kunda yangi kelgani yo'q`}` : "Spravochnikda Avto zapchast kategoriyasidagi mahsulot hali yo'q"}
        action={<LinkButton href="/stock/avto-zapchast" variant="secondary" size="sm"><Bell size={15} /> Yangi kelganlar</LinkButton>} />
      {parts.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.slice(0, 12).map((p) => {
            const f = fresh.get(p.id);
            return (
              <li key={p.id} className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", f ? "border-blue-200 bg-blue-50/60" : "border-slate-200")}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{p.name}</span>
                  <span className="block text-xs text-slate-500">{p.code}{p.lastIn ? ` · oxirgi kirim ${date(p.lastIn)}` : ""}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn("tabular font-semibold", p.balance > 0 ? "text-emerald-700" : "text-slate-400")}>{fmtNum(p.balance, 3)} {unitLabel(p.unit)}</span>
                  {f && <Badge color="blue" dot={false}>Yangi</Badge>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {parts.length > 12 && <p className="mt-2 text-xs text-slate-500">Yana {parts.length - 12} ta — pastdagi jadvalda «Avto zapchast» kategoriyasini tanlang.</p>}
    </Card>
  );
}
