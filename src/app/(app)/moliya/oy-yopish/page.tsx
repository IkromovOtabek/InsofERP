import { Lock, LockOpen } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { addMonths, monthKeyOf, monthRange } from "@/lib/fin-report/period";
import { PERIOD_SECTIONS, periodMonthLabel, periodSectionLabel } from "@/lib/period-sections";
import { Badge, Empty, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { ConfirmButton } from "../../payments/confirm-button";
import { closePeriodAction, reopenPeriodAction } from "./actions";

/**
 * Oy yopish — bo'lim × oy jadvali. Yopilgan oyga sanalangan yozuvni baza o'zi rad etadi (`lib/period-sections.ts`).
 * Faqat tugagan oylar yopiladi; ochish sabab bilan, kim ochishi — Ruxsatlar → Moliya → «Oy yopish».
 */
const MONTHS = 12;

export default async function PeriodClosePage() {
  const s = await requirePage("/moliya/oy-yopish");
  const canClose = canDo(s, "moliya", "period_close");
  const canReopen = canDo(s, "moliya", "period_reopen");
  const current = monthKeyOf(new Date());
  const months = monthRange(addMonths(current, -MONTHS), MONTHS).reverse();

  const [rows, history] = await Promise.all([
    db.periodClose.findMany({ where: { month: { in: months } } }),
    db.auditLog.findMany({ where: { entity: "PeriodClose" }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { fullName: true } } } }),
  ]);
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.closedById))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const closed = new Map(rows.map((r) => [`${r.section}:${r.month}`, r]));

  const btn = "whitespace-nowrap text-[13px] font-medium text-brand-700 hover:underline";
  return (
    <div>
      <PageHeader
        eyebrow="Moliya"
        title="Oy yopish"
        info={
          <div className="space-y-2">
            <p>Yopilgan oyga sanalangan yozuvni hech kim qo&apos;sha, tahrirlay, bekor qila yoki o&apos;chira olmaydi — veb, mobil ilova va Excel import ham. Hisobotlar o&apos;sha oy uchun qotib qoladi.</p>
            <p>Faqat tugagan oylar yopiladi. Ochish uchun sabab yoziladi va Amallar tarixiga tushadi. Kim yopishi va kim ochishi — Ruxsatlar → Moliya → «Oy yopish».</p>
            <ul className="list-disc space-y-1 pl-5">
              {PERIOD_SECTIONS.map((x) => <li key={x.key}><b>{x.label}:</b> {x.covers}</li>)}
            </ul>
          </div>
        }
      />

      <Table>
        <thead>
          <tr>
            <Th>Oy</Th>
            {PERIOD_SECTIONS.map((x) => <Th key={x.key} className="text-center"><span title={`${x.label}: ${x.covers}`}>{x.short}</span></Th>)}
            {canClose && <Th />}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => {
            const open = PERIOD_SECTIONS.filter((x) => !closed.has(`${x.key}:${m}`));
            return (
              <Tr key={m}>
                <Td className="whitespace-nowrap font-medium">{periodMonthLabel(m)}</Td>
                {PERIOD_SECTIONS.map((x) => {
                  const r = closed.get(`${x.key}:${m}`);
                  return (
                    <Td key={x.key} className="text-center align-top">
                      {r ? (
                        <div className="flex flex-col items-center gap-1">
                          <span title={`${users.get(r.closedById) ?? "—"} · ${dateTime(r.closedAt)}`}><Badge color="green" dot={false}><Lock size={11} /> Yopiq</Badge></span>
                          {canReopen && (
                            <ConfirmButton
                              action={reopenPeriodAction.bind(null, x.key, m)}
                              label="Ochish"
                              question={`«${x.short}» — ${periodMonthLabel(m)} ochilsinmi?`}
                              reason="required"
                              okText="Ochildi"
                              className={btn}
                            />
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Badge color="slate" dot={false}><LockOpen size={11} /> Ochiq</Badge>
                          {canClose && (
                            <ConfirmButton
                              action={closePeriodAction.bind(null, x.key, m)}
                              label="Yopish"
                              question={`«${x.short}» — ${periodMonthLabel(m)} yopilsinmi?`}
                              okText="Yopildi"
                              className={btn}
                            />
                          )}
                        </div>
                      )}
                    </Td>
                  );
                })}
                {canClose && (
                  <Td right className="align-top">
                    {open.length > 0 && (
                      <ConfirmButton
                        action={closePeriodAction.bind(null, "all", m)}
                        label="Hammasini yopish"
                        question={`${periodMonthLabel(m)} — ochiq ${open.length} ta bo'lim (${open.map((x) => x.label).join(", ")}) yopilsinmi?`}
                        okText="Yopildi"
                        className={btn}
                      />
                    )}
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-slate-500">Joriy oy ({periodMonthLabel(current)}) tugagach yopish mumkin bo&apos;ladi.</p>

      <Section title="Amallar tarixi">
        <Table>
          <thead><tr><Th>Vaqt</Th><Th>Kim</Th><Th>Amal</Th><Th>Bo&apos;lim</Th><Th>Oy</Th><Th>Sabab</Th></tr></thead>
          <tbody>
            {history.length === 0 && <Empty text="Hali birorta oy yopilmagan" icon={Lock} />}
            {history.map((h) => {
              const [section, month] = h.entityId.split(":");
              const after = (h.after ?? {}) as { closed?: boolean; reason?: string };
              return (
                <Tr key={h.id}>
                  <Td className="whitespace-nowrap">{dateTime(h.createdAt)}</Td>
                  <Td>{h.user.fullName}</Td>
                  <Td>{after.closed ? <Badge color="green">Yopildi</Badge> : <Badge color="amber">Ochildi</Badge>}</Td>
                  <Td>{periodSectionLabel(section)}</Td>
                  <Td className="whitespace-nowrap">{month ? periodMonthLabel(month) : "—"}</Td>
                  <Td className="text-slate-600">{after.reason ?? "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Section>
    </div>
  );
}
