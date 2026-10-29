import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { MAX_AMOUNT, validDate } from "./action";
import { notifyAfter, notifyRoles, notifyUsers } from "./notify";
import { createGoodsReceipt } from "./receipts";
import { resolveMaterials } from "./import-materials";
import { normalizeUnit, UNIT_FALLBACK } from "./unit";
import { isMaterialCategory, MATERIAL_CATEGORY_LABEL } from "./material-category";
import { fmtNum } from "./format";
import type { MaterialCategory, Prisma, ReceiptPayment, Role, ShipmentStatus } from "@/generated/prisma";

/**
 * Jo'natma (JN-…): snabjenets olib kelgan mol nakladnoyini kiritib skladga jo'natadi, sklad tekshirib qabul qiladi.
 *
 *   DRAFT (snabjenets yozmoqda) → SENT (skladda bildirishnoma) → PARTIAL / DONE (qatorlar ko'rib chiqildi)
 *                               ↘ CANCELLED (snabjenets qaytarib oldi — birorta qator qabul qilinmagan bo'lsa)
 *
 * Sklad hammasini yoki belgilaganlarini qabul qiladi (fakt miqdor bilan) — tanlanganlar bitta kirim (GoodsReceipt)
 * bo'lib skladga tushadi; belgilanmaganlari kutishda qoladi, keyin qabul qilinadi yoki sabab bilan rad etiladi.
 * Spravochnikda yo'q mahsulot qabulda shu nom va kategoriya bilan xomashyo bo'lib ochiladi.
 *
 * Ruxsat chaqiruvchida (`requireAction("stock", "shipment" | "shipment_accept")`); xato matnlari o'zbekcha.
 */

export type ShipmentLineInput = {
  /** Spravochnikdagi mahsulot; bo'sh — yangi nom (`name` + `category` + `unit`) */
  materialId?: string | null;
  name?: string | null;
  unit?: string | null;
  category?: string | null;
  qty: number;
  price: number;
};

export type ShipmentInput = {
  supplierId: string;
  warehouseId: string;
  /** YYYY-MM-DD — nakladnoy sanasi */
  date: string;
  waybillNo?: string | null;
  payment?: ReceiptPayment | null;
  carrier?: string | null;
  note?: string | null;
  items: ShipmentLineInput[];
};

type Actor = { userId: string; role: Role };

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  DRAFT: "Qoralama",
  SENT: "Qabul kutmoqda",
  PARTIAL: "Qisman qabul qilindi",
  DONE: "Yakunlandi",
  CANCELLED: "Qaytarib olindi",
};

/** Badge rangi (`components/ui` BadgeColor). */
export const SHIPMENT_STATUS_COLOR: Record<ShipmentStatus, "slate" | "amber" | "blue" | "green" | "red"> = {
  DRAFT: "slate", SENT: "amber", PARTIAL: "blue", DONE: "green", CANCELLED: "red",
};

/** Sklad hali ko'rib chiqmagan jo'natmalar (bildirishnoma banneri shu holatlar bo'yicha). */
export const OPEN_SHIPMENT: ShipmentStatus[] = ["SENT", "PARTIAL"];

class ShipmentError extends Error {}
function fail(msg: string): never { throw new ShipmentError(msg); }

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clean = (v: string | null | undefined, max = 300) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/** Toshkent bo'yicha bugungi sana (YYYY-MM-DD) — kelajak sana bilan jo'natib bo'lmaydi. */
function todayTashkent(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Qatorlarni tekshirib, bazaga yoziladigan ko'rinishga keltiradi (mavjud mahsulotning nomi/birligi/kategoriyasi spravochnikdan). */
async function normalizeLines(raw: ShipmentLineInput[]) {
  const lines = raw.filter((l) => l && (l.materialId || (l.name ?? "").trim()));
  if (!lines.length) fail("Kamida bitta mahsulot qatori kerak");
  if (lines.length > 200) fail("Bitta jo'natmada 200 tadan ko'p qator bo'lmasin");
  for (const l of lines) {
    if (!(Number.isFinite(l.qty) && l.qty > 0 && l.qty <= MAX_AMOUNT) || r3(l.qty) < 0.001) fail("Har qatorda miqdor 0 dan katta bo'lsin");
    if (!(Number.isFinite(l.price) && l.price >= 0 && l.price <= MAX_AMOUNT)) fail("Narx manfiy bo'lmasin");
  }
  const ids = [...new Set(lines.map((l) => l.materialId).filter((x): x is string => !!x))];
  const mats = ids.length
    ? await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true, category: true, isActive: true } })
    : [];
  const byId = new Map(mats.map((m) => [m.id, m]));
  return lines.map((l, i) => {
    if (l.materialId) {
      const m = byId.get(l.materialId) ?? fail("Mahsulot topilmadi — sahifani yangilang");
      if (!m.isActive) fail(`«${m.name}» yopilgan — boshqasini tanlang`);
      return { materialId: m.id, name: m.name, unit: m.unit, category: m.category, qty: r3(l.qty), price: Math.round(l.price * 100) / 100, sortOrder: i };
    }
    const name = (l.name ?? "").trim().slice(0, 200);
    if (name.length < 2) fail("Yangi mahsulot nomini to'liq yozing");
    if (!isMaterialCategory(l.category)) fail(`«${name}» uchun kategoriyani tanlang`);
    return {
      materialId: null, name, unit: normalizeUnit(l.unit) ?? UNIT_FALLBACK, category: l.category as MaterialCategory,
      qty: r3(l.qty), price: Math.round(l.price * 100) / 100, sortOrder: i,
    };
  });
}

/**
 * Jo'natmani saqlash: yangi yoki mavjud qoralamani yangilash. `send` — shu zahoti skladga jo'natiladi
 * (sklad xodimlariga bildirishnoma va push ketadi).
 */
export async function saveShipment(input: ShipmentInput, actor: Actor, opts: { id?: string | null; send: boolean }) {
  try {
    if (!input.date || !validDate(input.date)) fail("Sana noto'g'ri");
    if (input.date.slice(0, 10) > todayTashkent()) fail("Nakladnoy sanasi bugundan keyin bo'lmasin");
    const payment = input.payment ?? null;
    if (payment != null && payment !== "BANK" && payment !== "CASH") fail("To'lov turi noto'g'ri");
    const [wh, sup] = await Promise.all([
      db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } }),
      db.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, isActive: true } }),
    ]);
    if (!wh) fail("Sklad topilmadi yoki yopilgan");
    if (!sup) fail("Yetkazuvchi topilmadi");
    if (!sup!.isActive) fail(`«${sup!.name}» yopilgan — avval Yetkazuvchilar bo'limida faollashtiring`);
    const items = await normalizeLines(input.items);

    const head = {
      date: new Date(input.date.slice(0, 10)), warehouseId: wh!.id, supplierId: sup!.id, payment,
      waybillNo: clean(input.waybillNo, 60), carrier: clean(input.carrier, 120), note: clean(input.note, 1000),
      ...(opts.send ? { status: "SENT" as const, sentAt: new Date() } : {}),
    };

    const saved = await db.$transaction(async (tx) => {
      if (opts.id) {
        // Faqat o'z qoralamasi (direktor — har qanday) va faqat DRAFT holatida: jo'natilgani sklad ko'rmoqda
        const own = actor.role === "DIRECTOR" ? {} : { createdById: actor.userId };
        const upd = await tx.supplyShipment.updateMany({ where: { id: opts.id, status: "DRAFT", ...own }, data: head });
        if (upd.count !== 1) fail("Jo'natma allaqachon yuborilgan yoki sizniki emas — sahifani yangilang");
        await tx.supplyShipmentItem.deleteMany({ where: { shipmentId: opts.id } });
        await tx.supplyShipmentItem.createMany({ data: items.map((i) => ({ ...i, shipmentId: opts.id! })) });
        const s = await tx.supplyShipment.findUniqueOrThrow({ where: { id: opts.id }, select: { id: true, docNo: true } });
        await audit(tx, actor.userId, "UPDATE", "SupplyShipment", s.id, undefined, { ...head, items });
        return s;
      }
      const s = await tx.supplyShipment.create({
        data: { ...head, docNo: await nextNo(tx, "supplyShipment", "JN"), createdById: actor.userId, items: { create: items } },
        select: { id: true, docNo: true },
      });
      await audit(tx, actor.userId, "CREATE", "SupplyShipment", s.id, undefined, { ...head, items });
      return s;
    });
    if (opts.send) announceSent(saved.id, actor.userId);
    return saved;
  } catch (e) {
    if (e instanceof ShipmentError) throw new Error(e.message);
    throw e;
  }
}

/** Qoralamani skladga jo'natish (tahrirsiz). */
export async function sendShipment(id: string, actor: Actor) {
  const own = actor.role === "DIRECTOR" ? {} : { createdById: actor.userId };
  const s = await db.supplyShipment.findFirst({ where: { id, ...own }, select: { date: true, _count: { select: { items: true } } } });
  if (!s) throw new Error("Jo'natma topilmadi");
  if (!s._count.items) throw new Error("Jo'natmada qator yo'q");
  if (s.date.toISOString().slice(0, 10) > todayTashkent()) throw new Error("Nakladnoy sanasi bugundan keyin bo'lmasin");
  const upd = await db.supplyShipment.updateMany({ where: { id, status: "DRAFT", ...own }, data: { status: "SENT", sentAt: new Date() } });
  if (upd.count !== 1) throw new Error("Jo'natma allaqachon yuborilgan — sahifani yangilang");
  await audit(db, actor.userId, "STATUS_CHANGE", "SupplyShipment", id, { status: "DRAFT" }, { status: "SENT" });
  announceSent(id, actor.userId);
}

/** Qaytarib olish: hech bir qator qabul qilinmagan bo'lsa (sklad hali kirim qilmagan; rad etilganlari bo'lishi mumkin). */
export async function cancelShipment(id: string, actor: Actor, reason?: string | null) {
  const own = actor.role === "DIRECTOR" ? {} : { createdById: actor.userId };
  const before = await db.supplyShipment.findFirst({ where: { id, ...own }, select: { status: true, docNo: true } });
  if (!before) throw new Error("Jo'natma topilmadi");
  const upd = await db.supplyShipment.updateMany({
    where: { id, status: { in: ["DRAFT", "SENT", "PARTIAL"] }, ...own, items: { none: { status: "ACCEPTED" } } },
    data: { status: "CANCELLED", cancelledAt: new Date(), note: reason ? clean(reason, 1000) : undefined },
  });
  if (upd.count !== 1) throw new Error("Sklad qabul qilishni boshlagan — endi qaytarib bo'lmaydi");
  await audit(db, actor.userId, "STATUS_CHANGE", "SupplyShipment", id, { status: before.status }, { status: "CANCELLED", reason });
  if (before.status !== "DRAFT") {
    notifyAfter(() => notifyRoles(["WAREHOUSE"], {
      type: "SHIPMENT_CANCELLED", title: `Jo'natma qaytarib olindi — ${before.docNo}`,
      body: reason ? `Sabab: ${reason}` : "Snabjenets jo'natmani qaytarib oldi", link: { key: "jonatma", id }, channel: "oddiy",
    }, { except: actor.userId }));
  }
}

/** Qolgan qatorlar bo'yicha holatni qayta hisoblash (shu tranzaksiya ichida). */
async function refreshStatus(tx: Prisma.TransactionClient, id: string) {
  const pending = await tx.supplyShipmentItem.count({ where: { shipmentId: id, status: "PENDING" } });
  await tx.supplyShipment.updateMany({ where: { id, status: { in: OPEN_SHIPMENT } }, data: { status: pending ? "PARTIAL" : "DONE" } });
}

export type AcceptLine = { itemId: string; qty: number };

/**
 * Tanlangan qatorlarni qabul qilish: bitta kirim (GoodsReceipt) — sklad qoldig'iga tushadi.
 * Qatorlar kirim bilan bir tranzaksiyada band qilinadi (PENDING → ACCEPTED): ikki xodim bir vaqtda bossa
 * ikkinchisi «allaqachon qabul qilingan» xatosini oladi, ikki kirim bo'lmaydi.
 */
export async function acceptShipment(id: string, lines: AcceptLine[], actor: Actor) {
  const sel = new Map<string, number>();
  for (const l of lines) if (l.itemId) sel.set(l.itemId, l.qty);
  if (!sel.size) throw new Error("Qabul qilinadigan qatorlarni belgilang");
  for (const q of sel.values()) {
    if (!(Number.isFinite(q) && q > 0 && q <= MAX_AMOUNT) || r3(q) < 0.001) throw new Error("Qabul qilingan miqdor 0 dan katta bo'lsin");
  }

  const s = await db.supplyShipment.findUnique({
    where: { id },
    select: {
      id: true, docNo: true, status: true, date: true, warehouseId: true, supplierId: true, waybillNo: true, payment: true, carrier: true, note: true, createdById: true,
      items: { where: { id: { in: [...sel.keys()] } }, select: { id: true, materialId: true, name: true, unit: true, category: true, price: true, qty: true, status: true } },
    },
  });
  if (!s) throw new Error("Jo'natma topilmadi");
  if (!OPEN_SHIPMENT.includes(s.status)) throw new Error("Bu jo'natma qabul kutmayapti — sahifani yangilang");
  if (s.items.length !== sel.size) throw new Error("Qator topilmadi — sahifani yangilang");
  if (s.items.some((i) => i.status !== "PENDING")) throw new Error("Ba'zi qatorlar allaqachon ko'rib chiqilgan — sahifani yangilang");

  // Spravochnikda yo'q mahsulotlar — nom bo'yicha topiladi yoki shu nom, birlik va kategoriya bilan ochiladi.
  // Qatorga darhol bog'lanadi: kirim yiqilsa ham qayta bosishda ikkinchi xomashyo ochilmaydi
  const fresh = s.items.filter((i) => !i.materialId);
  if (fresh.length) {
    await db.$transaction(async (tx) => {
      const { result, created } = await resolveMaterials(tx, fresh.map((i) => ({ name: i.name, unit: i.unit })), true);
      const newIds = new Set(created.map((m) => m.id));
      for (const i of fresh) {
        const m = result.get(i.name.toLowerCase().trim());
        if (!m) continue;
        if (newIds.has(m.id)) await tx.material.update({ where: { id: m.id }, data: { category: i.category } });
        await tx.supplyShipmentItem.updateMany({ where: { id: i.id, materialId: null }, data: { materialId: m.id } });
        i.materialId = m.id;
      }
    });
  }

  const now = new Date();
  const rec = await createGoodsReceipt({
    supplierId: s.supplierId, warehouseId: s.warehouseId, date: s.date.toISOString().slice(0, 10),
    waybillNo: s.waybillNo, payment: s.payment, carrier: s.carrier, buyerId: s.createdById,
    note: [`Jo'natma ${s.docNo}`, s.note].filter(Boolean).join(" · "),
    clientToken: randomUUID(),
    items: s.items.map((i) => ({ materialId: i.materialId!, qty: r3(sel.get(i.id)!), price: Number(i.price) })),
  }, actor, {
    within: async (tx, r) => {
      for (const i of s.items) {
        const upd = await tx.supplyShipmentItem.updateMany({
          where: { id: i.id, status: "PENDING" },
          data: { status: "ACCEPTED", acceptedQty: r3(sel.get(i.id)!), receiptId: r.id, decidedById: actor.userId, decidedAt: now },
        });
        if (upd.count !== 1) throw new Error(`«${i.name}» allaqachon ko'rib chiqilgan — sahifani yangilang`);
      }
      await refreshStatus(tx, s.id);
      await audit(tx, actor.userId, "STATUS_CHANGE", "SupplyShipment", s.id, undefined, { accepted: s.items.map((i) => ({ id: i.id, qty: sel.get(i.id) })), receipt: r.docNo });
    },
  });

  const short = s.items.filter((i) => r3(sel.get(i.id)!) < Number(i.qty));
  notifyAfter(() => notifyUsers([s.createdById !== actor.userId ? s.createdById : null], {
    type: "SHIPMENT_ACCEPTED",
    title: `Sklad qabul qildi — ${s.docNo}`,
    body: `${s.items.length} qator skladga kirim bo'ldi (${rec.docNo})` + (short.length ? ` · ${short.length} qatorda miqdor kam: ${short.slice(0, 3).map((i) => i.name).join(", ")}` : ""),
    link: { key: "jonatma", id: s.id }, channel: short.length ? undefined : "oddiy",
  }));
  return { receiptId: rec.id, receiptNo: rec.docNo, count: s.items.length };
}

/** Qatorlarni rad etish (sabab majburiy) — snabjenetsga xabar boradi. */
export async function rejectShipmentItems(id: string, itemIds: string[], reason: string, actor: Actor) {
  const why = clean(reason, 300);
  if (!why || why.length < 3) throw new Error("Rad etish sababini yozing");
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) throw new Error("Rad etiladigan qatorlarni belgilang");
  const s = await db.supplyShipment.findUnique({ where: { id }, select: { docNo: true, status: true, createdById: true, items: { where: { id: { in: ids } }, select: { id: true, name: true } } } });
  if (!s) throw new Error("Jo'natma topilmadi");
  if (!OPEN_SHIPMENT.includes(s.status)) throw new Error("Bu jo'natma qabul kutmayapti — sahifani yangilang");
  if (s.items.length !== ids.length) throw new Error("Qator topilmadi — sahifani yangilang");
  await db.$transaction(async (tx) => {
    const upd = await tx.supplyShipmentItem.updateMany({
      where: { id: { in: ids }, shipmentId: id, status: "PENDING" },
      data: { status: "REJECTED", rejectReason: why, decidedById: actor.userId, decidedAt: new Date() },
    });
    if (upd.count !== ids.length) throw new Error("Ba'zi qatorlar allaqachon ko'rib chiqilgan — sahifani yangilang");
    await refreshStatus(tx, id);
    await audit(tx, actor.userId, "STATUS_CHANGE", "SupplyShipment", id, undefined, { rejected: ids, reason: why });
  });
  notifyAfter(() => notifyUsers([s.createdById], {
    type: "SHIPMENT_REJECTED",
    title: `Sklad rad etdi — ${s.docNo}`,
    body: `${s.items.map((i) => i.name).slice(0, 3).join(", ")}${s.items.length > 3 ? ` va yana ${s.items.length - 3} ta` : ""} · Sabab: ${why}`,
    link: { key: "jonatma", id },
  }));
}

/** Skladga xabar: «Yangi mahsulotlar keldi — qabul qiling». */
function announceSent(id: string, actorId: string) {
  notifyAfter(async () => {
    const s = await db.supplyShipment.findUnique({
      where: { id },
      select: { docNo: true, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } }, items: { select: { name: true } } },
    });
    if (!s) return;
    const names = s.items.slice(0, 3).map((i) => i.name).join(", ") + (s.items.length > 3 ? ` va yana ${s.items.length - 3} ta` : "");
    await notifyRoles(["WAREHOUSE"], {
      type: "SHIPMENT_SENT",
      title: `Yangi mahsulotlar keldi — qabul qiling`,
      body: `${s.docNo} · ${s.createdBy.fullName} · ${s.supplier.name} · ${names}`,
      link: { key: "jonatma", id },
    }, { except: actorId });
  });
}

// ───────────────────────── O'qish ─────────────────────────

/** Sklad kutayotgan jo'natmalar — veb banner va ilova banneri uchun. */
export async function pendingShipments(take = 5) {
  const where = { status: { in: OPEN_SHIPMENT } };
  const [count, rows] = await Promise.all([
    db.supplyShipment.count({ where }),
    db.supplyShipment.findMany({
      where, orderBy: { sentAt: "asc" }, take,
      select: {
        id: true, docNo: true, sentAt: true, createdBy: { select: { fullName: true } }, supplier: { select: { name: true } },
        _count: { select: { items: { where: { status: "PENDING" } } } },
      },
    }),
  ]);
  return { count, rows: rows.map((r) => ({ id: r.id, docNo: r.docNo, sentAt: r.sentAt, by: r.createdBy.fullName, supplier: r.supplier.name, pending: r._count.items })) };
}

export type ShipmentTab = "open" | "draft" | "done" | "all";
export const SHIPMENT_TABS: { key: ShipmentTab; label: string; status?: ShipmentStatus[] }[] = [
  { key: "open", label: "Qabul kutmoqda", status: OPEN_SHIPMENT },
  { key: "draft", label: "Qoralamalar", status: ["DRAFT"] },
  { key: "done", label: "Yakunlangan", status: ["DONE", "CANCELLED"] },
  { key: "all", label: "Hammasi" },
];

/**
 * Ro'yxat. Snabjenets faqat o'z jo'natmalarini ko'radi; sklad (va direktor) — hammasini, qoralamalarsiz
 * (qoralama — snabjenetsning shaxsiy ishi, skladga hali yuborilmagan).
 */
export async function listShipments(tab: ShipmentTab, viewer: Actor, opts: { q?: string; take?: number } = {}) {
  const t = SHIPMENT_TABS.find((x) => x.key === tab) ?? SHIPMENT_TABS[0]!;
  const mine = viewer.role === "PROCUREMENT";
  const where: Prisma.SupplyShipmentWhereInput = {
    ...(t.status ? { status: { in: t.status } } : {}),
    ...(mine ? { createdById: viewer.userId } : { OR: [{ status: { not: "DRAFT" } }, { createdById: viewer.userId }] }),
    ...(opts.q ? { OR: [{ docNo: { contains: opts.q, mode: "insensitive" } }, { waybillNo: { contains: opts.q, mode: "insensitive" } }, { supplier: { name: { contains: opts.q, mode: "insensitive" } } }, { items: { some: { name: { contains: opts.q, mode: "insensitive" } } } }] } : {}),
  };
  const rows = await db.supplyShipment.findMany({
    where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: opts.take ?? 200,
    select: {
      id: true, docNo: true, date: true, status: true, waybillNo: true, sentAt: true,
      supplier: { select: { name: true } }, createdBy: { select: { fullName: true } },
      items: { select: { qty: true, price: true, status: true, category: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, docNo: r.docNo, date: r.date, status: r.status, waybillNo: r.waybillNo, sentAt: r.sentAt,
    supplier: r.supplier.name, by: r.createdBy.fullName,
    lines: r.items.length,
    pending: r.items.filter((i) => i.status === "PENDING").length,
    accepted: r.items.filter((i) => i.status === "ACCEPTED").length,
    rejected: r.items.filter((i) => i.status === "REJECTED").length,
    total: r.items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0),
    categories: [...new Set(r.items.map((i) => i.category))],
  }));
}

export async function shipmentCounts(viewer: Actor) {
  const mine = viewer.role === "PROCUREMENT";
  const scope: Prisma.SupplyShipmentWhereInput = mine ? { createdById: viewer.userId } : { OR: [{ status: { not: "DRAFT" } }, { createdById: viewer.userId }] };
  const g = await db.supplyShipment.groupBy({ by: ["status"], where: scope, _count: { _all: true } });
  const c = (st: ShipmentStatus[]) => g.filter((x) => st.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
  return { open: c(OPEN_SHIPMENT), draft: c(["DRAFT"]), done: c(["DONE", "CANCELLED"]), all: c(["DRAFT", "SENT", "PARTIAL", "DONE", "CANCELLED"]) };
}

export async function getShipment(id: string) {
  return db.supplyShipment.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, vatPayer: true } },
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          material: { select: { id: true, code: true, name: true } },
          receipt: { select: { id: true, docNo: true } },
          decidedBy: { select: { fullName: true } },
        },
      },
    },
  });
}

export type ShipmentFull = NonNullable<Awaited<ReturnType<typeof getShipment>>>;

/** Kim nima qila oladi — sahifa va ilova bir xil qoidani ishlatadi. */
export function shipmentRights(s: { status: ShipmentStatus; createdById: string; items: { status: string }[] }, who: Actor, can: { send: boolean; accept: boolean }) {
  const owner = who.role === "DIRECTOR" || s.createdById === who.userId;
  return {
    edit: can.send && owner && s.status === "DRAFT",
    send: can.send && owner && s.status === "DRAFT",
    cancel: can.send && owner && ["DRAFT", "SENT", "PARTIAL"].includes(s.status) && !s.items.some((i) => i.status === "ACCEPTED"),
    accept: can.accept && OPEN_SHIPMENT.includes(s.status),
  };
}

/** Qator yorlig'i: «Sement M400 · 12 t × 950 000» */
export const lineLabel = (i: { name: string; unit: string; qty: unknown; category: MaterialCategory }) =>
  `${i.name} · ${fmtNum(String(i.qty), 3)} ${i.unit} · ${MATERIAL_CATEGORY_LABEL[i.category]}`;
