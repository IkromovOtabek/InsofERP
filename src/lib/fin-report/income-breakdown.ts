import { isRealizationRow, loadRevenue } from "@/lib/bi/core";
import { moneyShort } from "@/lib/format";
import { avtoReport } from "./avto";
import { pnlSum, type PnlReport } from "./pnl";

/**
 * Foyda tarkibi qatori: `sign` — summa oldidagi belgi (+ daromad, − xarajat, = natija), `kind` — ko'rinishi
 * (`head` — guruh sarlavhasi, `line` — oddiy, `sub` — qator tarkibi, `total` — oraliq natija, `grand` — yakuniy natija,
 * `excluded` — ma'lumot uchun ko'rsatiladi, lekin hisobga kirmaydi: kulrang, ulush o'rniga «kirmaydi»).
 */
export type BreakdownLine = {
  label: string; value: number; sign?: "+" | "−" | "="; kind?: "head" | "line" | "sub" | "total" | "grand" | "excluded"; hint?: string;
  /** Bosilsa — manba paneli (qaysi yozuvlar, qachon) */
  href?: string;
  /** PNL manba paneli kaliti (`?drill=`) — veb havolasi shundan quriladi */
  drill?: string;
};

/** Zavod xarajati guruhlari — PNL qatorlari bilan bir xil bo'linish (transport — ishlab chiqarish ichida). */
const EXPENSE_GROUPS = [
  { key: "cogs", label: "Mahsulot tannarxi", hint: "retsept × xomashyo narxi" },
  { key: "prod", label: "Ishlab chiqarish va transport", hint: "ish haqi, sex xarajatlari, yoqilg'i, ta'mir (zavod kassasidan)" },
  { key: "admin", label: "Ma'muriy xarajatlar" },
  { key: "comm", label: "Tijoriy xarajatlar" },
  { key: "unknown", label: "Kategoriyasiz xarajat" },
  { key: "tax", label: "Soliqlar" },
  { key: "interest", label: "Kredit foizi" },
] as const;

/** Kartalar uchun yig'indilar (sotuv manbasisiz, tez): jami daromad, zavod xarajati (tannarx + barcha xarajat guruhlari), sof foyda. */
export function pnlTotals(rep: PnlReport) {
  const t = (k: keyof PnlReport["parts"]) => pnlSum(rep.parts, k);
  return { income: t("income") + t("otherIncome"), expenses: EXPENSE_GROUPS.reduce((s, g) => s + t(g.key), 0), net: t("net") };
}

/**
 * Jami daromad va foyda tarkibi — faqat zavod (QQSsiz, hisoblangan PNL bilan bir hisob): zavod sotuvi + boshqa tushumlar.
 * Logistika moliyasi alohida hisob — bu yerga qo'shilmaydi (foydalanuvchi qarori, 2026-11-27); `logi` — logistika daromadini
 * ma'lumot uchun («kirmaydi») ko'rsatish (summasini ko'ra oladigan rollarga). Veb PNL sahifasi va mobil direktor bosh sahifasi
 * shu bitta funksiyadan o'qiydi — ikki joyda ikki xil son chiqmasin.
 *
 * `from`/`to` — PNL davri (`[from, to)`), sotuv manbasi (zayavka / reestr) shu oraliqdan bo'linadi.
 */
export async function incomeBreakdown(rep: PnlReport, from: Date, to: Date, o: { logi: boolean }) {
  const p = rep.parts;
  const [sold, avto] = await Promise.all([loadRevenue(from, to), o.logi ? avtoReport(from, to) : Promise.resolve(null)]);
  const t = (k: keyof PnlReport["parts"]) => pnlSum(p, k);
  const sales = t("income"), other = t("otherIncome"), refund = t("refund");
  // Sotuv manbasi bo'yicha (QQSsiz — PNL bilan bir xil): zayavka reyslari va Realizatsiya reestri qatorlari
  const fromReg = sold.filter(isRealizationRow).reduce((x, r) => x + r.net, 0);
  const fromOrders = sold.reduce((x, r) => x + r.net, 0) - fromReg;
  const income = sales + other, net = t("net");
  const groups = EXPENSE_GROUPS.map((g) => ({ ...g, value: t(g.key) }));
  const expenses = groups.reduce((s, g) => s + g.value, 0);
  const lines: BreakdownLine[] = [
    { label: "Daromad", value: 0, kind: "head" },
    { label: "Zavod sotuvi", value: sales, sign: "+", hint: "yetkazilgan mahsulot (QQSsiz)", drill: "income" },
    { label: "Zayavka reyslari", value: fromOrders, kind: "sub", hint: "Manba: Buyurtmalar → yetkazilgan reyslar", drill: "income" },
    { label: "Realizatsiya reestri", value: fromReg, kind: "sub", hint: "Manba: Sotuv → Realizatsiya (qo'lda / Excel qatorlar)", drill: "income" },
    { label: "Mijozga qaytarilgan pul", value: -refund, sign: "−", kind: "sub", hint: "Manba: Kassa → «Sotib oluvchi pulini qaytarish»", drill: "refund" },
    { label: "Boshqa tushumlar", value: other, sign: "+", hint: "sotuvdan tashqari kirim", drill: "other-income" },
    ...rep.otherIncomeBy.map((x): BreakdownLine => ({ label: x.name, value: x.total, kind: "sub", hint: "Manba: Kassa → Kirim-Chiqim", drill: "other-income" })),
    { label: "Jami daromad", value: income, sign: "=", kind: "total", drill: "total-income" },
    ...(avto && avto.total.revenue ? [{ label: "Logistika daromadi", value: avto.total.revenue, kind: "excluded" as const, hint: "Manba: Logistika → Moliya (dostavka, usluga) — alohida hisob, zavodga qo'shilmaydi", href: "/logistika/moliya" }] : []),
    { label: "Xarajatlar", value: 0, kind: "head" },
    ...groups.map((g): BreakdownLine => ({ label: g.label, value: -g.value, sign: "−", ...("hint" in g ? { hint: g.hint } : {}), drill: g.key })),
    { label: "Zavod sof foydasi", value: net, sign: "=", kind: "grand", drill: "net" },
  ];
  const notes = [
    "Kirmaydi: logistika daromadi (dostavka, usluga — alohida hisob, Logistika → Moliya), mijoz to'lovlari (pul oqimi, daromad emas), kredit va hisoblar orasidagi o'tkazmalar.",
    ...(t("uncosted") > 0 ? [`Tannarxi noma'lum sotuv ${moneyShort(t("uncosted"))} — foyda biroz oshib ko'rinishi mumkin.`] : []),
  ];
  return { income, net, sales, other, expenses, groups, lines, notes };
}

/**
 * Zavod xarajati guruhining tarkibi — PNL'dagi ichki qatorlar (`prod:<nom>`, `admin:<nom>` …): kassa kategoriyasi bo'yicha.
 * Qiymat musbat (xarajat), kattasi tepada; nolli qatorlar tashlanadi.
 */
export function expenseItems(rep: PnlReport, group: string): { label: string; value: number }[] {
  return rep.rows
    .filter((r) => r.kind === "sub" && r.key.startsWith(`${group}:`))
    .map((r) => ({ label: r.label, value: -(r.total ?? 0) }))
    .filter((x) => Math.abs(x.value) >= 0.5)
    .sort((a, b) => b.value - a.value);
}
