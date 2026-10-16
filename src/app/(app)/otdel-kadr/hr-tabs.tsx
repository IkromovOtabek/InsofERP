import Link from "next/link";
import { Inbox } from "lucide-react";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { date, money } from "@/lib/format";
import { dayUtc, isoDay, monthOf, monthTitle, shiftDay, shiftMonth, today, validDay, validMonth } from "@/lib/davomat";
import { plansInRange } from "@/lib/hr/shifts";
import { listHrRequests, requestCounts, periodText } from "@/lib/hr/requests";
import { calculate } from "@/lib/hr/payroll";
import { REQUEST_KIND, REQUEST_STATUS_BADGE, REQUEST_STATUS_LABEL, RULE_TRIGGER } from "@/lib/hr/labels";
import { Badge, Callout, Card, CardHeader, Empty, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { PatternFill, ShiftGrid, ShiftTemplates, type GridDay, type GridRow } from "./grafik";
import { DecideButtons, RequestForm } from "./arizalar-forms";
import { createRequestForEmployee, decideRequest } from "./hr-actions";
import { AdjustmentForm, CancelAdjustment, RuleActions, RuleForm, type RuleRow } from "./jarima-forms";
import type { HrRequestStatus } from "@/generated/prisma";

const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

type Emp = { id: string; fullName: string; position: string; workSchedule: string | null };

/** Dushanba — hafta boshi. */
function weekStart(iso: string) {
  const d = dayUtc(iso).getUTCDay();
  return shiftDay(iso, d === 0 ? -6 : 1 - d);
}

// ───────────────────────── Smena grafigi ─────────────────────────

export async function GrafikTab({ employees, hafta }: { employees: Emp[]; hafta?: string }) {
  const start = weekStart(validDay(hafta) ?? today());
  const end = shiftDay(start, 6);
  const [templates, plans] = await Promise.all([
    db.shiftTemplate.findMany({ orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }] }),
    plansInRange(employees, start, end),
  ]);
  const cells = await db.shiftAssignment.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: dayUtc(start), lte: dayUtc(end) } } });
  const cellBy = new Map(cells.map((c) => [`${c.employeeId}|${isoDay(c.date)}`, c]));
  const now = today();
  const days: GridDay[] = Array.from({ length: 7 }, (_, i) => {
    const iso = shiftDay(start, i);
    return { iso, label: `${iso.slice(8, 10)}.${iso.slice(5, 7)}`, weekday: WD[dayUtc(iso).getUTCDay()]!, weekend: dayUtc(iso).getUTCDay() === 0, isToday: iso === now };
  });
  const rows: GridRow[] = employees.map((e) => ({
    id: e.id, fullName: e.fullName, position: e.position,
    cells: Object.fromEntries(days.map((d) => {
      const c = cellBy.get(`${e.id}|${d.iso}`);
      const value = !c ? "" : c.off ? "off" : c.templateId ? `t:${c.templateId}` : `${c.start}-${c.end}`;
      // Katak bo'sh bo'lsa nima ishlaydi — kartadagi grafik (yakshanba — dam)
      const fb = plans.get(e.id)?.get(d.iso);
      const fallback = c ? "Kartadagi smena" : fb?.off ? "Dam (karta)" : `${fb?.start ?? "08:00"}–${fb?.end ?? "17:00"} (karta)`;
      return [d.iso, { value, fallback }];
    })),
  }));
  const title = `${date(dayUtc(start))} – ${date(dayUtc(end))}`;
  return (
    <div className="space-y-4">
      <ShiftGrid days={days} rows={rows} templates={templates} title={title}
        prevHref={`/otdel-kadr?tab=grafik&hafta=${shiftDay(start, -7)}`} nextHref={`/otdel-kadr?tab=grafik&hafta=${shiftDay(start, 7)}`} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PatternFill employees={employees} templates={templates} from={start} to={shiftDay(start, 27)} />
        <ShiftTemplates templates={templates} />
      </div>
    </div>
  );
}

// ───────────────────────── Arizalar ─────────────────────────

const REQ_TABS: { key: HrRequestStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Ko'rib chiqilmoqda" }, { key: "APPROVED", label: "Tasdiqlangan" },
  { key: "REJECTED", label: "Rad etilgan" }, { key: "ALL", label: "Hammasi" },
];

export async function ArizalarTab({ s, employees, holat }: { s: Session; employees: Emp[]; holat?: string }) {
  const tab = REQ_TABS.find((t) => t.key === holat) ?? REQ_TABS[0]!;
  const [rows, counts] = await Promise.all([listHrRequests({ status: tab.key, take: 200 }), requestCounts()]);
  const canDecide = canDo(s, "employees", "requests", ["HR"]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Ko'rib chiqilmoqda" value={String(counts.PENDING ?? 0)} icon={Inbox} tone={counts.PENDING ? "warning" : "default"} />
        <StatCard label="Tasdiqlangan" value={String(counts.APPROVED ?? 0)} />
        <StatCard label="Rad etilgan" value={String(counts.REJECTED ?? 0)} />
        <StatCard label="Qaytarib olingan" value={String(counts.CANCELLED ?? 0)} />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
          {REQ_TABS.map((t) => (
            <Link key={t.key} href={`/otdel-kadr?tab=arizalar&holat=${t.key}`} className={`rounded-md px-2.5 py-1 text-sm ${t.key === tab.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {t.label}{t.key !== "ALL" && counts[t.key as HrRequestStatus] ? ` · ${counts[t.key as HrRequestStatus]}` : ""}
            </Link>
          ))}
        </div>
        <Table>
          <thead><tr><Th>Ariza</Th><Th>Xodim</Th><Th>Turi va davri</Th><Th>Sababi</Th><Th>Holat</Th><Th right>Amal</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty text="Ariza yo'q" />}
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap font-medium">{r.docNo}<div className="text-xs font-normal text-slate-500">{date(r.createdAt)}</div></Td>
                <Td>{r.employee.fullName}<div className="text-xs text-slate-500">{r.employee.position}</div></Td>
                <Td>
                  {REQUEST_KIND[r.kind].label}
                  <div className="text-xs text-slate-500">
                    {r.dateFrom && r.dateTo ? periodText(isoDay(r.dateFrom), isoDay(r.dateTo)) : ""}
                    {r.amount ? money(Number(r.amount)) : ""}
                  </div>
                </Td>
                <Td className="max-w-xs text-sm">{r.reason}{r.decisionNote && <div className="text-xs text-slate-500">Javob: {r.decisionNote}</div>}</Td>
                <Td>
                  <Badge color={REQUEST_STATUS_BADGE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
                  {r.appliedDays != null && <div className="mt-1 text-xs text-slate-500">davomatga {r.appliedDays} kun</div>}
                  {r.payrollRunId && <div className="mt-1 text-xs"><Link className="text-brand-700 hover:underline" href={`/ish-haqi/${r.payrollRunId}`}>avans vedomosti</Link></div>}
                </Td>
                <Td right>
                  {r.status === "PENDING" && canDecide && (
                    <DecideButtons approve={decideRequest.bind(null, r.id, true)} reject={decideRequest.bind(null, r.id, false)} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {canDecide && (
        <Card>
          <CardHeader title="Xodim nomidan ariza kiritish" icon={Inbox} description="Qog'oz ariza yoki kasallik varaqasi keltirilganda. Xodimning o'zi ilovadan yoki «Mening hisobim» sahifasidan yuboradi" />
          <RequestForm action={createRequestForEmployee} employees={employees} />
        </Card>
      )}
    </div>
  );
}

// ───────────────────────── Jarima va bonuslar ─────────────────────────

export async function JarimaTab({ s, employees, positions, oy }: { s: Session; employees: Emp[]; positions: string[]; oy?: string }) {
  const month = validMonth(oy) ?? monthOf(today());
  const editable = canDo(s, "employees", "payrules", ["HR"]);
  const [rules, adjustments, preview] = await Promise.all([
    db.payRule.findMany({ orderBy: [{ isActive: "desc" }, { kind: "asc" }, { createdAt: "asc" }] }),
    db.payAdjustment.findMany({ where: { month }, orderBy: { createdAt: "desc" }, include: { employee: { select: { fullName: true, position: true } } } }),
    calculate(month, "FINAL"),
  ]);
  const ruleRows: RuleRow[] = rules.map((r) => ({
    id: r.id, name: r.name, trigger: r.trigger, amount: Number(r.amount), perMinute: r.perMinute, graceMinutes: r.graceMinutes,
    maxPerMonth: r.maxPerMonth == null ? null : Number(r.maxPerMonth), position: r.position, isActive: r.isActive, note: r.note,
  }));
  // Global kechikish jarimasi — Sozlamalar → Davomat sahifasida boshqariladi (`lib/hr/late-fine.ts`)
  const isGlobalLate = (r: RuleRow) => r.trigger === "LATE" && !r.position;
  const hits = preview.filter((l) => l.bonus || l.penalty).sort((a, b) => b.penalty + b.bonus - (a.penalty + a.bonus));
  const totalBonus = preview.reduce((x, l) => x + l.bonus, 0), totalPenalty = preview.reduce((x, l) => x + l.penalty, 0);
  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Qoidalar — hamma uchun bir xil</h2>
          <p className="text-xs text-slate-500">Davomatdan avtomatik hisoblanadi va oy yakuni ish haqiga qo&apos;shiladi / ushlanadi. Sababi tasdiqlangan kunlar (arizalar) hisoblanmaydi.</p>
        </div>
        <Table>
          <thead><tr><Th>Qoida</Th><Th>Nimaga qarab</Th><Th right>Summa</Th><Th>Kimga</Th><Th right>Amal</Th></tr></thead>
          <tbody>
            {ruleRows.length === 0 && <Empty text="Qoida hali yo'q" />}
            {ruleRows.map((r) => (
              <Tr key={r.id} className={r.isActive ? "" : "opacity-50"}>
                <Td className="font-medium">
                  <Badge color={RULE_TRIGGER[r.trigger].kinds[0] === "BONUS" ? "green" : "red"}>{RULE_TRIGGER[r.trigger].kinds[0] === "BONUS" ? "Bonus" : "Jarima"}</Badge> {r.name}
                  {!r.isActive && <span className="ml-1 text-xs text-slate-500">(o&apos;chiq)</span>}
                  {r.note && <div className="text-xs font-normal text-slate-500">{r.note}</div>}
                </Td>
                <Td>{RULE_TRIGGER[r.trigger].label}{r.graceMinutes ? <div className="text-xs text-slate-500">{r.graceMinutes} daqiqagacha hisoblanmaydi</div> : null}</Td>
                <Td right>{money(r.amount)}{r.perMinute ? " / daq" : ""}{r.maxPerMonth != null && <div className="text-xs text-slate-500">oyiga ko&apos;pi {money(r.maxPerMonth)}</div>}</Td>
                <Td>{r.position ?? "Hamma"}</Td>
                <Td right>
                  {isGlobalLate(r)
                    ? <Link href="/settings/davomat" className="text-sm text-brand-700 hover:underline">Davomat sozlamalarida</Link>
                    : <RuleActions rule={r} positions={positions} editable={editable} />}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {editable && <div className="border-t border-slate-100 p-4"><RuleForm positions={positions} /></div>}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/otdel-kadr?tab=jarima-bonus&oy=${shiftMonth(month, -1)}`} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">← {monthTitle(shiftMonth(month, -1))}</Link>
        <h2 className="text-base font-semibold">{monthTitle(month)}</h2>
        {month < monthOf(today()) && <Link href={`/otdel-kadr?tab=jarima-bonus&oy=${shiftMonth(month, 1)}`} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">{monthTitle(shiftMonth(month, 1))} →</Link>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold">Hisoblangan (qoidalar + qo&apos;lda)</h2>
            <p className="text-xs text-slate-500">Bonus {money(totalBonus)} · jarima {money(totalPenalty)} — oy yakuni vedomostiga shunday tushadi</p>
          </div>
          <Table>
            <thead><tr><Th>Xodim</Th><Th>Tafsilot</Th><Th right>Bonus</Th><Th right>Jarima</Th></tr></thead>
            <tbody>
              {hits.length === 0 && <Empty text="Bu oyda jarima ham, bonus ham yo'q" />}
              {hits.map((l) => (
                <Tr key={l.employeeId}>
                  <Td className="font-medium">{l.fullName}<div className="text-xs font-normal text-slate-500">{l.position}</div></Td>
                  <Td className="text-xs text-slate-600">
                    {l.breakdown.rules.map((h) => <div key={h.rule}>{h.rule}: {h.detail}</div>)}
                    {l.breakdown.manual.map((m) => <div key={m.id}>Qo&apos;lda: {m.reason}</div>)}
                  </Td>
                  <Td right className="text-emerald-700">{l.bonus ? money(l.bonus) : "—"}</Td>
                  <Td right className="text-red-700">{l.penalty ? money(l.penalty) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Qo&apos;lda yozilgan</h2><p className="text-xs text-slate-500">O&apos;chirilmaydi — bekor qilinsa sababi bilan qoladi</p></div>
          <Table>
            <thead><tr><Th>Xodim</Th><Th>Sababi</Th><Th right>Summa</Th><Th right /></tr></thead>
            <tbody>
              {adjustments.length === 0 && <Empty text="Qo'lda yozuv yo'q" />}
              {adjustments.map((a) => (
                <Tr key={a.id} className={a.cancelledAt ? "opacity-50" : ""}>
                  <Td className="font-medium">{a.employee.fullName}<div className="text-xs font-normal text-slate-500">{a.date ? date(a.date) : date(a.createdAt)}</div></Td>
                  <Td className="text-sm">{a.reason}{a.cancelledAt && <div className="text-xs text-red-600">Bekor: {a.cancelReason}</div>}</Td>
                  <Td right className={a.kind === "BONUS" ? "text-emerald-700" : "text-red-700"}>{a.kind === "BONUS" ? "+" : "−"}{money(Number(a.amount))}</Td>
                  <Td right>{!a.cancelledAt && editable && <CancelAdjustment id={a.id} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {editable && <div className="border-t border-slate-100 p-4"><AdjustmentForm employees={employees} month={month} /></div>}
        </Card>
      </div>
      {!editable && <Callout tone="info">Jarima va bonuslarni otdel kadr yozadi</Callout>}
    </div>
  );
}

