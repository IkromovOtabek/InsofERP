import { z } from "zod";
import type { DriverPayType, FuelType, Prisma, TransportExpenseKind } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { driverLedger, type LedgerKind, type LedgerRefs, type LedgerRow } from "@/lib/driver-ledger";
import { driverTariff, monthLocked, priceTrip, suggestPay } from "@/lib/driver-trip-pay";
import { entrySchema, updateLogisticsEntry } from "@/lib/logistics-entry";
import { lastFuelPrice } from "@/lib/logistics-costs";
import { date as fmtDate } from "@/lib/format";

/**
 * Hisob varag'i (Haydovchilar tabeli → mashina varag'i) qatorini tahrirlash — qatordagi qalam, Excel'dagidek hamma ustun
 * bitta oynada. Qator turiga qarab nima yoziladi:
 *  - qo'lda qator (`LogisticsEntry`) — hammasi: sana, transport, haydovchi, joylar, yuk, reys soni, km, baraban soati,
 *    zapravka, xarajatlar, haq, kirim, izoh (`updateLogisticsEntry` qoidalari bilan);
 *  - ECO reys — yuklash joyi, km, baraban soati, haq (`priceTrip` qoidasi: faqat `logistika.pay`), zapravka, xarajatlar,
 *    izoh (yetkazishdagi izoh). Sana, haydovchi, tushirish joyi, yuk va kirim — reys va zayavkadan, bu yerda o'zgarmaydi;
 *  - reyssiz kun — zapravka va xarajatlar.
 * Hisoblanadigan ustunlar (baraban sarfi, sarf, qoldiq, yoqilg'i summasi, jami xarajat, foyda) saqlagach o'zi qayta hisoblanadi.
 *
 * Zapravka va xarajat — varaqda shu qatorga tushgan yozuvlar (`LedgerRow.refs`, bog'lanmagani ham): yozuv bitta bo'lsa —
 * miqdori/summasi joyida o'zgaradi, bir nechta bo'lsa — eskilari sababi bilan bekor qilinib, bitta yangi yozuv qatorga
 * bog'lanib yoziladi, 0 — bekor qilinadi. Hammasi AuditLog'da; yozuv shu orada boshqa joyda o'zgargan bo'lsa — tahrir qaytariladi.
 */

export const ledgerEditSchema = entrySchema.extend({
  /** Narxlangan reys haqini o'zgartirish sababi (`priceTrip`) */
  payReason: z.string().trim().max(300).optional().transform((v) => v || null),
});
export type LedgerEditInput = z.infer<typeof ledgerEditSchema>;

export const isLedgerKind = (k: string): k is LedgerKind => k === "trip" || k === "entry" || k === "cost";

/** Tahrir oynasi qiymatlari — ochilganda serverdan (jadvalda har qatorga yuborilmaydi). */
export type LedgerEditData = {
  kind: LedgerKind; id: string; no: string; date: string; dateText: string; vehicleId: string; plate: string; unit: string;
  driverId: string | null; driver: string | null;
  pickup: string; dropoff: string; address: string | null; cargo: string; trips: number; km: number; hours: number | null;
  refuel: number; fuelPrice: number | null; lastPrice: number | null;
  /** Haq: qo'lda qatorda — yozilgani, reysda — narxlangan bo'lsa (bo'lmasa `suggested` — taklif) */
  pay: number | null; suggested: number | null; payType: DriverPayType | null; priced: boolean; approved: boolean;
  /** Haq qotgan (kassaga o'tgan naqd / yopilgan oy) — sababi */
  payLock: string | null;
  repair: number; parts: number; vulc: number; other: number;
  revenue: number; revenueType: "BANK" | "CASH" | "OBJECT" | null; revBank: number; revCash: number; revOther: number;
  note: string; ownCosts: boolean;
};

type Cat = Exclude<keyof LedgerRefs, "fuel">;
const CATS: { key: Cat; kind: TransportExpenseKind; title: string }[] = [
  { key: "repair", kind: "REPAIR", title: "Ta'mir" },
  { key: "parts", kind: "PARTS", title: "Zapchast" },
  // Vulkanizatsiya alohida tur emas — OTHER, izohidagi so'z bilan ajraladi (`driver-ledger`)
  { key: "vulc", kind: "OTHER", title: "Vulkanizatsiya" },
  { key: "other", kind: "OTHER", title: "Boshqa xarajat" },
];

const STALE = "Qatordagi zapravka yoki xarajat boshqa joyda o'zgartirildi — sahifani yangilab, qayta tahrirlang";
class StaleRow extends Error { constructor() { super(STALE); } }

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Yangi zapravka turi — qoldiq yuritiladigan yoqilg'i (`createLogisticsEntry` dagidek; kartada tur yo'q bo'lsa — birlikdan). */
const fuelTypeOf = (fuelType: FuelType | null | undefined, unit: string): FuelType =>
  fuelType === "DIESEL_METHANE" ? "METHANE" : fuelType ?? (unit === "m³" ? "METHANE" : "DIESEL");

/** Qatorni varaqdagi holida topish: shu mashinaning shu oyi qayta hisoblanadi (qoldiq va bog'lanmagan yozuvlar varaqdagidek). */
async function findRow(kind: LedgerKind, id: string): Promise<LedgerRow | string> {
  let vehicleId: string | null = null, at: Date | null = null;
  if (kind === "entry") {
    const e = await db.logisticsEntry.findUnique({ where: { id }, select: { vehicleId: true, date: true, cancelledAt: true } });
    if (!e || e.cancelledAt) return "Qator topilmadi yoki bekor qilingan — sahifani yangilang";
    vehicleId = e.vehicleId; at = e.date;
  } else if (kind === "trip") {
    const t = await db.trip.findUnique({ where: { id }, select: { vehicleId: true, deliveredAt: true, status: true } });
    if (!t || t.status !== "DELIVERED" || !t.deliveredAt) return "Faqat yetkazilgan reys qatori tahrirlanadi";
    vehicleId = t.vehicleId; at = t.deliveredAt;
  } else {
    // Reyssiz kun: `<mashina>:<yil>-<oy>-<kun>`
    const m = /^(.+):(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(id);
    if (m) { vehicleId = m[1]!; at = new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4])); }
  }
  if (!vehicleId || !at) return "Qator topilmadi — sahifani yangilang";
  const from = new Date(at.getFullYear(), at.getMonth(), 1), to = new Date(at.getFullYear(), at.getMonth() + 1, 1);
  return (await driverLedger(from, to, { vehicleId })).rows.find((r) => r.kind === kind && r.id === id) ?? "Qator topilmadi — sahifani yangilang";
}

/** Haq qotganmi: naqdi kassaga o'tgan yoki oyi vedomostda yopilgan (reysda — `priceTrip`, qo'lda qatorda — `cancelBlock` qoidasi). */
async function payLockOf(r: LedgerRow): Promise<string | null> {
  if (r.kind === "cost") return null;
  if (r.payType === "CASH" && r.approvedAt) return "Naqd haq kassaga o'tgan";
  const payroll = r.kind === "trip" ? true : r.payType === "PAYROLL" && r.pay > 0;
  return payroll && (await monthLocked(r.at)) ? "Shu oyning ish haqi vedomosti tasdiqlangan" : null;
}

export async function ledgerEditData(kind: LedgerKind, id: string): Promise<LedgerEditData | { error: string }> {
  const r = await findRow(kind, id);
  if (typeof r === "string") return { error: r };
  const v = await db.vehicle.findUnique({ where: { id: r.vehicleId }, select: { fuelType: true } });
  const [payLock, lastPrice] = await Promise.all([payLockOf(r), r.refuelPrice == null ? lastFuelPrice(fuelTypeOf(v?.fuelType, r.unit)) : Promise.resolve(null)]);
  // Izoh yozilmagan qo'lda qatorda `note` = «yuklash → tushirish» — oynada bo'sh (saqlaganda yangi joylardan qayta tuziladi)
  const autoNote = [r.src.pickup, r.src.dropoff].filter(Boolean).join(" → ");
  return {
    kind, id, no: r.no, date: isoDay(r.at), dateText: fmtDate(r.at), vehicleId: r.vehicleId, plate: r.plate, unit: r.unit,
    driverId: r.driverId, driver: r.driver,
    pickup: r.kind === "cost" ? "" : r.src.pickup ?? "", dropoff: r.kind === "trip" ? r.dropoff : r.src.dropoff ?? "", address: r.address,
    cargo: r.kind === "trip" ? r.cargo : r.src.cargo ?? "", trips: r.trips, km: r.km, hours: r.workHours,
    refuel: r.refuel, fuelPrice: r.refuelPrice, lastPrice,
    pay: r.kind === "trip" ? (r.src.priced ? r.amount : null) : r.amount, suggested: r.src.suggested, payType: r.payType, priced: r.src.priced, approved: !!r.approvedAt, payLock,
    repair: r.repair, parts: r.parts, vulc: r.vulc, other: r.other,
    revenue: r.revenue, revenueType: r.src.revenueType, revBank: r2(r.revBank), revCash: r2(r.revCash), revOther: r2(r.revOther),
    note: r.kind === "entry" && r.src.note === autoNote ? "" : r.src.note ?? "", ownCosts: r.ownCosts,
  };
}

// ───────────────────────── Zapravka va xarajat: reja (o'qish) → yozish (tranzaksiyada) ─────────────────────────

type FuelPlan = { ids: string[]; single: string | null; liters: number; price: number; fuelType: FuelType };
type CostPlan = { title: string; ids: string[]; single: string | null; amount: number; kind: TransportExpenseKind };
type Plan = { fuel: FuelPlan | null; costs: CostPlan[]; /** tahrirdan keyin qatorda zapravka yoki xarajat qoladi */ after: boolean };

async function planCosts(r: LedgerRow, d: LedgerEditInput, fuelType: FuelType): Promise<Plan | { error: string }> {
  const expIds = CATS.flatMap((c) => r.refs[c.key]);
  const [logs, exps] = await Promise.all([
    r.refs.fuel.length ? db.fuelLog.findMany({ where: { id: { in: r.refs.fuel }, cancelledAt: null }, select: { id: true, liters: true, amount: true, fuelType: true } }) : Promise.resolve([]),
    expIds.length ? db.transportExpense.findMany({ where: { id: { in: expIds }, cancelledAt: null }, select: { id: true, amount: true, kind: true } }) : Promise.resolve([]),
  ]);
  if (logs.length !== r.refs.fuel.length || exps.length !== expIds.length) return { error: STALE };

  let fuel: FuelPlan | null = null;
  const liters = r2(d.refuel ?? 0);
  const haveL = logs.reduce((a, f) => a + Number(f.liters), 0), haveSum = logs.reduce((a, f) => a + Number(f.amount), 0);
  const havePrice = haveL > 0 ? haveSum / haveL : null;
  const price = d.fuelPrice && d.fuelPrice > 0 ? d.fuelPrice : null;
  // Varaqda zapravka 0,1 gacha yaxlitlangan — o'zgarmagan qiymat qayta yozilmasin
  const litersChanged = Math.abs(liters - haveL) > 0.051;
  const priceChanged = liters > 0 && price != null && havePrice != null && Math.abs(price - havePrice) >= 0.01;
  if (litersChanged || priceChanged) {
    const p = price ?? (havePrice != null ? r2(havePrice) : liters > 0 ? await lastFuelPrice(fuelType) : null);
    if (liters > 0 && !p) return { error: "Zapravka narxini yozing (oldingi zapravka topilmadi)" };
    fuel = {
      ids: logs.map((f) => f.id), single: logs.length === 1 ? logs[0]!.id : null, liters, price: p ?? 0,
      fuelType: logs.length && logs.every((f) => f.fuelType === logs[0]!.fuelType) ? logs[0]!.fuelType : fuelType,
    };
  }

  const costs: CostPlan[] = [];
  for (const c of CATS) {
    const old = exps.filter((x) => r.refs[c.key].includes(x.id));
    const want = Math.round(d[c.key] ?? 0);
    if (Math.abs(want - old.reduce((a, x) => a + Number(x.amount), 0)) < 0.5) continue;
    costs.push({
      title: c.title, ids: old.map((x) => x.id), single: old.length === 1 ? old[0]!.id : null, amount: want,
      kind: old.length && old.every((x) => x.kind === old[0]!.kind) ? old[0]!.kind : c.kind,
    });
  }
  return { fuel, costs, after: liters > 0 || CATS.some((c) => Math.round(d[c.key] ?? 0) > 0) };
}

type Ctx = { date: Date; driverId: string | null; vehicleId: string; tripId: string | null; entryId: string | null; label: string };

async function applyCosts(tx: Prisma.TransactionClient, plan: Plan, ctx: Ctx, userId: string) {
  const now = new Date();
  const why = `Hisob varag'ida tahrirlandi (${ctx.label})`.slice(0, 300);
  const cancel = async (entity: "FuelLog" | "TransportExpense", ids: string[]) => {
    if (!ids.length) return;
    const data = { cancelledAt: now, cancelledById: userId, cancelReason: why };
    const where = { id: { in: ids }, cancelledAt: null };
    const u = entity === "FuelLog" ? await tx.fuelLog.updateMany({ where, data }) : await tx.transportExpense.updateMany({ where, data });
    if (u.count !== ids.length) throw new StaleRow();
    for (const id of ids) await audit(tx, userId, "STATUS_CHANGE", entity, id, { cancelledAt: null }, data);
  };

  const f = plan.fuel;
  if (f && f.liters > 0 && f.single) {
    const before = await tx.fuelLog.findUnique({ where: { id: f.single }, select: { liters: true, pricePerL: true, amount: true } });
    const data = { liters: f.liters, pricePerL: f.price, amount: Math.round(f.liters * f.price) };
    if ((await tx.fuelLog.updateMany({ where: { id: f.single, cancelledAt: null }, data })).count !== 1) throw new StaleRow();
    await audit(tx, userId, "UPDATE", "FuelLog", f.single, before ?? undefined, { ...data, reason: why });
  } else if (f) {
    await cancel("FuelLog", f.ids);
    if (f.liters > 0) {
      const n = await tx.fuelLog.create({
        data: {
          vehicleId: ctx.vehicleId, driverId: ctx.driverId, tripId: ctx.tripId, entryId: ctx.entryId, date: ctx.date, fuelType: f.fuelType,
          liters: f.liters, pricePerL: f.price, amount: Math.round(f.liters * f.price), note: `Hisob varag'i · ${ctx.label}`, createdById: userId,
        },
      });
      await audit(tx, userId, "CREATE", "FuelLog", n.id, undefined, n);
    }
  }

  for (const c of plan.costs) {
    if (c.amount > 0 && c.single) {
      const before = await tx.transportExpense.findUnique({ where: { id: c.single }, select: { amount: true } });
      if ((await tx.transportExpense.updateMany({ where: { id: c.single, cancelledAt: null }, data: { amount: c.amount } })).count !== 1) throw new StaleRow();
      await audit(tx, userId, "UPDATE", "TransportExpense", c.single, before ?? undefined, { amount: c.amount, reason: why });
      continue;
    }
    await cancel("TransportExpense", c.ids);
    if (c.amount > 0) {
      const n = await tx.transportExpense.create({
        data: { kind: c.kind, amount: c.amount, date: ctx.date, vehicleId: ctx.vehicleId, driverId: ctx.driverId, tripId: ctx.tripId, entryId: ctx.entryId, note: `${c.title} · ${ctx.label}`, createdById: userId },
      });
      await audit(tx, userId, "CREATE", "TransportExpense", n.id, undefined, n);
    }
  }
}

// ───────────────────────── Saqlash ─────────────────────────

export async function updateLedgerRow(kind: LedgerKind, id: string, d: LedgerEditInput, userId: string, canPay: boolean): Promise<{ ok: true; note: string } | { error: string }> {
  const r = await findRow(kind, id);
  if (typeof r === "string") return { error: r };
  const v = await db.vehicle.findUnique({ where: { id: r.vehicleId }, select: { fuelType: true } });
  const plan = await planCosts(r, d, fuelTypeOf(v?.fuelType, r.unit));
  if ("error" in plan) return plan;
  try {
    if (kind === "entry") {
      const res = await updateLogisticsEntry(id, d, userId, {
        costs: plan.after,
        apply: (tx, c) => applyCosts(tx, plan, { date: c.date, driverId: c.driverId, vehicleId: c.vehicleId ?? r.vehicleId, tripId: null, entryId: id, label: `qo'lda qator ${c.docNo}` }, userId),
      });
      if ("error" in res) return res;
      return { ok: true, note: `${res.docNo} saqlandi${res.reapprove ? " — haq ish boshqaruvchi tasdig'iga qaytdi" : ""}` };
    }
    if (kind === "trip") return await updateTripRow(r, d, plan, userId, canPay);
    if (!plan.fuel && !plan.costs.length) return { ok: true, note: "O'zgarish yo'q" };
    await db.$transaction((tx) => applyCosts(tx, plan, { date: r.at, driverId: null, vehicleId: r.vehicleId, tripId: null, entryId: null, label: `reyssiz kun ${fmtDate(r.at)}` }, userId));
    return { ok: true, note: "Saqlandi" };
  } catch (e) {
    if (e instanceof StaleRow) return { error: e.message };
    throw e;
  }
}

/**
 * ECO reys qatori: haq — avval (`priceTrip`: yopilgan oy, kassaga o'tgan naqd, narxlanganda sabab — rad etsa hech narsa
 * yozilmaydi), keyin bitta tranzaksiyada yuklash joyi, km, baraban soati, izoh va zapravka/xarajatlar.
 */
async function updateTripRow(r: LedgerRow, d: LedgerEditInput, plan: Plan, userId: string, canPay: boolean): Promise<{ ok: true; note: string } | { error: string }> {
  const t = await db.trip.findUnique({
    where: { id: r.id },
    select: { pickupAddress: true, deliveryComment: true, payKm: true, workHours: true, waitMin: true, paySuggested: true, deliveryNoteNo: true, vehicle: { select: { type: true } } },
  });
  if (!t) return { error: "Reys topilmadi" };
  if (d.km != null && d.km > 5000) return { error: "Km juda katta (5000 dan oshmaydi)" };

  // Haq: bo'sh qoldirilsa — o'zgarmaydi; turi tanlanmasa — avvalgisi
  const amount = d.payAmount != null ? Math.round(d.payAmount) : null;
  const type = d.payType ?? r.payType;
  const payChanged = amount != null && (!r.src.priced || amount !== Math.round(r.amount ?? 0) || type !== r.payType);
  if (payChanged) {
    if (!canPay) return { error: "Reys haqini dispetcher qo'yadi — haq ustunini o'zgartirmang" };
    if (!type) return { error: "To'lov turini tanlang: naqd yoki oylik" };
    const p = await priceTrip(r.id, amount, d.payReason, userId, type);
    if ("error" in p) return p;
  }

  const data: { pickupAddress?: string | null; payKm?: number; paySuggested?: number; workHours?: number; deliveryComment?: string | null } = {};
  if ((d.pickup ?? "") !== (t.pickupAddress?.trim() ?? "")) data.pickupAddress = d.pickup;
  if (d.km != null && Math.abs(d.km - r.km) > 0.05) {
    data.payKm = r1(d.km);
    // Narxi qo'yilmagan reysda taklif yangi km bilan (`fixTripKmHours` dagidek)
    if (!r.src.priced && !payChanged) data.paySuggested = suggestPay(await driverTariff(), data.payKm, t.waitMin, t.vehicle.type === "MIXER");
  }
  if (d.drumHours != null && (r.workHours == null || Math.abs(d.drumHours - r.workHours) > 0.005)) data.workHours = r2(d.drumHours);
  const comment = d.note || null;
  if ((comment ?? "") !== (t.deliveryComment ?? "")) data.deliveryComment = comment;
  const changed = Object.keys(data).length > 0 || !!plan.fuel || plan.costs.length > 0;

  if (changed) {
    await db.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.trip.update({ where: { id: r.id }, data });
        await audit(tx, userId, "UPDATE", "Trip", r.id,
          { pickupAddress: t.pickupAddress, payKm: t.payKm, workHours: t.workHours, paySuggested: t.paySuggested, deliveryComment: t.deliveryComment },
          { ...data, reason: "Hisob varag'i: qator tahriri" });
      }
      await applyCosts(tx, plan, { date: r.at, driverId: r.driverId, vehicleId: r.vehicleId, tripId: r.id, entryId: null, label: `reys ${t.deliveryNoteNo}` }, userId);
    });
  }
  if (!changed && !payChanged) return { ok: true, note: "O'zgarish yo'q" };
  return { ok: true, note: `${r.no} saqlandi${payChanged ? " — haq ish boshqaruvchi tasdig'iga yuborildi" : ""}` };
}
