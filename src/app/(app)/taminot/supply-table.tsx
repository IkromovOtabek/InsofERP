import Link from "next/link";
import { ClipboardList, Clock } from "lucide-react";
import { SUPPLY_COLOR, SUPPLY_LABEL, SUPPLY_OWNER, plannedSum, factSum, hasFact } from "@/lib/supply";
import type { SupplyStatus } from "@/generated/prisma";
import { money, date } from "@/lib/format";
import { Badge, Empty, Table, Td, Th, Tr } from "@/components/ui";

export type SupplyRow = {
  id: string; docNo: string; date: Date; status: SupplyStatus; needBy: Date | null;
  warehouse: { name: string }; supplier: { name: string } | null; createdBy: { fullName: string };
  items: { qty: unknown; price: unknown; factQty: unknown; factPrice: unknown }[];
};

/** Ta'minot zayavkalari ro'yxati — Snabjeniye oynasi ham, Ta'minot zayavkalari bo'limi ham shuni ko'rsatadi. */
export function SupplyTable({ rows, empty }: { rows: SupplyRow[]; empty: string }) {
  return (
    <Table>
      <thead><tr><Th>№</Th><Th>Sana</Th><Th>Sklad</Th><Th>Tarkib</Th><Th right>Summa</Th><Th>Holat</Th><Th>Kim kutmoqda</Th></tr></thead>
      <tbody>
        {rows.length === 0 && <Empty text={empty} icon={ClipboardList} />}
        {rows.map((r) => {
          const items = r.items as { qty: number; price: number; factQty: number | null; factPrice: number | null }[];
          const plan = plannedSum(items);
          const fact = hasFact(items) ? factSum(items) : null;
          const late = r.needBy != null && r.needBy < new Date() && r.status !== "RECEIVED" && r.status !== "REJECTED";
          return (
            <Tr key={r.id} className={late ? "bg-red-50/60" : undefined}>
              <Td><Link href={`/taminot/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
              <Td>
                {date(r.date)}
                {r.needBy && <div className={late ? "text-xs font-semibold text-red-600" : "text-xs text-slate-500"}>{date(r.needBy)} gacha</div>}
              </Td>
              <Td className="text-slate-600">{r.warehouse.name}<div className="text-xs text-slate-500">{r.createdBy.fullName}</div></Td>
              <Td className="text-slate-600">{items.length} qator{r.supplier ? ` · ${r.supplier.name}` : ""}</Td>
              <Td right>
                {plan > 0 ? money(plan) : <span className="text-slate-400">narx yo&apos;q</span>}
                {fact != null && Math.abs(fact - plan) > 0.5 && <div className={fact > plan ? "text-xs text-red-600" : "text-xs text-emerald-700"}>fakt {money(fact)}</div>}
              </Td>
              <Td>
                <Badge color={SUPPLY_COLOR[r.status]}>
                  {r.status === "APPROVED" && <Clock size={11} />}
                  {SUPPLY_LABEL[r.status]}
                </Badge>
              </Td>
              <Td className="text-xs text-slate-500">{SUPPLY_OWNER[r.status]}</Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
