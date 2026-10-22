import { z } from "zod";
import { Prisma, type RentMethod, type RentTxType } from "@/generated/prisma";
import { db } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { MAX_AMOUNT } from "@/lib/action";
import { dateRu, fmtNum, money } from "@/lib/format";
import {
  RENT_AREA_MAX, RENT_EXPENSE_CATEGORIES, RENT_INCOME_CATEGORY, RENT_METHOD_LABEL, cancelRentTx, createRentTx, currentMonth, monthKey, monthLabel,
  monthSheet, openMonth, parseMonth, rentBalance, saveRentShopData, shiftMonth, shopDebts, leaseDebts, saveRentChargeData, RENT_MAX_MONTHS, RENT_ELEC_CATEGORY, RENT_SHOP_STATUS, RENT_PERIOD_LABEL, RENT_PAY_STATUS_LABEL, rentFor, rentPerM2, rentShopStates, toggleRentShopActive, startRentLease, endRentLease, today, type RentPayStatus,
} from "@/lib/rent";
import { elecLedger, elecSheet, saveRentElecData } from "@/lib/rent-elec";
import { LEASE_SOON_DAYS, addPriceChange, cancelPriceChange, leaseDaysLeft, rentCollection, rentOccupancy } from "@/lib/rent-contract";
import { rentDebtors, sendRentReminder, shopLedger } from "@/lib/rent-tenant";
import { rentReceiptPath } from "@/lib/rent-receipt";
import { publicOrigin } from "@/lib/public-url";
import type { MobileUser } from "./auth";
import type { CreateForm, CreateResult } from "./create";
import type { DetailAction, FormField, FormOption, MobileDetail } from "./detail";
import type { HomeCard, HomeRow, HomeSection, Tone } from "./home";
import { ListError, type MobileList } from "./list";
import { formatPhone, normalizePhone } from "@/lib/phone";

/**
 * Arenda (do'konlar ijarasi) — sekretarning mobil ish joyi. Vebdagi `/arenda` sahifasi bilan bitta qoida:
 * hisob `lib/rent.ts` da (`monthSheet`, `createRentTx`, `cancelRentTx`, `openMonth`), bu yerda faqat
 * ilova uchun shakl: oy varag'i (`GET /api/mobile/arenda`), jurnal va do'konlar ro'yxati, kartochkalar,
 * kirim/chiqim/do'kon formalari va amallar (storno, oyni ochish, do'kon hisobi).
 *
 * Ruxsat — veb bilan bir xil (`lib/permissions.ts` → `arenda: create | shops | storno`).
 */

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const num = (v: number) => (Math.abs(v) < 0.005 ? "—" : fmtNum(v));

export const arendaCan = (user: Pick<MobileUser, "role" | "perms">, action: "create" | "shops" | "storno") =>
  canDo({ role: user.role, perms: user.perms }, "arenda", action);

// ───────────────────────── Oy varag'i (ekran) ─────────────────────────

export type ArendaRow = { shopId: string; name: string; isActive: boolean; due: string; paid: string; left: string; dueNum: number; leftNum: number };
export type ArendaGroup = { location: string; rows: ArendaRow[]; due: string; paid: string; left: string };
export type ArendaScreen = {
  month: string; monthLabel: string; prev: string; next: string; current: string; opened: boolean; shops: number;
  /** Arenda kassasi — butun davr: kirim − chiqim (storno hisobga kirmaydi). */
  balance: { total: string; cash: string; bank: string; totalNum: number };
  totals: { due: string; paid: string; left: string; leftNum: number };
  groups: ArendaGroup[];
  can: { create: boolean; shops: boolean; storno: boolean };
};

/** `GET /api/mobile/arenda?oy=YYYY-MM` — tepada kassa, pastda Excel'dagi oy varag'i (bozor bo'yicha guruhlangan). */
export async function arendaScreen(user: MobileUser, oy?: string | null): Promise<ArendaScreen> {
  const now = currentMonth();
  const month = parseMonth(oy) ?? now;
  const [balance, sheet, shops] = await Promise.all([rentBalance(), monthSheet(month), db.rentShop.count({ where: { isActive: true } })]);
  return {
    month: monthKey(month), monthLabel: monthLabel(month), prev: monthKey(shiftMonth(month, -1)), next: monthKey(shiftMonth(month, 1)), current: monthKey(now),
    opened: sheet.opened, shops,
    balance: { total: money(balance.total), cash: money(balance.cash), bank: money(balance.bank), totalNum: balance.total },
    totals: { due: money(sheet.total.due), paid: money(sheet.total.paid), left: money(sheet.total.left), leftNum: sheet.total.left },
    groups: sheet.groups.map((g) => ({
      location: g.location,
      due: money(g.total.due), paid: money(g.total.paid), left: money(g.total.left),
      rows: g.rows.map((r) => ({ shopId: r.shopId, name: r.name, isActive: r.isActive, due: num(r.due), paid: num(r.paid), left: num(r.left), dueNum: r.due, leftNum: r.left })),
    })),
    can: { create: arendaCan(user, "create"), shops: arendaCan(user, "shops"), storno: arendaCan(user, "storno") },
  };
}

// ───────────────────────── Ro'yxatlar ─────────────────────────

const TX_TONE = (t: { type: RentTxType; cancelledAt: Date | null }): Tone => (t.cancelledAt ? "warning" : t.type === "INCOME" ? "success" : "danger");

function txRow(t: { id: string; type: RentTxType; method: RentMethod; date: Date; month: Date | null; amount: Prisma.Decimal; category: string; note: string | null; cancelledAt: Date | null; cancelReason: string | null; shop: { name: string } | null }): HomeRow {
  const sign = t.type === "INCOME" ? "+" : "−";
  const parts = [dateRu(t.date), RENT_METHOD_LABEL[t.method], t.note, t.cancelledAt ? `bekor qilingan: ${t.cancelReason ?? ""}` : null].filter(Boolean);
  return {
    id: t.id,
    title: t.type === "INCOME" ? `${t.shop?.name ?? "Do'kon"}${t.month ? ` · ${monthLabel(t.month)}` : ""}` : t.category,
    subtitle: parts.join(" · "),
    right: `${sign}${money(n(t.amount))}`,
    status: t.cancelledAt ? "Bekor qilingan" : t.type === "INCOME" ? "Kirim" : "Chiqim",
    tone: TX_TONE(t),
  };
}

const JURNAL_TABS = [
  { key: "all", label: "Hammasi", where: {} as Prisma.RentTxWhereInput },
  { key: "income", label: "Kirim", where: { type: "INCOME", cancelledAt: null } as Prisma.RentTxWhereInput },
  { key: "expense", label: "Chiqim", where: { type: "EXPENSE", cancelledAt: null } as Prisma.RentTxWhereInput },
  { key: "storno", label: "Bekor qilingan", where: { cancelledAt: { not: null } } as Prisma.RentTxWhereInput },
] as const;

/** Arenda kassasi jurnali — oxirgi 200 yozuv, qidiruv do'kon/kategoriya/izoh bo'yicha. */
export async function arendaJurnalList(q?: string, filter?: string): Promise<MobileList> {
  const tab = JURNAL_TABS.find((t) => t.key === filter) ?? JURNAL_TABS[0];
  const search: Prisma.RentTxWhereInput = q
    ? { OR: [{ category: { contains: q, mode: "insensitive" } }, { note: { contains: q, mode: "insensitive" } }, { shop: { name: { contains: q, mode: "insensitive" } } }] }
    : {};
  const [rows, counts] = await Promise.all([
    db.rentTx.findMany({ where: { ...tab.where, ...search }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200, include: { shop: { select: { name: true } } } }),
    Promise.all(JURNAL_TABS.map((t) => db.rentTx.count({ where: { ...t.where, ...search } }))),
  ]);
  return {
    key: "arenda-jurnal", title: "Kirim-chiqim jurnali", rows: rows.map(txRow),
    filters: JURNAL_TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], active: t.key === tab.key })),
  };
}

/** Do'konlar — joy (bozor) bo'yicha tartibda, o'ngda umumiy qarz/avans; filtrlar — to'lov holati va bo'sh joylar (veb bilan bir xil). */
export async function arendaShopsList(q?: string, filter?: string): Promise<MobileList> {
  const search: Prisma.RentShopWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } : {};
  const all = await db.rentShop.findMany({ where: search, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const states = await rentShopStates(all);
  const st = (x: (typeof all)[number]) => states.get(x.id)!;
  const tests: Record<string, (x: (typeof all)[number]) => boolean> = {
    active: (x) => x.isActive, muddat: (x) => st(x).status === "OVERDUE", bugun: (x) => st(x).status === "TODAY",
    tolagan: (x) => st(x).status === "PAID", bosh: (x) => !x.isActive, all: () => true,
  };
  const cur = filter && tests[filter] ? filter : "active";
  const shops = all.filter(tests[cur]);
  const tone: Record<RentPayStatus, Tone> = { VACANT: "info", OVERDUE: "danger", TODAY: "warning", PAID: "success", WAITING: "info" };
  return {
    key: "arenda-shops", title: "Do'konlar",
    rows: shops.map((s) => {
      const x = st(s), debt = x.debt;
      const pay = s.period === "DAILY" ? "har kuni" : s.payDay ? `to'lov ${s.payDay}-sana` : "to'lov kuni yo'q";
      return {
        id: s.id, title: s.name,
        subtitle: `${s.location}${s.isActive && s.tenantName ? ` · ${s.tenantName}` : ""} · ${s.isActive ? `${pay}${s.phone ? "" : " · telefon yo'q"}` : "bo'sh joy"}`,
        right: debt > 0.005 ? `qarz ${money(debt)}` : debt < -0.005 ? `avans ${money(-debt)}` : "—",
        status: RENT_PAY_STATUS_LABEL[x.status], tone: tone[x.status],
      };
    }),
    filters: ([["active", RENT_SHOP_STATUS.on], ["muddat", "Muddati o'tgan"], ["bugun", "Bugun"], ["tolagan", "To'laganlar"], ["bosh", "Bo'sh joylar"], ["all", "Hammasi"]] as const)
      .map(([key, label]) => ({ key, label, count: all.filter(tests[key]).length, active: key === cur })),
  };
}

/** Qarzdorlar — veb «Arenda → Qarzdorlar»: shartnoma bo'yicha (sobiq ijarachilar ham), ijara va svet qarzi alohida. */
export async function arendaDebtorsList(q?: string, filter?: string): Promise<MobileList> {
  const s = q?.trim().toLowerCase();
  const all = (await rentDebtors()).filter((d) => !s || [d.name, d.location, d.tenantName ?? "", d.phone ?? ""].some((x) => x.toLowerCase().includes(s)));
  const tests: Record<string, (d: (typeof all)[number]) => boolean> = { all: () => true, active: (d) => !d.former, former: (d) => d.former, elec: (d) => d.elecDebt > 1 };
  const cur = filter && tests[filter] ? filter : "all";
  return {
    key: "arenda-debtors", title: "Qarzdorlar",
    rows: all.filter(tests[cur]).map((d) => ({
      id: d.id,
      title: `${d.name}${d.tenantName ? ` · ${d.tenantName}` : ""}`,
      subtitle: [
        d.location,
        d.unpaid.length ? `${d.unpaid.length} oy to'lanmagan` : null,
        d.elecDebt > 1 ? `svet ${money(d.elecDebt)}` : null,
        d.lastPaidAt ? `oxirgi to'lov ${dateRu(d.lastPaidAt)}` : "to'lov yo'q",
        d.former && d.endedAt ? `chiqib ketgan ${dateRu(d.endedAt)}` : null,
      ].filter(Boolean).join(" · "),
      right: d.debt > 1 ? `qarz ${money(d.debt)}` : "—",
      status: d.former ? "Sobiq ijarachi" : d.linked ? "Telegram ulangan" : "Telegram yo'q",
      tone: d.former ? "warning" : "danger",
    })),
    filters: ([["all", "Hammasi"], ["active", "Amaldagi"], ["former", "Sobiq ijarachilar"], ["elec", "Svet qarzi"]] as const)
      .map(([key, label]) => ({ key, label, count: all.filter(tests[key]).length, active: key === cur })),
  };
}

/** Svet varag'i — veb «Arenda → Svet» (oy bo'yicha): ko'rsatkich, summasi, berilgan, qoldiq. Filtr — oxirgi 3 oy. */
export async function arendaSvetList(q?: string, filter?: string): Promise<MobileList> {
  const now = currentMonth();
  const months = [0, 1, 2].map((k) => shiftMonth(now, -k));
  const sheets = await Promise.all(months.map((m) => elecSheet(m)));
  const idx = Math.max(0, months.findIndex((m) => monthKey(m) === filter));
  const s = q?.trim().toLowerCase();
  const match = (r: { name: string; location: string; tenantName: string | null }) => !s || [r.name, r.location, r.tenantName ?? ""].some((x) => x.toLowerCase().includes(s));
  const sheet = sheets[idx];
  return {
    key: "arenda-svet", title: `Svet · ${monthLabel(months[idx])}`,
    rows: sheet.groups.flatMap((g) => g.rows).filter(match).map((r) => ({
      id: r.shopId,
      title: `${r.name}${r.tenantName ? ` · ${r.tenantName}` : ""}${r.former ? " (sobiq)" : ""}`,
      subtitle: [
        r.location,
        r.meterEnd != null ? `${r.meterStart != null ? fmtNum(r.meterStart, 1) : "—"} → ${fmtNum(r.meterEnd, 1)} (${fmtNum(r.kwh, 1)} kVt)` : "ko'rsatkich yo'q",
        `summasi ${num(r.sum)}`, `berilgan ${num(r.paid)}`,
      ].join(" · "),
      right: r.left > 1 ? `−${money(r.left)}` : r.left < -1 ? `avans ${money(-r.left)}` : "—",
      status: r.left > 1 ? "Qarz" : r.sum > 0 ? "To'langan" : "Hisob yo'q",
      tone: r.left > 1 ? "danger" : r.sum > 0 ? "success" : "info",
    })),
    filters: months.map((m, i) => ({ key: monthKey(m), label: monthLabel(m), count: sheets[i].groups.reduce((a, g) => a + g.rows.filter(match).length, 0), active: i === idx })),
  };
}

// ───────────────────────── Kartochkalar ─────────────────────────

/** Jurnal yozuvi — kirim yoki chiqim; storno faqat bekor qilinmaganiga. */
export async function arendaTxDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.rentTx.findUnique({ where: { id }, include: { shop: true, createdBy: { select: { fullName: true } } } });
  if (!t) throw new ListError("NOT_FOUND", "Yozuv topilmadi", 404);
  const cancelledBy = t.cancelledById ? await db.user.findUnique({ where: { id: t.cancelledById }, select: { fullName: true } }) : null;
  const income = t.type === "INCOME";
  const actions: DetailAction[] = [];
  if (!t.cancelledAt && arendaCan(user, "storno")) {
    actions.push({
      id: "arenda.storno", label: "Bekor qilish", tone: "danger",
      form: [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda", hint: "Yozuv jurnalda chizilgan holda qoladi, kassa qoldig'i qayta hisoblanadi" }],
    });
  }
  // Kvitansiya QR'i olib boradigan ommaviy sahifa (to'lov haqiqiyligi va hozirgi qarz) — ijarachiga yuborish mumkin
  if (income && t.shopId) {
    const { origin } = await publicOrigin().catch(() => ({ origin: "" }));
    if (origin) actions.push({ id: "arenda.receipt", label: "Kvitansiya sahifasi (QR)", local: true, effect: { openUrl: `${origin}${rentReceiptPath(t.id)}` } });
  }
  return {
    key: "arenda-tx", id: t.id,
    title: income ? `Kirim · ${t.shop?.name ?? "Do'kon"}` : `Chiqim · ${t.category}`,
    subtitle: `${dateRu(t.date)} · ${RENT_METHOD_LABEL[t.method]}`,
    status: t.cancelledAt ? "Bekor qilingan" : income ? "Kirim" : "Chiqim",
    fields: [
      { label: "Summa", value: `${income ? "+" : "−"}${money(n(t.amount))}`, tone: TX_TONE(t) },
      { label: "Usul", value: RENT_METHOD_LABEL[t.method] },
      ...(t.shop ? [{ label: "Do'kon", value: `${t.shop.name} · ${t.shop.location}` }] : []),
      ...(rentFor(t) ? [rentFor(t)!] : []),
      ...(t.batchId ? [{ label: "Bir necha oyga", value: "summa oylarga bo'lingan — bitta kvitansiya, bekor qilinsa hammasi" }] : []),
      { label: income ? "Turi" : "Chiqim turi", value: t.category },
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
      { label: "Kiritdi", value: `${t.createdBy.fullName} · ${dateRu(t.createdAt)}` },
      ...(t.cancelledAt ? [{ label: "Bekor qilindi", value: `${cancelledBy?.fullName ?? "—"} · ${dateRu(t.cancelledAt)}${t.cancelReason ? ` · ${t.cancelReason}` : ""}`, tone: "warning" as Tone }] : []),
    ],
    sections: [],
    actions,
  };
}

const owed = (v: number) => (v > 1 ? `qarz ${money(v)}` : v < -1 ? `avans ${money(-v)}` : "qarz yo'q");
const PAY_TONE: Record<RentPayStatus, Tone> = { VACANT: "info", OVERDUE: "danger", TODAY: "warning", PAID: "success", WAITING: "info" };
const payDayOptions = (): FormOption[] => Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}-sana` }));
const d2 = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;

/**
 * Ijarachi (do'kon) kartasi — veb `/arenda/dokon/[id]` ning ko'chirmasi: holat va qarz, ijarachi va shartnoma (muddati yaqinlashsa
 * ogohlantirish), oyma-oy hisob, svet hisobi, to'lovlar tarixi, oldingi ijarachilar, narx o'zgarishlari, eslatmalar.
 * Amallar: ijaraga berish / ijarachini almashtirish / joyni bo'shatish, narx o'zgarishi, svet ko'rsatkichi, shu oy hisobi,
 * sobiq ijarachi qarzini qabul qilish, Telegram eslatma, qo'ng'iroq. Hisob qoidalari — `lib/rent*.ts` (veb bilan bitta).
 */
export async function arendaShopDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const s = await db.rentShop.findUnique({ where: { id } });
  if (!s) throw new ListError("NOT_FOUND", "Do'kon topilmadi", 404);
  const now = currentMonth();
  const daily = s.period === "DAILY";
  // Joriy shartnoma (amaldagi, bo'lmasa oxirgi) — karta shu bo'yicha; qolganlari «Oldingi ijarachilar»
  const leases = await db.rentLease.findMany({ where: { shopId: id }, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] });
  const active = leases.find((l) => l.status === "ACTIVE") ?? null;
  const lease = active ?? leases[0] ?? null;
  const former = leases.filter((l) => l.id !== lease?.id);
  const [ledger, elec, txs, changes, formerDebts, states, reminders, curCharge] = await Promise.all([
    shopLedger(id, lease?.id ?? null),
    lease ? elecLedger(lease.id) : Promise.resolve({ months: [], debt: 0 }),
    db.rentTx.findMany({ where: { shopId: id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 15 }),
    db.rentPriceChange.findMany({ where: { shopId: id }, orderBy: [{ fromMonth: "desc" }, { createdAt: "desc" }], take: 10 }),
    leaseDebts(former.map((l) => l.id)),
    rentShopStates([s]),
    db.rentReminder.findMany({ where: { shopId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
    active ? db.rentCharge.findUnique({ where: { leaseId_month: { leaseId: active.id, month: now } } }) : Promise.resolve(null),
  ]);
  const state = states.get(id)!;
  const debt = ledger.debt;
  const cur = ledger.months.find((m) => m.key === monthKey(now));
  const showElec = s.electricityBilled || elec.months.length > 0;
  const left = active ? leaseDaysLeft(active.endDate) : null;
  const canShops = arendaCan(user, "shops"), canCreate = arendaCan(user, "create");
  const formerOwing = former.filter((l) => (formerDebts.get(l.id) ?? 0) > 1);

  const actions: DetailAction[] = [];
  if (s.phone) actions.push({ id: "arenda.call", label: "Qo'ng'iroq qilish", local: true, effect: { openUrl: `tel:${s.phone}` } });
  if (canCreate && s.tgChatId && (debt > 1 || ledger.elecDebt > 1)) {
    actions.push({ id: "arenda.remind", label: "Qarz eslatmasini yuborish (Telegram)", tone: "warning", confirm: `${s.tenantName ?? s.name} ga Telegram orqali qarz eslatmasi yuborilsinmi?` });
  }
  if (canShops && active) {
    actions.push({
      id: "arenda.charge", label: cur ? "Shu oy hisobini tahrirlash" : "Shu oy hisobini ochish", tone: "brand",
      form: [
        { name: "month", label: "Oy", type: "select", required: true, value: monthKey(now), options: monthOptions(now) },
        { name: "bankDue", label: "Perechisleniye, so'm", type: "number", required: true, value: String(cur?.bankDue ?? n(s.bankAmount)) },
        { name: "cashDue", label: "Naqd, so'm", type: "number", required: true, value: String(cur?.cashDue ?? n(s.cashAmount)) },
        ...(s.electricityBilled ? [] : [{ name: "electricity", label: "Svet, so'm", type: "number" as const, value: String(n(curCharge?.electricity ?? s.electricity)), hint: "Ma'lumot uchun — qoldiqqa ta'sir qilmaydi" }]),
        { name: "tax", label: "Soliq, so'm", type: "number", value: String(n(curCharge?.tax ?? s.tax)) },
        { name: "note", label: "Izoh", type: "text", value: cur?.note ?? undefined },
      ],
    });
    if (showElec) {
      actions.push({
        id: "arenda.elec", label: "Svet ko'rsatkichi", tone: "brand",
        form: [
          { name: "month", label: "Oy", type: "select", required: true, value: monthKey(now), options: [0, 1, 2].map((k) => shiftMonth(now, -k)).map((m) => ({ value: monthKey(m), label: monthLabel(m) })), hint: "Qiymatlar shu oy hisobidan to'ldirilgan" },
          { name: "meterStart", label: "Avvalgi ko'rsatkich, kVt", type: "number", value: curCharge?.meterStart != null ? String(n(curCharge.meterStart)) : undefined },
          { name: "meterEnd", label: "Hozirgi ko'rsatkich, kVt", type: "number", value: curCharge?.meterEnd != null ? String(n(curCharge.meterEnd)) : undefined, hint: "Summa = farq × 1 kVt narxi + ustama (veb «Svet tarifi»)" },
          { name: "amount", label: "Summa (hisoblagichsiz), so'm", type: "number", value: String(n(curCharge?.elecDue ?? s.elecFixed)), hint: "Ko'rsatkich kiritilmasa — shu summa" },
          { name: "paidDirect", label: "Litsevoyga o'zi to'lagan, so'm", type: "number", value: String(n(curCharge?.elecPaidDirect)), hint: "Kassaga kirmaydi" },
          { name: "note", label: "Izoh", type: "text", value: curCharge?.elecNote ?? undefined },
        ],
      });
    }
    actions.push({
      id: "arenda.price", label: "Narx o'zgarishi",
      form: [
        { name: "fromMonth", label: "Qaysi oydan", type: "select", required: true, value: monthKey(shiftMonth(now, 1)), options: Array.from({ length: 12 }, (_, i) => shiftMonth(now, i + 1)).map((m) => ({ value: monthKey(m), label: monthLabel(m) })), hint: "Yangi narx shu oy hisobi ochilganda qo'llanadi" },
        { name: "bankAmount", label: `${RENT_PERIOD_LABEL[s.period]} — perechisleniye, so'm`, type: "number", required: true, value: String(n(s.bankAmount)) },
        { name: "cashAmount", label: `${RENT_PERIOD_LABEL[s.period]} — naqd, so'm`, type: "number", required: true, value: String(n(s.cashAmount)) },
        { name: "note", label: "Izoh", type: "text", placeholder: "Masalan: kelishuv bo'yicha" },
      ],
    });
  }
  const pending = changes.filter((c) => !c.appliedAt && !c.cancelledAt);
  if (canShops && pending.length) {
    actions.push({
      id: "arenda.price.cancel", label: "Narx o'zgarishini bekor qilish", tone: "danger",
      form: [{ name: "changeId", label: "Qaysi o'zgarish", type: "select", required: true, value: pending[0].id, options: pending.map((c) => ({ value: c.id, label: `${monthLabel(c.fromMonth)} dan — ${money(n(c.bankAmount) + n(c.cashAmount))}` })) }],
    });
  }
  if (canCreate && formerOwing.length) {
    actions.push({
      id: "arenda.pay.former", label: "Sobiq ijarachi qarzini qabul qilish", tone: "success",
      form: [
        { name: "leaseId", label: "Ijarachi", type: "select", required: true, value: formerOwing[0].id, options: formerOwing.map((l) => ({ value: l.id, label: l.tenantName ?? "Ijarachi ko'rsatilmagan", hint: `qarz ${money(formerDebts.get(l.id) ?? 0)}` })) },
        { name: "month", label: "Qaysi oy uchun", type: "select", required: true, value: monthKey(now), options: monthOptions(now) },
        ...(daily ? [{ name: "day", label: "Qaysi kun uchun", type: "select" as const, required: true, value: ymd(new Date()), options: recentDays() }] : []),
        methodField(), amountField(), dateField(),
        { name: "note", label: "Izoh", type: "text", placeholder: "Ixtiyoriy" },
      ],
    });
  }
  if (canShops) {
    const leaseForm = (replace: boolean): FormField[] => [
      { name: "tenantName", label: "Ijarachi F.I.O. / korxona", type: "text", required: true },
      { name: "phone", label: "Telefon", type: "text", required: true, placeholder: "+998 90 123 45 67" },
      { name: "inn", label: "INN / JShShIR", type: "text", placeholder: "Ixtiyoriy" },
      { name: "startDate", label: "Ijara boshlanishi (kk.oo.yyyy)", type: "text", required: true, value: d2(today()), hint: replace ? "Amaldagi shartnoma bir kun oldin yopiladi — eski ijarachi qarzi o'zida qoladi" : undefined },
      { name: "endDate", label: "Shartnoma tugashi (kk.oo.yyyy)", type: "text", placeholder: "Bo'sh — muddatsiz" },
      { name: "contractNo", label: "Shartnoma raqami", type: "text", placeholder: "Bo'sh — avtomatik (IJ-yil-00001)" },
      { name: "deposit", label: "Zaklad, so'm", type: "number", placeholder: "0" },
      { name: "bankAmount", label: `${RENT_PERIOD_LABEL[s.period]} — perechisleniye, so'm`, type: "number", value: String(n(s.bankAmount)) },
      { name: "cashAmount", label: `${RENT_PERIOD_LABEL[s.period]} — naqd, so'm`, type: "number", value: String(n(s.cashAmount)) },
      ...(daily ? [] : [{ name: "payDay", label: "To'lov kuni (har oyning nechanchi sanasi)", type: "select" as const, required: true, value: s.payDay ? String(s.payDay) : undefined, options: payDayOptions() }]),
      { name: "leaseNote", label: "Kelishuv (izoh)", type: "text" },
    ];
    if (active) {
      actions.push({ id: "arenda.lease.start", label: "Ijarachini almashtirish", form: leaseForm(true) });
      actions.push({
        id: "arenda.lease.end", label: "Joyni bo'shatish", tone: "danger",
        form: [
          { name: "endedAt", label: "Chiqish sanasi (kk.oo.yyyy)", type: "text", required: true, value: d2(today()) },
          { name: "reason", label: "Sabab", type: "text", placeholder: "Masalan: shartnoma muddati tugadi" },
        ],
      });
    } else {
      actions.push({ id: "arenda.lease.start", label: "Ijaraga berish", tone: "success", form: leaseForm(false) });
    }
    const locs = await db.rentShop.findMany({ distinct: ["location"], select: { location: true }, orderBy: { location: "asc" } });
    actions.push({
      id: "arenda.shop.edit", label: "Tahrirlash",
      form: [
        { name: "name", label: "Do'kon nomi", type: "text", required: true, value: s.name },
        { name: "location", label: "Joy (bozor)", type: "select", required: true, value: s.location, options: [...locs.map((l) => ({ value: l.location, label: l.location })), { value: NEW_LOCATION, label: "Yangi joy…" }] },
        { name: "locationNew", label: "Yangi joy nomi", type: "text", showIf: { field: "location", equals: NEW_LOCATION } },
        { name: "area", label: "Maydoni, m²", type: "number", value: s.area ? String(n(s.area)) : undefined },
        ...(active ? [
          { name: "tenantName", label: "Ijarachi F.I.O. / korxona", type: "text" as const, value: s.tenantName ?? undefined },
          { name: "phone", label: "Ijarachi telefoni", type: "text" as const, required: true, value: s.phone ?? undefined, placeholder: "+998 90 123 45 67" },
          { name: "inn", label: "INN / JShShIR", type: "text" as const, value: s.inn ?? undefined },
          { name: "endDate", label: "Shartnoma tugashi (kk.oo.yyyy)", type: "text" as const, value: active.endDate ? d2(active.endDate) : undefined, hint: "Uzaytirish — yangi sanani yozing; bo'sh — muddatsiz" },
        ] : []),
        { name: "period", label: "Ijara turi", type: "select", required: true, value: s.period, options: [{ value: "MONTHLY", label: "Oylik" }, { value: "DAILY", label: "Kunlik (bozor joyi)" }] },
        { name: "payDay", label: "To'lov kuni (har oyning nechanchi sanasi)", type: "select", value: s.payDay ? String(s.payDay) : undefined, options: payDayOptions(), hint: "Oylik ijarada — kunlikda kerak emas" },
        { name: "bankAmount", label: `${RENT_PERIOD_LABEL[s.period]} — perechisleniye, so'm`, type: "number", value: String(n(s.bankAmount)) },
        { name: "cashAmount", label: `${RENT_PERIOD_LABEL[s.period]} — naqd, so'm`, type: "number", value: String(n(s.cashAmount)) },
        { name: "electricityBilled", label: "Svetni ijarachi alohida to'laydi", type: "switch", value: String(s.electricityBilled) },
        { name: "elecFixed", label: "Shartnoma bo'yicha oylik svet, so'm", type: "number", value: String(n(s.elecFixed)), showIf: { field: "electricityBilled", equals: "true" }, hint: "Hisoblagichsiz joyda — har oy shu summa" },
        { name: "electricity", label: "Svet, so'm", type: "number", value: String(n(s.electricity)), showIf: { field: "electricityBilled", equals: "false" }, hint: "Ma'lumot uchun" },
        { name: "tax", label: "Soliq, so'm", type: "number", value: String(n(s.tax)) },
        { name: "note", label: "Izoh", type: "text", value: s.note ?? undefined },
      ],
    });
  }

  const sections: HomeSection[] = [{
    title: `Oyma-oy hisob${lease?.tenantName ? ` — ${lease.tenantName}` : ""}`, empty: active ? "Hisob hali ochilmagan — «Shu oy hisobini ochish»" : "Hisob yo'q",
    rows: ledger.months.slice(0, 12).map((m) => ({
      id: `m~${m.key}`, title: m.label, subtitle: `bank ${num(m.bankDue)} · naqd ${num(m.cashDue)}${m.note ? ` · ${m.note}` : ""}`, right: `${num(m.paid)} / ${num(m.due)}`,
      status: m.left > 1 ? `qoldiq ${num(m.left)}` : m.left < -1 ? `avans ${num(-m.left)}` : "To'liq", tone: m.left > 1 ? "danger" : "success",
    })),
  }];
  if (showElec) {
    sections.push({
      title: `Svet hisobi · ${owed(elec.debt)}`, empty: "Hali svet hisobi yo'q — «Svet ko'rsatkichi»",
      rows: elec.months.slice(0, 12).map((m) => ({
        id: `e~${m.key}`, title: monthLabel(m.month), subtitle: `${m.kwh ? `${fmtNum(m.kwh, 1)} kVt · ` : ""}summasi ${num(m.sum)} · berilgan ${num(m.paid)}`,
        right: m.left > 1 ? `−${num(m.left)}` : m.left < -1 ? `avans ${num(-m.left)}` : "—", tone: m.left > 1 ? "danger" : "success",
      })),
    });
  }
  sections.push({
    title: "To'lovlar tarixi", empty: "To'lov yo'q", target: "arenda-tx",
    rows: txs.map((t) => {
      const income = t.type === "INCOME", f = rentFor(t);
      return {
        id: t.id, title: income ? `${f?.value ?? "—"}${t.category === RENT_ELEC_CATEGORY ? " · svet" : ""}` : `Chiqim · ${t.category}`,
        subtitle: [dateRu(t.date), RENT_METHOD_LABEL[t.method], t.batchId ? "bir necha oyga" : null, t.leaseId && t.leaseId !== lease?.id ? "sobiq ijarachi" : null, t.cancelledAt ? `bekor: ${t.cancelReason ?? ""}` : null].filter(Boolean).join(" · "),
        right: `${income ? "+" : "−"}${money(n(t.amount))}`, status: t.cancelledAt ? "Bekor qilingan" : undefined, tone: TX_TONE(t),
      };
    }),
  });
  if (former.length) {
    sections.push({
      title: "Oldingi ijarachilar", empty: "—",
      rows: former.map((l) => {
        const d = formerDebts.get(l.id) ?? 0;
        return { id: `l~${l.id}`, title: l.tenantName ?? "Ijarachi ko'rsatilmagan", subtitle: `${dateRu(l.startDate)} — ${l.endedAt ? dateRu(l.endedAt) : "…"}${l.endReason ? ` · ${l.endReason}` : ""}`, right: owed(d), tone: d > 1 ? "danger" : "success" };
      }),
    });
  }
  if (changes.length) {
    sections.push({
      title: "Narx o'zgarishi", empty: "—",
      rows: changes.map((c) => ({
        id: `p~${c.id}`, title: `${monthLabel(c.fromMonth)} dan — ${money(n(c.bankAmount) + n(c.cashAmount))}`, subtitle: `bank ${num(n(c.bankAmount))} · naqd ${num(n(c.cashAmount))}${c.note ? ` · ${c.note}` : ""}`,
        status: c.cancelledAt ? "Bekor qilingan" : c.appliedAt ? "Qo'llangan" : "Kutilmoqda", tone: c.cancelledAt ? "info" : c.appliedAt ? "success" : "brand",
      })),
    });
  }
  if (reminders.length) {
    sections.push({
      title: "Eslatmalar", empty: "—",
      rows: reminders.map((r) => ({ id: `r~${r.id}`, title: `${dateRu(r.createdAt)} · ${r.auto ? "avtomatik" : "qo'lda"}`, subtitle: r.error ?? undefined, right: num(n(r.debt)), status: r.ok ? "Yetkazildi" : "Yetmadi", tone: r.ok ? "success" : "danger" })),
    });
  }

  return {
    key: "arenda-shop", id: s.id, title: s.name, subtitle: [s.location, s.tenantName].filter(Boolean).join(" · "), status: RENT_PAY_STATUS_LABEL[state.status],
    fields: [
      daily
        ? { label: "Muddati o'tgan qarz", value: money(state.overdue), tone: state.overdue > 1 ? "danger" : "success" }
        : { label: "Jami qarz", value: owed(debt), tone: debt > 1 ? "danger" : "success" },
      { label: `Shu oy (${monthLabel(now)})`, value: cur ? `qoldiq ${money(Math.max(0, cur.left))} · tushdi ${money(cur.paid)}` : "hisob ochilmagan" },
      ...(showElec ? [{ label: "Svet qarzi", value: owed(elec.debt), tone: (elec.debt > 1 ? "danger" : "success") as Tone }] : []),
      ...(active && left !== null && left <= LEASE_SOON_DAYS ? [{ label: "Shartnoma muddati", value: left < 0 ? `${-left} kun oldin tugagan` : left === 0 ? "bugun tugaydi" : `tugashiga ${left} kun qoldi`, tone: (left < 0 ? "danger" : "warning") as Tone }] : []),
      ...(lease ? [{ label: active ? "Shartnoma" : "Oxirgi shartnoma (yopilgan)", value: [lease.no ? `№ ${lease.no}` : null, `${dateRu(lease.startDate)} — ${lease.endDate ? dateRu(lease.endDate) : lease.endedAt ? dateRu(lease.endedAt) : "muddatsiz"}`].filter(Boolean).join(" · ") }] : []),
      ...(active && n(active.deposit) > 0 ? [{ label: "Zaklad", value: money(n(active.deposit)) }] : []),
      ...(active?.note ? [{ label: "Kelishuv", value: active.note }] : []),
      ...(active ? [
        { label: "Ijarachi", value: s.tenantName ?? "kiritilmagan" },
        { label: "Telefon", value: s.phone ? formatPhone(s.phone) : "kiritilmagan", tone: (s.phone ? undefined : "warning") as Tone | undefined },
        ...(s.inn ? [{ label: "INN", value: s.inn }] : []),
        { label: "Telegram", value: s.tgChatId ? "ulangan — eslatma o'zi boradi" : "ulanmagan (vebda QR bilan ulanadi)" },
      ] : []),
      { label: "Ijara", value: `${RENT_PERIOD_LABEL[s.period]} · bank ${money(n(s.bankAmount))} · naqd ${money(n(s.cashAmount))}${!daily && s.payDay ? ` · to'lov ${s.payDay}-sana` : ""}` },
      ...(s.area ? [{ label: "Maydoni", value: `${fmtNum(n(s.area), 2)} m²${rentPerM2(s) ? ` · 1 m² — ${money(rentPerM2(s)!)}` : ""}` }] : []),
      { label: "Svet", value: s.electricityBilled ? `alohida hisob${n(s.elecFixed) > 0 ? ` · shartnoma bo'yicha ${money(n(s.elecFixed))}/oy` : ""}` : "ijaraga kiritilgan" },
      ...(n(s.tax) ? [{ label: "Soliq", value: money(n(s.tax)) }] : []),
      ...(s.note ? [{ label: "Izoh", value: s.note }] : []),
      { label: "Holat", value: RENT_PAY_STATUS_LABEL[state.status], tone: PAY_TONE[state.status] },
    ],
    sections,
    actions,
  };
}

// ───────────────────────── Formalar ─────────────────────────

/** Kirim formasidagi «Qaysi oy uchun»: 12 oy orqaga va 2 oy oldinga (vebdagi bilan bir xil). */
function monthOptions(now: Date): FormOption[] {
  return Array.from({ length: 15 }, (_, i) => shiftMonth(now, 2 - i)).map((m) => ({ value: monthKey(m), label: monthLabel(m) }));
}

const WEEKDAYS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Oxirgi 14 kun — sekretar daftarni kechikib yozishi mumkin. */
function recentDays(): FormOption[] {
  return Array.from({ length: 14 }, (_, k) => {
    const d = new Date(); d.setDate(d.getDate() - k);
    return { value: ymd(d), label: k === 0 ? "Bugun" : k === 1 ? "Kecha" : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")} · ${WEEKDAYS[d.getDay()]}` };
  });
}
const methodField = (): FormField => ({
  name: "method", label: "To'lov usuli", type: "select", required: true, value: "CASH",
  options: (Object.keys(RENT_METHOD_LABEL) as RentMethod[]).map((m) => ({ value: m, label: RENT_METHOD_LABEL[m] })),
});
const dateField = (): FormField => ({ name: "date", label: "Sana", type: "select", required: true, value: ymd(new Date()), options: recentDays() });
const amountField = (): FormField => ({ name: "amount", label: "Summa, so'm", type: "number", required: true, placeholder: "0" });

export async function arendaKirimForm(): Promise<CreateForm> {
  const now = currentMonth();
  const [shops, debts] = await Promise.all([db.rentShop.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }), shopDebts()]);
  return {
    key: "arenda-kirim", title: "Arenda kirimi", submitLabel: "Kirimni saqlash",
    fields: [
      {
        name: "shopId", label: "Do'kon", type: "select", required: true,
        options: shops.map((s) => { const d = debts.get(s.id) ?? 0; return { value: s.id, label: `${s.name} · ${s.location}${s.period === "DAILY" ? " (kunlik)" : ""}`, hint: d > 0.005 ? `qarz ${money(d)}` : d < -0.005 ? `avans ${money(-d)}` : "qarz yo'q" }; }),
      },
      { name: "kind", label: "To'lov turi", type: "select", required: true, value: "rent", options: [{ value: "rent", label: "Ijara to'lovi" }, { value: "elec", label: "Svet to'lovi" }], hint: "Svet — alohida hisob (oy bo'yicha)" },
      { name: "month", label: "Qaysi oy uchun", type: "select", required: true, value: monthKey(now), options: monthOptions(now), hint: "Kunlik ijarada oy tanlangan kundan olinadi" },
      // `showIf` do'kon turiga qaray olmaydi — maydon doim ko'rinadi, server faqat kunlik do'konda hisobga oladi
      { name: "day", label: "Qaysi kun uchun (kunlik ijara)", type: "select", value: ymd(new Date()), options: recentDays(), hint: "Faqat «(kunlik)» do'konlarda" },
      { name: "months", label: "Necha oyga", type: "select", value: "1", options: Array.from({ length: RENT_MAX_MONTHS }, (_, i) => ({ value: String(i + 1), label: i ? `${i + 1} oyga (summa teng bo'linadi)` : "1 oyga" })), hint: "Oldindan to'lov: tanlangan oydan boshlab" },
      methodField(),
      amountField(),
      dateField(),
      { name: "note", label: "Izoh", type: "text", placeholder: "Ixtiyoriy" },
    ],
  };
}

export async function arendaChiqimForm(): Promise<CreateForm> {
  const b = await rentBalance();
  return {
    key: "arenda-chiqim", title: "Arenda chiqimi", submitLabel: "Chiqimni saqlash",
    fields: [
      { name: "category", label: "Chiqim turi", type: "select", required: true, value: RENT_EXPENSE_CATEGORIES[0], options: RENT_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })) },
      { ...methodField(), hint: `Kassada: naqd ${money(b.cash)} · perechisleniye ${money(b.bank)}` },
      amountField(),
      dateField(),
      { name: "note", label: "Izoh", type: "text", placeholder: "«Boshqa» uchun majburiy" },
    ],
  };
}

const NEW_LOCATION = "__new__";

export async function arendaShopForm(): Promise<CreateForm> {
  const locs = await db.rentShop.findMany({ distinct: ["location"], select: { location: true }, orderBy: { location: "asc" } });
  return {
    key: "arenda-shop", title: "Yangi do'kon", submitLabel: "Do'konni qo'shish",
    fields: [
      { name: "name", label: "Do'kon nomi", type: "text", required: true, placeholder: "Masalan: 12-do'kon, Anvar aka" },
      { name: "location", label: "Joy (bozor)", type: "select", required: true, value: locs[0]?.location ?? NEW_LOCATION, options: [...locs.map((l) => ({ value: l.location, label: l.location })), { value: NEW_LOCATION, label: "Yangi joy…" }] },
      { name: "locationNew", label: "Yangi joy nomi", type: "text", showIf: { field: "location", equals: NEW_LOCATION }, placeholder: "Masalan: Texno siti bozor" },
      { name: "area", label: "Maydoni, m²", type: "number", required: true, placeholder: "Masalan: 24", hint: "1 m² narxi shundan hisoblanadi" },
      { name: "vacant", label: "Bo'sh joy (hali ijaraga berilmagan)", type: "switch", value: "false" },
      { name: "tenantName", label: "Ijarachi F.I.O. / korxona", type: "text", showIf: { field: "vacant", equals: "false" } },
      { name: "phone", label: "Ijarachi telefoni", type: "text", required: true, placeholder: "+998 90 123 45 67", hint: "Eslatma va bog'lanish uchun", showIf: { field: "vacant", equals: "false" } },
      { name: "inn", label: "INN / JShShIR", type: "text", placeholder: "Ixtiyoriy", showIf: { field: "vacant", equals: "false" } },
      { name: "period", label: "Ijara turi", type: "select", required: true, value: "MONTHLY", options: [{ value: "MONTHLY", label: "Oylik" }, { value: "DAILY", label: "Kunlik (bozor joyi)" }] },
      { name: "payDay", label: "To'lov kuni (har oyning nechanchi sanasi)", type: "select", value: "5", options: payDayOptions(), hint: "Oylik ijarada — kunlikda kerak emas" },
      { name: "bankAmount", label: "Perechisleniye (oylik yoki kunlik), so'm", type: "number", value: "0" },
      { name: "cashAmount", label: "Naqd (oylik yoki kunlik), so'm", type: "number", value: "0" },
      { name: "electricityBilled", label: "Svetni ijarachi alohida to'laydi", type: "switch", value: "false" },
      { name: "elecFixed", label: "Shartnoma bo'yicha oylik svet, so'm", type: "number", value: "0", showIf: { field: "electricityBilled", equals: "true" }, hint: "Hisoblagichsiz joyda — har oy shu summa" },
      { name: "electricity", label: "Svet, so'm", type: "number", value: "0", showIf: { field: "electricityBilled", equals: "false" }, hint: "Ma'lumot uchun" },
      { name: "tax", label: "Soliq, so'm", type: "number", value: "0" },
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

// ───────────────────────── Yaratish ─────────────────────────

const zAmount = z.coerce.number({ message: "Summani kiriting" }).positive("Summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "Summa juda katta");
const zDec0 = z.coerce.number({ message: "Raqam kiriting" }).min(0, "Manfiy bo'lmasin").max(MAX_AMOUNT, "Summa juda katta").default(0);
const zText = z.string().trim().max(500, "Izoh juda uzun").optional().transform((v) => (v ? v : null));
const zToken = z.string().regex(/^[A-Za-z0-9-]{16,64}$/).optional().catch(undefined);
/** Ilova switch'i `true/false` yuboradi; eski ilova yubormasa — undefined. */
const zBool = z.union([z.boolean(), z.enum(["true", "false", "on", ""])]).optional().transform((v) => (v === undefined ? undefined : v === true || v === "true" || v === "on"));

const TxBody = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  method: z.enum(["CASH", "BANK"], { message: "To'lov usulini tanlang" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto'g'ri"),
  month: z.string().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Kun noto'g'ri").optional(),
  shopId: z.string().optional(),
  amount: zAmount,
  category: z.string().optional(),
  note: zText,
  clientToken: zToken,
  months: z.coerce.number().int().min(1).max(RENT_MAX_MONTHS).optional().catch(undefined),
  // Eski ilova yubormasa — ijara to'lovi
  kind: z.enum(["rent", "elec"]).optional().catch(undefined),
});

const ShopBody = z.object({
  name: z.string().trim().min(1, "Do'kon nomini yozing").max(200, "Nom juda uzun"),
  location: z.string().trim().min(1, "Joy (bozor) ni tanlang"),
  locationNew: z.string().trim().max(120, "Nom juda uzun").optional(),
  // Eski ilova yubormasa — o'zgarmaydi (yangi do'konda — oylik)
  period: z.enum(["MONTHLY", "DAILY"]).optional(),
  phone: z.string().trim().max(40).optional(),
  payDay: z.coerce.number().int().min(1, "To'lov kuni 1–31").max(31, "To'lov kuni 1–31").optional().catch(undefined),
  bankAmount: zDec0, cashAmount: zDec0, electricity: zDec0, tax: zDec0,
  // Eski ilova yubormasa — o'zgarmaydi
  area: z.preprocess((v) => (v === "" || v == null ? undefined : typeof v === "string" ? v.replace(",", ".") : v),
    z.coerce.number({ message: "Maydonni raqamda kiriting" }).positive("Maydon 0 dan katta bo'lsin").max(RENT_AREA_MAX, "Maydon juda katta").optional()),
  note: zText,
  // Ijarachi va svet (ilovaning yangi formasi); eski ilova yubormasa — o'zgarmaydi
  tenantName: z.string().trim().max(200, "Ijarachi nomi juda uzun").optional(),
  inn: z.string().trim().max(20).optional(),
  endDate: z.string().trim().max(20).optional(),
  electricityBilled: zBool,
  elecFixed: z.coerce.number({ message: "Raqam kiriting" }).min(0, "Manfiy bo'lmasin").max(MAX_AMOUNT, "Summa juda katta").optional(),
  // Faqat yangi joy: hali ijaraga berilmagan
  vacant: zBool,
});

/** INN: 9 xona (korxona) yoki 14 xona (JShShIR) — veb `tenantCheck` bilan bir xil. */
function shopInn(v: string | undefined): { inn?: string } {
  if (!v) return {};
  const x = v.replace(/\s+/g, "");
  if (!/^\d{9}$|^\d{14}$/.test(x)) throw new ListError("ACTION_FAILED", "INN 9 xonali (JShShIR — 14 xonali) bo'lsin", 400);
  return { inn: x };
}

/** Sana: «kk.oo.yyyy» yoki «yyyy-mm-dd» → UTC yarim tun (veb `new Date("yyyy-mm-dd")` bilan bir xil); bo'sh — undefined. */
function parseDay(v: string | undefined, label: string): Date | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t) ?? null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const [y, mo, d] = m ? [Number(m[3]), Number(m[2]), Number(m[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (!y || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw new ListError("ACTION_FAILED", `${label}: sana noto'g'ri — masalan ${d2(today())}`, 400);
  }
  return date;
}

/** Telefon: bo'sh — o'zgarmaydi (eski ilova yubormaydi), noto'g'ri — xato. */
function shopPhone(v: string | undefined): { phone?: string } {
  if (!v) return {};
  const p = normalizePhone(v);
  if (!p) throw new ListError("ACTION_FAILED", "Telefon raqami noto'g'ri — masalan +998 90 123 45 67", 400);
  return { phone: p };
}

const issue = (e: z.ZodError) => e.issues[0]?.message ?? "Ma'lumot to'liq emas";

/** `mobileCreate` → `arenda-kirim` / `arenda-chiqim` / `arenda-shop`. Ruxsat (`canCreate`) chaqiruvchida tekshirilgan. */
export async function arendaCreate(user: MobileUser, key: string, payload: unknown): Promise<CreateResult> {
  if (key === "arenda-kirim" || key === "arenda-chiqim") {
    const type: RentTxType = key === "arenda-kirim" ? "INCOME" : "EXPENSE";
    const p = TxBody.safeParse({ ...(payload as object), type });
    if (!p.success) throw new Error(issue(p.error));
    const d = p.data;
    const month = d.month ? parseMonth(d.month) : null;
    if (type === "INCOME" && !d.shopId) throw new Error("Do'konni tanlang");
    if (type === "INCOME" && !month) throw new Error("Qaysi oy uchun to'lov — oyni tanlang");
    const elec = type === "INCOME" && d.kind === "elec";
    const category = type === "INCOME" ? (elec ? RENT_ELEC_CATEGORY : RENT_INCOME_CATEGORY) : (d.category ?? "");
    if (type === "EXPENSE" && !(RENT_EXPENSE_CATEGORIES as readonly string[]).includes(category)) throw new Error("Chiqim turini tanlang");
    if (type === "EXPENSE" && category === "Boshqa" && !d.note) throw new Error("«Boshqa» chiqim uchun izoh yozing");
    const r = await createRentTx({
      type, method: d.method, date: new Date(`${d.date}T00:00:00Z`), month, shopId: type === "INCOME" ? d.shopId! : null,
      amount: d.amount, category, note: d.note, clientToken: d.clientToken ?? null,
      day: type === "INCOME" && d.day && !elec ? new Date(`${d.day}T00:00:00Z`) : null,
      months: type === "INCOME" && !elec ? d.months : undefined,
    }, user.id);
    if (r.error) throw new Error(r.error);
    // Jurnal ro'yxati ochiladi (yangi yozuv birinchi qatorda); bitta yozuv id'si `createRentTx` dan qaytmaydi
    return { key: "arenda-jurnal", id: "", message: r.duplicate ? "Allaqachon saqlangan (qayta bosildi)" : type === "INCOME" ? `Kirim saqlandi — ${money(d.amount)}` : `Chiqim saqlandi — ${money(d.amount)}` };
  }
  if (key === "arenda-shop") {
    const p = ShopBody.safeParse(payload);
    if (!p.success) throw new Error(issue(p.error));
    const d = p.data;
    const location = d.location === NEW_LOCATION ? (d.locationNew ?? "") : d.location;
    if (!location) throw new Error("Yangi joy (bozor) nomini yozing");
    if (!d.area) throw new Error("Do'kon maydonini (m²) kiriting");
    // Ijaradagi joyda telefon va (oylikda) to'lov kuni shart — veb `saveRentShop` bilan bir xil (eslatma va «Bugun / Muddati o'tgan» filtrlari)
    const vacant = d.vacant === true;
    const period = d.period ?? "MONTHLY";
    if (!vacant && !d.phone) throw new Error("Ijaradagi joy uchun ijarachi telefonini kiriting");
    if (!vacant && period === "MONTHLY" && !d.payDay) throw new Error("To'lov kunini tanlang — har oyning nechanchi sanasigacha to'laydi");
    const tenant = vacant ? {} : { ...shopPhone(d.phone), ...shopInn(d.inn), ...(d.tenantName ? { tenantName: d.tenantName } : {}) };
    // Shu oy hisobi ochilgan bo'lsa — yangi do'kon ham shu oyga tushadi (vebdagi `saveRentShop` bilan bir xil qoida)
    const r = await saveRentShopData(null, {
      name: d.name, location, ...tenant, period, payDay: period === "DAILY" ? null : d.payDay, area: d.area, isActive: !vacant,
      bankAmount: d.bankAmount, cashAmount: d.cashAmount, electricity: d.electricity, tax: d.tax, note: d.note,
      ...(d.electricityBilled !== undefined ? { electricityBilled: d.electricityBilled } : {}), ...(d.elecFixed !== undefined ? { elecFixed: d.elecFixed } : {}),
    }, currentMonth(), user.id);
    if (r.error) throw new Error(r.error);
    return { key: "arenda-shop", id: r.id!, message: vacant ? "Bo'sh joy qo'shildi" : "Do'kon qo'shildi" };
  }
  throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
}

// ───────────────────────── Amallar ─────────────────────────

const zNumOpt = z.preprocess((v) => (v === "" || v == null ? undefined : typeof v === "string" ? v.replace(/\s+/g, "").replace(",", ".") : v),
  z.coerce.number({ message: "Raqam kiriting" }).min(0, "Manfiy bo'lmasin").max(MAX_AMOUNT, "Summa juda katta").optional());

const LeaseBody = z.object({
  tenantName: z.string().trim().min(1, "Ijarachi F.I.O. sini yozing").max(200, "Ijarachi nomi juda uzun"),
  phone: z.string({ message: "Ijarachi telefonini kiriting" }).trim().min(1, "Ijarachi telefonini kiriting").max(40),
  inn: z.string().trim().max(20).optional(),
  startDate: z.string({ message: "Ijara boshlanish sanasini yozing" }).trim().min(1, "Ijara boshlanish sanasini yozing"),
  endDate: z.string().trim().max(20).optional(),
  contractNo: z.string().trim().max(60, "Shartnoma raqami juda uzun").optional(),
  deposit: zNumOpt, bankAmount: zNumOpt, cashAmount: zNumOpt,
  payDay: z.coerce.number().int().min(1, "To'lov kuni 1–31").max(31, "To'lov kuni 1–31").optional().catch(undefined),
  leaseNote: zText,
});
const PriceBody = z.object({ fromMonth: z.string({ message: "Qaysi oydan — oyni tanlang" }), bankAmount: zDec0, cashAmount: zDec0, note: zText });
const ElecBody = z.object({
  month: z.string({ message: "Oyni tanlang" }),
  meterStart: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number({ message: "Ko'rsatkich raqam bo'lsin" }).min(0, "Ko'rsatkich noto'g'ri").max(1e9, "Ko'rsatkich noto'g'ri").optional()),
  meterEnd: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number({ message: "Ko'rsatkich raqam bo'lsin" }).min(0, "Ko'rsatkich noto'g'ri").max(1e9, "Ko'rsatkich noto'g'ri").optional()),
  amount: zDec0, paidDirect: zDec0, note: zText,
});
const FormerPayBody = z.object({
  leaseId: z.string({ message: "Ijarachini tanlang" }).min(1, "Ijarachini tanlang"),
  method: z.enum(["CASH", "BANK"], { message: "To'lov usulini tanlang" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto'g'ri"),
  month: z.string({ message: "Qaysi oy uchun — oyni tanlang" }),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Kun noto'g'ri").optional(),
  amount: zAmount,
  note: zText,
});

const ChargeBody = z.object({ month: z.string(), bankDue: zDec0, cashDue: zDec0, electricity: zDec0, tax: zDec0, note: zText });

/** `runMobileAction` → `arenda.*`. Ruxsat (`can`) chaqiruvchida. */
export async function arendaAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<{ ok: true; message: string }> {
  const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
  switch (action) {
    case "arenda.storno": {
      const r = await cancelRentTx(id, String(payload.reason ?? ""), user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Bekor qilindi — kassa qoldig'i qayta hisoblandi" };
    }
    case "arenda.open-month": {
      const month = parseMonth(id);
      if (!month) fail("Oy noto'g'ri");
      const { created } = await openMonth(month!, user.id);
      return { ok: true, message: created ? `${created} ta do'kon hisobi ochildi` : "Yangi do'kon yo'q — hisob avvaldan ochilgan" };
    }
    case "arenda.shop.toggle": {
      const r = await toggleRentShopActive(id, user.id);
      if (r.error) fail(r.error, 404);
      return { ok: true, message: r.active ? `Ijaraga berildi${r.charged ? " — shu oy hisobiga qo'shildi" : ""}` : "Bo'sh joy deb belgilandi" };
    }
    case "arenda.shop.edit": {
      // Andoza summalar keyingi oylar hisobiga tushadi; ochilgan oy hisobi o'zgarmaydi (veb bilan bir xil)
      const p = ShopBody.safeParse(payload);
      if (!p.success) fail(issue(p.error));
      const d = p.data!;
      const location = d.location === NEW_LOCATION ? (d.locationNew ?? "") : d.location;
      if (!location) fail("Yangi joy (bozor) nomini yozing");
      const cur = await db.rentShop.findUnique({ where: { id }, select: { isActive: true, phone: true, payDay: true, period: true, electricity: true } });
      if (!cur) fail("Do'kon topilmadi", 404);
      const period = d.period ?? cur!.period;
      const phone = shopPhone(d.phone);
      // Ijaradagi joyda telefon va (oylikda) to'lov kuni shart — veb bilan bir xil; eski ilova yubormasa — mavjudi hisoblanadi
      if (cur!.isActive && !(phone.phone ?? cur!.phone)) fail("Ijaradagi joy uchun ijarachi telefonini kiriting");
      if (cur!.isActive && period === "MONTHLY" && !(d.payDay ?? cur!.payDay)) fail("To'lov kunini tanlang — har oyning nechanchi sanasigacha to'laydi");
      // Shartnoma tugashi: «-» — muddatsiz; bo'sh (yuborilmagan) — o'zgarmaydi
      const endDate = d.endDate === undefined ? undefined : /^[-–—]$/.test(d.endDate) ? null : parseDay(d.endDate, "Shartnoma tugashi");
      const r = await saveRentShopData(id, {
        name: d.name, location, ...phone, ...shopInn(d.inn), ...(d.tenantName ? { tenantName: d.tenantName } : {}), ...(endDate !== undefined ? { endDate } : {}),
        period: d.period, payDay: period === "DAILY" ? null : d.payDay, area: d.area, bankAmount: d.bankAmount, cashAmount: d.cashAmount,
        // Svet ijarachida bo'lsa «Svet, so'm» maydoni yashirin — yuborilmagani 0 bo'lib yozilmasin
        electricity: payload.electricity !== undefined ? d.electricity : n(cur!.electricity),
        tax: d.tax, note: d.note,
        ...(d.electricityBilled !== undefined ? { electricityBilled: d.electricityBilled } : {}), ...(d.elecFixed !== undefined ? { elecFixed: d.elecFixed } : {}),
      }, null, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Do'kon saqlandi" };
    }
    case "arenda.lease.start": {
      // Ijaraga berish (bo'sh joy) yoki ijarachini almashtirish — veb `startRentLeaseAction` bilan bir xil
      const p = LeaseBody.safeParse(payload);
      if (!p.success) fail(issue(p.error));
      const d = p.data!;
      const shop = await db.rentShop.findUnique({ where: { id }, select: { period: true } });
      if (!shop) fail("Do'kon topilmadi", 404);
      const monthly = shop!.period === "MONTHLY";
      if (monthly && !d.payDay) fail("To'lov kunini tanlang — har oyning nechanchi sanasigacha to'laydi");
      const r = await startRentLease(id, {
        tenantName: d.tenantName, phone: shopPhone(d.phone).phone!, inn: shopInn(d.inn).inn ?? null, no: d.contractNo || null,
        startDate: parseDay(d.startDate, "Ijara boshlanishi")!, endDate: parseDay(d.endDate, "Shartnoma tugashi") ?? null,
        deposit: d.deposit ?? null, leaseNote: d.leaseNote, bankAmount: d.bankAmount, cashAmount: d.cashAmount, ...(monthly ? { payDay: d.payDay } : {}),
      }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: `${r.replaced ? "Ijarachi almashtirildi" : "Ijaraga berildi"}${r.charged ? " — shu oy jadvaliga qo'shildi, summani tekshiring" : ""}${r.replaced ? ". Eski ijarachining shu oy hisobini tuzating" : ""}` };
    }
    case "arenda.lease.end": {
      const endedAt = parseDay(String(payload.endedAt ?? ""), "Chiqish sanasi");
      if (!endedAt) fail("Chiqish sanasini yozing");
      const r = await endRentLease(id, { endedAt, reason: String(payload.reason ?? "").trim().slice(0, 300) || null }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Joy bo'shatildi — qarzi bo'lsa «Qarzdorlar» da sobiq ijarachi sifatida qoladi" };
    }
    case "arenda.price": {
      const p = PriceBody.safeParse(payload);
      if (!p.success) fail(issue(p.error));
      const d = p.data!;
      const fromMonth = parseMonth(d.fromMonth);
      if (!fromMonth) fail("Oy noto'g'ri");
      const r = await addPriceChange(id, { fromMonth: fromMonth!, bankAmount: d.bankAmount, cashAmount: d.cashAmount, note: d.note }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: `${monthLabel(fromMonth!)} hisobi ochilganda yangi narx qo'llanadi` };
    }
    case "arenda.price.cancel": {
      const changeId = String(payload.changeId ?? "");
      const c = await db.rentPriceChange.findUnique({ where: { id: changeId }, select: { shopId: true } });
      if (!c || c.shopId !== id) fail("Narx o'zgarishi topilmadi", 404);
      const r = await cancelPriceChange(changeId, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Narx o'zgarishi bekor qilindi" };
    }
    case "arenda.elec": {
      const p = ElecBody.safeParse(payload);
      if (!p.success) fail(issue(p.error));
      const d = p.data!;
      const month = parseMonth(d.month);
      if (!month) fail("Oy noto'g'ri");
      const lease = await db.rentLease.findFirst({ where: { shopId: id, status: "ACTIVE" }, select: { id: true } });
      if (!lease) fail("Bu joy hozir ijarada emas", 400);
      const r = await saveRentElecData(lease!.id, month!, { meterStart: d.meterStart ?? null, meterEnd: d.meterEnd ?? null, amount: d.amount, paidDirect: d.paidDirect, note: d.note }, user.id);
      if (r.error) fail(r.error === "Avval 1 kVt narxini kiriting (shu sahifadagi «Svet tarifi»)" ? "Avval vebda «Arenda → Svet» da 1 kVt narxini kiriting" : r.error);
      return { ok: true, message: `${monthLabel(month!)} svet hisobi saqlandi — summasi ${money(r.sum ?? 0)}` };
    }
    case "arenda.remind": {
      const r = await sendRentReminder(id, { auto: false, userId: user.id });
      if (!r.ok) fail(r.error);
      return { ok: true, message: "Eslatma Telegram orqali yuborildi" };
    }
    case "arenda.pay.former": {
      // Sobiq ijarachi qarzi — kirim o'sha shartnomaga yoziladi (veb kartadagi «Qarzni qabul qilish»)
      const p = FormerPayBody.safeParse(payload);
      if (!p.success) fail(issue(p.error));
      const d = p.data!;
      const l = await db.rentLease.findUnique({ where: { id: d.leaseId }, select: { shopId: true, status: true } });
      if (!l || l.shopId !== id || l.status === "ACTIVE") fail("Sobiq ijarachi shartnomasi topilmadi", 404);
      const r = await createRentTx({
        type: "INCOME", method: d.method, date: new Date(`${d.date}T00:00:00Z`), month: parseMonth(d.month), shopId: id, leaseId: d.leaseId,
        amount: d.amount, category: RENT_INCOME_CATEGORY, note: d.note, clientToken: null, day: d.day ? new Date(`${d.day}T00:00:00Z`) : null,
      }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Sobiq ijarachidan to'lov yozildi" };
    }
    case "arenda.charge": {
      const p = ChargeBody.safeParse(payload);
      if (!p.success) fail(issue(p.error));
      const d = p.data!;
      const month = parseMonth(d.month);
      if (!month) fail("Oy noto'g'ri");
      const lease = await db.rentLease.findFirst({ where: { shopId: id, status: "ACTIVE" }, select: { id: true } });
      if (!lease) fail("Bu joy hozir ijarada emas — hisob ochib bo'lmaydi", 400);
      const r = await saveRentChargeData(lease!.id, month!, { bankDue: d.bankDue, cashDue: d.cashDue, electricity: d.electricity, tax: d.tax, note: d.note }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: `${monthLabel(month!)} hisobi saqlandi` };
    }
  }
  return fail("Bunday amal yo'q", 404);
}

// ───────────────────────── Bosh sahifa ─────────────────────────

/** Sekretar bosh ekrani: arenda kassasi, shu oy holati, qarzdor do'konlar, so'nggi harakatlar. */
export async function arendaHome(): Promise<{ cards: HomeCard[]; sections: HomeSection[] }> {
  const month = currentMonth();
  const soon = new Date(today().getTime() + LEASE_SOON_DAYS * 86_400_000);
  const [balance, sheet, recent, occ, coll, expiring] = await Promise.all([
    rentBalance(), monthSheet(month),
    db.rentTx.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8, include: { shop: { select: { name: true } } } }),
    rentOccupancy(), rentCollection(6),
    db.rentLease.findMany({ where: { status: "ACTIVE", endDate: { not: null, lte: soon } }, orderBy: { endDate: "asc" }, take: 10, include: { shop: { select: { name: true, location: true } } } }),
  ]);
  const t = sheet.total;
  const debtors = sheet.groups.flatMap((g) => g.rows).filter((r) => r.left > 0.005).sort((a, b) => b.left - a.left);
  const cards: HomeCard[] = [
    { key: "balance", label: "Arenda kassasi", value: money(balance.total), hint: `naqd ${money(balance.cash)} · bank ${money(balance.bank)}`, tone: balance.total < 0 ? "danger" : "success", icon: "wallet", open: { key: "arenda-jurnal" } },
    { key: "due", label: `To'lashi kerak (${monthLabel(month)})`, value: money(t.due), hint: sheet.opened ? `${sheet.groups.reduce((s, g) => s + g.rows.length, 0)} ta do'kon` : "oy hisobi hali ochilmagan", tone: sheet.opened ? "info" : "warning", icon: "calendar" },
    { key: "paid", label: "Tushgan", value: money(t.paid), hint: t.due > 0 ? `${Math.round((t.paid / t.due) * 100)}% yig'ildi` : undefined, tone: "success", icon: "trending-up" },
    { key: "left", label: "Qoldiq", value: money(t.left), hint: debtors.length ? `${debtors.length} ta do'kon qarzdor` : "hamma to'lagan", tone: t.left > 0.005 ? "danger" : "success", icon: "alert-circle", open: { key: "arenda-debtors" } },
  ];
  const sections: HomeSection[] = [
    { title: "Shu oy qarzdorlar", empty: "Qarzdor do'kon yo'q", target: "arenda-shop", rows: debtors.slice(0, 8).map((r) => ({ id: r.shopId, title: r.name, subtitle: `${r.location} · to'lashi kerak ${num(r.due)}`, right: `−${money(r.left)}`, tone: "danger" as Tone })) },
    ...(expiring.length ? [{
      title: "Shartnoma muddati tugayapti", empty: "—", target: "arenda-shop",
      rows: expiring.map((l) => {
        const d = leaseDaysLeft(l.endDate) ?? 0;
        return { id: l.shopId, title: `${l.shop.name}${l.tenantName ? ` · ${l.tenantName}` : ""}`, subtitle: `${l.shop.location} · ${dateRu(l.endDate!)} gacha`, right: d < 0 ? `${-d} kun o'tdi` : d === 0 ? "bugun" : `${d} kun qoldi`, tone: (d < 0 ? "danger" : "warning") as Tone };
      }),
    }] : []),
    { title: "So'nggi harakatlar", empty: "Harakat yo'q", target: "arenda-tx", rows: recent.map(txRow) },
    {
      title: "Bandlik (bozorlar bo'yicha)", empty: "Do'kon yo'q",
      rows: [...occ.rows, occ.total].map((r) => ({
        id: `occ~${r.location}`, title: r.location,
        subtitle: `ijarada ${r.on} · bo'sh ${r.off}${r.area ? ` · ${fmtNum(r.areaOn, 1)} / ${fmtNum(r.area, 1)} m²` : ""}${r.perM2 ? ` · 1 m² ${money(r.perM2)}` : ""}${r.lost ? ` · bo'sh joydan yo'qotish ${money(r.lost)}/oy` : ""}`,
        right: money(r.monthly), tone: (r.off ? "warning" : "success") as Tone,
      })),
    },
    {
      title: "Yig'im (oxirgi 6 oy)", empty: "Hisob yo'q",
      rows: [...coll].reverse().map((m) => ({ id: `col~${m.key}`, title: m.label, subtitle: `kerak ${money(m.due)} · tushdi ${money(m.paid)}`, right: m.rate === null ? "—" : `${m.rate}%`, tone: (m.rate === null ? "info" : m.rate >= 90 ? "success" : m.rate >= 60 ? "warning" : "danger") as Tone })),
    },
  ];
  return { cards, sections };
}
