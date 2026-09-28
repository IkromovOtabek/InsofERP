import { z } from "zod";
import { db } from "./db";
import { getCompany } from "./company";
import { createLead } from "./leads";
import { unitLabel } from "./unit";

/**
 * E-commerce — Insof ECO ilovasidagi do'kon.
 *
 * Ilova ochilganda login so'ramaydi: mehmon mahsulotlarni ko'radi va buyurtma qoldiradi.
 * Buyurtma `Lead` bo'lib tushadi (`source: "eco-shop"`) — sotuv bo'limi uni
 * "Sayt arizalari" va "E-commerce → Buyurtmalar" da ko'radi, bog'lanib mijozga aylantiradi.
 * Vitrina qaysi mahsulotni ko'rsatishi `ShopItem` da (boshqaruv paneli: `/e-commerce`).
 */

export const SHOP_SOURCE = "eco-shop";
/** Ommaviy surat marshruti — ilova `erpUrl` bilan birlashtiradi. */
export const shopPhotoUrl = (stored: string) => `/api/public/shop/photo/${stored}`;

export type ShopCatalogItem = {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitLabel: string;
  strengthClass: string | null;
  price: number;
  description: string | null;
  photo: string | null;
  badge: string | null;
  minQty: number | null;
  group: string | null;
};

export type ShopCatalog = {
  company: { name: string; phone: string | null };
  items: ShopCatalogItem[];
};

/** Ilovaga beriladigan vitrina — faqat chiqarilgan va faol mahsulotlar. */
export async function shopCatalog(): Promise<ShopCatalog> {
  const [company, rows] = await Promise.all([
    getCompany(),
    db.shopItem.findMany({
      where: { isPublished: true, product: { isActive: true } },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      include: { product: { include: { group: { select: { name: true } } } } },
    }),
  ]);
  return {
    company: { name: company.name, phone: company.phone?.trim() || null },
    items: rows.map((r) => ({
      id: r.productId,
      code: r.product.code,
      name: r.title?.trim() || r.product.name,
      unit: r.product.unit,
      unitLabel: unitLabel(r.product.unit),
      strengthClass: r.product.strengthClass,
      price: Number(r.price ?? r.product.price),
      description: r.description?.trim() || null,
      photo: r.photo ? shopPhotoUrl(r.photo) : null,
      badge: r.badge?.trim() || null,
      minQty: r.minQty ? Number(r.minQty) : null,
      group: r.product.group?.name ?? null,
    })),
  };
}

const orderSchema = z.object({
  productId: z.string().trim().min(1),
  qty: z.coerce.number().positive("hajm 0 dan katta bo'lsin").max(100_000),
  name: z.string().trim().min(2, "ism to'liq yozilsin").max(80),
  phone: z.string().trim().min(1, "telefon raqami kerak"),
  address: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
  note: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
});
export type ShopOrderInput = z.input<typeof orderSchema>;
export type ShopOrderResult = { ok: true; message: string } | { ok: false; error: string };

/** Ilovadan kelgan buyurtma → sotuv bo'limiga ariza. Faqat vitrinadagi mahsulotga. */
export async function createShopOrder(raw: unknown): Promise<ShopOrderResult> {
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  const d = parsed.data;
  const item = await db.shopItem.findUnique({ where: { productId: d.productId, isPublished: true }, include: { product: { select: { name: true, unit: true } } } });
  if (!item) return { ok: false, error: "Bu mahsulot hozir do'konda yo'q" };
  if (item.minQty && d.qty < Number(item.minQty)) return { ok: false, error: `Eng kam buyurtma: ${Number(item.minQty)} ${unitLabel(item.product.unit)}` };

  const res = await createLead({
    name: d.name,
    phone: d.phone,
    productId: d.productId,
    qty: d.qty,
    address: d.address,
    message: d.note,
    source: SHOP_SOURCE,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    message: res.duplicate
      ? "Buyurtmangiz allaqachon qabul qilingan — sotuv bo'limi tez orada bog'lanadi."
      : "Buyurtma qabul qilindi. Sotuv bo'limi siz bilan bog'lanadi.",
  };
}
