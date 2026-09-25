import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { customerCredit, DEFAULT_CREDIT_LIMIT } from "@/lib/finance";
import { nextNo } from "@/lib/numbering";
import { money } from "@/lib/format";
import { routeDistance, type Distance } from "@/lib/geo";
import { notifyAfter, notifyRoles, notifyUsers } from "@/lib/notify";

/**
 * Zayavka holat o'tishlari — yagona joy (reyslar uchun `lib/trips.ts` qanday bo'lsa, shunday).
 * Veb ERP server action'lari ham, mobil ilova API'si ham shu funksiyalarni chaqiradi:
 * qoida ikkita joyda ikki xil bo'lib ketmasligi uchun.
 *
 * Sessiya/ruxsat tekshiruvi va `revalidatePath` — chaqiruvchida.
 */
export type OrderResult = { changed: boolean; status?: string; error?: string };

/**
 * Qabul qilish: DRAFT → CONFIRMED yoki BLOCKED (kredit limiti yetmasa — direktor ochadi).
 * Limit: qarz + ochiq zayavkalar + shu zayavka ≤ limit.
 */
export async function orderConfirm(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { items: true, customer: true } });
  if (o.status !== "DRAFT") return { changed: false, error: "Faqat qoralama zayavka qabul qilinadi" };

  // Sklad zaxirasi zayavkasida mijoz ham, narx ham yo'q — kredit limiti tekshirilmaydi
  if (o.kind === "STOCK") {
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: "CONFIRMED" } });
      await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CONFIRMED", kind: "STOCK" });
    });
    return { changed: true, status: "CONFIRMED" };
  }

  const total = o.items.reduce((sum, i) => sum + Number(i.qtyM3) * Number(i.price), 0);
  const credit = await customerCredit(o.customerId);
  const status = credit.used + total > credit.limit ? "BLOCKED" : "CONFIRMED";

  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status } });
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status, debt: credit.debt, open: credit.open, total, limit: credit.limit });
  });

  // Bloklangan zayavkani faqat direktor ocha oladi — u bilmasa zayavka turib qoladi.
  // Tasdiqlangani esa ishlab chiqarish va logistikaning ishi: ular kun bo'yi ro'yxatni
  // qayta-qayta ochib ko'rmasin.
  const link = { key: "orders", id };
  notifyAfter(() => status === "BLOCKED"
    ? notifyRoles(["DIRECTOR"], {
        type: "ORDER_BLOCKED",
        title: `Limit oshdi — ${o.orderNo}`,
        body: `${o.customer.name} · ${money(total)}. Blokni oching yoki to'lov kutiladi`,
        link,
      })
    : notifyRoles(["PRODUCTION", "LOGISTICS"], {
        type: "ORDER_CONFIRMED",
        title: `Yangi zayavka — ${o.orderNo}`,
        body: `${o.customer.name} · ${o.deliveryAddress}`,
        link,
      }, { except: userId }));
  return { changed: true, status };
}

/** BLOCKED → CONFIRMED. Faqat direktor (ruxsat chaqiruvchida tekshiriladi). */
export async function orderUnblock(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  if (o.status !== "BLOCKED") return { changed: false, error: "Zayavka bloklanmagan" };
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: "CONFIRMED" } });
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: "BLOCKED" }, { status: "CONFIRMED", by: "director" });
  });
  // Zayavkani kiritgan sotuvchi kutib turibdi — javobni o'zi so'ramasin
  notifyAfter(async () => {
    await notifyUsers([o.createdById], { type: "ORDER_UNBLOCKED", title: `Blok ochildi — ${o.orderNo}`, body: "Direktor zayavkani tasdiqladi", link: { key: "orders", id } });
    await notifyRoles(["PRODUCTION", "LOGISTICS"], { type: "ORDER_CONFIRMED", title: `Yangi zayavka — ${o.orderNo}`, body: "Blok ochildi, ishga tushiring", link: { key: "orders", id } });
  });
  return { changed: true, status: "CONFIRMED" };
}

/** Bekor qilish. Zames yoki reys boshlangan bo'lsa — mumkin emas. */
export async function orderCancel(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { batches: true, trips: true } });
  if (o.batches.length || o.trips.length) return { changed: false, error: "Zames yoki reys bor — bekor qilib bo'lmaydi" };
  if (!["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status)) return { changed: false, error: "Bu holatdagi zayavka bekor qilinmaydi" };
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.brigadeTask.updateMany({ where: { orderId: id, status: { in: ["NEW", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CANCELLED" });
  });
  return { changed: true, status: "CANCELLED" };
}

// ───────────────────────── Yangi zayavka ─────────────────────────

/** `price` — NDS qo'shilgan holdagi kelishilgan narx; `nds` — soliq qo'shilganini eslatib turadi. */
export type NewOrderItem = { productId: string; qtyM3: number; price: number; nds?: boolean };
export type NewOrderInput = {
  /** Mavjud mijoz; `newCustomer` berilsa bo'sh qoldiriladi. */
  customerId?: string;
  newCustomer?: { name: string; phone?: string | null; inn?: string | null; address?: string | null };
  deliveryDate: Date;
  /** Soat ("HH:MM") — endi formada so'ralmaydi, eski importlar uchun ixtiyoriy qolgan. */
  deliveryTime?: string | null;
  deliveryAddress: string;
  /** Obyekt nuqtasi — forma xaritadan beradi. Bo'lmasa zayavka baribir saqlanadi. */
  lat?: number | null;
  lng?: number | null;
  items: NewOrderItem[];
  needsPump?: boolean;
  needsDelivery?: boolean;
  isUrgent?: boolean;
  /** Qarzga — kafolat xati talab qilinadi. Bosh to'lov bunda ham bo'lishi mumkin. */
  onCredit?: boolean;
  prepay?: { amount: number; cashAccountId: string };
  contractAmount?: number;
  note?: string | null;
};
export type NewOrderResult = { id: string; orderNo: string; onCredit: boolean; contractNo: string | null };

/**
 * Zayavka ochish — veb "Yangi zayavka" formasi ham, mobil ilova ham shu yerdan.
 * Tekshiruvlar: mijoz qora ro'yxatda emasmi, INN takrorlanmaydimi, oldindan to'lov
 * summadan oshmaydimi, kassa bormi. Xato bo'lsa `Error` tashlanadi — chaqiruvchi ko'rsatadi.
 *
 * `opts.id` — chaqiruvchi id'ni oldindan bilishi kerak bo'lsa (veb'da shartnoma fayli
 * zayavka id'si bo'yicha saqlanadi, tranzaksiyadan oldin).
 */
export async function createOrder(
  input: NewOrderInput,
  userId: string,
  opts?: { id?: string; contractFile?: { stored: string; name: string; type: string } },
): Promise<NewOrderResult> {
  const items = input.items.filter((i) => i.productId && i.qtyM3 > 0);
  if (items.length === 0) throw new Error("Kamida bitta mahsulot qatori kerak");
  if (items.some((i) => i.price < 0)) throw new Error("Narx manfiy bo'lmasin");
  if (!input.deliveryAddress.trim()) throw new Error("Obyekt manzili kerak");

  // Zavoddan obyektgacha yo'l — nuqta berilgan va zavod joyi sozlangan bo'lsa
  let dist: Distance | null = null;
  if (input.lat != null && input.lng != null) {
    const plant = await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } });
    if (plant?.lat != null && plant?.lng != null) {
      dist = await routeDistance({ lat: plant.lat, lng: plant.lng }, { lat: input.lat, lng: input.lng });
    }
  }
  // Soat majburiy emas — berilgan bo'lsa formati tekshiriladi
  if (input.deliveryTime && !/^\d{2}:\d{2}$/.test(input.deliveryTime)) throw new Error("Yetkazish soati formati: 09:30");

  const total = items.reduce((s, i) => s + i.qtyM3 * i.price, 0);
  const onCredit = !!input.onCredit;

  // ── Shartnoma ──
  const contractAmount = input.contractAmount && input.contractAmount > 0 ? input.contractAmount : null;

  // ── Bosh to'lov ──
  // Qarzga olinganda ham bo'lishi mumkin: bir qismi naqd, qolgani kredit limitidan.
  const prepay = input.prepay && input.prepay.amount > 0 ? input.prepay : null;
  if (prepay) {
    if (prepay.amount > total + 0.005) throw new Error(`Oldindan to'lov ${money(prepay.amount)} zayavka summasidan ${money(total)} katta`);
    const acc = await db.cashAccount.findUnique({ where: { id: prepay.cashAccountId } });
    if (!acc || !acc.isActive) throw new Error("Kassa/hisob topilmadi");
  }

  // ── Mijoz ──
  if (input.newCustomer) {
    if (!input.newCustomer.name.trim()) throw new Error("Yangi mijoz nomi to'ldirilishi shart");
    if (input.newCustomer.inn) {
      const dup = await db.customer.findUnique({ where: { inn: input.newCustomer.inn } });
      if (dup) throw new Error(`Bu INN bilan mijoz allaqachon bor: ${dup.name}. Uni ro'yxatdan tanlang.`);
    }
  } else {
    if (!input.customerId) throw new Error("Mijoz tanlanmagan");
    const c = await db.customer.findUnique({ where: { id: input.customerId } });
    if (!c || !c.isActive) throw new Error("Mijoz topilmadi yoki nofaol");
    const credit = await customerCredit(c.id);
    if (credit.blacklisted) {
      throw new Error(`${c.name} qora ro'yxatda: limit ${money(credit.limit)} to'liq ishlatilgan (qarz ${money(credit.debt)}, ochiq zayavkalar ${money(credit.open)}). Qarz to'langach zayavka ochish mumkin.`);
    }
  }

  return db.$transaction(async (tx) => {
    let customerId = input.customerId!;
    if (input.newCustomer) {
      const c = await tx.customer.create({
        data: { name: input.newCustomer.name, phone: input.newCustomer.phone ?? undefined, inn: input.newCustomer.inn ?? undefined, address: input.newCustomer.address ?? undefined, creditLimit: DEFAULT_CREDIT_LIMIT },
      });
      await audit(tx, userId, "CREATE", "Customer", c.id, undefined, { ...c, via: "order-form" });
      customerId = c.id;
    }
    const o = await tx.order.create({
      data: {
        ...(opts?.id ? { id: opts.id } : {}),
        orderNo: await nextNo(tx, "order", "Z"),
        customerId,
        deliveryDate: input.deliveryDate,
        deliveryTime: input.deliveryTime ?? null,
        deliveryAddress: input.deliveryAddress,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        // Masofa har doim serverda hisoblanadi — brauzerdan kelgan raqamga ishonmaymiz
        ...(dist ? { distanceKm: dist.km, distanceSource: dist.source } : {}),
        needsPump: !!input.needsPump,
        needsDelivery: input.needsDelivery ?? true,
        isUrgent: !!input.isUrgent,
        onCredit,
        note: input.note ?? undefined,
        createdById: userId,
        items: { create: items },
        ...(contractAmount != null ? { contractAmount, contractAt: new Date(), contractNo: await nextNo(tx, "contract", "SH") } : {}),
        ...(opts?.contractFile ? { contractFile: opts.contractFile.stored, contractFileName: opts.contractFile.name, contractFileType: opts.contractFile.type, contractFileAt: new Date() } : {}),
      },
    });
    await audit(tx, userId, "CREATE", "Order", o.id, undefined, { ...o, items, prepay: prepay?.amount ?? 0, contractAmount });
    if (prepay) {
      const p = await tx.payment.create({ data: { customerId, orderId: o.id, cashAccountId: prepay.cashAccountId, amount: prepay.amount, note: `Oldindan to'lov · ${o.orderNo}` } });
      await audit(tx, userId, "CREATE", "Payment", p.id, undefined, { ...p, via: "order-form" });
    }
    return { id: o.id, orderNo: o.orderNo, onCredit, contractNo: o.contractNo };
  });
}
