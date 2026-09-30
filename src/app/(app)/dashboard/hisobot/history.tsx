import Link from "next/link";
import { History } from "lucide-react";
import { dayTitle } from "@/lib/davomat";
import { dateTime } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { reportHistory } from "@/lib/production-report";

type Row = Awaited<ReturnType<typeof reportHistory>>[number];

/** Qayd etilgan hisobotlar tarixi — hisobot sahifasi pastida va direktor kabinetida. */
export function ReportHistory({ rows, current, title = "Qayd etilgan hisobotlar" }: { rows: Row[]; current: string | null; title?: string }) {
  return (
    <Card padded={false}>
      <div className="px-5 pt-5"><CardHeader icon={History} title={title} description="Saqlangan varaq o'zgarmaydi — keyin tuzatilgan raqamlar faqat yangi qayd etilgan nusxada ko'rinadi" /></div>
      <Table className="rounded-none border-0 shadow-none">
        <thead><tr><Th>Kun</Th><Th>Xulosa</Th><Th>Kim qayd etdi</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text="Hali hisobot qayd etilmagan" icon={History} />}
          {rows.map((r) => (
            <Tr key={r.id} className={cn(r.id === current && "bg-brand-50/60")}>
              <Td className="whitespace-nowrap">
                <Link href={`/dashboard/hisobot/${r.id}`} className="font-medium hover:underline">{dayTitle(r.iso)}</Link>
                {!r.latest && <div className="text-[11px] text-slate-400">avvalgi nusxa</div>}
              </Td>
              <Td className="text-slate-600">{r.summary}{r.note && <div className="text-xs text-slate-400">“{r.note}”</div>}</Td>
              <Td className="whitespace-nowrap text-slate-500">{r.by}<div className="text-[11px] text-slate-400">{dateTime(r.createdAt)}</div></Td>
              <Td>{r.seenAt ? <Badge color="green">Direktor ko&apos;rdi</Badge> : <Badge color="amber">Yangi</Badge>}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
