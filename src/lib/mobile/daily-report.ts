import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { ISSUE_KIND, TRIP_PHASE, tripPhase } from "@/lib/logistics";
import { BRIGADE_ISSUE } from "@/lib/brigade-shift";
import { unitLabel } from "@/lib/unit";
import { ownerCached } from "./owner-cache";
import type { MobileUser } from "./auth";
import { ListError } from "./list";

/**
 * Kunlik hisobot (Excel) — direktor ilovasidagi "Kunlik hisobot (Excel)" tugmasi.
 * `GET /api/mobile/report/daily?date=YYYY-MM-DD` → .xlsx: xulosa, sotuv, ishlab chiqarish,
 * reyslar, to'lovlar (mijoz to'lovlari va kirim-chiqim), muammolar — har biri alohida varaqda.
 * Raqamlar bazadan to'g'ridan-to'g'ri (veb hisobotlari bilan bir xil jadvallar), ilova faylni faqat ulashadi.
 */

/** Hisobotni kim yuklaydi: direktor (pul, sotuv, muammolar — hammasi bir faylda). */
const REPORT_ROLES = ["DIRECTOR"] as const;

const ORDER_LABEL: Record<string, string> = { DRAFT: "Qoralama", BLOCKED: "Bloklangan", CONFIRMED: "Tasdiqlangan", IN_PRODUCTION: "Ishlab chiqarishda", DELIVERED: "Yetkazildi", CLOSED: "Yopildi", CANCELLED: "Bekor qilingan" };
const TX_LABEL: Record<string, string> = { INCOME: "Kirim", EXPENSE: "Chiqim", OPENING: "Boshlang'ich qoldiq" };
const LEVEL_LABEL: Record<string, string> = { crit: "Jiddiy", warn: "Ogohlantirish", ok: "Joyida" };

const F_MONEY = "#,##0";
const F_QTY = "#,##0.0##";
const F_INT = "0";

type Col = { h: string; w?: number; z?: string };
type Cell = string | number | null;

const n = (v: unknown) => Number(v ?? 0);
const hm = (d: Date | null | undefined) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "");
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

/**
 * Varaq: 1-qator — sarlavha (birlashtirilgan), 2-qator — ustun nomlari, keyin ma'lumot, oxirida "Jami".
 * Raqamli ustunlarga Excel formati (`z`) qo'yiladi — fayl ochilganda summa "1 250 000" bo'lib ko'rinadi.
 */
function sheet(title: string, cols: Col[], rows: Cell[][], totals?: Cell[]): XLSX.WorkSheet {
  const aoa: Cell[][] = [[title], cols.map((c) => c.h), ...(rows.length ? rows : [["Bu kunda yozuv yo'q"]])];
  if (totals && rows.length) aoa.push(totals);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, cols.length - 1) } }];
  ws["!cols"] = cols.map((c, i) => ({ wch: c.w ?? Math.min(48, Math.max(c.h.length + 2, ...aoa.slice(1).map((r) => String(r[i] ?? "").length + 2))) }));
  ws["!autofilter"] = rows.length ? { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: 1 + rows.length, c: cols.length - 1 } }) } : undefined;
  for (let r = 2; r < aoa.length; r++) {
    cols.forEach((c, ci) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
      if (c.z && cell && cell.t === "n") cell.z = c.z;
    });
  }
  return ws;
}

export function dayBounds(raw?: string | null): { from: Date; to: Date; iso: string } {
  const ok = !!raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(`${raw}T00:00:00`).getTime());
  const from = ok ? new Date(`${raw}T00:00:00`) : new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  const iso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
  return { from, to, iso };
}

export async function dailyReportXlsx(user: MobileUser, rawDate?: string | null): Promise<{ file: Buffer; name: string }> {
  if (!(REPORT_ROLES as readonly string[]).includes(user.role)) throw new ListError("FORBIDDEN", "Kunlik hisobot faqat direktorga ochiq", 403);
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) throw new ListError("BAD_REQUEST", "Sana YYYY-MM-DD ko'rinishida bo'lsin", 400);
  const { from, to, iso } = dayBounds(rawDate);
  // "2026-02-31" kabi mavjud bo'lmagan sana JS'da jimgina 3-martga aylanardi — boshqa kunning hisobotini bermaymiz
  if (rawDate && iso !== rawDate) throw new ListError("BAD_REQUEST", "Bunday sana yo'q", 400);
  if (from.getTime() > Date.now()) throw new ListError("BAD_REQUEST", "Kelajakdagi kun uchun hisobot yo'q", 400);
  const range = { gte: from, lt: to };
  const isToday = new Date() >= from && new Date() < to;

  const [orders, batches, trips, payments, txs, tripIssues, brigIssues, owner] = await Promise.all([
    db.order.findMany({
      where: { kind: "SALE", date: range },
      orderBy: { date: "asc" },
      include: { customer: { select: { name: true } }, createdBy: { select: { fullName: true } }, items: { include: { product: { select: { name: true, unit: true } } } } },
    }),
    db.productionBatch.findMany({
      where: { date: range },
      orderBy: { date: "asc" },
      include: { product: { select: { name: true, unit: true } }, order: { select: { orderNo: true, customer: { select: { name: true } } } }, createdBy: { select: { fullName: true } } },
    }),
    db.trip.findMany({
      where: { OR: [{ createdAt: range }, { loadedAt: range }, { deliveredAt: range }] },
      orderBy: { createdAt: "asc" },
      include: { order: { select: { orderNo: true, deliveryAddress: true, customer: { select: { name: true } }, items: { select: { product: { select: { unit: true } } } } } }, vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } },
    }),
    db.payment.findMany({ where: { date: range }, orderBy: { date: "asc" }, include: { customer: { select: { name: true } }, cashAccount: { select: { name: true } }, invoice: { select: { invoiceNo: true } }, createdBy: { select: { fullName: true } } } }),
    db.cashTransaction.findMany({ where: { date: range, type: { not: "OPENING" } }, orderBy: { date: "asc" }, include: { cashAccount: { select: { name: true } }, createdBy: { select: { fullName: true } } } }),
    db.tripIssue.findMany({ where: { OR: [{ createdAt: range }, { resolvedAt: range }] }, orderBy: { createdAt: "asc" }, include: { trip: { select: { deliveryNoteNo: true, vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } } } } }),
    db.brigadeIssue.findMany({ where: { OR: [{ createdAt: range }, { resolvedAt: range }] }, orderBy: { createdAt: "asc" }, include: { brigade: { select: { name: true } }, createdBy: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } } } }),
    // Egasi qarorini kutayotgan masalalar — "hozirgi holat", shuning uchun faqat bugungi hisobotda
    isToday ? ownerCached().catch(() => null) : Promise.resolve(null),
  ]);

  // ── Sotuv ──
  const live = orders.filter((o) => o.status !== "CANCELLED" && o.status !== "DRAFT");
  const salesRows: Cell[][] = orders.flatMap((o) => o.items.map((i) => [
    o.orderNo, hm(o.date), o.customer.name, i.product.name, n(i.qtyM3), unitLabel(i.product.unit), n(i.price), n(i.qtyM3) * n(i.price), ORDER_LABEL[o.status] ?? o.status, o.createdBy.fullName,
  ]));
  const salesSum = live.reduce((s, o) => s + o.items.reduce((x, i) => x + n(i.qtyM3) * n(i.price), 0), 0);

  // ── Ishlab chiqarish ──
  const madeRows: Cell[][] = batches.map((b) => [
    b.batchNo, hm(b.date), b.shift, b.product.name, n(b.qtyM3), unitLabel(b.product.unit), b.order ? `${b.order.orderNo} · ${b.order.customer.name}` : "Omborga", b.createdBy.fullName, b.cancelledAt ? `Bekor: ${b.cancelReason ?? ""}` : "Faol",
  ]);
  const madeByUnit = new Map<string, number>();
  for (const b of batches) if (!b.cancelledAt) madeByUnit.set(b.product.unit, (madeByUnit.get(b.product.unit) ?? 0) + n(b.qtyM3));

  // ── Reyslar ──
  const tripRows: Cell[][] = trips.map((t) => {
    const unit = t.order.items.every((i) => i.product.unit === "m3") ? "m3" : t.order.items[0]?.product.unit ?? "m3";
    return [
      t.deliveryNoteNo, t.order.orderNo, t.order.customer.name, t.order.deliveryAddress, t.vehicle.plate, t.driver.fullName,
      n(t.qtyM3), unitLabel(unit), t.status === "CANCELLED" ? "Bekor qilindi" : TRIP_PHASE[tripPhase(t)].label, hm(t.loadedAt), hm(t.departedAt), hm(t.deliveredAt),
    ];
  });
  const delivered = trips.filter((t) => t.status === "DELIVERED" && t.deliveredAt && t.deliveredAt >= from && t.deliveredAt < to);
  const shippedByUnit = new Map<string, number>();
  for (const t of delivered) {
    const u = t.order.items.every((i) => i.product.unit === "m3") ? "m3" : t.order.items[0]?.product.unit ?? "m3";
    shippedByUnit.set(u, (shippedByUnit.get(u) ?? 0) + n(t.acceptedQty ?? t.qtyM3));
  }

  // ── To'lovlar ──
  const payRows: Cell[][] = payments.map((p) => [hm(p.date), p.customer.name, p.invoice?.invoiceNo ?? (p.orderId ? "Avans" : ""), p.cashAccount.name, n(p.amount), p.note ?? "", p.createdBy?.fullName ?? ""]);
  const paySum = payments.reduce((s, p) => s + n(p.amount), 0);
  const txRows: Cell[][] = txs.map((t) => [hm(t.date), TX_LABEL[t.type] ?? t.type, t.category, t.counterparty ?? "", t.cashAccount.name, t.type === "EXPENSE" ? -n(t.amount) : n(t.amount), t.note ?? "", t.createdBy.fullName]);
  const income = txs.filter((t) => t.type === "INCOME").reduce((s, t) => s + n(t.amount), 0);
  const expense = txs.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + n(t.amount), 0);

  // ── Muammolar ──
  const problemRows: Cell[][] = [
    ...tripIssues.map((i) => [hm(i.createdAt), "Reys", `${i.trip.deliveryNoteNo} · ${i.trip.vehicle.plate}`, ISSUE_KIND[i.kind], i.note ?? "", i.trip.driver.fullName, i.resolvedAt ? `Hal qilindi ${hm(i.resolvedAt)}${i.resolution ? ` — ${i.resolution}` : ""}` : "Ochiq"] as Cell[]),
    ...brigIssues.map((i) => [hm(i.createdAt), "Brigada", i.brigade.name, BRIGADE_ISSUE[i.kind]?.label ?? i.kind, i.note, i.createdBy.fullName, i.resolvedAt ? `Hal qilindi ${hm(i.resolvedAt)}${i.resolvedBy ? ` · ${i.resolvedBy.fullName}` : ""}${i.resolution ? ` — ${i.resolution}` : ""}` : "Ochiq"] as Cell[]),
    ...(owner?.decisions ?? []).map((d) => ["hozir", "Egasi qarori", d.owner, d.problem, `${d.decision}${d.effect ? ` · ${d.effect}` : ""}`, `muddat: ${d.due}`, LEVEL_LABEL[d.level] ?? d.level] as Cell[]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const openProblems = tripIssues.filter((i) => !i.resolvedAt).length + brigIssues.filter((i) => !i.resolvedAt).length;

  const qtyText = (m: Map<string, number>) => [...m.entries()].map(([u, q]) => `${Math.round(q * 10) / 10} ${unitLabel(u)}`).join(" · ") || "0";
  const title = (what: string) => `${what} — ${dmy(from)}`;

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: `Kunlik hisobot ${dmy(from)}`, Author: user.fullName, CreatedDate: new Date() };

  XLSX.utils.book_append_sheet(wb, sheet(title("Kunlik hisobot: xulosa"), [{ h: "Ko'rsatkich", w: 34 }, { h: "Qiymat", w: 18, z: F_MONEY }, { h: "Izoh", w: 40 }], [
    ["Zayavkalar soni", live.length, `${orders.length - live.length} ta qoralama/bekor alohida`],
    ["Sotuv summasi, so'm", Math.round(salesSum), "qoralama va bekor qilinganlarsiz"],
    ["Ishlab chiqarildi", null, qtyText(madeByUnit)],
    ["Zameslar soni", batches.filter((b) => !b.cancelledAt).length, ""],
    ["Yetkazilgan reyslar", delivered.length, qtyText(shippedByUnit)],
    ["Jami reyslar (kun davomida harakat)", trips.length, ""],
    ["Mijoz to'lovlari, so'm", Math.round(paySum), `${payments.length} ta to'lov`],
    ["Boshqa kirim, so'm", Math.round(income), ""],
    ["Chiqim, so'm", Math.round(expense), ""],
    ["Ochiq muammolar (shu kundagi)", openProblems, `${tripIssues.length + brigIssues.length} ta qayd`],
    ...(owner ? [["Egasi qarorini kutayotgan masalalar", owner.decisions.length, owner.reportText] as Cell[]] : []),
    ["Hisobot tuzildi", null, `${dmy(new Date())} ${hm(new Date())} · ${user.fullName}`],
  ]), "Xulosa");

  XLSX.utils.book_append_sheet(wb, sheet(title("Sotuv (zayavkalar)"), [
    { h: "Zayavka" }, { h: "Vaqt" }, { h: "Mijoz" }, { h: "Mahsulot" }, { h: "Miqdor", z: F_QTY }, { h: "Birlik" }, { h: "Narx, so'm", z: F_MONEY }, { h: "Summa, so'm", z: F_MONEY }, { h: "Holat" }, { h: "Kiritdi" },
  ], salesRows, ["Jami (faol)", null, null, null, null, null, null, Math.round(salesSum), null, null]), "Sotuv");

  XLSX.utils.book_append_sheet(wb, sheet(title("Ishlab chiqarish (zameslar)"), [
    { h: "Zames" }, { h: "Vaqt" }, { h: "Smena", z: F_INT }, { h: "Mahsulot" }, { h: "Miqdor", z: F_QTY }, { h: "Birlik" }, { h: "Zayavka / mijoz" }, { h: "Kiritdi" }, { h: "Holat" },
  ], madeRows), "Ishlab chiqarish");

  XLSX.utils.book_append_sheet(wb, sheet(title("Otgruzka va reyslar"), [
    { h: "Nakladnoy" }, { h: "Zayavka" }, { h: "Mijoz" }, { h: "Manzil", w: 36 }, { h: "Mashina" }, { h: "Haydovchi" }, { h: "Miqdor", z: F_QTY }, { h: "Birlik" }, { h: "Bosqich" }, { h: "Yuklandi" }, { h: "Yo'lga chiqdi" }, { h: "Yetkazildi" },
  ], tripRows), "Reyslar");

  XLSX.utils.book_append_sheet(wb, sheet(title("Mijoz to'lovlari"), [
    { h: "Vaqt" }, { h: "Mijoz" }, { h: "Schyot" }, { h: "Kassa / hisob" }, { h: "Summa, so'm", z: F_MONEY }, { h: "Izoh", w: 30 }, { h: "Qabul qildi" },
  ], payRows, ["Jami", null, null, null, Math.round(paySum), null, null]), "To'lovlar");

  XLSX.utils.book_append_sheet(wb, sheet(title("Kirim-chiqim (kassa va bank)"), [
    { h: "Vaqt" }, { h: "Turi" }, { h: "Kategoriya" }, { h: "Kontragent" }, { h: "Kassa / hisob" }, { h: "Summa, so'm", z: F_MONEY }, { h: "Izoh", w: 30 }, { h: "Kiritdi" },
  ], txRows, ["Sof oqim", null, null, null, null, Math.round(income - expense), null, null]), "Kirim-chiqim");

  XLSX.utils.book_append_sheet(wb, sheet(title("Muammolar"), [
    { h: "Vaqt" }, { h: "Manba" }, { h: "Obyekt" }, { h: "Muammo", w: 36 }, { h: "Izoh", w: 40 }, { h: "Kim / muddat" }, { h: "Holat", w: 28 },
  ], problemRows), "Muammolar");

  const file = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  return { file, name: `kunlik-hisobot-${iso}.xlsx` };
}
