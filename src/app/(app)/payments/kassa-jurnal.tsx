import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { fmtNum, date, isoDate, opAt } from "@/lib/format";
import { Button, Callout, Card, Input, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { JOURNAL_ONLY, TRANSFER_REF, isTransfer, txSign } from "@/lib/cash-tx";
import { cancelNote, cancellerNames } from "@/lib/cancelled";
import { SALES_MANBA } from "@/lib/cash-import";
import { categoryOptions } from "@/lib/fin-report/categories";
import { accountBalances } from "@/lib/payments";
import { CashEditProvider } from "./cash-edit";
import { KassaJournal, type KassaRow } from "./kassa-table";
import { LastImportUndo } from "./import/recent";

type Account = { id: string; name: string; type: "CASH" | "BANK" };

/**
 * Davrdagi kirim / chiqim. Hisob ustunida perekit ham kiradi (pul shu hisobga kirgan yoki chiqqan); Jami ustunida
 * perekit yo'q — pul kompaniya ichida ko'chgan, oyoqlari bir-birini yopadi. Boshlang'ich qoldiq yozuvi («Oy oxiri
 * qoldiqlari», `OPENING`) oqim emas — bu yerga kirmaydi, faqat qoldiqqa ta'sir qiladi.
 */
type Flow = { inc: number; exp: number };
const noFlow = (): Flow => ({ inc: 0, exp: 0 });

async function flowsSince(since: Date, accountIds: string[], until?: Date) {
  const when = { gte: since, ...(until ? { lte: until } : {}) };
  const [pay, tx] = await Promise.all([
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: when, cashAccountId: { in: accountIds } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: when, cashAccountId: { in: accountIds } }, _sum: { amount: true } }),
  ]);
  const byAcc = new Map<string, Flow>();
  const total = noFlow();
  const of = (id: string) => { const f = byAcc.get(id) ?? noFlow(); byAcc.set(id, f); return f; };
  for (const p of pay) { const a = Number(p._sum.amount ?? 0); of(p.cashAccountId).inc += a; total.inc += a; }
  for (const t of tx) {
    if (t.type === "OPENING") continue;
    const a = Number(t._sum.amount ?? 0), f = of(t.cashAccountId);
    const transfer = isTransfer(t.type);
    if (txSign(t.type) > 0) { f.inc += a; if (!transfer) total.inc += a; }
    else { f.exp += a; if (!transfer) total.exp += a; }
  }
  return { byAcc, total };
}

/** Matritsa ustunlarini ajratuvchi tik chiziq (birinchi — «Hisob» ustunidan boshqa hamma katakda) */
const COL = "border-l border-l-slate-200";
// Ixcham matritsa: kataklar kichik, jadval esa butun kenglikka cho'ziladi (yonida bo'sh joy qolmaydi)
const CELL = "px-3 py-1.5 text-[13px]";
const HEAD = "px-3 py-2 text-[11px]";

/** Kirim / chiqim million so'mda, Google jadvalidagi kabi: «+2454,9 / −2333» */
const mln = (v: number) => fmtNum(v / 1e6, 1);
const flowText = (f?: Flow) => (
  <span className="whitespace-nowrap">
    <span className={f?.inc ? "text-emerald-700" : "text-slate-400"}>+{mln(f?.inc ?? 0)}</span>
    <span className="text-slate-300"> / </span>
    <span className={f?.exp ? "text-red-600" : "text-slate-400"}>−{mln(f?.exp ?? 0)}</span>
  </span>
);

/**
 * Hisoblar matritsasi (Google jadvalidagi «Kassa» varag'i tepasi kabi): ustunlar — har bir kassa/bank hisobi va Jami,
 * qatorlar — «Qoldiq» (tepadagi sana oxiriga; sukut — bugun), «Bugun, mln» va «Shu oy, mln» (kirim / chiqim).
 * Tanlangan sana bugun / shu oydan farq qilsa — shu davr qatori ham. Hisob nomi bosilsa — jurnal shu hisob bo'yicha ochiladi.
 */
export async function AccountMatrix({ accounts, range }: { accounts: Account[]; range: { from: Date; to: Date } }) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ids = accounts.map((a) => a.id);
  const toToday = isoDate(range.to) === isoDate(today);
  const own = toToday && [isoDate(today), isoDate(monthStart)].includes(isoDate(range.from)) ? null : range;
  const [closing, day, month, sel] = await Promise.all([
    accountBalances(db, ids, range.to),
    flowsSince(today, ids),
    flowsSince(monthStart, ids),
    own ? flowsSince(own.from, ids, own.to) : null,
  ]);
  const total = accounts.reduce((s, a) => s + (closing.get(a.id) ?? 0), 0);
  const flowRow = (label: string, f: Awaited<ReturnType<typeof flowsSince>>, className?: string) => (
    <Tr className={className}>
      <Td className={cn(CELL, "whitespace-nowrap font-medium")}>{label}</Td>
      {accounts.map((a) => <Td key={a.id} right className={cn(COL, CELL)}>{flowText(f.byAcc.get(a.id))}</Td>)}
      <Td right className={cn(COL, CELL, "font-semibold")}>{flowText(f.total)}</Td>
    </Tr>
  );

  return (
    <div className="mb-6">
      <Table>
        <thead>
          <tr>
            <Th className={HEAD}>Hisob</Th>
            {accounts.map((a) => (
              <Th key={a.id} right className={cn(COL, HEAD)}>
                <Link href={`/payments?account=${a.id}&from=${isoDate(range.from)}&to=${isoDate(range.to)}`} className="hover:underline">{a.name}</Link>
              </Th>
            ))}
            <Th right className={cn(COL, HEAD)}>Jami</Th>
          </tr>
        </thead>
        <tbody>
          <Tr className="bg-brand-50/60">
            <Td className={cn(CELL, "whitespace-nowrap font-medium")}>
              Qoldiq
              {!toToday && <span className="block text-[10.5px] leading-tight font-normal text-slate-500">{date(range.to)} oxiriga</span>}
            </Td>
            {accounts.map((a) => {
              const b = closing.get(a.id) ?? 0;
              return <Td key={a.id} right className={cn(COL, CELL, "font-semibold", b < 0 ? "text-red-600" : "text-slate-900")}>{fmtNum(b)}</Td>;
            })}
            <Td right className={cn(COL, CELL, "font-bold", total < 0 ? "text-red-600" : "text-slate-900")}>{fmtNum(total)}</Td>
          </Tr>
          {own && sel && flowRow(`${rangeLabel(own.from, own.to)}, mln`, sel, "bg-amber-50/60")}
          {flowRow("Bugun, mln", day)}
          {flowRow("Shu oy, mln", month)}
        </tbody>
      </Table>
      <p className="mt-1.5 text-xs text-slate-500">Qoldiq — so&apos;mda, tepadagi sana oxiriga; Bugun va Shu oy — kirim / chiqim, million so&apos;mda. Hisob ustunlarida perekit ham kirim/chiqimga kiradi; Jami — perekitsiz (pul kompaniya ichida ko&apos;chgan). Hisob nomini bosing — jurnal shu hisob bo&apos;yicha ochiladi.</p>
    </div>
  );
}

/** Yuklash chegarasi: davrda bundan ko'p yozuv bo'lsa — oxirgilari (filtr va Excel brauzerda, shu qatorlar bo'yicha) */
const MAX_LOAD = 5000;

type KassaSp = { from?: string; to?: string; account?: string; kind?: string; manba?: string; q?: string; import?: string };

/** Kassa jurnali davri: `?from&to`, ko'rsatilmasa — joriy oy boshidan bugungacha. */
export function kassaRange(sp: KassaSp) {
  const now = new Date();
  const from = new Date(sp.from || isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const to = new Date(sp.to || isoDate(now));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return kassaRange({});
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

const rangeLabel = (from: Date, to: Date) => (isoDate(from) === isoDate(to) ? date(from) : `${date(from)} — ${date(to)}`);

/**
 * Sahifaning eng tepasidagi sana tanlovi (Kassa jurnali tabida): oraliq + «Bugun», «Kecha», «Shu oy», «O'tgan oy».
 * Hisoblar matritsasida shu davr qatori, jurnal pastida — shu davr jami.
 */
export function KassaDateBar({ sp }: { sp: KassaSp }) {
  const { from, to } = kassaRange(sp);
  const f = isoDate(from), t = isoDate(to);
  const now = new Date();
  const today = isoDate(now);
  const yest = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const quick: [string, string, string][] = [
    ["Bugun", today, today],
    ["Kecha", yest, yest],
    ["Shu oy", isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), today],
    ["O'tgan oy", isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), isoDate(new Date(now.getFullYear(), now.getMonth(), 0))],
  ];
  // Matritsadan tanlangan hisob (?account) sana o'zgarganda ham qoladi — jurnal filtrlari qayta boshlanmaydi
  const acc = sp.account ? `&account=${encodeURIComponent(sp.account)}` : "";
  return (
    <Card padded={false} className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm">
      {/* key — tez tugma bosilganda maydonlar yangi sanani ko'rsatsin (defaultValue faqat birinchi chizishda o'qiladi) */}
      <form key={`${f}_${t}`} className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><CalendarDays size={16} className="text-slate-500" /> Sana</span>
        <input type="hidden" name="tab" value="kassa" />
        {sp.account && <input type="hidden" name="account" value={sp.account} />}
        <Input name="from" type="date" aria-label="Boshlanish sanasi" defaultValue={f} className="h-9 w-40" />
        <span className="text-slate-400">—</span>
        <Input name="to" type="date" aria-label="Tugash sanasi" defaultValue={t} className="h-9 w-40" />
        <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {quick.map(([label, a, b]) => (
          <Link key={label} href={`/payments?tab=kassa&from=${a}&to=${b}${acc}`} aria-current={a === f && b === t ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", a === f && b === t ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-100")}>{label}</Link>
        ))}
      </div>
    </Card>
  );
}

/**
 * Kassa jurnali — kassa (naqd) va buxgalteriya (bank hisoblari) bo'yicha BARCHA kirim va chiqim bitta jadvalda:
 * mijoz to'lovlari (`Payment`), boshqa kirimlar, chiqimlar va perekit oyoqlari (`CashTransaction`). Bekor qilingan
 * yozuv ko'rinadi, lekin jamiga kirmaydi. Bu yerda — davr qatorlari; hisob / tur / qidiruv va ustun filtrlari,
 * saralash, jami — `kassa-table.tsx` da (brauzerda).
 */
export async function KassaJurnalTab({ accounts, sp, canEdit = false, canAddSub = false }: { accounts: Account[]; sp: KassaSp; canEdit?: boolean; canAddSub?: boolean }) {
  const { from, to } = kassaRange(sp);
  const range = { gte: from, lte: to };
  const [payments, txs] = await Promise.all([
    db.payment.findMany({
      where: { date: range },
      include: { customer: { select: { name: true } }, invoice: { select: { invoiceNo: true } }, register: { select: { id: true } }, cashAccount: true, createdBy: { select: { fullName: true } } },
    }),
    db.cashTransaction.findMany({
      where: { ...JOURNAL_ONLY, date: range },
      include: { cashAccount: true, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);
  // Tahrir oynasining ro'yxatlari (qator tafsilotidagi «Tahrirlash») — jadvalga bir marta
  const [marks, cNames, editCats] = await Promise.all([
    customerMarks(payments.map((p) => p.customerId)), cancellerNames(txs),
    canEdit ? Promise.all([categoryOptions("INCOME"), categoryOptions("EXPENSE"), db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } })]) : null,
  ]);
  const editOptions = editCats ? { accounts, income: editCats[0], expense: editCats[1], customers: editCats[2], canAddSub } : null;

  const base = (d: Date, c: Date) => ({ day: isoDate(d), at: opAt(d, c), ts: d.getTime(), cts: c.getTime() });
  // Perekitning ikkinchi oyog'i qaysi hisobda — jurnal jamisida tanlangan hisoblar ichidagi perekitni ajratish uchun
  // (oyoqlar bir sanada yoziladi, shuning uchun ikkalasi ham shu davr qatorlarida bor)
  const legs = new Map<string, { id: string; acc: string }[]>();
  for (const t of txs) if (isTransfer(t.type) && t.refType === TRANSFER_REF && t.refId) legs.set(t.refId, [...(legs.get(t.refId) ?? []), { id: t.id, acc: t.cashAccountId }]);
  const peerOf = (t: { id: string; refId: string | null }) => (t.refId ? legs.get(t.refId)?.find((l) => l.id !== t.id)?.acc : undefined);
  const all: KassaRow[] = [
    ...payments.map((p): KassaRow => ({
      key: `p${p.id}`, ...base(p.date, p.createdAt), accountId: p.cashAccountId, account: p.cashAccount.name, method: p.cashAccount.type,
      inc: Number(p.amount), exp: 0, transfer: false,
      manba: SALES_MANBA,
      sub: p.invoice ? `Schyot ${p.invoice.invoiceNo}` : p.register ? "Realizatsiya" : p.orderId ? "Zayavka avansi" : "Mijoz avansi",
      who: p.customer.name, whoHref: `/customers/${p.customerId}`, blacklisted: marks.black.has(p.customerId), contracted: marks.contract.has(p.customerId),
      note: p.note ?? "", by: p.createdBy?.fullName ?? "", href: p.orderId && !p.invoice ? `/orders/${p.orderId}` : undefined, cancelled: null,
      kind: "pay", rowId: p.id,
    })),
    ...txs.map((t): KassaRow => {
      const transfer = isTransfer(t.type);
      const amount = Number(t.amount);
      const sign = txSign(t.type);
      const doc = transfer && t.refType === TRANSFER_REF && t.refId ? t.refId : null;
      return {
        key: `t${t.id}`, ...base(t.date, t.createdAt), accountId: t.cashAccountId, account: t.cashAccount.name, method: t.cashAccount.type,
        inc: sign > 0 ? amount : 0, exp: sign < 0 ? amount : 0, transfer, peerId: transfer ? peerOf(t) : undefined,
        manba: transfer ? "Perekit" : t.category,
        sub: transfer ? (t.counterparty ?? "") : (t.subCategory ?? ""),
        // Kontragent — yozilgan nom (tahrirda shu o'zgaradi), bo'lmasa yetkazuvchi
        who: transfer ? "" : (t.counterparty ?? t.supplier?.name ?? ""),
        note: t.note ?? "", by: t.createdBy.fullName, cancelled: cancelNote(t, cNames),
        kind: doc ? "transfer" : "tx", rowId: doc ?? t.id,
        href: t.refType === "GoodsReceipt" && t.refId ? `/receipts/${t.refId}`
          : t.refType === "StockIn" && t.refId ? `/stock?tab=moves&ref=${t.refId}`
          : t.refType === "MechanicRequest" && t.refId ? `/mexanik-sorovlar/${t.refId}`
          : undefined,
      };
    }),
  ].sort((a, b) => b.ts - a.ts || b.cts - a.cts);
  const rows = all.slice(0, MAX_LOAD);

  // Excel importidan qaytganda: «yozildi-o'tkazildi»
  const [imported, dupes, transfers, newSubs, newTops] = (sp.import ?? "").split("-").map((n) => Number(n) || 0);
  const acc = accounts.some((a) => a.id === sp.account) ? sp.account : undefined;
  // key — hisob nomi (matritsadagi havola) bosilganda filtr shu hisobdan qayta boshlansin
  const table = (
    <KassaJournal key={acc ?? ""} rows={rows} accounts={accounts} from={isoDate(from)} to={isoDate(to)}
      initial={{ account: acc, kind: sp.kind, manba: sp.manba, q: sp.q }} truncated={all.length > rows.length ? all.length : undefined} />
  );

  return (
    <>
      {sp.import && (
        <Callout tone="success" title="Excel importi">
          {imported} ta qator Kassa jurnaliga yozildi.{transfers > 0 && ` ${transfers} ta perekit o'tkazma hujjati bo'lib yozildi.`}{newTops > 0 && ` ${newTops} ta yangi manba qo'shildi — PNL qatorini Moliya → Kategoriyalarda tekshiring.`}{newSubs > 0 && ` ${newSubs} ta yangi sub manba kategoriyalarga qo'shildi.`}{dupes > 0 && ` ${dupes} ta qator jurnalda allaqachon bor edi — qayta yozilmadi.`} Jadval import qilingan davr bilan ko&apos;rsatilmoqda.
          <LastImportUndo added={imported} transfers={transfers} />
        </Callout>
      )}
      {editOptions ? <CashEditProvider options={editOptions}>{table}</CashEditProvider> : table}
    </>
  );
}
