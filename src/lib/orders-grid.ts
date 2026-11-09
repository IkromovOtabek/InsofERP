import { db } from "./db";
import { createOrder } from "./orders";
import { flatName, nameIndex } from "./excel";
import { withNds, ndsOf } from "./nds";
import { notifyAfter, notifyRoles } from "./notify";

/**
 * Yangi zayavka — «Excel ko'rinish»: logistika/sotuv xodimi kunlik «Zayavka realizatsiya» varag'ini to'ldiradi.
 * Varaq ikki bo'lim: Perechisleniye (bank, QQS 12% bilan) va Naqd (QQS'siz). Bitta qator — mijoz × mahsulot.
 *
 * Bo'lim + mijoz + obyekt + soat — bitta qoralama zayavka: qatorlar shu bo'yicha guruhlanadi, qator dastavkalari
 * zayavka dastavkasiga qo'shiladi. Zayavka `lib/orders.ts` → `createOrder` orqali ochiladi (qora ro'yxat, raqamlash,
 * obyekt kartasi, audit — tizim formasidagi kabi). Ro'yxatda yo'q mijoz — yangi mijoz (telefoni qatordagi raqam).
 *
 * «Bosh to'lov» ustuni — qatorlar bo'yicha yig'ilib zayavka bosh to'lovi bo'ladi (bo'lim usuli bilan: naqd — kassaga,
 * perechisleniye — buxgalterga so'rov). Qora ro'yxatdagi mijozga zayavka faqat to'liq bosh to'lov bilan ochiladi.
 */
export type GridSection = "bank" | "cash";
export type GridRow = {
  key: string;
  section: GridSection;
  customer: string;
  customerId?: string | null;
  product: string;
  productId?: string | null;
  qty: number;
  /** QQS'siz narx — perechisleniyeda QQS ustiga qo'shiladi */
  price: number;
  /** Shu qatorning dastavka summasi (QQS'siz) */
  fee: number;
  /** Kutilayotgan bosh to'lov (QQS bilan, so'm); 0 — yo'q */
  prepay?: number;
  receiver?: string | null;
  phone?: string | null;
  site?: string | null;
  time?: string | null;
};
export type GridResult = {
  created: { id: string; orderNo: string; customer: string; keys: string[] }[];
  failed: { customer: string; error: string; keys: string[] }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** «6:30», «6.30», «0630», «15» → «06:30» / «15:00»; bo'sh — null; noto'g'ri — undefined. */
export function gridTime(v?: string | null): string | null | undefined {
  const t = (v ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?:[:.,\s-]?(\d{2}))?$/);
  if (!m) return undefined;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export async function createGridOrders(input: { date: string; rows: GridRow[] }, userId: string): Promise<GridResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Sana noto'g'ri");
  const rows = input.rows.filter((r) => r.customer.trim() || r.product.trim());
  if (rows.length === 0) throw new Error("Jadvalda to'ldirilgan qator yo'q");

  const [products, customers] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
    db.customer.findMany({
      where: { isActive: true, isInternal: false },
      select: { id: true, name: true, aliases: true, address: true, sites: { where: { isActive: true }, orderBy: { createdAt: "desc" }, select: { address: true, lat: true, lng: true } } },
    }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const productByName = new Map<string, (typeof products)[number]>();
  for (const p of products) { productByName.set(flatName(p.code), p); productByName.set(flatName(p.name), p); }
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const customerByName = nameIndex(customers);

  // ── Guruhlash: bo'lim + mijoz + obyekt + soat. Qator xatosi butun guruhni to'xtatadi (qisman zayavka ochilmasin)
  type Group = { section: GridSection; customer: string; customerId: string | null; site: string; time: string | null; rows: GridRow[]; error?: string };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const known = (r.customerId && customerById.get(r.customerId)) || customerByName.get(flatName(r.customer)) || null;
    const time = gridTime(r.time);
    const key = [r.section, known?.id ?? `new:${flatName(r.customer)}`, norm(r.site ?? ""), time ?? ""].join("|");
    const g = groups.get(key) ?? { section: r.section, customer: known?.name ?? r.customer.trim(), customerId: known?.id ?? null, site: (r.site ?? "").trim(), time: time ?? null, rows: [] };
    g.rows.push(r);
    if (!g.error) {
      if (!r.customer.trim()) g.error = "«Kimga» (mijoz) yozilmagan";
      else if (!r.product.trim()) g.error = "Mahsulot yozilmagan";
      else if (!((r.productId && productById.get(r.productId)) || productByName.get(flatName(r.product)))) g.error = `Bunday mahsulot ro'yxatda yo'q: «${r.product}»`;
      else if (!(r.qty > 0)) g.error = `${r.product}: soni 0 dan katta bo'lsin`;
      else if (!(r.price >= 0) || !(r.fee >= 0) || !((r.prepay ?? 0) >= 0)) g.error = `${r.product}: narx, dastavka yoki bosh to'lov manfiy bo'lmasin`;
      else if (time === undefined) g.error = `Vaqt noto'g'ri: «${r.time}» — masalan 9:00`;
    }
    groups.set(key, g);
  }

  const created: GridResult["created"] = [];
  const failed: GridResult["failed"] = [];
  const newCustomers = new Map<string, string>(); // shu varaqda ochilgan yangi mijoz — keyingi guruhlar o'shani oladi
  const since = new Date(Date.now() - 15 * 60_000);

  for (const g of groups.values()) {
    const keys = g.rows.map((r) => r.key);
    if (g.error) { failed.push({ customer: g.customer, error: g.error, keys }); continue; }
    const bank = g.section === "bank";
    const customerId = g.customerId ?? newCustomers.get(flatName(g.customer)) ?? null;
    const c = customerId ? customerById.get(customerId) : null;
    // Obyekt: qatordagi joy → mijozning oxirgi obyekti → mijoz manzili. Nuqta — mijozning shu manzildagi obyektidan
    const address = g.site || c?.sites[0]?.address || c?.address?.trim() || "";
    if (!address) { failed.push({ customer: g.customer, error: "«Obyekt joyi» yozilmagan", keys }); continue; }
    const place = c?.sites.find((s) => norm(s.address) === norm(address));

    // Bir mahsulot takrorlansa — bir qator (narx birinchisidan); QQS perechisleniyeda narx ustiga qo'shiladi
    const items = new Map<string, { qty: number; price: number }>();
    let fee = 0, prepay = 0;
    for (const r of g.rows) {
      const p = (r.productId && productById.get(r.productId)) || productByName.get(flatName(r.product))!;
      const prev = items.get(p.id);
      items.set(p.id, { qty: (prev?.qty ?? 0) + r.qty, price: prev?.price ?? r.price });
      fee += r.fee;
      prepay += r.prepay ?? 0;
    }
    const lines = [...items].map(([productId, v]) => ({ productId, qtyM3: v.qty, price: bank ? withNds(v.price) : v.price, nds: bank }));
    const deliveryFee = r2(fee + (bank ? ndsOf(fee) : 0));

    // Saqlash ikki marta bosilsa (javob kelmay qolgan) — shu xodim yaqinda ochgan aynan shu zayavka takrorlanmaydi
    if (customerId) {
      const sig = (l: { productId: string; qtyM3: unknown }[]) => l.map((i) => `${i.productId}:${Number(i.qtyM3)}`).sort().join("|");
      const same = await db.order.findFirst({
        where: { customerId, createdById: userId, createdAt: { gte: since }, deliveryDate: new Date(input.date), deliveryTime: g.time, deliveryAddress: address, status: "DRAFT" },
        select: { orderNo: true, items: { select: { productId: true, qtyM3: true } } },
        orderBy: { createdAt: "desc" },
      });
      if (same && sig(same.items) === sig(lines)) { failed.push({ customer: g.customer, error: `Bu zayavka hozirgina ochilgan: ${same.orderNo}`, keys }); continue; }
    }

    const receivers = [...new Set(g.rows.map((r) => [r.receiver?.trim(), r.phone?.trim()].filter(Boolean).join(", ")).filter(Boolean))];
    const phone = g.rows.map((r) => r.phone?.trim()).find(Boolean) ?? null;
    try {
      const res = await createOrder(
        {
          ...(customerId ? { customerId } : { newCustomer: { name: g.customer, phone } }),
          // Tizim formasidagi kabi: «YYYY-MM-DD» → UTC yarim kechasi (taqvim va hisobotlar shu bilan ishlaydi)
          deliveryDate: new Date(input.date),
          deliveryTime: g.time,
          deliveryAddress: address,
          lat: place?.lat ?? null,
          lng: place?.lng ?? null,
          items: lines,
          needsDelivery: true,
          deliveryFee,
          // Tizim formasidagi «Naqd» / «Perechisleniye» (bosh to'lovsiz)
          onCredit: false,
          prepay: prepay > 0 ? { amount: r2(prepay) } : undefined,
          payMethod: bank ? "BANK" : "CASH",
          note: [receivers.length ? `Qabul qiluvchi: ${receivers.join("; ")}` : null, "Excel ko'rinishdan"].filter(Boolean).join("\n"),
        },
        userId,
        { viaImport: true }, // «create» va «excel» ruxsati chaqiruvchida tekshirilgan; sotuvga bitta umumiy xabar boradi
      );
      if (!customerId) newCustomers.set(flatName(g.customer), res.customerId);
      created.push({ id: res.id, orderNo: res.orderNo, customer: g.customer, keys });
    } catch (e) {
      failed.push({ customer: g.customer, error: (e as Error).message || "Zayavka saqlanmadi", keys });
    }
  }

  // Sotuvdan boshqa xodim ochgan qoralamalar — sotuv qabul qiladi; har zayavkaga alohida emas, bitta xabar
  if (created.length) {
    notifyAfter(async () => {
      const u = await db.user.findUnique({ where: { id: userId }, select: { role: true, fullName: true } });
      if (!u || u.role === "SALES" || u.role === "DIRECTOR" || u.role === "SUPERADMIN") return;
      const names = [...new Set(created.map((x) => x.customer))];
      await notifyRoles(["SALES"], {
        type: "ORDER_NEW",
        title: created.length > 1 ? `${created.length} ta yangi zayavka — qabul qilish kerak` : "Yangi zayavka — qabul qilish kerak",
        body: `${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""} · ochdi: ${u.fullName}`,
        link: { key: "orders", id: created[0]!.id },
      }, { except: userId });
    });
  }
  return { created, failed };
}
