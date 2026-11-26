import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import type { Drill, DrillItem, DrillPart } from "@/lib/drill";
import { DRILL_LIMIT, sortDrill } from "@/lib/drill";
import type { LedgerRow } from "@/lib/driver-ledger";
import type { LedgerExtra } from "@/lib/ledger-extras";
import { PAY_TYPE_LABEL } from "@/lib/driver-trip-pay";
import { date, dateTime, fmtNum, money } from "@/lib/format";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Hisob varag'i tepasidagi kartalar bosilganda (`?karta=<kalit>`) — o'sha kartaning o'zi: faqat shu ko'rsatkichga tushgan
 * qatorlar (Kirim kartasi — faqat kirimli qatorlar) o'ng panelda; tarkibi (`&tur=`) bosilsa — shu turdagilari; qator bosilsa
 * (`&qator=<id>`, jurnal yozuvi — `&jt=<id>`) markazda batafsil oyna. Raqamlar kartadagi bilan bitta manbadan (varaq qatorlari).
 */
export const CARD_KEYS = ["tushum", "xarajat", "oylik", "jami", "reys", "probeg", "yoqilgi"] as const;
export type CardKey = (typeof CARD_KEYS)[number];
export const isCardKey = (v: string | undefined): v is CardKey => !!v && (CARD_KEYS as readonly string[]).includes(v);
/** Kartalar ko'rinadigan, lekin summa huquqisiz ham ochiladiganlari */
export const PUBLIC_CARDS: readonly CardKey[] = ["reys", "probeg", "yoqilgi", "oylik"];

type Metric = { key: string; label: string; of: (r: LedgerRow) => number };
const REVENUE: Metric[] = [
  { key: "revBank", label: "Dostavka — perech.", of: (r) => r.revBank },
  { key: "revCash", label: "Dostavka — naqd", of: (r) => r.revCash },
  { key: "revDebt", label: "Dostavka — qarzga (to'lov turi yo'q)", of: (r) => r.revDebt },
  { key: "svcBank", label: "Usluga — perech.", of: (r) => r.svcBank },
  { key: "svcCash", label: "Usluga — naqd", of: (r) => r.svcCash },
  { key: "revOther", label: "Obyekt (zavod uchun)", of: (r) => r.revOther },
];
const COST: Metric[] = [
  { key: "fuel", label: "Yoqilg'i (norma × narx)", of: (r) => r.fuelSum },
  { key: "repair", label: "Ta'mir", of: (r) => r.repair },
  { key: "parts", label: "Zapchast", of: (r) => r.parts },
  { key: "vulc", label: "Vulkanizator", of: (r) => r.vulc },
  { key: "other", label: "Boshqa", of: (r) => r.other },
];
const costOf = (r: LedgerRow) => r.fuelSum + r.repair + r.parts + r.vulc + r.other;
const EXTRA_IN = "jurnal_kirim", EXTRA_OUT = "jurnal_chiqim";

const rowTitle = (r: LedgerRow) => [r.no || (r.kind === "cost" ? "Reyssiz kun" : "Qo'lda qator"), r.plate, r.driver].filter(Boolean).join(" · ");
const rowSub = (r: LedgerRow) => [r.dropoff ? `${r.pickup} → ${r.dropoff}` : null, r.cargo !== "—" ? r.cargo : null].filter(Boolean).join(" · ");

/**
 * Karta paneli. `href(extra)` — joriy varaq havolasi + `karta`/`tur`/`qator` parametrlari.
 * `extras` — jurnaldagi varaqqa tushmaydigan pul (faqat filtrsiz varaqda, summa huquqi bilan).
 */
export function ledgerCardDrill(key: CardKey, tur: string | null, rows: LedgerRow[], extras: { income: LedgerExtra[]; expense: LedgerExtra[] } | null,
  period: string, href: (p: Record<string, string>) => string): Drill {
  const rowItem = (r: LedgerRow, amount: number): DrillItem => ({ date: r.at, title: rowTitle(r), sub: rowSub(r) || undefined, amount, href: href({ karta: key, ...(tur ? { tur } : {}), qator: r.id }) });
  const extraItem = (x: LedgerExtra, sign = 1): DrillItem => ({
    date: x.at, title: `${x.docNo} · ${x.category}`, sub: [x.account, x.vehicle, x.who, x.note].filter(Boolean).join(" · ") || undefined,
    amount: sign * x.amount, href: href({ karta: key, ...(tur ? { tur } : {}), jt: x.id }),
  });
  const sumOf = (xs: LedgerExtra[]) => xs.reduce((s, x) => s + x.amount, 0);
  const total = (m: Metric) => rows.reduce((s, r) => s + m.of(r), 0);
  const fromMetrics = (ms: Metric[], extra: { key: string; label: string; list: LedgerExtra[] } | null) => {
    const parts: DrillPart[] = ms.map((m) => ({ key: m.key, label: m.label, value: total(m) })).filter((p) => Math.abs(p.value) >= 1);
    if (extra && extra.list.length) parts.push({ key: extra.key, label: extra.label, value: sumOf(extra.list) });
    const pick = tur ? ms.filter((m) => m.key === tur) : ms;
    const items: DrillItem[] = [];
    if (!tur || pick.length) for (const r of rows) { const v = pick.reduce((s, m) => s + m.of(r), 0); if (Math.abs(v) >= 0.5) items.push(rowItem(r, v)); }
    if (extra && (!tur || tur === extra.key)) items.push(...extra.list.map((x) => extraItem(x)));
    return { parts, items };
  };
  const limit = (items: DrillItem[]) => sortDrill(items).slice(0, DRILL_LIMIT);
  const subLabel = (ms: Metric[], extraKey: string, extraLabel: string) => (tur ? (ms.find((m) => m.key === tur)?.label ?? (tur === extraKey ? extraLabel : "")) : "");

  if (key === "tushum") {
    const lbl = "Boshqa kirim (Logistika moliya jurnali)";
    const { parts, items } = fromMetrics(REVENUE, extras ? { key: EXTRA_IN, label: lbl, list: extras.income } : null);
    const value = tur ? items.reduce((s, i) => s + i.amount, 0) : parts.reduce((s, p) => s + p.value, 0);
    const sl = subLabel(REVENUE, EXTRA_IN, lbl);
    return { title: `Jami tushum${sl ? ` — ${sl}` : ""}`, period, value, parts: tur ? [] : parts, items: limit(items),
      note: "Faqat kirimi bor qatorlar. Tarkibdagi qatorni bosing — shu turdagilari, yozuvni bosing — batafsil." };
  }
  if (key === "xarajat") {
    const lbl = "Mashinasiz xarajat (Logistika moliya jurnali)";
    const { parts, items } = fromMetrics(COST, extras ? { key: EXTRA_OUT, label: lbl, list: extras.expense } : null);
    const value = tur ? items.reduce((s, i) => s + i.amount, 0) : parts.reduce((s, p) => s + p.value, 0);
    const sl = subLabel(COST, EXTRA_OUT, lbl);
    return { title: `Xarajat (oyliksiz)${sl ? ` — ${sl}` : ""}`, period, value, parts: tur ? [] : parts, items: limit(items),
      note: "Haydovchi oyligi alohida kartada. Yoqilg'i — norma bo'yicha sarf × zapravka narxi." };
  }
  if (key === "oylik") {
    const items = rows.filter((r) => r.pay > 0).map((r) => ({ ...rowItem(r, r.pay), sub: [r.amount == null ? "narxsiz — taklif" : r.payType ? PAY_TYPE_LABEL[r.payType] : null, r.approvedAt ? "tasdiqlangan" : null, rowSub(r)].filter(Boolean).join(" · ") }));
    return { title: "Haydovchilar oyligi (reys haqi)", period, value: rows.reduce((s, r) => s + r.pay, 0), parts: [], items: limit(items),
      note: "Reys narxi yoki qo'lda yozilgan haq; narxlanmagan reysda — taklif narx." };
  }
  if (key === "jami") {
    const inc = rows.reduce((s, r) => s + r.revenue, 0) + (extras ? sumOf(extras.income) : 0);
    const cost = rows.reduce((s, r) => s + costOf(r), 0) + (extras ? sumOf(extras.expense) : 0);
    const pay = rows.reduce((s, r) => s + r.pay, 0);
    const items: DrillItem[] = rows.filter((r) => Math.abs(r.profit) >= 0.5).map((r) => rowItem(r, r.profit));
    if (extras) items.push(...extras.income.map((x) => extraItem(x)), ...extras.expense.map((x) => extraItem(x, -1)));
    return { title: "Jami (tushum − xarajat − oylik)", period, value: inc - cost - pay,
      parts: [{ key: "tushum", label: "Jami tushum", value: inc }, { key: "xarajat", label: "Xarajat (oyliksiz)", value: -cost }, { key: "oylik", label: "Haydovchilar oyligi", value: -pay }],
      items: limit(items), note: "Har qator: uning tushumi − xarajati − haydovchi haqi." };
  }
  if (key === "reys") {
    return { title: "Reyslar", period, value: rows.reduce((s, r) => s + r.trips, 0), isQty: true, unit: "reys", parts: [],
      items: limit(rows.filter((r) => r.trips > 0).map((r) => rowItem(r, r.trips))) };
  }
  if (key === "probeg") {
    return { title: "Probeg", period, value: rows.reduce((s, r) => s + r.km, 0), isQty: true, unit: "km", parts: [],
      items: limit(rows.filter((r) => r.km > 0).map((r) => rowItem(r, r.km))) };
  }
  // yoqilgi — sarf (norma) va zapravka
  const items = rows.filter((r) => (r.use ?? 0) > 0 || r.refuel > 0).map((r) => ({
    ...rowItem(r, r.use ?? 0), sub: [`zapravka ${fmtNum(r.refuel, 1)} ${r.unit}`, `qoldiq ${fmtNum(r.balAfter, 1)} ${r.unit}`, rowSub(r)].filter(Boolean).join(" · "),
  }));
  return { title: "Yoqilg'i sarfi (norma)", period, value: rows.reduce((s, r) => s + (r.use ?? 0), 0), isQty: true, unit: "m³ / l", parts: [], items: limit(items),
    note: "Miqdor — normaga ko'ra sarf; zapravka va qoldiq izohda." };
}

/** Tarkib qatoridan o'tish: «Jami» da — boshqa karta, qolganlarida — shu tur. */
export function cardPartHref(key: CardKey, href: (p: Record<string, string>) => string) {
  return (part: string) => (key === "jami" ? href({ karta: part }) : href({ karta: key, tur: part }));
}

const Row = ({ label, children, strong, tone }: { label: string; children: React.ReactNode; strong?: boolean; tone?: "red" | "green" }) => (
  <div className={cn("flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0", strong && "font-semibold")}>
    <span className="text-slate-500">{label}</span>
    <span className={cn("text-right tabular text-slate-900", tone === "red" && "text-red-600", tone === "green" && "text-emerald-700")}>{children}</span>
  </div>
);
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><div className="mb-1 text-[13px] font-semibold text-slate-700">{title}</div><div className="rounded-lg border border-slate-200 px-3">{children}</div></div>
);
const sm = (v: number) => (Math.abs(v) >= 1 ? money(v) : "—");

function Modal({ title, sub, closeHref, children, actions }: { title: string; sub?: string; closeHref: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 print:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <Link href={closeHref} scroll={false} aria-label="Yopish" className="absolute inset-0 bg-black/40" />
      <div className="relative flex max-h-[90vh] w-[min(40rem,100%)] flex-col rounded-(--radius-card) bg-white shadow-(--shadow-pop) animate-fade-up">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0"><h2 className="text-[17px] font-bold text-slate-900">{title}</h2>{sub && <div className="mt-0.5 text-sm text-slate-500">{sub}</div>}</div>
          <Link href={closeHref} scroll={false} aria-label="Yopish" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={20} /></Link>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {actions && <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-3">{actions}</div>}
      </div>
    </div>
  );
}

const KIND_LABEL = { trip: "Reys (ECO / tizim)", entry: "Qo'lda qator", cost: "Reyssiz kun — xarajat" } as const;

/** Varaq qatori — batafsil oyna. `money` — summa huquqi (tushum, xarajat, foyda). */
export function LedgerRowDetail({ r, closeHref, showMoney, editHref }: { r: LedgerRow; closeHref: string; showMoney: boolean; editHref: string | null }) {
  const link = "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50";
  return (
    <Modal title={r.no || KIND_LABEL[r.kind]} sub={`${dateTime(r.at)} · ${r.plate}${r.driver ? ` · ${r.driver}` : ""}`} closeHref={closeHref}
      actions={<>
        {r.kind === "trip" && <Link href={`/trips/${r.id}`} className={link}><ExternalLink size={14} /> Reysni ochish</Link>}
        {editHref && <Link href={editHref} scroll={false} className={link}>Varaqda tahrirlash</Link>}
      </>}>
      <div className="flex flex-wrap gap-1.5"><Badge color={r.kind === "trip" ? "blue" : r.kind === "entry" ? "amber" : "slate"}>{KIND_LABEL[r.kind]}</Badge>
        {r.fuelPriceMissing && <Badge color="red">Yoqilg&apos;i narxi yo&apos;q</Badge>}</div>
      <Block title="Ish">
        <Row label="Qayerdan → qayerga">{r.pickup} → {r.dropoff ?? "—"}</Row>
        {r.address && <Row label="Manzil">{r.address}</Row>}
        <Row label="Yuk">{r.cargo}</Row>
        <Row label="Reys">{fmtNum(r.trips, 0)}</Row>
        <Row label="Probeg">{fmtNum(r.km, 0)} km{r.kmGas != null ? ` (gazda ${fmtNum(r.kmGas, 0)})` : ""}</Row>
        {r.workHours != null && <Row label="Baraban soati">{fmtNum(r.workHours, 1)}{r.hoursGas != null ? ` (gazda ${fmtNum(r.hoursGas, 1)})` : ""}</Row>}
      </Block>
      <Block title={`Yoqilg'i, ${r.unit}`}>
        <Row label="Qoldiq (oldin)">{fmtNum(r.balBefore, 1)}</Row>
        <Row label="Zapravka">{fmtNum(r.refuel, 1)}{r.refuelPrice ? ` · ${money(r.refuelPrice)} / ${r.unit}` : ""}</Row>
        <Row label="Sarf (norma)">{r.use != null ? fmtNum(r.use, 1) : "—"}{r.drumUse ? ` (baraban ${fmtNum(r.drumUse, 1)})` : ""}</Row>
        {r.useExtra != null && <Row label="Dizel (qo'shimcha), l">{fmtNum(r.useExtra, 1)}</Row>}
        <Row label="Qoldiq (keyin)" tone={r.balAfter < 0 ? "red" : undefined}>{fmtNum(r.balAfter, 1)}</Row>
      </Block>
      <Block title="Haydovchi haqi (oylik)">
        <Row label="Summa" strong>{sm(r.pay)}</Row>
        <Row label="Holati">{r.amount == null ? (r.pay > 0 ? `narxsiz — taklif${r.suggestText ? ` (${r.suggestText})` : ""}` : "—") : `${r.payType ? PAY_TYPE_LABEL[r.payType] : "—"} · ${r.approvedAt ? `tasdiqlangan ${date(r.approvedAt)}` : "tasdiq kutmoqda"}`}</Row>
      </Block>
      {showMoney && <>
        <Block title="Xarajat">
          <Row label="Yoqilg'i">{sm(r.fuelSum)}</Row><Row label="Ta'mir">{sm(r.repair)}</Row><Row label="Zapchast">{sm(r.parts)}</Row>
          <Row label="Vulkanizator">{sm(r.vulc)}</Row><Row label="Boshqa">{sm(r.other)}</Row><Row label="Haydovchi haqi">{sm(r.pay)}</Row>
          <Row label="Jami xarajat" strong>{sm(r.total)}</Row>
        </Block>
        <Block title="Tushum (bajarilgan ish)">
          {REVENUE.map((m) => Math.abs(m.of(r)) >= 1 ? <Row key={m.key} label={m.label}>{money(m.of(r))}</Row> : null)}
          <Row label="Jami tushum" strong>{sm(r.revenue)}</Row>
        </Block>
        <Row label="Foyda (tushum − xarajat)" strong tone={r.profit < 0 ? "red" : "green"}>{money(r.profit)}</Row>
      </>}
      {r.remarks.length > 0 && <Block title="Izoh">{r.remarks.map((x, i) => <div key={i} className="py-1.5 text-sm text-slate-700">{x}</div>)}</Block>}
    </Modal>
  );
}

/** Logistika moliya jurnali yozuvi — batafsil oyna. */
export function ExtraDetail({ x, closeHref }: { x: LedgerExtra; closeHref: string }) {
  return (
    <Modal title={x.docNo} sub={`${dateTime(x.at)} · ${x.type === "INCOME" ? "Kirim" : "Chiqim"}`} closeHref={closeHref}
      actions={<Link href="/logistika/moliya?tab=jurnal" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"><ExternalLink size={14} /> Jurnalda ochish</Link>}>
      <Block title="Logistika moliya yozuvi">
        <Row label="Toifa">{x.category}</Row>
        <Row label="Summa" strong tone={x.type === "INCOME" ? "green" : undefined}>{money(x.amount)}</Row>
        <Row label="Hisob">{x.account}</Row>
        {x.vehicle && <Row label="Mashina">{x.vehicle}</Row>}
        {x.who && <Row label={x.type === "INCOME" ? "Kimdan" : "Kimga"}>{x.who}</Row>}
        {x.note && <Row label="Izoh">{x.note}</Row>}
        <Row label="Kim yozdi">{x.createdBy}</Row>
      </Block>
      <p className="text-[13px] text-slate-500">Bu pul varaq qatorlariga tushmaydi (reys yoki mashinaga bog&apos;lanmagan), shuning uchun jamiga alohida qo&apos;shilgan.</p>
    </Modal>
  );
}
