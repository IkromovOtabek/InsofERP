import { z } from "zod";
import { Prisma, type DriverPayType } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { notifyAfter, notifyRoles, notifyUsers } from "@/lib/notify";
import { monthLocked, PAY_APPROVER_ROLES, PAY_TYPE_LABEL, PAY_TYPES, TRIP_PAY_PROBLEM } from "@/lib/driver-trip-pay";
import { dayField, numIn } from "@/lib/logistics-admin";
import { money } from "@/lib/format";

/**
 * Dispetcherning qo'lda yozuvi (Haydovchilar tabeli → «Qo'lda yozuvlar»): tizimga reys bo'lib tushmagan ish —
 * ECO'ga ulanmagan haydovchi, zavoddan tashqari ish, oyiga qat'iy haq — va transportning qo'shimcha kirimi.
 *
 * Bitta yozuvda ikki narsa bo'lishi mumkin: haydovchi haqi (`payAmount`, to'lov turi bilan) va kirim (`revenue`).
 * Haq reys haqi bilan bir oqimda: dispetcher yozadi → ish boshqaruvchi tasdiqlaydi (`approveLogisticsEntries`):
 * oylik — oy yakuni vedomostiga (`tripPayByDriver`), naqd — kassaga mexanik so'rovi (`TRIP_PAY_PROBLEM`, transport
 * xarajatiga qayta yozilmaydi). Kirim tasdiqsiz — hisobot uchun (Avtotransport tahlili, transport kartasi, tabel).
 * Chiqim bu yerda emas — `TransportExpense` (Logistika → Transport xarajatlari bilan bitta manba).
 *
 * Yozuv o'chirilmaydi: bekor qilinadi (sababi bilan) yoki ish boshqaruvchi rad etadi — hammasi AuditLog'da.
 * Naqdi kassaga o'tgan yoki oyi vedomostda yopilgan oylik haqni bekor qilib bo'lmaydi.
 */

export const ENTRY_PREFIX = "QY";

export const entrySchema = z.object({
  date: dayField,
  driverId: z.string().trim().optional().transform((v) => v || null),
  vehicleId: z.string().trim().optional().transform((v) => v || null),
  trips: numIn(0, 1000),
  km: numIn(0, 100_000),
  payAmount: numIn(0, 100_000_000),
  payType: z.enum(PAY_TYPES).optional().or(z.literal("").transform(() => undefined)),
  revenue: numIn(0, 1_000_000_000),
  note: z.string().trim().min(3, "Izoh yozing: qanday ish, qayerga (kamida 3 belgi)").max(300),
  clientToken: z.string().trim().max(64).optional().transform((v) => v || null),
});
export type EntryInput = z.infer<typeof entrySchema>;

type Result = { ok: true; id: string; docNo: string } | { error: string };

/** Oy bo'yicha amaldagi (bekor qilinmagan) yozuvlar. */
export const activeEntryWhere = (from: Date, to: Date) => ({ cancelledAt: null, date: { gte: from, lt: to } });

/** Haqi bor, ish boshqaruvchi hali tasdiqlamagan yozuvlar. */
export const pendingEntryWhere = () => ({ cancelledAt: null, payApprovedAt: null, payAmount: { gt: 0 }, payType: { not: null } });

export async function createLogisticsEntry(d: EntryInput, userId: string): Promise<Result> {
  if (d.clientToken) {
    const dup = await db.logisticsEntry.findUnique({ where: { clientToken: d.clientToken }, select: { id: true, docNo: true, createdById: true } });
    if (dup) return dup.createdById === userId ? { ok: true, id: dup.id, docNo: dup.docNo } : { error: "Forma kaliti band — sahifani yangilang" };
  }
  const pay = Math.round(d.payAmount ?? 0), revenue = Math.round(d.revenue ?? 0);
  if (pay <= 0 && revenue <= 0) return { error: "Haydovchi haqi yoki kirim summasini kiriting" };
  if (pay > 0 && !d.driverId) return { error: "Haq kimga — haydovchini tanlang" };
  if (pay > 0 && !d.payType) return { error: "To'lov turini tanlang: naqd yoki oylik" };
  if (revenue > 0 && !d.vehicleId) return { error: "Kirim qaysi transportniki — transportni tanlang" };
  const date = d.date ?? new Date();
  if (date.getTime() > Date.now() + 86_400_000) return { error: "Sana kelajakda bo'lmasin" };

  const [driver, vehicle] = await Promise.all([
    d.driverId ? db.employee.findUnique({ where: { id: d.driverId }, select: { id: true, fullName: true, external: true } }) : null,
    d.vehicleId ? db.vehicle.findUnique({ where: { id: d.vehicleId }, select: { id: true, plate: true } }) : null,
  ]);
  if (d.driverId && !driver) return { error: "Haydovchi topilmadi" };
  if (d.vehicleId && !vehicle) return { error: "Transport topilmadi" };
  // Ko'chadan haydovchi shtatda emas — oylik vedomostga kirmaydi
  if (pay > 0 && driver?.external && d.payType === "PAYROLL") return { error: "Ko'chadan haydovchi oylikda yo'q — to'lov turi faqat naqd" };
  if (pay > 0 && d.payType === "PAYROLL" && (await monthLocked(date))) return { error: "Shu oyning ish haqi vedomosti tasdiqlangan — oylikka yozib bo'lmaydi" };

  try {
    const row = await db.$transaction(async (tx) => {
      const e = await tx.logisticsEntry.create({
        data: {
          docNo: await nextNo(tx, "logisticsEntry", ENTRY_PREFIX), date, driverId: driver?.id ?? null, vehicleId: vehicle?.id ?? null,
          trips: Math.round(d.trips ?? 0), km: d.km ?? null,
          payAmount: pay > 0 ? pay : null, payType: pay > 0 ? (d.payType as DriverPayType) : null, revenue: revenue > 0 ? revenue : null,
          note: d.note, clientToken: d.clientToken, createdById: userId,
        },
      });
      await audit(tx, userId, "CREATE", "LogisticsEntry", e.id, undefined, e);
      return e;
    });
    if (pay > 0) notifyAfter(() => notifyRoles(PAY_APPROVER_ROLES, {
      type: "TRIP_PAY_APPROVE", title: `Qo'lda haydovchi haqi: ${row.docNo}`,
      body: `${driver!.fullName}${vehicle ? ` · ${vehicle.plate}` : ""} · ${money(pay)} · ${PAY_TYPE_LABEL[d.payType as DriverPayType].toLowerCase()} — Haydovchilar tabelida tasdiqlang`,
    }, { except: userId }));
    return { ok: true, id: row.id, docNo: row.docNo };
  } catch (e) {
    // Bir vaqtda ikki marta yuborilgan forma — mavjudini qaytaramiz
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && d.clientToken) {
      const dup = await db.logisticsEntry.findUnique({ where: { clientToken: d.clientToken }, select: { id: true, docNo: true } });
      if (dup) return { ok: true, id: dup.id, docNo: dup.docNo };
    }
    throw e;
  }
}

/** Bekor qilishni nima to'sadi: naqdi kassaga o'tgan, yoki oyi vedomostda yopilgan oylik haq. */
async function cancelBlock(e: { date: Date; payType: DriverPayType | null; payApprovedAt: Date | null; payAmount: unknown }): Promise<string | null> {
  if (e.payType === "CASH" && e.payApprovedAt) return "Naqd haq kassaga o'tgan — bekor qilib bo'lmaydi";
  if (e.payType === "PAYROLL" && Number(e.payAmount ?? 0) > 0 && (await monthLocked(e.date))) return "Shu oyning ish haqi vedomosti tasdiqlangan — bekor qilib bo'lmaydi";
  return null;
}

/** Dispetcher xato yozuvni bekor qiladi (sababi bilan). Shartli `updateMany` — ikki bosish bitta natija. */
export async function cancelLogisticsEntry(id: string, reason: string, userId: string): Promise<Result> {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { error: "Bekor qilish sababini yozing (kamida 3 belgi)" };
  const e = await db.logisticsEntry.findUnique({ where: { id } });
  if (!e) return { error: "Yozuv topilmadi" };
  if (e.cancelledAt) return { error: "Yozuv allaqachon bekor qilingan" };
  const block = await cancelBlock(e);
  if (block) return { error: block };
  const now = new Date();
  const ok = await db.$transaction(async (tx) => {
    const u = await tx.logisticsEntry.updateMany({ where: { id, cancelledAt: null, payApprovedAt: e.payApprovedAt }, data: { cancelledAt: now, cancelledById: userId, cancelReason: why } });
    if (u.count !== 1) return false;
    await audit(tx, userId, "STATUS_CHANGE", "LogisticsEntry", id, { cancelledAt: null }, { cancelledAt: now, cancelReason: why });
    return true;
  });
  return ok ? { ok: true, id, docNo: e.docNo } : { error: "Yozuv boshqa joyda o'zgartirildi — sahifani yangilang" };
}

/**
 * Ish boshqaruvchi qo'lda yozilgan haqni tasdiqlaydi: oylik — vedomostga tushadi, naqd — shu tranzaksiyada kassaga
 * tasdiqlangan mexanik so'rovi ochiladi (transport bo'lsa — shu mashinaga, bo'lmasa «Boshqa xarajat»).
 */
export async function approveLogisticsEntries(ids: string[], userId: string): Promise<{ done: number; failed: number }> {
  const rows = await db.logisticsEntry.findMany({
    where: { id: { in: ids.slice(0, 500) }, ...pendingEntryWhere() },
    select: { id: true, docNo: true, date: true, payAmount: true, payType: true, vehicleId: true, note: true, createdById: true, driver: { select: { fullName: true } } },
  });
  const now = new Date();
  let done = 0, cashN = 0, cashSum = 0, payrollN = 0, payrollSum = 0;
  for (const e of rows) {
    const amount = Number(e.payAmount ?? 0);
    if (e.payType === "PAYROLL" && (await monthLocked(e.date))) continue;
    const ok = await db.$transaction(async (tx) => {
      const u = await tx.logisticsEntry.updateMany({ where: { id: e.id, cancelledAt: null, payApprovedAt: null }, data: { payApprovedAt: now, payApprovedById: userId } });
      if (u.count !== 1) return false;
      let mechId: string | null = null;
      if (e.payType === "CASH" && amount > 0) {
        const who = e.driver?.fullName ?? "haydovchi";
        const m = await tx.mechanicRequest.create({
          data: {
            docNo: await nextNo(tx, "mechanicRequest", "MX"), problem: TRIP_PAY_PROBLEM, amount, payee: who,
            ...(e.vehicleId ? { target: "TRANSPORT" as const, vehicleId: e.vehicleId } : { target: "OTHER" as const, object: "Haydovchi haqi (qo'lda yozuv)" }),
            note: `Qo'lda yozuv ${e.docNo} · haydovchi ${who} · naqd haq · ${e.note}`.slice(0, 500),
            status: "APPROVED", decidedById: userId, decidedAt: now, createdById: e.createdById,
          },
        });
        await tx.logisticsEntry.update({ where: { id: e.id }, data: { mechanicRequestId: m.id } });
        await audit(tx, userId, "CREATE", "MechanicRequest", m.id, undefined, m);
        mechId = m.id;
      }
      await audit(tx, userId, "STATUS_CHANGE", "LogisticsEntry", e.id, { payApprovedAt: null }, { payApprovedAt: now, payType: e.payType, payAmount: amount, mechanicRequestId: mechId });
      return true;
    });
    if (!ok) continue;
    done++;
    if (e.payType === "CASH") { cashN++; cashSum += amount; } else { payrollN++; payrollSum += amount; }
  }
  notifyAfter(async () => {
    if (cashN) await notifyRoles(["CASHIER"], { type: "KIRIM_APPROVED", title: `Haydovchiga naqd haq (qo'lda yozuv): ${cashN} ta`, body: `Jami ${money(cashSum)} — ish boshqaruvchi tasdiqladi, Mexanik so'rovlari → «Tasdiqlangan»` }, { except: userId });
    if (payrollN) await notifyRoles(["ACCOUNTING"], { type: "TRIP_PAY_PAYROLL", title: `Oylikka haydovchi haqi (qo'lda yozuv): ${payrollN} ta`, body: `Jami ${money(payrollSum)} — tasdiqlandi, oy yakuni vedomostiga tushadi`, channel: "oddiy" }, { except: userId });
  });
  return { done, failed: ids.length - done };
}

/** Ish boshqaruvchi rad etadi: yozuv sababi bilan bekor bo'ladi, dispetcher kerak bo'lsa qayta yozadi. */
export async function rejectLogisticsEntry(id: string, reason: string, userId: string): Promise<Result> {
  const why = String(reason ?? "").trim().slice(0, 280);
  if (why.length < 3) return { error: "Rad etish sababini yozing" };
  const e = await db.logisticsEntry.findFirst({ where: { id, ...pendingEntryWhere() }, select: { docNo: true, payAmount: true, createdById: true } });
  if (!e) return { error: "Yozuv tasdiq kutayotganlar ichida yo'q — sahifani yangilang" };
  const now = new Date(), text = `Rad etildi: ${why}`;
  const ok = await db.$transaction(async (tx) => {
    const u = await tx.logisticsEntry.updateMany({ where: { id, cancelledAt: null, payApprovedAt: null }, data: { cancelledAt: now, cancelledById: userId, cancelReason: text } });
    if (u.count !== 1) return false;
    await audit(tx, userId, "STATUS_CHANGE", "LogisticsEntry", id, { cancelledAt: null }, { cancelledAt: now, cancelReason: text });
    return true;
  });
  if (!ok) return { error: "Yozuv boshqa joyda o'zgartirildi — sahifani yangilang" };
  notifyAfter(() => notifyUsers([e.createdById === userId ? null : e.createdById], {
    type: "TRIP_PAY_REJECTED", title: `Qo'lda haq rad etildi: ${e.docNo}`, body: `${money(Number(e.payAmount ?? 0))} — sabab: ${why}. Kerak bo'lsa qayta yozing`,
  }));
  return { ok: true, id, docNo: e.docNo };
}

export type EntryRow = {
  id: string; docNo: string; date: Date; driverId: string | null; driver: string | null; vehicleId: string | null; plate: string | null;
  trips: number; km: number | null; pay: number; payType: DriverPayType | null; approvedAt: Date | null; revenue: number; note: string;
  /** Naqd haq kassada qaysi holatda (tasdiqdan keyin) */
  cashStatus: string | null;
  createdBy: string; cancelledAt: Date | null; cancelReason: string | null;
};

/** Yozuvlar ro'yxati (tabel jadvali uchun) — yangisi oldin. */
export async function entryRows(where: Prisma.LogisticsEntryWhereInput, take = 500): Promise<EntryRow[]> {
  const rows = await db.logisticsEntry.findMany({
    where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take,
    select: {
      id: true, docNo: true, date: true, driverId: true, vehicleId: true, trips: true, km: true, payAmount: true, payType: true, payApprovedAt: true,
      revenue: true, note: true, mechanicRequestId: true, cancelledAt: true, cancelReason: true,
      driver: { select: { fullName: true } }, vehicle: { select: { plate: true } }, createdBy: { select: { fullName: true } },
    },
  });
  const mechIds = rows.map((r) => r.mechanicRequestId).filter((x): x is string => !!x);
  const mech = new Map(mechIds.length ? (await db.mechanicRequest.findMany({ where: { id: { in: mechIds } }, select: { id: true, status: true } })).map((m) => [m.id, m.status]) : []);
  return rows.map((r) => ({
    id: r.id, docNo: r.docNo, date: r.date, driverId: r.driverId, driver: r.driver?.fullName ?? null, vehicleId: r.vehicleId, plate: r.vehicle?.plate ?? null,
    trips: r.trips, km: r.km != null ? Number(r.km) : null, pay: Number(r.payAmount ?? 0), payType: r.payType, approvedAt: r.payApprovedAt,
    revenue: Number(r.revenue ?? 0), note: r.note, cashStatus: r.mechanicRequestId ? mech.get(r.mechanicRequestId) ?? null : null,
    createdBy: r.createdBy.fullName, cancelledAt: r.cancelledAt, cancelReason: r.cancelReason,
  }));
}
