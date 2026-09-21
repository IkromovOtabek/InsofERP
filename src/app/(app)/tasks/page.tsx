import Link from "next/link";
import { ListChecks, Zap } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { requireSession } from "@/lib/auth";
import { qty, deliveryAt } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Button, Empty, PageHeader, Progress, Select, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { TASK_STATUS, TaskStatusBadge } from "./status";
import { ProgressForm } from "./progress-form";
import { cancelTask } from "./actions";
import type { TaskStatus } from "@/generated/prisma";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; brigade?: string }> }) {
  const { status, brigade } = await searchParams;
  const s = await requireSession(["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS"]);
  const canProgress = ["PRODUCTION", "LOGISTICS", "DIRECTOR"].includes(s.role);
  const canCancel = ["PRODUCTION", "SALES", "DIRECTOR"].includes(s.role);
  const st = status && status in TASK_STATUS ? (status as TaskStatus) : undefined;
  const [tasks, brigades] = await Promise.all([
    db.brigadeTask.findMany({
      where: { ...(st ? { status: st } : status === "" || !status ? { status: { in: ["NEW", "IN_PROGRESS"] } } : {}), ...(brigade ? { brigadeId: brigade } : {}) },
      orderBy: [{ order: { isUrgent: "desc" } }, { dueDate: "asc" }],
      include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } },
      take: 300,
    }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const marks = await customerMarks(tasks.map((t) => t.order.customerId));
  const q = (k: string) => `${k}${brigade ? `${k.includes("?") ? "&" : "?"}brigade=${brigade}` : ""}`;
  const tabs = [{ key: "", label: "Ochiq", href: q("/tasks") }, ...(Object.keys(TASK_STATUS) as TaskStatus[]).map((k) => ({ key: k, label: TASK_STATUS[k].label, href: q(`/tasks?status=${k}`) }))];

  return (
    <div>
      <PageHeader title="Topshiriqlar" subtitle="Zayavkadagi har bir mahsulot qatori biriktirilgan brigadaga topshiriq sifatida tushadi. Bajarilgan miqdor kiritilgach qoldiq ko'rinadi." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs current={st ?? ""} items={tabs} className="mb-0" />
        <form className="flex items-center gap-2">
          {st && <input type="hidden" name="status" value={st} />}
          <Select name="brigade" defaultValue={brigade ?? ""} className="h-9 w-56 text-sm">
            <option value="">Barcha brigadalar</option>
            {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Button variant="secondary" className="h-9 text-sm">Filtr</Button>
        </form>
      </div>
      <Table>
        <thead><tr><Th>№</Th><Th>Muddat</Th><Th>Brigada</Th><Th>Zayavka / mijoz</Th><Th>Mahsulot</Th><Th right>Topshiriq</Th><Th right>Bajarildi</Th><Th right>Qoldiq</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {tasks.length === 0 && <Empty text="Topshiriqlar yo'q" icon={ListChecks} />}
          {tasks.map((t) => {
            const total = Number(t.qty), done = Number(t.doneQty), rem = Math.max(0, total - done);
            const unit = unitLabel(t.orderItem.product.unit);
            const open = t.status === "NEW" || t.status === "IN_PROGRESS";
            return (
              <Tr key={t.id}>
                <Td className="font-medium">{t.taskNo}</Td>
                <Td>{deliveryAt(t.dueDate, t.order.deliveryTime)}{t.order.isUrgent && <div><Badge color="red"><Zap size={11} /> Zarur</Badge></div>}</Td>
                <Td>{t.brigade.name}</Td>
                <Td><Link href={`/orders/${t.orderId}`} className="hover:underline">{t.order.orderNo}</Link><div className="text-xs text-slate-500"><CustomerName name={t.order.customer.name} blacklisted={marks.black.has(t.order.customerId)} contracted={marks.contract.has(t.order.customerId)} short /></div></Td>
                <Td>{t.orderItem.product.name}</Td>
                <Td right>{qty(total)} {unit}</Td>
                <Td right className="text-emerald-700">{qty(done)}</Td>
                <Td right className={rem > 0 ? "font-semibold text-amber-700" : "text-slate-400"}>{qty(rem)}<div className="mt-1 w-20"><Progress value={done} max={total} tone={rem === 0 ? "success" : "default"} /></div></Td>
                <Td><TaskStatusBadge status={t.status} /></Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {open && canProgress && <ProgressForm taskId={t.id} remaining={rem} unit={unit} />}
                    {open && canCancel && <form action={cancelTask.bind(null, t.id)}><Button variant="ghost" className="h-8 px-2 text-xs text-red-600 hover:bg-red-50">Bekor</Button></form>}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
