import { z } from "zod";
import { driverPositionNames } from "@/lib/positions";
import { db } from "@/lib/db";
import { productCatalog, groupPath } from "@/lib/product-catalog";
import { createOrder } from "@/lib/orders";
import { createTrip, READINESS_INCLUDE, orderReadiness } from "@/lib/trips";
import { customersCredit, blacklistedIds } from "@/lib/finance";
import { pushTripToEco } from "@/lib/eco/sync";
import { ecoEnabled, normalizePhone } from "@/lib/eco/client";
import { audit } from "@/lib/audit";
import { createSupplyRequest } from "@/lib/supply";
import type { MobileUser } from "./auth";
import type { FormField, FormOption } from "./detail";
import { ListError } from "./list";
import { unitLabel } from "@/lib/unit";
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
  // Ta'minot so'rovi — sklad kerakli mahsulotlar jadvalini tuzadi (veb `/stock/supply/new`)
  supply: { roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"], title: "Ta'minot so'rovi", label: "Ta'minot so'rash" },
  customers: { roles: ["SALES", "ACCOUNTING", "FINANCE"], title: "Yangi mijoz", label: "Mijoz qo'shish" },
  suppliers: { roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"], title: "Yangi yetkazuvchi", label: "Yetkazuvchi qo'shish" },
  brigades: { roles: ["SUPERVISOR", "PRODUCTION", "HR"], title: "Yangi brigada", label: "Brigada ochish" },
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
  switch (key) {
    case "orders": return orderForm();
    case "trips": return tripForm();
    case "supply": return supplyForm();
    case "customers": return customerForm();
    case "suppliers": return supplierForm();
    default: return brigadeForm();
  }
}

/** Ta'minot so'rovi: sklad + qachongacha + mahsulotlar jadvali (spravochnikdagi xomashyo, miqdor, izoh). */
async function supplyForm(): Promise<CreateForm> {
  const [warehouses, materials, balances] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  const bal = new Map(balances.map((b) => [b.materialId, Number(b._sum.qty ?? 0)]));
  return {
    key: "supply", title: "Ta'minot so'rovi", submitLabel: "Snabjeniyega yuborish",
    fields: [
      { name: "warehouseId", label: "Sklad", type: "select", required: true, value: warehouses[0]?.id, options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
      { name: "needBy", label: "Qachongacha kerak", type: "date" },
      {
        name: "items", label: "Kerakli mahsulotlar", type: "items", required: true,
        columns: [
          // Qoldiq nom yonida — kam qolganini ko'rib so'raydi. Birlik xomashyodan olinadi (`extra`).
          { name: "materialId", label: "Xomashyo", type: "select", required: true, options: materials.map((m) => ({ value: m.id, label: `${m.name} · qoldiq ${(bal.get(m.id) ?? 0).toFixed(1)} ${m.unit}${(bal.get(m.id) ?? 0) < Number(m.minStock) ? " · kam qolgan" : ""}`, extra: { unit: m.unit } })) },
          { name: "qty", label: "Miqdor", type: "number", required: true, placeholder: "0" },
          { name: "note", label: "Izoh (marka, o'lcham…)", type: "text" },
        ],
      },
      { name: "note", label: "Izoh", type: "text", hint: "Spravochnikda yo'q mahsulotni vebdagi Sklad bo'limidan so'rang" },
    ],
  };
}

async function customerForm(): Promise<CreateForm> {
  return {
    key: "customers", title: "Yangi mijoz", submitLabel: "Mijozni saqlash",
    fields: [
      { name: "name", label: "Nomi", type: "text", required: true, placeholder: "MChJ yoki F.I.Sh." },
      { name: "phone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67" },
      { name: "inn", label: "INN", type: "text", placeholder: "9 raqam" },
      { name: "address", label: "Manzil", type: "text" },
    ],
  };
}

async function supplierForm(): Promise<CreateForm> {
  return {
    key: "suppliers", title: "Yangi yetkazuvchi", submitLabel: "Saqlash",
    fields: [
      { name: "name", label: "Nomi", type: "text", required: true },
      { name: "phone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67" },
      { name: "inn", label: "INN", type: "text", placeholder: "9 raqam" },
    ],
  };
}

async function brigadeForm(): Promise<CreateForm> {
  const leaders = await db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } });
  return {
    key: "brigades", title: "Yangi brigada", submitLabel: "Brigadani ochish",
    fields: [
      { name: "name", label: "Brigada nomi", type: "text", required: true, placeholder: "1-brigada" },
      { name: "leaderId", label: "Brigadir", type: "select", options: leaders.map((e) => ({ value: e.id, label: `${e.fullName} · ${e.position}` })), hint: "Keyin Xodimlar kartochkasidan ham biriktirish mumkin" },
      { name: "phone", label: "Telefon", type: "text" },
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
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
    { value: NEW_CUSTOMER, label: "+ Yangi mijoz" },
    ...customers.map((c) => {
      const cr = credit.get(c.id);
      const left = cr ? cr.limit - cr.used : null;
      return {
        value: c.id,
        label: black.has(c.id) ? `${c.name} — QORA RO'YXAT` : `${c.name}${left != null ? ` · limitda ${money(Math.max(0, left))}` : ""}`,
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
    db.order.findMany({ where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, orderBy: { deliveryDate: "asc" }, include: { customer: true, ...READINESS_INCLUDE } }),
    // Veb formasi bilan bir xil: mikser ham, yuk mashina ham (nasos yuk tashimaydi)
    db.vehicle.findMany({ where: { isActive: true, type: { in: ["MIXER", "TRUCK"] } }, orderBy: [{ type: "asc" }, { plate: "asc" }] }),
    db.employee.findMany({ where: { isActive: true, position: { in: await driverPositionNames() } }, orderBy: { fullName: "asc" }, include: { vehicle: { select: { plate: true } } } }),
  ]);

  // Faqat brigada tayyorlab bergan (hali jo'natilmagan) miqdori bor zayavkalar — qolgani sexda,
  // reys ochib bo'lmaydi. Qoldiq zayavkadagi mahsulot birligida (aralash birlikda birliksiz).
  const open = orders
    .map((o) => { const rd = orderReadiness(o); return { o, left: rd.available, sexda: rd.inProduction, unit: rd.unit }; })
    .filter((x) => x.left > 0.001);

  return {
    key: "trips", title: "Yangi reys", submitLabel: "Reysni ochish",
    fields: [
      {
        name: "orderId", label: "Zayavka", type: "select", required: true,
        options: open.map(({ o, left, sexda, unit }) => ({ value: o.id, label: `${o.orderNo} · ${o.customer.name} · tayyor ${left}${unit ? ` ${unitLabel(unit)}` : ""}${sexda > 0 ? ` · sexda ${sexda}` : ""}`, extra: { qtyM3: String(left) } })),
        hint: open.length ? "Faqat brigada tayyorlab bergan miqdor reysga beriladi; sexdagisi brigada tasdiqidan keyin" : "Brigada tayyorlagan mahsuloti bor zayavka yo'q — brigada tasdiqini kuting",
      },
      {
        name: "vehicleId", label: "Texnika", type: "select", required: true,
        options: vehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.type === "MIXER" ? "mikser" : "yuk mashina"}${v.capacityM3 ? ` · ${v.capacityM3} m³` : ""}` })),
        hint: "Beton — mikser, dona mahsulot (plita, blok) — yuk mashina",
      },
      {
        name: "driverId", label: "Haydovchi", type: "select", required: true,
        options: drivers.map((d) => ({ value: d.id, label: `${d.fullName}${d.vehicle ? ` · ${d.vehicle.plate}` : " · texnikasiz"}${normalizePhone(d.phone) ? "" : " · telefonsiz"}`, extra: d.vehicleId ? { vehicleId: d.vehicleId } : undefined })),
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

const SupplyBody = z.object({
  warehouseId: z.string().trim().min(1, "Sklad tanlanmagan"),
  needBy: z.string().trim().optional(),
  note: z.string().trim().optional(),
  items: z.array(z.object({
    materialId: z.string().trim().min(1, "Xomashyo tanlanmagan"),
    qty: z.coerce.number().positive("Miqdor 0 dan katta bo'lsin"),
    note: z.string().trim().optional(),
  })).min(1, "Kamida bitta qator kerak"),
});
const CustomerBody = z.object({ name: z.string().trim().min(2, "Mijoz nomi kerak"), phone: z.string().trim().optional(), inn: z.string().trim().optional(), address: z.string().trim().optional() });
const SupplierBody = z.object({ name: z.string().trim().min(2, "Yetkazuvchi nomi kerak"), phone: z.string().trim().optional(), inn: z.string().trim().optional() });
const BrigadeBody = z.object({ name: z.string().trim().min(1, "Brigada nomi kerak"), leaderId: z.string().trim().optional(), phone: z.string().trim().optional(), note: z.string().trim().optional() });

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

    if (key === "supply") {
      const p = SupplyBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const mats = await db.material.findMany({ where: { id: { in: p.data.items.map((i) => i.materialId) } }, select: { id: true, name: true, unit: true } });
      const byId = new Map(mats.map((m) => [m.id, m]));
      const r = await createSupplyRequest({
        warehouseId: p.data.warehouseId, needBy: p.data.needBy || null, note: p.data.note || null,
        items: p.data.items.map((i) => { const m = byId.get(i.materialId); return { materialId: m?.id ?? null, name: m?.name ?? "", unit: m?.unit ?? "dona", qty: i.qty, note: i.note || null }; }),
      }, user.id);
      if (r.error || !r.id) throw new Error(r.error ?? "Saqlanmadi");
      return { key: "supply", id: r.id, message: `${r.docNo} ochildi — snabjeniye narx qo'yadi` };
    }
    if (key === "customers") {
      const p = CustomerBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      if (d.inn && (await db.customer.findUnique({ where: { inn: d.inn } }))) throw new Error("Bu INN bilan mijoz allaqachon bor");
      const c = await db.customer.create({ data: { name: d.name, phone: d.phone || null, inn: d.inn || null, address: d.address || null } });
      await audit(db, user.id, "CREATE", "Customer", c.id, undefined, c);
      return { key: "customers", id: c.id, message: `${c.name} qo'shildi` };
    }
    if (key === "suppliers") {
      const p = SupplierBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      if (d.inn && (await db.supplier.findUnique({ where: { inn: d.inn } }))) throw new Error("Bu INN bilan yetkazuvchi bor");
      const sup = await db.supplier.create({ data: { name: d.name, phone: d.phone || null, inn: d.inn || null } });
      await audit(db, user.id, "CREATE", "Supplier", sup.id, undefined, sup);
      return { key: "suppliers", id: sup.id, message: `${sup.name} qo'shildi` };
    }
    if (key === "brigades") {
      const p = BrigadeBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const b = await db.brigade.create({ data: { name: d.name, leaderId: d.leaderId || null, phone: d.phone || null, note: d.note || null } });
      await audit(db, user.id, "CREATE", "Brigade", b.id, undefined, b);
      return { key: "brigades", id: b.id, message: `${b.name} ochildi` };
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
