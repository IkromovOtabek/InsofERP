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
  ttn: string | null; vehicle: string | null; unit: string; qty: number;
  price: number; delivery: number; net: number; vat: number; total: number;
  address: string; phone: string | null; contractNo: string | null; invoiceNo: string | null; missing: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const PAY_LABEL = Object.fromEntries(PAY_GROUPS.map((g) => [g.key, g.label])) as Record<PayGroupKey, string>;

const ORDER_SELECT = {
  id: true, deliveryDate: true, deliveryAddress: true, deliveryFee: true, payMethod: true, onCredit: true, contractNo: true,
  customerId: true, customer: { select: { name: true, phone: true } },
  site: { select: { name: true, contactPhone: true } },
  createdBy: { select: { fullName: true } },
  items: { orderBy: { id: "asc" as const }, select: { qtyM3: true, price: true, nds: true, product: { select: { name: true, unit: true, groupId: true } } } },
  invoices: { where: { status: { not: "CANCELLED" as const }, isOpening: false }, orderBy: { date: "asc" as const }, select: { invoiceNo: true } },
  // Zayavkaning barcha reyslari tartib bilan: dastavka birinchisiga, qatorlar navbat bilan — davrdan oldingi reyslar ham kerak
  trips: { where: { status: { not: "CANCELLED" as const } }, orderBy: [{ loadedAt: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }], select: { id: true, qtyM3: true, acceptedQty: true } },
};

export async function realizationRows(from: Date, to: Date): Promise<RealizationRow[]> {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0); b.setDate(b.getDate() + 1);
  const live = { kind: "SALE" as const, status: { not: "CANCELLED" as const } };
  const [trips, pickups, groups] = await Promise.all([
    db.trip.findMany({
      where: { status: { not: "CANCELLED" }, order: live, OR: [{ loadedAt: { gte: a, lt: b } }, { loadedAt: null, createdAt: { gte: a, lt: b } }] },
      select: { id: true, deliveryNoteNo: true, qtyM3: true, acceptedQty: true, loadedAt: true, createdAt: true, vehicle: { select: { plate: true } }, order: { select: ORDER_SELECT } },
    }),
    db.order.findMany({
      where: { ...live, status: { in: ["DELIVERED", "CLOSED"] }, deliveryDate: { gte: a, lt: b }, trips: { none: { status: { not: "CANCELLED" } } } },
      select: ORDER_SELECT,
    }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const rootName = rootGroupName(groups);

  type O = (typeof pickups)[number];
  const rows: RealizationRow[] = [];
  const tripQty = (t: { qtyM3: unknown; acceptedQty: unknown }) => Number(t.acceptedQty ?? t.qtyM3);
  const push = (o: O, date: Date, trip: { id: string; no: string; plate: string } | null) => {
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
      customerId: o.customerId, customer: o.customer.name, ttn: trip?.no ?? null, vehicle: trip ? trip.plate : "o'zi oldi",
      address: o.site?.name || o.deliveryAddress, phone: o.site?.contactPhone || o.customer.phone || null,
      contractNo: o.contractNo, invoiceNo, missing,
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
        ...base, key: `${trip?.id ?? o.id}-${n}`, product: i.product.name, group: rootName(i.product.groupId), unit: unitLabel(i.product.unit),
        qty, price: i.nds ? withoutNds(price) : price, delivery, net: r2(line - vat + delivery), vat, total: r2(line + delivery),
      });
    });
    // Mahsulot qatorisiz zayavka (faqat dastavka)
    if (o.items.length === 0 && fee > 0) {
      rows.push({ ...base, key: `${trip?.id ?? o.id}-fee`, product: "Dastavka", group: "Boshqa", unit: "", qty: 0, price: 0, delivery: fee, net: fee, vat: 0, total: fee });
    }
  };

  for (const t of trips) push(t.order, t.loadedAt ?? t.createdAt, { id: t.id, no: t.deliveryNoteNo, plate: t.vehicle.plate });
  for (const o of pickups) push(o, o.deliveryDate, null);

  return rows.sort((x, y) => x.date.getTime() - y.date.getTime() || (x.ttn ?? "").localeCompare(y.ttn ?? "", "uz", { numeric: true }) || x.key.localeCompare(y.key));
}
