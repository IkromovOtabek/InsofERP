import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { money, moneyShort, date, isoDate } from "@/lib/format";
import { Badge, Button, Empty, Input, Select, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { JOURNAL_ONLY, isTransfer, txSign } from "@/lib/cash-tx";
import { cancelNote, cancellerNames } from "@/lib/cancelled";

type Account = { id: string; name: string; type: "CASH" | "BANK" };

/** Hisob ustunida: +kirim / −chiqim (perekit ham shu hisobning harakati). Jami ustunida perekit yo'q — pul kompaniya ichida ko'chgan. */
type Flow = { inc: number; exp: number };

async function flowsSince(since: Date, accountIds: string[]) {
  const [pay, tx] = await Promise.all([
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { gte: since }, cashAccountId: { in: accountIds } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { ...JOURNAL_ONLY, cancelledAt: null, date: { gte: since }, cashAccountId: { in: accountIds } }, _sum: { amount: true } }),
  ]);
  const byAcc = new Map<string, Flow>();
  const total: Flow = { inc: 0, exp: 0 };
  const add = (id: string, amount: number, sign: number, transfer: boolean) => {
    const f = byAcc.get(id) ?? { inc: 0, exp: 0 };
    if (sign > 0) f.inc += amount; else f.exp += amount;
    byAcc.set(id, f);
    if (!transfer) { if (sign > 0) total.inc += amount; else total.exp += amount; }
  };
  for (const p of pay) add(p.cashAccountId, Number(p._sum.amount ?? 0), 1, false);
  for (const t of tx) add(t.cashAccountId, Number(t._sum.amount ?? 0), txSign(t.type), isTransfer(t.type));
  return { byAcc, total };
}

const flowText = (f?: Flow) => (
  <span className="whitespace-nowrap">
    <span className={f?.inc ? "text-emerald-700" : "text-slate-400"}>+{moneyShort(f?.inc ?? 0)}</span>
    <span className="text-slate-300"> / </span>
    <span className={f?.exp ? "text-red-600" : "text-slate-400"}>−{moneyShort(f?.exp ?? 0)}</span>
  </span>
);

/**
 * Hisoblar matritsasi (Google jadvalidagi «Kassa» varag'i tepasi kabi): ustunlar — har bir kassa/bank hisobi va Jami,
 * qatorlar — qoldiq, bugungi va shu oydagi kirim/chiqim. Hisob nomi bosilsa — jurnal shu hisob bo'yicha ochiladi.
 */
export async function AccountMatrix({ accounts, balances }: { accounts: Account[]; balances: Map<string, number> }) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ids = accounts.map((a) => a.id);
  const [day, month] = await Promise.all([flowsSince(today, ids), flowsSince(monthStart, ids)]);
  const total = accounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);

  return (
    <div className="mb-6">
      <Table>
        <thead>
          <tr>
            <Th>Hisob</Th>
            {accounts.map((a) => (
              <Th key={a.id} right>
                <Link href={`/payments?tab=kassa&account=${a.id}`} className="hover:underline">{a.name}</Link>
                <span className="block text-[10.5px] font-medium normal-case tracking-normal text-slate-500">{a.type === "CASH" ? "naqd" : "bank"}</span>
              </Th>
            ))}
            <Th right>Jami</Th>
          </tr>
        </thead>
        <tbody>
          <Tr>
            <Td>Qoldiq</Td>
            {accounts.map((a) => {
              const b = balances.get(a.id) ?? 0;
              return <Td key={a.id} right className={`font-semibold ${b < 0 ? "text-red-600" : "text-slate-900"}`}>{money(b)}</Td>;
            })}
            <Td right className={`font-bold ${total < 0 ? "text-red-600" : "text-slate-900"}`}>{money(total)}</Td>
          </Tr>
          <Tr>
            <Td>Bugun</Td>
            {accounts.map((a) => <Td key={a.id} right>{flowText(day.byAcc.get(a.id))}</Td>)}
            <Td right className="font-medium">{flowText(day.total)}</Td>
          </Tr>
          <Tr>
            <Td>Shu oy</Td>
            {accounts.map((a) => <Td key={a.id} right>{flowText(month.byAcc.get(a.id))}</Td>)}
            <Td right className="font-medium">{flowText(month.total)}</Td>
          </Tr>
        </tbody>
      </Table>
      <p className="mt-1.5 text-xs text-slate-500">Hisob ustunlarida perekit ham hisobga olingan; Jami — perekitsiz (pul kompaniya ichida ko&apos;chgan). Hisob nomini bosing — jurnal shu hisob bo&apos;yicha ochiladi.</p>
    </div>
  );
}

type JRow = {
  id: string; date: Date; createdAt: Date; accountId: string; account: string; method: "CASH" | "BANK";
  inc: number; exp: number; transfer: boolean;
  manba: string; sub: string; who: string; whoHref?: string; blacklisted?: boolean; contracted?: boolean;
  note: string | null; by: string | null; href?: string; cancelled: string | null;
};

const KINDS = [
  { key: "", label: "Hammasi" },
  { key: "in", label: "Kirim" },
  { key: "out", label: "Chiqim" },
  { key: "perekit", label: "Perekit" },
] as const;

const MAX_ROWS = 1000;

/**
 * Kassa jurnali — kassa (naqd) va buxgalteriya (bank hisoblari) bo'yicha BARCHA kirim va chiqim bitta jadvalda:
 * mijoz to'lovlari (`Payment`), boshqa kirimlar, chiqimlar va perekit oyoqlari (`CashTransaction`). Bekor qilingan
 * yozuv ko'rinadi, lekin jamiga kirmaydi. Ustunlar Google jadvalidagidek: Sana, Hisob, Kirim, Chiqim, Manba, Sub manba,
 * Kontragent, Izoh.
 */
export async function KassaJurnalTab({ accounts, sp }: { accounts: Account[]; sp: { from?: string; to?: string; account?: string; kind?: string; manba?: string; q?: string } }) {
  const now = new Date();
  const from = new Date(sp.from || isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const to = new Date(sp.to || isoDate(now)); to.setHours(23, 59, 59, 999);
  const acc = accounts.some((a) => a.id === sp.account) ? sp.account : undefined;
  const kind = KINDS.some((k) => k.key === sp.kind) ? sp.kind ?? "" : "";
  const manba = sp.manba || undefined;
  const q = sp.q?.trim().toLowerCase() || undefined;

  const range = { gte: from, lte: to };
  const [payments, txs] = await Promise.all([
    db.payment.findMany({
      where: { date: range, ...(acc ? { cashAccountId: acc } : {}) },
      include: { customer: { select: { name: true } }, invoice: { select: { invoiceNo: true } }, register: { select: { id: true } }, cashAccount: true, createdBy: { select: { fullName: true } } },
    }),
    db.cashTransaction.findMany({
      where: { ...JOURNAL_ONLY, date: range, ...(acc ? { cashAccountId: acc } : {}) },
      include: { cashAccount: true, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);
  const [marks, cNames] = await Promise.all([customerMarks(payments.map((p) => p.customerId)), cancellerNames(txs)]);

  const all: JRow[] = [
    ...payments.map((p): JRow => ({
      id: p.id, date: p.date, createdAt: p.createdAt, accountId: p.cashAccountId, account: p.cashAccount.name, method: p.cashAccount.type,
      inc: Number(p.amount), exp: 0, transfer: false,
      manba: "Savdo tushumi",
      sub: p.invoice ? `Schyot ${p.invoice.invoiceNo}` : p.register ? "Realizatsiya" : p.orderId ? "Zayavka avansi" : "Mijoz avansi",
      who: p.customer.name, whoHref: `/customers/${p.customerId}`, blacklisted: marks.black.has(p.customerId), contracted: marks.contract.has(p.customerId),
      note: p.note, by: p.createdBy?.fullName ?? null, href: p.orderId && !p.invoice ? `/orders/${p.orderId}` : undefined, cancelled: null,
    })),
    ...txs.map((t): JRow => {
      const transfer = isTransfer(t.type);
      const amount = Number(t.amount);
      const sign = txSign(t.type);
      return {
        id: t.id, date: t.date, createdAt: t.createdAt, accountId: t.cashAccountId, account: t.cashAccount.name, method: t.cashAccount.type,
        inc: sign > 0 ? amount : 0, exp: sign < 0 ? amount : 0, transfer,
        manba: transfer ? "Perekit" : t.category,
        sub: transfer ? (t.counterparty ?? "") : (t.subCategory ?? ""),
        who: transfer ? "" : (t.supplier?.name ?? t.counterparty ?? ""),
        note: t.note, by: t.createdBy.fullName, cancelled: cancelNote(t, cNames),
        href: t.refType === "GoodsReceipt" && t.refId ? `/receipts/${t.refId}`
          : t.refType === "StockIn" && t.refId ? `/stock?tab=moves&ref=${t.refId}`
          : t.refType === "MechanicRequest" && t.refId ? `/mexanik-sorovlar/${t.refId}`
          : undefined,
      };
    }),
  ];

  // Manba tanlovi — davrdagi barcha manbalardan (boshqa filtrlar qo'llanmasdan oldin)
  const manbaOpts = [...new Set(all.map((r) => r.manba))].sort((a, b) => a.localeCompare(b));
  const rows = all
    .filter((r) => !kind || (kind === "perekit" ? r.transfer : !r.transfer && (kind === "in" ? r.inc > 0 : r.exp > 0)))
    .filter((r) => !manba || r.manba === manba)
    .filter((r) => !q || [r.who, r.note, r.manba, r.sub, r.account, r.by].some((x) => x?.toLowerCase().includes(q)))
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());

  const live = rows.filter((r) => !r.cancelled && !r.transfer);
  const inc = live.reduce((s, r) => s + r.inc, 0);
  const exp = live.reduce((s, r) => s + r.exp, 0);
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <>
      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="tab" value="kassa" />
        <Input name="from" type="date" aria-label="Boshlanish sanasi" defaultValue={isoDate(from)} className="h-9 w-40" />
        <span className="text-slate-400">—</span>
        <Input name="to" type="date" aria-label="Tugash sanasi" defaultValue={isoDate(to)} className="h-9 w-40" />
        <Select name="account" aria-label="Hisob" defaultValue={acc ?? ""} className="h-9 w-48">
          <option value="">Barcha hisoblar</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select name="kind" aria-label="Turi" defaultValue={kind} className="h-9 w-36">
          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </Select>
        <Select name="manba" aria-label="Manba" defaultValue={manba ?? ""} className="h-9 w-48">
          <option value="">Barcha manbalar</option>
          {manbaOpts.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Input name="q" placeholder="Kontragent, izoh…" aria-label="Qidiruv" defaultValue={sp.q ?? ""} className="h-9 w-52" />
        <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
        {(sp.from || sp.to || acc || kind || manba || q) && <Link href="/payments?tab=kassa" className="text-xs text-slate-500 hover:underline">filtrni tozalash</Link>}
      </form>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Kirim (davr)" value={money(inc)} icon={ArrowDownLeft} tone="success" />
        <StatCard label="Chiqim (davr)" value={money(exp)} icon={ArrowUpRight} tone={exp > 0 ? "danger" : "default"} />
        <StatCard label="Sof oqim" value={money(inc - exp)} icon={Wallet} tone={inc - exp >= 0 ? "success" : "danger"} hint="perekit va bekor qilinganlarsiz" />
      </div>

      <h2 className="mb-3 font-semibold">
        Kassa jurnali <span className="text-sm font-normal text-slate-500">· {rows.length} ta yozuv{rows.length > shown.length ? ` (oxirgi ${shown.length} tasi ko'rsatilgan — davrni toraytiring)` : ""}</span>
      </h2>
      <Table maxHeight="75vh">
        <thead>
          <tr><Th>Sana</Th><Th>Hisob</Th><Th right>Kirim</Th><Th right>Chiqim</Th><Th>Manba</Th><Th>Sub manba</Th><Th>Kontragent</Th><Th className="min-w-80">Izoh</Th></tr>
        </thead>
        <tbody>
          {shown.length === 0 && <Empty text="Davrda kirim-chiqim yo'q" />}
          {shown.map((r) => {
            const amtCls = r.cancelled ? "text-slate-400 line-through" : r.transfer ? "text-sky-700" : "";
            return (
              <Tr key={r.id} className={r.cancelled ? "bg-slate-50/60 text-slate-400" : undefined}>
                <Td className="whitespace-nowrap">{date(r.date)}</Td>
                <Td className="whitespace-nowrap">
                  {r.account}
                  <span className="ml-1.5"><Badge color={r.method === "CASH" ? "amber" : "slate"} dot={false}>{r.method === "CASH" ? "naqd" : "bank"}</Badge></span>
                </Td>
                <Td right className={`font-medium ${amtCls || "text-emerald-700"}`}>{r.inc ? money(r.inc) : ""}</Td>
                <Td right className={`font-medium ${amtCls || "text-red-600"}`}>{r.exp ? money(r.exp) : ""}</Td>
                <Td className="whitespace-nowrap">
                  {r.href ? <Link href={r.href} className="font-medium text-slate-800 hover:underline">{r.manba} →</Link> : r.manba}
                  {r.cancelled && <span className="mt-1 block"><Badge color="slate">Bekor qilingan</Badge></span>}
                </Td>
                <Td className="whitespace-nowrap text-slate-600">{r.sub}</Td>
                <Td>{r.who ? <CustomerName name={r.who} blacklisted={!!r.blacklisted} contracted={!!r.contracted} href={r.whoHref} /> : <span className="text-slate-300">—</span>}</Td>
                <Td className="text-slate-600">
                  {r.note ?? ""}
                  {r.by && <span className="block text-xs text-slate-400">kiritdi: {r.by}</span>}
                  {r.cancelled && <span className="block text-xs text-red-600">Bekor qilindi: {r.cancelled}</span>}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
