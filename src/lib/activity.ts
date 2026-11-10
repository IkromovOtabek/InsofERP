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
const MONEY = new Set(["deliveryFee", "prepayAmount", "total", "contractAmount", "payAmount", "amount", "price", "sum", "nds"]);

/** Kassa / bank yozuvlari (kirim/chiqim, to'lov, perekit, realizatsiya qatori) tahririda ko'rsatiladigan maydonlar — `cashActivity`. */
const CASH_FIELD: Record<string, string> = {
  type: "Turi", date: "Sana", cashAccountId: "Hisob", fromAccountId: "Qayerdan", toAccountId: "Qayerga", amount: "Summa",
  category: "Manba", subCategory: "Sub manba", counterparty: "Kontragent", customerId: "Mijoz", note: "Izoh",
  vehicleNo: "Mashina №", ttn: "TTN", productName: "Mahsulot", unit: "Birlik", qty: "Miqdor", fromWho: "Kimdan", payType: "Deniga",
  deliveryFee: "Dostavka", price: "Narx", sum: "Summa (NDS'siz)", nds: "NDS", total: "Itogo", address: "Manzil",
  contractNo: "Shartnoma", invoiceNo: "Schyot", monthNo: "Oy",
};
/** Hisob / mijoz id'lari — `cashActivity` da nomga aylanadi. */
const ID_KEYS = { account: ["cashAccountId", "fromAccountId", "toAccountId"], customer: ["customerId"] };
type Names = Map<string, string>;

type Json = Record<string, unknown> | null;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function show(k: string, v: unknown, names?: Names): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "ha" : "yo'q";
  if (typeof v === "string" && names?.has(v)) return names.get(v)!;
  if (k === "type") return v === "INCOME" ? "kirim" : v === "EXPENSE" ? "chiqim" : String(v);
  if (MONEY.has(k)) return money(Number(v));
  if (k === "payMethod" || k === "payType") return v === "CASH" ? "naqd" : v === "BANK" ? "perechisleniye" : v === "PAYROLL" ? "oylikka" : String(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return k === "deliveryDate" || k === "date" ? date(new Date(v)) : dateTime(new Date(v));
  if (typeof v === "number") return fmtNum(v);
  return String(v).slice(0, 120);
}

/** before → after farqi: «Yetkazish sanasi: 06.11.2026 → 08.11.2026». */
function diff(before: Json, after: Json, fields: Record<string, string> = FIELD, names?: Names): string[] {
  if (!after) return [];
  const out: string[] = [];
  for (const k of Object.keys(after)) {
    if (!fields[k]) continue;
    const a = before?.[k], b = after[k];
    if (before && show(k, a, names) === show(k, b, names)) continue;
    out.push(before && k in before ? `${fields[k]}: ${show(k, a, names)} → ${show(k, b, names)}` : `${fields[k]}: ${show(k, b, names)}`);
  }
  if (Array.isArray(after.items) && JSON.stringify(after.items) !== JSON.stringify(before?.items)) out.push("Mahsulot qatorlari o'zgardi");
  return out;
}

/** Bekor qilish / o'chirish sababi — tarix qatori ostida. */
const why = (a: Json): string[] => (typeof a?.reason === "string" && a.reason ? [`Sabab: ${a.reason}`] : []);
const sumOf = (a: Json) => (a?.amount != null ? ` — ${money(Number(a.amount))}` : "");

/** `names` — `cashActivity` dan: hisob/mijoz id'lari nomga aylanadi, kassa yozuvlari tahriri maydonma-maydon ko'rinadi. */
function describe(entity: string, action: string, before: Json, after: Json, label?: string, names?: Names): { text: string; details: string[] } {
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
      if (action === "DELETE") return { text: after?.by === "register-row-delete" ? "To'lov realizatsiya qatori bilan o'chirildi" : "To'lov bekor qilindi", details: typeof after?.reason === "string" ? [after.reason] : [] };
      return { text: after?.by === "register-edit" ? "To'lov realizatsiya qatori bilan o'zgardi" : "To'lov o'zgardi", details: names ? diff(before, after, CASH_FIELD, names) : [] };
    case "CashTransaction":
      if (action === "CREATE") return { text: `${after?.type === "INCOME" ? "Kirim" : after?.type === "EXPENSE" ? "Chiqim" : "Yozuv"} kiritildi${sumOf(after)}`, details: [] };
      if (action === "UPDATE") return { text: "Yozuv tahrirlandi", details: diff(before, after, CASH_FIELD, names) };
      if (action === "STATUS_CHANGE") return { text: "Bekor qilindi", details: why(after) };
      return { text: after?.by === "transfer-storno" ? "Perekit bekor qilindi" : "O'chirildi", details: why(after) };
    case "CashTransfer":
      if (action === "CREATE") return { text: `Perekit yozildi${sumOf(after)}`, details: [] };
      if (action === "UPDATE") return { text: "Perekit tahrirlandi", details: diff(before, after, CASH_FIELD, names) };
      if (action === "STATUS_CHANGE") return { text: "Perekit bekor qilindi", details: why(after) };
      return { text: "Perekit o'chirildi", details: why(after) };
    case "SalesRegister":
      if (action === "CREATE") return { text: "Qator kiritildi", details: [] };
      if (action === "UPDATE") return { text: "Qator tahrirlandi", details: diff(before, after, CASH_FIELD, names) };
      return { text: "Qator o'chirildi", details: why(after) };
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

async function activity(refs: Ref[], cash = false): Promise<ActivityRow[]> {
  const or = refs.filter((r) => r.ids.length).map((r) => ({ entity: r.entity, entityId: { in: r.ids } }));
  if (!or.length) return [];
  const log = await db.auditLog.findMany({
    where: { OR: or },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, entity: true, entityId: true, action: true, before: true, after: true, createdAt: true, user: { select: { fullName: true } } },
  });
  const names = cash ? await idNames(log) : undefined;
  return log.map((l) => {
    const label = refs.find((r) => r.entity === l.entity)?.label?.get(l.entityId);
    const d = describe(l.entity, l.action, obj(l.before), obj(l.after), label, names);
    return { id: l.id, at: l.createdAt, by: l.user.fullName, ...d };
  });
}

/** Tarixdagi hisob va mijoz id'lari → nomlari (ikki so'rov). */
async function idNames(log: { before: unknown; after: unknown }[]): Promise<Names> {
  const acc = new Set<string>(), cust = new Set<string>();
  for (const l of log) {
    for (const o of [obj(l.before), obj(l.after)]) {
      if (!o) continue;
      for (const k of ID_KEYS.account) if (typeof o[k] === "string") acc.add(o[k] as string);
      for (const k of ID_KEYS.customer) if (typeof o[k] === "string") cust.add(o[k] as string);
    }
  }
  const [a, c] = await Promise.all([
    acc.size ? db.cashAccount.findMany({ where: { id: { in: [...acc] } }, select: { id: true, name: true } }) : [],
    cust.size ? db.customer.findMany({ where: { id: { in: [...cust] } }, select: { id: true, name: true } }) : [],
  ]);
  return new Map([...a, ...c].map((x) => [x.id, x.name]));
}

/**
 * Kassa / bank qatori tafsiloti (`payments/row-detail.ts`): kirim/chiqim, to'lov, perekit hujjati, realizatsiya qatori —
 * kim kiritdi, tahrirladi (qaysi ustun nimadan nimaga), bekor qildi yoki o'chirdi.
 */
export async function cashActivity(refs: { entity: string; ids: string[] }[]): Promise<ActivityRow[]> {
  return activity(refs, true);
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
