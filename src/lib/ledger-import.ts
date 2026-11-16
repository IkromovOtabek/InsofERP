import { z } from "zod";
import { db } from "@/lib/db";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { PAY_APPROVER_ROLES } from "@/lib/driver-trip-pay";
import { createLogisticsEntry, entrySchema } from "@/lib/logistics-entry";
import { ledgerEditData, updateLedgerRow, type LedgerEditInput } from "@/lib/ledger-edit";
import { matchKey } from "@/lib/excel";
import { money } from "@/lib/format";
import { LEDGER_TEXT_MAX as TEXT_MAX } from "@/lib/ledger-revenue";

/**
 * Hisob varag'i → «Excel orqali qo'shish»: dispetcherning Excel / Google varag'i ko'rinishidagi jadvaldan ko'p qator birdan.
 * Ustunlar varaqdagidek: sana, mashina, haydovchi, qayerdan/qayerga, reys, yuk, probeg va baraban soati (DT / gaz alohida),
 * ish haqi va to'lov turi, remont usta / zapchast / vulkanizatsiya, usluga (perech. / naqd / tekin — o'zimizga), izoh, TTN.
 *
 * Har qator «Sotuv reysi» bilan bog'lanadi (`checkLedgerImport`) — shu mashinaning shu kungi yetkazilgan reyslari:
 *  - TTN yozilgan — reys TTN yoki nakladnoy raqami bo'yicha topiladi;
 *  - TTN yo'q — tushirish joyi mijoz/obyekt nomiga mos reyslar (marka — «M-300» — mos kelgani oldin), reys soni bo'yicha;
 *  - mos reys yo'q, lekin shu kuni sotuv bor — «TTN yozing» (ogohlantirish); sotuv yo'q — oddiy qo'lda qator.
 * Saqlashda (`saveLedgerImport`): bog'langan qator yangi qator ochmaydi — km, baraban soati, haq (reyslarga teng bo'lib) va
 * xarajat (birinchi reysga) o'sha reys qatorlariga yoziladi (`updateLedgerRow`, ikki marta hisoblanmaydi; dastavka daromadi
 * zayavkadan qoladi). Qolgani — qo'lda qator (`createLogisticsEntry`): DT / gaz km va soati alohida (`kmGas`, `drumHoursGas`).
 */

export const IMPORT_MAX_ROWS = 500;

const numOrNull = z.number().finite().nullable();
export const importRowSchema = z.object({
  key: z.string().min(1).max(24),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto'g'ri"),
  vehicleId: z.string().min(1).max(40),
  driverId: z.string().max(40).nullable(),
  pickup: z.string().max(TEXT_MAX.pickup, `Qayerdan — ${TEXT_MAX.pickup} belgigacha`), dropoff: z.string().max(TEXT_MAX.dropoff, `Qayerga — ${TEXT_MAX.dropoff} belgigacha`),
  cargo: z.string().max(TEXT_MAX.cargo, `Yuk — ${TEXT_MAX.cargo} belgigacha`),
  trips: numOrNull, kmDt: numOrNull, kmGas: numOrNull, hDt: numOrNull, hGas: numOrNull,
  pay: numOrNull, payType: z.enum(["", "CASH", "PAYROLL"]),
  repair: numOrNull, parts: numOrNull, vulc: numOrNull,
  svcBank: numOrNull, svcCash: numOrNull, svcFree: numOrNull,
  note: z.string().max(TEXT_MAX.note, `Izoh — ${TEXT_MAX.note} belgigacha`), ttn: z.string().max(TEXT_MAX.ttn, `TTN — ${TEXT_MAX.ttn} belgigacha`),
});
export type ImportRow = z.infer<typeof importRowSchema>;

/** Bog'langan sotuv reysi: `label` — varaqdagidek «zayavka|mashina|TTN», `revenue` — dastavka haqidan ulushi. */
export type LinkTrip = { id: string; label: string; customer: string; revenue: number };
export type LinkState =
  | { status: "linked"; auto: boolean; trips: LinkTrip[]; missing: number }
  | { status: "ttn-missing"; count: number }
  | { status: "ttn-notfound"; ttn: string[] }
  | { status: "no-sales"; dup: string | null }
  /** Reys soni bo'sh / 0 va TTN yo'q — remont, kunlik haq kabi reyssiz qator: bog'lanmaydi */
  | { status: "no-trip" };

type CheckRow = Pick<ImportRow, "key" | "date" | "vehicleId" | "dropoff" | "cargo" | "trips" | "ttn" | "kmDt" | "kmGas">;

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayStart = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d!); };
/** TTN / nakladnoy raqamini taqqoslash: belgilarsiz, raqam bo'lsa — boshidagi nollarsiz. */
const ttnKey = (s: string) => { const k = matchKey(s); return /^\d+$/.test(k) ? String(Number(k)) : k; };
/** Mijoz / obyekt nomi mosligi: biri ikkinchisining ichida (kamida 4 belgi), yozuvidan qat'i nazar. */
const nameMatch = (a: string, b: string) => { const x = matchKey(a), y = matchKey(b); return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)); };
/** Yukdagi beton markasi: «M-300 10m3 1X» → «m300». */
const gradeOf = (s: string) => { const m = /[mм]\s*-?\s*(\d{3})/i.exec(s); return m ? `m${m[1]}` : null; };

/** Qatorlarni shu mashinaning shu kungi yetkazilgan sotuv reyslari bilan bog'lash (saqlashdan oldin ham, oynada ham bir xil). */
export async function checkLedgerImport(rows: CheckRow[]): Promise<Record<string, LinkState>> {
  const ok = rows.filter((r) => r.vehicleId && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  if (!ok.length) return {};
  const days = ok.map((r) => r.date).sort();
  const from = dayStart(days[0]!), to = new Date(dayStart(days[days.length - 1]!).getTime() + 86_400_000);
  const vehicleIds = [...new Set(ok.map((r) => r.vehicleId))];
  const [trips, entries] = await Promise.all([
    db.trip.findMany({
      where: { status: "DELIVERED", vehicleId: { in: vehicleIds }, deliveredAt: { gte: from, lt: to } }, orderBy: { deliveredAt: "asc" },
      select: {
        id: true, deliveryNoteNo: true, ttn: true, deliveredAt: true, vehicleId: true, orderId: true, qtyM3: true, vehicle: { select: { plate: true } },
        order: { select: { orderNo: true, deliveryFee: true, customer: { select: { name: true, aliases: true } }, site: { select: { name: true } }, items: { select: { product: { select: { name: true } } } } } },
      },
    }),
    // Takror tekshiruvi: shu mashinaning shu kunlardagi qo'lda qatorlari
    db.logisticsEntry.findMany({
      where: { cancelledAt: null, vehicleId: { in: vehicleIds }, date: { gte: from, lt: to } },
      select: { docNo: true, date: true, vehicleId: true, dropoff: true, trips: true, km: true },
    }),
  ]);
  // Dastavka haqi zayavkaning barcha reyslariga hajm ulushida (`driverLedger` dagidek)
  const orderIds = [...new Set(trips.map((t) => t.orderId))];
  const orderQty = new Map((orderIds.length
    ? await db.trip.groupBy({ by: ["orderId"], where: { orderId: { in: orderIds }, status: { not: "CANCELLED" } }, _sum: { qtyM3: true }, _count: true })
    : []).map((g) => [g.orderId, { qty: Number(g._sum.qtyM3 ?? 0), n: g._count }]));

  type T = (typeof trips)[number];
  const group = new Map<string, T[]>();
  for (const t of trips) { const k = `${t.vehicleId}|${dayOf(t.deliveredAt!)}`; group.set(k, [...(group.get(k) ?? []), t]); }
  const link = (t: T): LinkTrip => {
    const fee = Number(t.order.deliveryFee ?? 0), oq = orderQty.get(t.orderId);
    const revenue = fee > 0 && oq ? (oq.qty > 0 ? (fee * Number(t.qtyM3)) / oq.qty : fee / oq.n) : 0;
    return { id: t.id, label: `${t.order.orderNo}|${t.vehicle.plate}|${t.ttn?.trim() || t.deliveryNoteNo}`, customer: t.order.site?.name ?? t.order.customer.name, revenue: Math.round(revenue) };
  };
  const names = (t: T) => [t.order.customer.name, ...t.order.customer.aliases, t.order.site?.name ?? ""].filter(Boolean);

  const used = new Set<string>();
  const out: Record<string, LinkState> = {};
  for (const r of ok) {
    const list = group.get(`${r.vehicleId}|${r.date}`) ?? [];
    const tokens = r.ttn.split(/[\s,;/]+/).map((x) => x.trim()).filter(Boolean);
    if (tokens.length) {
      const found: T[] = [], miss: string[] = [];
      for (const tk of tokens) {
        const k = ttnKey(tk);
        const t = list.find((x) => ttnKey(x.ttn ?? "") === k || ttnKey(x.deliveryNoteNo) === k);
        if (t) { if (!found.includes(t)) found.push(t); } else miss.push(tk);
      }
      if (miss.length) { out[r.key] = { status: "ttn-notfound", ttn: miss }; continue; }
      found.forEach((t) => used.add(t.id));
      out[r.key] = { status: "linked", auto: false, trips: found.map(link), missing: 0 };
      continue;
    }
    if ((r.trips ?? 0) < 1) { out[r.key] = { status: "no-trip" }; continue; }
    if (!list.length) {
      const km = (r.kmDt ?? 0) + (r.kmGas ?? 0);
      const dup = entries.find((e) => e.vehicleId === r.vehicleId && dayOf(e.date) === r.date && matchKey(e.dropoff ?? "") === matchKey(r.dropoff)
        && e.trips === Math.round(r.trips ?? 0) && Math.abs(Number(e.km ?? 0) - km) < 0.05);
      out[r.key] = { status: "no-sales", dup: dup?.docNo ?? null };
      continue;
    }
    const free = list.filter((t) => !used.has(t.id));
    const cand = r.dropoff.trim() ? free.filter((t) => names(t).some((n) => nameMatch(n, r.dropoff))) : [];
    if (!cand.length) { out[r.key] = { status: "ttn-missing", count: free.length || list.length }; continue; }
    const g = gradeOf(r.cargo);
    const sorted = g ? [...cand.filter((t) => t.order.items.some((i) => matchKey(i.product.name).includes(g))), ...cand.filter((t) => !t.order.items.some((i) => matchKey(i.product.name).includes(g)))] : cand;
    const want = Math.max(1, Math.round(r.trips ?? 1));
    const pick = sorted.slice(0, want);
    pick.forEach((t) => used.add(t.id));
    out[r.key] = { status: "linked", auto: true, trips: pick.map(link), missing: Math.max(0, want - pick.length) };
  }
  return out;
}

/** zod xatosidagi maydon nomi — foydalanuvchiga ustun nomi bilan. */
const FIELD: Record<string, string> = {
  date: "Sana", trips: "Reys", km: "Probeg", kmGas: "Probeg gazda", drumHours: "Baraban soati", drumHoursGas: "Baraban gazda",
  payAmount: "Ish haqi", revenue: "Usluga", repair: "Remont usta", parts: "Zapchast", vulc: "Vulkanizatsiya", pickup: "Qayerdan", dropoff: "Qayerga", cargo: "Yuk", note: "Izoh",
};
const s = (v: number | null) => (v == null ? "" : String(v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type RowResult = { ok: true; note: string } | { error: string };

/**
 * Saqlash: qatorlar ketma-ket (reys qatori va QY-raqamlar to'qnashmasin). Bog'lanish serverda qayta tekshiriladi.
 * `token` — oyna ochilganda olingan bir martalik kalit: qator kaliti bilan qo'lda qatorning `clientToken`i (qayta bosilsa
 * dublikat bo'lmaydi). Haq tasdig'i uchun bildirishnoma import oxirida bitta.
 */
export async function saveLedgerImport(rows: ImportRow[], token: string, userId: string, canPay: boolean): Promise<Record<string, RowResult>> {
  const links = await checkLedgerImport(rows);
  const res: Record<string, RowResult> = {};
  let paid = 0, paySum = 0;
  for (const r of rows) {
    const km = (r.kmDt ?? 0) + (r.kmGas ?? 0), h = (r.hDt ?? 0) + (r.hGas ?? 0);
    const svc = ([["SERVICE_BANK", r.svcBank], ["SERVICE_CASH", r.svcCash], ["OBJECT", r.svcFree]] as const).filter(([, v]) => (v ?? 0) > 0);
    const l = links[r.key];
    try {
      if (l?.status === "ttn-notfound") { res[r.key] = { error: `TTN ${l.ttn.join(", ")} shu kuni shu mashinada topilmadi` }; continue; }
      if (l?.status === "linked") {
        // Reys qatorlariga: km, soat va haq reyslarga teng bo'lib, xarajat — birinchi reysga; bo'sh ustun reysdagini o'zgartirmaydi
        const n = l.trips.length, done: string[] = [];
        const payEach = (r.pay ?? 0) > 0 ? Math.floor((r.pay ?? 0) / n) : 0;
        for (let i = 0; i < n; i++) {
          const x = await ledgerEditData("trip", l.trips[i]!.id);
          if ("error" in x) throw new Error(`${l.trips[i]!.label}: ${x.error}`);
          const pay = payEach > 0 ? (i === 0 ? (r.pay ?? 0) - payEach * (n - 1) : payEach) : null;
          const d: LedgerEditInput = {
            date: null, driverId: x.driverId, vehicleId: x.vehicleId, trips: 1,
            km: km > 0 ? r1(km / n) : x.km, drumHours: h > 0 ? r2(h / n) : x.hours, kmGas: null, drumHoursGas: null,
            payAmount: pay, payType: r.payType || undefined, revenue: null, revenueType: undefined,
            pickup: r.pickup.trim() || x.pickup || null, dropoff: null, cargo: null,
            refuel: x.refuel || null, fuelPrice: x.fuelPrice,
            repair: i === 0 && (r.repair ?? 0) > 0 ? r.repair : x.repair, parts: i === 0 && (r.parts ?? 0) > 0 ? r.parts : x.parts,
            vulc: i === 0 && (r.vulc ?? 0) > 0 ? r.vulc : x.vulc, other: x.other,
            note: r.note.trim() || x.note, clientToken: null, payReason: x.priced ? "Hisob varag'i: Excel orqali qo'shish" : null,
          };
          const u = await updateLedgerRow("trip", x.id, d, userId, canPay, { silent: true });
          if ("error" in u) throw new Error(`${l.trips[i]!.label}: ${u.error}${done.length ? ` (${done.length} ta reysga yozilgan)` : ""}`);
          if (pay && pay !== x.pay) { paid++; paySum += pay; }
          done.push(l.trips[i]!.label);
        }
        res[r.key] = { ok: true, note: `Reysga yozildi: ${done.join(", ")}` };
        continue;
      }
      // Qo'lda qator
      if (svc.length > 1) { res[r.key] = { error: "Usluga summasi bitta ustunda bo'lsin: perechisleniya, naqd yoki tekin" }; continue; }
      const p = entrySchema.safeParse({
        // Reys bo'sh — 0 (remont, kunlik haq kabi reyssiz qator)
        date: r.date, driverId: r.driverId ?? "", vehicleId: r.vehicleId, trips: s(r.trips),
        km: km > 0 ? String(r1(km)) : "", kmGas: km > 0 ? String(r1(r.kmGas ?? 0)) : "",
        drumHours: h > 0 ? String(r2(h)) : "", drumHoursGas: h > 0 ? String(r2(r.hGas ?? 0)) : "",
        payAmount: s(r.pay), payType: r.payType, revenue: svc[0] ? s(svc[0][1]) : "", revenueType: svc[0]?.[0] ?? "",
        pickup: r.pickup, dropoff: r.dropoff, cargo: r.cargo, refuel: "", fuelPrice: "",
        repair: s(r.repair), parts: s(r.parts), vulc: s(r.vulc), other: "", note: r.note, clientToken: `${token}:${r.key}`.slice(0, 64),
      });
      if (!p.success) {
        const i = p.error.issues[0]!;
        res[r.key] = { error: `${FIELD[String(i.path[0])] ?? String(i.path[0] ?? "")}: ${i.message}` };
        continue;
      }
      const c = await createLogisticsEntry(p.data, userId, { silent: true });
      if ("error" in c) { res[r.key] = { error: c.error }; continue; }
      if ((p.data.payAmount ?? 0) > 0) { paid++; paySum += Math.round(p.data.payAmount ?? 0); }
      res[r.key] = { ok: true, note: `${c.docNo} qo'shildi` };
    } catch (e) {
      res[r.key] = { error: e instanceof Error ? e.message : "Saqlab bo'lmadi" };
    }
  }
  if (paid) notifyAfter(() => notifyRoles(PAY_APPROVER_ROLES, {
    type: "TRIP_PAY_APPROVE", title: `Hisob varag'i (Excel): ${paid} ta haq`,
    body: `Jami ${money(paySum)} — Haydovchilar tabelida tasdiqlang`,
  }, { except: userId }));
  return res;
}
