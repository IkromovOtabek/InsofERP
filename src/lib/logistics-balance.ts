import { db } from "@/lib/db";
import { driverLedger, type LedgerTotals } from "@/lib/driver-ledger";
import { ledgerExtras } from "@/lib/ledger-extras";
import { transportCashNames, DELIVERY_LOGI_SINCE } from "@/lib/logistics-finance";
import { DISPATCH_WH_NAME } from "@/lib/dispatcher-stock";

/**
 * Logistika hisobi — to'rt raqam (foydalanuvchi qarori, 2026-11-26):
 *
 *   Tushum  = bajarilgan ish: dostavka (zayavka va Realizatsiya «Dost.»), usluga, zavod uchun ish (obyekt) — Hisob varag'i
 *             qatorlaridan + Logistika moliyada qo'lda yozilgan boshqa kirim;
 *   Xarajat = transportga haqiqatan ketgan pul:
 *             · kassada «Transport» manbasi bilan to'g'ridan yozilgan chiqim (zavod kassasidan — Logistikada ham ko'rinadi);
 *             · mashina xarajati (ta'mir, zapchast, balon, yo'l, jarima…: Hisob varag'i, skladdan berilgan zapchast, mexanik so'rovi,
 *               kassadan logistikaga olingan yozuv);
 *             · Logistika moliyadagi mashinaga yozilmagan chiqim (yoqilg'i xaridi, logistika boshlig'i chiqimi…);
 *             · dispetcher omboridan mashinaga berilgan yoqilg'i (sklad qiymati);
 *   Oylik   = haydovchilarga hisoblangan haq (reys haqi + qo'lda haq);
 *   Qoldiq  = Tushum − Xarajat − Oylik.
 *
 * Yoqilg'i normasi (km × norma) xarajatga qo'shilmaydi — faqat nazorat uchun; haydovchi/dispetcher yozgan zapravka ham (puli
 * kassada yoki skladda bor — ikki marta sanalmasin). Haydovchi haqi to'lovlari Xarajatga emas — Oylikda.
 * Har bir manba yozuvi `items` da — kartadan bosilganda shu ro'yxat ko'rinadi (son va ro'yxat bitta hisobdan).
 */

export type BalGroup = "Yoqilg'i" | "Ta'mir va zapchast" | "Balon, vulkanizator" | "Yollanma texnika" | "Yo'l, jarima" | "Boshqa";
export const BAL_GROUPS: BalGroup[] = ["Yoqilg'i", "Ta'mir va zapchast", "Balon, vulkanizator", "Yollanma texnika", "Yo'l, jarima", "Boshqa"];
export type BalSource = "kassa" | "mashina" | "logistika" | "sklad";
export const BAL_SOURCE_LABEL: Record<BalSource, string> = {
  kassa: "Zavod kassasi (Transport)", mashina: "Mashina xarajati", logistika: "Logistika moliya", sklad: "Dispetcher omboridan yoqilg'i",
};
export type BalItem = { id: string; date: Date; title: string; sub?: string; amount: number; group: BalGroup; source: BalSource; href?: string };

export type LogiBalance = {
  from: Date; to: Date;
  tushum: number; tushumParts: { dostavka: number; usluga: number; obyekt: number; boshqa: number };
  xarajat: number; xarajatByGroup: Record<BalGroup, number>; xarajatBySource: Record<BalSource, number>;
  oylik: number; qoldiq: number;
  items: BalItem[];
  ledger: LedgerTotals;
};

/** Toifa nomi / izohdan guruh (lotin va kirill). */
export function balGroupOf(text: string): BalGroup {
  const t = text.toLowerCase();
  if (/yoqil|benzin|solyar|salyar|dizel|metan|propan|zapravk|ёқил|бензин|соляр|дизел|метан|пропан|заправк/.test(t)) return "Yoqilg'i";
  if (/balon|ballon|shina|pokrishk|vulkan|балон|баллон|шина|покрышк|вулкан/.test(t)) return "Balon, vulkanizator";
  if (/yollanma|nasos|ijara|arenda|наём|ёлланма|ижара|аренд|насос/.test(t)) return "Yollanma texnika";
  if (/yo'?l|shtraf|jarima|sug'?urta|strax|kira|штраф|жарима|йўл|суғурта|страх/.test(t)) return "Yo'l, jarima";
  if (/ta'?mir|remont|usta|zapchast|ehtiyot|moy|filtr|akkumul|ремонт|таъмир|уста|запчаст|эхтиёт|мой|фильтр/.test(t)) return "Ta'mir va zapchast";
  return "Boshqa";
}
const kindGroup: Record<string, BalGroup> = {
  REPAIR: "Ta'mir va zapchast", PARTS: "Ta'mir va zapchast", ROAD: "Yo'l, jarima", FINE: "Yo'l, jarima", PARKING: "Yo'l, jarima", WASH: "Boshqa", OTHER: "Boshqa",
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** `ledger` — shu davr uchun allaqachon hisoblangan Hisob varag'i (sahifada qayta hisoblanmasin). */
export async function logiBalance(from: Date, to: Date, ledger?: { total: LedgerTotals }): Promise<LogiBalance> {
  const range = { gte: from, lt: to };
  const names = await transportCashNames();
  const [led, extras, cash, exps, ltx, fuel] = await Promise.all([
    ledger ? Promise.resolve(ledger) : driverLedger(from, to),
    ledgerExtras(from, to),
    // Kassada to'g'ridan yozilgan transport chiqimi (hujjatga bog'lanmagan: mexanik so'rovi, ta'minot, logistika yozuvi — o'z joyida)
    db.cashTransaction.findMany({
      where: { cancelledAt: null, type: "EXPENSE", date: range, refType: null, OR: [{ category: { in: names } }, { subCategory: { in: names } }] },
      select: { id: true, date: true, amount: true, category: true, subCategory: true, counterparty: true, note: true, cashAccount: { select: { name: true } } },
    }),
    db.transportExpense.findMany({
      where: { cancelledAt: null, kind: { not: "DRIVER_PAY" }, date: range },
      select: { id: true, date: true, amount: true, kind: true, note: true, vehicle: { select: { plate: true } }, trip: { select: { vehicle: { select: { plate: true } } } } },
    }),
    // Logistika moliya chiqimi, mashina xarajati yaratilmagan (yoqilg'i xaridi, mashinasiz chiqim); haq to'lovi — Oylikda
    db.logisticsTx.findMany({
      where: {
        cancelledAt: null, type: "EXPENSE", date: range, transportExpenseId: null, category: { not: "Haydovchi haqi" },
        OR: [{ refType: null }, { refType: { notIn: ["MechanicRequest", "DriverMonthPay"] } }],
      },
      select: { id: true, docNo: true, date: true, amount: true, category: true, counterparty: true, note: true, vehicleId: true },
    }),
    db.fuelLog.findMany({
      where: { cancelledAt: null, date: range, station: DISPATCH_WH_NAME },
      select: { id: true, date: true, amount: true, liters: true, note: true, vehicle: { select: { plate: true } } },
    }),
  ]);
  const vehIds = [...new Set(ltx.flatMap((t) => (t.vehicleId ? [t.vehicleId] : [])))];
  const plateOf = new Map((vehIds.length ? await db.vehicle.findMany({ where: { id: { in: vehIds } }, select: { id: true, plate: true } }) : []).map((v) => [v.id, v.plate]));

  const items: BalItem[] = [];
  for (const c of cash) {
    const cat = c.subCategory ?? c.category;
    items.push({
      id: `c:${c.id}`, date: c.date, amount: Number(c.amount), source: "kassa", group: balGroupOf(`${cat} ${c.note ?? ""}`),
      title: `Kassa · ${cat}`, sub: [c.cashAccount.name, c.counterparty, c.note].filter(Boolean).join(" · ") || undefined,
    });
  }
  for (const e of exps) {
    const plate = e.vehicle?.plate ?? e.trip?.vehicle.plate ?? null;
    const g = /vulkaniz|balon|shina/i.test(e.note ?? "") ? "Balon, vulkanizator" : kindGroup[e.kind] ?? "Boshqa";
    items.push({ id: `e:${e.id}`, date: e.date, amount: Number(e.amount), source: "mashina", group: g, title: `${plate ?? "Mashina"} · ${g}`, sub: e.note ?? undefined });
  }
  for (const t of ltx) {
    const plate = t.vehicleId ? plateOf.get(t.vehicleId) ?? null : null;
    items.push({
      id: `l:${t.id}`, date: t.date, amount: Number(t.amount), source: "logistika", group: balGroupOf(`${t.category} ${t.note ?? ""}`),
      title: `${t.docNo} · ${t.category}`, sub: [plate, t.counterparty, t.note].filter(Boolean).join(" · ") || undefined, href: "/logistika/moliya?tab=jurnal",
    });
  }
  for (const f of fuel) {
    items.push({ id: `f:${f.id}`, date: f.date, amount: Number(f.amount), source: "sklad", group: "Yoqilg'i", title: `${f.vehicle.plate} · yoqilg'i ${Number(f.liters)}`, sub: f.note ?? undefined });
  }
  items.sort((a, b) => b.date.getTime() - a.date.getTime() || b.amount - a.amount);

  const byGroup = Object.fromEntries(BAL_GROUPS.map((g) => [g, 0])) as Record<BalGroup, number>;
  const bySource: Record<BalSource, number> = { kassa: 0, mashina: 0, logistika: 0, sklad: 0 };
  for (const i of items) { byGroup[i.group] += i.amount; bySource[i.source] += i.amount; }
  const t = led.total;
  const boshqa = extras.income.reduce((a, x) => a + x.amount, 0);
  const tushum = r2(t.revenue + boshqa);
  const xarajat = r2(items.reduce((a, i) => a + i.amount, 0));
  const oylik = r2(t.pay);
  return {
    from, to, tushum,
    tushumParts: { dostavka: r2(t.revBank + t.revCash + t.revDebt), usluga: r2(t.svcBank + t.svcCash), obyekt: r2(t.revOther), boshqa: r2(boshqa) },
    xarajat, xarajatByGroup: byGroup, xarajatBySource: bySource, oylik, qoldiq: r2(tushum - xarajat - oylik), items, ledger: t,
  };
}

/** Boshidan (logistika alohida hisobi boshlangan kun — `DELIVERY_LOGI_SINCE`) hozirgacha qoldiq: logistika boshlig'i chiqimi shundan. */
export async function logiQoldiqNow(): Promise<{ qoldiq: number; since: Date }> {
  const now = new Date();
  const b = await logiBalance(DELIVERY_LOGI_SINCE, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  return { qoldiq: b.qoldiq, since: DELIVERY_LOGI_SINCE };
}
