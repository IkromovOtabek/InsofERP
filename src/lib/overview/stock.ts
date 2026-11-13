import type { MaterialCategory, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { materialTurnover, type TurnoverRow } from "@/lib/stock-turnover";

/**
 * Sklad umumiy ko'rinishi (/stock/umumiy) — xomashyo bo'yicha davr raqamlari bir joyda.
 * Asos — `materialTurnover` (Sklad → «Qoldiqlar» bilan bir xil qoida va narx): qoldiq qiymati, kirim, chiqim.
 * Bu yerda faqat qo'shimcha kesimlar: harakat turi bo'yicha (kirim / chiqim tarkibi) va sklad bo'yicha.
 * Summa = Σ qty × unitCost + narxsiz miqdor × joriy narx («Дона сўм» ?? o'rtacha tannarx) — aylanmadagidek,
 * shuning uchun kesimlar yig'indisi «Qoldiqlar» jamiga teng. `cats` — ko'rinadigan kategoriyalar (mexanik — `categoriesFor`).
 * Sana chegaralari ISO satr + `::timestamp` (sababi `lib/stock-turnover.ts` izohida).
 */

export type FlowKey = "receipt" | "surplus" | "prod" | "brigade" | "issue" | "writeoff" | "shortage" | "other";
export const FLOW_LABEL: Record<FlowKey, string> = {
  receipt: "Yetkazuvchidan kirim (storno ayirilgan)",
  surplus: "Inventarizatsiya ortig'i, boshlang'ich qoldiq",
  prod: "Ishlab chiqarish (zames)",
  brigade: "Brigadalarga berildi (qaytgani ayirilgan)",
  issue: "Oluvchi va xodimlarga chiqim",
  writeoff: "Hisobdan chiqarish (spisanie)",
  shortage: "Inventarizatsiya kamomadi",
  other: "Boshqa harakatlar",
};
const FLOW_ORDER: FlowKey[] = ["receipt", "surplus", "prod", "brigade", "issue", "writeoff", "shortage", "other"];
const FLOW_OF: Record<string, FlowKey> = {
  RECEIPT: "receipt", ADJ_IN: "surplus", PRODUCTION_CONSUME: "prod", BRIGADE_ISSUE: "brigade", BRIGADE_RETURN: "brigade",
  ISSUE: "issue", WRITE_OFF: "writeoff", ADJ_OUT: "shortage",
};
const INBOUND = new Set<FlowKey>(["receipt", "surplus"]);

export type Flow = { key: FlowKey; label: string; inbound: boolean; moves: number; sum: number };
export type WarehouseRow = { id: string; name: string; isDefault: boolean; isActive: boolean; positions: number; value: number; in: number; out: number };

type Num = Prisma.Decimal | number | string | null;
type CloseRaw = { warehouseId: string; materialId: string; q: Num; sk: Num; sn: Num };
type FlowRaw = { warehouseId: string; materialId: string; k: string; n: number; sk: Num; sn: Num };

const EPS = 0.0005;
const num = (v: Num) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;

export async function stockOverview(p: { from: Date; to: Date; cats: MaterialCategory[] }) {
  const from = p.from.toISOString(), to = p.to.toISOString();
  const [turnover, warehouses, closeRows, flowRows] = await Promise.all([
    materialTurnover({ from: p.from, to: p.to }),
    db.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isActive: true, isDefault: true } }),
    db.$queryRaw<CloseRaw[]>`
      SELECT s."warehouseId", s."materialId", SUM(s."qty") AS "q",
        SUM(s."qty" * s."unitCost") FILTER (WHERE s."unitCost" IS NOT NULL) AS "sk",
        SUM(s."qty") FILTER (WHERE s."unitCost" IS NULL) AS "sn"
      FROM "StockMove" s
      WHERE s."materialId" IS NOT NULL AND s."date" < ${to}::timestamp
      GROUP BY 1, 2`,
    db.$queryRaw<FlowRaw[]>`
      SELECT s."warehouseId", s."materialId",
        CASE WHEN s."type" = 'ADJUSTMENT' THEN (CASE WHEN s."qty" > 0 THEN 'ADJ_IN' ELSE 'ADJ_OUT' END) ELSE s."type"::text END AS "k",
        COUNT(*)::int AS "n",
        SUM(s."qty" * s."unitCost") FILTER (WHERE s."unitCost" IS NOT NULL) AS "sk",
        SUM(s."qty") FILTER (WHERE s."unitCost" IS NULL) AS "sn"
      FROM "StockMove" s
      WHERE s."materialId" IS NOT NULL AND s."date" >= ${from}::timestamp AND s."date" < ${to}::timestamp
      GROUP BY 1, 2, 3`,
  ]);

  const allowed = new Set(p.cats);
  const materials: TurnoverRow[] = turnover.filter((r) => allowed.has(r.category));
  // Narxsiz harakat bahosi — aylanmadagi joriy narx; ro'yxatda yo'q xomashyo (boshqa kategoriya) hisobga kirmaydi
  const price = new Map(materials.map((r) => [r.id, r.unitPrice ?? r.avgCost ?? 0]));
  const val = (x: { materialId: string; sk: Num; sn: Num }) => num(x.sk) + num(x.sn) * price.get(x.materialId)!;

  const wh = new Map<string, { positions: number; value: number; in: number; out: number }>();
  const whAt = (id: string) => { let w = wh.get(id); if (!w) wh.set(id, w = { positions: 0, value: 0, in: 0, out: 0 }); return w; };
  for (const c of closeRows) {
    if (!price.has(c.materialId)) continue;
    const w = whAt(c.warehouseId);
    w.value += val(c);
    if (num(c.q) > EPS) w.positions++;
  }
  const flows = new Map<FlowKey, { moves: number; sum: number }>();
  for (const f of flowRows) {
    if (!price.has(f.materialId)) continue;
    const key = FLOW_OF[f.k] ?? "other";
    const inbound = INBOUND.has(key);
    const v = inbound ? val(f) : -val(f); // chiqim musbat
    const g = flows.get(key) ?? { moves: 0, sum: 0 };
    g.moves += Number(f.n); g.sum += v;
    flows.set(key, g);
    const w = whAt(f.warehouseId);
    if (inbound) w.in += v; else w.out += v;
  }

  const sum = (f: (r: TurnoverRow) => number) => r2(materials.reduce((a, r) => a + f(r), 0));
  return {
    materials,
    total: {
      value: sum((r) => r.close.s),
      positions: materials.filter((r) => r.close.q > EPS).length,
      in: sum((r) => r.in.s),
      out: sum((r) => r.out.s),
      /** Narxsiz harakat joriy narx bilan baholangan — summa taxminiy («≈») */
      approx: materials.some((r) => r.approx),
    },
    flows: FLOW_ORDER.flatMap((key): Flow[] => {
      const g = flows.get(key);
      return g && g.moves > 0 ? [{ key, label: FLOW_LABEL[key], inbound: INBOUND.has(key), moves: g.moves, sum: r2(g.sum) }] : [];
    }),
    warehouses: warehouses.flatMap((w): WarehouseRow[] => {
      const x = wh.get(w.id);
      if (!w.isActive && (!x || (x.positions === 0 && Math.abs(x.in) + Math.abs(x.out) < 0.5))) return [];
      return [{ ...w, positions: x?.positions ?? 0, value: r2(x?.value ?? 0), in: r2(x?.in ?? 0), out: r2(x?.out ?? 0) }];
    }),
  };
}

export type StockOverview = Awaited<ReturnType<typeof stockOverview>>;
