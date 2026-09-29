import Link from "next/link";
import { AlertTriangle, ArrowRight, BadgeCheck, CalendarClock, ClipboardList, Clock, Layers, PackageCheck, ShoppingCart, Truck, Wallet } from "lucide-react";
import { procurementHome, PRIORITY_LABEL, type Priority } from "@/lib/procurement-home";
import { SUPPLY_COLOR, SUPPLY_LABEL, SUPPLY_OWNER } from "@/lib/supply";
import { money, moneyShort, qty, fmtNum, date, pct } from "@/lib/format";
import { Badge, Card, Empty, Progress, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";

const more = (href: string, text: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{text} <ArrowRight size={14} /></Link>
);
const PRIORITY_COLOR: Record<Priority, "red" | "amber" | "slate"> = { critical: "red", high: "amber", normal: "slate" };
const STAGE_TAB: Record<string, string> = { NEW: "NEW", PRICED: "PRICED", APPROVED: "APPROVED", FUNDED: "FUNDED" };

/**
 * Snabjeniye (ta'minot) xodimining bosh sahifasi — "JBI Snabjeniye kabineti" hujjatidagi Dashboard:
 * Pending | Approved | Ordered | Delayed | Bugungi kirim | Received | Critical stock | Monthly procurement,
 * so'ng shoshilinch xaridlar, kechikishlar, kritik qoldiq, oylik xarid summasi va top yetkazuvchilar.
 * Hamma raqam `procurementHome()` dan — UI o'zi hisoblamaydi.
 */
export async function ProcurementHome() {
  const d = await procurementHome();
  const c = d.counts;
  const budgetPct = d.money.budget ? (d.money.spent / d.money.budget) * 100 : null;
  const budgetTone = budgetPct === null ? "default" : budgetPct >= 100 ? "danger" : budgetPct >= 85 ? "warning" : "success";

  return (
    <div className="space-y-8">
      {/* ── Kartochkalar ── */}
      <div data-tour="stats" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Kutilayotgan zayavkalar" value={`${c.pending} ta`} hint={`${c.priceWait} narx kutmoqda · ${c.approveWait} tasdiqda`} icon={ClipboardList} tone={c.priceWait ? "warning" : "default"} href="/snabjeniye?tab=NEW" />
        <StatCard label="Tasdiqlangan" value={`${c.approved} ta`} hint="moliya pul ajratishi kutilmoqda" icon={BadgeCheck} tone="info" href="/snabjeniye?tab=APPROVED" />
        <StatCard label="Buyurtma / yo'lda" value={`${c.ordered} ta`} hint={c.ordered ? `${moneyShort(d.money.ordered)} so'm · qabul kutilmoqda` : "ochiq buyurtma yo'q"} icon={Truck} tone={c.ordered ? "brand" : "default"} href="/snabjeniye?tab=FUNDED" />
        <StatCard label="Kechikmoqda" value={`${c.delayed} ta`} hint="kerak sana o'tib ketgan" icon={Clock} tone={c.delayed ? "danger" : "success"} href="#kechikish" />
        <StatCard label="Bugungi kirim" value={`${c.receivedToday} / ${c.expectedToday + c.receivedToday}`} hint={c.expectedToday ? `${c.expectedToday} ta hali kelmadi` : "qabul qilingan / kutilgan"} icon={CalendarClock} tone={c.expectedToday ? "warning" : "default"} href="#bugun" />
        <StatCard label="Qabul qilindi (oy)" value={`${c.receivedMonth} ta`} hint={`${c.receiptsMonth} kirim hujjati${c.rejectedMonth ? ` · ${c.rejectedMonth} bekor` : ""}`} icon={PackageCheck} tone="success" href="/receipts" />
        <StatCard label="Kritik qoldiq" value={`${c.critical} ta`} hint={c.criticalUnrequested ? `${c.criticalUnrequested} tasi hali so'ralmagan` : c.critical ? "hammasi zayavkada" : "xomashyo yetarli"} icon={AlertTriangle} tone={c.criticalUnrequested ? "danger" : c.critical ? "warning" : "success"} href="#qoldiq" />
        <StatCard label="Oylik xarid" value={`${moneyShort(d.money.spent)} so'm`} hint={d.money.budget ? `byudjet ${moneyShort(d.money.budget)} · ${pct(budgetPct ?? 0, 0)}` : "byudjet belgilanmagan"} icon={Wallet} tone={budgetTone} href="#xarid" />
      </div>

      {/* ── Zanjir: har bosqichda nechta hujjat va kim ushlab turibdi ── */}
      <Section title="Xarid zanjiri" className="mt-0" action={more("/snabjeniye", "Snabjeniye")}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {d.stages.map((s, i) => (
            <Link key={s.status} href={`/snabjeniye?tab=${STAGE_TAB[s.status]}`} className="block">
              <Card className="h-full transition hover:border-slate-300 hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{i + 1}-bosqich</span>
                  <Badge color={SUPPLY_COLOR[s.status]}>{SUPPLY_LABEL[s.status]}</Badge>
                </div>
                <div className="mt-2 text-2xl font-semibold tabular">{s.count}</div>
                <div className="text-sm text-slate-500 tabular">{s.sum > 0 ? money(s.sum) : "—"}</div>
                <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">{SUPPLY_OWNER[s.status]}</div>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Shoshilinch xaridlar ── */}
        <Section title="Shoshilinch xaridlar" className="mt-0" action={more("/snabjeniye", "Hammasi")}>
          <Table>
            <thead><tr><Th>№</Th><Th>Tarkib</Th><Th>Kerak sana</Th><Th>Prioritet</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {d.urgent.length === 0 && <Empty text="Shoshilinch xarid yo'q" icon={ShoppingCart} />}
              {d.urgent.slice(0, 8).map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/taminot/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                  <Td className="max-w-56 text-slate-600"><div className="truncate">{r.what}</div>{r.hasCritical && <div className="text-xs text-red-600">kritik xomashyo</div>}</Td>
                  <Td className={r.late > 0 ? "font-semibold text-red-600" : ""}>{r.needBy ? date(r.needBy) : "—"}</Td>
                  <Td><Badge color={PRIORITY_COLOR[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge></Td>
                  <Td><Badge color={SUPPLY_COLOR[r.status]}>{SUPPLY_LABEL[r.status]}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        {/* ── Kechikayotgan yetkazishlar ── */}
        <div id="kechikish">
          <Section title="Kechikayotgan yetkazishlar" className="mt-0">
            <Table>
              <thead><tr><Th>№</Th><Th>Yetkazuvchi</Th><Th>Kerak edi</Th><Th right>Kechikish</Th><Th>Kim kutmoqda</Th></tr></thead>
              <tbody>
                {d.delayed.length === 0 && <Empty text="Kechikayotgan buyurtma yo'q" icon={Clock} />}
                {d.delayed.slice(0, 8).map((r) => (
                  <Tr key={r.id} className="bg-red-50/40">
                    <Td><Link href={`/taminot/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                    <Td className="text-slate-600">{r.supplier ?? <span className="text-slate-400">tanlanmagan</span>}</Td>
                    <Td>{r.needBy ? date(r.needBy) : "—"}</Td>
                    <Td right className="font-semibold text-red-600">{r.late} kun</Td>
                    <Td className="text-xs text-slate-500">{SUPPLY_OWNER[r.status]}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Kritik qoldiq ── */}
        <div id="qoldiq">
          <Section title="Kritik qoldiq" className="mt-0" action={more("/stock", "Sklad")}>
            <Table>
              <thead><tr><Th>Xomashyo</Th><Th right>Qoldiq</Th><Th className="w-36">Yetadi</Th><Th>Sabab</Th><Th>Zayavka</Th></tr></thead>
              <tbody>
                {d.stock.length === 0 && <Empty text="Hamma xomashyo yetarli" icon={Layers} />}
                {d.stock.slice(0, 10).map((m) => (
                  <Tr key={m.id}>
                    <Td><span className="inline-flex items-center gap-2"><Layers size={14} className="text-slate-400" />{m.name}</span></Td>
                    <Td right>{qty(m.balance)} <span className="text-slate-400">{m.unit}</span></Td>
                    <Td>
                      {m.days === null ? <span className="text-slate-400">—</span> : (
                        <div className="space-y-1">
                          <div className={`text-[13px] font-semibold tabular ${m.level === "critical" ? "text-red-600" : "text-amber-600"}`}>{m.days > 999 ? ">999" : fmtNum(m.days, 1)} kun</div>
                          <Progress value={Math.min(m.days, d.thresholds.warn * 2)} max={d.thresholds.warn * 2} tone={m.level === "critical" ? "danger" : "warning"} />
                        </div>
                      )}
                    </Td>
                    <Td><Badge color={m.level === "critical" ? "red" : "amber"}>{m.reason}</Badge></Td>
                    <Td>{m.requested ? <Badge color="blue">So&apos;ralgan</Badge> : <Link href="/stock/supply/new" className="text-xs font-medium text-red-600 hover:underline">So&apos;rov ochish</Link>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </div>

        {/* ── Bugungi kirim ── */}
        <div id="bugun">
          <Section title="Bugungi kirim" className="mt-0" action={more("/receipts", "Kirimlar")}>
            <Table>
              <thead><tr><Th>№</Th><Th>Yetkazuvchi</Th><Th>Tarkib</Th><Th right>Summa</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {d.expectedToday.length + d.receivedToday.length === 0 && <Empty text="Bugun kirim rejalashtirilmagan" icon={Truck} />}
                {d.expectedToday.map((r) => (
                  <Tr key={r.id}>
                    <Td><Link href={`/taminot/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                    <Td className="text-slate-600">{r.supplier ?? "—"}</Td>
                    <Td className="max-w-48 truncate text-slate-600">{r.what}</Td>
                    <Td right>{money(r.total)}</Td>
                    <Td><Badge color="amber">Kutilmoqda</Badge></Td>
                  </Tr>
                ))}
                {d.receivedToday.map((g) => (
                  <Tr key={g.id}>
                    <Td className="font-medium">{g.docNo}</Td>
                    <Td className="text-slate-600">{g.supplier}</Td>
                    <Td className="max-w-48 truncate text-slate-600">{g.lines}</Td>
                    <Td right>{money(g.total)}</Td>
                    <Td><Badge color="green">Qabul qilindi</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Oylik xarid summasi: reja vs fakt ── */}
        <div id="xarid">
          <Section title="Oylik xarid summasi" className="mt-0" action={more("/cashflow?category=Xomashyo", "Kirim-Chiqim")}>
            <Card>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[13px] text-slate-500">Moliya ajratgan (fakt)</div>
                  <div className="mt-1 text-2xl font-semibold tabular">{money(d.money.spent)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] text-slate-500">Byudjet (reja)</div>
                  <div className="mt-1 text-lg font-semibold tabular text-slate-700">{d.money.budget ? money(d.money.budget) : "—"}</div>
                </div>
              </div>
              {d.money.budget ? (
                <div className="mt-3">
                  <Progress value={Math.min(d.money.spent, d.money.budget)} max={d.money.budget} tone={budgetTone === "default" ? "default" : budgetTone} />
                  <div className="mt-1 text-xs text-slate-500">{pct(budgetPct ?? 0, 0)} ishlatildi · qoldi {money(Math.max(0, d.money.budget - d.money.spent))}</div>
                </div>
              ) : (
                <div className="mt-3 text-xs text-slate-500">&quot;Xomashyo&quot; uchun oylik byudjetni direktor Bosh sahifa → Byudjet bo&apos;limida belgilaydi.</div>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
                <div><dt className="text-xs text-slate-500">Qabul qilingan (fakt summa)</dt><dd className="font-medium tabular">{money(d.money.received)}</dd></div>
                <div><dt className="text-xs text-slate-500">Barcha kirim hujjatlari</dt><dd className="font-medium tabular">{money(d.money.receiptsSum)}</dd></div>
                <div><dt className="text-xs text-slate-500">Yo&apos;ldagi buyurtmalar</dt><dd className="font-medium tabular">{money(d.money.ordered)}</dd></div>
                <div><dt className="text-xs text-slate-500">Kutilayotgan xarajat (tasdiqgacha)</dt><dd className="font-medium tabular">{money(d.money.pipeline)}</dd></div>
              </dl>
            </Card>
          </Section>
        </div>

        {/* ── Top yetkazuvchilar ── */}
        <Section title="Top yetkazuvchilar · 90 kun" className="mt-0" action={more("/suppliers", "Yetkazuvchilar")}>
          <Table>
            <thead><tr><Th>Yetkazuvchi</Th><Th right>Xarid hajmi</Th><Th right>Kirimlar</Th><Th>Oxirgi</Th><Th>Kechikish</Th></tr></thead>
            <tbody>
              {d.topSuppliers.length === 0 && <Empty text="So'nggi 90 kunda kirim yo'q" icon={Truck} />}
              {d.topSuppliers.map((s) => (
                <Tr key={s.id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td right>{money(s.sum)}</Td>
                  <Td right className="text-slate-500">{s.count}</Td>
                  <Td className="text-slate-500">{date(s.last)}</Td>
                  <Td>{s.delayed ? <Badge color="red">{s.delayed} ta</Badge> : <span className="text-slate-400">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      </div>
    </div>
  );
}
