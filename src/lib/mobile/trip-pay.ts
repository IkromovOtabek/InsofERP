import { db } from "@/lib/db";
import { approveTripPays, fuelNormText, PAY_TYPE_LABEL, PAY_TYPES, payTrips, pendingApprovalWhere, priceTrip, rejectTripPay, unpricedWhere, type PayTripRow } from "@/lib/driver-trip-pay";
import { dateTime, fmtNum, money } from "@/lib/format";
import type { MobileUser } from "./auth";
import type { MobileDetail } from "./detail";
import { can } from "./detail";
import type { HomeRow, HomeSection } from "./home";
import { ListError, type MobileList } from "./list";

/**
 * Ilova: dispetcherning haydovchi tabeli — narx belgilanmagan reyslar (vebdagi `/logistika/tabel` tepasi) va
 * shu oy narxlanganlari. Bildirishnoma (`TRIP_UNPRICED`, eslatma) `trip-pay` kartochkasini ochadi.
 */

const wait = (r: PayTripRow) => (r.vehicleType === "MIXER" && r.waitMin ? ` · kutish ${r.waitMin} daq` : "");

/** Reys haqi holati: narxsiz → tasdiq kutilmoqda → oylikka tasdiqlangan / kassa (naqd). */
function payState(r: PayTripRow): { status: string; tone: HomeRow["tone"] } {
  if (!r.pricedAt) return { status: "Narxsiz", tone: "warning" };
  if (!r.payType) return { status: "Narxlangan", tone: "success" };
  const t = PAY_TYPE_LABEL[r.payType];
  if (!r.approvedAt) return { status: `${t} · tasdiq kutilmoqda`, tone: "warning" };
  if (r.payType === "PAYROLL") return { status: "Oylikka tasdiqlangan", tone: "success" };
  return r.cashStatus === "PAID" ? { status: "Naqd · kassa berdi", tone: "success" } : { status: "Naqd · kassa kutilmoqda", tone: "info" };
}

const row = (r: PayTripRow): HomeRow => ({
  id: r.id,
  title: `${r.no} · ${r.driver}`,
  subtitle: `${dateTime(r.deliveredAt)} · ${r.plate} · ${fmtNum(r.km, 0)} km${wait(r)}${r.workHours != null ? ` · ${fmtNum(r.workHours, 1)} soat` : ""}`,
  right: money(r.amount ?? r.suggested),
  ...payState(r),
});

/** Ro'yxat: narxsiz (dispetcher), tasdiq kutilmoqda (ish boshqaruvchi — uning sukuti), shu oy narxlangan. */
export async function tripPayList(user: MobileUser, title: string, filter?: string): Promise<MobileList> {
  const approver = can(user, "trip.pay.approve");
  const tab = filter === "month" ? "month" : filter === "approve" ? "approve" : filter === "open" ? "open" : approver ? "approve" : "open";
  const monthFrom = new Date(); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const [open, pending, month] = await Promise.all([
    payTrips(unpricedWhere()),
    payTrips(pendingApprovalWhere()),
    tab === "month" ? payTrips({ status: "DELIVERED", deliveredAt: { gte: monthFrom }, pricedAt: { not: null } }) : Promise.resolve([]),
  ]);
  const rows = tab === "month" ? [...month].reverse() : tab === "approve" ? pending : open;
  return {
    key: "trip-pay", title,
    rows: rows.slice(0, 300).map(row),
    filters: [
      ...(approver ? [{ key: "approve", label: "Tasdiq kutilmoqda", count: pending.length, active: tab === "approve" }] : []),
      { key: "open", label: "Narxsiz", count: open.length, active: tab === "open" },
      ...(!approver ? [{ key: "approve", label: "Tasdiqda", count: pending.length, active: tab === "approve" }] : []),
      { key: "month", label: "Shu oy narxlangan", active: tab === "month" },
    ],
  };
}

/** Bosh sahifa bo'limi (ish boshqaruvchi): reys haqi tasdig'i kutayotganlar — bo'lsa, ro'yxatlar boshida. */
export async function tripPayApproveSection(): Promise<HomeSection | null> {
  const rows = await payTrips(pendingApprovalWhere(), 20);
  if (!rows.length) return null;
  return { title: `Reys haqi tasdig'i (${rows.length})`, empty: "", target: "trip-pay", rows: rows.map(row) };
}

/** Bosh sahifa bo'limi (dispetcher): narxsiz reyslar — bo'lsa, ro'yxatlar boshida. */
export async function tripPaySection(): Promise<HomeSection | null> {
  const rows = await payTrips(unpricedWhere(), 20);
  if (!rows.length) return null;
  return { title: `Narx belgilanmagan reyslar (${rows.length})`, empty: "", target: "trip-pay", rows: rows.map(row) };
}

export async function tripPayDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const [r] = await payTrips({ id, status: "DELIVERED" }, 1);
  if (!r) throw new ListError("NOT_FOUND", "Yetkazilgan reys topilmadi", 404);
  const pricedBy = r.pricedAt ? await db.trip.findUnique({ where: { id }, select: { pricedById: true } }).then((t) => t?.pricedById ? db.user.findUnique({ where: { id: t.pricedById }, select: { fullName: true } }) : null) : null;
  const isMixer = r.vehicleType === "MIXER";
  const pending = !!r.pricedAt && !!r.payType && !r.approvedAt;
  return {
    key: "trip-pay", id: r.id, title: `Reys haqi · ${r.no}`, subtitle: `${r.driver} · ${r.plate}`,
    status: payState(r).status,
    fields: [
      { label: "Yetkazildi", value: dateTime(r.deliveredAt) },
      { label: "Obyekt", value: r.customer },
      { label: "Km (borib-kelish)", value: `${fmtNum(r.km, 0)} km` },
      ...(isMixer ? [{ label: "Obyektda kutish", value: r.waitMin != null ? `${r.waitMin} daq` : "—" }, { label: "Mikser aylantirildi", value: r.drumTurns != null ? `${r.drumTurns} marta` : "kiritilmagan" }] : []),
      { label: "Ishlagan soat", value: r.workHours != null ? `${fmtNum(r.workHours, 1)} soat` : "kiritilmagan" },
      ...(fuelNormText(r) ? [{ label: "Yoqilg'i normasi", value: fuelNormText(r)! }] : []),
      { label: "Tarif bo'yicha taklif", value: `${money(r.suggested)} (${r.suggestText})` },
      ...(r.pricedAt && r.amount != null ? [{ label: "Belgilangan narx", value: money(r.amount), tone: "success" as const }] : []),
      ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
      ...(r.pricedAt ? [{ label: "Kim belgiladi", value: `${pricedBy?.fullName ?? "—"} · ${dateTime(r.pricedAt)}` }] : []),
      ...(r.payType ? [{ label: "To'lov turi", value: PAY_TYPE_LABEL[r.payType] }] : []),
      ...(r.rejectReason && !r.pricedAt ? [{ label: "Rad etilgan", value: r.rejectReason, tone: "danger" as const }] : []),
    ],
    sections: [],
    // Ish boshqaruvchi: tasdiq / rad; dispetcher: narx (naqdi kassaga o'tgan reys narxi o'zgarmaydi)
    actions: pending && can(user, "trip.pay.approve") ? [
      { id: "trip.pay.approve", label: r.payType === "CASH" ? "Tasdiqlash — kassaga" : "Tasdiqlash — oylikka", tone: "success", confirm: `${money(r.amount ?? 0)} reys haqi tasdiqlansinmi?` },
      { id: "trip.pay.reject", label: "Rad etish", tone: "danger", form: [{ name: "reason", label: "Rad etish sababi", type: "text", required: true }] },
    ] : can(user, "trip.price") && !(r.payType === "CASH" && r.approvedAt) ? [{
      id: "trip.price", label: !r.pricedAt ? "Narxni tasdiqlash" : "Narxni tuzatish", tone: !r.pricedAt ? "success" : "brand",
      form: [
        { name: "amount", label: "Reys haqi, so'm", type: "number", required: true, value: String(r.amount ?? r.suggested), hint: "Taklif tarif bo'yicha — o'zgartirish mumkin" },
        { name: "payType", label: "To'lov turi", type: "select", required: true, value: r.payType ?? "PAYROLL", options: PAY_TYPES.map((v) => ({ value: v, label: PAY_TYPE_LABEL[v] })), hint: "Ish boshqaruvchi tasdiqlaydi: naqd — kassa beradi, oylik — vedomostga tushadi" },
        { name: "note", label: !r.pricedAt ? "Izoh" : "O'zgartirish sababi", type: "text", required: !!r.pricedAt },
      ],
    }] : [],
  };
}

export async function runTripPrice(user: MobileUser, id: string, payload: Record<string, unknown>): Promise<string> {
  const amount = Number(String(payload.amount ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount)) throw new ListError("ACTION_FAILED", "Summani kiriting", 400);
  const note = typeof payload.note === "string" && payload.note.trim() ? payload.note.trim().slice(0, 300) : null;
  const payType = payload.payType === "CASH" ? "CASH" : "PAYROLL";
  const r = await priceTrip(id, amount, note, user.id, payType);
  if ("error" in r) throw new ListError("ACTION_FAILED", r.error, 400);
  return "Narx belgilandi — ish boshqaruvchi tasdig'iga yuborildi";
}

export async function runTripPayApprove(user: MobileUser, id: string): Promise<string> {
  const r = await approveTripPays([id], user.id);
  if (!r.done) throw new ListError("ACTION_FAILED", "Reys tasdiq kutayotganlar ichida yo'q — ro'yxatni yangilang", 400);
  return "Tasdiqlandi";
}

export async function runTripPayReject(user: MobileUser, id: string, payload: Record<string, unknown>): Promise<string> {
  const r = await rejectTripPay(id, typeof payload.reason === "string" ? payload.reason : "", user.id);
  if ("error" in r) throw new ListError("ACTION_FAILED", r.error, 400);
  return "Rad etildi — reys dispetcherga qaytdi";
}
