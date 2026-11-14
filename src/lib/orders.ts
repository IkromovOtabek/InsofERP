import { db } from "@/lib/db";
import { ensureSite } from "@/lib/logistics";
import { blockKey, blockName, ensureBlocks } from "@/lib/site-blocks";
import { audit } from "@/lib/audit";
import { canDoByUserId } from "@/lib/auth";
import { customerCredit, defaultCreditLimit, type CustomerCredit } from "@/lib/finance";
import { nextNo } from "@/lib/numbering";
import { date, deliveryAt, fmtNum, isoDate, money } from "@/lib/format";
import { routeDistance, type Distance } from "@/lib/geo";
import { notifyAfter, notifyEmployees, notifyRoles, notifyUsers } from "@/lib/notify";
import { syncCustomerLater } from "@/lib/eco/customers";
import { expectedAdvance } from "@/lib/payments";
import type { PayMethod, Prisma, Role } from "@/generated/prisma";
import { cancelPaymentRequestTx, createPaymentRequestTx, notifyNewPaymentRequest, OPEN_STATUSES, syncPaymentRequest } from "@/lib/payment-requests";
import { MAX_AMOUNT } from "@/lib/action";
import { parseInn } from "@/lib/inn";
import { linkOrderTx, syncDealLater } from "@/lib/amocrm/sync";
import { orderTotal } from "@/lib/order-total";
import { purgeOrderTx } from "@/lib/purge-cancelled";
import { orderLines, TRIP_STEP } from "@/lib/trips";
import { fmtUnitTotals } from "@/lib/unit";
import { checkStockSources } from "./brigade-stock-source";

/**
 * Zayavka holat o'tishlari — yagona joy (reyslar uchun `lib/trips.ts` qanday bo'lsa, shunday).
 * Veb ERP server action'lari ham, mobil ilova API'si ham shu funksiyalarni chaqiradi:
 * qoida ikkita joyda ikki xil bo'lib ketmasligi uchun.
 *
 * Sessiya/ruxsat tekshiruvi va `revalidatePath` — chaqiruvchida.
 */
export type OrderResult = { changed: boolean; status?: string; error?: string };

/** Qora ro'yxatdagi mijozga «Qarzga» zayavka xatosi (ochishda va tahrirda bir xil matn). */
const qarzgaYopiq = (name: string, c: CustomerCredit) =>
  `Kredit limiti to'lgan — qarzga berilmaydi: ${name} uchun naqd yoki perechisleniye bilan oching. Limit ${money(c.limit)}, qarz ${money(c.debt)}, ochiq zayavkalar ${money(c.open)}.`;

/**
 * Beton (m³) ishlab chiqarishga tushmaydi: zayavka qabul qilingach to'g'ridan-to'g'ri logistikaga — reys ochiladi.
 * Faqat betondan iborat zayavka haqida sex xabardor qilinmaydi; dona mahsulot qatori bo'lsa — ishlab chiqarish ham.
 */
const crewRoles = (units: string[]): Role[] => (units.length && units.every((u) => u === "m3") ? ["LOGISTICS"] : ["PRODUCTION", "LOGISTICS"]);

/** m³ birligidagi (beton) qatorlar yig'indisi — ustun/blok (dona) kunlik beton limitiga kirmaydi. */
const concreteM3 = (items: { qtyM3: unknown; product: { unit: string } }[]) =>
  items.reduce((s, i) => s + (i.product.unit === "m3" ? Number(i.qtyM3) : 0), 0);

/** Kunlik limit xatosidan keyingi maslahat: qabul qiluvchi (sotuvchi) uchun — sukut; blok ochuvchi direktor uchun — o'zi;
 *  direktor ruxsati bilan blok ochuvchi boshqa xodim uchun — direktorga yo'llanma (Sozlamalar unga yopiq). */
const DAILY_LIMIT_HINT_SELLER = "Boshqa yetkazish kuniga zayavka oching yoki direktor limitni Sozlamalar → Limitlar'da oshirsin";
const DAILY_LIMIT_HINT_DIRECTOR = "Limitni Sozlamalar → Limitlar'da oshiring yoki yetkazish sanasini o'zgartiring (zayavkani bekor qilib, boshqa kunga qayta oching)";
const DAILY_LIMIT_HINT_UNBLOCKER = "Zayavkani boshqa yetkazish kuniga qayta oching yoki direktor kunlik limitni Sozlamalar → Limitlar'da oshirsin";

/**
 * Kunlik zayavka limiti tekshiruvi (qabul qilishda va blokni ochishda). Shu yetkazish kuniga tasdiqlangan SALE
 * zayavkalar (CONFIRMED/IN_PRODUCTION/DELIVERED/CLOSED) hajmi va soni hisoblanadi; shu zayavka qo'shilganda
 * direktor qo'ygan chegaradan (Sozlamalar → Limitlar) oshsa — o'zbekcha xato qaytadi. 0/bo'sh chegara — cheklov yo'q.
 * DRAFT/BLOCKED/CANCELLED sanoqqa kirmaydi — shuning uchun blok ochilganda ham qayta tekshiriladi.
 *
 * Chegarada: limitga AYNAN TENG bo'lsa — ruxsat, oshsa — rad.
 *   · son:  tasdiqlangan + 1 ≤ maxCount → ruxsat;
 *   · hajm: tasdiqlangan m³ + shu zayavka m³ ≤ maxM3 + 0.001 → ruxsat (0.001 — float yig'indisi xatosi uchun
 *     zaxira: 0.1 + 0.2 kabi yig'indi teng holatni rad etmasin; shu sabab 0.001 m³ gacha ortiqcha ham o'tadi).
 * Kasr m³: `qtyM3` (Decimal 18,3) `Number()` bilan aniq songa o'tadi (7.5 → 7.5), yaxlitlanmaydi.
 * Hajmga faqat m³ birligidagi qatorlar kiradi (`concreteM3`), son esa barcha SALE zayavkalarni sanaydi.
 */
async function dailyOrderLimitError(
  client: Prisma.TransactionClient | typeof db,
  orderId: string,
  deliveryDate: Date,
  items: { qtyM3: unknown; product: { unit: string } }[],
  hint: string = DAILY_LIMIT_HINT_SELLER,
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
  const dayStr = date(dayStart);

  if (maxCount > 0 && confirmed.length + 1 > maxCount) {
    return `${dayStr} kuniga kunlik zayavka soni limiti to'lgan: limit ${fmtNum(maxCount)} ta, allaqachon ${fmtNum(confirmed.length)} ta tasdiqlangan. ${hint}`;
  }
  if (maxM3 > 0) {
    const existing = confirmed.reduce((s, ord) => s + concreteM3(ord.items), 0);
    const mine = concreteM3(items);
    if (existing + mine > maxM3 + 0.001) {
      return `${dayStr} kuniga kunlik hajm limiti oshib ketadi: limit ${fmtNum(maxM3, 3)} m³, tasdiqlangan ${fmtNum(existing, 3)} m³ + bu zayavka ${fmtNum(mine, 3)} m³ = ${fmtNum(existing + mine, 3)} m³. ${hint}`;
    }
  }
  return null;
}

/**
 * Zayavka qabul qilish va blokni ochishdagi qulflar — tartib DOIM bir xil: avval mijoz (`credit:`), keyin
 * yetkazish kuni (`orderday:`). `orderConfirm` ham, `orderUnblock` ham shu yerdan oladi: tartib yoki kalit
 * ikki joyda farq qilsa, ikki tranzaksiya bir-birining qulfini kutib qoladi (deadlock) yoki navbat ishlamaydi.
 */
async function lockCreditAndDay(tx: Prisma.TransactionClient, customerId: string, deliveryDate: Date) {
  // Mijoz bo'yicha navbat: bir vaqtda qabul qilingan ikki zayavka limitni birga oshirib yubormasin.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credit:" + customerId}))`;
  // Kun bo'yicha navbat: turli mijozlarning ikki zayavkasi bir vaqtda qabul qilinsa ham kunlik limit oshmaydi.
  const day = new Date(deliveryDate); day.setHours(0, 0, 0, 0);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"orderday:" + day.toISOString()}))`;
}

/**
 * Qabul qilish: DRAFT → CONFIRMED yoki BLOCKED (kredit limiti yetmasa — direktor ochadi).
 * Limit: «Qarzga» — qarz + ochiq zayavkalar + shu zayavka ≤ limit. «Naqd» / «Perechisleniye» — zayavka limitga
 * tushmaydi va bloklanmaydi (pul yetkazilgandan keyin keladi), mijoz qarzdor bo'lsa ham.
 */
export async function orderConfirm(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { items: { include: { product: { select: { unit: true } } } }, customer: true } });
  // Amal ruxsati (rol yoki direktor bergan): mijoz zayavkasi — "confirm", sklad zayavkasi — "stock"
  if (!(await canDoByUserId(userId, "orders", o.kind === "STOCK" ? "stock" : "confirm"))) {
    return { changed: false, error: "Zayavkani qabul qilishga ruxsatingiz yo'q — direktordan ruxsat so'rang" };
  }
  if (o.status !== "DRAFT") return { changed: false, error: "Faqat qoralama zayavka qabul qilinadi" };
  if (o.dateUnknown) return { changed: false, error: "Yetkazish sanasi aniq emas — avval sanani belgilang" };

  // Sklad zaxirasi zayavkasida mijoz ham, narx ham yo'q — kredit limiti tekshirilmaydi
  if (o.kind === "STOCK") {
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: "CONFIRMED" } });
      await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CONFIRMED", kind: "STOCK" });
    });
    return { changed: true, status: "CONFIRMED" };
  }

  const total = orderTotal(o);
  // Naqd/perechisleniye zayavkada bosh to'lov reys ochish/yuklashdan oldin majburiy (`prepayShortError`)
  const required = o.onCredit ? 0 : expectedAdvance(o);
  const res = await db.$transaction(async (tx) => {
    // Qulflar (avval mijoz, keyin kun — `lockCreditAndDay`): mijoz bo'yicha va yetkazish kuni bo'yicha navbat.
    // Shu zayavkaga olingan avans (u hali DRAFT) mijozning umumiy to'lovi sifatida `used` dan ayirilgan.
    await lockCreditAndDay(tx, o.customerId, o.deliveryDate);
    // ── Kunlik zayavka limiti (Sozlamalar → Limitlar, direktor) ──
    // Shu yetkazish kuniga allaqachon tasdiqlangan SALE zayavkalar hajmi (m³) yoki soni chegaradan oshsa — qabul
    // qilinmaydi. `dailyCapacityM3` (kalendar rangi) bilan ARALASHTIRILMAYDI: bu — direktor qo'ygan qattiq cheklov.
    const limitErr = await dailyOrderLimitError(tx, o.id, o.deliveryDate, o.items);
    if (limitErr) return { error: limitErr };
    const credit = await customerCredit(o.customerId);
    const paid = Number((await tx.payment.aggregate({ where: { orderId: id }, _sum: { amount: true } }))._sum.amount ?? 0);
    const pending = Math.max(0, required - paid);
    // «Naqd» / «Perechisleniye» hech qachon bloklanmaydi: pul yetkazilgandan keyin keladi, jo'natilgani keyin
    // `orderExposure` bo'yicha qarz bo'lib limitga kiradi. Bloklash faqat «Qarzga»da: butun summa limitdan joy band qiladi;
    // `net` — ortiqcha to'lov (shu zayavkaning avansi ham) ayirilgan sof holat, oldindan to'liq to'langani bloklanmaydi.
    const status: "BLOCKED" | "CONFIRMED" = o.onCredit && paid < total - 0.005 && total > 0.005
      && Math.max(0, credit.net) + total > credit.limit && credit.net + total > credit.limit ? "BLOCKED" : "CONFIRMED";
    const r = await tx.order.updateMany({ where: { id, status: "DRAFT", dateUnknown: false }, data: { status } });
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
        title: "Limit oshdi",
        body: `${o.customer.name} · ${money(total)}. Blokni oching yoki to'lov kutiladi`,
        link,
      })
    : notifyRoles(crewRoles(o.items.map((i) => i.product.unit)), {
        type: "ORDER_CONFIRMED",
        title: "Yangi zayavka",
        body: `${o.customer.name} · ${o.deliveryAddress}`,
        link,
      }, { except: userId }));
  // Agent (yoki boshqa xodim) ochgan zayavka qabul qilindi/bloklandi — muallif mijozga javob beradi
  if (o.createdById !== userId) {
    notifyAfter(() => notifyUsers([o.createdById], {
      type: status === "BLOCKED" ? "ORDER_BLOCKED" : "ORDER_CONFIRMED",
      title: status === "BLOCKED" ? `Zayavka bloklandi — ${o.customer.name}` : "Zayavka qabul qilindi",
      body: status === "BLOCKED" ? "Kredit limiti oshgan — direktor qarorini kutmoqda"
        : `${o.customer.name} · ${crewRoles(o.items.map((i) => i.product.unit)).includes("PRODUCTION") ? "ishlab chiqarishga" : "logistikaga"} o'tdi`,
      link,
    }));
  }
  return { changed: true, status };
}

/**
 * Qoralama zayavkaning yetkazish sanasini belgilash/o'zgartirish ("Sana aniq emas" bo'lib ochilganida ham).
 * Faqat DRAFT: qabul qilingandan keyin sana ishlab chiqarish va reys rejasiga bog'lanadi.
 */
export async function orderSetDate(id: string, deliveryDate: Date, userId: string): Promise<OrderResult> {
  const o = await db.order.findUnique({ where: { id }, select: { status: true, kind: true, deliveryDate: true, dateUnknown: true } });
  if (!o) return { changed: false, error: "Zayavka topilmadi" };
  if (!(await canDoByUserId(userId, "orders", o.kind === "STOCK" ? "stock" : "create"))) {
    return { changed: false, error: "Zayavkani tahrirlashga ruxsatingiz yo'q — direktordan ruxsat so'rang" };
  }
  if (o.status !== "DRAFT") return { changed: false, error: "Sana faqat qoralama zayavkada o'zgartiriladi" };
  const dd = deliveryDate.getTime();
  if (!Number.isFinite(dd)) return { changed: false, error: "Yetkazish sanasi noto'g'ri" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dd < today.getTime()) return { changed: false, error: "Yetkazish sanasi o'tib ketgan — bugungi yoki keyingi sanani tanlang" };
  if (dd > Date.now() + 366 * 86_400_000) return { changed: false, error: "Yetkazish sanasi bir yildan uzoq bo'lmasin" };
  const ok = await db.$transaction(async (tx) => {
    const r = await tx.order.updateMany({ where: { id, status: "DRAFT" }, data: { deliveryDate, dateUnknown: false } });
    if (r.count !== 1) return false;
    await audit(tx, userId, "UPDATE", "Order", id, { deliveryDate: o.deliveryDate, dateUnknown: o.dateUnknown }, { deliveryDate, dateUnknown: false });
    return true;
  });
  if (!ok) return { changed: false, error: "Zayavka shu payt qabul qilindi yoki bekor qilindi" };
  return { changed: true };
}

/** Ishlab chiqarish doskasidan ko'chirish mumkin bo'lgan holatlar — yetkazilgan/yopilgan/bekor qilingan ko'chirilmaydi. */
const MOVABLE = ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION"] as const;

/**
 * Ishlab chiqarish doskasida zayavkani boshqa yetkazish kuniga ko'chirish (qabul qilingan zayavka ham).
 * Qabul qilingan SALE zayavka yangi kunning kunlik limitiga qayta tekshiriladi (`orderConfirm` dagi kun qulfi bilan);
 * brigada topshiriqlari va bosh to'lov so'rovining muddati ham yangi sanaga o'tadi. Zayavka egasiga xabar boradi.
 */
export async function orderReschedule(id: string, deliveryDate: Date, userId: string): Promise<OrderResult> {
  if (!(await canDoByUserId(userId, "production", "reschedule"))) {
    return { changed: false, error: "Sanani o'zgartirishga ruxsatingiz yo'q — direktordan ruxsat so'rang" };
  }
  const dd = deliveryDate.getTime();
  if (!Number.isFinite(dd)) return { changed: false, error: "Yetkazish sanasi noto'g'ri" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dd < today.getTime()) return { changed: false, error: "O'tgan sanaga ko'chirib bo'lmaydi — bugungi yoki keyingi sanani tanlang" };
  if (dd > Date.now() + 366 * 86_400_000) return { changed: false, error: "Yetkazish sanasi bir yildan uzoq bo'lmasin" };
  const o = await db.order.findUnique({
    where: { id },
    select: { status: true, kind: true, deliveryDate: true, dateUnknown: true, createdById: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } } },
  });
  if (!o) return { changed: false, error: "Zayavka topilmadi" };
  if (!(MOVABLE as readonly string[]).includes(o.status)) return { changed: false, error: "Yetkazilgan, yopilgan yoki bekor qilingan zayavka ko'chirilmaydi" };
  if (!o.dateUnknown && o.deliveryDate.getTime() === dd) return { changed: false };

  const res = await db.$transaction(async (tx) => {
    if (o.kind === "SALE" && (o.status === "CONFIRMED" || o.status === "IN_PRODUCTION")) {
      const day = new Date(deliveryDate); day.setHours(0, 0, 0, 0);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"orderday:" + day.toISOString()}))`;
      const limitErr = await dailyOrderLimitError(tx, id, deliveryDate, o.items, "Boshqa kunni tanlang yoki direktor limitni Sozlamalar → Limitlar'da oshirsin");
      if (limitErr) return { error: limitErr };
    }
    // Holat sharti bilan: shu orada yetkazilgan/bekor qilingan zayavka ko'chirilmaydi
    const r = await tx.order.updateMany({ where: { id, status: { in: [...MOVABLE] } }, data: { deliveryDate, dateUnknown: false } });
    if (r.count !== 1) return { error: "Zayavka shu payt yetkazildi yoki bekor qilindi" };
    await tx.brigadeTask.updateMany({ where: { orderId: id, status: { notIn: ["DONE", "CANCELLED"] } }, data: { dueDate: deliveryDate } });
    await tx.paymentRequest.updateMany({ where: { orderId: id, status: { in: ["PENDING", "PARTIAL"] } }, data: { dueDate: deliveryDate } });
    await audit(tx, userId, "UPDATE", "Order", id, { deliveryDate: o.deliveryDate, dateUnknown: o.dateUnknown }, { deliveryDate, dateUnknown: false });
    return null;
  });
  if (res) return { changed: false, error: res.error };
  if (o.createdById !== userId) {
    notifyAfter(() => notifyUsers([o.createdById], {
      type: "ORDER_RESCHEDULED", title: `Sana o'zgardi — ${o.customer.name}`,
      body: `Yetkazish sanasi ${o.dateUnknown ? "belgilandi" : `${date(o.deliveryDate)} dan ko'chirildi`}: ${date(deliveryDate)}`, link: { key: "orders", id },
    }));
  }
  return { changed: true };
}

/**
 * BLOCKED → CONFIRMED. Faqat direktor (ruxsat chaqiruvchida tekshiriladi).
 * Direktor faqat KREDIT limitini chetlab o'tadi; kunlik zayavka limiti (hajm/son) qayta tekshiriladi: BLOCKED zayavka
 * qabul paytida kunlik sanoqqa kirmagan, shu orada o'sha kun boshqa zayavkalar bilan to'lgan bo'lishi mumkin.
 * Sklad (STOCK) zayavkasi kunlik limitga kirmaydi (limit faqat SALE).
 */
export async function orderUnblock(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { items: { select: { qtyM3: true, product: { select: { unit: true } } } }, customer: { select: { name: true } } } });
  if (o.status !== "BLOCKED") return { changed: false, error: "Zayavka bloklanmagan" };
  const res = await db.$transaction(async (tx) => {
    if (o.kind === "SALE") {
      // `orderConfirm` bilan bir xil qulf tartibi (avval mijoz, keyin kun) — deadlock bo'lmasin; blok ochilishi
      // mijozning ochiq zayavkalarini ham oshiradi, shuning uchun mijoz navbati ham kerak.
      await lockCreditAndDay(tx, o.customerId, o.deliveryDate);
      // Blokni direktor bergan ruxsat bilan boshqa xodim ham ochishi mumkin — Sozlamalar esa faqat direktorga ochiq,
      // shuning uchun maslahat kim ochayotganiga qarab
      const opener = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      const isDirector = opener?.role === "DIRECTOR" || opener?.role === "SUPERADMIN";
      const limitErr = await dailyOrderLimitError(tx, o.id, o.deliveryDate, o.items, isDirector ? DAILY_LIMIT_HINT_DIRECTOR : DAILY_LIMIT_HINT_UNBLOCKER);
      if (limitErr) return { error: `Blok ochilmadi — ${limitErr}` };
    }
    // Holat sharti bilan: ikki marta bosilsa ikkinchisi hech narsa yozmaydi (audit va bildirishnoma ham takrorlanmaydi)
    const r = await tx.order.updateMany({ where: { id, status: "BLOCKED" }, data: { status: "CONFIRMED" } });
    if (r.count === 0) return null;
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: "BLOCKED" }, { status: "CONFIRMED", by: "director" });
    return { ok: true as const };
  });
  if (!res) return { changed: false, error: "Zayavka bloklanmagan" };
  if ("error" in res) return { changed: false, error: res.error };
  // Zayavkani kiritgan sotuvchi kutib turibdi — javobni o'zi so'ramasin
  notifyAfter(async () => {
    await notifyUsers([o.createdById], { type: "ORDER_UNBLOCKED", title: `Blok ochildi — ${o.customer.name}`, body: "Direktor zayavkani tasdiqladi", link: { key: "orders", id } });
    await notifyRoles(crewRoles(o.items.map((i) => i.product.unit)), { type: "ORDER_CONFIRMED", title: `Yangi zayavka — ${o.customer.name}`, body: "Blok ochildi, ishga tushiring", link: { key: "orders", id } });
  });
  return { changed: true, status: "CONFIRMED" };
}

class PurgeFailed extends Error {}

/**
 * Bekor qilish. Zames, reys yoki brigada qaydi bo'lsa — mumkin emas.
 * Bekor qilingan zayavka shu tranzaksiyada bazadan o'chiriladi (`lib/purge-cancelled.ts`) — hech qayerda qolmaydi.
 */
export async function orderCancel(id: string, userId: string): Promise<OrderResult> {
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { items: { select: { product: { select: { unit: true } } } }, batches: { where: { cancelledAt: null } }, trips: { where: { status: { not: "CANCELLED" } } }, invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNo: true } }, customer: { select: { name: true } } } });
  if (o.batches.length || o.trips.length) return { changed: false, error: "Zames yoki reys bor — bekor qilib bo'lmaydi" };
  // Brigada qayd qilgan ish oyligiga kirgan — topshiriq bilan zayavka o'chirilsa oylik yo'qoladi
  if (await db.taskProgress.count({ where: { task: { orderId: id } } })) return { changed: false, error: "Brigada ishlab chiqarishni boshlagan (qayd bor) — zayavkani bekor qilib bo'lmaydi" };
  if (!["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status)) return { changed: false, error: "Bu holatdagi zayavka bekor qilinmaydi" };
  // Schyot qolib ketsa mijoz yetkazilmagan mahsulot uchun qarzdor bo'lib turardi — avval schyot bekor qilinadi.
  // Avans esa yo'qolmaydi: bekor qilingan zayavkadagi to'lov mijozning ortiqcha to'lovi bo'lib qarz/limitni kamaytiradi.
  if (o.invoices.length) return { changed: false, error: `Schyot bor (${o.invoices.map((i) => i.invoiceNo).join(", ")}) — avval uni bekor qiling` };
  // Bekor qilinadigan topshiriqlar brigadirlari — ular sexda ishni boshlab qo'ymasin
  const openTasks = await db.brigadeTask.findMany({ where: { orderId: id, status: { in: ["NEW", "IN_PROGRESS"] } }, select: { brigade: { select: { leaderId: true } } } });
  const done = await db.$transaction(async (tx) => {
    const r = await tx.order.updateMany({ where: { id, status: { in: ["DRAFT", "BLOCKED", "CONFIRMED"] }, batches: { none: { cancelledAt: null } }, trips: { every: { status: "CANCELLED" } } }, data: { status: "CANCELLED" } });
    if (r.count !== 1) return false;
    await tx.brigadeTask.updateMany({ where: { orderId: id, status: { in: ["NEW", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
    // Bosh to'lov so'rovi kassir/buxgalter ro'yxatidan tushadi (tushgan avans mijozda ortiqcha to'lov bo'lib qoladi)
    await cancelPaymentRequestTx(tx, id, userId);
    await audit(tx, userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CANCELLED" });
    // Bekor qilingan zayavka hech qayerda qolmaydi — shu yerning o'zida o'chadi (o'chmasa hammasi orqaga qaytadi)
    if (!(await purgeOrderTx(tx, id, userId))) throw new PurgeFailed();
    return true;
  }).catch((e) => { if (e instanceof PurgeFailed) return "purge" as const; throw e; });
  if (done === "purge") return { changed: false, error: "Zayavkani o'chirib bo'lmadi — unga bog'langan hujjat bor" };
  if (!done) return { changed: false, error: "Zayavka shu payt o'zgardi — sahifani yangilang" };
  // Tasdiqlangan zayavkani sex va logistika rejalashtirgan bo'lishi mumkin — bekor qilingani darhol bilinsin.
  // Havolasiz: zayavka o'chirilgan, ochiladigan sahifa yo'q
  notifyAfter(async () => {
    const n = { type: "ORDER_CANCELLED", title: `Zayavka bekor qilindi — ${o.customer.name}`, body: `${o.orderNo} · ${o.deliveryAddress} — ${o.status === "CONFIRMED" ? "ishlab chiqarish va reys rejalashtirmang" : "qoralama bekor qilindi"}` };
    if (o.status === "CONFIRMED") await notifyRoles(crewRoles(o.items.map((i) => i.product.unit)), n, { except: userId });
    await notifyUsers([o.createdById].filter((u) => u !== userId), n);
    const leaders = openTasks.map((t) => t.brigade.leaderId);
    if (leaders.length) await notifyEmployees(leaders, { ...n, title: `Topshiriq bekor qilindi — ${o.customer.name}`, body: "Zayavka bekor qilindi, ishni to'xtating" });
  });
  return { changed: true, status: "CANCELLED" };
}

// ───────────────────────── Yangi zayavka ─────────────────────────

/** `price` — NDS qo'shilgan holdagi kelishilgan narx; `nds` — soliq qo'shilganini eslatib turadi. */
export type NewOrderItem = {
  productId: string; qtyM3: number; price: number; nds?: boolean;
  /** Obyekt bloki nomi («A blok»): obyektda yo'q bo'lsa qo'shiladi (`lib/site-blocks.ts`) */
  block?: string | null;
  /** «Brigadadan olish»: tayyor mahsulot shu brigada omboridan beriladi (`lib/brigade-stock-source.ts`); faqat dona mahsulot */
  stockBrigadeId?: string | null;
};
export type NewOrderInput = {
  /** Mavjud mijoz; `newCustomer` berilsa bo'sh qoldiriladi. */
  customerId?: string;
  newCustomer?: { name: string; phone?: string | null; inn?: string | null; address?: string | null };
  deliveryDate: Date;
  /** Sana hali aniq emas — `deliveryDate` e'tiborga olinmaydi (bugun yoziladi), qoralamada keyin belgilanadi. */
  dateUnknown?: boolean;
  /** Soat ("HH:MM") — endi formada so'ralmaydi, eski importlar uchun ixtiyoriy qolgan. */
  deliveryTime?: string | null;
  deliveryAddress: string;
  /** Obyekt nuqtasi — forma xaritadan beradi. Bo'lmasa zayavka baribir saqlanadi. */
  lat?: number | null;
  lng?: number | null;
  items: NewOrderItem[];
  needsPump?: boolean;
  needsDelivery?: boolean;
  /** Dastavka summasi (so'm) — zayavka summasiga qo'shiladi; `needsDelivery` yo'q bo'lsa e'tiborga olinmaydi. */
  deliveryFee?: number | null;
  isUrgent?: boolean;
  /** Qarzga — kafolat xati talab qilinadi. Bosh to'lov bunda ham bo'lishi mumkin. */
  onCredit?: boolean;
  /**
   * Kutilayotgan bosh to'lov (avans). Sotuvchi pulni kassaga yozmaydi: summa `Order.prepayAmount` ga
   * yoziladi, kassir/buxgalterga bildirishnoma ketadi, pulni kassir `/payments` da qabul qiladi.
   * `cashAccountId` — eski mijozlar (mobil ilova) uchun qoldirilgan, e'tiborga olinmaydi.
   */
  prepay?: { amount: number; cashAccountId?: string };
  /**
   * Bosh to'lov qanday keladi: CASH — naqd (so'rov Kassa xodimiga), BANK — perechisleniye (so'rov Buxgalterga).
   * Berilmasa — CASH (eski mijozlar: agent kabineti, Excel importi, eski mobil ilova).
   */
  payMethod?: PayMethod | null;
  contractAmount?: number;
  note?: string | null;
  /** amoCRM kelishuvidan ochilgan zayavka (`/orders/new?amo=`) — holati sdelkaga qaytariladi */
  amoDealId?: string | null;
};
export type NewOrderResult = { id: string; orderNo: string; customerId: string; onCredit: boolean; contractNo: string | null; requestId?: string | null };

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
  const items = input.items.filter((i) => i.productId && i.qtyM3 > 0).map((i) => ({ ...i, stockBrigadeId: i.stockBrigadeId || null }));
  if (items.length === 0) throw new Error("Kamida bitta mahsulot qatori kerak");
  if (items.some((i) => !Number.isFinite(i.qtyM3) || i.qtyM3 > 100_000)) throw new Error("Miqdor juda katta (100 000 dan oshmasin)");
  const srcErr = await checkStockSources(db, items);
  if (srcErr) throw new Error(srcErr);
  if (items.some((i) => !Number.isFinite(i.price) || i.price < 0)) throw new Error("Narx manfiy bo'lmasin");
  if (items.some((i) => i.price > MAX_AMOUNT)) throw new Error("Narx juda katta");
  if (!input.deliveryAddress.trim()) throw new Error("Obyekt manzili kerak");
  // Sana aniq emas — vaqtinchalik qiymat (bugun); kalendarga tushmaydi, qabul qilishdan oldin belgilanadi
  const dateUnknown = !!input.dateUnknown;
  if (dateUnknown) { const t = new Date(); t.setHours(0, 0, 0, 0); input = { ...input, deliveryDate: t }; }
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

  // Dastavka summasi — faqat dastavka kerak bo'lsa; mijoz o'zi olib ketsa 0
  const deliveryFee = (input.needsDelivery ?? true) ? Math.round((Number(input.deliveryFee) || 0) * 100) / 100 : 0;
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) throw new Error("Dastavka summasi manfiy bo'lmasin");
  if (deliveryFee > MAX_AMOUNT) throw new Error("Dastavka summasi juda katta");
  const total = orderTotal({ items, deliveryFee });
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
  // To'lov usuli: bosh to'lovli yoki oldindan to'lovli zayavkada — naqd yoki perechisleniye (sukut naqd)
  const payMethod: PayMethod | null = input.payMethod === "BANK" || input.payMethod === "CASH" ? input.payMethod : prepayAmount || !onCredit ? "CASH" : null;
  const note = input.note?.trim() || null;

  // ── Mijoz ──
  if (input.newCustomer) {
    if (!input.newCustomer.name.trim()) throw new Error("Yangi mijoz nomi to'ldirilishi shart");
    // INN: 9 (STIR) yoki 14 (JSHSHIR) raqam — veb forma ham, mobil ilova ham shu yerdan o'tadi
    const innR = parseInn(input.newCustomer.inn);
    if (innR.error !== undefined) throw new Error(innR.error);
    input = { ...input, newCustomer: { ...input.newCustomer, inn: innR.inn } };
    if (input.newCustomer?.inn) {
      const dup = await db.customer.findUnique({ where: { inn: input.newCustomer.inn } });
      if (dup) throw new Error(`Bu INN bilan mijoz allaqachon bor: ${dup.name}. Uni ro'yxatdan tanlang.`);
    }
  } else {
    if (!input.customerId) throw new Error("Mijoz tanlanmagan");
    const c = await db.customer.findUnique({ where: { id: input.customerId } });
    if (!c || !c.isActive) throw new Error("Mijoz topilmadi yoki nofaol");
    // Qora ro'yxat (limit yo'q yoki to'lgan) — faqat «Qarzga» yopiq; naqd/perechisleniye zayavka limitga bog'liq emas
    if (onCredit) {
      const credit = await customerCredit(c.id);
      if (credit.blacklisted) throw new Error(qarzgaYopiq(c.name, credit));
    }
  }

  const res = await db.$transaction(async (tx) => {
    let customerId = input.customerId!;
    if (input.newCustomer) {
      const c = await tx.customer.create({
        data: { name: input.newCustomer.name, phone: input.newCustomer.phone ?? undefined, inn: input.newCustomer.inn ?? undefined, address: input.newCustomer.address ?? undefined, creditLimit: await defaultCreditLimit(tx) },
      });
      await audit(tx, userId, "CREATE", "Customer", c.id, undefined, { ...c, via: "order-form" });
      customerId = c.id;
    }
    // Obyekt kartasi (Logistika → Obyektlar): mijozning shu manzili — bor bo'lsa o'sha, yo'q bo'lsa yangisi
    const siteId = await ensureSite(tx, customerId, input.deliveryAddress, { lat: input.lat, lng: input.lng });
    // Qator bloklari (A, B…) — shu obyekt ichida; yangi nom obyektga qo'shiladi
    const blocks = siteId ? await ensureBlocks(tx, siteId, items.map((i) => i.block)) : new Map<string, string>();
    const rows = items.map(({ block, ...i }) => ({ ...i, blockId: blocks.get(blockKey(block) ?? "") ?? null }));
    const o = await tx.order.create({
      data: {
        ...(opts?.id ? { id: opts.id } : {}),
        orderNo: await nextNo(tx, "order", "Z"),
        customerId,
        siteId,
        deliveryDate: input.deliveryDate,
        dateUnknown,
        deliveryTime: input.deliveryTime ?? null,
        deliveryAddress: input.deliveryAddress,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        // Masofa har doim serverda hisoblanadi — brauzerdan kelgan raqamga ishonmaymiz
        ...(dist ? { distanceKm: dist.km, distanceSource: dist.source } : {}),
        needsPump: !!input.needsPump,
        needsDelivery: input.needsDelivery ?? true,
        deliveryFee,
        isUrgent: !!input.isUrgent,
        onCredit,
        prepayAmount,
        payMethod,
        note: note ?? undefined,
        createdById: userId,
        items: { create: rows },
        ...(contractAmount != null ? { contractAmount, contractAt: new Date(), contractNo: await nextNo(tx, "contract", "SH") } : {}),
        ...(opts?.contractFile ? { contractFile: opts.contractFile.stored, contractFileName: opts.contractFile.name, contractFileType: opts.contractFile.type, contractFileAt: new Date() } : {}),
      },
    });
    await audit(tx, userId, "CREATE", "Order", o.id, undefined, { ...o, items, contractAmount });
    if (input.amoDealId) await linkOrderTx(tx, input.amoDealId, o.id, customerId, userId);
    // Bosh to'lov — «Pul qabul qilish» so'rovi: naqd — Kassa xodimiga, perechisleniye — Buxgalterga
    const rq = prepayAmount && prepayAmount > 0 && o.kind === "SALE" ? await createPaymentRequestTx(tx, o, payMethod ?? "CASH", prepayAmount, userId) : null;
    return { id: o.id, orderNo: o.orderNo, customerId, onCredit, contractNo: o.contractNo, requestId: rq?.id ?? null };
  });
  if (res.requestId) notifyNewPaymentRequest(res.requestId, userId);
  // Agent (yoki sotuvdan boshqa xodim) ochgan qoralama — uni sotuv qabul qiladi; xabarsiz DRAFT'da unutilib qolardi.
  // Sotuvchining o'zi ochgani hamkasblariga yuborilmaydi (shovqin), Excel importi ham.
  if (!opts?.viaImport) {
    notifyAfter(async () => {
      const [u, c] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { role: true, fullName: true } }),
        db.customer.findUnique({ where: { id: res.customerId }, select: { name: true } }),
      ]);
      if (!u || u.role === "SALES" || u.role === "DIRECTOR" || u.role === "SUPERADMIN") return;
      await notifyRoles(["SALES"], {
        type: "ORDER_NEW",
        title: "Yangi zayavka — qabul qilish kerak",
        body: `${c?.name ?? "Mijoz"} · ochdi: ${u.fullName}`,
        link: { key: "orders", id: res.id },
      }, { except: userId });
    });
  }
  // Yangi mijoz ilovaga ham yetsin — telefoni ilovada ro'yxatdan o'tgan bo'lsa hisobi o'sha yerda ulanadi
  if (input.newCustomer) syncCustomerLater(res.customerId);
  if (input.amoDealId) syncDealLater();
  return res;
}

// ───────────────────────── Tahrirlash ─────────────────────────

/** Tahrirlanadigan holatlar — ishlab chiqarish boshlanguncha (zames ham, reys ham yo'q). */
export const EDITABLE_STATUSES = ["DRAFT", "BLOCKED", "CONFIRMED"] as const;
export const isEditable = (o: { status: string; batches: unknown[]; trips: unknown[] }) =>
  (EDITABLE_STATUSES as readonly string[]).includes(o.status) && o.batches.length === 0 && o.trips.length === 0;

/** `id` — mavjud qator (bo'lmasa yangi qator). `price` — NDS bilan saqlanadigan narx (chaqiruvchi qo'shadi). */
/** Tranzaksiya ichidagi xato: `throw` qilinadi — yozilgan hamma narsa orqaga qaytadi (oddiy `return` commit qilib yuborardi). */
class EditError extends Error {}

/** `block` — obyekt bloki nomi; `undefined` — forma yubormagan, qator bloki o'zgarmaydi */
export type EditOrderItem = {
  id?: string | null; productId: string; qtyM3: number; price: number; nds: boolean; block?: string | null;
  /** «Brigadadan olish» brigadasi: null — olib tashlandi, undefined — o'zgarmaydi */
  stockBrigadeId?: string | null;
};
export type EditOrderInput = {
  items: EditOrderItem[];
  deliveryDate: Date;
  /** Faqat qoralamada: sana hali aniq emas */
  dateUnknown?: boolean;
  isUrgent: boolean;
  note: string | null;
  /** Quyidagilar faqat mijoz (SALE) zayavkasida — sklad zayavkasida e'tiborga olinmaydi */
  deliveryAddress?: string;
  lat?: number | null;
  lng?: number | null;
  needsPump?: boolean;
  needsDelivery?: boolean;
  deliveryFee?: number;
  onCredit?: boolean;
  /** Kutilayotgan bosh to'lov; 0 — yo'q */
  prepayAmount?: number;
  payMethod?: PayMethod | null;
  /** «HH:MM» yoki null (soatsiz); `undefined` — o'zgarmaydi (veb tahrir formasi soat yubormaydi) */
  deliveryTime?: string | null;
  /** AuditLog'dagi manba belgisi: sukut «order-edit», Excel ko'rinish katagidan — «order-grid-cell» */
  via?: string;
};

/**
 * Ochilgan zayavkani tahrirlash (veb `/orders/[id]/edit`). Qoralama, bloklangan va tasdiqlangan zayavka — zames, reys bo'lmasa.
 *  · Brigadaga berilgan qator o'chirilmaydi va mahsuloti almashmaydi (topshiriqlar qatorga bog'liq — o'chsa ular ham o'chardi);
 *    soni brigadaga berilgan / bajarilgan miqdordan kam bo'lmaydi.
 *  · Schyot yozilgan zayavkaning summasi o'zgarmaydi — avval schyot bekor qilinadi.
 *  · Tasdiqlangan zayavkada limitga tushadigan summa (faqat «Qarzga») oshsa kredit limiti qayta tekshiriladi: yetmasa — BLOCKED,
 *    direktor ochadi. Sana yoki beton hajmi o'zgarsa — kunlik limit. Kamaygan yoki o'zgarmagan bo'lsa — tekshirilmaydi
 *    (direktor blokdan chiqargan zayavka izoh tuzatilgani uchun qayta bloklanmasin).
 *  · Bosh to'lov so'rovi (PS-…) yangi summa/usulga keltiriladi; tushgan puldan kam qilib bo'lmaydi.
 * Hammasi bitta tranzaksiyada, holat sharti bilan; o'zgarish `AuditLog`ga «oldin/keyin» bo'lib yoziladi.
 */
export async function orderEdit(id: string, input: EditOrderInput, userId: string): Promise<OrderResult> {
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      items: { include: { product: { select: { name: true, unit: true } }, tasks: { select: { qty: true, doneQty: true, status: true } } } },
      batches: { where: { cancelledAt: null }, select: { id: true } },
      trips: { select: { id: true } },
      invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNo: true } },
    },
  });
  if (!o) return { changed: false, error: "Zayavka topilmadi" };
  const isStock = o.kind === "STOCK";
  if (!(await canDoByUserId(userId, "orders", isStock ? "stock" : "edit"))) {
    return { changed: false, error: "Zayavkani tahrirlashga ruxsatingiz yo'q — direktordan ruxsat so'rang" };
  }
  if (!isEditable(o)) return { changed: false, error: "Ishlab chiqarish boshlangan, yetkazilgan yoki bekor qilingan zayavka tahrirlanmaydi" };

  // ── Qatorlar ──
  const items = input.items.filter((i) => i.productId && i.qtyM3 > 0).map((i) => ({ ...i, ...(isStock ? { price: 0, nds: false } : {}) }));
  if (items.length === 0) return { changed: false, error: "Kamida bitta mahsulot qatori kerak" };
  if (items.some((i) => !Number.isFinite(i.qtyM3) || i.qtyM3 > 100_000)) return { changed: false, error: "Miqdor juda katta (100 000 dan oshmasin)" };
  if (items.some((i) => !Number.isFinite(i.price) || i.price < 0)) return { changed: false, error: "Narx manfiy bo'lmasin" };
  if (items.some((i) => i.price > MAX_AMOUNT)) return { changed: false, error: "Narx juda katta" };
  const old = new Map(o.items.map((i) => [i.id, i]));
  if (items.some((i) => i.id && !old.has(i.id))) return { changed: false, error: "Zayavka qatori topilmadi — sahifani yangilab qayta urining" };
  // Tegilmagan qator narxi tiyinigacha saqlanadi: forma NDS'siz narxni ko'rsatadi, soliq qayta qo'shilganda 1 tiyin siljishi mumkin
  for (const i of items) {
    const prev = i.id ? old.get(i.id) : undefined;
    if (prev && prev.nds === i.nds && Math.abs(Number(prev.price) - i.price) <= 0.011) i.price = Number(prev.price);
  }
  const products = await db.product.findMany({ where: { id: { in: [...new Set(items.map((i) => i.productId))] } }, select: { id: true, unit: true, isActive: true } });
  const unitOf = new Map(products.map((p) => [p.id, p.unit]));
  if (items.some((i) => !unitOf.has(i.productId))) return { changed: false, error: "Mahsulot topilmadi — ro'yxatdan qayta tanlang" };
  // Sklad zaxirasi — faqat dona mahsulot: beton zakaz olingandan keyin tayyorlanadi
  if (isStock && items.some((i) => unitOf.get(i.productId) === "m3")) return { changed: false, error: "Sklad zayavkasiga beton qo'shilmaydi — faqat dona mahsulot" };
  // «Brigadadan olish» — faqat mijoz zayavkasida va dona mahsulotda (sklad zayavkasi hovliga ishlab chiqaradi)
  if (isStock) for (const i of items) if (i.stockBrigadeId !== undefined) i.stockBrigadeId = null;
  const srcErr = await checkStockSources(db, items);
  if (srcErr) return { changed: false, error: srcErr };
  // Brigadaga berilgan qator: o'chmaydi, mahsuloti almashmaydi, soni berilgan/bajarilganidan kam bo'lmaydi
  for (const prev of o.items) {
    if (!prev.tasks.length) continue;
    const next = items.find((i) => i.id === prev.id);
    const name = prev.product.name;
    if (!next) return { changed: false, error: `«${name}» qatori brigadaga berilgan — o'chirib bo'lmaydi` };
    if (next.productId !== prev.productId) return { changed: false, error: `«${name}» qatori brigadaga berilgan — mahsulotini almashtirib bo'lmaydi` };
    const given = prev.tasks.filter((t) => t.status !== "CANCELLED").reduce((s, t) => s + Number(t.qty), 0);
    const done = prev.tasks.reduce((s, t) => s + Number(t.doneQty), 0);
    const min = Math.max(given, done);
    if (next.qtyM3 < min - 0.0005) return { changed: false, error: `«${name}»: brigadaga ${fmtNum(min, 3)} berilgan — sonini bundan kam qilib bo'lmaydi` };
  }

  // ── Sana ──
  const dateUnknown = !!input.dateUnknown;
  if (dateUnknown && o.status !== "DRAFT") return { changed: false, error: "Qabul qilingan zayavkada yetkazish sanasi aniq bo'lishi kerak" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const deliveryDate = dateUnknown ? today : input.deliveryDate;
  const dd = deliveryDate.getTime();
  if (!Number.isFinite(dd)) return { changed: false, error: "Yetkazish sanasi noto'g'ri" };
  const dateChanged = dateUnknown !== o.dateUnknown || dd !== o.deliveryDate.getTime();
  // O'zgarmagan sana o'tib ketgan bo'lsa ham qoladi (kechikkan zayavkaning izohini tuzatish mumkin bo'lsin)
  if (dateChanged && !dateUnknown && dd < today.getTime()) return { changed: false, error: "Yetkazish sanasi o'tib ketgan — bugungi yoki keyingi sanani tanlang" };
  if (dd > Date.now() + 366 * 86_400_000) return { changed: false, error: "Yetkazish sanasi bir yildan uzoq bo'lmasin" };

  // ── Mijoz zayavkasi: manzil, dastavka, to'lov ──
  const deliveryAddress = isStock ? o.deliveryAddress : (input.deliveryAddress ?? "").trim();
  if (!deliveryAddress) return { changed: false, error: "Obyekt manzili kerak" };
  const needsDelivery = isStock ? false : !!input.needsDelivery;
  const deliveryFee = needsDelivery ? Math.round((Number(input.deliveryFee) || 0) * 100) / 100 : 0;
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) return { changed: false, error: "Dastavka summasi manfiy bo'lmasin" };
  if (deliveryFee > MAX_AMOUNT) return { changed: false, error: "Dastavka summasi juda katta" };
  const oldTotal = orderTotal(o);
  const total = orderTotal({ items, deliveryFee });
  if (total > MAX_AMOUNT) return { changed: false, error: "Zayavka summasi juda katta — miqdor va narxni tekshiring" };
  const totalChanged = Math.abs(total - oldTotal) > 0.005;
  if (totalChanged && o.invoices.length) {
    return { changed: false, error: `Schyot bor (${o.invoices.map((i) => i.invoiceNo).join(", ")}) — summani o'zgartirish uchun avval schyotni bekor qiling` };
  }
  const onCredit = isStock ? false : !!input.onCredit;
  const prepayAmount = isStock ? null : (input.prepayAmount ?? 0) > 0 ? Math.round(input.prepayAmount! * 100) / 100 : null;
  if (prepayAmount != null && (!Number.isFinite(prepayAmount) || prepayAmount > total + 0.005)) {
    return { changed: false, error: `Bosh to'lov ${money(prepayAmount)} zayavka summasidan ${money(total)} katta` };
  }
  const payMethod: PayMethod | null = isStock ? null
    : input.payMethod === "BANK" || input.payMethod === "CASH" ? input.payMethod : prepayAmount || !onCredit ? "CASH" : null;
  const credit = isStock ? null : await customerCredit(o.customerId);
  // Qora ro'yxat — «Qarzga»ga o'tkazib ham, qarzga summasini oshirib ham bo'lmaydi (ochishdagi qoida bilan bir xil)
  if (credit?.blacklisted && onCredit && (totalChanged || !o.onCredit)) {
    return { changed: false, error: qarzgaYopiq(o.customer.name, credit) };
  }
  // Obyekt nuqtasi o'zgarsa masofa qayta hisoblanadi (serverda — brauzer raqamiga ishonmaymiz)
  const lat = isStock ? o.lat : input.lat ?? null;
  const lng = isStock ? o.lng : input.lng ?? null;
  const pointChanged = lat !== o.lat || lng !== o.lng;
  let dist: Distance | null = null;
  if (!isStock && pointChanged && lat != null && lng != null) {
    const plant = await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } });
    if (plant?.lat != null && plant?.lng != null) dist = await routeDistance({ lat: plant.lat, lng: plant.lng }, { lat, lng });
  }
  const note = input.note?.trim() || null;
  const deliveryTime = isStock || input.deliveryTime === undefined ? o.deliveryTime : input.deliveryTime?.trim() || null;
  if (deliveryTime !== o.deliveryTime && deliveryTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)) return { changed: false, error: "Soat noto'g'ri — masalan 09:30" };
  const concreteOf = (list: { productId: string; qtyM3: number }[]) => list.reduce((s, i) => s + (unitOf.get(i.productId) === "m3" ? i.qtyM3 : 0), 0);
  const oldM3 = concreteM3(o.items);
  const newM3 = concreteOf(items);

  let res: { status: typeof o.status; notifyReq: string | null };
  try {
    res = await db.$transaction(async (tx) => {
      let status = o.status;
      if (!isStock && o.status === "CONFIRMED") {
        // Limitga tushadigan summa (`orderExposure`): «Qarzga» — butun summa; naqd/perechisleniye — reysi yo'q, demak 0
        const exposureOf = (cr: boolean, sum: number) => (cr ? sum : 0);
        const oldExposure = exposureOf(o.onCredit, oldTotal);
        const exposure = exposureOf(onCredit, total);
        const needDay = dateChanged || newM3 > oldM3 + 0.0005;
        const needCredit = exposure > oldExposure + 0.005;
        if (needDay || needCredit) await lockCreditAndDay(tx, o.customerId, deliveryDate);
        if (needDay) {
          const limitErr = await dailyOrderLimitError(tx, id, deliveryDate, items.map((i) => ({ qtyM3: i.qtyM3, product: { unit: unitOf.get(i.productId)! } })), "Boshqa kunni tanlang yoki direktor limitni Sozlamalar → Limitlar'da oshirsin");
          if (limitErr) throw new EditError(limitErr);
        }
        if (needCredit) {
          // Tasdiqlangan (schyotsiz) zayavka `net` ichida eski limit summasi bilan turibdi — o'rniga yangisi qo'yiladi
          const base = credit!.net - (o.invoices.length ? 0 : oldExposure);
          if (exposure > 0.005 && Math.max(0, base) + exposure > credit!.limit && base + exposure > credit!.limit) status = "BLOCKED";
        }
      }
      // Obyekt: manzil yoki nuqta o'zgarsa — shu manzil kartasi; eski (obyektsiz) zayavkaga blok berilsa ham karta ochiladi
      const needSite = !isStock && (deliveryAddress !== o.deliveryAddress || pointChanged || (!o.siteId && items.some((i) => blockName(i.block))));
      const siteId = needSite ? await ensureSite(tx, o.customerId, deliveryAddress, { lat, lng }) : o.siteId;
      const blocks = siteId && !isStock ? await ensureBlocks(tx, siteId, items.map((i) => i.block)) : new Map<string, string>();
      // Holat sharti bilan: shu orada qabul qilingan / bekor qilingan / zames-reys ochilgan zayavka yozilmaydi
      const r = await tx.order.updateMany({
        where: { id, status: o.status, batches: { none: { cancelledAt: null } }, trips: { none: {} } },
        data: {
          status, deliveryDate, dateUnknown, isUrgent: !!input.isUrgent, note,
          ...(isStock ? {} : {
            deliveryAddress, lat, lng, needsPump: !!input.needsPump, needsDelivery, deliveryFee, onCredit, prepayAmount, payMethod, deliveryTime,
            ...(siteId !== o.siteId ? { siteId } : {}),
            ...(pointChanged ? { distanceKm: dist?.km ?? null, distanceSource: dist?.source ?? null } : {}),
          }),
        },
      });
      if (r.count !== 1) throw new EditError("Zayavka shu payt o'zgardi (qabul qilindi, bekor qilindi yoki ishlab chiqarish boshlandi) — sahifani yangilang");

      // Qatorlar: o'chirilgani — faqat topshiriqsizi (shart bilan: shu orada brigada tayinlangan bo'lsa o'chmaydi)
      const keep = new Set(items.map((i) => i.id).filter(Boolean));
      const drop = o.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
      if (drop.length) {
        const d = await tx.orderItem.deleteMany({ where: { id: { in: drop }, orderId: id, tasks: { none: {} } } });
        if (d.count !== drop.length) throw new EditError("Qatorga shu payt brigada tayinlandi — sahifani yangilab qayta urining");
      }
      for (const i of items) {
        const data = {
          productId: i.productId, qtyM3: i.qtyM3, price: i.price, nds: i.nds,
          ...(i.block !== undefined ? { blockId: isStock ? null : blocks.get(blockKey(i.block) ?? "") ?? null } : {}),
          ...(i.stockBrigadeId !== undefined ? { stockBrigadeId: i.stockBrigadeId || null } : {}),
        };
        if (!i.id) { await tx.orderItem.create({ data: { ...data, orderId: id } }); continue; }
        const prev = old.get(i.id)!;
        const u = await tx.orderItem.updateMany({ where: { id: i.id, orderId: id, ...(prev.productId !== i.productId ? { tasks: { none: {} } } : {}) }, data });
        if (u.count !== 1) throw new EditError("Qatorga shu payt brigada tayinlandi — sahifani yangilab qayta urining");
      }
      if (dateChanged) await tx.brigadeTask.updateMany({ where: { orderId: id, status: { notIn: ["DONE", "CANCELLED"] } }, data: { dueDate: deliveryDate } });

      // Bosh to'lov so'rovi — yangi summa va usul
      let notifyReq: string | null = null;
      if (!isStock) {
        const req = await tx.paymentRequest.findUnique({ where: { orderId: id } });
        const advance = Number((await tx.payment.aggregate({ where: { orderId: id }, _sum: { amount: true } }))._sum.amount ?? 0);
        if (prepayAmount != null) {
          if (prepayAmount < advance - 0.005) throw new EditError(`Bosh to'lovdan ${money(advance)} tushgan — undan kam qilib bo'lmaydi`);
          if (!req) {
            notifyReq = (await createPaymentRequestTx(tx, { id, customerId: o.customerId, deliveryDate }, payMethod ?? "CASH", prepayAmount, userId)).id;
          } else {
            if (req.method !== payMethod && advance > 0.005) throw new EditError("Bosh to'lovning bir qismi tushgan — to'lov usulini o'zgartirib bo'lmaydi");
            const reopen = req.status === "CANCELLED";
            const moved = req.method !== payMethod || Math.abs(Number(req.amount) - prepayAmount) > 0.005;
            if (reopen || moved || dateChanged) {
              await tx.paymentRequest.update({
                where: { id: req.id },
                data: { amount: prepayAmount, method: payMethod ?? "CASH", dueDate: deliveryDate, ...(reopen ? { status: "PENDING", received: 0, closedAt: null } : {}) },
              });
              await audit(tx, userId, "UPDATE", "PaymentRequest", req.id, { amount: Number(req.amount), method: req.method, status: req.status }, { amount: prepayAmount, method: payMethod, via: "order-edit" });
              await syncPaymentRequest(tx, id, userId);
              if (reopen || req.method !== payMethod) notifyReq = req.id;
            }
          }
        } else if (req && req.status !== "CANCELLED") {
          if (advance > 0.005) throw new EditError(`Bosh to'lovdan ${money(advance)} tushgan — bosh to'lovni olib tashlab bo'lmaydi`);
          await cancelPaymentRequestTx(tx, id, userId);
        }
      }

      const pick = (x: { deliveryDate: Date; dateUnknown: boolean; isUrgent: boolean; note: string | null; deliveryAddress: string; needsPump: boolean; needsDelivery: boolean; deliveryFee: unknown; onCredit: boolean; prepayAmount: unknown; payMethod: unknown; deliveryTime: string | null }) => ({
        deliveryDate: x.deliveryDate, dateUnknown: x.dateUnknown, deliveryTime: x.deliveryTime, isUrgent: x.isUrgent, note: x.note, deliveryAddress: x.deliveryAddress, needsPump: x.needsPump,
        needsDelivery: x.needsDelivery, deliveryFee: Number(x.deliveryFee ?? 0), onCredit: x.onCredit, prepayAmount: x.prepayAmount == null ? null : Number(x.prepayAmount), payMethod: x.payMethod,
      });
      await audit(tx, userId, "UPDATE", "Order", id,
        { status: o.status, total: oldTotal, ...pick(o), items: o.items.map((i) => ({ id: i.id, productId: i.productId, qtyM3: Number(i.qtyM3), price: Number(i.price), nds: i.nds, blockId: i.blockId, stockBrigadeId: i.stockBrigadeId })) },
        { status, total, ...pick({ deliveryDate, dateUnknown, isUrgent: !!input.isUrgent, note, deliveryAddress, needsPump: isStock ? o.needsPump : !!input.needsPump, needsDelivery, deliveryFee, onCredit, prepayAmount, payMethod, deliveryTime }), items, via: input.via ?? "order-edit" });
      return { status, notifyReq };
    });
  } catch (e) {
    if (e instanceof EditError) return { changed: false, error: e.message };
    throw e;
  }

  if (res.notifyReq) notifyNewPaymentRequest(res.notifyReq, userId);
  const link = { key: "orders", id };
  const name = isStock ? "Sklad zayavkasi" : o.customer.name;
  notifyAfter(async () => {
    if (res.status === "BLOCKED" && o.status !== "BLOCKED") {
      await notifyRoles(["DIRECTOR"], { type: "ORDER_BLOCKED", title: "Limit oshdi", body: `${name} · zayavka o'zgartirildi, ${money(total)}. Blokni oching yoki to'lov kutiladi`, link });
    }
    // Qabul qilingan zayavkani sex va logistika rejalashtirgan — o'zgargani darhol bilinsin
    if (o.status === "CONFIRMED") {
      // Eski yoki yangi qatorlardan birortasi dona bo'lsa — sex ham bilsin (betonga dona qo'shilgan / olingan)
      await notifyRoles(crewRoles([...o.items.map((i) => i.product.unit), ...items.map((i) => unitOf.get(i.productId) ?? "")]), { type: "ORDER_CHANGED", title: `Zayavka o'zgartirildi — ${name}`, body: res.status === "BLOCKED" ? "Limit oshdi — direktor qarorini kuting" : "Mahsulot, soni yoki sanani tekshiring", link }, { except: userId });
    }
    if (o.createdById !== userId) await notifyUsers([o.createdById], { type: "ORDER_CHANGED", title: `Zayavka o'zgartirildi — ${name}`, body: res.status === "BLOCKED" ? "Limit oshdi — zayavka bloklandi" : "Zayavka ma'lumotlari yangilandi", link });
  });
  return { changed: true, status: res.status };
}

// ───────────────────────── Logistika: yetkazish ma'lumotlari ─────────────────────────

/** Yetkazish ma'lumotlari tahrirlanadigan holatlar — reys ochilgan, yetkazilgan zayavka ham (manzil hujjatlarda yangilanadi). */
export const DELIVERY_EDIT_STATUSES = ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION", "DELIVERED"] as const;

export type DeliveryEditInput = {
  deliveryDate: Date;
  /** "HH:MM" yoki bo'sh */
  deliveryTime: string | null;
  deliveryAddress: string;
  lat: number | null;
  lng: number | null;
  needsPump: boolean;
  isUrgent: boolean;
  note: string | null;
};

/**
 * Logistika «Buyurtmalar» oynasidan: sana, soat, obyekt manzili/nuqtasi, nasos, shoshilinch, izoh.
 * Mahsulot, miqdor, narx va to'lov bu yerda o'zgarmaydi (ular — sotuvning to'liq tahriri, `orderEdit`).
 * Reys ochilgan zayavkada ham ishlaydi: nakladnoy, kalendar, haydovchi ilovasi manzilni zayavkadan o'qiydi — hammasida yangisi.
 */
export async function orderDeliveryEdit(id: string, input: DeliveryEditInput, userId: string): Promise<OrderResult> {
  if (!(await canDoByUserId(userId, "logistika", "order_edit"))) return { changed: false, error: "Zayavkani tahrirlashga ruxsatingiz yo'q — direktordan ruxsat so'rang" };
  const o = await db.order.findUnique({
    where: { id },
    select: {
      id: true, kind: true, status: true, customerId: true, siteId: true, createdById: true, deliveryDate: true, dateUnknown: true, deliveryTime: true,
      deliveryAddress: true, lat: true, lng: true, needsPump: true, isUrgent: true, note: true,
      customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } },
    },
  });
  if (!o) return { changed: false, error: "Zayavka topilmadi" };
  if (o.kind === "STOCK") return { changed: false, error: "Sklad zayavkasida yetkazish yo'q" };
  if (!(DELIVERY_EDIT_STATUSES as readonly string[]).includes(o.status)) return { changed: false, error: "Yopilgan zayavka tahrirlanmaydi" };

  const deliveryAddress = input.deliveryAddress.trim().slice(0, 300);
  if (!deliveryAddress) return { changed: false, error: "Obyekt manzili kerak" };
  const deliveryTime = input.deliveryTime?.trim() || null;
  if (deliveryTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)) return { changed: false, error: "Soat noto'g'ri — masalan 09:30" };
  // Kun bo'yicha solishtiriladi (eski yozuvlarda vaqt qismi turlicha): o'zgarmagan sana bazadagidek qoladi,
  // yangisi `orderEdit` dagidek saqlanadi (formadagi "YYYY-MM-DD" → Date)
  if (!Number.isFinite(input.deliveryDate.getTime())) return { changed: false, error: "Yetkazish sanasini tanlang" };
  const dateChanged = o.dateUnknown || isoDate(input.deliveryDate) !== isoDate(o.deliveryDate);
  const deliveryDate = dateChanged ? input.deliveryDate : o.deliveryDate;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dateChanged && deliveryDate.getTime() < today.getTime()) return { changed: false, error: "Yetkazish sanasi o'tib ketgan — bugungi yoki keyingi sanani tanlang" };
  if (deliveryDate.getTime() > Date.now() + 366 * 86_400_000) return { changed: false, error: "Yetkazish sanasi bir yildan uzoq bo'lmasin" };
  const note = input.note?.trim().slice(0, 1000) || null;
  const { lat, lng } = input;
  const pointChanged = lat !== o.lat || lng !== o.lng;
  let dist: Distance | null = null;
  if (pointChanged && lat != null && lng != null) {
    const plant = await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } });
    if (plant?.lat != null && plant?.lng != null) dist = await routeDistance({ lat: plant.lat, lng: plant.lng }, { lat, lng });
  }
  const next = { deliveryDate, dateUnknown: false, deliveryTime, deliveryAddress, lat, lng, needsPump: input.needsPump, isUrgent: input.isUrgent, note };
  const prev = { deliveryDate: o.deliveryDate, dateUnknown: o.dateUnknown, deliveryTime: o.deliveryTime, deliveryAddress: o.deliveryAddress, lat: o.lat, lng: o.lng, needsPump: o.needsPump, isUrgent: o.isUrgent, note: o.note };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => {
    const a = prev[k], b = next[k];
    return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
  });
  if (!changed.length) return { changed: false, status: o.status };

  try {
    await db.$transaction(async (tx) => {
      // Qabul qilingan zayavka boshqa kunga o'tsa — o'sha kunning limiti (qabul qilishdagi qoida)
      if (dateChanged && o.status === "CONFIRMED") {
        await lockCreditAndDay(tx, o.customerId, deliveryDate);
        const limitErr = await dailyOrderLimitError(tx, id, deliveryDate, o.items, "Boshqa kunni tanlang yoki direktor limitni Sozlamalar → Limitlar'da oshirsin");
        if (limitErr) throw new EditError(limitErr);
      }
      const siteId = deliveryAddress !== o.deliveryAddress || pointChanged ? await ensureSite(tx, o.customerId, deliveryAddress, { lat, lng }) : o.siteId;
      const r = await tx.order.updateMany({
        where: { id, status: o.status },
        data: { ...next, ...(siteId !== o.siteId ? { siteId } : {}), ...(pointChanged ? { distanceKm: dist?.km ?? null, distanceSource: dist?.source ?? null } : {}) },
      });
      if (r.count !== 1) throw new EditError("Zayavka shu payt o'zgardi — sahifani yangilang");
      if (dateChanged) await tx.brigadeTask.updateMany({ where: { orderId: id, status: { notIn: ["DONE", "CANCELLED"] } }, data: { dueDate: deliveryDate } });
      const pick = <T extends Record<string, unknown>>(x: T) => Object.fromEntries(changed.map((k) => [k, x[k]]));
      await audit(tx, userId, "UPDATE", "Order", id, pick(prev), { ...pick(next), via: "logistika" });
    });
  } catch (e) {
    if (e instanceof EditError) return { changed: false, error: e.message };
    throw e;
  }

  // Sex, logistika va zayavkani ochgan sotuvchi — yangi sana/manzil darhol bilinsin
  const link = { key: "orders", id };
  const what = changed.includes("deliveryDate") || changed.includes("deliveryTime") ? `yetkazish ${deliveryAt(deliveryDate, deliveryTime)}` : changed.includes("deliveryAddress") ? deliveryAddress : "yetkazish ma'lumotlari";
  notifyAfter(async () => {
    const n = { type: "ORDER_CHANGED", title: `Zayavka o'zgartirildi — ${o.customer.name}`, body: `Logistika: ${what}`, link };
    if (o.status !== "DRAFT") await notifyRoles(crewRoles(o.items.map((i) => i.product.unit)), n, { except: userId });
    if (o.createdById !== userId) await notifyUsers([o.createdById], n);
  });
  return { changed: true, status: o.status };
}

// ───────────────────────── Yetkazilganicha yopish ─────────────────────────

/** Hali yetkazilmagan (rejada / yuklangan / yo'lda) reys holatlari — bunday reys bo'lsa zayavka yetkazilganicha yopilmaydi. */
const TRIP_IN_FLIGHT = ["PLANNED", "LOADED", "ON_ROAD"] as const;

type NumLike = number | string | { toString(): string };
type CloseAtDeliveredInput = {
  items: { id: string; productId: string; qtyM3: NumLike; price: NumLike; product: { unit: string; name: string } }[];
  trips: { status: string; qtyM3: unknown; acceptedQty?: unknown; returnedQty?: unknown; vehicle: { type: string } }[];
  deliveryFee: NumLike;
};

export type CloseAtDeliveredPlan = {
  /** Bir mahsulot bir necha qatorda har xil narxda — reys qaysi qatorga tegishliligi noma'lum, yangi summa taxminiy bo'lardi */
  mixedPrices: boolean;
  /** Qator id → yetkazilgan miqdor (yangi miqdor) */
  delivered: Map<string, number>;
  /** Jami yetkazilgan (birliklar aralash bo'lsa ham — faqat 0 dan kattaligini bilish uchun) */
  deliveredQty: number;
  /** Olib tashlanadigan qoldiq, birlik bo'yicha («20 dona · 3 m³») */
  restText: string;
  /** Olib tashlanadigan qoldiq bormi */
  hasRest: boolean;
  oldTotal: number;
  newTotal: number;
};

/**
 * Har zayavka qatorining yetkazilgan miqdori — faqat DELIVERED reyslardan (`tripCoveredQty`: mijoz qabul qilgani, qaytgani ayirilib).
 * Qatorlarga taqsimlash «Yangi reys» jamlanmasidagi qoida bilan (`orderLines`): aralash zayavkada beton — mikser reyslaridan,
 * dona — boshqa texnikadan; bir turdagi bir nechta qatorda navbat bilan. Navbat qator id tartibida — sahifadagi oldindan
 * ko'rsatish ham, server ham bir xil natija bersin. Summa `orderTotal` bilan (tahrirdagi qoida), dastavka o'zgarmaydi.
 */
export function closeAtDeliveredPlan(o: CloseAtDeliveredInput): CloseAtDeliveredPlan {
  const items = [...o.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = orderLines({
    items: items.map((i) => ({ productId: i.productId, qtyM3: i.qtyM3, product: i.product, tasks: [] })),
    trips: o.trips.filter((t) => t.status === "DELIVERED"),
  });
  const delivered = new Map(items.map((i, n) => [i.id, lines[n]!.shipped]));
  const rest = items
    .map((i) => ({ unit: i.product.unit, qty: Math.max(0, Math.round((Number(i.qtyM3) - (delivered.get(i.id) ?? 0)) * 1000) / 1000) }))
    .filter((r) => r.qty > 0.0005);
  const priceOf = new Map<string, Set<string>>();
  for (const i of items) priceOf.set(i.productId, (priceOf.get(i.productId) ?? new Set<string>()).add(Number(i.price).toFixed(2)));
  return {
    mixedPrices: [...priceOf.values()].some((p) => p.size > 1),
    delivered,
    deliveredQty: [...delivered.values()].reduce((s, q) => s + q, 0),
    restText: fmtUnitTotals(rest),
    hasRest: rest.length > 0,
    oldTotal: orderTotal(o),
    newTotal: orderTotal({ items: items.map((i) => ({ qtyM3: delivered.get(i.id) ?? 0, price: i.price })), deliveryFee: o.deliveryFee }),
  };
}

/** Tranzaksiya ichidagi rad etish — hammasi orqaga qaytadi, matn foydalanuvchiga boradi. */
class CloseError extends Error {}

/**
 * «Yetkazilganicha yopish»: mijoz qolgan qismidan voz kechdi — zayavka yetkazilgan miqdorda yopiladi.
 * Aks holda zayavka abadiy IN_PRODUCTION bo'lib qolar, to'liq summasi kredit limiti va obyekt qarzida «ochiq zayavka» bo'lib turardi.
 * Bitta tranzaksiyada, zayavka qatori qulfi ostida (`createTrip`, `tripDelivered` ham shu qatorni qulflaydi):
 *  · yo'ldagi / rejadagi reys bo'lsa — rad etiladi (avval yetkazilsin yoki bekor qilinsin);
 *  · har qator miqdori yetkazilganiga tushadi; 0 bo'lib qolgan topshiriqsiz qator o'chadi (tahrirdagi kabi),
 *    topshiriqli qator 0 bo'lib qoladi (topshiriq va brigada qaydlari qatorga bog'liq);
 *  · ochiq brigada topshiriqlari yopiladi: bajarilgani bor — shu miqdorda DONE, hech narsa bajarilmagan — CANCELLED
 *    (`taskSubstitute` dagi qoida; brigada oyligi qaydlardan — o'zgarmaydi). Ortiqcha chiqarilgani hovlida erkin qoldiq;
 *  · schyot yangi summadan katta bo'lsa — rad etiladi (avval schyot tuzatiladi yoki bekor qilinadi);
 *  · bosh to'lov va uning so'rovi yangi summadan oshmaydi;
 *  · holat DELIVERED (schyotlar yangi summani to'liq qoplab, hammasi to'langan bo'lsa — CLOSED, `tripDelivered` dagi kabi).
 * Ruxsat chaqiruvchida («orders → cancel», sklad zayavkasi — «stock»).
 */
export async function orderCloseAtDelivered(id: string, reason: string, userId: string): Promise<OrderResult & { note?: string }> {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { changed: false, error: "Yopish sababini yozing" };

  let res: { status: "DELIVERED" | "CLOSED"; customer: string; createdById: string; units: string[]; restText: string; oldTotal: number; newTotal: number; leaders: string[]; invoiced: boolean; amo: boolean };
  try {
    res = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const o = await tx.order.findUnique({
        where: { id },
        include: {
          customer: { select: { name: true } },
          items: { include: { product: { select: { name: true, unit: true } }, tasks: { select: { id: true, qty: true, doneQty: true, status: true, brigade: { select: { leaderId: true } } } } } },
          trips: { where: { status: { not: "CANCELLED" } }, select: { status: true, qtyM3: true, acceptedQty: true, returnedQty: true, deliveryNoteNo: true, vehicle: { select: { type: true } } } },
          invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNo: true, amount: true, status: true } },
        },
      });
      if (!o) throw new CloseError("Zayavka topilmadi");
      if (o.status !== "CONFIRMED" && o.status !== "IN_PRODUCTION") throw new CloseError("Faqat ishlab chiqarish / yetkazish jarayonidagi zayavka yetkazilganicha yopiladi");
      const inFlight = o.trips.filter((t) => (TRIP_IN_FLIGHT as readonly string[]).includes(t.status));
      if (inFlight.length) {
        throw new CloseError(`Yetkazilmagan reys bor: ${inFlight.map((t) => `${t.deliveryNoteNo} — ${TRIP_STEP[t.status] ?? t.status}`).join(", ")}. Avval uni yetkazing yoki bekor qiling`);
      }
      if (!o.trips.some((t) => t.status === "DELIVERED")) throw new CloseError("Hali yetkazilgan reys yo'q — yopib bo'lmaydi");
      const plan = closeAtDeliveredPlan(o);
      if (plan.deliveredQty <= 0.0005) throw new CloseError("Yetkazilgan miqdor 0 (yuk to'liq qaytgan) — yetkazilganicha yopib bo'lmaydi");
      if (!plan.hasRest) throw new CloseError("Zayavka to'liq yetkazilgan — olib tashlanadigan qoldiq yo'q");
      if (plan.mixedPrices) throw new CloseError("Bir mahsulot bir necha qatorda har xil narxda — yetkazilgani qaysi narxdagi qatorga tegishli aniq emas. Zayavkani tahrirlab qatorlarni moslang yoki qoldiqni qo'lda kamaytiring");
      const invoiced = o.invoices.reduce((s, i) => s + Number(i.amount), 0);
      if (invoiced > plan.newTotal + 0.005) {
        throw new CloseError(`Schyot (${o.invoices.map((i) => i.invoiceNo).join(", ")}) ${money(invoiced)} — yetkazilgan summa ${money(plan.newTotal)} dan katta. Avval schyotni tuzating yoki bekor qiling`);
      }

      // Holat — shartli: zayavka shu payt boshqa holatga o'tgan yoki yangi reys ochilgan bo'lsa yozilmaydi
      const paidUp = o.invoices.length > 0 && o.invoices.every((i) => i.status === "PAID") && invoiced >= plan.newTotal - 0.005;
      const status = paidUp ? "CLOSED" as const : "DELIVERED" as const;
      const prepayAmount = o.prepayAmount != null && Number(o.prepayAmount) > plan.newTotal + 0.005 ? Math.round(plan.newTotal * 100) / 100 : null;
      const r = await tx.order.updateMany({
        where: { id, status: o.status, trips: { none: { status: { in: [...TRIP_IN_FLIGHT] } } } },
        data: { status, ...(prepayAmount != null ? { prepayAmount } : {}) },
      });
      if (r.count !== 1) throw new CloseError("Zayavka shu payt o'zgardi — sahifani yangilang");

      // ── Qatorlar: yetkazilgan miqdorga ──
      const itemsAfter: { id: string; productId: string; qtyM3: number; deleted?: boolean }[] = [];
      for (const i of o.items) {
        const was = Number(i.qtyM3);
        const now = plan.delivered.get(i.id) ?? 0;
        if (now >= was - 0.0005) { itemsAfter.push({ id: i.id, productId: i.productId, qtyM3: was }); continue; }
        if (now <= 0.0005 && i.tasks.length === 0) {
          // Shart bilan: shu orada brigada tayinlangan bo'lsa qator o'chmaydi (topshiriqlari kaskad bilan ketardi)
          const d = await tx.orderItem.deleteMany({ where: { id: i.id, orderId: id, tasks: { none: {} } } });
          if (d.count !== 1) throw new CloseError("Qatorga shu payt brigada tayinlandi — sahifani yangilab qayta urining");
          itemsAfter.push({ id: i.id, productId: i.productId, qtyM3: 0, deleted: true });
        } else {
          await tx.orderItem.update({ where: { id: i.id }, data: { qtyM3: now } });
          itemsAfter.push({ id: i.id, productId: i.productId, qtyM3: now });
        }
      }

      // ── Ochiq brigada topshiriqlari: qolgan ish endi kerak emas ──
      const open = o.items.flatMap((i) => i.tasks).filter((t) => t.status === "NEW" || t.status === "IN_PROGRESS");
      for (const t of open) {
        const done = Number(t.doneQty);
        const next = done > 0.0005 ? { qty: done, status: "DONE" as const } : { qty: Number(t.qty), status: "CANCELLED" as const };
        // doneQty sharti: shu payt brigada qayd qilgan bo'lsa (`taskProgress`) eski qiymat bilan yopilmaydi
        const u = await tx.brigadeTask.updateMany({ where: { id: t.id, status: t.status, doneQty: t.doneQty }, data: next });
        if (u.count !== 1) throw new CloseError("Brigada topshirig'i shu payt yangilandi — sahifani yangilab qayta urining");
        await audit(tx, userId, "UPDATE", "BrigadeTask", t.id, { qty: Number(t.qty), doneQty: done, status: t.status }, { ...next, reason: why, via: "order-close-delivered" });
      }
      // Shu orada yangi topshiriq qo'shilgan bo'lsa — yopilgan zayavkada ochiq ish qolmasin
      const late = await tx.brigadeTask.count({ where: { orderId: id, status: { in: ["NEW", "IN_PROGRESS"] } } });
      if (late) throw new CloseError("Zayavkaga shu payt brigada tayinlandi — sahifani yangilab qayta urining");

      // ── Bosh to'lov so'rovi yangi summadan oshmasin ──
      const req = await tx.paymentRequest.findUnique({ where: { orderId: id } });
      if (req && OPEN_STATUSES.includes(req.status) && Number(req.amount) > plan.newTotal + 0.005) {
        const amount = Math.round(plan.newTotal * 100) / 100;
        await tx.paymentRequest.update({ where: { id: req.id }, data: { amount } });
        await audit(tx, userId, "UPDATE", "PaymentRequest", req.id, { amount: Number(req.amount) }, { amount, via: "order-close-delivered" });
        await syncPaymentRequest(tx, id, userId);
      }

      await audit(tx, userId, "STATUS_CHANGE", "Order", id,
        { status: o.status, total: plan.oldTotal, prepayAmount: o.prepayAmount == null ? null : Number(o.prepayAmount), items: o.items.map((i) => ({ id: i.id, productId: i.productId, qtyM3: Number(i.qtyM3) })) },
        { status, total: plan.newTotal, ...(prepayAmount != null ? { prepayAmount } : {}), items: itemsAfter, removed: plan.restText, tasksClosed: open.length, reason: why, via: "close-delivered" });

      return {
        status, customer: o.customer.name, createdById: o.createdById, units: o.items.map((i) => i.product.unit),
        restText: plan.restText, oldTotal: plan.oldTotal, newTotal: plan.newTotal,
        leaders: [...new Set(open.map((t) => t.brigade.leaderId).filter((x): x is string => !!x))],
        invoiced: o.invoices.length > 0, amo: !!o.amoDealId,
      };
    });
  } catch (e) {
    if (e instanceof CloseError) return { changed: false, error: e.message };
    throw e;
  }

  const link = { key: "orders", id };
  notifyAfter(async () => {
    const n = { type: "ORDER_CHANGED", title: `Zayavka yetkazilganicha yopildi — ${res.customer}`, body: `Qolgan ${res.restText} olib tashlandi · ${money(res.oldTotal)} → ${money(res.newTotal)} · sabab: ${why}`, link };
    // Sex va logistika qolganini rejalashtirmasin; zayavkani ochgan sotuvchi mijozga javob beradi
    await notifyRoles(crewRoles(res.units), n, { except: userId });
    if (res.createdById !== userId) await notifyUsers([res.createdById], n);
    if (res.leaders.length) await notifyEmployees(res.leaders, { type: "TASK_CANCELLED", title: `Topshiriq yopildi — ${res.customer}`, body: "Mijoz qolganidan voz kechdi — ishni to'xtating" });
    // Schyot yo'q — buxgalteriya yozmasa zayavka hech qachon yopilmaydi (`tripDelivered` dagi kabi)
    if (!res.invoiced) await notifyRoles(["ACCOUNTING"], { type: "ORDER_DELIVERED", title: `Yetkazildi, schyot kerak — ${res.customer}`, body: `Zayavka yetkazilgan miqdorda yopildi: ${money(res.newTotal)}`, link }, { except: userId });
  });
  if (res.amo) syncDealLater();
  return { changed: true, status: res.status, note: `Zayavka yetkazilganicha yopildi: qolgan ${res.restText} olib tashlandi, summa ${money(res.newTotal)}${res.status === "CLOSED" ? " — schyot to'langan, zayavka yopildi" : ""}` };
}
