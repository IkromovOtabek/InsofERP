import { db } from "@/lib/db";
import { date, dateTime, fmtNum, money } from "@/lib/format";

/**
 * «Amallar tarixi» — hujjat ustida kim, qachon, nima qilgani. Manba — audit jurnali (`lib/audit.ts`):
 * har amal allaqachon yoziladi (veb, mobil ilova, ECO), shuning uchun alohida jadval yo'q.
 * Zayavka tarixiga uning reyslari, to'lovlari, schyotlari, topshiriqlari va zameslari ham qo'shiladi.
 */

export type ActivityRow = { id: string; at: Date; by: string; text: string; details: string[] };
type Ref = { entity: string; ids: string[]; label?: Map<string, string> };

const ORDER_STATUS: Record<string, string> = {
  DRAFT: "Qoralama", BLOCKED: "Limit oshdi — bloklandi", CONFIRMED: "Zayavka qabul qilindi", IN_PRODUCTION: "Ishlab chiqarishga tushdi",
  DELIVERED: "Yetkazildi", CLOSED: "Yopildi", CANCELLED: "Bekor qilindi",
};
const TRIP_STATUS: Record<string, string> = { PLANNED: "rejalashtirildi", LOADED: "yuklandi", ON_ROAD: "yo'lga chiqdi", DELIVERED: "yetkazildi", CANCELLED: "bekor qilindi" };
const TRIP_PHASE: Record<string, string> = { ARRIVED: "obyektga yetib keldi", UNLOADING: "tushirish boshlandi" };

/** Tahrirda ko'rsatiladigan maydonlar — nomi o'zbekcha; qolganlari (texnik) chiqarilmaydi. */
const FIELD: Record<string, string> = {
  deliveryDate: "Yetkazish sanasi", deliveryTime: "Soat", deliveryAddress: "Manzil", needsPump: "Nasos", isUrgent: "Shoshilinch",
  note: "Izoh", needsDelivery: "Dastavka", deliveryFee: "Dastavka summasi", onCredit: "Qarzga", prepayAmount: "Bosh to'lov",
  payMethod: "To'lov usuli", total: "Summa", dateUnknown: "Sana aniq emas", guaranteeAt: "Kafolat xati", contractNo: "Shartnoma",
  contractAmount: "Shartnoma summasi", cancelReason: "Bekor qilish sababi", ttn: "TTN", pickupAddress: "Yuk olingan joy",
  payAmount: "Reys haqi", payType: "To'lov turi", payNote: "Haq izohi",
};
const MONEY = new Set(["deliveryFee", "prepayAmount", "total", "contractAmount", "payAmount"]);

type Json = Record<string, unknown> | null;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function show(k: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "ha" : "yo'q";
  if (MONEY.has(k)) return money(Number(v));
  if (k === "payMethod" || k === "payType") return v === "CASH" ? "naqd" : v === "BANK" ? "perechisleniye" : v === "PAYROLL" ? "oylikka" : String(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return k === "deliveryDate" ? date(new Date(v)) : dateTime(new Date(v));
  if (typeof v === "number") return fmtNum(v);
  return String(v).slice(0, 120);
}

/** before → after farqi: «Yetkazish sanasi: 06.11.2026 → 08.11.2026». */
function diff(before: Json, after: Json): string[] {
  if (!after) return [];
  const out: string[] = [];
  for (const k of Object.keys(after)) {
    if (!FIELD[k]) continue;
    const a = before?.[k], b = after[k];
    if (before && show(k, a) === show(k, b)) continue;
    out.push(before && k in before ? `${FIELD[k]}: ${show(k, a)} → ${show(k, b)}` : `${FIELD[k]}: ${show(k, b)}`);
  }
  if (Array.isArray(after.items) && JSON.stringify(after.items) !== JSON.stringify(before?.items)) out.push("Mahsulot qatorlari o'zgardi");
  return out;
}

function describe(entity: string, action: string, before: Json, after: Json, label?: string): { text: string; details: string[] } {
  const st = typeof after?.status === "string" ? after.status : null;
  const tag = label ? ` ${label}` : "";
  switch (entity) {
    case "Order":
      if (action === "CREATE") return { text: "Zayavka ochildi", details: [] };
      if (action === "DELETE") return { text: "Zayavka o'chirildi", details: [] };
      if (action === "STATUS_CHANGE") return { text: after?.by === "director" ? "Direktor blokni ochdi" : ORDER_STATUS[st ?? ""] ?? "Holat o'zgardi", details: [] };
      return { text: after?.cancelReason ? "Bekor qilish sababi yozildi" : after?.via === "logistika" ? "Logistika yetkazish ma'lumotini tahrirladi" : "Zayavka tahrirlandi", details: diff(before, after) };
    case "Trip":
      if (action === "CREATE") return { text: `Reys${tag} ochildi`, details: [] };
      if (action === "DELETE") return { text: `Reys${tag} o'chirildi`, details: [] };
      if (action === "STATUS_CHANGE" && st) return { text: `Reys${tag} ${TRIP_STATUS[st] ?? st}`, details: typeof after?.note === "string" && after.note ? [after.note] : [] };
      if (action === "STATUS_CHANGE") return { text: after?.payApprovedAt ? `Reys${tag} haqi tasdiqlandi` : after?.payRejectReason ? `Reys${tag} haqi rad etildi` : `Reys${tag} o'zgardi`, details: diff(before, after) };
      if (typeof after?.phase === "string") return { text: `Reys${tag}: ${TRIP_PHASE[after.phase] ?? after.phase}`, details: [] };
      if (after && "returnedAt" in after) return { text: `Reys${tag}: zavodga qaytdi`, details: [] };
      if (after && "closedAt" in after) return { text: `Reys${tag} yopildi`, details: [] };
      return { text: `Reys${tag} tahrirlandi`, details: diff(before, after) };
    case "Payment":
      if (action === "CREATE") return { text: `To'lov qabul qilindi${after?.amount != null ? ` — ${money(Number(after.amount))}` : ""}`, details: [] };
      if (action === "DELETE") return { text: "To'lov bekor qilindi", details: typeof after?.reason === "string" ? [after.reason] : [] };
      return { text: "To'lov o'zgardi", details: [] };
    case "PaymentRequest":
      if (action === "CREATE") return { text: `Bosh to'lov so'rovi ochildi${after?.amount != null ? ` — ${money(Number(after.amount))}` : ""}`, details: [] };
      if (st === "RECEIVED") return { text: "Bosh to'lov qabul qilindi", details: [] };
      if (st === "CANCELLED") return { text: "Bosh to'lov so'rovi bekor qilindi", details: [] };
      return { text: "Bosh to'lov so'rovi o'zgardi", details: diff(before, after) };
    case "Invoice":
      if (action === "CREATE") return { text: `Schyot yozildi${typeof after?.invoiceNo === "string" ? ` ${after.invoiceNo}` : ""}`, details: [] };
      if (st === "CANCELLED") return { text: "Schyot bekor qilindi", details: typeof after?.reason === "string" ? [after.reason] : [] };
      return { text: "Schyot o'zgardi", details: [] };
    case "BrigadeTask":
      if (action === "CREATE") return { text: `Brigadaga topshiriq berildi${typeof after?.taskNo === "string" ? ` ${after.taskNo}` : ""}`, details: [] };
      if (st === "DONE") return { text: "Brigada topshiriqni bajardi", details: [] };
      if (st === "CANCELLED") return { text: "Topshiriq bekor qilindi", details: [] };
      if (after && "startedAt" in after) return { text: "Brigada ishni boshladi", details: [] };
      return { text: "Topshiriq o'zgardi", details: [] };
    case "ProductionBatch":
      if (action === "CREATE") return { text: `Zames qilindi${typeof after?.batchNo === "string" ? ` ${after.batchNo}` : ""}`, details: [] };
      return { text: "Zames storno qilindi", details: [] };
    default:
      return { text: `${entity}: ${action}`, details: [] };
  }
}

async function activity(refs: Ref[]): Promise<ActivityRow[]> {
  const or = refs.filter((r) => r.ids.length).map((r) => ({ entity: r.entity, entityId: { in: r.ids } }));
  if (!or.length) return [];
  const log = await db.auditLog.findMany({
    where: { OR: or },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, entity: true, entityId: true, action: true, before: true, after: true, createdAt: true, user: { select: { fullName: true } } },
  });
  return log.map((l) => {
    const label = refs.find((r) => r.entity === l.entity)?.label?.get(l.entityId);
    const d = describe(l.entity, l.action, obj(l.before), obj(l.after), label);
    return { id: l.id, at: l.createdAt, by: l.user.fullName, ...d };
  });
}

/** Zayavka va unga bog'liq hujjatlar: reys, to'lov, bosh to'lov so'rovi, schyot, topshiriq, zames. */
export async function orderActivity(orderId: string): Promise<ActivityRow[]> {
  const o = await db.order.findUnique({
    where: { id: orderId },
    select: {
      trips: { select: { id: true, deliveryNoteNo: true, ttn: true } }, payments: { select: { id: true } }, invoices: { select: { id: true } },
      tasks: { select: { id: true } }, batches: { select: { id: true } }, payRequest: { select: { id: true } },
    },
  });
  if (!o) return [];
  return activity([
    { entity: "Order", ids: [orderId] },
    { entity: "Trip", ids: o.trips.map((t) => t.id), label: new Map(o.trips.map((t) => [t.id, t.ttn || t.deliveryNoteNo])) },
    { entity: "Payment", ids: o.payments.map((x) => x.id) },
    // Bosh to'lov so'rovi bekor qilinganda audit zayavka id'si bilan yoziladi (`cancelPaymentRequestTx`)
    { entity: "PaymentRequest", ids: [orderId, ...(o.payRequest ? [o.payRequest.id] : [])] },
    { entity: "Invoice", ids: o.invoices.map((x) => x.id) },
    { entity: "BrigadeTask", ids: o.tasks.map((x) => x.id) },
    { entity: "ProductionBatch", ids: o.batches.map((x) => x.id) },
  ]);
}

/** Reysning o'zi: ochilishi, holatlari, bosqichlari, TTN, reys haqi. */
export async function tripActivity(tripId: string): Promise<ActivityRow[]> {
  return activity([{ entity: "Trip", ids: [tripId] }]);
}
