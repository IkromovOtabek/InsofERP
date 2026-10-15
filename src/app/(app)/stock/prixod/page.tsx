import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet, FileUp, Plus, Rows3, Wallet, Percent, Sigma, Search } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { canSeePrixod } from "@/lib/stock-journal-access";
import { pathAllowed } from "@/lib/nav";
import { dateRu, fmtNum } from "@/lib/format";
import { unitShort } from "@/lib/unit";
import { cn } from "@/lib/utils";
import { prixodJournal, prixodTotals, type PrixodPayment, type PrixodRow } from "@/lib/receipts";
import { stockPeriod, StockPeriodBar } from "@/components/stock-period";
import { Badge, Button, Callout, Empty, Input, LinkButton, PageHeader, Select, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard } from "@/components/ui";
import { ExcelButton } from "../../logistika/excel-button";

/** Sahifada ko'rinadigan qatorlar chegarasi (jami va Excel — hamma qatorlardan). */
const MAX_ROWS = 2000;
const PAY_LABEL: Record<PrixodPayment, string> = { BANK: "Bank o'tkazma", CASH: "Naqd pul" };
/** Excel'da «To'lov turi» to'liq: naqd yoki bank o'tkazmasi ekani aniq bo'lsin. */
const PAY_EXCEL: Record<PrixodPayment, string> = { BANK: "O'tkazma (bank)", CASH: "Naqd (kassa)" };

const money = (v: number) => fmtNum(v, 2);
/** Kartalardagi jami summalar — Chiqim jurnalidagi kabi butun so'mda («… so'm»). */
const soum = (v: number) => `${fmtNum(v, 0)} so'm`;

function PayChip({ p }: { p: PrixodPayment | null }) {
  if (!p) return <span className="text-slate-400">—</span>;
  return <Badge color={p === "BANK" ? "blue" : "amber"} dot={false}>{PAY_LABEL[p]}</Badge>;
}

/** Uzun matn (Manzil, Maqsad) — bir qatorda, to'liq matn sichqoncha ostida. */
function Clip({ text, w = "max-w-[200px]" }: { text: string | null; w?: string }) {
  if (!text) return <span className="text-slate-400">—</span>;
  return <div className={`${w} truncate`} title={text}>{text}</div>;
}

/** «Hujjat» (Excel): storno qatori — «Storno K-…», storno qilingan asl qator — «K-… (storno)». */
const docLabel = (r: PrixodRow) => (r.storno ? `Storno ${r.docNo}` : r.cancelled ? `${r.docNo} (storno)` : r.docNo);

/**
 * Sklad → «Kirim» (avval «Приход»): kirim jurnali foydalanuvchi Excel'idagi ustunlar bilan (matn o'zbekcha, «Рус» — lug'atdan).
 * Har qator — kirim hujjatining bitta qatori. Storno qilingan kirim o'z sanasida ustidan chizilgan, storno sanasida — manfiy
 * «Storno» qatori (jami «Qoldiqlar» dagi «Kirim» bilan bir xil). Ma'lumot `lib/receipts.ts#prixodJournal` dan, yangi kirim — /stock/prixod/new.
 * Ko'rish ruxsati — `lib/stock-journal-access.ts#canSeePrixod`.
 */
export default async function PrixodPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string; wh?: string; saved?: string }> }) {
  const s = await requirePage("/stock");
  // Xarid narxlari, yetkazuvchilar va QQS — /stock ni ko'radigan hamma rolga emas (`lib/stock-journal-access.ts`)
  if (!canSeePrixod(s)) redirect("/stock");
  const sp = await searchParams;
  const period = stockPeriod(sp);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const saved = sp.saved && /^[A-Za-z0-9-]{1,40}$/.test(sp.saved) ? sp.saved : null;
  const warehouses = await db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const wh = warehouses.find((w) => w.id === sp.wh)?.id ?? null;
  const [rows, savedRec] = await Promise.all([
    prixodJournal({ from: period.from, to: period.to, warehouseId: wh, q }),
    saved ? db.goodsReceipt.findUnique({ where: { docNo: saved }, select: { id: true, docNo: true } }) : Promise.resolve(null),
  ]);
  const tot = prixodTotals(rows);
  const shown = rows.slice(0, MAX_ROWS);
  const canCreate = canDo(s, "stock", "receipt");
  // Kirim hujjati sahifasi (/receipts) hamma Sklad rollariga ochiq emas — havola faqat ochiladigan bo'lsa
  const canOpen = pathAllowed("/receipts", s.role, s.perms);
  const keep: Record<string, string> = { ...(q ? { q } : {}), ...(wh ? { wh } : {}) };

  const excel = [
    ...rows.map((r) => ({
      "Sana": dateRu(r.date), "Hujjat": docLabel(r), "Nomi": r.material, "TTN": r.waybillNo ?? "", "Birlik": unitShort(r.unit), "Miqdor": r.qty,
      "Kimdan": r.supplier, "Kimga": r.recipient, "To'lov turi": r.payment ? PAY_EXCEL[r.payment] : "Ko'rsatilmagan", "Yetkazib berish": r.delivery, "Narx": r.price,
      "Umumiy summa": r.sum, "QQS stavkasi": `${r.vatRate}%`, "QQS": r.vat, "Jami summa": r.total, "Manzil": r.address ?? "", "Ta'minotchi": r.buyer ?? "", "Maqsad": r.purpose ?? "",
    })),
    ...(rows.length ? [{ "Sana": "Jami", "Hujjat": "", "Nomi": "", "TTN": "", "Birlik": "", "Miqdor": null, "Kimdan": "", "Kimga": "", "To'lov turi": "", "Yetkazib berish": tot.delivery, "Narx": null, "Umumiy summa": tot.sum, "QQS stavkasi": "", "QQS": tot.vat, "Jami summa": tot.total, "Manzil": "", "Ta'minotchi": "", "Maqsad": "" }] : []),
  ];

  return (
    <div>
      <PageHeader
        back={{ href: "/stock", label: "Sklad" }}
        title="Kirim"
        subtitle={`${period.label} · skladga kirimlar`}
        action={<>
          <ExcelButton file={`kirim_${period.fromStr}_${period.toStr}`} sheets={[{ name: "Kirim", rows: excel }]} />
          {canCreate && <LinkButton href="/stock/prixod/import" variant="secondary"><FileUp size={16} /> Excel'dan yuklash</LinkButton>}
          {canCreate && <LinkButton href="/stock/prixod/jurnal" variant="secondary"><FileSpreadsheet size={16} /> Excel jurnal</LinkButton>}
          {canCreate && <LinkButton href="/stock/prixod/new"><Plus size={16} /> Yangi kirim</LinkButton>}
        </>}
      />

      {saved && (
        <Callout tone="success" title="Kirim saqlandi">
          {"Hujjat "}{savedRec && canOpen ? <Link href={`/receipts/${savedRec.id}`} className="font-semibold underline">{savedRec.docNo}</Link> : <b>{saved}</b>}{" — "}{"skladdagi qoldiq oshdi."}
        </Callout>
      )}

      <div className="mb-4 space-y-3">
        <StockPeriodBar base="/stock/prixod" period={period} hidden={keep} />
        <form action="/stock/prixod" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="from" value={period.fromStr} />
          <input type="hidden" name="to" value={period.toStr} />
          <div className="relative w-full sm:w-80">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Nomi yoki yetkazuvchi" aria-label="Qidiruv" className="pl-9" />
          </div>
          {warehouses.length > 1 && (
            <Select name="wh" defaultValue={wh ?? ""} aria-label="Sklad" className="w-auto min-w-44">
              <option value="">Barcha skladlar</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
          <Button type="submit" variant="secondary">Qidirish</Button>
          {(q || wh) && <Link href={`/stock/prixod?from=${period.fromStr}&to=${period.toStr}`} className="text-sm text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline">Tozalash</Link>}
        </form>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Qatorlar" value={fmtNum(tot.rows)} icon={Rows3} hint={`${new Set(rows.map((r) => r.receiptId)).size} ta hujjat`} />
        <StatCard label="Umumiy summa" value={soum(tot.sum)} icon={Wallet} hint={tot.delivery > 0 ? `shu jumladan yetkazib berish ${soum(tot.delivery)}` : "QQS'siz"} />
        <StatCard label="QQS" value={soum(tot.vat)} icon={Percent} tone="info" />
        <StatCard label="Jami summa" value={soum(tot.total)} icon={Sigma} tone="success" hint="QQS va yetkazib berish bilan" />
      </div>

      {rows.some((r) => r.cancelled || r.storno) && (
        <p className="mb-3 text-xs text-slate-500">
          Bekor qilingan (storno) kirim o'z sanasida ustidan chizilgan holda qoladi, bekor qilingan sanada esa minus bilan «Storno» qatori chiqadi. Jamilar storno bilan hisoblanadi, «Qoldiqlar» dagi «Kirim» kabi.
        </p>
      )}

      {rows.length > shown.length && (
        <Callout tone="warning">{`${fmtNum(rows.length)} ta qatordan birinchi ${fmtNum(shown.length)} tasi ko'rsatildi — davr yoki qidiruvni toraytiring. Jamilar va Excel — barcha qatorlar bo'yicha.`}</Callout>
      )}

      <Sheet>
        <SheetHead>
          <tr>
            <SheetTh>Sana</SheetTh>
            <SheetTh className="sticky left-0 z-20 min-w-[180px] text-left">Nomi</SheetTh>
            <SheetTh>TTN</SheetTh>
            <SheetTh>Birlik</SheetTh>
            <SheetTh right>Miqdor</SheetTh>
            <SheetTh>Kimdan</SheetTh>
            <SheetTh>Kimga</SheetTh>
            <SheetTh>To'lov turi</SheetTh>
            <SheetTh right>Yetkazib berish</SheetTh>
            <SheetTh right>Narx</SheetTh>
            <SheetTh right>Umumiy summa</SheetTh>
            <SheetTh right>QQS</SheetTh>
            <SheetTh right>Jami summa</SheetTh>
            <SheetTh>Manzil</SheetTh>
            <SheetTh>Ta'minotchi</SheetTh>
            <SheetTh>Maqsad</SheetTh>
          </tr>
        </SheetHead>
        <tbody>
          {shown.length === 0 && <Empty text={q || wh ? "Hech narsa topilmadi — qidiruv yoki davrni o'zgartiring" : "Tanlangan davrda kirimlar yo'q"} />}
          {shown.map((r) => <Row key={r.id} r={r} canOpen={canOpen} />)}
        </tbody>
        {rows.length > 0 && (
          <SheetFoot>
            <tr>
              <SheetTd colSpan={8}>{`Jami · ${fmtNum(tot.rows)} ta qator`}</SheetTd>
              <SheetTd right>{money(tot.delivery)}</SheetTd>
              <SheetTd />
              <SheetTd right>{money(tot.sum)}</SheetTd>
              <SheetTd right>{money(tot.vat)}</SheetTd>
              <SheetTd right>{money(tot.total)}</SheetTd>
              <SheetTd colSpan={3} />
            </tr>
          </SheetFoot>
        )}
      </Sheet>
    </div>
  );
}

function Row({ r, canOpen }: { r: PrixodRow; canOpen: boolean }) {
  // Storno qilingan asl qator — kulrang, ustidan chizilgan; storno qatori (manfiy) — och qizil fon, qizil matn
  const tone = r.storno ? ("red" as const) : undefined;
  return (
    <SheetTr className={cn("group", r.cancelled && "[&>td]:text-slate-400 [&>td]:line-through", r.storno && "[&>td]:text-red-700")}>
      <SheetTd tone={tone} className="whitespace-nowrap">
        {canOpen ? <Link href={`/receipts/${r.receiptId}`} title={`${r.docNo} hujjatini ochish`} className="font-medium hover:underline">{dateRu(r.date)}</Link> : <span className="font-medium">{dateRu(r.date)}</span>}
        {r.storno
          ? <span className="ml-1.5 text-[11px] font-semibold">{`Storno ${r.docNo}`}</span>
          : <span className="ml-1.5 text-[11px] text-slate-400">{r.docNo}</span>}
        {r.cancelled && <span className="ml-1.5" title="Kirim bekor qilingan (storno)"><Badge color="red" dot={false}>storno</Badge></span>}
      </SheetTd>
      <SheetTd tone={tone} className="sticky left-0 z-[1] min-w-[180px] bg-white font-medium text-slate-900 group-hover:bg-slate-50">{r.material}</SheetTd>
      <SheetTd tone={tone} center className="whitespace-nowrap">{r.waybillNo ?? <span className="text-slate-400">—</span>}</SheetTd>
      <SheetTd tone={tone} center>{unitShort(r.unit)}</SheetTd>
      <SheetTd tone={tone} right>{fmtNum(r.qty, 3)}</SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.supplier}</SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.recipient}</SheetTd>
      <SheetTd tone={tone} center><PayChip p={r.payment} /></SheetTd>
      <SheetTd tone={tone} right muted={!r.delivery}>{r.delivery ? money(r.delivery) : "—"}</SheetTd>
      <SheetTd tone={tone} right>{money(r.price)}</SheetTd>
      <SheetTd tone={tone} right>{money(r.sum)}</SheetTd>
      <SheetTd tone={tone} right muted={!r.vat}>{money(r.vat)}{r.vatRate > 0 && <span className="ml-1 text-[11px] text-slate-400">{r.vatRate}%</span>}</SheetTd>
      <SheetTd tone={tone} right strong>{money(r.total)}</SheetTd>
      <SheetTd tone={tone}><Clip text={r.address} /></SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.buyer ?? <span className="text-slate-400">—</span>}</SheetTd>
      <SheetTd tone={tone}><Clip text={r.purpose} w="max-w-[240px]" /></SheetTd>
    </SheetTr>
  );
}
