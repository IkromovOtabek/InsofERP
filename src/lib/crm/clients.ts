import type { CrmClientStatus, CrmOptionKind, CrmResultGroup, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import type { Activity } from "./labels";

/**
 * Sotuv CRM — mijozlar (docs/CRM_SPEC.md 3.1, 5.2, 5.3). Mijoz — mavjud `Customer` kartasi:
 * `crmAt` bor — CRM mijozi (ro'yxatda sukut bo'yicha), yo'q — oddiy ERP mijozi (faqat qidiruvda topiladi).
 */

const digits = (v: string) => v.replace(/\D+/g, "");

export type CrmOptionRow = { id: string; code: string; label: string };
export type CrmOptions = Record<CrmOptionKind, CrmOptionRow[]>;

/** Faol ro'yxatlar (manba, mijoz turi, mahsulot, aloqa turi). `keep` — nofaol bo'lsa ham ko'rsatiladigan (tahrirdagi joriy qiymat). */
export async function crmOptions(keep: (string | null | undefined)[] = []): Promise<CrmOptions> {
  const ids = keep.filter((x): x is string => !!x);
  const rows = await db.crmOption.findMany({
    where: { OR: [{ isActive: true }, ...(ids.length ? [{ id: { in: ids } }] : [])] },
    orderBy: [{ sort: "asc" }, { label: "asc" }],
  });
  const out: CrmOptions = { SOURCE: [], CLIENT_TYPE: [], PRODUCT: [], CHANNEL: [] };
  for (const r of rows) out[r.kind].push({ id: r.id, code: r.code, label: r.label });
  return out;
}

/** Mas'ul xodim bo'la oladiganlar: faol, CRM bilan ishlaydigan rollar yoki CRM moduli berilganlar. */
export async function crmUsers(keep?: string | null): Promise<{ id: string; fullName: string }[]> {
  const users = await db.user.findMany({
    where: { OR: [{ isActive: true }, ...(keep ? [{ id: keep }] : [])], role: { notIn: ["DRIVER", "BRIGADIER", "SUPERADMIN"] } },
    select: { id: true, fullName: true, role: true, perms: true },
    orderBy: { fullName: "asc" },
  });
  return users
    .filter((u) => u.id === keep || ["SALES", "SUPERVISOR", "DIRECTOR"].includes(u.role) || (() => {
      const p = (u.perms as Record<string, unknown> | null)?.crm;
      return p !== undefined && p !== "none";
    })())
    .map(({ id, fullName }) => ({ id, fullName }));
}

/* ───────────────────────── Dublikat tekshiruvi (3.1) ───────────────────────── */

export type DupMatch = { id: string; name: string; inCrm: boolean; by: "inn" | "phone" };

/** STIR yoki telefon (oxirgi 9 raqam, yozilishidan qat'iy nazar) bo'yicha mavjud mijozlar. */
export async function findDuplicates(input: { inn?: string | null; phone?: string | null; excludeId?: string | null }): Promise<DupMatch[]> {
  const inn = digits(input.inn ?? "");
  const norm = normalizePhone(input.phone);
  const local = norm ? norm.slice(4) : "";
  if (!inn && !local) return [];
  const rows = await db.$queryRaw<{ id: string; name: string; crmAt: Date | null; byInn: boolean }[]>`
    SELECT id, name, "crmAt", (${inn} <> '' AND inn = ${inn}) AS "byInn"
    FROM "Customer"
    WHERE "isInternal" = false AND id <> ${input.excludeId ?? ""}
      AND ((${inn} <> '' AND inn = ${inn})
        OR (${local} <> '' AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = ${local}))
    ORDER BY "crmAt" IS NULL, name
    LIMIT 5`;
  return rows.map((r) => ({ id: r.id, name: r.name, inCrm: !!r.crmAt, by: r.byInn ? "inn" : "phone" }));
}

/* ───────────────────────── Oxirgi natija va voronka ───────────────────────── */

export type LastResult = { customerId: string; date: Date; label: string | null; group: CrmResultGroup | null; stage: number | null };

/** Har mijozning eng oxirgi (bekor qilinmagan) aloqasi natijasi. `ids` bo'lmasa — hammasi. */
export async function lastResults(ids?: string[]): Promise<Map<string, LastResult>> {
  if (ids && !ids.length) return new Map();
  const rows = await db.$queryRaw<LastResult[]>`
    SELECT DISTINCT ON (c."customerId") c."customerId", c.date, r.label, r."group", r.stage
    FROM "CrmContact" c LEFT JOIN "CrmResult" r ON r.id = c."resultId"
    WHERE c."cancelledAt" IS NULL AND (${!ids}::boolean OR c."customerId" = ANY(${ids ?? []}::text[]))
    ORDER BY c."customerId", c.date DESC, c."createdAt" DESC`;
  return new Map(rows.map((r) => [r.customerId, r]));
}

/** Voronkadagi joyi (5.3): aloqalardagi eng yuqori bosqich; bekor qilinmagan zayavka — 6, yetkazilgan — 7. */
export function funnelPosition(maxStage: number | null, orders: { status: string }[]): number {
  let n = maxStage ?? 0;
  const live = orders.filter((o) => o.status !== "CANCELLED");
  if (live.length) n = Math.max(n, 6);
  if (live.some((o) => o.status === "DELIVERED" || o.status === "CLOSED")) n = 7;
  return n;
}

/** Faollik (4.4): oxirgi bekor qilinmagan zayavkadan o'tgan kun. */
export function activityOf(lastOrder: Date | null, cfg: { active: number; cold: number }, now = new Date()): Activity {
  if (!lastOrder) return "NONE";
  const days = Math.floor((now.getTime() - lastOrder.getTime()) / 86_400_000);
  if (days <= cfg.active) return "ACTIVE";
  if (days <= cfg.cold) return "COOLING";
  return "OLD";
}

export async function activityCfg(): Promise<{ active: number; cold: number }> {
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { crmActiveDays: true, crmColdDays: true } });
  return { active: s?.crmActiveDays ?? 30, cold: s?.crmColdDays ?? 90 };
}

/* ───────────────────────── Ro'yxat va qidiruv (5.2) ───────────────────────── */

export type ClientFilter = "all" | "new" | "active" | "waiting" | "refusal";

export type ClientRow = {
  id: string; name: string; region: string | null; source: string | null; owner: string | null;
  status: CrmClientStatus; inCrm: boolean; phone: string | null; nextContactAt: Date | null;
};

export const LIST_LIMIT = 300;

/**
 * Qidiruv — nom (va boshqa nomlari), telefon (raqamlarning istalgan qismi, bo'sh joy/tire hisobga olinmaydi),
 * STIR, viloyat, prorab. Qidiruvda ERP'ning barcha mijozlari; qidiruvsiz — faqat CRM mijozlari.
 */
export async function listClients(p: { q?: string; filter: ClientFilter; sourceId?: string; ownerId?: string }): Promise<{ rows: ClientRow[]; total: number }> {
  const q = (p.q ?? "").trim();
  const where: Prisma.CustomerWhereInput = { isInternal: false, isActive: true };
  if (q) {
    const like = `%${q}%`;
    const d = digits(q);
    const dLike = d.length >= 3 ? `%${d}%` : "";
    const hits = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer" WHERE "isInternal" = false AND (
        name ILIKE ${like} OR coalesce(region, '') ILIKE ${like} OR coalesce(district, '') ILIKE ${like}
        OR coalesce("foremanName", '') ILIKE ${like} OR coalesce("contactPerson", '') ILIKE ${like}
        OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE ${like})
        OR (${dLike} <> '' AND (
          regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE ${dLike}
          OR regexp_replace(coalesce("foremanPhone", ''), '\\D', '', 'g') LIKE ${dLike}
          OR coalesce(inn, '') LIKE ${dLike})))
      LIMIT 1000`;
    where.id = { in: hits.map((h) => h.id) };
  } else {
    where.crmAt = { not: null };
  }
  if (p.sourceId) where.sourceId = p.sourceId;
  if (p.ownerId) where.ownerId = p.ownerId;
  if (p.filter === "new") where.OR = [{ crmStatus: "NEW" }, { crmStatus: null }];
  if (p.filter === "active") where.crmStatus = "ACTIVE";

  const base = await db.customer.findMany({
    where,
    select: {
      id: true, name: true, region: true, phone: true, crmStatus: true, crmAt: true, nextContactAt: true,
      source: { select: { label: true } }, owner: { select: { fullName: true } },
    },
    orderBy: [{ crmAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
  });

  // Kutilayotgan / Otkaz — oxirgi aloqa natijasi guruhi bo'yicha (holat avtomatikasi 3-bosqichda)
  let list = base;
  if (p.filter === "waiting" || p.filter === "refusal") {
    const last = await lastResults(base.map((c) => c.id));
    const want: CrmResultGroup[] = p.filter === "waiting" ? ["WAITING"] : ["REFUSAL", "LOSS"];
    list = base.filter((c) => {
      const g = last.get(c.id)?.group;
      return (g && want.includes(g)) || (p.filter === "refusal" && c.crmStatus === "LOST");
    });
  }

  return {
    total: list.length,
    rows: list.slice(0, LIST_LIMIT).map((c) => ({
      id: c.id, name: c.name, region: c.region, phone: c.phone, nextContactAt: c.nextContactAt,
      source: c.source?.label ?? null, owner: c.owner?.fullName ?? null,
      status: c.crmStatus ?? "NEW", inCrm: !!c.crmAt,
    })),
  };
}

/* ───────────────────────── Kartochka (5.3) ───────────────────────── */

export async function clientCard(id: string) {
  const c = await db.customer.findFirst({
    where: { id, isInternal: false },
    include: {
      source: true, clientType: true, owner: { select: { id: true, fullName: true } },
      crmContacts: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: {
          result: true, channel: { select: { label: true } }, product: { select: { label: true } },
          user: { select: { fullName: true } }, cancelledBy: { select: { fullName: true } },
        },
      },
      orders: {
        where: { kind: "SALE" },
        orderBy: { date: "desc" },
        take: 50,
        select: {
          id: true, orderNo: true, date: true, status: true, deliveryFee: true, crmContactId: true,
          items: { select: { qtyM3: true, price: true } },
          _count: { select: { trips: { where: { status: { not: "CANCELLED" } } } } },
        },
      },
    },
  });
  if (!c) return null;
  const live = c.crmContacts.filter((x) => !x.cancelledAt);
  const maxStage = live.reduce<number | null>((m, x) => (x.result ? Math.max(m ?? 0, x.result.stage) : m ?? 1), null);
  const lastOrder = c.orders.find((o) => o.status !== "CANCELLED")?.date ?? null;
  const cfg = await activityCfg();
  return {
    c,
    position: funnelPosition(maxStage, c.orders),
    activity: activityOf(lastOrder, cfg),
    status: (c.crmStatus ?? "NEW") as CrmClientStatus,
  };
}

/** `+998901234567` → Telegram havolasi (`https://t.me/+998…`); yaroqsiz raqam — null. */
export function telegramLink(phone: string | null | undefined): string | null {
  const n = normalizePhone(phone);
  return n ? `https://t.me/${n}` : null;
}
export function telLink(phone: string | null | undefined): string | null {
  const n = normalizePhone(phone);
  return n ? `tel:${n}` : phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
}
