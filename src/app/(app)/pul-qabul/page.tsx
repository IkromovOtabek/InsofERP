import Link from "next/link";
import { AlarmClock, Banknote, CalendarDays, CheckCheck, ChevronDown, ChevronUp, HandCoins, History, Landmark, Layers, ListTodo, Search } from "lucide-react";
import type { PayMethod } from "@/generated/prisma";
import { requirePage } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { date, dateTime, isoDate, money } from "@/lib/format";
import { daysLeft, dueLabel } from "@/lib/production";
import {
  PAYREQ_STATUS_COLOR, PAYREQ_STATUS_LABEL, PAYREQ_TABS, getPaymentRequest, listPaymentRequests, methodsFor, payReqCounts, payReqTab, receiveAccounts,
  type PayReqRow, type PayReqTab,
} from "@/lib/payment-requests";
import { Badge, Button, Callout, Empty, Input, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { payReqSummary } from "./summary";
import { ReceiveForm } from "./receive-form";

const TAB_ICON: Record<PayReqTab, typeof Layers> = { all: Layers, open: ListTodo, today: CalendarDays, overdue: AlarmClock, done: CheckCheck, history: History };
const SUBTITLE: Record<PayMethod, string> = {
  CASH: "Naqd bosh to'lovlar — mijoz pul olib kelganda qabul qiling",
  BANK: "Perechisleniye — bankka tushganini tasdiqlang",
};
const COLS = 11;

/** Usul belgisi: naqd — sariq (kassa), perechisleniye — ko'k (bank). */
function MethodBadge({ method }: { method: PayMethod }) {
  return method === "CASH"
    ? <Badge color="amber" dot={false}><Banknote size={12} /> Naqd</Badge>
    : <Badge color="blue" dot={false}><Landmark size={12} /> Perechisleniye</Badge>;
}

/**
 * «Pul qabul qilish» — zayavka bosh to'lovi so'rovlari (PS-…).
 * Kassir naqd so'rovlarni, buxgalter perechisleniyeni ko'radi va qabul qiladi; direktor — ikkalasini.
 * Qabul huquqi yo'q, lekin bo'limni ko'radigan xodim (masalan Finance) — ikkala usulni faqat ko'radi.
 * Filtrlar ECO ilovasidagi chiplar bilan bir xil (`PAYREQ_TABS`). Qator ochilsa — to'lovlar tarixi va qabul formasi.
 */
export default async function PulQabulPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; from?: string; to?: string; open?: string }> }) {
  const s = await requirePage("/pul-qabul");
  const sp = await searchParams;
  const can = methodsFor(s);
  const methods: PayMethod[] = can.length ? can : ["CASH", "BANK"];
  const tab = payReqTab(sp.tab);
  const q = sp.q?.trim() || undefined;
  const parse = (v?: string) => { const d = v ? new Date(v) : undefined; return d && Number.isFinite(d.getTime()) ? d : undefined; };
  const from = tab === "history" ? parse(sp.from) : undefined;
  const to = tab === "history" ? parse(sp.to) : undefined;
  if (to) to.setHours(23, 59, 59, 999);

  const [counts, rows, summary, cashAccs, bankAccs] = await Promise.all([
    payReqCounts(methods),
    listPaymentRequests(tab, methods, { q, from, to }),
    payReqSummary(methods),
    can.includes("CASH") ? receiveAccounts("CASH") : [],
    can.includes("BANK") ? receiveAccounts("BANK") : [],
  ]);
  // Bildirishnoma yoki boshqa tabdan ochilgan so'rov ro'yxatda bo'lmasa — tepaga qo'shiladi
  let list: PayReqRow[] = rows;
  if (sp.open && !rows.some((r) => r.id === sp.open)) {
    const one = await getPaymentRequest(sp.open, methods);
    if (one) list = [one, ...rows];
  }
  const canOrders = pathAllowed("/orders", s.role, s.perms);
  const accountsFor = (m: PayMethod) => (m === "CASH" ? cashAccs : bankAccs);

  const href = (t: PayReqTab, open?: string) => {
    const p = new URLSearchParams();
    if (t !== "open") p.set("tab", t);
    if (q) p.set("q", q);
    if (t === "history" && from) p.set("from", isoDate(from));
    if (t === "history" && to) p.set("to", isoDate(to));
    if (open) p.set("open", open);
    const qs = p.toString();
    return qs ? `/pul-qabul?${qs}` : "/pul-qabul";
  };
  const subtitle = can.length
    ? can.map((m) => SUBTITLE[m]).join(" · ")
    : "Naqd bosh to'lovni Kassa xodimi, perechisleniyeni Buxgalter qabul qiladi — sizda faqat ko'rish";
  const tabLabel = PAYREQ_TABS.find((t) => t.key === tab)?.label ?? "";

  return (
    <div>
      <PageHeader title="Pul qabul qilish" subtitle={subtitle} />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Ochiq so'rovlar" value={`${summary.open.n} ta`} hint={`kutilmoqda ${money(summary.open.left)}`} icon={HandCoins} tone={summary.open.n > 0 ? "warning" : "default"} href={href("open")} />
        <StatCard label="Muddati o'tgan" value={`${summary.overdue.n} ta`} hint={summary.overdue.n > 0 ? `${money(summary.overdue.left)} hali tushmagan` : "yo'q"} icon={AlarmClock} tone={summary.overdue.n > 0 ? "danger" : "default"} href={href("overdue")} />
        <StatCard label="Bugun qabul qilingan" value={money(summary.today.sum)} hint={`${summary.today.n} ta to'lov`} icon={CheckCheck} tone="success" />
      </div>

      {!can.length && <Callout tone="info">Bu bo&apos;limda sizda faqat ko&apos;rish huquqi bor: pulni qabul qilish tugmasi Kassa xodimi va Buxgalterda chiqadi.</Callout>}

      <Tabs current={tab} items={PAYREQ_TABS.map((t) => ({ key: t.key, label: t.label, icon: TAB_ICON[t.key], href: href(t.key), count: counts[t.key] }))} />

      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
        <Input name="q" defaultValue={q ?? ""} placeholder="PS №, zayavka № yoki mijoz…" className="h-9 w-full sm:w-64" />
        {tab === "history" && (
          <>
            <Input name="from" type="date" defaultValue={from ? isoDate(from) : ""} className="h-9 w-40" aria-label="Davr boshi" />
            <span className="text-slate-400">—</span>
            <Input name="to" type="date" defaultValue={to ? isoDate(to) : ""} className="h-9 w-40" aria-label="Davr oxiri" />
          </>
        )}
        <Button variant="secondary" className="h-9 text-sm"><Search size={14} /> Qidirish</Button>
        {(q || from || to) && <Link href={tab === "open" ? "/pul-qabul" : `/pul-qabul?tab=${tab}`} className="text-xs text-slate-500 hover:underline">filtrni tozalash</Link>}
      </form>

      <Table>
        <thead>
          <tr>
            <Th>PS №</Th><Th>Zayavka</Th><Th>Mijoz</Th><Th>Usul</Th><Th right>Bosh to&apos;lov</Th><Th right>Tushgan</Th><Th right>Qolgan</Th>
            <Th>Muddat</Th><Th>Holat</Th><Th>Kim ochgan</Th><Th></Th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && <Empty text={`"${tabLabel}" bo'yicha so'rov yo'q`} icon={HandCoins} />}
          {list.map((r) => {
            const isOpenRow = r.id === sp.open;
            const active = r.status === "PENDING" || r.status === "PARTIAL";
            const late = r.overdue ? -daysLeft(r.dueDate) : 0;
            const mayReceive = active && can.includes(r.method);
            return [
              <Tr key={r.id} className={cn(r.overdue && "bg-red-50/60", isOpenRow && !r.overdue && "bg-brand-50/60")}>
                <Td><Link href={isOpenRow ? href(tab) : href(tab, r.id)} className="font-medium hover:underline">{r.docNo}</Link></Td>
                <Td>
                  {canOrders ? <Link href={`/orders/${r.order.id}`} className="font-medium hover:underline">{r.order.orderNo}</Link> : <span className="font-medium">{r.order.orderNo}</span>}
                  <div className="text-xs text-slate-500">{r.order.products || "—"}</div>
                  <div className="text-xs text-slate-500">summa {money(r.order.total)}</div>
                </Td>
                <Td>
                  <div className="text-slate-900">{r.customer.name}</div>
                  {r.customer.phone && <a href={`tel:${r.customer.phone}`} className="text-xs text-slate-500 hover:underline">{r.customer.phone}</a>}
                </Td>
                <Td><MethodBadge method={r.method} /></Td>
                <Td right className="font-medium text-slate-900">{money(r.amount)}</Td>
                <Td right>
                  {money(r.received)}
                  {r.payments.length > 0 && <div className="text-[11px] text-slate-500">{`${r.payments.length} ta to'lov`}</div>}
                </Td>
                <Td right className={cn(r.left > 0 && active && "font-semibold text-slate-900")}>{active ? money(r.left) : "—"}</Td>
                <Td className="whitespace-nowrap">
                  <span className={r.overdue ? "font-semibold text-red-700" : ""}>{date(r.dueDate)}</span>
                  {r.order.deliveryTime && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-slate-700">{r.order.deliveryTime}</span>}
                  {r.overdue
                    ? <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-red-700"><AlarmClock size={12} /> {`muddati o'tgan ${late} kun`}</div>
                    : active ? <div className="mt-0.5 text-[11px] text-slate-500">{dueLabel(r.dueDate)}</div>
                    : r.closedAt ? <div className="mt-0.5 text-[11px] text-slate-500">{`yopildi ${date(r.closedAt)}`}</div> : null}
                </Td>
                <Td><Badge color={PAYREQ_STATUS_COLOR[r.status]}>{PAYREQ_STATUS_LABEL[r.status]}</Badge></Td>
                <Td className="whitespace-nowrap">
                  {r.createdBy}
                  <div className="text-[11px] text-slate-500">{dateTime(r.createdAt)}</div>
                </Td>
                <Td className="whitespace-nowrap">
                  <Link href={isOpenRow ? href(tab) : href(tab, r.id)} className={cn("inline-flex items-center gap-1 text-sm font-medium hover:underline", mayReceive ? "text-slate-900" : "text-slate-500")}>
                    {isOpenRow ? <ChevronUp size={14} /> : mayReceive ? <HandCoins size={14} /> : <ChevronDown size={14} />}
                    {isOpenRow ? "Yopish" : mayReceive ? "Qabul qilish" : "Tarix"}
                  </Link>
                </Td>
              </Tr>,
              isOpenRow && (
                <tr key={`${r.id}-open`} className="bg-slate-50/70">
                  <Td colSpan={COLS}>
                    <div className="grid grid-cols-1 gap-5 font-normal lg:grid-cols-5">
                      <div className="lg:col-span-2">
                        <div className="mb-2 text-[13px] font-semibold text-slate-700">To&apos;lovlar tarixi</div>
                        {r.payments.length === 0 ? <p className="text-sm text-slate-500">Hali to&apos;lov tushmagan</p> : (
                          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                            {r.payments.map((p) => (
                              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 text-sm">
                                <span className="font-medium tabular-nums text-slate-900">{money(p.amount)}</span>
                                <span className="text-xs text-slate-500">{`${date(p.date)} · ${p.account} (${p.accountType === "CASH" ? "naqd" : "bank"})${p.by ? ` · ${p.by}` : ""}`}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="lg:col-span-3">
                        {mayReceive ? (
                          <>
                            <div className="mb-2 text-[13px] font-semibold text-slate-700">{r.method === "CASH" ? `Naqd pulni qabul qilish · ${r.docNo}` : `Perechisleniyeni tasdiqlash · ${r.docNo}`}</div>
                            <ReceiveForm requestId={r.id} method={r.method} left={r.left} accounts={accountsFor(r.method)} />
                          </>
                        ) : active ? (
                          <p className="text-sm text-slate-500">{r.method === "CASH" ? "Naqd pulni Kassa xodimi qabul qiladi." : "Perechisleniyeni Buxgalter tasdiqlaydi."}</p>
                        ) : (
                          <p className="text-sm text-slate-500">{r.status === "RECEIVED" ? "Bosh to'lov to'liq qabul qilingan." : "So'rov bekor qilingan (zayavka bekor)."}</p>
                        )}
                      </div>
                    </div>
                  </Td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </Table>
    </div>
  );
}
