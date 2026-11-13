"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { orderEdit, type EditOrderInput } from "@/lib/orders";
import { noteInfo, noteWithReceiver, noteWithTrips } from "@/lib/order-day-sheet";
import { blockKey, blockName } from "@/lib/site-blocks";
import { numText } from "@/lib/format";
import { withNds, withoutNds } from "@/lib/nds";
import { MAX_AMOUNT } from "@/lib/action";

/** Katakdagi qalam qaysi maydonni o'zgartiradi. Qator maydonlari — product…vat, qolgani — butun zayavkaniki. */
export type GridCellField = "product" | "block" | "qty" | "price" | "vat" | "trips" | "fee" | "receiver" | "phone" | "site" | "date" | "time" | "prepay";
const FIELDS: readonly GridCellField[] = ["product", "block", "qty", "price", "vat", "trips", "fee", "receiver", "phone", "site", "date", "time", "prepay"];
const ITEM_FIELDS: readonly GridCellField[] = ["product", "block", "qty", "price", "vat"];

export type GridCellInput = {
  orderId: string;
  /** Zayavka qatori (mahsulot qatori maydonlari uchun) */
  itemId: string | null;
  field: GridCellField;
  /** Son — «1 205 357,14» ham bo'ladi; sana — «YYYY-MM-DD» yoki «unknown»; QQS — «1»/«0»; mahsulot — id */
  value: string;
  /** Faqat «site»: xaritadagi nuqta */
  lat?: number | null;
  lng?: number | null;
};
export type GridCellResult = { ok: true; blocked?: boolean } | { error: string };

const num = (v: string) => { const x = Number(numText(v.trim())); return v.trim() && Number.isFinite(x) ? x : NaN; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * «Excel ko'rinish» varag'idagi olingan zayavka katagini tahrirlash — faqat shu ustun. Zayavkaning qolgan ma'lumotlari bazadagidek
 * yuboriladi va saqlash to'liq tahrir bilan bir xil (`lib/orders.ts` → `orderEdit`): ruxsat («orders → edit»), holat sharti
 * (ishlab chiqarish boshlanmagan), schyot, kredit/kunlik limit, bosh to'lov so'rovi, brigadaga berilgan qator va AuditLog o'sha yerda.
 * Qabul qiluvchi, telefon va reys soni zayavka izohida turadi («Qabul qiluvchi: …», «Dastavka: N reys» — `lib/order-day-sheet.ts`).
 */
export async function editOrderGridCell(raw: GridCellInput): Promise<GridCellResult> {
  const s = await getSession();
  if (!s) return { error: "Tizimga qayta kiring" };
  if (!raw || typeof raw.orderId !== "string" || typeof raw.value !== "string" || !FIELDS.includes(raw.field) || raw.value.length > 500) {
    return { error: "So'rov noto'g'ri — sahifani yangilang" };
  }
  if (!canDo(s, "orders", "edit")) return { error: "Zayavkani tahrirlashga ruxsatingiz yo'q — direktordan ruxsat so'rang" };
  const { field, value } = raw;

  const o = await db.order.findUnique({
    where: { id: raw.orderId },
    select: {
      kind: true, status: true, deliveryDate: true, dateUnknown: true, deliveryTime: true, isUrgent: true, note: true, deliveryAddress: true,
      lat: true, lng: true, needsPump: true, needsDelivery: true, deliveryFee: true, onCredit: true, prepayAmount: true, payMethod: true,
      items: { orderBy: { id: "asc" }, select: { id: true, productId: true, qtyM3: true, price: true, nds: true, product: { select: { price: true } }, block: { select: { name: true } } } },
    },
  });
  if (!o || o.kind !== "SALE") return { error: "Zayavka topilmadi — sahifani yangilang" };

  // Zayavka bazadagidek; blok `undefined` — o'zgarmaydi. Narx bazadagidek (QQS bilan) — `orderEdit` shuni kutadi.
  const input: EditOrderInput = {
    items: o.items.map((i) => ({ id: i.id, productId: i.productId, qtyM3: Number(i.qtyM3), price: Number(i.price), nds: i.nds })),
    deliveryDate: o.deliveryDate, dateUnknown: o.dateUnknown, deliveryTime: o.deliveryTime, isUrgent: o.isUrgent, note: o.note,
    deliveryAddress: o.deliveryAddress, lat: o.lat, lng: o.lng, needsPump: o.needsPump, needsDelivery: o.needsDelivery,
    deliveryFee: Number(o.deliveryFee), onCredit: o.onCredit, prepayAmount: Number(o.prepayAmount ?? 0), payMethod: o.payMethod,
    via: "order-grid-cell",
  };
  const before = JSON.stringify(input);

  const it = ITEM_FIELDS.includes(field) ? input.items.find((i) => i.id === raw.itemId) : undefined;
  if (ITEM_FIELDS.includes(field) && !it) return { error: "Zayavka qatori topilmadi — sahifani yangilang" };
  const base = it ? (it.nds ? withoutNds(it.price) : it.price) : 0; // qator narxi QQS'siz
  const ni = noteInfo(o.note);

  switch (field) {
    case "product": {
      if (!value || value.length > 64) return { error: "Mahsulotni ro'yxatdan tanlang" };
      if (value === it!.productId) break;
      const p = await db.product.findUnique({ where: { id: value }, select: { price: true, isActive: true } });
      if (!p || !p.isActive) return { error: "Mahsulot topilmadi — ro'yxatdan qayta tanlang" };
      // Narx eski mahsulotning katalog narxi bo'lsa — yangisining narxi (yangi qatordagi kabi); qo'lda yozilgan narx qoladi
      const was = Number(o.items.find((i) => i.id === it!.id)!.product.price);
      if (Math.abs(base - was) <= 0.011 && Number(p.price) > 0) it!.price = it!.nds ? withNds(Number(p.price)) : Number(p.price);
      it!.productId = value;
      break;
    }
    case "block": {
      const next = blockName(value);
      if (blockKey(next) !== blockKey(o.items.find((i) => i.id === it!.id)!.block?.name)) it!.block = next;
      break;
    }
    case "qty": {
      const q = num(value);
      if (!(q > 0) || q > 100_000) return { error: "Soni 0 dan katta va 100 000 dan oshmasin" };
      it!.qtyM3 = Math.round(q * 1000) / 1000;
      break;
    }
    case "price": {
      const p = num(value);
      if (!(p >= 0) || p > MAX_AMOUNT) return { error: "Narx noto'g'ri" };
      it!.price = it!.nds ? withNds(r2(p)) : r2(p);
      break;
    }
    case "vat": {
      const on = value === "1";
      if (on === it!.nds) break;
      it!.nds = on;
      it!.price = on ? withNds(base) : base;
      break;
    }
    case "trips": {
      const t = value.trim();
      if (t && !/^\d{1,3}$/.test(t)) return { error: "Reys soni butun son bo'lsin (0 — dastavka yo'q)" };
      const n = t ? Number(t) : null;
      input.needsDelivery = n !== 0;
      if (n === 0) input.deliveryFee = 0;
      input.note = noteWithTrips(o.note, n);
      break;
    }
    case "fee": {
      const f = num(value || "0");
      if (!(f >= 0) || f > MAX_AMOUNT) return { error: "Dastavka summasi noto'g'ri" };
      input.deliveryFee = r2(f);
      if (f > 0) input.needsDelivery = true; // summa yozildi — dastavka bor
      break;
    }
    case "receiver": input.note = noteWithReceiver(o.note, value.trim().slice(0, 120), ni.phone); break;
    case "phone": {
      const ph = value.trim().slice(0, 40);
      if (ph && ph.replace(/\D/g, "").length < 7) return { error: "Telefon raqami noto'g'ri — masalan +998 90 123 45 67" };
      input.note = noteWithReceiver(o.note, ni.receiver, ph);
      break;
    }
    case "site": {
      const a = value.replace(/\s+/g, " ").trim().slice(0, 300);
      if (!a) return { error: "Obyekt manzilini yozing" };
      const ok = (x: unknown) => typeof x === "number" && Number.isFinite(x);
      const point = ok(raw.lat) && ok(raw.lng) && Math.abs(raw.lat!) <= 90 && Math.abs(raw.lng!) <= 180 ? { lat: raw.lat!, lng: raw.lng! } : null;
      input.deliveryAddress = a; input.lat = point?.lat ?? null; input.lng = point?.lng ?? null;
      break;
    }
    case "date": {
      if (value === "unknown") { input.dateUnknown = true; break; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(value).getTime())) return { error: "Sana noto'g'ri" };
      // Kun bo'yicha (eski yozuvlarda vaqt qismi turlicha): o'sha kun — bazadagi sana o'zgarmaydi
      if (o.dateUnknown || o.deliveryDate.toISOString().slice(0, 10) !== value) input.deliveryDate = new Date(value);
      input.dateUnknown = false;
      break;
    }
    case "time": {
      const t = value.trim();
      const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
      if (t && (!m || Number(m[1]) > 23 || Number(m[2] ?? 0) > 59)) return { error: "Soat noto'g'ri — masalan 09:30" };
      input.deliveryTime = m ? `${m[1]!.padStart(2, "0")}:${m[2] ?? "00"}` : null;
      break;
    }
    case "prepay": {
      const p = num(value || "0");
      if (!(p >= 0) || p > MAX_AMOUNT) return { error: "Bosh to'lov noto'g'ri" };
      input.prepayAmount = r2(p);
      break;
    }
  }
  // Hech narsa o'zgarmadi — yozuv, audit va «zayavka o'zgartirildi» xabari bo'lmasin
  if (JSON.stringify(input) === before) return { ok: true };

  let res;
  try {
    res = await orderEdit(raw.orderId, input, s.userId);
  } catch (e) {
    console.error("[orders/grid-cell]", e);
    return { error: "Saqlanmadi — qayta urinib ko'ring" };
  }
  if (res.error) return { error: res.error };
  revalidatePath("/orders"); revalidatePath(`/orders/${raw.orderId}`); revalidatePath("/sales"); revalidatePath("/production");
  revalidatePath("/customers"); revalidatePath("/payments"); revalidatePath("/pul-qabul"); revalidatePath("/tasks");
  return { ok: true, blocked: res.status === "BLOCKED" && o.status !== "BLOCKED" };
}
