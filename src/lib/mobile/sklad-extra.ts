import { db } from "@/lib/db";
import { moduleWriteAllowed } from "@/lib/auth";
import { dateRu, fmtNum } from "@/lib/format";
import { unitLabel, unitShort } from "@/lib/unit";
import { ostatkaDetail, ostatkaSummary } from "@/lib/ostatka";
import { productionCapacity } from "@/lib/production-capacity";
import { brigadeStocks, issueToBrigade, returnFromBrigade, undistributedMaterials, type BrigadeMaterial } from "@/lib/brigade-stock";
import { isCardKind, recipientCard } from "@/lib/recipient-card";
import { recipientList, setRecipientActive, upsertRecipient } from "@/lib/stock-recipients";
import { cancelIssue, IssueError } from "@/lib/stock-issue";
import { cancelReceipt } from "@/lib/storno";
import { fillMissingPricesFromAvg, MaterialPriceError, setMaterialPrice } from "@/lib/material-price";
import { removeMaterial } from "@/lib/material-remove";
import { MATERIAL_CATALOG_ROLES } from "@/lib/catalog";
import { updateSupplierRequisites } from "@/lib/supplier-edit";
import { supplierLedger, supplierPrices } from "@/lib/receipt-payables";
import { canRemoveSupplyDoc, deleteSupplyQuote, removeSupplyDocument } from "@/lib/procurement";
import { INCIDENT_LABEL } from "@/lib/procurement-const";
import { procurementReport } from "@/lib/procurement-report";
import { addProductStock } from "@/lib/product-stock";
import { saveInventoryCount, saveStockWriteOff } from "@/lib/stock-adjust";
import { DIRECTOR_NOTIFY_SUM, WRITE_OFF_REASONS } from "@/lib/stock-adjust-const";
import { issuePrices } from "@/lib/stock-price";
import { STOCK_EPS } from "@/lib/stock-lock";
import type { MobileUser } from "./auth";
import type { ActionResult } from "./actions";
import type { CreateForm, CreateResult } from "./create";
import type { DetailAction, DetailField, FormField, FormOption, MobileDetail } from "./detail";
import { can } from "./detail";
import type { HomeCard, HomeRow, HomeSection, Tone } from "./home";
import { ListError, SKLAD_PERIODS, listAllowed, skladPeriod, type ListFilter, type MobileList, type SkladPeriod, type SkladPeriodKey } from "./list";
import { procRange, type DashRange } from "./dashboard";
import { brigStockDetail } from "./brigadier";
import { SKLAD_DETAIL_ROLES } from "./sklad-extra-access";

/**
 * Sklad / snabjeniye kabinetining veb → mobil parity qismi (ruxsat jadvallari — `./sklad-extra-access.ts`):
 *  · ro'yxatlar: «Tayyor mahsulot» (`products`), «Ishlab chiqarish imkoni» (`capacity`), «Brigadalar skladi» (`brig-stock`),
 *    «Oluvchilar» (`recipients`); sklad jurnallaridagi sklad filtri (`parseSkladFilter`, `skladJournalFilters`);
 *  · kartochkalar: tayyor mahsulot, imkoniyat, oluvchi (`oluvchi`: `e~<xodim>` / `r~<oluvchi>`, brigada — `brig-stock`),
 *    ta'minot hujjati (`supply-doc`, surat — `/api/mobile/supply-doc`);
 *  · amallar: kirim / chiqim stornosi, brigadaga berish va qaytarish, «Kimga» oluvchisi, «Dona narxi» (olib tashlash,
 *    o'rtachadan to'ldirish), xomashyoni o'chirish, yetkazuvchi rekvizitlari, ta'minot taklifi va hujjatini o'chirish;
 *  · formalar: tayyor mahsulot qo'shish, inventarizatsiya, hisobdan chiqarish, yangi oluvchi; Kirim formasidagi qo'shimcha maydonlar;
 *  · Snabjeniye hisoboti (dashboard kartasi).
 * Biznes qoidalari takrorlanmaydi — veb bilan bir xil `lib/*` funksiyalari chaqiriladi.
 */

const sum = (n: unknown) => Number(n ?? 0);
const money = (n: number) => `${fmtNum(Math.round(n), 0)} so'm`;
const qtyU = (q: number, unit: string) => `${fmtNum(q, 3)} ${unitShort(unit)}`;
const pq = (q: number, unit: string) => `${fmtNum(q, 3)} ${unitLabel(unit)}`;
const f = (label: string, value: string, tone?: Tone): DetailField => ({ label, value, ...(tone ? { tone } : {}) });
const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
const forbid = (): never => { throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403); };
const textOf = (p: Record<string, unknown>, key: string) => String(p[key] ?? "").trim();
const numOf = (p: Record<string, unknown>, key: string) => {
  const t = textOf(p, key).replace(/\s+/g, "").replace(",", ".");
  if (!t) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
/** Ro'yxat qatori id'sidagi `~` dan keyingi qism — faqat React kaliti (`detail.ts` `baseId` bilan bir qoida). */
const baseId = (id: string) => id.split("~")[0];
const TAKE = 60;

/** Faol skladlar — asosiysi birinchi. */
const activeWarehouses = () => db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } });

/** Direktor modulni "yo'q" qilgan bo'lsa (`moduleClosed` ishlatilmaydigan kalitlar uchun — `brig-stock`). */
const stockClosed = (user: MobileUser) => user.role !== "DIRECTOR" && user.perms?.stock === "none";

// ───────────────────────── Sklad jurnallari: sklad filtri ─────────────────────────

/** Filtr kaliti: `<davr>` yoki `<davr>|<skladId>` («Kirim», «Chiqim», «Qoldiqlar» va «Qoldiqlar» jami kartochkasi id'si). */
export const WH_SEP = "|";

export function parseSkladFilter(filter?: string | null): { period: SkladPeriod; warehouseId: string | null } {
  const [p, wh] = String(filter ?? "").split(WH_SEP);
  return { period: skladPeriod(p || null), warehouseId: wh?.trim() || null };
}

/**
 * Davr chiplari + (skladlar bir nechta bo'lsa) sklad chiplari — veb «Qoldiqlar» dagi sklad tanlovi bilan bir xil:
 * zames, berish va spisanie AYNAN tanlangan skladdan yechiladi. Noma'lum sklad id'si — «Barcha skladlar».
 */
export async function skladJournalFilters(period: SkladPeriodKey, warehouseId: string | null): Promise<{ filters: ListFilter[]; warehouse: { id: string; name: string } | null }> {
  const ws = await db.warehouse.findMany({
    where: { OR: [{ isActive: true }, ...(warehouseId ? [{ id: warehouseId }] : [])] },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true },
  });
  const wh = ws.find((w) => w.id === warehouseId) ?? null;
  const suffix = wh ? `${WH_SEP}${wh.id}` : "";
  const periods: ListFilter[] = SKLAD_PERIODS.map((p) => ({ key: `${p.key}${suffix}`, label: p.label, active: p.key === period }));
  if (ws.length < 2) return { filters: periods, warehouse: wh };
  return {
    filters: [...periods, { key: period, label: "Barcha skladlar", active: !wh }, ...ws.map((w) => ({ key: `${period}${WH_SEP}${w.id}`, label: w.name, active: w.id === wh?.id }))],
    warehouse: wh,
  };
}

// ───────────────────────── Ro'yxatlar ─────────────────────────

export async function skladList(user: MobileUser, key: string, title: string, q?: string, filter?: string): Promise<MobileList> {
  switch (key) {
    case "products": return productsList(title, q, filter);
    case "capacity": return capacityList(title, q, filter);
    case "brig-stock": return brigStockList(user, title, q);
    case "recipients": return recipientsList(title, q, filter);
    default: throw new ListError("UNKNOWN_LIST", "Bunday ro'yxat yo'q", 404);
  }
}

/** «Tayyor mahsulot» — hovlidagi dona mahsulot: jami / band (egasi bor) / erkin (`lib/ostatka.ts`, veb «Ishlab chiqarish imkoni»). */
async function productsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const s = q?.toLowerCase();
  const all = (await ostatkaSummary()).filter((p) => !s || p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s));
  const tabs = [
    { key: "all", label: "Hammasi", test: () => true },
    { key: "free", label: "Erkin bor", test: (p: (typeof all)[number]) => p.free > STOCK_EPS },
    { key: "short", label: "Yetishmaydi", test: (p: (typeof all)[number]) => p.shortage > STOCK_EPS },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const tot = all.reduce((a, p) => ({ free: a.free + p.free, owned: a.owned + p.owned }), { free: 0, owned: 0 });
  return {
    key: "products",
    title: all.length ? `${title} · erkin ${fmtNum(tot.free, 0)} · band ${fmtNum(tot.owned, 0)}` : title,
    rows: all.filter(tab.test).slice(0, TAKE).map((p): HomeRow => ({
      id: p.id,
      title: p.name,
      subtitle: `${p.code} · erkin ${fmtNum(p.free, 3)} · band ${fmtNum(p.owned, 3)}`,
      right: pq(p.total, p.unit),
      ...(p.shortage > STOCK_EPS ? { status: `${fmtNum(p.shortage, 3)} yetishmaydi`, tone: "danger" as Tone }
        : p.free > STOCK_EPS ? { status: "Erkin bor", tone: "success" as Tone }
        : p.total > STOCK_EPS ? { status: "Hammasi band", tone: "info" as Tone }
        : { status: "Bo'sh", tone: "info" as Tone }),
    })),
    filters: tabs.map((t) => ({ key: t.key, label: t.label, count: all.filter(t.test).length, active: t.key === tab.key })),
  };
}

type Cap = Awaited<ReturnType<typeof productionCapacity>>[number];
const capOk = (c: Cap) => (c.remaining <= 0 ? c.canMake > 0 : c.canMake >= c.remaining);

/** «Ishlab chiqarish imkoni» — hozirgi xomashyo qoldig'i bilan har mahsulotdan qancha chiqadi (`lib/production-capacity.ts`). */
async function capacityList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const s = q?.toLowerCase();
  const all = (await productionCapacity()).filter((c) => !s || c.product.toLowerCase().includes(s));
  const tabs = [
    { key: "all", label: "Hammasi", test: () => true },
    { key: "short", label: "Zayavkaga yetmaydi", test: (c: Cap) => c.canMake > 0 && !capOk(c) },
    { key: "none", label: "Xomashyo yo'q", test: (c: Cap) => c.canMake <= 0 },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  return {
    key: "capacity", title,
    rows: all.filter(tab.test).slice(0, TAKE).map((c): HomeRow => ({
      id: c.productId,
      title: `${c.product} · v${c.version}`,
      subtitle: [
        c.limiting ? `cheklovchi: ${c.limiting.name} (qoldiq ${fmtNum(c.limiting.balance, 3)} ${c.limiting.unit})` : null,
        c.remaining > 0 ? `zayavkalarga ${pq(c.remaining, c.unit)}` : null,
      ].filter(Boolean).join(" · ") || undefined,
      right: pq(c.canMake, c.unit),
      status: c.canMake <= 0 ? "Xomashyo yo'q" : capOk(c) ? "Yetarli" : "Zayavkaga yetmaydi",
      tone: c.canMake <= 0 ? "danger" : capOk(c) ? "success" : "warning",
    })),
    filters: tabs.map((t) => ({ key: t.key, label: t.label, count: all.filter(t.test).length, active: t.key === tab.key })),
  };
}

/** «Brigadalar skladi» — har brigada qo'lidagi xomashyo va qiymati (veb Sklad → «Brigadalarga berish»); kartochka — `brig-stock`. */
async function brigStockList(user: MobileUser, title: string, q?: string): Promise<MobileList> {
  if (stockClosed(user)) forbid();
  const s = q?.toLowerCase();
  const [list, undistributed] = await Promise.all([brigadeStocks(), undistributedMaterials()]);
  const rows = list.filter((b) => !s || b.name.toLowerCase().includes(s) || (b.leader ?? "").toLowerCase().includes(s));
  return {
    key: "brig-stock",
    // Kelgan, lekin hali birorta brigadaga berilmagan xomashyo — vebdagi sarlavha ogohlantirishi
    title: undistributed.count ? `${title} · ${undistributed.count} ta mahsulot berilmagan` : title,
    rows: rows.slice(0, TAKE).map((b): HomeRow => {
      const minus = b.materials.some((m) => m.qty < 0);
      return {
        id: b.id,
        title: b.name,
        subtitle: `${b.leader ?? "brigadirsiz"} · ${b.materials.length} xomashyo · ochiq ish ${fmtNum(b.openQty, 3)}`,
        right: money(b.value),
        ...(minus ? { status: "Minus qoldiq", tone: "danger" as Tone } : b.materials.length ? { tone: "success" as Tone } : { status: "Bo'sh", tone: "info" as Tone }),
      };
    }),
  };
}

/** «Oluvchilar (Kimga)» — erkin oluvchilar ro'yxati (nofaollari ham), kartochka — `oluvchi` (`r~<id>`). */
async function recipientsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const s = q?.toLowerCase();
  const all = (await recipientList()).filter((r) => !s || r.name.toLowerCase().includes(s) || (r.note ?? "").toLowerCase().includes(s));
  const tabs = [
    { key: "active", label: "Faol", test: (r: (typeof all)[number]) => r.isActive },
    { key: "inactive", label: "Nofaol", test: (r: (typeof all)[number]) => !r.isActive },
    { key: "all", label: "Hammasi", test: () => true },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  return {
    key: "recipients", title,
    rows: all.filter(tab.test).slice(0, TAKE).map((r): HomeRow => ({
      id: `r~${r.id}`, title: r.name,
      subtitle: [r.note, `${r.moves} ta chiqim qatori`].filter(Boolean).join(" · "),
      ...(r.isActive ? {} : { status: "Nofaol", tone: "info" as Tone }),
    })),
    filters: tabs.map((t) => ({ key: t.key, label: t.label, count: all.filter(t.test).length, active: t.key === tab.key })),
  };
}

// ───────────────────────── Kartochkalar ─────────────────────────

export async function skladDetail(user: MobileUser, card: string, id: string): Promise<MobileDetail> {
  switch (card) {
    case "products": return productCard(baseId(id));
    case "capacity": return capacityCard(baseId(id));
    case "oluvchi": return oluvchiCard(user, id);
    case "supply-doc": return supplyDocCard(user, baseId(id));
    default: throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  }
}

const MOVE_LABEL: Record<string, string> = { PRODUCTION_OUTPUT: "Ishlab chiqarildi", SHIPMENT: "Jo'natildi", ADJUSTMENT: "Qo'lda qo'shildi", WRITE_OFF: "Hisobdan chiqarildi" };
const ORDER_LABEL: Record<string, string> = { CONFIRMED: "Tasdiqlangan", IN_PRODUCTION: "Ishlab chiqarilmoqda" };

/** Tayyor mahsulot kartochkasi — kimga band, partiyalar, harakat tarixi (veb `/stock/products/[productId]`). */
async function productCard(productId: string): Promise<MobileDetail> {
  const d = await ostatkaDetail(productId);
  if (!d) throw new ListError("NOT_FOUND", "Mahsulot topilmadi", 404);
  const u = d.product.unit;
  return {
    key: "products", id: productId, title: d.product.name, subtitle: `${d.product.code} · birlik: ${unitLabel(u)}`,
    ...(d.shortage > STOCK_EPS ? { status: "Yetishmaydi" } : {}),
    fields: [
      f("Jami tayyor", pq(d.total, u)),
      f("Egasi bor (band)", `${pq(d.owned, u)} · ${d.owners.length} ta zayavka`, d.owned > 0 ? "info" : undefined),
      f("Egasi yo'q (erkin)", pq(d.free, u), d.free > 0 ? "success" : undefined),
      f("Yetishmaydi", pq(d.shortage, u), d.shortage > STOCK_EPS ? "danger" : "success"),
      ...(d.shortage > STOCK_EPS ? [f("Diqqat", `Band qilingan miqdor qoldiqdan ${pq(d.shortage, u)} ko'p — ishlab chiqarish rejalashtiring`, "danger")] : []),
    ],
    sections: [
      {
        title: "Kimniki (band qilingan)", empty: "Band qilingan zayavka yo'q — hammasi erkin", target: "orders", icon: "users",
        rows: d.owners.map((o) => ({
          id: o.orderId, title: o.customer,
          subtitle: `yetkazish ${dateRu(o.deliveryDate)} · buyurtma ${fmtNum(o.qty, 3)} · jo'natildi ${fmtNum(o.shipped, 3)}${o.phone ? ` · ${o.phone}` : ""}`,
          right: `band ${pq(o.reserved, u)}`, status: ORDER_LABEL[o.status] ?? o.status, tone: "brand" as Tone,
        })),
      },
      {
        title: "Ishlab chiqarilgan partiyalar", empty: "Hali ishlab chiqarilmagan", target: "production", icon: "factory",
        rows: d.batches.map((b) => ({
          id: b.id, title: b.batchNo,
          subtitle: `${dateRu(b.date)} · ${b.order ? b.order.customer.name : "sklad uchun"} · ${b.createdBy.fullName}`,
          right: pq(sum(b.qtyM3), u), ...(b.cancelledAt ? { status: "Bekor qilingan", tone: "danger" as Tone } : {}),
        })),
      },
      {
        title: "Harakat tarixi", empty: "Harakat yo'q", icon: "clock",
        rows: d.moves.map((m) => ({
          id: m.id, title: MOVE_LABEL[m.type] ?? m.type, subtitle: `${dateRu(m.createdAt)} · ${m.createdBy.fullName}${m.note ? ` · ${m.note}` : ""}`,
          right: `${sum(m.qty) > 0 ? "+" : ""}${fmtNum(sum(m.qty), 3)}`, tone: (sum(m.qty) < 0 ? "danger" : "success") as Tone,
        })),
      },
    ],
    actions: [],
  };
}

/** «Ishlab chiqarish imkoni» — bitta mahsulot: retsept tarkibi, har ingredient qoldig'i va zayavkalar uchun yetishmagani. */
async function capacityCard(productId: string): Promise<MobileDetail> {
  const c = (await productionCapacity()).find((x) => x.productId === productId);
  if (!c) throw new ListError("NOT_FOUND", "Faol retseptli mahsulot topilmadi", 404);
  const ok = capOk(c);
  return {
    key: "capacity", id: productId, title: c.product, subtitle: `Retsept v${c.version}`,
    status: c.canMake <= 0 ? "Xomashyo yo'q" : ok ? "Yetarli" : "Zayavkaga yetmaydi",
    fields: [
      f("Hozir ishlab chiqarish mumkin", pq(c.canMake, c.unit), c.canMake <= 0 ? "danger" : ok ? "success" : "warning"),
      f("Zayavkalar ehtiyoji", c.remaining > 0 ? pq(c.remaining, c.unit) : "—"),
      f("Cheklovchi ingredient", c.limiting ? `${c.limiting.name} · qoldiq ${fmtNum(c.limiting.balance, 3)} ${c.limiting.unit}, norma ${fmtNum(c.limiting.perUnit, 3)}/${unitLabel(c.unit)}` : "—"),
    ],
    sections: [{
      title: `Tarkib — 1 ${unitLabel(c.unit)} uchun`, empty: "Retsept bo'sh", icon: "layers",
      rows: c.items.map((i, n) => ({
        id: `i${n}`, title: i.name,
        subtitle: `norma ${fmtNum(i.perUnit, 3)} ${i.unit} · ${Number.isFinite(i.enoughFor) ? `${fmtNum(i.enoughFor, 2)} ${unitLabel(c.unit)} ga yetadi` : "cheklamaydi"}${i.short > 0 ? ` · zayavkalarga ${fmtNum(c.remaining * i.perUnit, 3)} kerak` : ""}`,
        right: `${fmtNum(i.balance, 3)} ${i.unit}`,
        ...(i.short > 0 ? { status: `${fmtNum(i.short, 3)} yetmaydi`, tone: "danger" as Tone } : {}),
      })),
    }],
    actions: [],
  };
}

/** Oluvchi kartasi id'si: `b~<brigada>` | `e~<xodim>` | `r~<oluvchi>` (keyingi `~n` — ro'yxat kaliti). */
function parseOluvchi(id: string): { kind: "b" | "e" | "r"; id: string } | null {
  const [k, x] = id.split("~");
  return k && x && isCardKind(k) ? { kind: k, id: x } : null;
}

/**
 * Oluvchi kartasi (veb `/oluvchi/[kind]/[id]`, `lib/recipient-card.ts`): xodim yoki erkin oluvchi skladdan nima va qancha pulga olgan
 * (joriy oy va barcha vaqt), tovar bo'yicha, chiqim tarixi. Brigada — `brig-stock` kartochkasi (qo'lidagi xomashyo, samaradorlik,
 * berish / qaytarish tugmalari). Erkin oluvchida — nomini tahrirlash va faol/nofaol (`stock` → `issue`).
 */
async function oluvchiCard(user: MobileUser, rawId: string): Promise<MobileDetail> {
  const k = parseOluvchi(rawId);
  if (!k) throw new ListError("NOT_FOUND", "Oluvchi topilmadi", 404);
  if (k.kind === "b") return brigStockDetail(user, k.id);
  const period = skladPeriod("month");
  const c = await recipientCard(k.kind, k.id, period);
  if (!c) throw new ListError("NOT_FOUND", "Oluvchi topilmadi", 404);
  const seeDocs = listAllowed(user, "rasxod");
  const fields: DetailField[] = [
    f("Turi", k.kind === "e" ? "Xodim" : "Erkin oluvchi (Kimga)"),
    ...(c.employee ? [f("Lavozim", c.employee.position), ...(c.employee.brigade ? [f("Brigada", c.employee.brigade)] : [])] : []),
    ...(c.recipient?.note ? [f("Izoh", c.recipient.note)] : []),
    f("Holat", c.isActive ? "Faol" : k.kind === "e" ? "Ishdan bo'shagan" : "Nofaol", c.isActive ? "success" : "warning"),
    f(`Berilgan (${period.label})`, `${money(c.totals.sum)} · ${c.totals.count} qator`, c.totals.sum > 0 ? "brand" : undefined),
    f("Berilgan (barcha vaqt)", `${money(c.allTime.sum)} · ${c.allTime.docs} chiqim`),
    ...(c.allTime.firstAt ? [f("Birinchi / oxirgi berish", `${dateRu(c.allTime.firstAt)} — ${c.allTime.lastAt ? dateRu(c.allTime.lastAt) : "—"}`)] : []),
  ];
  const sections: HomeSection[] = [
    {
      title: `Davrda olingan tovarlar (${period.label})`, empty: "Bu davrda skladdan olinmagan", target: "stock", icon: "package",
      rows: c.byMaterial.map((m) => ({ id: m.materialId, title: m.name, subtitle: `${m.docs} chiqim · oxirgisi ${dateRu(m.lastAt)}`, right: `${qtyU(m.qty, m.unit)} · ${money(m.sum)}` })),
    },
    {
      // Qator — chiqim hujjati (storno shu yerdan), «Chiqim» ochilmaydigan rolga — xomashyo kartochkasi
      title: "Oxirgi chiqimlar", empty: "Chiqim yo'q", target: "stock", icon: "circle-arrow-up",
      rows: c.rows.slice(-30).reverse().map((r, n) => ({
        id: seeDocs && r.ref ? `rasxod:${r.ref}~${n}` : `${r.materialId}~${n}`,
        title: r.material, subtitle: `${dateRu(r.date)}${r.note ? ` · ${r.note}` : ""}`, right: qtyU(r.qty, r.unit),
        ...(r.kind === "storno" ? { status: "Bekor qilish", tone: "danger" as Tone } : r.cancelled ? { status: "Bekor", tone: "danger" as Tone } : {}),
      })),
    },
    ...(c.employee?.leads.length ? [{
      title: "Brigadir", empty: "", target: "oluvchi", icon: "hard-hat",
      rows: c.employee.leads.map((b) => ({ id: `b~${b.id}`, title: b.name, subtitle: "Brigada skladi" })),
    }] : []),
  ];
  const actions: DetailAction[] = [];
  if (k.kind === "r") {
    const rec = await db.stockRecipient.findUnique({ where: { id: k.id }, select: { name: true, note: true, sortOrder: true, isActive: true } });
    if (rec && can(user, "recipient.edit")) {
      actions.push({
        id: "recipient.edit", label: "Tahrirlash", tone: "brand",
        form: [
          { name: "name", label: "Nomi", type: "text", required: true, value: rec.name },
          { name: "note", label: "Izoh", type: "text", value: rec.note ?? undefined },
          { name: "sortOrder", label: "Tartib raqami", type: "number", value: String(rec.sortOrder), hint: "«Kimga» ro'yxatidagi o'rni (kichigi tepada)" },
        ],
      });
    }
    if (rec && can(user, "recipient.toggle")) {
      actions.push(rec.isActive
        ? { id: "recipient.toggle", label: "«Kimga» ro'yxatidan yashirish", tone: "danger", confirm: `«${rec.name}» nofaol qilinsinmi? Chiqim formasida chiqmaydi, eski chiqimlarda nomi qoladi.` }
        : { id: "recipient.toggle", label: "Qayta faollashtirish", tone: "success" });
    }
  }
  return { key: "oluvchi", id: rawId, title: c.name, subtitle: c.subtitle ?? undefined, ...(c.isActive ? {} : { status: "Nofaol" }), fields, sections, actions };
}

/**
 * Brigada skladi kartochkasidagi (`brig-stock`, `./brigadier.ts`) tugmalar: skladdan brigadaga berish va ishlatilmaganini
 * skladga qaytarish — veb Sklad → «Brigadalarga berish» (`stock` → `brigade`, `lib/brigade-stock.ts`). Brigadirga chiqmaydi.
 */
export async function brigadeStockActions(user: MobileUser, brigadeId: string, hand: BrigadeMaterial[]): Promise<DetailAction[]> {
  const giveOk = can(user, "brigade.issue"), backOk = can(user, "brig.return");
  if (!giveOk && !backOk) return [];
  const [brigade, warehouses] = await Promise.all([db.brigade.findUnique({ where: { id: brigadeId }, select: { isActive: true } }), activeWarehouses()]);
  if (!brigade || !warehouses.length) return [];
  const whField = (hint?: string): FormField => ({ name: "warehouseId", label: "Sklad", type: "select", required: true, value: warehouses[0].id, options: warehouses.map((w) => ({ value: w.id, label: w.name })), ...(hint ? { hint } : {}) });
  const actions: DetailAction[] = [];
  if (giveOk && brigade.isActive) {
    const [mats, sums] = await Promise.all([
      db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
      db.stockMove.groupBy({ by: ["materialId", "warehouseId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    ]);
    const byWh = new Map<string, Map<string, number>>();
    for (const x of sums) {
      const m = byWh.get(x.materialId!) ?? new Map<string, number>();
      m.set(x.warehouseId, sum(x._sum.qty));
      byWh.set(x.materialId!, m);
    }
    const whName = new Map(warehouses.map((w) => [w.id, w.name]));
    const options: FormOption[] = mats.filter((m) => [...(byWh.get(m.id)?.values() ?? [])].some((v) => v > STOCK_EPS)).map((m) => {
      const per = [...(byWh.get(m.id) ?? new Map<string, number>())].filter(([w, v]) => v > STOCK_EPS && whName.has(w));
      const total = per.reduce((a, [, v]) => a + v, 0);
      return {
        value: m.id, label: `${m.name} — skladda ${qtyU(total, m.unit)}`,
        hint: warehouses.length > 1 ? per.map(([w, v]) => `${whName.get(w)}: ${fmtNum(v, 3)}`).join(" · ") : m.code,
      };
    });
    if (options.length) {
      actions.push({
        id: "brigade.issue", label: "Xomashyo berish", tone: "brand",
        form: [
          whField(warehouses.length > 1 ? "Xomashyo aynan shu skladdan beriladi" : undefined),
          {
            name: "items", label: "Xomashyo", type: "items", required: true,
            columns: [
              { name: "materialId", label: "Xomashyo", type: "select", required: true, options },
              { name: "qty", label: "Miqdor", type: "number", required: true, placeholder: "0" },
            ],
          },
          { name: "note", label: "Izoh", type: "text", placeholder: "ixtiyoriy" },
        ],
      });
    }
  }
  const held = hand.filter((m) => m.qty > STOCK_EPS);
  if (backOk && held.length) {
    actions.push({
      id: "brig.return", label: "Skladga qaytarish", tone: "warning",
      form: [
        { name: "materialId", label: "Xomashyo", type: "select", required: true, value: held[0].materialId, options: held.map((m) => ({ value: m.materialId, label: `${m.name} — qo'lida ${qtyU(m.qty, m.unit)}` })) },
        { name: "qty", label: "Qaytariladigan miqdor", type: "number", required: true, placeholder: "0", hint: "Ishlatilmagan xomashyo skladga qaytadi" },
        whField(),
      ],
    });
  }
  return actions;
}

/** Ta'minot hujjati (shartnoma, faktura, nakladnoy…) — rasm bo'lsa ilova o'zida ochadi (`/api/mobile/supply-doc`). */
async function supplyDocCard(user: MobileUser, docId: string): Promise<MobileDetail> {
  const d = await db.supplyDocument.findUnique({ where: { id: docId }, include: { request: { select: { id: true, docNo: true, status: true } }, createdBy: { select: { fullName: true } } } });
  if (!d) throw new ListError("NOT_FOUND", "Hujjat topilmadi", 404);
  const image = d.fileType.startsWith("image/");
  const actions: DetailAction[] = [];
  if (can(user, "supply.doc.drop")) {
    const okDrop = canRemoveSupplyDoc(d.request.status, user.role);
    actions.push({
      id: "supply.doc.drop", label: "Hujjatni o'chirish", tone: "danger",
      confirm: `«${d.kind}» (${d.fileName}) o'chirilsinmi? Fayl ham o'chadi, tarixda yozuv qoladi.`,
      ...(okDrop ? {} : { disabled: true, hint: "Qabul qilingan zayavka hujjatini faqat direktor o'chiradi" }),
    });
  }
  return {
    key: "supply-doc", id: d.id, title: d.kind, subtitle: d.request.docNo,
    fields: [
      f("Hujjat turi", d.kind),
      f("Fayl", d.fileName),
      f("Ta'minot zayavkasi", d.request.docNo),
      f("Kim biriktirdi", `${d.createdBy.fullName} · ${dateRu(d.createdAt)}`),
      ...(image ? [] : [f("Ko'rish", "PDF — ilovada ochilmaydi, saytda oching (Ta'minot → hujjat)", "info")]),
    ],
    sections: [{ title: "Ta'minot zayavkasi", empty: "", target: "supply", rows: [{ id: d.request.id, title: d.request.docNo, subtitle: "Zayavkani ochish" }] }],
    actions,
    ...(image ? { photo: { url: `/api/mobile/supply-doc?id=${d.id}`, title: d.kind } } : {}),
  };
}

// ───────────────────────── Mavjud kartochkalarga qo'shimchalar (`detail.ts` dan chaqiriladi) ─────────────────────────

/**
 * Kirim kartochkasi: to'langan summa (veb `/receipts/[id]` dagidek, bog'langan chiqimlar) va «Storno» —
 * faqat storno qilinmagan va ta'minotdan bo'lmagan kirimda (`stock` → `receipt_storno`, `lib/storno.ts`).
 */
export async function receiptExtra(user: MobileUser, r: { id: string; docNo: string; cancelledAt: Date | null }): Promise<{ fields: DetailField[]; actions: DetailAction[] }> {
  const [paid, supply] = await Promise.all([
    db.cashTransaction.aggregate({ where: { type: "EXPENSE", refType: "GoodsReceipt", refId: r.id, cancelledAt: null }, _sum: { amount: true } }),
    db.supplyRequest.findFirst({ where: { receiptId: r.id }, select: { id: true } }),
  ]);
  const paidSum = sum(paid._sum.amount);
  const actions: DetailAction[] = [];
  if (!r.cancelledAt && !supply && can(user, "receipt.storno")) {
    actions.push({
      id: "receipt.storno", label: "Bekor qilish", tone: "danger",
      confirm: paidSum > 0.005 ? `Kirimga ${money(paidSum)} to'lov bog'langan — avval to'lovni bekor qiling. Baribir urinib ko'rasizmi?` : `${r.docNo} bekor qilinsinmi? Xomashyo skladdan qaytariladi`,
      form: [{ name: "reason", label: "Bekor qilish sababi", type: "text", required: true, placeholder: "Nega bekor qilinmoqda" }],
    });
  }
  return { fields: [f("To'langan", paidSum > 0.005 ? money(paidSum) : "to'lanmagan", paidSum > 0.005 ? "success" : "warning")], actions };
}

/** «Chiqim» (berish hujjati) kartochkasi: «Storno» (`stock` → `issue_storno`, `cancelIssue`) va oluvchi kartasiga havola. */
export function rasxodExtra(user: MobileUser, ref: string, cancelled: boolean, to: { recipientId: string | null; employeeId: string | null; brigadeId: string | null; name: string }): { sections: HomeSection[]; actions: DetailAction[] } {
  const actions: DetailAction[] = [];
  if (!cancelled && can(user, "rasxod.storno")) {
    actions.push({
      id: "rasxod.storno", label: "Bekor qilish", tone: "danger",
      confirm: "Chiqim bekor qilinsinmi? Barcha qatorlar skladga teskari yoziladi.",
      form: [{ name: "reason", label: "Bekor qilish sababi", type: "text", required: true, placeholder: "kamida 3 belgi" }],
    });
  }
  const card = to.brigadeId ? `b~${to.brigadeId}` : to.employeeId ? `e~${to.employeeId}` : to.recipientId ? `r~${to.recipientId}` : null;
  const sections: HomeSection[] = card && listAllowedCard(user, "oluvchi")
    ? [{ title: "Oluvchi", empty: "", target: "oluvchi", icon: "user", rows: [{ id: card, title: to.name, subtitle: "Oluvchi kartasi — nima va qancha olgan" }] }]
    : [];
  return { sections, actions };
}

/** Kartochka shu rolga ochiladimi (`SKLAD_DETAIL_ROLES` + direktor yopmagan `stock` moduli) — ochilmaydigan havola ko'rsatilmaydi. */
function listAllowedCard(user: MobileUser, card: "oluvchi"): boolean {
  if (user.role === "DIRECTOR") return true;
  return (SKLAD_DETAIL_ROLES[card] ?? []).includes(user.role) && user.perms?.stock !== "none";
}

/** Brigada kartochkasidan (`brigades`) uning skladiga (qo'lidagi xomashyo, berish/qaytarish) havola. */
export function brigadeStockLink(user: MobileUser, brigadeId: string): HomeSection[] {
  return listAllowedCard(user, "oluvchi")
    ? [{ title: "Sklad", empty: "", target: "oluvchi", icon: "warehouse", rows: [{ id: `b~${brigadeId}`, title: "Brigada skladi", subtitle: "Qo'lidagi xomashyo, berilgani, samaradorlik" }] }]
    : [];
}

/** Xomashyo kartochkasi: «Dona narxi» ni olib tashlash va xomashyoni o'chirish (ishlatilgan bo'lsa — arxiv). */
export function materialExtraActions(user: MobileUser, m: { name: string; unitPrice: unknown }): DetailAction[] {
  const actions: DetailAction[] = [];
  if (m.unitPrice != null && can(user, "material.price.clear")) {
    actions.push({ id: "material.price.clear", label: "Narxni olib tashlash", tone: "warning", confirm: "«Dona narxi» olib tashlansinmi? Chiqim o'rtacha tannarx bo'yicha baholanadi." });
  }
  if (can(user, "material.delete") && moduleWriteAllowed({ role: user.role, perms: user.perms ?? {} }, "stock", MATERIAL_CATALOG_ROLES) === true) {
    actions.push({ id: "material.delete", label: "Xomashyoni o'chirish", tone: "danger", confirm: `«${m.name}» o'chirilsinmi? Hujjatlarda ishlatilgan bo'lsa — o'chirilmaydi, ro'yxatdan olib tashlanadi (arxiv). Skladda qoldig'i bor bo'lsa — o'zgarmaydi.` });
  }
  return actions;
}

/** «Qoldiqlar» jami kartochkasi: narxi yo'q xomashyolarga o'rtacha tannarxni qo'yish (veb «narxsizlarga o'rtacha tannarx»). */
export function ostatkiExtraActions(user: MobileUser, noPrice: number): DetailAction[] {
  return noPrice > 0 && can(user, "material.price.fill")
    ? [{ id: "material.price.fill", label: `Narxsizlarga o'rtacha tannarx (${noPrice})`, tone: "brand", confirm: `Narxi belgilanmagan ${noPrice} ta xomashyoga o'rtacha tannarx «Dona narxi» qilib qo'yilsinmi?` }]
    : [];
}

/** Ta'minot kartochkasi: tijorat taklifini o'chirish (narx bosqichida, snabjeniye). */
export function supplyExtraActions(user: MobileUser, r: { status: string; quotes: { id: string; supplierName: string; amount: unknown; chosen: boolean }[] }): DetailAction[] {
  if ((r.status !== "NEW" && r.status !== "PRICED") || !r.quotes.length || !can(user, "supply.quote.drop")) return [];
  return [{
    id: "supply.quote.drop", label: "Taklifni o'chirish", tone: "danger",
    form: [{ name: "quoteId", label: "Taklif", type: "select", required: true, options: r.quotes.map((q) => ({ value: q.id, label: `${q.supplierName} · ${money(sum(q.amount))}${q.chosen ? " · tanlangan" : ""}` })) }],
  }];
}

/**
 * Yetkazuvchi kartochkasi: rekvizitlar, hisob-kitob (olingan mol / to'langan / qarz / avans), to'lanmagan kirimlar, narxlar tarixi
 * (veb `/suppliers/[id]`, `lib/receipt-payables.ts`) va «Rekvizitlar» tugmasi (`stock` → `suppliers`).
 */
export async function supplierExtra(user: MobileUser, supplierId: string): Promise<{ fields: DetailField[]; sections: HomeSection[]; actions: DetailAction[] }> {
  const [s, ledger, prices] = await Promise.all([
    db.supplier.findUnique({ where: { id: supplierId }, select: { name: true, inn: true, phone: true, address: true, contactPerson: true, vatPayer: true } }),
    supplierLedger(supplierId),
    supplierPrices(supplierId),
  ]);
  if (!s) return { fields: [], sections: [], actions: [] };
  const fields: DetailField[] = [
    f("QQS", s.vatPayer ? "QQS to'lovchisi" : "QQS to'lovchisi emas"),
    ...(s.address ? [f("Manzil", s.address)] : []),
    ...(s.contactPerson ? [f("Mas'ul shaxs", s.contactPerson)] : []),
    f("Jami to'langan", money(ledger.paid), "info"),
    f("Qarzimiz", `${money(ledger.debt)} · ${ledger.unpaid.length} ta kirim${ledger.opening > 0.005 ? ` + boshlang'ich ${money(ledger.opening)}` : ""}`, ledger.debt > 0.005 ? "danger" : "success"),
    ...(ledger.advance > 0.005 ? [f("Avans (mol kutilmoqda)", money(ledger.advance), "warning")] : []),
    ...(ledger.refundDue > 0.005 ? [f("Qaytarilishi kerak", `${money(ledger.refundDue)} · bekor qilingan ta'minot`, "danger")] : []),
  ];
  const sections: HomeSection[] = [
    ...(ledger.unpaid.length ? [{
      title: `To'lanmagan kirimlar · ${ledger.unpaid.length}`, empty: "", target: "receipts", icon: "receipt",
      rows: ledger.unpaid.map((r) => ({ id: r.id, title: r.docNo, subtitle: `${dateRu(r.date)} · ${r.lines} qator${r.paid > 0.005 ? ` · jami ${money(r.total)}, to'langan ${money(r.paid)}` : ""}`, right: money(r.left), tone: "danger" as Tone })),
    }] : []),
    {
      title: "Narxlar tarixi (oxirgi narx)", empty: "Bu yetkazuvchidan hali kirim yo'q", target: "stock", icon: "trending-up",
      rows: prices.slice(0, 30).map((p) => {
        const d = p.prev ? ((p.price - p.prev) / p.prev) * 100 : null;
        return {
          id: p.materialId, title: p.name,
          subtitle: `${dateRu(p.date)} · ${fmtNum(p.qty, 3)} ${unitLabel(p.unit)}${p.prev != null ? ` · oldin ${money(p.prev)}` : ""} · ${p.receipts} kirim`,
          right: `${money(p.price)} / ${unitShort(p.unit)}`,
          ...(d == null ? {} : { status: `${d > 0 ? "+" : ""}${d.toFixed(1)}%`, tone: (d > 0 ? "danger" : "success") as Tone }),
        };
      }),
    },
  ];
  const actions: DetailAction[] = [];
  if (can(user, "supplier.edit")) {
    actions.push({
      id: "supplier.edit", label: "Rekvizitlar", tone: "brand",
      form: [
        { name: "name", label: "Nomi", type: "text", required: true, value: s.name },
        { name: "inn", label: "INN", type: "text", value: s.inn ?? undefined, hint: "9 (STIR) yoki 14 (JSHSHIR) raqam" },
        { name: "phone", label: "Telefon", type: "text", value: s.phone ?? undefined },
        { name: "address", label: "Manzil", type: "text", value: s.address ?? undefined },
        { name: "contactPerson", label: "Mas'ul shaxs", type: "text", value: s.contactPerson ?? undefined },
        { name: "vatPayer", label: "QQS to'lovchisi", type: "switch", value: s.vatPayer ? "true" : "false", hint: "Yoqilgan bo'lsa kirimga 12% QQS qo'shiladi" },
      ],
    });
  }
  // ── Yetkazuvchiga to'lov amallari (moliya bo'limi): shu yerga qo'shiladi (`actions.push(...)`) ──
  return { fields, sections, actions };
}

// ───────────────────────── Amallar ─────────────────────────

const bool = (v: unknown) => v === true || v === "true" || v === "1" || v === "on";

export async function runSkladAction(user: MobileUser, action: string, rawId: string, payload: Record<string, unknown>): Promise<ActionResult> {
  const actor = { userId: user.id, role: user.role };
  const id = baseId(rawId);
  switch (action) {
    case "receipt.storno": {
      const r = await cancelReceipt(id, textOf(payload, "reason").slice(0, 300), user.id);
      if ("error" in r) fail(r.error);
      return { ok: true, message: (r as { note: string }).note };
    }
    case "rasxod.storno": {
      try {
        const r = await cancelIssue(id, textOf(payload, "reason"), actor);
        return { ok: true, message: `Chiqim bekor qilindi: ${r.count} qator` };
      } catch (e) {
        if (e instanceof IssueError) fail(e.message);
        throw e;
      }
    }
    case "brigade.issue": {
      const brigadeId = brigadeOf(rawId);
      const rows = (Array.isArray(payload.items) ? payload.items : []) as Record<string, unknown>[];
      const items: { materialId: string; qty: number }[] = [];
      for (const [i, x] of rows.entries()) {
        const materialId = textOf(x, "materialId");
        if (!materialId) continue;
        const qty = numOf(x, "qty");
        if (!(qty > 0)) fail(`${i + 1}-qator: miqdorni 0 dan katta kiriting`);
        items.push({ materialId, qty });
      }
      if (!items.length) fail("Kamida bitta xomashyo va miqdor kiriting");
      const r = await issueToBrigade({ brigadeId, warehouseId: textOf(payload, "warehouseId"), note: textOf(payload, "note") || null, rows: items }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Brigadaga berildi" };
    }
    case "brig.return": {
      const brigadeId = brigadeOf(rawId);
      const materialId = textOf(payload, "materialId");
      const qty = numOf(payload, "qty");
      if (!materialId || !(qty > 0)) fail("Xomashyo va miqdorni belgilang");
      const r = await returnFromBrigade({ brigadeId, warehouseId: textOf(payload, "warehouseId"), rows: [{ materialId, qty }], note: "Brigadadan qaytarildi" }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Skladga qaytarildi" };
    }
    case "recipient.edit": {
      const recId = recipientOf(rawId);
      const raw = textOf(payload, "sortOrder");
      const sortOrder = raw === "" ? null : numOf(payload, "sortOrder");
      if (sortOrder != null && !Number.isFinite(sortOrder)) fail("Tartib raqami son bo'lishi kerak");
      const r = await upsertRecipient({ id: recId, name: textOf(payload, "name"), note: textOf(payload, "note") || null, sortOrder }, user.id);
      if ("error" in r) fail(r.error);
      return { ok: true, message: "Saqlandi" };
    }
    case "recipient.toggle": {
      const recId = recipientOf(rawId);
      const cur = await db.stockRecipient.findUnique({ where: { id: recId }, select: { isActive: true } });
      if (!cur) fail("Oluvchi topilmadi", 404);
      const r = await setRecipientActive(recId, !cur!.isActive, user.id);
      if ("error" in r) fail(r.error);
      const name = (r as { name: string }).name;
      return { ok: true, message: cur!.isActive ? `«${name}» «Kimga» ro'yxatidan yashirildi` : `«${name}» yana faol` };
    }
    case "material.price.clear": {
      try {
        const r = await setMaterialPrice(id, null, actor);
        return { ok: true, message: r.changed ? "Narx olib tashlandi — chiqim o'rtacha tannarx bo'yicha" : "O'zgarish yo'q" };
      } catch (e) {
        if (e instanceof MaterialPriceError) fail(e.message);
        throw e;
      }
    }
    case "material.price.fill": {
      const r = await fillMissingPricesFromAvg(actor);
      if (!r.filled && !r.noCost) return { ok: true, message: "Barcha xomashyoda narx allaqachon bor" };
      const parts = [r.filled ? `O'rtacha tannarx bo'yicha narx qo'yildi: ${r.filled} ta xomashyo` : "Narxlar o'zgarmadi"];
      if (r.noCost) parts.push(`tannarxsiz (kirim bo'lmagan): ${r.noCost} ta xomashyo — narxni qo'lda kiriting`);
      return { ok: true, message: parts.join(" · ") };
    }
    case "material.delete": {
      // Veb `deleteCatalogMaterial` bilan bir xil: `requireModuleWrite("stock", MATERIAL_CATALOG_ROLES)`
      if (moduleWriteAllowed({ role: user.role, perms: user.perms ?? {} }, "stock", MATERIAL_CATALOG_ROLES) !== true) fail("Bu amalga ruxsatingiz yo'q", 403);
      const r = await removeMaterial(id, actor);
      if (r.kind === "missing") fail("Xomashyo topilmadi", 404);
      if (r.kind === "deleted") return { ok: true, message: `«${r.name}» o'chirildi${r.opening ? " (boshlang'ich qoldig'i bilan)" : ""}.` };
      if (r.kind === "kept") fail(`«${r.name}» o'chirilmadi: ${r.why}`);
      const a = r as { name: string; why: string };
      return { ok: true, message: `«${a.name}» o'chirilmadi — ${a.why}. Ro'yxatdan olib tashlandi (hujjatlar joyida).` };
    }
    case "supplier.edit": {
      const opt = (k: string) => textOf(payload, k) || null;
      const r = await updateSupplierRequisites(id, {
        name: textOf(payload, "name"), inn: opt("inn"), phone: opt("phone"), address: opt("address"), contactPerson: opt("contactPerson"),
        vatPayer: payload.vatPayer == null || payload.vatPayer === "" ? null : bool(payload.vatPayer),
      }, user.id);
      if ("error" in r) fail(r.error);
      return { ok: true, message: (r as { note: string }).note };
    }
    case "supply.quote.drop": {
      const quoteId = textOf(payload, "quoteId");
      const q = quoteId ? await db.supplyQuote.findUnique({ where: { id: quoteId }, select: { requestId: true } }) : null;
      if (!q || q.requestId !== id) fail("Taklifni tanlang");
      const r = await deleteSupplyQuote(quoteId, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Taklif o'chirildi" };
    }
    case "supply.doc.drop": {
      const r = await removeSupplyDocument(id, user.id, user.role);
      if (r.error) fail(r.error);
      return { ok: true, message: r.note ?? "Hujjat o'chirildi" };
    }
    default:
      return fail("Bunday amal yo'q", 404);
  }
}

/** Brigada amali id'si: `brig-stock` kartochkasida — brigada id, oluvchi kartasidan — `b~<id>`. */
function brigadeOf(rawId: string): string {
  const k = parseOluvchi(rawId);
  if (k && k.kind !== "b") fail("Brigada tanlanmagan");
  return k ? k.id : baseId(rawId);
}
function recipientOf(rawId: string): string {
  const k = parseOluvchi(rawId);
  if (!k || k.kind !== "r") fail("Oluvchi topilmadi", 404);
  return k!.id;
}

// ───────────────────────── Formalar ─────────────────────────

export async function skladForm(user: MobileUser, key: string): Promise<CreateForm> {
  switch (key) {
    case "products": return productsForm(user);
    case "inventory": return inventoryForm();
    case "writeoff": return writeoffForm();
    case "recipient": return recipientForm();
    default: throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  }
}

const warehouseField = async (): Promise<FormField> => {
  const ws = await activeWarehouses();
  return { name: "warehouseId", label: "Sklad", type: "select", required: true, value: ws[0]?.id, options: ws.map((w) => ({ value: w.id, label: w.name })) };
};

/** «Tayyor mahsulot qo'shish» — veb `/stock/products/new`: dona mahsulot, sklad, miqdor (butun son), izoh. */
async function productsForm(user: MobileUser): Promise<CreateForm> {
  const [products, moved, warehouse] = await Promise.all([
    db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, unit: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _count: { _all: true } }),
    warehouseField(),
  ]);
  const hasMoves = new Set(moved.map((m) => m.productId));
  const director = user.role === "DIRECTOR";
  return {
    key: "products", title: "Tayyor mahsulot qo'shish", submitLabel: "Qo'shish",
    fields: [
      {
        name: "productId", label: "Mahsulot", type: "select", required: true,
        options: products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, hint: hasMoves.has(p.id) ? (director ? "harakati bor — direktor sifatida qo'shasiz" : "harakati bor — qo'lda qo'shib bo'lmaydi (faqat direktor)") : unitLabel(p.unit) })),
        hint: "Faqat hali harakati yo'q dona mahsulotga boshlang'ich qoldiq; ishlab chiqarilgani topshiriq orqali kirim bo'ladi",
      },
      warehouse,
      { name: "qty", label: "Miqdor (dona)", type: "number", required: true, placeholder: "0" },
      { name: "note", label: "Izoh", type: "text", placeholder: "Qo'lda qo'shildi" },
    ],
  };
}

/**
 * «Inventarizatsiya» — veb `/stock/inventarizatsiya`: qator — xomashyo (yorlig'ida hisobdagi qoldiq), haqiqiy (sanalgan) miqdor.
 * Tanlov qiymatida sklad va forma ochilgandagi hisobdagi qoldiq turadi (`<sklad>|<xomashyo>|<qoldiq>`): saqlashda qoldiq
 * o'zgargan bo'lsa yozilmaydi (veb bilan bir qoida — `saveInventoryCount`).
 */
async function inventoryForm(): Promise<CreateForm> {
  const [warehouses, materials, sums] = await Promise.all([
    activeWarehouses(),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
    db.stockMove.groupBy({ by: ["materialId", "warehouseId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  const bal = new Map(sums.map((x) => [`${x.warehouseId}|${x.materialId}`, Math.round(sum(x._sum.qty) * 1000) / 1000]));
  const many = warehouses.length > 1;
  const options: FormOption[] = warehouses.flatMap((w) => materials.map((m) => {
    const book = bal.get(`${w.id}|${m.id}`) ?? 0;
    return { value: `${w.id}|${m.id}|${book}`, label: `${m.name} · hisobda ${qtyU(book, m.unit)}${many ? ` · ${w.name}` : ""}`, hint: m.code };
  }));
  return {
    key: "inventory", title: "Inventarizatsiya", submitLabel: "Farqni yozish",
    fields: [
      {
        name: "items", label: "Sanalgan xomashyo", type: "items", required: true,
        columns: [
          { name: "materialId", label: "Xomashyo (hisobdagi qoldiq)", type: "select", required: true, options },
          { name: "actual", label: "Haqiqiy (sanalgan) miqdor", type: "number", required: true, placeholder: "0" },
        ],
      },
      { name: "reason", label: "Farq sababi", type: "text", required: true, placeholder: "Oylik sanoq, tarozi xatosi…", hint: `Faqat sanagan qatorlaringizni kiriting. Farq summasi ${money(DIRECTOR_NOTIFY_SUM)} dan oshsa — direktorga xabar ketadi` },
    ],
  };
}

/** «Hisobdan chiqarish» — veb `/stock/spisanie`: sklad, sabab, izoh, xomashyo va miqdor (qoldiqdan oshmaydi). */
async function writeoffForm(): Promise<CreateForm> {
  const [warehouse, materials, sums] = await Promise.all([
    warehouseField(),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  const bal = new Map(sums.map((x) => [x.materialId!, sum(x._sum.qty)]));
  const inStock = materials.filter((m) => (bal.get(m.id) ?? 0) > STOCK_EPS);
  const prices = await issuePrices(inStock.map((m) => m.id));
  return {
    key: "writeoff", title: "Hisobdan chiqarish", submitLabel: "Hisobdan chiqarish",
    fields: [
      warehouse,
      { name: "kind", label: "Sabab", type: "select", required: true, value: WRITE_OFF_REASONS[0], options: WRITE_OFF_REASONS.map((r) => ({ value: r, label: r })) },
      { name: "note", label: "Izoh", type: "text", required: true, placeholder: "Nima bo'ldi, kim aniqladi" },
      {
        name: "items", label: "Xomashyo", type: "items", required: true,
        columns: [
          {
            name: "materialId", label: "Xomashyo", type: "select", required: true,
            options: inStock.map((m) => {
              const p = prices.get(m.id);
              return { value: m.id, label: `${m.name} — qoldiq ${qtyU(bal.get(m.id) ?? 0, m.unit)}`, hint: `${m.code}${p != null ? ` · ${fmtNum(p, 2)} so'm` : " · narxsiz"}` };
            }),
          },
          { name: "qty", label: "Miqdor", type: "number", required: true, placeholder: "0" },
        ],
      },
    ],
  };
}

/** «Kimga» ro'yxatiga yangi oluvchi (shafyorlar, svarchiklar…) — veb Sklad → Chiqim → Oluvchilar. */
async function recipientForm(): Promise<CreateForm> {
  return {
    key: "recipient", title: "Yangi oluvchi (Kimga)", submitLabel: "Qo'shish",
    fields: [
      { name: "name", label: "Nomi", type: "text", required: true, placeholder: "Shafyorlar, Traktor…" },
      { name: "note", label: "Izoh", type: "text" },
      { name: "sortOrder", label: "Tartib raqami", type: "number", hint: "Bo'sh — ro'yxat oxiriga" },
    ],
  };
}

const DUP_WINDOW_MS = 3 * 60_000;
const rowsOf = (p: Record<string, unknown>) => (Array.isArray(p.items) ? p.items : []) as Record<string, unknown>[];

export async function skladCreate(user: MobileUser, key: string, raw: unknown): Promise<CreateResult> {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const actor = { userId: user.id, role: user.role };
  switch (key) {
    case "products": {
      const productId = textOf(p, "productId"), warehouseId = textOf(p, "warehouseId");
      const qty = numOf(p, "qty");
      if (!Number.isFinite(qty)) throw new Error("Miqdorni kiriting");
      const note = textOf(p, "note") || null;
      // Ilova bu formada bir martalik kalit yubormaydi — tarmoq qayta yuborsa (3 daqiqa ichida aynan shunday yozuv) ikkinchisi yozilmaydi
      const dup = await db.stockMove.findFirst({
        where: { createdById: user.id, createdAt: { gte: new Date(Date.now() - DUP_WINDOW_MS) }, type: "ADJUSTMENT", refType: "Manual", productId, warehouseId, qty, note: note ?? "Qo'lda qo'shildi" },
        select: { id: true },
      });
      if (dup) return { key: "products", id: productId, message: "Xuddi shunday qo'shish hozirgina saqlangan — qayta yozilmadi" };
      const r = await addProductStock({ productId, warehouseId, qty, note }, actor);
      if ("error" in r) throw new Error(r.error);
      return { key: "products", id: r.productId, message: "Tayyor mahsulot qoldig'i qo'shildi" };
    }
    case "inventory": {
      let wh: string | null = null;
      const rows: { materialId: string; book: number; actual: number }[] = [];
      for (const [i, x] of rowsOf(p).entries()) {
        const v = textOf(x, "materialId");
        if (!v) continue;
        const [w, materialId, book] = v.split("|");
        if (!w || !materialId || book == null) throw new Error(`${i + 1}-qator: xomashyoni qayta tanlang`);
        if (wh && wh !== w) throw new Error("Bitta sanoqda bitta sklad — boshqa sklad xomashyosini alohida kiriting");
        wh = w;
        const actual = numOf(x, "actual");
        if (!Number.isFinite(actual)) throw new Error(`${i + 1}-qator: haqiqiy miqdorni kiriting`);
        rows.push({ materialId, book: Number(book), actual });
      }
      if (!wh) throw new Error("Kamida bitta xomashyoning haqiqiy qoldig'ini kiriting");
      const r = await saveInventoryCount({ warehouseId: wh, reason: textOf(p, "reason"), rows }, user.id);
      if ("error" in r) throw new Error(r.error);
      return { key: "stock", id: rows[0].materialId, message: r.note };
    }
    case "writeoff": {
      const rows = rowsOf(p).map((x) => ({ materialId: textOf(x, "materialId"), qty: numOf(x, "qty") })).filter((x) => x.materialId);
      if (rows.some((x) => !Number.isFinite(x.qty))) throw new Error("Miqdor 0 dan katta raqam bo'lsin");
      const r = await saveStockWriteOff({ warehouseId: textOf(p, "warehouseId"), kind: textOf(p, "kind"), note: textOf(p, "note"), rows }, user.id);
      if ("error" in r) throw new Error(r.error);
      return { key: "stock", id: rows[0].materialId, message: r.note };
    }
    case "recipient": {
      const so = textOf(p, "sortOrder");
      const sortOrder = so === "" ? null : numOf(p, "sortOrder");
      if (sortOrder != null && !Number.isFinite(sortOrder)) throw new Error("Tartib raqami son bo'lishi kerak");
      const name = textOf(p, "name");
      const r = await upsertRecipient({ name, note: textOf(p, "note") || null, sortOrder }, user.id);
      if ("error" in r) throw new Error(r.error);
      const label = name.replace(/\s+/g, " ").trim();
      // `option` — «Chiqim» formasidagi «Kimga» tanlovi kaliti bilan bir xil (`r:<id>`)
      return { key: "oluvchi", id: `r~${r.id}`, message: "Oluvchi qo'shildi", option: { value: `r:${r.id}`, label: `Oluvchi: ${label}` } };
    }
    default:
      throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  }
}

/**
 * «Yangi kirim» formasining veb `prixod-form.tsx` dagi qo'shimcha maydonlari: qayerdan yuklandi, mashina, darhol kimga berildi
 * (avto chiqim) va — faqat direktorga — «Qaysi hisobdan to'landi» (darhol chiqim; `createGoodsReceipt` boshqa rolda e'tiborsiz).
 * «Ta'minotchi» (buyerId) vebda ham alohida maydon emas — Snabjeniye kiritsa o'zi yoziladi (`create.ts`).
 */
export async function prixodExtraFields(user: MobileUser, recipients: { id: string; name: string }[]): Promise<FormField[]> {
  const accounts = user.role === "DIRECTOR"
    ? await db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } })
    : [];
  return [
    { name: "loadedFrom", label: "Qayerdan yuklandi", type: "text", placeholder: "Zavod, bozor, sklad…" },
    { name: "carrier", label: "Mashina (kim olib keldi)", type: "text", placeholder: "Ta'minotchi o'zi / mashina raqami" },
    { name: "autoIssueToId", label: "Darhol kimga berildi (avto chiqim)", type: "select", options: recipients.map((r) => ({ value: r.id, label: r.name })), hint: "Tanlansa — kirim bilan birga shu oluvchiga chiqim yoziladi, mol skladda qolmaydi. Bo'sh — skladda qoladi" },
    ...(accounts.length ? [{
      name: "cashAccountId", label: "Qaysi hisobdan to'landi", type: "select" as const,
      options: accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.type === "CASH" ? "naqd kassa" : "bank"}` })),
      hint: "Tanlansa — shu zahoti chiqim yoziladi (naqd kirim — kassadan, bank o'tkazma — bankdan). Bo'sh — moliya to'laydi",
    }] : []),
  ];
}

// ───────────────────────── Snabjeniye hisoboti (dashboard kartasi) ─────────────────────────

/** Sklad va Snabjeniye dashboardidagi «Snabjeniye hisoboti» kartasi — qiymati yengil (davrda ochilgan talablar soni). */
export async function procReportTile(r: DashRange): Promise<HomeCard> {
  const requests = await db.supplyRequest.count({ where: { date: { gte: r.from, lt: r.to } } });
  return { key: "report", label: `Snabjeniye hisoboti (${r.label})`, value: `${requests} talab`, hint: "xarid, sarf, kechikish, yetkazuvchilar", tone: "info", icon: "file-text" };
}

/** «Snabjeniye hisoboti» batafsil — veb `/snabjeniye/hisobot` (`lib/procurement-report.ts`), davr — dashboard filtri. */
export async function procReportDetail(r: DashRange): Promise<Pick<MobileDetail, "title" | "subtitle" | "fields" | "sections">> {
  const d = await procurementReport(procRange(r));
  const t = d.totals;
  return {
    title: "Snabjeniye hisoboti", subtitle: `${dateRu(d.from)} — ${dateRu(d.to)}`,
    fields: [
      f("Xarid summasi", money(t.purchase), "brand"),
      f("Talablar", `${t.requests} ta · ${t.done} bajarildi · ${t.rejected} bekor`),
      f("O'rtacha yetkazish", t.avgLead == null ? "—" : `${fmtNum(t.avgLead, 1)} kun (talabdan kirimgacha)`, t.avgLead != null && t.avgLead > 5 ? "warning" : "success"),
      f("Kechikkan xaridlar", `${t.lateCount} ta`, t.lateCount ? "danger" : "success"),
      f("Muammolar", `${t.incidents} ta`, t.incidents ? "warning" : "success"),
    ],
    sections: [
      {
        title: "Yetkazib beruvchilar", empty: "Davrda xarid yo'q", target: "suppliers", icon: "store",
        rows: d.suppliers.slice(0, 30).map((s) => ({
          id: s.id, title: s.name,
          subtitle: [`${s.receipts} kirim`, s.orders ? `${s.orders} buyurtma` : null, s.avgLead != null ? `o'rtacha ${fmtNum(s.avgLead, 1)} kun` : null, s.late ? `${s.late} kechikish` : null, s.incidents ? `${s.incidents} muammo` : null].filter(Boolean).join(" · "),
          right: money(s.sum), ...(s.late ? { tone: "danger" as Tone } : {}),
        })),
      },
      {
        title: "Materiallar: xarid va sarf", empty: "Davrda harakat yo'q", target: "stock", icon: "layers",
        rows: d.materials.slice(0, 40).map((m) => ({
          id: m.id, title: m.name,
          subtitle: `sotib olindi ${m.qty ? `${fmtNum(m.qty, 3)} ${m.unit}` : "—"} · sarf ${m.used ? `${fmtNum(m.used, 3)} ${m.unit}` : "—"}${m.avgPrice != null ? ` · o'rtacha ${money(m.avgPrice)}` : ""}`,
          right: m.sum ? money(m.sum) : "—", ...(m.used > m.qty && m.qty > 0 ? { tone: "warning" as Tone } : {}),
        })),
      },
      {
        title: "Bo'limlar bo'yicha talablar", empty: "Talab yo'q", icon: "clipboard-list",
        rows: d.departments.map((x, i) => ({ id: `d${i}`, title: x.name, subtitle: `${x.done} bajarildi${x.critical ? ` · ${x.critical} kritik` : ""}`, right: `${x.count} ta` })),
      },
      {
        title: "Muammolar turi bo'yicha", empty: "Muammo yo'q", icon: "triangle-alert",
        rows: d.incidents.map((x) => ({ id: x.kind, title: INCIDENT_LABEL[x.kind], subtitle: x.open ? `${x.open} ochiq` : "hammasi yopilgan", right: `${x.total} ta`, ...(x.open ? { tone: "danger" as Tone } : {}) })),
      },
      {
        title: "Eng ko'p kechikkanlar", empty: "Kechikish yo'q", target: "supply", icon: "clock",
        rows: d.late.map((x) => ({ id: x.id, title: x.docNo, subtitle: x.supplier, right: `${x.late} kun`, tone: "danger" as Tone })),
      },
    ],
  };
}
