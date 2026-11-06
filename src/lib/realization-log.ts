import { z } from "zod";
import { Prisma, type RealizationEntry } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit, auditMany } from "@/lib/audit";
import { NDS_RATE } from "@/lib/nds";
import { PRODUCT_UNITS, normalizeUnit, unitLabel } from "@/lib/unit";
import { isoDate } from "@/lib/format";
import { matchKey, num, numMoney, parseDate, str, valueMapper, type ValueMaps } from "@/lib/excel";
import { dayField, numIn } from "@/lib/logistics-admin";
import { realizationRows, shortTtn, type RealizationRow } from "@/lib/realization";
import { PAY_GROUPS, rootGroupName, type PayGroupKey } from "@/lib/order-day-sheet";

/**
 * Logistika → «Realizatsiya» (dispetcher): jo'natmalar reestri — Google varag'idagi ustunlar bilan
 * (sana, to'lov turi, sotuvchi, xaridor, mahsulot, TTN, mashina … ortilgan joy, boradigan manzil, izoh, spravka nomi).
 *
 *  · Reysdan (avtomatik): har TTN qatori `realizationRows` dan jonli — reys ochilishi bilan o'zi tushadi. Mijoz, mahsulot,
 *    miqdor, narx va to'lov turi zayavkadan, bu yerda o'zgarmaydi (tuzatish — zayavkada). Dispetcher faqat ortilgan joy,
 *    boradigan manzil, izoh va spravka nomini to'ldiradi (`RealizationNote`: kalit — reys id, reyssiz zayavka — "o:<orderId>").
 *    To'ldirilmagani taklif bilan ko'rinadi: ortilgan joy — reys BRU'si (yoki yuk olingan manzil), manzil — obyekt,
 *    izoh — TTN, mashina, haydovchi va telefoni, spravka nomi — mijoz nomi.
 *  · Qo'lda: tizimga reys bo'lib tushmagan jo'natma (`RealizationEntry`). Faqat reestr — mijoz qarzi, kassa va skladga
 *    ta'sir qilmaydi. Mijoz (yoki aliasi) va mahsulot nomi ro'yxatdagiga mos kelsa bog'lanadi, birlik va guruh mahsulotdan.
 *    QQS — perechisleniyeda 12% (miqdor × narx dan, dastavkasiz). O'chirilmaydi — bekor qilinadi, hammasi AuditLog'da.
 *  · Summa (QQSsiz) = miqdor × narx + dastavka; Jami = Summa + QQS (`lib/realization.ts` bilan bitta qoida).
 *  · Excel'dan import: varaqdagi qatorlar qo'lda qator bo'lib tushadi. Reestrda bori (reys yoki avval kiritilgan) o'tkazib
 *    yuboriladi — fayl qayta yuklansa ham ikki marta yozilmaydi (`importRealizationEntries`).
 */

export type LogSource = "AUTO" | "MANUAL";
export type LogFields = { loadPlace: string | null; destination: string | null; note: string | null; refName: string | null };
export type LogRow = {
  key: string; source: LogSource;
  /** Tahrir kaliti: reysdan — `RealizationNote.key`, qo'lda — `RealizationEntry.id` */
  ref: string;
  orderId: string | null; tripId: string | null; customerId: string | null;
  date: Date; pay: PayGroupKey; payLabel: string; seller: string;
  customer: string; product: string; group: string; ttn: string | null; vehicle: string | null;
  /** Reysdan qatorda — dispetcher yozgan TTN (`Trip.ttn`, tahrir qiymati); bo'lmasa ko'rinadigani nakladnoy raqami */
  tripTtn: string | null;
  unitKey: string; unit: string; qty: number; price: number; delivery: number; net: number; vat: number; total: number;
  /** Ko'rinadigan qiymat: to'ldirilgani, bo'lmasa taklif */
  loadPlace: string; destination: string; note: string; refName: string;
  /** Reysdan qatorda: dispetcher to'ldirgani (formada) va taklif (placeholder) */
  filled: LogFields | null; suggest: LogFields | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
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

export async function realizationLog(from: Date, to: Date): Promise<LogRow[]> {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0); b.setDate(b.getDate() + 1);
  const [auto, entries] = await Promise.all([
    realizationRows(from, to),
    db.realizationEntry.findMany({ where: { cancelledAt: null, date: { gte: a, lt: b } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const keys = [...new Set(auto.map(autoKey))];
  const notes = new Map((keys.length ? await db.realizationNote.findMany({ where: { key: { in: keys } } }) : []).map((n) => [n.key, n]));

  const rows: LogRow[] = auto.map((r) => {
    const ref = autoKey(r);
    const n = notes.get(ref);
    const filled: LogFields = { loadPlace: n?.loadPlace ?? null, destination: n?.destination ?? null, note: n?.note ?? null, refName: n?.refName ?? null };
    const suggest = suggestOf(r);
    return {
      key: `a-${r.key}`, source: "AUTO", ref, orderId: r.orderId, tripId: r.tripId, customerId: r.customerId,
      date: r.date, pay: r.pay, payLabel: r.payLabel, seller: r.seller, customer: r.customer, product: r.product, group: r.group,
      ttn: r.ttn ? shortTtn(r.ttn) : null, tripTtn: r.tripTtn, vehicle: r.vehicle, unitKey: r.unit, unit: r.unit, qty: r.qty, price: r.price, delivery: r.delivery,
      net: r.net, vat: r.vat, total: r.total,
      loadPlace: filled.loadPlace ?? suggest.loadPlace ?? "", destination: filled.destination ?? suggest.destination ?? "",
      note: filled.note ?? suggest.note ?? "", refName: filled.refName ?? suggest.refName ?? "",
      filled, suggest,
    };
  });
  for (const e of entries) {
    const qty = Number(e.qty), price = Number(e.price), delivery = Number(e.delivery), vat = Number(e.vat);
    const net = r2(qty * price + delivery);
    const pay = (PAY_KEYS as string[]).includes(e.payGroup) ? (e.payGroup as PayGroupKey) : "CASH";
    rows.push({
      key: `m-${e.id}`, source: "MANUAL", ref: e.id, orderId: null, tripId: null, customerId: e.customerId,
      date: e.date, pay, payLabel: PAY_LABEL[pay], seller: e.seller ?? "", customer: e.customerName, product: e.productName, group: e.groupName,
      ttn: e.ttn, tripTtn: null, vehicle: e.vehicle, unitKey: e.unit, unit: unitLabel(e.unit), qty, price, delivery, net, vat, total: r2(net + vat),
      loadPlace: e.loadPlace ?? "", destination: e.destination ?? "", note: e.note ?? "", refName: e.refName ?? e.customerName,
      filled: null, suggest: null,
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

export const entrySchema = z.object({
  date: dayField.refine((d) => d !== null, "Sanani kiriting"),
  payGroup: z.enum(PAY_KEYS, { message: "To'lov turini tanlang" }),
  seller: text(100),
  customerName: z.string().trim().min(2, "Xaridor nomini yozing").max(200).transform((v) => v.replace(/\s+/g, " ")),
  productName: z.string().trim().min(1, "Mahsulotni yozing").max(200).transform((v) => v.replace(/\s+/g, " ")),
  groupName: text(60),
  unit: text(10),
  ttn: text(40),
  vehicle: text(40),
  qty: numIn(0, 1_000_000).refine((v) => v !== null && v > 0, "Miqdorni kiriting"),
  price: numIn(0, 10_000_000_000),
  delivery: numIn(0, 10_000_000_000),
  loadPlace: text(60),
  destination: text(200),
  note: text(300),
  refName: text(200),
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
  const qty = d.qty!, price = Math.round(d.price ?? 0), delivery = Math.round(d.delivery ?? 0);
  return {
    data: {
      date: d.date!, payGroup: d.payGroup, seller: d.seller, customerId, customerName: d.customerName,
      productId: product?.id ?? null, productName: product?.name ?? d.productName, groupName: group ?? "Boshqa",
      ttn: d.ttn, vehicle: d.vehicle, unit, qty, price, delivery, vat: d.payGroup === "BANK" ? r2(qty * price * NDS_RATE) : 0,
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

// ───────────────────────── Excel'dan import ─────────────────────────

export type ImportRow = Record<string, unknown>;
export type ImportResult = { ok: true; added: number; skipped: number; from: Date; to: Date } | { error: string };

const IMPORT_MAX = 3000;
const DAY = 86_400_000;

/** To'lov turi so'z boshidan (`matchKey` ko'rinishida): «Перечисление», «Безнал» → BANK; «Нал», «Нақд» → CASH; «Қарз», «Долг» → DEBT. */
const PAY_WORDS: [PayGroupKey, RegExp][] = [
  ["BANK", /^(perec|bezn|bank|xisob)/],
  ["CASH", /^(naqd|nakd|naqt|nal|cash)/],
  ["DEBT", /^(qarz|karz|dolg|nasiya|nasia|tekin|debt)/],
];
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
 * Varaqdagi jo'natmalar → qo'lda qatorlar (bitta formadagi qoidalar bilan). Biror qatorda xato bo'lsa hech narsa yozilmaydi.
 * Reestrda bor qator o'tkazib yuboriladi:
 *  · TTN bor — shu TTN reysdan yoki qo'lda qatorda ±1 kun ichida bor (mijoz, mahsulot, miqdor yoki mashinadan biri mos);
 *  · TTN'siz — o'sha kuni xaridor, mahsulot va miqdori bir xil qator bor (har mavjud qator bitta fayl qatoriga sanaladi).
 * Ikki import bir vaqtda kelsa — qulf ostida navbat bilan, ikkinchisi birinchisi yozganini ko'radi.
 */
export async function importRealizationEntries(rows: ImportRow[], maps: ValueMaps, userId: string): Promise<ImportResult> {
  if (!rows.length) return { error: "Faylda qator yo'q" };
  if (rows.length > IMPORT_MAX) return { error: `Bir martada ko'pi bilan ${IMPORT_MAX} qator — faylni bo'lib yuklang` };
  const pay = valueMapper(maps, "payGroup");
  const errors: string[] = [];
  const where = (i: number, name: string) => `${i + 1}-qator${name ? ` (${name})` : ""}`;

  const inputs: EntryInput[] = [];
  rows.forEach((x, i) => {
    const cell = (k: string) => str(x[k]);
    // Raqam katakdan (minglik ajratkich, vergul) — o'qilmasa matnicha qoladi va forma qoidasi xato beradi
    const amount = (k: string, read: (v: unknown) => number) => {
      if (!cell(k)) return "";
      const n = read(x[k]);
      return Number.isFinite(n) ? String(n) : cell(k);
    };
    const date = parseDate(x.date);
    const payGroup = payGroupOf(pay(cell("payGroup")));
    // Fayldagi qiymat bor, lekin o'qilmadi — qiymatning o'zi bilan aytiladi (forma xabari «tanlang» bo'lib chalg'itmasin)
    if (cell("date") && !date) { errors.push(`${where(i, cell("customerName"))}: Sana o'qilmadi — «${cell("date")}»`); return; }
    if (cell("payGroup") && !payGroup) { errors.push(`${where(i, cell("customerName"))}: To'lov turi aniqlanmadi — «${cell("payGroup")}» (Perechisleniye, Naqd yoki Qarz)`); return; }
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
      errors.push(`${where(i, cell("customerName"))}: ${label && !is.message.startsWith(label) ? `${label} — ` : ""}${is.message}`);
    } else if (future(p.data.date!)) errors.push(`${where(i, p.data.customerName)}: sana kelajakda`);
    else inputs.push(p.data);
  });

  const lk = errors.length ? null : await entryLookup(inputs.map((d) => d.customerName), inputs.map((d) => d.productName));
  const built = lk ? inputs.map((d, i) => {
    const r = entryData(d, lk);
    if ("error" in r) { errors.push(`${where(i, d.customerName)}: ${r.error} — «${d.productName}» mahsulotlar ro'yxatida yo'q`); return null; }
    return r.data;
  }) : [];
  if (errors.length) {
    return { error: `${errors.slice(0, 5).join("; ")}${errors.length > 5 ? `; yana ${errors.length - 5} ta qatorda xato` : ""}. Faylni tuzatib qayta yuklang — hech narsa yozilmadi` };
  }
  const data = built.filter((b) => b !== null);

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
    if (!fresh.length) return { added: 0, skipped: data.length };
    const created = await tx.realizationEntry.createManyAndReturn({ data: fresh.map((b) => ({ ...b, createdById: userId })) });
    await auditMany(tx, userId, "CREATE", "RealizationEntry", created.map((row) => ({ id: row.id, after: row })));
    return { added: created.length, skipped: data.length - created.length };
  }, { timeout: 60_000 });
  return { ok: true, ...res, from, to };
}
