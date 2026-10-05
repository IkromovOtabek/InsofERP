import type { Prisma, Role, SupplyStatus } from "@/generated/prisma";
import { normalizeUnit, toMaterialUnit, UNIT_FALLBACK } from "./unit";
import { MAX_AMOUNT } from "./action";
import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { resolveMaterials } from "./import-materials";
import { notifyAfter, notifyRoles, notifyUsers } from "./notify";
import { getCompany } from "./company";
import { cashOutflowError } from "./payments";
import { companyVatPayer, supplierVatRate, vatLine } from "./receipt-vat";

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
  responsible: { select: { id: true, fullName: true } },
  quotes: { orderBy: { createdAt: "asc" }, include: { createdBy: { select: { fullName: true } } } },
  incidents: { orderBy: { createdAt: "desc" }, include: { createdBy: { select: { fullName: true } } } },
  documents: { orderBy: { createdAt: "desc" }, include: { createdBy: { select: { fullName: true } } } },
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

/**
 * Bosqich o'tishi tranzaksiya ichida shartli: zayavka hali `from` bosqichida bo'lsagina o'zgaradi.
 * Ikki marta bosish, veb va ilovadan bir vaqtda yuborish — ikkinchisi hech narsa yozmaydi
 * (aks holda kirim ikki marta skladga tushar, chiqim ikki marta kassaga yozilardi).
 */
const QTY_TOLERANCE = 1.02;
const STALE = "Zayavka boshqa joyda o'zgartirildi — sahifani yangilang";
async function claim(tx: Tx, id: string, from: SupplyStatus[], data: Prisma.SupplyRequestUncheckedUpdateManyInput) {
  const r = await tx.supplyRequest.updateMany({ where: { id, status: { in: from } }, data });
  if (r.count !== 1) throw new Error(STALE);
}
/** Formadan kelgan qator id'lari shu zayavkaniki ekanini tekshiradi (boshqa zayavka qatoriga tegilmasin). */
function foreignRow(req: { items: { id: string }[] }, ids: string[]): boolean {
  const own = new Set(req.items.map((i) => i.id));
  return ids.some((i) => !own.has(i));
}
const event = (tx: Tx, requestId: string, stage: SupplyStatus, userId: string, note?: string | null) =>
  tx.supplyEvent.create({ data: { requestId, stage, userId, note: note ?? undefined } });

// ───────────────────────── 1. Sklad: kerakli mahsulotlar jadvali ─────────────────────────

export type NewItem = { materialId?: string | null; name: string; unit: string; qty: number; note?: string | null };

export async function createSupplyRequest(
  input: {
    warehouseId: string; needBy?: string | null; note?: string | null; items: NewItem[];
    /** Snabjeniye TZ: qaysi bo'lim so'rayapti va qanchalik shoshilinch */
    department?: string | null; priority?: "NORMAL" | "HIGH" | "CRITICAL" | null;
  },
  userId: string,
): Promise<SupplyResult> {
  if (!Array.isArray(input.items)) return { error: "Jadval o'qilmadi" };
  const raw = input.items.filter((i) => i && typeof i.name === "string" && i.name.trim());
  if (!raw.length) return { error: "Kamida bitta mahsulot kiriting" };
  const bad = raw.find((i) => !(Number(i.qty) > 0) || Number(i.qty) > MAX_AMOUNT);
  if (bad) return { error: `"${bad.name}": miqdor 0 dan katta (va juda katta bo'lmagan) raqam bo'lsin` };
  if (input.needBy && !Number.isFinite(new Date(input.needBy).getTime())) return { error: "Kerak sana noto'g'ri" };
  const wh = await db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true } });
  if (!wh) return { error: "Sklad tanlanmagan" };

  // Birlik brauzerdan emas, spravochnikdan: tanlangan xomashyo bazadan yuklanadi, noma'lum id — forma xatosi.
  // Birlik xomashyo birligi bo'ladi; faqat kg ↔ t farqiga ruxsat (qabulda o'zi o'giriladi — `toMaterialUnit`).
  const ids = [...new Set(raw.map((i) => i.materialId).filter((x): x is string => typeof x === "string" && !!x))];
  const mats = ids.length ? await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true, isActive: true } }) : [];
  const byId = new Map(mats.map((m) => [m.id, m]));
  const items: { materialId: string | null; name: string; unit: string; qty: number; note: string | null }[] = [];
  for (const i of raw) {
    const qty = Number(i.qty);
    const note = typeof i.note === "string" && i.note.trim() ? i.note.trim() : null;
    if (i.materialId) {
      const m = byId.get(i.materialId);
      if (!m || !m.isActive) return { error: `"${i.name}" spravochnikda topilmadi — qatorni qayta tanlang` };
      const asked = normalizeUnit(i.unit);
      const unit = !asked || asked === m.unit ? m.unit : toMaterialUnit(1, 0, asked, m.unit) ? asked : null;
      if (!unit) return { error: `"${m.name}": birligi «${m.unit}», so'rovda «${String(i.unit)}» — faqat kg ↔ t o'girish mumkin` };
      items.push({ materialId: m.id, name: m.name, unit, qty, note });
    } else {
      // Spravochnikda yo'q (yangi) mahsulot — birlik tanilgan ro'yxatdan, tanilmasa "dona"
      items.push({ materialId: null, name: i.name.trim().slice(0, 200), unit: normalizeUnit(i.unit) ?? UNIT_FALLBACK, qty, note });
    }
  }

  const req = await db.$transaction(async (tx) => {
    const r = await tx.supplyRequest.create({
      data: {
        docNo: await nextNo(tx, "supplyRequest", "TZ"),
        warehouseId: input.warehouseId,
        needBy: input.needBy ? new Date(input.needBy) : null,
        note: input.note ?? null,
        department: input.department || null,
        priority: input.priority ?? "NORMAL",
        createdById: userId,
        items: {
          create: items.map((i, n) => ({ ...i, sortOrder: n })),
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
    body: `${input.department || wh.name} · ${items.length} ta mahsulot${input.priority === "CRITICAL" ? " · KRITIK" : input.priority === "HIGH" ? " · shoshilinch" : ""} — narx qo'ying`,
    link: { key: "supply", id: req.id },
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
  if (foreignRow(req, rows.map((r) => r.itemId))) return { error: "Jadval o'zgargan — sahifani yangilang" };
  // Hamma qator 0 qilinsa — zayavka bo'sh qolardi (ilgari tekshiruv o'chirishdan KEYIN edi: qatorlar o'chib bo'lgach xato chiqardi)
  const zeroed = new Set(rows.filter((r) => r.qty === 0).map((r) => r.itemId));
  if (req.items.every((i) => zeroed.has(i.id))) return { error: "Hamma qatorni 0 qilib bo'lmaydi — zayavka kerak bo'lmasa, uni bekor qiling" };

  const res = await db.$transaction(async (tx) => {
    await claim(tx, id, ["NEW"], { updatedAt: new Date() });
    for (const r of rows) {
      if (r.qty === 0) { await tx.supplyRequestItem.deleteMany({ where: { id: r.itemId, requestId: id } }); continue; }
      await tx.supplyRequestItem.updateMany({ where: { id: r.itemId, requestId: id }, data: { qty: r.qty, note: r.note ?? null } });
    }
    await audit(tx, userId, "UPDATE", "SupplyRequest", id, { items: req.items }, { rows });
  }).catch((e: Error) => ({ error: e.message }));
  if (res && "error" in res) return { error: res.error };
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
  role?: Role,
): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: true } });
  const err = guard(req, ["NEW", "PRICED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const byId = new Map(req.items.map((i) => [i.id, i]));
  const rows = input.rows.filter((r) => byId.has(r.itemId));
  if (rows.length !== req.items.length) return { error: "Jadval o'zgargan — sahifani yangilang" };
  const bad = rows.find((r) => !(r.price >= 0) || !(r.qty >= 0) || r.price > MAX_AMOUNT || r.qty > MAX_AMOUNT);
  if (bad) return { error: `"${byId.get(bad.itemId)?.name}": miqdor va narx manfiy (yoki juda katta) bo'lmasin` };
  if (input.supplierId && !(await db.supplier.count({ where: { id: input.supplierId, isActive: true } }))) return { error: "Yetkazuvchi topilmadi yoki yopilgan" };
  const delivery = Math.max(0, input.delivery?.cost ?? Number(req.deliveryCost));
  const goods = rows.reduce((s, r) => s + r.qty * r.price, 0);
  const total = goods + delivery;
  if (!Number.isFinite(total) || total > MAX_AMOUNT) return { error: "Jami summa juda katta" };
  if (total <= 0) return { error: "Jami summa 0 — kamida bitta qatorga narx qo'ying" };
  // Hamma qator miqdori 0 qilinib "faqat dostavka" zayavkasiga aylantirilmasin: kamida bitta haqiqiy mol bo'lsin
  if (!rows.some((r) => r.qty > 0 && r.price > 0)) return { error: "Kamida bitta qatorda miqdor ham, narx ham 0 dan katta bo'lsin" };
  // Dostavka mol summasidan qimmat — g'alati holat: snabjeniye yuborolmaydi, faqat direktor o'zi narxlasa o'tadi
  if (delivery > goods + 0.5 && role !== "DIRECTOR") {
    return { error: `Dostavka (${ROUND(delivery)} so'm) mahsulot summasidan (${ROUND(goods)} so'm) katta — narxni tekshiring yoki direktor bilan kelishing` };
  }
  // So'ralgan vs narxlangan: miqdori o'zgargan qatorlar tarixda va auditda ko'rinsin
  const qtyChanged = rows.filter((r) => Math.abs(r.qty - Number(byId.get(r.itemId)!.qty)) > 0.0005);

  const res = await db.$transaction(async (tx) => {
    // Narx faqat hali tasdiqlanmagan zayavkaga qo'yiladi — tasdiq bilan bir vaqtda kelsa, tasdiq ustun
    await claim(tx, id, ["NEW", "PRICED"], {
      status: "PRICED", supplierId: input.supplierId || null,
      deliveryKind: input.delivery?.kind || null, deliveryProvider: input.delivery?.provider || null,
      deliveryCost: delivery, deliveryNote: input.delivery?.note || null,
      // Summa o'zgargan bo'lishi mumkin — direktorning oldingi tasdig'i kuchini yo'qotadi
      directorOkAt: null, directorOkById: null,
    });
    for (const r of rows) await tx.supplyRequestItem.update({ where: { id: r.itemId }, data: { qty: r.qty, price: r.price } });
    await event(tx, id, "PRICED", userId, `Jami ${ROUND(total)} so'm${delivery > 0 ? ` (dostavka ${ROUND(delivery)})` : ""}${
      qtyChanged.length ? ` · miqdor o'zgardi: ${qtyChanged.map((r) => `${byId.get(r.itemId)!.name} ${Number(byId.get(r.itemId)!.qty)} → ${r.qty}`).join("; ")}` : ""}${input.note ? ` · ${input.note}` : ""}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id,
      { status: req.status, items: req.items.map((i) => ({ id: i.id, name: i.name, qty: Number(i.qty), price: Number(i.price) })), deliveryCost: Number(req.deliveryCost) },
      { status: "PRICED", total, delivery, items: rows.map((r) => ({ id: r.itemId, name: byId.get(r.itemId)!.name, askedQty: Number(byId.get(r.itemId)!.qty), qty: r.qty, price: r.price })) });
  }).catch((e: Error) => ({ error: e.message }));
  if (res && "error" in res) return { error: res.error };
  // Katta xarid (Sozlamalardagi chegaradan oshsa) — avval direktor tasdiqlaydi, sotuv keyin
  const limit = Number((await getCompany()).supplyDirectorLimit);
  if (limit > 0 && total >= limit) {
    notifyAfter(() => notifyRoles(["DIRECTOR"], {
      type: "SUPPLY_DIRECTOR",
      title: `Katta xarid tasdig'i — ${req.docNo}`,
      body: `Jami ${ROUND(total)} so'm — chegara ${ROUND(limit)} dan oshdi`,
      link: { key: "supply", id },
    }, { except: userId }));
    return { id, docNo: req.docNo, note: `Jami summa: ${ROUND(total)} — chegaradan katta, avval direktor tasdiqlaydi` };
  }
  // Tasdiq — sotuv (ma'sul xodim) ishi; direktorga bu bosqich haqida xabar ketmaydi
  notifyAfter(() => notifyRoles(["SALES"], {
    type: "SUPPLY_PRICED",
    title: `Ta'minot narxlandi — ${req.docNo}`,
    body: `Jami ${ROUND(total)} so'm — tasdiq kutilmoqda`,
    link: { key: "supply", id },
  }, { except: userId }));
  return { id, docNo: req.docNo, note: `Jami summa: ${ROUND(total)}` };
}

// ───────────────────────── 3. Ma'sul xodim: tasdiqlash ─────────────────────────

export async function approveSupplyRequest(id: string, userId: string, note?: string | null): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id }, include: { items: true } });
  const err = guard(req, ["PRICED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const limit = Number((await getCompany()).supplyDirectorLimit);
  if (limit > 0 && totalPlanned(req) >= limit && !req.directorOkAt) {
    return { error: `Jami summa ${ROUND(totalPlanned(req))} so'm — ${ROUND(limit)} dan katta xarid avval direktor tasdig'idan o'tadi` };
  }

  const res = await db.$transaction(async (tx) => {
    // `updatedAt` ham mos kelishi shart: o'qigandan keyin narx qayta qo'yilgan bo'lsa, eski summa tasdiqlanmasin
    const r = await tx.supplyRequest.updateMany({ where: { id, status: "PRICED", updatedAt: req.updatedAt }, data: { status: "APPROVED" } });
    if (r.count !== 1) throw new Error(STALE);
    await event(tx, id, "APPROVED", userId, note);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "APPROVED" });
  }).catch((e: Error) => ({ error: e.message }));
  if (res && "error" in res) return { error: res.error };
  notifyAfter(() => notifyRoles(["FINANCE", "ACCOUNTING", "CASHIER"], {
    type: "SUPPLY_APPROVED",
    title: `Ta'minot tasdiqlandi — ${req.docNo}`,
    body: "Pul ajratish kutilmoqda",
    link: { key: "supply", id },
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

  const res = await db.$transaction(async (tx) => {
    // Avval bosqich egallanadi — ikkinchi bosish chiqimni ikki marta yozmasin
    await claim(tx, id, ["APPROVED"], { status: "FUNDED", cashAccountId: acc.id, deliveryStatus: "PLANNED" });
    const data = {
      cashAccountId: acc.id, amount: total, category: "Xomashyo",
      supplierId: req.supplierId, counterparty: req.supplier?.name ?? "Ta'minot",
      note: `Ta'minot ${req.docNo} · ${req.items.length} qator${Number(req.deliveryCost) > 0 ? ` + dostavka ${ROUND(Number(req.deliveryCost))}` : ""} (reja${req.recheck > 0 ? `, ${req.recheck}-qayta tasdiq` : ""})`,
    };
    // Narx o'zgarib qayta tasdiqqa qaytgan zayavkada chiqim allaqachon bor — yangisi ochilmaydi, o'sha tuzatiladi
    const prev = req.cashTxId ? await tx.cashTransaction.findUnique({ where: { id: req.cashTxId } }) : null;
    // Naqd kassa minusga tushmasin (hisob bo'yicha qulf ostida). Mavjud chiqim tuzatilsa — faqat o'sgan qismi tekshiriladi
    const extra = prev && prev.cashAccountId === acc.id ? total - Number(prev.amount) : total;
    if (extra > 0.005) {
      const cashErr = await cashOutflowError(tx, acc.id, extra);
      if (cashErr) throw new Error(cashErr);
    }
    const ct = prev
      ? await tx.cashTransaction.update({ where: { id: prev.id }, data })
      : await tx.cashTransaction.create({ data: { ...data, type: "EXPENSE", date: new Date(), refType: "SupplyRequest", refId: id, createdById: userId } });
    if (prev) await audit(tx, userId, "UPDATE", "CashTransaction", ct.id, prev, ct);
    else await tx.supplyRequest.update({ where: { id }, data: { cashTxId: ct.id } });
    await event(tx, id, "FUNDED", userId, `${acc.name} · ${ROUND(total)} so'm${input.note ? ` · ${input.note}` : ""}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "FUNDED", cashTxId: ct.id, total });
  }).catch((e: Error) => ({ error: e.message }));
  if (res && "error" in res) return { error: res.error };
  notifyAfter(() => notifyRoles(["PROCUREMENT", "WAREHOUSE"], {
    type: "SUPPLY_FUNDED",
    title: `Pul ajratildi — ${req.docNo}`,
    body: `${acc.name} · sotib olish mumkin`,
    link: { key: "supply", id },
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
  if (foreignRow(req, rows.map((r) => r.itemId))) return { error: "Jadval o'zgargan — sahifani yangilang" };

  await db.$transaction(async (tx) => {
    for (const r of rows) await tx.supplyRequestItem.updateMany({ where: { id: r.itemId, requestId: id }, data: { factQty: r.factQty, factPrice: r.factPrice } });
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
  // Formadan kelgan yetkazuvchi mavjud bo'lsin — aks holda kirim yozilayotganda Prisma (FK) matni chiqardi
  if (supplierId !== req.supplierId && !(await db.supplier.count({ where: { id: supplierId, isActive: true } }))) return { error: "Yetkazuvchi topilmadi yoki yopilgan" };
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
  // Miqdor tasdiqlangandan sezilarli ko'p kelsa ham summa oshadi — bu ham qayta tasdiqsiz o'tmasin
  // (2% — tarozi farqi uchun zaxira)
  const qtyGrew = lines.filter((l) => l.qty > Number(l.item.qty) * QTY_TOLERANCE + 0.001);
  const deliveryMoved = Math.abs(deliveryFact - Number(req.deliveryCost)) > 0.5;
  if (priceMoved.length || qtyGrew.length || deliveryMoved) {
    const res = await db.$transaction(async (tx) => {
      await claim(tx, id, ["FUNDED"], { updatedAt: new Date() });
      for (const l of lines) {
        await tx.supplyRequestItem.update({
          where: { id: l.item.id },
          data: { prevPrice: l.item.price, price: l.price, qty: l.qty, factQty: l.qty, factPrice: l.price },
        });
      }
      // Ajratilgan pul (chiqim) o'chirilmaydi — pul yetkazuvchiga ketgan bo'lishi mumkin. Yozuv joyida qoladi,
      // yangi summa moliya qayta tasdiqlaganda (`fundSupplyRequest`) shu yozuvning o'zi tuzatiladi
      await tx.supplyRequest.update({
        where: { id },
        data: { status: "PRICED", recheck: { increment: 1 }, supplierId, deliveryCost: deliveryFact, deliveryFactCost: deliveryFact, directorOkAt: null, directorOkById: null },
      });
      const what = [
        ...priceMoved.map((l) => `${l.item.name}: ${ROUND(Number(l.item.price))} → ${ROUND(l.price)}`),
        ...qtyGrew.filter((l) => !priceMoved.includes(l)).map((l) => `${l.item.name}: miqdor ${Number(l.item.qty)} → ${l.qty}`),
        ...(deliveryMoved ? [`dostavka: ${ROUND(Number(req.deliveryCost))} → ${ROUND(deliveryFact)}`] : []),
      ];
      await event(tx, id, "PRICED", userId, `Summa o'zgardi (${what.join("; ")}) — qayta tasdiq so'raldi. Yangi jami ${ROUND(factTotal)} so'm`);
      await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status, planTotal }, { status: "PRICED", reason: qtyGrew.length && !priceMoved.length ? "qty-grew" : "price-changed", factTotal });
    }).catch((e: Error) => ({ error: e.message }));
    if (res && "error" in res) return { error: res.error };
    return {
      id, docNo: req.docNo,
      note: `${priceMoved.length || deliveryMoved ? "Narx" : "Miqdor"} o'zgardi — zayavka Sotuv va Moliya tasdig'iga qaytdi (yangi jami ${ROUND(factTotal)} so'm). Tasdiqlangach qabul qilasiz.`,
    };
  }

  const out = await db.$transaction(async (tx) => {
    // Qabul bir marta: ikkinchi bosish (yoki veb + ilova) kirimni ikki marta yozmasin
    await claim(tx, id, ["FUNDED"], { status: "RECEIVED" });
    // Spravochnikda yo'q qatorlar uchun xomashyo ochiladi (nomi va birligi bo'yicha)
    const need = arrived.filter((l) => !l.item.materialId).map((l) => ({ name: l.item.name, unit: l.item.unit }));
    const { result } = need.length ? await resolveMaterials(tx, need, true) : { result: new Map() };
    const withMat = arrived.map((l) => ({
      ...l,
      materialId: l.item.materialId ?? result.get(l.item.name.toLowerCase().trim())?.id,
    }));
    const lost = withMat.find((l) => !l.materialId);
    if (lost) throw new Error(`"${lost.item.name}" uchun xomashyo ochilmadi`);
    // Qator birligi (masalan "t") xomashyo birligidan ("kg") farq qilsa — skladga o'girib yoziladi.
    // Summa o'zgarmaydi (miqdor × narx bir xil), faqat birlik to'g'rilanadi.
    const units = new Map((await tx.material.findMany({ where: { id: { in: withMat.map((l) => l.materialId!) } }, select: { id: true, unit: true } })).map((m) => [m.id, m.unit]));
    const stockLines = withMat.map((l) => {
      const conv = toMaterialUnit(l.qty, l.price, l.item.unit, units.get(l.materialId!) ?? l.item.unit);
      if (!conv) throw new Error(`"${l.item.name}": zayavkada birlik «${l.item.unit}», xomashyo spravochnikda «${units.get(l.materialId!)}» — o'girib bo'lmaydi`);
      return { ...l, qty: conv.qty, price: conv.price };
    });

    // QQS: ta'minot zanjiridagi narx — yetkazuvchiga TO'LANADIGAN narx (QQS bilan; moliya shu summani ajratgan).
    // Kirim qatorida u QQS'siz narx + QQS ga ajratiladi: hujjat jami (QQS bilan) fakt summaga teng qoladi,
    // sklad tannarxi esa korxona QQS to'lovchisi bo'lsa QQS'siz (`lib/receipt-vat.ts`)
    const sup = await tx.supplier.findUnique({ where: { id: supplierId }, select: { vatPayer: true } });
    const rate = supplierVatRate(sup?.vatPayer ?? true);
    const vatPayer = await companyVatPayer(tx);
    const vatLines = stockLines.map((l) => ({ materialId: l.materialId!, ...vatLine(l.qty, l.price, rate, vatPayer, true) }));
    const rec = await tx.goodsReceipt.create({
      data: {
        docNo: await nextNo(tx, "goodsReceipt", "K"),
        date: new Date(), supplierId, warehouseId: req.warehouseId, createdById: userId,
        note: `Ta'minot ${req.docNo}${input.note ? ` · ${input.note}` : ""}`,
        items: { create: vatLines.map((l) => ({ materialId: l.materialId, qty: l.qty, price: l.price, vatRate: l.vatRate, vatAmount: l.vatAmount })) },
      },
    });
    await tx.stockMove.createMany({
      data: vatLines.map((l) => ({
        type: "RECEIPT" as const, warehouseId: req.warehouseId, materialId: l.materialId,
        qty: l.qty, unitCost: l.unitCost, refType: "GoodsReceipt", refId: rec.id, createdById: userId,
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
        // Fakt summa rejadan oshsa — farq kassadan qo'shimcha chiqadi: naqd kassa minusga tushmasin
        const extra = factTotal - Number(before.amount);
        if (extra > 0.005) {
          const cashErr = await cashOutflowError(tx, before.cashAccountId, extra);
          if (cashErr) throw new Error(`Fakt summa rejadan ${ROUND(extra)} so'm ko'p. ${cashErr}`);
        }
        const after = await tx.cashTransaction.update({
          where: { id: req.cashTxId },
          data: { amount: factTotal, supplierId, note: `Ta'minot ${req.docNo} · kirim ${rec.docNo}${deliveryFact > 0 ? ` + dostavka ${ROUND(deliveryFact)}` : ""} (fakt)`, refType: "GoodsReceipt", refId: rec.id },
        });
        await audit(tx, userId, "UPDATE", "CashTransaction", after.id, before, after);
      }
    }
    await tx.supplyRequest.update({ where: { id }, data: { supplierId, receiptId: rec.id, deliveryStatus: "RECEIVED", arrivedAt: req.arrivedAt ?? new Date() } });
    const missing = lines.filter((l) => l.qty <= 0).length;
    const diff = ROUND(factTotal - planTotal);
    await event(tx, id, "RECEIVED", userId, `Kirim ${rec.docNo} · fakt ${ROUND(factTotal)} so'm${diff ? ` (rejadan ${diff > 0 ? "+" : ""}${diff})` : ""}${missing ? ` · ${missing} qator kelmadi` : ""}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "RECEIVED", receiptId: rec.id, factTotal, planTotal });
    return { receiptId: rec.id, docNo: rec.docNo, diff, missing };
  }).catch((e: Error) => ({ error: e.message }));

  if ("error" in out) return { error: out.error };
  // Qabul qilingan miqdor buyurtmadan farq qilsa — snabjeniye va sklad bilsin (2% tarozi zaxirasi)
  const short = lines.filter((l) => l.qty < Number(l.item.qty) / QTY_TOLERANCE - 0.001);
  if (short.length) {
    notifyAfter(() => notifyRoles(["PROCUREMENT", "WAREHOUSE"], {
      type: "SUPPLY_QTY_DIFF",
      title: `Miqdor farq qildi — ${req.docNo}`,
      body: short.slice(0, 3).map((l) => `${l.item.name}: ${Number(l.item.qty)} → ${l.qty} ${l.item.unit}`).join("; "),
      link: { key: "supply", id },
    }, { except: userId }));
  }
  return {
    id, docNo: req.docNo,
    note: `Kirim ${out.docNo} yozildi — sklad qoldig'i oshdi${out.diff ? `, chiqim ${out.diff > 0 ? "oshdi" : "kamaydi"}` : ""}${out.missing ? `, ${out.missing} qator kelmadi` : ""}`,
  };
}

const rows2map = (rows: FactRow[]): [string, FactRow][] => rows.map((r) => [r.itemId, r]);

// ───────────────────────── Bekor qilish ─────────────────────────

/** Pul bosqichidagi (moliya tasdiqlagan yoki pul ajratilgan) zayavkani bekor qila oladiganlar. */
export const SUPPLY_MONEY_REJECTERS: Role[] = ["FINANCE", "ACCOUNTING", "DIRECTOR"];

/**
 * Kim bekor qila oladi (veb, mobil va server bir qoidadan):
 *  · NEW / PRICED (pul hali ajratilmagan) — so'rovni yaratgan xodim, snabjeniye (PROCUREMENT, uning o'rnidagi
 *    WAREHOUSE), PRICED bosqichida tasdiqlovchi sotuv, direktor;
 *  · APPROVED / FUNDED, yoki chiqim allaqachon yozilgan (narx o'zgarib qayta tasdiqqa qaytgan) — faqat
 *    moliya/buxgalteriya/direktor: pul masalasi, sklad bekor qilsa to'lov "osilib" qoladi.
 */
export function canRejectSupply(
  req: { status: SupplyStatus; createdById: string; cashTxId: string | null },
  user: { id: string; role: Role },
): boolean {
  if (!isOpenSupply(req.status)) return false;
  if (req.status === "APPROVED" || req.status === "FUNDED" || req.cashTxId) return SUPPLY_MONEY_REJECTERS.includes(user.role);
  if (user.role === "DIRECTOR" || user.role === "PROCUREMENT" || user.role === "WAREHOUSE") return true;
  if (req.status === "PRICED" && user.role === "SALES") return true;
  return req.createdById === user.id;
}

/**
 * Ochiq zayavkani bekor qilish. Pul ajratilgan bo'lsa chiqim (CashTransaction) HECH QACHON o'chirilmaydi:
 * pul yetkazuvchiga ketgan bo'lishi mumkin. Chiqim joyida qoladi, izohiga "yetkazuvchidan qaytarilishi kerak"
 * belgisi yoziladi, zayavka tarixiga hodisa, auditga yozuv va moliya bo'limiga xabar ketadi.
 */
export async function rejectSupplyRequest(id: string, user: { id: string; role: Role }, reason: string): Promise<SupplyResult> {
  const userId = user.id;
  const req = await db.supplyRequest.findUnique({ where: { id } });
  const err = guard(req, ["NEW", "PRICED", "APPROVED", "FUNDED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  if (!canRejectSupply(req, user)) {
    return {
      error: req.status === "APPROVED" || req.status === "FUNDED" || req.cashTxId
        ? "Moliya tasdig'idan o'tgan zayavkani faqat moliya, buxgalteriya yoki direktor bekor qiladi"
        : "Bu zayavkani so'rovni kiritgan xodim yoki snabjeniye bekor qiladi",
    };
  }
  if (!reason.trim()) return { error: "Bekor qilish sababini yozing" };
  const why = reason.trim();

  const res = await db.$transaction(async (tx) => {
    // Qabul bilan bir vaqtda bekor qilinmasin — kirim yozilgan zayavka bekor bo'lib qolardi
    await claim(tx, id, ["NEW", "PRICED", "APPROVED", "FUNDED"], { status: "REJECTED" });
    let refund: { amount: number } | null = null;
    if (req.cashTxId) {
      const ct = await tx.cashTransaction.findUnique({ where: { id: req.cashTxId } });
      if (ct) {
        // Chiqim o'chirilmaydi — faqat belgi: pul yetkazuvchidan qaytarilishi (yoki boshqa xaridga hisoblanishi) kerak
        const mark = `BEKOR QILINGAN ZAYAVKA ${req.docNo} — yetkazuvchidan qaytarilishi kerak (${why})`;
        const after = await tx.cashTransaction.update({
          where: { id: ct.id },
          data: { note: ct.note?.includes("yetkazuvchidan qaytarilishi kerak") ? ct.note : `${ct.note ? `${ct.note} · ` : ""}${mark}` },
        });
        await audit(tx, userId, "UPDATE", "CashTransaction", ct.id, ct, after);
        refund = { amount: Number(ct.amount) };
      }
    }
    await event(tx, id, "REJECTED", userId,
      `${SUPPLY_LABEL[req.status]} bosqichida: ${why}${refund ? ` · ajratilgan ${ROUND(refund.amount)} so'm chiqim joyida qoldi — yetkazuvchidan qaytarilishi kerak` : ""}`);
    await audit(tx, userId, "STATUS_CHANGE", "SupplyRequest", id, { status: req.status }, { status: "REJECTED", reason: why, cashTxId: req.cashTxId, refundDue: refund?.amount ?? 0 });
    return refund;
  }).catch((e: Error) => ({ error: e.message }));
  if (res && "error" in res) return { error: res.error };
  // So'rovni kiritgan sklad/snabjeniye xodimi nega to'xtaganini bilsin
  notifyAfter(() => notifyUsers([req.createdById], {
    type: "SUPPLY_REJECTED",
    title: `Ta'minot bekor qilindi — ${req.docNo}`,
    body: why,
    link: { key: "supply", id },
  }));
  if (res) {
    // Pul chiqib ketgan — moliya qaytarib olishni kuzatsin
    notifyAfter(() => notifyRoles(["FINANCE", "ACCOUNTING", "DIRECTOR"], {
      type: "SUPPLY_REFUND_DUE",
      title: `Bekor qilingan ta'minot — pul qaytarilishi kerak · ${req.docNo}`,
      body: `${ROUND(res.amount)} so'm chiqim joyida qoldi. Sabab: ${why}`,
      link: { key: "supply", id },
    }, { except: userId }));
  }
  return { id, docNo: req.docNo, note: res ? `Zayavka bekor qilindi — ${ROUND(res.amount)} so'm chiqim joyida qoldi, yetkazuvchidan qaytarilishi kerak` : "Zayavka bekor qilindi" };
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
    where: { materialId: { in: ids }, receipt: { cancelledAt: null } }, // storno qilingan kirim narxi "oxirgi xarid" bo'lmasin
    orderBy: { receipt: { date: "desc" } },
    take: 1000,
    include: { receipt: { select: { date: true, supplier: { select: { name: true } } } }, material: { select: { name: true } } },
  });
  const latest = new Map<string, LastPrice>();
  for (const r of rows) {
    if (latest.has(r.materialId)) continue;
    // Ta'minot narxi QQS bilan (to'lanadigan) — taqqoslash ham QQS bilan birlik narxida
    const gross = Number(r.price) + (Number(r.qty) > 0 ? Number(r.vatAmount) / Number(r.qty) : 0);
    latest.set(r.materialId, { price: Math.round(gross * 100) / 100, date: r.receipt.date, supplier: r.receipt.supplier.name, qty: Number(r.qty), material: r.material.name });
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
