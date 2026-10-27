import { CalendarClock, Repeat, Target, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { date, fmtNum, isoDate, money } from "@/lib/format";
import { CAL_DAYS, cashCalendar } from "@/lib/fin-report/calendar";
import { groupSales } from "@/lib/fin-report/cost";
import { loadCategories, toTree } from "@/lib/fin-report/categories";
import { Badge, Card, CardHeader, DL, Empty, Input, Section, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DailyFlagToggle, PlannedCreateForm, PlannedRowActions, PlanSettingsForm, RecurringCreateForm, RecurringRowActions, SalesPlanForm, SupplierTermForm } from "./forms";

/**
 * To'lov rejasi — «Insof 2026» → «To'lov rejasi» varag'idek, to'lov kalendari shu sozlamalardan hisoblanadi:
 *  1. Oylik reja (mahsulot guruhlari bo'yicha) va reja koeffitsiyenti; 2. doimiy oylik to'lovlar; 3. kundalik xarajatlar
 *  (hisobga olinsinmi / rejaga qarab o'zgaradi); 4. ta'minotchi to'lov muddati; 5. bir martalik to'lov va tushumlar;
 *  6. divident — faqat foydadan. Kiritish — moliya (`moliya.plan`); `/moliya/tolov-rejasi` va Tahlil → Moliya da bir xil.
 */
export async function PaymentPlanView({ canWrite }: { canWrite: boolean }) {
  const [settings, recurring, planned, nodes, loans, cal, suppliers] = await Promise.all([
    db.companySettings.findUnique({ where: { id: "main" }, select: { supplierPaymentDays: true, cashPlanFactor: true, dividendPct: true, cashSalesPlan: true } }),
    db.recurringPayment.findMany({ where: { cancelledAt: null }, orderBy: [{ isActive: "desc" }, { dayOfMonth: "asc" }] }),
    db.plannedFlow.findMany({ where: { status: "PLANNED" }, orderBy: { date: "asc" } }),
    loadCategories(),
    db.loan.findMany({ where: { cancelledAt: null, closedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    cashCalendar(),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, paymentTermDays: true } }),
  ]);
  const sales = await groupSales(new Date(cal.today.getTime() - cal.histDays * 86_400_000), cal.today);
  const plan = (settings?.cashSalesPlan ?? {}) as Record<string, number>;
  const defDays = settings?.supplierPaymentDays ?? 7;
  const expenseTops = toTree(nodes, { type: "EXPENSE", activeOnly: true });
  const loanName = new Map(loans.map((l) => [l.id, l.name]));
  const monthlyFixed = recurring.filter((r) => r.isActive).reduce((x, r) => x + Number(r.amount), 0);
  const dueOf = new Map(cal.suppliers.map((x) => [x.supplierId, x]));
  const supRows = suppliers.map((x) => ({ ...x, due: dueOf.get(x.id) })).sort((a, b) => (b.due?.debt ?? 0) - (a.due?.debt ?? 0) || a.name.localeCompare(b.name));

  // Reja bo'yicha koeffitsiyent: rejasi bor guruhlar — reja × o'rtacha narx, qolganlari — haqiqiy (30 kunga keltirilgan)
  const to30 = CAL_DAYS / cal.histDays;
  const actual30 = sales.reduce((s, g) => s + g.net * to30, 0);
  const planned30 = sales.reduce((s, g) => s + (plan[g.group] ? plan[g.group]! * g.price : g.net * to30), 0);
  const planFactor = Object.keys(plan).length && actual30 > 0 ? planned30 / actual30 : null;

  // «OYLIK JAMI (taxminiy, 30 kun)» — jadvaldagi blok
  const inMonth = cal.perDayIn * CAL_DAYS, dailyMonth = cal.perDayOut * CAL_DAYS, materialsMonth = cal.perDayMaterials * CAL_DAYS;
  const dividendMonth = Math.max(0, cal.dividend.limit);
  const outMonth = monthlyFixed + dailyMonth + materialsMonth + dividendMonth;
  const dailySum = cal.dailyRows.reduce((x, r) => x + r.sum, 0), dailyAvg = cal.dailyRows.reduce((x, r) => x + (r.off ? 0 : r.avg), 0);

  return (
    <div>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="1. Oylik reja (ishlab chiqarish va sotuv)" icon={Target} description={`Reja bo'sh bo'lsa — oxirgi ${cal.histDays} kundek. Narx — QQSsiz, dostavkasiz`} />
          <SalesPlanForm id="sales-plan">
            <Table>
              <thead><tr><Th>Ko&apos;rsatkich</Th><Th right>Reja (oyiga)</Th><Th right>Oxirgi {cal.histDays} kun (haqiqiy)</Th><Th right>O&apos;rtacha narx (QQSsiz)</Th></tr></thead>
              <tbody>
                {sales.length === 0 && <Empty text="Oxirgi 30 kunda sotuv yo'q" />}
                {sales.map((g) => (
                  <Tr key={g.group}>
                    <Td>{g.group}{g.unit && <span className="font-normal text-slate-400">, {g.unit}</span>}</Td>
                    <Td right>
                      {canWrite
                        ? <Input name={`plan:${g.group}`} inputMode="decimal" defaultValue={plan[g.group] ? fmtNum(plan[g.group]!) : ""} className="ml-auto h-8 w-32 bg-amber-50 text-right tabular" aria-label={`${g.group} reja`} />
                        : (plan[g.group] ? fmtNum(plan[g.group]!) : "—")}
                    </Td>
                    <Td right>{fmtNum(g.qty)}</Td>
                    <Td right>{fmtNum(g.price)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {planFactor !== null && (
              <p className="text-[13px] text-slate-600">Reja bo&apos;yicha tushum oxirgi {CAL_DAYS} kundan <b>{fmtNum(planFactor, 2)}</b> baravar — reja koeffitsiyentini shunga qo&apos;yish mumkin (hozir {fmtNum(cal.factor, 2)}).</p>
            )}
          </SalesPlanForm>
          <div className="mt-5 border-t border-slate-100 pt-4">
            {canWrite ? <PlanSettingsForm days={defDays} factor={Number(settings?.cashPlanFactor ?? 1)} pct={Number(settings?.dividendPct ?? 100)} /> : (
              <DL items={[
                { k: "Ta'minotchiga to'lov muddati", v: `${defDays} kun` },
                { k: "Reja koeffitsiyenti", v: fmtNum(Number(settings?.cashPlanFactor ?? 1), 2) },
                { k: "Divident foizi", v: `${fmtNum(Number(settings?.dividendPct ?? 100))}%` },
              ]} />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Oylik jami (taxminiy, 30 kun)" />
          <dl className="divide-y divide-slate-100 text-sm">
            {([
              ["Doimiy to'lovlar (oylik, kredit, soliq, svet)", money(monthlyFixed)],
              [`Kundalik xarajatlar × ${CAL_DAYS} kun`, money(dailyMonth)],
              [`Xom-ashyo to'lovlari (o'tgan ${cal.histDays} kun × reja)`, money(materialsMonth)],
              ["Divident limiti (foydadan)", money(dividendMonth)],
              ["JAMI CHIQIM", money(outMonth), "font-bold"],
              [`Kutilayotgan tushum (o'tgan ${cal.histDays} kun × reja)`, money(inMonth)],
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

      <Section title="2. Doimiy oylik to'lovlar (har oy takrorlanadi)" action={<span className="text-sm text-slate-500">Jami oyiga: <b className="tabular text-slate-800">{fmtNum(monthlyFixed)}</b></span>}>
        <Table>
          <thead><tr><Th>Nomi</Th><Th>Toifa</Th><Th right>Oyning qaysi kuni</Th><Th right>Summa, so&apos;m</Th><Th>Faol</Th><Th>Izoh</Th>{canWrite && <Th />}</tr></thead>
          <tbody>
            {recurring.length === 0 && <Empty text="Doimiy to'lov kiritilmagan — oylik, avans, kredit, soliqlar, svet" icon={Repeat} />}
            {recurring.map((r) => (
              <Tr key={r.id} className={r.isActive ? undefined : "opacity-60"}>
                <Td>{r.name}</Td>
                <Td className="text-slate-500">{r.category}</Td>
                <Td right>{r.dayOfMonth}</Td>
                <Td right className="font-semibold">{fmtNum(Number(r.amount))}</Td>
                <Td>{r.isActive ? <Badge color="green">Ha</Badge> : <Badge color="slate">to&apos;xtatilgan</Badge>}</Td>
                <Td className="text-slate-500">{[r.loanId ? loanName.get(r.loanId) : null, r.note].filter(Boolean).join(" · ") || "—"}</Td>
                {canWrite && <Td right><RecurringRowActions id={r.id} active={r.isActive} /></Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
        {canWrite && <Card className="mt-4"><RecurringCreateForm cats={expenseTops.map((t) => ({ name: t.name, loan: t.needs === "LOAN" }))} loans={loans} /></Card>}
      </Section>

      <Section title={`3. Kundalik xarajatlar (oxirgi ${cal.histDays} kunlik o'rtachadan avtomatik)`}>
        <Table>
          <thead><tr><Th>Xarajat turi (Kirim-Chiqim manbasi)</Th><Th right>Oxirgi {cal.histDays} kun, so&apos;m</Th><Th right>Kunlik o&apos;rtacha</Th><Th>Hisobga olinsinmi</Th><Th>Rejaga qarab o&apos;zgaradi</Th><Th right>Kalendarga, kuniga</Th></tr></thead>
          <tbody>
            {cal.dailyRows.length === 0 && <Empty text="Kundalik xarajat yo'q" />}
            {cal.dailyRows.map((r) => (
              <Tr key={r.category} className={r.off ? "opacity-60" : undefined}>
                <Td>{r.category}</Td>
                <Td right>{fmtNum(r.sum)}</Td>
                <Td right>{fmtNum(r.avg)}</Td>
                <Td>{canWrite ? <DailyFlagToggle line={r.category} field="off" on={r.off} /> : (r.off ? "Yo'q" : "Ha")}</Td>
                <Td>{canWrite ? <DailyFlagToggle line={r.category} field="scaled" on={r.scaled} /> : (r.scaled ? "Ha" : "Yo'q")}</Td>
                <Td right className="font-medium">{fmtNum(r.perDay)}</Td>
              </Tr>
            ))}
            {cal.dailyRows.length > 0 && <Tr className="bg-slate-50 font-semibold"><Td>JAMI (hisobga olinganlari)</Td><Td right>{fmtNum(dailySum)}</Td><Td right>{fmtNum(dailyAvg)}</Td><Td /><Td /><Td right className="font-bold">{fmtNum(cal.perDayOut)}</Td></Tr>}
          </tbody>
        </Table>
        <p className="mt-2 text-[13px] text-slate-500">«Rejaga qarab o&apos;zgaradi» — reja koeffitsiyentiga ko&apos;paytiriladi ({fmtNum(cal.factor, 2)}). Xom-ashyo (ta&apos;minotchi qatorida), soliq, kredit, divident, loyihalar va doimiy to&apos;lovlardagi kategoriyalar bu yerga kirmaydi.</p>
      </Section>

      <Section title="4. Ta'minotchi to'lov muddati">
        <Table maxHeight="70vh">
          <thead><tr><Th>Ta&apos;minotchi</Th><Th right>Qarzimiz</Th><Th right>Muddati o&apos;tgan</Th><Th right>30 kunda</Th><Th right>Necha kunda to&apos;laymiz (bo&apos;sh = odatiy)</Th></tr></thead>
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

      <Section title="5. Bir martalik to'lovlar va kutilayotgan tushumlar">
        <Table>
          <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Kimga / kimdan</Th><Th>Izoh</Th><Th right>Summa, so&apos;m</Th>{canWrite && <Th />}</tr></thead>
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

      <Section title="6. Divident — faqat shu oy foydasidan olinadi">
        <Card className="max-w-2xl">
          <dl className="divide-y divide-slate-100 text-sm">
            {([
              [`Kutilayotgan sof foyda (${cal.dividend.month}, Foyda va zarar)`, money(cal.dividend.profit)],
              ["Foydaning necha foizi divident sifatida olinadi", `${fmtNum(cal.dividend.pct)}%`],
              ["Shu oy divident limiti", money(cal.dividend.limit)],
              ["Shu oy olingan divident (Kirim-Chiqim)", money(cal.dividend.taken)],
            ] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-2"><dt className="text-slate-600">{k}</dt><dd className="font-medium tabular">{v}</dd></div>)}
            <div className="flex justify-between gap-3 py-2">
              <dt className="font-semibold">Qolgan limit</dt>
              <dd className={cn("font-bold tabular", cal.dividend.left < 0 ? "text-red-600" : "text-emerald-700")}>{money(cal.dividend.left)}{cal.dividend.left < 0 && <span className="ml-2 text-[13px] font-semibold">foydadan {fmtNum(-cal.dividend.left)} ko&apos;p olingan</span>}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-slate-600">O&apos;tgan oy olingan divident</dt><dd className="font-medium tabular">{money(cal.dividend.prevTaken)}</dd></div>
          </dl>
        </Card>
      </Section>
    </div>
  );
}
