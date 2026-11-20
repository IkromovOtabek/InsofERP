import { db } from "./db";
import { driverEmployees, mainDriverOf } from "./logistics";
import { DISPATCH_WH } from "./dispatcher-stock";
import { notifyAfter, notifyRoles } from "./notify";
import { fmtNum } from "./format";
import { unitShort } from "./unit";
import type { TargetGroups } from "./issue-target";

export type DriverOpt = NonNullable<TargetGroups["drivers"]>[number];

/**
 * Haydovchilar ombori — skladdan haydovchiga va o'z transportimizga berilgan narsalar dispetcher ko'zi bilan.
 *
 *  · Sklad → «Yangi chiqim» → Kimga → «Haydovchilar»: kalit xodimniki ("e:<id>"), yozuv oddiy xodimga berish
 *    (`StockMove ISSUE`, `employeeId`) — sarf, qaytarish yo'q. Mashina raqami ro'yxatda faqat tanlash uchun.
 *  · «Avto zapchast» transportga ("v:<id>") — Logistika moliyadan chiqim (`lib/stock-issue.ts`); bu yerda faqat ko'rinadi.
 *  · Dispetcher omboridan mashinaga berish (`lib/dispatcher-stock.ts`) bu ro'yxatga kirmaydi — u zapravka/xarajat.
 *  · Bekor qilingan chiqim (`IssueStorno`) va bekor qilingan kirimning avto chiqimi teskari yozuv bilan netlanadi.
 * Ko'radi: Haydovchilar tabeli → «Ombor» (logistika, dispetcher, ish boshqaruvchi, buxgalteriya, direktor).
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.0005;

/** Mashina raqami: biriktirilgan texnika, bo'lmasa asosiy haydovchisi bo'lgan faol transport. */
async function driverPlates() {
  const vehicles = await db.vehicle.findMany({ where: { external: false }, select: { id: true, plate: true, mainDriverId: true, isActive: true } });
  const plate = new Map(vehicles.map((v) => [v.id, v.plate]));
  const mainOf = new Map(vehicles.filter((v) => v.mainDriverId && v.isActive).map((v) => [v.mainDriverId!, v.plate]));
  return (d: { id: string; vehicleId: string | null }) => (d.vehicleId && plate.get(d.vehicleId)) || mainOf.get(d.id) || null;
}

const byPlate = (a: DriverOpt, b: DriverOpt) =>
  Number(!a.plate) - Number(!b.plate) || (a.plate ?? "").localeCompare(b.plate ?? "") || a.name.localeCompare(b.name);

/** «Kimga» ro'yxati uchun: faol, o'zimizning (ko'chadan emas) haydovchilar — mashina raqami bo'yicha, mashinasizlari oxirida. */
export async function driverTargets(): Promise<DriverOpt[]> {
  const [drivers, plateOf] = await Promise.all([driverEmployees({ activeOnly: true }), driverPlates()]);
  return drivers.filter((d) => !d.external).map((d) => ({ id: d.id, name: d.fullName, plate: plateOf(d) })).sort(byPlate);
}

export type DriverStockItem = { materialId: string; name: string; unit: string; /** tanlangan oy (sof) */ month: number; /** barcha vaqt (sof) */ total: number; last: Date | null };
export type DriverStockHolder = {
  key: string; kind: "driver" | "vehicle"; id: string;
  /** haydovchi — F.I.O., transport — raqami */
  name: string;
  /** haydovchi — mashina raqami, transport — asosiy haydovchisi */
  sub: string | null;
  active: boolean; items: DriverStockItem[];
};
export type DriverStockMove = {
  id: string; at: Date; ref: string | null; kind: "driver" | "vehicle"; holderKey: string; name: string; sub: string | null;
  material: string; unit: string; qty: number; sum: number | null; warehouse: string; by: string; note: string | null;
  cancelled: boolean; auto: boolean;
};

/**
 * «Ombor» oynasi: kimda nima bor (haydovchi va transport bo'yicha, barcha vaqt + tanlangan oy) va oyning berish jurnali.
 * `driverId` — bitta haydovchi: uning o'zi va u asosiy haydovchi bo'lgan / biriktirilgan transport.
 */
export async function driverStock(p: { from: Date; to: Date; driverId?: string | null }) {
  const [drivers, plateOf] = await Promise.all([driverEmployees(), driverPlates()]);
  const driverIds = drivers.map((d) => d.id);
  const moves = await db.stockMove.findMany({
    where: {
      type: "ISSUE", materialId: { not: null }, warehouseId: { not: DISPATCH_WH },
      OR: [...(driverIds.length ? [{ employeeId: { in: driverIds } }] : []), { vehicleId: { not: null } }],
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, date: true, qty: true, unitCost: true, materialId: true, employeeId: true, vehicleId: true, refType: true, refId: true, note: true,
      material: { select: { name: true, unit: true } }, warehouse: { select: { name: true } }, createdBy: { select: { fullName: true } },
    },
  });
  const vehicleIds = [...new Set(moves.map((m) => m.vehicleId).filter((x): x is string => !!x))];
  const vehicles = vehicleIds.length ? await db.vehicle.findMany({
    where: { id: { in: vehicleIds } },
    select: { id: true, plate: true, isActive: true, mainDriverId: true, drivers: { select: { id: true, fullName: true } } },
  }) : [];
  const drv = new Map(drivers.map((d) => [d.id, { name: d.fullName, plate: plateOf(d), active: d.isActive, vehicleId: d.vehicleId }]));
  const veh = new Map(vehicles.map((v) => { const md = mainDriverOf(v); return [v.id, { plate: v.plate, active: v.isActive, driver: md?.fullName ?? null, driverId: md?.id ?? null }]; }));

  // Bekor qilinganlar: chiqim stornosi va bekor qilingan kirimning teskari avto chiqimi (qty > 0)
  const voided = new Set(moves.filter((m) => m.refId && (m.refType === "IssueStorno" || (m.refType === "GoodsReceipt" && Number(m.qty) > 0))).map((m) => `${m.refType === "IssueStorno" ? "Issue" : "GoodsReceipt"}|${m.refId}`));
  const holderOf = (m: { employeeId: string | null; vehicleId: string | null }) => {
    if (m.vehicleId) {
      const v = veh.get(m.vehicleId);
      return { key: `v:${m.vehicleId}`, kind: "vehicle" as const, id: m.vehicleId, name: v?.plate ?? "?", sub: v?.driver ?? null, active: v?.active ?? false };
    }
    const d = drv.get(m.employeeId!);
    return { key: `e:${m.employeeId}`, kind: "driver" as const, id: m.employeeId!, name: d?.name ?? "?", sub: d?.plate ?? null, active: d?.active ?? false };
  };
  // Bitta haydovchi: o'zi + uning transporti (biriktirilgan yoki asosiy haydovchisi)
  const pickVehicle = p.driverId ? drv.get(p.driverId)?.vehicleId ?? null : null;
  const keep = (m: { employeeId: string | null; vehicleId: string | null }) => !p.driverId
    || (m.vehicleId ? m.vehicleId === pickVehicle || veh.get(m.vehicleId)?.driverId === p.driverId : m.employeeId === p.driverId);

  const holders = new Map<string, DriverStockHolder & { byMat: Map<string, DriverStockItem> }>();
  const journal: DriverStockMove[] = [];
  for (const m of moves) {
    if (!keep(m)) continue;
    const h0 = holderOf(m);
    const h = holders.get(h0.key) ?? { ...h0, items: [], byMat: new Map<string, DriverStockItem>() };
    holders.set(h0.key, h);
    const out = -Number(m.qty); // berilgan — musbat, teskari (bekor) — manfiy
    const inMonth = m.date >= p.from && m.date < p.to;
    const it = h.byMat.get(m.materialId!) ?? { materialId: m.materialId!, name: m.material?.name ?? "?", unit: m.material?.unit ?? "", month: 0, total: 0, last: null };
    it.total += out;
    if (inMonth) it.month += out;
    if (out > 0 && (!it.last || m.date > it.last)) it.last = m.date;
    h.byMat.set(m.materialId!, it);
    if (inMonth && out > 0) {
      const cost = m.unitCost == null ? null : Number(m.unitCost);
      const doc = m.refType === "Issue" || m.refType === "GoodsReceipt" ? `${m.refType}|${m.refId}` : null;
      journal.push({
        id: m.id, at: m.date, ref: m.refType === "Issue" ? m.refId : null, kind: h0.kind, holderKey: h0.key, name: h0.name, sub: h0.sub,
        material: m.material?.name ?? "?", unit: m.material?.unit ?? "", qty: r3(out), sum: cost == null ? null : r2(out * cost),
        warehouse: m.warehouse.name, by: m.createdBy.fullName, note: m.note, cancelled: !!doc && voided.has(doc), auto: m.refType === "GoodsReceipt",
      });
    }
  }
  const list = [...holders.values()].map(({ byMat, ...h }) => ({
    ...h,
    items: [...byMat.values()].map((x) => ({ ...x, month: r3(x.month), total: r3(x.total) })).filter((x) => x.total > EPS || Math.abs(x.month) > EPS)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((h) => h.items.length > 0);
  const order = (a: DriverStockHolder, b: DriverStockHolder) => Number(!a.active) - Number(!b.active)
    || (a.kind === "driver" ? byPlate({ id: a.id, name: a.name, plate: a.sub }, { id: b.id, name: b.name, plate: b.sub }) : a.name.localeCompare(b.name));
  return {
    drivers: list.filter((h) => h.kind === "driver").sort(order),
    vehicles: list.filter((h) => h.kind === "vehicle").sort(order),
    journal,
  };
}

/** Dispetcher omboridagi pozitsiyalar soni (qoldig'i bor) — «Ombor» oynasidagi karta uchun. */
export async function dispatcherHeldCount(): Promise<number> {
  const sums = await db.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: DISPATCH_WH, materialId: { not: null } }, _sum: { qty: true } });
  return sums.filter((s) => Number(s._sum.qty ?? 0) > EPS).length;
}

/**
 * Bildirishnoma havolasi: id — "employees:<haydovchi>" yoki "vehicles:<transport>". Vebda Haydovchilar tabeli → «Ombor»
 * (haydovchi bo'lsa — faqat u), ECO'da `/api/mobile/detail` id'dagi kalit bo'yicha haydovchi / transport kartasini ochadi.
 */
export const DRIVER_STOCK_LINK = "driver-stock";

const listText = (a: string[], max = 4) => a.slice(0, max).join(", ") + (a.length > max ? ` va yana ${a.length - max} ta` : "");

/**
 * Skladdan haydovchiga yoki o'z transportimizga chiqim yozilgach — dispetcherlarga xabar (ovozsiz): kimga, nima, qancha.
 * Chaqiruvchi (veb va mobil chiqim) yangi hujjatda chaqiradi; Excel jurnal importi (eski daftar) xabar bermaydi.
 */
export function notifyDriverIssue(ref: string, actorUserId: string): void {
  notifyAfter(async () => {
    const moves = await db.stockMove.findMany({
      where: { refType: "Issue", refId: ref, type: "ISSUE", OR: [{ employeeId: { not: null } }, { vehicleId: { not: null } }] },
      select: { employeeId: true, vehicleId: true, qty: true, material: { select: { name: true, unit: true } }, warehouse: { select: { name: true } } },
    });
    const first = moves[0];
    if (!first) return;
    let title: string, linkId: string;
    if (first.vehicleId) {
      const v = await db.vehicle.findUnique({ where: { id: first.vehicleId }, select: { plate: true, mainDriverId: true, drivers: { select: { id: true, fullName: true } } } });
      if (!v) return;
      const md = mainDriverOf(v);
      title = `Skladdan transportga: ${v.plate}${md ? ` · ${md.fullName}` : ""}`;
      linkId = `vehicles:${first.vehicleId}`;
    } else {
      const d = (await driverTargets()).find((x) => x.id === first.employeeId);
      if (!d) return; // oddiy xodim — dispetcherga tegishli emas
      title = `Skladdan haydovchiga: ${d.plate ? `${d.plate} · ` : ""}${d.name}`;
      linkId = `employees:${d.id}`;
    }
    const lines = moves.map((m) => `${m.material?.name ?? "?"} ${fmtNum(-Number(m.qty), 3)} ${unitShort(m.material?.unit ?? "")}`);
    await notifyRoles(["DISPATCHER"], {
      type: "DRIVER_STOCK",
      title,
      body: `${listText(lines)} — ${first.warehouse.name}`,
      link: { key: DRIVER_STOCK_LINK, id: linkId },
      channel: "oddiy",
    }, { except: actorUserId });
  });
}
