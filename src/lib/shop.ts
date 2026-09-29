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
  /** Mahsulot kimniki — ilovada kartada ko'rinadi, bosilsa zavod profili ochiladi. */
  sellerId: string;
};

/** Sotuvchi (zavod) profili — hozir bitta zavod; SaaS'da har nusxa o'z zavodini beradi. */
export type ShopSeller = {
  id: string; name: string; legalName: string | null; about: string | null; address: string | null;
  phone: string | null; phone2: string | null; email: string | null; workingHours: string | null;
  foundedYear: number | null; location: { lat: number; lng: number } | null;
};

/** Bosh sahifa swiper'idagi reklama. */
export type ShopBannerItem = { id: string; title: string; subtitle: string | null; image: string | null; productId: string | null; buttonText: string | null };

export type ShopCatalog = {
  company: { name: string; phone: string | null; address: string | null };
  seller: ShopSeller;
  banners: ShopBannerItem[];
  items: ShopCatalogItem[];
};

/** Zavodning ommaviy identifikatori — hozircha bitta; ko'p zavodli bo'lsa CompanySettings.id. */
export const SELLER_ID = "main";

/** Ilovaga beriladigan vitrina — faqat chiqarilgan va faol mahsulotlar. */
export async function shopCatalog(): Promise<ShopCatalog> {
  const now = new Date();
  const [company, rows, banners] = await Promise.all([
    getCompany(),
    db.shopItem.findMany({
      where: { isPublished: true, product: { isActive: true } },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      include: { product: { include: { group: { select: { name: true } } } } },
    }),
    db.shopBanner.findMany({
      where: {
        isActive: true,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ]);
  const t = (v: string | null | undefined) => v?.trim() || null;
  return {
    company: { name: company.name, phone: t(company.phone), address: t(company.address) },
    seller: {
      id: SELLER_ID, name: company.name, legalName: t(company.legalName), about: t(company.about), address: t(company.address),
      phone: t(company.phone), phone2: t(company.phone2), email: t(company.email), workingHours: t(company.workingHours),
      foundedYear: company.foundedYear, location: company.lat != null && company.lng != null ? { lat: company.lat, lng: company.lng } : null,
    },
    banners: banners.map((b) => ({ id: b.id, title: b.title, subtitle: t(b.subtitle), image: b.image ? shopPhotoUrl(b.image) : null, productId: b.productId, buttonText: t(b.buttonText) })),
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
      sellerId: SELLER_ID,
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

const callbackSchema = z.object({
  name: z.string().trim().min(2, "ism to'liq yozilsin").max(80),
  phone: z.string().trim().min(1, "telefon raqami kerak"),
  message: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
});

/**
 * Ilovaning "Aloqa" bo'limidan "Menga qo'ng'iroq qiling" so'rovi — mahsulotsiz ariza.
 * Mijoz hali nima kerakligini bilmasa ham raqamini qoldiradi; sotuvchi qo'ng'iroq qiladi.
 */
export async function createShopCallback(raw: unknown): Promise<ShopOrderResult> {
  const parsed = callbackSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  const d = parsed.data;
  const res = await createLead({ name: d.name, phone: d.phone, message: d.message ?? "Ilovadan: qayta qo'ng'iroq so'rovi", source: SHOP_SOURCE });
  if (!res.ok) return res;
  return { ok: true, message: res.duplicate ? "So'rovingiz allaqachon qabul qilingan — tez orada qo'ng'iroq qilamiz." : "Rahmat! Ish vaqtida sizga qo'ng'iroq qilamiz." };
}
