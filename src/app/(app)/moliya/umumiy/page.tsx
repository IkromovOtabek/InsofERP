import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, HandCoins, Landmark, Scale, TrendingUp, Truck, Wallet } from "lucide-react";
import type { PayMethod } from "@/generated/prisma";
import { requirePage } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { financeOverview } from "@/lib/overview/finance";
import { LOAN_KIND_LABEL } from "@/lib/fin-report/loans";
import { CAL_KIND_LABEL } from "@/lib/fin-report/calendar";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { PAY_METHOD_LABEL, methodsFor } from "@/lib/payment-requests";
import { date, fmtNum, isoDate, money, moneyShort, pct } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { DayRangeBar, monthTitle, parseDayRange } from "@/app/(app)/bi-tahlil/month-bar";
import { payReqSummary } from "@/app/(app)/pul-qabul/summary";

export const dynamic = "force-dynamic";

const BASE = "/moliya/umumiy";
const tone = (v: number) => (v < 0 ? "danger" : "success");
const neg = (v: number) => (v < 0 ? "text-red-600" : undefined);

/** Karta sarlavhasidagi «Batafsil» havolasi — sahifa xodimga yopiq bo'lsa chiqmaydi. */
function More({ href }: { href?: string }) {
  if (!href) return null;
  return <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Batafsil <ArrowRight size={14} /></Link>;
}
/** Qator nomi: havola ochiq bo'lsa — bosiladi. */
function Name({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? <Link href={href} className="font-medium text-slate-800 hover:underline">{children}</Link> : <span className="font-medium text-slate-800">{children}</span>;
}

/**
 * Moliya — umumiy ko'rinish: kassa/bank qoldiqlari, davr kirim-chiqimi, chiqim manbalari, debitorka/kreditorka, kreditlar,
 * yaqin to'lovlar, ish haqi, to'lov kutayotgan so'rovlar va foyda — bitta sahifada, har blokdan o'z bo'limiga havola.
 * Hisob — `lib/overview/finance.ts` (boshqa moliya sahifalari bilan bir manbadan). Logistika hisobi bu yerga kirmaydi.
 */
export default async function MoliyaUmumiyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage("/moliya/umumiy");
  const period = parseDayRange(await searchParams);
  const can = methodsFor(s);
  const methods: PayMethod[] = can.length ? can : ["CASH", "BANK"];
  const [o, rq] = await Promise.all([financeOverview(period.from, period.to), payReqSummary(methods)]);

  const href = (path: string, q = "") => (pathAllowed(path, s.role, s.perms) ? path + q : undefined);
  const lastDay = new Date(period.to.getFullYear(), period.to.getMonth(), period.to.getDate() - 1);
  const cf = (tab: string, cat?: string) => href("/cashflow", `?${new URLSearchParams({ tab, from: isoDate(period.from), to: isoDate(lastDay), ...(cat ? { category: cat } : {}) })}`);
  const monthsLabel = o.months.length > 1 ? `${monthTitle(o.months[0]!)} — ${monthTitle(o.months[o.months.length - 1]!)}` : monthTitle(o.months[0]!);
  const pnlHref = href("/bi-tahlil/moliya/pnl", `?oy=${o.months[0]}&n=${o.months.length}`);
  const { flow, debts, loans, calendar: cal, payroll: pr } = o;

  return (
    <div>
      <PageHeader eyebrow="Moliya" title="Moliya — umumiy ko'rinish"
        info="Pul qoldiqlari, kirim-chiqim, qarzlar, kreditlar, ish haqi va to'lovlar bitta joyda. Logistika moliyasi alohida hisob — bu yerga kirmaydi." />
      <DayRangeBar base={BASE} range={period} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Pul qoldig'i (davr oxiri)" value={moneyShort(o.cash.close)} icon={Landmark} tone={o.cash.close < 0 ? "danger" : "brand"}
          hint={`Naqd ${moneyShort(o.cash.cashClose)} · Bank ${moneyShort(o.cash.bankClose)}`} href={href("/payments")} />
        <StatCard label="Kirim (davr)" value={moneyShort(flow.income)} icon={ArrowDownLeft} tone="success"
          hint={`Mijoz to'lovlari ${moneyShort(flow.payments)} · boshqa ${moneyShort(flow.otherIncome)}`} href={cf("INCOME")} />
        <StatCard label="Chiqim (davr)" value={moneyShort(flow.expense)} icon={ArrowUpRight} tone={flow.expense > 0 ? "danger" : "default"} href={cf("EXPENSE")} />
        <StatCard label="Sof oqim (kirim − chiqim)" value={moneyShort(flow.net)} icon={Wallet} tone={tone(flow.net)} href={cf("all")} />
        <StatCard label="Debitorka (mijozlar qarzi)" value={moneyShort(debts.receivable)} icon={HandCoins} tone="warning"
          hint={`${fmtNum(debts.debtors)} ta mijoz · mijoz avansi ${moneyShort(debts.customerAdvance)}`} href={href("/bi-tahlil/mijozlar/xaridorlar")} />
        <StatCard label="Kreditorka (ta'minotchilarga qarz)" value={moneyShort(debts.supplierDebt)} icon={Truck} tone={debts.supplierDebt > 0 ? "danger" : "default"}
          hint={`Bergan avansimiz ${moneyShort(debts.supplierAdvance)}`} href={href("/bi-tahlil/mijozlar/taminotchilar")} />
        <StatCard label="Kredit va olingan qarz" value={moneyShort(loans.bank + loans.borrowed)} icon={Scale}
          hint={`Bank ${moneyShort(loans.bank)} · olingan ${moneyShort(loans.borrowed)} · berilgan ${moneyShort(loans.lent)}`} href={href("/moliya/kreditlar")} />
        <StatCard label={`Zavod sof foydasi (PNL, ${monthsLabel})`} value={moneyShort(o.pnl.net)} icon={TrendingUp} tone={tone(o.pnl.net)} hint="Hisoblangan usulda, to'liq oy" href={pnlHref} />
      </div>

      <Section title="Pul">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Kassa va bank hisoblari" info="Davr boshi + kirim − chiqim ± o'tkazma = davr oxiri. O'tkazma ustunida perekit va shu davrda kiritilgan boshlang'ich qoldiq." action={<More href={href("/payments")} />} />
            <Table>
              <thead><tr><Th>Hisob</Th><Th right>Davr boshi</Th><Th right>Kirim</Th><Th right>Chiqim</Th><Th right>O&apos;tkazma ±</Th><Th right>Davr oxiri</Th></tr></thead>
              <tbody>
                {o.accounts.length === 0 && <Empty text="Kassa yoki bank hisobi yo'q" />}
                {o.accounts.map((a) => (
                  <Tr key={a.id}>
                    <Td><Name href={href("/cashflow", `?account=${a.id}&from=${isoDate(period.from)}&to=${isoDate(lastDay)}`)}>{a.name}</Name> <Badge color={a.type === "CASH" ? "amber" : "blue"} dot={false}>{a.type === "CASH" ? "Naqd" : "Bank"}</Badge></Td>
                    <Td right className={neg(a.open)}>{moneyShort(a.open)}</Td>
                    <Td right className="text-emerald-700">{moneyShort(a.income)}</Td>
                    <Td right className="text-red-600">{moneyShort(a.expense)}</Td>
                    <Td right>{moneyShort(a.other)}</Td>
                    <Td right className={`font-semibold ${neg(a.close) ?? ""}`}>{moneyShort(a.close)}</Td>
                  </Tr>
                ))}
                <Tr className="bg-slate-50 font-semibold">
                  <Td>Jami</Td><Td right>{moneyShort(o.cash.open)}</Td><Td right>{moneyShort(flow.income)}</Td><Td right>{moneyShort(flow.expense)}</Td>
                  <Td right>{moneyShort(o.cash.close - o.cash.open - flow.income + flow.expense)}</Td><Td right className={neg(o.cash.close)}>{moneyShort(o.cash.close)}</Td>
                </Tr>
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Chiqim manbalari" description={period.label} action={<More href={cf("EXPENSE")} />} />
            <Table>
              <thead><tr><Th>Manba</Th><Th right>Summa</Th><Th right>Ulush</Th></tr></thead>
              <tbody>
                {o.expenseByCat.length === 0 && <Empty text="Bu davrda chiqim yo'q" />}
                {o.expenseByCat.map((c) => (
                  <Tr key={c.category || "rest"}>
                    <Td>{c.category ? <Name href={cf("EXPENSE", c.category)}>{c.category}</Name> : <span className="text-slate-500">Boshqalar</span>}</Td>
                    <Td right>{moneyShort(c.sum)}</Td>
                    <Td right className="text-slate-500">{flow.expense ? pct((c.sum / flow.expense) * 100) : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </Section>

      <Section title="Qarzlar va kreditlar">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader title="Debitorka — eng katta qarzdorlar" description={`Jami ${money(debts.receivable)}`} action={<More href={href("/bi-tahlil/mijozlar/xaridorlar")} />} />
            <Table>
              <thead><tr><Th>Mijoz</Th><Th right>Qarz</Th></tr></thead>
              <tbody>
                {debts.topCustomers.length === 0 && <Empty text="Mijozlar qarzi yo'q" />}
                {debts.topCustomers.map((c) => <Tr key={c.id}><Td><Name href={href("/customers", `/${c.id}`)}>{c.name}</Name></Td><Td right>{moneyShort(c.sum)}</Td></Tr>)}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Kreditorka — ta'minotchilarga qarz" description={`Jami ${money(debts.supplierDebt)}`} action={<More href={href("/bi-tahlil/mijozlar/taminotchilar")} />} />
            <Table>
              <thead><tr><Th>Ta&apos;minotchi</Th><Th right>Qarzimiz</Th></tr></thead>
              <tbody>
                {debts.topSuppliers.length === 0 && <Empty text="Ta'minotchilarga qarz yo'q" />}
                {debts.topSuppliers.map((x) => <Tr key={x.id}><Td><Name href={href("/suppliers", `/${x.id}`)}>{x.name}</Name></Td><Td right>{moneyShort(x.sum)}</Td></Tr>)}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Kreditlar va qarzlar" description="Asosiy qarz qoldig'i (davr oxiri)" action={<More href={href("/moliya/kreditlar")} />} />
            <Table>
              <thead><tr><Th>Nomi</Th><Th right>Qoldiq</Th></tr></thead>
              <tbody>
                {loans.rows.length === 0 && <Empty text="Ochiq kredit yoki qarz yo'q" />}
                {loans.rows.map((l) => (
                  <Tr key={l.id}>
                    <Td><span className="font-medium text-slate-800">{l.name}</span><span className="block text-xs text-slate-500">{LOAN_KIND_LABEL[l.kind]} · {l.counterparty}{l.rate !== null ? ` · ${pct(l.rate)}` : ""}</span></Td>
                    <Td right className={l.kind === "LENT" ? "text-emerald-700" : undefined}>{moneyShort(l.balance)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </Section>

      <Section title="To'lovlar">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Yaqin 7 kunlik to'lovlar" description={`To'lov kalendari: 7 kunda ${money(cal.next7Out)}, muddati o'tgan ${money(cal.overdueOut)}. Eng kam qoldiq ${moneyShort(cal.min.balance)} (${date(cal.min.date)}).`} action={<More href={href("/moliya/kalendar")} />} />
            <Table>
              <thead><tr><Th>Muddat</Th><Th>Kimga</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {cal.items.length === 0 && <Empty text="Yaqin 7 kunda rejalashtirilgan to'lov yo'q" />}
                {cal.items.map((x, i) => (
                  <Tr key={`${x.kind}-${i}`}>
                    <Td>{date(x.due)}{x.overdue && <> <Badge color="red">Muddati o&apos;tgan</Badge></>}</Td>
                    <Td><Name href={x.href ? href(x.href) : undefined}>{x.who}</Name><span className="block text-xs text-slate-500">{CAL_KIND_LABEL[x.kind]} · {x.what}</span></Td>
                    <Td right>{moneyShort(x.amount)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="To'lov va qabul kutayotganlar" description="Ochiq so'rovlar va to'lanmagan hujjatlar (hozirgi holat)" />
            <Table>
              <thead><tr><Th>Nima</Th><Th right>Soni</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                <Tr><Td><Name href={href("/pul-qabul", "?tab=open")}>Pul qabul qilish — ochiq so&apos;rovlar</Name><span className="block text-xs text-slate-500">{methods.map((m) => PAY_METHOD_LABEL[m]).join(", ")}</span></Td><Td right>{fmtNum(rq.open.n)}</Td><Td right>{moneyShort(rq.open.left)}</Td></Tr>
                <Tr><Td><Name href={href("/pul-qabul", "?tab=overdue")}>Pul qabul qilish — muddati o&apos;tgan</Name></Td><Td right className={rq.overdue.n ? "text-red-600" : undefined}>{fmtNum(rq.overdue.n)}</Td><Td right>{moneyShort(rq.overdue.left)}</Td></Tr>
                <Tr><Td><Name href={href("/mexanik-sorovlar", "?tab=APPROVED")}>Mexanik so&apos;rovlari — pul berish kutilmoqda</Name><span className="block text-xs text-slate-500">Faqat zavod so&apos;rovlari</span></Td><Td right>{fmtNum(o.toPay.mechApproved.n)}</Td><Td right>{moneyShort(o.toPay.mechApproved.sum)}</Td></Tr>
                <Tr><Td><Name href={href("/mexanik-sorovlar", "?tab=NEW")}>Mexanik so&apos;rovlari — tasdiq kutilmoqda</Name></Td><Td right>{fmtNum(o.toPay.mechNew.n)}</Td><Td right>{moneyShort(o.toPay.mechNew.sum)}</Td></Tr>
                <Tr><Td><Name href={cf("all")}>To&apos;lanmagan kirim hujjatlari</Name><span className="block text-xs text-slate-500">Skladga kelgan, ta&apos;minotchiga to&apos;lanmagan</span></Td><Td right>{fmtNum(o.toPay.receipts.n)}</Td><Td right>{moneyShort(o.toPay.receipts.sum)}</Td></Tr>
                <Tr><Td><Name href={href("/ish-haqi")}>Ish haqi — tasdiqlangan, to&apos;lanmagan</Name></Td><Td right>{fmtNum(pr.runs.filter((r) => r.status === "APPROVED").length)}</Td><Td right>{moneyShort(pr.toPay)}</Td></Tr>
              </tbody>
            </Table>
          </Card>
        </div>
      </Section>

      <Section title="Foyda va ish haqi">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-2">
            <CardHeader title="Foyda va zarar (PNL)" description={`${monthsLabel} · hisoblangan usulda`} action={<More href={pnlHref} />} />
            <Table>
              <tbody>
                {([["Daromad", o.pnl.income], ["Yalpi foyda", o.pnl.gross], ["Operatsion foyda", o.pnl.operating], ["Zavod sof foydasi", o.pnl.net]] as const).map(([k, v], i) => (
                  <Tr key={k} className={i === 3 ? "bg-slate-50 font-semibold" : undefined}><Td>{k}</Td><Td right className={neg(v)}>{money(v)}</Td></Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card className="xl:col-span-3">
            <CardHeader title={`Ish haqi — ${monthsLabel}`} description={`Hisoblangan (oy yakuni) ${moneyShort(pr.gross)} · tasdiqlangan ${moneyShort(pr.approved)} · to'langan ${moneyShort(pr.paid)} · qoldi ${moneyShort(pr.toPay)}${pr.waiting.n ? ` · direktor tasdig'ida ${pr.waiting.n} ta (${moneyShort(pr.waiting.net)})` : ""}${pr.drafts ? ` · qoralama ${pr.drafts} ta` : ""}`} action={<More href={href("/ish-haqi")} />} />
            <Table>
              <thead><tr><Th>Vedomost</Th><Th>Holat</Th><Th right>Qo&apos;lga</Th><Th right>To&apos;langan</Th><Th right>Qoldi</Th></tr></thead>
              <tbody>
                {pr.runs.length === 0 && <Empty text="Bu oy uchun vedomost hali yo'q" />}
                {pr.runs.slice(0, 8).map((r) => (
                  <Tr key={r.id}>
                    <Td><Name href={href("/ish-haqi", `/${r.id}`)}>{r.docNo}</Name><span className="block text-xs text-slate-500">{PAYROLL_KIND_LABEL[r.kind]} · {monthTitle(r.month)}</span></Td>
                    <Td><Badge color={PAYROLL_STATUS_BADGE[r.status]}>{PAYROLL_STATUS_LABEL[r.status]}</Badge></Td>
                    <Td right>{moneyShort(r.net)}</Td>
                    <Td right>{moneyShort(r.paid)}</Td>
                    <Td right className={r.left > 0 ? "text-amber-700" : undefined}>{moneyShort(r.left)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      </Section>
    </div>
  );
}
