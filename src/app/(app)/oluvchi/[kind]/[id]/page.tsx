import Link from "next/link";
import { notFound } from "next/navigation";
import { HardHat, PackageMinus, User, Users } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { canSeeRasxod } from "@/lib/stock-journal-access";
import { CARD_KIND_LABEL, cardHref, cardKey, isCardKind, recipientCard, type RecipientCard } from "@/lib/recipient-card";
import { stockPeriod, StockPeriodBar } from "@/components/stock-period";
import { dateRu, fmtNum } from "@/lib/format";
import { unitLabel, unitShort } from "@/lib/unit";
import { Badge, Card, CardHeader, LinkButton, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Oluvchi kartasi — Chiqim jurnalidagi «Kimga» nomidan ochiladi: /oluvchi/b/<brigada> · /oluvchi/e/<xodim> · /oluvchi/r/<oluvchi>.
 * Nima va qancha pulga berilgan (davr va barcha vaqt), tovar bo'yicha, chiqim tarixi. Brigadada qo'shimcha: qo'lidagi xomashyo va
 * qiymati, shu xomashyo bilan qancha chiqara olishi, davrda ishlab chiqarilgani, 1 birlikka sarf (samaradorlik), brak.
 * Kim ko'radi — `lib/nav.ts` «/oluvchi»: sklad, snabjeniye, ishlab chiqarish, ish boshqaruvchi, buxgalteriya, direktor.
 * Raqamlar `lib/recipient-card.ts` dan — Chiqim jurnali bilan bir manba.
 */

const money = (v: number) => `${fmtNum(v, 0)} so'm`;
const ICON = { b: HardHat, e: User, r: Users } as const;

export default async function OluvchiPage({ params, searchParams }: {
  params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { kind, id } = await params;
  if (!isCardKind(kind)) notFound();
  const s = await requirePage("/oluvchi");
  const period = stockPeriod(await searchParams);
  const card = await recipientCard(kind, id, period);
  if (!card) notFound();
  const canIssue = canDo(s, "stock", "issue");
  const back = canSeeRasxod(s) ? { href: "/stock/rasxod", label: "Chiqim" } : { href: "/brigades", label: "Brigadalar" };
  const Icon = ICON[kind];
  const b = card.brigade;
  const base = cardHref(kind, id);

  return (
    <div>
      <PageHeader
        back={back}
        title={<span className="inline-flex items-center gap-2"><Icon size={22} className="text-slate-500" />{card.name}</span>}
        subtitle={card.subtitle ?? undefined}
        action={canIssue && card.isActive ? <LinkButton href={`/stock/rasxod/new?to=${cardKey(kind, id)}`}><PackageMinus size={16} /> Shu oluvchiga chiqim</LinkButton> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge color="slate" dot={false}>{CARD_KIND_LABEL[kind]}</Badge>
        {!card.isActive && <Badge color="amber" dot={false}>{kind === "e" ? "Ishdan bo'shagan" : "Nofaol"}</Badge>}
        {card.employee?.leads.map((x) => (
          <Link key={x.id} href={cardHref("b", x.id)} className="text-sm text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900">
            {`Brigadir: ${x.name} →`}
          </Link>
        ))}
        {b && b.members > 0 && <span className="text-sm text-slate-500">{`${b.members} xodim`}</span>}
        {b?.phone && <span className="text-sm text-slate-500">{b.phone}</span>}
      </div>

      <div className="mb-4"><StockPeriodBar base={base} period={period} /></div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Davrda berilgan" value={money(card.totals.sum)} hint={`${fmtNum(card.totals.count)} qator · ${period.label}`} tone="brand" />
        <StatCard label="Barcha vaqt" value={money(card.allTime.sum)} hint={card.allTime.lastAt ? `${fmtNum(card.allTime.docs)} chiqim · oxirgisi ${dateRu(card.allTime.lastAt)}` : "hali berilmagan"} />
        {b ? (
          <>
            <StatCard label="Qo'lida hozir" value={money(b.handValue)} hint={b.hand.length ? `${b.hand.length} xil xomashyo` : "xomashyo yo'q"} />
            <StatCard label="Ishlab chiqarildi (davr)" value={b.produced.length ? b.produced.map((p) => `${fmtNum(p.qty, 3)} ${unitLabel(p.unit)}`).join(" · ") : "0"}
              hint={`${fmtNum(b.doneTasks)} topshiriq yopildi · ${fmtNum(b.openTasks)} ochiq`} />
            <StatCard label="1 birlikka sarf" value={b.perUnit ? `${money(b.perUnit.value)} / ${unitShort(b.perUnit.unit)}` : "—"}
              hint={b.perUnit ? (b.perUnit.basis === "consumed" ? `retsept bo'yicha sarf ${money(b.consumedValue)} ÷ ${fmtNum(b.perUnit.producedQty, 3)} ${unitShort(b.perUnit.unit)}` : `taxminiy: berilgan ${money(card.totals.sum)} ÷ ${fmtNum(b.perUnit.producedQty, 3)} ${unitShort(b.perUnit.unit)}`) : "davrda mahsulot chiqarilmagan"} />
            <StatCard label="Brak (davr)" value={b.defects.length ? b.defects.map((p) => `${fmtNum(p.qty, 3)} ${unitLabel(p.unit)}`).join(" · ") : "0"}
              hint={b.defects.length ? b.defects.map((d) => d.product).join(", ") : "brak qayd etilmagan"} tone={b.defects.length ? "warning" : "default"} />
          </>
        ) : (
          <>
            <StatCard label="Tovarlar (davr)" value={fmtNum(card.byMaterial.length)} hint="xil tovar" />
            <StatCard label="QQS bilan (davr)" value={money(card.totals.total)} hint={card.totals.vat ? `QQS ${money(card.totals.vat)}` : "QQS 0"} />
          </>
        )}
      </div>

      {b && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Qo'lidagi xomashyo" description="Brigadaga berilgan, hali sarflanmagan yoki qaytarilmagan xomashyo (o'rtacha tannarxda)." />
            {b.hand.length === 0 ? <p className="text-sm text-slate-500">Brigada qo&apos;lida xomashyo yo&apos;q.</p> : (
              <Table>
                <thead><tr><Th>Nomi</Th><Th right>Miqdor</Th><Th right>Qiymat</Th></tr></thead>
                <tbody>
                  {b.hand.map((m) => (
                    <Tr key={m.materialId}>
                      <Td className="font-medium">{m.name}</Td>
                      <Td right className={cn("tabular", m.qty < 0 && "text-red-600")}>{`${fmtNum(m.qty, 3)} ${unitShort(m.unit)}`}</Td>
                      <Td right className="tabular text-slate-600">{fmtNum(m.cost)}</Td>
                    </Tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold"><Td>Jami</Td><Td /><Td right className="tabular">{fmtNum(b.handValue)}</Td></tr>
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Shu xomashyo bilan chiqara oladi" description="Retsept bo'yicha: qo'lidagi xomashyodan necha birlik chiqadi va qaysi xomashyo avval tugaydi." />
            {b.makes.length === 0 ? <p className="text-sm text-slate-500">Hozirgi qoldiq bilan retseptli mahsulot chiqarib bo&apos;lmaydi.</p> : (
              <ul className="divide-y divide-slate-100">
                {b.makes.map((m) => (
                  <li key={m.productId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{m.product}</div>
                      {m.limiting && <div className="text-xs text-slate-500">{`avval tugaydi: ${m.limiting.name} (${fmtNum(m.limiting.balance, 3)} ${unitShort(m.limiting.unit)})`}</div>}
                    </div>
                    <span className="shrink-0 font-semibold text-emerald-700 tabular">{`${fmtNum(m.canMake, 2)} ${unitLabel(m.unit)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {(b.produced.length > 0 || b.defects.length > 0) && (
            <Card className="lg:col-span-2">
              <CardHeader title="Ishlab chiqarish (davr)" description="Topshiriq fakti va brak — mahsulot bo'yicha." />
              <Table>
                <thead><tr><Th>Mahsulot</Th><Th right>Ishlab chiqarildi</Th><Th right>Brak</Th><Th right>Brak %</Th></tr></thead>
                <tbody>
                  {[...new Set([...b.produced.map((p) => p.product), ...b.defects.map((d) => d.product)])].map((name) => {
                    const p = b.produced.find((x) => x.product === name), d = b.defects.find((x) => x.product === name);
                    const unit = p?.unit ?? d?.unit ?? "";
                    const pct = p && p.qty > 0 && d ? (d.qty / p.qty) * 100 : null;
                    return (
                      <Tr key={name}>
                        <Td className="font-medium">{name}</Td>
                        <Td right className="tabular">{p ? `${fmtNum(p.qty, 3)} ${unitShort(unit)}` : "—"}</Td>
                        <Td right className={cn("tabular", d && "text-amber-700")}>{d ? `${fmtNum(d.qty, 3)} ${unitShort(unit)}` : "—"}</Td>
                        <Td right className={cn("tabular", pct != null && pct > 5 && "font-semibold text-red-600")}>{pct == null ? "—" : `${fmtNum(pct, 1)}%`}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}

      <Card className="mb-6">
        <CardHeader title="Davrda berilgan tovarlar" description="Tovar bo'yicha jami: bekor qilinganlar va qaytarishlar ayirilgan. Narx — chiqim paytidagi «Dona narxi»." />
        {card.byMaterial.length === 0 ? <p className="text-sm text-slate-500">Tanlangan davrda chiqim yo&apos;q.</p> : (
          <Table>
            <thead><tr><Th>Nomi</Th><Th>Birlik</Th><Th right>Miqdor</Th><Th right>Summa</Th><Th right>Chiqimlar</Th><Th>Oxirgisi</Th></tr></thead>
            <tbody>
              {card.byMaterial.map((m) => (
                <Tr key={m.materialId}>
                  <Td className="font-medium">{m.name}</Td>
                  <Td className="text-slate-500">{unitShort(m.unit)}</Td>
                  <Td right className="tabular">{fmtNum(m.qty, 3)}</Td>
                  <Td right className="tabular font-medium">{fmtNum(m.sum)}</Td>
                  <Td right className="tabular text-slate-500">{fmtNum(m.docs)}</Td>
                  <Td className="whitespace-nowrap text-slate-500">{dateRu(m.lastAt)}</Td>
                </Tr>
              ))}
              <tr className="bg-slate-50 font-semibold"><Td colSpan={3}>Jami</Td><Td right className="tabular">{fmtNum(card.totals.sum)}</Td><Td colSpan={2} /></tr>
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Chiqim tarixi" description={`${period.label} · ${fmtNum(card.rows.length)} qator. To'liq jurnal — Sklad → Chiqim.`} />
        {card.rows.length === 0 ? <p className="text-sm text-slate-500">Tanlangan davrda chiqim yo&apos;q.</p> : (
          <Table>
            <thead><tr><Th>Sana</Th><Th>Nomi</Th><Th>Birlik</Th><Th right>Miqdor</Th><Th right>Narx</Th><Th right>Summa</Th><Th>Holat / izoh</Th></tr></thead>
            <tbody>
              {card.rows.map((r) => <HistoryRow key={r.id} r={r} />)}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function HistoryRow({ r }: { r: RecipientCard["rows"][number] }) {
  const dim = r.kind === "return" || r.kind === "storno" || r.cancelled;
  const state = r.kind === "storno" ? "Bekor qilish" : r.kind === "return" ? "Qaytarish" : r.cancelled ? "Bekor qilingan" : r.auto ? "Avto" : null;
  const note = r.kind === "storno" && r.note ? r.note.replace(/^(?:Storno|Сторно|Bekor qilish):\s*/, "") : r.note;
  return (
    <Tr className={cn(dim && "text-slate-500")}>
      <Td className="whitespace-nowrap">{dateRu(r.date)}</Td>
      <Td className="font-medium">{r.material}</Td>
      <Td className="text-slate-500">{unitShort(r.unit)}</Td>
      <Td right className={cn("tabular", r.qty < 0 && "text-slate-500")}>{fmtNum(r.qty, 3)}</Td>
      <Td right className="tabular">{r.price == null ? <span className="text-amber-700">narx yo&apos;q</span> : <>{r.priceApprox && <span className="mr-0.5 text-slate-400">≈</span>}{fmtNum(r.price, 2)}</>}</Td>
      <Td right className="tabular font-medium">{fmtNum(r.sum)}</Td>
      <Td className="text-xs text-slate-500">
        {state && <Badge color={r.kind === "storno" || r.cancelled ? "red" : r.kind === "return" ? "slate" : "blue"} dot={false}>{state}</Badge>}
        {note && <span className="ml-1.5">{note}</span>}
      </Td>
    </Tr>
  );
}

export const metadata = { title: "Oluvchi kartasi" };
