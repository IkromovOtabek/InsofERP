import { db } from "@/lib/db";
import { pnlRange, pnlReport, type PnlReport } from "@/lib/fin-report/pnl";
import { monthKeyOf } from "@/lib/fin-report/period";
import { expenseItems, incomeBreakdown, pnlTotals, type BreakdownLine } from "@/lib/fin-report/income-breakdown";
import { canSeeLogiMoney } from "@/lib/logistics-finance";
import { loadRevenue } from "@/lib/bi/core";
import { day, money, num, sum, sumFull } from "./fmt";
import type { DashRange } from "./dashboard";
import type { MobileUser } from "./auth";
import type { DetailField, MobileDetail } from "./detail";
import type { HomeCard, HomeRow, HomeSection, Tone } from "./home";

/**
 * Direktor bosh sahifasining moliya va ishlab chiqarish kartalari (ilova 2026-11-27 talabi):
 *   · «Jami daromad» (hero) — vebdagi Foyda va zarar (PNL) → «Jami daromad» bilan bitta hisob; bosilsa foyda tarkibi;
 *   · «Umumiy zavod chiqimi» (hero'ni surganda) — tannarx + barcha zavod xarajatlari, PNL guruhlari bo'yicha tarkibi bilan;
 *   · «Beton» va «Plita» — davrda ishlab chiqarilgani; bosilsa qaysi kuni qancha, kim (mijoz / brigada) va qayerga ketgani.
 */

type Part = Pick<MobileDetail, "title" | "subtitle" | "fields" | "sections">;
const f = (label: string, value: string, tone?: Tone): DetailField => ({ label, value, tone });
const sec = (title: string, rows: HomeRow[], o: { empty?: string; target?: string; icon?: string } = {}): HomeSection =>
  ({ title, rows, empty: o.empty ?? "Bu davrda ma'lumot yo'q", target: o.target, icon: o.icon });
const pctOf = (v: number, base: number) => (base > 0 ? `${Math.round((Math.abs(v) / base) * 100)}%` : "—");
const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dmy = (iso: string) => iso.split("-").reverse().join(".");

/** Davr PNL'i: «Oy» — vebdagi PNL bilan aynan bir xil (oy ustuni), boshqa davr — shu oraliq qoidalari bilan. */
function periodPnl(r: DashRange): Promise<PnlReport> {
  return r.key === "month" ? pnlReport([monthKeyOf(r.from)], "accrual") : pnlRange(r.from, r.to);
}

// ───────────────────────── Bosh sahifa kartalari ─────────────────────────

/** Hero kartalari: «Jami daromad» va «Umumiy zavod chiqimi» (ilova ularni surib almashtiradi). */
export async function directorMoneyCards(r: DashRange, pl: string, open: (k: string) => { key: string; id: string }): Promise<HomeCard[]> {
  const T = pnlTotals(await periodPnl(r));
  return [
    { key: "profit", label: `Jami daromad ${pl}`.trim(), value: sumFull(T.income), hint: `sof foyda ${sumFull(T.net)}`, tone: T.net < 0 ? "danger" : "success", icon: "banknote", open: open("profit") },
    { key: "factory-out", label: `Umumiy zavod chiqimi ${pl}`.trim(), value: sumFull(T.expenses), hint: `daromadning ${pctOf(T.expenses, T.income)}`, tone: "warning", icon: "wallet", open: open("factory-out") },
  ];
}

/** Plita va boshqa dona mahsulot — PRODUCTION_OUTPUT (brigada qaydi) bo'yicha; papka — mahsulotning eng yuqori papkasi. */
async function donaOutput(from: Date, to: Date) {
  const [groups, moves] = await Promise.all([
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
    db.stockMove.findMany({
      where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: from, lt: to }, product: { unit: { not: "m3" } } },
      orderBy: { date: "desc" },
      select: { id: true, date: true, qty: true, product: { select: { name: true, unit: true, groupId: true } }, brigade: { select: { name: true } }, ownerBrigade: { select: { name: true } } },
    }),
  ]);
  const gById = new Map(groups.map((g) => [g.id, g]));
  const rootName = (gid: string | null) => { let g = gid ? gById.get(gid) : undefined; for (let i = 0; g?.parentId && i < 20; i++) g = gById.get(g.parentId) ?? g; return g?.name ?? null; };
  const rows = moves.map((m) => {
    const folder = rootName(m.product!.groupId) ?? m.product!.name;
    return { id: m.id, date: m.date, qty: sum(m.qty), product: m.product!.name, folder, brigade: (m.brigade ?? m.ownerBrigade)?.name ?? "Brigadasiz", plita: PLITA.test(folder) || PLITA.test(m.product!.name) };
  });
  // Plita papkasi/nomli mahsulot umuman bo'lmasa — barcha dona mahsulot «plita» hisoblanadi (karta bo'sh qolmasin)
  const anyPlita = rows.some((x) => x.plita) || (await db.product.count({ where: { unit: { not: "m3" }, OR: [{ name: { contains: "plita", mode: "insensitive" } }, { name: { startsWith: "PK" } }, { group: { name: { contains: "plita", mode: "insensitive" } } }] } })) > 0;
  return { rows, anyPlita, plita: anyPlita ? rows.filter((x) => x.plita) : rows, other: anyPlita ? rows.filter((x) => !x.plita) : [] };
}
const PLITA = /plita|плита|^PK|^ПК/i;
const qtySum = (rows: { qty: number }[]) => rows.reduce((s, x) => s + x.qty, 0);
const folderText = (rows: { folder: string; qty: number }[]) => {
  const m = new Map<string, number>();
  for (const x of rows) m.set(x.folder, (m.get(x.folder) ?? 0) + x.qty);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${num(v)}`).join(" · ");
};

/** «Plita» kartasi (Otgruzka o'rnida): davrda ishlab chiqarilgan plita soni. */
export async function plitaCard(r: DashRange, pl: string, open: (k: string) => { key: string; id: string }): Promise<HomeCard> {
  const D = await donaOutput(r.from, r.to);
  const days = new Set(D.plita.map((x) => localYmd(x.date))).size;
  const other = D.other.length ? `boshqa dona: ${folderText(D.other)}` : days ? `${days} kun · bosing — kim, qayerga` : "bu davrda qayd yo'q";
  return { key: "plita", label: `Plita ${pl}`.trim(), value: `${num(qtySum(D.plita))} dona`, hint: other, tone: "info", icon: "layers", open: open("plita") };
}

// ───────────────────────── Batafsil kartochkalar ─────────────────────────

/** Foyda tarkibi qatorlari → bo'limlar: har «head» — yangi bo'lim, qator o'ng tomonida summa, izohida ulush va manba. */
function linesToSections(lines: BreakdownLine[], base: number): HomeSection[] {
  const out: HomeSection[] = [];
  lines.forEach((l, i) => {
    if (l.kind === "head") { out.push(sec(l.label, [], { icon: out.length ? "wallet" : "trending-up", empty: "Bu davrda yozuv yo'q" })); return; }
    if ((l.kind === undefined || l.kind === "line" || l.kind === "sub") && Math.round(l.value) === 0) return;
    const shown = l.kind === "total" || l.kind === "grand" ? l.value : Math.abs(l.value);
    const tone: Tone | undefined = l.kind === "grand" ? (l.value < 0 ? "danger" : "success") : l.kind === "total" ? "brand" : l.kind === "excluded" ? "info" : undefined;
    const share = l.kind === "excluded" ? "kirmaydi" : `ulushi ${pctOf(shown, base)}`;
    if (!out.length) out.push(sec("Tarkibi", []));
    out[out.length - 1]!.rows.push({
      id: `l${i}`, title: `${l.kind === "sub" ? "· " : l.sign ? `${l.sign} ` : ""}${l.label}`,
      subtitle: [share, l.hint].filter(Boolean).join(" · "), right: shown < 0 ? sumFull(shown) : money(shown), tone,
    });
  });
  return out;
}

/** «Jami daromad» bosilganda — foyda qayerdan qo'shilyapti: daromad qismlari → xarajatlar → zavod sof foydasi. */
export async function incomeDetail(user: MobileUser, r: DashRange): Promise<Part> {
  const rep = await periodPnl(r);
  const b = await incomeBreakdown(rep, r.from, r.to, { logi: canSeeLogiMoney(user) });
  return {
    title: "Jami daromad va foyda tarkibi",
    subtitle: `Davr: ${r.label} · QQSsiz · vebdagi «Foyda va zarar» (PNL) bilan bitta hisob`,
    fields: [f("Jami daromad", money(b.income)), f("Zavod sof foydasi", sumFull(b.net), b.net < 0 ? "danger" : "success")],
    sections: [...linesToSections(b.lines, b.income), sec("Izoh", b.notes.map((n, i) => ({ id: `n${i}`, title: n })), { icon: "info" })],
  };
}

/** «Umumiy zavod chiqimi» bosilganda — PNL xarajat guruhlari va har birining kassa kategoriyalari. */
export async function factoryOutDetail(r: DashRange): Promise<Part> {
  const rep = await periodPnl(r);
  const T = pnlTotals(rep);
  const b = await incomeBreakdown(rep, r.from, r.to, { logi: false });
  const groups = b.groups.filter((g) => Math.round(g.value) !== 0);
  return {
    title: "Umumiy zavod chiqimi",
    subtitle: `Davr: ${r.label} · tannarx + zavod xarajatlari (PNL) · logistika alohida`,
    fields: [f("Jami chiqim", money(T.expenses), "warning"), f("Daromadga nisbatan", pctOf(T.expenses, T.income))],
    sections: [
      sec("Guruhlar bo'yicha", groups.map((g) => ({ id: g.key, title: g.label, subtitle: [`ulushi ${pctOf(g.value, T.expenses)}`, "hint" in g ? g.hint : undefined].filter(Boolean).join(" · "), right: money(g.value) })), { icon: "wallet", empty: "Bu davrda xarajat yo'q" }),
      ...groups.map((g) => ({ g, items: expenseItems(rep, g.key) })).filter((x) => x.items.length).map(({ g, items }) =>
        sec(g.label, items.slice(0, 25).map((x, i) => ({ id: `${g.key}-${i}`, title: x.label, subtitle: `ulushi ${pctOf(x.value, g.value)}`, right: money(x.value) })), { icon: "receipt" })),
    ],
  };
}

/** «Plita» bosilganda — qaysi kuni qancha, qaysi brigada quydi va qaysi mijozga (manzilga) ketdi. */
export async function plitaDetail(r: DashRange): Promise<Part> {
  const [D, trips] = await Promise.all([
    donaOutput(r.from, r.to),
    db.trip.findMany({
      where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to }, order: { items: { some: { product: { unit: { not: "m3" } } } } } },
      orderBy: { deliveredAt: "desc" }, take: 200,
      select: { id: true, qtyM3: true, deliveredAt: true, deliveryNoteNo: true, driver: { select: { fullName: true } }, vehicle: { select: { plate: true } }, order: { select: { orderNo: true, deliveryAddress: true, customer: { select: { name: true } }, items: { select: { product: { select: { name: true, unit: true, group: { select: { name: true } } } } } } } } },
    }),
  ]);
  const P = D.plita, total = qtySum(P);
  const byKey = <T,>(rows: T[], key: (x: T) => string, val: (x: T) => number) => {
    const m = new Map<string, { n: number; v: number; list: T[] }>();
    for (const x of rows) { const k = key(x); const g = m.get(k) ?? { n: 0, v: 0, list: [] }; g.n++; g.v += val(x); g.list.push(x); m.set(k, g); }
    return [...m];
  };
  const days = byKey(P, (x) => localYmd(x.date), (x) => x.qty).sort((a, b) => b[0].localeCompare(a[0]));
  const brigades = byKey(P, (x) => x.brigade, (x) => x.qty).sort((a, b) => b[1].v - a[1].v);
  const products = byKey(P, (x) => x.product, (x) => x.qty).sort((a, b) => b[1].v - a[1].v);
  // Plita reyslari — zayavkasida dona (plita) mahsulot bo'lgan, shu davrda yetkazilganlari
  const plitaTrips = trips.filter((t) => t.order.items.some((i) => i.product.unit !== "m3" && (!D.anyPlita || PLITA.test(i.product.group?.name ?? "") || PLITA.test(i.product.name))));
  const shipped = plitaTrips.reduce((s, t) => s + sum(t.qtyM3), 0);
  const dest = byKey(plitaTrips, (t) => `${t.order.customer.name}\u0000${t.order.deliveryAddress}`, (t) => sum(t.qtyM3)).sort((a, b) => b[1].v - a[1].v);
  return {
    title: "Plita — ishlab chiqarish va jo'natish",
    subtitle: `Davr: ${r.label} · brigada qaydi (sklad «Ishlab chiqarildi») va yetkazilgan reyslar`,
    fields: [
      f("Ishlab chiqarildi", `${num(total)} dona`),
      f("Mijozga yetkazildi", `${num(shipped)} dona · ${plitaTrips.length} reys`),
      ...(D.other.length ? [f("Boshqa dona mahsulot", folderText(D.other))] : []),
    ],
    sections: [
      sec("Kunlar bo'yicha", days.map(([iso, g]) => ({ id: `d-${iso}`, title: dmy(iso), subtitle: [...new Set(g.list.map((x) => x.brigade))].join(", "), right: `${num(g.v)} dona` })), { icon: "calendar-days", empty: "Bu davrda plita qayd etilmagan" }),
      sec("Kim ishlab chiqardi (brigada)", brigades.map(([name, g], i) => ({ id: `b${i}`, title: name, subtitle: `${g.n} ta qayd · ulushi ${pctOf(g.v, total)}`, right: `${num(g.v)} dona` })), { icon: "hard-hat" }),
      sec("Mahsulot bo'yicha", products.map(([name, g], i) => ({ id: `p${i}`, title: name, subtitle: `ulushi ${pctOf(g.v, total)}`, right: `${num(g.v)} dona` })), { icon: "package" }),
      sec("Qayerga ketdi (mijoz · manzil)", dest.map(([k, g], i) => { const [name, addr] = k.split("\u0000"); return { id: `c${i}`, title: name!, subtitle: `${addr} · ${g.n} reys`, right: `${num(g.v)} dona` }; }), { icon: "map-pin", empty: "Bu davrda plita yetkazilmagan" }),
      sec("Reyslar", plitaTrips.slice(0, 50).map((t) => ({ id: t.id, title: `${day(t.deliveredAt!)} · ${t.order.customer.name}`, subtitle: `${t.order.deliveryAddress} · ${t.driver.fullName} · ${t.vehicle.plate}`, right: `${num(sum(t.qtyM3))} dona` })), { target: "trips", empty: "Bu davrda plita reysi yo'q" }),
    ],
  };
}

// ───────────────────────── Beton — Realizatsiya reestridan ─────────────────────────

/**
 * Beton (m³) — Sotuv → «Realizatsiya» reestri qatorlari (`loadRevenue`: reyslar + qo'lda / Excel qatorlar, dispetcher
 * tuzatishlari bilan) — Tahlil, PNL va Jami daromad bilan bitta manba. Zames (ERP'da quyish qaydi) ko'p kunlari
 * yozilmaydi (2026-11: 33 m³ ↔ reestrda 3563 m³), shuning uchun karta reestrdan; zames izohda va tafsilot oxirida.
 */
const isM3 = (u: string) => /^(m3|м3|m³|куб)$/i.test(u.trim());
const betonRows = async (r: DashRange) => (await loadRevenue(r.from, r.to)).filter((x) => isM3(x.unit));

export async function betonCard(r: DashRange, pl: string, open: (k: string) => { key: string; id: string }, zamesM3: number): Promise<HomeCard> {
  const rows = await betonRows(r);
  const qty = rows.reduce((s, x) => s + x.qty, 0);
  return {
    key: "production", label: `Beton ${pl}`.trim(), value: `${num(qty)} m³`,
    hint: `${new Set(rows.map((x) => x.customerId)).size} mijoz · zames ${num(zamesM3)} m³`, tone: "success", icon: "factory", open: open("production"),
  };
}

export async function betonDetail(r: DashRange): Promise<Part> {
  const rows = await betonRows(r);
  const qty = rows.reduce((s, x) => s + x.qty, 0);
  const where = (x: (typeof rows)[number]) => x.rz?.address?.trim() || "manzil yozilmagan";
  const group = <K extends string>(key: (x: (typeof rows)[number]) => K) => {
    const m = new Map<K, { v: number; n: number; list: typeof rows }>();
    for (const x of rows) { const k = key(x); const g = m.get(k) ?? { v: 0, n: 0, list: [] }; g.v += x.qty; g.n++; g.list.push(x); m.set(k, g); }
    return [...m];
  };
  const m3 = (v: number) => `${num(v)} m³`;
  const days = group((x) => localYmd(x.date)).sort((a, b) => b[0].localeCompare(a[0]));
  const who = group((x) => `${localYmd(x.date)}\u0000${x.customer}\u0000${where(x)}`).sort((a, b) => b[0].localeCompare(a[0]) || b[1].v - a[1].v);
  const customers = group((x) => x.customer).sort((a, b) => b[1].v - a[1].v);
  const grades = group((x) => x.product).sort((a, b) => b[1].v - a[1].v);
  return {
    title: "Beton — sotilgan (Realizatsiya reestri)",
    subtitle: `Davr: ${r.label} · qaysi kuni qancha, kimga va qayerga · Sotuv → Realizatsiya bilan bitta hisob`,
    fields: [
      f("Jami beton", m3(qty)),
      f("Mijozlar", `${customers.length} ta`),
      f("Reestr qatorlari", `${rows.length} ta`),
    ],
    sections: [
      sec("Kunlar · kim · qayerga", who.slice(0, 120).map(([k, g], i) => { const [iso, name, addr] = k.split("\u0000"); return { id: `w${i}`, title: `${dmy(iso!)} · ${name}`, subtitle: `${addr} · ${g.n} qator`, right: m3(g.v) }; }), { icon: "map-pin", empty: "Bu davrda beton sotilmagan" }),
      sec("Kunlar bo'yicha", days.map(([iso, g]) => ({ id: `d-${iso}`, title: dmy(iso), subtitle: `${new Set(g.list.map((x) => x.customerId)).size} mijoz · ${g.n} qator`, right: m3(g.v) })), { icon: "calendar-days" }),
      sec("Mijozlar bo'yicha", customers.slice(0, 40).map(([name, g], i) => ({ id: `c${i}`, title: name, subtitle: `${g.n} qator · ulushi ${pctOf(g.v, qty)}`, right: m3(g.v) })), { icon: "users" }),
      sec("Marka bo'yicha", grades.map(([name, g], i) => ({ id: `g${i}`, title: name, subtitle: `ulushi ${pctOf(g.v, qty)}`, right: m3(g.v) })), { icon: "package" }),
    ],
  };
}
