import Link from "next/link";
import { ChevronLeft, ChevronRight, Landmark, Pencil, Store, Undo2, Wallet, Banknote } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, fmtNum, money } from "@/lib/format";
import {
  RENT_EXPENSE_CATEGORIES, RENT_METHOD_LABEL, currentMonth, monthKey, monthLabel, monthRange, monthSheet, parseMonth, rentBalance, shiftMonth, shopDebts,
} from "@/lib/rent";
import { Badge, Callout, Card, CardHeader, EmptyState, PageHeader, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { ConfirmButton } from "../payments/confirm-button";
import { ExcelButton } from "../logistika/excel-button";
import { ChargeRow, RentTxPanel, ShopForm } from "./arenda-forms";
import { openRentMonth, stornoRentTx, toggleRentShop } from "./actions";

const cell = (v: number) => (Math.abs(v) < 0.005 ? "–" : fmtNum(v));

/**
 * Arenda — do'konlar ijarasi (sekretar ish joyi). Tepada arenda kassasining umumiy summasi, uning ostida
 * «Kirim» / «Chiqim» tugmalari; pastda Excel'dagi oy varag'i (bozor bo'yicha guruhlangan), jurnal va do'konlar.
 */
export default async function ArendaPage({ searchParams }: { searchParams: Promise<{ oy?: string; tab?: string; edit?: string }> }) {
  const s = await requirePage("/arenda");
  const sp = await searchParams;
  const now = currentMonth();
  const month = parseMonth(sp.oy) ?? now;
  const key = monthKey(month);
  const tab = sp.tab === "jurnal" || sp.tab === "dokonlar" ? sp.tab : "jadval";
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
  const href = (p: { oy?: string; tab?: string; edit?: string }) => {
    const q = new URLSearchParams({ oy: p.oy ?? key, ...(p.tab ?? tab) !== "jadval" ? { tab: p.tab ?? tab } : {}, ...(p.edit ? { edit: p.edit } : {}) });
    return `/arenda?${q}`;
  };
  const t = sheet.total;

  return (
    <div>
      <PageHeader title="Arenda" subtitle="Do'konlar ijarasi: oylik hisob, ijarachilardan tushgan pul va arenda kassasi kirim-chiqimi." />

      {/* Umumiy summa — Kirim/Chiqim tugmalari tepasida */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Arenda kassasi — umumiy summa" value={money(balance.total)} icon={Wallet} tone={balance.total < 0 ? "danger" : "success"} hint="Barcha kirimlar − chiqimlar (bekor qilinganlar hisobga kirmaydi)" />
        <StatCard label="Naqd" value={money(balance.cash)} icon={Banknote} />
        <StatCard label="Perechisleniye" value={money(balance.bank)} icon={Landmark} />
      </div>
      <RentTxPanel shops={activeShops.map((x) => ({ id: x.id, name: x.name, location: x.location }))} month={key} months={months} expenseCats={RENT_EXPENSE_CATEGORIES} canCreate={canCreate} />

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
        { key: "jurnal", label: "Kirim-chiqim jurnali", href: href({ tab: "jurnal" }) },
        { key: "dokonlar", label: "Do'konlar", href: href({ tab: "dokonlar" }), count: activeShops.length },
      ]} />

      {tab === "jadval" && <SheetTab sheet={sheet} month={key} monthName={monthLabel(month)} canShops={canShops} hasShops={shops.length > 0} shopsHref={href({ tab: "dokonlar" })} />}
      {tab === "jurnal" && <JournalTab month={month} canStorno={canStorno} />}
      {tab === "dokonlar" && <ShopsTab shops={shops} month={key} editId={sp.edit} canShops={canShops} href={href} />}
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
                {g.rows.map((r) => <ChargeRow key={r.shopId} row={r} month={month} canEdit={canShops} />)}
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
          <p className="text-xs text-slate-500">Qoldiq = jami to&apos;lashi kerak − jami tushgan (qizil — qarz, yashil — ortiqcha to&apos;langan). Svet va soliq qoldiqqa ta&apos;sir qilmaydi. «Tushgan» — shu oy uchun yozilgan kirimlar.</p>
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
                    <span className="block text-xs text-slate-500">{x.category}{x.month ? ` · ${monthLabel(x.month)} uchun` : ""}</span>
                  </Td>
                  <Td>{RENT_METHOD_LABEL[x.method]}</Td>
                  <Td right className={`font-semibold tabular-nums ${off ? "line-through" : x.type === "INCOME" ? "text-emerald-700" : "text-red-600"}`}>{x.type === "INCOME" ? "+" : "−"}{fmtNum(Number(x.amount))}</Td>
                  <Td className="max-w-64 whitespace-normal text-xs text-slate-600">{x.note}{off && <span className="block text-slate-500">Bekor qilish sababi: {x.cancelReason}</span>}</Td>
                  <Td className="text-xs text-slate-500">{x.createdBy.fullName}</Td>
                  <Td>{canStorno && !off && <ConfirmButton action={stornoRentTx.bind(null, x.id)} label={<><Undo2 size={13} className="mr-1 inline" />Bekor qilish</>} question="Bekor qilinsinmi?" reason="required" okText="Bekor qilindi" className="text-xs text-slate-500 hover:text-red-600" />}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/* ───────────────────────── Do'konlar ───────────────────────── */

type Shop = Awaited<ReturnType<typeof db.rentShop.findMany>>[number];

async function ShopsTab({ shops, month, editId, canShops, href }: {
  shops: Shop[]; month: string; editId?: string; canShops: boolean; href: (p: { tab?: string; edit?: string }) => string;
}) {
  const debts = await shopDebts();
  const editing = editId ? shops.find((x) => x.id === editId) : undefined;
  const locations = [...new Set(shops.map((x) => x.location))];
  const plain = (x: Shop) => ({ id: x.id, name: x.name, location: x.location, bankAmount: Number(x.bankAmount), cashAmount: Number(x.cashAmount), electricity: Number(x.electricity), tax: Number(x.tax), note: x.note });
  return (
    <div className="space-y-4">
      {canShops && (
        <Card>
          <CardHeader title={editing ? `Tahrirlash: ${editing.name}` : "Yangi do'kon"} description="Oylik summalar — andoza: yangi oy ochilganda o'tgan oy hisobi bo'lmasa shu qiymatlar olinadi. Shu oy ochilgan bo'lsa yangi do'kon unga ham qo'shiladi."
            action={editing ? <Link href={href({ tab: "dokonlar" })} className="text-sm text-slate-500 hover:text-slate-900">Bekor qilish</Link> : undefined} />
          <ShopForm key={editing?.id ?? "new"} shop={editing ? plain(editing) : undefined} locations={locations} month={month} onDoneHref={href({ tab: "dokonlar" })} />
        </Card>
      )}
      {shops.length === 0 ? <EmptyState icon={Store} title="Do'konlar yo'q" text="Yuqoridagi forma orqali birinchi do'konni qo'shing." /> : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Joy</Th><Th>Do&apos;kon</Th><Th right>Perechisleniye</Th><Th right>Naqd</Th><Th right>Svet</Th><Th right>Soliq</Th><Th right>Umumiy qarz</Th><Th>Holat</Th><Th></Th></tr></thead>
            <tbody>
              {shops.map((x) => {
                const debt = debts.get(x.id) ?? 0;
                return (
                  <Tr key={x.id} className={x.isActive ? undefined : "opacity-60"}>
                    <Td className="text-slate-600">{x.location}</Td>
                    <Td><span className="font-medium text-slate-800">{x.name}</span>{x.note && <span className="block text-xs text-slate-500">{x.note}</span>}</Td>
                    <Td right>{cell(Number(x.bankAmount))}</Td>
                    <Td right>{cell(Number(x.cashAmount))}</Td>
                    <Td right>{cell(Number(x.electricity))}</Td>
                    <Td right>{cell(Number(x.tax))}</Td>
                    <Td right className={`font-semibold ${debt > 0.005 ? "text-red-600" : debt < -0.005 ? "text-emerald-700" : "text-slate-400"}`} >{debt < -0.005 ? `avans ${fmtNum(-debt)}` : cell(debt)}</Td>
                    <Td>{x.isActive ? <Badge color="green">faol</Badge> : <Badge color="slate">faolsiz</Badge>}</Td>
                    <Td>
                      {canShops && (
                        <div className="flex items-center gap-2">
                          <Link href={href({ tab: "dokonlar", edit: x.id })} aria-label={`${x.name} — tahrirlash`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={14} /></Link>
                          <ActionButton action={toggleRentShop.bind(null, x.id)} variant="ghost" className="h-7 px-2 text-xs">{x.isActive ? "Faolsizlantirish" : "Faollashtirish"}</ActionButton>
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
