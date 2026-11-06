import { db } from "./db";
import { audit } from "./audit";
import { lockStock } from "./stock-lock";
import { MAX_AMOUNT } from "./action";
import { isoDate } from "./format";
import { ISSUE_BACK_DAYS } from "./stock-issue";
import { Prisma, type Role } from "@/generated/prisma";

class AddStockError extends Error {}

/** Bitta formada qo'shiladigan qatorlar soni chegarasi */
const MAX_LINES = 100;

/**
 * Kirim sanasi ("YYYY-MM-DD", server vaqti Asia/Tashkent): bugun — hozirgi vaqt, o'tgan kun — o'sha kunning 12:00 i
 * (Chiqim bilan bir xil qoida, `stock-issue.ts` → `issueDate`). Kelajak va `ISSUE_BACK_DAYS` (31) kundan eski — rad.
 */
function stockDay(s: string | null | undefined, now = new Date()): Date | { error: string } {
  const v = (s ?? "").trim();
  if (!v) return now;
  const day = new Date(`${v}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(day.getTime()) || isoDate(day) !== v) return { error: "Sana noto'g'ri" };
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  if (day > today) return { error: "Sana kelajakda bo'lishi mumkin emas" };
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);
  if (day < min) return { error: `Sana ${ISSUE_BACK_DAYS} kundan eski bo'lmasin` };
  if (day.getTime() === today.getTime()) return now;
  const d = new Date(day); d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * Hovliga tayyor mahsulotni qo'lda kirim qilish (retseptsiz). Sklad harakati: ADJUSTMENT (+), refType "Manual".
 * Qoldiqni hujjatsiz oshirib bo'lmasin: faqat HALI HARAKATI YO'Q mahsulotga (boshlang'ich qoldiq)
 * yoki direktor. Ishlab chiqarilgan mahsulot topshiriq orqali (PRODUCTION_OUTPUT) kirim bo'ladi.
 * Veb (`stock/products/actions.ts`) va mobil ilova (`lib/mobile/sklad-extra.ts`) shu yerdan chaqiradi.
 * Ruxsat (stock → "products") va `revalidatePath` — chaqiruvchida.
 *
 * Ikki marta bosilgan "Qo'shish": formadagi bir martalik kalit (StockMove.clientToken — unique) bilan
 * ikkinchi so'rov hech narsa yozmaydi (`dup`). Kalitsiz so'rov uchun — "harakati yo'q" tekshiruvi qulf ichida.
 */
export async function addProductStock(
  input: { productId: string; warehouseId: string; qty: number; note?: string | null; clientToken?: string | null; date?: string | null },
  actor: { userId: string; role: Role },
): Promise<{ ok: true; dup: boolean; productId: string } | { error: string }> {
  const r = await addProductStockLines({ ...input, lines: [{ productId: input.productId, qty: input.qty }] }, actor);
  return "error" in r ? r : { ok: true, dup: r.dup, productId: input.productId };
}

/**
 * Bir nechta mahsulotni bitta formada (Sklad → Tayyor mahsulot qo'shish): bir sklad, bir sana, bir izoh; hammasi bitta
 * tranzaksiyada — biror qator xato bo'lsa hech biri yozilmaydi. Bir mahsulot ikki qatorda bo'lsa — miqdori qo'shiladi.
 * Bir martalik kalit birinchi harakatga yoziladi — takror yuborilgan forma butunlay `dup` bo'ladi.
 */
export async function addProductStockLines(
  input: { lines: { productId: string; qty: number }[]; warehouseId: string; note?: string | null; clientToken?: string | null; date?: string | null },
  actor: { userId: string; role: Role },
): Promise<{ ok: true; dup: boolean; count: number } | { error: string }> {
  if (!input.warehouseId) return { error: "Sklad tanlanmagan" };
  if (!input.lines.length) return { error: "Kamida bitta mahsulot qatori kerak" };
  if (input.lines.length > MAX_LINES) return { error: `Bir yo'la ${MAX_LINES} qatordan ko'p bo'lmasin` };
  for (const [i, l] of input.lines.entries()) {
    const at = input.lines.length > 1 ? `${i + 1}-qator: ` : "";
    if (!l.productId) return { error: `${at}Mahsulot tanlanmagan` };
    if (!Number.isInteger(l.qty)) return { error: `${at}Miqdor butun son bo'lsin` };
    if (!(l.qty > 0)) return { error: `${at}Miqdor 0 dan katta bo'lsin` };
    if (l.qty > MAX_AMOUNT) return { error: `${at}Qiymat juda katta` };
  }
  const merged = new Map<string, number>();
  for (const l of input.lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.qty);
  if ([...merged.values()].some((q) => q > MAX_AMOUNT)) return { error: "Qiymat juda katta" };
  const date = stockDay(input.date);
  if ("error" in date) return date;
  const [products, wh] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...merged.keys()] } }, select: { id: true, code: true, name: true, unit: true } }),
    db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } }),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  if ([...merged.keys()].some((id) => { const p = byId.get(id); return !p || p.unit === "m3"; })) return { error: "Faqat dona mahsulot qo'shiladi" };
  if (!wh) return { error: "Sklad topilmadi" };
  const raw = input.clientToken;
  const clientToken = typeof raw === "string" && /^[A-Za-z0-9-]{16,64}$/.test(raw.trim()) ? raw.trim() : null;
  const note = input.note?.trim() || null;
  const res = await db.$transaction(async (tx) => {
    await lockStock(tx);
    if (clientToken && (await tx.stockMove.findUnique({ where: { clientToken }, select: { id: true } }))) return "dup" as const;
    if (actor.role !== "DIRECTOR") {
      const moved = await tx.stockMove.groupBy({ by: ["productId"], where: { productId: { in: [...merged.keys()] } } });
      if (moved.length) {
        const names = moved.map((m) => `"${byId.get(m.productId!)?.name}"`).join(", ");
        throw new AddStockError(`${names} skladda harakati bor — qo'lda qoldiq qo'shib bo'lmaydi. Ishlab chiqarilgani topshiriq (brigada) orqali kirim bo'ladi; sanoq farqini direktor tuzatadi`);
      }
    }
    let first = true;
    for (const [productId, qty] of merged) {
      const p = byId.get(productId)!;
      const m = await tx.stockMove.create({ data: { type: "ADJUSTMENT", date, warehouseId: wh.id, productId, qty, note: note ?? "Qo'lda qo'shildi", refType: "Manual", clientToken: first ? clientToken : null, createdById: actor.userId } });
      await audit(tx, actor.userId, "CREATE", "StockMove", m.id, undefined, { product: p.code, qty, note, date });
      first = false;
    }
    return "ok" as const;
  }).catch((e: Error) => {
    if (e instanceof AddStockError) return { error: e.message };
    if (clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "dup" as const;
    throw e;
  });
  if (typeof res === "object") return res;
  return { ok: true, dup: res === "dup", count: merged.size };
}
