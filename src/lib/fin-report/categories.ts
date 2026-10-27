import { db } from "@/lib/db";
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
