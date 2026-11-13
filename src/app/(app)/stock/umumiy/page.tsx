import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, Boxes, ClipboardList, PackageCheck, PackageX, TriangleAlert, Truck, Warehouse } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canSee, pathAllowed } from "@/lib/nav";
import { canSeePrixod, canSeeRasxod } from "@/lib/stock-journal-access";
import { categoriesFor, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { stockOverview } from "@/lib/overview/stock";
import { STOCK_LEVEL_LABEL, stockStatus } from "@/lib/production-report";
import { ownerTurnover } from "@/lib/brigade-products";
import { ostatkaSummary } from "@/lib/ostatka";
import { SUPPLY_COLOR, SUPPLY_LABEL, totalPlanned } from "@/lib/supply";
import { listShipments, shipmentCounts } from "@/lib/shipments";
import { receiptTotal } from "@/lib/receipt-vat";
import { date, fmtNum, isoDate, money, moneyShort, qty } from "@/lib/format";
import { fmtUnitTotals, unitLabel } from "@/lib/unit";
import { DayRangeBar, parseDayRange } from "@/app/(app)/bi-tahlil/month-bar";
import { Badge, Callout, Empty, LinkButton, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import type { SupplyStatus } from "@/generated/prisma";

export const dynamic = "force-dynamic";

const EPS = 0.0005;
const OPEN_SUPPLY: SupplyStatus[] = ["NEW", "PRICED", "APPROVED", "FUNDED"];
const more = (href: string) => <LinkButton href={href} variant="ghost" size="sm">Batafsil <ArrowRight size={14} /></LinkButton>;
const amount = (v: number, unit: string) => `${qty(v)} ${unitLabel(unit)}`;

/**
 * Sklad va ta'minot — umumiy ko'rinish: tanlangan davr (sukut — shu oy) bo'yicha xomashyo qiymati, kirim, chiqim va uning
 * tarkibi, eng ko'p sarflangan xomashyo, kam qolganlar, skladlar kesimi, hovlidagi tayyor mahsulot, ochiq ta'minot
 * zayavkalari, qabul kutayotgan jo'natmalar va so'nggi kirimlar. Faqat o'qish; har blokdan batafsil sahifaga o'tiladi.
 * Raqamlar mavjud hisob-kitobdan: `materialTurnover` («Qoldiqlar»), `stockStatus`, `ownerTurnover` / `ostatkaSummary` (hovli),
 * `listShipments`. Bloklar ko'rinishi — o'sha sahifalarning o'z ruxsati bilan (Kirim jurnali, Hovli, Ta'minot, Jo'natmalar).
 */
export default async function StockOverviewPage({ searchParams }: { searchParams: Promise<{ davr?: string; dan?: string; gacha?: string; oy?: string }> }) {
  const s = await requirePage("/stock/umumiy");
  const period = parseDayRange(await searchParams);
  const last = new Date(period.to); last.setDate(last.getDate() - 1);
  const pq = new URLSearchParams({ from: isoDate(period.from), to: isoDate(last) }).toString();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const cats = categoriesFor(s.role);
  const catLimited = cats.length < MATERIAL_CATEGORIES.length;
  const seePrixod = canSeePrixod(s), seeRasxod = canSeeRasxod(s);
  const seeHolat = canSee(s, "stock", "holat"), seeHovli = canSee(s, "stock", "hovli");
  const seeSupply = pathAllowed("/taminot", s.role, s.perms), seeShip = pathAllowed("/jonatma", s.role, s.perms);
  const seeReceiptDoc = pathAllowed("/receipts", s.role, s.perms);
  const viewer = { userId: s.userId, role: s.role };
  const recWhere = { date: { gte: period.from, lt: period.to }, ...(catLimited ? { items: { some: { material: { category: { in: cats } } } } } : {}) };

  const [ov, status, yard, ostatka, supply, ships, shipCount, recCount, receipts] = await Promise.all([
    stockOverview({ from: period.from, to: period.to, cats }),
    stockStatus(),
    seeHovli ? ownerTurnover({ from: period.from, to: period.to }) : null,
    seeHovli ? ostatkaSummary() : null,
    seeSupply
      ? db.supplyRequest.findMany({
          where: { status: { in: OPEN_SUPPLY } }, orderBy: [{ needBy: "asc" }, { date: "asc" }],
          select: { id: true, docNo: true, status: true, needBy: true, deliveryCost: true, warehouse: { select: { name: true } }, items: { select: { qty: true, price: true, name: true } } },
        })
      : null,
    seeShip ? listShipments("open", viewer, { take: 5 }) : null,
    seeShip ? shipmentCounts(viewer) : null,
    db.goodsReceipt.count({ where: { ...recWhere, cancelledAt: null } }),
    seePrixod
      ? db.goodsReceipt.findMany({
          where: recWhere, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 6,
          select: { id: true, docNo: true, date: true, cancelledAt: true, supplier: { select: { name: true } }, warehouse: { select: { name: true } }, items: { select: { qty: true, price: true, vatAmount: true, deliveryCost: true } } },
        })
      : null,
  ]);

  // Xomashyo havolalari — Sklad sahifasi o'sha davr bilan
  const xomHref = `/stock?bolim=xomashyo&${pq}`;
  const t = ov.total;
  const allowed = new Set(ov.materials.map((m) => m.id));
  const low = status.filter((m) => m.level !== "ok" && allowed.has(m.id));
  const shortN = low.filter((m) => m.level === "short").length;
  const topOut = ov.materials.filter((m) => m.out.s > 0.5 || m.out.q > EPS).sort((a, b) => b.out.s - a.out.s || b.out.q - a.out.q).slice(0, 8);
  const inSum = ov.flows.filter((f) => f.inbound).reduce((a, f) => a + f.sum, 0);
  const outSum = ov.flows.filter((f) => !f.inbound).reduce((a, f) => a + f.sum, 0);

  const yardRows = (yard?.rows ?? []).filter((r) => r.total.close > EPS || r.total.in > EPS || r.total.out > EPS).sort((a, b) => b.total.close - a.total.close);
  const yardStock = yardRows.filter((r) => r.total.close > EPS);
  const yardShort = (ostatka ?? []).filter((p) => p.shortage > EPS);
  const owned = (ostatka ?? []).filter((p) => p.owned > EPS).map((p) => ({ unit: p.unit, qty: p.owned }));
  const free = (ostatka ?? []).filter((p) => p.free > EPS).map((p) => ({ unit: p.unit, qty: p.free }));

  const supplyRows = (supply ?? []).map((r) => ({ ...r, total: totalPlanned(r), late: !!r.needBy && r.needBy < today }));
  const supplySum = supplyRows.reduce((a, r) => a + r.total, 0);
  const supplyLate = supplyRows.filter((r) => r.late).length;
  const pendingLines = (ships ?? []).reduce((a, r) => a + r.pending, 0);

  return (
    <div>
      <PageHeader title="Sklad — umumiy ko'rinish" back={{ href: "/stock", label: "Sklad" }}
        subtitle="Xomashyo qoldig'i, davrdagi kirim-chiqim, skladlar, hovli va ta'minot — bir joyda. Har blokdan batafsil sahifaga o'ting." />
      <DayRangeBar base="/stock/umumiy" range={period} />
      {catLimited && <Callout tone="info">Faqat {cats.map((c) => MATERIAL_CATEGORY_LABEL[c]).join(" va ")} kategoriyalari ko&apos;rsatilmoqda.</Callout>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Xomashyo qiymati (davr oxiri)" value={(t.approx ? "≈ " : "") + moneyShort(t.value)} hint={`${fmtNum(t.positions)} xil xomashyo qoldiqda`} icon={Warehouse} tone="brand" href={xomHref} />
        <StatCard label="Davrda kirim" value={moneyShort(t.in)} hint={`${fmtNum(recCount)} ta kirim hujjati · tannarxda`} icon={ArrowDownToLine} tone="success" href={xomHref} />
        <StatCard label="Davrda chiqim" value={moneyShort(t.out)} hint="zames, brigada, oluvchi, spisanie · tannarxda" icon={ArrowUpFromLine} href={xomHref} />
        <StatCard label="Kam qolgan xomashyo" value={`${low.length} ta`} hint={shortN ? `${shortN} tasi zayavka yoki 3 kunga yetmaydi` : "hozirgi qoldiq bo'yicha"} icon={TriangleAlert} tone={shortN ? "danger" : low.length ? "warning" : "default"} href={seeHolat ? "/stock?bolim=holat" : xomHref} />
        {seeSupply && <StatCard label="Ochiq ta'minot zayavkalari" value={`${supplyRows.length} ta`} hint={`${moneyShort(supplySum)}${supplyLate ? ` · ${supplyLate} tasi muddati o'tgan` : ""}`} icon={ClipboardList} tone={supplyLate ? "warning" : "default"} href="/taminot" />}
        {seeShip && shipCount && <StatCard label="Qabul kutayotgan jo'natmalar" value={`${shipCount.open} ta`} hint={pendingLines ? `${pendingLines} qator tekshirilmagan` : "skladda tekshiriladi"} icon={Truck} tone={shipCount.open ? "warning" : "default"} href="/jonatma?tab=open" />}
        {seeHovli && <StatCard label="Hovlidagi tayyor mahsulot" value={`${yardStock.length} xil`} hint={fmtUnitTotals(yardStock.map((r) => ({ unit: r.unit, qty: r.total.close })))} icon={Boxes} href={`/stock?bolim=hovli&${pq}`} />}
        {seeHovli && <StatCard label="Zayavkalarga band (hovli)" value={owned.length ? fmtUnitTotals(owned) : "0"} hint={`erkin: ${fmtUnitTotals(free)}${yardShort.length ? ` · ${yardShort.length} xil yetmaydi` : ""}`} icon={PackageCheck} tone={yardShort.length ? "warning" : "default"} href={`/stock?bolim=hovli&${pq}`} />}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Section title="Kirim va chiqim tarkibi" className="mt-0" action={more(seeRasxod ? `/stock/rasxod?${pq}` : xomHref)}>
          <Table>
            <thead><tr><Th>Harakat turi</Th><Th right>Harakatlar</Th><Th right>Summa</Th></tr></thead>
            <tbody>
              {ov.flows.length === 0 && <Empty text="Davrda xomashyo harakati yo'q" />}
              {ov.flows.map((f) => (
                <Tr key={f.key}>
                  <Td><Badge color={f.inbound ? "green" : "red"}>{f.inbound ? "Kirim" : "Chiqim"}</Badge> <span className="ml-1">{f.label}</span></Td>
                  <Td right>{fmtNum(f.moves)}</Td>
                  <Td right>{money(f.sum)}</Td>
                </Tr>
              ))}
              {ov.flows.length > 0 && <>
                <Tr className="font-semibold"><Td>Jami kirim</Td><Td /><Td right className="text-emerald-700">{money(inSum)}</Td></Tr>
                <Tr className="font-semibold"><Td>Jami chiqim</Td><Td /><Td right className="text-red-600">{money(outSum)}</Td></Tr>
              </>}
            </tbody>
          </Table>
        </Section>

        <Section title="Eng ko'p sarflangan xomashyo" className="mt-0" action={more(xomHref)}>
          <Table>
            <thead><tr><Th>Xomashyo</Th><Th right>Sarf</Th><Th right>Summa</Th><Th right>Qoldiq</Th></tr></thead>
            <tbody>
              {topOut.length === 0 && <Empty text="Davrda sarf yo'q" icon={ArrowUpFromLine} />}
              {topOut.map((m) => (
                <Tr key={m.id}>
                  <Td><Link href={`/stock?tab=moves&material=${m.id}&${pq}`} className="font-medium hover:underline">{m.name}</Link></Td>
                  <Td right>{amount(m.out.q, m.unit)}</Td>
                  <Td right>{money(m.out.s)}</Td>
                  <Td right className={m.close.q < m.minStock ? "font-semibold text-red-600" : undefined}>{amount(m.close.q, m.unit)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Kam qolgan xomashyo (hozir)" className="mt-0" action={more(seeHolat ? "/stock?bolim=holat" : xomHref)}>
          <Table>
            <thead><tr><Th>Xomashyo</Th><Th right>Qoldiq</Th><Th right>Kerak</Th><Th right>Yetadi</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {low.length === 0 && <Empty text="Hamma xomashyo yetarli" icon={PackageCheck} />}
              {low.slice(0, 8).map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium">{m.name}</Td>
                  <Td right>{amount(m.balance, m.unit)}</Td>
                  <Td right>{m.need > EPS ? amount(m.need, m.unit) : "—"}</Td>
                  <Td right>{m.days === null ? "—" : `${fmtNum(m.days, 1)} kun`}</Td>
                  <Td><Badge color={m.level === "short" ? "red" : "amber"}>{STOCK_LEVEL_LABEL[m.level]}</Badge></Td>
                </Tr>
              ))}
              {low.length > 8 && <Tr><Td colSpan={5} className="text-slate-500">yana {low.length - 8} ta — batafsil sahifada</Td></Tr>}
            </tbody>
          </Table>
        </Section>

        <Section title="Skladlar bo'yicha" className="mt-0" action={more(xomHref)}>
          <Table>
            <thead><tr><Th>Sklad</Th><Th right>Xomashyo</Th><Th right>Qiymat</Th><Th right>Kirim</Th><Th right>Chiqim</Th></tr></thead>
            <tbody>
              {ov.warehouses.length === 0 && <Empty text="Sklad yo'q" icon={Warehouse} />}
              {ov.warehouses.map((w) => (
                <Tr key={w.id}>
                  <Td>
                    <Link href={`/stock?bolim=xomashyo&wh=${w.id}&${pq}`} className="font-medium hover:underline">{w.name}</Link>
                    {w.isDefault && <span className="ml-2"><Badge color="green">Asosiy</Badge></span>}
                    {!w.isActive && <span className="ml-2"><Badge color="slate">Yopiq</Badge></span>}
                  </Td>
                  <Td right>{fmtNum(w.positions)} xil</Td>
                  <Td right className="font-semibold">{money(w.value)}</Td>
                  <Td right className="text-emerald-700">{moneyShort(w.in)}</Td>
                  <Td right className="text-red-600">{moneyShort(w.out)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        {seeHovli && (
          <Section title="Hovli — tayyor mahsulot" className="mt-0" action={more(`/stock?bolim=hovli&${pq}`)}>
            <Table>
              <thead><tr><Th>Mahsulot</Th><Th right>Kirim</Th><Th right>Chiqim</Th><Th right>Qoldiq</Th></tr></thead>
              <tbody>
                {yardRows.length === 0 && <Empty text="Hovlida mahsulot yo'q" icon={Boxes} />}
                {yardRows.slice(0, 8).map((r) => (
                  <Tr key={r.productId}>
                    <Td className="font-medium">{r.name}{yardShort.some((p) => p.id === r.productId) && <span className="ml-2"><Badge color="amber">Zayavkaga yetmaydi</Badge></span>}</Td>
                    <Td right className="text-emerald-700">{r.total.in > EPS ? amount(r.total.in, r.unit) : "—"}</Td>
                    <Td right className="text-red-600">{r.total.out > EPS ? amount(r.total.out, r.unit) : "—"}</Td>
                    <Td right className="font-semibold">{amount(r.total.close, r.unit)}</Td>
                  </Tr>
                ))}
                {yardRows.length > 8 && <Tr><Td colSpan={4} className="text-slate-500">yana {yardRows.length - 8} xil — batafsil sahifada</Td></Tr>}
              </tbody>
            </Table>
          </Section>
        )}

        {seeSupply && (
          <Section title="Ta'minot zayavkalari (ochiq)" className="mt-0" action={more("/taminot")}>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {OPEN_SUPPLY.map((st) => <Badge key={st} color={SUPPLY_COLOR[st]}>{SUPPLY_LABEL[st]}: {supplyRows.filter((r) => r.status === st).length}</Badge>)}
            </div>
            <Table>
              <thead><tr><Th>№</Th><Th>Holat</Th><Th>Kerak sana</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {supplyRows.length === 0 && <Empty text="Ochiq zayavka yo'q" icon={ClipboardList} />}
                {supplyRows.slice(0, 6).map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/taminot/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link>
                      <div className="max-w-56 truncate text-xs text-slate-400">{r.items.map((i) => i.name).join(", ")}</div>
                    </Td>
                    <Td><Badge color={SUPPLY_COLOR[r.status]}>{SUPPLY_LABEL[r.status]}</Badge></Td>
                    <Td className={r.late ? "font-semibold text-red-600" : "text-slate-600"}>{r.needBy ? date(r.needBy) : "—"}</Td>
                    <Td right>{money(r.total)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        )}

        {seeShip && ships && (
          <Section title="Qabul kutayotgan jo'natmalar" className="mt-0" action={more("/jonatma?tab=open")}>
            <Table>
              <thead><tr><Th>№</Th><Th>Sana</Th><Th>Yetkazuvchi</Th><Th right>Qatorlar</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {ships.length === 0 && <Empty text="Qabul kutayotgan jo'natma yo'q" icon={Truck} />}
                {ships.map((r) => (
                  <Tr key={r.id}>
                    <Td><Link href={`/jonatma/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                    <Td className="whitespace-nowrap">{date(r.date)}</Td>
                    <Td className="text-slate-600">{r.supplier}</Td>
                    <Td right>{r.pending} / {r.lines}</Td>
                    <Td right>{money(r.total)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        )}

        {receipts && (
          <Section title="So'nggi kirimlar" className="mt-0" action={more(`/stock/prixod?${pq}`)}>
            <Table>
              <thead><tr><Th>№</Th><Th>Sana</Th><Th>Yetkazuvchi</Th><Th>Sklad</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {receipts.length === 0 && <Empty text="Davrda kirim yo'q" icon={PackageX} />}
                {receipts.map((r) => (
                  <Tr key={r.id} className={r.cancelledAt ? "text-slate-400 line-through" : undefined}>
                    <Td>{seeReceiptDoc ? <Link href={`/receipts/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link> : <span className="font-medium">{r.docNo}</span>}</Td>
                    <Td className="whitespace-nowrap">{date(r.date)}</Td>
                    <Td>{r.supplier.name}</Td>
                    <Td>{r.warehouse.name}</Td>
                    <Td right>{money(receiptTotal(r.items))}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        )}
      </div>
    </div>
  );
}
