import { z } from "zod";
import { after } from "next/server";
import { db } from "@/lib/db";
import { orderCancel, orderConfirm, orderUnblock } from "@/lib/orders";
import { tripCancelled, tripDelivered, tripLoaded, tripOnRoad } from "@/lib/trips";
import { addPayment } from "@/lib/payments";
import { taskCancel, taskProgress } from "@/lib/tasks";
import { pushTripStatus, pushTripToEco } from "@/lib/eco/sync";
import { ecoEnabled } from "@/lib/eco/client";
import type { MobileUser } from "./auth";
import { ACTION_ROLES, can } from "./detail";
import { ListError } from "./list";

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

const fail = (m: string, status = 400) => { throw new ListError("ACTION_FAILED", m, status); };

export async function runMobileAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown> = {}): Promise<ActionResult> {
  if (!id) fail("id yo'q");
  if (!(action in ACTION_ROLES)) fail("Bunday amal yo'q", 404); // noma'lum amal — ruxsat xatosi bilan chalkashmasin
  if (!can(user, action)) fail("Bu amalga ruxsatingiz yo'q", 403);

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
      const r = await tripDelivered(id, user.id, p.data!.receiverName, p.data!.note);
      if (r.error) fail(r.error);
      if (!r.changed) fail("Holat mos emas");
      if (ecoEnabled()) after(() => pushTripStatus(id, "COMPLETED", { note: `Qabul qildi: ${p.data!.receiverName}` }));
      return { ok: true, message: "Yetkazildi deb belgilandi" };
    }
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
      return { ok: true, message: r.status === "DONE" ? "Qayd qilindi — topshiriq bajarildi" : "Qayd qilindi" };
    }
    case "task.cancel": {
      const r = await taskCancel(id, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Topshiriq bekor qilindi" };
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
