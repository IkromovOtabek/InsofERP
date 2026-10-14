import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { money, isoDate } from "@/lib/format";
import { Empty, Section, Table, Td, Th, Tr } from "@/components/ui";
import { OrderStatusBadge, SALES_STATUSES } from "../orders/status";
import type { OrderStatus } from "@/generated/prisma";

/**
 * Buxgalteriya kabineti: Sotuv holatlari — joriy oyda qabul qilingan zayavkalar holat bo'yicha (soni, summa,
 * to'langan, qoldiq). Hisob Sotuv sahifasi bilan bir xil: summa = Σ miqdor × narx, to'langan = schyot to'lovlari
 * (bekor qilinmagan schyot) + schyotsiz avanslar. Qator bosilsa — Sotuv sahifasi shu holat filtri bilan.
 */
export async function SalesStatusSection() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await db.$queryRaw<{ status: OrderStatus; n: bigint; total: unknown; paid: unknown }[]>`
    SELECT o."status", COUNT(*) AS n,
      COALESCE(SUM((SELECT SUM(i."qtyM3" * i."price") FROM "OrderItem" i WHERE i."orderId" = o."id")), 0) AS total,
      COALESCE(SUM((SELECT SUM(p."amount") FROM "Payment" p LEFT JOIN "Invoice" v ON v."id" = p."invoiceId"
        WHERE (v."orderId" = o."id" AND v."status"::text <> 'CANCELLED') OR (p."invoiceId" IS NULL AND p."orderId" = o."id"))), 0) AS paid
    FROM "Order" o
    WHERE o."kind"::text = 'SALE' AND o."status"::text = ANY(${SALES_STATUSES as string[]}) AND o."date" >= ${from}
    GROUP BY o."status"`;
  const by = new Map(rows.map((r) => [r.status, { n: Number(r.n), total: Number(r.total ?? 0), paid: Number(r.paid ?? 0) }]));
  const list = SALES_STATUSES.map((st) => ({ st, ...(by.get(st) ?? { n: 0, total: 0, paid: 0 }) }));
  const sum = list.reduce((a, r) => ({ n: a.n + r.n, total: a.total + r.total, paid: a.paid + r.paid }), { n: 0, total: 0, paid: 0 });
  const period = `from=${isoDate(from)}&to=${isoDate(now)}`;

  return (
    <Section title="Sotuv holatlari (joriy oy)" action={<Link href={`/sales?${period}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Sotuv <ArrowRight size={14} /></Link>}>
      <Table>
        <thead><tr><Th>Holat</Th><Th right>Zayavka</Th><Th right>Summa</Th><Th right>To&apos;langan</Th><Th right>Qoldiq</Th></tr></thead>
        <tbody>
          {sum.n === 0 && <Empty text="Joriy oyda qabul qilingan zayavka yo'q" />}
          {sum.n > 0 && list.map((r) => (
            <Tr key={r.st}>
              <Td><Link href={`/sales?status=${r.st}&${period}`} className="hover:underline"><OrderStatusBadge status={r.st} /></Link></Td>
              <Td right className="tabular-nums">{r.n}</Td>
              <Td right className="whitespace-nowrap tabular-nums">{money(r.total)}</Td>
              <Td right className="whitespace-nowrap tabular-nums text-emerald-700">{money(r.paid)}</Td>
              <Td right className={"whitespace-nowrap tabular-nums " + (r.total - r.paid > 0.005 ? "text-red-600" : "text-slate-400")}>{money(Math.max(0, r.total - r.paid))}</Td>
            </Tr>
          ))}
          {sum.n > 0 && (
            <Tr>
              <Td className="font-semibold">Jami</Td>
              <Td right className="font-semibold tabular-nums">{sum.n}</Td>
              <Td right className="whitespace-nowrap font-semibold tabular-nums">{money(sum.total)}</Td>
              <Td right className="whitespace-nowrap font-semibold tabular-nums text-emerald-700">{money(sum.paid)}</Td>
              <Td right className="whitespace-nowrap font-semibold tabular-nums">{money(Math.max(0, sum.total - sum.paid))}</Td>
            </Tr>
          )}
        </tbody>
      </Table>
    </Section>
  );
}
