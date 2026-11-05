import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NDS_RATE } from "@/lib/nds";
import { PRODUCT_UNITS, unitLabel } from "@/lib/unit";
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
      ttn: r.ttn ? shortTtn(r.ttn) : null, vehicle: r.vehicle, unitKey: r.unit, unit: r.unit, qty: r.qty, price: r.price, delivery: r.delivery,
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
      ttn: e.ttn, vehicle: e.vehicle, unitKey: e.unit, unit: unitLabel(e.unit), qty, price, delivery, net, vat, total: r2(net + vat),
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

type Result = { ok: true; id: string } | { error: string };

/** Forma qiymatlari → jadval qatori: mijoz/mahsulot ro'yxatga bog'lanadi, birlik va guruh mahsulotdan, QQS to'lov turidan. */
async function entryData(d: EntryInput) {
  const [customer, product] = await Promise.all([
    db.customer.findFirst({
      where: { isInternal: false, OR: [{ name: { equals: d.customerName, mode: "insensitive" } }, { aliases: { has: d.customerName } }] },
      orderBy: { isActive: "desc" }, select: { id: true },
    }),
    db.product.findFirst({
      where: { OR: [{ name: { equals: d.productName, mode: "insensitive" } }, { code: { equals: d.productName, mode: "insensitive" } }] },
      orderBy: { isActive: "desc" }, select: { id: true, name: true, unit: true, groupId: true },
    }),
  ]);
  let group = d.groupName;
  if (!group && product) group = rootGroupName(await db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }))(product.groupId);
  const unit = product?.unit ?? d.unit ?? "m3";
  if (!product && !PRODUCT_UNITS.some(([u]) => u === unit)) return { error: "O'lchov birligini tanlang" } as const;
  const qty = d.qty!, price = Math.round(d.price ?? 0), delivery = Math.round(d.delivery ?? 0);
  return {
    data: {
      date: d.date!, payGroup: d.payGroup, seller: d.seller, customerId: customer?.id ?? null, customerName: d.customerName,
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
  const r = await entryData(d);
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
  const before = await db.realizationEntry.findUnique({ where: { id } });
  if (!before) return { error: "Qator topilmadi" };
  if (before.cancelledAt) return { error: "Qator bekor qilingan" };
  if (future(d.date!)) return { error: "Sana kelajakda bo'lmasin" };
  const r = await entryData(d);
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
export async function saveRealizationNote(key: string, d: NoteInput, userId: string): Promise<Result> {
  const exists = key.startsWith("o:")
    ? await db.order.findFirst({ where: { id: key.slice(2), kind: "SALE" }, select: { id: true } })
    : await db.trip.findUnique({ where: { id: key }, select: { id: true } });
  if (!exists) return { error: "Reys topilmadi" };
  await db.$transaction(async (tx) => {
    const before = await tx.realizationNote.findUnique({ where: { key } });
    const data = { loadPlace: d.loadPlace, destination: d.destination, note: d.note, refName: d.refName, updatedById: userId };
    await tx.realizationNote.upsert({ where: { key }, create: { key, ...data }, update: data });
    await audit(tx, userId, before ? "UPDATE" : "CREATE", "RealizationNote", key, before ?? undefined, data);
  });
  return { ok: true, id: key };
}
