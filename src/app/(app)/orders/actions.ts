"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { createOrder as createOrderDomain, orderCancel, orderConfirm, orderUnblock } from "@/lib/orders";
import { createStockOrder as createStockOrderDomain } from "@/lib/stock-orders";
import { importOrders, type ImportOrderRow } from "@/lib/import-orders";
import { parseForm, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { saveContractFile, removeContractFile } from "@/lib/uploads";
import { withNds } from "@/lib/nds";

const schema = z.object({
  // Mijoz: mavjudini tanlash ("existing") yoki shu yerning o'zida yangi ochish ("new")
  customerMode: z.enum(["existing", "new"]).default("existing"),
  customerId: z.string().trim().optional(),
  newName: z.string().trim().optional(),
  newPhone: zOpt,
  newInn: zOpt,
  newAddress: zOpt,
  deliveryDate: zStr("Yetkazish sanasi kerak").refine((v) => Number.isFinite(new Date(v).getTime()), "Yetkazish sanasi noto'g'ri"),
  deliveryAddress: zStr("Obyekt manzili kerak"),
  // Xaritadan belgilangan nuqta; bo'sh bo'lishi mumkin. Masofa serverda hisoblanadi.
  lat: z.coerce.number().optional().catch(undefined),
  lng: z.coerce.number().optional().catch(undefined),
  needsPump: z.string().optional().transform((v) => v === "on"),
  needsDelivery: z.string().optional().transform((v) => v === "on"),
  isUrgent: z.string().optional().transform((v) => v === "on"),
  payment: z.enum(["prepay", "credit"]).default("prepay"),
  // Kutilayotgan bosh to'lov (0 — yo'q). Pul kassaga yozilmaydi — kassir `/payments` da qabul qiladi
  prepayAmount: z.coerce.number({ message: "Bosh to'lov raqam bo'lsin" }).min(0, "Bosh to'lov manfiy bo'lmasin").max(MAX_AMOUNT, "Bosh to'lov juda katta").default(0),
  hasContract: z.string().optional().transform((v) => v === "on"), // "Shartnoma qilish" belgilangan
  contractAmount: z.coerce.number({ message: "Shartnoma summasi raqam bo'lsin" }).min(0, "Shartnoma summasi manfiy bo'lmasin").max(MAX_AMOUNT, "Shartnoma summasi juda katta").default(0),
  note: zOpt,
  productId: z.array(z.string()).min(1, "Kamida bitta mahsulot"),
  qtyM3: z.array(z.coerce.number({ message: "Miqdor raqam bo'lsin" }).positive("Miqdor 0 dan katta bo'lsin").max(100_000, "Miqdor juda katta (100 000 dan oshmasin)")),
  price: z.array(z.coerce.number({ message: "Narx raqam bo'lsin" }).min(0, "Narx manfiy bo'lmasin").max(MAX_AMOUNT, "Narx juda katta")),
  // Qator narxiga "NDS 12%" tugmasi bilan soliq qo'shilganmi ("1" / "0")
  nds: z.array(z.string()).optional(),
});

/**
 * Domen xatosi (o'zbekcha `Error`) foydalanuvchiga o'zicha ko'rinadi; baza (Prisma) xatosi esa xom
 * ko'rinmasin — jurnalga yoziladi, foydalanuvchiga umumiy gap.
 */
function userError(e: unknown): string {
  const err = e as Error;
  if (err?.name?.startsWith("PrismaClient") || /prisma|invocation/i.test(err?.message ?? "")) {
    console.error("[orders]", e);
    return "Zayavka saqlanmadi: ma'lumotlarni tekshirib, qayta urinib ko'ring";
  }
  return err?.message || "Zayavka saqlanmadi";
}

export async function createOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "create");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  if (d.hasContract && d.contractAmount <= 0) return { error: "Shartnoma summasini kiriting" };
  const contractAmount = d.hasContract ? d.contractAmount : undefined;

  // Didox'da imzolangan shartnoma fayli zayavka id'si bo'yicha saqlanadi — shuning uchun id oldindan beriladi
  const orderId = crypto.randomUUID();
  const saved = contractAmount != null ? await saveContractFile(orderId, fd.get("contractFile")) : null;
  if (saved && "error" in saved) return { error: saved.error };

  let res;
  try {
    // Qoida `lib/orders.ts` da — mobil ilovadagi "Yangi zayavka" ham shuni chaqiradi
    res = await createOrderDomain(
      {
        customerId: d.customerMode === "existing" ? d.customerId : undefined,
        newCustomer: d.customerMode === "new" ? { name: d.newName ?? "", phone: d.newPhone, inn: d.newInn, address: d.newAddress } : undefined,
        deliveryDate: new Date(d.deliveryDate),
        deliveryAddress: d.deliveryAddress,
        lat: Number.isFinite(d.lat) ? d.lat : null,
        lng: Number.isFinite(d.lng) ? d.lng : null,
        // Narx NDS'siz kiritiladi; "NDS 12%" belgilangan qatorda soliq qo'shib saqlanadi
        // (shunda limit, bosh to'lov, schyot va qarz mijoz to'laydigan summa bo'yicha ishlaydi).
        items: d.productId.map((productId, i) => {
          const nds = d.nds?.[i] === "1";
          const price = d.price[i]!;
          return { productId, qtyM3: d.qtyM3[i]!, price: nds ? withNds(price) : price, nds };
        }).filter((i) => i.productId),
        needsPump: d.needsPump,
        needsDelivery: d.needsDelivery,
        isUrgent: d.isUrgent,
        onCredit: d.payment === "credit",
        prepay: d.prepayAmount > 0 ? { amount: d.prepayAmount } : undefined,
        contractAmount,
        note: d.note,
      },
      s.userId,
      { id: orderId, contractFile: saved ?? undefined },
    );
  } catch (e) {
    return { error: userError(e) };
  }

  revalidatePath("/orders"); revalidatePath("/customers"); revalidatePath("/production"); revalidatePath("/payments");
  const q = [res.onCredit && "guarantee=1", res.contractNo && "contract=1"].filter(Boolean).join("&");
  redirect(q ? `/orders/${res.id}?${q}` : `/orders/${res.id}`);
}

const stockSchema = z.object({
  dueDate: zStr("Tayyor bo'lish muddati kerak"),
  isUrgent: z.string().optional().transform((v) => v === "on"),
  note: zOpt,
  productId: z.array(z.string()).min(1, "Kamida bitta mahsulot"),
  qty: z.array(z.coerce.number().positive("miqdor 0 dan katta bo'lsin")),
});

/**
 * Sklad zayavkasi (zaxiraga ishlab chiqarish): mijozsiz, narxsiz.
 * Qoida `lib/stock-orders.ts` da.
 */
export async function createStockOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "stock");
  const r = parseForm(stockSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  let res;
  try {
    res = await createStockOrderDomain(
      {
        dueDate: new Date(d.dueDate),
        items: d.productId.map((productId, i) => ({ productId, qtyM3: d.qty[i]! })).filter((i) => i.productId && i.qtyM3 > 0),
        isUrgent: d.isUrgent,
        note: d.note,
      },
      s.userId,
    );
  } catch (e) {
    return { error: userError(e) };
  }

  revalidatePath("/orders"); revalidatePath("/production"); revalidatePath("/stock");
  redirect(`/orders/${res.id}`);
}

/**
 * Qabul qilish: DRAFT → CONFIRMED (Sotuv bo'limiga o'tadi) yoki BLOCKED (limit yetmaydi — direktor ochadi).
 * Limit tekshiruvi: qarz + ochiq zayavkalar + shu zayavka ≤ limit.
 */
export async function confirmOrder(id: string): Promise<ActionState> {
  // Sklad zayavkasini sotuvdan tashqari ishlab chiqarish/sklad xodimi ham qabul qiladi
  const o = await db.order.findUnique({ where: { id }, select: { kind: true } });
  if (!o) return { error: "Zayavka topilmadi" };
  const s = await requireAction("orders", o.kind === "STOCK" ? "stock" : "confirm");
  const r = await orderConfirm(id, s.userId); // qoida `lib/orders.ts` da — mobil ilova ham shuni chaqiradi
  // Xato (kunlik limit, holat o'zgargan) tugma yonida ko'rinadi — ilgari `throw` qilinib, prod'da matn yashirinardi
  if (r.error) return { error: r.error };
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers"); revalidatePath("/production"); revalidatePath("/stock");
  return { ok: true, note: r.status === "BLOCKED" ? "Limit yetmadi — zayavka bloklandi, direktor ochadi" : "Qabul qilindi" };
}

/** BLOCKED → CONFIRMED. Direktor (yoki direktor "unblock" ruxsatini bergan xodim). */
export async function unblockOrder(id: string): Promise<ActionState> {
  const s = await requireAction("orders", "unblock");
  const r = await orderUnblock(id, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  return { ok: true };
}

/** Bekor qilish — sabab so'raladi va auditga yoziladi (tasdiq tugmasi `ConfirmButton`). */
export async function cancelOrder(id: string, reason: string): Promise<ActionState> {
  const ord = await db.order.findUnique({ where: { id }, select: { kind: true } });
  if (!ord) return { error: "Zayavka topilmadi" };
  const kind = ord.kind;
  const s = await requireAction("orders", kind === "STOCK" ? "stock" : "cancel");
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { error: "Bekor qilish sababini yozing" };
  const r = await orderCancel(id, s.userId);
  if (r.error) return { error: r.error };
  await audit(db, s.userId, "UPDATE", "Order", id, undefined, { cancelReason: why });
  revalidatePath(`/orders/${id}`); revalidatePath("/tasks"); revalidatePath("/brigades");
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  return { ok: true, note: "Zayavka bekor qilindi" };
}

/**
 * Sklad zayavkasini yopish: so'ralgan zaxira hovliga chiqarib qo'yilgan.
 * Mijoz zayavkasi bunday yopilmaydi — u schyot/to'lov bo'yicha yopiladi.
 */
export async function closeStockOrder(id: string): Promise<ActionState> {
  const s = await requireAction("orders", "stock");
  const o = await db.order.findUnique({ where: { id }, select: { kind: true, status: true } });
  if (!o) return { error: "Zayavka topilmadi" };
  if (o.kind !== "STOCK") return { error: "Bu tugma faqat sklad zayavkasi uchun" };
  if (!["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Faqat qabul qilingan sklad zayavkasi yopiladi" };
  const done = await db.$transaction(async (tx) => {
    // Holat sharti bilan: ikki marta bosilsa ikkinchisi hech narsa yozmaydi
    const r = await tx.order.updateMany({ where: { id, status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, data: { status: "CLOSED" } });
    if (!r.count) return false;
    await audit(tx, s.userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CLOSED", kind: "STOCK" });
    return true;
  });
  if (!done) return { error: "Zayavka shu payt o'zgardi — sahifani yangilang" };
  revalidatePath(`/orders/${id}`); revalidatePath("/orders"); revalidatePath("/production"); revalidatePath("/stock");
  return { ok: true };
}

/** Mijoz imzolagan kafolat xati qabul qilindi / qaytarildi. */
export async function toggleGuarantee(id: string) {
  const s = await requireAction("orders", "contract");
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  const guaranteeAt = o.guaranteeAt ? null : new Date();
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { guaranteeAt } });
    await audit(tx, s.userId, "UPDATE", "Order", id, { guaranteeAt: o.guaranteeAt }, { guaranteeAt });
  });
  revalidatePath(`/orders/${id}`);
}

const contractSchema = z.object({ contractAmount: z.coerce.number().positive("Shartnoma summasi 0 dan katta bo'lsin") });

/**
 * Mavjud zayavkaga shartnoma qo'shish / summasini o'zgartirish / Didox'da imzolangan faylni yuklash (almashtirish).
 * Raqam bir marta beriladi. Fayl `uploads/contracts/` ga yoziladi — isbot uchun tizimda saqlanadi.
 */
export async function setContract(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "contract");
  const r = parseForm(contractSchema, fd);
  if ("error" in r) return { error: r.error };
  const o = await db.order.findUnique({ where: { id } });
  if (!o) return { error: "Zayavka topilmadi" };
  if (o.status === "CANCELLED") return { error: "Bekor qilingan zayavkaga shartnoma qo'shib bo'lmaydi" };
  const saved = await saveContractFile(id, fd.get("contractFile"));
  if (saved && "error" in saved) return { error: saved.error };
  await db.$transaction(async (tx) => {
    const data = {
      contractAmount: r.data.contractAmount, contractAt: o.contractAt ?? new Date(), contractNo: o.contractNo ?? (await nextNo(tx, "contract", "SH")),
      ...(saved ? { contractFile: saved.stored, contractFileName: saved.name, contractFileType: saved.type, contractFileAt: new Date() } : {}),
    };
    await tx.order.update({ where: { id }, data });
    await audit(tx, s.userId, "UPDATE", "Order", id, { contractAmount: o.contractAmount, contractNo: o.contractNo, contractFile: o.contractFile }, data);
  });
  if (saved && o.contractFile && o.contractFile !== saved.stored) await removeContractFile(o.contractFile); // almashtirilgan eski fayl
  revalidatePath(`/orders/${id}`); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  return { ok: true };
}

const importSchema = z.object({
  rows: z.string().min(1, "Excel ma'lumotlari yo'q"),
  defaultDate: zStr("Standart yetkazish sanasi kerak"),
  createCustomers: z.string().optional().transform((v) => v === "on"),
  onCredit: z.string().optional().transform((v) => v === "on"),
  note: zOpt,
});

/**
 * Excel orqali ko'p zayavka (kesishma jadval brauzerda qatorlarga yoyiladi).
 * Mijoz + yetkazish sanasi bo'yicha guruhlanib, har guruh bitta qoralama zayavka bo'ladi.
 * Hammasi o'tsa /orders ga qaytadi; bir qismi o'tmasa (limit, qora ro'yxat) sahifada qolib, sababi yoziladi.
 */
export async function importOrdersFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "import");
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  let rows: ImportOrderRow[];
  try { rows = JSON.parse(d.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows)) return { error: "Excel ma'lumotlari o'qilmadi" };

  let res;
  try {
    res = await importOrders(
      { rows, defaultDate: d.defaultDate, createCustomers: d.createCustomers, onCredit: d.onCredit, note: d.note },
      s.userId,
    );
  } catch (e) {
    return { error: userError(e) };
  }

  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers"); revalidatePath("/production"); revalidatePath("/cashflow");
  if (!res.failed.length && !res.noPrice.length && !res.duplicates.length) redirect(`/orders?imported=${res.orders.length}`);
  // Diqqat qilinadigan joyi bor — sahifada qoladi va nimaga e'tibor berish kerakligi yoziladi
  const list = (l: string[], n = 5) => `${l.slice(0, n).join(", ")}${l.length > n ? "…" : ""}`;
  return {
    ok: true,
    note: [
      `${res.orders.length} ta zayavka ochildi (${res.lines} ta qator)`,
      res.createdCustomers.length ? `yangi mijoz: ${list(res.createdCustomers)}` : "",
      res.noPrice.length ? `narxi 0 bo'lgan mahsulot: ${list(res.noPrice)} — zayavkada narxni to'g'rilang` : "",
      res.duplicates.length ? `${res.duplicates.length} tasi avval import qilingan — takror ochilmadi: ${list(res.duplicates.map((d) => `${d.customer} (${d.date})`), 3)}` : "",
      res.failed.length ? `${res.failed.length} ta zayavka ochilmadi: ${res.failed.slice(0, 3).map((f) => `${f.customer} (${f.date}) — ${f.error}`).join("; ")}` : "",
    ].filter(Boolean).join(" · "),
  };
}
