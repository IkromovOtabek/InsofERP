import Link from "next/link";
import { AlarmClock, ArrowRight, CheckCheck, HandCoins } from "lucide-react";
import type { PayMethod } from "@/generated/prisma";
import { money } from "@/lib/format";
import { Section, StatCard } from "@/components/ui";
import { payReqSummary } from "../pul-qabul/summary";

/**
 * Kassir / buxgalter bosh sahifasi: «Pul qabul qilish» — ochiq, muddati o'tgan so'rovlar va bugun qabul qilingan pul.
 * Raqamlar bo'lim sahifasidagi bilan bir manbadan (`payReqSummary`).
 */
export async function PulQabulSection({ methods }: { methods: PayMethod[] }) {
  const s = await payReqSummary(methods);
  return (
    <Section title="Pul qabul qilish" className="mt-0 mb-8" action={<Link href="/pul-qabul" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Ochish <ArrowRight size={14} /></Link>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Ochiq so'rovlar" value={`${s.open.n} ta`} hint={`kutilmoqda ${money(s.open.left)}`} icon={HandCoins} tone={s.open.n > 0 ? "warning" : "default"} href="/pul-qabul" />
        <StatCard label="Muddati o'tgan" value={`${s.overdue.n} ta`} hint={s.overdue.n > 0 ? `${money(s.overdue.left)} hali tushmagan` : "yo'q"} icon={AlarmClock} tone={s.overdue.n > 0 ? "danger" : "default"} href="/pul-qabul?tab=overdue" />
        <StatCard label="Bugun qabul qilingan" value={money(s.today.sum)} hint={`${s.today.n} ta to'lov`} icon={CheckCheck} tone="success" href="/pul-qabul?tab=done" />
      </div>
    </Section>
  );
}
