import Link from "next/link";
import { db } from "@/lib/db";
import { qty, money, dateTime, dateRu, fmtNum } from "@/lib/format";
import { lastInboundMoves } from "@/lib/stock";
import { materialTurnover } from "@/lib/stock-turnover";
import { productionCapacity } from "@/lib/production-capacity";
import { ostatkaSummary } from "@/lib/ostatka";
import { unitLabel, unitShort } from "@/lib/unit";
import { canSeePrixod, canSeeRasxod } from "@/lib/stock-journal-access";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { Badge, Callout, Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Sheet, SheetHead, SheetTh, SheetTd, SheetTr, SheetFoot } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Boxes, Factory, PackagePlus, ChevronRight, ClipboardList, HardHat, ScanLine, ScanText, PackageMinus, ArrowDownToLine, ArrowUpFromLine, Warehouse } from "lucide-react";
import { visionEnabled } from "@/lib/ai/vision";
import { brigadeStocks, undistributedMaterials } from "@/lib/brigade-stock";
import { StockPeriodBar, stockPeriod } from "@/components/stock-period";
import { BrigadeDistributeForm, BrigadeReturnForm } from "./brigade-form";
import { MaterialBulkBar } from "./material-bulk";
import { FillPricesButton, PriceCell } from "./price-cell";
import { ExcelButton } from "../logistika/excel-button";
import { moduleWriteAllowed } from "@/lib/auth";
import { MATERIAL_CATALOG_ROLES } from "@/lib/catalog";
import { Card, CardHeader } from "@/components/ui";
import { HoldingsPanel } from "@/components/holdings-panel";
import { holdingsOverview } from "@/lib/holdings";
import { CATEGORY_SLUG, MATERIAL_CATEGORY_LABEL, MATERIAL_CATEGORY_OPTIONS, categoriesFor, categoryFromSlug } from "@/lib/material-category";
import { avtoPartsFeed } from "@/lib/avto-parts";
import { ForYouParts } from "./for-you-parts";

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: "Kirim", PRODUCTION_CONSUME: "Zames chiqimi", PRODUCTION_OUTPUT: "Ishlab chiqarildi",
  SHIPMENT: "Jo'natish", ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Hisobdan chiqarish",
  BRIGADE_ISSUE: "Brigadaga berildi", BRIGADE_RETURN: "Brigadadan qaytdi", ISSUE: "Chiqim",
};
const EPS = 0.0005;
/** «Qoldiqlar» kataklari: miqdor — 3 kasrgacha, summa — butun so'm («so'm» qo'shilmaydi). Nol — bo'sh (Excel'dagidek). */
const cellQ = (v: number) => (Math.abs(v) < EPS ? "" : fmtNum(v, 3));
const cellS = (v: number) => (Math.abs(v) < 0.5 ? "" : fmtNum(v, 0));
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Xomashyo qoldig'i jadvalidagi belgilar shu formaga tegishli (`MaterialBulkBar`). */
const MATERIAL_FORM = "material-bulk";
const REF_LINK: Record<string, string> = { GoodsReceipt: "/receipts", ProductionBatch: "/production", Trip: "/trips" };
const REF_LABEL: Record<string, string> = { GoodsReceipt: "Kirim", ProductionBatch: "Zames", Trip: "Reys", Manual: "Qo'lda", StockIn: "Sklad kirimi", Brigade: "Brigada", Inventory: "Inventarizatsiya", WriteOff: "Hisobdan chiqarish", BrigadeTask: "Topshiriq" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string; added?: string; updated?: string; moved?: string; guessed?: string; ref?: string; from?: string; to?: string; wh?: string; material?: string; receipt?: string; kat?: string }> }) {
  const s = await requirePage("/stock");
  const sp = await searchParams;
  const { tab = "balance", added, updated, moved, guessed, ref, material } = sp;
  const canAdd = ["PRODUCTION", "WAREHOUSE", "PROCUREMENT", "DIRECTOR"].includes(s?.role ?? "");
  // Belgilab o'chirish — xomashyo spravochnigi bilan bir xil huquq (`deleteMaterials` → requireModuleWrite)
  const canDelete = moduleWriteAllowed(s, "stock", MATERIAL_CATALOG_ROLES) === true;
  // «Dona narxi» — Snabjeniye (stock → "price"), direktor va u ruxsat bergan xodim
  const canPrice = canDo(s, "stock", "price");
  // «Qoldiqlar» va xomashyo harakatlari davri (?from&to, standart — joriy oy); sklad filtri (?wh)
  const period = stockPeriod(sp);
  const toIncl = new Date(period.to); toIncl.setDate(toIncl.getDate() - 1);
  // «Kimda nima bor» — brigadalar qo'lida va xodim/oluvchilar shu oy olgani (Qoldiqlar oynasida, yig'ilgan holda)
  const holdings = tab === "balance" ? await holdingsOverview() : null;
  const [materials, mSums, whSums, allWarehouses] = await Promise.all([
    tab === "brigades" ? db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }) : [],
    tab === "balance" ? db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }) : [],
    tab === "balance" || tab === "brigades" ? db.stockMove.groupBy({ by: ["materialId", "warehouseId"], where: { materialId: { not: null } }, _sum: { qty: true } }) : [],
    tab === "balance" || tab === "moves" ? db.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { id: "asc" }], select: { id: true, name: true, isActive: true } }) : [],
  ]);
  // Joriy (butun, davrdan qat'i nazar) qoldiq — o'chirish tasdig'i (`data-stock`) uchun
  const mb = new Map(mSums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  // Bir nechta sklad bo'lsa — «Qoldiqlar» sklad bo'yicha ham ko'riladi: zames, brigadaga berish va spisanie
  // AYNAN tanlangan skladdan yechadi, faqat jami ko'rinsa "qoldiq bor, lekin yetmaydi" chalkashligi chiqardi
  const shownWarehouses = allWarehouses.filter((w) => w.isActive || whSums.some((x) => x.warehouseId === w.id && Math.abs(Number(x._sum.qty ?? 0)) > EPS));
  const perWarehouse = shownWarehouses.length > 1;
  const wh = allWarehouses.find((w) => w.id === sp.wh) ?? null;

  // «Qoldiqlar» — xomashyo aylanmasi (Excel XOMASHYO jadvali) va oxirgi kirim (kim, qachon — nom ustida)
  // Kategoriya (?kat=zavod|avto|xomashyo): mexanik faqat Avto zapchast va Xomashyoni ko'radi (`categoriesFor`)
  const cats = categoriesFor(s?.role);
  const katWant = categoryFromSlug(sp.kat);
  const kat = katWant && cats.includes(katWant) ? katWant : null;
  const [turnoverAll, last] = tab === "balance"
    ? await Promise.all([materialTurnover({ from: period.from, to: period.to, warehouseId: wh?.id }), lastInboundMoves()])
    : [[], null] as [Awaited<ReturnType<typeof materialTurnover>>, null];
  const turnoverSeen = turnoverAll.filter((r) => cats.includes(r.category));
  const turnover = kat ? turnoverSeen.filter((r) => r.category === kat) : turnoverSeen;
  // Mexanik «Siz uchun» — faqat Avto zapchastlar: joriy qoldiq va oxirgi kelganlari
  const forYou = tab === "balance" && s?.role === "MECHANIC" ? await avtoPartsFeed(30) : null;
  const activeRows = turnover.filter((r) => r.isActive).length;
  const noPrice = turnover.filter((r) => r.isActive && r.unitPrice == null && (r.avgCost ?? 0) > 0).length;
  const tot = turnover.reduce((a, r) => ({ open: a.open + r.open.s, in: a.in + r.in.s, out: a.out + r.out.s, close: a.close + r.close.s, approx: a.approx || r.approx }), { open: 0, in: 0, out: 0, close: 0, approx: false });
  // Excel — barcha ustunlar (ekrandagi kabi) + «Jami» qatori; raqamlar raqam bo'lib (Excel'da qo'shib bo'lsin).
  // Sarlavha va matnlar o'zbekcha — ExcelButton ularni ekrandagi tilga o'giradi
  const openH = `${dateRu(period.from)} holatiga qoldiq`, closeH = `${dateRu(toIncl)} oxiridagi qoldiq`;
  const excelRows: Record<string, string | number | null>[] = turnover.map((r, i) => ({
    "№": i + 1, "Nomi": r.name, "Kod": r.code, "Kategoriya": MATERIAL_CATEGORY_LABEL[r.category], "Birlik": unitShort(r.unit),
    "Dona narxi": r.unitPrice, "O'rtacha tannarx": r.avgCost == null ? null : r2(r.avgCost),
    [`${openH}, miqdor`]: r.open.q, [`${openH}, summa`]: r.open.s,
    "Kirim, miqdor": r.in.q, "Kirim, summa": r.in.s,
    "Chiqim, miqdor": r.out.q, "Chiqim, summa": r.out.s,
    [`${closeH}, miqdor`]: r.close.q, [`${closeH}, jami summa`]: r.close.s,
    "Minimal qoldiq": r.minStock, "Baholash": r.approx ? "≈ narxsiz qismi bor" : "", "Holat": r.isActive ? "" : "arxiv",
  }));
  if (turnover.length) excelRows.push({
    "№": null, "Nomi": "Jami", "Kod": "", "Kategoriya": "", "Birlik": "", "Dona narxi": null, "O'rtacha tannarx": null,
    [`${openH}, miqdor`]: null, [`${openH}, summa`]: r2(tot.open), "Kirim, miqdor": null, "Kirim, summa": r2(tot.in),
    "Chiqim, miqdor": null, "Chiqim, summa": r2(tot.out), [`${closeH}, miqdor`]: null, [`${closeH}, jami summa`]: r2(tot.close),
    "Minimal qoldiq": null, "Baholash": tot.approx ? "≈" : "", "Holat": "",
  });
  const periodQs = (extra: Record<string, string> = {}) => new URLSearchParams({ from: period.fromStr, to: period.toStr, ...(wh ? { wh: wh.id } : {}), ...(kat ? { kat: CATEGORY_SLUG[kat] } : {}), ...extra }).toString();

  // `ref` berilsa — faqat shu hujjat/partiya qatorlari (Kirim-Chiqimdan "batafsil" shu yerga olib keladi);
  // `material` — «Qoldiqlar» qatoridan: shu xomashyoning davrdagi harakatlari (sklad tanlangan bo'lsa — shu skladda)
  const moveMaterial = tab === "moves" && !ref && material
    ? await db.material.findUnique({ where: { id: material }, select: { id: true, name: true, unit: true } })
    : null;
  const movesWhere = ref ? { refId: ref }
    : moveMaterial ? { materialId: moveMaterial.id, ...(sp.from || sp.to ? { date: { gte: period.from, lt: period.to } } : {}), ...(wh ? { warehouseId: wh.id } : {}) }
    : undefined;
  const moves = tab === "moves"
    ? await db.stockMove.findMany({ where: movesWhere, orderBy: moveMaterial ? { date: "desc" } : { createdAt: "desc" }, take: ref || moveMaterial ? 500 : 300, include: { material: true, product: true, warehouse: true, createdBy: true, recipient: { select: { name: true } }, employee: { select: { fullName: true } } } })
    : [];
  // Ishlab chiqarish imkoni: hozirgi xomashyo qoldig'i bilan har mahsulotdan qancha chiqadi;
  // shu yerda hovlida turgan dona mahsulot (erkin/band) va tayyor beton qoldig'i ham ko'rsatiladi
  const [capacity, pieces, concrete, cSums] = tab === "capacity"
    ? await Promise.all([
        productionCapacity(),
        ostatkaSummary(),
        db.product.findMany({ where: { isActive: true, unit: "m3" }, orderBy: { code: "asc" } }),
        db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
      ])
    : [[], [], [], []] as [Awaited<ReturnType<typeof productionCapacity>>, Awaited<ReturnType<typeof ostatkaSummary>>, [], []];
  const cb = new Map(cSums.map((x) => [x.productId, Number(x._sum.qty ?? 0)]));
  // Yangi kelgan ta'minot (oxirgi 7 kun): "yangi mahsulotlar keldi" belgisi va brigadaga taqsimlash taklifi
  // Kelgan, lekin hali brigadalarga berilmagan mahsulotlar — Brigadalar ko'rinishi sarlavhasida
  const undistributed = tab === "brigades" ? await undistributedMaterials() : { count: 0, names: [] as string[] };
  const arrivals = await db.supplyRequest.findMany({
    where: { status: "RECEIVED", updatedAt: { gte: new Date(Date.now() - 7 * 864e5) } },
    orderBy: { updatedAt: "desc" }, take: 5,
    include: { items: true, receipt: { select: { id: true, docNo: true } } },
  });
  // Brigadalar tabi: qoldiq, ishlab chiqarish imkoni va taqsimlash formasi
  const [brigStocks, warehouses] = tab === "brigades"
    ? await Promise.all([
        brigadeStocks(),
        db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
      ])
    : [[], []] as [Awaited<ReturnType<typeof brigadeStocks>>, { id: string; name: string }[]];
  // Tanlangan skladdagi qoldiq — forma «Skladda» va «Qoladi» ni shu skladdan hisoblaydi (berish ham aynan shu skladdan)
  const byWh = new Map<string, Record<string, number>>();
  if (tab === "brigades") for (const x of whSums) {
    if (!x.materialId) continue;
    const r = byWh.get(x.materialId) ?? {};
    r[x.warehouseId] = Number(x._sum.qty ?? 0);
    byWh.set(x.materialId, r);
  }
  // Kirim hujjatidan ochilgan (?receipt=): shu kirim qatorlari oldindan to'ldiriladi — miqdor kelganicha,
  // lekin shu skladdagi joriy qoldiqdan oshmaydi (bir qismi allaqachon berilgan/sarflangan bo'lishi mumkin)
  const fromReceipt = tab === "brigades" && sp.receipt
    ? await db.goodsReceipt.findUnique({ where: { id: sp.receipt }, select: { id: true, docNo: true, warehouseId: true, cancelledAt: true, items: { select: { materialId: true, qty: true } } } })
    : null;
  const distributeInitial = fromReceipt && !fromReceipt.cancelledAt && warehouses.some((w) => w.id === fromReceipt.warehouseId)
    ? {
        warehouseId: fromReceipt.warehouseId, note: `${fromReceipt.docNo} kirimidan`,
        qty: Object.fromEntries([...fromReceipt.items.reduce((m, i) => m.set(i.materialId, (m.get(i.materialId) ?? 0) + Number(i.qty)), new Map<string, number>())]
          .map(([id, q]) => [id, Math.round(Math.min(q, byWh.get(id)?.[fromReceipt.warehouseId] ?? 0) * 1000) / 1000] as const)
          .filter(([, q]) => q > EPS)),
      }
    : undefined;

  const canMakeBy = new Map(capacity.map((c) => [c.productId, c]));
  // Ishlab chiqarish imkoni doskalari: eng kam qolgan (chiqarish mumkin bo'lgan) mahsulot tepada
  const capacitySorted = [...capacity].sort((a, b) => a.canMake - b.canMake || a.product.localeCompare(b.product));
  const piecesSorted = [...pieces].sort((a, b) => a.free - b.free || a.total - b.total || a.name.localeCompare(b.name));
  const concreteSorted = [...concrete].sort((a, b) => (canMakeBy.get(a.id)?.canMake ?? Infinity) - (canMakeBy.get(b.id)?.canMake ?? Infinity));
  const pieceTotals = pieces.reduce((a, r) => ({ total: a.total + r.total, free: a.free + r.free, owned: a.owned + r.owned }), { total: 0, free: 0, owned: 0 });

  return (
    <div>
      <PageHeader title="Sklad" subtitle="Xomashyo qoldig'i — ishlab chiqarishning asosi: retseptlar shu xomashyolardan tuziladi, imkoniyat qoldiqqa qarab hisoblanadi."
        action={
          <div className="flex flex-wrap gap-2">
            {/* «Kirim» / «Chiqim» jurnallari (Excel'dagidek) — xarid narxlari bor: faqat `lib/stock-journal-access` rollariga */}
            {canSeePrixod(s) && <LinkButton href="/stock/prixod" variant="success" size="lg"><ArrowDownToLine size={18} /> <span>Kirim</span></LinkButton>}
            {canSeeRasxod(s) && <LinkButton href="/stock/rasxod" variant="danger" size="lg"><ArrowUpFromLine size={18} /> <span>Chiqim</span></LinkButton>}
            {/* Kelgan xomashyoni brigadalarga taqsimlash — sklad xodimining kundalik ishi, menyuda tab yo'q */}
            {canDo(s, "stock", "brigade") && <LinkButton href="/stock?tab=brigades" variant="secondary" size="lg"><HardHat size={18} /> <span>Brigadalarga berish</span></LinkButton>}
            {/* Nakladnoy rasmi → Kirim formasi o'zi to'ladi (AI kaliti bo'lsa) */}
            {canSeePrixod(s) && canDo(s, "stock", "receipt") && visionEnabled() && <LinkButton href="/stock/prixod/new?scan=1" variant="secondary" size="lg"><ScanText size={18} /> <span>Nakladnoyni skanerlash</span></LinkButton>}
            {canAdd && <>
            {/* Zaxiraga ishlab chiqarish: mijozsiz zayavka — tayyor mahsulot hovlida erkin qoldiq bo'lib turadi */}
            <LinkButton href="/orders/new?tur=sklad" variant="secondary"><Factory size={16} /> Zaxiraga zayavka</LinkButton>
            <LinkButton href="/stock/materials/new" variant="secondary"><PackagePlus size={16} /> Xomashyo qo&apos;shish</LinkButton>
            {/* Qoldiqni faqat hujjat bilan o'zgartirish: sanab chiqish farqi va hisobdan chiqarish (sabab majburiy) */}
            <LinkButton href="/stock/inventarizatsiya" variant="secondary"><ScanLine size={16} /> Inventarizatsiya</LinkButton>
            <LinkButton href="/stock/spisanie" variant="secondary"><PackageMinus size={16} /> Hisobdan chiqarish</LinkButton>
            {/* Kerakli mahsulotlar jadvali — snabjeniye zanjirining boshi */}
            <LinkButton href="/stock/supply/new"><ClipboardList size={16} /> Kerakli mahsulotlar</LinkButton>
            </>}
            {/* Mexanik skladdan faqat snabjenetsga zayavka yuboradi (texnika ehtiyoji) — qolgan sklad amallari unga yopiq */}
            {s?.role === "MECHANIC" && <LinkButton href="/stock/supply/new"><ClipboardList size={16} /> Snabjenetsga zayavka</LinkButton>}
          </div>
        } />
      {/* Sklad kabinetida faqat «Qoldiqlar». «Ishlab chiqarish imkoni», «Brigadalar» va harakatlar ko'rinishi tab sifatida
          olib tashlangan, lekin boshqa bo'limlardagi havolalar (Brigadalar, Ta'minot, Zayavka, BI, xomashyo qatori) uchun ochiladi */}
      {tab !== "balance" && !(tab === "moves" && (ref || moveMaterial)) && (
        <Link href="/stock" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">← <span>Qoldiqlar</span></Link>
      )}
      {added != null && (
        <Callout tone="success" title="Xomashyo qo'shildi">Yangi: {added} ta · yangilandi: {updated ?? 0} ta · boshlang&apos;ich qoldiq yozildi: {moved ?? 0} ta.{Number(guessed) > 0 && ` ${guessed} ta xomashyoning birligi faylda tanilmadi — "dona" qo'yildi, Sozlamalardan tuzatsangiz bo'ladi.`}</Callout>
      )}

      {arrivals.length > 0 && (tab === "balance" || tab === "brigades") && (
        <Callout tone="success" title={`Yangi mahsulotlar keldi — ${arrivals.length} ta ta'minot qabul qilindi`}>
          <ul className="space-y-0.5">
            {arrivals.map((a) => (
              <li key={a.id}>
                <Link href={`/taminot/${a.id}`} className="font-medium underline">{a.docNo}</Link>
                {" · "}{a.items.length} qator{a.receipt ? <> · kirim <Link href={`/receipts/${a.receipt.id}`} className="underline">{a.receipt.docNo}</Link></> : null}
                {" · "}{money(a.items.reduce((x, i) => x + Number(i.factQty ?? i.qty) * Number(i.factPrice ?? i.price), 0))}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {tab === "brigades" && fromReceipt && (
        distributeInitial
          ? <Callout tone="info" title={`${fromReceipt.docNo} kirimi bo'yicha taqsimlash`}>
              {Object.keys(distributeInitial.qty).length > 0
                ? <>Kirim qatorlari jadvalga qo&apos;yildi ({Object.keys(distributeInitial.qty).length} ta) — har biriga brigada tanlang, kerak bo&apos;lsa «+» bilan bir nechta brigadaga bo&apos;ling.</>
                : "Bu kirimdagi xomashyo skladda qolmagan — allaqachon berilgan yoki sarflangan."}
            </Callout>
          : <Callout tone="warning" title={`${fromReceipt.docNo} kirimi`}>{fromReceipt.cancelledAt ? "Kirim bekor qilingan — taqsimlanmaydi." : "Kirim skladi yopilgan — jadvaldan qo'lda tanlang."}</Callout>
      )}
      {tab === "brigades" && (
        <div className="space-y-5">
          <Card padded={false}>
            <div className="p-5">
              <CardHeader icon={HardHat}
                title={undistributed.count > 0 ? `Brigadaga xomashyo berish · ${undistributed.count} ta mahsulot hali berilmagan` : "Brigadaga xomashyo berish"}
                description={undistributed.count > 0
                  ? `Taqsimlanmagan: ${undistributed.names.slice(0, 6).join(", ")}${undistributed.names.length > 6 ? ` va yana ${undistributed.names.length - 6} ta` : ""}. Berilgani sklad qoldig'idan chiqadi, brigada qoldig'iga o'tadi.`
                  : "Kelgan mahsulotlarni brigadalarga taqsimlaysiz: berilgani sklad qoldig'idan chiqadi, brigada qoldig'iga o'tadi. Topshiriq bajarilganda retsept bo'yicha o'zi kamayadi."} />
            </div>
            <div className="px-5 pb-5">
              {brigStocks.length === 0 ? (
                <p className="text-sm text-slate-500">Brigadalar yo&apos;q — avval <Link href="/brigades" className="underline">Brigadalar</Link> bo&apos;limida qo&apos;shing.</p>
              ) : (
                <BrigadeDistributeForm
                  key={fromReceipt?.id ?? "all"}
                  brigades={brigStocks.map((b) => ({ id: b.id, name: b.name, leader: b.leader }))}
                  warehouses={warehouses}
                  materials={materials.filter((m) => Object.values(byWh.get(m.id) ?? {}).some((v) => v > EPS)).map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, byWh: byWh.get(m.id) ?? {} }))}
                  initial={distributeInitial}
                />
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {brigStocks.map((b) => {
              const makes = b.makes.filter((m) => m.canMake > 0).sort((x, y) => y.canMake - x.canMake).slice(0, 6);
              return (
                <Card key={b.id} padded={false}>
                  <div className="p-5">
                    <CardHeader icon={HardHat} title={b.name}
                      description={`${b.leader ?? "brigadirsiz"} · ochiq topshiriq qoldig'i ${qty(b.openQty)}`}
                      action={<span className="inline-flex flex-wrap gap-1.5">
                        {b.materials.some((m) => m.qty < 0) && <Badge color="red">minus qoldiq</Badge>}
                        <Badge color={b.value > 0 ? "green" : "slate"}>{money(b.value)}</Badge>
                      </span>} />
                    {b.materials.length === 0 ? (
                      <p className="text-sm text-slate-500">Qo&apos;lida xomashyo yo&apos;q — yuqoridagi forma orqali bering.</p>
                    ) : (
                      <div className="overflow-x-auto"><table className="w-full text-sm">
                        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Xomashyo</th><th className="py-1 text-right">Qoldiq</th><th className="py-1 text-right">Qiymati</th></tr></thead>
                        <tbody>
                          {b.materials.map((m) => (
                            <tr key={m.materialId} className="border-t border-slate-100">
                              <td className="py-1.5">{m.name}</td>
                              <td className={cn("py-1.5 text-right tabular", m.qty < 0 && "font-semibold text-red-600")}>{qty(m.qty)} {unitLabel(m.unit)}</td>
                              <td className={cn("py-1.5 text-right tabular", m.qty < 0 ? "text-red-600" : "text-slate-500")}>{money(m.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    )}
                    {b.materials.length > 0 && warehouses[0] && (
                      <BrigadeReturnForm brigadeId={b.id} warehouseId={warehouses[0].id} materials={b.materials.map((m) => ({ materialId: m.materialId, name: m.name, unit: m.unit, qty: m.qty }))} />
                    )}
                    <h3 className="mt-4 mb-1.5 text-[13px] font-semibold text-slate-700">Shu xomashyo bilan ishlab chiqara oladi</h3>
                    {makes.length === 0 ? (
                      <p className="text-sm text-slate-500">Hech narsa — retsept xomashyosi yetishmaydi.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {makes.map((m) => (
                          <li key={m.productId} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-slate-700">{m.product}</span>
                            <span className="shrink-0 font-semibold text-emerald-700 tabular">{qty(m.canMake)} {unitLabel(m.unit)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">Topshiriq bajarilganda brigadada yetmagan xomashyo skladdan avtomatik beriladi. Brigada qoldig&apos;i manfiy (qizil) chiqsa — skladda ham yetmagan: xomashyo kelgach shu miqdorni brigadaga bersangiz nolga tushadi.</p>
        </div>
      )}

      {tab === "capacity" && (
        <div className="space-y-4">
          <Table>
            <thead><tr><Th>Mahsulot</Th><Th>Retsept</Th><Th right>Hozir ishlab chiqarish mumkin</Th><Th right>Zayavkalar ehtiyoji</Th><Th>Cheklovchi ingredient</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {capacity.length === 0 && <Empty text="Faol retseptli mahsulot yo'q — avval Retseptlar bo'limida retsept kiriting" icon={Factory} />}
              {capacitySorted.map((c) => {
                const ok = c.remaining <= 0 ? c.canMake > 0 : c.canMake >= c.remaining;
                return (
                  <Tr key={c.productId}>
                    <Td className="font-medium">{c.product}</Td>
                    <Td><Link href={`/recipes/${c.productId}`} className="text-slate-500 hover:underline">v{c.version}</Link></Td>
                    <Td right className={cn("font-semibold", c.canMake <= 0 ? "text-red-600" : ok ? "text-emerald-700" : "text-amber-700")}>{qty(c.canMake)} {unitLabel(c.unit)}</Td>
                    <Td right className="text-slate-600">{c.remaining > 0 ? `${qty(c.remaining)} ${unitLabel(c.unit)}` : "—"}</Td>
                    <Td className="text-slate-600">{c.limiting ? <>{c.limiting.name} <span className="text-slate-400">· qoldiq {qty(c.limiting.balance)} {c.limiting.unit}, norma {qty(c.limiting.perUnit)}/{unitLabel(c.unit)}</span></> : "—"}</Td>
                    <Td>{c.canMake <= 0 ? <Badge color="red">Xomashyo yo&apos;q</Badge> : ok ? <Badge color="green">Yetarli</Badge> : <Badge color="amber">Zayavkaga yetmaydi</Badge>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <div>
            <h2 className="mb-2 font-semibold">Dona mahsulotlar (hovlida)</h2>
            <Table>
              <thead><tr><Th>Mahsulot</Th><Th>Kod</Th><Th>Birlik</Th><Th right>Jami</Th><Th right>Erkin</Th><Th right>Band</Th><Th>Holat</Th><Th></Th></tr></thead>
              <tbody>
                {pieces.length === 0 && <Empty text={"Dona mahsulot yo'q — Sozlamalar → Beton markalari bo'limida birligi \"dona\" bo'lgan mahsulot (ustun, blok, bordyur…) qo'shing"} icon={Boxes} />}
                {piecesSorted.map((r) => (
                  <Tr key={r.id} className="[&>td]:py-4 [&>td]:text-[15px]">
                    <Td><Link href={`/stock/products/${r.id}`} className="hover:underline">{r.name}</Link></Td>
                    <Td className="text-slate-500">{r.code}</Td>
                    <Td className="text-slate-500">{unitLabel(r.unit)}</Td>
                    <Td right className="font-semibold">{qty(r.total)}</Td>
                    <Td right className="text-lg font-semibold text-emerald-600">{qty(r.free)}</Td>
                    <Td right className="text-lg font-semibold text-blue-600">{qty(r.owned)}</Td>
                    <Td>{r.shortage > 0 ? <Badge color="red">{qty(r.shortage)} yetishmaydi</Badge> : r.free > 0 ? <Badge color="green">Erkin bor</Badge> : r.total > 0 ? <Badge color="blue">Hammasi band</Badge> : <Badge>Bo&apos;sh</Badge>}</Td>
                    <Td><Link href={`/stock/products/${r.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Ochish <ChevronRight size={14} /></Link></Td>
                  </Tr>
                ))}
                {pieces.length > 0 && (
                  <tr className="bg-slate-50/80 [&>td]:py-4 [&>td]:text-[15px]">
                    <Td className="font-semibold">Jami mahsulot</Td><Td /><Td />
                    <Td right className="font-semibold">{qty(pieceTotals.total)}</Td>
                    <Td right className="text-lg font-semibold text-emerald-600">{qty(pieceTotals.free)} ta</Td>
                    <Td right className="text-lg font-semibold text-blue-600">{qty(pieceTotals.owned)} ta</Td>
                    <Td colSpan={2} className="text-sm text-slate-500">erkin / band</Td>
                  </tr>
                )}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-slate-500">Hovlida tayyor turgan dona mahsulotlar (ustun, blok, bordyur…). Qatorni bosib, kimga band qilinganini ko&apos;rasiz. Qo&apos;lda kirim qilish — yuqoridagi «Tayyor mahsulot qo&apos;shish».</p>
          </div>

          <div>
            <h2 className="mb-2 font-semibold">Tayyor beton (ishlab chiqarilgan − jo&apos;natilgan)</h2>
            <Table>
              <thead><tr><Th>Marka</Th><Th right>Qoldiq</Th><Th right>Xomashyodan chiqadi</Th><Th>Cheklovchi xomashyo</Th></tr></thead>
              <tbody>
                {concrete.length === 0 && <Empty text="Beton markasi kiritilmagan — Sozlamalar → Beton markalari" icon={Factory} />}
                {concreteSorted.map((p) => {
                  const c = canMakeBy.get(p.id);
                  return (
                    <Tr key={p.id} className="[&>td]:py-4 [&>td]:text-[15px]">
                      <Td className="font-medium">{p.name}</Td>
                      <Td right>{qty(cb.get(p.id) ?? 0)} m³</Td>
                      <Td right className={c ? (c.canMake > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600") : "text-slate-400"}>{c ? `${qty(c.canMake)} m³` : "retsept yo'q"}</Td>
                      <Td className="text-slate-600">{c?.limiting ? <>{c.limiting.name} <span className="text-slate-400">· qoldiq {qty(c.limiting.balance)} {c.limiting.unit}</span></> : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-slate-500">Beton oldindan tayyorlanmaydi — zakaz olingandan keyin ishlab chiqariladi. Shuning uchun &quot;Qoldiq&quot; zames qilingan, lekin hali nakladnoy yozilmagan hajm (nolga yaqin bo&apos;lishi kerak); asosiy ko&apos;rsatkich — xomashyodan retsept bo&apos;yicha qancha chiqishi.</p>
          </div>

          {capacity.some((c) => c.items.some((i) => i.short > 0)) && (
            <div>
              <h2 className="mb-2 font-semibold">Zayavkalar uchun yetishmaydigan xomashyo / mahsulot</h2>
              <Table>
                <thead><tr><Th>Mahsulot</Th><Th>Ingredient</Th><Th right>Qoldiq</Th><Th right>Kerak</Th><Th right>Yetishmaydi</Th></tr></thead>
                <tbody>
                  {capacitySorted.flatMap((c) => c.items.filter((i) => i.short > 0).map((i) => (
                    <Tr key={`${c.productId}-${i.name}`}><Td>{c.product}</Td><Td className="font-medium">{i.name}</Td><Td right>{qty(i.balance)} {i.unit}</Td><Td right>{qty(c.remaining * i.perUnit)} {i.unit}</Td><Td right className="font-semibold text-red-600">{qty(i.short)} {i.unit}</Td></Tr>
                  )))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-slate-500">Kerak = qabul qilingan, hali ishlab chiqarilmagan zayavkalar × retsept normasi. Yetishmayotganini <Link href="/receipts/import" className="underline">Kirim → Excel orqali</Link> yoki <Link href="/receipts/new" className="underline">Kirim</Link> bilan kiriting.</p>
            </div>
          )}
        </div>
      )}

      {forYou && <ForYouParts parts={forYou.parts} feed={forYou.feed} />}
      {holdings && <div className="mb-4"><HoldingsPanel holdings={holdings} collapsible /></div>}
      {tab === "balance" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Xomashyo qoldiqlari</h2>
              <p className="text-sm text-slate-500">{`${period.label}${wh ? ` · ${wh.name}` : perWarehouse ? " · barcha skladlar" : ""}`}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canPrice && <FillPricesButton count={noPrice} />}
              <ExcelButton file={`Qoldiqlar ${period.fromStr} — ${period.toStr}${kat ? ` ${MATERIAL_CATEGORY_LABEL[kat]}` : ""}${wh ? ` (${wh.name.replace(/[\\/:*?"<>|]/g, " ")})` : ""}`} sheets={[{ name: "Qoldiqlar", rows: excelRows }]} />
            </div>
          </div>
          <StockPeriodBar base="/stock" period={period} hidden={{ tab: "balance", ...(wh ? { wh: wh.id } : {}), ...(kat ? { kat: CATEGORY_SLUG[kat] } : {}) }} />
          {/* Kategoriya: Zavod zapchast / Avto zapchast / Xomashyo (mexanikka — ikkitasi) */}
          <div className="flex flex-wrap items-center gap-1">
            {[null, ...cats].map((c) => {
              const active = c === kat;
              const n = c ? turnoverSeen.filter((r) => r.category === c).length : turnoverSeen.length;
              const qs = new URLSearchParams({ tab: "balance", from: period.fromStr, to: period.toStr, ...(wh ? { wh: wh.id } : {}), ...(c ? { kat: CATEGORY_SLUG[c] } : {}) });
              return (
                <Link key={c ?? "all"} href={`/stock?${qs.toString()}`} prefetch={false}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition pointer-coarse:h-11", active ? "border-slate-900 bg-slate-900 font-semibold text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900")}>
                  {c ? MATERIAL_CATEGORY_LABEL[c] : cats.length < 3 ? "Hammasi (sizga tegishli)" : "Barcha kategoriyalar"}
                  <span className="tabular opacity-70">{n}</span>
                </Link>
              );
            })}
          </div>
          {perWarehouse && (
            <div className="flex flex-wrap items-center gap-1">
              <Warehouse size={15} className="mr-1 text-slate-400" aria-hidden />
              {[null, ...shownWarehouses].map((w) => {
                const active = (w?.id ?? null) === (wh?.id ?? null);
                const qs = new URLSearchParams({ tab: "balance", from: period.fromStr, to: period.toStr, ...(w ? { wh: w.id } : {}), ...(kat ? { kat: CATEGORY_SLUG[kat] } : {}) });
                return (
                  <Link key={w?.id ?? "all"} href={`/stock?${qs.toString()}`} prefetch={false}
                    className={cn("inline-flex h-8 items-center rounded-lg border px-3 text-sm transition pointer-coarse:h-11", active ? "border-slate-900 bg-slate-900 font-semibold text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900")}>
                    {w ? `${w.name}${w.isActive ? "" : " (yopilgan)"}` : "Barcha skladlar"}
                  </Link>
                );
              })}
            </div>
          )}
          {canDelete && <MaterialBulkBar formId={MATERIAL_FORM} total={activeRows} categories={MATERIAL_CATEGORY_OPTIONS} />}
          <Sheet>
            <SheetHead>
              <tr>
                {canDelete && <SheetTh rowSpan={2} tone="plain" className="w-10"><span className="sr-only">Belgilash</span></SheetTh>}
                <SheetTh rowSpan={2} tone="yellow" className="w-10">№</SheetTh>
                <SheetTh rowSpan={2} tone="yellow" className="min-w-56">Nomi</SheetTh>
                <SheetTh rowSpan={2} tone="blue">Birlik</SheetTh>
                <SheetTh rowSpan={2} tone="blue" className="min-w-28" title="Birlik narxi — Ta'minot belgilaydi; chiqim shu narx bo'yicha baholanadi">Dona narxi</SheetTh>
                <SheetTh colSpan={2} tone="gray">Qoldiq<span className="block text-[11px] font-normal text-slate-600">{`${dateRu(period.from)} holatiga`}</span></SheetTh>
                <SheetTh colSpan={2} tone="green">Kirim</SheetTh>
                <SheetTh colSpan={2} tone="red">Chiqim</SheetTh>
                <SheetTh colSpan={2} tone="gray">Qoldiq<span className="block text-[11px] font-normal text-slate-600">{`${dateRu(toIncl)} oxiriga`}</span></SheetTh>
              </tr>
              <tr>
                <SheetTh tone="gray">Miqdor</SheetTh><SheetTh tone="gray">Summa</SheetTh>
                <SheetTh tone="green">Miqdor</SheetTh><SheetTh tone="green">Summa</SheetTh>
                <SheetTh tone="red">Miqdor</SheetTh><SheetTh tone="red">Summa</SheetTh>
                <SheetTh tone="gray">Miqdor</SheetTh><SheetTh tone="gray">Jami summa</SheetTh>
              </tr>
            </SheetHead>
            <tbody>
              {turnover.length === 0 && (
                <tr><SheetTd colSpan={canDelete ? 13 : 12} center muted className="py-10">Xomashyo qo&apos;shilmagan — «Xomashyo qo&apos;shish» tugmasini bosing</SheetTd></tr>
              )}
              {turnover.map((r, i) => {
                const b = mb.get(r.id) ?? 0, l = last?.materials.get(r.id);
                const low = r.minStock > 0 && r.close.q < r.minStock;
                const zero = Math.abs(r.close.q) < EPS;
                return (
                  <SheetTr key={r.id} className={cn(!r.isActive && "text-slate-500")}>
                    {canDelete && (
                      <SheetTd center className="w-10">
                        {/* Faqat faol xomashyo belgilanadi. data-stock — JORIY (davrdan qat'i nazar) qoldiq: tasdiq oynasi qoldig'i borlarini alohida aytadi */}
                        {r.isActive && (
                          <label className="-m-2 flex cursor-pointer items-center justify-center p-2 pointer-coarse:min-h-11">
                            <input type="checkbox" form={MATERIAL_FORM} name="ids" value={r.id} data-stock={Math.abs(b) > EPS ? "1" : "0"} aria-label={`${r.name} — belgilash`} className="h-4 w-4 cursor-pointer accent-slate-900 pointer-coarse:h-5 pointer-coarse:w-5" />
                          </label>
                        )}
                      </SheetTd>
                    )}
                    <SheetTd center muted>{i + 1}</SheetTd>
                    <SheetTd tone="yellow">
                      <Link href={`/stock?tab=moves&${periodQs({ material: r.id })}`} prefetch={false}
                        title={l ? `Oxirgi kirim: ${l.by} · ${dateTime(l.date)} — davrdagi harakatlar` : "Davrdagi harakatlar"}
                        className={cn("font-medium hover:underline", r.isActive ? "text-slate-900" : "text-slate-500")}>{r.name}</Link>
                      <span className="ml-1.5 text-[11px] text-slate-400">{r.code}</span>
                      {r.category !== "XOMASHYO" && <span className="ml-1.5 inline-block align-middle"><Badge color={r.category === "AVTO_ZAPCHAST" ? "blue" : "violet"} dot={false}>{MATERIAL_CATEGORY_LABEL[r.category]}</Badge></span>}
                      {!r.isActive && <span className="ml-1.5 inline-block align-middle"><Badge dot={false}>arxiv</Badge></span>}
                    </SheetTd>
                    <SheetTd center tone="blue" className="text-slate-600">{unitShort(r.unit)}</SheetTd>
                    <SheetTd right tone="blue"><PriceCell materialId={r.id} name={r.name} price={r.unitPrice} avg={r.avgCost} canEdit={canPrice && r.isActive} /></SheetTd>
                    <SheetTd right tone="gray">{cellQ(r.open.q)}</SheetTd>
                    <SheetTd right tone="gray">{cellS(r.open.s)}</SheetTd>
                    <SheetTd right tone="green">{cellQ(r.in.q)}</SheetTd>
                    <SheetTd right tone="green">{cellS(r.in.s)}</SheetTd>
                    <SheetTd right tone="red">{cellQ(r.out.q)}</SheetTd>
                    <SheetTd right tone="red">{cellS(r.out.s)}</SheetTd>
                    <SheetTd right tone={zero ? "gray" : undefined} muted={zero}
                      className={cn(!zero && "font-semibold", r.close.q > EPS && "bg-emerald-100 text-emerald-900", r.close.q < -EPS && "bg-red-100 text-red-700")}>
                      {low && <span className="mr-1.5 inline-block align-middle" title={`Minimal qoldiqdan kam (${fmtNum(r.minStock, 3)})`}><Badge color="amber" dot={false}>Kam</Badge></span>}
                      {zero ? "0" : fmtNum(r.close.q, 3)}
                    </SheetTd>
                    <SheetTd right tone="gray" strong>
                      {r.approx && <span className="mr-0.5 font-normal text-amber-600" title="Harakatlarning bir qismi narxsiz — joriy narx bo'yicha baholangan («Dona narxi» yoki o'rtacha tannarx)">≈</span>}
                      {cellS(r.close.s) || "0"}
                    </SheetTd>
                  </SheetTr>
                );
              })}
            </tbody>
            {turnover.length > 0 && (
              <SheetFoot>
                <tr>
                  <SheetTd colSpan={canDelete ? 5 : 4} right>Jami <span className="font-normal text-slate-500">· {`${turnover.length} ta xomashyo`}</span></SheetTd>
                  <SheetTd /><SheetTd right>{fmtNum(tot.open, 0)}</SheetTd>
                  <SheetTd /><SheetTd right className="text-emerald-800">{fmtNum(tot.in, 0)}</SheetTd>
                  <SheetTd /><SheetTd right className="text-red-700">{fmtNum(tot.out, 0)}</SheetTd>
                  <SheetTd /><SheetTd right>{tot.approx && <span className="mr-0.5 font-normal text-amber-600">≈</span>}{fmtNum(tot.close, 0)}</SheetTd>
                </tr>
              </SheetFoot>
            )}
          </Sheet>
          <p className="text-xs text-slate-500">
            Summa = miqdor × harakat narxi: kirim — xarid narxida (yetkazib berish bilan), chiqim — berilgan paytdagi «Dona narxi» bo&apos;yicha.
            «≈» — narxsiz eski harakatlar bor, ular joriy narx bo&apos;yicha baholangan («Dona narxi» yoki o&apos;rtacha tannarx).
            «Jami» qatorida miqdor qo&apos;shilmaydi — birliklar har xil. Nomini bosing — davrdagi harakatlar.
          </p>
        </div>
      )}

      {tab === "moves" && ref && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
          <span className="text-slate-600">Bitta hujjat bo&apos;yicha: <b className="text-slate-900">{moves.length} qator</b>, jami <b className="text-slate-900">{money(moves.reduce((x, m) => x + Number(m.qty) * Number(m.unitCost ?? 0), 0))}</b></span>
          <Link href="/stock" className="font-medium text-slate-600 hover:text-slate-900 hover:underline">← <span>Qoldiqlar</span></Link>
        </div>
      )}
      {tab === "moves" && moveMaterial && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
          <span className="text-slate-600">
            <b className="text-slate-900">{moveMaterial.name}</b> harakatlari{sp.from || sp.to ? ` · ${period.label}` : ""}{wh ? ` · ${wh.name}` : ""}:{" "}
            <b className="text-slate-900">{moves.length}{moves.length >= 500 ? "+" : ""} qator</b>
            {" · "}kirim <b className="text-emerald-700">+{qty(moves.reduce((x, m) => x + Math.max(0, Number(m.qty)), 0))}</b>
            {" · "}chiqim <b className="text-red-600">{qty(moves.reduce((x, m) => x + Math.min(0, Number(m.qty)), 0))}</b> {unitLabel(moveMaterial.unit)}
          </span>
          <span className="flex flex-wrap gap-4">
            <Link href={`/stock?tab=balance&${periodQs()}`} className="font-medium text-slate-600 hover:text-slate-900 hover:underline">← <span>Qoldiqlar</span></Link>
          </span>
        </div>
      )}
      {tab === "moves" && (
        <Table>
          <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Nomi</Th><Th right>Miqdor</Th><Th>Sklad</Th><Th>Hujjat</Th><Th>Kim</Th></tr></thead>
          <tbody>
            {moves.length === 0 && <Empty text="Harakatlar yo'q" />}
            {moves.map((m) => (
              <Tr key={m.id}>
                <Td>{dateTime(m.date)}</Td>
                <Td>{m.refType === "OpeningBalance" || ((m.refType === "Manual" || m.refType === "StockIn") && m.note?.startsWith("Boshlang'ich")) ? "Boshlang'ich qoldiq" : (m.note?.startsWith("Storno ") || m.note?.startsWith("Bekor qilish ")) ? `Bekor qilish · ${TYPE_LABEL[m.type]}` : TYPE_LABEL[m.type]}</Td>
                <Td>{m.material?.name ?? m.product?.name}</Td>
                <Td right className={Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)} {m.material?.unit ?? m.product?.unit}</Td>
                <Td>{m.warehouse.name}</Td>
                <Td>{m.recipient || m.employee ? <span>Kimga: <span className="font-medium text-slate-800">{m.employee?.fullName ?? m.recipient?.name}</span></span> : m.refType && m.refId && REF_LINK[m.refType] ? <Link href={`${REF_LINK[m.refType]}/${m.refId}`} className="hover:underline">{REF_LABEL[m.refType] ?? m.refType}</Link> : m.refType === "StockIn" && m.refId ? <Link href={`/stock?tab=moves&ref=${m.refId}`} className="hover:underline">Sklad kirimi</Link> : m.refType === "Brigade" ? <Link href="/stock?tab=brigades" className="hover:underline">Brigada</Link> : m.refType === "Manual" ? "Qo'lda" : "—"}</Td>
                <Td>{m.createdBy.fullName}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
