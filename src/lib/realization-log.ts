import { z } from "zod";
import { Prisma, type RealizationEntry, type RealizationLine, type RealizationNote } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit, auditMany } from "@/lib/audit";
import { NDS_RATE } from "@/lib/nds";
import { PRODUCT_UNITS, normalizeUnit, unitLabel } from "@/lib/unit";
import { dateRu, fmtNum, fmtTiyin, isoDate } from "@/lib/format";
import { matchKey, num, numMoney, parseDate, str, valueMapper, type ValueMaps } from "@/lib/excel";
import { dayField, numIn } from "@/lib/logistics-admin";
import { realizationRows, shortTtn, type RealizationRow } from "@/lib/realization";
import { PAY_GROUPS, rootGroupName, type PayGroupKey } from "@/lib/order-day-sheet";
import { nextCatalogCode } from "@/lib/numbering";
import { defaultCreditLimit } from "@/lib/finance";

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
 *  · Qo'lda: tizimga reys bo'lib tushmagan jo'natma (`RealizationEntry`). Faqat reestr — mijoz qarzi, kassa va skladga
 *    ta'sir qilmaydi. Mijoz (yoki aliasi) va mahsulot nomi ro'yxatdagiga mos kelsa bog'lanadi, birlik va guruh mahsulotdan.
 *    QQS — perechisleniyeda 12% (miqdor × narx dan, dastavkasiz). O'chirilmaydi — bekor qilinadi, hammasi AuditLog'da.
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
  const delivery = pick("delivery", dec(l?.delivery), r.delivery, fmtTiyin);
  const money = "qty" in orig || "price" in orig || "delivery" in orig;
  const line = r3(qty * price);
  const vat = money ? (r.nds ? r3(line * NDS_RATE) : 0) : r.vat;
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

export async function realizationLog(from: Date, to: Date): Promise<LogRow[]> {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0); b.setDate(b.getDate() + 1);
  // Dispetcher sanasini shu davrga ko'chirgan reys/zayavka — asl sanasi boshqa davrda bo'lsa ham shu yerda
  const moved = (await db.realizationNote.findMany({ where: { date: { gte: a, lt: b } }, select: { key: true } })).map((n) => n.key);
  const [auto, entries] = await Promise.all([
    realizationRows(from, to, { tripIds: moved.filter((k) => !k.startsWith("o:")), orderIds: moved.filter((k) => k.startsWith("o:")).map((k) => k.slice(2)) }),
    db.realizationEntry.findMany({ where: { cancelledAt: null, date: { gte: a, lt: b } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const keys = [...new Set(auto.map(autoKey))];
  const [noteList, lineList] = await Promise.all([
    keys.length ? db.realizationNote.findMany({ where: { key: { in: keys } } }) : [],
    auto.length ? db.realizationLine.findMany({ where: { key: { in: auto.map((r) => r.key) } } }) : [],
  ]);
  const notes = new Map(noteList.map((n) => [n.key, n]));
  const lines = new Map(lineList.map((l) => [l.key, l]));

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
    const qty = Number(e.qty), price = Number(e.price), delivery = Number(e.delivery), vat = Number(e.vat);
    const net = r3(qty * price + delivery);
    const pay = (PAY_KEYS as string[]).includes(e.payGroup) ? (e.payGroup as PayGroupKey) : "CASH";
    rows.push({
      key: `m-${e.id}`, source: "MANUAL", ref: e.id, orderId: null, tripId: null, customerId: e.customerId,
      date: e.date, at: e.createdAt, pay, payLabel: PAY_LABEL[pay], seller: e.seller ?? "", customer: e.customerName, product: e.productName, group: e.groupName,
      ttn: e.ttn, tripTtn: null, vehicle: e.vehicle, unitKey: e.unit, unit: unitLabel(e.unit), qty, price, delivery, net, vat, total: r3(net + vat),
      loadPlace: e.loadPlace ?? "", destination: e.destination ?? "", note: e.note ?? "", refName: e.refName ?? e.customerName,
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
 * Mijoz (nomi yoki aliasi) va mahsulot (nomi yoki kodi) ro'yxatdan: katta-kichik harfsiz, faoli ustun, nomi aliasdan ustun.
 * Bitta forma ham, Excel import ham shu bilan — importda hamma nom bitta so'rovda.
 */
async function entryLookup(customerNames: string[], productNames: string[]): Promise<Lookup> {
  const cn = uniq(customerNames), pn = uniq(productNames);
  const ci = (v: string) => ({ equals: v, mode: "insensitive" as const });
  const [customers, products, groups] = await Promise.all([
    cn.length
      ? db.customer.findMany({ where: { isInternal: false, OR: [...cn.map((n) => ({ name: ci(n) })), { aliases: { hasSome: cn } }] }, orderBy: { isActive: "desc" }, select: { id: true, name: true, aliases: true } })
      : [],
    pn.length
      ? db.product.findMany({ where: { OR: pn.flatMap((n) => [{ name: ci(n) }, { code: ci(n) }]) }, orderBy: { isActive: "desc" }, select: { id: true, name: true, code: true, unit: true, groupId: true } })
      : [],
    pn.length ? db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }) : [],
  ]);
  const lc = (v: string) => v.toLowerCase();
  const cust = new Map<string, string>();
  for (const c of customers) if (!cust.has(lc(c.name))) cust.set(lc(c.name), c.id);
  for (const c of customers) for (const a of c.aliases) if (!cust.has(lc(a))) cust.set(lc(a), c.id);
  const prod = new Map<string, ProductHit>();
  for (const p of products) if (!prod.has(lc(p.name))) prod.set(lc(p.name), p);
  for (const p of products) if (p.code && !prod.has(lc(p.code))) prod.set(lc(p.code), p);
  return { customer: (n) => cust.get(lc(n)) ?? null, product: (n) => prod.get(lc(n)) ?? null, group: rootGroupName(groups) };
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
      ttn: d.ttn, vehicle: d.vehicle, unit, qty, price, delivery, vat: d.payGroup === "BANK" ? r3(qty * price * NDS_RATE) : 0,
      loadPlace: d.loadPlace, destination: d.destination, note: d.note, refName: d.refName,
    },
  } as const;
}

const future = (d: Date) => d.getTime() > Date.now() + 86_400_000;

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
      const row = await tx.realizationEntry.create({ data: { ...r.data, clientToken: d.clientToken, createdById: userId } });
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
    const u = await tx.realizationEntry.updateMany({ where: { id, cancelledAt: null, updatedAt: before.updatedAt }, data: r.data });
    if (u.count !== 1) return false;
    await audit(tx, userId, "UPDATE", "RealizationEntry", id, before, r.data);
    return true;
  });
  return ok ? { ok: true, id } : { error: "Qator boshqa joyda o'zgartirildi — sahifani yangilang" };
}

export async function cancelRealizationEntry(id: string, reason: string, userId: string): Promise<Result> {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { error: "Bekor qilish sababini yozing (kamida 3 belgi)" };
  const now = new Date();
  const ok = await db.$transaction(async (tx) => {
    const u = await tx.realizationEntry.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: now, cancelledById: userId, cancelReason: why } });
    if (u.count !== 1) return false;
    await audit(tx, userId, "STATUS_CHANGE", "RealizationEntry", id, { cancelledAt: null }, { cancelledAt: now, cancelReason: why });
    return true;
  });
  return ok ? { ok: true, id } : { error: "Qator topilmadi yoki allaqachon bekor qilingan" };
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
    return { added: created.length, skipped: data.length - created.length, newProducts: cat.created, newCustomers: cust.created };
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
      data: { code: String(++seq), name: r.productName, unit: r.unit, groupId: groupId(r.groupName), note: "Realizatsiya Excel importidan" },
    });
    await audit(tx, userId, "CREATE", "Product", p.id, undefined, p);
    idOf.set(key, p.id);
    created.push(p.name);
  }
  return result;
}

/**
 * Importda ro'yxatda yo'q xaridor mijozlar ro'yxatiga ham qo'shiladi (Otabek, 2026-11-12) — boshqa Excel importlaridagidek:
 * nomi bilan, standart kredit limiti (Sozlamalar → Limitlar), AuditLog'da `via: "realization-import"`. Reestr qatori faqat
 * bog'lanadi — mijoz qarzi, kassa va skladga ta'sir yo'q. Bir xil nom (katta-kichik harfsiz) — bitta mijoz; import qulfi ostida
 * nomi yoki aliasi bo'yicha qayta tekshiriladi. Faqat yoziladigan (reestrda yo'q) qatorlar uchun.
 */
async function addMissingCustomers(
  tx: Prisma.TransactionClient,
  rows: readonly { customerId: string | null; customerName: string }[],
  userId: string,
): Promise<{ idOf: (name: string) => string | null; created: string[] }> {
  const lc = (v: string) => v.toLowerCase();
  const want = new Map<string, string>();
  for (const r of rows) if (!r.customerId && !want.has(lc(r.customerName))) want.set(lc(r.customerName), r.customerName);
  const idOf = new Map<string, string>();
  const created: string[] = [];
  const result = { idOf: (n: string) => idOf.get(lc(n)) ?? null, created };
  if (!want.size) return result;

  const names = [...want.values()];
  const have = await tx.customer.findMany({
    where: { isInternal: false, OR: [...names.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })), { aliases: { hasSome: names } }] },
    orderBy: { isActive: "desc" }, select: { id: true, name: true, aliases: true },
  });
  for (const c of have) if (!idOf.has(lc(c.name))) idOf.set(lc(c.name), c.id);
  for (const c of have) for (const a of c.aliases) if (!idOf.has(lc(a))) idOf.set(lc(a), c.id);
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
