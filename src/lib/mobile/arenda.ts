import { z } from "zod";
import { Prisma, type RentMethod, type RentTxType } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { canDo } from "@/lib/permissions";
import { MAX_AMOUNT } from "@/lib/action";
import { dateRu, fmtNum, money } from "@/lib/format";
import {
  RENT_EXPENSE_CATEGORIES, RENT_INCOME_CATEGORY, RENT_METHOD_LABEL, cancelRentTx, createRentTx, currentMonth, monthKey, monthLabel,
  monthSheet, openMonth, parseMonth, rentBalance, shiftMonth, shopDebts,
} from "@/lib/rent";
import type { MobileUser } from "./auth";
import type { CreateForm, CreateResult } from "./create";
import type { DetailAction, FormField, FormOption, MobileDetail } from "./detail";
import type { HomeCard, HomeRow, HomeSection, Tone } from "./home";
import { ListError, type MobileList } from "./list";

/**
 * Arenda (do'konlar ijarasi) — sekretarning mobil ish joyi. Vebdagi `/arenda` sahifasi bilan bitta qoida:
 * hisob `lib/rent.ts` da (`monthSheet`, `createRentTx`, `cancelRentTx`, `openMonth`), bu yerda faqat
 * ilova uchun shakl: oy varag'i (`GET /api/mobile/arenda`), jurnal va do'konlar ro'yxati, kartochkalar,
 * kirim/chiqim/do'kon formalari va amallar (storno, oyni ochish, do'kon hisobi).
 *
 * Ruxsat — veb bilan bir xil (`lib/permissions.ts` → `arenda: create | shops | storno`).
 */

const n = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
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
  const parts = [dateRu(t.date), RENT_METHOD_LABEL[t.method], t.note, t.cancelledAt ? `storno: ${t.cancelReason ?? ""}` : null].filter(Boolean);
  return {
    id: t.id,
    title: t.type === "INCOME" ? `${t.shop?.name ?? "Do'kon"}${t.month ? ` · ${monthLabel(t.month)}` : ""}` : t.category,
    subtitle: parts.join(" · "),
    right: `${sign}${money(n(t.amount))}`,
    status: t.cancelledAt ? "Storno" : t.type === "INCOME" ? "Kirim" : "Chiqim",
    tone: TX_TONE(t),
  };
}

const JURNAL_TABS = [
  { key: "all", label: "Hammasi", where: {} as Prisma.RentTxWhereInput },
  { key: "income", label: "Kirim", where: { type: "INCOME", cancelledAt: null } as Prisma.RentTxWhereInput },
  { key: "expense", label: "Chiqim", where: { type: "EXPENSE", cancelledAt: null } as Prisma.RentTxWhereInput },
  { key: "storno", label: "Storno", where: { cancelledAt: { not: null } } as Prisma.RentTxWhereInput },
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

/** Do'konlar — joy (bozor) bo'yicha tartibda, o'ngda umumiy qarz/avans. */
export async function arendaShopsList(q?: string, filter?: string): Promise<MobileList> {
  const onlyActive = filter !== "all";
  const search: Prisma.RentShopWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] } : {};
  const [shops, debts, total] = await Promise.all([
    db.rentShop.findMany({ where: { ...search, ...(onlyActive ? { isActive: true } : {}) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    shopDebts(),
    db.rentShop.count({ where: search }),
  ]);
  const active = onlyActive ? shops.length : shops.filter((s) => s.isActive).length;
  return {
    key: "arenda-shops", title: "Do'konlar",
    rows: shops.map((s) => {
      const debt = debts.get(s.id) ?? 0;
      return {
        id: s.id, title: s.name,
        subtitle: `${s.location} · bank ${num(n(s.bankAmount))} · naqd ${num(n(s.cashAmount))}`,
        right: debt > 0.005 ? `qarz ${money(debt)}` : debt < -0.005 ? `avans ${money(-debt)}` : "—",
        status: s.isActive ? "Faol" : "Yopiq", tone: !s.isActive ? "info" : debt > 0.005 ? "danger" : "success",
      };
    }),
    filters: [
      { key: "active", label: "Faol", count: active, active: onlyActive },
      { key: "all", label: "Hammasi", count: total, active: !onlyActive },
    ],
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
      id: "arenda.storno", label: "Storno qilish", tone: "danger",
      form: [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda", hint: "Yozuv jurnalda chizilgan holda qoladi, kassa qoldig'i qayta hisoblanadi" }],
    });
  }
  return {
    key: "arenda-tx", id: t.id,
    title: income ? `Kirim · ${t.shop?.name ?? "Do'kon"}` : `Chiqim · ${t.category}`,
    subtitle: `${dateRu(t.date)} · ${RENT_METHOD_LABEL[t.method]}`,
    status: t.cancelledAt ? "Storno" : income ? "Kirim" : "Chiqim",
    fields: [
      { label: "Summa", value: `${income ? "+" : "−"}${money(n(t.amount))}`, tone: TX_TONE(t) },
      { label: "Usul", value: RENT_METHOD_LABEL[t.method] },
      ...(t.shop ? [{ label: "Do'kon", value: `${t.shop.name} · ${t.shop.location}` }] : []),
      ...(t.month ? [{ label: "Qaysi oy uchun", value: monthLabel(t.month) }] : []),
      { label: income ? "Turi" : "Chiqim turi", value: t.category },
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
      { label: "Kiritdi", value: `${t.createdBy.fullName} · ${dateRu(t.createdAt)}` },
      ...(t.cancelledAt ? [{ label: "Storno", value: `${cancelledBy?.fullName ?? "—"} · ${dateRu(t.cancelledAt)}${t.cancelReason ? ` · ${t.cancelReason}` : ""}`, tone: "warning" as Tone }] : []),
    ],
    sections: [],
    actions,
  };
}

/** Do'kon kartochkasi: andoza summalar, umumiy qarz, oxirgi oylar hisobi; amallar — shu oy hisobini tahrirlash, yopish/ochish. */
export async function arendaShopDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const s = await db.rentShop.findUnique({ where: { id } });
  if (!s) throw new ListError("NOT_FOUND", "Do'kon topilmadi", 404);
  const now = currentMonth();
  const [charges, paid, debts] = await Promise.all([
    db.rentCharge.findMany({ where: { shopId: id }, orderBy: { month: "desc" }, take: 6 }),
    db.rentTx.groupBy({ by: ["month"], where: { shopId: id, type: "INCOME", cancelledAt: null, month: { not: null } }, _sum: { amount: true } }),
    shopDebts(),
  ]);
  const paidBy = new Map(paid.map((p) => [monthKey(p.month!), n(p._sum.amount)]));
  const debt = debts.get(id) ?? 0;
  const cur = charges.find((c) => monthKey(c.month) === monthKey(now));
  const canShops = arendaCan(user, "shops");

  const actions: DetailAction[] = [];
  if (canShops) {
    actions.push({
      id: "arenda.charge", label: cur ? "Shu oy hisobini tahrirlash" : "Shu oy hisobini ochish", tone: "brand",
      form: [
        { name: "month", label: "Oy", type: "select", required: true, value: monthKey(now), options: monthOptions(now) },
        { name: "bankDue", label: "Perechisleniye, so'm", type: "number", required: true, value: String(n(cur?.bankDue ?? s.bankAmount)) },
        { name: "cashDue", label: "Naqd, so'm", type: "number", required: true, value: String(n(cur?.cashDue ?? s.cashAmount)) },
        { name: "electricity", label: "Svet, so'm", type: "number", value: String(n(cur?.electricity ?? s.electricity)), hint: "Ma'lumot uchun — qoldiqqa ta'sir qilmaydi" },
        { name: "tax", label: "Soliq, so'm", type: "number", value: String(n(cur?.tax ?? s.tax)) },
        { name: "note", label: "Izoh", type: "text", value: cur?.note ?? undefined },
      ],
    });
    actions.push({
      id: "arenda.shop.toggle", label: s.isActive ? "Do'konni yopish" : "Qayta faollashtirish", tone: s.isActive ? "danger" : "success",
      confirm: s.isActive ? "Yopilgan do'kon keyingi oylar hisobiga tushmaydi, tarixi joyida qoladi. Yopasizmi?" : "Do'kon keyingi oy ochilganda yana hisobga tushadi. Faollashtirasizmi?",
    });
  }

  const months: HomeSection = {
    title: "Oylar bo'yicha hisob", empty: "Hisob hali ochilmagan — «Shu oy hisobini ochish»",
    rows: charges.map((c) => {
      const due = n(c.bankDue) + n(c.cashDue), p = paidBy.get(monthKey(c.month)) ?? 0, left = r2(due - p);
      return { id: c.id, title: monthLabel(c.month), subtitle: `bank ${num(n(c.bankDue))} · naqd ${num(n(c.cashDue))}`, right: `${num(p)} / ${num(due)}`, status: left > 0.005 ? `qoldiq ${num(left)}` : left < -0.005 ? `avans ${num(-left)}` : "To'liq", tone: left > 0.005 ? "danger" : "success" };
    }),
  };

  return {
    key: "arenda-shop", id: s.id, title: s.name, subtitle: s.location, status: s.isActive ? "Faol" : "Yopiq",
    fields: [
      { label: "Umumiy holat", value: debt > 0.005 ? `qarz ${money(debt)}` : debt < -0.005 ? `avans ${money(-debt)}` : "qarz yo'q", tone: debt > 0.005 ? "danger" : "success" },
      { label: "Oylik (andoza)", value: `bank ${money(n(s.bankAmount))} · naqd ${money(n(s.cashAmount))}` },
      ...(n(s.electricity) || n(s.tax) ? [{ label: "Svet · soliq", value: `${money(n(s.electricity))} · ${money(n(s.tax))}` }] : []),
      ...(s.note ? [{ label: "Izoh", value: s.note }] : []),
      { label: "Holat", value: s.isActive ? "Faol" : "Yopiq", tone: s.isActive ? "success" : "info" },
    ],
    sections: [months],
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
        options: shops.map((s) => { const d = debts.get(s.id) ?? 0; return { value: s.id, label: `${s.name} · ${s.location}`, hint: d > 0.005 ? `qarz ${money(d)}` : d < -0.005 ? `avans ${money(-d)}` : "qarz yo'q" }; }),
      },
      { name: "month", label: "Qaysi oy uchun", type: "select", required: true, value: monthKey(now), options: monthOptions(now) },
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
      { name: "bankAmount", label: "Oylik — perechisleniye, so'm", type: "number", value: "0" },
      { name: "cashAmount", label: "Oylik — naqd, so'm", type: "number", value: "0" },
      { name: "electricity", label: "Svet, so'm", type: "number", value: "0", hint: "Ma'lumot uchun" },
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

const TxBody = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  method: z.enum(["CASH", "BANK"], { message: "To'lov usulini tanlang" }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto'g'ri"),
  month: z.string().optional(),
  shopId: z.string().optional(),
  amount: zAmount,
  category: z.string().optional(),
  note: zText,
  clientToken: zToken,
});

const ShopBody = z.object({
  name: z.string().trim().min(1, "Do'kon nomini yozing").max(200, "Nom juda uzun"),
  location: z.string().trim().min(1, "Joy (bozor) ni tanlang"),
  locationNew: z.string().trim().max(120, "Nom juda uzun").optional(),
  bankAmount: zDec0, cashAmount: zDec0, electricity: zDec0, tax: zDec0,
  note: zText,
});

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
    const category = type === "INCOME" ? RENT_INCOME_CATEGORY : (d.category ?? "");
    if (type === "EXPENSE" && !(RENT_EXPENSE_CATEGORIES as readonly string[]).includes(category)) throw new Error("Chiqim turini tanlang");
    if (type === "EXPENSE" && category === "Boshqa" && !d.note) throw new Error("«Boshqa» chiqim uchun izoh yozing");
    const r = await createRentTx({
      type, method: d.method, date: new Date(`${d.date}T00:00:00Z`), month, shopId: type === "INCOME" ? d.shopId! : null,
      amount: d.amount, category, note: d.note, clientToken: d.clientToken ?? null,
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
    const data = { name: d.name, location, bankAmount: d.bankAmount, cashAmount: d.cashAmount, electricity: d.electricity, tax: d.tax, note: d.note };
    try {
      const month = currentMonth();
      const shop = await db.$transaction(async (tx) => {
        const shop = await tx.rentShop.create({ data });
        await audit(tx, user.id, "CREATE", "RentShop", shop.id, undefined, shop);
        // Shu oy hisobi ochilgan bo'lsa — yangi do'kon ham shu oyga tushadi (vebdagi `saveRentShop` bilan bir xil)
        if (await tx.rentCharge.count({ where: { month } })) {
          await tx.rentCharge.create({ data: { shopId: shop.id, month, bankDue: data.bankAmount, cashDue: data.cashAmount, electricity: data.electricity, tax: data.tax } });
        }
        return shop;
      });
      return { key: "arenda-shop", id: shop.id, message: "Do'kon qo'shildi" };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new Error(`«${location}» da «${d.name}» nomli do'kon allaqachon bor`);
      throw e;
    }
  }
  throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
}

// ───────────────────────── Amallar ─────────────────────────

const ChargeBody = z.object({ month: z.string(), bankDue: zDec0, cashDue: zDec0, electricity: zDec0, tax: zDec0, note: zText });

/** `runMobileAction` → `arenda.*`. Ruxsat (`can`) chaqiruvchida. */
export async function arendaAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<{ ok: true; message: string }> {
  const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
  switch (action) {
    case "arenda.storno": {
      const r = await cancelRentTx(id, String(payload.reason ?? ""), user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Storno qilindi — kassa qoldig'i qayta hisoblandi" };
    }
    case "arenda.open-month": {
      const month = parseMonth(id);
      if (!month) fail("Oy noto'g'ri");
      const { created } = await openMonth(month!, user.id);
      return { ok: true, message: created ? `${created} ta do'kon hisobi ochildi` : "Yangi do'kon yo'q — hisob avvaldan ochilgan" };
    }
    case "arenda.shop.toggle": {
      const shop = await db.rentShop.findUnique({ where: { id } });
      if (!shop) fail("Do'kon topilmadi", 404);
      const ok = await db.rentShop.updateMany({ where: { id, isActive: shop!.isActive }, data: { isActive: !shop!.isActive } });
      if (ok.count) await audit(db, user.id, "STATUS_CHANGE", "RentShop", id, { isActive: shop!.isActive }, { isActive: !shop!.isActive });
      return { ok: true, message: shop!.isActive ? "Do'kon yopildi" : "Do'kon qayta faollashtirildi" };
    }
    case "arenda.charge": {
      const p = ChargeBody.safeParse(payload);
      if (!p.success) fail(issue(p.error));
      const d = p.data!;
      const month = parseMonth(d.month);
      if (!month) fail("Oy noto'g'ri");
      const before = await db.rentCharge.findUnique({ where: { shopId_month: { shopId: id, month: month! } } });
      if (!before && !(await db.rentShop.findUnique({ where: { id }, select: { id: true } }))) fail("Do'kon topilmadi", 404);
      const data = { bankDue: d.bankDue, cashDue: d.cashDue, electricity: d.electricity, tax: d.tax, note: d.note };
      const c = await db.rentCharge.upsert({ where: { shopId_month: { shopId: id, month: month! } }, create: { shopId: id, month: month!, ...data }, update: data });
      await audit(db, user.id, before ? "UPDATE" : "CREATE", "RentCharge", c.id, before ?? undefined, c);
      return { ok: true, message: `${monthLabel(month!)} hisobi saqlandi` };
    }
  }
  return fail("Bunday amal yo'q", 404);
}

// ───────────────────────── Bosh sahifa ─────────────────────────

/** Sekretar bosh ekrani: arenda kassasi, shu oy holati, qarzdor do'konlar, so'nggi harakatlar. */
export async function arendaHome(): Promise<{ cards: HomeCard[]; sections: HomeSection[] }> {
  const month = currentMonth();
  const [balance, sheet, recent] = await Promise.all([
    rentBalance(), monthSheet(month),
    db.rentTx.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8, include: { shop: { select: { name: true } } } }),
  ]);
  const t = sheet.total;
  const debtors = sheet.groups.flatMap((g) => g.rows).filter((r) => r.left > 0.005).sort((a, b) => b.left - a.left);
  const cards: HomeCard[] = [
    { key: "balance", label: "Arenda kassasi", value: money(balance.total), hint: `naqd ${money(balance.cash)} · bank ${money(balance.bank)}`, tone: balance.total < 0 ? "danger" : "success", icon: "wallet", open: { key: "arenda-jurnal" } },
    { key: "due", label: `To'lashi kerak (${monthLabel(month)})`, value: money(t.due), hint: sheet.opened ? `${sheet.groups.reduce((s, g) => s + g.rows.length, 0)} ta do'kon` : "oy hisobi hali ochilmagan", tone: sheet.opened ? "info" : "warning", icon: "calendar" },
    { key: "paid", label: "Tushgan", value: money(t.paid), hint: t.due > 0 ? `${Math.round((t.paid / t.due) * 100)}% yig'ildi` : undefined, tone: "success", icon: "trending-up" },
    { key: "left", label: "Qoldiq", value: money(t.left), hint: debtors.length ? `${debtors.length} ta do'kon qarzdor` : "hamma to'lagan", tone: t.left > 0.005 ? "danger" : "success", icon: "alert-circle", open: { key: "arenda-shops" } },
  ];
  const sections: HomeSection[] = [
    { title: "Shu oy qarzdorlar", empty: "Qarzdor do'kon yo'q", target: "arenda-shop", rows: debtors.slice(0, 8).map((r) => ({ id: r.shopId, title: r.name, subtitle: `${r.location} · to'lashi kerak ${num(r.due)}`, right: `−${money(r.left)}`, tone: "danger" as Tone })) },
    { title: "So'nggi harakatlar", empty: "Harakat yo'q", target: "arenda-tx", rows: recent.map(txRow) },
  ];
  return { cards, sections };
}
