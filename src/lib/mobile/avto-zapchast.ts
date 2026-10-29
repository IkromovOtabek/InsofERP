import { db } from "@/lib/db";
import { avtoPartsFeed, avtoPartsUnread, markAvtoPartsSeen, type AvtoFeedRow } from "@/lib/avto-parts";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { dateRu, fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import type { MobileUser } from "./auth";
import type { HomeRow } from "./home";
import type { MobileDetail } from "./detail";
import type { MobileList } from "./list";
import { ListError } from "./list";

/**
 * ECO: «Yangi kelgan avto zapchastlar» — veb `/stock/avto-zapchast` bilan bir manba (`lib/avto-parts.ts`).
 * Ro'yxat (`avto-zapchast`) bosh ekrandagi banner / «E'tibor talab qiladi» qatoridan ochiladi; kartochka —
 * bildirishnoma bosilganda (`/erp/avto-zapchast/<kirim id | "yangi">`) yoki ro'yxat qatoridan (xomashyo id).
 * Ochilgach xodimning avto zapchast xabarlari o'qilgan bo'ladi — banner yo'qoladi.
 */
const DAYS = 30;

const qty = (v: number, unit: string) => `${fmtNum(v, 3)} ${unitLabel(unit)}`;
function feedRow(f: AvtoFeedRow, fresh: boolean): HomeRow {
  return {
    id: f.materialId,
    title: f.name,
    subtitle: f.kind === "in" ? `Skladga keldi · ${dateRu(f.date)} · ${f.supplier ?? ""} · ${f.docNo ?? ""}` : `Ro'yxatga qo'shildi · ${dateRu(f.date)}`,
    right: f.qty != null ? qty(f.qty, f.unit) : undefined,
    ...(fresh ? { status: "Yangi", tone: "brand" as const } : {}),
  };
}

/** Banner chegarasi: xabar kirimdan bir necha soniya keyin yoziladi (guruhlash) — 1 daqiqa oldinga. */
const freshFn = (since: Date | null) => (d: Date) => since != null && d.getTime() >= since.getTime() - 60_000;

export async function avtoList(user: MobileUser, title: string, q?: string): Promise<MobileList> {
  const [{ feed }, unread] = await Promise.all([avtoPartsFeed(DAYS), avtoPartsUnread(user.id)]);
  const isNew = freshFn(unread.since);
  const s = q?.toLowerCase();
  const rows = feed.filter((f) => !s || f.name.toLowerCase().includes(s) || f.code.toLowerCase().includes(s)).map((f) => feedRow(f, isNew(f.addedAt)));
  if (unread.count) await markAvtoPartsSeen(user.id);
  return { key: "avto-zapchast", title, rows };
}

export async function avtoDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  // Xomashyo kartochkasi (ro'yxat qatoridan): joriy qoldiq va so'nggi kirimlari
  const m = await db.material.findUnique({ where: { id }, select: { id: true, name: true, code: true, unit: true, category: true } });
  if (m) {
    if (m.category !== "AVTO_ZAPCHAST") throw new ListError("NOT_FOUND", "Bu avto zapchast emas", 404);
    const [sum, items] = await Promise.all([
      db.stockMove.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }),
      db.goodsReceiptItem.findMany({
        where: { materialId: m.id, receipt: { cancelledAt: null } }, orderBy: { receipt: { date: "desc" } }, take: 10,
        select: { id: true, qty: true, receipt: { select: { docNo: true, date: true, supplier: { select: { name: true } } } } },
      }),
    ]);
    const bal = Number(sum._sum.qty ?? 0);
    return {
      key: "avto-zapchast", id, title: m.name, subtitle: `${m.code} · ${MATERIAL_CATEGORY_LABEL[m.category]}`,
      status: bal > 0 ? "Skladda bor" : "Skladda yo'q",
      fields: [{ label: "Skladdagi qoldiq", value: qty(bal, m.unit), tone: bal > 0 ? "success" : "warning" }, { label: "Birlik", value: unitLabel(m.unit) }],
      sections: [{
        title: "So'nggi kirimlar", empty: "Kirim bo'lmagan", icon: "truck",
        rows: items.map((i) => ({ id: i.id, title: `${i.receipt.docNo} · ${dateRu(i.receipt.date)}`, subtitle: i.receipt.supplier.name, right: qty(Number(i.qty), m.unit) })),
      }],
      actions: [],
    };
  }

  // Bildirishnomadan: bitta kirim yoki «yangi» (so'nggi kelganlar)
  const rec = id === "yangi" ? null : await db.goodsReceipt.findUnique({
    where: { id },
    select: {
      docNo: true, date: true, cancelledAt: true, supplier: { select: { name: true } },
      items: { where: { material: { category: "AVTO_ZAPCHAST" } }, select: { qty: true, material: { select: { id: true, name: true, unit: true } } } },
    },
  });
  if (id !== "yangi" && !rec) throw new ListError("NOT_FOUND", "Kirim topilmadi", 404);
  const [{ feed }, unread] = await Promise.all([avtoPartsFeed(DAYS), avtoPartsUnread(user.id)]);
  const isNew = freshFn(unread.since);
  if (unread.count) await markAvtoPartsSeen(user.id);
  const recent: HomeRow[] = feed.slice(0, 30).map((f) => feedRow(f, isNew(f.addedAt)));
  if (rec) {
    return {
      key: "avto-zapchast", id, title: `Avto zapchast keldi — ${rec.docNo}`, subtitle: `${dateRu(rec.date)} · ${rec.supplier.name}`,
      status: rec.cancelledAt ? "Bekor qilingan" : "Skladda",
      fields: [{ label: "Ta'minotchi", value: rec.supplier.name }, { label: "Sana", value: dateRu(rec.date) }],
      sections: [
        { title: "Shu kirimdagi avto zapchastlar", empty: "Avto zapchast yo'q", icon: "package", target: "avto-zapchast",
          rows: rec.items.map((i) => ({ id: i.material.id, title: i.material.name, right: qty(Number(i.qty), i.material.unit) })) },
        { title: `So'nggi ${DAYS} kunda kelganlar`, empty: "Yo'q", icon: "truck", target: "avto-zapchast", rows: recent },
      ],
      actions: [],
    };
  }
  return {
    key: "avto-zapchast", id, title: "Yangi kelgan avto zapchastlar", subtitle: `So'nggi ${DAYS} kun`,
    fields: [{ label: "Yozuvlar", value: `${feed.length} ta` }],
    sections: [{ title: "Kelgan va qo'shilganlar", empty: `So'nggi ${DAYS} kunda avto zapchast kelmagan`, icon: "truck", target: "avto-zapchast", rows: recent }],
    actions: [],
  };
}

/**
 * Bosh ekran banneri (mexanik): o'qilmagan avto zapchast xabarlari. Yangi ilova `notice` ni tepada chizadi,
 * eskisi — «Avtomatik ogohlantirish» qatori sifatida («E'tibor talab qiladi»).
 */
export type HomeNotice = { title: string; lines: string[]; count: number; action: string; open: { key: string } };
export async function avtoNotice(userId: string): Promise<HomeNotice | null> {
  const u = await avtoPartsUnread(userId);
  if (u.count === 0) return null;
  return {
    title: u.count > 1 ? `Yangi avto zapchastlar — ${u.count} ta xabar` : (u.lines[0]?.title ?? "Yangi avto zapchast"),
    lines: u.lines.map((l) => l.body),
    count: u.count,
    action: "Ko'rish",
    open: { key: "avto-zapchast" },
  };
}
