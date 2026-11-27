import { db } from "@/lib/db";
import { pnlDrill, pnlDrillRange, pnlRange, pnlReport, type PnlReport } from "@/lib/fin-report/pnl";
import { monthKeyOf } from "@/lib/fin-report/period";
import { expenseItems, incomeBreakdown, pnlTotals, type BreakdownLine } from "@/lib/fin-report/income-breakdown";
import { canSeeLogiMoney } from "@/lib/logistics-finance";
import { loadRevenue } from "@/lib/bi/core";
import { day, money, num, sum, sumFull, time } from "./fmt";
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

/** Davr kaliti — bosh sahifa filtri bilan bir xil (`month`, `week`, `custom~YYYY-MM-DD~YYYY-MM-DD`). */
const pidOf = (r: DashRange) => (r.key === "custom" ? `custom~${localYmd(r.from)}~${localYmd(new Date(r.to.getTime() - 86_400_000))}` : r.key);
/**
 * PNL qatori manbasi kartochkasi kaliti: `dash/pnl~<kalit>.<davr>`. Kalit base64url — PNL kalitlarida «:» bor
 * (`prod:Avtotransport`), `mobileDetail` esa «:» ni aralash ro'yxat belgisi deb ajratadi.
 */
export const PNL_DRILL = "pnl~";
const drillId = (key: string, r: DashRange) => `${PNL_DRILL}${Buffer.from(key, "utf8").toString("base64url")}.${pidOf(r)}`;

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
function linesToSections(lines: BreakdownLine[], base: number, r: DashRange): HomeSection[] {
  const out: HomeSection[] = [];
  lines.forEach((l, i) => {
    // Har qator bosiladi — manba yozuvlari (`pnlDrillDetail`); logistika qatori — alohida hisob izohi
    if (l.kind === "head") { out.push(sec(l.label, [], { icon: out.length ? "wallet" : "trending-up", empty: "Bu davrda yozuv yo'q", target: "dash" })); return; }
    if ((l.kind === undefined || l.kind === "line" || l.kind === "sub") && Math.round(l.value) === 0) return;
    const shown = l.kind === "total" || l.kind === "grand" ? l.value : Math.abs(l.value);
    const tone: Tone | undefined = l.kind === "grand" ? (l.value < 0 ? "danger" : "success") : l.kind === "total" ? "brand" : l.kind === "excluded" ? "info" : undefined;
    const share = l.kind === "excluded" ? "kirmaydi" : `ulushi ${pctOf(shown, base)}`;
    if (!out.length) out.push(sec("Tarkibi", [], { target: "dash" }));
    out[out.length - 1]!.rows.push({
      id: l.drill ? drillId(l.drill, r) : l.kind === "excluded" ? drillId("logi", r) : `l${i}`, title: `${l.kind === "sub" ? "· " : l.sign ? `${l.sign} ` : ""}${l.label}`,
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
    sections: [...linesToSections(b.lines, b.income, r), sec("Izoh", ["Qatorni bosing — summa qaysi yozuvlardan, qachon tushgani (fakt) ochiladi.", ...b.notes].map((n, i) => ({ id: `n${i}`, title: n })), { icon: "info" })],
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
      sec("Guruhlar bo'yicha", groups.map((g) => ({ id: drillId(g.key, r), title: g.label, subtitle: [`ulushi ${pctOf(g.value, T.expenses)}`, "hint" in g ? g.hint : undefined].filter(Boolean).join(" · "), right: money(g.value) })), { icon: "wallet", empty: "Bu davrda xarajat yo'q", target: "dash" }),
      ...groups.map((g) => ({ g, items: expenseItems(rep, g.key) })).filter((x) => x.items.length).map(({ g, items }) =>
        sec(g.label, items.slice(0, 25).map((x) => ({ id: drillId(`${g.key}:${x.label}`, r), title: x.label, subtitle: `ulushi ${pctOf(x.value, g.value)}`, right: money(x.value) })), { icon: "receipt", target: "dash" })),
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

// ───────────────────────── PNL qatori — fakt yozuvlari ─────────────────────────

/**
 * «Jami daromad» / «Umumiy zavod chiqimi» tarkibidagi qator bosilganda: qaysi yozuv (kassa, reestr qatori, sklad sarfi),
 * qachon, qancha — vebdagi PNL manba paneli (`?drill=`) bilan bitta hisob. Jami qator bo'lsa — tarkibi (har biri yana bosiladi).
 */
export async function pnlDrillDetail(rawKey: string, r: DashRange): Promise<Part> {
  let key: string;
  try { key = Buffer.from(rawKey, "base64url").toString("utf8"); } catch { key = ""; }
  if (key === "logi") {
    return {
      title: "Logistika daromadi", subtitle: `Davr: ${r.label} · alohida hisob`,
      fields: [],
      sections: [sec("Izoh", [{ id: "n0", title: "Dostavka va usluga daromadi Logistika → Moliya bo'limida yuritiladi va zavod daromadiga qo'shilmaydi." }], { icon: "info" })],
    };
  }
  const d = key ? (r.key === "month" ? await pnlDrill([monthKeyOf(r.from)], "accrual", key, null) : await pnlDrillRange(r.from, r.to, key, r.label)) : null;
  if (!d) return { title: "Ma'lumot topilmadi", subtitle: `Davr: ${r.label}`, fields: [], sections: [] };
  const unit = d.isQty ? ` ${d.unit ?? ""}`.trimEnd() : "";
  const val = (v: number) => (d.isQty ? `${num(v)}${unit}` : v < 0 ? sumFull(v) : money(v));
  const items = d.items;
  return {
    title: d.title, subtitle: `Davr: ${r.label}${d.note ? ` · ${d.note}` : ""}`,
    fields: [f("Summa", val(d.value)), ...(items.length ? [f("Yozuvlar", `${items.length} ta`)] : [])],
    sections: [
      ...(d.parts.length ? [sec("Tarkibi", d.parts.map((x) => ({ id: drillId(x.key, r), title: x.label, right: val(x.value) })), { icon: "layers", target: "dash" })] : []),
      ...(items.length || !d.parts.length ? [sec("Yozuvlar (fakt)", items.slice(0, 200).map((it, i) => ({
        id: `i${i}`, title: `${it.date ? `${day(it.date)}${it.date.getHours() || it.date.getMinutes() ? ` ${time(it.date)}` : ""} · ` : ""}${it.title}`, subtitle: it.sub, right: val(it.amount),
      })), { icon: "receipt", empty: "Bu davrda yozuv yo'q" })] : []),
    ],
  };
}

// ───────────────────────── Kartochka ichida nima bor (info tugmasi) ─────────────────────────

/** Direktor kartochkalari — «i» tugmasi bosilganda: bu kartochkada nima ko'rinadi va raqam qayerdan olinadi. */
export const DIRECTOR_INFO: Record<string, string[]> = {
  revenue: ["Tushum — tanlangan davrda sotilgan mahsulot summasi (Sotuv → Realizatsiya reestri, QQS va dastavka bilan).", "Ichida: mahsulot, mijoz, sotuvchi va kunlar kesimi, zayavkalar ro'yxati."],
  profit: ["Jami daromad — vebdagi Foyda va zarar (PNL) → «Jami daromad»: zavod sotuvi + boshqa tushumlar, QQSsiz.", "Ichida: daromad qismlari (zayavka reyslari, Realizatsiya reestri, kassadagi boshqa kirimlar), xarajat guruhlari va zavod sof foydasi, har birining ulushi.", "Har qatorni bosing — summa qaysi yozuvlardan, qachon tushgani (fakt) ochiladi.", "Logistika daromadi (dostavka, usluga) alohida hisob — jamiga kirmaydi."],
  "factory-out": ["Umumiy zavod chiqimi — PNL bo'yicha mahsulot tannarxi + barcha zavod xarajatlari (ishlab chiqarish va transport, ma'muriy, tijoriy, soliq, kredit foizi).", "Ichida: guruhlar va har guruhning kassa kategoriyalari, ulushi bilan; har qator bosilsa — fakt yozuvlar.", "Kredit tanasi, asosiy vosita xaridi va logistika xarajatlari bu yerga kirmaydi."],
  expenses: ["Xarajatlar — kassadan chiqqan xarajatlar (kirim-chiqim), byudjet bilan taqqoslash.", "Ichida: kategoriyalar, byudjetdan oshganlar, rejalashtirilmaganlar."],
  cash: ["Pul — hozir qo'ldagi pul: kassa + bank qoldig'i.", "Ichida: har kassa va bank hisobi qoldig'i."],
  receivable: ["Debitorka — mijozlar qarzi: schyot va qarzga sotuv minus to'lovlar.", "Ichida: qarzdorlar, qarz yoshi (0–7, 8–30, 31–60, 60+ kun), ochiq schyotlar, mijozlar avansi."],
  problems: ["Muammolar — egasi qarorini kutayotgan masalalar.", "Ichida: har masala, mas'ul, muddat va summa."],
  production: ["Beton — tanlangan davrda sotilgan beton (Sotuv → Realizatsiya reestri, m³).", "Ichida: qaysi kuni qancha, qaysi mijozga va qaysi manzilga; kunlar, mijozlar va marka bo'yicha.", "Oxirida — ERP'ga yozilgan zameslar (quyish qaydi) va plan/fakt."],
  shipment: ["Otgruzka — «Yetkazildi» bosilgan reyslar hajmi.", "Ichida: haydovchi, mijoz, transport va kunlar bo'yicha, reyslar ro'yxati."],
  plita: ["Plita — brigadalar sklad orqali qayd etgan ishlab chiqarilgan plita (dona).", "Ichida: kunlar, kim ishlab chiqargani (brigada), mahsulot, qaysi mijozga va manzilga yetkazilgani, reyslar."],
  [PNL_DRILL]: ["Bu qator summasi qaysi yozuvlardan yig'ilgani: sana, manba (kassa, reestr qatori, sklad sarfi) va summa.", "Jami qator bo'lsa — tarkibi; har birini bosib ichiga kiring.", "Vebdagi Foyda va zarar (PNL) manba paneli bilan bitta hisob."],
};
