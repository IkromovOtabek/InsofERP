import Link from "next/link";
import { Users, Wallet, HandCoins, UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { customersCredit } from "@/lib/finance";
import { money } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { AgentOrderForm } from "./agent-order-form";
import { AssignAgentForm } from "./assign-form";

/**
 * Sotuv agenti kabineti (ko'chadagi agent). AGENT uchun — vebdagi yagona sahifa (OWN_PAGE_ONLY):
 * o'z mijozlari, har birining zavoddan qarzi, umumiy qarz va "Yangi zayavka" (faqat o'z mijoziga).
 * Direktor / otdel kadr / sotuv uchun — mijozni agentga biriktirish va agentlar bo'yicha umumiy ko'rinish.
 */
export default async function AgentPage() {
  const s = await requirePage("/agent");
  return s.role === "AGENT" ? <AgentCabinet userId={s.userId} fullName={s.fullName} /> : <AgentManage />;
}

/* ───────────────────────── Agentning o'z kabineti ───────────────────────── */

async function AgentCabinet({ userId, fullName }: { userId: string; fullName: string }) {
  const [customers, products] = await Promise.all([
    db.customer.findMany({ where: { agentId: userId }, orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, name: true, phone: true, isActive: true } }),
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, name: true, unit: true, price: true } }),
  ]);
  const credit = await customersCredit(customers.map((c) => c.id));
  const totalDebt = customers.reduce((sum, c) => sum + (credit.get(c.id)?.debt ?? 0), 0);
  const activeCustomers = customers.filter((c) => c.isActive);

  return (
    <div>
      <PageHeader title="Mening mijozlarim" subtitle={fullName} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 [&>*]:min-w-0">
        <StatCard label="Olib kelgan mijozlar" value={`${customers.length} ta`} hint={`${activeCustomers.length} faol`} icon={Users} tone="brand" />
        <StatCard label="Umumiy qarz" value={money(totalDebt)} icon={HandCoins} tone={totalDebt > 0 ? "warning" : "success"} />
        <StatCard label="Qarzdor mijoz" value={`${[...credit.values()].filter((c) => c.debt > 0).length} ta`} icon={Wallet} tone="default" />
      </div>

      <Card className="mb-5">
        <CardHeader icon={UserPlus} title="Yangi zayavka" description="Faqat o'z mijozingizga. Zayavka qoralama bo'lib tushadi — sotuv bo'limi qabul qiladi." />
        <div className="mt-3"><AgentOrderForm customers={activeCustomers.map((c) => ({ id: c.id, name: c.name }))} products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, price: Number(p.price) }))} /></div>
      </Card>

      <Card padded={false}>
        <div className="p-5"><CardHeader icon={Users} title="Mijozlar va qarz" description="Har mijozning zavoddan joriy qarzi" /></div>
        <Table>
          <thead><tr><Th>Mijoz</Th><Th>Telefon</Th><Th right>Qarz</Th><Th right>Limitda qolgan</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {customers.length === 0 && <Empty text="Sizga hali mijoz biriktirilmagan — direktor/sotuv bo'limiga ayting" icon={Users} />}
            {customers.map((c) => {
              const cr = credit.get(c.id);
              const black = !!cr?.blacklisted;
              return (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="text-slate-600">{c.phone ?? "—"}</Td>
                  <Td right className={cr && cr.debt > 0 ? "font-medium text-amber-700" : "text-slate-500"}>{money(cr?.debt ?? 0)}</Td>
                  <Td right className="text-slate-600">{cr ? money(Math.max(0, cr.limit - cr.used)) : "—"}</Td>
                  <Td>{!c.isActive ? <Badge>Nofaol</Badge> : black ? <Badge color="red">Qora ro&apos;yxat</Badge> : cr && cr.debt > 0 ? <Badge color="amber">Qarzdor</Badge> : <Badge color="green">Toza</Badge>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <p className="mt-3 text-xs text-slate-500">
        Savol bo&apos;lsa sotuv bo&apos;limiga murojaat qiling. <Link href="/qollanma" className="underline">Qo&apos;llanma</Link>
      </p>
    </div>
  );
}

/* ───────────────────────── Direktor / HR / sotuv: biriktirish ───────────────────────── */

async function AgentManage() {
  const [agents, customers] = await Promise.all([
    db.user.findMany({ where: { role: "AGENT", isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true, agentId: true } }),
  ]);
  const credit = await customersCredit(customers.map((c) => c.id));
  // Har agent bo'yicha: mijozlar soni va umumiy qarz
  const byAgent = new Map<string, { count: number; debt: number }>();
  for (const c of customers) {
    if (!c.agentId) continue;
    const a = byAgent.get(c.agentId) ?? { count: 0, debt: 0 };
    a.count += 1; a.debt += credit.get(c.id)?.debt ?? 0;
    byAgent.set(c.agentId, a);
  }
  const unassigned = customers.filter((c) => !c.agentId).length;

  return (
    <div>
      <PageHeader title="Sotuv agentlari" subtitle="Mijozni agentga biriktiring — agent o'z mijozlariga zayavka ochadi va qarzini ko'radi" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 [&>*]:min-w-0">
        <StatCard label="Agentlar" value={`${agents.length} ta`} icon={Users} tone="brand" />
        <StatCard label="Biriktirilmagan mijoz" value={`${unassigned} ta`} icon={UserPlus} tone={unassigned ? "warning" : "success"} />
      </div>

      <Card className="mb-5">
        <CardHeader icon={UserPlus} title="Mijozni agentga biriktirish" />
        <div className="mt-3"><AssignAgentForm agents={agents} customers={customers} /></div>
      </Card>

      <Card padded={false}>
        <div className="p-5"><CardHeader icon={Users} title="Agentlar bo'yicha" description="Har agentning mijozlari va umumiy qarzi" /></div>
        <Table>
          <thead><tr><Th>Agent</Th><Th right>Mijozlar</Th><Th right>Umumiy qarz</Th></tr></thead>
          <tbody>
            {agents.length === 0 && <Empty text="Hali sotuv agenti yo'q — Otdel kadr «Sotuv agenti» lavozimi bilan login ochsin" icon={Users} />}
            {agents.map((a) => {
              const st = byAgent.get(a.id) ?? { count: 0, debt: 0 };
              return (
                <Tr key={a.id}>
                  <Td className="font-medium">{a.fullName}</Td>
                  <Td right>{st.count} ta</Td>
                  <Td right className={st.debt > 0 ? "font-medium text-amber-700" : "text-slate-500"}>{money(st.debt)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
