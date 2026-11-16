import Link from "next/link";
import { HandCoins, Settings2, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { date, dateTime, money } from "@/lib/format";
import { monthOf, monthTitle, today } from "@/lib/davomat";
import { canPayroll, listRuns, payrollSettings } from "@/lib/hr/payroll";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { CalculateForm, PieceRatesForm, SettingsForm } from "./forms";
import { listDebts } from "@/lib/hr/employee-debt";
import { ConfirmButton } from "../payments/confirm-button";
import { cancelEmployeeDebt } from "./actions";

/**
 * Ish haqi: otdel kadr / buxgalteriya hisoblaydi, direktor tasdiqlaydi, kassir to'laydi (`lib/hr/payroll.ts`).
 * Har vedomost — oy uchun avans, oy yakuni yoki alohida to'lov (xodimning avans arizasi).
 */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requirePage("/ish-haqi");
  const sp = await searchParams;
  const month = monthOf(today());
  const canCalc = canPayroll(s, "calc");
  const canSettings = canPayroll(s, "settings");
  const canDebts = canPayroll(s, "debts");
  // Faqat qarzlar huquqi bor (Sekretar) — vedomost va sozlamalar ko'rinmaydi, faqat «Xodim qarzlari»
  const debtsOnly = canDebts && !canCalc && !canSettings && !["HR", "ACCOUNTING", "FINANCE", "CASHIER", "DIRECTOR", "SUPERADMIN"].includes(s.role);
  const tab = debtsOnly ? "qarzlar" : sp.tab === "qarzlar" && canDebts ? "qarzlar" : sp.tab === "sozlamalar" ? "sozlamalar" : "vedomostlar";
  const debts = tab === "qarzlar" ? await listDebts() : [];
  if (debtsOnly) return <DebtsView debts={debts} canCancel />;

  const [runs, st, products] = await Promise.all([
    listRuns({ take: 80 }),
    payrollSettings(),
    tab === "sozlamalar" ? db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, pieceRate: true } }) : Promise.resolve([]),
  ]);
  const waiting = runs.filter((r) => r.status === "SUBMITTED");
  const toPay = runs.filter((r) => r.status === "APPROVED");
  const thisMonth = runs.filter((r) => r.month === month && r.status !== "CANCELLED");

  return (
    <div className="space-y-4">
      <PageHeader title="Ish haqi" info="Avans va oy yakuni vedomostlari: hisoblash → direktor tasdig'i → kassadan to'lov" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`${monthTitle(month)} — hisoblangan`} value={money(thisMonth.filter((r) => r.kind === "FINAL").reduce((x, r) => x + Number(r.gross), 0))} icon={Wallet} href="/ish-haqi#vedomostlar" />
        <StatCard label="Direktor tasdig'ida" value={String(waiting.length)} tone={waiting.length ? "warning" : "default"} hint={waiting.length ? money(waiting.reduce((x, r) => x + Number(r.net), 0)) : undefined} href={waiting.length === 1 ? `/ish-haqi/${waiting[0].id}` : "/ish-haqi#vedomostlar"} />
        <StatCard label="To'lov kutmoqda" value={String(toPay.length)} tone={toPay.length ? "brand" : "default"} hint={toPay.length ? money(toPay.reduce((x, r) => x + Number(r.net) - Number(r.paid), 0)) : undefined} href={toPay.length === 1 ? `/ish-haqi/${toPay[0].id}` : "/ish-haqi#vedomostlar"} />
        <StatCard label={`${monthTitle(month)} — to'langan`} value={money(thisMonth.reduce((x, r) => x + Number(r.paid), 0))} href="/ish-haqi#vedomostlar" />
      </div>
      <Tabs current={tab} items={[
        { key: "vedomostlar", label: "Vedomostlar", href: "/ish-haqi", icon: Wallet },
        ...(canDebts ? [{ key: "qarzlar", label: "Xodim qarzlari", href: "/ish-haqi?tab=qarzlar", icon: HandCoins }] : []),
        { key: "sozlamalar", label: "Sozlamalar", href: "/ish-haqi?tab=sozlamalar", icon: Settings2 },
      ]} />

      {tab === "qarzlar" && <DebtTable debts={debts} canCancel={canDebts} />}

      {tab === "vedomostlar" && (
        <>
          {canCalc && (
            <Card>
              <CardHeader title="Hisoblash" info={`Avans — 1–${st.advanceDay} kunlar bo'yicha, oylikning ${st.advancePct}%; oy yakuni — tabel, smena grafigi, ta'til/kasallik, jarima/bonus, soliq va berilgan avanslar bilan`} />
              <CalculateForm month={month} />
            </Card>
          )}
          <Card padded={false}>
            <div id="vedomostlar" className="scroll-mt-20" />
            <Table>
              <thead><tr><Th>Vedomost</Th><Th>Oy</Th><Th>Turi</Th><Th right>Xodim</Th><Th right>Hisoblangan</Th><Th right>Qo&apos;lga</Th><Th right>To&apos;langan</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {runs.length === 0 && <Empty text="Vedomost hali yo'q — yuqorida oy va turini tanlab hisoblang" />}
                {runs.map((r) => (
                  <Tr key={r.id} className={r.status === "CANCELLED" ? "opacity-50" : ""}>
                    <Td className="font-medium"><Link href={`/ish-haqi/${r.id}`} className="text-brand-700 hover:underline">{r.docNo}</Link><div className="text-xs font-normal text-slate-500">{dateTime(r.createdAt)}{r.note ? ` · ${r.note}` : ""}</div></Td>
                    <Td>{monthTitle(r.month)}</Td>
                    <Td>{PAYROLL_KIND_LABEL[r.kind]}</Td>
                    <Td right>{r._count.lines}</Td>
                    <Td right>{money(Number(r.gross))}</Td>
                    <Td right className="font-medium">{money(Number(r.net))}</Td>
                    <Td right>{money(Number(r.paid))}</Td>
                    <Td><Badge color={PAYROLL_STATUS_BADGE[r.status]}>{PAYROLL_STATUS_LABEL[r.status]}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "sozlamalar" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Soliq, avans, kasallik"
              info={<>
                <p>Barcha xodimlarga bir xil. O&apos;zgarish keyingi hisobdan qo&apos;llanadi — tasdiqlangan vedomostlar o&apos;zgarmaydi.</p>
                <p><b>Xodimning ish haqi turi.</b> Oklad, kunbay, soatbay yoki sdelka — xodim kartasida («Ish haqi turi» va «Tarif stavka»). Jarima va bonus qoidalari — Otdel kadr → Jarima va bonuslar.</p>
              </>} />
            <SettingsForm editable={canSettings} v={{
              incomeTaxPct: Number(st.incomeTaxPct), inpsPct: Number(st.inpsPct), socialTaxPct: Number(st.socialTaxPct), advancePct: st.advancePct, advanceDay: st.advanceDay,
              sickPctShort: st.sickPctShort, sickPctLong: st.sickPctLong, hoursPerDay: Number(st.hoursPerDay), vacationPaid: st.vacationPaid,
            }} />
          </Card>
          <Card>
            <CardHeader title="Sdelka narxlari" info="Brigada bajargan 1 birlik uchun ish haqi fondiga qo'shiladigan summa. Fond sdelkadagi a'zolarga ishlagan soati bo'yicha bo'linadi" />
            {products.length ? <PieceRatesForm editable={canSettings} products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, pieceRate: p.pieceRate == null ? null : Number(p.pieceRate) }))} /> : <Empty text="Mahsulot yo'q" />}
          </Card>
        </div>
      )}
    </div>
  );
}

type Debt = Awaited<ReturnType<typeof listDebts>>[number];

/** Sekretar ko'rinishi: faqat xodim qarzlari. */
function DebtsView({ debts, canCancel }: { debts: Debt[]; canCancel: boolean }) {
  return (
    <div className="space-y-4">
      <PageHeader title="Xodim qarzlari" info="Kirim-Chiqimda «Hodimlar bilan hisob-kitob» chiqimi «Oylikdan nasiya» bilan yozilsa — qarz shu yerda; har oy yakuni vedomostida ulushi ushlanadi" />
      <DebtTable debts={debts} canCancel={canCancel} />
    </div>
  );
}

/** Nasiya qarzlari: jami, oylik ulush, muddat, ushlangan / qolgan. Ushlangan — oy yakuni vedomosti tasdiqlangan oylar. */
function DebtTable({ debts, canCancel }: { debts: Debt[]; canCancel: boolean }) {
  const active = debts.filter((d) => !d.cancelledAt);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Faol qarzlar" value={String(active.filter((d) => d.left > 0).length)} icon={HandCoins} />
        <StatCard label="Jami berilgan" value={money(active.reduce((x, d) => x + d.amount, 0))} />
        <StatCard label="Ushlangan" value={money(active.reduce((x, d) => x + d.held, 0))} />
        <StatCard label="Qolgan" value={money(active.reduce((x, d) => x + d.left, 0))} tone="warning" />
      </div>
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Sana</Th><Th right>Summa</Th><Th right>Oyiga</Th><Th>Muddat</Th><Th right>Ushlangan</Th><Th right>Qolgan</Th><Th>Izoh</Th><Th></Th></tr></thead>
          <tbody>
            {debts.length === 0 && <tr><td colSpan={9}><Empty text="Qarz yo'q — Kirim-Chiqimda «Hodimlar bilan hisob-kitob» chiqimida «Oylikdan nasiya» belgilansa shu yerga tushadi" /></td></tr>}
            {debts.map((d) => (
              <Tr key={d.id} className={d.cancelledAt ? "opacity-50" : ""}>
                <Td className="font-medium"><Link href={`/employees/${d.employee.id}`} className="hover:underline">{d.employee.fullName}</Link><div className="text-xs font-normal text-slate-500">{d.employee.position}</div></Td>
                <Td>{date(d.date)}{d.account ? <div className="text-xs text-slate-500">{d.account}</div> : null}</Td>
                <Td right>{money(d.amount)}</Td>
                <Td right>{money(d.monthly)}</Td>
                <Td>{monthTitle(d.startMonth)} — {monthTitle(d.endMonth)}<div className="text-xs text-slate-500">{d.months} oy · {d.heldN} ushlangan</div></Td>
                <Td right>{money(d.held)}</Td>
                <Td right className="font-medium">{d.cancelledAt ? <Badge color="slate">Bekor</Badge> : d.left > 0 ? money(d.left) : <Badge color="green">Yopildi</Badge>}</Td>
                <Td className="text-slate-600">{d.cancelledAt ? d.cancelReason : d.note ?? "—"}</Td>
                <Td right>{canCancel && !d.cancelledAt && d.left > 0 && (
                  <ConfirmButton action={cancelEmployeeDebt.bind(null, d.id)} label="Bekor qilish" reason="required" question="Qarz oylikdan ushlanmay qo'yiladi (kassa chiqimi o'zgarmaydi). Sababi?" className="text-xs" />
                )}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
