import { z } from "zod";
import { after } from "next/server";
import { db } from "@/lib/db";
import { orderCancel, orderConfirm, orderUnblock } from "@/lib/orders";
import { tripArrival, tripCancelled, tripDelivered, tripLoaded, tripOnRoad } from "@/lib/trips";
import { addPayment } from "@/lib/payments";
import { taskCancel, taskProgress } from "@/lib/tasks";
import { clearBrigadeLeader, setBrigadeLeader } from "@/lib/brigades";
import { audit } from "@/lib/audit";
import { createInvoice } from "@/lib/invoices";
import { convertLead, saveLeadNote, setLeadStatus } from "@/lib/leads";
import {
  approveSupplyRequest, editSupplyItems, fundSupplyRequest, priceSupplyRequest, receiveSupplyRequest,
  rejectSupplyRequest, saveSupplyFact, type FactRow,
} from "@/lib/supply";
import { pushTripStatus, pushTripToEco } from "@/lib/eco/sync";
import { ecoEnabled } from "@/lib/eco/client";
import type { MobileUser } from "./auth";
import { ACTION_ROLES, NEW_BRIGADE, can } from "./detail";
import { driverEmployeeId, myBrigadeIds, ListError } from "./list";

/**
 * Mobil ilovadagi tugmalarning ijrosi.
 *
 * Qoidalar bu yerda takrorlanmaydi — `lib/orders.ts`, `lib/trips.ts`, `lib/payments.ts`
 * chaqiriladi, ya'ni veb ERP'dagi tugma bilan bir xil natija beradi (audit ham yoziladi).
 * Bu yerda faqat: ruxsat, kirish ma'lumotini tekshirish va ECO'ga xabar berish.
 */
export type ActionResult = { ok: true; message: string };

const Receiver = z.object({ receiverName: z.string().trim().min(2, "Qabul qilgan kishini yozing"), note: z.string().trim().optional() });
const Progress = z.object({
  qty: z.coerce.number().positive("Miqdor 0 dan katta bo'lsin"),
  note: z.string().trim().optional(),
});
const Pay = z.object({
  amount: z.coerce.number().positive("Summa 0 dan katta bo'lsin"),
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

/** Brigadir faqat O'Z brigadasiga tayinlangan topshiriqni qayd qiladi — reysdagi qoidaning aynan o'zi. */
async function assertOwnTask(user: MobileUser, taskId: string) {
  if (user.role !== "BRIGADIER") return;
  const t = await db.brigadeTask.findUnique({ where: { id: taskId }, select: { brigadeId: true } });
  if (!t || !(await myBrigadeIds(user.id)).includes(t.brigadeId)) fail("Bu topshiriq sizning brigadangizga tayinlanmagan", 403);
}

export async function runMobileAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown> = {}): Promise<ActionResult> {
  if (!id) fail("id yo'q");
  if (!(action in ACTION_ROLES)) fail("Bunday amal yo'q", 404); // noma'lum amal — ruxsat xatosi bilan chalkashmasin
  if (!can(user, action)) fail("Bu amalga ruxsatingiz yo'q", 403);
  if (action.startsWith("trip.")) await assertOwnTrip(user, id);
  if (action.startsWith("task.")) await assertOwnTask(user, id);

  switch (action) {
    // ── Zayavka ──
    case "order.confirm": {
      const r = await orderConfirm(id, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.status === "BLOCKED" ? "Limit oshgan — zayavka bloklandi, direktor ochadi" : "Zayavka qabul qilindi" };
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
      // Logist/ishlab chiqarish bunga tushmaydi — GPS ishlamay qolgan reysni ular yopadi.
      if (user.role === "DRIVER") {
        const near = await tripArrival(id);
        if (!near.near) fail(near.reason ?? "Obyektga yetib borilmagan");
      }
      const r = await tripDelivered(id, user.id, p.data!.receiverName, p.data!.note);
      if (r.error) fail(r.error);
      if (!r.changed) fail("Holat mos emas");
      if (ecoEnabled()) after(() => pushTripStatus(id, "COMPLETED", { note: `Qabul qildi: ${p.data!.receiverName}` }));
      return { ok: true, message: "Yetkazildi deb belgilandi" };
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
      // `note` — hovliga nechta kirim bo'lgani, zayavka yopilgani, xomashyo yetmagani
      const base = r.status === "DONE" ? "Qayd qilindi — topshiriq bajarildi" : "Qayd qilindi";
      return { ok: true, message: r.note ? `${base}. ${r.note}` : base };
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
      const r = await rejectSupplyRequest(id, user.id, textOf(payload, "reason"));
      if (r.error) fail(r.error);
      return { ok: true, message: "Ta'minot zayavkasi bekor qilindi" };
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
      return { ok: true, message: r.invoiceStatus === "PAID" ? "To'lov qabul qilindi — schyot yopildi" : "To'lov qabul qilindi" };
    }

    default:
      return fail("Bunday amal yo'q", 404) as never;
  }
}
