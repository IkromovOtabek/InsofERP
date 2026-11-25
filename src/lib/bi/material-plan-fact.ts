import { db } from "@/lib/db";
import { avgUnitCosts } from "@/lib/stock";
import { companyVatPayer } from "@/lib/receipt-vat";
import { CONSUME_TYPES } from "@/lib/material-usage";
import { activeRecipes, expand, monthPrices, productInfo } from "@/lib/fin-report/cost";

/**
 * Ishlab chiqarish: xomashyo plan-fakt (Tahlil → Ishlab chiqarish → «Xomashyo plan-fakt»).
 *
 *  · Plan (norma) — davrda ishlab chiqarilgan miqdor (PRODUCTION_OUTPUT, storno bilan) × faol retseptdagi XOMASHYO qatorlari.
 *    Retseptdagi mahsulot-ingredient (FBS ichidagi beton) jamiga qo'shilmaydi — u o'z zamesida (o'z PRODUCTION_OUTPUT'ida)
 *    allaqachon hisoblangan, ikki marta sanalmasin. 1 birlik tarkibida esa to'liq yoyilgan holda ko'rsatiladi.
 *  · Fakt — davrda skladdan haqiqatda chiqqan xomashyo: zames + brigadaga berilgan + «Chiqim» (Расход) − brigadadan qaytgan
 *    (`CONSUME_TYPES`, `lib/material-usage.ts` bilan bitta ta'rif). Brigada topshirig'idagi avtomatik sarf (BrigadeMove CONSUME)
 *    olinmaydi — u retsept bo'yicha yoziladi va doim normaga teng chiqadi.
 *  · Mahsulot 1 birligining fakt sarfi — sklad har dona uchun alohida sarf yozmaydi, shuning uchun har xomashyo
 *    koeffitsiyenti (fakt ÷ norma) mahsulot normasiga qo'llanadi (norma ulushi bo'yicha taqsimlash).
 *  · Narx — davrning o'rtacha xarid narxi (kirimdan, korxona QQS to'lovchisi bo'lsa QQSsiz), yo'q bo'lsa umumiy o'rtacha —
 *    «Tannarx hisobi» bilan bir xil.
 *  · Brigada bo'yicha — brigadaga skladdan berilgan (− qaytgan) va shu brigada chiqargan mahsulot normasi. Brigada qo'lidagi
 *    qoldiq o'zgarishi hisobga olinmaydi: davr oxirida ishlatilmagan qoldiq «ortiqcha berilgan» bo'lib ko'rinadi.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const EPS = 0.0005;

export type PfMaterial = {
  id: string; name: string; unit: string; price: number;
  plan: number; fact: number; diff: number; diffPct: number | null;
  planSum: number; factSum: number; diffSum: number;
  /** fakt ÷ norma; norma yo'q — null */
  coef: number | null;
};
export type PfLine = { materialId: string; name: string; unit: string; price: number; plan: number; fact: number | null; planSum: number; factSum: number | null };
export type PfProduct = {
  id: string; name: string; code: string; unit: string; group: string;
  produced: number; hasRecipe: boolean;
  /** 1 birlik uchun: norma va fakt (so'm) */
  unitPlan: number | null; unitFact: number | null; unitDiff: number | null; diffPct: number | null;
  /** butun ishlab chiqarilgani uchun (so'm) */
  totalPlan: number | null; totalFact: number | null;
  lines: PfLine[];
};
export type PfBrigade = {
  id: string; name: string; output: string;
  planSum: number; issuedSum: number; diffSum: number; diffPct: number | null;
  lines: { materialId: string; name: string; unit: string; plan: number; issued: number; diff: number }[];
};
export type MaterialPlanFact = {
  materials: PfMaterial[]; products: PfProduct[]; brigades: PfBrigade[];
  planSum: number; factSum: number; diffSum: number; diffPct: number | null;
  noRecipe: number; vatPayer: boolean;
};

export async function materialPlanFact(from: Date, to: Date): Promise<MaterialPlanFact> {
  const [recipes, products, avgAll, vatPayer, mats] = await Promise.all([
    activeRecipes(), productInfo(), avgUnitCosts(), companyVatPayer(),
    db.material.findMany({ select: { id: true, name: true, unit: true, category: true } }),
  ]);
  const [price, output, consumed, brigadeOut] = await Promise.all([
    monthPrices(from, to, vatPayer, avgAll),
    db.stockMove.groupBy({ by: ["productId", "brigadeId"], where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: from, lt: to } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId", "type", "brigadeId"], where: { materialId: { not: null }, type: { in: [...CONSUME_TYPES] }, date: { gte: from, lt: to } }, _sum: { qty: true } }),
    db.brigade.findMany({ select: { id: true, name: true } }),
  ]);
  const matById = new Map(mats.map((m) => [m.id, m]));
  const brigName = new Map(brigadeOut.map((b) => [b.id, b.name]));
  const inRecipe = new Set([...recipes.values()].flat().map((l) => l.materialId).filter((x): x is string => !!x));
  const isRaw = (id: string) => matById.get(id)?.category === "XOMASHYO" || inRecipe.has(id);
  const priceOf = (id: string) => price.get(id) ?? 0;

  // ── Ishlab chiqarilgan: mahsulot bo'yicha va brigada × mahsulot ──
  const produced = new Map<string, number>();
  const byBrigade = new Map<string, Map<string, number>>();
  for (const o of output) {
    const q = Number(o._sum.qty ?? 0);
    if (!o.productId || Math.abs(q) < EPS) continue;
    produced.set(o.productId, (produced.get(o.productId) ?? 0) + q);
    if (o.brigadeId) {
      const m = byBrigade.get(o.brigadeId) ?? new Map<string, number>();
      m.set(o.productId, (m.get(o.productId) ?? 0) + q);
      byBrigade.set(o.brigadeId, m);
    }
  }
  /** Mahsulot 1 birligining to'g'ridan-to'g'ri xomashyo qatorlari (mahsulot-ingredientsiz) */
  const direct = (pid: string) => (recipes.get(pid) ?? []).filter((l) => l.materialId && isRaw(l.materialId));

  // ── Plan: material bo'yicha ──
  const plan = new Map<string, number>();
  for (const [pid, q] of produced) for (const l of direct(pid)) plan.set(l.materialId!, (plan.get(l.materialId!) ?? 0) + l.qty * q);

  // ── Fakt: material bo'yicha, brigadaga berilgani alohida ──
  const fact = new Map<string, number>();
  const issued = new Map<string, Map<string, number>>(); // brigada → material → miqdor
  for (const c of consumed) {
    const id = c.materialId!;
    if (!isRaw(id)) continue;
    const q = -Number(c._sum.qty ?? 0);
    fact.set(id, (fact.get(id) ?? 0) + q);
    if ((c.type === "BRIGADE_ISSUE" || c.type === "BRIGADE_RETURN") && c.brigadeId) {
      const m = issued.get(c.brigadeId) ?? new Map<string, number>();
      m.set(id, (m.get(id) ?? 0) + q);
      issued.set(c.brigadeId, m);
    }
  }

  const coef = new Map<string, number>();
  const materials: PfMaterial[] = [];
  for (const id of new Set([...plan.keys(), ...fact.keys()])) {
    const m = matById.get(id);
    if (!m) continue;
    const p = r3(plan.get(id) ?? 0), f = r3(fact.get(id) ?? 0);
    if (Math.abs(p) < EPS && Math.abs(f) < EPS) continue;
    const pr = priceOf(id);
    if (p > EPS) coef.set(id, f / p);
    materials.push({
      id, name: m.name, unit: m.unit, price: r2(pr), plan: p, fact: f, diff: r3(f - p), diffPct: p > EPS ? Math.round(((f - p) / p) * 1000) / 10 : null,
      planSum: r2(p * pr), factSum: r2(f * pr), diffSum: r2((f - p) * pr), coef: p > EPS ? Math.round((f / p) * 1000) / 1000 : null,
    });
  }
  materials.sort((a, b) => Math.abs(b.diffSum) - Math.abs(a.diffSum));

  // ── Mahsulot: 1 birlik tarkibi (to'liq yoyilgan) ──
  const productRows: PfProduct[] = [];
  let noRecipe = 0;
  for (const [pid, q] of produced) {
    const info = products.get(pid);
    if (!info) continue;
    const use = expand(pid, recipes);
    const lines: PfLine[] = [];
    if (use) {
      for (const [mid, perUnit] of use) {
        if (!isRaw(mid)) continue;
        const m = matById.get(mid);
        const pr = priceOf(mid), k = coef.get(mid);
        const factU = k === undefined ? null : perUnit * k;
        lines.push({ materialId: mid, name: m?.name ?? "?", unit: m?.unit ?? "", price: r2(pr), plan: r3(perUnit), fact: factU === null ? null : r3(factU), planSum: r2(perUnit * pr), factSum: factU === null ? null : r2(factU * pr) });
      }
      lines.sort((a, b) => b.planSum - a.planSum);
    } else noRecipe++;
    const unitPlan = use ? r2(lines.reduce((s, l) => s + l.planSum, 0)) : null;
    // Normasi yo'q material (koeffitsiyent topilmagan) faktda norma bilan olinadi
    const unitFact = use ? r2(lines.reduce((s, l) => s + (l.factSum ?? l.planSum), 0)) : null;
    productRows.push({
      id: pid, name: info.name, code: info.code, unit: info.unit, group: info.group, produced: r3(q), hasRecipe: !!use,
      unitPlan, unitFact, unitDiff: unitPlan !== null && unitFact !== null ? r2(unitFact - unitPlan) : null,
      diffPct: unitPlan && unitFact !== null ? Math.round(((unitFact - unitPlan) / unitPlan) * 1000) / 10 : null,
      totalPlan: unitPlan !== null ? r2(unitPlan * q) : null, totalFact: unitFact !== null ? r2(unitFact * q) : null, lines,
    });
  }
  productRows.sort((a, b) => a.group.localeCompare(b.group, "uz") || (b.totalPlan ?? 0) - (a.totalPlan ?? 0));

  // ── Brigada: berilgan vs chiqargani normasi ──
  const brigades: PfBrigade[] = [];
  for (const bid of new Set([...byBrigade.keys(), ...issued.keys()])) {
    const out = byBrigade.get(bid) ?? new Map<string, number>();
    const bPlan = new Map<string, number>();
    for (const [pid, q] of out) for (const l of direct(pid)) bPlan.set(l.materialId!, (bPlan.get(l.materialId!) ?? 0) + l.qty * q);
    const bIss = issued.get(bid) ?? new Map<string, number>();
    const lines = [...new Set([...bPlan.keys(), ...bIss.keys()])].map((mid) => {
      const m = matById.get(mid);
      const p = r3(bPlan.get(mid) ?? 0), i = r3(bIss.get(mid) ?? 0);
      return { materialId: mid, name: m?.name ?? "?", unit: m?.unit ?? "", plan: p, issued: i, diff: r3(i - p) };
    }).filter((l) => Math.abs(l.plan) >= EPS || Math.abs(l.issued) >= EPS).sort((a, b) => Math.abs(b.diff * priceOf(b.materialId)) - Math.abs(a.diff * priceOf(a.materialId)));
    if (!lines.length && !out.size) continue;
    const planSum = r2(lines.reduce((s, l) => s + l.plan * priceOf(l.materialId), 0));
    const issuedSum = r2(lines.reduce((s, l) => s + l.issued * priceOf(l.materialId), 0));
    const outText = [...out].filter(([, q]) => Math.abs(q) >= EPS).map(([pid, q]) => { const p = products.get(pid); return `${p?.name ?? "?"} — ${Math.round(q * 1000) / 1000} ${p?.unit ?? ""}`; }).join("; ");
    brigades.push({ id: bid, name: brigName.get(bid) ?? "?", output: outText, planSum, issuedSum, diffSum: r2(issuedSum - planSum), diffPct: planSum > 0 ? Math.round(((issuedSum - planSum) / planSum) * 1000) / 10 : null, lines });
  }
  brigades.sort((a, b) => Math.abs(b.diffSum) - Math.abs(a.diffSum));

  const planSum = r2(materials.reduce((s, m) => s + m.planSum, 0));
  const factSum = r2(materials.reduce((s, m) => s + m.factSum, 0));
  return { materials, products: productRows, brigades, planSum, factSum, diffSum: r2(factSum - planSum), diffPct: planSum > 0 ? Math.round(((factSum - planSum) / planSum) * 1000) / 10 : null, noRecipe, vatPayer };
}
