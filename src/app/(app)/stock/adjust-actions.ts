"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { MAX_AMOUNT, type ActionState } from "@/lib/action";
import { lockStock, STOCK_EPS } from "@/lib/stock-lock";
import { avgUnitCosts } from "@/lib/stock";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { money } from "@/lib/format";
import { DIRECTOR_NOTIFY_SUM, WRITE_OFF_REASONS } from "./adjust-const";

/**
 * Sklad qoldig'ini HUJJAT bilan o'zgartirish (yangi model yo'q — StockMove turlari yetarli):
 *
 *  · Inventarizatsiya — sanab chiqish: hisobdagi va haqiqiy qoldiq solishtiriladi, farq
 *    ADJUSTMENT (±) bo'lib yoziladi (refType "Inventory", bitta sanoq — bitta refId).
 *  · Hisobdan chiqarish (spisanie) — brak, yo'qotish, muddati o'tgan: WRITE_OFF (−),
 *    qoldiqdan oshmaydi.
 *
 * Ikkalasida sabab majburiy, har biri auditda. Qoldiqqa tegadigan tekshiruv va yozuv — `lockStock` ostida
 * (parallel zames/berish bilan bir qoldiqni ikki marta ishlatmasin). Farq summasi katta bo'lsa
 * (DIRECTOR_NOTIFY_SUM dan) — yoziladi, lekin direktorga xabar ketadi.
 * Kim: stock → "adjust" amali (lib/permissions.ts) — sklad (WAREHOUSE), direktor va u ruxsat bergan xodim.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function refresh() {
  revalidatePath("/stock"); revalidatePath("/stock/inventarizatsiya"); revalidatePath("/stock/spisanie");
  revalidatePath("/dashboard"); revalidatePath("/snabjeniye");
}

// ───────────────────────── Inventarizatsiya ─────────────────────────

type CountRow = { materialId: string; book: number; actual: number };

export async function saveInventory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "adjust");
  const warehouseId = text(fd, "warehouseId");
  const reason = text(fd, "reason");
  if (!reason) return { error: "Farq sababini yozing (masalan: oylik sanoq, tarozi xatosi, o'g'irlik)" };
  let raw: CountRow[];
  try { raw = JSON.parse(String(fd.get("rows") ?? "[]")); } catch { return { error: "Jadval o'qilmadi" }; }
  if (!Array.isArray(raw)) return { error: "Jadval o'qilmadi" };
  const rows = raw
    .map((x) => ({ materialId: String(x?.materialId ?? ""), book: Number(x?.book), actual: Number(x?.actual) }))
    .filter((x) => x.materialId);
  if (!rows.length) return { error: "Kamida bitta xomashyoning haqiqiy qoldig'ini kiriting" };
  const bad = rows.find((x) => !Number.isFinite(x.actual) || x.actual < 0 || x.actual > MAX_AMOUNT || !Number.isFinite(x.book));
  if (bad) return { error: "Haqiqiy qoldiq manfiy bo'lmagan raqam bo'lsin" };
  if (new Set(rows.map((x) => x.materialId)).size !== rows.length) return { error: "Bir xomashyo ikki marta sanalgan" };

  const wh = await db.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { id: true, name: true } });
  if (!wh) return { error: "Sklad tanlanmagan" };
  const ids = rows.map((x) => x.materialId);
  const mats = await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } });
  if (mats.length !== ids.length) return { error: "Ro'yxatdagi xomashyo topilmadi — sahifani yangilang" };
  const meta = new Map(mats.map((m) => [m.id, m]));
  const batchId = crypto.randomUUID();

  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    const sums = await tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: wh.id, materialId: { in: ids } }, _sum: { qty: true } });
    const bal = new Map(sums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));
    // Sanoq paytida (sahifa ochilgandan keyin) qoldiq o'zgargan bo'lsa — eski hisob bilan farq yozilmasin
    const moved = rows.filter((x) => Math.abs((bal.get(x.materialId) ?? 0) - x.book) > STOCK_EPS);
    if (moved.length) {
      return { error: `Sanoq paytida qoldiq o'zgardi: ${moved.slice(0, 5).map((x) => meta.get(x.materialId)?.name).join(", ")} — sahifani yangilab, shu qatorlarni qayta kiriting` };
    }
    const costs = await avgUnitCosts(ids, tx);
    const diffs = rows
      .map((x) => ({ ...x, diff: r3(x.actual - (bal.get(x.materialId) ?? 0)) }))
      .filter((x) => Math.abs(x.diff) > STOCK_EPS);
    if (!diffs.length) return { ok: true as const, count: 0, sum: 0, plus: 0, minus: 0, lines: [] as string[], first: "" };
    let sum = 0, plus = 0, minus = 0;
    const lines: string[] = [];
    for (const x of diffs) {
      const m = meta.get(x.materialId)!;
      const cost = costs.get(x.materialId) ?? null;
      await tx.stockMove.create({
        data: {
          type: "ADJUSTMENT", warehouseId: wh.id, materialId: x.materialId, qty: x.diff, unitCost: cost,
          refType: "Inventory", refId: batchId, createdById: s.userId,
          note: `Inventarizatsiya: hisobda ${r3(x.book)}, haqiqiy ${r3(x.actual)} ${m.unit} · ${reason}`,
        },
      });
      const v = Math.abs(x.diff) * (cost ?? 0);
      sum += v;
      if (x.diff > 0) plus += v; else minus += v;
      lines.push(`${m.name}: ${x.diff > 0 ? "+" : ""}${x.diff} ${m.unit}`);
    }
    await audit(tx, s.userId, "CREATE", "StockMove", batchId, undefined, {
      via: "inventory", warehouse: wh.name, reason, counted: rows.length,
      diffs: diffs.map((x) => ({ materialId: x.materialId, book: x.book, actual: x.actual, diff: x.diff })), sum,
    });
    return { ok: true as const, count: diffs.length, sum, plus, minus, lines, first: diffs[0].materialId };
  });
  if ("error" in res) return { error: res.error };
  refresh();
  if (!res.count) return { ok: true, note: `${rows.length} ta xomashyo sanaldi — farq yo'q` };
  if (res.sum >= DIRECTOR_NOTIFY_SUM) {
    notifyAfter(() => notifyRoles(["DIRECTOR"], {
      type: "STOCK_INVENTORY",
      title: `Inventarizatsiya farqi katta — ${wh.name}`,
      body: `${res.count} qator · ortiqcha ${money(res.plus)}, kam ${money(res.minus)} · ${reason} · ${res.lines.slice(0, 3).join("; ")}`,
      link: { key: "stock", id: res.first },
    }, { except: s.userId }));
  }
  return {
    ok: true,
    note: `Farq yozildi: ${res.count} qator (ortiqcha ${money(res.plus)}, kam ${money(res.minus)})${res.sum >= DIRECTOR_NOTIFY_SUM ? " — summa katta, direktorga xabar ketdi" : ""}`,
  };
}

// ───────────────────────── Hisobdan chiqarish (spisanie) ─────────────────────────

export async function saveWriteOff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "adjust");
  const warehouseId = text(fd, "warehouseId");
  const kind = text(fd, "kind");
  const note = text(fd, "note");
  if (!(WRITE_OFF_REASONS as readonly string[]).includes(kind)) return { error: "Sababni tanlang" };
  if (!note) return { error: "Izoh majburiy — nima bo'ldi, kim aniqladi" };
  let raw: { materialId?: unknown; qty?: unknown }[];
  try { raw = JSON.parse(String(fd.get("rows") ?? "[]")); } catch { return { error: "Jadval o'qilmadi" }; }
  if (!Array.isArray(raw)) return { error: "Jadval o'qilmadi" };
  const rows = raw.map((x) => ({ materialId: String(x?.materialId ?? ""), qty: Number(x?.qty) })).filter((x) => x.materialId && x.qty !== 0);
  if (!rows.length) return { error: "Kamida bitta xomashyo va miqdor kiriting" };
  if (rows.some((x) => !Number.isFinite(x.qty) || x.qty <= 0 || x.qty > MAX_AMOUNT)) return { error: "Miqdor 0 dan katta raqam bo'lsin" };
  const wanted = new Map<string, number>();
  for (const x of rows) wanted.set(x.materialId, (wanted.get(x.materialId) ?? 0) + x.qty);

  const wh = await db.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { id: true, name: true } });
  if (!wh) return { error: "Sklad tanlanmagan" };
  const ids = [...wanted.keys()];
  const mats = await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } });
  if (mats.length !== ids.length) return { error: "Xomashyo topilmadi — sahifani yangilang" };
  const meta = new Map(mats.map((m) => [m.id, m]));
  const batchId = crypto.randomUUID();
  const reason = `${kind} · ${note}`;

  const res = await db.$transaction(async (tx) => {
    // Qoldiq qulf ostida va AYNAN shu sklad bo'yicha: hisobdan chiqarish qoldiqdan oshmasin
    await lockStock(tx);
    const sums = await tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: wh.id, materialId: { in: ids } }, _sum: { qty: true } });
    const bal = new Map(sums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));
    const short = [...wanted.entries()].filter(([id, q]) => (bal.get(id) ?? 0) < q - STOCK_EPS)
      .map(([id, q]) => `${meta.get(id)!.name} (${wh.name}da ${r3(bal.get(id) ?? 0)}, chiqarilmoqda ${r3(q)} ${meta.get(id)!.unit})`);
    if (short.length) return { error: `Qoldiqdan ko'p chiqarib bo'lmaydi: ${short.join(", ")}` };
    const costs = await avgUnitCosts(ids, tx);
    let sum = 0;
    for (const [id, q] of wanted) {
      const cost = costs.get(id) ?? null;
      await tx.stockMove.create({
        data: {
          type: "WRITE_OFF", warehouseId: wh.id, materialId: id, qty: -r3(q), unitCost: cost,
          refType: "WriteOff", refId: batchId, note: `Hisobdan chiqarildi: ${reason}`, createdById: s.userId,
        },
      });
      sum += q * (cost ?? 0);
    }
    await audit(tx, s.userId, "CREATE", "StockMove", batchId, undefined, {
      via: "write-off", warehouse: wh.name, reason, rows: [...wanted.entries()].map(([materialId, qty]) => ({ materialId, qty })), sum,
    });
    return { ok: true as const, sum };
  });
  if ("error" in res) return { error: res.error };
  refresh();
  const lines = [...wanted.entries()].map(([id, q]) => `${meta.get(id)!.name}: ${r3(q)} ${meta.get(id)!.unit}`);
  if (res.sum >= DIRECTOR_NOTIFY_SUM) {
    notifyAfter(() => notifyRoles(["DIRECTOR"], {
      type: "STOCK_WRITE_OFF",
      title: `Katta hisobdan chiqarish — ${money(res.sum)}`,
      body: `${wh.name} · ${reason} · ${lines.slice(0, 3).join("; ")}`,
      link: { key: "stock", id: ids[0] },
    }, { except: s.userId }));
  }
  return { ok: true, note: `Hisobdan chiqarildi: ${lines.length} ta xomashyo, ${money(res.sum)}${res.sum >= DIRECTOR_NOTIFY_SUM ? " — summa katta, direktorga xabar ketdi" : ""}` };
}
