import Link from "next/link";
import { CircleCheck, Clock, HandCoins, Wrench } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { MECH_STATUS_COLOR, MECH_STATUS_SHORT, MECH_TABS, TARGET_LABEL, mechSubject, mechTab, mechanicCounts, mechanicList, tabCount } from "@/lib/mechanic-requests";
import { money, dateTime } from "@/lib/format";
import { Badge, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";

/**
 * Mexanik so'rovlari ("Kirim") — mexanik ta'mir / ehtiyot qism uchun pul so'raydi (Insof ECO ilovasidan),
 * ish boshqaruvchi tasdiqlaydi, kassa pul beradi. Mexanik faqat o'z so'rovlarini ko'radi.
 */
export default async function MexanikSorovlarPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const s = await requirePage("/mexanik-sorovlar");
  const { tab, q } = await searchParams;
  const t = mechTab(tab);
  const own = s.role === "MECHANIC" ? s.userId : null;
  const [rows, c] = await Promise.all([mechanicList({ status: t.status, createdById: own, q }), mechanicCounts(own)]);

  return (
    <div>
      <PageHeader title={own ? "Mening so'rovlarim" : "Mexanik so'rovlari"}
        subtitle="Mexanik Insof ECO ilovasidan pul so'raydi → ish boshqaruvchi tasdiqlaydi → kassa pul beradi. Tasdiqlanmagan so'rovga kassa pul bermaydi." />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Tasdiq kutmoqda" value={`${c.counts.NEW} ta`} hint={c.counts.NEW ? money(c.sums.NEW) : undefined} icon={Clock} tone={c.counts.NEW ? "warning" : "default"} href="/mexanik-sorovlar?tab=NEW" />
        <StatCard label="Kassa kutmoqda" value={`${c.counts.APPROVED} ta`} hint={c.counts.APPROVED ? money(c.sums.APPROVED) : undefined} icon={HandCoins} tone={c.counts.APPROVED ? "info" : "default"} href="/mexanik-sorovlar?tab=APPROVED" />
        <StatCard label="Pul berilgan" value={`${c.counts.PAID} ta`} hint={money(c.sums.PAID)} icon={CircleCheck} tone="success" href="/mexanik-sorovlar?tab=PAID" />
        <StatCard label="Rad / bekor" value={`${c.counts.REJECTED + c.counts.CANCELLED} ta`} icon={Wrench} href="/mexanik-sorovlar?tab=REJECTED" />
      </div>

      <Tabs current={t.key} items={MECH_TABS.map((x) => ({ key: x.key, label: x.label, href: `/mexanik-sorovlar?tab=${x.key}`, count: tabCount(c.counts, x) }))} />
      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Nima uchun</Th><Th>Muammo</Th><Th right>Summa</Th><Th>Holat</Th>{!own && <Th>Kim so&apos;radi</Th>}</tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text={`"${t.label}" bo'yicha so'rov yo'q`} icon={Wrench} />}
          {rows.map((r) => (
            <Tr key={r.id} className={r.urgent && r.status === "NEW" ? "bg-red-50/60" : undefined}>
              <Td>
                <Link href={`/mexanik-sorovlar/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link>
                {r.urgent && <div className="mt-0.5"><Badge color="red">Shoshilinch</Badge></div>}
              </Td>
              <Td className="whitespace-nowrap text-slate-600">{dateTime(r.createdAt)}</Td>
              <Td>
                <div className="font-medium">{mechSubject(r)}</div>
                <div className="text-xs text-slate-500">{TARGET_LABEL[r.target]}</div>
              </Td>
              <Td className="text-slate-600">{r.problem}{r.note && <div className="max-w-xs truncate text-xs text-slate-500">{r.note}</div>}</Td>
              <Td right className="font-medium">{money(r.amount)}</Td>
              <Td><Badge color={MECH_STATUS_COLOR[r.status]}>{MECH_STATUS_SHORT[r.status]}</Badge></Td>
              {!own && <Td className="text-slate-600">{r.createdBy.fullName}</Td>}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
