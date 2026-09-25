import { db } from "./db";
import { audit } from "./audit";
import { DEFAULT_CREDIT_LIMIT } from "./finance";
import { createOrder } from "./orders";
import { flatName, num, str } from "./excel";

/**
 * Excel'dan zayavkalar: bitta qator — bitta mijoz × mahsulot × miqdor.
 * Kesishma jadval brauzerda shu ko'rinishga yoyiladi (`lib/excel.ts` → `unpivotMatrix`).
 *
 * Bitta mijoz + bitta yetkazish sanasi — bitta zayavka: qatorlar shu bo'yicha guruhlanadi.
 * Zayavka `lib/orders.ts` → `createOrder` orqali ochiladi, ya'ni limit/qora ro'yxat tekshiruvi,
 * raqamlash va audit qo'lda ochilgan zayavka bilan bir xil bo'ladi.
 */
export type ImportOrderRow = { customer?: unknown; product?: unknown; qty?: unknown; date?: unknown; unit?: unknown; price?: unknown };

export type ImportOrdersInput = {
  rows: ImportOrderRow[];
  /** Faylda sana bo'lmagan qatorlar uchun (matritsada sanasi yo'q ustunlar). */
  defaultDate: string;
  /** Ro'yxatda yo'q mijozlarni (obyekt nomlarini) yangi mijoz sifatida ochish. */
  createCustomers: boolean;
  onCredit: boolean;
  note?: string | null;
};

export type ImportOrdersResult = {
  orders: { id: string; orderNo: string; customer: string; date: string; lines: number }[];
  failed: { customer: string; date: string; error: string }[];
  /** Ayni shu mijoz + sana + mahsulotlar bo'yicha qoralama zayavka allaqachon bor — takror ochilmadi. */
  duplicates: { customer: string; date: string }[];
  createdCustomers: string[];
  /** Narxi 0 bo'lgan (mahsulotda bazaviy narx qo'yilmagan) mahsulot nomlari. */
  noPrice: string[];
  lines: number;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cut = (l: string[], n = 8) => `${l.slice(0, n).join(", ")}${l.length > n ? `… (jami ${l.length} ta)` : ""}`;

export async function importOrders(input: ImportOrdersInput, userId: string): Promise<ImportOrdersResult> {
  if (!ISO.test(input.defaultDate)) throw new Error("Standart yetkazish sanasi noto'g'ri");

  const rows = input.rows
    .map((r) => ({
      customer: str(r.customer),
      product: str(r.product),
      qty: num(r.qty),
      date: str(r.date) || input.defaultDate,
      price: str(r.price) === "" ? null : num(r.price),
    }))
    .filter((r) => r.customer !== "" && r.product !== "");
  if (rows.length === 0) throw new Error("Faylda qator yo'q");

  for (const [i, r] of rows.entries()) {
    if (!(r.qty > 0)) throw new Error(`${i + 1}-qator (${r.customer} · ${r.product}): miqdor 0 dan katta raqam bo'lsin`);
    if (r.price != null && !(r.price >= 0)) throw new Error(`${i + 1}-qator (${r.product}): narx noto'g'ri`);
    if (!ISO.test(r.date)) throw new Error(`${i + 1}-qator (${r.customer}): yetkazish sanasi noto'g'ri — «${r.date}»`);
  }

  // ── Mahsulotlar: faqat ro'yxatdagi. Zayavka importi yangi mahsulot yaratmaydi —
  //    mahsulotga narx, birlik va (beton bo'lsa) retsept kerak, ular bu faylda yo'q.
  const products = await db.product.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, price: true } });
  const byProduct = new Map<string, (typeof products)[number]>();
  for (const p of products) { byProduct.set(flatName(p.code), p); byProduct.set(flatName(p.name), p); }
  const unknownProducts = [...new Set(rows.filter((r) => !byProduct.get(flatName(r.product))).map((r) => r.product))];
  if (unknownProducts.length) throw new Error(`Bunday mahsulot ro'yxatda yo'q: ${cut(unknownProducts)}. Avval Mahsulotlar bo'limiga qo'shing (yoki fayldagi nomini to'g'rilang).`);

  // ── Mijozlar: nomi bo'yicha (tinish belgilari va harf katta-kichikligi hisobga olinmaydi)
  const customers = await db.customer.findMany({ where: { isActive: true, isInternal: false }, select: { id: true, name: true, address: true } });
  const byCustomer = new Map<string, (typeof customers)[number]>();
  for (const c of customers) byCustomer.set(flatName(c.name), c);
  const unknownCustomers = [...new Set(rows.filter((r) => !byCustomer.get(flatName(r.customer))).map((r) => r.customer))];
  if (unknownCustomers.length && !input.createCustomers) {
    throw new Error(`Bunday mijoz yo'q: ${cut(unknownCustomers)}. "Ro'yxatda yo'q mijozlarni yaratish" ni belgilang yoki nomini to'g'rilang.`);
  }
  const createdCustomers: string[] = [];
  for (const name of unknownCustomers) {
    const c = await db.$transaction(async (tx) => {
      const created = await tx.customer.create({ data: { name, creditLimit: DEFAULT_CREDIT_LIMIT }, select: { id: true, name: true, address: true } });
      await audit(tx, userId, "CREATE", "Customer", created.id, undefined, { ...created, via: "excel-import" });
      return created;
    });
    byCustomer.set(flatName(name), c);
    createdCustomers.push(c.name);
  }

  // ── Guruhlash: mijoz + yetkazish sanasi = bitta zayavka; bir mahsulot takrorlansa miqdor qo'shiladi
  type Group = { customer: (typeof customers)[number]; label: string; date: string; items: Map<string, { qty: number; price: number }> };
  const groups = new Map<string, Group>();
  const noPrice = new Set<string>();
  for (const r of rows) {
    const c = byCustomer.get(flatName(r.customer))!;
    const p = byProduct.get(flatName(r.product))!;
    const price = r.price ?? Number(p.price);
    if (!(price > 0)) noPrice.add(p.name);
    const key = `${c.id}|${r.date}`;
    const g = groups.get(key) ?? { customer: c, label: r.customer, date: r.date, items: new Map() };
    const prev = g.items.get(p.id);
    g.items.set(p.id, { qty: (prev?.qty ?? 0) + r.qty, price: prev?.price ?? price });
    groups.set(key, g);
  }

  // ── Zayavkalar ketma-ket ochiladi: bittasi o'tmasa (limit, qora ro'yxat) qolganlari to'xtamaydi
  const orders: ImportOrdersResult["orders"] = [];
  const failed: ImportOrdersResult["failed"] = [];
  const duplicates: ImportOrdersResult["duplicates"] = [];
  for (const g of groups.values()) {
    const items = [...g.items].map(([productId, v]) => ({ productId, qtyM3: v.qty, price: v.price }));
    // Bitta fayl ikki marta yuklansa takror zayavka ochilmasin: shu mijoz + shu sanadagi
    // qoralama zayavkalar ichida mahsulot-miqdori aynan bir xili bo'lsa — o'tkazib yuboriladi
    const same = await db.order.findMany({
      where: { customerId: g.customer.id, deliveryDate: new Date(g.date), status: "DRAFT" },
      select: { items: { select: { productId: true, qtyM3: true } } },
    });
    const key = (l: { productId: string; qtyM3: unknown }[]) => l.map((i) => `${i.productId}:${Number(i.qtyM3)}`).sort().join("|");
    if (same.some((o) => key(o.items) === key(items.map((i) => ({ productId: i.productId, qtyM3: i.qtyM3 }))))) {
      duplicates.push({ customer: g.customer.name, date: g.date });
      continue;
    }
    try {
      const res = await createOrder(
        {
          customerId: g.customer.id,
          // Vebdagi "Yangi zayavka" formasi ham shunday saqlaydi ("YYYY-MM-DD" → UTC yarim kechasi):
          // taqvim va hisobotlar sanani bir xil ko'rishi uchun shu usul saqlanadi
          deliveryDate: new Date(g.date),
          // Excel'da manzil bo'lmaydi: mijoz kartasidagi manzil, bo'lmasa ustun nomi (u aslida obyekt nomi)
          deliveryAddress: g.customer.address?.trim() || g.label,
          items,
          onCredit: input.onCredit,
          note: [input.note?.trim(), "Excel'dan import"].filter(Boolean).join(" · "),
        },
        userId,
      );
      orders.push({ id: res.id, orderNo: res.orderNo, customer: g.customer.name, date: g.date, lines: items.length });
    } catch (e) {
      failed.push({ customer: g.customer.name, date: g.date, error: (e as Error).message });
    }
  }
  if (orders.length === 0) {
    const why = [
      duplicates.length ? `${duplicates.length} tasi avval import qilingan (${cut(duplicates.map((d) => `${d.customer} · ${d.date}`), 3)})` : "",
      failed.length ? failed.slice(0, 2).map((f) => `${f.customer} — ${f.error}`).join("; ") : "",
    ].filter(Boolean).join(" · ");
    throw new Error(`Yangi zayavka ochilmadi: ${why || "sabab aniqlanmadi"}`);
  }

  return { orders, failed, duplicates, createdCustomers, noPrice: [...noPrice], lines: rows.length };
}
