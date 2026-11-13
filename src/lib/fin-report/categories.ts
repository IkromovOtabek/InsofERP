import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { CashCategoryNeeds, CashFlowKind, CashTxType, LoanPart, PnlLine } from "@/generated/prisma";
export { FLOW_LABEL, PNL_LINE_LABEL, NEEDS_LABEL } from "./labels";

/**
 * Kirim-Chiqim kategoriyalari daraxti (Manba → Sub manba) — `CashCategory` jadvalidan.
 * Kassa yozuvi kategoriyaga NOM orqali bog'lanadi (`CashTransaction.category` / `subCategory`), shuning uchun
 * avtomatik yozadigan joylar (kirim, snab, ish haqi, mexanik…) va eski yozuvlar o'zgarmaydi.
 * Eski / erkin nomlar `aliases` orqali topiladi; topilmagani hisobotda «Manbasi aniqlanmagan».
 */
export type CatNode = {
  id: string; name: string; type: CashTxType; parentId: string | null; flow: CashFlowKind; pnlLine: PnlLine;
  needs: CashCategoryNeeds | null; loanPart: LoanPart | null; aliases: string[]; isSystem: boolean; isActive: boolean; sort: number;
  /** Tannarxga kiradi — ishlab chiqarish xarajati (`lib/fin-report/cost.ts`) */
  inCost: boolean;
};

/** Hisobotdagi «Manbasi aniqlanmagan» qatori — daraxtdan topilmagan kategoriya nomlari shu yerga yig'iladi. */
export const UNKNOWN_CATEGORY = "Manbasi aniqlanmagan";

export const normCat = (s: string) => s.trim().toLowerCase().replace(/[ʻʼ’‘`]/g, "'").replace(/\s+/g, " ");

let cache: { at: number; nodes: CatNode[] } | null = null;
const TTL = 60_000;

/** Barcha kategoriyalar (nofaollari ham — eski yozuvlar ham topilsin). 1 daqiqa keshda; tahrirdan keyin `resetCategoryCache`. */
export async function loadCategories(): Promise<CatNode[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.nodes;
  const nodes = await db.cashCategory.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] });
  cache = { at: Date.now(), nodes };
  return nodes;
}

export function resetCategoryCache() {
  cache = null;
}

/**
 * Yozishdagi tekshiruvlar uchun (`lib/cash-entry.ts`): berilgan nomlardan biri keshda topilmasa — bazadan bir marta qayta
 * o'qiladi. Kesh har modul nusxasida alohida: «+» bilan hozirgina qo'shilgan manba / sub manba (boshqa action, boshqa
 * jarayon) shu yerda 1 daqiqagacha ko'rinmay, yozuv «bunday sub manba yo'q» deb rad etilardi.
 */
export async function loadCategoriesFor(names: (string | null | undefined)[]): Promise<CatNode[]> {
  const nodes = await loadCategories();
  const keys = new Set<string>();
  for (const n of nodes) { keys.add(normCat(n.name)); for (const a of n.aliases) keys.add(normCat(a)); }
  if (names.every((x) => !x || keys.has(normCat(x)))) return nodes;
  cache = null;
  return loadCategories();
}

export type Resolved = { top: CatNode; sub: CatNode | null } | null;

/** Nom → tugun xaritasi va topuvchi. `resolve(category, sub)` — Manba (top) va Sub manbani qaytaradi. */
export function makeResolver(nodes: CatNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byName = new Map<string, CatNode>();
  for (const n of nodes) byName.set(normCat(n.name), n);
  for (const n of nodes) for (const a of n.aliases) if (!byName.has(normCat(a))) byName.set(normCat(a), n);
  const find = (s: string | null | undefined) => (s ? byName.get(normCat(s)) ?? null : null);
  const topOf = (n: CatNode) => (n.parentId ? byId.get(n.parentId) ?? n : n);

  return function resolve(category: string, subCategory?: string | null): Resolved {
    const sub = find(subCategory);
    if (sub && sub.parentId) return { top: topOf(sub), sub };
    const node = find(category);
    if (!node) return null;
    // Eski yozuvda kategoriya o'rniga sub manba nomi yozilgan bo'lishi mumkin («Yoqilg'i» → Transport / Yoqilg'i)
    return node.parentId ? { top: topOf(node), sub: node } : { top: node, sub: null };
  };
}

export type CategoryTree = (CatNode & { children: CatNode[] })[];

/** Formalar va sozlama sahifasi uchun daraxt: faqat manbalar (ota-onasiz), bolalari ichida. */
export function toTree(nodes: CatNode[], opts: { type?: CashTxType; activeOnly?: boolean } = {}): CategoryTree {
  const ok = (n: CatNode) => (!opts.type || n.type === opts.type) && (!opts.activeOnly || n.isActive);
  return nodes
    .filter((n) => !n.parentId && ok(n))
    .map((n) => ({ ...n, children: nodes.filter((c) => c.parentId === n.id && ok(c)) }));
}

/** Kirim-Chiqim formasi uchun ixcham variantlar (klientga yuboriladi). */
export type CategoryOption = { name: string; needs: CashCategoryNeeds | null; loanPart: LoanPart | null; subs: string[] };

export async function categoryOptions(type: "INCOME" | "EXPENSE"): Promise<CategoryOption[]> {
  return toTree(await loadCategories(), { type, activeOnly: true }).map((t) => ({ name: t.name, needs: t.needs, loanPart: t.loanPart, subs: t.children.map((c) => c.name) }));
}

/** Nom boshqa kategoriya nomi yoki alias'i bilan to'qnashmasin — aks holda yozuv qaysi biriga tushishi noaniq. */
export async function categoryNameTaken(name: string, exceptId?: string) {
  const k = normCat(name);
  const all = await db.cashCategory.findMany({ select: { id: true, name: true, aliases: true } });
  return all.some((c) => c.id !== exceptId && (normCat(c.name) === k || c.aliases.includes(k)));
}

export type NewCategory = {
  name: string; parentId?: string | null; type?: CashTxType; flow?: CashFlowKind; pnlLine?: PnlLine;
  needs?: CashCategoryNeeds | null; loanPart?: LoanPart | null; via?: string;
};

/**
 * Yangi manba yoki sub manba — Moliya → Kategoriyalar sahifasi ham, Kirim-Chiqim formasidagi «+» ham shu bilan.
 * Sub manba ota-onasining turini, oqimini va PNL qatorini oladi; sub manba ostiga yana sub manba qo'shilmaydi.
 */
export async function createCashCategory(d: NewCategory, userId: string): Promise<{ id: string; name: string } | { error: string }> {
  const name = d.name.replace(/\s+/g, " ").trim();
  if (!name) return { error: "Nomi kerak" };
  if (name.length > 80) return { error: "Nomi juda uzun" };
  if (await categoryNameTaken(name)) return { error: "Bunday nom (yoki alias) allaqachon bor" };
  let data;
  if (d.parentId) {
    const p = await db.cashCategory.findUnique({ where: { id: d.parentId } });
    if (!p || p.parentId) return { error: "Manba topilmadi (sub manba ostiga yana sub manba qo'shilmaydi)" };
    data = { name, type: p.type, parentId: p.id, flow: p.flow, pnlLine: p.pnlLine };
  } else {
    if (!d.type || !d.flow || !d.pnlLine) return { error: "Turi, oqim turi va PNL qatorini tanlang" };
    data = { name, type: d.type, flow: d.flow, pnlLine: d.pnlLine, needs: d.needs || null, loanPart: d.needs === "LOAN" ? d.loanPart || "PRINCIPAL" : null, sort: 500 };
  }
  try {
    const c = await db.$transaction(async (tx) => {
      const c = await tx.cashCategory.create({ data });
      await audit(tx, userId, "CREATE", "CashCategory", c.id, undefined, d.via ? { ...c, via: d.via } : c);
      return c;
    });
    resetCategoryCache();
    return { id: c.id, name: c.name };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { error: "Bunday nom allaqachon bor" };
    throw e;
  }
}
