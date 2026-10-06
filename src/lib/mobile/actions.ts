import { z } from "zod";
import { splitRef } from "./director";
import { after } from "next/server";
import { db } from "@/lib/db";
import { orderCancel, orderConfirm, orderUnblock } from "@/lib/orders";
import { reportTripIssue, resolveTripIssue, tripArrival, tripArrived, tripCancelled, tripClosed, tripDelivered, tripLoaded, tripOnRoad, tripReturned, tripUnloading } from "@/lib/trips";
import { addFuelLog } from "@/lib/logistics-costs";
import type { TripIssueKind } from "@/generated/prisma";
import { addPayment } from "@/lib/payments";
import { taskCancel, taskProgress } from "@/lib/tasks";
import { clearBrigadeLeader, setBrigadeLeader } from "@/lib/brigades";
import { audit } from "@/lib/audit";
import { deliveryAt, fmtNum, money } from "@/lib/format";
import { createInvoice } from "@/lib/invoices";
import { convertLead, saveLeadNote, setLeadStatus } from "@/lib/leads";
import {
  approveSupplyRequest, editSupplyItems, fundSupplyRequest, priceSupplyRequest, receiveSupplyRequest,
  rejectSupplyRequest, saveSupplyFact, type FactRow,
} from "@/lib/supply";
import {
  addSupplyDocument, addSupplyQuote, chooseSupplyQuote, createSupplyIncident, dataUrlFile, directorApproveSupply,
  resolveSupplyIncident, updateSupplyDelivery, updateSupplyMeta,
} from "@/lib/procurement";
import { pushTripStatus, pushTripToEco } from "@/lib/eco/sync";
import { ecoEnabled } from "@/lib/eco/client";
import type { MobileUser } from "./auth";
import type { AttendanceStatus } from "@/generated/prisma";
import { dayUtc, isAttendanceStatus, today } from "@/lib/davomat";
import { faceCheckEnabled } from "@/lib/ai/face";
import { assignEmployeeBrigade, markAllPresent, markAttendanceByFace, markProductionAttendance, markProductionCheckout } from "@/lib/production-staff";
import { submitReport } from "@/lib/production-report";
import { addProductDefect } from "@/lib/defects";
import { BRIGADE_ISSUE, closeShift, isIssueKind, openShift, reportBrigadeIssue, resolveBrigadeIssue, canResolveIssue, startTask } from "@/lib/brigade-shift";
import { productionStaff } from "@/lib/production-staff";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { TODAY_PREFIX } from "./brigadier";
import { clearDashCache } from "./dashboard";
import { problemAction } from "./problems";
import { assertAtSite, knownPoint } from "./geofence";
import { ACTION_ROLES, NEW_BRIGADE, can } from "./detail";
import { driverEmployeeId, myBrigadeIds, ListError } from "./list";

/**
 * Mobil ilovadagi tugmalarning ijrosi.
 *
 * Qoidalar bu yerda takrorlanmaydi — `lib/orders.ts`, `lib/trips.ts`, `lib/payments.ts`
 * chaqiriladi, ya'ni veb ERP'dagi tugma bilan bir xil natija beradi (audit ham yoziladi).
 * Bu yerda faqat: ruxsat, kirish ma'lumotini tekshirish va ECO'ga xabar berish.
 */
export type ActionResult = { ok: true; message: string; receipt?: Receipt };

/**
 * Muhim amal (masalan zayavka qabul qilinishi) natijasining "chek"i — ilova uni oddiy
 * "Bajarildi" oynasi o'rniga katta modalda ko'rsatadi: bosh summa, holat, asosiy qatorlar.
 * Matnlar serverda tayyorlanadi, ilova faqat chizadi (yangi maydon — ilovani yangilamasdan).
 */
export type Receipt = {
  headline: string;
  caption?: string;
  status: { label: string; tone: "success" | "warning"; at: string };
  rows: { label: string; value: string; copy?: boolean }[];
};

const Receiver = z.object({ receiverName: z.string().trim().min(2, "Qabul qilgan kishini yozing"), note: z.string().trim().optional() });
const Progress = z.object({
  qty: z.coerce.number({ message: "Raqam kiriting" }).positive("Miqdor 0 dan katta bo'lsin"),
  note: z.string().trim().optional(),
});
const Pay = z.object({
  amount: z.coerce.number({ message: "Raqam kiriting" }).positive("Summa 0 dan katta bo'lsin"),
  cashAccountId: z.string().trim().min(1, "Kassa/hisob tanlanmagan"),
  note: z.string().trim().optional(),
});

const Leader = z.object({
  brigadeId: z.string().trim().min(1, "Brigada tanlanmagan"),
  newName: z.string().trim().optional(),
  newPhone: z.string().trim().optional(),
  newNote: z.string().trim().optional(),
});

const fail = (m: string, status = 400) => { throw new ListError("ACTION_FAILED", m, status); };

// Forma maydonlari ilovadan satr bo'lib keladi ("12 500", "12,5") — vebdagi `num()` bilan bir xil o'qiladi
const textOf = (p: Record<string, unknown>, key: string) => String(p[key] ?? "").trim();
const numOf = (p: Record<string, unknown>, key: string) => {
  const n = Number(textOf(p, key).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
/** Bo'sh maydon — "berilmagan" (null), 0 emas: qabul miqdori bo'sh bo'lsa hammasi qabul qilingan. */
const optNum = (p: Record<string, unknown>, key: string) => (textOf(p, key) === "" ? null : numOf(p, key));
/** `prefix_<itemId>` maydonlaridan qator id'lari — ta'minot jadvali uchun. */
const itemIds = (p: Record<string, unknown>, prefix: string) =>
  Object.keys(p).filter((k) => k.startsWith(`${prefix}_`)).map((k) => k.slice(prefix.length + 1));
const factRows = (p: Record<string, unknown>): FactRow[] =>
  itemIds(p, "factQty").map((itemId) => ({ itemId, factQty: numOf(p, `factQty_${itemId}`), factPrice: numOf(p, `factPrice_${itemId}`) }));

/**
 * Haydovchi faqat O'ZIGA biriktirilgan reysni harakatlantiradi.
 *
 * `can()` faqat rolni tekshiradi — "haydovchilar reys bosqichini belgilay oladi" deydi,
 * "qaysi reysni" demaydi. Amal id bo'yicha chaqirilgani uchun, bu tekshiruvsiz
 * begona nakladnoyning raqamini yuborib, boshqa haydovchining reysini yopib qo'yish mumkin edi.
 */
async function assertOwnTrip(user: MobileUser, tripId: string) {
  if (user.role !== "DRIVER") return;
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { driverId: true } });
  if (!t || t.driverId !== (await driverEmployeeId(user.id))) fail("Bu reys sizga biriktirilmagan", 403);
}

/**
 * Haydovchi bosqichni GPS'siz belgiladi — reysga ochiq muammo yoziladi. Dispetcher uni hal
 * qilmaguncha reys yopilmaydi (`tripClosed` qoidasi), ya'ni tekshiruv dispetcherda qoladi.
 */
async function gpsIssue(tripId: string, userId: string, step: string) {
  await reportTripIssue(tripId, userId, { kind: "OTHER", note: `"${step}" GPS'siz belgilandi — joylashuv aniqlanmagan, tekshiring`, source: "DRIVER" }).catch(() => undefined);
}

/** Brigadir faqat O'Z brigadasiga tayinlangan topshiriqni qayd qiladi — reysdagi qoidaning aynan o'zi. */
async function assertOwnTask(user: MobileUser, taskId: string) {
  if (user.role !== "BRIGADIER") return;
  const t = await db.brigadeTask.findUnique({ where: { id: taskId }, select: { brigadeId: true } });
  if (!t || !(await myBrigadeIds(user.id)).includes(t.brigadeId)) fail("Bu topshiriq sizning brigadangizga tayinlanmagan", 403);
}

/** Brigadir davomatni faqat O'Z brigadasi a'zosiga belgilaydi (sex boshlig'i — hammaga). */
async function assertOwnMember(user: MobileUser, employeeId: string) {
  if (user.role !== "BRIGADIER") return;
  const m = (await productionStaff()).members.find((x) => x.id === employeeId);
  if (!m?.brigadeId || !(await myBrigadeIds(user.id)).includes(m.brigadeId)) fail("Bu xodim sizning brigadangizda emas", 403);
}

/**
 * Smena/muammo amallari ikki kartadan chaqiriladi: smena kartasi (id — `b~<brigadeId>`) va
 * topshiriq kartasi (id — topshiriq). Brigada va topshiriq shu yerda aniqlanadi, egalik tekshiriladi.
 */
async function brigadeOf(user: MobileUser, id: string): Promise<{ brigadeId: string; taskId: string | null }> {
  let brigadeId: string, taskId: string | null = null;
  if (id.startsWith(TODAY_PREFIX)) brigadeId = id.slice(TODAY_PREFIX.length);
  else {
    const t = await db.brigadeTask.findUnique({ where: { id }, select: { brigadeId: true } });
    if (!t) return fail("Topshiriq topilmadi", 404) as never;
    brigadeId = t.brigadeId; taskId = id;
  }
  if (user.role === "BRIGADIER" && !(await myBrigadeIds(user.id)).includes(brigadeId)) fail("Bu brigada sizga biriktirilmagan", 403);
  return { brigadeId, taskId };
}

/**
 * Fakt kiritish / yakunlash formasidagi ixtiyoriy "shundan brak" — bajarilgan miqdor yozilgach
 * brak shu topshiriqqa bog'lanib qayd qilinadi. Brak yozilmasa ham fakt saqlangan bo'ladi:
 * xato matni xabarga qo'shiladi (brigadir kartadagi "Brakni qayd qilish" bilan qayta yozadi).
 */
async function defectWithProgress(user: MobileUser, taskId: string, payload: Record<string, unknown>): Promise<string | null> {
  const qty = optNum(payload, "defectQty");
  if (!qty || qty <= 0) return null;
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId }, select: { brigadeId: true, orderItem: { select: { productId: true } } } });
  const r = await addProductDefect({
    productId: t.orderItem.productId, qty, reason: textOf(payload, "defectReason") || "Boshqa", brigadeId: t.brigadeId, taskId,
    note: textOf(payload, "defectNote") || null,
  }, user.id);
  if ("error" in r) return `Brak yozilmadi: ${r.error}`;
  notifyAfter(() => notifyRoles(["PRODUCTION", "SUPERVISOR"], { type: "DEFECT", title: "Brak qayd qilindi", body: r.text, channel: "oddiy" }, { except: user.id }));
  return `brak ${r.text}`;
}

export async function runMobileAction(user: MobileUser, action: string, rawId: string, payload: Record<string, unknown> = {}): Promise<ActionResult> {
  if (!rawId) fail("id yo'q");
  // Aralash ro'yxatdan ochilgan kartochka (`orders:<id>`) — amal haqiqiy id bilan bajariladi
  const id = splitRef(rawId)[1];
  // `in` prototipni ham ko'radi ("constructor", "toString" → 500) — faqat o'z kalitlari
  if (typeof action !== "string" || !Object.hasOwn(ACTION_ROLES, action)) fail("Bunday amal yo'q", 404); // noma'lum amal — ruxsat xatosi bilan chalkashmasin
  if (!can(user, action)) fail("Bu amalga ruxsatingiz yo'q", 403);
  if (action.startsWith("trip.")) await assertOwnTrip(user, id);
  if (action.startsWith("task.")) await assertOwnTask(user, id);
  if (["att.present", "att.face", "att.absent", "att.status", "att.checkout"].includes(action)) await assertOwnMember(user, id);

  switch (action) {
    // ── Egasi qarori (direktor "Muammolar") — id: masala kaliti ──
    case "problem.assign":
    case "problem.note":
      return { ok: true, message: await problemAction(user, action, id, payload) };

    // ── Zayavka ──
    case "order.confirm": {
      const r = await orderConfirm(id, user.id);
      if (r.error) fail(r.error);
      const blocked = r.status === "BLOCKED";
      return {
        ok: true,
        message: blocked ? "Limit oshgan — zayavka bloklandi, direktor ochadi" : "Zayavka qabul qilindi",
        receipt: await orderReceipt(id, blocked),
      };
    }
    case "order.unblock": {
      const r = await orderUnblock(id, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Blok ochildi" };
    }
    case "order.cancel": {
      const r = await orderCancel(id, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Zayavka bekor qilindi" };
    }

    // ── Reys ── (holat ECO'ga ham uzatiladi — haydovchi ilovasida bir xil ko'rinadi)
    case "trip.loaded": {
      const r = await tripLoaded(id, user.id);
      if (r.error) fail(r.error);
      if (!r.changed) fail("Holat mos emas");
      if (ecoEnabled()) after(() => pushTripStatus(id, "LOADING"));
      return { ok: true, message: "Yuklandi — skladdan chiqim yozildi" };
    }
    case "trip.onroad": {
      const r = await tripOnRoad(id, user.id);
      if (!r.changed) fail(r.error ?? "Holat mos emas");
      if (ecoEnabled()) after(() => pushTripStatus(id, "EN_ROUTE"));
      return { ok: true, message: "Reys yo'lga chiqdi" };
    }
    case "trip.delivered": {
      const p = Receiver.safeParse(payload);
      if (!p.success) fail(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      // Haydovchi reysni faqat obyektda yopadi. Tugma ilovada ham yopiq turadi, lekin
      // qoida shu yerda ham tekshiriladi: so'rov ilovadan tashqari ham yuborilishi mumkin.
      // GPS umuman yo'q bo'lsa (`unknown`) — belgilashga ruxsat, lekin reysga muammo yoziladi:
      // bosqichni haydovchidan boshqa hech kim belgilamaydi, dispetcher esa tekshirib yopadi.
      const gps = await tripArrival(id);
      // Hozirgi joylashuv (payload `lat/lng`) obyektdan 300 m ichida bo'lsin — ECO bilan bir xil qoida (`./geofence.ts`)
      assertAtSite(payload, knownPoint(gps.destination?.lat, gps.destination?.lng), "Yetkazdim");
      if (!gps.near && !gps.unknown) fail(gps.reason ?? "Obyektga yetib borilmagan");
      const q = { acceptedQty: optNum(payload, "acceptedQty"), returnedQty: optNum(payload, "returnedQty"), comment: p.data!.note || null };
      const r = await tripDelivered(id, user.id, p.data!.receiverName, p.data!.note, q);
      if (r.error) fail(r.error);
      if (!r.changed) fail("Holat mos emas");
      if (gps.unknown) await gpsIssue(id, user.id, "Yetkazdim");
      if (ecoEnabled()) after(() => pushTripStatus(id, "COMPLETED", { note: `Qabul qildi: ${p.data!.receiverName}`, acceptedM3: q.acceptedQty ?? undefined }));
      return { ok: true, message: gps.unknown ? "Yetkazildi deb belgilandi — GPS bo'lmagani dispetcherga muammo sifatida yuborildi" : "Yetkazildi deb belgilandi" };
    }
    // Marshrut ekrani — ilova ichidagi ish. Yangi ilova buni serverga umuman yubormaydi
    // (`local: true`), lekin eski ilova yuboradi: holat o'zgarmaydi, xato ham chiqmaydi.
    case "trip.route":
      return { ok: true, message: "Marshrut" };
    case "trip.cancel": {
      const r = await tripCancelled(id, user.id);
      if (r.error) fail(r.error);
      if (ecoEnabled()) after(() => pushTripStatus(id, "CANCELLED"));
      return { ok: true, message: "Reys bekor qilindi" };
    }
    // ── Logistika TZ: obyekt bosqichlari, muammo, yoqilg'i, yopish ──
    case "trip.arrived": {
      const gps = await tripArrival(id);
      assertAtSite(payload, knownPoint(gps.destination?.lat, gps.destination?.lng), "Yetib keldim");
      if (!gps.near && !gps.unknown) fail(gps.reason ?? "Obyektga yetib borilmagan");
      const r = await tripArrived(id, user.id, gps.unknown ? "Haydovchi ilovasi (GPS'siz)" : "Haydovchi ilovasi");
      if (r.error) fail(r.error);
      if (r.changed && gps.unknown) await gpsIssue(id, user.id, "Yetib keldim");
      if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "ARRIVED"));
      return { ok: true, message: "Obyektga yetib keldi" };
    }
    case "trip.unloading": {
      // "Yetib keldim" bosilmagan bo'lsa tushirish uni ham belgilaydi — 1 km qoidasi shu yerda ham
      const cur = await db.trip.findUnique({ where: { id }, select: { arrivedAt: true } });
      // "Tushirishni boshladim" ham obyektda bosiladi (ECO'da UNLOADING ham tekshiriladi)
      const site = await tripArrival(id);
      assertAtSite(payload, knownPoint(site.destination?.lat, site.destination?.lng), "Tushirishni boshladim");
      if (cur && !cur.arrivedAt) {
        const gps = site;
        if (!gps.near && !gps.unknown) fail(gps.reason ?? "Obyektga yetib borilmagan");
        const a = await tripArrived(id, user.id, gps.unknown ? "Haydovchi ilovasi (GPS'siz)" : "Haydovchi ilovasi");
        if (a.error) fail(a.error);
        if (a.changed && gps.unknown) await gpsIssue(id, user.id, "Yetib keldim");
        if (a.changed && ecoEnabled()) after(() => pushTripStatus(id, "ARRIVED"));
      }
      const r = await tripUnloading(id, user.id);
      if (r.error) fail(r.error);
      if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "UNLOADING"));
      return { ok: true, message: "Tushirish boshlandi" };
    }
    case "trip.returned": {
      const r = await tripReturned(id, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Zavodga qaytdi — mashina bo'sh" };
    }
    case "trip.problem": {
      const kind = textOf(payload, "kind") as TripIssueKind;
      if (!["BREAKDOWN", "TRAFFIC", "SITE_NOT_READY", "QUALITY", "ACCIDENT", "OTHER"].includes(kind)) fail("Muammo turini tanlang");
      await reportTripIssue(id, user.id, { kind, note: textOf(payload, "note"), source: user.role === "DRIVER" ? "DRIVER" : "LOGISTICS" }).catch((e) => fail((e as Error).message));
      return { ok: true, message: "Muammo dispetcherga yuborildi" };
    }
    case "trip.resolve": {
      const resolution = textOf(payload, "resolution");
      if (!resolution) fail("Qanday hal qilinganini yozing");
      const open = await db.tripIssue.findMany({ where: { tripId: id, resolvedAt: null }, select: { id: true } });
      for (const i of open) await resolveTripIssue(i.id, user.id, resolution);
      return { ok: true, message: `${open.length} ta muammo yopildi` };
    }
    case "trip.fuel": {
      const t = await db.trip.findUnique({ where: { id }, select: { vehicleId: true, driverId: true } });
      if (!t) return fail("Reys topilmadi", 404) as never;
      try {
        await addFuelLog({
          vehicleId: t.vehicleId, driverId: t.driverId, tripId: id,
          liters: numOf(payload, "liters"), pricePerL: numOf(payload, "pricePerL"),
          odometerKm: optNum(payload, "odometerKm") != null ? Math.round(optNum(payload, "odometerKm")!) : null, station: textOf(payload, "station"),
        }, user.id);
      } catch (e) { fail((e as Error).message); }
      return { ok: true, message: "Zapravka yozildi" };
    }
    case "trip.close": {
      const r = await tripClosed(id, user.id, { acceptedQty: optNum(payload, "acceptedQty"), returnedQty: optNum(payload, "returnedQty"), comment: textOf(payload, "note") || null });
      if (r.error) fail(r.error);
      return { ok: true, message: r.warning ? `Reys yopildi. ${r.warning}` : "Reys yopildi" };
    }
    case "trip.eco": {
      if (!ecoEnabled()) fail("ECO ulanmagan");
      const r = await pushTripToEco(id);
      if (!r.ok) fail(r.error ?? "ECO'ga yuborib bo'lmadi", 502);
      return { ok: true, message: r.error ?? "Haydovchi ilovasiga yuborildi" };
    }

    // ── Brigada topshirig'i ──
    case "task.progress": {
      const p = Progress.safeParse(payload);
      if (!p.success) fail(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const r = await taskProgress(id, p.data!.qty, user.id, p.data!.note);
      if (r.error) fail(r.error);
      clearDashCache();
      // `note` — hovliga nechta kirim bo'lgani, zayavka yopilgani, xomashyo yetmagani
      const base = r.status === "DONE" ? "Qayd qilindi — topshiriq bajarildi" : "Qayd qilindi";
      const def = await defectWithProgress(user, id, payload);
      return { ok: true, message: [r.note ? `${base}. ${r.note}` : base, def].filter(Boolean).join(" · ") };
    }
    case "task.start": {
      // Smena ochilmagan bo'lsa — ish boshlanishi smenani ham ochadi (brigadir unutib qo'ymasin)
      const { brigadeId } = await brigadeOf(user, id);
      const sh = user.role === "BRIGADIER" ? await openShift(brigadeId, user.id) : null;
      const r = await startTask(id, user.id);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return { ok: true, message: sh && "created" in sh && sh.created ? "Ish boshlandi — bugungi smena ham ochildi" : "Ish boshlandi" };
    }
    case "task.finish": {
      const t = await db.brigadeTask.findUniqueOrThrow({ where: { id }, select: { qty: true, doneQty: true } });
      const left = Number(t.qty) - Number(t.doneQty);
      if (left <= 0) fail("Qoldiq yo'q — topshiriq bajarilgan");
      const r = await taskProgress(id, left, user.id, textOf(payload, "note") || "Yakunlandi");
      if (r.error) fail(r.error);
      clearDashCache();
      const def = await defectWithProgress(user, id, payload);
      return { ok: true, message: [r.note ? `Topshiriq yakunlandi. ${r.note}` : "Topshiriq yakunlandi", def].filter(Boolean).join(" · ") };
    }
    case "task.defect":
    case "shift.defect": {
      const { brigadeId, taskId } = await brigadeOf(user, id);
      // Smena bo'yicha brak (topshiriqsiz): brigadir faqat o'z brigadasi ishlayotgan mahsulotni yozadi —
      // hovlidagi istalgan mahsulotni (masalan, betonni) hisobdan chiqarib bo'lmasin
      if (!taskId && user.role === "BRIGADIER") {
        const own = await db.brigadeTask.count({
          where: { brigadeId, status: { in: ["NEW", "IN_PROGRESS", "DONE"] }, orderItem: { productId: textOf(payload, "productId") } },
        });
        if (!own) fail("Bu mahsulot brigadangiz topshiriqlarida yo'q");
      }
      const r = await addProductDefect({ productId: textOf(payload, "productId"), qty: numOf(payload, "qty"), reason: textOf(payload, "reason"), brigadeId, taskId, note: textOf(payload, "note") || null }, user.id);
      if ("error" in r) fail(r.error);
      const text = (r as { text: string }).text;
      // Sifat — ishlab chiqarishning nazorati: brigadir yozgan brak ularga ham ko'rinsin
      notifyAfter(() => notifyRoles(["PRODUCTION", "SUPERVISOR"], { type: "DEFECT", title: "Brak qayd qilindi", body: text, channel: "oddiy" }, { except: user.id }));
      clearDashCache();
      return { ok: true, message: `Brak qayd qilindi — ${text}` };
    }

    // ── Brigadir smenasi va muammolari — qoida `lib/brigade-shift.ts` da ──
    case "shift.open": {
      const { brigadeId } = await brigadeOf(user, id);
      const r = await openShift(brigadeId, user.id);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return { ok: true, message: (r as { created: boolean }).created ? "Smena boshlandi — brigada tarkibini belgilang" : "Smena allaqachon ochiq" };
    }
    case "shift.close": {
      const { brigadeId } = await brigadeOf(user, id);
      const r = await closeShift(brigadeId, user.id, textOf(payload, "note") || null);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return { ok: true, message: `Smena yopildi, hisobot ishlab chiqarishga yuborildi. ${(r as { summary: string }).summary}` };
    }
    case "issue.equipment":
    case "issue.material":
    case "issue.staff":
    case "issue.other": {
      const { brigadeId, taskId } = await brigadeOf(user, id);
      const kind = action === "issue.other" ? textOf(payload, "kind") : action.slice(6).toUpperCase();
      if (!isIssueKind(kind)) fail("Muammo turini tanlang");
      const r = await reportBrigadeIssue({
        brigadeId, taskId: taskId ?? (textOf(payload, "taskId") || null), kind: kind as never,
        equipment: textOf(payload, "equipment") || null, qty: optNum(payload, "qty"),
        downtimeMin: optNum(payload, "downtimeMin") != null ? Math.round(optNum(payload, "downtimeMin")!) : null, note: textOf(payload, "note"),
      }, user.id);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return { ok: true, message: (r as { text: string }).text };
    }
    case "issue.resolve": {
      const i = await db.brigadeIssue.findUnique({ where: { id }, select: { kind: true, brigadeId: true } });
      if (!i) fail("Muammo topilmadi", 404);
      if (!canResolveIssue(user.role, i!.kind) && user.role !== "DIRECTOR") fail("Bu muammo sizning bo'limingizga tegishli emas", 403);
      if (user.role === "BRIGADIER" && !(await myBrigadeIds(user.id)).includes(i!.brigadeId)) fail("Bu brigada sizga biriktirilmagan", 403);
      const dm = optNum(payload, "downtimeMin");
      const r = await resolveBrigadeIssue(id, user.id, textOf(payload, "resolution"), dm != null ? Math.max(0, Math.round(dm)) : null);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return { ok: true, message: "Muammo hal qilindi" };
    }
    case "issue.remind": {
      const i = await db.brigadeIssue.findUnique({ where: { id }, select: { kind: true, note: true, resolvedAt: true, brigade: { select: { name: true } } } });
      if (!i) return fail("Muammo topilmadi", 404) as never;
      if (i.resolvedAt) fail("Muammo allaqachon hal qilingan");
      const note = textOf(payload, "note").slice(0, 500);
      if (!note) fail("Xabar matnini yozing");
      const owners = BRIGADE_ISSUE[i.kind].owner;
      await audit(db, user.id, "UPDATE", "BrigadeIssue", id, undefined, { remind: owners, note });
      notifyAfter(() => notifyRoles(owners, { type: "BRIGADE_ISSUE", title: `Direktor: ${BRIGADE_ISSUE[i.kind].label} — ${i.brigade.name}`, body: `${note} · ${i.note}`.slice(0, 300), link: { key: "brig-issue", id } }));
      return { ok: true, message: "Mas'ul bo'limga eslatma yuborildi" };
    }
    case "task.cancel": {
      const r = await taskCancel(id, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Topshiriq bekor qilindi" };
    }

    // ── Brigadir (Xodimlar kartochkasi) ──
    case "employee.brigade": {
      const p = Leader.safeParse(payload);
      if (!p.success) fail(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const isNew = p.data!.brigadeId === NEW_BRIGADE;
      if (isNew && !p.data!.newName) fail("Yangi brigada nomini yozing");
      const r = await setBrigadeLeader({
        employeeId: id,
        brigadeId: isNew ? undefined : p.data!.brigadeId,
        newBrigade: isNew ? { name: p.data!.newName!, phone: p.data!.newPhone, note: p.data!.newNote } : undefined,
      }, user.id);
      if (r.error) fail(r.error);
      const extra = [
        r.created ? "brigada ochildi" : null,
        r.replaced ? `eski brigadir ${r.replaced} olindi` : null,
        r.freed ? `${r.freed} brigadirsiz qoldi` : null,
      ].filter(Boolean).join(", ");
      return { ok: true, message: `${r.brigadeName} brigadiri qilib biriktirildi${extra ? ` — ${extra}` : ""}` };
    }
    case "employee.brigade.clear": {
      const r = await clearBrigadeLeader(id, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: `Brigadirlikdan olindi — ${r.freed} brigadirsiz qoldi` };
    }

    // ── Ta'minot zanjiri — qoida `lib/supply.ts` da, veb bilan bir xil ──
    case "supply.items": {
      const rows = itemIds(payload, "qty").map((itemId) => ({ itemId, qty: numOf(payload, `qty_${itemId}`), note: null }));
      const r = await editSupplyItems(id, rows, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Jadval saqlandi" };
    }
    case "supply.price": {
      const rows = itemIds(payload, "price").map((itemId) => ({ itemId, price: numOf(payload, `price_${itemId}`), qty: numOf(payload, `qty_${itemId}`) }));
      const r = await priceSupplyRequest(id, {
        supplierId: textOf(payload, "supplierId") || null, note: textOf(payload, "note") || null, rows,
        delivery: { kind: textOf(payload, "deliveryKind") || null, provider: textOf(payload, "deliveryProvider") || null, cost: numOf(payload, "deliveryCost"), note: textOf(payload, "deliveryNote") || null },
      }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: `Tasdiqlashga yuborildi${r.note ? ` — ${r.note}` : ""}` };
    }
    case "supply.approve": {
      const r = await approveSupplyRequest(id, user.id, textOf(payload, "note") || null);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Tasdiqlandi — Moliya bo'limiga yuborildi" };
    }
    case "supply.fund": {
      const r = await fundSupplyRequest(id, { cashAccountId: textOf(payload, "cashAccountId"), note: textOf(payload, "note") || null }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Pul ajratildi — snabjeniye sotib olishi mumkin" };
    }
    case "supply.fact": {
      const r = await saveSupplyFact(id, factRows(payload), user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Tuzatishlar saqlandi" };
    }
    case "supply.receive": {
      const r = await receiveSupplyRequest(id, {
        supplierId: textOf(payload, "supplierId") || null, rows: factRows(payload), note: textOf(payload, "note") || null,
        deliveryFactCost: "deliveryFactCost" in payload ? numOf(payload, "deliveryFactCost") : null,
      }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Qabul qilindi — skladga kirim yozildi" };
    }
    case "supply.reject": {
      const r = await rejectSupplyRequest(id, { id: user.id, role: user.role }, textOf(payload, "reason"));
      if (r.error) fail(r.error);
      return { ok: true, message: "Ta'minot zayavkasi bekor qilindi" };
    }
    // ── Snabjeniye TZ: rekvizitlar, takliflar, direktor, yetkazish, muammo, hujjat — qoida `lib/procurement.ts` da ──
    case "supply.meta": {
      const r = await updateSupplyMeta(id, {
        department: textOf(payload, "department") || null, priority: textOf(payload, "priority") || null,
        responsibleId: textOf(payload, "responsibleId") || null, needBy: textOf(payload, "needBy") || null, contractNo: textOf(payload, "contractNo") || null,
      }, user.id);
      if (r.error) fail(r.error);
      clearDashCache();
      return { ok: true, message: r.note ?? "Saqlandi" };
    }
    case "supply.quote": {
      const r = await addSupplyQuote(id, {
        supplierId: textOf(payload, "supplierId") || null, supplierName: textOf(payload, "supplierName") || null, amount: numOf(payload, "amount"),
        deliveryDays: textOf(payload, "deliveryDays") ? numOf(payload, "deliveryDays") : null, paymentTerms: textOf(payload, "paymentTerms") || null,
        validUntil: textOf(payload, "validUntil") || null, note: textOf(payload, "note") || null,
      }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Taklif qo'shildi" };
    }
    case "supply.quote.choose": {
      const quoteId = textOf(payload, "quoteId");
      const q = await db.supplyQuote.findUnique({ where: { id: quoteId }, select: { requestId: true } });
      if (!q || q.requestId !== id) fail("Taklifni tanlang");
      const r = await chooseSupplyQuote(quoteId, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Taklif tanlandi" };
    }
    case "supply.director": {
      const r = await directorApproveSupply(id, user.id, textOf(payload, "note") || null);
      if (r.error) fail(r.error);
      clearDashCache();
      return { ok: true, message: r.note ?? "Tasdiqlandi" };
    }
    case "supply.delivery": {
      const r = await updateSupplyDelivery(id, {
        status: textOf(payload, "deliveryStatus"), shippedAt: textOf(payload, "shippedAt") || null, eta: textOf(payload, "eta") || null,
        provider: textOf(payload, "deliveryProvider") || null, note: textOf(payload, "note") || null,
      }, user.id);
      if (r.error) fail(r.error);
      clearDashCache();
      return { ok: true, message: r.note ?? "Holat yangilandi" };
    }
    case "supply.incident": {
      const r = await createSupplyIncident(id, { kind: textOf(payload, "kind"), note: textOf(payload, "note") }, user.id);
      if (r.error) fail(r.error);
      clearDashCache();
      return { ok: true, message: r.note ?? "Muammo qayd qilindi" };
    }
    case "supply.incident.resolve": {
      const incidentId = textOf(payload, "incidentId");
      const inc = await db.supplyIncident.findUnique({ where: { id: incidentId }, select: { requestId: true } });
      if (!inc || inc.requestId !== id) fail("Muammoni tanlang");
      const r = await resolveSupplyIncident(incidentId, textOf(payload, "resolution"), user.id);
      if (r.error) fail(r.error);
      clearDashCache();
      return { ok: true, message: r.note ?? "Muammo yopildi" };
    }
    case "supply.doc": {
      // Ilova rasmni data-URL qilib yuboradi (kamera / galereya) — `photo` maydoni
      const file = dataUrlFile(textOf(payload, "photo"), textOf(payload, "kind") || "hujjat");
      if (!file) fail("Hujjat suratini oling yoki tanlang");
      const r = await addSupplyDocument(id, textOf(payload, "kind"), file, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Hujjat biriktirildi" };
    }

    // ── Sayt arizalari — qoida `lib/leads.ts` da ──
    case "lead.progress":
    case "lead.reopen":
    case "lead.reject": {
      const status = action === "lead.progress" ? "IN_PROGRESS" : action === "lead.reject" ? "REJECTED" : "NEW";
      const r = await setLeadStatus(id, status, user.id);
      if (!r.ok) fail(r.error);
      return { ok: true, message: status === "IN_PROGRESS" ? "Bog'lanildi deb belgilandi" : status === "REJECTED" ? "Ariza bekor qilindi" : "Ariza yana yangi holatda" };
    }
    case "lead.convert": {
      const r = await convertLead(id, { name: textOf(payload, "name"), inn: textOf(payload, "inn") || null }, user.id);
      if (!r.ok) throw new ListError("ACTION_FAILED", r.error, 400);
      return { ok: true, message: r.note ?? "Mijoz yaratildi" };
    }
    case "lead.note": {
      const r = await saveLeadNote(id, textOf(payload, "note") || null);
      if (!r.ok) fail(r.error);
      return { ok: true, message: "Izoh saqlandi" };
    }

    // ── Spravochniklar: yopish/ochish (veb sahifadagi tugma bilan bir xil) ──
    case "brigade.toggle": {
      const b = await db.brigade.findUnique({ where: { id } });
      if (!b) fail("Brigada topilmadi", 404);
      await db.$transaction(async (tx) => {
        await tx.brigade.update({ where: { id }, data: { isActive: !b!.isActive } });
        await audit(tx, user.id, "UPDATE", "Brigade", id, { isActive: b!.isActive }, { isActive: !b!.isActive });
      });
      return { ok: true, message: b!.isActive ? "Brigada yopildi" : "Brigada qayta ochildi" };
    }
    case "supplier.toggle": {
      const cur = await db.supplier.findUnique({ where: { id } });
      if (!cur) fail("Yetkazuvchi topilmadi", 404);
      await db.supplier.update({ where: { id }, data: { isActive: !cur!.isActive } });
      await audit(db, user.id, "UPDATE", "Supplier", id, { isActive: cur!.isActive }, { isActive: !cur!.isActive });
      return { ok: true, message: cur!.isActive ? "Yetkazuvchi yopildi" : "Yetkazuvchi qayta ochildi" };
    }

    // ── Schyot yozish — qoida `lib/invoices.ts` da ──
    case "order.invoice": {
      const date = textOf(payload, "date");
      const r = await createInvoice({ orderId: id, amount: numOf(payload, "amount"), date: date ? new Date(`${date}T00:00:00`) : new Date() }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.status === "PAID" ? `${r.invoiceNo} yozildi — avans bilan to'liq yopildi` : r.status === "PARTIAL" ? `${r.invoiceNo} yozildi — avans bog'landi` : `${r.invoiceNo} yozildi` };
    }

    // ── Schyot ──
    case "invoice.pay": {
      const p = Pay.safeParse(payload);
      if (!p.success) fail(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const inv = await db.invoice.findUnique({ where: { id }, include: { payments: true } });
      if (!inv) fail("Schyot topilmadi", 404);
      if (!["OPEN", "PARTIAL"].includes(inv!.status)) fail("Bu schyot yopilgan");
      const paid = inv!.payments.reduce((s, x) => s + Number(x.amount), 0);
      const left = Number(inv!.amount) - paid;
      if (p.data!.amount > left + 0.005) fail(`Qoldiqdan ko'p: ${Math.round(left).toLocaleString("ru-RU")} so'm`);
      const account = await db.cashAccount.findFirst({ where: { id: p.data!.cashAccountId, isActive: true } });
      if (!account) fail("Kassa/hisob topilmadi");
      const r = await addPayment({ customerId: inv!.customerId, invoiceId: inv!.id, cashAccountId: account!.id, amount: p.data!.amount, date: new Date(), note: p.data!.note }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.invoiceStatus === "PAID" ? "To'lov qabul qilindi — schyot yopildi" : "To'lov qabul qilindi" };
    }

    // ── Sex: davomat, kunlik hisobot, taqsimlash — qoidalar `lib/production-staff.ts` / `production-report.ts` da ──
    case "att.present":
    case "att.absent":
    case "att.status":
    case "att.form": {
      const employeeId = action === "att.form" ? textOf(payload, "employeeId") : id;
      const status = action === "att.present" ? "PRESENT" : action === "att.absent" ? "ABSENT" : textOf(payload, "status");
      if (!employeeId) fail("Xodim tanlanmagan");
      if (!isAttendanceStatus(status)) fail("Holatni tanlang");
      // Brigadir: yuz tekshiruvi yoqiq bo'lsa "Keldi" faqat `att.face` orqali (kamerasiz belgilab yuborilmasin);
      // kelgan/ketgan vaqtni esa faqat sex boshlig'i (PRODUCTION/SUPERVISOR) tuzatadi
      const brig = user.role === "BRIGADIER";
      if (brig && status === "PRESENT" && faceCheckEnabled()) {
        const cur = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: employeeId!, date: dayUtc(today()) } }, select: { status: true } });
        if (cur?.status !== "PRESENT") fail("Yuz tekshiruvi yoqilgan — \"Keldi\" ni faqat yuz bilan tasdiqlang", 403);
      }
      const withForm = (action === "att.status" || action === "att.form") && !brig;
      const r = await markProductionAttendance(user.id, employeeId, {
        status: status as AttendanceStatus,
        checkIn: withForm ? textOf(payload, "checkIn") || null : undefined,
        checkOut: withForm ? textOf(payload, "checkOut") || null : undefined,
        ...(brig && action === "att.status" ? { note: textOf(payload, "note") || null } : {}),
        note: withForm ? textOf(payload, "note") || null : undefined,
      });
      if ("error" in r) fail(r.error!);
      clearDashCache();
      return { ok: true, message: (r as { text: string }).text };
    }
    case "att.face": {
      // Ilova ichidagi yuz skaneri kadri (data-URL); solishtirish va qoida — `lib/production-staff.ts`.
      // Kadrsiz (telefon Face ID'si bilan, 1.0.3 sinov build'i) endi qabul qilinmaydi
      const photo = dataUrlFile(textOf(payload, "photo"), "yuz");
      if (!photo) fail(payload?.biometric === true ? "Ilovani yangilang — \"Keldi\" endi yuz skaneri bilan belgilanadi" : "Xodimning yuzini skaner qiling");
      const r = await markAttendanceByFace(user.id, id, photo!);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return { ok: true, message: (r as { text: string }).text };
    }
    case "att.checkout": {
      const r = await markProductionCheckout(user.id, id);
      if ("error" in r) fail(r.error!);
      clearDashCache();
      return { ok: true, message: (r as { text: string }).text };
    }
    case "att.all": {
      // Brigadir — faqat o'z brigadasi (smena kartasidan, id `b~<brigadeId>`)
      // Yuz tekshiruvi yoqiq bo'lsa brigadir hammani birdan "Keldi" qila olmaydi — har biri yuz bilan
      if (user.role === "BRIGADIER" && faceCheckEnabled()) fail("Yuz tekshiruvi yoqilgan — har bir a'zoni yuz bilan \"Keldi\" qiling", 403);
      const only = user.role === "BRIGADIER" ? [(await brigadeOf(user, id)).brigadeId] : undefined;
      const r = await markAllPresent(user.id, today(), only);
      clearDashCache();
      return { ok: true, message: r.count ? `${r.count} kishi "Keldi" deb belgilandi` : "Hamma allaqachon belgilangan" };
    }
    case "report.submit": {
      const r = await submitReport(user.id, today(), textOf(payload, "note") || null);
      if ("error" in r) fail(r.error!);
      clearDashCache(); // bosh ekrandagi "Kunlik hisobot" kartasi darhol "Qayd etildi" bo'lsin
      return { ok: true, message: "Hisobot saqlandi va direktorga yuborildi" };
    }
    case "sex.assign": {
      const brigadeId = textOf(payload, "brigadeId") || null;
      const r = await assignEmployeeBrigade(user.id, id, brigadeId);
      if ("error" in r) fail(r.error!);
      clearDashCache();
      return { ok: true, message: brigadeId ? "Xodim brigadaga biriktirildi" : "Xodim brigadadan chiqarildi" };
    }

    default:
      return fail("Bunday amal yo'q", 404) as never;
  }
}

/** Qabul qilingan zayavka cheki: summa, hajm, mijoz, yetkazish va to'lov sharti. */
export async function orderReceipt(id: string, blocked: boolean): Promise<Receipt> {
  const o = await db.order.findUniqueOrThrow({
    where: { id },
    include: { customer: { select: { name: true } }, items: { include: { product: { select: { code: true, name: true } } } } },
  });
  const volume = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const total = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
  const stock = o.kind === "STOCK";
  const extras = [o.needsDelivery ? "dastavka" : "o'zi olib ketadi", o.needsPump ? "nasos" : null, o.isUrgent ? "shoshilinch" : null].filter(Boolean).join(" · ");
  const rows: Receipt["rows"] = [
    { label: "Zayavka", value: o.orderNo, copy: true },
    ...(stock ? [] : [{ label: "Mijoz", value: o.customer.name }]),
    { label: "Mahsulot", value: o.items.map((i) => `${i.product.code} · ${fmtNum(Number(i.qtyM3), 1)} m³`).join(", ") || "—" },
    { label: "Yetkazish", value: deliveryAt(o.deliveryDate, o.deliveryTime) },
    { label: "Manzil", value: o.deliveryAddress },
    { label: "Shart", value: extras },
    ...(stock ? [] : [{ label: "To'lov", value: o.onCredit ? "qarzga (kafolat xati)" : "oldindan / naqd" }]),
  ];
  return {
    headline: stock ? `${fmtNum(volume, 1)} m³` : money(total),
    caption: stock ? "Sklad zaxirasiga ishlab chiqarish" : `${fmtNum(volume, 1)} m³ beton`,
    status: { label: blocked ? "Bloklandi — limit oshgan" : "Qabul qilindi", tone: blocked ? "warning" : "success", at: new Date().toISOString() },
    rows,
  };
}
