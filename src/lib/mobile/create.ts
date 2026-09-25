import { z } from "zod";
import { driverPositionNames } from "@/lib/positions";
import { db } from "@/lib/db";
import { productCatalog, groupPath } from "@/lib/product-catalog";
import { createOrder } from "@/lib/orders";
import { createTrip } from "@/lib/trips";
import { customersCredit, blacklistedIds } from "@/lib/finance";
import { pushTripToEco } from "@/lib/eco/sync";
import { ecoEnabled, normalizePhone } from "@/lib/eco/client";
import type { MobileUser } from "./auth";
import type { FormField, FormOption } from "./detail";
import { ListError } from "./list";
import { unitLabel, soleUnit } from "@/lib/unit";
import type { Role } from "@/generated/prisma";

/**
 * Mobil ilovada yangi hujjat ochish: forma tavsifi serverdan keladi, ilova uni chizadi.
 *
 * Shu sababli tanlov ro'yxatlari (mijozlar, mahsulotlar, mikserlar, haydovchilar) har doim
 * dolzarb bo'ladi va qoidalar (qora ro'yxat, qoldiq, sig'im) bitta joyda — `lib/orders.ts`,
 * `lib/trips.ts` da — tekshiriladi.
 */
export type CreateForm = { key: string; title: string; submitLabel: string; fields: FormField[] };

/** Kim qaysi hujjatni ocha oladi — veb ERP bilan bir xil. */
export const CREATE_ROLES: Record<string, { roles: Role[]; title: string; label: string }> = {
  orders: { roles: ["SALES"], title: "Yangi zayavka", label: "Zayavka ochish" },
  trips: { roles: ["LOGISTICS", "PRODUCTION"], title: "Yangi reys", label: "Reys ochish" },
};

export const canCreate = (user: MobileUser, key: string) =>
  !!CREATE_ROLES[key] && (user.role === "DIRECTOR" || CREATE_ROLES[key].roles.includes(user.role));

const NEW_CUSTOMER = "__new__";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ───────────────────────── Forma tavsifi ─────────────────────────

export async function mobileForm(user: MobileUser, key: string): Promise<CreateForm> {
  if (!CREATE_ROLES[key]) throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  if (!canCreate(user, key)) throw new ListError("FORBIDDEN", "Bu hujjatni ochishga ruxsatingiz yo'q", 403);
  return key === "orders" ? orderForm() : tripForm();
}

async function orderForm(): Promise<CreateForm> {
  const [customers, catalog, accounts] = await Promise.all([
    db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" } }),
    productCatalog(), // veb bilan bir xil mahsulot ro'yxati (papka yo'li nom yonida)
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  // Qora ro'yxatdagi mijoz tanlanmasin — ro'yxatdan chiqarilmaydi, lekin belgilanadi
  const black = await blacklistedIds(customers.map((c) => c.id));
  const credit = await customersCredit(customers.map((c) => c.id));

  const customerOptions: FormOption[] = [
    { value: NEW_CUSTOMER, label: "➕ Yangi mijoz" },
    ...customers.map((c) => {
      const cr = credit.get(c.id);
      const left = cr ? cr.limit - cr.used : null;
      return {
        value: c.id,
        label: black.has(c.id) ? `⛔ ${c.name} — qora ro'yxat` : `${c.name}${left != null ? ` · limitda ${money(Math.max(0, left))}` : ""}`,
      };
    }),
  ];

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);

  return {
    key: "orders", title: "Yangi zayavka", submitLabel: "Zayavkani ochish",
    fields: [
      { name: "customerId", label: "Mijoz", type: "select", required: true, options: customerOptions, hint: "Qora ro'yxatdagi mijozga zayavka ochilmaydi" },
      { name: "newName", label: "Yangi mijoz nomi", type: "text", required: true, showIf: { field: "customerId", equals: NEW_CUSTOMER } },
      { name: "newPhone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67", showIf: { field: "customerId", equals: NEW_CUSTOMER } },
      { name: "newInn", label: "INN", type: "text", placeholder: "9 raqam", showIf: { field: "customerId", equals: NEW_CUSTOMER } },
      { name: "deliveryDate", label: "Yetkazish sanasi", type: "date", required: true, value: ymd(tomorrow) },
      { name: "deliveryAddress", label: "Obyekt manzili", type: "text", required: true, placeholder: "Tuman, ko'cha, mo'ljal" },
      {
        name: "items", label: "Mahsulot", type: "items", required: true,
        columns: [
          // Birlik mahsulot nomi yonida turadi: hajm va narx shu birlikda kiritiladi (beton m³, ustun/blok dona)
          { name: "productId", label: "Mahsulot", type: "select", required: true, options: catalog.products.map((p) => { const path = groupPath(catalog.groups, p.groupId); return { value: p.id, label: `${path ? `${path} › ` : ""}${p.name} · ${p.unit}`, extra: { price: String(Math.round(Number(p.price))) } }; }) },
          { name: "qtyM3", label: "Hajmi (mahsulot birligida)", type: "number", required: true, placeholder: "0" },
          { name: "price", label: "Narx (1 birlik)", type: "number", required: true, placeholder: "0" },
        ],
      },
      { name: "needsPump", label: "Nasos kerak", type: "switch", value: "false" },
      { name: "isUrgent", label: "Shoshilinch", type: "switch", value: "false" },
      { name: "onCredit", label: "Qarzga", type: "switch", value: "false", hint: "Belgilansa kafolat xati talab qilinadi, oldindan to'lov olinmaydi" },
      { name: "prepayAmount", label: "Oldindan to'lov (so'm)", type: "number", placeholder: "0", showIf: { field: "onCredit", equals: "false" } },
      { name: "prepayAccountId", label: "To'lov qayerga tushdi", type: "select", options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.type === "CASH" ? "kassa" : "bank"})` })), showIf: { field: "onCredit", equals: "false" } },
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

async function tripForm(): Promise<CreateForm> {
  const [orders, vehicles, drivers] = await Promise.all([
    db.order.findMany({ where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, orderBy: { deliveryDate: "asc" }, include: { customer: true, items: { include: { product: true } }, trips: true } }),
    // Veb formasi bilan bir xil: mikser ham, yuk mashina ham (nasos yuk tashimaydi)
    db.vehicle.findMany({ where: { isActive: true, type: { in: ["MIXER", "TRUCK"] } }, orderBy: [{ type: "asc" }, { plate: "asc" }] }),
    db.employee.findMany({ where: { isActive: true, position: { in: await driverPositionNames() } }, orderBy: { fullName: "asc" }, include: { vehicle: { select: { plate: true } } } }),
  ]);

  // Faqat qoldig'i bor zayavkalar — reys ochib bo'lmaydiganlari ro'yxatda turmasin
  const open = orders
    .map((o) => {
      const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
      const shipped = o.trips.filter((t) => t.status !== "CANCELLED").reduce((s, t) => s + Number(t.qtyM3), 0);
      // Qoldiq zayavkadagi mahsulot birligida ko'rsatiladi (aralash birlikda birliksiz)
      return { o, left: total - shipped, unit: soleUnit(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) };
    })
    .filter((x) => x.left > 0.001);

  return {
    key: "trips", title: "Yangi reys", submitLabel: "Reysni ochish",
    fields: [
      {
        name: "orderId", label: "Zayavka", type: "select", required: true,
        options: open.map(({ o, left, unit }) => ({ value: o.id, label: `${o.orderNo} · ${o.customer.name} · qoldiq ${left}${unit ? ` ${unitLabel(unit)}` : ""}`, extra: { qtyM3: String(left) } })),
        hint: open.length ? undefined : "Qoldig'i bor tasdiqlangan zayavka yo'q",
      },
      {
        name: "vehicleId", label: "Texnika", type: "select", required: true,
        options: vehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.type === "MIXER" ? "mikser" : "yuk mashina"}${v.capacityM3 ? ` · ${v.capacityM3} m³` : ""}` })),
        hint: "Beton — mikser, dona mahsulot (plita, blok) — yuk mashina",
      },
      {
        name: "driverId", label: "Haydovchi", type: "select", required: true,
        options: drivers.map((d) => ({ value: d.id, label: `${d.fullName}${d.vehicle ? ` · ${d.vehicle.plate}` : " · texnikasiz"}${normalizePhone(d.phone) ? "" : " · ⚠️ telefonsiz"}`, extra: d.vehicleId ? { vehicleId: d.vehicleId } : undefined })),
        hint: "Haydovchining biriktirilgan texnikasi yonida ko'rsatiladi; telefoni yo'q haydovchi ilovada reysni ko'rmaydi",
      },
      { name: "qtyM3", label: "Hajmi (zayavka birligida)", type: "number", required: true, placeholder: "0" },
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

// ───────────────────────── Yuborish ─────────────────────────

const OrderBody = z.object({
  customerId: z.string().trim().min(1, "Mijoz tanlanmagan"),
  newName: z.string().trim().optional(),
  newPhone: z.string().trim().optional(),
  newInn: z.string().trim().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Yetkazish sanasi kerak"),
  deliveryAddress: z.string().trim().min(1, "Obyekt manzili kerak"),
  items: z.array(z.object({
    productId: z.string().trim().min(1, "Marka tanlanmagan"),
    qtyM3: z.coerce.number().positive("Hajm 0 dan katta bo'lsin"),
    price: z.coerce.number().min(0, "Narx manfiy bo'lmasin"),
  })).min(1, "Kamida bitta mahsulot qatori kerak"),
  needsPump: z.coerce.boolean().optional(),
  isUrgent: z.coerce.boolean().optional(),
  onCredit: z.coerce.boolean().optional(),
  prepayAmount: z.coerce.number().min(0).optional(),
  prepayAccountId: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

const TripBody = z.object({
  orderId: z.string().trim().min(1, "Zayavka tanlanmagan"),
  vehicleId: z.string().trim().min(1, "Mikser tanlanmagan"),
  driverId: z.string().trim().min(1, "Haydovchi tanlanmagan"),
  qtyM3: z.coerce.number().positive("Hajm 0 dan katta bo'lsin"),
  note: z.string().trim().optional(),
});

export type CreateResult = { key: string; id: string; message: string };

export async function mobileCreate(user: MobileUser, key: string, payload: unknown): Promise<CreateResult> {
  if (!CREATE_ROLES[key]) throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  if (!canCreate(user, key)) throw new ListError("FORBIDDEN", "Bu hujjatni ochishga ruxsatingiz yo'q", 403);

  try {
    if (key === "orders") {
      const p = OrderBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const isNew = d.customerId === NEW_CUSTOMER;
      const r = await createOrder({
        customerId: isNew ? undefined : d.customerId,
        newCustomer: isNew ? { name: d.newName ?? "", phone: d.newPhone || undefined, inn: d.newInn || undefined } : undefined,
        deliveryDate: new Date(`${d.deliveryDate}T00:00:00`),
        deliveryAddress: d.deliveryAddress,
        items: d.items,
        needsPump: d.needsPump,
        isUrgent: d.isUrgent,
        onCredit: d.onCredit,
        prepay: d.prepayAmount ? { amount: d.prepayAmount, cashAccountId: d.prepayAccountId ?? "" } : undefined,
        note: d.note,
      }, user.id);
      return { key: "orders", id: r.id, message: `${r.orderNo} ochildi — qoralama holatida, qabul qilishni unutmang` };
    }

    const p = TripBody.safeParse(payload);
    if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
    const r = await createTrip(p.data, user.id);
    // Haydovchi ilovasiga darhol yuborish — reys kartochkasi ochilganda holat ko'rinsin
    if (ecoEnabled()) {
      const push = await pushTripToEco(r.id);
      if (push.error) return { key: "trips", id: r.id, message: `${r.deliveryNoteNo} ochildi. ${push.error}` };
    }
    return { key: "trips", id: r.id, message: `${r.deliveryNoteNo} ochildi va haydovchi ilovasiga yuborildi` };
  } catch (e) {
    if (e instanceof ListError) throw e;
    throw new ListError("CREATE_FAILED", (e as Error).message, 400);
  }
}
