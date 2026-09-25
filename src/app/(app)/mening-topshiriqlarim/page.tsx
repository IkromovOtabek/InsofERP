import Link from "next/link";
import { CheckCheck, HardHat, ListChecks, Package, Phone, Zap } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { myBrigades } from "@/lib/brigades";
import { qty as q, date, deliveryAt } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Empty, EmptyState, PageHeader, Progress, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { TaskStatusBadge } from "../tasks/status";

/**
 * Brigadirning o'z sahifasi. ERP'da brigadir boshqa bo'limlarni ko'rmaydi (middleware shu
 * sahifaga yo'naltiradi): bu yerda faqat o'z brigadasiga tayinlangan topshiriqlar.
 * Bajarilgan miqdor Insof ECO ilovasida qayd qilinadi — veb "nima qilish kerak edi" ni ko'rsatadi.
 */
export default async function MyTasksPage() {
  const s = await requireSession(["BRIGADIER"]);
  const [me, brigades] = await Promise.all([
    db.employee.findFirst({ where: { userId: s.userId }, select: { fullName: true, phone: true } }),
    myBrigades(s.userId),
  ]);

  if (!me) {
    return (
      <div>
        <PageHeader title="Mening topshiriqlarim" />
        <EmptyState icon={HardHat} title="Login xodim kartasiga bog'lanmagan"
          text="Otdel kadrga ayting: Xodimlar bo'limida sizning kartangizga shu login biriktirilishi kerak." />
      </div>
    );
  }
  if (brigades.length === 0) {
    return (
      <div>
        <PageHeader title="Mening topshiriqlarim" subtitle={me.fullName} />
        <EmptyState icon={HardHat} title="Siz hali brigadir emassiz"
          text="Ishlab chiqarish yoki Otdel kadr sizni brigadaga brigadir qilib biriktirgach, tayinlangan topshiriqlar shu yerda va Insof ECO ilovasida chiqadi." />
      </div>
    );
  }

  const brigadeIds = brigades.map((b) => b.id);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const include = { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } } as const;
  const [open, done, todayProgress] = await Promise.all([
    db.brigadeTask.findMany({
      where: { brigadeId: { in: brigadeIds }, status: { in: ["NEW", "IN_PROGRESS"] } },
      orderBy: { dueDate: "asc" }, include,
    }),
    db.brigadeTask.findMany({
      where: { brigadeId: { in: brigadeIds }, status: { in: ["DONE", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" }, take: 50, include,
    }),
    db.taskProgress.findMany({
      where: { date: { gte: today }, task: { brigadeId: { in: brigadeIds } } },
      select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } },
    }),
  ]);
  const left = open.reduce((x, t) => x + Math.max(0, Number(t.qty) - Number(t.doneQty)), 0);
  const overdue = open.filter((t) => t.dueDate < today).length;
  const doneToday = todayProgress.reduce((x, p) => x + Number(p.qty), 0);

  return (
    <div>
      <PageHeader title="Mening topshiriqlarim"
        subtitle={`${me.fullName} · ${brigades.map((b) => b.name).join(", ")}`} />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Ochiq topshiriq" value={`${open.length} ta`} icon={ListChecks} tone={open.length ? "brand" : "success"} />
        <StatCard label="Qolgan hajm" value={q(left)} hint="bajarilishi kerak" icon={Package} tone={left > 0 ? "warning" : "success"} />
        <StatCard label="Kechikkan" value={`${overdue} ta`} hint={overdue ? "muddati o'tgan" : "muddat buzilmagan"} icon={Zap} tone={overdue ? "danger" : "success"} />
        <StatCard label="Bugun bajarildi" value={q(doneToday)} hint={`${todayProgress.length} qayd`} icon={CheckCheck} tone="success" />
      </div>

      <Card className="mb-5" padded={false}>
        <div className="p-5"><CardHeader icon={Package} title="Bajarilishi kerak" description="Ishlab chiqarish brigadangizga tayinlagan topshiriqlar" /></div>
        <Table>
          <thead><tr><Th>№</Th><Th>Muddat</Th><Th>Zayavka / mijoz</Th><Th>Mahsulot</Th><Th right>Topshiriq</Th><Th right>Bajarildi</Th><Th right>Qoldiq</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {open.length === 0 && <Empty text="Ochiq topshiriq yo'q — brigadangizga tayinlansa shu yerda chiqadi" icon={ListChecks} />}
            {open.map((t) => {
              const total = Number(t.qty), doneQty = Number(t.doneQty), rem = Math.max(0, total - doneQty);
              const unit = unitLabel(t.orderItem.product.unit);
              return (
                <Tr key={t.id}>
                  <Td className="font-medium">{t.taskNo}{brigades.length > 1 && <div className="text-xs text-slate-500">{t.brigade.name}</div>}</Td>
                  <Td className={t.dueDate < today ? "text-red-700" : undefined}>
                    {deliveryAt(t.dueDate, t.order.deliveryTime)}
                    {t.order.isUrgent && <div><Badge color="red"><Zap size={11} /> Zarur</Badge></div>}
                  </Td>
                  <Td>{t.order.orderNo}<div className="text-xs text-slate-500">{t.order.customer.name}</div></Td>
                  <Td>{t.orderItem.product.name}</Td>
                  <Td right className="whitespace-nowrap">{q(total)} {unit}</Td>
                  <Td right className="text-emerald-700">{q(doneQty)}</Td>
                  <Td right className={rem > 0 ? "font-semibold text-amber-700" : "text-slate-400"}>
                    {q(rem)}<div className="mt-1 w-20"><Progress value={doneQty} max={total || 1} tone={rem === 0 ? "success" : "default"} /></div>
                  </Td>
                  <Td><TaskStatusBadge status={t.status} /></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-3 font-semibold">Tarix</h2>
      <Table>
        <thead><tr><Th>№</Th><Th>Zayavka / mijoz</Th><Th>Mahsulot</Th><Th>Muddat</Th><Th right>Bajarildi</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {done.length === 0 && <Empty text="Hali yakunlangan topshiriq yo'q" />}
          {done.map((t) => (
            <Tr key={t.id}>
              <Td className="font-medium">{t.taskNo}</Td>
              <Td>{t.order.orderNo}<div className="text-xs text-slate-500">{t.order.customer.name}</div></Td>
              <Td>{t.orderItem.product.name}</Td>
              <Td>{date(t.dueDate)}</Td>
              <Td right className="whitespace-nowrap">{q(t.doneQty)} / {q(t.qty)} {unitLabel(t.orderItem.product.unit)}</Td>
              <Td><TaskStatusBadge status={t.status} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-slate-500">
        Bajarilgan miqdorni <b>Insof ECO</b> ilovasida qayd qilasiz — bu sahifa shu ma&apos;lumotni ko&apos;rsatadi.
        Savol bo&apos;lsa ishlab chiqarish bo&apos;limiga murojaat qiling. <Link href="/qollanma" className="underline">Qo&apos;llanma</Link>
      </p>
      {me.phone && <p className="mt-1 text-xs text-slate-400"><Phone size={11} className="inline" /> {me.phone}</p>}
    </div>
  );
}
