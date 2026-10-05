import { db } from "@/lib/db";
import { ensureSite } from "@/lib/logistics";
import { audit } from "@/lib/audit";
import { canDoByUserId } from "@/lib/auth";
import { customerCredit, DEFAULT_CREDIT_LIMIT } from "@/lib/finance";
import { nextNo } from "@/lib/numbering";
import { money } from "@/lib/format";
import { routeDistance, type Distance } from "@/lib/geo";
import { notifyAfter, notifyRoles, notifyUsers } from "@/lib/notify";
import { syncCustomerLater } from "@/lib/eco/customers";
import { expectedAdvance } from "@/lib/payments";
import type { Prisma } from "@/generated/prisma";
import { MAX_AMOUNT } from "@/lib/action";

/**
 * Zayavka holat o'tishlari — yagona joy (reyslar uchun `lib/trips.ts` qanday bo'lsa, shunday).
 * Veb ERP server action'lari ham, mobil ilova API'si ham shu funksiyalarni chaqiradi:
 * qoida ikkita joyda ikki xil bo'lib ketmasligi uchun.
 *
 * Sessiya/ruxsat tekshiruvi va `revalidatePath` — chaqiruvchida.
 */
export type OrderResult = { changed: boolean; status?: string; error?: string };

/** m³ birligidagi (beton) qatorlar yig'indisi — ustun/blok (dona) kunlik beton limitiga kirmaydi. */
const concreteM3 = (items: { qtyM3: unknown; product: { unit: string } }[]) =>
  items.reduce((s, i) => s + (i.product.unit === "m3" ? Number(i.qtyM3) : 0), 0);

/**
 * Kunlik zayavka limiti tekshiruvi (qabul qilishda). Shu yetkazish kuniga tasdiqlangan SALE zayavkalar
 * (CONFIRMED/IN_PRODUCTION/DELIVERED/CLOSED) hajmi va soni hisoblanadi; shu zayavka qo'shilganda
 * direktor qo'ygan chegaradan oshsa — o'zbekcha xato qaytadi. 0/bo'sh chegara — cheklov yo'q.
 */
async function dailyOrderLimitError(
  client: Prisma.TransactionClient | typeof db,
  orderId: string,
  deliveryDate: Date,
  items: { qtyM3: unknown; product: { unit: string } }[],
): Promise<string | null> {
  const c = await client.companySettings.findUnique({ where: { id: "main" }, select: { dailyOrderMaxM3: true, dailyOrderMaxCount: true } });
  const maxM3 = Number(c?.dailyOrderMaxM3 ?? 0);
  const maxCount = Number(c?.dailyOrderMaxCount ?? 0);
  if (maxM3 <= 0 && maxCount <= 0) return null;

  const dayStart = new Date(deliveryDate); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const confirmed = await client.order.findMany({
    where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"] }, deliveryDate: { gte: dayStart, lt: dayEnd }, id: { not: orderId } },
    select: { items: { select: { qtyM3: true, product: { select: { unit: true } } } } },
  });
  const dayStr = dayStart.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

  if (maxCount > 0 && confirmed.length + 1 > maxCount) {
    return `${dayStr} kuniga kunlik zayavka soni chegarasi (${maxCount} ta) to'lgan — allaqachon ${confirmed.length} ta tasdiqlangan. Boshqa kun tanlang yoki direktorga murojaat qiling`;
  }
  if (maxM3 > 0) {
    const existing = confirmed.reduce((s, ord) => s + concreteM3(ord.items), 0);
    const mine = concreteM3(items);
    if (existing + mine > maxM3 + 0.001) {
      return `${dayStr} kuniga kunlik hajm chegarasi (${maxM3} m³) oshib ketadi: tasdiqlangan ${existing} m³ + bu zayavka ${mine} m³. Boshqa kun tanlang yoki direktorga murojaat qiling`;
    }
  }
  return null;
}

/**
 * Qabul qilish: DRAFT → CONFIRMED yoki BLOCKED (kredit limiti yetmasa — direktor ochadi).
 * Limit: qarz + ochiq zayavkalar + shu zayavka ≤ limit.
 */
export async function orderConfirm(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { items: { include: { product: { select: { unit: true } } } }, customer: true } });
  // Amal ruxsati (rol yoki direktor bergan): mijoz zayavkasi — "confirm", sklad zayavkasi — "stock"
  if (!(await canDoByUserId(userId, "orders", o.kind === "STOCK" ? "stock" : "confirm"))) {
    return { changed: false, error: "Zayavkani qabul qilishga ruxsatingiz yo'q — direktordan ruxsat so'rang" };
  }
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
  // Naqd to'lovli zayavka: bosh to'lov reys ochish/yuklashdan oldin majburiy (`prepayShortError`), shuning uchun
  // kutilayotgan, hali kelmagan qismi kredit limitiga yuklanmaydi — limitga faqat qolgan (qarzga ketadigan) qism tushadi.
  const required = o.onCredit ? 0 : expectedAdvance(o);
  const res = await db.$transaction(async (tx) => {
    // Mijoz bo'yicha navbat: bir vaqtda qabul qilingan ikki zayavka limitni birga oshirib yubormasin.
    // Shu zayavkaga olingan avans (u hali DRAFT) mijozning umumiy to'lovi sifatida `used` dan ayirilgan.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credit:" + o.customerId}))`;
    // ── Kunlik zayavka limiti (Sozlamalar → direktor) ──
    // Shu yetkazish kuniga allaqachon tasdiqlangan SALE zayavkalar hajmi (m³) yoki soni chegaradan oshsa — qabul
    // qilinmaydi. `dailyCapacityM3` (kalendar rangi) bilan ARALASHTIRILMAYDI: bu — direktor qo'ygan qattiq cheklov.
    // Kun bo'yicha qulf ostida: turli mijozlarning ikki zayavkasi bir vaqtda qabul qilinsa ham chegara oshmaydi.
    const day = new Date(o.deliveryDate); day.setHours(0, 0, 0, 0);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"orderday:" + day.toISOString()}))`;
    const limitErr = await dailyOrderLimitError(tx, o.id, o.deliveryDate, o.items);
    if (limitErr) return { error: limitErr };
    const credit = await customerCredit(o.customerId);
    const advance = await tx.payment.aggregate({ where: { orderId: id }, _sum: { amount: true } });
    const pending = Math.max(0, required - Number(advance._sum.amount ?? 0));
    const exposure = total - pending;
    // `net` — ortiqcha to'lov (shu zayavkaning avansi ham) ayirilgan sof holat: to'liq oldindan to'langan zayavka bloklanmaydi.
    // To'liq oldindan to'lovli zayavka (exposure ≤ 0) limitga hech narsa qo'shmaydi — mijozning eski qarzi bo'lsa ham
    // (qora ro'yxat) qabul qilinadi: pul kassaga tushmaguncha reys baribir ochilmaydi (`prepayShortError`).
    const status = exposure > 0.005 && Math.max(0, credit.net) + exposure > credit.limit && credit.net + exposure > credit.limit ? "BLOCKED" : "CONFIRMED";
    const r = await tx.order.updateMany({ where: { id, status: "DRAFT" }, data: { status } });
    if (r.count !== 1) return null;
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status, debt: credit.debt, open: credit.open, total, limit: credit.limit, prepayPending: pending });
    return { status };
  });
  if (!res) return { changed: false, error: "Zayavka shu payt boshqa joyda qabul qilindi" };
  if ("error" in res) return { changed: false, error: res.error };
  const status = res.status;

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
  // Holat sharti bilan: ikki marta bosilsa ikkinchisi hech narsa yozmaydi (audit va bildirishnoma ham takrorlanmaydi)
  const changed = await db.$transaction(async (tx) => {
    const r = await tx.order.updateMany({ where: { id, status: "BLOCKED" }, data: { status: "CONFIRMED" } });
    if (r.count === 0) return false;
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: "BLOCKED" }, { status: "CONFIRMED", by: "director" });
    return true;
  });
  if (!changed) return { changed: false, error: "Zayavka bloklanmagan" };
  // Zayavkani kiritgan sotuvchi kutib turibdi — javobni o'zi so'ramasin
  notifyAfter(async () => {
    await notifyUsers([o.createdById], { type: "ORDER_UNBLOCKED", title: `Blok ochildi — ${o.orderNo}`, body: "Direktor zayavkani tasdiqladi", link: { key: "orders", id } });
    await notifyRoles(["PRODUCTION", "LOGISTICS"], { type: "ORDER_CONFIRMED", title: `Yangi zayavka — ${o.orderNo}`, body: "Blok ochildi, ishga tushiring", link: { key: "orders", id } });
  });
  return { changed: true, status: "CONFIRMED" };
}

/** Bekor qilish. Zames yoki reys boshlangan bo'lsa — mumkin emas. */
export async function orderCancel(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { batches: { where: { cancelledAt: null } }, trips: true, invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNo: true } } } });
  if (o.batches.length || o.trips.length) return { changed: false, error: "Zames yoki reys bor — bekor qilib bo'lmaydi" };
  if (!["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status)) return { changed: false, error: "Bu holatdagi zayavka bekor qilinmaydi" };
  // Schyot qolib ketsa mijoz yetkazilmagan mahsulot uchun qarzdor bo'lib turardi — avval schyot bekor qilinadi.
  // Avans esa yo'qolmaydi: bekor qilingan zayavkadagi to'lov mijozning ortiqcha to'lovi bo'lib qarz/limitni kamaytiradi.
  if (o.invoices.length) return { changed: false, error: `Schyot bor (${o.invoices.map((i) => i.invoiceNo).join(", ")}) — avval uni bekor qiling` };
  const done = await db.$transaction(async (tx) => {
    const r = await tx.order.updateMany({ where: { id, status: { in: ["DRAFT", "BLOCKED", "CONFIRMED"] }, batches: { none: { cancelledAt: null } }, trips: { none: {} } }, data: { status: "CANCELLED" } });
    if (r.count !== 1) return false;
    await tx.brigadeTask.updateMany({ where: { orderId: id, status: { in: ["NEW", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CANCELLED" });
    return true;
  });
  if (!done) return { changed: false, error: "Zayavka shu payt o'zgardi — sahifani yangilang" };
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
  /**
   * Kutilayotgan bosh to'lov (avans). Sotuvchi pulni kassaga yozmaydi: summa `Order.prepayAmount` ga
   * yoziladi, kassir/buxgalterga bildirishnoma ketadi, pulni kassir `/payments` da qabul qiladi.
   * `cashAccountId` — eski mijozlar (mobil ilova) uchun qoldirilgan, e'tiborga olinmaydi.
   */
  prepay?: { amount: number; cashAccountId?: string };
  contractAmount?: number;
  note?: string | null;
};
export type NewOrderResult = { id: string; orderNo: string; customerId: string; onCredit: boolean; contractNo: string | null };

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
  /** `allowPastDate` — Excel importi: eski zayavkalar o'tgan sana bilan ham kiritiladi.
   *  `viaAgent` — sotuv agenti kabinetidan (o'z faylidagi action ruxsatni o'zi tekshirgan): "orders"
   *  moduli tekshiruvi o'tkazib yuboriladi, chunki agent "orders" roliga kirmaydi. */
  opts?: { id?: string; contractFile?: { stored: string; name: string; type: string }; allowPastDate?: boolean; viaAgent?: boolean; viaImport?: boolean },
): Promise<NewOrderResult> {
  // Amal ruxsati: zayavka ochish (rol yoki direktor bergan "create"); agent kabineti o'z ruxsatini o'zi tekshiradi
  // Excel importi (`viaImport`) — chaqiruvchi "import" amalini tekshirgan
  if (!opts?.viaAgent && !opts?.viaImport && !(await canDoByUserId(userId, "orders", "create"))) {
    throw new Error("Zayavka ochishga ruxsatingiz yo'q — direktordan ruxsat so'rang");
  }
  const items = input.items.filter((i) => i.productId && i.qtyM3 > 0);
  if (items.length === 0) throw new Error("Kamida bitta mahsulot qatori kerak");
  if (items.some((i) => !Number.isFinite(i.qtyM3) || i.qtyM3 > 100_000)) throw new Error("Miqdor juda katta (100 000 dan oshmasin)");
  if (items.some((i) => !Number.isFinite(i.price) || i.price < 0)) throw new Error("Narx manfiy bo'lmasin");
  if (items.some((i) => i.price > MAX_AMOUNT)) throw new Error("Narx juda katta");
  if (!input.deliveryAddress.trim()) throw new Error("Obyekt manzili kerak");
  // Yetkazish sanasi: o'qiladigan va kechagidan oldin emas (o'tgan sanaga zayavka kalendarni buzadi)
  const dd = input.deliveryDate.getTime();
  if (!Number.isFinite(dd)) throw new Error("Yetkazish sanasi noto'g'ri");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!opts?.allowPastDate && dd < today.getTime() - 86_400_000) throw new Error("Yetkazish sanasi o'tib ketgan — bugungi yoki keyingi sanani tanlang");
  if (dd > Date.now() + 366 * 86_400_000) throw new Error("Yetkazish sanasi bir yildan uzoq bo'lmasin");

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
  if (total > MAX_AMOUNT) throw new Error("Zayavka summasi juda katta — miqdor va narxni tekshiring");
  const onCredit = !!input.onCredit;

  // ── Shartnoma ──
  const contractAmount = input.contractAmount && input.contractAmount > 0 ? input.contractAmount : null;

  // ── Bosh to'lov (kutilayotgan avans) ──
  // Qarzga olinganda ham bo'lishi mumkin: bir qismi naqd, qolgani kredit limitidan.
  // Sotuvchi kassaga pul yozmaydi — bu faqat va'da: `prepayAmount` ga yoziladi, pulni kassir qabul qiladi.
  const prepay = input.prepay && input.prepay.amount > 0 ? input.prepay : null;
  if (prepay) {
    if (!Number.isFinite(prepay.amount) || prepay.amount > total + 0.005) throw new Error(`Oldindan to'lov ${money(prepay.amount)} zayavka summasidan ${money(total)} katta`);
  }
  const prepayAmount = prepay ? Math.round(prepay.amount * 100) / 100 : null;
  const note = input.note?.trim() || null;

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
    // Qora ro'yxat (limit yo'q yoki to'lgan) — faqat KREDIT bloklanadi: to'liq oldindan to'lovli zayavka ochiladi
    // (yangi qarz tug'dirmaydi, pul kelmaguncha reys ochilmaydi). Qisman avans — qolgani qarz, u ham mumkin emas.
    if (credit.blacklisted && (onCredit || (prepayAmount ?? 0) < total - 0.005)) {
      throw new Error(`Kredit limiti yo'q — faqat oldindan to'lov bilan: ${c.name} uchun bosh to'lov zayavka summasiga teng bo'lsin (${money(total)}). Limit ${money(credit.limit)}, qarz ${money(credit.debt)}, ochiq zayavkalar ${money(credit.open)}.`);
    }
  }

  const res = await db.$transaction(async (tx) => {
    let customerId = input.customerId!;
    if (input.newCustomer) {
      const c = await tx.customer.create({
        data: { name: input.newCustomer.name, phone: input.newCustomer.phone ?? undefined, inn: input.newCustomer.inn ?? undefined, address: input.newCustomer.address ?? undefined, creditLimit: DEFAULT_CREDIT_LIMIT },
      });
      await audit(tx, userId, "CREATE", "Customer", c.id, undefined, { ...c, via: "order-form" });
      customerId = c.id;
    }
    // Obyekt kartasi (Logistika → Obyektlar): mijozning shu manzili — bor bo'lsa o'sha, yo'q bo'lsa yangisi
    const siteId = await ensureSite(tx, customerId, input.deliveryAddress, { lat: input.lat, lng: input.lng });
    const o = await tx.order.create({
      data: {
        ...(opts?.id ? { id: opts.id } : {}),
        orderNo: await nextNo(tx, "order", "Z"),
        customerId,
        siteId,
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
        prepayAmount,
        note: note ?? undefined,
        createdById: userId,
        items: { create: items },
        ...(contractAmount != null ? { contractAmount, contractAt: new Date(), contractNo: await nextNo(tx, "contract", "SH") } : {}),
        ...(opts?.contractFile ? { contractFile: opts.contractFile.stored, contractFileName: opts.contractFile.name, contractFileType: opts.contractFile.type, contractFileAt: new Date() } : {}),
      },
    });
    await audit(tx, userId, "CREATE", "Order", o.id, undefined, { ...o, items, contractAmount });
    return { id: o.id, orderNo: o.orderNo, customerId, onCredit, contractNo: o.contractNo };
  });
  // Kutilayotgan avans: kassir va buxgalter pulni qabul qilib, to'lov formasida shu zayavkani tanlaydi
  if (prepay) {
    notifyAfter(async () => {
      const c = await db.customer.findUnique({ where: { id: res.customerId }, select: { name: true } });
      await notifyRoles(["CASHIER", "ACCOUNTING"], {
        type: "ADVANCE_EXPECTED",
        title: `${res.orderNo} bo'yicha ${money(prepay.amount)} avans kutilmoqda`,
        body: `${c?.name ?? "Mijoz"} · pulni Kassa/bank → «Zayavka (avans)» orqali qabul qiling`,
        link: { key: "orders", id: res.id },
      }, { except: userId });
    });
  }
  // Yangi mijoz ilovaga ham yetsin — telefoni ilovada ro'yxatdan o'tgan bo'lsa hisobi o'sha yerda ulanadi
  if (input.newCustomer) syncCustomerLater(res.customerId);
  return res;
}
