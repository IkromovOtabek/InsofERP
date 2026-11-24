import type { Prisma } from "@/generated/prisma";
import { lockStock, STOCK_EPS } from "@/lib/stock-lock";
import { defaultWarehouse, pickProductWarehouse } from "@/lib/warehouse";
import { brigadeNames, ownerLabel, takeFromOwners } from "@/lib/brigade-products";
import { autoBatchForSale } from "@/lib/production-batch";
import { cancelBatchTx } from "@/lib/storno";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";

/**
 * Reyssiz sotuv → sklad (Sarvar rejasi 2-bosqich, 2026-11-24). Realizatsiya reestrining qo'lda / Excel qatori
 * (`RealizationEntry`) avval skladga umuman tegmasdi — plita qoldig'i o'sib borardi (tizimda 770, haqiqatda 72),
 * «sotilgan beton ≠ ishlab chiqarilgan beton». Endi qator yozilgan/tahrirlangan/o'chirilgan tranzaksiyaning o'zida:
 *  · DONA mahsulot (plita, kolso, FBS… — m³ emas): skladdan jo'natma (SHIPMENT). Qoldiq yetmasa ham sotuv saqlanadi —
 *    ombor minusga tushadi, foydalanuvchiga ogohlantirish va direktorga xabar («ishlab chiqarilmagan yoki qayd qilinmagan»).
 *    Omborlar — `takeFromOwners` (umumiy hovli → brigadalar), sklad — qoldig'i yetadigani, bo'lmasa asosiy.
 *  · BETON (m³): `CompanySettings.realizationAutoConsume` yoqilgan bo'lsa — retsept bo'yicha zames (xomashyo sarfi +
 *    beton kirimi, `autoBatchForSale`) va darhol jo'natma. Sukut — o'chiq: hozir xomashyo «Chiqim» bilan qo'lda chiqadi,
 *    ikkalasi bo'lsa sarf ikki marta yoziladi. Xomashyo yetmasa zames yozilmaydi — ogohlantirish.
 *  · Faqat `CompanySettings.realizationStockFrom` sanasidan (shu kun ham) keyingi qatorlar — eski oylar orqaga yozilmaydi.
 *    Katalogga bog'lanmagan qator (mahsulot yo'q) tegilmaydi.
 * Sklad jurnali o'zgarmaydi: tahrirda farq qo'shimcha yozuv bilan, o'chirishda teskari yozuv bilan tuzatiladi (reys miqdori
 * tuzatishi bilan bir xil usul); zames — storno (`cancelBatchTx`). Yozuvlar: `refType = "RealizationEntry"`, `refId = qator id`;
 * zames izohida `[rz:<qator id>]` belgisi.
 */
export const RZ_STOCK_REF = "RealizationEntry";
const batchTag = (id: string) => `[rz:${id}]`;

export type ShortSale = { product: string; unit: string; qty: number; have: number; customer: string };
export type SaleSync = { short: ShortSale | null; warn: string | null };

type EntryLike = { id: string; date: Date; productId: string | null; customerName: string; qty: Prisma.Decimal | number | string; ttn?: string | null };

/** TTN solishtirish kaliti — Tahlil tushumidagi qoida (`bi/core.ts`): «N-2026-00161», «ТТН-161», «№161», «161» — bitta. */
const ttnKey = (v: string | null | undefined) => (v ?? "").replace(/^.*-0*(?=\d)/, "").toLowerCase().replace(/[^0-9a-zа-яё]/g, "").replace(/^0+(?=\d)/, "");

/**
 * Shu TTN bilan ±1 kunda yuklangan reys bormi — u mahsulotni o'zi skladdan chiqargan (reys yuklanganda), qo'lda qator
 * ikkinchi marta chiqarmasin. Tahlil tushumida ham shu qator ikki marta sanalmaydi.
 */
async function tripShipped(tx: Prisma.TransactionClient, e: EntryLike): Promise<boolean> {
  const k = ttnKey(e.ttn);
  if (!k) return false;
  const DAY = 86_400_000;
  const trips = await tx.trip.findMany({
    where: { status: { notIn: ["PLANNED", "CANCELLED"] }, loadedAt: { gte: new Date(e.date.getTime() - DAY), lt: new Date(e.date.getTime() + 2 * DAY) } },
    select: { ttn: true, deliveryNoteNo: true },
  });
  return trips.some((t) => ttnKey(t.ttn) === k || ttnKey(t.deliveryNoteNo) === k);
}
/**
 * Teskari tartib: reestr qatori AVVAL kiritilib skladdan chiqargan, keyin shu TTN bilan reys yuklandi (yoki reysga shu TTN
 * yozildi) — mahsulotni endi reys chiqargan, qatorning chiqimi qaytariladi (ikki marta chiqmasin). `tripLoaded` va
 * `setTripTtn` tranzaksiyasi ichida chaqiriladi. Qaytarilgan qatorlar soni.
 */
export async function releaseRealizationForTrip(tx: Prisma.TransactionClient, tripId: string, userId: string): Promise<number> {
  const t = await tx.trip.findUnique({ where: { id: tripId }, select: { ttn: true, deliveryNoteNo: true, loadedAt: true, status: true } });
  if (!t?.loadedAt || t.status === "PLANNED" || t.status === "CANCELLED") return 0;
  const keys = new Set([ttnKey(t.ttn), ttnKey(t.deliveryNoteNo)].filter(Boolean));
  if (!keys.size) return 0;
  const DAY = 86_400_000;
  // `tripShipped` oynasining teskarisi: reys qator sanasidan −1 … +2 kun ichida yuklangan
  const entries = await tx.realizationEntry.findMany({
    where: { cancelledAt: null, ttn: { not: null }, date: { gt: new Date(t.loadedAt.getTime() - 2 * DAY), lte: new Date(t.loadedAt.getTime() + DAY) } },
    select: { id: true, date: true, productId: true, customerName: true, qty: true, ttn: true },
  });
  let n = 0;
  for (const e of entries) {
    if (!keys.has(ttnKey(e.ttn))) continue;
    // Qator hozir skladdan sof chiqarib turibdimi (avval qaytarilgan bo'lsa — yozuvlar bor, lekin yig'indi 0)
    const net = (await tx.stockMove.aggregate({ where: { refType: RZ_STOCK_REF, refId: e.id }, _sum: { qty: true } }))._sum.qty;
    if (Math.abs(Number(net ?? 0)) <= STOCK_EPS) continue;
    await syncRealizationSale(tx, e.id, e, userId);
    n++;
  }
  return n;
}

type Group = { warehouseId: string; productId: string; owner: string | null; out: number; date: Date };
type Want = { productId: string; qty: number; date: Date; name: string; unit: string };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Qator holatiga sklad yozuvlarini moslaydi (qatorni yozgan tranzaksiya ichida, sklad qulfi shu yerda olinadi).
 * `entry` — yangi holat, `null` — qator o'chirildi.
 */
export async function syncRealizationSale(tx: Prisma.TransactionClient, id: string, entry: EntryLike | null, userId: string): Promise<SaleSync> {
  await lockStock(tx);
  const [moves, settings, batches] = await Promise.all([
    tx.stockMove.findMany({ where: { refType: RZ_STOCK_REF, refId: id }, orderBy: { createdAt: "asc" }, select: { warehouseId: true, productId: true, ownerBrigadeId: true, qty: true, date: true } }),
    tx.companySettings.findUnique({ where: { id: "main" }, select: { realizationStockFrom: true, realizationAutoConsume: true } }),
    tx.productionBatch.findMany({ where: { cancelledAt: null, note: { contains: batchTag(id) } }, select: { id: true, productId: true, qtyM3: true, date: true } }),
  ]);
  const productIds = [...new Set([...moves.map((m) => m.productId), entry?.productId].filter((x): x is string => !!x))];
  const products = new Map((await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, unit: true } })).map((p) => [p.id, p]));

  // Hozir skladdan sof chiqib turgani — sklad × mahsulot × brigada ombori bo'yicha
  const byKey = new Map<string, Group>();
  for (const m of moves) {
    if (!m.productId) continue;
    const k = `${m.warehouseId}|${m.productId}|${m.ownerBrigadeId ?? ""}`;
    const g = byKey.get(k) ?? { warehouseId: m.warehouseId, productId: m.productId, owner: m.ownerBrigadeId, out: 0, date: m.date };
    g.out = r3(g.out - Number(m.qty));
    byKey.set(k, g);
  }
  const live = [...byKey.values()].filter((g) => Math.abs(g.out) > STOCK_EPS);
  const isM3 = (productId: string) => products.get(productId)?.unit === "m3";

  const from = settings?.realizationStockFrom ?? null;
  const p = entry?.productId ? products.get(entry.productId) : undefined;
  const inRange = !!entry && !!p && !!from && entry.date >= from && Number(entry.qty) > STOCK_EPS && !(await tripShipped(tx, entry));
  const want: Want | null = inRange ? { productId: p!.id, qty: r3(Number(entry!.qty)), date: entry!.date, name: p!.name, unit: p!.unit } : null;
  const note = entry ? "Realizatsiya qatori tuzatildi" : "Realizatsiya qatori o'chirildi";

  const short = await syncPieces(tx, id, live.filter((g) => !isM3(g.productId)), want && want.unit !== "m3" ? want : null, entry, note, userId);
  // Beton qatori, avtomatik sarf o'chiq — beton yozuvlariga tegilmaydi (yoqilgan paytda yozilgani o'z holicha qoladi)
  const touchConcrete = !entry || p?.unit !== "m3" || !!settings?.realizationAutoConsume;
  const warn = touchConcrete
    ? await syncConcrete(tx, id, live.filter((g) => isM3(g.productId)), batches, want && want.unit === "m3" && settings?.realizationAutoConsume ? want : null, entry, note, userId)
    : null;
  return { short, warn };
}

/** Dona mahsulot jo'natmasi: kerakli miqdorga farq bilan yetkaziladi. */
async function syncPieces(tx: Prisma.TransactionClient, id: string, live: Group[], want: Want | null, entry: EntryLike | null, note: string, userId: string): Promise<ShortSale | null> {
  const keep = !!want && live.every((g) => g.productId === want.productId && sameDay(g.date, want.date));
  // Mahsulot yoki sana o'zgardi / qator o'chdi / endi kerak emas — avvalgi chiqim to'liq qaytariladi
  if (!keep) {
    for (const g of live) {
      await tx.stockMove.create({
        data: { type: "SHIPMENT", warehouseId: g.warehouseId, productId: g.productId, ownerBrigadeId: g.owner, qty: g.out, date: g.date, refType: RZ_STOCK_REF, refId: id, note: `${note} — chiqim qaytarildi`, createdById: userId },
      });
    }
  }
  if (!want) return null;
  const shipped = keep ? r3(live.reduce((s, g) => s + g.out, 0)) : 0;
  const delta = r3(want.qty - shipped);
  if (Math.abs(delta) <= STOCK_EPS) return null;

  if (delta < 0) {
    // Miqdor kamaydi — farq chiqqan omborlarga qaytadi (oxirgisidan)
    let left = -delta;
    for (const g of [...live].reverse()) {
      if (left <= STOCK_EPS) break;
      const back = r3(Math.min(left, g.out));
      if (back <= STOCK_EPS) continue;
      await tx.stockMove.create({
        data: { type: "SHIPMENT", warehouseId: g.warehouseId, productId: g.productId, ownerBrigadeId: g.owner, qty: back, date: g.date, refType: RZ_STOCK_REF, refId: id, note: `${note}: miqdor kamaydi`, createdById: userId },
      });
      left = r3(left - back);
    }
    return null;
  }

  // Chiqim (yoki qo'shimcha chiqim): qoldig'i yetadigan sklad, bo'lmasa asosiy sklad — minusga tushadi, ogohlantirish
  const wh = await pickProductWarehouse(tx, want.productId, delta);
  let warehouseId: string;
  let short: ShortSale | null = null;
  if ("short" in wh) {
    const def = await defaultWarehouse(tx);
    if (!def) return null; // sklad ochilmagan — yozib bo'lmaydi (sotuv baribir saqlanadi)
    warehouseId = def.id;
    short = { product: want.name, unit: want.unit, qty: delta, have: r3(wh.total), customer: entry!.customerName };
  } else warehouseId = wh.id;
  const parts = await takeFromOwners(tx, { warehouseId, productId: want.productId, qty: delta });
  const names = parts.some((x) => x.owner) ? await brigadeNames(tx) : new Map<string, string>();
  for (const part of parts) {
    await tx.stockMove.create({
      data: {
        type: "SHIPMENT", warehouseId, productId: want.productId, ownerBrigadeId: part.owner, qty: -part.qty, date: want.date, refType: RZ_STOCK_REF, refId: id,
        note: `Reyssiz sotuv: ${entry!.customerName} · ${ownerLabel(names, part.owner)}dan`, createdById: userId,
      },
    });
  }
  return short;
}

/** Beton: zames (xomashyo sarfi + beton kirimi) va jo'natma — kerakli holatga mos bo'lmasa storno qilinib qayta yoziladi. */
async function syncConcrete(
  tx: Prisma.TransactionClient, id: string, live: Group[], batches: { id: string; productId: string; qtyM3: Prisma.Decimal; date: Date }[],
  want: Want | null, entry: EntryLike | null, note: string, userId: string,
): Promise<string | null> {
  const b = batches[0];
  const same = !!want && batches.length === 1 && b!.productId === want.productId && Math.abs(Number(b!.qtyM3) - want.qty) <= STOCK_EPS && sameDay(b!.date, want.date);
  if (same) return null;
  // Avval jo'natma qaytadi (beton qoldig'i tiklanadi), keyin zames storno — beton va xomashyo qoldig'i minusga tushmaydi
  for (const g of live) {
    await tx.stockMove.create({
      data: { type: "SHIPMENT", warehouseId: g.warehouseId, productId: g.productId, ownerBrigadeId: g.owner, qty: g.out, date: g.date, refType: RZ_STOCK_REF, refId: id, note: `${note} — beton chiqimi qaytarildi`, createdById: userId },
    });
  }
  for (const x of batches) await cancelBatchTx(tx, x.id, entry ? "Realizatsiya qatori o'zgardi" : "Realizatsiya qatori o'chirildi", userId);
  if (!want) return null;
  const wh = await defaultWarehouse(tx);
  if (!wh) return `${want.name}: faol sklad yo'q — xomashyo sarfi yozilmadi`;
  const res = await autoBatchForSale(tx, { productId: want.productId, warehouseId: wh.id, qtyM3: want.qty, note: `Reyssiz sotuv: ${entry!.customerName} ${batchTag(id)}` }, userId);
  if ("error" in res) return `${want.name} ${fmtNum(want.qty, 3)} m³: xomashyo sarfi (zames) yozilmadi — ${res.error}`;
  // Zames va uning sklad yozuvlari sotuv sanasida (bir tranzaksiyada yaratilgan — jurnal hali hech kimga ko'rinmagan)
  await tx.productionBatch.update({ where: { id: res.id }, data: { date: want.date } });
  await tx.stockMove.updateMany({ where: { refType: "ProductionBatch", refId: res.id }, data: { date: want.date } });
  await tx.stockMove.create({
    data: { type: "SHIPMENT", warehouseId: wh.id, productId: want.productId, qty: -want.qty, date: want.date, refType: RZ_STOCK_REF, refId: id, note: `Reyssiz sotuv: ${entry!.customerName} · ${res.batchNo}`, createdById: userId },
  });
  return null;
}

/** Foydalanuvchiga ogohlantirish matni (bir nechta qator — importda). */
export function saleWarnText(list: SaleSync[]): string | undefined {
  const shorts = list.map((x) => x.short).filter((x): x is ShortSale => !!x);
  const warns = list.map((x) => x.warn).filter((x): x is string => !!x);
  const parts = [
    shorts.length && `Skladda yetmadi: ${shorts.slice(0, 8).map((x) => `${x.product} — sotildi ${fmtNum(x.qty, 3)} ${unitLabel(x.unit)}, skladda ${fmtNum(Math.max(0, x.have), 3)}`).join("; ")}${shorts.length > 8 ? ` va yana ${shorts.length - 8} ta` : ""}. Sotuv saqlandi, sklad minusga tushdi — ishlab chiqarilgani qayd qilinsin yoki sanoq bilan tuzatilsin.`,
    warns.length && `${warns.slice(0, 5).join("; ")}${warns.length > 5 ? ` va yana ${warns.length - 5} ta` : ""}.`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/** Direktorga xabar — tranzaksiya yopilgandan keyin chaqiriladi. */
export function notifyShortSales(list: SaleSync[], userId: string) {
  const s = list.map((x) => x.short).filter((x): x is ShortSale => !!x);
  if (!s.length) return;
  notifyAfter(() => notifyRoles(["DIRECTOR"], {
    type: "STOCK_SHORT_SALE",
    title: s.length === 1 ? `Skladda yo'q mahsulot sotildi: ${s[0]!.product}` : `Skladda yo'q mahsulot sotildi: ${s.length} ta qator`,
    body: `${s.slice(0, 5).map((x) => `${x.customer}: ${x.product} ${fmtNum(x.qty, 3)} ${unitLabel(x.unit)} (skladda ${fmtNum(Math.max(0, x.have), 3)})`).join("; ")}. Ishlab chiqarilmagan yoki ishlab chiqarish qayd qilinmagan.`,
  }, { except: userId }));
}
