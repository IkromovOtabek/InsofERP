import { z } from "zod";
import { Prisma, type RealizationEntry, type RealizationLine, type RealizationNote } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit, auditMany } from "@/lib/audit";
import { NDS_RATE, entryNds, feeHasNds, splitNds, withNds, withoutNds } from "@/lib/nds";
import { PRODUCT_UNITS, normalizeUnit, unitLabel } from "@/lib/unit";
import { dateRu, fmtNum, fmtTiyin, isoDate } from "@/lib/format";
import { matchKey, num, numMoney, parseDate, str, valueMapper, type ValueMaps } from "@/lib/excel";
import { dayField, numIn } from "@/lib/logistics-admin";
import { realizationRows, shortTtn, type RealizationRow } from "@/lib/realization";
import { PAY_GROUPS, rootGroupName, type PayGroupKey } from "@/lib/order-day-sheet";
import { nextCatalogCode } from "@/lib/numbering";
import { defaultCreditLimit } from "@/lib/credit-default";
import { customerNameKey, lockCustomerName } from "@/lib/customer-name";
import { ensureSite } from "@/lib/logistics";
import { STOCK_EPS, lockStock } from "@/lib/stock-lock";
import { eco, ecoEnabled } from "@/lib/eco/client";
import { notifyAfter } from "@/lib/notify";

/**
 * Logistika → «Realizatsiya» (dispetcher): jo'natmalar reestri — Google varag'idagi ustunlar bilan
 * (sana, to'lov turi, sotuvchi, xaridor, mahsulot, TTN, mashina … ortilgan joy, boradigan manzil, izoh, spravka nomi).
 *
 *  · Reysdan (avtomatik): har TTN qatori `realizationRows` dan jonli — reys ochilishi bilan o'zi tushadi. Dispetcher ortilgan joy,
 *    boradigan manzil, izoh va spravka nomini to'ldiradi (`RealizationNote`: kalit — reys id, reyssiz zayavka — "o:<orderId>").
 *    To'ldirilmagani taklif bilan ko'rinadi: ortilgan joy — reys BRU'si (yoki yuk olingan manzil), manzil — obyekt,
 *    izoh — TTN, mashina, haydovchi va telefoni, spravka nomi — mijoz nomi.
 *    Xaridordan boshqa ustunlarni ham tuzatadi — faqat reestrda (zayavka, mijoz qarzi, kassa, sklad o'zgarmaydi; xaridor — zayavkada):
 *    sana, to'lov turi, sotuvchi, mashina (va reyssiz qatorda TTN) — reys bo'yicha (`RealizationNote`); mahsulot, guruh, o'lchov,
 *    miqdor, narx, dastavka — zayavka qatori bo'yicha (`RealizationLine`). Bo'sh qoldirilgani yoki asliga teng qiymat — zayavkadagisi.
 *    Miqdor, narx yoki dastavka tuzatilsa summa va QQS (zayavka qatoridagi «QQS 12%» belgisi bo'yicha) qayta hisoblanadi.
 *    Dastavka ustunida QQS'siz summa; zayavkada dastavka QQS bilan bo'lsa, uning QQS'i QQS ustuniga qo'shiladi (`lib/realization.ts`).
 *  · Qo'lda: tizimga reys bo'lib tushmagan jo'natma (`RealizationEntry`). Kassa va skladga ta'sir qilmaydi; mijoz
 *    debitorkasiga «Sotib olgan» bo'lib tushadi (`lib/debt-sales.ts`). Mijoz (yoki aliasi) nomi ro'yxatdagiga mos kelsa
 *    bog'lanadi, yo'q bo'lsa mijozlarga qo'shiladi (`addMissingCustomers`); mahsulot mos kelsa — birlik va guruh mahsulotdan.
 *    QQS — perechisleniyeda 12%: miqdor × narx dan ham, dastavkadan ham (`entryNds`). O'chirilsa — bazadan, hamma joydan (`deleteRealizationEntry`), AuditLog'da nusxa qoladi.
 *  · Summa (QQSsiz) = miqdor × narx + dastavka; Jami = Summa + QQS (`lib/realization.ts` bilan bitta qoida).
 *  · Excel'dan import: varaqdagi qatorlar qo'lda qator bo'lib tushadi. Reestrda bori (reys yoki avval kiritilgan) o'tkazib
 *    yuboriladi — fayl qayta yuklansa ham ikki marta yozilmaydi (`importRealizationEntries`). Ro'yxatda yo'q xaridor mijozlarga,
 *    ro'yxatda yo'q mahsulot katalogga ham qo'shiladi; o'qib bo'lmaydigan qator (sana, to'lov turi, miqdor)
 *    o'tkazib yuboriladi — qolganini to'xtatmaydi.
 */

export type LogSource = "AUTO" | "MANUAL";
export type LogFields = { loadPlace: string | null; destination: string | null; note: string | null; refName: string | null };
export type LogRow = {
  key: string; source: LogSource;
  /** Tahrir kaliti: reysdan — `RealizationNote.key`, qo'lda — `RealizationEntry.id` */
  ref: string;
  orderId: string | null; tripId: string | null; customerId: string | null;
  date: Date; pay: PayGroupKey; payLabel: string; seller: string;
  /** Soat qayerdan (`opAt`): reysdan — yuklangan payt (sana ko'chirilmagan bo'lsa), qo'lda — kiritilgan payt; aks holda null */
  at: Date | null;
  customer: string; product: string; group: string; ttn: string | null; vehicle: string | null;
  /** Qo'lda/Excel qatorda yozilgan xaridor nomi — bog'langan mijoz kartasi nomidan farq qilsa (`customer` — karta nomi) */
  typedName?: string | null;
  /** Reysdan qatorda — dispetcher yozgan TTN (`Trip.ttn`, tahrir qiymati); bo'lmasa ko'rinadigani nakladnoy raqami */
  tripTtn: string | null;
  unitKey: string; unit: string; qty: number; price: number; delivery: number; net: number; vat: number; total: number;
  /** Ko'rinadigan qiymat: to'ldirilgani, bo'lmasa taklif */
  loadPlace: string; destination: string; note: string; refName: string;
  /** Reysdan qatorda: dispetcher to'ldirgani (formada) va taklif (placeholder) */
  filled: LogFields | null; suggest: LogFields | null;
  /** Reysdan qatorning mahsulot qatori kaliti (`RealizationLine.key`); qo'lda qatorda null */
  line: string | null;
  /** Reysdan qatorda dispetcher tuzatgan ustun → zayavka/reysdagi asl qiymat (ko'rinishi); tuzatilmagan ustun yo'q */
  orig: Partial<Record<AutoCell, string>>;
};

/** Reestr summalari 3 xonagacha (`RealizationEntry`/`RealizationLine` — Decimal(18,3)) */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const PAY_LABEL = Object.fromEntries(PAY_GROUPS.map((g) => [g.key, g.label])) as Record<PayGroupKey, string>;
export const PAY_KEYS = PAY_GROUPS.map((g) => g.key) as [PayGroupKey, ...PayGroupKey[]];

/** Reysdan qatorning qo'shimcha maydonlari kaliti — bitta reysning hamma qatoriga bitta. */
export const autoKey = (r: { tripId: string | null; orderId: string }) => r.tripId ?? `o:${r.orderId}`;

function suggestOf(r: RealizationRow): LogFields {
  return {
    loadPlace: r.loadPlace,
    destination: r.address || null,
    note: [r.ttn && `TTN ${shortTtn(r.ttn)}`, r.tripId && r.vehicle && `mash. ${r.vehicle}`, r.driver && `haydovchi ${r.driver}`, r.driverPhone].filter(Boolean).join("; ") || null,
    refName: r.customer,
  };
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Reysdan qatorga dispetcher tuzatishlari: bo'sh maydon — zayavka/reysdagi qiymat; miqdor/narx/dastavka tuzatilsa summa va QQS qayta. */
function autoEdits(r: RealizationRow, n: RealizationNote | undefined, l: RealizationLine | undefined) {
  const orig: Partial<Record<AutoCell, string>> = {};
  const pick = <T>(field: AutoCell, over: T | null | undefined, base: T, show: (v: T) => string): T => {
    if (over == null) return base;
    orig[field] = show(base);
    return over;
  };
  const dec = (v: Prisma.Decimal | null | undefined) => (v == null ? null : Number(v));
  const pay = pick("payGroup", n?.payGroup && (PAY_KEYS as string[]).includes(n.payGroup) ? (n.payGroup as PayGroupKey) : null, r.pay, (p) => PAY_LABEL[p]);
  const unitKey = pick("unit", l?.unit, r.unitKey, unitLabel);
  const qty = pick("qty", dec(l?.qty), r.qty, (v) => fmtNum(v, 3));
  const price = pick("price", dec(l?.price), r.price, fmtTiyin);
  // Dastavka tuzatishi zayavka dastavkasidek saqlanadi — zayavkada QQS bo'lsa QQS bilan; ustunda QQS'siz qismi
  const over = l?.delivery == null ? null : r.feeNds ? splitNds(Number(l.delivery)) : { net: Number(l.delivery), vat: 0 };
  const delivery = pick("delivery", over?.net, r.delivery, fmtTiyin);
  const money = "qty" in orig || "price" in orig || "delivery" in orig;
  const line = r3(qty * price);
  const vat = money ? r3((r.nds ? line * NDS_RATE : 0) + (over ? over.vat : r.deliveryVat)) : r.vat;
  const net = money ? r3(line + delivery) : r.net;
  return {
    date: pick("date", n?.date, r.date, dateRu),
    pay, payLabel: PAY_LABEL[pay],
    seller: pick("seller", n?.seller, r.seller, (v) => v || "—"),
    vehicle: pick("vehicle", n?.vehicle, r.vehicle, (v) => v ?? "—"),
    // Reysda TTN — `Trip.ttn` (o'z katagi); reyssiz (o'zi olib ketgan) qatorda — shu yerda
    ttn: r.tripId ? (r.ttn ? shortTtn(r.ttn) : null) : pick<string | null>("ttn", n?.ttn, null, () => "—"),
    product: pick("productName", l?.productName, r.product, (v) => v),
    group: pick("groupName", l?.groupName, r.group, (v) => v),
    unitKey, unit: unitLabel(unitKey), qty, price, delivery, net, vat, total: money ? r3(net + vat) : r.total,
    orig,
  };
}

/** `customerIds` — faqat shu mijozlar qatorlari (debitorka: `lib/debt-sales.ts`); mijozga bog'lanmagan qo'lda qator kirmaydi. */
export async function realizationLog(from: Date, to: Date, opts?: { customerIds?: string[] }): Promise<LogRow[]> {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0); b.setDate(b.getDate() + 1);
  const ids = opts?.customerIds;
  // Dispetcher sanasini shu davrga ko'chirgan reys/zayavka — asl sanasi boshqa davrda bo'lsa ham shu yerda
  const moved = (await db.realizationNote.findMany({ where: { date: { gte: a, lt: b } }, select: { key: true } })).map((n) => n.key);
  const [auto, entries] = await Promise.all([
    realizationRows(from, to, { tripIds: moved.filter((k) => !k.startsWith("o:")), orderIds: moved.filter((k) => k.startsWith("o:")).map((k) => k.slice(2)), customerIds: ids }),
    db.realizationEntry.findMany({ where: { cancelledAt: null, date: { gte: a, lt: b }, ...(ids ? { customerId: { in: ids } } : {}) }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const keys = [...new Set(auto.map(autoKey))];
  const [noteList, lineList] = await Promise.all([
    keys.length ? db.realizationNote.findMany({ where: { key: { in: keys } } }) : [],
    auto.length ? db.realizationLine.findMany({ where: { key: { in: auto.map((r) => r.key) } } }) : [],
  ]);
  const notes = new Map(noteList.map((n) => [n.key, n]));
  const lines = new Map(lineList.map((l) => [l.key, l]));
  // Qo'lda/Excel qator — bog'langan mijoz kartasi nomi bilan (debitorka va mijoz kartasidagidek); Excel'da yozilgani `typedName`
  const cardIds = [...new Set(entries.flatMap((e) => (e.customerId ? [e.customerId] : [])))];
  const cardName = new Map(cardIds.length ? (await db.customer.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]) : []);

  const rows: LogRow[] = [];
  for (const r of auto) {
    const ref = autoKey(r);
    const n = notes.get(ref);
    const e = autoEdits(r, n, lines.get(r.key));
    // Sanasi boshqa davrga ko'chirilgan qator — o'sha davrda
    if (e.date < a || e.date >= b) continue;
    const filled: LogFields = { loadPlace: n?.loadPlace ?? null, destination: n?.destination ?? null, note: n?.note ?? null, refName: n?.refName ?? null };
    const suggest = suggestOf(r);
    rows.push({
      ...e, key: `a-${r.key}`, source: "AUTO", ref, line: r.key, orderId: r.orderId, tripId: r.tripId, customerId: r.customerId,
      at: r.tripId && !("date" in e.orig) ? r.date : null, customer: r.customer, tripTtn: r.tripTtn,
      loadPlace: filled.loadPlace ?? suggest.loadPlace ?? "", destination: filled.destination ?? suggest.destination ?? "",
      note: filled.note ?? suggest.note ?? "", refName: filled.refName ?? suggest.refName ?? "",
      filled, suggest,
    });
  }
  for (const e of entries) {
    const qty = Number(e.qty), price = Number(e.price), delivery = Number(e.delivery);
    const net = r3(qty * price + delivery);
    const pay = (PAY_KEYS as string[]).includes(e.payGroup) ? (e.payGroup as PayGroupKey) : "CASH";
    const customer = (e.customerId && cardName.get(e.customerId)) || e.customerName;
    // QQS qoidadan (saqlangan `vat` dan emas): dastavka QQS'i qo'shilishidan oldin yozilgan qatorlar ham bir xil hisoblansin
    const vat = entryNds(pay, qty, price, delivery).total;
    rows.push({
      key: `m-${e.id}`, source: "MANUAL", ref: e.id, orderId: null, tripId: null, customerId: e.customerId,
      date: e.date, at: e.createdAt, pay, payLabel: PAY_LABEL[pay], seller: e.seller ?? "", customer, typedName: customer === e.customerName ? null : e.customerName, product: e.productName, group: e.groupName,
      ttn: e.ttn, tripTtn: null, vehicle: e.vehicle, unitKey: e.unit, unit: unitLabel(e.unit), qty, price, delivery, net, vat, total: r3(net + vat),
      loadPlace: e.loadPlace ?? "", destination: e.destination ?? "", note: e.note ?? "", refName: e.refName ?? customer,
      filled: null, suggest: null, line: null, orig: {},
    });
  }
  // Varaqdagidek: kun, keyin TTN raqami (reysdan va qo'lda aralash), TTN'sizlar kun oxirida
  return rows.sort((x, y) => {
    const dx = dayKey(x.date), dy = dayKey(y.date);
    if (dx !== dy) return x.date.getTime() - y.date.getTime();
    return (x.ttn ?? "￿").localeCompare(y.ttn ?? "￿", "uz", { numeric: true }) || x.date.getTime() - y.date.getTime() || x.key.localeCompare(y.key);
  });
}

// ───────────────────────── Forma ro'yxatlari ─────────────────────────

export type LogOptions = {
  /** To'lov turlari — klient `order-day-sheet` ni (u bazani tortadi) import qilmasin */
  pays: { key: PayGroupKey; label: string }[];
  customers: string[]; products: { name: string; unit: string; group: string }[]; groups: string[];
  sellers: string[]; vehicles: string[]; loadPlaces: string[]; destinations: string[];
};

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))];

export async function realizationOptions(): Promise<LogOptions> {
  const [customers, products, groups, sellers, vehicles, settings, warehouses, entries, notes] = await Promise.all([
    db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { name: true } }),
    db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true, unit: true, groupId: true } }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
    db.user.findMany({ where: { isActive: true, role: "SALES" }, orderBy: { fullName: "asc" }, select: { fullName: true } }),
    db.vehicle.findMany({ orderBy: { plate: "asc" }, select: { plate: true } }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { bruNames: true } }),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } }),
    db.realizationEntry.findMany({ where: { cancelledAt: null }, orderBy: { createdAt: "desc" }, take: 500, select: { seller: true, loadPlace: true, destination: true, groupName: true } }),
    db.realizationNote.findMany({ orderBy: { updatedAt: "desc" }, take: 500, select: { loadPlace: true, destination: true } }),
  ]);
  const rootName = rootGroupName(groups);
  return {
    pays: PAY_GROUPS,
    customers: uniq(customers.map((c) => c.name)),
    products: products.map((p) => ({ name: p.name, unit: p.unit, group: rootName(p.groupId) })),
    groups: uniq([...groups.filter((g) => !g.parentId).map((g) => g.name), ...entries.map((e) => e.groupName), "Boshqa"]),
    sellers: uniq([...sellers.map((u) => u.fullName), ...entries.map((e) => e.seller)]),
    vehicles: uniq(vehicles.map((v) => v.plate)),
    loadPlaces: uniq([...(settings?.bruNames ?? []), ...warehouses.map((w) => w.name), ...notes.map((n) => n.loadPlace), ...entries.map((e) => e.loadPlace)]),
    destinations: uniq([...notes.map((n) => n.destination), ...entries.map((e) => e.destination)]).slice(0, 300),
  };
}

// ───────────────────────── Qo'lda qator ─────────────────────────

const text = (max: number) => z.string().trim().max(max, `ko'pi bilan ${max} belgi`).optional().transform((v) => (v ? v.replace(/\s+/g, " ") : null));

/** Matn maydonlari uzunligi — forma qoidasi; Excel importida uzun qiymat xato emas, shu uzunlikda kesiladi. */
const MAX_LEN = {
  seller: 100, customerName: 200, productName: 200, groupName: 60, unit: 10, ttn: 40, vehicle: 40,
  loadPlace: 60, destination: 200, note: 300, refName: 200,
} as const;

export const entrySchema = z.object({
  date: dayField.refine((d) => d !== null, "Sanani kiriting"),
  payGroup: z.enum(PAY_KEYS, { message: "To'lov turini tanlang" }),
  seller: text(MAX_LEN.seller),
  customerName: z.string().trim().min(2, "Xaridor nomini yozing").max(MAX_LEN.customerName).transform((v) => v.replace(/\s+/g, " ")),
  productName: z.string().trim().min(1, "Mahsulotni yozing").max(MAX_LEN.productName).transform((v) => v.replace(/\s+/g, " ")),
  groupName: text(MAX_LEN.groupName),
  unit: text(MAX_LEN.unit),
  ttn: text(MAX_LEN.ttn),
  vehicle: text(MAX_LEN.vehicle),
  qty: numIn(0, 1_000_000).refine((v) => v !== null && v > 0, "Miqdorni kiriting"),
  price: numIn(0, 10_000_000_000),
  delivery: numIn(0, 10_000_000_000),
  loadPlace: text(MAX_LEN.loadPlace),
  destination: text(MAX_LEN.destination),
  note: text(MAX_LEN.note),
  refName: text(MAX_LEN.refName),
  clientToken: z.string().trim().max(64).optional().transform((v) => v || null),
});
export type EntryInput = z.infer<typeof entrySchema>;

export const noteSchema = z.object({ loadPlace: text(60), destination: text(200), note: text(300), refName: text(200) });
export type NoteInput = z.infer<typeof noteSchema>;

/** Umumiy son xabari («ko'pi bilan …») qaysi maydonniki ekani ko'rinsin — forma va Excel import xatolarida */
export const ENTRY_LABELS: Record<string, string> = {
  date: "Sana", payGroup: "To'lov turi", qty: "Miqdor", price: "Narx (QQSsiz)", delivery: "Dostavka", customerName: "Xaridor", productName: "Mahsulot",
  seller: "Sotuvchi", groupName: "Guruh", unit: "O'lchov", ttn: "TTN", vehicle: "Mashina", loadPlace: "Ortilgan joy", destination: "Boradigan manzil",
  note: "Izoh", refName: "Spravka nomi",
};

type Result = { ok: true; id: string } | { error: string };

type ProductHit = { id: string; name: string; unit: string; groupId: string | null };
type Lookup = { customer: (name: string) => string | null; product: (name: string) => ProductHit | null; group: (groupId: string | null) => string };

/**
 * Mijoz (nomi yoki aliasi) va mahsulot (nomi yoki kodi) ro'yxatdan: faoli ustun, nomi aliasdan ustun. Mahsulot —
 * katta-kichik harfsiz; mijoz — nom kaliti bilan (`customerNameKey`: kirill/lotin, bo'shliq va belgilarsiz), «Kirpichniy dom»
 * va «KIRPICHNIY  DOM.» bitta mijoz bo'lsin. Bitta forma ham, Excel import ham shu bilan — importda hamma nom bitta so'rovda.
 */
async function entryLookup(customerNames: string[], productNames: string[]): Promise<Lookup> {
  const cn = uniq(customerNames), pn = uniq(productNames);
  const ci = (v: string) => ({ equals: v, mode: "insensitive" as const });
  const [customers, products, groups] = await Promise.all([
    cn.length
      ? db.customer.findMany({ where: { isInternal: false }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, aliases: true } })
      : [],
    pn.length
      ? db.product.findMany({ where: { OR: pn.flatMap((n) => [{ name: ci(n) }, { code: ci(n) }]) }, orderBy: { isActive: "desc" }, select: { id: true, name: true, code: true, unit: true, groupId: true } })
      : [],
    pn.length ? db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }) : [],
  ]);
  const lc = (v: string) => v.toLowerCase();
  const ck = customerNameKey;
  const cust = new Map<string, string>();
  for (const c of customers) { const k = ck(c.name); if (k && !cust.has(k)) cust.set(k, c.id); }
  for (const c of customers) for (const a of c.aliases) { const k = ck(a); if (k && !cust.has(k)) cust.set(k, c.id); }
  const prod = new Map<string, ProductHit>();
  for (const p of products) if (!prod.has(lc(p.name))) prod.set(lc(p.name), p);
  for (const p of products) if (p.code && !prod.has(lc(p.code))) prod.set(lc(p.code), p);
  return { customer: (n) => cust.get(ck(n)) ?? null, product: (n) => prod.get(lc(n)) ?? null, group: rootGroupName(groups) };
}

/** Forma qiymatlari → jadval qatori: mijoz/mahsulot ro'yxatga bog'lanadi, birlik va guruh mahsulotdan, QQS to'lov turidan. */
function entryData(d: EntryInput, lk: Lookup) {
  const customerId = lk.customer(d.customerName);
  const product = lk.product(d.productName);
  const group = d.groupName ?? (product ? lk.group(product.groupId) : null);
  const unit = product?.unit ?? d.unit ?? "m3";
  if (!product && !PRODUCT_UNITS.some(([u]) => u === unit)) return { error: "O'lchov birligini tanlang" } as const;
  // Narx va dastavka 3 xonagacha (Decimal(18,3))
  const qty = d.qty!, price = r3(d.price ?? 0), delivery = r3(d.delivery ?? 0);
  return {
    data: {
      date: d.date!, payGroup: d.payGroup, seller: d.seller, customerId, customerName: d.customerName,
      productId: product?.id ?? null, productName: product?.name ?? d.productName, groupName: group ?? "Boshqa",
      ttn: d.ttn, vehicle: d.vehicle, unit, qty, price, delivery, vat: entryNds(d.payGroup, qty, price, delivery).total,
      loadPlace: d.loadPlace, destination: d.destination, note: d.note, refName: d.refName,
    },
  } as const;
}

const future = (d: Date) => d.getTime() > Date.now() + 86_400_000;
/** Excel importi katalogga qo'shgan mahsulot izohi — qator o'chirilganda egasiz qolgani shu belgi bilan topiladi (`dropOrphanProduct`). */
const IMPORTED_PRODUCT_NOTE = "Realizatsiya Excel importidan";

export async function createRealizationEntry(d: EntryInput, userId: string): Promise<Result> {
  if (d.clientToken) {
    const dup = await db.realizationEntry.findUnique({ where: { clientToken: d.clientToken }, select: { id: true, createdById: true } });
    if (dup) return dup.createdById === userId ? { ok: true, id: dup.id } : { error: "Forma kaliti band — sahifani yangilang" };
  }
  if (future(d.date!)) return { error: "Sana kelajakda bo'lmasin" };
  const r = entryData(d, await entryLookup([d.customerName], [d.productName]));
  if ("error" in r) return { error: r.error! };
  try {
    const e = await db.$transaction(async (tx) => {
      const customerId = r.data.customerId ?? (await addMissingCustomers(tx, [r.data], userId)).idOf(r.data.customerName);
      const row = await tx.realizationEntry.create({ data: { ...r.data, customerId, clientToken: d.clientToken, createdById: userId } });
      await audit(tx, userId, "CREATE", "RealizationEntry", row.id, undefined, row);
      return row;
    });
    return { ok: true, id: e.id };
  } catch (e) {
    // Bir vaqtda ikki marta yuborilgan forma — mavjudini qaytaramiz
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && d.clientToken) {
      const dup = await db.realizationEntry.findUnique({ where: { clientToken: d.clientToken }, select: { id: true } });
      if (dup) return { ok: true, id: dup.id };
    }
    throw e;
  }
}

/** Qo'lda qatorni tuzatish. Shartli `updateMany` — boshqa joyda o'zgargan yoki bekor qilingan bo'lsa yozilmaydi. */
export async function updateRealizationEntry(id: string, d: EntryInput, userId: string): Promise<Result> {
  return writeEntry(id, await db.realizationEntry.findUnique({ where: { id } }), d, userId);
}

/** Jadval katagidan tahrir qilinadigan maydonlar (Summa, QQS, Jami — hisoblanadi). */
export const ENTRY_CELLS = ["date", "payGroup", "seller", "customerName", "productName", "groupName", "unit", "ttn", "vehicle", "qty", "price", "delivery", "loadPlace", "destination", "note", "refName"] as const;
export type EntryCell = (typeof ENTRY_CELLS)[number];
export type FieldResult = Result | { error: string; field?: string };

/**
 * Qo'lda qatorning bitta katagi: qolgan maydonlar bazadagicha, forma qoidalari bilan tekshiriladi.
 * Mahsulot almashsa va u ro'yxatda bo'lsa — guruh mahsulotdan (formadagidek); o'qilgan holatga shartli yoziladi.
 */
export async function updateRealizationEntryField(id: string, field: EntryCell, value: string, userId: string): Promise<FieldResult> {
  const e = await db.realizationEntry.findUnique({ where: { id } });
  if (!e) return { error: "Qator topilmadi" };
  if (field === "unit" && e.productId) return { error: "O'lchov mahsulotdan olinadi — mahsulot kartasida o'zgartiriladi", field };
  const raw: Record<EntryCell, string> = {
    date: isoDate(e.date), payGroup: e.payGroup, seller: e.seller ?? "", customerName: e.customerName, productName: e.productName, groupName: e.groupName,
    unit: e.unit, ttn: e.ttn ?? "", vehicle: e.vehicle ?? "", qty: String(e.qty), price: String(e.price), delivery: String(e.delivery),
    loadPlace: e.loadPlace ?? "", destination: e.destination ?? "", note: e.note ?? "", refName: e.refName ?? "",
  };
  raw[field] = value;
  if (field === "productName" && (await entryLookup([], [value])).product(value.trim())) raw.groupName = "";
  const p = entrySchema.safeParse(raw);
  if (!p.success) {
    const is = p.error.issues[0];
    return { error: is?.message ?? "Qiymat noto'g'ri", field: String(is?.path[0] ?? field) };
  }
  return writeEntry(id, e, p.data, userId);
}

async function writeEntry(id: string, before: RealizationEntry | null, d: EntryInput, userId: string): Promise<Result> {
  if (!before) return { error: "Qator topilmadi" };
  if (before.cancelledAt) return { error: "Qator bekor qilingan" };
  if (future(d.date!)) return { error: "Sana kelajakda bo'lmasin" };
  const r = entryData(d, await entryLookup([d.customerName], [d.productName]));
  if ("error" in r) return { error: r.error! };
  const ok = await db.$transaction(async (tx) => {
    // Xaridor ro'yxatda yo'q bo'lsa — mijozlarga qo'shiladi (debitorkaga tushishi uchun)
    const data = { ...r.data, customerId: r.data.customerId ?? (await addMissingCustomers(tx, [r.data], userId)).idOf(r.data.customerName) };
    const u = await tx.realizationEntry.updateMany({ where: { id, cancelledAt: null, updatedAt: before.updatedAt }, data });
    if (u.count !== 1) return false;
    await audit(tx, userId, "UPDATE", "RealizationEntry", id, before, data);
    return true;
  });
  return ok ? { ok: true, id } : { error: "Qator boshqa joyda o'zgartirildi — sahifani yangilang" };
}

/**
 * Qo'lda / Excel qatorni o'chirish (Otabek, 2026-11-20 — bekor qilish o'rniga): qator bazadan o'chadi. Reestr, mijoz debitorkasi
 * («Sotib olgan», akt sverka, mijoz kartasi), kredit limiti, Tahlil (sotuv, marja, kunlik realizatsiya hisoboti) va «bugun kim
 * kiritmagan» uni jonli o'qiydi — hech qayerda qolmaydi. Kassa va skladga qo'lda qator ta'sir qilmagan, ular o'zgarmaydi.
 * Shu qator uchun avtomatik qo'shilgan mijoz yoki mahsulot (`addMissingCustomers` / `addMissingProducts`) boshqa hech qayerda
 * ishlatilmagan va keyin qo'lda tahrirlanmagan bo'lsa — u ham o'chadi. AuditLog'da DELETE + oxirgi holat nusxasi (sabab bilan) qoladi.
 * O'qilgan holatga shartli: shu payt tahrirlangan yoki boshqa joyda o'chirilgan qator ikkinchi marta yozilmaydi.
 */
export async function deleteRealizationEntry(id: string, reason: string, userId: string): Promise<{ ok: true; dropped: string[] } | { error: string }> {
  const why = String(reason ?? "").trim().slice(0, 300);
  const e = await db.$transaction(async (tx) => {
    const row = await tx.realizationEntry.findUnique({ where: { id } });
    if (!row) return null;
    const r = await tx.realizationEntry.deleteMany({ where: { id, updatedAt: row.updatedAt } });
    if (r.count !== 1) return null;
    await audit(tx, userId, "DELETE", "RealizationEntry", id, row, why ? { reason: why } : undefined);
    return row;
  });
  if (!e) return { error: "Qator topilmadi yoki shu payt o'zgardi — sahifani yangilang" };
  const dropped: string[] = [];
  if (e.customerId) { const c = await dropOrphanCustomer(e.customerId, userId); if (c) dropped.push(`mijoz «${c}»`); }
  if (e.productId) { const p = await dropOrphanProduct(e.productId, userId); if (p) dropped.push(`mahsulot «${p}»`); }
  return { ok: true, dropped };
}

/** FK bilan bog'liq yozuv chiqib qolsa (sanalmagani) — o'chirilmaydi, hammasi orqaga qaytadi. */
const isFkBlock = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2025");
/** Realizatsiya o'zi ochgan va keyin hech kim tahrirlamagan yozuv (AuditLog'da faqat CREATE). */
async function untouched(entity: "Customer" | "Product", id: string, made: Prisma.AuditLogWhereInput): Promise<boolean> {
  const [created, edited] = await Promise.all([
    db.auditLog.count({ where: { entity, entityId: id, action: "CREATE", ...made } }),
    db.auditLog.count({ where: { entity, entityId: id, action: { not: "CREATE" } } }),
  ]);
  return created > 0 && edited === 0;
}

/**
 * O'chirilgan qator uchun avtomatik qo'shilgan mijoz (`via: "realization-import"`): boshqa realizatsiya, zayavka, obyekt, schyot,
 * to'lov, kassa, qarz o'tkazmasi, boshlang'ich qoldiq, ariza, taklif, amoCRM'da uchramasa — o'chadi (mijozlar ro'yxatida ham qolmaydi).
 * Ixtiyoriy bog'lanishlar (SET NULL) o'chirishda jim uzilmasin — shu qulf ostida qayta sanaladi (`addMissingCustomers` bilan bir navbat).
 */
async function dropOrphanCustomer(id: string, userId: string): Promise<string | null> {
  const c = await db.customer.findUnique({ where: { id } });
  if (!c || c.isInternal || !(await untouched("Customer", id, { after: { path: ["via"], equals: "realization-import" } }))) return null;
  const where = { customerId: id };
  try {
    const done = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"realization-customers"}))`;
      const used = await Promise.all([
        tx.realizationEntry.count({ where }), tx.order.count({ where }), tx.site.count({ where }), tx.invoice.count({ where }), tx.payment.count({ where }),
        tx.paymentRequest.count({ where }), tx.salesRegister.count({ where }), tx.cashTransaction.count({ where }), tx.openingBalance.count({ where }),
        tx.lead.count({ where }), tx.commercialOffer.count({ where }), tx.amoDeal.count({ where }),
        tx.customerDebtTransfer.count({ where: { OR: [{ debtorId: id }, { payerId: id }] } }),
      ]);
      if (used.some((n) => n > 0)) return false;
      await tx.customer.delete({ where: { id } });
      await audit(tx, userId, "DELETE", "Customer", id, c, { via: "realization-delete" });
      return true;
    });
    if (!done) return null;
  } catch (e) {
    if (isFkBlock(e)) return null;
    throw e;
  }
  // ECO'da shu karta (tashkilot) bo'lsa — ilovada egasiz faol qolmasin (mijozni o'chirishdagidek)
  if (ecoEnabled()) notifyAfter(async () => { await eco.upsertCustomer({ externalRef: id, name: c.name, isActive: false }); });
  return c.name;
}

/**
 * O'chirilgan qator uchun Excel importi katalogga qo'shgan mahsulot (izohi «Realizatsiya Excel importidan»): boshqa realizatsiya,
 * zayavka, zames, reja, brak, sklad harakati, retsept, ariza, taklif, do'kon yoki boshlang'ich qoldiqda uchramasa — katalogdan o'chadi.
 */
async function dropOrphanProduct(id: string, userId: string): Promise<string | null> {
  const p = await db.product.findUnique({ where: { id } });
  if (!p || p.note !== IMPORTED_PRODUCT_NOTE || !(await untouched("Product", id, {}))) return null;
  const where = { productId: id };
  try {
    const done = await db.$transaction(async (tx) => {
      const used = await Promise.all([
        tx.realizationEntry.count({ where }), tx.orderItem.count({ where }), tx.productionBatch.count({ where }), tx.productionPlan.count({ where }),
        tx.productDefect.count({ where }), tx.stockMove.count({ where }), tx.recipe.count({ where }), tx.recipeItem.count({ where }), tx.lead.count({ where }),
        tx.commercialOfferItem.count({ where }), tx.openingBalance.count({ where }), tx.shopItem.count({ where }), tx.shopBanner.count({ where }),
      ]);
      if (used.some((n) => n > 0)) return false;
      await tx.product.delete({ where: { id } });
      await audit(tx, userId, "DELETE", "Product", id, p, { via: "realization-delete" });
      return true;
    });
    return done ? p.name : null;
  } catch (e) {
    if (isFkBlock(e)) return null;
    throw e;
  }
}

// ───────────────────────── Reysdan qatorga to'ldirish ─────────────────────────

/** Ortilgan joy, manzil, izoh, spravka nomi — bo'sh qoldirilgani taklifga qaytadi. Reys/zayavka ma'lumoti o'zgarmaydi. */
const noteTarget = (key: string) => key.startsWith("o:")
  ? db.order.findFirst({ where: { id: key.slice(2), kind: "SALE" }, select: { id: true } })
  : db.trip.findUnique({ where: { id: key }, select: { id: true } });

export async function saveRealizationNote(key: string, d: NoteInput, userId: string): Promise<Result> {
  if (!await noteTarget(key)) return { error: "Reys topilmadi" };
  await db.$transaction(async (tx) => {
    const before = await tx.realizationNote.findUnique({ where: { key } });
    const data = { loadPlace: d.loadPlace, destination: d.destination, note: d.note, refName: d.refName, updatedById: userId };
    await tx.realizationNote.upsert({ where: { key }, create: { key, ...data }, update: data });
    await audit(tx, userId, before ? "UPDATE" : "CREATE", "RealizationNote", key, before ?? undefined, data);
  });
  return { ok: true, id: key };
}

export const NOTE_CELLS = ["loadPlace", "destination", "note", "refName"] as const;
export type NoteCell = (typeof NOTE_CELLS)[number];

/** Jadval katagidan bitta maydon: faqat shu ustun yoziladi — boshqa katakni bir vaqtda tahrirlagan kishinikini bosib ketmaydi. */
export async function saveRealizationNoteField(key: string, field: NoteCell, value: string, userId: string): Promise<FieldResult> {
  const p = noteSchema.shape[field].safeParse(value);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Qiymat noto'g'ri", field };
  if (!await noteTarget(key)) return { error: "Reys topilmadi" };
  await db.$transaction(async (tx) => {
    const before = await tx.realizationNote.findUnique({ where: { key } });
    const data = { [field]: p.data, updatedById: userId };
    await tx.realizationNote.upsert({ where: { key }, create: { key, ...data }, update: data });
    await audit(tx, userId, before ? "UPDATE" : "CREATE", "RealizationNote", key, before ? { [field]: before[field] } : undefined, data);
  });
  return { ok: true, id: key };
}

// ───────────────────────── Reysdan qatorni tuzatish (faqat reestr) ─────────────────────────

/** Reys bo'yicha — shu reysning hamma qatoriga: sana, to'lov turi, sotuvchi, mashina; reyssiz qatorda TTN ham (reysda — `Trip.ttn`). */
export const TRIP_CELLS = ["date", "payGroup", "seller", "vehicle", "ttn"] as const;
export type TripCell = (typeof TRIP_CELLS)[number];
/** Zayavka mahsulot qatori bo'yicha (`RealizationLine`). Xaridor tuzatilmaydi — u zayavkada. */
export const LINE_CELLS = ["productName", "groupName", "unit", "qty", "price", "delivery"] as const;
export type LineCell = (typeof LINE_CELLS)[number];
export type AutoCell = TripCell | LineCell;

const EPOCH = new Date(0);
/** Bitta reys (yoki reyssiz zayavka) qatorlari asl qiymati bilan — tuzatishni asl qiymat bilan solishtirish uchun. */
const autoRowsOf = (key: string) =>
  realizationRows(EPOCH, EPOCH, key.startsWith("o:") ? { tripIds: [], orderIds: [key.slice(2)] } : { tripIds: [key], orderIds: [] });

const issue = (e: z.ZodError, field: string): FieldResult => ({ error: e.issues[0]?.message ?? "Qiymat noto'g'ri", field });

/** Reys bo'yicha bitta katak. Bo'sh qoldirilgani yoki asliga teng qiymat — tuzatish olib tashlanadi (zayavkadagisi ko'rinadi). */
export async function saveRealizationTripField(key: string, field: TripCell, value: string, userId: string): Promise<FieldResult> {
  const r = (await autoRowsOf(key))[0];
  if (!r) return { error: "Reys topilmadi" };
  if (field === "ttn" && r.tripId) return { error: "Reys TTN raqami reysning o'zida yoziladi", field };
  let set: { date: Date | null } | { [k: string]: string | null };
  if (field === "date") {
    const p = dayField.safeParse(value);
    if (!p.success) return issue(p.error, field);
    if (p.data && future(p.data)) return { error: "Sana kelajakda bo'lmasin", field };
    set = { date: p.data && isoDate(p.data) !== isoDate(r.date) ? p.data : null };
  } else if (field === "payGroup") {
    const v = value.trim();
    if (v && !(PAY_KEYS as string[]).includes(v)) return { error: "To'lov turini tanlang", field };
    set = { payGroup: v && v !== r.pay ? v : null };
  } else {
    const p = text(field === "seller" ? 100 : 40).safeParse(value);
    if (!p.success) return issue(p.error, field);
    const base = field === "seller" ? r.seller : field === "vehicle" ? r.vehicle : null;
    set = { [field]: p.data && p.data !== base ? p.data : null };
  }
  await db.$transaction(async (tx) => {
    const before = await tx.realizationNote.findUnique({ where: { key } });
    const data = { ...set, updatedById: userId };
    await tx.realizationNote.upsert({ where: { key }, create: { key, ...data }, update: data });
    await audit(tx, userId, before ? "UPDATE" : "CREATE", "RealizationNote", key, before ? { [field]: before[field] } : undefined, data);
  });
  return { ok: true, id: key };
}

type LineSet = { productName?: string | null; groupName?: string | null; unit?: string | null; qty?: number | null; price?: number | null; delivery?: number | null };

/**
 * Mahsulot qatori bo'yicha bitta katak (`key` — `RealizationRow.key`). Ro'yxatdagi mahsulot tanlansa o'lchov va guruh ham
 * undan (qo'lda qatordagidek); mahsulot bo'shatilsa — uchalasi zayavkadagiga qaytadi.
 */
export async function saveRealizationLineField(key: string, field: LineCell, value: string, userId: string): Promise<FieldResult> {
  // Kalit «<reys yoki zayavka id>-<qator id | fee>» — cuid'da chiziqcha yo'q
  const head = key.split("-")[0] ?? "";
  const trip = head ? await db.trip.findUnique({ where: { id: head }, select: { id: true } }) : null;
  const r = head ? (await autoRowsOf(trip ? head : `o:${head}`)).find((x) => x.key === key) : undefined;
  if (!r) return { error: "Qator topilmadi — sahifani yangilang" };
  const set: LineSet = {};
  if (field === "productName") {
    const p = text(200).safeParse(value);
    if (!p.success) return issue(p.error, field);
    const lk = p.data ? await entryLookup([], [p.data]) : null;
    const hit = p.data ? lk!.product(p.data) : null;
    const name = hit?.name ?? p.data;
    set.productName = name && name !== r.product ? name : null;
    if (hit || !name) {
      const group = hit ? lk!.group(hit.groupId) : null;
      set.groupName = group && group !== r.group ? group : null;
      set.unit = hit && hit.unit !== r.unitKey ? hit.unit : null;
    }
  } else if (field === "groupName") {
    const p = text(60).safeParse(value);
    if (!p.success) return issue(p.error, field);
    set.groupName = p.data && p.data !== r.group ? p.data : null;
  } else if (field === "unit") {
    const v = value.trim();
    if (v && !PRODUCT_UNITS.some(([u]) => u === v)) return { error: "O'lchov birligini tanlang", field };
    set.unit = v && v !== r.unitKey ? v : null;
  } else {
    const p = (field === "qty" ? numIn(0, 1_000_000) : numIn(0, 10_000_000_000)).safeParse(value);
    if (!p.success) return issue(p.error, field);
    if (field === "qty") {
      if (p.data !== null && p.data <= 0) return { error: "Miqdor 0 dan katta bo'lsin", field };
      set.qty = p.data !== null && Math.abs(p.data - r.qty) >= 0.0005 ? p.data : null;
    } else if (field === "delivery") {
      // Ustunda QQS'siz; tuzatish zayavka dastavkasidek saqlanadi — zayavkada QQS bo'lsa QQS bilan (`autoEdits`)
      const same = p.data !== null && Math.abs(p.data - r.delivery) < 0.005;
      set.delivery = p.data === null || same ? null : r3(r.feeNds ? p.data * (1 + NDS_RATE) : p.data);
    } else {
      const v = p.data === null ? null : r3(p.data);
      set[field] = v !== null && Math.abs(v - r[field]) >= 0.0005 ? v : null;
    }
  }
  await db.$transaction(async (tx) => {
    const before = await tx.realizationLine.findUnique({ where: { key } });
    const data = { ...set, updatedById: userId };
    await tx.realizationLine.upsert({ where: { key }, create: { key, ...data }, update: data });
    await audit(tx, userId, before ? "UPDATE" : "CREATE", "RealizationLine", key,
      before ? Object.fromEntries(Object.keys(set).map((k) => [k, before[k as keyof LineSet]])) : undefined, data);
  });
  return { ok: true, id: key };
}

// ───────────────────────── Excel'dan import ─────────────────────────

export type ImportRow = Record<string, unknown>;
/**
 * `problems` — o'qilmagan va qo'shilmagan qatorlar (sabab bilan); `guessedUnits` — ro'yxatda yo'q mahsulot o'lchovi
 * ko'rsatilmagan yoki tanilmagan, nomidan qo'yilgan qatorlar soni; `newProducts` / `newCustomers` — katalogga qo'shilgan
 * mahsulotlar va mijozlar ro'yxatiga qo'shilgan xaridorlar nomi.
 */
export type ImportResult =
  | { ok: true; added: number; skipped: number; problems: string[]; guessedUnits: number; newProducts: string[]; newCustomers: string[]; from: Date; to: Date }
  | { error: string };

const IMPORT_MAX = 3000;
const DAY = 86_400_000;

/**
 * To'lov turi so'z boshidan (`matchKey` ko'rinishida): «Перечисление», «Безнал», «п-р», «б/н» → BANK;
 * «Нал», «Нақд», «н-к» → CASH; «Қарз», «Долг» → DEBT.
 */
const PAY_WORDS: [PayGroupKey, RegExp][] = [
  ["BANK", /^(perec|bezn|bank|xisob|pr$|pp$|bn$|bnal)/],
  ["CASH", /^(naqd|nakd|naqt|nal|cash|nk$)/],
  ["DEBT", /^(qarz|karz|dolg|nasiya|nasia|tekin|debt)/],
];

/** Ro'yxatda yo'q mahsulotning o'lchovi ko'rsatilmagan yoki tanilmagan — nomidan: ustun, blok, bordyur, halqa… → dona, qolgani (beton, shag'al) → m³. */
const PIECE_WORDS = /ustun|устун|stolb|столб|fbs|фбс|blok|блок|bord[yu]r|бордюр|halqa|xalqa|кольц|lotok|лоток|truba|труб/i;
const guessUnit = (product: string) => (PIECE_WORDS.test(product) ? "dona" : "m3");
const isProductUnit = (u: string | null) => !!u && PRODUCT_UNITS.some(([k]) => k === u);

/** O'tkazilgan qatorlar ro'yxati xabarga: birinchi `max` tasi, qolgani soni bilan. */
export const listProblems = (p: string[], max = 8) => `${p.slice(0, max).join("; ")}${p.length > max ? `; yana ${p.length - max} ta` : ""}`;
export function payGroupOf(v: string): PayGroupKey | null {
  // Oynadagi «Qiymatlarni moslash» tizim kalitini yuboradi (CASH…) — `matchKey` uni «casx» qilib qo'yadi
  const key = v.trim().toUpperCase();
  if ((PAY_KEYS as string[]).includes(key)) return key as PayGroupKey;
  const k = matchKey(v);
  return k ? PAY_WORDS.find(([, re]) => re.test(k))?.[0] ?? null : null;
}

/** TTN solishtirish kaliti: «N-2026-00161», «ТТН-161», «№161», «161» — bitta. */
const ttnKey = (v: string | null) => matchKey((v ?? "").replace(/^.*-0*(?=\d)/, "")).replace(/^0+(?=\d)/, "");
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Takrorni topish uchun qatorning solishtiriladigan qismi: nomlar `matchKey` bilan (kirill/lotin, katta-kichik farqi yo'q). */
type Seen = { day: number; customerId: string | null; cust: string; prod: string; qty: number; ttn: string; vehicle: string };
const seenOf = (r: { date: Date; customerId: string | null; customer: string; product: string; qty: number; ttn: string | null; vehicle: string | null }): Seen => ({
  day: day0(r.date), customerId: r.customerId, cust: matchKey(r.customer), prod: matchKey(r.product), qty: r.qty, ttn: ttnKey(r.ttn), vehicle: matchKey(r.vehicle ?? ""),
});
const sameCust = (a: Seen, b: Seen) => (!!a.customerId && a.customerId === b.customerId) || (!!a.cust && a.cust === b.cust);
const sameQty = (a: Seen, b: Seen) => Math.abs(a.qty - b.qty) < 0.0005;

/**
 * Varaqdagi jo'natmalar → qo'lda qatorlar (bitta formadagi qoidalar bilan).
 * Xato qator importni to'xtatmaydi: sana, to'lov turi, xaridor yoki miqdori o'qilmagan qator sababi bilan `problems` ga tushadi,
 * qolganlari yoziladi. Ro'yxatda yo'q xaridor mijozlarga (`addMissingCustomers`), ro'yxatda yo'q mahsulot katalogga
 * (`addMissingProducts`; o'lchovi tanilmasa nomidan) qo'shiladi va qator ularga bog'lanadi.
 * Uzun matn forma chegarasida kesiladi. Reestrda bor qator o'tkazib yuboriladi:
 *  · TTN bor — shu TTN reysdan yoki qo'lda qatorda ±1 kun ichida bor (mijoz, mahsulot, miqdor yoki mashinadan biri mos);
 *  · TTN'siz — o'sha kuni xaridor, mahsulot va miqdori bir xil qator bor (har mavjud qator bitta fayl qatoriga sanaladi).
 * Ikki import bir vaqtda kelsa — qulf ostida navbat bilan, ikkinchisi birinchisi yozganini ko'radi.
 */
export async function importRealizationEntries(rows: ImportRow[], maps: ValueMaps, userId: string): Promise<ImportResult> {
  if (!rows.length) return { error: "Faylda qator yo'q" };
  if (rows.length > IMPORT_MAX) return { error: `Bir martada ko'pi bilan ${IMPORT_MAX} qator — faylni bo'lib yuklang` };
  const pay = valueMapper(maps, "payGroup");
  const problems: string[] = [];
  const where = (i: number, name: string) => `${i + 1}-qator${name ? ` (${name})` : ""}`;

  const inputs: { d: EntryInput; i: number }[] = [];
  rows.forEach((x, i) => {
    const cell = (k: string) => {
      const v = str(x[k]).replace(/\s+/g, " ");
      const max = MAX_LEN[k as keyof typeof MAX_LEN];
      return max && v.length > max ? v.slice(0, max).trimEnd() : v;
    };
    // Raqam katakdan (minglik ajratkich, vergul) — o'qilmasa matnicha qoladi va forma qoidasi xato beradi
    const amount = (k: string, read: (v: unknown) => number) => {
      if (!cell(k)) return "";
      const n = read(x[k]);
      return Number.isFinite(n) ? String(n) : cell(k);
    };
    const date = parseDate(x.date);
    const payGroup = payGroupOf(pay(cell("payGroup")));
    // Fayldagi qiymat bor, lekin o'qilmadi — qiymatning o'zi bilan aytiladi (forma xabari «tanlang» bo'lib chalg'itmasin)
    if (cell("date") && !date) { problems.push(`${where(i, cell("customerName"))}: sana o'qilmadi — «${cell("date")}»`); return; }
    if (cell("payGroup") && !payGroup) { problems.push(`${where(i, cell("customerName"))}: to'lov turi aniqlanmadi — «${cell("payGroup")}» (Perechisleniye, Naqd yoki Qarz)`); return; }
    const p = entrySchema.safeParse({
      date: date ? isoDate(date) : "",
      payGroup: payGroup ?? "",
      seller: cell("seller"), customerName: cell("customerName"), productName: cell("productName"), groupName: cell("groupName"),
      unit: normalizeUnit(cell("unit")) ?? cell("unit"), ttn: cell("ttn"), vehicle: cell("vehicle"),
      qty: amount("qty", num), price: amount("price", numMoney), delivery: amount("delivery", numMoney),
      loadPlace: cell("loadPlace"), destination: cell("destination"), note: cell("note"), refName: cell("refName"),
    });
    if (!p.success) {
      const is = p.error.issues[0];
      const label = ENTRY_LABELS[String(is.path[0] ?? "")];
      problems.push(`${where(i, cell("customerName"))}: ${label && !is.message.startsWith(label) ? `${label} — ` : ""}${is.message}`);
    } else if (future(p.data.date!)) problems.push(`${where(i, p.data.customerName)}: sana kelajakda`);
    else inputs.push({ d: p.data, i });
  });

  // Ro'yxatda yo'q mahsulot ham qo'shiladi: o'lchovi ko'rsatilmagan yoki tanilmagan bo'lsa — nomidan (forma «tanlang» deydi, import to'xtamaydi)
  const lk = inputs.length ? await entryLookup(inputs.map((x) => x.d.customerName), inputs.map((x) => x.d.productName)) : null;
  let guessedUnits = 0;
  const data = lk ? inputs.flatMap(({ d, i }) => {
    if (!lk.product(d.productName) && !isProductUnit(d.unit)) {
      guessedUnits++;
      d = { ...d, unit: guessUnit(d.productName) };
    }
    const r = entryData(d, lk);
    if ("error" in r) { problems.push(`${where(i, d.customerName)}: ${r.error}`); return []; }
    return [r.data];
  }) : [];
  if (!data.length) {
    return { error: `Hech bir qator qo'shilmadi — ${listProblems(problems)}. Faylni tuzatib qayta yuklang` };
  }

  const times = data.map((b) => day0(b.date));
  const from = new Date(Math.min(...times)), to = new Date(Math.max(...times));
  const auto = (await realizationRows(new Date(from.getTime() - DAY), new Date(to.getTime() + DAY))).map(seenOf);

  const res = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"realization-import"}))`;
    const manual = await tx.realizationEntry.findMany({
      where: { cancelledAt: null, date: { gte: new Date(from.getTime() - DAY), lt: new Date(to.getTime() + 2 * DAY) } },
      select: { date: true, customerId: true, customerName: true, productName: true, qty: true, ttn: true, vehicle: true },
    });
    const existing = [...auto, ...manual.map((e) => seenOf({ ...e, customer: e.customerName, product: e.productName, qty: Number(e.qty) }))];
    const used = new Set<number>();
    const fresh = data.filter((b) => {
      const s = seenOf({ ...b, customer: b.customerName, product: b.productName });
      if (s.ttn && existing.some((e) => e.ttn === s.ttn && Math.abs(e.day - s.day) <= DAY
        && (sameCust(e, s) || e.prod === s.prod || sameQty(e, s) || (!!s.vehicle && e.vehicle === s.vehicle)))) return false;
      const twin = existing.findIndex((e, j) => !used.has(j) && e.day === s.day && (!s.ttn || !e.ttn) && sameCust(e, s) && e.prod === s.prod && sameQty(e, s));
      if (twin < 0) return true;
      used.add(twin);
      return false;
    });
    if (!fresh.length) return { added: 0, skipped: data.length, newProducts: [], newCustomers: [] };
    const cat = await addMissingProducts(tx, fresh, userId);
    const cust = await addMissingCustomers(tx, fresh, userId);
    const created = await tx.realizationEntry.createManyAndReturn({
      data: fresh.map((b) => ({
        ...b, productId: b.productId ?? cat.idOf(b.productName), customerId: b.customerId ?? cust.idOf(b.customerName), createdById: userId,
      })),
    });
    await auditMany(tx, userId, "CREATE", "RealizationEntry", created.map((row) => ({ id: row.id, after: row })));
    // Avvalgi importlardagi (mijoz qo'shilmasdan oldingi) bog'lanmagan qatorlar ham shu yerda bog'lanadi
    const old = await linkEntriesIn(tx, userId);
    return { added: created.length, skipped: data.length - created.length, newProducts: cat.created, newCustomers: [...cust.created, ...old.newCustomers] };
  }, { timeout: 60_000 });
  return { ok: true, ...res, problems, guessedUnits, from, to };
}

/**
 * Importda ro'yxatda yo'q mahsulot katalogga ham qo'shiladi (Otabek, 2026-11-12): faol, narxi 0, o'lchovi qatordagidek,
 * papkasi — «Guruh» nomli mavjud papka (yangi papka ochilmaydi, topilmasa ro'yxat ildizida), izohida qayerdan kelgani.
 * Bir xil nom (katta-kichik harfsiz) — bitta mahsulot. Import qulfi ostida qayta tekshiriladi: shu orada qo'shilgan bo'lsa
 * yangisi ochilmaydi, o'shanga bog'lanadi. Faqat yoziladigan (reestrda yo'q) qatorlar uchun.
 */
async function addMissingProducts(
  tx: Prisma.TransactionClient,
  rows: readonly { productId: string | null; productName: string; unit: string; groupName: string }[],
  userId: string,
): Promise<{ idOf: (name: string) => string | null; created: string[] }> {
  const lc = (v: string) => v.toLowerCase();
  const want = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!r.productId && !want.has(lc(r.productName))) want.set(lc(r.productName), r);
  const idOf = new Map<string, string>();
  const created: string[] = [];
  const result = { idOf: (n: string) => idOf.get(lc(n)) ?? null, created };
  if (!want.size) return result;

  const ci = (v: string) => ({ equals: v, mode: "insensitive" as const });
  const [have, groups] = await Promise.all([
    tx.product.findMany({ where: { OR: [...want.values()].flatMap((r) => [{ name: ci(r.productName) }, { code: ci(r.productName) }]) }, orderBy: { isActive: "desc" }, select: { id: true, name: true, code: true } }),
    tx.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  for (const p of have) if (!idOf.has(lc(p.name))) idOf.set(lc(p.name), p.id);
  for (const p of have) if (!idOf.has(lc(p.code))) idOf.set(lc(p.code), p.id);
  // Papka nomi `matchKey` bilan (kirill/lotin farqsiz), ildiz papka ustun
  const groupId = (name: string) => {
    const k = matchKey(name);
    const hit = groups.filter((g) => matchKey(g.name) === k);
    return (hit.find((g) => !g.parentId) ?? hit[0])?.id ?? null;
  };
  let seq = Number(await nextCatalogCode(tx)) - 1;
  for (const [key, r] of want) {
    if (idOf.has(key)) continue;
    const p = await tx.product.create({
      data: { code: String(++seq), name: r.productName, unit: r.unit, groupId: groupId(r.groupName), note: IMPORTED_PRODUCT_NOTE },
    });
    await audit(tx, userId, "CREATE", "Product", p.id, undefined, p);
    idOf.set(key, p.id);
    created.push(p.name);
  }
  return result;
}

/**
 * Ro'yxatda yo'q xaridor mijozlar ro'yxatiga qo'shiladi — import (Otabek, 2026-11-12), qo'lda qator va uning tahriri
 * (2026-11-17): nomi bilan, standart kredit limiti (Sozlamalar → Limitlar), AuditLog'da `via: "realization-import"`.
 * Qator mijozga bog'lanadi va uning debitorkasiga tushadi (`lib/debt-sales.ts`); kassa va skladga ta'sir yo'q. Bir xil nom (katta-kichik harfsiz) — bitta mijoz; import qulfi ostida
 * nomi yoki aliasi bo'yicha qayta tekshiriladi. Faqat yoziladigan (reestrda yo'q) qatorlar uchun.
 */
async function addMissingCustomers(
  tx: Prisma.TransactionClient,
  rows: readonly { customerId: string | null; customerName: string }[],
  userId: string,
): Promise<{ idOf: (name: string) => string | null; created: string[] }> {
  // Nom kaliti (`customerNameKey`) — «Kirpichniy dom», «KIRPICHNIY  DOM.» va «Кирпичный дом» bitta mijoz (takror ochilmasin)
  const ck = customerNameKey;
  const want = new Map<string, string>();
  for (const r of rows) { const k = ck(r.customerName); if (!r.customerId && k && !want.has(k)) want.set(k, r.customerName.replace(/\s+/g, " ").trim()); }
  const idOf = new Map<string, string>();
  const created: string[] = [];
  const result = { idOf: (n: string) => idOf.get(ck(n)) ?? null, created };
  if (!want.size) return result;
  // Qo'lda qator, tahrir va import bir vaqtda bir xil yangi nomni ikki mijoz qilib yubormasin
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"realization-customers"}))`;
  // Mijoz kartasi / zayavka formasi bilan ham bir navbat (`lib/customer-name.ts`)
  for (const name of [...want.values()].sort()) await lockCustomerName(tx, name);

  const have = await tx.customer.findMany({ where: { isInternal: false }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, aliases: true } });
  for (const c of have) { const k = ck(c.name); if (k && !idOf.has(k)) idOf.set(k, c.id); }
  for (const c of have) for (const a of c.aliases) { const k = ck(a); if (k && !idOf.has(k)) idOf.set(k, c.id); }
  const limit = await defaultCreditLimit(tx);
  for (const [key, name] of want) {
    if (idOf.has(key)) continue;
    const c = await tx.customer.create({ data: { name, creditLimit: limit } });
    await audit(tx, userId, "CREATE", "Customer", c.id, undefined, { ...c, via: "realization-import" });
    idOf.set(key, c.id);
    created.push(c.name);
  }
  return result;
}

/**
 * Mijozga bog'lanmagan (bekor qilinmagan) qo'lda/Excel qatorlar — nomi (yoki aliasi) bo'yicha mijozga bog'lanadi, ro'yxatda
 * yo'q bo'lsa mijoz qo'shiladi. 2026-11-12 gacha import mijoz qo'shmagan edi — o'sha qatorlar debitorkaga tushmay qolgan.
 * Importda o'zi chaqiriladi; prodda bir martalik: `scripts/realizatsiya-mijoz-boglash.ts`.
 */
export async function linkEntriesIn(tx: Prisma.TransactionClient, userId: string): Promise<{ linked: number; newCustomers: string[] }> {
  const rows = await tx.realizationEntry.findMany({ where: { cancelledAt: null, customerId: null }, select: { id: true, customerName: true } });
  if (!rows.length) return { linked: 0, newCustomers: [] };
  const cust = await addMissingCustomers(tx, rows.map((r) => ({ customerId: null, customerName: r.customerName })), userId);
  const byCustomer = new Map<string, string[]>();
  for (const r of rows) {
    const id = cust.idOf(r.customerName);
    if (id) byCustomer.set(id, [...(byCustomer.get(id) ?? []), r.id]);
  }
  let linked = 0;
  for (const [customerId, ids] of byCustomer) {
    linked += (await tx.realizationEntry.updateMany({ where: { id: { in: ids }, customerId: null }, data: { customerId } })).count;
    await auditMany(tx, userId, "UPDATE", "RealizationEntry", ids.map((id) => ({ id, after: { customerId, via: "realization-link" } })));
  }
  return { linked, newCustomers: cust.created };
}

// ───────────────────────── Reysdan qatorni manbada tuzatish (zayavka va reys) ─────────────────────────

/**
 * «Realizatsiya: zayavka va reysni tahrirlash» (`logistika.real_source`, Otabek 2026-11-17: «tahrirlangandan keyin boshqa joylar ham
 * o'zgarsin»): reysdan qatordagi tahrir reestrga emas, manbaning o'ziga yoziladi — zayavka, reys, Tahlil, debitorka, mijoz kartasi,
 * nakladnoy hammasi yangi qiymatni ko'radi. Shu ustunning reestrdagi eski tuzatishi (`RealizationNote`/`RealizationLine`) olib tashlanadi.
 *  · Xaridor → zayavka mijozi (ro'yxatda yo'q bo'lsa mijozlarga qo'shiladi). Schyot, to'lov yoki bosh to'lov so'rovi bor zayavkada — rad.
 *  · Sana → reysning yuklangan (va yetkazilgan) vaqti soati saqlanib, sklad jo'natma yozuvi sanasi ham; reyssiz zayavkada — yetkazish sanasi.
 *  · To'lov turi → zayavkaning «qarzga» belgisi va to'lov usuli. Mashina → reys texnikasi (raqami ro'yxatda bo'lishi shart).
 *  · Mahsulot → zayavka qatori mahsuloti (katalogda bo'lishi, o'lchovi bir xil bo'lishi shart) va shu zayavka reyslarining sklad yozuvlari.
 *  · Miqdor → reys yuki (bitta mahsulotli zayavkada; ko'p mahsulotlida reys yuki qatorlarga bo'lingani uchun — faqat reestrda) va
 *    sklad jo'natmasiga farq yoziladi; reyssiz zayavkada — zayavka qatori miqdori.
 *  · Narx → zayavka qatori narxi (QQS belgisi bo'lsa QQS qo'shib saqlanadi) — shu qatorning hamma reysiga. Dastavka → zayavka dastavkasi.
 * Sotuvchi, guruh, o'lchov, ortilgan joy, manzil, izoh, spravka nomi va reyssiz qator TTN'i — reestrda (ular zayavka/reysning
 * o'z maydoni emas yoki butun katalogga ta'sir qiladi). `null` qaytsa — bu katak manbaga yozilmaydi, chaqiruvchi reestrga yozadi.
 */
export const SOURCE_NOTE_CELLS = ["customerName", "date", "payGroup", "vehicle"] as const;
export type SourceNoteCell = (typeof SOURCE_NOTE_CELLS)[number];
export const SOURCE_LINE_CELLS = ["productName", "qty", "price", "delivery"] as const;
export type SourceLineCell = (typeof SOURCE_LINE_CELLS)[number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const plateKey = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();

/** Shu ustunlarning reestrdagi tuzatishini olib tashlash (manbaga yozilgani ko'rinsin). */
async function dropNote(tx: Prisma.TransactionClient, key: string, fields: string[]) {
  const n = await tx.realizationNote.findUnique({ where: { key } });
  if (n && fields.some((f) => n[f as keyof RealizationNote] != null)) await tx.realizationNote.update({ where: { key }, data: Object.fromEntries(fields.map((f) => [f, null])) });
}
async function dropLine(tx: Prisma.TransactionClient, keys: string[], fields: string[]) {
  if (!keys.length) return;
  await tx.realizationLine.updateMany({ where: { key: { in: keys } }, data: Object.fromEntries(fields.map((f) => [f, null])) });
}

class SourceError extends Error {}
const run = async (f: () => Promise<void>, id: string, field: string): Promise<FieldResult> => {
  try { await f(); return { ok: true, id }; } catch (e) {
    if (e instanceof SourceError) return { error: e.message, field };
    throw e;
  }
};

const orderOf = (id: string) => db.order.findUnique({
  where: { id },
  select: {
    id: true, kind: true, status: true, customerId: true, siteId: true, deliveryAddress: true, lat: true, lng: true, deliveryDate: true,
    payMethod: true, onCredit: true, deliveryFee: true, updatedAt: true, items: { select: { nds: true } },
    customer: { select: { name: true } }, site: { select: { customerId: true } },
    trips: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
    _count: { select: { invoices: { where: { status: { not: "CANCELLED" } } }, payments: true } }, payRequest: { select: { id: true } },
  },
});

/** Reys bo'yicha ustun (`key` — reys id yoki «o:<zayavka id>»). */
export async function saveSourceNoteField(key: string, field: SourceNoteCell, value: string, userId: string): Promise<FieldResult | null> {
  const tripId = key.startsWith("o:") ? null : key;
  const trip = tripId ? await db.trip.findUnique({ where: { id: tripId }, select: { id: true, orderId: true, status: true, loadedAt: true, deliveredAt: true, vehicleId: true } }) : null;
  if (tripId && !trip) return { error: "Reys topilmadi" };
  const o = await orderOf(trip?.orderId ?? key.slice(2));
  if (!o || o.kind !== "SALE") return { error: "Zayavka topilmadi" };
  if (o.status === "CANCELLED") return { error: "Zayavka bekor qilingan", field };
  const v = value.trim();

  if (field === "customerName") {
    if (v.length < 2) return { error: "Xaridor nomini yozing", field };
    if (v.toLowerCase() === o.customer.name.toLowerCase()) return { ok: true, id: key };
    if (o._count.invoices || o._count.payments || o.payRequest)
      return { error: "Zayavkaga schyot, to'lov yoki bosh to'lov so'rovi bog'langan — xaridorni avval o'shalarda tuzating", field };
    const found = (await entryLookup([v], [])).customer(v);
    return run(async () => {
      await db.$transaction(async (tx) => {
        const customerId = found ?? (await addMissingCustomers(tx, [{ customerId: null, customerName: v }], userId)).idOf(v);
        if (!customerId) throw new SourceError("Xaridor topilmadi");
        // Obyekt kartasi mijozniki — yangi mijozga shu manzil bilan (bor bo'lsa o'sha)
        const siteId = o.siteId && o.site?.customerId !== customerId ? await ensureSite(tx, customerId, o.deliveryAddress, { lat: o.lat, lng: o.lng }) : o.siteId;
        const u = await tx.order.updateMany({ where: { id: o.id, customerId: o.customerId, updatedAt: o.updatedAt }, data: { customerId, siteId } });
        if (u.count !== 1) throw new SourceError("Zayavka shu payt o'zgardi — sahifani yangilang");
        await audit(tx, userId, "UPDATE", "Order", o.id, { customerId: o.customerId, siteId: o.siteId }, { customerId, siteId, via: "realizatsiya" });
      });
    }, key, field);
  }

  if (field === "date") {
    const p = dayField.safeParse(v);
    if (!p.success) return issue(p.error, field);
    if (!p.data) return { error: "Sanani tanlang", field };
    const day = p.data;
    if (future(day)) return { error: "Sana kelajakda bo'lmasin", field };
    // Hali yuklanmagan reysda yuklangan vaqt yo'q — sana faqat reestrda
    if (trip && !trip.loadedAt) return null;
    return run(async () => {
      await db.$transaction(async (tx) => {
        if (trip) {
          const old = trip.loadedAt!;
          const at = new Date(day); at.setHours(old.getHours(), old.getMinutes(), old.getSeconds(), old.getMilliseconds());
          const shift = at.getTime() - old.getTime();
          if (shift) {
            const deliveredAt = trip.deliveredAt ? new Date(trip.deliveredAt.getTime() + shift) : null;
            const u = await tx.trip.updateMany({ where: { id: trip.id, loadedAt: old }, data: { loadedAt: at, ...(deliveredAt ? { deliveredAt } : {}) } });
            if (u.count !== 1) throw new SourceError("Reys shu payt o'zgardi — sahifani yangilang");
            // Skladdagi jo'natma yozuvi ham shu kunga (qoldiq hisobotlari sana bo'yicha)
            const moves = await tx.stockMove.findMany({ where: { refType: "Trip", refId: trip.id, type: "SHIPMENT" }, select: { id: true, date: true } });
            for (const m of moves) await tx.stockMove.update({ where: { id: m.id }, data: { date: new Date(m.date.getTime() + shift) } });
            await audit(tx, userId, "UPDATE", "Trip", trip.id, { loadedAt: old, deliveredAt: trip.deliveredAt }, { loadedAt: at, deliveredAt, via: "realizatsiya" });
          }
        } else if (isoDate(day) !== isoDate(o.deliveryDate)) {
          const u = await tx.order.updateMany({ where: { id: o.id, updatedAt: o.updatedAt }, data: { deliveryDate: day } });
          if (u.count !== 1) throw new SourceError("Zayavka shu payt o'zgardi — sahifani yangilang");
          await audit(tx, userId, "UPDATE", "Order", o.id, { deliveryDate: o.deliveryDate }, { deliveryDate: day, via: "realizatsiya" });
        }
        await dropNote(tx, key, ["date"]);
      });
    }, key, field);
  }

  if (field === "payGroup") {
    if (!(PAY_KEYS as string[]).includes(v)) return { error: "To'lov turini tanlang", field };
    const data = v === "DEBT" ? { onCredit: true } : { onCredit: false, payMethod: v === "BANK" ? "BANK" as const : "CASH" as const };
    return run(async () => {
      await db.$transaction(async (tx) => {
        const u = await tx.order.updateMany({ where: { id: o.id, updatedAt: o.updatedAt }, data });
        if (u.count !== 1) throw new SourceError("Zayavka shu payt o'zgardi — sahifani yangilang");
        await audit(tx, userId, "UPDATE", "Order", o.id, { onCredit: o.onCredit, payMethod: o.payMethod }, { ...data, via: "realizatsiya" });
        await dropNote(tx, key, ["payGroup"]);
      });
    }, key, field);
  }

  // Mashina: reyssiz (o'zi olib ketgan) qatorda — faqat reestrda
  if (!trip) return null;
  if (!v) return { error: "Mashina raqamini yozing", field };
  const vehicles = await db.vehicle.findMany({ select: { id: true, plate: true } });
  const hit = vehicles.find((x) => plateKey(x.plate) === plateKey(v));
  if (!hit) return { error: `«${v}» raqamli mashina ro'yxatda yo'q — Logistika → Transport'da qo'shing yoki ro'yxatdan tanlang`, field };
  if (hit.id === trip.vehicleId) return run(() => db.$transaction((tx) => dropNote(tx, key, ["vehicle"])), key, field);
  return run(async () => {
    await db.$transaction(async (tx) => {
      const u = await tx.trip.updateMany({ where: { id: trip.id, vehicleId: trip.vehicleId }, data: { vehicleId: hit.id } });
      if (u.count !== 1) throw new SourceError("Reys shu payt o'zgardi — sahifani yangilang");
      await audit(tx, userId, "UPDATE", "Trip", trip.id, { vehicleId: trip.vehicleId }, { vehicleId: hit.id, via: "realizatsiya" });
      await dropNote(tx, key, ["vehicle"]);
    });
  }, key, field);
}

/** Zayavka qatori bo'yicha ustun (`key` — `RealizationRow.key`: «<reys yoki zayavka id>-<qator id>»). */
export async function saveSourceLineField(key: string, field: SourceLineCell, value: string, userId: string): Promise<FieldResult | null> {
  const [head = "", itemId = ""] = key.split("-");
  if (!head || !itemId) return null;
  if (itemId === "fee") {
    // Faqat dastavkali (mahsulot qatorisiz) zayavka
    if (field !== "delivery") return null;
    const t = await db.trip.findUnique({ where: { id: head }, select: { orderId: true } });
    const fo = await orderOf(t?.orderId ?? head);
    if (!fo || fo.kind !== "SALE" || fo.status === "CANCELLED") return { error: "Zayavka topilmadi", field };
    return saveFee(fo);
  }
  const trip = await db.trip.findUnique({
    where: { id: head },
    select: { id: true, orderId: true, status: true, qtyM3: true, acceptedQty: true },
  });
  const item = await db.orderItem.findUnique({
    where: { id: itemId },
    select: { id: true, orderId: true, productId: true, price: true, nds: true, qtyM3: true, product: { select: { name: true, unit: true } } },
  });
  if (!item || (trip ? trip.orderId : head) !== item.orderId) return { error: "Qator topilmadi — sahifani yangilang" };
  const o = await orderOf(item.orderId);
  if (!o || o.kind !== "SALE") return { error: "Zayavka topilmadi" };
  if (o.status === "CANCELLED") return { error: "Zayavka bekor qilingan", field };
  const itemCount = await db.orderItem.count({ where: { orderId: o.id } });
  const v = value.trim();
  return field === "delivery" ? saveFee(o) : field === "price" ? savePrice() : field === "qty" ? saveQty() : saveProduct();

  async function saveFee(order: NonNullable<Awaited<ReturnType<typeof orderOf>>>): Promise<FieldResult> {
    const p = numIn(0, 10_000_000_000).safeParse(value);
    if (!p.success) return issue(p.error, field);
    // Reestrda dastavka QQS'siz; zayavkada QQS bo'lsa QQS qo'shib saqlanadi (`feeHasNds`)
    const nds = feeHasNds(order.items), cur = Number(order.deliveryFee);
    if (Math.abs((p.data ?? 0) - (nds ? withoutNds(cur) : cur)) < 0.005) return { ok: true, id: key };
    const fee = nds ? withNds(p.data ?? 0) : r2(p.data ?? 0);
    return run(async () => {
      await db.$transaction(async (tx) => {
        const u = await tx.order.updateMany({ where: { id: order.id, updatedAt: order.updatedAt }, data: { deliveryFee: fee } });
        if (u.count !== 1) throw new SourceError("Zayavka shu payt o'zgardi — sahifani yangilang");
        await audit(tx, userId, "UPDATE", "Order", order.id, { deliveryFee: order.deliveryFee }, { deliveryFee: fee, via: "realizatsiya" });
        await dropLine(tx, [key], ["delivery"]);
      });
    }, key, field);
  }

  async function savePrice(): Promise<FieldResult> {
    const p = numIn(0, 10_000_000_000).safeParse(value);
    if (!p.success) return issue(p.error, field);
    if (p.data === null) return { error: "Narxni yozing", field };
    // Reestrda narx QQSsiz; zayavka qatorida «QQS 12%» bo'lsa narx QQS bilan saqlanadi
    const price = r2(item!.nds ? p.data * (1 + NDS_RATE) : p.data);
    return run(async () => {
      await db.$transaction(async (tx) => {
        const u = await tx.orderItem.updateMany({ where: { id: item!.id, price: item!.price }, data: { price } });
        if (u.count !== 1) throw new SourceError("Zayavka qatori shu payt o'zgardi — sahifani yangilang");
        await audit(tx, userId, "UPDATE", "OrderItem", item!.id, { price: item!.price }, { price, orderId: o!.id, via: "realizatsiya" });
        // Narx qatorning hamma reysiga — ularning reestrdagi narx tuzatishi ham olinadi
        await dropLine(tx, [`${o!.id}-${item!.id}`, ...o!.trips.map((t) => `${t.id}-${item!.id}`)], ["price"]);
      });
    }, key, field);
  }

  async function saveQty(): Promise<FieldResult | null> {
    const p = numIn(0, 1_000_000).safeParse(value);
    if (!p.success) return issue(p.error, field);
    if (p.data === null || p.data <= 0) return { error: "Miqdor 0 dan katta bo'lsin", field };
    const q = r3(p.data);
    if (!trip) {
      // Reyssiz (o'zi olib ketgan) zayavka: qator miqdorining o'zi
      return run(async () => {
        await db.$transaction(async (tx) => {
          const u = await tx.orderItem.updateMany({ where: { id: item!.id, qtyM3: item!.qtyM3 }, data: { qtyM3: q } });
          if (u.count !== 1) throw new SourceError("Zayavka qatori shu payt o'zgardi — sahifani yangilang");
          await audit(tx, userId, "UPDATE", "OrderItem", item!.id, { qtyM3: item!.qtyM3 }, { qtyM3: q, orderId: o!.id, via: "realizatsiya" });
          await dropLine(tx, [key], ["qty"]);
        });
      }, key, field);
    }
    // Ko'p mahsulotli zayavkada reys yuki qatorlarga bo'lingan — bitta qatorning ulushini reysga yozib bo'lmaydi
    if (itemCount > 1) return null;
    const loaded = Number(trip.qtyM3);
    const shown = trip.acceptedQty != null ? Number(trip.acceptedQty) : loaded;
    const delta = r3(q - shown);
    if (Math.abs(delta) < 0.0005) return run(() => db.$transaction((tx) => dropLine(tx, [key], ["qty"])), key, field);
    const qtyM3 = r3(loaded + delta);
    if (qtyM3 <= 0) return { error: "Reys yuki 0 dan katta bo'lsin", field };
    return run(async () => {
      await db.$transaction(async (tx) => {
        await lockStock(tx);
        const u = await tx.trip.updateMany({ where: { id: trip.id, qtyM3: trip.qtyM3 }, data: { qtyM3, ...(trip.acceptedQty != null ? { acceptedQty: q } : {}) } });
        if (u.count !== 1) throw new SourceError("Reys shu payt o'zgardi — sahifani yangilang");
        // Yuklangan reysda skladdan chiqim farqqa tuzatiladi: oxirgi jo'natma yozuvi ombori va sanasi bilan
        const last = await tx.stockMove.findFirst({
          where: { refType: "Trip", refId: trip.id, type: "SHIPMENT", qty: { lt: 0 } }, orderBy: { createdAt: "desc" },
          select: { warehouseId: true, productId: true, ownerBrigadeId: true, date: true },
        });
        if (last) {
          if (delta > 0 && item!.product.unit !== "m3") {
            const have = await tx.stockMove.aggregate({ where: { warehouseId: last.warehouseId, productId: last.productId, ownerBrigadeId: last.ownerBrigadeId }, _sum: { qty: true } });
            const left = Number(have._sum.qty ?? 0);
            if (left + STOCK_EPS < delta) throw new SourceError(`Omborda ${item!.product.name} ${fmtNum(Math.max(0, left), 3)} ${unitLabel(item!.product.unit)} — ${fmtNum(delta, 3)} qo'shib bo'lmaydi`);
          }
          await tx.stockMove.create({
            data: {
              type: "SHIPMENT", warehouseId: last.warehouseId, productId: last.productId, ownerBrigadeId: last.ownerBrigadeId, qty: -delta, date: last.date,
              refType: "Trip", refId: trip.id, note: `Realizatsiyada miqdor tuzatildi: ${fmtNum(shown, 3)} → ${fmtNum(q, 3)}`, createdById: userId,
            },
          });
        }
        await audit(tx, userId, "UPDATE", "Trip", trip.id, { qtyM3: trip.qtyM3, acceptedQty: trip.acceptedQty }, { qtyM3, acceptedQty: trip.acceptedQty != null ? q : null, via: "realizatsiya" });
        await dropLine(tx, [key], ["qty"]);
      });
    }, key, field);
  }

  async function saveProduct(): Promise<FieldResult> {
    if (!v) return { error: "Mahsulot nomini yozing", field };
    const hit = (await entryLookup([], [v])).product(v);
    if (!hit) return { error: `«${v}» katalogda yo'q — ro'yxatdan tanlang (yangi mahsulot Sklad → Tayyor mahsulotlarda qo'shiladi)`, field };
    if (hit.id === item!.productId) return run(() => db.$transaction((tx) => dropLine(tx, [key], ["productName", "groupName", "unit"])), key, field);
    if (hit.unit !== item!.product.unit) return { error: `O'lchovi boshqa (${unitLabel(hit.unit)}) — bunday almashtirish zayavka tahririda qilinadi`, field };
    const same = await db.orderItem.count({ where: { orderId: o!.id, productId: item!.productId } });
    return run(async () => {
      await db.$transaction(async (tx) => {
        await lockStock(tx);
        const u = await tx.orderItem.updateMany({ where: { id: item!.id, productId: item!.productId }, data: { productId: hit.id } });
        if (u.count !== 1) throw new SourceError("Zayavka qatori shu payt o'zgardi — sahifani yangilang");
        // Shu zayavka reyslari skladdan qaysi mahsulotni chiqargan bo'lsa — yangisiga (zayavkada shu mahsulotli boshqa qator bo'lmasa)
        const moved = same === 1 && o!.trips.length
          ? (await tx.stockMove.updateMany({ where: { refType: "Trip", refId: { in: o!.trips.map((t) => t.id) }, productId: item!.productId }, data: { productId: hit.id } })).count
          : 0;
        await audit(tx, userId, "UPDATE", "OrderItem", item!.id, { productId: item!.productId, product: item!.product.name }, { productId: hit.id, product: hit.name, stockMoves: moved, orderId: o!.id, via: "realizatsiya" });
        await dropLine(tx, [`${o!.id}-${item!.id}`, ...o!.trips.map((t) => `${t.id}-${item!.id}`)], ["productName", "groupName", "unit"]);
      });
    }, key, field);
  }
}
