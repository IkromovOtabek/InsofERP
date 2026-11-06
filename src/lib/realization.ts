import { db } from "@/lib/db";
import { ndsPart, withoutNds } from "@/lib/nds";
import { unitLabel } from "@/lib/unit";
import { PAY_GROUPS, payGroupOf, rootGroupName, type PayGroupKey } from "@/lib/order-day-sheet";

/**
 * Realizatsiya reestri (Sotuv → «Realizatsiya») — buxgalteriyaning «Realizatsiya» Google varag'i ko'rinishida:
 * har qator — bitta reys (TTN): sana, to'lov turi, sotuvchi, xaridor, mahsulot, mashina, miqdor, narx, dastavka, QQS,
 * guruh, manzil, shartnoma va schyot-faktura raqami.
 *
 *  · Sana — yuklangan vaqt (bo'lmasa reys ochilgan vaqt). Bekor qilingan reys va zayavka kirmaydi.
 *  · Bir nechta mahsulotli zayavkada reyslar qatorlarni navbat bilan to'ldiradi (oldingi reyslar yukidan keyin): 12 + 5 dona
 *    zayavkaning 17 talik reysi — 12 va 5, 10 + 7 lik ikki reysi — 10; 2 + 5 (bir TTN — bir necha qator, dona kasrga bo'linmaydi).
 *  · Dastavka zayavkaning birinchi reysiga yoziladi (kunlik varaqdagi qoida — `lib/order-day-sheet.ts`).
 *  · Summa (QQSsiz) = miqdor × narx (QQSsiz) + dastavka; Jami = Summa + QQS.
 *  · Reyssiz yetkazilgan zayavka (mijoz o'zi olib ketgan) — yetkazish sanasi bilan, mashina «o'zi oldi».
 *  · Perechisleniye qatorida shartnoma yoki schyot-faktura bo'lmasa — «Hujjatlar» ustunida ogohlantirish.
 */

export type RealizationRow = {
  key: string; orderId: string; tripId: string | null;
  date: Date; pay: PayGroupKey; payLabel: string; seller: string;
  customerId: string; customer: string; product: string; group: string;
  /** TTN: dispetcher yozgani (`Trip.ttn`), bo'lmasa nakladnoy raqami; `tripTtn` — faqat yozilgani (tahrir uchun) */
  ttn: string | null; tripTtn: string | null; vehicle: string | null; unit: string; qty: number;
  /** Mahsulot birligi kaliti (m3, dona…) va zayavka qatorida «QQS 12%» belgisi — Logistika reestridagi tuzatish qayta hisobi uchun */
  unitKey: string; nds: boolean;
  price: number; delivery: number; net: number; vat: number; total: number;
  address: string; phone: string | null; contractNo: string | null; invoiceNo: string | null; missing: string[];
  /** Reys ma'lumoti (Logistika → Realizatsiya): yuk olingan joy — BRU yoki manzil, haydovchi */
  loadPlace: string | null; driver: string | null; driverPhone: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/**
 * Tizim nakladnoy raqami «N-2026-00161» → «161» (varaqdagidek qisqa); to'liq raqam — sarlavhada va Excel'da.
 * Dispetcher yozgan TTN (`Trip.ttn`) o'zicha qoladi.
 */
export const shortTtn = (v: string | null) => (v ? v.replace(/^[A-Z]-\d{4}-0*(?=\d)/, "") : "");
const PAY_LABEL = Object.fromEntries(PAY_GROUPS.map((g) => [g.key, g.label])) as Record<PayGroupKey, string>;

const ORDER_SELECT = {
  id: true, deliveryDate: true, deliveryAddress: true, deliveryFee: true, payMethod: true, onCredit: true, contractNo: true,
  customerId: true, customer: { select: { name: true, phone: true } },
  site: { select: { name: true, contactPhone: true } },
  createdBy: { select: { fullName: true } },
  items: { orderBy: { id: "asc" as const }, select: { id: true, qtyM3: true, price: true, nds: true, product: { select: { name: true, unit: true, groupId: true } } } },
  invoices: { where: { status: { not: "CANCELLED" as const }, isOpening: false }, orderBy: { date: "asc" as const }, select: { invoiceNo: true } },
  // Zayavkaning barcha reyslari tartib bilan: dastavka birinchisiga, qatorlar navbat bilan — davrdan oldingi reyslar ham kerak
  trips: { where: { status: { not: "CANCELLED" as const } }, orderBy: [{ loadedAt: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }], select: { id: true, qtyM3: true, acceptedQty: true } },
};

/**
 * `extra` — davrdan tashqaridagi reys/zayavka ham qo'shilsin (Logistika reestrida dispetcher sanasini shu davrga o'zgartirgan).
 */
export async function realizationRows(from: Date, to: Date, extra?: { tripIds: string[]; orderIds: string[] }): Promise<RealizationRow[]> {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0); b.setDate(b.getDate() + 1);
  const live = { kind: "SALE" as const, status: { not: "CANCELLED" as const } };
  const [trips, pickups, groups] = await Promise.all([
    db.trip.findMany({
      where: { status: { not: "CANCELLED" }, order: live, OR: [{ loadedAt: { gte: a, lt: b } }, { loadedAt: null, createdAt: { gte: a, lt: b } }, ...(extra?.tripIds.length ? [{ id: { in: extra.tripIds } }] : [])] },
      select: {
        id: true, deliveryNoteNo: true, ttn: true, qtyM3: true, acceptedQty: true, loadedAt: true, createdAt: true, bru: true, pickupAddress: true,
        vehicle: { select: { plate: true } }, driver: { select: { fullName: true, phone: true } }, order: { select: ORDER_SELECT },
      },
    }),
    db.order.findMany({
      where: { ...live, status: { in: ["DELIVERED", "CLOSED"] }, OR: [{ deliveryDate: { gte: a, lt: b } }, ...(extra?.orderIds.length ? [{ id: { in: extra.orderIds } }] : [])], trips: { none: { status: { not: "CANCELLED" } } } },
      select: ORDER_SELECT,
    }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const rootName = rootGroupName(groups);

  type O = (typeof pickups)[number];
  const rows: RealizationRow[] = [];
  const tripQty = (t: { qtyM3: unknown; acceptedQty: unknown }) => Number(t.acceptedQty ?? t.qtyM3);
  type TripInfo = { id: string; no: string; ttn: string | null; plate: string; loadPlace: string | null; driver: string; driverPhone: string | null };
  const push = (o: O, date: Date, trip: TripInfo | null) => {
    const pay = payGroupOf(o);
    // Shu reysning yuki zayavka qatorlari bo'yicha: [oldingi reyslar yig'indisi; + shu reys) oralig'i qatorlar oralig'iga solinadi
    const idx = trip ? o.trips.findIndex((t) => t.id === trip.id) : -1;
    const before = idx > 0 ? o.trips.slice(0, idx).reduce((s, t) => s + tripQty(t), 0) : 0;
    const load = idx >= 0 ? tripQty(o.trips[idx]!) : 0;
    const withFee = !trip || idx === 0;
    const invoiceNo = o.invoices.map((i) => i.invoiceNo).join(", ") || null;
    const missing = pay === "BANK" ? [!o.contractNo && "Shartnoma", !invoiceNo && "Sch-faktura"].filter((x): x is string => !!x) : [];
    const base = {
      orderId: o.id, tripId: trip?.id ?? null, date, pay, payLabel: PAY_LABEL[pay], seller: o.createdBy.fullName,
      customerId: o.customerId, customer: o.customer.name, ttn: trip?.no ?? null, tripTtn: trip?.ttn ?? null, vehicle: trip ? trip.plate : "o'zi oldi",
      address: o.site?.name || o.deliveryAddress, phone: o.site?.contactPhone || o.customer.phone || null,
      contractNo: o.contractNo, invoiceNo, missing,
      loadPlace: trip?.loadPlace ?? null, driver: trip?.driver ?? null, driverPhone: trip?.driverPhone ?? null,
    };
    const fee = withFee ? Number(o.deliveryFee) : 0;
    let start = 0;
    o.items.forEach((i, n) => {
      const q = Number(i.qtyM3);
      const last = n === o.items.length - 1;
      // Reyssiz (o'zi olib ketgan) — qatorning o'zi; reysda — qator oralig'iga tushgan qismi (ortiqcha yuk oxirgi qatorga)
      const qty = !trip ? q : o.items.length === 1 ? load
        : r3(Math.max(0, Math.min(before + load, last ? Infinity : start + q) - Math.max(before, start)));
      start += q;
      if (trip && o.items.length > 1 && qty <= 0) return;
      const price = Number(i.price);
      const line = r2(qty * price);
      const vat = i.nds ? ndsPart(line) : 0;
      const delivery = n === 0 ? fee : 0;
      rows.push({
        // Kalit zayavka qatori id si bilan — qator qo'shilsa/olinsa ham dispetcher tuzatishi (`RealizationLine`) o'z qatorida qoladi
        ...base, key: `${trip?.id ?? o.id}-${i.id}`, product: i.product.name, group: rootName(i.product.groupId), unit: unitLabel(i.product.unit),
        unitKey: i.product.unit, nds: i.nds, qty, price: i.nds ? withoutNds(price) : price, delivery, net: r2(line - vat + delivery), vat, total: r2(line + delivery),
      });
    });
    // Mahsulot qatorisiz zayavka (faqat dastavka)
    if (o.items.length === 0 && fee > 0) {
      rows.push({ ...base, key: `${trip?.id ?? o.id}-fee`, product: "Dastavka", group: "Boshqa", unit: "", unitKey: "", nds: false, qty: 0, price: 0, delivery: fee, net: fee, vat: 0, total: fee });
    }
  };

  for (const t of trips) {
    push(t.order, t.loadedAt ?? t.createdAt, {
      id: t.id, no: t.ttn ?? t.deliveryNoteNo, ttn: t.ttn, plate: t.vehicle.plate, loadPlace: t.bru || t.pickupAddress || null,
      driver: t.driver.fullName, driverPhone: t.driver.phone,
    });
  }
  for (const o of pickups) push(o, o.deliveryDate, null);

  return rows.sort((x, y) => x.date.getTime() - y.date.getTime() || (x.ttn ?? "").localeCompare(y.ttn ?? "", "uz", { numeric: true }) || x.key.localeCompare(y.key));
}
