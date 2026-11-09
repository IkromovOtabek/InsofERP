import { db } from "./db";
import { createOrder } from "./orders";
import { flatName, nameIndex } from "./excel";
import { withNds, ndsOf } from "./nds";
import { blockKey, blockName } from "./site-blocks";
import { notifyAfter, notifyRoles } from "./notify";

/**
 * Yangi zayavka — «Excel ko'rinish»: logistika/sotuv xodimi kunlik «Zayavka realizatsiya» varag'ini to'ldiradi.
 * Varaq uch bo'lim — tizim formasidagi to'lov turlari: Perechisleniye (bank, QQS 12% bilan), Naqd (QQS'siz) va Qarzga
 * (kafolat xati bilan; QQS va bosh to'lov usuli bo'lim uchun tanlanadi). Bitta qator — mijoz × mahsulot.
 *
 * Bo'lim + mijoz + obyekt + soat — bitta qoralama zayavka: qatorlar shu bo'yicha guruhlanadi, qator dastavkalari
 * zayavka dastavkasiga qo'shiladi. Zayavka `lib/orders.ts` → `createOrder` orqali ochiladi (qora ro'yxat, raqamlash,
 * obyekt kartasi, audit — tizim formasidagi kabi). Ro'yxatda yo'q mijoz — yangi mijoz (telefoni qatordagi raqam).
 *
 * Qator sanasi bo'sh bo'lsa — varaq sanasi; «aniq emas» — sana keyin belgilanadi (`dateUnknown`). «Reys»: 0 — dastavka yo'q,
 * 1+ — dastavka bor (soni izohga yoziladi). «Blok» — obyekt ichidagi bino (A blok…), yangi nom obyektga qo'shiladi.
 *
 * «Bosh to'lov» ustuni — qatorlar bo'yicha yig'ilib zayavka bosh to'lovi bo'ladi (bo'lim usuli bilan: naqd — kassaga,
 * perechisleniye — buxgalterga so'rov). Qora ro'yxatdagi mijozga zayavka faqat to'liq bosh to'lov bilan ochiladi.
 */
export type GridSection = "bank" | "cash" | "credit";
export type GridRow = {
  key: string;
  section: GridSection;
  customer: string;
  customerId?: string | null;
  product: string;
  productId?: string | null;
  /** Obyekt bloki nomi (A blok…) — bo'sh bo'lishi mumkin */
  block?: string | null;
  qty: number;
  /** QQS'siz narx — perechisleniyeda QQS ustiga qo'shiladi */
  price: number;
  /** Shu qatorning dastavka summasi (QQS'siz) */
  fee: number;
  /** Reys soni: 0 — dastavka yo'q (mijoz o'zi olib ketadi), 1+ — dastavka bor; null — dastavka bor, soni noma'lum */
  trips?: number | null;
  /** Kutilayotgan bosh to'lov (QQS bilan, so'm); 0 — yo'q */
  prepay?: number;
  receiver?: string | null;
  phone?: string | null;
  site?: string | null;
  time?: string | null;
  /** Yetkazish sanasi «YYYY-MM-DD»; bo'sh — varaq sanasi */
  date?: string | null;
  /** Sana aniq emas — qoralamada keyin belgilanadi */
  dateUnknown?: boolean;
  /** «Obyekt joyi» oynasida xaritadan belgilangan nuqta */
  lat?: number | null;
  lng?: number | null;
};
export type GridResult = {
  created: { id: string; orderNo: string; customer: string; credit: boolean; keys: string[] }[];
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

/** «Yangi mijoz» oynasida kiritilgan ma'lumot — shu nomdagi yangi mijoz ochilganda ishlatiladi */
export type GridNewCustomer = { name: string; phone?: string | null; inn?: string | null; address?: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function createGridOrders(
  input: {
    date: string; rows: GridRow[]; newCustomers?: GridNewCustomer[];
    /** Qarzga bo'limida QQS 12% */ creditVat?: boolean; /** Qarzga bo'limida bosh to'lov qanday keladi */ creditPay?: "CASH" | "BANK";
  },
  userId: string,
): Promise<GridResult> {
  if (!ISO.test(input.date)) throw new Error("Sana noto'g'ri");
  const details = new Map((input.newCustomers ?? []).map((c) => [flatName(c.name), c]));
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

  // ── Guruhlash: bo'lim + mijoz + obyekt + sana + soat. Qator xatosi butun guruhni to'xtatadi (qisman zayavka ochilmasin)
  type Group = { section: GridSection; customer: string; customerId: string | null; site: string; time: string | null; date: string; dateUnknown: boolean; rows: GridRow[]; error?: string };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const known = (r.customerId && customerById.get(r.customerId)) || customerByName.get(flatName(r.customer)) || null;
    const time = gridTime(r.time);
    const day = r.date?.trim() || input.date;
    const key = [r.section, known?.id ?? `new:${flatName(r.customer)}`, norm(r.site ?? ""), time ?? "", r.dateUnknown ? "?" : day].join("|");
    const g = groups.get(key) ?? { section: r.section, customer: known?.name ?? r.customer.trim(), customerId: known?.id ?? null, site: (r.site ?? "").trim(), time: time ?? null, date: day, dateUnknown: !!r.dateUnknown, rows: [] };
    g.rows.push(r);
    if (!g.error) {
      if (!r.customer.trim()) g.error = "«Kimga» (mijoz) yozilmagan";
      else if (!r.product.trim()) g.error = "Mahsulot yozilmagan";
      else if (!((r.productId && productById.get(r.productId)) || productByName.get(flatName(r.product)))) g.error = `Bunday mahsulot ro'yxatda yo'q: «${r.product}»`;
      else if (!(r.qty > 0)) g.error = `${r.product}: soni 0 dan katta bo'lsin`;
      else if (!(r.price >= 0) || !(r.fee >= 0) || !((r.prepay ?? 0) >= 0)) g.error = `${r.product}: narx, dastavka yoki bosh to'lov manfiy bo'lmasin`;
      else if (time === undefined) g.error = `Vaqt noto'g'ri: «${r.time}» — masalan 9:00`;
      else if (!r.dateUnknown && !ISO.test(day)) g.error = `Sana noto'g'ri: «${r.date}»`;
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
    const credit = g.section === "credit";
    const vat = g.section === "bank" || (credit && !!input.creditVat);
    const customerId = g.customerId ?? newCustomers.get(flatName(g.customer)) ?? null;
    const c = customerId ? customerById.get(customerId) : null;
    const fresh = customerId ? null : details.get(flatName(g.customer)) ?? null; // «Yangi mijoz» oynasidagi ma'lumot
    // Obyekt: qatordagi joy → mijozning oxirgi obyekti → mijoz (yoki yangi mijoz) manzili. Nuqta — mijozning shu manzildagi obyektidan
    const address = g.site || c?.sites[0]?.address || c?.address?.trim() || fresh?.address?.trim() || "";
    if (!address) { failed.push({ customer: g.customer, error: "«Obyekt joyi» yozilmagan", keys }); continue; }
    // Nuqta: xaritada belgilangani → mijozning shu manzildagi obyektiniki
    const marked = g.rows.find((r) => r.lat != null && r.lng != null);
    const place = marked ? { lat: marked.lat!, lng: marked.lng! } : c?.sites.find((s) => norm(s.address) === norm(address));

    // Bir blokda bir mahsulot takrorlansa — bir qator (narx birinchisidan); QQS narx va dastavka ustiga qo'shiladi
    const items = new Map<string, { productId: string; block: string | null; qty: number; price: number }>();
    let fee = 0, prepay = 0, trips = 0;
    for (const r of g.rows) {
      const p = (r.productId && productById.get(r.productId)) || productByName.get(flatName(r.product))!;
      const block = blockName(r.block);
      const k = `${p.id}|${blockKey(block) ?? ""}`, prev = items.get(k);
      items.set(k, { productId: p.id, block, qty: (prev?.qty ?? 0) + r.qty, price: prev?.price ?? r.price });
      if (r.trips !== 0) fee += r.fee; // reys 0 — dastavka yo'q
      prepay += r.prepay ?? 0;
      trips += r.trips ?? 0;
    }
    // Dastavka: hamma qatorda reys 0 — mijoz o'zi olib ketadi; biror qatorda reys bor yoki bo'sh (soni noma'lum) — dastavka bor
    const needsDelivery = !g.rows.every((r) => r.trips === 0);
    const lines = [...items.values()].map((v) => ({ productId: v.productId, qtyM3: v.qty, price: vat ? withNds(v.price) : v.price, nds: vat, block: v.block }));
    const deliveryFee = needsDelivery ? r2(fee + (vat ? ndsOf(fee) : 0)) : 0;

    // Saqlash ikki marta bosilsa (javob kelmay qolgan) — shu xodim yaqinda ochgan aynan shu zayavka takrorlanmaydi
    if (customerId) {
      const sig = (l: { productId: string; qtyM3: unknown }[]) => l.map((i) => `${i.productId}:${Number(i.qtyM3)}`).sort().join("|");
      const same = await db.order.findFirst({
        where: { customerId, createdById: userId, createdAt: { gte: since }, ...(g.dateUnknown ? { dateUnknown: true } : { deliveryDate: new Date(g.date) }), deliveryTime: g.time, deliveryAddress: address, status: "DRAFT" },
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
          ...(customerId ? { customerId } : { newCustomer: { name: g.customer, phone: fresh?.phone?.trim() || phone, inn: fresh?.inn ?? null, address: fresh?.address?.trim() || null } }),
          // Tizim formasidagi kabi: «YYYY-MM-DD» → UTC yarim kechasi (taqvim va hisobotlar shu bilan ishlaydi)
          deliveryDate: new Date(g.date),
          dateUnknown: g.dateUnknown,
          deliveryTime: g.time,
          deliveryAddress: address,
          lat: place?.lat ?? null,
          lng: place?.lng ?? null,
          items: lines,
          needsDelivery,
          deliveryFee,
          // Tizim formasidagi «Naqd» / «Perechisleniye» / «Qarzga»: qarzga usul faqat bosh to'lov bo'lsa beriladi
          onCredit: credit,
          prepay: prepay > 0 ? { amount: r2(prepay) } : undefined,
          payMethod: g.section === "bank" ? "BANK" : g.section === "cash" ? "CASH" : prepay > 0 ? (input.creditPay ?? "CASH") : null,
          note: [receivers.length ? `Qabul qiluvchi: ${receivers.join("; ")}` : null, trips > 0 ? `Dastavka: ${trips} reys` : null, "Excel ko'rinishdan"].filter(Boolean).join("\n"),
        },
        userId,
        { viaImport: true }, // «create» va «excel» ruxsati chaqiruvchida tekshirilgan; sotuvga bitta umumiy xabar boradi
      );
      if (!customerId) newCustomers.set(flatName(g.customer), res.customerId);
      created.push({ id: res.id, orderNo: res.orderNo, customer: g.customer, credit: res.onCredit, keys });
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
