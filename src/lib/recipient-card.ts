import { db } from "./db";
import { rasxodJournal, rasxodTotals, type RasxodRow } from "./stock-issue";
import { brigadeStocks, type BrigadeMake, type BrigadeMaterial } from "./brigade-stock";

/**
 * «Kimga» kartasi — skladdan olgan har bir oluvchining o'z sahifasi (veb `/oluvchi/<kind>/<id>`, ECO «Mening skladim»):
 *  · `b` — brigada: davrda berilgan tovarlar, qo'lidagi qoldiq va qiymati, shu xomashyo bilan qancha chiqara olishi,
 *    davrda ishlab chiqarilgani, retsept bo'yicha sarflangan xomashyo qiymati, 1 birlikka sarf (samaradorlik), brak;
 *  · `e` — xodim (Employee): davrda nima va qancha pulga olgan, barcha vaqt jami;
 *  · `r` — erkin oluvchi (StockRecipient: shofyorlar, Traktor…): xuddi xodimdek.
 * Hamma raqam `rasxodJournal` bilan bir manbadan (StockMove) — jurnal va karta bir-biriga mos chiqadi.
 */

export type CardKind = "b" | "e" | "r";
export const CARD_KIND_LABEL: Record<CardKind, string> = { b: "Brigada", e: "Xodim", r: "Oluvchi" };

/** URL kaliti `b|e|r` ↔ jurnal filtri «Kimga» kaliti ("b:<id>"). */
export const cardKey = (kind: CardKind, id: string) => `${kind}:${id}`;
export const cardHref = (kind: CardKind, id: string) => `/oluvchi/${kind}/${id}`;
/** Jurnal qatoridagi `toKey` ("b:<id>" | "e:<id>" | "r:<id>") → karta havolasi; boshqa turlar (zames, spisanie) — null. */
export function cardHrefOf(toKey: string): string | null {
  const m = /^([ber]):(.+)$/.exec(toKey);
  return m ? cardHref(m[1] as CardKind, m[2]) : null;
}
export const isCardKind = (v: string): v is CardKind => v === "b" || v === "e" || v === "r";

export type CardMaterial = { materialId: string; name: string; unit: string; qty: number; sum: number; docs: number; lastAt: Date };
export type ProducedRow = { product: string; unit: string; qty: number };
export type BrigadeBlock = {
  leader: string | null; phone: string | null; members: number;
  /** Qo'lidagi xomashyo (BrigadeMove yig'indisi) va qiymati */
  hand: BrigadeMaterial[]; handValue: number;
  /** Shu xomashyo bilan qancha mahsulot chiqara oladi */
  makes: BrigadeMake[];
  /** Davrda ishlab chiqarilgani (topshiriq fakti) va braki — mahsulot bo'yicha */
  produced: ProducedRow[]; defects: ProducedRow[];
  /** Davrda retsept bo'yicha sarflangan xomashyo qiymati (BrigadeMove CONSUME) */
  consumedValue: number;
  /**
   * Samaradorlik: 1 birlik mahsulotga sarflangan xomashyo qiymati (asosiy birlik bo'yicha).
   * `basis` — "consumed" (retsept sarfi bor) yoki "issued" (sarf yozilmagan — berilgan summa bo'yicha, taxminiy)
   */
  perUnit: { unit: string; value: number; producedQty: number; basis: "consumed" | "issued" } | null;
  doneTasks: number; openTasks: number;
};
export type RecipientCard = {
  kind: CardKind; id: string; name: string; subtitle: string | null; isActive: boolean;
  /** Davrdagi chiqim qatorlari (jurnal bilan bir xil) va yig'indilari */
  rows: RasxodRow[]; totals: ReturnType<typeof rasxodTotals>;
  /** Davrda tovar bo'yicha: miqdor (storno / qaytish ayirilgan), summa, hujjatlar soni */
  byMaterial: CardMaterial[];
  /** Barcha vaqt bo'yicha: berilgan summa (storno ayirilgan), hujjatlar, birinchi va oxirgi berish */
  allTime: { sum: number; docs: number; firstAt: Date | null; lastAt: Date | null };
  brigade: BrigadeBlock | null;
  employee: { position: string; brigade: string | null; leads: { id: string; name: string }[] } | null;
  recipient: { note: string | null } | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function groupProduced(list: { qty: unknown; product: { name: string; unit: string } }[]): ProducedRow[] {
  const m = new Map<string, ProducedRow>();
  for (const x of list) {
    const cur = m.get(x.product.name) ?? { product: x.product.name, unit: x.product.unit, qty: 0 };
    cur.qty += Number(x.qty);
    m.set(x.product.name, cur);
  }
  return [...m.values()].map((p) => ({ ...p, qty: r3(p.qty) })).sort((a, b) => b.qty - a.qty);
}

/** Oluvchi topilmasa null (nofaol bo'lsa ham karta ochiladi — eski chiqimlar ko'rinsin). */
export async function recipientCard(kind: CardKind, id: string, period: { from: Date; to: Date }): Promise<RecipientCard | null> {
  const key = cardKey(kind, id);
  const brig = kind === "b" ? await db.brigade.findUnique({ where: { id }, select: { id: true, name: true, phone: true, note: true, isActive: true, leader: { select: { fullName: true } }, _count: { select: { members: true } } } }) : null;
  const emp = kind === "e" ? await db.employee.findUnique({ where: { id }, select: { id: true, fullName: true, position: true, isActive: true, brigade: { select: { name: true } }, brigades: { where: { isActive: true }, select: { id: true, name: true } } } }) : null;
  const rec = kind === "r" ? await db.stockRecipient.findUnique({ where: { id }, select: { id: true, name: true, note: true, isActive: true } }) : null;
  if (!brig && !emp && !rec) return null;

  // Barcha vaqt: shu oluvchining chiqim harakatlari (storno teskari ishorali — yig'indida o'zi ayriladi)
  const allWhere = kind === "b" ? { type: "BRIGADE_ISSUE" as const, brigadeId: id } : kind === "e" ? { type: "ISSUE" as const, employeeId: id } : { type: "ISSUE" as const, recipientId: id };
  const [rows, all] = await Promise.all([
    rasxodJournal({ from: period.from, to: period.to, to_: key }),
    db.stockMove.findMany({ where: { ...allWhere, materialId: { not: null } }, select: { qty: true, unitCost: true, refId: true, date: true } }),
  ]);
  let sum = 0; const docs = new Set<string>(); let firstAt: Date | null = null, lastAt: Date | null = null;
  for (const m of all) {
    sum += -Number(m.qty) * Number(m.unitCost ?? 0);
    if (m.refId) docs.add(m.refId);
    if (Number(m.qty) < 0) { // berish qatori (storno va qaytish emas)
      if (!firstAt || m.date < firstAt) firstAt = m.date;
      if (!lastAt || m.date > lastAt) lastAt = m.date;
    }
  }

  const byMat = new Map<string, CardMaterial>();
  for (const r of rows) {
    const cur = byMat.get(r.materialId) ?? { materialId: r.materialId, name: r.material, unit: r.unit, qty: 0, sum: 0, docs: 0, lastAt: r.date };
    cur.qty += r.qty; cur.sum += r.sum;
    if (r.kind === "issue" || r.kind === "brigade") { cur.docs += 1; if (r.date > cur.lastAt) cur.lastAt = r.date; }
    byMat.set(r.materialId, cur);
  }
  const byMaterial = [...byMat.values()].map((m) => ({ ...m, qty: r3(m.qty), sum: r2(m.sum) })).sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
  const totals = rasxodTotals(rows);

  let brigade: BrigadeBlock | null = null;
  if (brig) {
    const bw = { brigadeId: id };
    const [stocks, progress, defects, consumed, done, open] = await Promise.all([
      brigadeStocks({ includeInactive: true }),
      db.taskProgress.findMany({ where: { date: { gte: period.from, lt: period.to }, task: bw }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { name: true, unit: true } } } } } } } }),
      db.productDefect.findMany({ where: { ...bw, date: { gte: period.from, lt: period.to } }, select: { qty: true, product: { select: { name: true, unit: true } } } }),
      db.brigadeMove.findMany({ where: { ...bw, type: "CONSUME", date: { gte: period.from, lt: period.to } }, select: { qty: true, unitCost: true } }),
      db.brigadeTask.count({ where: { ...bw, status: "DONE", updatedAt: { gte: period.from, lt: period.to } } }),
      db.brigadeTask.count({ where: { ...bw, status: { in: ["NEW", "IN_PROGRESS"] } } }),
    ]);
    const st = stocks.find((s) => s.id === id);
    const produced = groupProduced(progress.map((p) => ({ qty: p.qty, product: p.task.orderItem.product })));
    const consumedValue = r2(consumed.reduce((s, m) => s + -Number(m.qty) * Number(m.unitCost ?? 0), 0));
    // Asosiy birlik — davrda eng ko'p chiqarilgan mahsulot birligi; sarf shu birlikdagi jami miqdorga bo'linadi
    const mainUnit = produced[0]?.unit ?? null;
    const producedQty = mainUnit ? produced.filter((p) => p.unit === mainUnit).reduce((s, p) => s + p.qty, 0) : 0;
    const basis: "consumed" | "issued" = consumedValue > 0 ? "consumed" : "issued";
    const numer = basis === "consumed" ? consumedValue : totals.sum;
    brigade = {
      leader: brig.leader?.fullName ?? null, phone: brig.phone ?? null, members: brig._count.members,
      hand: st?.materials ?? [], handValue: r2(st?.value ?? 0), makes: (st?.makes ?? []).filter((m) => m.canMake > 0).sort((a, b) => b.canMake - a.canMake),
      produced, defects: groupProduced(defects), consumedValue,
      perUnit: mainUnit && producedQty > 0 && numer > 0 ? { unit: mainUnit, value: r2(numer / producedQty), producedQty: r3(producedQty), basis } : null,
      doneTasks: done, openTasks: open,
    };
  }

  const name = brig?.name ?? emp?.fullName ?? rec?.name ?? "—";
  const isActive = brig?.isActive ?? emp?.isActive ?? rec?.isActive ?? false;
  const subtitle = brig
    ? [brig.leader ? `Brigadir: ${brig.leader.fullName}` : "Brigadir belgilanmagan", brig.note].filter(Boolean).join(" · ")
    : emp
      ? [emp.position, emp.brigade ? `brigada: ${emp.brigade.name}` : null].filter(Boolean).join(" · ")
      : rec?.note ?? null;
  return {
    kind, id, name, subtitle: subtitle || null, isActive,
    rows, totals, byMaterial,
    allTime: { sum: r2(sum), docs: docs.size, firstAt, lastAt },
    brigade,
    employee: emp ? { position: emp.position, brigade: emp.brigade?.name ?? null, leads: emp.brigades } : null,
    recipient: rec ? { note: rec.note } : null,
  };
}
