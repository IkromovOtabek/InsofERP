import { db } from "@/lib/db";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";

/**
 * Avto zapchast (`Material.category = AVTO_ZAPCHAST`) — mexanik uchun xabar va «yangi kelganlar».
 *
 * Ikki hodisa mexaniklarga (MECHANIC) bildirishnoma + ECO push bo'lib ketadi:
 *  - yangi karta: spravochnikka Avto zapchast qo'shildi yoki boshqa kategoriyadan Avto zapchastga o'tkazildi;
 *  - kirim: skladga Avto zapchast keldi (kirim formasi, Excel jurnal, ta'minot, mobil ilova).
 * ERP va ECO tepasidagi banner shu bildirishnomalarning o'qilmaganlaridan tuziladi — alohida jadval yo'q.
 * «Ko'rish» bosilganda ular o'qilgan bo'ladi va banner yo'qoladi.
 */
export const AVTO_PART_TYPES = ["AVTO_PART_NEW", "AVTO_PART_IN"] as const;
/** Bildirishnoma havolasi: ECO'da `/erp/avto-zapchast/<id>`, vebda `/stock/avto-zapchast`. */
export const AVTO_PART_LINK = "avto-zapchast";

const list = (a: string[], max = 5) => a.slice(0, max).join(", ") + (a.length > max ? ` va yana ${a.length - max} ta` : "");

/** Spravochnikka qo'shilgan (yoki Avto zapchastga o'tkazilgan) kartalar — `materialIds` dan faqat faol Avto zapchastlar olinadi. */
export function notifyNewAvtoParts(materialIds: string[], actorUserId?: string | null): void {
  if (materialIds.length === 0) return;
  notifyAfter(async () => {
    const ms = await db.material.findMany({ where: { id: { in: materialIds }, category: "AVTO_ZAPCHAST", isActive: true }, select: { name: true }, orderBy: { name: "asc" } });
    if (ms.length === 0) return;
    await notifyRoles(["MECHANIC"], {
      type: "AVTO_PART_NEW",
      title: ms.length > 1 ? `${ms.length} ta yangi avto zapchast` : "Yangi avto zapchast",
      body: list(ms.map((m) => m.name)),
      link: { key: AVTO_PART_LINK, id: "yangi" },
      channel: "oddiy",
    }, { except: actorUserId });
  });
}

/**
 * Kirim hujjatida Avto zapchast bo'lsa — mexaniklarga «keldi» xabari. Xodim bo'yicha 30 soniyalik oynada
 * guruhlanadi: Excel jurnal importi o'nlab kirim yaratsa, mexanikka o'nlab push emas, bitta xabar boradi.
 */
const receiptQueue = new Map<string, string[]>();
export function queueAvtoReceipt(receiptId: string, actorUserId: string | null): void {
  const k = actorUserId ?? "";
  const q = receiptQueue.get(k);
  if (q) { q.push(receiptId); return; }
  receiptQueue.set(k, [receiptId]);
  const timer = setTimeout(() => {
    const ids = receiptQueue.get(k) ?? [];
    receiptQueue.delete(k);
    sendAvtoReceipts(ids, actorUserId).catch((e) => console.error("[notify] avto zapchast", e));
  }, 30_000);
  timer.unref?.();
}

async function sendAvtoReceipts(receiptIds: string[], actorUserId: string | null): Promise<void> {
  const recs = await db.goodsReceipt.findMany({
    where: { id: { in: receiptIds }, cancelledAt: null, items: { some: { material: { category: "AVTO_ZAPCHAST" } } } },
    orderBy: { date: "asc" },
    select: {
      id: true, supplier: { select: { name: true } },
      items: { where: { material: { category: "AVTO_ZAPCHAST" } }, select: { qty: true, material: { select: { name: true, unit: true } } } },
    },
  });
  if (recs.length === 0) return;
  const parts = recs.flatMap((r) => r.items.map((i) => `${i.material.name} ${fmtNum(Number(i.qty), 3)} ${unitLabel(i.material.unit)}`));
  const suppliers = [...new Set(recs.map((r) => r.supplier.name))];
  await notifyRoles(["MECHANIC"], {
    type: "AVTO_PART_IN",
    title: recs.length > 1 ? `Skladga avto zapchast keldi — ${recs.length} ta kirim` : "Skladga avto zapchast keldi",
    body: `${list(parts)} · ${list(suppliers, 3)}`,
    link: { key: AVTO_PART_LINK, id: recs.length === 1 ? recs[0]!.id : "yangi" },
    channel: "oddiy",
  }, { except: actorUserId });
}

export type AvtoUnread = { count: number; since: Date | null; lines: { id: string; title: string; body: string; createdAt: Date }[] };

/** Banner uchun: xodimning o'qilmagan avto zapchast xabarlari (eng yangisi tepada). */
export async function avtoPartsUnread(userId: string): Promise<AvtoUnread> {
  const where = { userId, readAt: null, type: { in: [...AVTO_PART_TYPES] } };
  const [count, lines, first] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, title: true, body: true, createdAt: true } }),
    db.notification.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return { count, since: first?.createdAt ?? null, lines };
}

/** «Ko'rish» — avto zapchast xabarlari o'qilgan bo'ladi (boshqa bildirishnomalarga tegilmaydi). */
export async function markAvtoPartsSeen(userId: string): Promise<number> {
  const r = await db.notification.updateMany({ where: { userId, readAt: null, type: { in: [...AVTO_PART_TYPES] } }, data: { readAt: new Date() } });
  return r.count;
}

export type AvtoFeedRow = {
  /** `date` — hujjat sanasi (orqa sana bo'lishi mumkin); `addedAt` — tizimga kiritilgan payt («Yangi» belgisi shundan) */
  key: string; kind: "in" | "new"; date: Date; addedAt: Date; materialId: string; name: string; code: string; unit: string;
  qty: number | null; receiptId: string | null; docNo: string | null; supplier: string | null;
};
export type AvtoPartRow = { id: string; name: string; code: string; unit: string; balance: number; lastIn: Date | null };

/**
 * «Yangi kelgan avto zapchastlar»: `days` kun ichidagi kirimlar (bekor qilinmagan) va yangi kartalar,
 * eng yangisi tepada; hamda barcha faol Avto zapchastlar joriy qoldig'i bilan («Siz uchun» bo'limi).
 */
export async function avtoPartsFeed(days = 30): Promise<{ feed: AvtoFeedRow[]; parts: AvtoPartRow[] }> {
  const since = new Date(Date.now() - days * 864e5);
  const [items, cards, parts] = await Promise.all([
    db.goodsReceiptItem.findMany({
      where: { material: { category: "AVTO_ZAPCHAST" }, receipt: { cancelledAt: null, date: { gte: since } } },
      orderBy: { receipt: { date: "desc" } }, take: 300,
      select: { id: true, qty: true, material: { select: { id: true, name: true, code: true, unit: true } }, receipt: { select: { id: true, docNo: true, date: true, createdAt: true, supplier: { select: { name: true } } } } },
    }),
    db.material.findMany({ where: { category: "AVTO_ZAPCHAST", isActive: true, createdAt: { gte: since } }, select: { id: true, name: true, code: true, unit: true, createdAt: true } }),
    db.material.findMany({ where: { category: "AVTO_ZAPCHAST", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
  ]);
  const ids = parts.map((p) => p.id);
  const [sums, lastIn] = ids.length
    ? await Promise.all([
        db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { in: ids } }, _sum: { qty: true } }),
        db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { in: ids }, type: "RECEIPT", qty: { gt: 0 } }, _max: { date: true } }),
      ])
    : [[], []];
  const bal = new Map(sums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const last = new Map(lastIn.map((x) => [x.materialId, x._max.date]));

  const feed: AvtoFeedRow[] = [
    ...items.map((i) => ({
      key: `i-${i.id}`, kind: "in" as const, date: i.receipt.date, addedAt: i.receipt.createdAt, materialId: i.material.id, name: i.material.name, code: i.material.code, unit: i.material.unit,
      qty: Number(i.qty), receiptId: i.receipt.id, docNo: i.receipt.docNo, supplier: i.receipt.supplier.name,
    })),
    ...cards.map((m) => ({
      key: `m-${m.id}`, kind: "new" as const, date: m.createdAt, addedAt: m.createdAt, materialId: m.id, name: m.name, code: m.code, unit: m.unit,
      qty: null, receiptId: null, docNo: null, supplier: null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    feed,
    parts: parts.map((p) => ({ ...p, balance: Math.round((bal.get(p.id) ?? 0) * 1000) / 1000, lastIn: last.get(p.id) ?? null })),
  };
}
