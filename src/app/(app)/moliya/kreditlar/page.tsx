import { HandCoins, Landmark, Percent, Wallet } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { date, fmtNum, isoDate, money } from "@/lib/format";
import { loanBalances, LOAN_KIND_LABEL } from "@/lib/fin-report/loans";
import { loadCategories } from "@/lib/fin-report/categories";
import { Badge, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { LinkTxForm, LoanCreateForm, LoanRowActions } from "./forms";

/**
 * Kreditlar va qarzlar — balansning passivi (bank kreditlari, olingan qarzlar) va aktivi (biz bergan qarzlar).
 * Qoldiq = boshlang'ich + kassadagi asosiy qarz harakatlari (`lib/fin-report/loans`). Foiz — PNL xarajati.
 */
export default async function LoansPage() {
  const s = await requirePage("/moliya/kreditlar");
  const canWrite = canDo(s, "moliya", "loans");
  const [loans, nodes] = await Promise.all([loanBalances(), loadCategories()]);
  const loanCats = nodes.filter((n) => n.needs === "LOAN").flatMap((n) => [n.name, ...n.aliases]);
  const unlinked = await db.cashTransaction.findMany({
    where: { cancelledAt: null, loanId: null, type: { in: ["INCOME", "EXPENSE"] }, category: { in: loanCats, mode: "insensitive" } },
    orderBy: { date: "desc" }, take: 100,
    select: { id: true, date: true, type: true, amount: true, category: true, counterparty: true, note: true, cashAccount: { select: { name: true } } },
  });

  const owe = loans.filter((l) => l.kind !== "LENT" && !l.closedAt);
  const bank = owe.filter((l) => l.kind === "BANK").reduce((x, l) => x + l.balance, 0);
  const borrowed = owe.filter((l) => l.kind === "BORROWED").reduce((x, l) => x + l.balance, 0);
  const lent = loans.filter((l) => l.kind === "LENT" && !l.closedAt).reduce((x, l) => x + l.balance, 0);
  const interest = loans.reduce((x, l) => x + l.interestPaid, 0);
  const openLoans = loans.filter((l) => !l.closedAt).map((l) => ({ id: l.id, label: `${l.name} (${LOAN_KIND_LABEL[l.kind]})` }));

  return (
    <div>
      <PageHeader eyebrow="Moliya" title="Kreditlar va qarzlar" subtitle="Bank kreditlari, olingan va berilgan qarzlar: qoldiq, to'langan asosiy qarz va foiz" />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Bank kreditlari" value={money(bank)} hint="balans passivi" icon={Landmark} tone={bank > 0 ? "warning" : "default"} href="#reyestr" />
        <StatCard label="Olingan qarzlar" value={money(borrowed)} icon={Wallet} href="#reyestr" />
        <StatCard label="Biz bergan qarzlar" value={money(lent)} hint="balans aktivi" icon={HandCoins} tone="info" href="#reyestr" />
        <StatCard label="To'langan foiz (jami)" value={money(interest)} hint="PNL: «Kredit foizi»" icon={Percent} href="#reyestr" />
      </div>

      <Section id="reyestr" title="Reyestr">
        <Table>
          <thead><tr><Th>Nomi</Th><Th>Turi</Th><Th>Qoldiq sanasi</Th><Th right>Boshlang&apos;ich</Th><Th right>Olindi / berildi</Th><Th right>Qaytarildi</Th><Th right>Foiz to&apos;landi</Th><Th right>Qoldiq</Th>{canWrite && <Th />}</tr></thead>
          <tbody>
            {loans.length === 0 && <Empty text="Kredit kiritilmagan — balansda «Bank kreditlari» 0 bo'lib turadi" icon={Landmark} />}
            {loans.map((l) => {
              const got = l.kind === "LENT" ? l.principalOut : l.principalIn;
              const back = l.kind === "LENT" ? l.principalIn : l.principalOut;
              return (
                <Tr key={l.id}>
                  <Td>{l.name}{l.closedAt && <> <Badge color="green">yopilgan</Badge></>}<div className="text-[13px] font-normal text-slate-500">{[l.counterparty, l.rate !== null ? `${fmtNum(l.rate, 2)}%` : null, l.note].filter(Boolean).join(" · ")}</div></Td>
                  <Td><Badge color={l.kind === "LENT" ? "blue" : l.kind === "BANK" ? "amber" : "violet"}>{LOAN_KIND_LABEL[l.kind]}</Badge></Td>
                  <Td>{date(l.openingDate)}</Td>
                  <Td right>{fmtNum(l.opening)}</Td>
                  <Td right>{fmtNum(got)}</Td>
                  <Td right>{fmtNum(back)}</Td>
                  <Td right className="text-slate-500">{fmtNum(l.interestPaid)}</Td>
                  <Td right className="font-semibold">{fmtNum(l.balance)}</Td>
                  {canWrite && <Td right><LoanRowActions id={l.id} canClose={!l.closedAt} /></Td>}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Section>

      {unlinked.length > 0 && (
        <Section title="Kassada kredit yozuvi, lekin kredit tanlanmagan">
          <p className="mb-3 text-[13px] text-slate-500">Bu yozuvlar qoldiqni o&apos;zgartirmaydi va balansga tushmaydi. Qaysi kreditga tegishli ekanini tanlang.</p>
          <Table>
            <thead><tr><Th>Sana</Th><Th>Kategoriya</Th><Th>Hisob</Th><Th>Izoh</Th><Th right>Summa</Th>{canWrite && <Th />}</tr></thead>
            <tbody>
              {unlinked.map((t) => (
                <Tr key={t.id}>
                  <Td>{date(t.date)}</Td>
                  <Td>{t.category}</Td>
                  <Td className="text-slate-500">{t.cashAccount.name}</Td>
                  <Td className="text-slate-500">{[t.counterparty, t.note].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td right className={t.type === "EXPENSE" ? "text-red-600" : "text-emerald-700"}>{t.type === "EXPENSE" ? "−" : "+"}{fmtNum(Number(t.amount))}</Td>
                  {canWrite && <Td right>{openLoans.length ? <LinkTxForm txId={t.id} loans={openLoans} /> : <span className="text-[13px] text-slate-400">avval kredit qo&apos;shing</span>}</Td>}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {canWrite && (
        <div className="mt-8">
          <Card>
            <CardHeader title="Yangi kredit yoki qarz" description="Tizimga o'tish sanasidagi qolgan asosiy qarzni kiriting; keyingi to'lovlar Kirim-Chiqimda shu kreditni tanlab yoziladi" />
            <LoanCreateForm today={isoDate()} />
          </Card>
        </div>
      )}
    </div>
  );
}
