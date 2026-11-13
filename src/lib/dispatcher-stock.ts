import { Prisma, type FuelType, type Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { lockStock, STOCK_EPS } from "@/lib/stock-lock";
import { issuePrices } from "@/lib/stock-price";
import { issueDate, IssueError } from "@/lib/stock-issue";
import { fmtNum } from "@/lib/format";
import { unitShort } from "@/lib/unit";

/**
 * Dispetcher ombori — avto zapchast va yoqilg'i (salyarka, metan…) dispetcher javobgarligida.
 *
 *  · Dispetcher skladdagi avto zapchast va yoqilg'ini ko'radi, lekin qo'sha olmaydi (kirim, yangi karta — sklad ishi):
 *    keraklisini tanlab, miqdorini yozib «o'ziga oladi» — asosiy skladdan shu omborga ko'chadi (`TRANSFER`, juft −/+ yozuv,
 *    sklad jami o'zgarmaydi, PNL sarfiga kirmaydi). Ortib qolgani skladga qaytariladi (teskari `TRANSFER`).
 *  · Mashinaga berish — dispetcher omboridan chiqim (`ISSUE`, sarf): yoqilg'i bo'lsa o'sha mashinaga zapravka (`FuelLog`,
 *    stansiya «Dispetcher ombori») — hisob varag'i va yoqilg'i qoldig'iga tushadi; zapchast — transport xarajati (`PARTS`).
 *    Narx — skladdagi «Dona narxi», bo'lmasa o'rtacha kirim tannarxi (`issuePrices`).
 *  · Bekor qilish — zapravka/xarajat bekor bo'ladi, mol dispetcher omboriga teskari yozuv bilan qaytadi.
 *
 * Ombor bitta, qat'iy id bilan (`DISPATCH_WH`). Umumiy sklad formalarida (kirim, chiqim, inventarizatsiya) tanlovda chiqmasligi
 * uchun `isActive = false`: u faqat shu modul orqali ishlaydi, Sklad → Qoldiqlarda esa qoldig'i bo'lsa ustun bo'lib ko'rinadi.
 * Hammasi `lockStock` ostida, bitta tranzaksiyada; `clientToken` — takror yuborish ikkinchi yozuv qilmasin.
 */
export const DISPATCH_WH = "dispetcher";
export const DISPATCH_WH_NAME = "Dispetcher ombori";

const REF_TAKE = "DispatchTake";
const REF_RETURN = "DispatchReturn";
/** Mashinaga berish: `refId` — zapravka (`FuelLog`) yoki xarajat (`TransportExpense`) id; bekor qilinsa `<ref>Storno` */
const REF_FUEL = "DispatchFuel";
const REF_PART = "DispatchPart";
const STORNO = "Storno";
export const DISPATCH_REFS = [REF_TAKE, REF_RETURN, REF_FUEL, REF_PART, REF_FUEL + STORNO, REF_PART + STORNO] as const;

const MAX_ROWS = 100;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Materialning nomidan yoqilg'i turi (salyarka/dizel, metan, propan, benzin); yoqilg'i bo'lmasa null. */
export function fuelOf(name: string): FuelType | null {
  const t = ` ${name.toLowerCase()} `;
  if (/metan|метан|\bcng\b/.test(t)) return "METHANE";
  if (/propan|пропан/.test(t)) return "PROPANE";
  if (/benzin|бензин|\bai-?\s?\d{2}\b|аи-?\s?\d{2}/.test(t)) return "PETROL";
  if (/salyarka|solyarka|солярк|dizel|дизел|diesel|[\s(]d\/?t[\s.,)]|[\s(]д\/?т[\s.,)]/.test(t)) return "DIESEL";
  return null;
}

/** Dispetcherga ko'rinadigan material: Avto zapchast kategoriyasi yoki yoqilg'i (qaysi kategoriyada bo'lmasin). */
const visible = (m: { category: string; name: string }) => m.category === "AVTO_ZAPCHAST" || fuelOf(m.name) != null;

/** Ombor yozuvi bo'lmasa — yaratiladi (birinchi «o'ziga olish»da). */
async function ensureWarehouse(tx: Prisma.TransactionClient) {
  await tx.warehouse.upsert({ where: { id: DISPATCH_WH }, update: {}, create: { id: DISPATCH_WH, name: DISPATCH_WH_NAME, isActive: false } });
}

export type DispatchRow = {
  id: string; code: string; name: string; unit: string; category: string; fuel: FuelType | null; price: number | null;
  /** Skladlardagi qoldiq (dispetcher omboridan tashqari) */
  byWh: Record<string, number>; inStock: number;
  /** Dispetcher qo'lidagi */
  held: number;
};

/** Sahifa uchun: skladlar, avto zapchast/yoqilg'i qoldig'i (skladda va dispetcherda) va narx. */
export async function dispatcherStock() {
  const [warehouses, mats, heldSums] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true, id: { not: DISPATCH_WH } }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.material.findMany({ select: { id: true, code: true, name: true, unit: true, category: true, isActive: true }, orderBy: { name: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: DISPATCH_WH, materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  const held = new Map(heldSums.map((s) => [s.materialId!, Number(s._sum.qty ?? 0)]));
  const list = mats.filter((m) => (m.isActive && visible(m)) || Math.abs(held.get(m.id) ?? 0) > STOCK_EPS);
  const ids = list.map((m) => m.id);
  const whIds = warehouses.map((w) => w.id);
  const [sums, prices] = await Promise.all([
    ids.length && whIds.length ? db.stockMove.groupBy({ by: ["materialId", "warehouseId"], where: { materialId: { in: ids }, warehouseId: { in: whIds } }, _sum: { qty: true } }) : Promise.resolve([]),
    issuePrices(ids),
  ]);
  const byMat = new Map<string, Record<string, number>>();
  for (const s of sums) {
    const x = byMat.get(s.materialId!) ?? {};
    x[s.warehouseId] = r3(Number(s._sum.qty ?? 0));
    byMat.set(s.materialId!, x);
  }
  const rows: DispatchRow[] = list.map((m) => {
    const byWh = byMat.get(m.id) ?? {};
    return {
      id: m.id, code: m.code, name: m.name, unit: m.unit, category: m.category, fuel: fuelOf(m.name), price: prices.get(m.id) ?? null,
      byWh, inStock: r3(Object.values(byWh).reduce((a, v) => a + v, 0)), held: r3(held.get(m.id) ?? 0),
    };
  });
  return { warehouses, rows };
}

type Item = { materialId: string; qty: number };
type Actor = { userId: string; role: Role };

function cleanItems(items: unknown): Item[] {
  const want = new Map<string, number>();
  for (const it of Array.isArray(items) ? items : []) {
    const id = String((it as Item)?.materialId ?? "").trim();
    const q = Number((it as Item)?.qty);
    if (!id || !Number.isFinite(q) || q === 0) continue;
    if (q < 0 || q > 1e9) throw new IssueError("Miqdor 0 dan katta son bo'lishi kerak");
    want.set(id, (want.get(id) ?? 0) + q);
  }
  const rows = [...want].map(([materialId, q]) => ({ materialId, qty: r3(q) })).filter((r) => r.qty > 0);
  if (!rows.length) throw new IssueError("Kamida bitta mahsulotni belgilab, miqdorini yozing");
  if (rows.length > MAX_ROWS) throw new IssueError(`Qatorlar juda ko'p (ko'pi bilan ${MAX_ROWS})`);
  return rows;
}

const byToken = async (token: string | null) => (token ? db.stockMove.findUnique({ where: { clientToken: token }, select: { refId: true } }) : null);

/**
 * Ombordan omborga ko'chirish (o'ziga olish yoki qaytarish): har qatorga juft `TRANSFER` (−manba, +qabul), qoldiq manba
 * ombori bo'yicha qulf ostida tekshiriladi. Narx harakatga yoziladi (tannarx izi uchun).
 */
async function transfer(kind: "take" | "return", input: { warehouseId: string; items: unknown; note?: string | null; clientToken?: string | null }, actor: Actor) {
  const token = input.clientToken?.trim() || null;
  const dup = await byToken(token);
  if (dup) return { ref: dup.refId ?? "", count: 0, existed: true };
  const rows = cleanItems(input.items);
  const note = input.note?.trim().slice(0, 300) || null;
  const ids = rows.map((r) => r.materialId);
  const [wh, mats] = await Promise.all([
    db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true, NOT: { id: DISPATCH_WH } }, select: { id: true, name: true } }),
    db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true, category: true } }),
  ]);
  if (!wh) throw new IssueError("Sklad tanlanmagan yoki yopilgan");
  if (mats.length !== ids.length) throw new IssueError("Mahsulot topilmadi — sahifani yangilang");
  const meta = new Map(mats.map((m) => [m.id, m]));
  // O'ziga faqat avto zapchast va yoqilg'i olinadi; qaytarishda — qo'lida nima bo'lsa
  if (kind === "take") {
    const bad = mats.filter((m) => !visible(m));
    if (bad.length) throw new IssueError(`Faqat avto zapchast va yoqilg'i olinadi: ${bad.map((m) => m.name).join(", ")}`);
  }
  const from = kind === "take" ? wh.id : DISPATCH_WH, to = kind === "take" ? DISPATCH_WH : wh.id;
  const fromName = kind === "take" ? wh.name : DISPATCH_WH_NAME;
  const ref = crypto.randomUUID();
  const refType = kind === "take" ? REF_TAKE : REF_RETURN;
  try {
    await db.$transaction(async (tx) => {
      await lockStock(tx);
      await ensureWarehouse(tx);
      const sums = await tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: from, materialId: { in: ids } }, _sum: { qty: true } });
      const bal = new Map(sums.map((s) => [s.materialId!, Number(s._sum.qty ?? 0)]));
      const short = rows.filter((r) => (bal.get(r.materialId) ?? 0) < r.qty - STOCK_EPS).map((r) => {
        const m = meta.get(r.materialId)!, u = unitShort(m.unit);
        return `${m.name} — bor ${fmtNum(Math.max(0, bal.get(r.materialId) ?? 0), 3)} ${u}, kerak ${fmtNum(r.qty, 3)} ${u}`;
      });
      if (short.length) throw new IssueError(`«${fromName}» da yetarli emas: ${short.join("; ")}`);
      const prices = await issuePrices(ids, tx);
      const date = new Date();
      for (const [i, r] of rows.entries()) {
        const unitCost = prices.get(r.materialId) ?? null;
        const base = { type: "TRANSFER" as const, date, materialId: r.materialId, unitCost, refType, refId: ref, note, createdById: actor.userId };
        await tx.stockMove.create({ data: { ...base, warehouseId: from, qty: -r.qty, clientToken: i === 0 ? token : null } });
        await tx.stockMove.create({ data: { ...base, warehouseId: to, qty: r.qty } });
      }
      await audit(tx, actor.userId, "CREATE", "StockMove", ref, undefined, { via: kind === "take" ? "dispetcher_oldi" : "dispetcher_qaytardi", role: actor.role, warehouse: wh.name, rows, note });
    });
  } catch (e) {
    if (token && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await byToken(token);
      if (again) return { ref: again.refId ?? "", count: 0, existed: true };
    }
    throw e;
  }
  return { ref, count: rows.length, existed: false };
}

export const takeToDispatcher = (input: Parameters<typeof transfer>[1], actor: Actor) => transfer("take", input, actor);
export const returnFromDispatcher = (input: Parameters<typeof transfer>[1], actor: Actor) => transfer("return", input, actor);

/**
 * Dispetcher omboridan mashinaga berish: yoqilg'i — zapravka (`FuelLog`), zapchast — transport xarajati (`PARTS`), ikkalasi ham
 * shu omborda `ISSUE` (sarf) bilan. Narx yo'q bo'lsa — rad (summasiz zapravka/xarajat logistika tannarxini buzadi).
 */
export async function issueToVehicle(input: {
  vehicleId: string; materialId: string; qty: number; date?: string | null; driverId?: string | null; note?: string | null; clientToken?: string | null;
}, actor: Actor) {
  const token = input.clientToken?.trim() || null;
  const dup = await byToken(token);
  if (dup) return { id: dup.refId ?? "", existed: true };
  const date = issueDate(input.date, new Date());
  const note = input.note?.trim().slice(0, 300) || null;
  const [v, m, drv] = await Promise.all([
    db.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true, plate: true } }),
    db.material.findUnique({ where: { id: input.materialId }, select: { id: true, name: true, unit: true } }),
    input.driverId ? db.employee.findUnique({ where: { id: input.driverId }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!v) throw new IssueError("Mashinani tanlang");
  if (!m) throw new IssueError("Mahsulotni tanlang");
  if (input.driverId && !drv) throw new IssueError("Haydovchi topilmadi");
  const fuel = fuelOf(m.name);
  // Zapravka litri 2 xonagacha saqlanadi — sklad harakati ham shu miqdorda bo'lsin
  const qty = fuel ? r2(Number(input.qty)) : r3(Number(input.qty));
  if (!Number.isFinite(qty) || qty <= 0) throw new IssueError("Miqdorni yozing");
  if (fuel && qty > 1000) throw new IssueError("Bir zapravkada 1000 dan ko'p bo'lmaydi — raqamni tekshiring");
  const u = unitShort(m.unit);
  try {
    return await db.$transaction(async (tx) => {
      await lockStock(tx);
      const held = Number((await tx.stockMove.aggregate({ where: { warehouseId: DISPATCH_WH, materialId: m.id }, _sum: { qty: true } }))._sum.qty ?? 0);
      if (held < qty - STOCK_EPS) throw new IssueError(`Dispetcher omborida yetarli emas: ${m.name} — bor ${fmtNum(Math.max(0, held), 3)} ${u}, kerak ${fmtNum(qty, 3)} ${u}`);
      const price = (await issuePrices([m.id], tx)).get(m.id) ?? 0;
      if (!(price > 0)) throw new IssueError(`«${m.name}» narxi yo'q — Snabjeniye «Dona narxi»ni qo'ysin yoki kirim narxi bilan kiritilsin`);
      const amount = r2(qty * price);
      let refType: string, refId: string;
      if (fuel) {
        const f = await tx.fuelLog.create({
          data: { date, vehicleId: v.id, driverId: drv?.id ?? null, fuelType: fuel, liters: qty, pricePerL: price, amount, station: DISPATCH_WH_NAME, note: note ?? `${m.name} — dispetcher omboridan`, createdById: actor.userId },
        });
        await audit(tx, actor.userId, "CREATE", "FuelLog", f.id, undefined, f);
        refType = REF_FUEL; refId = f.id;
      } else {
        const e = await tx.transportExpense.create({
          data: { date, kind: "PARTS", vehicleId: v.id, driverId: drv?.id ?? null, amount, note: `${m.name} × ${fmtNum(qty, 3)} ${u} — dispetcher omboridan${note ? `: ${note}` : ""}`, createdById: actor.userId },
        });
        await audit(tx, actor.userId, "CREATE", "TransportExpense", e.id, undefined, e);
        refType = REF_PART; refId = e.id;
      }
      await tx.stockMove.create({
        data: {
          type: "ISSUE", date, warehouseId: DISPATCH_WH, materialId: m.id, employeeId: drv?.id ?? null, qty: -qty, unitCost: price,
          refType, refId, note: `${v.plate}${note ? ` · ${note}` : ""}`, clientToken: token, createdById: actor.userId,
        },
      });
      return { id: refId, existed: false };
    });
  } catch (e) {
    if (token && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await byToken(token);
      if (again) return { id: again.refId ?? "", existed: true };
    }
    throw e;
  }
}

/**
 * Mashinaga berishni bekor qilish: zapravka / xarajat shartli `updateMany` bilan bekor (ikki bosish — ikkinchisi rad),
 * mol dispetcher omboriga teskari `ISSUE` (+) bilan qaytadi. Sabab majburiy.
 */
export async function cancelVehicleIssue(refId: string, reason: string, actor: Actor) {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) throw new IssueError("Bekor qilish sababini yozing (kamida 3 belgi)");
  return db.$transaction(async (tx) => {
    await lockStock(tx);
    const mv = await tx.stockMove.findFirst({ where: { refId, refType: { in: [REF_FUEL, REF_PART] }, warehouseId: DISPATCH_WH } });
    if (!mv) throw new IssueError("Yozuv topilmadi — sahifani yangilang");
    if (await tx.stockMove.count({ where: { refId, refType: mv.refType + STORNO } })) throw new IssueError("Bu berish allaqachon bekor qilingan");
    const data = { cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: why };
    const n = mv.refType === REF_FUEL
      ? (await tx.fuelLog.updateMany({ where: { id: refId, cancelledAt: null }, data })).count
      : (await tx.transportExpense.updateMany({ where: { id: refId, cancelledAt: null }, data })).count;
    if (!n) throw new IssueError("Zapravka / xarajat allaqachon bekor qilingan");
    await tx.stockMove.create({
      data: {
        type: "ISSUE", date: new Date(), warehouseId: DISPATCH_WH, materialId: mv.materialId, employeeId: mv.employeeId, qty: -Number(mv.qty), unitCost: mv.unitCost,
        refType: mv.refType + STORNO, refId, note: `Bekor qilish: ${why}`, createdById: actor.userId,
      },
    });
    await audit(tx, actor.userId, "STATUS_CHANGE", mv.refType === REF_FUEL ? "FuelLog" : "TransportExpense", refId, { status: "ACTIVE" }, { status: "CANCELLED", reason: why, via: "dispetcher_ombori" });
  });
}

export type DispatchMove = {
  id: string; at: Date; kind: "take" | "return" | "fuel" | "part" | "storno"; material: string; unit: string; qty: number; sum: number | null;
  warehouse: string | null; plate: string | null; who: string | null; by: string; note: string | null;
  /** Mashinaga berish — bekor qilish uchun (zapravka/xarajat id), bekor qilinmagan bo'lsa */
  cancelRef: string | null; cancelled: boolean;
};

/** Harakatlar jurnali: olindi, qaytarildi, mashinaga berildi (zapravka / zapchast), bekor qilindi. */
export async function dispatcherMoves(from: Date, to: Date, take = 300): Promise<DispatchMove[]> {
  const moves = await db.stockMove.findMany({
    where: { refType: { in: [...DISPATCH_REFS] }, date: { gte: from, lt: to }, OR: [{ warehouseId: DISPATCH_WH }, { refType: { in: [REF_TAKE, REF_RETURN] } }] },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: take * 2,
    select: {
      id: true, date: true, warehouseId: true, refType: true, refId: true, qty: true, unitCost: true, note: true,
      material: { select: { name: true, unit: true } }, warehouse: { select: { name: true } }, employee: { select: { fullName: true } }, createdBy: { select: { fullName: true } },
    },
  });
  // Ko'chirishda juftning faqat skladdagi tomoni (dispetcher tomoni takror) ko'rsatiladi
  const rows = moves.filter((m) => !((m.refType === REF_TAKE || m.refType === REF_RETURN) && m.warehouseId === DISPATCH_WH)).slice(0, take);
  const issueIds = [...new Set(rows.filter((m) => m.refType !== REF_TAKE && m.refType !== REF_RETURN).map((m) => m.refId!).filter(Boolean))];
  const [fuels, parts, stornos] = issueIds.length ? await Promise.all([
    db.fuelLog.findMany({ where: { id: { in: issueIds } }, select: { id: true, cancelledAt: true, vehicle: { select: { plate: true } } } }),
    db.transportExpense.findMany({ where: { id: { in: issueIds } }, select: { id: true, cancelledAt: true, vehicle: { select: { plate: true } } } }),
    db.stockMove.findMany({ where: { refId: { in: issueIds }, refType: { in: [REF_FUEL + STORNO, REF_PART + STORNO] } }, select: { refId: true } }),
  ]) : [[], [], []];
  const rec = new Map([...fuels, ...parts].map((x) => [x.id, x]));
  const reversed = new Set(stornos.map((s) => s.refId));
  return rows.map((m) => {
    const q = Number(m.qty), cost = m.unitCost != null ? Number(m.unitCost) : null;
    const r = m.refId ? rec.get(m.refId) : undefined;
    const kind: DispatchMove["kind"] = m.refType === REF_TAKE ? "take" : m.refType === REF_RETURN ? "return" : m.refType === REF_FUEL ? "fuel" : m.refType === REF_PART ? "part" : "storno";
    const issue = kind === "fuel" || kind === "part";
    const cancelled = issue && (reversed.has(m.refId!) || !!r?.cancelledAt);
    return {
      id: m.id, at: m.date, kind, material: m.material?.name ?? "—", unit: m.material?.unit ?? "", qty: Math.abs(q), sum: cost != null ? r2(Math.abs(q) * cost) : null,
      warehouse: kind === "take" || kind === "return" ? m.warehouse.name : null, plate: r?.vehicle?.plate ?? null,
      who: m.employee?.fullName ?? null, by: m.createdBy.fullName, note: m.note, cancelRef: issue && !cancelled ? m.refId : null, cancelled,
    };
  });
}
