import type { Prisma } from "@/generated/prisma";

/**
 * Obyekt bloklari — obyekt ichidagi binolar (A blok, B blok…). Zayavka qatori blok NOMI bilan keladi:
 * obyektda shu nom bor bo'lsa (katta-kichik harf farqisiz) o'sha, yo'q bo'lsa yangisi qo'shiladi —
 * obyekt kartasi zayavkada manzil bo'yicha ochilgani kabi (`ensureSite`). Bloklarni mijoz kartasidagi
 * «Obyektlar» bo'limida ham tahrirlasa bo'ladi. Ishlab chiqarish matritsasida bir obyektning har bloki alohida ustun.
 */

/** Saralash: kiritilgan tartib, keyin nomi */
export const BLOCK_ORDER = [{ sortOrder: "asc" }, { name: "asc" }] satisfies Prisma.SiteBlockOrderByWithRelationInput[];

/** «  a   blok » → «A blok»: bo'sh joylar yig'iladi, birinchi harf katta, 40 belgidan oshmaydi. Bo'sh bo'lsa — null. */
export function blockName(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return s ? s[0]!.toLocaleUpperCase("uz") + s.slice(1) : null;
}

/** Taqqoslash kaliti — katta-kichik harf farqisiz */
export const blockKey = (raw: string | null | undefined) => blockName(raw)?.toLocaleLowerCase("uz") ?? null;

/**
 * Blok nomlarini id ga aylantiradi (kalit — `blockKey`). Obyektdagi bor blok olinadi («faol emas» bo'lsa qayta faollashadi),
 * yo'g'i ro'yxat oxiriga qo'shiladi. Zayavka ochish/tahrirlash tranzaksiyasi ichida chaqiriladi.
 */
export async function ensureBlocks(tx: Prisma.TransactionClient, siteId: string, names: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const want = [...new Set(names.map(blockName).filter((x): x is string => !!x))];
  if (!want.length) return out;
  const have = await tx.siteBlock.findMany({ where: { siteId }, select: { id: true, name: true, isActive: true, sortOrder: true } });
  const byKey = new Map(have.map((b) => [b.name.toLocaleLowerCase("uz"), b]));
  let next = Math.max(-1, ...have.map((b) => b.sortOrder)) + 1;
  for (const name of want) {
    const key = name.toLocaleLowerCase("uz");
    if (out.has(key)) continue;
    const b = byKey.get(key);
    if (b) {
      if (!b.isActive) await tx.siteBlock.update({ where: { id: b.id }, data: { isActive: true } });
      out.set(key, b.id);
      continue;
    }
    // upsert: parallel zayavka shu nomni bir vaqtda qo'shsa ham ikkinchisi xato bermasin
    const c = await tx.siteBlock.upsert({ where: { siteId_name: { siteId, name } }, create: { siteId, name, sortOrder: next++ }, update: {}, select: { id: true } });
    out.set(key, c.id);
  }
  return out;
}

export type BlockRename = { id: string; from: string; to: string };

/**
 * Blokni qayta nomlash (obyekt formasidagi chip qalami): blok o'sha id bilan qoladi — zayavka qatorlari unga bog'liqligicha,
 * matritsada ustun ikkiga bo'linmaydi (o'chirib yangi nom qo'shilsa eski blok «faol emas» bo'lib, yangisi alohida ustun bo'lardi).
 * `from` — bazadagi joriy nom. Yangi nom shu obyektdagi boshqa blokda (faol emasida ham) bo'lsa — xato.
 * Tranzaksiya ichida chaqiriladi; audit — chaqiruvchida (bu modul klientda ham ishlatiladi, `db`/`audit` import qilinmaydi).
 */
export async function renameSiteBlocks(tx: Prisma.TransactionClient, siteId: string, pairs: { from: string; to: string }[]): Promise<{ ok: true; renamed: BlockRename[] } | { ok: false; error: string }> {
  const list = pairs.map((p) => ({ from: blockName(p.from), to: blockName(p.to) })).filter((p): p is { from: string; to: string } => !!p.from && !!p.to && p.from !== p.to);
  if (!list.length) return { ok: true, renamed: [] };
  const have = await tx.siteBlock.findMany({ where: { siteId }, select: { id: true, name: true, isActive: true } });
  const byKey = new Map(have.map((b) => [b.name.toLocaleLowerCase("uz"), b]));
  const renamed: BlockRename[] = [];
  for (const p of list) {
    const fromKey = p.from.toLocaleLowerCase("uz"), toKey = p.to.toLocaleLowerCase("uz");
    const b = byKey.get(fromKey);
    if (!b) continue; // shu orada o'chirilgan — ro'yxat sinxroni (`syncSiteBlocks`) yangi nomni o'zi qo'shadi
    const other = byKey.get(toKey);
    if (other && other.id !== b.id) {
      return { ok: false, error: other.isActive
        ? `«${p.to}» nomli blok bu obyektda allaqachon bor — boshqa nom bering`
        : `«${p.to}» nomli eski (faol emas) blok bor — boshqa nom bering yoki shu nomni «Blok qo'shish» bilan qaytaring` };
    }
    await tx.siteBlock.update({ where: { id: b.id }, data: { name: p.to } });
    byKey.delete(fromKey);
    byKey.set(toKey, { ...b, name: p.to });
    renamed.push({ id: b.id, from: b.name, to: p.to });
  }
  return { ok: true, renamed };
}

/**
 * Mijoz kartasidagi obyekt formasi: obyekt bloklari aynan shu ro'yxat bo'lsin (tartibi ham). Yangisi qo'shiladi;
 * ro'yxatdan olingani — zayavkada ishlatilmagan bo'lsa o'chadi, ishlatilgan bo'lsa «faol emas» bo'ladi (tarix uzilmasin).
 */
export async function syncSiteBlocks(tx: Prisma.TransactionClient, siteId: string, names: string[]): Promise<{ before: string[]; after: string[] }> {
  const list = [...new Map(names.map(blockName).filter((x): x is string => !!x).map((n) => [n.toLocaleLowerCase("uz"), n])).values()];
  const have = await tx.siteBlock.findMany({ where: { siteId }, orderBy: BLOCK_ORDER, select: { id: true, name: true, isActive: true, _count: { select: { items: true } } } });
  const byKey = new Map(have.map((b) => [b.name.toLocaleLowerCase("uz"), b]));
  for (const [i, name] of list.entries()) {
    const b = byKey.get(name.toLocaleLowerCase("uz"));
    if (b) await tx.siteBlock.update({ where: { id: b.id }, data: { name, sortOrder: i, isActive: true } });
    else await tx.siteBlock.create({ data: { siteId, name, sortOrder: i } });
  }
  const keep = new Set(list.map((n) => n.toLocaleLowerCase("uz")));
  for (const b of have) {
    if (keep.has(b.name.toLocaleLowerCase("uz"))) continue;
    if (b._count.items) { if (b.isActive) await tx.siteBlock.update({ where: { id: b.id }, data: { isActive: false } }); }
    else await tx.siteBlock.delete({ where: { id: b.id } });
  }
  return { before: have.filter((b) => b.isActive).map((b) => b.name), after: list };
}
