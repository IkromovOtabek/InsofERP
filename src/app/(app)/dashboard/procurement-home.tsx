import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Bell, ClipboardList, ClipboardPlus, Clock, FileBarChart, Filter, Layers, PackageCheck, ShoppingCart, Store, Truck, X,
} from "lucide-react";
import { procurementHome, type AlertTone, type ProcFilters } from "@/lib/procurement-home";
import { SUPPLY_COLOR, SUPPLY_LABEL } from "@/lib/supply";
import { DELIVERY_COLOR, DELIVERY_LABEL, PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, REQUISITION_LABEL } from "@/lib/procurement-const";
import { money, moneyShort, qty, date, pct, isoDate } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, Input, Progress, Section, Select, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { BarChart, HBarList } from "@/components/ui/charts";
import { cn } from "@/lib/utils";

const more = (href: string, text: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{text} <ArrowRight size={14} /></Link>
);
const ALERT_CLS: Record<AlertTone, string> = {
  danger: "border-red-200 bg-red-50/70 text-red-900",
  warning: "border-amber-200 bg-amber-50/70 text-amber-900",
  info: "border-blue-200 bg-blue-50/70 text-blue-900",
};

/**
 * Snabjeniye bosh sahifasi — "Biton Snabjenya Dashboard" TZ 9-bo'lim layouti:
 * filtrlar → 5 KPI → 2 grafik → shoshilinch talablar → yetkazib berish monitoringi →
 * yetkazib beruvchilar va zaxira; o'ngda tezkor amallar va bildirishnomalar (alertlar).
 * Hamma raqam `procurementHome()` dan — UI o'zi hisoblamaydi.
 */
export async function ProcurementHome({ filters = {}, base = "/dashboard" }: { filters?: ProcFilters; base?: string }) {
  const d = await procurementHome(filters);
  const c = d.counts;
  const link = (qs: string) => (qs.startsWith("?") ? `${base}${base.includes("?") ? "&" : "?"}${qs.slice(1)}` : qs);
  const budgetPct = d.money.budget ? (d.money.spent / d.money.budget) * 100 : null;
  const budgetTone = budgetPct === null ? "default" : budgetPct >= 100 ? "danger" : budgetPct >= 85 ? "warning" : "success";
  const view = base.includes("view=procurement");

  return (
    <div className="space-y-6">
      {/* ── Filtrlar (TZ 6) ── */}
      <form method="get" action="/dashboard" className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
        {view && <input type="hidden" name="view" value="procurement" />}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Input type="date" name="from" defaultValue={filters.from ?? ""} title="Sanadan" aria-label="Sanadan" />
          <Input type="date" name="to" defaultValue={filters.to ?? ""} title="Sanagacha" aria-label="Sanagacha" />
          <Select name="dept" defaultValue={filters.dept ?? ""} aria-label="Bo'lim">
            <option value="">Barcha bo&apos;limlar</option>
            {d.options.departments.map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
          <Select name="group" defaultValue={filters.group ?? ""} aria-label="Material turi">
            <option value="">Barcha material turlari</option>
            {d.options.groups.map((g) => <option key={g.id} value={g.id}>{g.parentId ? `· ${g.name}` : g.name}</option>)}
          </Select>
          <Select name="sup" defaultValue={filters.sup ?? ""} aria-label="Yetkazib beruvchi">
            <option value="">Barcha yetkazuvchilar</option>
            {d.options.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select name="pr" defaultValue={filters.pr ?? ""} aria-label="Ustuvorlik">
            <option value="">Har qanday ustuvorlik</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </Select>
          <Select name="st" defaultValue={filters.st ?? ""} aria-label="Status">
            <option value="">Barcha statuslar</option>
            <optgroup label="Talabnoma">
              {(["NEW", "PRICED", "APPROVED", "FUNDED"] as const).map((s) => <option key={s} value={s}>{REQUISITION_LABEL[s]} · {SUPPLY_LABEL[s]}</option>)}
            </optgroup>
            <optgroup label="Yetkazib berish">
              {(["PLANNED", "IN_TRANSIT", "ARRIVED", "RECEIVING", "PROBLEM"] as const).map((s) => <option key={s} value={`d:${s}`}>{DELIVERY_LABEL[s]}</option>)}
            </optgroup>
          </Select>
          <Select name="late" defaultValue={filters.late ?? ""} aria-label="Kechikish">
            <option value="">Kechikkan / kechikmagan</option>
            <option value="1">Faqat kechikkan</option>
            <option value="0">Kechikmagan</option>
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input name="q" defaultValue={filters.q ?? ""} placeholder="Material kodi / nomi, buyurtma raqami, shartnoma" className="min-w-60 flex-1" />
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"><Filter size={15} /> Filtrlash</button>
          {d.filtered && <Link href={base} className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100"><X size={15} /> Tozalash</Link>}
          <span className="ml-auto text-xs text-slate-500">Davr: {date(d.from)} — {date(d.to)}{!d.dated && " (joriy oy)"}</span>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="space-y-6 xl:col-span-3">
          {/* ── 1-qator: KPI ── */}
          <div data-tour="stats" className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
            <StatCard label="Ochiq talablar" value={`${c.open} ta`} hint={`${c.priceWait} narx kutmoqda · ${c.approveWait} tasdiqda`} icon={ClipboardList} tone={c.priceWait ? "warning" : "default"} href="/snabjeniye?tab=open" />
            <StatCard label="Shoshilinch talablar" value={`${c.urgent} ta`} hint={c.critical ? `${c.critical} tasi kritik` : "kritik yo'q"} icon={AlertTriangle} tone={c.critical ? "danger" : c.urgent ? "warning" : "success"} href="#shoshilinch" />
            <StatCard label="Buyurtmalar" value={`${c.orders} ta`} hint={c.orders ? `${moneyShort(d.money.ordered)} so'm` : "ochiq buyurtma yo'q"} icon={ShoppingCart} tone={c.orders ? "brand" : "default"} href="/snabjeniye?tab=FUNDED" />
            <StatCard label="Yo'ldagi yuklar" value={`${c.inTransit} ta`} hint="yetkazish holati: yo'lda" icon={Truck} tone={c.inTransit ? "info" : "default"} href="#yetkazish" />
            <StatCard label="Kechikkanlar" value={`${c.delayed} ta`} hint="kerak sana / ETA o'tgan" icon={Clock} tone={c.delayed ? "danger" : "success"} href={link("?late=1#yetkazish")} />
          </div>

          {/* ── B. Xarid jarayoni ── */}
          <Card padded={false}>
            <div className="grid grid-cols-2 sm:grid-cols-4 2xl:grid-cols-7 2xl:divide-x 2xl:divide-slate-100">
              {d.pipeline.map((s, i) => (
                <Link key={s.key} href={s.href} className="group p-3 transition hover:bg-slate-50">
                  <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400" title={s.label}>{i + 1}. {s.label}</div>
                  <div className={cn("mt-1 text-2xl font-semibold tabular", s.count ? "text-slate-900" : "text-slate-300")}>{s.count}</div>
                  <div className="text-xs text-slate-500">{s.hint}</div>
                </Link>
              ))}
            </div>
          </Card>

          {/* ── 2-qator: grafiklar ── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader icon={Layers} title="Material qoldig'i" description="Qoldiq ehtiyojning necha foizini yopadi (minimal yoki rejadagi sarf)" action={more("#zaxira", "Zaxira")} />
              {d.stockChart.length === 0
                ? <p className="py-6 text-center text-sm text-slate-500">Hamma xomashyo yetarli</p>
                : <HBarList max={100} formatValue={(v) => pct(v, 0)}
                    data={d.stockChart.map((m) => {
                      const need = Math.max(m.minStock, m.planned);
                      const cover = need > 0 ? Math.min(100, (m.balance / need) * 100) : m.days != null ? Math.min(100, (m.days / (d.thresholds.warn * 2)) * 100) : 100;
                      return { label: m.name, value: Math.max(0, cover), tone: m.level === "critical" ? "danger" as const : m.level === "warn" ? "warning" as const : "info" as const,
                        hint: `${qty(m.balance)} / ${qty(need || m.balance)} ${m.unit}` };
                    })} />}
            </Card>
            <Card>
              <CardHeader icon={ShoppingCart} title="Xarid summasi" description={`${d.weekly ? "Haftalik" : "Kunlik"} kirimlar · jami ${money(d.money.purchaseTotal)}`} action={more("/receipts", "Kirimlar")} />
              <BarChart data={d.purchaseBars} formatValue={(v) => money(v)} labelEvery={Math.max(1, Math.ceil(d.purchaseBars.length / 8))} />
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-500">Oylik xarid (moliya ajratgan)</span>
                  <span className="font-semibold tabular">{money(d.money.spent)}{d.money.budget ? <span className="font-normal text-slate-400"> / {moneyShort(d.money.budget)}</span> : null}</span>
                </div>
                {d.money.budget
                  ? <div className="mt-1.5"><Progress value={Math.min(d.money.spent, d.money.budget)} max={d.money.budget} tone={budgetTone === "default" ? "default" : budgetTone} /><div className="mt-1 text-xs text-slate-500">{pct(budgetPct ?? 0, 0)} byudjet ishlatildi</div></div>
                  : <div className="mt-1 text-xs text-slate-500">&quot;Xomashyo&quot; byudjeti belgilanmagan</div>}
              </div>
            </Card>
          </div>

          {/* ── 3-qator: A. Shoshilinch talablar ── */}
          <div id="shoshilinch">
            <Section title="Shoshilinch talablar" className="mt-0" action={more("/snabjeniye?tab=open", "Barcha talablar")}>
              <Table>
                <thead><tr><Th>Talab №</Th><Th>Bo&apos;lim</Th><Th>Material</Th><Th right>Miqdor</Th><Th>Kerak sana</Th><Th>Ustuvorlik</Th><Th>Holat</Th></tr></thead>
                <tbody>
                  {d.urgent.length === 0 && <Empty text="Shoshilinch talab yo'q" icon={ShoppingCart} />}
                  {d.urgent.slice(0, 10).map((r) => (
                    <Tr key={r.id} className={r.priority === "CRITICAL" ? "bg-red-50/40" : undefined}>
                      <Td><Link href={`/taminot/${r.id}`} className="whitespace-nowrap font-medium hover:underline">{r.docNo}</Link>{r.responsible && <div className="text-xs text-slate-400">{r.responsible}</div>}</Td>
                      <Td className="text-slate-600">{r.department}</Td>
                      <Td className="max-w-56 text-slate-700"><div className="truncate">{r.what}</div>{r.hasCritical && <div className="text-xs text-red-600">kritik xomashyo</div>}</Td>
                      <Td right className="whitespace-nowrap tabular">{r.qtyText}</Td>
                      <Td className={r.late > 0 ? "font-semibold text-red-600" : ""}>{r.needBy ? date(r.needBy) : "—"}{r.late > 0 && <div className="text-xs">{r.late} kun o&apos;tdi</div>}</Td>
                      <Td><Badge color={PRIORITY_COLOR[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge></Td>
                      <Td><Badge color={SUPPLY_COLOR[r.status]}>{REQUISITION_LABEL[r.status]}</Badge>{r.waitDirector && <div className="mt-0.5 text-xs text-amber-700">direktor tasdig&apos;i</div>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          </div>

          {/* ── 4-qator: C. Yetkazib berish monitoringi ── */}
          <div id="yetkazish">
            <Section title="Yetkazib berish monitoringi" className="mt-0" action={more("/snabjeniye?tab=FUNDED", "Buyurtmalar")}>
              <Table>
                <thead><tr><Th>Buyurtma №</Th><Th>Yetkazib beruvchi</Th><Th>Transport</Th><Th>Jo&apos;natilgan</Th><Th>ETA</Th><Th>Holat</Th><Th right>Kechikish</Th></tr></thead>
                <tbody>
                  {d.deliveries.length === 0 && <Empty text="Ochiq buyurtma yo'q" icon={Truck} />}
                  {d.deliveries.slice(0, 12).map((r) => (
                    <Tr key={r.id} className={r.late > 0 ? "bg-red-50/40" : undefined}>
                      <Td><Link href={`/taminot/${r.id}`} className="whitespace-nowrap font-medium hover:underline">{r.docNo}</Link><div className="max-w-40 truncate text-xs text-slate-400">{r.what}</div></Td>
                      <Td className="text-slate-600">{r.supplier ?? <span className="text-slate-400">tanlanmagan</span>}</Td>
                      <Td className="max-w-40 truncate text-slate-600">{r.transport ?? "—"}</Td>
                      <Td className="text-slate-600">{r.shippedAt ? date(r.shippedAt) : "—"}</Td>
                      <Td className={r.late > 0 ? "font-semibold text-red-600" : ""}>{r.eta ? date(r.eta) : r.needBy ? <span className="text-slate-400">{date(r.needBy)}</span> : "—"}</Td>
                      <Td>{r.delivery ? <Badge color={DELIVERY_COLOR[r.delivery]}>{DELIVERY_LABEL[r.delivery]}</Badge> : <Badge color="slate">Rejalashtirilgan</Badge>}{r.incidents.length > 0 && <div className="mt-0.5 text-xs text-red-600">{r.incidents.length} muammo</div>}</Td>
                      <Td right className={r.late > 0 ? "font-semibold text-red-600" : "text-slate-400"}>{r.late > 0 ? `${r.late} kun` : "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          </div>

          {/* ── 5-qator: E. Yetkazib beruvchilar va kechikishlar ── */}
          <Section title="Yetkazib beruvchilar va kechikishlar" className="mt-0" action={more("/suppliers", "Yetkazuvchilar")}>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { k: "Faol", v: d.supplierStats.active },
                { k: "Yangi (davrda)", v: d.supplierStats.fresh },
                { k: "Narx takliflari", v: d.supplierStats.quotes },
                { k: "Yetkazishlar", v: d.supplierStats.deliveries },
                { k: "Kechikishlar", v: d.supplierStats.delayed, bad: d.supplierStats.delayed > 0 },
                { k: "Shartnomasiz buyurtma", v: d.supplierStats.noContract, bad: d.supplierStats.noContract > 0, hint: `${d.supplierStats.withContract} tasi shartnomali` },
              ].map((x) => (
                <div key={x.k} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="text-xs text-slate-500">{x.k}</div>
                  <div className={cn("text-lg font-semibold tabular", x.bad && "text-red-600")}>{x.v}</div>
                  {x.hint && <div className="text-[11px] text-slate-400">{x.hint}</div>}
                </div>
              ))}
            </div>
            <Table>
              <thead><tr><Th>Yetkazuvchi</Th><Th right>Xarid (davrda)</Th><Th right>Kirimlar</Th><Th right>Ochiq buyurtma</Th><Th>Oxirgi kirim</Th><Th>Kechikish</Th></tr></thead>
              <tbody>
                {d.supplierRows.length === 0 && <Empty text="Davrda yetkazish yo'q" icon={Store} />}
                {d.supplierRows.map((s) => (
                  <Tr key={s.id}>
                    <Td className="font-medium"><Link href={link(`?sup=${s.id}`)} className="hover:underline">{s.name}</Link></Td>
                    <Td right>{s.sum ? money(s.sum) : "—"}</Td>
                    <Td right className="text-slate-500">{s.count}</Td>
                    <Td right className="text-slate-500">{s.open}</Td>
                    <Td className="text-slate-500">{s.count ? date(s.last) : "—"}</Td>
                    <Td>{s.delayed ? <Badge color="red">{s.delayed} ta</Badge> : <span className="text-slate-400">—</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>

          {/* ── D. Materiallar zaxirasi ── */}
          <div id="zaxira">
            <Section title="Materiallar zaxirasi" className="mt-0" action={more("/stock", "Sklad")}>
              <Table>
                <thead><tr><Th>Material</Th><Th>Birlik</Th><Th right>Joriy qoldiq</Th><Th right>Minimal</Th><Th right>Reja sarf</Th><Th right>Yetishmovchilik</Th><Th>Buyurtma kerakmi?</Th></tr></thead>
                <tbody>
                  {d.stock.length === 0 && <Empty text="Material topilmadi" icon={Layers} />}
                  {d.stock.slice(0, 15).map((m) => (
                    <Tr key={m.id} className={m.level === "critical" ? "bg-red-50/40" : undefined}>
                      <Td><div className="font-medium">{m.name}</div><div className="text-xs text-slate-400">{m.code}{m.level !== "ok" && ` · ${m.reason}`}</div></Td>
                      <Td className="text-slate-500">{m.unit}</Td>
                      <Td right className={m.level === "critical" ? "font-semibold text-red-600" : ""}>{qty(m.balance)}</Td>
                      <Td right className="text-slate-500">{m.minStock ? qty(m.minStock) : "—"}</Td>
                      <Td right className="text-slate-500">{m.planned ? qty(m.planned) : "—"}</Td>
                      <Td right className={m.shortage > 0 ? "font-semibold text-red-600" : "text-slate-400"}>{m.shortage > 0 ? qty(m.shortage) : "—"}</Td>
                      <Td>
                        {!m.orderNeeded ? <span className="text-xs text-slate-400">Yo&apos;q</span>
                          : m.requested ? <Badge color="blue">So&apos;ralgan</Badge>
                          : <Link href="/stock/supply/new" className="text-xs font-semibold text-red-600 hover:underline">Ha — talab ochish</Link>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          </div>
        </div>

        {/* ── Yon panel: tezkor amallar + bildirishnomalar ── */}
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title="Tezkor amallar" />
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
              {[
                { href: "/stock/supply/new", icon: ClipboardPlus, label: "Yangi talab" },
                { href: "/snabjeniye?tab=NEW", icon: ShoppingCart, label: "Xarid yaratish", hint: c.priceWait ? `${c.priceWait} ta narx kutmoqda` : undefined },
                { href: "/suppliers", icon: Store, label: "Yetkazib beruvchi" },
                { href: `/snabjeniye/hisobot${d.dated ? `?from=${isoDate(d.from)}&to=${isoDate(d.to)}` : ""}`, icon: FileBarChart, label: "Hisobot" },
                { href: "/receipts", icon: PackageCheck, label: "Kirimlar" },
              ].map((a) => (
                <Link key={a.href} href={a.href} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-50">
                  <a.icon size={16} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate">{a.label}{a.hint && <span className="block text-xs font-normal text-amber-700">{a.hint}</span>}</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader icon={Bell} title="Bildirishnomalar" description={d.alerts.length ? `${d.alerts.reduce((s, a) => s + a.count, 0)} ta signal` : "Hammasi joyida"} />
            {d.alerts.length === 0 && <p className="text-sm text-emerald-700">Muammo va kechikish yo&apos;q.</p>}
            <div className="space-y-2">
              {d.alerts.map((a) => (
                <div key={a.key} className={cn("rounded-lg border p-3 text-sm", ALERT_CLS[a.tone])}>
                  <Link href={link(a.href)} className="flex items-start justify-between gap-2 font-medium hover:underline">
                    <span>{a.title}</span><span className="shrink-0 tabular">{a.count}</span>
                  </Link>
                  {a.text && <div className="mt-1 text-xs opacity-80">{a.text}</div>}
                  {a.docs.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {a.docs.map((x) => <Link key={x.id} href={`/taminot/${x.id}`} className="rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium hover:bg-white">{x.docNo}</Link>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {d.limit > 0 && <p className="px-1 text-xs text-slate-500">{money(d.limit)} dan katta xarid avval direktor tasdig&apos;idan o&apos;tadi (Sozlamalar).</p>}
        </aside>
      </div>
    </div>
  );
}

