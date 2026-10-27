import { CalendarDays, ListChecks, Zap } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { requireRoles } from "@/lib/page-guard";
import { qty, deliveryAt, date } from "@/lib/format";
import { fmtUnitTotals, unitLabel } from "@/lib/unit";
import { taskDefectTotals } from "@/lib/defects";
import { canTask } from "@/lib/tasks";
import { Badge, Button, Empty, Input, PageHeader, Progress, Select, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { TASK_STATUS, TaskStatusBadge } from "./status";
import { ProgressForm } from "./progress-form";
import { cancelTask } from "./actions";
import { CancelTaskButton } from "./cancel-button";
import type { TaskStatus } from "@/generated/prisma";

/** «Bajarildi» yorlig'i — tugatilgan sana bo'yicha davr (server mahalliy vaqti, TZ=Asia/Tashkent). */
const PERIODS = [
  { key: "all", label: "Hammasi" }, { key: "today", label: "Bugun" }, { key: "yesterday", label: "Kecha" },
  { key: "week", label: "Shu hafta" }, { key: "month", label: "Shu oy" },
] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y!, m! - 1, d!); };
function periodRange(key: string, from?: string, to?: string): { gte?: Date; lt?: Date } | null {
  // Ixtiyoriy oraliq (sanadan — sanagacha, ikkalasi ham kiradi) davr tugmalaridan ustun
  if ((from && DAY_RE.test(from)) || (to && DAY_RE.test(to))) {
    const r: { gte?: Date; lt?: Date } = {};
    if (from && DAY_RE.test(from)) r.gte = dayOf(from);
    if (to && DAY_RE.test(to)) { const t = dayOf(to); t.setDate(t.getDate() + 1); r.lt = t; }
    return r;
  }
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const add = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  if (key === "today") return { gte: t, lt: add(t, 1) };
  if (key === "yesterday") return { gte: add(t, -1), lt: t };
  if (key === "week") return { gte: add(t, -((t.getDay() + 6) % 7)), lt: add(t, 1) }; // dushanbadan
  if (key === "month") return { gte: new Date(t.getFullYear(), t.getMonth(), 1), lt: add(t, 1) };
  return null;
}
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; brigade?: string; period?: string; from?: string; to?: string }> }) {
  const { status, brigade, period = "all", from, to } = await searchParams;
  const s = await requireRoles(["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS"], { module: "tasks" });
  // Rol matritsasi `lib/tasks.ts` da — server action va mobil ilova ham shundan foydalanadi
  const canProgress = canTask(s.role, "progress");
  const canCancel = canTask(s.role, "cancel");
  const st = status && status in TASK_STATUS ? (status as TaskStatus) : undefined;
  // «Bajarildi»: tugatilgan vaqt — topshiriq DONE ga o'tgan payt (shundan keyin u o'zgarmaydi)
  const isDone = st === "DONE";
  const custom = isDone && !!((from && DAY_RE.test(from)) || (to && DAY_RE.test(to)));
  const range = isDone ? periodRange(period, from, to) : null;
  const [tasks, brigades] = await Promise.all([
    db.brigadeTask.findMany({
      where: { ...(st ? { status: st } : status === "" || !status ? { status: { in: ["NEW", "IN_PROGRESS"] } } : {}), ...(brigade ? { brigadeId: brigade } : {}), ...(range ? { updatedAt: range } : {}) },
      orderBy: isDone ? [{ updatedAt: "desc" }] : [{ order: { isUrgent: "desc" } }, { dueDate: "asc" }],
      include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } },
      take: 300,
    }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  // «Qolganini boshqa o'lchamda bajardim» — o'rinbosar uchun dona mahsulotlar (beton zames orqali yuritiladi)
  const subProducts = canProgress ? await db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, select: { id: true, name: true, unit: true }, orderBy: { name: "asc" } }) : [];
  const subBrigades = brigades.map((b) => ({ id: b.id, name: b.name }));
  const [marks, defects] = await Promise.all([customerMarks(tasks.map((t) => t.order.customerId)), taskDefectTotals(tasks.map((t) => t.id))]);
  const q = (k: string) => `${k}${brigade ? `${k.includes("?") ? "&" : "?"}brigade=${brigade}` : ""}`;
  // Davr havolalari: holat va brigada saqlanadi, ixtiyoriy oraliq tushib qoladi
  const pHref = (k: string) => `/tasks?status=DONE${brigade ? `&brigade=${brigade}` : ""}${k !== "all" ? `&period=${k}` : ""}`;
  const doneTotal = isDone ? fmtUnitTotals(tasks.map((t) => ({ unit: t.orderItem.product.unit, qty: t.doneQty }))) : "";
  const byBrigade = isDone ? [...tasks.reduce((m, t) => m.set(t.brigade.name, [...(m.get(t.brigade.name) ?? []), { unit: t.orderItem.product.unit, qty: t.doneQty }]), new Map<string, { unit: string; qty: unknown }[]>())]
    .map(([name, rows]) => ({ name, text: fmtUnitTotals(rows as { unit: string; qty: number }[]), n: rows.length })) : [];
  const tabs = [{ key: "", label: "Ochiq", href: q("/tasks") }, ...(Object.keys(TASK_STATUS) as TaskStatus[]).map((k) => ({ key: k, label: TASK_STATUS[k].label, href: q(`/tasks?status=${k}`) }))];

  return (
    <div>
      <PageHeader title="Topshiriqlar" subtitle="Zayavkadagi har bir mahsulot qatori biriktirilgan brigadaga topshiriq sifatida tushadi. Bajarilgan miqdor kiritilgach qoldiq ko'rinadi." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs current={st ?? ""} items={tabs} className="mb-0" />
        <form className="flex flex-wrap items-center gap-2">
          {st && <input type="hidden" name="status" value={st} />}
          {isDone && !custom && period !== "all" && <input type="hidden" name="period" value={period} />}
          <Select name="brigade" aria-label="Brigada" defaultValue={brigade ?? ""} className="h-9 w-56 text-sm">
            <option value="">Barcha brigadalar</option>
            {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          {isDone && (
            <>
              <Input type="date" name="from" defaultValue={custom ? from : ""} aria-label="Sanadan" className="h-9 w-40 text-sm" />
              <span className="text-sm text-slate-400">—</span>
              <Input type="date" name="to" defaultValue={custom ? to : ""} aria-label="Sanagacha" className="h-9 w-40 text-sm" />
            </>
          )}
          <Button variant="secondary" className="h-9 text-sm">Filtr</Button>
        </form>
      </div>
      {isDone && (
        <div className="mb-4 flex flex-col gap-2">
          <Tabs current={custom ? "" : period} scroll={false} className="mb-0 self-start" items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: pHref(p.key), icon: p.key === "all" ? undefined : CalendarDays }))} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span><b className="text-slate-900">{tasks.length} ta</b> topshiriq tugatildi{custom ? ` (${from ? date(dayOf(from)) : "…"} — ${to ? date(dayOf(to)) : "…"})` : ""} · jami <b className="text-slate-900">{doneTotal}</b></span>
            {byBrigade.map((b) => <span key={b.name} className="text-xs text-slate-500">{b.name}: <b className="text-slate-700">{b.text}</b> ({b.n})</span>)}
            {tasks.length >= 300 && <span className="text-xs text-amber-700">Faqat oxirgi 300 tasi — davrni toraytiring</span>}
          </div>
        </div>
      )}
      <Table>
        <thead><tr><Th>№</Th>{isDone && <Th>Tugatildi</Th>}<Th>Muddat</Th><Th>Brigada</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>Topshiriq</Th><Th right>Bajarildi</Th><Th right>Brak</Th><Th right>Qoldiq</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {tasks.length === 0 && <Empty text={isDone && range ? "Bu davrda tugatilgan topshiriq yo'q" : "Topshiriqlar yo'q"} icon={ListChecks} />}
          {tasks.map((t) => {
            const total = Number(t.qty), done = Number(t.doneQty), rem = Math.max(0, total - done);
            const unit = unitLabel(t.orderItem.product.unit);
            const open = t.status === "NEW" || t.status === "IN_PROGRESS";
            return (
              <Tr key={t.id}>
                <Td className="font-medium">{t.taskNo}</Td>
                {isDone && <Td className="whitespace-nowrap">{date(t.updatedAt)} <span className="text-slate-500">{hhmm(t.updatedAt)}</span></Td>}
                <Td>{deliveryAt(t.dueDate, t.order.deliveryTime)}{t.order.isUrgent && <div><Badge color="red"><Zap size={11} /> Zarur</Badge></div>}</Td>
                <Td>{t.brigade.name}</Td>
                <Td><CustomerName name={t.order.customer.name} blacklisted={marks.black.has(t.order.customerId)} contracted={marks.contract.has(t.order.customerId)} href={`/orders/${t.orderId}`} short /></Td>
                <Td>{t.orderItem.product.name}</Td>
                <Td right>{qty(total)} {unit}</Td>
                <Td right className="text-emerald-700">{qty(done)}</Td>
                <Td right className={defects.get(t.id) ? "text-red-700" : "text-slate-400"}>{defects.get(t.id) ? qty(defects.get(t.id)!) : "—"}</Td>
                <Td right className={rem > 0 ? "font-semibold text-amber-700" : "text-slate-400"}>{qty(rem)}<div className="mt-1 w-20"><Progress value={done} max={total} tone={rem === 0 ? "success" : "default"} /></div></Td>
                <Td><TaskStatusBadge status={t.status} /></Td>
                <Td>
                  <div className="flex items-start gap-2">
                    {open && canProgress && <ProgressForm taskId={t.id} remaining={rem} unit={unit} product={t.orderItem.product.name} productId={t.orderItem.productId} brigadeId={t.brigadeId} products={subProducts} brigades={subBrigades} />}
                    {open && canCancel && <CancelTaskButton action={cancelTask.bind(null, t.id)} />}
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
