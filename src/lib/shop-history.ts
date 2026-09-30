import { db } from "./db";
import { isoDate } from "./format";

/**
 * E-commerce o'zgarishlar tarixi — vitrina (ShopItem) va reklama (ShopBanner) tahrirlari.
 *
 * Alohida jadval yo'q: har saqlash `AuditLog` ga yoziladi (before/after), bu yerda maydon
 * bo'yicha "nima → nimaga" ko'rinishiga aylantiriladi. Eski yozuvlarda `before` butun Prisma
 * qatori (Decimal satr) bo'lgani uchun faqat ma'lum maydonlar solishtiriladi va normallashtiriladi.
 */

export const SHOP_HISTORY_ENTITIES = ["ShopItem", "ShopBanner"] as const;

type FieldKind = "text" | "money" | "num" | "bool" | "photo" | "date" | "product";
const ITEM_FIELDS: Record<string, { label: string; kind: FieldKind; empty?: string }> = {
  isPublished: { label: "Do'konda", kind: "bool" },
  title: { label: "Nomi", kind: "text", empty: "mahsulot nomi" },
  price: { label: "Narx", kind: "money", empty: "bazaviy narx" },
  minQty: { label: "Eng kam buyurtma", kind: "num" },
  badge: { label: "Yorliq", kind: "text" },
  sortOrder: { label: "Tartib", kind: "num" },
  photo: { label: "Surat", kind: "photo" },
  description: { label: "Tavsif", kind: "text" },
};
const BANNER_FIELDS: Record<string, { label: string; kind: FieldKind; empty?: string }> = {
  isActive: { label: "Faol", kind: "bool" },
  title: { label: "Sarlavha", kind: "text" },
  subtitle: { label: "Matn", kind: "text" },
  buttonText: { label: "Tugma", kind: "text" },
  productId: { label: "Mahsulot", kind: "product" },
  sortOrder: { label: "Tartib", kind: "num" },
  startsAt: { label: "Boshlanishi", kind: "date" },
  endsAt: { label: "Tugashi", kind: "date" },
  image: { label: "Surat", kind: "photo" },
};

export type ShopChange = { field: string; from: string | null; to: string | null };
export type ShopHistoryEntry = {
  id: string;
  at: Date;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  /** Nima o'zgargani: mahsulot yoki banner nomi. */
  subject: string;
  changes: ShopChange[];
};

type Rec = Record<string, unknown> | null;
const asRec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function norm(v: unknown, kind: FieldKind): string | number | boolean | null {
  if (v === undefined || v === null || v === "") return null;
  if (kind === "bool") return v === true || v === "true";
  if (kind === "money" || kind === "num") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (kind === "date") { const d = new Date(String(v)); return Number.isNaN(+d) ? null : isoDate(d); }
  return String(v);
}

function show(v: string | number | boolean | null, kind: FieldKind, names: Map<string, string>): string | null {
  if (v === null) return kind === "bool" ? "Yo'q" : null;
  if (kind === "bool") return v ? "Ha" : "Yo'q";
  if (kind === "money") return `${Number(v).toLocaleString("ru-RU")} so'm`;
  if (kind === "num") return Number(v).toLocaleString("ru-RU");
  if (kind === "photo") return "surat";
  if (kind === "product") return names.get(String(v)) ?? "o'chirilgan mahsulot";
  if (kind === "date") { const [y, m, d] = String(v).split("-"); return `${d}.${m}.${y}`; }
  return String(v);
}

/** Ikki holat orasidagi farq. `before` bo'lmasa (yangi yozuv) — to'ldirilgan maydonlar. */
export function shopDiff(entity: string, before: unknown, after: unknown, names: Map<string, string> = new Map()): ShopChange[] {
  const fields = entity === "ShopBanner" ? BANNER_FIELDS : ITEM_FIELDS;
  const b = asRec(before), a = asRec(after);
  const out: ShopChange[] = [];
  for (const [key, { label, kind, empty }] of Object.entries(fields)) {
    // after'da maydon umuman bo'lmasa — o'zgarmagan (masalan, surat yuklanmagan saqlash)
    if (a && !(key in a)) continue;
    const from = b ? norm(b[key], kind) : null;
    const to = a ? norm(a[key], kind) : null;
    if (from === to) continue;
    if (!b && (to === null || to === false || (kind === "num" && to === 0))) continue;
    if (kind === "photo") {
      out.push({ field: label, from: null, to: from === null ? "qo'shildi" : to === null ? "olib tashlandi" : "almashtirildi" });
      continue;
    }
    // Bo'sh nom/narx = mahsulotniki olinadi — "bo'sh" emas, shuni yozamiz
    out.push({ field: label, from: from === null && b ? empty ?? null : show(from, kind, names), to: to === null && empty ? empty : show(to, kind, names) });
  }
  return out;
}

/**
 * Tarix yozuvlari: hamma e-commerce o'zgarishlari yoki bitta obyektniki (`entityIds`).
 * `names` — productId → nom (ShopItem id ham), sahifa allaqachon yuklagan mahsulotlardan.
 */
export async function shopHistory(opts: { names: Map<string, string>; entityIds?: string[]; take?: number }): Promise<ShopHistoryEntry[]> {
  const logs = await db.auditLog.findMany({
    where: { entity: { in: [...SHOP_HISTORY_ENTITIES] }, ...(opts.entityIds ? { entityId: { in: opts.entityIds } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 300,
    include: { user: { select: { fullName: true } } },
  });
  return logs.map((l) => {
    const a = asRec(l.after), b = asRec(l.before);
    const subject = l.entity === "ShopBanner"
      ? `Reklama: ${String(a?.title ?? b?.title ?? "—")}`
      : opts.names.get(l.entityId) ?? String(a?.product ?? b?.product ?? "Mahsulot");
    return {
      id: l.id, at: l.createdAt, user: l.user.fullName, action: l.action, entity: l.entity, entityId: l.entityId, subject,
      changes: l.action === "DELETE" ? [] : shopDiff(l.entity, l.before, l.after, opts.names),
    };
  });
}

/** Vitrina qatorining audit uchun surati — faqat ilovada ko'rinadigan maydonlar. */
export function shopItemSnapshot(it: { isPublished: boolean; title: string | null; description: string | null; badge: string | null; price: unknown; minQty: unknown; sortOrder: number; photo: string | null } | null) {
  if (!it) return null;
  return {
    isPublished: it.isPublished, title: it.title, description: it.description, badge: it.badge,
    price: it.price == null ? null : Number(it.price), minQty: it.minQty == null ? null : Number(it.minQty),
    sortOrder: it.sortOrder, photo: it.photo,
  };
}
