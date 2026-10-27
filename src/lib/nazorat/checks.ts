import { db } from "@/lib/db";
import { txSign } from "@/lib/cash-tx";
import { loadRevenue } from "@/lib/bi/core";
import { avgUnitCosts } from "@/lib/stock";
import { tripFuelNorm } from "@/lib/driver-trip-pay";
import { fmtNum, moneyShort } from "@/lib/format";
import { loadCategories, makeResolver } from "@/lib/fin-report/categories";
import type { Role } from "@/generated/prisma";

/**
 * Kunlik Nazorat — 14 ta tekshiruv («Insof 2026» → «Nazorat»). Har biri: holat, qiymat, mas'ul rollar, nima qilish kerak
 * va muammoli yozuvlarga havola. Hammasi ERP jurnallaridan hisoblanadi (kassa, sotuv, sklad, yoqilg'i, reyslar).
 * Kun — Toshkent kuni (UTC+5): server qaysi mintaqada bo'lmasin, «bugun» korxona uchun bir xil.
 */
export type CheckStatus = "crit" | "warn" | "ok" | "info" | "unset";
export type Check = { no: number; key: string; title: string; status: CheckStatus; value: string; roles: Role[]; owner: string; action: string; href: string; detail?: string };

export const STATUS_LABEL: Record<CheckStatus, string> = { crit: "Shoshilinch", warn: "Tekshirish kerak", ok: "Joyida", info: "Ma'lumot", unset: "Sozlanmagan" };

const TZ = 5 * 3_600_000, DAY = 86_400_000;
/** Toshkent kuni boshi (UTC sifatida saqlanadigan instant). */
export const tashkentDay = (d: Date = new Date()) => new Date(Math.floor((d.getTime() + TZ) / DAY) * DAY - TZ);
export const tashkentHour = (d: Date = new Date()) => new Date(d.getTime() + TZ).getUTCHours();
const tashkentMonthStart = (day: Date) => { const x = new Date(day.getTime() + TZ); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) - TZ); };
const dd = (d: Date) => { const x = new Date(d.getTime() + TZ); return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}`; };

/** Kassa qoldig'i hozir (barcha harakatlar + mijoz to'lovlari) — kassani yopish formasi ham shundan. */
export async function accountBalance(cashAccountId: string): Promise<number> {
  const [tx, pay] = await Promise.all([
    db.cashTransaction.groupBy({ by: ["type"], where: { cashAccountId, cancelledAt: null }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { cashAccountId }, _sum: { amount: true } }),
  ]);
  return Math.round((tx.reduce((s, g) => s + txSign(g.type) * Number(g._sum.amount ?? 0), 0) + Number(pay._sum.amount ?? 0)) * 100) / 100;
}

/** Nazorat — `day` kuni holatiga (sukut: bugun). `now` — soatga qarab «kassa yopilmagan» qizil yoki sariq. */
export async function runChecks(opts: { day?: Date; now?: Date } = {}): Promise<Check[]> {
  const now = opts.now ?? new Date();
  const day = tashkentDay(opts.day ?? now), next = new Date(day.getTime() + DAY);
  const month = tashkentMonthStart(day);
  const week = new Date(day.getTime() - 7 * DAY);
  const isToday = day.getTime() === tashkentDay(now).getTime();

  const [settings, nodes, cashAccounts, counts, txDay, payDay, revenueMonth, revenueDay, payCashMonth, catUse, loans, funded, issues, matCost, fuelLogs, trips, tripsWeek, logsWeek, openTrips, invMoves, cementIds] = await Promise.all([
    db.companySettings.findUnique({ where: { id: "main" }, select: { controlReportHour: true, fuelMaterialId: true } }),
    loadCategories(),
    db.cashAccount.findMany({ where: { type: "CASH", isActive: true }, select: { id: true, name: true } }),
    db.cashCount.findMany({ where: { day }, select: { cashAccountId: true, diff: true } }),
    db.cashTransaction.findMany({ where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: day, lt: next } }, select: { type: true, amount: true } }),
    db.payment.aggregate({ where: { date: { gte: day, lt: next } }, _sum: { amount: true } }),
    loadRevenue(month, next),
    loadRevenue(day, next),
    db.payment.aggregate({ where: { date: { gte: month, lt: next }, cashAccount: { type: "CASH" } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["category"], where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: new Date(day.getTime() - 90 * DAY), lt: next } }, _count: { _all: true } }),
    db.loan.count({ where: { cancelledAt: null } }),
    db.supplyRequest.findMany({ where: { status: "FUNDED" }, select: { id: true, docNo: true, eta: true, updatedAt: true } }),
    db.stockMove.findMany({ where: { type: "ISSUE", materialId: { not: null }, recipientId: null, employeeId: null, brigadeId: null, date: { gte: month, lt: next } }, select: { materialId: true, qty: true } }),
    avgUnitCosts(),
    db.fuelLog.groupBy({ by: ["fuelType"], where: { cancelledAt: null, date: { gte: month, lt: next } }, _sum: { liters: true, amount: true } }),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: month, lt: next } }, select: { payKm: true, distanceKm: true, workHours: true, vehicle: { select: { fuelType: true, fuelNormL100: true, idleNormPerHour: true, gasNormPer100: true, gasIdlePerHour: true } } } }),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: week, lt: day } }, select: { deliveredAt: true } }),
    db.fuelLog.findMany({ where: { cancelledAt: null, date: { gte: week, lt: day } }, select: { date: true } }),
    db.trip.count({ where: { status: { in: ["LOADED", "ON_ROAD"] }, OR: [{ departedAt: { lt: new Date(now.getTime() - DAY) } }, { departedAt: null, createdAt: { lt: new Date(now.getTime() - DAY) } }] } }),
    db.stockMove.findMany({ where: { refType: "Inventory", date: { lt: next } }, orderBy: { date: "desc" }, take: 500, select: { refId: true, date: true, qty: true, materialId: true } }),
    db.material.findMany({ where: { OR: [{ name: { contains: "sement", mode: "insensitive" } }, { name: { contains: "цемент", mode: "insensitive" } }, { group: { name: { contains: "sement", mode: "insensitive" } } }] }, select: { id: true } }),
  ]);
  const fuelMoves = settings?.fuelMaterialId
    ? await db.stockMove.aggregate({ where: { materialId: settings.fuelMaterialId, type: "RECEIPT", date: { gte: month, lt: next } }, _sum: { qty: true } })
    : null;
  const resolve = makeResolver(nodes);
  const hour = settings?.controlReportHour ?? 19;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // 1. Kassa yopildimi
  const counted = new Map(counts.map((c) => [c.cashAccountId, Number(c.diff)]));
  const missing = cashAccounts.filter((a) => !counted.has(a.id));
  const diffSum = [...counted.values()].reduce((s, v) => s + Math.abs(v), 0);
  add({
    no: 1, key: "cash-close", title: "Kassa bugun yopildimi (pul sanab solishtirildimi)", roles: ["CASHIER"], owner: "Kassir", href: "/cashflow#kassa-yopish",
    status: !cashAccounts.length ? "unset" : missing.length ? (isToday && tashkentHour(now) < hour ? "warn" : "crit") : diffSum >= 1000 ? "warn" : "ok",
    value: !cashAccounts.length ? "naqd kassa yo'q" : missing.length ? `yopilmagan: ${missing.map((a) => a.name).join(", ")}` : diffSum >= 1000 ? `farq ${fmtNum(diffSum)} so'm` : "yopildi",
    action: "Kechqurun naqdni sanab, Kirim-Chiqim → «Kassani yopish» ga yozsin",
  });

  // 2. Kassa jurnalidagi xato yozuvlar
  const unknown = catUse.filter((c) => !resolve(c.category)).reduce((s, c) => s + c._count._all, 0);
  const namesOf = (needs: "LOAN" | "ASSET") => nodes.filter((n) => n.needs === needs).flatMap((n) => [n.name, ...n.aliases]);
  const [loanUnlinked, assetUnlinked, future] = await Promise.all([
    loans ? db.cashTransaction.count({ where: { cancelledAt: null, loanId: null, type: { in: ["INCOME", "EXPENSE"] }, category: { in: namesOf("LOAN"), mode: "insensitive" } } }) : 0,
    db.cashTransaction.count({ where: { cancelledAt: null, type: "EXPENSE", fixedAsset: null, category: { in: namesOf("ASSET"), mode: "insensitive" } } }),
    db.cashTransaction.count({ where: { cancelledAt: null, date: { gte: new Date(next.getTime() + DAY) } } }),
  ]);
  const errs = unknown + loanUnlinked + assetUnlinked + future;
  add({
    no: 2, key: "cash-errors", title: "Kassa jurnalida xato yozuvlar", roles: ["CASHIER", "ACCOUNTING"], owner: "Kassir + buxgalter", href: unknown ? "/moliya/kategoriyalar" : loanUnlinked ? "/moliya/kreditlar" : assetUnlinked ? "/moliya/asosiy-vositalar" : "/cashflow",
    status: errs ? "warn" : "ok", value: errs ? `${errs} ta` : "yo'q",
    detail: errs ? [unknown && `kategoriyasi noma'lum ${unknown}`, loanUnlinked && `kreditga bog'lanmagan ${loanUnlinked}`, assetUnlinked && `kartochkasiz vosita ${assetUnlinked}`, future && `kelajak sanali ${future}`].filter(Boolean).join(", ") : undefined,
    action: "Moliya → Kategoriyalar / Kreditlar / Asosiy vositalar sahifalarida yozuvlarni to'g'irlasin",
  });

  // 3. Naqd sotuv − kassaga tushgan (oy)
  const cashOrders = new Set((await db.order.findMany({ where: { id: { in: [...new Set(revenueMonth.map((r) => r.orderId))] }, payMethod: "CASH" }, select: { id: true } })).map((o) => o.id));
  const cashSales = revenueMonth.filter((r) => cashOrders.has(r.orderId)).reduce((s, r) => s + r.revenue, 0);
  const cashIn = Number(payCashMonth._sum.amount ?? 0);
  const gap = cashSales - cashIn;
  add({
    no: 3, key: "cash-sales", title: "Naqd sotuv − kassaga tushgan pul (oy boshidan)", roles: ["SALES", "CASHIER"], owner: "Sotuvchilar + kassir", href: "/bi-tahlil/sotuvlar",
    status: !cashSales && !cashIn ? "info" : gap > Math.max(1_000_000, cashSales * 0.02) ? "warn" : "ok", value: `${fmtNum(gap)} so'm`,
    detail: `naqd sotuv ${moneyShort(cashSales)}, kassaga ${moneyShort(cashIn)}`,
    action: "Naqd sotilgan pul kassaga to'liq kirdimi — sotuvchidan so'rang",
  });

  // 4–5. Bugungi sotuv, bugungi kirim / chiqim — ma'lumot uchun
  add({ no: 4, key: "sales-today", title: "Bugungi sotuv (QQS bilan)", roles: [], owner: "—", href: "/bi-tahlil/sotuvlar", status: "info", value: `${fmtNum(revenueDay.reduce((s, r) => s + r.revenue, 0))} so'm`, action: "Ma'lumot uchun" });
  const inDay = Number(payDay._sum.amount ?? 0) + txDay.filter((t) => t.type === "INCOME").reduce((s, t) => s + Number(t.amount), 0);
  const outDay = txDay.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + Number(t.amount), 0);
  add({ no: 5, key: "cash-today", title: "Bugun kassaga kirim / chiqim", roles: [], owner: "—", href: "/cashflow", status: "info", value: `+${moneyShort(inDay)} / −${moneyShort(outDay)}`, action: "Ma'lumot uchun" });

  // 6. Snab ↔ sklad: pul berilgan, mol kelmagan
  const late = funded.filter((f) => (f.eta ?? f.updatedAt).getTime() < day.getTime() - 3 * DAY);
  add({
    no: 6, key: "supply", title: "Pul berilgan, 3 kundan beri skladga kelmagan ta'minot", roles: ["PROCUREMENT", "WAREHOUSE"], owner: "Snabjenets + skladchi", href: "/taminot",
    status: late.length ? "warn" : "ok", value: late.length ? `${late.length} ta` : "yo'q", detail: late.slice(0, 5).map((f) => f.docNo).join(", ") || undefined,
    action: "Ta'minot zayavkalarini tekshirib, kelgan molni qabul qilsin yoki pulni qaytarsin",
  });

  // 7. Salyarka: skladga kelgan − mashinalarga quyilgan (oy)
  const dieselLogs = fuelLogs.find((f) => f.fuelType === "DIESEL");
  const dieselGiven = Number(dieselLogs?._sum.liters ?? 0);
  if (!settings?.fuelMaterialId || !fuelMoves) {
    add({ no: 7, key: "diesel-stock", title: "Salyarka: skladga kelgan − mashinalarga quyilgan (oy)", roles: ["WAREHOUSE", "LOGISTICS"], owner: "Skladchi + logistika", href: "/dashboard?view=nazorat#sozlamalar", status: "unset", value: "dizel materiali tanlanmagan", action: "Nazorat sozlamasida qaysi xomashyo — dizel ekanini tanlang" });
  } else {
    const inLit = Number(fuelMoves._sum.qty ?? 0), d = inLit - dieselGiven;
    const price = matCost.get(settings.fuelMaterialId) ?? 0;
    add({
      no: 7, key: "diesel-stock", title: "Salyarka: skladga kelgan − mashinalarga quyilgan (oy)", roles: ["WAREHOUSE", "LOGISTICS"], owner: "Skladchi + logistika", href: "/logistika/yoqilgi",
      status: Math.abs(d) > Math.max(100, inLit * 0.03) ? "warn" : "ok", value: `${fmtNum(d)} l`, detail: `kirim ${fmtNum(inLit)} l, quyilgan ${fmtNum(dieselGiven)} l${price ? ` · ${moneyShort(d * price)} so'm` : ""}`,
      action: "Har bir quyish Yoqilg'i jurnaliga yozilsin; bakdagi qoldiqni o'lchang",
    });
  }

  // 8. Kimga berilgani yozilmagan sklad chiqimi (oy)
  const issueSum = issues.reduce((s, m) => s + Math.abs(Number(m.qty)) * (matCost.get(m.materialId!) ?? 0), 0);
  add({
    no: 8, key: "issue-unknown", title: "Kimga berilgani yozilmagan sklad chiqimi (oy)", roles: ["WAREHOUSE"], owner: "Skladchi", href: "/stock/rasxod",
    status: issues.length ? "warn" : "ok", value: issues.length ? `${fmtNum(issueSum)} so'm` : "yo'q", detail: issues.length ? `${issues.length} ta chiqim` : undefined,
    action: "Sklad → Расход: har bir chiqimga oluvchi (kimga) yozdirsin",
  });

  // 9. Sement silosi bugun o'lchandimi
  const cement = new Set(cementIds.map((m) => m.id));
  const cementCounts = invMoves.filter((m) => m.materialId && cement.has(m.materialId));
  const lastCement = cementCounts[0];
  const cementToday = cementCounts.filter((m) => m.date >= day && m.date < next);
  const cementDiff = cementToday.reduce((s, m) => s + Number(m.qty), 0);
  add({
    no: 9, key: "silo", title: "Sement silosi bugun o'lchandimi", roles: ["PRODUCTION"], owner: "BRU operatori", href: "/stock",
    status: !cement.size ? "unset" : cementToday.length ? (Math.abs(cementDiff) > 0 ? "warn" : "ok") : "warn",
    value: !cement.size ? "sement xomashyosi yo'q" : cementToday.length ? `farq ${fmtNum(cementDiff, 1)}` : "o'lchanmagan",
    detail: lastCement && !cementToday.length ? `oxirgi o'lchov ${dd(lastCement.date)}` : undefined,
    action: "Har kuni kechqurun silosni o'lchab, Sklad → Inventarizatsiyaga yozsin",
  });

  // 10. Yoqilg'i yozilmagan ish kunlari (oxirgi 7 kun)
  const tripDays = new Set(tripsWeek.map((t) => tashkentDay(t.deliveredAt!).getTime()));
  const logDays = new Set(logsWeek.map((l) => tashkentDay(l.date).getTime()));
  const gapDays = [...tripDays].filter((d) => !logDays.has(d)).sort();
  add({
    no: 10, key: "fuel-days", title: "Reys bo'lgan, yoqilg'i yozilmagan kunlar (7 kun)", roles: ["MECHANIC", "LOGISTICS"], owner: "Mexanik", href: "/logistika/yoqilgi",
    status: gapDays.length ? "warn" : "ok", value: gapDays.length ? `${gapDays.length} kun` : "yo'q", detail: gapDays.map((d) => dd(new Date(d))).join(", ") || undefined,
    action: "Shu kunlarning quyishlarini Yoqilg'i jurnaliga yozsin",
  });

  // 11. Yopilmagan reyslar (24 soatdan ortiq)
  add({
    no: 11, key: "open-trips", title: "24 soatdan beri yopilmagan reyslar", roles: ["LOGISTICS"], owner: "Logistika", href: "/trips",
    status: openTrips ? "warn" : "ok", value: openTrips ? `${openTrips} ta` : "yo'q", action: "Reyslarni yetkazildi / bekor qilindi deb yopsin",
  });

  // 12–13. DT va gaz: berilgani − normasi (oy)
  let dtNorm = 0, gasNorm = 0;
  for (const t of trips) {
    const v = t.vehicle, km = Number(t.payKm ?? t.distanceKm ?? 0), h = t.workHours != null ? Number(t.workHours) : null;
    if (!km && !h) continue;
    if (v.fuelType === "DIESEL" || v.fuelType === "DIESEL_METHANE") dtNorm += tripFuelNorm(v, km, h) ?? 0;
    if (v.fuelType === "METHANE") gasNorm += tripFuelNorm(v, km, h) ?? 0;
    if (v.fuelType === "DIESEL_METHANE") gasNorm += tripFuelNorm({ fuelNormL100: v.gasNormPer100, idleNormPerHour: v.gasIdlePerHour }, km, h) ?? 0;
  }
  const gasGiven = Number(fuelLogs.find((f) => f.fuelType === "METHANE")?._sum.liters ?? 0);
  const fuelCheck = (no: number, key: string, title: string, given: number, norm: number, unit: string): Check => {
    const d = given - norm;
    return {
      no, key, title, roles: ["DISPATCHER"], owner: "Haydovchilar (dispetcher)", href: "/logistika/yoqilgi",
      status: !norm && !given ? "info" : !norm ? "unset" : d > Math.max(50, norm * 0.05) ? "warn" : "ok",
      value: !norm && given ? "norma kiritilmagan" : `${d > 0 ? "+" : ""}${fmtNum(d)} ${unit}`, detail: `berildi ${fmtNum(given)}, norma ${fmtNum(norm)} ${unit}`,
      action: "Qaysi mashina normadan ko'p olganini Yoqilg'i sahifasida ko'ring",
    };
  };
  add(fuelCheck(12, "dt-norm", "DT: berilgani − normasi (oy)", dieselGiven, dtNorm, "l"));
  add(fuelCheck(13, "gas-norm", "Gaz: berilgani − normasi (oy)", gasGiven, gasNorm, "m³"));

  // 14. Sklad: oxirgi sanoq
  const lastInv = invMoves[0];
  const lastBatch = lastInv ? invMoves.filter((m) => m.refId === lastInv.refId) : [];
  const invDiff = lastBatch.reduce((s, m) => s + Number(m.qty) * (matCost.get(m.materialId ?? "") ?? 0), 0);
  const invAge = lastInv ? Math.floor((day.getTime() - tashkentDay(lastInv.date).getTime()) / DAY) : null;
  add({
    no: 14, key: "stock-count", title: "Sklad: oxirgi sanoq va farqi", roles: ["WAREHOUSE"], owner: "Skladchi", href: "/stock",
    status: invAge === null ? "crit" : invAge > 7 ? "warn" : Math.abs(invDiff) >= 1_000_000 ? "warn" : "ok",
    value: invAge === null ? "sanalmagan" : `${invAge} kun oldin · ${fmtNum(invDiff)} so'm`,
    action: "Haftada 1 marta Sklad → Inventarizatsiya qilsin",
  });

  return checks.sort((a, b) => a.no - b.no);
}
