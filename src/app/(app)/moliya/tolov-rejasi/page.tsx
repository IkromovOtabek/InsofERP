import { CalendarClock, Repeat, Truck } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { date, fmtNum, isoDate, money } from "@/lib/format";
import { CAL_DAYS, cashCalendar } from "@/lib/fin-report/calendar";
import { loadCategories, toTree } from "@/lib/fin-report/categories";
import { Badge, Card, CardHeader, DL, Empty, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { MoliyaTabs } from "../moliya-tabs";
import { PlannedCreateForm, PlannedRowActions, PlanSettingsForm, RecurringCreateForm, RecurringRowActions, SupplierTermForm } from "./forms";

/**
 * To'lov rejasi — to'lov kalendari shu sozlamalardan hisoblanadi («Insof 2026» → «To'lov rejasi»):
 * doimiy oylik to'lovlar, bir martalik to'lov / kutilayotgan tushumlar, ta'minotchilar to'lov muddati, reja koeffitsiyenti
 * va divident foizi. Kiritish — moliya (`moliya.plan`); ko'rish — direktor, moliya, buxgalteriya.
 */
export default async function PaymentPlanPage() {
  const s = await requirePage("/moliya/tolov-rejasi");
  const canWrite = canDo(s, "moliya", "plan");
  const [settings, recurring, planned, nodes, loans, cal, suppliers] = await Promise.all([
    db.companySettings.findUnique({ where: { id: "main" }, select: { supplierPaymentDays: true, cashPlanFactor: true, dividendPct: true } }),
    db.recurringPayment.findMany({ where: { cancelledAt: null }, orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }] }),
    db.plannedFlow.findMany({ where: { status: "PLANNED" }, orderBy: { date: "asc" } }),
    loadCategories(),
    db.loan.findMany({ where: { cancelledAt: null, closedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    cashCalendar(),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, paymentTermDays: true } }),
  ]);
  const defDays = settings?.supplierPaymentDays ?? 7;
  const expenseTops = toTree(nodes, { type: "EXPENSE", activeOnly: true });
  const loanName = new Map(loans.map((l) => [l.id, l.name]));
  const monthlyFixed = recurring.filter((r) => r.isActive).reduce((x, r) => x + Number(r.amount), 0);
  const dueOf = new Map(cal.suppliers.map((x) => [x.supplierId, x]));
  const supRows = suppliers.map((x) => ({ ...x, due: dueOf.get(x.id) })).sort((a, b) => (b.due?.debt ?? 0) - (a.due?.debt ?? 0) || a.name.localeCompare(b.name));

  // Oylik jami (taxminiy, 30 kun) — jadvaldagi «OYLIK JAMI» bloki
  const inMonth = cal.perDayIn * CAL_DAYS, dailyMonth = cal.perDayOut * CAL_DAYS;
  const supplier30 = cal.totals.outSupplier;
  const outMonth = monthlyFixed + dailyMonth + supplier30 + Math.max(0, cal.dividend.left);

  return (
    <div>
      <PageHeader eyebrow="Moliya" title="To'lov rejasi" subtitle="Doimiy va bir martalik to'lovlar, ta'minotchilar muddati — to'lov kalendari shundan hisoblanadi" />
      <MoliyaTabs current="/moliya/tolov-rejasi" />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Sozlamalar" icon={CalendarClock} description="Kalendar uchun umumiy qoidalar" />
          {canWrite ? <PlanSettingsForm days={defDays} factor={Number(settings?.cashPlanFactor ?? 1)} pct={Number(settings?.dividendPct ?? 100)} /> : (
            <DL items={[
              { k: "Ta'minotchiga to'lov muddati", v: `${defDays} kun` },
              { k: "Reja koeffitsiyenti", v: fmtNum(Number(settings?.cashPlanFactor ?? 1), 2) },
              { k: "Divident foizi", v: `${fmtNum(Number(settings?.dividendPct ?? 100))}%` },
            ]} />
          )}
        </Card>
        <Card>
          <CardHeader title="Oylik jami (taxminiy, 30 kun)" />
          <dl className="divide-y divide-slate-100 text-sm">
            {([
              ["Doimiy to'lovlar", money(monthlyFixed)],
              [`Kundalik xarajatlar × ${CAL_DAYS} kun`, money(dailyMonth)],
              ["Ta'minotchilarga (30 kunda muddati yetadi)", money(supplier30)],
              ["Divident limiti qoldig'i", money(Math.max(0, cal.dividend.left))],
              ["JAMI CHIQIM", money(outMonth), "font-bold"],
              [`Kutilayotgan tushum (${cal.histDays} kun o'rtachasi × ${fmtNum(cal.factor, 2)})`, money(inMonth)],
              ["FARQ (tushum − chiqim)", money(inMonth - outMonth), inMonth - outMonth < 0 ? "font-bold text-red-600" : "font-bold text-emerald-700"],
            ] as [string, string, string?][]).map(([k, v, cls]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="min-w-0 text-slate-600">{k}</dt>
                <dd className={`shrink-0 whitespace-nowrap tabular ${cls ?? "font-medium"}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Section title="Doimiy oylik to'lovlar">
        <Table>
          <thead><tr><Th>Nomi</Th><Th>Kategoriya</Th><Th right>Kuni</Th><Th right>Summa</Th><Th>Holati</Th><Th>Izoh</Th>{canWrite && <Th />}</tr></thead>
          <tbody>
            {recurring.length === 0 && <Empty text="Doimiy to'lov kiritilmagan — oylik, avans, kredit, soliqlar, svet" icon={Repeat} />}
            {recurring.map((r) => (
              <Tr key={r.id} className={r.isActive ? undefined : "opacity-60"}>
                <Td>{r.name}</Td>
                <Td className="text-slate-500">{r.category}</Td>
                <Td right>{r.dayOfMonth}</Td>
                <Td right className="font-semibold">{fmtNum(Number(r.amount))}</Td>
                <Td>{r.isActive ? <Badge color="green">faol</Badge> : <Badge color="slate">to&apos;xtatilgan</Badge>}</Td>
                <Td className="text-slate-500">{[r.loanId ? loanName.get(r.loanId) : null, r.note].filter(Boolean).join(" · ") || "—"}</Td>
                {canWrite && <Td right><RecurringRowActions id={r.id} active={r.isActive} /></Td>}
              </Tr>
            ))}
            {recurring.length > 0 && <Tr><Td className="font-semibold">Oyiga jami (faollar)</Td><Td /><Td /><Td right className="font-bold">{fmtNum(monthlyFixed)}</Td><Td /><Td />{canWrite && <Td />}</Tr>}
          </tbody>
        </Table>
        {canWrite && <Card className="mt-4"><RecurringCreateForm cats={expenseTops.map((t) => ({ name: t.name, loan: t.needs === "LOAN" }))} loans={loans} /></Card>}
      </Section>

      <Section title="Bir martalik to'lovlar va kutilayotgan tushumlar">
        <Table>
          <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Kimga / kimdan</Th><Th>Nima uchun</Th><Th right>Summa</Th>{canWrite && <Th />}</tr></thead>
          <tbody>
            {planned.length === 0 && <Empty text="Rejalashtirilgan bir martalik to'lov yoki va'da qilingan tushum yo'q" icon={CalendarClock} />}
            {planned.map((p) => (
              <Tr key={p.id}>
                <Td>{date(p.date)}{p.date < cal.today && <> <Badge color="red">muddati o&apos;tgan</Badge></>}</Td>
                <Td>{p.type === "INCOME" ? <Badge color="green">tushum</Badge> : <Badge color="amber">to&apos;lov</Badge>}</Td>
                <Td>{p.counterparty}</Td>
                <Td className="text-slate-500">{[p.category, p.note].filter(Boolean).join(" · ") || "—"}</Td>
                <Td right className={p.type === "INCOME" ? "text-emerald-700" : "text-red-600"}>{p.type === "INCOME" ? "+" : "−"}{fmtNum(Number(p.amount))}</Td>
                {canWrite && <Td right><PlannedRowActions id={p.id} /></Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
        {canWrite && <Card className="mt-4"><PlannedCreateForm today={isoDate()} cats={expenseTops.map((t) => t.name)} /></Card>}
      </Section>

      <Section title="Ta'minotchilar: to'lov muddati va qarz">
        <Table maxHeight="70vh">
          <thead><tr><Th>Ta&apos;minotchi</Th><Th right>Qarzimiz</Th><Th right>Muddati o&apos;tgan</Th><Th right>30 kunda</Th><Th right>Muddat, kun</Th></tr></thead>
          <tbody>
            {supRows.length === 0 && <Empty text="Ta'minotchi yo'q" icon={Truck} />}
            {supRows.map((x) => (
              <Tr key={x.id}>
                <Td>{x.name}</Td>
                <Td right>{x.due ? fmtNum(x.due.debt) : "–"}</Td>
                <Td right className={x.due?.overdue ? "font-semibold text-red-600" : "text-slate-400"}>{x.due?.overdue ? fmtNum(x.due.overdue) : "–"}</Td>
                <Td right>{x.due?.due30 ? fmtNum(x.due.due30) : "–"}</Td>
                <Td right>{canWrite ? <SupplierTermForm supplierId={x.id} days={x.paymentTermDays} placeholder={defDays} /> : `${x.paymentTermDays ?? defDays}`}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title={`Kundalik xarajatlar (oxirgi ${cal.histDays} kun o'rtachasidan)`}>
        <Table>
          <thead><tr><Th>Kategoriya</Th><Th right>{cal.histDays} kunda</Th><Th right>Kuniga</Th></tr></thead>
          <tbody>
            {cal.dailyRows.length === 0 && <Empty text="Kundalik xarajat yo'q" />}
            {cal.dailyRows.map((r) => <Tr key={r.category}><Td>{r.category}</Td><Td right>{fmtNum(r.sum)}</Td><Td right>{fmtNum(r.perDay)}</Td></Tr>)}
            {cal.dailyRows.length > 0 && <Tr><Td className="font-semibold">Jami</Td><Td right className="font-semibold">{fmtNum(cal.dailyRows.reduce((x, r) => x + r.sum, 0))}</Td><Td right className="font-bold">{fmtNum(cal.perDayOut)}</Td></Tr>}
          </tbody>
        </Table>
        <p className="mt-2 text-[13px] text-slate-500">Xom-ashyo (ta&apos;minotchi qatorida), soliq, kredit, divident, loyihalar va doimiy to&apos;lovlardagi kategoriyalar bu yerga kirmaydi.</p>
      </Section>
    </div>
  );
}
