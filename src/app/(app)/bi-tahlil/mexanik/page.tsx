import Link from "next/link";
import { CheckCircle2, Clock, Wallet, Wrench } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { requirePage } from "@/lib/page-guard";
import { MechanicTech } from "@/app/(app)/dashboard/mechanic-home";
import { mechanicCounts, mechanicList, mechSubject, MECH_STATUS_COLOR, MECH_STATUS_SHORT } from "@/lib/mechanic-requests";
import { date, money, moneyShort } from "@/lib/format";
import { Badge, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Mexanik tahlili — faqat texnika: ta'mir pul so'rovlari, ehtiyot qism zayavkalari, texnik xizmat. Zayavka/reys nazorati — Tahlil → Logistika. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mexanik");
  const { range } = await biContext(searchParams);
  const [c, open] = await Promise.all([mechanicCounts(), mechanicList({ status: ["NEW", "APPROVED"], take: 10 })]);
  return (
    <BiPage title="Mexanik" subtitle="Texnika: ta'mir uchun pul so'rovlari, ehtiyot qism zayavkalari va texnik xizmat muddati" tab="mechanic" range={range} period={false}>
      <Section title="Mexanik so'rovlari (ta'mir, ehtiyot qism uchun pul)" className="mt-0"
        action={<Link href="/mexanik-sorovlar" className="text-sm text-slate-500 hover:text-slate-900">Hammasi</Link>}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Tasdiq kutilmoqda" value={`${c.counts.NEW} ta`} hint={moneyShort(c.sums.NEW)} icon={Clock} tone={c.counts.NEW ? "warning" : "default"} href="/mexanik-sorovlar?tab=NEW" />
          <StatCard label="Kassa kutilmoqda" value={`${c.counts.APPROVED} ta`} hint={moneyShort(c.sums.APPROVED)} icon={Wallet} tone={c.counts.APPROVED ? "info" : "default"} href="/mexanik-sorovlar?tab=APPROVED" />
          <StatCard label="Pul berilgan" value={`${c.counts.PAID} ta`} hint={moneyShort(c.sums.PAID)} icon={CheckCircle2} tone="success" href="/mexanik-sorovlar?tab=PAID" />
          <StatCard label="Rad / bekor" value={`${c.counts.REJECTED + c.counts.CANCELLED} ta`} hint={`jami ${c.total} ta so'rov`} icon={Wrench} href="/mexanik-sorovlar?tab=REJECTED" />
        </div>
        <div className="mt-3">
          <Table>
            <thead><tr><Th>Hujjat</Th><Th>Nima uchun</Th><Th>Muammo</Th><Th right>Summa</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {open.length === 0 && <Empty text="Ochiq so'rov yo'q" icon={Wrench} />}
              {open.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/mexanik-sorovlar/${r.id}`} className="font-medium tabular hover:underline">{r.docNo}</Link>
                    <div className="text-xs text-slate-500">{date(r.createdAt)} · {r.createdBy.fullName}</div>
                  </Td>
                  <Td className="tabular">{mechSubject(r)}</Td>
                  <Td className="text-sm">{r.problem}{r.urgent && <span className="ml-1.5"><Badge color="red">Shoshilinch</Badge></span>}</Td>
                  <Td right className="tabular">{money(r.amount)}</Td>
                  <Td><Badge color={MECH_STATUS_COLOR[r.status]}>{MECH_STATUS_SHORT[r.status]}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Section>
      <MechanicTech />
    </BiPage>
  );
}
