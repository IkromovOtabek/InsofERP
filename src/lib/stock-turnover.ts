import type { MaterialCategory, Prisma } from "@/generated/prisma";
import { db } from "./db";
import { avgUnitCosts } from "./stock";

/**
 * Xomashyo aylanmasi — Sklad → «Остатки» (foydalanuvchi Excel'idagi XOMASHYO jadvali):
 * Остатка (davr boshi) | Приход | Расход | Остатка (davr oxiri), har biri К-во va Сумма.
 *
 * Tasnif — har harakat aniq bitta ustunga tushadi (ayniyat: close.q = open.q + in.q − out.q):
 *  · Приход = RECEIPT (ishorasi bilan: storno — minus) + ADJUSTMENT qty > 0 (inventarizatsiya ortig'i, boshlang'ich qoldiq);
 *  · Расход = −(qolgan hammasi): PRODUCTION_CONSUME, BRIGADE_ISSUE, BRIGADE_RETURN (qaytish — minus sarf), WRITE_OFF,
 *    ISSUE (Кому), ADJUSTMENT qty < 0. Storno qilingan zames/berish (teskari harakat) ham shu ustunda ayiriladi.
 *
 * Summa: harakat summasi = qty × COALESCE(unitCost, joriy narx). Joriy narx = Material.unitPrice («Дона сўм») ?? o'rtacha
 * tannarx (`avgUnitCosts`). unitCost'i yo'q eski chiqimlar shu narx bilan baholanadi — bunday qatorda `approx = true` («≈»).
 * open.s = Σ(date < from) qty × narx (kirim − chiqim); close.s = open.s + in.s − out.s.
 *
 * Sana chegaralari: `StockMove.date` — vaqt mintaqasisiz timestamp (UTC devor vaqti). Prisma `Date` parametrini
 * `timestamptz` qilib yuboradi va sessiya mintaqasi (Asia/Tashkent) bilan solishtirishda 5 soat siljiydi — shuning uchun
 * chegara ISO satr + `::timestamp` bilan beriladi (aniq UTC qiymat, `findMany({ date: { gte } })` bilan bir xil).
 * Filtrlar oddiy parametr (`Prisma.sql` bo'lagi emas) — `avgUnitCosts` dagi HMR muammosi sababli.
 */
export type TurnoverRow = {
  id: string; name: string; code: string; unit: string; isActive: boolean;
  category: MaterialCategory;
  minStock: number;
  /** «Дона сўм» (Snabjeniye belgilagan), yo'q bo'lsa null */
  unitPrice: number | null;
  /** Miqdorga tortilgan o'rtacha tannarx (kirimlar), yo'q bo'lsa null */
  avgCost: number | null;
  open: { q: number; s: number };
  in: { q: number; s: number };
  /** Расход — musbat (skladdan chiqqan) */
  out: { q: number; s: number };
  close: { q: number; s: number };
  /** Narxsiz (unitCost NULL) harakat joriy narx bilan baholandi — summa taxminiy */
  approx: boolean;
};

type Num = Prisma.Decimal | number | string | null;
type Raw = {
  id: string; name: string; code: string; unit: string; isActive: boolean; category: MaterialCategory; minStock: Num; unitPrice: Num;
  oq: Num; osk: Num; osn: Num; iq: Num; isk: Num; isn: Num; xq: Num; xsk: Num; xsn: Num; pn: bigint | number | null;
};

const EPS = 0.0005;
const n = (v: Num | bigint) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

export async function materialTurnover(p: { from: Date; to: Date; warehouseId?: string | null }): Promise<TurnoverRow[]> {
  const from = p.from.toISOString();
  const to = p.to.toISOString();
  const wh = p.warehouseId || null;
  const [rows, avg] = await Promise.all([
    db.$queryRaw<Raw[]>`
      SELECT m."id", m."name", m."code", m."unit", m."isActive", m."category"::text AS "category", m."minStock", m."unitPrice",
        a."oq", a."osk", a."osn", a."iq", a."isk", a."isn", a."xq", a."xsk", a."xsn", a."pn"
      FROM "Material" m
      LEFT JOIN (
        SELECT x."materialId",
          SUM(x."qty") FILTER (WHERE NOT x."p") AS "oq",
          SUM(x."qty" * x."unitCost") FILTER (WHERE NOT x."p" AND x."unitCost" IS NOT NULL) AS "osk",
          SUM(x."qty") FILTER (WHERE NOT x."p" AND x."unitCost" IS NULL) AS "osn",
          SUM(x."qty") FILTER (WHERE x."p" AND x."inb") AS "iq",
          SUM(x."qty" * x."unitCost") FILTER (WHERE x."p" AND x."inb" AND x."unitCost" IS NOT NULL) AS "isk",
          SUM(x."qty") FILTER (WHERE x."p" AND x."inb" AND x."unitCost" IS NULL) AS "isn",
          SUM(x."qty") FILTER (WHERE x."p" AND NOT x."inb") AS "xq",
          SUM(x."qty" * x."unitCost") FILTER (WHERE x."p" AND NOT x."inb" AND x."unitCost" IS NOT NULL) AS "xsk",
          SUM(x."qty") FILTER (WHERE x."p" AND NOT x."inb" AND x."unitCost" IS NULL) AS "xsn",
          COUNT(*) FILTER (WHERE x."p") AS "pn"
        FROM (
          SELECT s."materialId", s."qty", s."unitCost",
            s."date" >= ${from}::timestamp AS "p",
            (s."type" = 'RECEIPT' OR (s."type" = 'ADJUSTMENT' AND s."qty" > 0)) AS "inb"
          FROM "StockMove" s
          WHERE s."materialId" IS NOT NULL AND s."date" < ${to}::timestamp
            AND (${wh}::text IS NULL OR s."warehouseId" = ${wh}::text)
        ) x
        GROUP BY x."materialId"
      ) a ON a."materialId" = m."id"
      WHERE m."isActive" OR a."materialId" IS NOT NULL
      ORDER BY m."name", m."code"`,
    avgUnitCosts(),
  ]);

  const out: TurnoverRow[] = [];
  for (const r of rows) {
    const unitPrice = r.unitPrice == null ? null : Number(r.unitPrice);
    const avgCost = avg.get(r.id) ?? null;
    const cur = unitPrice ?? avgCost ?? 0;
    const open = { q: r3(n(r.oq)), s: r2(n(r.osk) + n(r.osn) * cur) };
    const inc = { q: r3(n(r.iq)), s: r2(n(r.isk) + n(r.isn) * cur) };
    const dec = { q: r3(-n(r.xq)), s: r2(-(n(r.xsk) + n(r.xsn) * cur)) };
    const close = { q: r3(open.q + inc.q - dec.q), s: r2(open.s + inc.s - dec.s) };
    // Arxivdagi xomashyo — faqat davrda harakati yoki qoldig'i bo'lsa (o'chirilgan ro'yxatni to'ldirib yubormasin)
    if (!r.isActive && n(r.pn) === 0 && Math.abs(close.q) < EPS) continue;
    out.push({
      id: r.id, name: r.name, code: r.code, unit: r.unit, isActive: r.isActive, category: r.category,
      minStock: n(r.minStock), unitPrice, avgCost,
      open, in: inc, out: dec, close,
      approx: Math.abs(n(r.osn)) > EPS || Math.abs(n(r.isn)) > EPS || Math.abs(n(r.xsn)) > EPS,
    });
  }
  return out;
}
