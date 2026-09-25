import type { Prisma, SupplyStatus } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { resolveMaterials } from "./import-materials";
import { notifyAfter, notifyRoles, notifyUsers } from "./notify";

/**
 * Ta'minot zayavkasi — bitta hujjat besh bo'limdan o'tadi:
 *
 *   Sklad (kerakli mahsulotlar jadvali)  →  Snabjeniye (narx, jami summa)
 *   →  Ta'minot zayavkalari (ma'sul xodim tasdiqlaydi)  →  Moliya / Kirim-Chiqim (pul ajratadi)
 *   →  Snabjeniye (kelgan molni tekshiradi, "Qabul qildim")  →  Sklad kirimi  →  Brigadalarga taqsimlash.
 *
 * Bu yerda faqat qoida va baza ishi. Sessiya tekshiruvi va `revalidatePath` — chaqiruvchi
 * server action'da (`lib/supply-actions.ts`), mobil ilova ham shu funksiyalarni chaqira oladi.
 */

export const SUPPLY_LABEL: Record<SupplyStatus, string> = {
  NEW: "Narx kutilmoqda",
  PRICED: "Tasdiq kutilmoqda",
  APPROVED: "Moliya kutilmoqda",
  FUNDED: "Tasdiqdan o'tdi",
  RECEIVED: "Qabul qilindi",
  REJECTED: "Bekor qilindi",
};

/** Qaysi bo'lim harakat qilishi kerak — ro'yxatlarda "kim ushlab turibdi" ko'rinsin. */
export const SUPPLY_OWNER: Record<SupplyStatus, string> = {
  NEW: "Snabjeniye narx qo'yishi kerak",
  PRICED: "Ma'sul xodim tasdiqlashi kerak",
  APPROVED: "Moliya tasdiqlashi kerak",
  FUNDED: "Snabjeniye mollarni qabul qilishi kerak",
  RECEIVED: "Sklad kirimi bo'ldi — brigadalarga taqsimlanadi",
  REJECTED: "Yopilgan",
};

export const SUPPLY_COLOR: Record<SupplyStatus, "slate" | "amber" | "blue" | "green" | "red"> = {
  NEW: "slate", PRICED: "amber", APPROVED: "amber", FUNDED: "blue", RECEIVED: "green", REJECTED: "red",
};

/** Hujjat yo'li — batafsil sahifadagi bosqichlar chizig'i. */
export const SUPPLY_STEPS = [
  { key: "NEW", label: "Sklad so'rovi" },
  { key: "PRICED", label: "Narx qo'yildi" },
  { key: "APPROVED", label: "Tasdiqlandi" },
  { key: "FUNDED", label: "Moliya ajratdi" },
  { key: "RECEIVED", label: "Qabul qilindi" },
];

/** Moliya tasdig'ini kutayotgan (soat ikonkasi) bosqich. */
export const isWaitingFinance = (s: SupplyStatus) => s === "APPROVED";
export const isOpenSupply = (s: SupplyStatus) => s !== "RECEIVED" && s !== "REJECTED";

type Num = Prisma.Decimal | number | string;
export type ItemLike = { qty: Num; price: Num; factQty?: Num | null; factPrice?: Num | null };

/** Mahsulot summasi: sklad so'ragan miqdor × snabjeniye narxi (dostavkasiz). */
export const plannedSum = (items: ItemLike[]) => items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0);
/** Fakt summasi: kelgan miqdor × kelgan narx (hali kiritilmagan qator reja bo'yicha olinadi). */
export const factSum = (items: ItemLike[]) => items.reduce((s, i) => s + Number(i.factQty ?? i.qty) * Number(i.factPrice ?? i.price), 0);
export const hasFact = (items: ItemLike[]) => items.some((i) => i.factQty != null || i.factPrice != null);

type WithDelivery = { deliveryCost: Num; deliveryFactCost?: Num | null };
/** To'liq reja summasi: mahsulotlar + dostavka xizmati. Tasdiq va pul shu summa bo'yicha. */
export const totalPlanned = (r: { items: ItemLike[] } & WithDelivery) => plannedSum(r.items) + Number(r.deliveryCost ?? 0);
/** To'liq fakt summasi: kelgan mahsulotlar + haqiqatda to'langan dostavka. */
export const totalFact = (r: { items: ItemLike[] } & WithDelivery) => factSum(r.items) + Number(r.deliveryFactCost ?? r.deliveryCost ?? 0);

/** Dostavka turlari — snabjeniye narx qo'yayotganda tanlaydi (konstanta `lib/supply-const.ts` da: klient ham o'qiydi). */
export { DELIVERY_KINDS } from "./supply-const";

export type SupplyResult = { id?: string; docNo?: string; error?: string; note?: string };

const ROUND = (n: number) => Math.round(n * 100) / 100;

const full = {
  items: { orderBy: { sortOrder: "asc" } },
  warehouse: true,
  supplier: true,
  cashAccount: true,
  createdBy: { select: { fullName: true } },
  events: { orderBy: { createdAt: "asc" }, include: { user: { select: { fullName: true, role: true } } } },
  receipt: { select: { id: true, docNo: true } },
} satisfies Prisma.SupplyRequestInclude;

export type SupplyFull = Prisma.SupplyRequestGetPayload<{ include: typeof full }>;

export const supplyRequest = (id: string) => db.supplyRequest.findUnique({ where: { id }, include: full });

/** Bosqich qo'riqchisi — noto'g'ri tugma bosilsa (ikki odam bir vaqtda ishlasa) o'zbekcha xato. */
function guard(req: { status: SupplyStatus } | null, expect: SupplyStatus[]): string | null {
  if (!req) return "Ta'minot zayavkasi topilmadi";
  if (!expect.includes(req.status)) return `Bu amal "${SUPPLY_LABEL[req.status]}" bosqichida bajarilmaydi — sahifani yangilang`;
  return null;
}

type Tx = Prisma.TransactionClient;
const event = (tx: Tx, requestId: string, stage: SupplyStatus, userId: string, note?: string | null) =>
  tx.supplyEvent.create({ data: { requestId, stage, userId, note: note ?? undefined } });

// ───────────────────────── 1. Sklad: kerakli mahsulotlar jadvali ─────────────────────────

export type NewItem = { materialId?: string | null; name: string; unit: string; qty: number; note?: string | null };

export async function createSupplyRequest(
  input: { warehouseId: string; needBy?: string | null; note?: string | null; items: NewItem[] },
  userId: string,
): Promise<SupplyResult> {
  const items = input.items.filter((i) => i.name.trim());
  if (!items.length) return { error: "Kamida bitta mahsulot kiriting" };
  const bad = items.find((i) => !(i.qty > 0));
  if (bad) return { error: `"${bad.name}": miqdor 0 dan katta bo'lsin` };
  const wh = await db.warehouse.findUnique({ where: { id: input.warehouseId } });
  if (!wh) return { error: "Sklad tanlanmagan" };

  const req = await db.$transaction(async (tx) => {
    const r = await tx.supplyRequest.create({
      data: {
        docNo: await nextNo(tx, "supplyRequest", "TZ"),
        warehouseId: input.warehouseId,
        needBy: input.needBy ? new Date(input.needBy) : null,
        note: input.note ?? null,
        createdById: userId,
        items: {
          create: items.map((i, n) => ({
            materialId: i.materialId || null,
            name: i.name.trim(),
            unit: i.unit.trim() || "dona",
            qty: i.qty,
            note: i.note ?? null,
            sortOrder: n,
          })),
        },
      },
      include: { items: true },
    });
    await event(tx, r.id, "NEW", userId, `${items.length} ta mahsulot so'raldi`);
    await audit(tx, userId, "CREATE", "SupplyRequest", r.id, undefined, r);
    return r;
  });
  // Zanjirning har qadamida KEYINGI xodim kutib qoladi — xabar o'sha "navbat"ni uzatadi
  notifyAfter(() => notifyRoles(["PROCUREMENT"], {
    type: "SUPPLY_NEW",
    title: `Yangi ta'minot so'rovi — ${req.docNo}`,
    body: `${wh.name} · ${items.length} ta mahsulot — narx qo'ying`,
  }, { except: userId }));
  return { id: req.id, docNo: req.docNo };
}

/** Sklad o'z so'rovini (hali narx qo'yilmagan bo'lsa) tuzatadi. */
export async function editSupplyItems(
  id: string,
  rows: { itemId: string; qty: number; note?: string | null }[],
  userId: string,
): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: true } });
  const err = guard(req, ["NEW"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const bad = rows.find((r) => !(r.qty >= 0));
  if (bad) return { error: "Miqdor manfiy bo'lmasin" };

  await db.$transaction(async (tx) => {
    for (const r of rows) {
      if (r.qty === 0) { await tx.supplyRequestItem.delete({ where: { id: r.itemId } }); continue; }
      await tx.supplyRequestItem.update({ where: { id: r.itemId }, data: { qty: r.qty, note: r.note ?? null } });
    }
    await audit(tx, userId, "UPDATE", "SupplyRequest", id, { items: req.items }, { rows });
  });
  const left = await db.supplyRequestItem.count({ where: { requestId: id } });
  if (!left) return { error: "Jadvalda qator qolmadi — zayavkani bekor qiling" };
  return { id, docNo: req.docNo };
}

// ───────────────────────── 2. Snabjeniye: narx va jami summa ─────────────────────────

export async function priceSupplyRequest(
  id: string,
  input: {
    supplierId?: string | null; note?: string | null;
    rows: { itemId: string; qty: number; price: number }[];
    delivery?: { kind?: string | null; provider?: string | null; cost?: number; note?: string | null };
  },
  userId: string,
): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: true } });
  const err = guard(req, ["NEW", "PRICED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const byId = new Map(req.items.map((i) => [i.id, i]));
  const rows = input.rows.filter((r) => byId.has(r.itemId));
  if (rows.length !== req.items.length) return { error: "Jadval o'zgargan — sahifani yangilang" };
  const bad = rows.find((r) => !(r.price >= 0) || !(r.qty >= 0));
  if (bad) return { error: `"${byId.get(bad.itemId)?.name}": miqdor va narx manfiy bo'lmasin` };
  const delivery = Math.max(0, input.delivery?.cost ?? Number(req.deliveryCost));
  const total = rows.reduce((s, r) => s + r.qty * r.price, 0) + delivery;
  if (total <= 0) return { error: "Jami summa 0 — kamida bitta qatorga narx qo'ying" };

  await db.$transaction(async (tx) => {
    for (const r of rows) await tx.supplyRequestItem.update({ where: { id: r.itemId }, data: { qty: r.qty, price: r.price } });
    await tx.supplyRequest.update({
      where: { id },
      data: {
        status: "PRICED", supplierId: input.supplierId || null,
        deliveryKind: input.delivery?.kind || null, deliveryProvider: input.delivery?.provider || null,
        deliveryCost: delivery, deliveryNote: input.delivery?.note || null,
      },
    });
    await event(tx, id, "PRICED", userId, `Jami ${ROUND(total)} so'm${delivery > 0 ? ` (dostavka ${ROUND(delivery)})` : ""}${input.note ? ` · ${input.note}` : ""}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "PRICED", total });
  });
  notifyAfter(() => notifyRoles(["SALES", "DIRECTOR"], {
    type: "SUPPLY_PRICED",
    title: `Ta'minot narxlandi — ${req.docNo}`,
    body: `Jami ${ROUND(total)} so'm — tasdiq kutilmoqda`,
  }, { except: userId }));
  return { id, docNo: req.docNo, note: `Jami summa: ${ROUND(total)}` };
}

// ───────────────────────── 3. Ma'sul xodim: tasdiqlash ─────────────────────────

export async function approveSupplyRequest(id: string, userId: string, note?: string | null): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: true } });
  const err = guard(req, ["PRICED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };

  await db.$transaction(async (tx) => {
    await tx.supplyRequest.update({ where: { id }, data: { status: "APPROVED" } });
    await event(tx, id, "APPROVED", userId, note);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "APPROVED" });
  });
  notifyAfter(() => notifyRoles(["FINANCE", "ACCOUNTING", "CASHIER"], {
    type: "SUPPLY_APPROVED",
    title: `Ta'minot tasdiqlandi — ${req.docNo}`,
    body: "Pul ajratish kutilmoqda",
  }, { except: userId }));
  return { id, docNo: req.docNo, note: "Moliya bo'limiga yuborildi" };
}

// ───────────────────────── 4. Moliya: pul ajratish (Kirim-Chiqimga chiqim) ─────────────────────────

/**
 * Moliya tasdig'i: reja summasi Kirim-Chiqimga chiqim bo'lib yoziladi va soat ikonkasi o'chadi.
 * Mol kelganda fakt summa boshqacha chiqsa — shu yozuv tuzatiladi (ikki marta hisoblanmaydi).
 */
export async function fundSupplyRequest(
  id: string,
  input: { cashAccountId: string; note?: string | null },
  userId: string,
): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: true, supplier: true } });
  const err = guard(req, ["APPROVED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const acc = await db.cashAccount.findUnique({ where: { id: input.cashAccountId } });
  if (!acc || !acc.isActive) return { error: "To'lov hisobi tanlanmagan" };
  const total = totalPlanned(req);

  await db.$transaction(async (tx) => {
    const ct = await tx.cashTransaction.create({
      data: {
        type: "EXPENSE", date: new Date(), cashAccountId: acc.id, amount: total, category: "Xomashyo",
        supplierId: req.supplierId, counterparty: req.supplier?.name ?? "Ta'minot",
        note: `Ta'minot ${req.docNo} · ${req.items.length} qator${Number(req.deliveryCost) > 0 ? ` + dostavka ${ROUND(Number(req.deliveryCost))}` : ""} (reja)`,
        refType: "SupplyRequest", refId: id, createdById: userId,
      },
    });
    await tx.supplyRequest.update({ where: { id }, data: { status: "FUNDED", cashAccountId: acc.id, cashTxId: ct.id } });
    await event(tx, id, "FUNDED", userId, `${acc.name} · ${ROUND(total)} so'm${input.note ? ` · ${input.note}` : ""}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "FUNDED", cashTxId: ct.id, total });
  });
  notifyAfter(() => notifyRoles(["PROCUREMENT", "WAREHOUSE"], {
    type: "SUPPLY_FUNDED",
    title: `Pul ajratildi — ${req.docNo}`,
    body: `${acc.name} · sotib olish mumkin`,
  }, { except: userId }));
  return { id, docNo: req.docNo, note: "Snabjeniye sotib olishi mumkin" };
}

// ───────────────────────── 5. Snabjeniye: tekshirish va qabul ─────────────────────────

export type FactRow = { itemId: string; factQty: number; factPrice: number };

/** "Tahrirlash": kelgan miqdor/narxni saqlab qo'yish (hali qabul qilmasdan). */
export async function saveSupplyFact(id: string, rows: FactRow[], userId: string): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: true } });
  const err = guard(req, ["FUNDED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const bad = rows.find((r) => !(r.factQty >= 0) || !(r.factPrice >= 0));
  if (bad) return { error: "Kelgan miqdor va narx manfiy bo'lmasin" };

  await db.$transaction(async (tx) => {
    for (const r of rows) await tx.supplyRequestItem.update({ where: { id: r.itemId }, data: { factQty: r.factQty, factPrice: r.factPrice } });
    await audit(tx, userId, "UPDATE", "SupplyRequest", id, { items: req.items }, { fact: rows });
  });
  return { id, docNo: req.docNo, note: "Tuzatishlar saqlandi" };
}

/**
 * "Qabul qildim": fakt miqdor/narx bo'yicha kirim hujjati (GoodsReceipt) va sklad kirimi (StockMove) yaraladi,
 * moliya yozgan chiqim fakt summaga tuzatiladi. Spravochnikda yo'q nomlar shu yerda xomashyo bo'lib ochiladi.
 * Kelmagan qator (fakt 0) kirimga tushmaydi — jadvalda "kelmadi" bo'lib qoladi.
 */
export async function receiveSupplyRequest(
  id: string,
  input: { supplierId?: string | null; rows: FactRow[]; note?: string | null; deliveryFactCost?: number | null },
  userId: string,
): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } }, supplier: true } });
  const err = guard(req, ["FUNDED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const supplierId = input.supplierId || req.supplierId;
  if (!supplierId) return { error: "Yetkazuvchi tanlanmagan — kirim hujjati yetkazuvchisiz yozilmaydi" };
  const byId = new Map(rows2map(input.rows));
  const bad = req.items.find((i) => { const r = byId.get(i.id); return r ? !(r.factQty >= 0) || !(r.factPrice >= 0) : false; });
  if (bad) return { error: `"${bad.name}": kelgan miqdor va narx manfiy bo'lmasin` };
  const lines = req.items.map((i) => {
    const r = byId.get(i.id);
    return { item: i, qty: r ? r.factQty : Number(i.factQty ?? i.qty), price: r ? r.factPrice : Number(i.factPrice ?? i.price) };
  });
  const arrived = lines.filter((l) => l.qty > 0);
  if (!arrived.length) return { error: "Birorta mahsulot kelmadi — qabul qilib bo'lmaydi, zayavkani bekor qiling" };
  const deliveryFact = Math.max(0, input.deliveryFactCost ?? Number(req.deliveryFactCost ?? req.deliveryCost));
  const factTotal = lines.reduce((s, l) => s + l.qty * l.price, 0) + deliveryFact;
  const planTotal = totalPlanned(req);

  // ── Narx o'zgargan bo'lsa qabul qilinmaydi: zayavka Sotuv va Moliya tasdig'iga qaytadi ──
  // (miqdor kam kelishi tasdiqni talab qilmaydi — pul baribir fakt bo'yicha tuzatiladi)
  const priceMoved = lines.filter((l) => Math.abs(l.price - Number(l.item.price)) > 0.5 && l.qty > 0);
  const deliveryMoved = Math.abs(deliveryFact - Number(req.deliveryCost)) > 0.5;
  if (priceMoved.length || deliveryMoved) {
    await db.$transaction(async (tx) => {
      for (const l of lines) {
        await tx.supplyRequestItem.update({
          where: { id: l.item.id },
          data: { prevPrice: l.item.price, price: l.price, qty: l.qty, factQty: l.qty, factPrice: l.price },
        });
      }
      // Ajratilgan pul bekor qilinadi — yangi summa tasdiqlangach qaytadan yoziladi
      if (req.cashTxId) {
        const ct = await tx.cashTransaction.findUnique({ where: { id: req.cashTxId } });
        if (ct) { await tx.cashTransaction.delete({ where: { id: ct.id } }); await audit(tx, userId, "DELETE", "CashTransaction", ct.id, ct, undefined); }
      }
      await tx.supplyRequest.update({
        where: { id },
        data: { status: "PRICED", cashTxId: null, recheck: { increment: 1 }, supplierId, deliveryCost: deliveryFact, deliveryFactCost: deliveryFact },
      });
      const what = [
        ...priceMoved.map((l) => `${l.item.name}: ${ROUND(Number(l.item.price))} → ${ROUND(l.price)}`),
        ...(deliveryMoved ? [`dostavka: ${ROUND(Number(req.deliveryCost))} → ${ROUND(deliveryFact)}`] : []),
      ];
      await event(tx, id, "PRICED", userId, `Narx o'zgardi (${what.join("; ")}) — qayta tasdiq so'raldi. Yangi jami ${ROUND(factTotal)} so'm`);
      await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status, planTotal }, { status: "PRICED", reason: "price-changed", factTotal });
    });
    return {
      id, docNo: req.docNo,
      note: `Narx o'zgardi — zayavka Sotuv va Moliya tasdig'iga qaytdi (yangi jami ${ROUND(factTotal)} so'm). Tasdiqlangach qabul qilasiz.`,
    };
  }

  const out = await db.$transaction(async (tx) => {
    // Spravochnikda yo'q qatorlar uchun xomashyo ochiladi (nomi va birligi bo'yicha)
    const need = arrived.filter((l) => !l.item.materialId).map((l) => ({ name: l.item.name, unit: l.item.unit }));
    const { result } = need.length ? await resolveMaterials(tx, need, true) : { result: new Map() };
    const withMat = arrived.map((l) => ({
      ...l,
      materialId: l.item.materialId ?? result.get(l.item.name.toLowerCase().trim())?.id,
    }));
    const lost = withMat.find((l) => !l.materialId);
    if (lost) throw new Error(`"${lost.item.name}" uchun xomashyo ochilmadi`);

    const rec = await tx.goodsReceipt.create({
      data: {
        docNo: await nextNo(tx, "goodsReceipt", "K"),
        date: new Date(), supplierId, warehouseId: req.warehouseId, createdById: userId,
        note: `Ta'minot ${req.docNo}${input.note ? ` · ${input.note}` : ""}`,
        items: { create: withMat.map((l) => ({ materialId: l.materialId!, qty: l.qty, price: l.price })) },
      },
    });
    await tx.stockMove.createMany({
      data: withMat.map((l) => ({
        type: "RECEIPT" as const, warehouseId: req.warehouseId, materialId: l.materialId!,
        qty: l.qty, unitCost: l.price, refType: "GoodsReceipt", refId: rec.id, createdById: userId,
      })),
    });
    // Har qatorga fakt yoziladi va topilgan xomashyo biriktiriladi
    for (const l of lines) {
      const m = withMat.find((w) => w.item.id === l.item.id);
      await tx.supplyRequestItem.update({ where: { id: l.item.id }, data: { factQty: l.qty, factPrice: l.price, materialId: m?.materialId ?? l.item.materialId } });
    }
    await tx.supplyRequest.update({ where: { id }, data: { deliveryFactCost: deliveryFact } });
    // Moliya yozgan chiqim — fakt summaga keltiriladi (yangi yozuv ochilmaydi)
    if (req.cashTxId) {
      const before = await tx.cashTransaction.findUnique({ where: { id: req.cashTxId } });
      if (before) {
        const after = await tx.cashTransaction.update({
          where: { id: req.cashTxId },
          data: { amount: factTotal, supplierId, note: `Ta'minot ${req.docNo} · kirim ${rec.docNo}${deliveryFact > 0 ? ` + dostavka ${ROUND(deliveryFact)}` : ""} (fakt)`, refType: "GoodsReceipt", refId: rec.id },
        });
        await audit(tx, userId, "UPDATE", "CashTransaction", after.id, before, after);
      }
    }
    await tx.supplyRequest.update({ where: { id }, data: { status: "RECEIVED", supplierId, receiptId: rec.id } });
    const missing = lines.filter((l) => l.qty <= 0).length;
    const diff = ROUND(factTotal - planTotal);
    await event(tx, id, "RECEIVED", userId, `Kirim ${rec.docNo} · fakt ${ROUND(factTotal)} so'm${diff ? ` (rejadan ${diff > 0 ? "+" : ""}${diff})` : ""}${missing ? ` · ${missing} qator kelmadi` : ""}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "RECEIVED", receiptId: rec.id, factTotal, planTotal });
    return { receiptId: rec.id, docNo: rec.docNo, diff, missing };
  }).catch((e: Error) => ({ error: e.message }));

  if ("error" in out) return { error: out.error };
  return {
    id, docNo: req.docNo,
    note: `Kirim ${out.docNo} yozildi — sklad qoldig'i oshdi${out.diff ? `, chiqim ${out.diff > 0 ? "oshdi" : "kamaydi"}` : ""}${out.missing ? `, ${out.missing} qator kelmadi` : ""}`,
  };
}

const rows2map = (rows: FactRow[]): [string, FactRow][] => rows.map((r) => [r.itemId, r]);

// ───────────────────────── Bekor qilish ─────────────────────────

/** Har qanday ochiq bosqichda bekor qilish. Pul ajratilgan bo'lsa — chiqim yozuvi olib tashlanadi. */
export async function rejectSupplyRequest(id: string, userId: string, reason: string): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id } });
  const err = guard(req, ["NEW", "PRICED", "APPROVED", "FUNDED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  if (!reason.trim()) return { error: "Bekor qilish sababini yozing" };

  await db.$transaction(async (tx) => {
    if (req.cashTxId) {
      const ct = await tx.cashTransaction.findUnique({ where: { id: req.cashTxId } });
      if (ct) {
        await tx.cashTransaction.delete({ where: { id: ct.id } });
        await audit(tx, userId, "DELETE", "CashTransaction", ct.id, ct, undefined);
      }
    }
    await tx.supplyRequest.update({ where: { id }, data: { status: "REJECTED", cashTxId: null } });
    await event(tx, id, "REJECTED", userId, `${SUPPLY_LABEL[req.status]} bosqichida: ${reason.trim()}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "REJECTED", reason });
  });
  // So'rovni kiritgan sklad/snabjeniye xodimi nega to'xtaganini bilsin
  notifyAfter(() => notifyUsers([req.createdById], {
    type: "SUPPLY_REJECTED",
    title: `Ta'minot bekor qilindi — ${req.docNo}`,
    body: reason.trim(),
  }));
  return { id, docNo: req.docNo, note: "Zayavka bekor qilindi" };
}

// ───────────────────────── Oldingi narx (taqqoslash) ─────────────────────────

export type LastPrice = { price: number; date: Date; supplier: string; qty: number; material: string };

/** Qator kaliti: spravochnikdagi mahsulot bo'lsa id, bo'lmasa nomi. Taqqoslash faqat shu kalit bo'yicha. */
export const priceKey = (i: { materialId?: string | null; name: string }) => i.materialId ?? `name:${i.name.trim().toLowerCase()}`;

/**
 * Har bir qator uchun AYNAN O'SHA mahsulotning oxirgi xarid narxi (kirim hujjatlaridan).
 * Boshqa mahsulot bilan taqqoslanmaydi: spravochnikdagi qator id bo'yicha, spravochnikda
 * yo'q qator esa aynan shu nomdagi xomashyo bo'yicha qidiriladi. Topilmasa — "birinchi marta".
 */
export async function lastPurchasePrices(items: { materialId?: string | null; name: string }[]): Promise<Map<string, LastPrice>> {
  const out = new Map<string, LastPrice>();
  if (!items.length) return out;
  // Spravochnikda yo'q qatorlar: aynan shu nom bo'yicha xomashyo bor-yo'qligini qidiramiz
  const names = [...new Set(items.filter((i) => !i.materialId).map((i) => i.name.trim()).filter(Boolean))];
  const byName = names.length
    ? await db.material.findMany({ where: { OR: names.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })) }, select: { id: true, name: true } })
    : [];
  const nameToId = new Map(byName.map((m) => [m.name.trim().toLowerCase(), m.id]));

  // Qator kaliti ↔ material id
  const keyToId = new Map<string, string>();
  for (const i of items) {
    const id = i.materialId ?? nameToId.get(i.name.trim().toLowerCase());
    if (id) keyToId.set(priceKey(i), id);
  }
  const ids = [...new Set(keyToId.values())];
  if (!ids.length) return out;

  // Har bir xomashyo bo'yicha eng oxirgi kirim qatori
  const rows = await db.goodsReceiptItem.findMany({
    where: { materialId: { in: ids } },
    orderBy: { receipt: { date: "desc" } },
    take: 1000,
    include: { receipt: { select: { date: true, supplier: { select: { name: true } } } }, material: { select: { name: true } } },
  });
  const latest = new Map<string, LastPrice>();
  for (const r of rows) {
    if (latest.has(r.materialId)) continue;
    latest.set(r.materialId, { price: Number(r.price), date: r.receipt.date, supplier: r.receipt.supplier.name, qty: Number(r.qty), material: r.material.name });
  }
  for (const [key, id] of keyToId) {
    const v = latest.get(id);
    if (v) out.set(key, v);
  }
  return out;
}

/** Narx farqi: oldingi xariddan necha foiz qimmat/arzon. */
export const priceDelta = (now: number, was: number) => (was > 0 ? ((now - was) / was) * 100 : 0);

// ───────────────────────── Ro'yxatlar ─────────────────────────

export const SUPPLY_TABS: { key: string; label: string; status: SupplyStatus[] }[] = [
  { key: "open", label: "Ochiq", status: ["NEW", "PRICED", "APPROVED", "FUNDED"] },
  { key: "NEW", label: "Narx kutmoqda", status: ["NEW"] },
  { key: "PRICED", label: "Tasdiq kutmoqda", status: ["PRICED"] },
  { key: "APPROVED", label: "Moliya kutmoqda", status: ["APPROVED"] },
  { key: "FUNDED", label: "Tasdiqdan o'tdi", status: ["FUNDED"] },
  { key: "RECEIVED", label: "Qabul qilingan", status: ["RECEIVED"] },
  { key: "REJECTED", label: "Bekor qilingan", status: ["REJECTED"] },
];

export const supplyTab = (key?: string) => SUPPLY_TABS.find((t) => t.key === key) ?? SUPPLY_TABS[0];

export const supplyList = (status: SupplyStatus[], take = 200) =>
  db.supplyRequest.findMany({
    where: { status: { in: status } },
    orderBy: [{ date: "desc" }],
    take,
    include: { items: true, warehouse: true, supplier: true, createdBy: { select: { fullName: true } } },
  });

/** Bo'limlar uchun kutayotganlar soni (menyu va bosh sahifa belgilari). */
export async function supplyCounts() {
  const rows = await db.supplyRequest.groupBy({ by: ["status"], _count: { _all: true } });
  const by = (s: SupplyStatus) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { NEW: by("NEW"), PRICED: by("PRICED"), APPROVED: by("APPROVED"), FUNDED: by("FUNDED"), RECEIVED: by("RECEIVED"), REJECTED: by("REJECTED") };
}
