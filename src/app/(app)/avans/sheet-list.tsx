import Link from "next/link";
import { date, dateTime, money } from "@/lib/format";
import { monthTitle } from "@/lib/davomat";
import { ADVANCE_STATUS_BADGE, ADVANCE_STATUS_LABEL, type AdvanceSheetRow } from "@/lib/hr/advance-sheet";
import { Badge, Card, Empty, Table, Td, Th, Tr } from "@/components/ui";

/** Avans varaqalari ro'yxati — Ish haqi → Avans (sekretar) va `/avans` (qabul qiluvchi) uchun bir xil. */
export function AdvanceSheetList({ rows, empty }: { rows: AdvanceSheetRow[]; empty: string }) {
  return (
    <Card padded={false}>
      <Table>
        <thead><tr><Th>Varaqa</Th><Th>Oy / holati</Th><Th>Kimlar</Th><Th right>Xodim</Th><Th right>Avans</Th><Th right>Berildi</Th><Th>Jo&apos;natilgan</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text={empty} />}
          {rows.map((r) => (
            <Tr key={r.id} className={r.status === "CANCELLED" ? "opacity-50" : ""}>
              <Td className="font-medium"><Link href={`/avans/${r.id}`} className="text-brand-700 hover:underline">{r.docNo}</Link><div className="text-xs font-normal text-slate-500">{r.createdBy} · {dateTime(r.createdAt)}</div></Td>
              <Td>{monthTitle(r.month)}<div className="text-xs text-slate-500">{date(r.asOf)} holatiga</div></Td>
              <Td>{r.groupLabel ?? "Barcha xodimlar"}</Td>
              <Td right>{r.count}</Td>
              <Td right className="font-medium">{money(r.total)}</Td>
              <Td right>{r.given ? money(r.given) : "—"}</Td>
              <Td>{r.recipient ? <>{r.recipient}<div className="text-xs text-slate-500">{r.sentAt ? dateTime(r.sentAt) : ""}</div></> : "—"}</Td>
              <Td><Badge color={ADVANCE_STATUS_BADGE[r.status]}>{ADVANCE_STATUS_LABEL[r.status]}</Badge></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
