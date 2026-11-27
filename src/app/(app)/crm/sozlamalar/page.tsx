import { notFound } from "next/navigation";
import { Card, CardHeader, PageHeader, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { ActivityForm, OptionForm, ResultForm } from "./forms";

const KINDS = [
  { key: "SOURCE", label: "Manba", count: "sourceCustomers" },
  { key: "CLIENT_TYPE", label: "Mijoz turi", count: "typeCustomers" },
  { key: "PRODUCT", label: "Mahsulot", count: "productContacts" },
  { key: "CHANNEL", label: "Aloqa turi", count: "channelContacts" },
] as const;

/** CRM sozlamalari (menejer): ro'yxatlar, natijalar, faollik chegaralari. O'chirish yo'q — nofaol qilinadi (tarix saqlansin). */
export default async function CrmSettings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requirePage("/crm/sozlamalar");
  if (!canDo(s, "crm", "manage")) notFound();
  const { tab = "SOURCE" } = await searchParams;
  const kind = KINDS.find((k) => k.key === tab);
  const items = [
    ...KINDS.map((k) => ({ key: k.key, label: k.label, href: `/crm/sozlamalar?tab=${k.key}` })),
    { key: "RESULT", label: "Natijalar", href: "/crm/sozlamalar?tab=RESULT" },
    { key: "ACTIVITY", label: "Faollik", href: "/crm/sozlamalar?tab=ACTIVITY" },
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="CRM sozlamalari" back={{ href: "/crm", label: "Bugun" }} />
      <Tabs current={kind ? kind.key : tab} items={items} />
      {kind && <OptionsCard kind={kind.key} label={kind.label} />}
      {tab === "RESULT" && <ResultsCard />}
      {tab === "ACTIVITY" && <ActivityCard />}
    </div>
  );
}

async function OptionsCard({ kind, label }: { kind: (typeof KINDS)[number]["key"]; label: string }) {
  const rows = await db.crmOption.findMany({
    where: { kind }, orderBy: [{ isActive: "desc" }, { sort: "asc" }, { label: "asc" }],
    include: { _count: { select: { sourceCustomers: true, typeCustomers: true, productContacts: true, channelContacts: true, leadSourceContacts: true } } },
  });
  const used = (r: (typeof rows)[number]) => r._count.sourceCustomers + r._count.typeCustomers + r._count.productContacts + r._count.channelContacts + r._count.leadSourceContacts;
  return (
    <Card>
      <CardHeader title={label} description="Tartib — kichik son tepada. Ishlatilgan qiymat o'chirilmaydi, nofaol qilinadi (yangi tanlovlarda chiqmaydi)" />
      <div className="divide-y divide-slate-100">
        {rows.map((r) => <OptionForm key={r.id} kind={kind} row={{ id: r.id, label: r.label, sort: r.sort, isActive: r.isActive, used: used(r) }} />)}
      </div>
      <div className="mt-2 border-t border-slate-200 pt-2"><OptionForm kind={kind} /></div>
    </Card>
  );
}

async function ResultsCard() {
  const rows = await db.crmResult.findMany({ orderBy: [{ isActive: "desc" }, { sort: "asc" }], include: { _count: { select: { contacts: true } } } });
  return (
    <Card>
      <CardHeader title="Natijalar" description="Bosqich — voronkadagi eng yuqori yetgan bosqich (1–6). Guruh — formadagi bo'lim va hisobotlar (Otkaz, Kutilayotgan…). «+ kun» — keyingi aloqa sanasi standarti"
        info="Bosqich yoki guruhni o'zgartirsangiz, eski aloqalar ham yangi qoida bo'yicha hisoblanadi (voronka, avto-holat). «Taklif yuborildi», «Qimmat dedi», «Zayafka oldim» hisobotlarda alohida ustun — nomini o'zgartirish mumkin, ma'nosini emas." />
      {rows.map((r) => <ResultForm key={r.id} row={{ id: r.id, label: r.label, stage: r.stage, group: r.group, nextRule: r.nextRule, defaultDays: r.defaultDays, sort: r.sort, isActive: r.isActive, used: r._count.contacts }} />)}
      <div className="mt-2 border-t border-slate-200 pt-1"><ResultForm /></div>
    </Card>
  );
}

async function ActivityCard() {
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { crmActiveDays: true, crmColdDays: true } });
  return (
    <Card>
      <CardHeader title="Faollik chegaralari" description="Mijoz kartochkasidagi belgi: Faol · Sovib qoldi · Eski: qayta aloqa kerak. «Ishlayotgan» → «Eski mijoz» holati ham «Sovib qoldi» chegarasidan" />
      <ActivityForm active={s?.crmActiveDays ?? 30} cold={s?.crmColdDays ?? 90} />
    </Card>
  );
}
