import Link from "next/link";
import { redirect } from "next/navigation";
import { FileUp, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { canSeeRasxod } from "@/lib/stock-journal-access";
import { companyVatPayer } from "@/lib/receipt-vat";
import { dateRu, fmtNum } from "@/lib/format";
import { unitShort } from "@/lib/unit";
import { rasxodByTarget, rasxodJournal, rasxodTotals, STORNO_NOTE_RE, type RasxodRow, type RasxodTarget } from "@/lib/stock-issue";
import { recipientList } from "@/lib/stock-recipients";
import { cardHrefOf } from "@/lib/recipient-card";
import { stockPeriod, StockPeriodBar } from "@/components/stock-period";
import { Badge, Callout, Card, CardHeader, LinkButton, PageHeader, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard, type SheetTone } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { RasxodFilters } from "./rasxod-filters";
import { RecipientsManager } from "./recipients-manager";
import { StornoButton } from "./storno-button";
import { cancelRasxod } from "./actions";

/**
 * Sklad → «Chiqim» (avval «Расход») — skladdan chiqim jurnali, foydalanuvchi Excel'idagi ustunlar bilan. Matn o'zbekcha,
 * «Рус» rejimida lug'at avvalgi ruscha nomlarni qaytaradi (Число | Наименование | Ед Изм | К-во | От Кого | Кому | Деньги | …):
 * Sana | Nomi | Birlik | Miqdor | Kimdan | Kimga | To'lov turi | Yetkazib berish | Narx | Umumiy summa | QQS | Jami summa
 * (Excel'da yana «QQS stavkasi»: 0, 6 yoki 12% — oxirgi kirimdan; «To'lov turi» to'liq: O'tkazma (bank) / Naqd (kassa)).
 * Manba — StockMove (`rasxodJournal`): oluvchilarga va brigadalarga berish, qaytishlar, zames (kunlik, ko'k qator),
 * spisanie, inventarizatsiya kamomadi. Narx — harakatdagi «Dona narxi» («Дона сўм») snapshot.
 * Kim ko'radi — `canSeeRasxod` (lib/stock-journal-access): jurnalda narxlar va summalar bor. QQS — faqat korxona QQS
 * to'lovchisi bo'lsa (aks holda narx QQS ichida, QQS 0). Storno — `stock` → `issue_storno` (direktor yoki ruxsat berilgan).
 */

const money = (v: number) => `${fmtNum(v, 0)} so'm`;
const PAY: Record<"BANK" | "CASH", { label: string; color: "blue" | "amber"; title: string }> = {
  BANK: { label: "Bank o'tkazma", color: "blue", title: "Bank o'tkazma — oxirgi kirim bo'yicha" },
  CASH: { label: "Naqd pul", color: "amber", title: "Naqd pul — oxirgi kirim bo'yicha" },
};
/** Excel'da «To'lov turi» to'liq yoziladi — naqd yoki o'tkazma ekani qisqartmasiz ham tushunarli bo'lsin. */
const PAY_EXCEL: Record<"BANK" | "CASH", string> = { BANK: "O'tkazma (bank)", CASH: "Naqd (kassa)" };

export default async function RasxodPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; wh?: string; komu?: string; saved?: string }> }) {
  const s = await requirePage("/stock");
  // Narx va summalar — /stock ni ko'radigan hamma rolga emas (sotuv, logistika, mexanik — Sklad sahifasiga qaytadi)
  if (!canSeeRasxod(s)) redirect("/stock");
  const sp = await searchParams;
  const period = stockPeriod(sp);
  const canIssue = canDo(s, "stock", "issue");
  const canStorno = canDo(s, "stock", "issue_storno");

  const [warehouses, recipients, brigades, employees, vatPayer] = await Promise.all([
    db.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    recipientList(),
    db.brigade.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, name: true, isActive: true, leader: { select: { fullName: true } } } }),
    // Filtrda ishdan bo'shaganlar ham: eski chiqimlari nomi bilan topilsin
    db.employee.findMany({ orderBy: [{ isActive: "desc" }, { fullName: "asc" }], select: { id: true, fullName: true, isActive: true } }),
    companyVatPayer(),
  ]);
  const wh = warehouses.some((w) => w.id === sp.wh) ? sp.wh! : null;
  const komu = sp.komu && /^(r:.+|b:.+|e:.+|b|e|prod|writeoff|inventory)$/.test(sp.komu) ? sp.komu : null;
  const rows = await rasxodJournal({ from: period.from, to: period.to, warehouseId: wh, to_: komu });
  const t = rasxodTotals(rows);
  const targets = rasxodByTarget(rows);
  const saved = Number(sp.saved);
  // Storno tugmasi — har chiqim hujjatining (ref) birinchi ko'rinadigan qatorida, bir marta; storno qilinganida yo'q
  const refRows = new Map<string, RasxodRow[]>();
  for (const r of rows) if (r.ref && (r.kind === "issue" || r.kind === "brigade")) refRows.set(r.ref, [...(refRows.get(r.ref) ?? []), r]);
  const stornoAt = new Map<string, RasxodRow[]>(); // qator id → shu hujjat qatorlari (tugma shu qatorda)
  if (canStorno) for (const list of refRows.values()) if (!list[0].cancelled) stornoAt.set(list[0].id, list);
  const cols = canStorno ? 13 : 12;

  const hidden: Record<string, string> = {};
  if (wh) hidden.wh = wh;
  if (komu) hidden.komu = komu;

  const excelRows: Record<string, string | number | null>[] = rows.map((r) => ({
    "Sana": dateRu(r.date),
    "Nomi": r.material,
    "Birlik": unitShort(r.unit),
    "Miqdor": r.qty,
    "Kimdan": r.from,
    "Kimga": `${r.to}${r.auto ? " (avto)" : ""}${r.cancelled ? " (bekor qilingan)" : ""}${r.kind === "storno" && r.note ? ` · ${r.note}` : ""}`,
    "To'lov turi": r.payment ? PAY_EXCEL[r.payment] : "Ko'rsatilmagan",
    "Yetkazib berish": r.delivery,
    "Narx": r.price,
    "Umumiy summa": r.sum,
    "QQS stavkasi": `${r.vatRate}%`,
    "QQS": r.vat,
    "Jami summa": r.total,
  }));
  if (rows.length) {
    excelRows.push({ "Sana": "Jami", "Nomi": "", "Birlik": "", "Miqdor": null, "Kimdan": "", "Kimga": "", "To'lov turi": "", "Yetkazib berish": t.delivery, "Narx": null, "Umumiy summa": t.sum, "QQS stavkasi": "", "QQS": t.vat, "Jami summa": t.total });
  }

  return (
    <div>
      <PageHeader
        back={{ href: "/stock", label: "Sklad" }}
        title="Chiqim"
        subtitle="Skladdan xomashyo berish: kimga, qancha va qaysi narxda (Dona narxi). Zameslar — kuniga bitta qator."
        action={
          <>
            <ExcelButton file={`Chiqim ${period.fromStr} — ${period.toStr}`} sheets={[{ name: "Chiqim", rows: excelRows }]} />
            {canIssue && <LinkButton href="/stock/rasxod/import" variant="secondary"><FileUp size={16} /> Excel'dan yuklash</LinkButton>}
            {canIssue && <LinkButton href="/stock/rasxod/new"><Plus size={16} /> Yangi chiqim</LinkButton>}
          </>
        }
      />

      {saved > 0 && <div className="mb-4"><Callout tone="success" title="Chiqim yozildi">{`Qatorlar: ${saved}. Sklad qoldig'i kamaydi.`}</Callout></div>}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <StockPeriodBar base="/stock/rasxod" period={period} hidden={hidden} />
        <RasxodFilters
          warehouses={warehouses.map((w) => ({ id: w.id, name: w.isActive ? w.name : `${w.name} (yopilgan)` }))}
          brigades={brigades.map((b) => ({ id: b.id, name: `${b.leader ? `${b.name} — ${b.leader.fullName}` : b.name}${b.isActive ? "" : " (nofaol)"}` }))}
          employees={employees.map((e) => ({ id: e.id, name: e.isActive ? e.fullName : `${e.fullName} (ishdan bo'shagan)` }))}
          recipients={recipients.map((r) => ({ id: r.id, name: r.isActive ? r.name : `${r.name} (yashirilgan)` }))}
          wh={wh} komu={komu} from={period.fromStr} to={period.toStr}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Qatorlar" value={fmtNum(t.count)} hint={period.label} />
        <StatCard label="Summa" value={money(t.sum)} hint="Miqdor × Narx" />
        <StatCard label="QQS" value={money(t.vat)} hint={vatPayer ? "oxirgi kirim stavkasi bo'yicha" : "0 — QQS to'lovchisi emas, narx QQS bilan"} />
        <StatCard label="Jami" value={money(t.total)} tone="brand" hint="Summa + QQS" />
      </div>

      <Sheet>
        <SheetHead>
          <tr>
            <SheetTh>Sana</SheetTh>
            <SheetTh>Nomi</SheetTh>
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
            {canStorno && <SheetTh title="Chiqimni bekor qilish (direktor yoki uning ruxsati bilan)" />}
          </tr>
        </SheetHead>
        <tbody>
          {rows.length === 0 && (
            <tr><SheetTd colSpan={cols} center muted className="py-10">Tanlangan davrda chiqim yo'q</SheetTd></tr>
          )}
          {rows.map((r) => {
            const docRows = stornoAt.get(r.id);
            return (
              <Row key={r.id} r={r} storno={canStorno ? (docRows
                ? <StornoButton action={cancelRasxod.bind(null, docRows[0].ref!)} question={stornoQuestion(docRows)} />
                : null) : undefined} />
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <SheetFoot>
            <tr>
              <SheetTd colSpan={7}>{`Jami · ${fmtNum(t.count)} qator`}</SheetTd>
              <SheetTd right>{t.delivery ? fmtNum(t.delivery) : "—"}</SheetTd>
              <SheetTd />
              <SheetTd right>{fmtNum(t.sum)}</SheetTd>
              <SheetTd right>{fmtNum(t.vat)}</SheetTd>
              <SheetTd right>{fmtNum(t.total)}</SheetTd>
              {canStorno && <SheetTd />}
            </tr>
          </SheetFoot>
        )}
      </Sheet>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-sm border border-blue-300 bg-blue-100" /> Ishlab chiqarish (zames) — kunlik zameslar bo'yicha xomashyo sarfi</span>
        <span><b className="text-slate-700">≈</b> — narx qayd etilmagan, joriy «Dona narxi» ko'rsatilgan</span>
        <span><b className="text-slate-700">avto</b> — brigadaga topshiriq bo'yicha avtomatik berilgan</span>
        <span>To'lov turi va QQS — shu xomashyoning oxirgi kirimi bo'yicha</span>
        {!vatPayer && <span>QQS 0: korxona QQS to'lovchisi emas — narx (tannarx, «Dona narxi») QQSni o'z ichiga oladi</span>}
        <span><b className="text-slate-700">Bekor qilish</b> — chiqim bekor qilindi: minusli qator, xomashyo skladga qaytdi</span>
      </div>

      {canIssue && (
        <Card className="mt-8">
          <div id="recipients" className="scroll-mt-20">
            <CardHeader title="Boshqa oluvchilar (Kimga)" description="Tizimda yo'q nomlar: shofyorlar, Traktor, Mexanik / ustaxona va h.k. Brigadalar («Brigadalar» bo'limi) va xodimlar («Xodimlar») «Kimga» ro'yxatida avtomatik bor va birinchi turadi. Oluvchi o'chirilmaydi — uni yashirish mumkin. Nomini bosib kartasini oching." />
            <RecipientsManager list={recipients} />
          </div>
        </Card>
      )}

      {targets.length > 0 && (
        <Card className="mt-8">
          <CardHeader title="Kimga berildi" description={`${period.label} · «Kimga» ustunidagi nomlar bo'yicha: qaysi mahsulotdan qancha va necha pullik (Jami summa). Qaytarish va bekor qilish ayirilgan.`} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {targets.map((g) => <TargetCard key={g.key} g={g} />)}
          </div>
        </Card>
      )}
    </div>
  );
}

const TARGET_KIND = {
  b: { label: "Brigada", color: "amber" as const },
  e: { label: "Xodim", color: "blue" as const },
  r: { label: "Oluvchi", color: "slate" as const },
};

/** «Kimga berildi» kartasi: nom (kartasiga havola), jami summa, mahsulotlar — miqdor va summa. */
function TargetCard({ g }: { g: RasxodTarget }) {
  const href = cardHrefOf(g.key);
  const k = /^([ber])(:|$)/.exec(g.key)?.[1] as keyof typeof TARGET_KIND | undefined;
  const K = k ? TARGET_KIND[k] : null;
  return (
    <div className="flex flex-col rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {href
            ? <Link href={href} prefetch={false} className="block truncate font-medium text-slate-900 hover:underline" title="Oluvchi kartasini ochish">{g.name}</Link>
            : <span className={cn("block truncate font-medium", g.kind === "prod" ? "text-blue-800" : "text-slate-900")}>{g.name}</span>}
          <span className="block text-xs text-slate-500">{`${fmtNum(g.items.length)} xil mahsulot · ${fmtNum(g.rows)} qator`}</span>
        </div>
        {K && <Badge color={K.color}>{K.label}</Badge>}
      </div>
      <ul className="flex-1 divide-y divide-slate-100 text-sm">
        {g.items.map((x) => (
          <li key={x.materialId} className="flex items-baseline justify-between gap-3 py-1">
            <span className="min-w-0 truncate text-slate-700" title={x.material}>{x.material}</span>
            <span className="shrink-0 whitespace-nowrap tabular">
              <b className="font-semibold text-slate-900">{`${fmtNum(x.qty, 3)} ${unitShort(x.unit)}`}</b>
              <span className="ml-2 text-xs text-slate-500">{money(x.total)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-2 text-sm">
        <span className="text-slate-500">Jami</span>
        <b className="tabular font-semibold text-slate-900">{money(g.total)}</b>
      </div>
    </div>
  );
}

/** Storno savoli: sana, kimga, qancha qator. */
function stornoQuestion(list: RasxodRow[]): string {
  const r = list[0];
  return `${dateRu(r.date)} sanadagi chiqim — ${r.to}${list.length > 1 ? ` (${list.length} qator)` : ""} bekor qilinsinmi? Xomashyo skladga qaytadi`;
}

/** «Kimga» nomi: brigada / xodim / oluvchi — kartasiga havola; zames, spisanie, inventarizatsiya — oddiy matn. */
function KimgaName({ r }: { r: RasxodRow }) {
  const href = cardHrefOf(r.toKey);
  const cls = r.kind === "storno" ? "font-medium text-red-700" : undefined;
  if (!href) return <span title={r.note ?? undefined} className={cls}>{r.to}</span>;
  return (
    <Link href={href} prefetch={false} title={r.note ? `${r.note} · kartasini ochish` : "Oluvchi kartasini ochish"}
      className={cn("underline decoration-slate-300 underline-offset-2 hover:text-slate-900 hover:decoration-slate-600", cls)}>
      {r.to}
    </Link>
  );
}

/** `storno`: undefined — ustun yo'q (ruxsat yo'q); null — bo'sh katak; element — tugma. */
function Row({ r, storno }: { r: RasxodRow; storno?: React.ReactNode }) {
  const tone: SheetTone | undefined = r.kind === "prod" ? "blue" : undefined;
  const neg = r.qty < 0;
  const reason = r.kind === "storno" && r.note ? r.note.replace(STORNO_NOTE_RE, "") : null;
  return (
    <SheetTr className={cn((r.kind === "return" || r.kind === "storno" || r.cancelled) && "text-slate-500")}>
      <SheetTd tone={tone} className="whitespace-nowrap">{dateRu(r.date)}</SheetTd>
      <SheetTd tone={tone} strong>{r.material}</SheetTd>
      <SheetTd tone={tone} center>{unitShort(r.unit)}</SheetTd>
      <SheetTd tone={tone} right strong className={cn(neg && "text-slate-500")}>{fmtNum(r.qty, 3)}</SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.from}</SheetTd>
      <SheetTd tone={tone} className={cn(r.kind === "prod" && "font-medium text-blue-800", (r.kind === "writeoff" || r.kind === "inventory") && "text-amber-800")}>
        <KimgaName r={r} />
        {r.auto && <span className="ml-1.5 rounded bg-slate-100 px-1 py-px text-[11px] font-medium text-slate-600" title="Avtomatik berilgan: topshiriq uchun brigadada yetmadi yoki kirimda «Darhol kimga berildi»">avto</span>}
        {r.cancelled && <span className="ml-1.5 rounded bg-red-50 px-1 py-px text-[11px] font-medium text-red-700" title="Bu chiqim bekor qilingan — minusli «Bekor qilish» qatoriga qarang">bekor qilingan</span>}
        {reason && <span className="block text-[11px] text-slate-500">{`Sabab: ${reason}`}</span>}
      </SheetTd>
      <SheetTd tone={tone} center>
        {r.payment ? <span title={PAY[r.payment].title}><Badge color={PAY[r.payment].color} dot={false}>{PAY[r.payment].label}</Badge></span> : <span className="text-slate-400">—</span>}
      </SheetTd>
      <SheetTd tone={tone} right muted={!r.delivery}>{r.delivery ? fmtNum(r.delivery) : "—"}</SheetTd>
      <SheetTd tone={tone} right>
        {r.price == null
          ? <span className="text-amber-700" title="Narx yo'q: «Dona narxi» belgilanmagan va kirim bo'lmagan">narx yo'q</span>
          : <span title={r.priceApprox ? "Narx qayd etilmagan — joriy «Dona narxi»" : undefined}>{r.priceApprox && <span className="mr-0.5 text-slate-400">≈</span>}{fmtNum(r.price, 2)}</span>}
      </SheetTd>
      <SheetTd tone={tone} right>{fmtNum(r.sum)}</SheetTd>
      <SheetTd tone={tone} right muted={!r.vat}>{r.vat ? fmtNum(r.vat) : "0"}{r.vatRate > 0 && <span className="ml-1 text-[11px] text-slate-400">{r.vatRate}%</span>}</SheetTd>
      <SheetTd tone={tone} right strong>{fmtNum(r.total)}</SheetTd>
      {storno !== undefined && <SheetTd tone={tone} center>{storno}</SheetTd>}
    </SheetTr>
  );
}
