import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { cleanAliases } from "@/lib/customer-admin";
import { openingDay } from "@/lib/opening-balances";
import { date } from "@/lib/format";
import { Prisma, type Customer } from "@/generated/prisma";
import { syncCustomerLater, customerAppStatus } from "@/lib/eco/customers";
import { eco, ecoEnabled } from "@/lib/eco/client";
import { notifyAfter } from "@/lib/notify";

/**
 * Takror mijozlarni birlashtirish: «manba» kartasidagi hamma narsa «maqsad» kartasiga ko'chadi, manba o'chiriladi.
 * Mijoz ko'p joydan ochiladi (zayavka formasi, Excel ko'rinish, importlar, sayt arizalari) — takror kartalar ko'p bo'ladi.
 *
 * Ko'chadigan bog'lanishlar — `Customer` modelining HAMMA aloqasi (prisma/schema.prisma):
 *   zayavkalar, obyektlar, schyotlar, to'lovlar, bosh to'lov so'rovlari, sotuv reyestri, realizatsiya qatorlari,
 *   boshlang'ich qoldiqlar, sayt arizalari, tijorat takliflari, amoCRM kelishuvlari. Agent (`agentId`) va bo'sh maydonlar
 *   (INN, telefon, manzil, mas'ul shaxs) maqsadda bo'sh bo'lsa manbadan olinadi; kredit limiti — maqsadniki.
 * Manba nomi va boshqa nomlari maqsadning boshqa nomlariga qo'shiladi (`cleanAliases`) — importlar eski nomni ham taniydi.
 *
 * Yagona (unique) to'qnashuvlar oldindan aniq sabab bilan rad etiladi, tasodifiy baza xatosi bilan emas:
 *   · turli INN — boshqa-boshqa yuridik shaxs bo'lishi mumkin;
 *   · boshlang'ich qoldiq — mijozga kuniga bitta faol yozuv (`OpeningBalance.activeKey`).
 * Ruxsat (faqat direktor) — chaqiruvchida. Hammasi bitta tranzaksiyada, ikkala kartaga AuditLog.
 */

export type MergeCounts = {
  orders: number; sites: number; invoices: number; payments: number; payRequests: number; register: number;
  realizations: number; openings: number; leads: number; offers: number; amoDeals: number;
};

const COUNT_LABELS: [keyof MergeCounts, string][] = [
  ["orders", "zayavka"], ["sites", "obyekt"], ["invoices", "schyot"], ["payments", "to'lov"], ["payRequests", "bosh to'lov so'rovi"],
  ["register", "sotuv reyestri qatori"], ["realizations", "realizatsiya qatori"], ["openings", "boshlang'ich qoldiq"],
  ["leads", "sayt arizasi"], ["offers", "tijorat taklifi"], ["amoDeals", "amoCRM kelishuvi"],
];

/** «12 zayavka · 3 schyot · 1 obyekt» — faqat bori. */
export function mergeCountsText(c: MergeCounts): string {
  const parts = COUNT_LABELS.filter(([k]) => c[k] > 0).map(([k, l]) => `${c[k]} ${l}`);
  return parts.length ? parts.join(" · ") : "bog'langan hujjat yo'q";
}

type Client = Prisma.TransactionClient | typeof db;

async function countsOf(client: Client, customerId: string): Promise<MergeCounts> {
  const where = { customerId };
  const [orders, sites, invoices, payments, payRequests, register, realizations, openings, leads, offers, amoDeals] = await Promise.all([
    client.order.count({ where }), client.site.count({ where }), client.invoice.count({ where }), client.payment.count({ where }),
    client.paymentRequest.count({ where }), client.salesRegister.count({ where }), client.realizationEntry.count({ where }),
    client.openingBalance.count({ where }), client.lead.count({ where }), client.commercialOffer.count({ where }), client.amoDeal.count({ where }),
  ]);
  return { orders, sites, invoices, payments, payRequests, register, realizations, openings, leads, offers, amoDeals };
}

/** Boshlang'ich qoldiq kaliti manbadan maqsadga: "CUSTOMER:<id>" yoki "CUSTOMER:<id>:<kun>" (`lib/opening-balances.ts`). */
function rekey(key: string | null, fromId: string, toId: string): string | null {
  if (!key) return key;
  const from = `CUSTOMER:${fromId}`;
  return key === from || key.startsWith(`${from}:`) ? `CUSTOMER:${toId}${key.slice(from.length)}` : key;
}

/** Birlashtirishga to'sqinlik — aniq sabab bilan; yo'q bo'lsa null. Tranzaksiya ichida qulf ostida qayta tekshiriladi. */
async function mergeBlocker(client: Client, source: Customer, target: Customer): Promise<string | null> {
  if (source.id === target.id) return "Mijozni o'ziga birlashtirib bo'lmaydi";
  if (source.isInternal || target.isInternal) return "Ichki (tizim) kartasi birlashtirilmaydi";
  if (!target.isActive) return `«${target.name}» nofaol — avval uni faollashtiring yoki boshqa kartani tanlang`;
  if (source.inn && target.inn && source.inn !== target.inn) {
    return `INN har xil (${source.inn} va ${target.inn}) — bu boshqa-boshqa yuridik shaxs bo'lishi mumkin. Rostdan bitta mijoz bo'lsa, avval noto'g'ri INN ni tuzating`;
  }
  // Boshlang'ich qoldiq: mijozga kuniga bitta faol yozuv — ikkala kartada bir kunga bo'lsa, qaysi biri qolishini buxgalter hal qiladi
  const active = { kind: "CUSTOMER" as const, cancelledAt: null };
  const src = await client.openingBalance.findMany({ where: { ...active, customerId: source.id }, select: { date: true, activeKey: true } });
  if (src.length) {
    const tgt = await client.openingBalance.findMany({ where: { ...active, customerId: target.id }, select: { date: true, activeKey: true } });
    const days = new Set(tgt.map((o) => openingDay(o.date)));
    const keys = new Set(tgt.map((o) => o.activeKey).filter(Boolean));
    const clash = src.find((o) => days.has(openingDay(o.date)) || (o.activeKey && keys.has(rekey(o.activeKey, source.id, target.id))));
    if (clash) return `Ikkala mijozda ham ${date(clash.date)} sanasiga boshlang'ich qoldiq bor — avval bittasini bekor qiling yoki tuzating (Moliya → Boshlang'ich qoldiqlar)`;
  }
  return null;
}

export type MergeTarget = { id: string; name: string; inn: string | null; phone: string | null; isActive: boolean };

/** Maqsad kartani izlash: nom, INN, telefon yoki boshqa nom bo'yicha (manba va ichki kartalarsiz). */
export async function findMergeTargetsLib(sourceId: string, q: string): Promise<MergeTarget[]> {
  const t = q.replace(/\s+/g, " ").trim().slice(0, 100);
  if (t.length < 2) return [];
  const digits = t.replace(/\D/g, "");
  return db.customer.findMany({
    where: {
      id: { not: sourceId }, isInternal: false,
      OR: [
        { name: { contains: t, mode: "insensitive" } },
        { aliases: { has: t } },
        // Telefon kartada turli shaklda yozilgan bo'lishi mumkin («+998 90 …» yoki «90…») — ikkala ko'rinishda ham
        ...(digits.length >= 3 ? [{ inn: { contains: digits } }, { phone: { contains: digits } }, { phone: { contains: t } }] : []),
      ],
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 15,
    select: { id: true, name: true, inn: true, phone: true, isActive: true },
  });
}

export type MergePreview =
  | { ok: true; counts: string; target: MergeTarget; appLinked: boolean }
  | { ok: false; error: string };

/** Tanlangan maqsad uchun oldindan ko'rish: nima ko'chadi va to'sqinlik bormi (birlashtirish o'zi tranzaksiyada qayta tekshiradi). */
export async function customerMergePreview(sourceId: string, targetId: string): Promise<MergePreview> {
  const [source, target] = await Promise.all([db.customer.findUnique({ where: { id: sourceId } }), db.customer.findUnique({ where: { id: targetId } })]);
  if (!source || !target) return { ok: false, error: "Mijoz topilmadi — sahifani yangilang" };
  const block = await mergeBlocker(db, source, target);
  if (block) return { ok: false, error: block };
  const [counts, appLinked] = await Promise.all([countsOf(db, sourceId), sourceHasApp(sourceId)]);
  return { ok: true, counts: mergeCountsText(counts), target: { id: target.id, name: target.name, inn: target.inn, phone: target.phone, isActive: target.isActive }, appLinked };
}

/** Manba kartasi ECO ilovasida a'zolari bilan ulanganmi (ECO o'chiq / javob bermasa — yo'q deb olinadi). */
async function sourceHasApp(customerId: string): Promise<boolean> {
  if (!ecoEnabled()) return false;
  const st = await customerAppStatus(customerId);
  return st.available && st.linked && st.members.length > 0;
}

class MergeError extends Error {}

export type MergeResult = { ok: true; note: string; targetId: string; appLinked: boolean } | { ok: false; error: string };

export async function mergeCustomers(sourceId: string, targetId: string, reason: string, userId: string): Promise<MergeResult> {
  const why = String(reason ?? "").trim().slice(0, 300);
  if (why.length < 3) return { ok: false, error: "Birlashtirish sababini yozing" };
  if (!sourceId || !targetId) return { ok: false, error: "Mijoz tanlanmagan" };
  // ECO holati tranzaksiyadan oldin (tarmoq so'rovi qulf ostida turmasin): ilova hisobi ECO'da eski kartada qoladi — ogohlantiramiz
  const appLinked = await sourceHasApp(sourceId);

  let out: { source: Customer; target: Customer; moved: MergeCounts };
  try {
    out = await db.$transaction(async (tx) => {
      // Qulflar — kodda qabul qilingan tartibda (boshlang'ich qoldiq → mijoz → kredit), ikkala id ham bir xil tartibda:
      // shu payt to'lov, schyot, boshlang'ich qoldiq yoki zayavka qabul qilish eski kartaga yozib qo'ymasin
      const ids = [sourceId, targetId].sort();
      for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening:CUSTOMER:" + id}))`;
      for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credit:" + id}))`;
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id IN (${ids[0]}, ${ids[1]}) ORDER BY id FOR UPDATE`;
      const [source, target] = await Promise.all([tx.customer.findUnique({ where: { id: sourceId } }), tx.customer.findUnique({ where: { id: targetId } })]);
      if (!source || !target) throw new MergeError("Mijoz topilmadi — sahifani yangilang");
      const block = await mergeBlocker(tx, source, target);
      if (block) throw new MergeError(block);

      // ── Bog'lanishlar maqsadga ──
      const where = { customerId: source.id }, data = { customerId: target.id };
      const moved: MergeCounts = {
        orders: (await tx.order.updateMany({ where, data })).count,
        sites: (await tx.site.updateMany({ where, data })).count,
        invoices: (await tx.invoice.updateMany({ where, data })).count,
        payments: (await tx.payment.updateMany({ where, data })).count,
        payRequests: (await tx.paymentRequest.updateMany({ where, data })).count,
        register: (await tx.salesRegister.updateMany({ where, data })).count,
        realizations: (await tx.realizationEntry.updateMany({ where, data })).count,
        leads: (await tx.lead.updateMany({ where, data })).count,
        offers: (await tx.commercialOffer.updateMany({ where, data })).count,
        amoDeals: (await tx.amoDeal.updateMany({ where, data })).count,
        openings: 0,
      };
      // Boshlang'ich qoldiq: kalit ham yangi mijoz nomiga (to'qnashuv yuqorida tekshirilgan)
      const openings = await tx.openingBalance.findMany({ where, select: { id: true, activeKey: true } });
      for (const ob of openings) {
        await tx.openingBalance.update({ where: { id: ob.id }, data: { customerId: target.id, activeKey: rekey(ob.activeKey, source.id, target.id) } });
      }
      moved.openings = openings.length;

      // ── Manba o'chadi (INN unique — maqsadga o'tkazishdan oldin bo'shasin) ──
      await tx.customer.delete({ where: { id: source.id } });
      const fill: Prisma.CustomerUpdateInput = {
        aliases: cleanAliases([...target.aliases, source.name, ...source.aliases], target.name),
        ...(!target.inn && source.inn ? { inn: source.inn } : {}),
        ...(!target.phone && source.phone ? { phone: source.phone } : {}),
        ...(!target.address && source.address ? { address: source.address } : {}),
        ...(!target.contactPerson && source.contactPerson ? { contactPerson: source.contactPerson } : {}),
        ...(!target.agentId && source.agentId ? { agent: { connect: { id: source.agentId } } } : {}),
      };
      const after = await tx.customer.update({ where: { id: target.id }, data: fill });
      const from = { id: source.id, name: source.name, inn: source.inn, phone: source.phone, creditLimit: Number(source.creditLimit), agentId: source.agentId };
      await audit(tx, userId, "UPDATE", "Customer", target.id, target, { ...after, mergedFrom: from, moved, reason: why, via: "customer-merge" });
      await audit(tx, userId, "DELETE", "Customer", source.id, source, { mergedInto: { id: target.id, name: target.name }, moved, reason: why, via: "customer-merge" });
      return { source, target: after, moved };
    });
  } catch (e) {
    if (e instanceof MergeError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Birlashtirilmadi: maqsad kartada xuddi shunday yagona yozuv bor (INN yoki boshlang'ich qoldiq) — sahifani yangilab, ma'lumotni tekshiring" };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return { ok: false, error: "Birlashtirilmadi: manba kartaga bog'langan boshqa yozuv bor — hech narsa o'zgarmadi" };
    }
    throw e;
  }

  // ECO: manba tashkiloti ilovada egasiz faol qolmasin (o'chirishdagi kabi), maqsad kartasi (yangi nomlar, INN, telefon) qayta yuboriladi
  const { source, target, moved } = out;
  if (ecoEnabled()) notifyAfter(async () => { await eco.upsertCustomer({ externalRef: source.id, name: source.name, isActive: false }); });
  syncCustomerLater(target.id);
  return {
    ok: true, targetId: target.id, appLinked,
    note: `«${source.name}» → «${target.name}» birlashtirildi: ${mergeCountsText(moved)}`,
  };
}
