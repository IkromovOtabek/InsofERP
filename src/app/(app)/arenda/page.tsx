import Link from "next/link";
import { ChevronLeft, ChevronRight, Landmark, Pencil, Store, Undo2, Wallet, Banknote, FileSpreadsheet, MessageCircle, Printer, Send, Users, CircleCheck, CircleDashed, AlertTriangle, CalendarClock, ListFilter, BarChart3, Ruler, TrendingDown, FileClock, Zap } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, fmtNum, isoDate, money } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { getCompany } from "@/lib/company";
import { rentDebtors } from "@/lib/rent-tenant";
import { RemindDayForm } from "./tenant-forms";
import { BulkPriceForm, KwhPriceForm, LessorForm } from "./contract-forms";
import { getRentLessor } from "@/lib/rent-lessor";
import { ElecBill, ElecRow } from "./elec-forms";
import { elecSheet } from "@/lib/rent-elec";
import { LEASE_SOON_DAYS, leaseDaysLeft, leaseTerm, rentCollection, rentOccupancy } from "@/lib/rent-contract";
import {
  RENT_EXPENSE_CATEGORIES, RENT_METHOD_LABEL, RENT_PAY_STATUS_LABEL, RENT_SHOP_STATUS, currentMonth, rentPerM2, rentShopStates, type RentPayStatus, monthKey, monthLabel, monthRange, monthSheet, parseMonth, rentBalance, shiftMonth,
} from "@/lib/rent";
import { Badge, type BadgeColor, Callout, Card, CardHeader, EmptyState, LinkButton, PageHeader, Progress, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "../payments/confirm-button";
import { ExcelButton } from "../logistika/excel-button";
import { ChargeRow, RentTxPanel, ShopForm } from "./arenda-forms";
import { openRentMonth, sendRentReminderNow, stornoRentTx, toggleRentShop } from "./actions";

const cell = (v: number) => (Math.abs(v) < 0.005 ? "–" : fmtNum(v));

/**
 * Arenda — do'konlar ijarasi (sekretar ish joyi). Tepada arenda kassasining umumiy summasi, uning ostida
 * «Kirim» / «Chiqim» tugmalari; pastda Excel'dagi oy varag'i (bozor bo'yicha guruhlangan), jurnal va do'konlar.
 */
export default async function ArendaPage({ searchParams }: { searchParams: Promise<{ oy?: string; tab?: string; edit?: string; import?: string; holat?: string }> }) {
  const s = await requirePage("/arenda");
  const sp = await searchParams;
  const now = currentMonth();
  const month = parseMonth(sp.oy) ?? now;
  const key = monthKey(month);
  const tab = sp.tab === "jurnal" || sp.tab === "dokonlar" || sp.tab === "qarzdorlar" || sp.tab === "filter" || sp.tab === "tahlil" || sp.tab === "svet" ? sp.tab : "jadval";
  const canCreate = canDo(s, "arenda", "create");
  const canShops = canDo(s, "arenda", "shops");
  const canStorno = canDo(s, "arenda", "storno");

  const [balance, sheet, shops] = await Promise.all([
    rentBalance(),
    monthSheet(month),
    db.rentShop.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
  ]);
  const activeShops = shops.filter((x) => x.isActive);
  // Kirim formasidagi «Qaysi oy uchun»: tanlangan oy atrofida 12 oy orqaga va 2 oy oldinga
  const months = Array.from({ length: 15 }, (_, i) => shiftMonth(now, 2 - i)).map((m) => ({ key: monthKey(m), label: monthLabel(m) }));
  if (!months.some((m) => m.key === key)) months.push({ key, label: monthLabel(month) });
  const holat = parseShopFilter(sp.holat);
  const href = (p: { oy?: string; tab?: string; edit?: string; holat?: string }) => {
    const q = new URLSearchParams({ oy: p.oy ?? key, ...(p.tab ?? tab) !== "jadval" ? { tab: p.tab ?? tab } : {}, ...(p.edit ? { edit: p.edit } : {}), ...(p.holat ? { holat: p.holat } : {}) });
    return `/arenda?${q}`;
  };
  const t = sheet.total;
  // Importdan qaytilganda: "do'konlar-yangi-to'lovlar-bekor-o'tkazilgan"
  const im = /^(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/.exec(sp.import ?? "");
  const imported = im ? { shops: +im[1], newShops: +im[2], payments: +im[3], replaced: +im[4], skipped: +im[5] } : null;

  return (
    <div>
      <PageHeader title="Arenda" subtitle="Do'konlar ijarasi: oylik hisob, ijarachilardan tushgan pul va arenda kassasi kirim-chiqimi."
        action={canShops ? <LinkButton href="/arenda/import" variant="secondary"><FileSpreadsheet size={16} /> Excel&apos;dan import</LinkButton> : undefined} />
      {imported && (
        <Callout tone="success" title={`${monthLabel(month)} varag'i import qilindi`}>
          {imported.shops} ta do&apos;kon hisobi yozildi{imported.newShops ? `, ${imported.newShops} ta yangi do'kon qo'shildi` : ""}
          {imported.payments ? `, ${imported.payments} ta to'lov kirim qilindi` : ""}
          {imported.replaced ? `, ${imported.replaced} ta eski import kirimi summa o'zgargani uchun bekor qilindi` : ""}
          {imported.skipped ? `. O'tkazib yuborilgan qatorlar («Общий», «Буш», izohlar): ${imported.skipped}` : ""}.
        </Callout>
      )}

      {/* Umumiy summa — Kirim/Chiqim tugmalari tepasida */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Arenda kassasi — umumiy summa" value={money(balance.total)} icon={Wallet} tone={balance.total < 0 ? "danger" : "success"} hint="Barcha kirimlar − chiqimlar (bekor qilinganlar hisobga kirmaydi)" />
        <StatCard label="Naqd" value={money(balance.cash)} icon={Banknote} />
        <StatCard label="Perechisleniye" value={money(balance.bank)} icon={Landmark} />
      </div>
      <RentTxPanel shops={activeShops.map((x) => ({ id: x.id, name: x.name, location: x.location, daily: x.period === "DAILY" }))} month={key} months={months} expenseCats={RENT_EXPENSE_CATEGORIES} canCreate={canCreate} />

      {/* Oy almashtirgich */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-xs">
          <Link href={href({ oy: monthKey(shiftMonth(month, -1)) })} aria-label="O'tgan oy" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ChevronLeft size={18} /></Link>
          <span className="min-w-40 px-2 text-center text-base font-semibold text-slate-900">{monthLabel(month)}</span>
          <Link href={href({ oy: monthKey(shiftMonth(month, 1)) })} aria-label="Keyingi oy" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ChevronRight size={18} /></Link>
          {key !== monthKey(now) && <Link href={href({ oy: monthKey(now) })} className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Joriy oy</Link>}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-900">To&apos;lashi kerak: <b className="tabular-nums">{money(t.due)}</b></span>
          <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-900">Tushgan: <b className="tabular-nums">{money(t.paid)}</b></span>
          <span className={`rounded-lg px-3 py-1.5 ${t.left > 0.005 ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"}`}>Qoldiq: <b className="tabular-nums">{money(t.left)}</b></span>
        </div>
      </div>

      <Tabs current={tab} className="mb-4" items={[
        { key: "jadval", label: "Oylik jadval", href: href({ tab: "jadval" }) },
        { key: "svet", label: "Svet", href: href({ tab: "svet" }), icon: Zap },
        { key: "jurnal", label: "Kirim-chiqim jurnali", href: href({ tab: "jurnal" }) },
        { key: "qarzdorlar", label: "Qarzdorlar", href: href({ tab: "qarzdorlar" }) },
        { key: "dokonlar", label: "Do'konlar", href: href({ tab: "dokonlar" }), count: shops.length },
        { key: "filter", label: "Filter", href: href({ tab: "filter" }), icon: ListFilter },
        { key: "tahlil", label: "Tahlil", href: href({ tab: "tahlil" }), icon: BarChart3 },
      ]} />

      {tab === "jadval" && <SheetTab sheet={sheet} month={key} monthName={monthLabel(month)} canShops={canShops} hasShops={shops.length > 0} shopsHref={href({ tab: "dokonlar" })} />}
      {tab === "svet" && <ElecTab month={month} monthName={monthLabel(month)} canShops={canShops} shopsHref={href({ tab: "dokonlar" })} />}
      {tab === "jurnal" && <JournalTab month={month} canStorno={canStorno} />}
      {tab === "qarzdorlar" && <DebtorsTab canShops={canShops} canCreate={canCreate} />}
      {tab === "dokonlar" && <ShopsTab mode="dokonlar" shops={shops} month={key} editId={sp.edit} canShops={canShops} href={href} />}
      {tab === "filter" && <ShopsTab mode="filter" shops={shops} month={key} holat={holat} canShops={canShops} href={href} />}
      {tab === "tahlil" && <AnalyticsTab />}
    </div>
  );
}

/* ───────────────────────── Oy varag'i (Excel ko'rinishi) ───────────────────────── */

function SheetTab({ sheet, month, monthName, canShops, hasShops, shopsHref }: {
  sheet: Awaited<ReturnType<typeof monthSheet>>; month: string; monthName: string; canShops: boolean; hasShops: boolean; shopsHref: string;
}) {
  if (!hasShops) {
    return <EmptyState icon={Store} title="Hali do'kon kiritilmagan" text="Avval «Do'konlar» bo'limida ijaraga berilgan do'konlarni joyi (bozor) bilan kiriting — keyin oylik jadval shu yerda chiqadi." action={canShops ? <Link href={shopsHref} className="text-sm font-medium text-brand-700 hover:underline">Do&apos;kon qo&apos;shish →</Link> : undefined} />;
  }
  const head = ["Do'konlar nomi", "Perechisleniye summasi", "Naqd to'lovi", "Jami to'lashi kerak", "Svet", "Biz to'laydigan soliq", "Perechisleniye o'tgan", "Naqd bergan", "Jami tushgan", "Qoldiq", "Izoh"];
  const excelRows = sheet.groups.flatMap((g) => [
    ...g.rows.map((r) => ({
      "Joy": g.location, [head[0]]: r.name, [head[1]]: r.bankDue, [head[2]]: r.cashDue, [head[3]]: r.due, [head[4]]: r.electricity, [head[5]]: r.tax,
      [head[6]]: r.bankPaid, [head[7]]: r.cashPaid, [head[8]]: r.paid, [head[9]]: r.left, [head[10]]: r.note,
    })),
    { "Joy": g.location, [head[0]]: "Umumiy", [head[1]]: g.total.bankDue, [head[2]]: g.total.cashDue, [head[3]]: g.total.due, [head[4]]: g.total.electricity, [head[5]]: g.total.tax, [head[6]]: g.total.bankPaid, [head[7]]: g.total.cashPaid, [head[8]]: g.total.paid, [head[9]]: g.total.left, [head[10]]: null },
  ]);
  const sumCells = (x: typeof sheet.total) => [x.bankDue, x.cashDue, x.due, x.electricity, x.tax, x.bankPaid, x.cashPaid, x.paid, x.left];
  // Oy o'rtasida ijarachi almashgan do'kon ikki qatorda — ijarachi nomi ko'rsatiladi
  const rowsAll = sheet.groups.flatMap((g) => g.rows);
  const twice = new Set(rowsAll.filter((r, i) => rowsAll.findIndex((x) => x.shopId === r.shopId) !== i).map((r) => r.shopId));

  return (
    <div className="space-y-3">
      {!sheet.opened && (
        <Callout tone="warning" title={`${monthName} hisobi hali ochilmagan`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Oy ochilganda har bir faol do&apos;konga o&apos;tgan oydagi summalar (bo&apos;lmasa do&apos;kon andozasi) ko&apos;chiriladi. Keyin qatorni qalam bilan tahrirlash mumkin.</span>
            {canShops && <ActionButton action={openRentMonth.bind(null, month)}>Oyni ochish</ActionButton>}
          </div>
        </Callout>
      )}
      {sheet.groups.length > 0 && (
        <>
          <div className="flex justify-end"><ExcelButton file={`Arenda ${monthName}`} sheets={[{ name: monthName, rows: excelRows }]} /></div>
          <Sheet lang="uz" maxHeight="75vh">
            <SheetHead>
              <tr>
                {head.map((h, i) => <SheetTh key={h} tone={i === 3 ? "yellow" : i >= 6 && i <= 8 ? "green" : i === 9 ? "red" : "plain"} className={i === 0 ? "sticky left-0 z-20 min-w-60 text-left" : "whitespace-normal"}>{h}</SheetTh>)}
              </tr>
            </SheetHead>
            {sheet.groups.map((g) => (
              <tbody key={g.location}>
                <tr><SheetTd colSpan={11} tone="blue" className="py-2 text-base font-semibold text-slate-900"><span className="sticky left-2.5">{g.location}</span></SheetTd></tr>
                {g.rows.map((r) => <ChargeRow key={r.leaseId} row={r} month={month} canEdit={canShops} showTenant={twice.has(r.shopId)} />)}
                <tr>
                  <SheetTd tone="gray" strong className="sticky left-0 z-[1] text-center">Umumiy</SheetTd>
                  {sumCells(g.total).map((v, i) => <SheetTd key={i} right tone="gray" strong className={i === 8 && v > 0.005 ? "text-red-700" : undefined}>{cell(v)}</SheetTd>)}
                  <SheetTd tone="gray" />
                </tr>
              </tbody>
            ))}
            {sheet.groups.length > 1 && (
              <SheetFoot>
                <tr>
                  <SheetTd className="sticky left-0 z-[1] text-center">Jami ({sheet.groups.length} joy)</SheetTd>
                  {sumCells(sheet.total).map((v, i) => <SheetTd key={i} right>{cell(v)}</SheetTd>)}
                  <SheetTd />
                </tr>
              </SheetFoot>
            )}
          </Sheet>
          <p className="text-xs text-slate-500">Qoldiq = jami to&apos;lashi kerak − jami tushgan (qizil — qarz, yashil — ortiqcha to&apos;langan). Svet hisobidagi do&apos;konlar sveti alohida — «Svet» varag&apos;ida, soliq — ma&apos;lumot uchun. «Tushgan» — shu oy uchun yozilgan ijara kirimlari.</p>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Kirim-chiqim jurnali ───────────────────────── */

async function JournalTab({ month, canStorno }: { month: Date; canStorno: boolean }) {
  const txs = await db.rentTx.findMany({
    where: { date: monthRange(month) },
    include: { shop: { select: { name: true, location: true } }, createdBy: { select: { fullName: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const live = txs.filter((x) => !x.cancelledAt);
  const inc = live.filter((x) => x.type === "INCOME").reduce((a, x) => a + Number(x.amount), 0);
  const exp = live.filter((x) => x.type === "EXPENSE").reduce((a, x) => a + Number(x.amount), 0);
  return (
    <Card padded={false}>
      <div className="p-4 pb-2">
        <CardHeader title="Kirim-chiqim jurnali" description={`Shu oy sanasi bilan yozilgan yozuvlar: kirim ${money(inc)}, chiqim ${money(exp)}. Xato yozuv o'chirilmaydi — sabab bilan bekor qilinadi.`} />
      </div>
      {txs.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">Bu oyda kirim-chiqim yo&apos;q</div> : (
        <Table>
          <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Do&apos;kon / maqsad</Th><Th>Usul</Th><Th right>Summa</Th><Th>Izoh</Th><Th>Kiritdi</Th><Th></Th></tr></thead>
          <tbody>
            {txs.map((x) => {
              const off = !!x.cancelledAt;
              return (
                <Tr key={x.id} className={off ? "opacity-55" : undefined}>
                  <Td className="whitespace-nowrap">{date(x.date)}</Td>
                  <Td>{off ? <Badge color="slate">bekor qilingan</Badge> : x.type === "INCOME" ? <Badge color="green">Kirim</Badge> : <Badge color="red">Chiqim</Badge>}</Td>
                  <Td className={off ? "line-through" : undefined}>
                    {x.shop ? <><span className="font-medium text-slate-800">{x.shop.name}</span> <span className="text-xs text-slate-500">· {x.shop.location}</span></> : null}
                    <span className="block text-xs text-slate-500">{x.category}{x.day ? ` · ${date(x.day)} kun uchun` : x.month ? ` · ${monthLabel(x.month)} uchun` : ""}</span>
                  </Td>
                  <Td>{RENT_METHOD_LABEL[x.method]}</Td>
                  <Td right className={`font-semibold tabular-nums ${off ? "line-through" : x.type === "INCOME" ? "text-emerald-700" : "text-red-600"}`}>{x.type === "INCOME" ? "+" : "−"}{fmtNum(Number(x.amount))}</Td>
                  <Td className="max-w-64 whitespace-normal text-xs text-slate-600">{x.note}{off && <span className="block text-slate-500">Bekor qilish sababi: {x.cancelReason}</span>}</Td>
                  <Td className="text-xs text-slate-500">{x.createdBy.fullName}</Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      {x.type === "INCOME" && x.shop && <Link href={`/arenda/kvitansiya/${x.id}`} title="Kvitansiyani chop etish" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><Printer size={13} /> Kvitansiya</Link>}
                      {canStorno && !off && <ConfirmButton action={stornoRentTx.bind(null, x.id)} label={<><Undo2 size={13} className="mr-1 inline" />Bekor qilish</>} question="Bekor qilinsinmi?" reason="required" okText="Bekor qilindi" className="text-xs text-slate-500 hover:text-red-600" />}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/* ───────────────────────── Qarzdorlar ───────────────────────── */

/** Qarzi bor ijarachilar: qaysi oylar to'lanmagan, Telegram ulanganmi, oxirgi eslatma — va eslatma yuborish. */
async function DebtorsTab({ canShops, canCreate }: { canShops: boolean; canCreate: boolean }) {
  const [debtors, company] = await Promise.all([rentDebtors(), getCompany()]);
  const total = debtors.reduce((s, d) => s + Math.max(0, d.debt), 0);
  const elecTotal = debtors.reduce((s, d) => s + Math.max(0, d.elecDebt), 0);
  const notLinked = debtors.filter((d) => !d.linked && !d.former).length;
  const former = debtors.filter((d) => d.former);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Qarzdor ijarachilar" value={debtors.length} icon={Users} tone={debtors.length ? "danger" : "success"} />
        <StatCard label="Jami ijara qarzi" value={money(total)} icon={Wallet} tone={total > 1 ? "danger" : "success"} hint={elecTotal > 1 ? `svet qarzi alohida: ${money(elecTotal)}` : undefined} />
        <StatCard label="Telegram'ga ulanmagan" value={notLinked} icon={MessageCircle} hint={former.length ? `sobiq ijarachilar: ${former.length} ta, qarzi ${money(former.reduce((a, d) => a + d.debt, 0))}` : "ularga eslatmani kartadan nusxalab yuborasiz"} />
      </div>
      {canShops && <Card><RemindDayForm day={company.rentRemindDay} /></Card>}
      {debtors.length === 0 ? <EmptyState icon={Store} title="Qarzdor yo'q" text="Barcha ijarachilar hisobini to'lagan." /> : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Do&apos;kon</Th><Th>Ijarachi</Th><Th>To&apos;lanmagan oylar</Th><Th right>Ijara qarzi</Th><Th right>Svet qarzi</Th><Th>Oxirgi to&apos;lov</Th><Th>Telegram</Th><Th>Oxirgi eslatma</Th><Th></Th></tr></thead>
            <tbody>
              {debtors.map((d) => (
                <Tr key={d.leaseId} className={d.former ? "bg-slate-50/70" : undefined}>
                  <Td><Link href={`/arenda/dokon/${d.id}`} className="font-medium text-slate-800 hover:underline">{d.name}</Link><span className="block text-xs text-slate-500">{d.location}</span>{d.former && <Badge color="slate">sobiq ijarachi{d.endedAt ? ` · ${date(d.endedAt)} gacha` : ""}</Badge>}</Td>
                  <Td className="text-sm">{d.tenantName ?? <span className="text-slate-400">—</span>}{d.phone && <a href={`tel:${d.phone}`} className="block text-xs text-brand-700 hover:underline">{formatPhone(d.phone)}</a>}</Td>
                  <Td className="text-xs">{d.unpaid.length ? <>{d.unpaid.length} oy<span className="block text-slate-500">{d.unpaid.slice(0, 3).map((m) => m.label).join(", ")}{d.unpaid.length > 3 ? "…" : ""}</span></> : <span className="text-slate-500">oldingi qoldiq</span>}</Td>
                  <Td right className={d.debt > 1 ? "font-semibold text-red-600" : "text-slate-400"}>{d.debt > 1 ? fmtNum(d.debt) : "–"}</Td>
                  <Td right className={d.elecDebt > 1 ? "font-semibold text-amber-700" : "text-slate-400"}>{d.elecDebt > 1 ? fmtNum(d.elecDebt) : "–"}</Td>
                  <Td className="text-xs text-slate-600">{d.lastPaidAt ? date(d.lastPaidAt) : "—"}</Td>
                  <Td>{d.former ? <span className="text-xs text-slate-400">—</span> : d.linked ? <Badge color="green">ulangan</Badge> : <Badge color="slate">yo&apos;q</Badge>}</Td>
                  <Td className="text-xs text-slate-600">{d.lastReminder ? <>{date(d.lastReminder.at)}{!d.lastReminder.ok && <span className="block text-red-600">yetmadi</span>}</> : "—"}</Td>
                  <Td>
                    {d.former
                      ? <Link href={`/arenda/dokon/${d.id}#oldingi`} className="text-xs font-medium text-brand-700 hover:underline">To&apos;lov qabul qilish</Link>
                      : d.linked && canCreate
                        ? <ActionButton action={sendRentReminderNow.bind(null, d.id)} variant="secondary" className="h-8 px-3 text-xs"><Send size={13} /> Eslatma</ActionButton>
                        : <Link href={`/arenda/dokon/${d.id}`} className="text-xs font-medium text-brand-700 hover:underline">Matn / QR</Link>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────── Do'konlar ───────────────────────── */

type Shop = Awaited<ReturnType<typeof db.rentShop.findMany>>[number];

/** Do'konlar ro'yxati filtrlari (`?holat=`): to'lov holati, ijara turi va to'liq kiritilmagan ma'lumot. */
const SHOP_FILTERS = ["muddat", "bugun", "kutilmoqda", "tolagan", "ijarada", "bosh", "kunlik", "toliqemas", "tugayapti", "tugagan"] as const;
type ShopFilter = (typeof SHOP_FILTERS)[number];
const parseShopFilter = (v?: string): ShopFilter | undefined => (SHOP_FILTERS as readonly string[]).includes(v ?? "") ? (v as ShopFilter) : undefined;

const STATUS_BADGE: Record<RentPayStatus, BadgeColor> = { VACANT: "slate", OVERDUE: "red", TODAY: "amber", PAID: "green", WAITING: "blue" };

/**
 * «Do'konlar» (`mode="dokonlar"`) — qo'shish/tahrirlash formasi, bozorlar bandligi va to'liq ro'yxat;
 * «Filter» (`mode="filter"`) — to'lov holati kartalari, filtrlar va saralangan ro'yxat.
 */
async function ShopsTab({ mode, shops: all, month, editId, holat: holatParam, canShops, href }: {
  mode: "dokonlar" | "filter"; shops: Shop[]; month: string; editId?: string; holat?: ShopFilter; canShops: boolean; href: (p: { tab?: string; edit?: string; holat?: string }) => string;
}) {
  const [states, leases, lessor] = await Promise.all([
    rentShopStates(all),
    db.rentLease.findMany({ where: { status: "ACTIVE", shopId: { in: all.map((x) => x.id) } } }),
    getRentLessor(),
  ]);
  const leaseOf = new Map(leases.map((l) => [l.shopId, l]));
  const term = (x: Shop) => leaseTerm(leaseOf.get(x.id)?.endDate);
  const isFilter = mode === "filter", holat = isFilter ? holatParam : undefined;
  const st = (x: Shop) => states.get(x.id)!;
  const editing = editId ? all.find((x) => x.id === editId) : undefined;
  const locations = [...new Set(all.map((x) => x.location))];
  // Joy bo'yicha: jami / ijarada / bo'sh — qaysi bozorda nechta joyga ijarachi qo'yish kerak
  const byLoc = locations.map((l) => {
    const xs = all.filter((x) => x.location === l);
    const on = xs.filter((x) => x.isActive).length;
    const m2 = (ys: Shop[]) => ys.reduce((s, x) => s + Number(x.area ?? 0), 0);
    return { location: l, total: xs.length, on, off: xs.length - on, area: m2(xs), offArea: m2(xs.filter((x) => !x.isActive)) };
  });
  const hasArea = all.some((x) => x.area);
  // Ijaradagi joyda telefon va (oylikda) to'lov kuni bo'lishi shart — yo'qlari «To'liq emas» filtrida
  const incomplete = (x: Shop) => x.isActive && (!x.phone || (x.period === "MONTHLY" && !x.payDay));
  const test: Record<ShopFilter, (x: Shop) => boolean> = {
    muddat: (x) => st(x).status === "OVERDUE", bugun: (x) => st(x).status === "TODAY", kutilmoqda: (x) => st(x).status === "WAITING",
    tolagan: (x) => st(x).status === "PAID", ijarada: (x) => x.isActive, bosh: (x) => !x.isActive,
    kunlik: (x) => x.period === "DAILY", toliqemas: incomplete,
    tugayapti: (x) => x.isActive && term(x) === "soon", tugagan: (x) => x.isActive && term(x) === "expired",
  };
  const count = (f: ShopFilter) => all.filter(test[f]).length;
  const overdueSum = all.reduce((s, x) => s + st(x).overdue, 0);
  const todaySum = all.filter(test.bugun).reduce((s, x) => s + (x.period === "DAILY" ? Number(x.bankAmount) + Number(x.cashAmount) : st(x).monthLeft), 0);
  // Saralash: muddati o'tganlar — qarz kattasidan; qolganlari — joy (bozor), ichida avval bo'sh joylar
  const shops = all.filter(holat ? test[holat] : () => true).sort((a, b) => holat === "muddat"
    ? st(b).overdue - st(a).overdue
    : locations.indexOf(a.location) - locations.indexOf(b.location) || Number(a.isActive) - Number(b.isActive));
  const plain = (x: Shop) => {
    const l = leaseOf.get(x.id);
    return {
      id: x.id, name: x.name, location: x.location, period: x.period, payDay: x.payDay, area: x.area ? Number(x.area) : null, bankAmount: Number(x.bankAmount), cashAmount: Number(x.cashAmount),
      electricity: Number(x.electricity), electricityBilled: x.electricityBilled, elecFixed: Number(x.elecFixed), tax: Number(x.tax), note: x.note, tenantName: x.tenantName, phone: x.phone, inn: x.inn,
      address: x.address, cadastre: x.cadastre,
      lease: l ? {
        no: l.no, startDate: isoDate(l.startDate), endDate: l.endDate ? isoDate(l.endDate) : null, deposit: Number(l.deposit),
        tenantRep: l.tenantRep, tenantAddress: l.tenantAddress, tenantAccount: l.tenantAccount, tenantMfo: l.tenantMfo,
      } : null,
    };
  };
  // Narx o'zgarishi: joriy oydan keyingi 12 oy
  const priceMonths = Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth(), i + 1)).map((m) => ({ key: monthKey(m), label: monthLabel(m) }));
  const endCell = (x: Shop) => {
    const l = leaseOf.get(x.id);
    if (!l?.endDate) return null;
    const d = leaseDaysLeft(l.endDate)!;
    return <span className={`block text-xs ${d < 0 ? "font-medium text-red-600" : d <= LEASE_SOON_DAYS ? "font-medium text-amber-700" : "text-slate-500"}`}>shartnoma {date(l.endDate)} gacha{d < 0 ? " · tugagan" : d <= LEASE_SOON_DAYS ? ` · ${d} kun qoldi` : ""}</span>;
  };
  const f = (k: ShopFilter, label: string) => ({ key: k, label, href: href({ tab: "filter", holat: k }), count: count(k) });
  return (
    <div className="space-y-4">
      {!isFilter && canShops && (
        <Card>
          <CardHeader title={editing ? `Tahrirlash: ${editing.name}` : "Yangi do'kon"} description="Summalar — andoza: yangi oy ochilganda o'tgan oy hisobi bo'lmasa shu qiymatlar olinadi (kunlikda — kunlik summa × kunlar). Shu oy ochilgan bo'lsa yangi do'kon unga ham qo'shiladi."
            action={editing ? <Link href={href({ tab: "dokonlar" })} className="text-sm text-slate-500 hover:text-slate-900">Bekor qilish</Link> : undefined} />
          <ShopForm key={editing?.id ?? "new"} shop={editing ? plain(editing) : undefined} locations={locations} month={month} onDoneHref={href({ tab: "dokonlar" })} />
        </Card>
      )}
      {!isFilter && canShops && !editing && (
        <Card>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Ijaraga beruvchi rekvizitlari (shartnoma uchun)</summary>
            <p className="mt-1 text-xs text-slate-500">Ijara shartnomasi va dalolatnomalarda «Арендодатель / Ijaraga beruvchi» sifatida chiqadi. Bo&apos;sh maydon korxona rekvizitlaridan olinadi.</p>
            <div className="mt-3"><LessorForm lessor={lessor} /></div>
          </details>
        </Card>
      )}
      {!isFilter && canShops && !editing && locations.length > 0 && (
        <Card>
          <CardHeader title="Bozor bo'yicha narx o'zgarishi" description="Tanlangan joydagi ijaradagi har do'konning narxi tanlangan oydan boshlab % ga o'zgaradi (1000 so'mga yaxlitlanadi). Oy hisobi ochilganda qo'llanadi; bitta do'kon narxi — do'kon kartasida." />
          <BulkPriceForm locations={locations} months={priceMonths} />
        </Card>
      )}
      {all.length > 0 && (
        <>
          {isFilter && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Muddati o'tgan" value={count("muddat")} icon={AlertTriangle} tone={count("muddat") ? "danger" : "success"} hint={overdueSum > 0.005 ? `qarz ${money(overdueSum)}` : "muddati o'tgan qarz yo'q"} href={href({ tab: "filter", holat: "muddat" })} />
            <StatCard label="Bugun to'lov kuni" value={count("bugun")} icon={CalendarClock} tone={count("bugun") ? "warning" : "default"} hint={todaySum > 0.005 ? `kutilmoqda ${money(todaySum)}` : undefined} href={href({ tab: "filter", holat: "bugun" })} />
            <StatCard label="To'laganlar" value={count("tolagan")} icon={CircleCheck} tone="success" hint={`ijarada ${count("ijarada")} ta joydan`} href={href({ tab: "filter", holat: "tolagan" })} />
            <StatCard label="Bo'sh — ijarachi kerak" value={count("bosh")} icon={CircleDashed} tone={count("bosh") ? "warning" : "success"} hint={`jami ${all.length} ta joy`} href={href({ tab: "filter", holat: "bosh" })} />
          </div>}
          {count("tugagan") + count("tugayapti") > 0 && (
            <Callout tone={count("tugagan") ? "danger" : "warning"} title={`Ijara shartnomasi: ${count("tugagan") ? `${count("tugagan")} tasining muddati tugagan` : ""}${count("tugagan") && count("tugayapti") ? ", " : ""}${count("tugayapti") ? `${count("tugayapti")} tasi ${LEASE_SOON_DAYS} kun ichida tugaydi` : ""}`}>
              Shartnomani uzaytiring (do&apos;kon kartasida tugash sanasini o&apos;zgartiring) yoki joyni bo&apos;shatishni rejalashtiring.{" "}
              <Link href={href({ tab: "filter", holat: count("tugagan") ? "tugagan" : "tugayapti" })} className="font-medium underline">Ro&apos;yxatni ochish →</Link>
            </Callout>
          )}
          {count("toliqemas") > 0 && (
            <Callout tone="warning" title={`${count("toliqemas")} ta ijaradagi joyda telefon yoki to'lov kuni kiritilmagan`}>
              Ularsiz «Bugun» va «Muddati o&apos;tgan» to&apos;g&apos;ri chiqmaydi (to&apos;lov kuni bo&apos;lmasa — oy oxiri olinadi). <Link href={href({ tab: "filter", holat: "toliqemas" })} className="font-medium underline">Ro&apos;yxatni ochish →</Link>
            </Callout>
          )}
          {!isFilter && byLoc.length > 1 && (
            <Card padded={false}>
              <Table>
                <thead><tr><Th>Joy (bozor)</Th><Th right>Jami</Th><Th right>Ijarada</Th><Th right>Bo&apos;sh</Th>{hasArea && <Th right>Maydon, m²</Th>}<Th>Bandlik</Th></tr></thead>
                <tbody>
                  {byLoc.map((g) => (
                    <Tr key={g.location}>
                      <Td className="font-medium text-slate-800">{g.location}</Td>
                      <Td right>{g.total}</Td>
                      <Td right className="text-emerald-700">{g.on}</Td>
                      <Td right className={g.off ? "font-semibold text-amber-700" : "text-slate-400"}>{g.off || "–"}</Td>
                      {hasArea && <Td right>{g.area ? fmtNum(g.area, 2) : "–"}{g.offArea > 0 && <span className="block text-xs text-amber-700">bo&apos;sh {fmtNum(g.offArea, 2)}</span>}</Td>}
                      <Td className="w-48"><Progress value={g.on} max={g.total} tone="success" /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {isFilter && <Tabs current={holat ?? "all"} className="mb-0" items={[
            { key: "all", label: "Hammasi", href: href({ tab: "filter" }), count: all.length },
            f("muddat", "Muddati o'tgan"), f("bugun", "Bugun to'lov"), f("kutilmoqda", "To'lov kuni kelmagan"), f("tolagan", "To'laganlar"),
            f("ijarada", RENT_SHOP_STATUS.on), f("bosh", "Bo'sh joylar"), f("kunlik", "Kunlik ijara"), f("toliqemas", "Ma'lumoti to'liq emas"),
            f("tugayapti", "Shartnoma tugayapti"), f("tugagan", "Shartnoma tugagan"),
          ]} />}
        </>
      )}
      {all.length === 0 ? <EmptyState icon={Store} title="Do'konlar yo'q" text="Yuqoridagi forma orqali birinchi do'konni qo'shing." /> : shops.length === 0 ? <EmptyState icon={Store} title="Bu filtrda joy yo'q" text="Boshqa filtrni tanlang yoki «Hammasi» ni bosing." /> : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Joy</Th><Th>Do&apos;kon / ijarachi</Th><Th>To&apos;lov kuni</Th><Th right>Perechisleniye</Th><Th right>Naqd</Th><Th right>Svet</Th><Th right>Soliq</Th><Th right>Umumiy qarz</Th><Th>Holat</Th><Th></Th></tr></thead>
            <tbody>
              {shops.map((x) => {
                const s = st(x), debt = s.debt;
                return (
                  <Tr key={x.id} className={x.isActive ? undefined : "bg-amber-50/40"}>
                    <Td className="text-slate-600">{x.location}</Td>
                    <Td>
                      <Link href={`/arenda/dokon/${x.id}`} className="font-medium text-slate-800 hover:underline">{x.name}</Link>
                      {(x.tenantName || x.phone) && <span className="block text-xs text-slate-500">{x.tenantName}{x.tenantName && x.phone ? " · " : ""}{x.phone && <a href={`tel:${x.phone}`} className="text-brand-700 hover:underline">{formatPhone(x.phone)}</a>}</span>}
                      {x.area && <span className="block text-xs text-slate-500">{fmtNum(Number(x.area), 2)} m²{rentPerM2(x) ? ` · 1 m² — ${fmtNum(rentPerM2(x)!)}` : ""}</span>}
                      {x.isActive && !x.phone && <span className="block text-xs text-red-600">telefon kiritilmagan</span>}
                      {x.isActive && endCell(x)}
                      {x.note && <span className="block text-xs text-slate-500">{x.note}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-sm">
                      {x.period === "DAILY" ? <Badge color="blue">har kuni</Badge>
                        : x.payDay ? <>har oy {x.payDay}-sana{s.dueDate && x.isActive && <span className="block text-xs text-slate-500">{date(s.dueDate)}</span>}</>
                        : x.isActive ? <span className="text-xs text-red-600">kiritilmagan</span> : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td right>{cell(Number(x.bankAmount))}</Td>
                    <Td right>{cell(Number(x.cashAmount))}</Td>
                    <Td right>{cell(Number(x.electricity))}</Td>
                    <Td right>{cell(Number(x.tax))}</Td>
                    <Td right className={`font-semibold ${debt > 0.005 ? "text-red-600" : debt < -0.005 ? "text-emerald-700" : "text-slate-400"}`} >{debt < -0.005 ? `avans ${fmtNum(-debt)}` : cell(debt)}</Td>
                    <Td>
                      <Badge color={STATUS_BADGE[s.status]}>{RENT_PAY_STATUS_LABEL[s.status]}</Badge>
                      {s.status === "OVERDUE" && <span className="block text-xs font-medium text-red-600">{fmtNum(s.overdue)}</span>}
                    </Td>
                    <Td>
                      {canShops && (
                        <div className="flex items-center gap-2">
                          <Link href={href({ tab: "dokonlar", edit: x.id })} aria-label={`${x.name} — tahrirlash`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={14} /></Link>
                          {x.isActive
                            ? <ConfirmButton action={toggleRentShop.bind(null, x.id)} label="Bo'shatish" question={`«${x.name}» bugungi sana bilan bo'shatilsinmi? Shartnoma yopiladi, qarzi bo'lsa ijarachi «sobiq» bo'lib qoladi.`} okText="Bo'shatildi" className="text-xs text-slate-500 hover:text-red-600" />
                            : <Link href={`/arenda/dokon/${x.id}#shartnoma`} className="text-xs font-medium text-brand-700 hover:underline">Ijaraga berish</Link>}
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────── Tahlil: bandlik va yig'im ───────────────────────── */

/**
 * Bozorlar bo'yicha bandlik (joy va m²), oylik daromad (andoza bo'yicha), 1 m² o'rtacha narx va bo'sh maydon sababli
 * yo'qotilayotgan daromad; pastda — oxirgi 6 oy yig'imi (hisoblangan va shu oy uchun tushgan).
 */
async function AnalyticsTab() {
  const [{ rows, total }, months] = await Promise.all([rentOccupancy(), rentCollection(6)]);
  if (!total.total) return <EmptyState icon={BarChart3} title="Hali do'kon yo'q" text="Do'konlar kiritilgach bandlik va daromad tahlili shu yerda chiqadi." />;
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
  const m2 = (v: number) => (v > 0 ? fmtNum(v, 2) : "–");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Bandlik (joylar)" value={pct(total.on, total.total)} icon={Store} hint={`${total.on} ta ijarada, ${total.off} ta bo'sh`} />
        <StatCard label="Bandlik (maydon)" value={total.area > 0 ? pct(total.areaOn, total.area) : "—"} icon={Ruler} hint={total.area > 0 ? `${m2(total.areaOn)} / ${m2(total.area)} m²${total.noArea ? ` · ${total.noArea} ta joyda m² yo'q` : ""}` : "do'konlarga m² kiriting"} />
        <StatCard label="Oylik daromad (andoza)" value={money(total.monthly)} icon={Wallet} hint={total.perM2 !== null ? `o'rtacha 1 m² — ${money(total.perM2)}` : "kunlik ijara × 30 kun"} />
        <StatCard label="Bo'sh joylar sababli yo'qotish" value={total.lost !== null ? money(total.lost) : "—"} icon={TrendingDown} tone={total.lost ? "warning" : "default"} hint={total.lost !== null ? `oyiga · bo'sh ${m2(total.areaOff)} m² bozor narxida` : "bo'sh joylarga m² kiriting"} />
      </div>
      <Card padded={false}>
        <div className="p-5 pb-0"><CardHeader title="Bozorlar bo'yicha" description="Daromad — ijaradagi joylarning andoza summasi (kunlik ijara × 30). Yo'qotish — bo'sh maydon shu bozorning 1 m² o'rtacha narxida ijaraga berilsa oyiga qancha tushardi." /></div>
        <Table>
          <thead><tr><Th>Joy (bozor)</Th><Th right>Joylar</Th><Th right>Ijarada</Th><Th right>Bo&apos;sh</Th><Th right>Maydon, m²</Th><Th right>Bo&apos;sh m²</Th><Th>Bandlik (m²)</Th><Th right>Oylik daromad</Th><Th right>1 m² narx</Th><Th right>Yo&apos;qotish / oy</Th></tr></thead>
          <tbody>
            {[...rows, ...(rows.length > 1 ? [total] : [])].map((r) => (
              <Tr key={r.location} className={r === total ? "bg-slate-50/70 font-semibold" : undefined}>
                <Td className="font-medium text-slate-800">{r.location}</Td>
                <Td right>{r.total}</Td>
                <Td right className="text-emerald-700">{r.on}</Td>
                <Td right className={r.off ? "text-amber-700" : "text-slate-400"}>{r.off || "–"}</Td>
                <Td right>{m2(r.area)}{r.noArea > 0 && <span className="block text-[11px] font-normal text-slate-400">{r.noArea} ta joyda m² yo&apos;q</span>}</Td>
                <Td right className={r.areaOff ? "text-amber-700" : "text-slate-400"}>{m2(r.areaOff)}</Td>
                <Td className="w-40">{r.area > 0 ? <Progress value={r.areaOn} max={r.area} tone="success" /> : <span className="text-xs text-slate-400">—</span>}</Td>
                <Td right>{fmtNum(r.monthly)}</Td>
                <Td right>{r.perM2 !== null ? fmtNum(r.perM2) : "–"}</Td>
                <Td right className={r.lost ? "text-red-600" : "text-slate-400"}>{r.lost ? fmtNum(r.lost) : "–"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card padded={false}>
        <div className="p-5 pb-0"><CardHeader title="Oylar bo'yicha yig'im" icon={FileClock} description="Hisoblangan (oy hisobi) va shu oy uchun yozilgan kirimlar. Joriy oy hali tugamagan." /></div>
        <Table>
          <thead><tr><Th>Oy</Th><Th right>Hisoblangan</Th><Th right>Tushgan</Th><Th right>Qoldiq</Th><Th>Yig&apos;im</Th></tr></thead>
          <tbody>
            {months.map((m) => (
              <Tr key={m.key}>
                <Td><Link href={`/arenda?oy=${m.key}`} className="hover:underline">{m.label}</Link></Td>
                <Td right>{cell(m.due)}</Td>
                <Td right className="text-emerald-700">{cell(m.paid)}</Td>
                <Td right className={m.due - m.paid > 0.005 ? "text-red-600" : "text-slate-400"}>{cell(Math.max(0, m.due - m.paid))}</Td>
                <Td className="w-56">{m.rate !== null ? <div className="flex items-center gap-2"><Progress value={Math.min(m.paid, m.due)} max={m.due} tone={m.rate >= 95 ? "success" : m.rate >= 70 ? "warning" : "danger"} /><span className="w-10 text-right text-xs tabular-nums text-slate-600">{m.rate}%</span></div> : <span className="text-xs text-slate-400">hisob yo&apos;q</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

/* ───────────────────────── Svet varag'i (Excel «Свет отчёт») ───────────────────────── */

/**
 * Oyning svet hisobi joy (bozor) bo'yicha: avvalgi / hozirgi ko'rsatkich, farqi, narxi, ustama, summasi, shartnoma bo'yicha
 * summa, berilgan (kassaga svet to'lovi + litsevoyga), qoldiq va izoh; har joy oxirida jami va «To'lashimiz kerak».
 * Svet qarzi ijara qarzidan alohida — `lib/rent-elec.ts`.
 */
async function ElecTab({ month, monthName, canShops, shopsHref }: { month: Date; monthName: string; canShops: boolean; shopsHref: string }) {
  const { settings, groups, total, bill } = await elecSheet(month);
  const key = monthKey(month);
  const head = ["№", "Do'kon / ijarachi", "Avvalgi ko'rsatkich", "Hozirgi ko'rsatkich", "Farqi, kVt", "Narxi", `Ustama ${fmtNum(settings.markup, 2)}%`, "Summasi", "Shartnoma bo'yicha", "Berilgan", "Qoldiq", "Izoh"];
  const excelRows = groups.flatMap((g) => [
    ...g.rows.map((r, i) => ({
      "Joy": g.location, [head[0]]: i + 1, [head[1]]: r.tenantName ? `${r.name} — ${r.tenantName}` : r.name, [head[2]]: r.meterStart, [head[3]]: r.meterEnd, [head[4]]: r.kwh || null,
      [head[5]]: r.price || null, [head[6]]: r.extra || null, [head[7]]: r.sum, [head[8]]: r.fixed || null, [head[9]]: r.paid, [head[10]]: r.left, [head[11]]: r.note,
    })),
    { "Joy": g.location, [head[1]]: "Jami", [head[4]]: g.total.kwh, [head[5]]: g.total.price, [head[6]]: g.total.extra, [head[7]]: g.total.sum, [head[8]]: g.total.fixed, [head[9]]: g.total.paid, [head[10]]: g.total.left, [head[11]]: g.bill ? `To'lashimiz kerak: ${g.bill}` : null },
  ]);
  const totals = (t: typeof total) => [t.kwh, t.price, t.extra, t.sum, t.fixed, t.paid, t.left];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Svet summasi — ${monthName}`} value={money(total.sum)} icon={Zap} hint={`${fmtNum(total.kwh, 1)} kVt · ${groups.reduce((a, g) => a + g.rows.length, 0)} ta joy`} />
        <StatCard label="Ijarachilardan olindi" value={money(total.paid)} icon={Wallet} tone="success" hint="kassaga svet to'lovi + litsevoyga" />
        <StatCard label="Qoldiq" value={money(total.left)} icon={AlertTriangle} tone={total.left > 1 ? "danger" : "success"} hint="manfiy — ortiqcha to'langan" />
        <StatCard label="To'lashimiz kerak" value={bill ? money(bill) : "—"} icon={Landmark} tone={bill && total.paid < bill ? "warning" : "default"} hint={bill ? `farq (olingan − to'lanadigan) ${money(total.paid - bill)}` : "joy bo'yicha jadvalda kiriting"} />
      </div>
      {canShops && <Card><KwhPriceForm price={settings.kwhPrice} markup={settings.markup} /></Card>}
      {groups.length === 0 ? (
        <EmptyState icon={Zap} title={`${monthName} — svet hisobi yo'q`}
          text="Do'kon formasida «Svet hisobida» belgisini qo'ying (hisoblagichsiz joyga shartnoma bo'yicha oylik summa ham). Oy hisobi ochilganda joy shu varaqqa tushadi."
          action={canShops ? <Link href={shopsHref} className="text-sm font-medium text-brand-700 hover:underline">Do&apos;konlarga o&apos;tish →</Link> : undefined} />
      ) : (
        <>
          <div className="flex justify-end"><ExcelButton file={`Svet ${monthName}`} sheets={[{ name: monthName, rows: excelRows }]} /></div>
          <Sheet lang="uz" maxHeight="75vh">
            <SheetHead>
              <tr>{head.map((h, i) => <SheetTh key={h} tone={i === 7 ? "yellow" : i === 9 ? "green" : i === 10 ? "red" : "plain"} className={i === 1 ? "sticky left-0 z-20 min-w-60 text-left" : "whitespace-normal"}>{h}</SheetTh>)}</tr>
            </SheetHead>
            {groups.map((g) => (
              <tbody key={g.location}>
                <tr><SheetTd colSpan={12} tone="blue" className="py-2 text-base font-semibold text-slate-900"><span className="sticky left-2.5">{g.location}</span></SheetTd></tr>
                {g.rows.map((r, i) => <ElecRow key={r.chargeId} row={r} no={i + 1} month={key} canEdit={canShops} kwhPrice={settings.kwhPrice} markup={settings.markup} />)}
                <tr>
                  <SheetTd tone="gray" />
                  <SheetTd tone="gray" strong className="sticky left-0 z-[1] text-center">Jami</SheetTd>
                  <SheetTd tone="gray" /><SheetTd tone="gray" />
                  {totals(g.total).map((v, i) => <SheetTd key={i} right tone="gray" strong className={i === 6 && v > 0.005 ? "text-red-700" : undefined}>{i === 0 ? (v ? fmtNum(v, 1) : "–") : cell(v)}</SheetTd>)}
                  <SheetTd tone="gray" className="text-xs">
                    <span className="block text-slate-500">To&apos;lashimiz kerak</span>
                    <ElecBill location={g.location} month={key} amount={g.bill} canEdit={canShops} />
                  </SheetTd>
                </tr>
              </tbody>
            ))}
            {groups.length > 1 && (
              <SheetFoot>
                <tr>
                  <SheetTd />
                  <SheetTd className="sticky left-0 z-[1] text-center">Jami ({groups.length} joy)</SheetTd>
                  <SheetTd /><SheetTd />
                  {totals(total).map((v, i) => <SheetTd key={i} right>{i === 0 ? (v ? fmtNum(v, 1) : "–") : cell(v)}</SheetTd>)}
                  <SheetTd className="text-xs">{bill ? `To'lashimiz kerak: ${fmtNum(bill)}` : ""}</SheetTd>
                </tr>
              </SheetFoot>
            )}
          </Sheet>
          <p className="text-xs text-slate-500">
            Svet to&apos;lovini yuqoridagi «Kirim» → «Svet to&apos;lovi» bilan yozing (kvitansiya chiqadi); ijarachi elektr kompaniyasining litsevoy hisobiga o&apos;zi to&apos;lasa — qatorni tahrirlab «litsevoyga» summasini kiriting.
            Elektr kompaniyasiga to&apos;lovni «Chiqim» → «Svet» bilan yozing. Svet qarzi ijara qarzidan alohida hisoblanadi.
          </p>
        </>
      )}
    </div>
  );
}
