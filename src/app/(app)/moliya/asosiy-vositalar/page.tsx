import Link from "next/link";
import { Building2, CalendarClock, Coins, TrendingDown } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { date, fmtNum, isoDate, money } from "@/lib/format";
import { activeAssets, assetStateAt, depreciationIn, monthlyDepreciation } from "@/lib/fin-report/assets";
import { loadCategories } from "@/lib/fin-report/categories";
import { addMonths, monthKeyOf, monthLabel, monthRange } from "@/lib/fin-report/period";
import { Badge, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { AssetCreateForm, AssetRowActions, type AssetPrefill } from "./forms";

/**
 * Asosiy vositalar — bino, uskuna, mashinalar. Amortizatsiya teng ulushda, olingan oydan keyingi oydan (`lib/fin-report/assets`);
 * PNL'da «Amortizatsiya» qatori, balansda qoldiq qiymat. Kassada «Asosiy vosita xaridi» bilan yozilgan, lekin
 * kartochkasi ochilmagan chiqimlar alohida ro'yxatda — bitta bosish bilan kartochka ochiladi.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const s = await requirePage("/moliya/asosiy-vositalar");
  const sp = await searchParams;
  const canWrite = canDo(s, "moliya", "assets");
  const now = monthKeyOf(new Date());

  const [assets, nodes] = await Promise.all([activeAssets(), loadCategories()]);
  const assetCats = nodes.filter((n) => n.needs === "ASSET").flatMap((n) => [n.name, ...n.aliases]);
  const unlinked = await db.cashTransaction.findMany({
    where: { type: "EXPENSE", cancelledAt: null, fixedAsset: null, category: { in: assetCats, mode: "insensitive" } },
    orderBy: { date: "desc" }, take: 50,
    select: { id: true, date: true, amount: true, counterparty: true, note: true, cashAccount: { select: { name: true } } },
  });
  const pre = unlinked.find((t) => t.id === sp.tx);
  const prefill: AssetPrefill | undefined = pre ? { cashTxId: pre.id, cost: String(Number(pre.amount)), acquiredAt: isoDate(pre.date), name: pre.note ?? pre.counterparty ?? undefined } : undefined;

  const live = assets.filter((a) => !a.disposedAt);
  const cost = live.reduce((x, a) => x + a.cost, 0);
  const net = assets.reduce((x, a) => x + assetStateAt(a, now).net, 0);
  const monthly = assets.reduce((x, a) => x + depreciationIn(a, now), 0);
  const schedule = monthRange(addMonths(now, -2), 12).map((m) => ({ m, dep: assets.reduce((x, a) => x + depreciationIn(a, m), 0), net: assets.reduce((x, a) => x + assetStateAt(a, m).net, 0) }));
  const today = isoDate();

  return (
    <div>
      <PageHeader eyebrow="Moliya" title="Asosiy vositalar" subtitle="Bino, uskuna va mashinalar: qiymati, amortizatsiyasi va balansdagi qoldiq qiymati" />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Vositalar" value={String(live.length)} hint={`${assets.length - live.length} ta chiqarilgan`} icon={Building2} href="#royxat" />
        <StatCard label="Boshlang'ich qiymat" value={money(cost)} icon={Coins} tone="info" href="#royxat" />
        <StatCard label="Qoldiq qiymat (balansda)" value={money(net)} hint={`${monthLabel(now)} oxiriga`} icon={TrendingDown} tone="brand" href="#royxat" />
        <StatCard label="Oylik amortizatsiya" value={money(monthly)} hint="PNL'da ishlab chiqarish xarajati" icon={CalendarClock} href={assets.length ? "#oylar" : "#royxat"} />
      </div>

      {unlinked.length > 0 && (
        <Section title="Kassada xarid bor, kartochkasi yo'q">
          <Table>
            <thead><tr><Th>Sana</Th><Th>Hisob</Th><Th>Kimga / izoh</Th><Th right>Summa</Th>{canWrite && <Th />}</tr></thead>
            <tbody>
              {unlinked.map((t) => (
                <Tr key={t.id}>
                  <Td>{date(t.date)}</Td>
                  <Td className="text-slate-500">{t.cashAccount.name}</Td>
                  <Td>{[t.counterparty, t.note].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td right>{money(Number(t.amount))}</Td>
                  {canWrite && <Td right><Link href={`?tx=${t.id}#yangi`} className="text-[13px] font-semibold text-brand-700 hover:underline">Kartochka ochish</Link></Td>}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section id="royxat" title="Ro'yxat">
        <Table>
          <thead><tr><Th>Nomi</Th><Th>Guruh</Th><Th>Olingan</Th><Th right>Qiymati</Th><Th right>Muddat</Th><Th right>Oylik</Th><Th right>Yig'ilgan</Th><Th right>Qoldiq qiymat</Th>{canWrite && <Th />}</tr></thead>
          <tbody>
            {assets.length === 0 && <Empty text="Asosiy vosita kiritilmagan — balansda «Asosiy vositalar» 0 bo'lib turadi" icon={Building2} />}
            {assets.map((a) => {
              const st = assetStateAt(a, now);
              return (
                <Tr key={a.id}>
                  <Td>{a.name}{a.disposedAt && <> <Badge color="slate">chiqarilgan {date(a.disposedAt)}</Badge></>}{a.cashTxId && <> <Badge color="blue">kassadan</Badge></>}{a.note && <div className="text-[13px] font-normal text-slate-500">{a.note}</div>}</Td>
                  <Td className="text-slate-500">{a.group}</Td>
                  <Td>{date(a.acquiredAt)}</Td>
                  <Td right>{fmtNum(a.cost)}</Td>
                  <Td right className="text-slate-500">{fmtNum(a.lifeMonths / 12, 2)} yil</Td>
                  <Td right>{fmtNum(monthlyDepreciation(a))}</Td>
                  <Td right className="text-slate-500">{fmtNum(st.accumulated)}</Td>
                  <Td right className="font-semibold">{fmtNum(st.net)}</Td>
                  {canWrite && <Td right>{!a.disposedAt && <AssetRowActions id={a.id} today={today} />}</Td>}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Section>

      {assets.length > 0 && (
        <Section id="oylar" title="Oylar bo'yicha">
          <Table>
            <thead><tr><Th>Oy</Th><Th right>Amortizatsiya (PNL)</Th><Th right>Qoldiq qiymat oy oxirida (balans)</Th></tr></thead>
            <tbody>
              {schedule.map((r) => (
                <Tr key={r.m} className={r.m === now ? "bg-amber-50/60" : undefined}><Td>{monthLabel(r.m)}</Td><Td right>{fmtNum(r.dep)}</Td><Td right>{fmtNum(r.net)}</Td></Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      {canWrite && (
        <div id="yangi" className="mt-8 scroll-mt-20">
          <Card>
            <CardHeader title="Yangi asosiy vosita" description="Tizimga o'tish sanasidagi bor vositalarni bugungi baholangan qiymati va qolgan xizmat muddati bilan kiriting" />
            <AssetCreateForm prefill={prefill} today={today} txOptions={unlinked.map((t) => ({ id: t.id, label: `${date(t.date)} · ${money(Number(t.amount))}${t.note ? " · " + t.note : ""}` }))} />
          </Card>
        </div>
      )}
    </div>
  );
}
