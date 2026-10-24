"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { createOrder as createOrderDomain, orderConfirm, orderSetDate, orderUnblock } from "@/lib/orders";
import { cancelOrderWithReason, closeStockOrderLib, setGuarantee, setOrderContract } from "@/lib/order-docs";
import { createStockOrder as createStockOrderDomain } from "@/lib/stock-orders";
import { importOrders, type ImportOrderRow } from "@/lib/import-orders";
import { parseForm, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { saveContractFile } from "@/lib/uploads";
import { withNds } from "@/lib/nds";

const schema = z.object({
  // Mijoz: mavjudini tanlash ("existing") yoki shu yerning o'zida yangi ochish ("new")
  customerMode: z.enum(["existing", "new"]).default("existing"),
  customerId: z.string().trim().optional(),
  newName: z.string().trim().optional(),
  newPhone: zOpt,
  newInn: zOpt,
  newAddress: zOpt,
  // "Sana aniqmi?" — Yo'q bo'lsa sana kelmaydi (`dateUnknown=1`), qoralamada keyin belgilanadi
  deliveryDate: zOpt.refine((v) => !v || Number.isFinite(new Date(v).getTime()), "Yetkazish sanasi noto'g'ri"),
  dateUnknown: z.string().optional().transform((v) => v === "1"),
  deliveryAddress: zStr("Obyekt manzili kerak"),
  // Xaritadan belgilangan nuqta; bo'sh bo'lishi mumkin. Masofa serverda hisoblanadi.
  lat: z.coerce.number().optional().catch(undefined),
  lng: z.coerce.number().optional().catch(undefined),
  needsPump: z.string().optional().transform((v) => v === "on"),
  needsDelivery: z.string().optional().transform((v) => v === "on"),
  // Dastavka summasi — faqat «Dastavka kerak» belgilanganda hisobga olinadi (createOrder o'zi nolga tushiradi)
  deliveryFee: z.coerce.number({ message: "Dastavka summasi raqam bo'lsin" }).min(0, "Dastavka summasi manfiy bo'lmasin").max(MAX_AMOUNT, "Dastavka summasi juda katta").default(0),
  isUrgent: z.string().optional().transform((v) => v === "on"),
  payment: z.enum(["prepay", "credit"]).default("prepay"),
  // Bosh to'lov qanday keladi: CASH — naqd (so'rov Kassa xodimiga), BANK — perechisleniye (Buxgalterga).
  // Qarzga zayavkada bosh to'lovsiz yuborilmaydi — createOrder o'zi hal qiladi.
  payMethod: z.enum(["CASH", "BANK"], { message: "To'lov usuli noto'g'ri" }).optional(),
  // Kutilayotgan bosh to'lov (0 — yo'q). Pul kassaga yozilmaydi — kassir `/payments` da qabul qiladi
  prepayAmount: z.coerce.number({ message: "Bosh to'lov raqam bo'lsin" }).min(0, "Bosh to'lov manfiy bo'lmasin").max(MAX_AMOUNT, "Bosh to'lov juda katta").default(0),
  hasContract: z.string().optional().transform((v) => v === "on"), // "Shartnoma qilish" belgilangan
  contractAmount: z.coerce.number({ message: "Shartnoma summasi raqam bo'lsin" }).min(0, "Shartnoma summasi manfiy bo'lmasin").max(MAX_AMOUNT, "Shartnoma summasi juda katta").default(0),
  note: zOpt,
  // Obyekt manzili yonidagi qavs ichidagi izoh (mo'ljal, darvoza…) — zayavka izohining boshiga yoziladi
  addressNote: zOpt,
  // Firma zayavkasida mas'ul shaxs ismi (Firma qatori ostida) — izohning boshiga yoziladi
  contactName: zOpt,
  amoDealId: zOpt,
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

  if (!d.dateUnknown && !d.deliveryDate) return { error: "Yetkazish sanasi aniqmi? «Ha» ni tanlab sanani kiriting yoki «Yo'q» ni belgilang" };
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
        deliveryDate: d.deliveryDate ? new Date(d.deliveryDate) : new Date(),
        dateUnknown: d.dateUnknown,
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
        deliveryFee: d.needsDelivery ? d.deliveryFee : 0,
        isUrgent: d.isUrgent,
        onCredit: d.payment === "credit",
        prepay: d.prepayAmount > 0 ? { amount: d.prepayAmount } : undefined,
        payMethod: d.payMethod,
        contractAmount,
        note: [d.contactName && `Mas'ul shaxs: ${d.contactName}`, d.addressNote && `Obyekt: ${d.addressNote}`, d.note].filter(Boolean).join("\n") || undefined,
        // Kelishuvda mijoz bo'lmasa (webhook usuli) — yangi mijoz bilan ham bog'lanadi; boshqa mijoz bo'lsa linkOrderTx rad etadi
        amoDealId: d.amoDealId ?? null,
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

/** Qoralama zayavkaning yetkazish sanasini belgilash/o'zgartirish ("Sana aniq emas" bo'lib ochilgan bo'lsa ham). */
export async function setOrderDate(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "create");
  const v = String(fd.get("deliveryDate") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: "Yetkazish sanasini tanlang" };
  const r = await orderSetDate(id, new Date(v), s.userId);
  if (r.error) return { error: r.error };
  revalidatePath(`/orders/${id}`); revalidatePath("/orders");
  return { ok: true, note: "Sana saqlandi" };
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

/** Bekor qilish — sabab so'raladi va auditga yoziladi (tasdiq tugmasi `ConfirmButton`). Qoida `lib/order-docs.ts` da — mobil ham shuni chaqiradi. */
export async function cancelOrder(id: string, reason: string): Promise<ActionState> {
  const ord = await db.order.findUnique({ where: { id }, select: { kind: true } });
  if (!ord) return { error: "Zayavka topilmadi" };
  const kind = ord.kind;
  const s = await requireAction("orders", kind === "STOCK" ? "stock" : "cancel");
  const r = await cancelOrderWithReason(id, reason, s.userId);
  if (!r.ok) return { error: r.error };
  revalidatePath(`/orders/${id}`); revalidatePath("/tasks"); revalidatePath("/brigades");
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  return { ok: true, note: "Zayavka bekor qilindi" };
}

/**
 * Sklad zayavkasini yopish: so'ralgan zaxira hovliga chiqarib qo'yilgan.
 * Mijoz zayavkasi bunday yopilmaydi — u schyot/to'lov bo'yicha yopiladi. Qoida `lib/order-docs.ts` da.
 */
export async function closeStockOrder(id: string): Promise<ActionState> {
  const s = await requireAction("orders", "stock");
  const r = await closeStockOrderLib(id, s.userId);
  if (!r.ok) return { error: r.error };
  revalidatePath(`/orders/${id}`); revalidatePath("/orders"); revalidatePath("/production"); revalidatePath("/stock");
  return { ok: true };
}

/** Mijoz imzolagan kafolat xati qabul qilindi / qaytarildi. Qoida `lib/order-docs.ts` da. */
export async function toggleGuarantee(id: string) {
  const s = await requireAction("orders", "contract");
  const o = await db.order.findUniqueOrThrow({ where: { id }, select: { guaranteeAt: true } });
  await setGuarantee(id, !o.guaranteeAt, s.userId);
  revalidatePath(`/orders/${id}`);
}

const contractSchema = z.object({ contractAmount: z.coerce.number().positive("Shartnoma summasi 0 dan katta bo'lsin") });

/**
 * Mavjud zayavkaga shartnoma qo'shish / summasini o'zgartirish / Didox'da imzolangan faylni yuklash (almashtirish).
 * Raqam bir marta beriladi. Fayl `uploads/contracts/` ga yoziladi — qoida `lib/order-docs.ts` da (mobil ham shuni chaqiradi).
 */
export async function setContract(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "contract");
  const r = parseForm(contractSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await setOrderContract(id, r.data.contractAmount, fd.get("contractFile"), s.userId);
  if (!res.ok) return { error: res.error };
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
