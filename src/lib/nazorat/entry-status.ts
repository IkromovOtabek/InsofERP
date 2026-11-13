import { db } from "@/lib/db";
import { dayUtc, today as todayIso } from "@/lib/davomat";
import { realizationLog } from "@/lib/realization-log";
import { isWorkDay, workCalendar } from "@/lib/work-calendar";
import { fmtNum } from "@/lib/format";
import type { Role } from "@/generated/prisma";
import { tashkentDay } from "./checks";

/**
 * Kiritish nazorati — bugun har bo'lim o'z ma'lumotini tizimga kiritdimi (direktor Tahlil sahifasidagi salomlashuv qatori):
 *   Kadrlar — xodimlar davomati (yuz skaneri / qo'lda) belgilanganmi;
 *   Sklad — bugungi kirim va chiqim yozilganmi;
 *   Ishlab chiqarish — bugungi ishlab chiqarish (partiyalar) kiritilganmi;
 *   Realizatsiya — bugungi jo'natmalar reestrda to'liq yozilganmi (TTN, narx, ortilgan joy, manzil);
 *   Kassa — bugungi kirim-chiqim yozilganmi va kassa yopilganmi (pul sanab solishtirildi).
 * Har birida mas'ul xodim(lar) — shu rol foydalanuvchilari. Dam olish kunida yozuv bo'lmasa — «dam olish kuni».
 */
export type EntryState = "ok" | "partial" | "missing" | "none";
export type EntryStatus = { key: string; dept: string; state: EntryState; text: string; who: string[]; href: string };

const DAY = 86_400_000;
/** Sklad xodimi qo'lda yozadigan harakatlar (ishlab chiqarish sarfi va jo'natma avtomatik — ular hisobga olinmaydi). */
const STOCK_IN = ["RECEIPT"] as const;
const STOCK_OUT = ["ISSUE", "BRIGADE_ISSUE", "WRITE_OFF"] as const;

const ROLES: Record<string, Role[]> = {
  hr: ["HR"], stock: ["WAREHOUSE"], production: ["PRODUCTION"], realization: ["LOGISTICS", "DISPATCHER"], cash: ["CASHIER"],
};

export async function entryStatus(now: Date = new Date()): Promise<EntryStatus[]> {
  const day = tashkentDay(now), next = new Date(day.getTime() + DAY);
  const [cal, users, employees, attendance, stockMoves, batches, log, cashAccounts, counts, txCount, payCount] = await Promise.all([
    workCalendar(),
    db.user.findMany({ where: { isActive: true, role: { in: Object.values(ROLES).flat() } }, select: { fullName: true, role: true }, orderBy: { fullName: "asc" } }),
    db.employee.count({ where: { isActive: true, external: false } }),
    db.attendance.findMany({ where: { date: dayUtc(todayIso()), employee: { isActive: true, external: false } }, select: { facePhoto: true } }),
    db.stockMove.groupBy({ by: ["type"], where: { date: { gte: day, lt: next }, type: { in: [...STOCK_IN, ...STOCK_OUT] } }, _count: { _all: true } }),
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: day, lt: next } }, select: { qtyM3: true, product: { select: { unit: true } } } }),
    realizationLog(now, now).catch(() => null),
    db.cashAccount.findMany({ where: { type: "CASH", isActive: true }, select: { id: true, name: true } }),
    db.cashCount.findMany({ where: { day }, select: { cashAccountId: true } }),
    db.cashTransaction.count({ where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: day, lt: next } } }),
    db.payment.count({ where: { date: { gte: day, lt: next } } }),
  ]);
  const workday = isWorkDay(cal, now);
  const who = (key: string) => users.filter((u) => ROLES[key]!.includes(u.role)).map((u) => u.fullName);
  /** Yozuv yo'q: ish kunida — «yozilmagan», dam olish kunida — kulrang ma'lumot. */
  const empty = (text: string): Pick<EntryStatus, "state" | "text"> => (workday ? { state: "missing", text } : { state: "none", text: "dam olish kuni" });
  const out: EntryStatus[] = [];

  // Kadrlar: davomat
  const marked = attendance.length, face = attendance.filter((a) => a.facePhoto).length;
  out.push({
    key: "hr", dept: "Kadrlar", who: who("hr"), href: "/otdel-kadr?tab=davomat",
    ...(!employees ? { state: "none" as const, text: "xodim yo'q" }
      : !marked ? empty(`davomat belgilanmagan · 0/${employees}`)
      : marked < employees ? { state: "partial" as const, text: `davomat ${marked}/${employees} · ${employees - marked} xodim belgilanmagan` }
      : { state: "ok" as const, text: `davomat ${marked}/${employees}${face ? ` · yuz bilan ${face}` : ""}` }),
  });

  // Sklad: kirim va chiqim
  const cnt = (types: readonly string[]) => stockMoves.filter((g) => types.includes(g.type)).reduce((s, g) => s + g._count._all, 0);
  const sIn = cnt(STOCK_IN), sOut = cnt(STOCK_OUT);
  out.push({
    key: "stock", dept: "Sklad", who: who("stock"), href: "/stock",
    ...(!sIn && !sOut ? empty("bugun kirim-chiqim yozilmagan") : { state: "ok" as const, text: `kirim ${sIn} · chiqim ${sOut}` }),
  });

  // Ishlab chiqarish: partiyalar (beton m³, dona mahsulot)
  const m3 = batches.filter((b) => b.product.unit === "m3").reduce((s, b) => s + Number(b.qtyM3), 0);
  const pcs = batches.filter((b) => b.product.unit !== "m3").reduce((s, b) => s + Number(b.qtyM3), 0);
  out.push({
    key: "production", dept: "Ishlab chiqarish", who: who("production"), href: "/production",
    ...(!batches.length ? empty("bugun kiritilmagan")
      : { state: "ok" as const, text: [`${batches.length} partiya`, m3 ? `${fmtNum(m3, 1)} m³` : "", pcs ? `${fmtNum(pcs)} dona` : ""].filter(Boolean).join(" · ") }),
  });

  // Realizatsiya: reysdan qatorda dispetcher TTN, ortilgan joy va manzilni yozgan, narx bor; qo'lda qatorda TTN va narx
  if (log) {
    const full = (r: (typeof log)[number]) => r.price > 0 && (r.source === "MANUAL" ? !!r.ttn : !!r.tripTtn && !!r.filled?.loadPlace && !!r.filled?.destination);
    const done = log.filter(full).length, total = log.length;
    out.push({
      key: "realization", dept: "Realizatsiya", who: who("realization"), href: "/logistika/realizatsiya",
      ...(!total ? { state: "none" as const, text: "bugun jo'natma yo'q" }
        : done === total ? { state: "ok" as const, text: `${total} qator to'liq yozilgan` }
        : done === 0 ? { state: "missing" as const, text: `${total} qator — to'liq yozilmagan` }
        : { state: "partial" as const, text: `qisman: ${total - done}/${total} qator to'liq emas` }),
    });
  }

  // Kassa: bugungi yozuvlar va kassa yopilishi
  const entries = txCount + payCount;
  const closed = new Set(counts.map((c) => c.cashAccountId));
  const open = cashAccounts.filter((a) => !closed.has(a.id));
  out.push({
    key: "cash", dept: "Kassa", who: who("cash"), href: "/payments",
    ...(!entries && !closed.size ? empty("bugun kirim-chiqim yozilmagan")
      : open.length ? { state: "partial" as const, text: `${entries} yozuv · kassa yopilmagan${cashAccounts.length > 1 ? ` (${open.map((a) => a.name).join(", ")})` : ""}` }
      : { state: "ok" as const, text: `${entries} yozuv${cashAccounts.length ? " · kassa yopildi" : ""}` }),
  });

  return out;
}
