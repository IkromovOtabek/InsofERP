import { db } from "@/lib/db";
import { fuelNormText, PAY_TYPE_LABEL, PAY_TYPES, payTrips, priceTrip, unpricedWhere, type PayTripRow } from "@/lib/driver-trip-pay";
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

const row = (r: PayTripRow): HomeRow => ({
  id: r.id,
  title: `${r.no} · ${r.driver}`,
  subtitle: `${dateTime(r.deliveredAt)} · ${r.plate} · ${fmtNum(r.km, 0)} km${wait(r)}${r.workHours != null ? ` · ${fmtNum(r.workHours, 1)} soat` : ""}`,
  right: money(r.amount ?? r.suggested),
  status: r.amount == null ? "Narxsiz" : "Narxlangan",
  tone: r.amount == null ? "warning" : "success",
});

export async function tripPayList(title: string, filter?: string): Promise<MobileList> {
  const tab = filter === "month" ? "month" : "open";
  const monthFrom = new Date(); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const [open, month] = await Promise.all([
    payTrips(unpricedWhere()),
    tab === "month" ? payTrips({ status: "DELIVERED", deliveredAt: { gte: monthFrom }, pricedAt: { not: null } }) : Promise.resolve([]),
  ]);
  const rows = tab === "month" ? [...month].reverse() : open;
  return {
    key: "trip-pay", title,
    rows: rows.slice(0, 300).map(row),
    filters: [
      { key: "open", label: "Narxsiz", count: open.length, active: tab === "open" },
      { key: "month", label: "Shu oy narxlangan", active: tab === "month" },
    ],
  };
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
  return {
    key: "trip-pay", id: r.id, title: `Reys haqi · ${r.no}`, subtitle: `${r.driver} · ${r.plate}`,
    status: r.amount == null ? "Narxsiz" : "Narxlangan",
    fields: [
      { label: "Yetkazildi", value: dateTime(r.deliveredAt) },
      { label: "Obyekt", value: r.customer },
      { label: "Km (borib-kelish)", value: `${fmtNum(r.km, 0)} km` },
      ...(isMixer ? [{ label: "Obyektda kutish", value: r.waitMin != null ? `${r.waitMin} daq` : "—" }, { label: "Mikser aylantirildi", value: r.drumTurns != null ? `${r.drumTurns} marta` : "kiritilmagan" }] : []),
      { label: "Ishlagan soat", value: r.workHours != null ? `${fmtNum(r.workHours, 1)} soat` : "kiritilmagan" },
      ...(fuelNormText(r) ? [{ label: "Yoqilg'i normasi", value: fuelNormText(r)! }] : []),
      { label: "Tarif bo'yicha taklif", value: `${money(r.suggested)} (${r.suggestText})` },
      ...(r.amount != null ? [{ label: "Belgilangan narx", value: money(r.amount), tone: "success" as const }] : []),
      ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
      ...(r.pricedAt ? [{ label: "Kim belgiladi", value: `${pricedBy?.fullName ?? "—"} · ${dateTime(r.pricedAt)}` }] : []),
    ],
    sections: [],
    actions: can(user, "trip.price") ? [{
      id: "trip.price", label: r.amount == null ? "Narxni tasdiqlash" : "Narxni tuzatish", tone: r.amount == null ? "success" : "brand",
      form: [
        { name: "amount", label: "Reys haqi, so'm", type: "number", required: true, value: String(r.amount ?? r.suggested), hint: "Taklif tarif bo'yicha — o'zgartirish mumkin" },
        { name: "payType", label: "To'lov turi", type: "select", required: true, value: r.payType ?? "PAYROLL", options: PAY_TYPES.map((v) => ({ value: v, label: PAY_TYPE_LABEL[v] })), hint: "Ish boshqaruvchi tasdiqlaydi: naqd — kassa beradi, oylik — vedomostga tushadi" },
        { name: "note", label: r.amount == null ? "Izoh" : "O'zgartirish sababi", type: "text", required: r.amount != null },
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
