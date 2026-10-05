import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Wallet, Landmark, Trash2 } from "lucide-react";
import { accountBalances } from "@/lib/payments";
import { ConfirmButton } from "../payments/confirm-button";
import { PayReceiptForm } from "./pay-receipt-form";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { requireRoles } from "@/lib/page-guard";
import { money, date, isoDate } from "@/lib/format";
import { Badge, Button, Card, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr, Input } from "@/components/ui";
import { SupplyApprovals } from "@/components/supply-approvals";
import { TxForm } from "./tx-form";
import { deleteCashTx } from "./actions";
import { unpaidReceipts } from "@/lib/receipt-payables";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./categories";

type Row = { id: string; date: Date; kind: "INCOME" | "EXPENSE"; account: string; category: string; who: string; note: string | null; amount: number; href?: string; deletable: boolean; blacklisted?: boolean; contracted?: boolean };

/** Kirim-Chiqim: mijoz to'lovlari (Payment) + boshqa kirimlar va barcha chiqimlar (CashTransaction) bitta jurnalda. */
export default async function CashflowPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; account?: string; category?: string }> }) {
  const s = await requireRoles(["CASHIER", "ACCOUNTING", "FINANCE"], { module: "cashflow" });
  const canDelete = ["ACCOUNTING", "FINANCE", "DIRECTOR"].includes(s.role);
  const sp = await searchParams;
  const tab = sp.tab ?? "all";
  const now = new Date();
  const from = new Date(sp.from ?? isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const to = new Date(sp.to ?? isoDate(now)); to.setHours(23, 59, 59, 999);
  const acc = sp.account || undefined;
  const cat = sp.category || undefined; // egasi dashbordidan "kategoriya → detalizatsiya" havolasi

  const [accounts, suppliers, payments, txs, balance] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.payment.findMany({ where: { date: { gte: from, lte: to }, ...(acc ? { cashAccountId: acc } : {}) }, include: { customer: true, invoice: true, cashAccount: true, createdBy: { select: { fullName: true } } } }),
    // Boshlang'ich qoldiq (OPENING) kirim ham, chiqim ham emas — u faqat hisob qoldig'ida (Boshlang'ich qoldiqlar bo'limi)
    db.cashTransaction.findMany({ where: { type: { not: "OPENING" }, date: { gte: from, lte: to }, ...(acc ? { cashAccountId: acc } : {}) }, include: { cashAccount: true, supplier: true, createdBy: true } }),
    // Hisob qoldiqlari (butun davr): mijoz to'lovlari + kirim − chiqim — Kassa/bank sahifasi bilan bir manba
    accountBalances(),
  ]);

  const canPay = ["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role);
  const [marks, unpaid, supplyTx] = await Promise.all([
    customerMarks(payments.map((p) => p.customerId)),
    unpaidReceipts(),
    // Ta'minot zanjirining chiqimlari kirimga bog'langan bo'lsa ham bu yerdan o'chirilmaydi
    db.supplyRequest.findMany({ where: { cashTxId: { in: txs.filter((t) => t.refType === "GoodsReceipt").map((t) => t.id) } }, select: { cashTxId: true } }),
  ]);
  const supplyTxIds = new Set(supplyTx.map((x) => x.cashTxId));

  const rows: Row[] = [
    ...payments.map((p): Row => ({ id: p.id, date: p.date, kind: "INCOME", account: p.cashAccount.name, category: p.invoice ? `Mijoz to'lovi · ${p.invoice.invoiceNo}` : "Mijoz avansi", who: p.customer.name, note: [p.note, p.createdBy ? `kiritdi: ${p.createdBy.fullName}` : null].filter(Boolean).join(" · ") || null, amount: Number(p.amount), href: `/customers/${p.customerId}`, deletable: false, blacklisted: marks.black.has(p.customerId), contracted: marks.contract.has(p.customerId) })),
    // Hujjatdan avtomatik yozilgan chiqim (kirim hujjati / sklad kirimi) — ustiga bosilsa batafsili ochiladi
    ...txs.map((t): Row => ({
      id: t.id, date: t.date, kind: t.type === "EXPENSE" ? "EXPENSE" : "INCOME", account: t.cashAccount.name,
      category: t.refType ? `Kirim · ${t.category}` : t.category,
      who: t.supplier?.name ?? t.counterparty ?? "—", note: [t.note, `kiritdi: ${t.createdBy.fullName}`].filter(Boolean).join(" · "), amount: Number(t.amount),
      href: t.refType === "GoodsReceipt" && t.refId ? `/receipts/${t.refId}`
        : t.refType === "StockIn" && t.refId ? `/stock?tab=moves&ref=${t.refId}`
        : undefined,
      // Hujjatga bog'langanini bu yerdan o'chirib bo'lmaydi — hujjatning o'zidan tuzatiladi. Istisno: kirim hujjatiga
      // to'lov (o'chirish = to'lov storno, kirim yana "to'lanmagan" bo'ladi), ta'minot zanjirinikidan tashqari
      deletable: !t.refType || (t.refType === "GoodsReceipt" && !supplyTxIds.has(t.id)),
    })),
  ].filter((r) => (tab === "all" || r.kind === tab) && (!cat || r.category === cat || r.category.endsWith(`· ${cat}`))).sort((a, b) => b.date.getTime() - a.date.getTime());

  const inc = rows.filter((r) => r.kind === "INCOME").reduce((x, r) => x + r.amount, 0);
  const exp = rows.filter((r) => r.kind === "EXPENSE").reduce((x, r) => x + r.amount, 0);
  const byCat = new Map<string, number>();
  for (const r of rows.filter((r) => r.kind === "EXPENSE")) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
  const qs = (t: string) => `/cashflow?tab=${t}&from=${isoDate(from)}&to=${isoDate(to)}${acc ? `&account=${acc}` : ""}${cat ? `&category=${encodeURIComponent(cat)}` : ""}`;

  return (
    <div>
      <PageHeader title="Kirim-Chiqim" subtitle={cat ? `Detalizatsiya: «${cat}» — sana, summa, kontragent, hisob, kim kiritgan. ` : "Pul oqimi jurnali: mijoz to'lovlari (Kassa/bank'dan avtomatik), boshqa kirimlar va barcha chiqimlar."} action={cat ? <Link href={`/cashflow?tab=${tab}&from=${isoDate(from)}&to=${isoDate(to)}`} className="text-sm text-slate-500 hover:text-slate-900">✕ Filtrni olib tashlash</Link> : undefined} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Kirim (davr)" value={money(inc)} icon={ArrowDownLeft} tone="success" />
        <StatCard label="Chiqim (davr)" value={money(exp)} icon={ArrowUpRight} tone={exp > 0 ? "danger" : "default"} />
        <StatCard label="Sof oqim" value={money(inc - exp)} icon={Wallet} tone={inc - exp >= 0 ? "success" : "danger"} />
        <StatCard label="Hisoblar qoldig'i" value={money([...balance.values()].reduce((a, b) => a + b, 0))} icon={Landmark} hint={accounts.map((a) => `${a.name}: ${money(balance.get(a.id) ?? 0)}`).join(" · ")} />
      </div>

      {/* Moliya tasdig'i: Sotuv bo'limi tasdiqlagan ta'minot zayavkalari — soat ikonkasi bilan */}
      <SupplyApprovals mode="finance" />

      {/* Sklad/snabjeniye yozgan kirimlar — pulini moliya to'laydi */}
      {unpaid.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-1 font-semibold">To&apos;lanmagan kirimlar <Badge color="amber">{unpaid.length}</Badge></h2>
          <p className="mb-3 text-sm text-slate-500">Xomashyo skladga kirim qilingan, yetkazuvchiga hali to&apos;liq pul to&apos;lanmagan. Qolgan jami {money(unpaid.reduce((x, r) => x + r.left, 0))}. Summa bo&apos;sh qolsa — qolgani to&apos;liq to&apos;lanadi; qisman to&apos;lash uchun summani yozing.</p>
          <Table>
            <thead><tr><Th>Sana</Th><Th>Kirim</Th><Th>Yetkazuvchi</Th><Th right>Summa</Th><Th></Th></tr></thead>
            <tbody>
              {unpaid.map((r) => (
                <Tr key={r.id}>
                  <Td>{date(r.date)}</Td>
                  <Td><Link href={`/receipts/${r.id}`} className="font-medium text-slate-800 hover:underline">{r.docNo} →</Link> <span className="text-xs text-slate-500">{r.lines} qator</span></Td>
                  <Td>{r.supplier}</Td>
                  <Td right className="font-medium">{money(r.left)}{r.paid > 0.005 && <span className="block text-xs font-normal text-slate-500">jami {money(r.total)}, to&apos;langan {money(r.paid)}</span>}</Td>
                  <Td>
                    {canPay ? (
                      <PayReceiptForm receiptId={r.id} left={r.left} accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))} />
                    ) : <span className="text-xs text-slate-500">Moliya to&apos;laydi</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="mb-3 font-semibold">Yangi kirim / chiqim</h2>
          <TxForm accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} suppliers={suppliers} receipts={unpaid.map((r) => ({ id: r.id, supplierId: r.supplierId, label: `${r.docNo} · ${r.supplier} · qolgan ${money(r.left)}` }))} incomeCats={INCOME_CATEGORIES} expenseCats={EXPENSE_CATEGORIES} />
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Chiqimlar kategoriya bo&apos;yicha</h2>
          {byCat.size === 0 ? <p className="text-sm text-slate-500">Davrda chiqim yo&apos;q</p> : (
            <ul className="space-y-1.5 text-sm">
              {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-3"><span className="truncate text-slate-700">{k}</span><span className="font-medium tabular-nums">{money(v)}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs current={tab} className="mb-0" items={[{ key: "all", label: "Hammasi", href: qs("all") }, { key: "INCOME", label: "Kirim", href: qs("INCOME") }, { key: "EXPENSE", label: "Chiqim", href: qs("EXPENSE") }]} />
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="tab" value={tab} />
          {cat && <input type="hidden" name="category" value={cat} />}
          <Input name="from" type="date" aria-label="Boshlanish sanasi" defaultValue={isoDate(from)} className="h-9 w-40" />
          <span className="text-slate-400">—</span>
          <Input name="to" type="date" aria-label="Tugash sanasi" defaultValue={isoDate(to)} className="h-9 w-40" />
          <select name="account" aria-label="Kassa / hisob" defaultValue={acc ?? ""} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">Barcha hisoblar</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
        </form>
      </div>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Kategoriya</Th><Th>Kimdan / kimga</Th><Th>Hisob</Th><Th right>Summa</Th><Th>Izoh</Th><Th></Th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text="Davrda harakat yo'q" />}
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td>{date(r.date)}</Td>
              <Td>{r.kind === "INCOME" ? <Badge color="green">Kirim</Badge> : <Badge color="red">Chiqim</Badge>}</Td>
              <Td>{r.href ? <Link href={r.href} className="font-medium text-slate-800 hover:underline">{r.category} →</Link> : r.category}</Td>
              <Td><CustomerName name={r.who} blacklisted={!!r.blacklisted} contracted={!!r.contracted} href={r.href} /></Td>
              <Td className="text-slate-500">{r.account}</Td>
              <Td right className={r.kind === "INCOME" ? "font-medium text-emerald-700" : "font-medium text-red-600"}>{r.kind === "INCOME" ? "+" : "−"}{money(r.amount)}</Td>
              <Td className="text-slate-500">{r.note ?? ""}</Td>
              <Td>{r.deletable && canDelete && <ConfirmButton action={deleteCashTx.bind(null, r.id)} label="" title="O'chirish" icon={<Trash2 size={14} />} question={`${r.kind === "INCOME" ? "Kirim" : "Chiqim"} ${money(r.amount)} o'chirilsinmi?`} okText="O'chirildi" className="h-7 px-1.5" />}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
