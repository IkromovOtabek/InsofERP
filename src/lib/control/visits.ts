import type { Prisma } from "@/generated/prisma";
import { NAV } from "@/lib/nav";
import { isoDate } from "@/lib/format";
import { DEVICES, type Device } from "@/lib/visit-info";
import { isDbMissing, tenantDb } from "./db";

/**
 * Korxona tashriflari — IT panel → korxona → «Tashriflar» tabi. Korxona bazasidagi `VisitLog` dan jonli o'qiladi
 * (yozuvchisi `lib/visits.ts`); control bazaga hech narsa ko'chirilmaydi. IT (SSO) kirishlari sukut bo'yicha yashirin.
 */

export const VISIT_DAYS = [1, 7, 30, 90] as const;
export const JOURNAL_PAGE = 50;

export type VisitFilter = { days: number; userId?: string; device?: Device; kind?: "PAGE" | "LOGIN"; it: boolean; page: number };

/** URL parametrlari → filtr (noto'g'ri qiymat — sukut). */
export function visitFilter(q: { kun?: string; u?: string; qurilma?: string; tur?: string; it?: string; bet?: string }): VisitFilter {
  const days = Number(q.kun);
  return {
    days: (VISIT_DAYS as readonly number[]).includes(days) ? days : 7,
    userId: q.u && /^[a-z0-9]{10,40}$/i.test(q.u) ? q.u : undefined,
    device: q.qurilma && q.qurilma in DEVICES ? (q.qurilma as Device) : undefined,
    kind: q.tur === "PAGE" || q.tur === "LOGIN" ? q.tur : undefined,
    it: q.it === "1",
    page: Math.max(0, Math.min(200, Math.floor(Number(q.bet) || 0))),
  };
}

/** Yo'l → ERP bo'limi nomi (menyudagi eng uzun mos band, ichki bandlar bilan). Topilmasa — yo'lning o'zi. */
const SECTIONS = NAV.flatMap((i) => [{ href: i.href, label: i.label }, ...(i.children ?? []).map((c) => ({ href: c.href, label: `${i.label} → ${c.label}` }))])
  .sort((a, b) => b.href.length - a.href.length);
const EXTRA: Record<string, string> = { "/hisobim": "Mening hisobim", "/qollanma": "Qo'llanma" };
export function sectionLabel(path: string): string {
  const hit = SECTIONS.find((s) => path === s.href || path.startsWith(`${s.href}/`));
  return hit?.label ?? EXTRA[path] ?? path;
}

const day0 = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export type VisitUser = {
  id: string; fullName: string; login: string; role: string; superadmin: boolean;
  visits: number; logins: number; lastAt: Date; lastPath: string | null;
  device: string; os: string | null; browser: string | null; ip: string | null; lastLogin: { at: Date; method: string | null } | null;
};
export type VisitRow = Prisma.VisitLogGetPayload<{ include: { user: { select: { fullName: true; login: true; role: true } } } }>;

export type TenantVisits =
  | { ok: false; reason: "missing" | "nolog" | "error"; error?: string }
  | {
      ok: true;
      usersToday: number; usersPeriod: number; viewsPeriod: number; loginsPeriod: number;
      days: { day: string; users: number; views: number }[];
      devices: { device: string; users: number; views: number }[];
      sections: { label: string; views: number; users: number }[];
      users: VisitUser[];
      silent: { id: string; fullName: string; role: string }[];
      journal: VisitRow[]; journalTotal: number;
    };

/** Bitta korxona: xulosa (davr), foydalanuvchilar, jurnal (filtr bilan). */
export async function tenantVisits(dbName: string, f: VisitFilter): Promise<TenantVisits> {
  const db = tenantDb(dbName);
  const now = new Date();
  const since = f.days === 1 ? day0(now) : new Date(day0(now).getTime() - (f.days - 1) * 864e5);
  const it: Prisma.VisitLogWhereInput = f.it ? {} : { superadmin: false };
  const period: Prisma.VisitLogWhereInput = { createdAt: { gte: since }, ...it };
  const journalWhere: Prisma.VisitLogWhereInput = { ...period, ...(f.userId ? { userId: f.userId } : {}), ...(f.device ? { device: f.device } : {}), ...(f.kind ? { kind: f.kind } : {}) };
  // Kunlar server mahalliy vaqti bo'yicha (`lib/format` sanalari bilan bir xil); ustun — zonasiz UTC
  const off = -now.getTimezoneOffset();
  try {
    const [today, byUser, byKind, byDevice, byPath, perDay, journal, journalTotal] = await Promise.all([
      db.visitLog.groupBy({ by: ["userId"], where: { createdAt: { gte: day0(now) }, ...it } }),
      db.visitLog.groupBy({ by: ["userId", "kind"], where: period, _count: { _all: true }, _max: { createdAt: true } }),
      db.visitLog.groupBy({ by: ["kind"], where: period, _count: { _all: true } }),
      db.visitLog.groupBy({ by: ["device", "userId"], where: period, _count: { _all: true } }),
      db.visitLog.groupBy({ by: ["path", "userId"], where: { ...period, kind: "PAGE" }, _count: { _all: true } }),
      db.$queryRaw<{ d: string; users: bigint; views: bigint }[]>`
        SELECT to_char(date_trunc('day', "createdAt" + make_interval(mins => ${off}::int)), 'YYYY-MM-DD') AS d,
               COUNT(DISTINCT "userId") AS users, COUNT(*) FILTER (WHERE "kind" = 'PAGE') AS views
        FROM "VisitLog" WHERE "createdAt" >= ${since} AND (${f.it} OR NOT "superadmin")
        GROUP BY 1 ORDER BY 1`,
      db.visitLog.findMany({
        where: journalWhere, orderBy: { createdAt: "desc" }, take: JOURNAL_PAGE, skip: f.page * JOURNAL_PAGE,
        include: { user: { select: { fullName: true, login: true, role: true } } },
      }),
      db.visitLog.count({ where: journalWhere }),
    ]);

    const userIds = [...new Set(byUser.map((r) => r.userId))];
    const [people, lastRows, lastLogins, activeUsers] = await Promise.all([
      db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, login: true, role: true } }),
      db.visitLog.findMany({ where: { ...period, userId: { in: userIds } }, orderBy: { createdAt: "desc" }, distinct: ["userId"] }),
      db.visitLog.findMany({ where: { ...period, kind: "LOGIN", userId: { in: userIds } }, orderBy: { createdAt: "desc" }, distinct: ["userId"], select: { userId: true, createdAt: true, method: true } }),
      db.user.findMany({ where: { isActive: true, role: { not: "SUPERADMIN" } }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: "asc" } }),
    ]);
    const person = new Map(people.map((p) => [p.id, p]));
    const last = new Map(lastRows.map((r) => [r.userId, r]));
    const login = new Map(lastLogins.map((r) => [r.userId, r]));
    const count = (uid: string, kind: "PAGE" | "LOGIN") => byUser.find((r) => r.userId === uid && r.kind === kind)?._count._all ?? 0;

    const users: VisitUser[] = userIds.flatMap((id) => {
      const p = person.get(id); const l = last.get(id);
      if (!p || !l) return [];
      const lg = login.get(id);
      return [{
        id, fullName: p.fullName, login: p.login, role: p.role, superadmin: p.role === "SUPERADMIN",
        visits: count(id, "PAGE"), logins: count(id, "LOGIN"), lastAt: l.createdAt, lastPath: l.kind === "PAGE" ? l.path : null,
        device: l.device, os: l.os, browser: l.browser, ip: l.ip, lastLogin: lg ? { at: lg.createdAt, method: lg.method } : null,
      }];
    }).sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());

    const agg = <K extends string>(rows: { key: K; userId: string; n: number }[]) => {
      const m = new Map<K, { views: number; users: Set<string> }>();
      for (const r of rows) { const x = m.get(r.key) ?? { views: 0, users: new Set<string>() }; x.views += r.n; x.users.add(r.userId); m.set(r.key, x); }
      return [...m.entries()].map(([key, x]) => ({ key, views: x.views, users: x.users.size })).sort((a, b) => b.views - a.views || b.users - a.users);
    };
    const seen = new Set(userIds);

    return {
      ok: true,
      usersToday: today.length,
      usersPeriod: userIds.length,
      viewsPeriod: byKind.find((k) => k.kind === "PAGE")?._count._all ?? 0,
      loginsPeriod: byKind.find((k) => k.kind === "LOGIN")?._count._all ?? 0,
      // Tashrifsiz kunlar ham grafikda (0) — davr to'liq ko'rinsin
      days: Array.from({ length: f.days }, (_, i) => {
        const d = isoDate(new Date(since.getFullYear(), since.getMonth(), since.getDate() + i));
        const r = perDay.find((x) => x.d === d);
        return { day: d, users: Number(r?.users ?? 0), views: Number(r?.views ?? 0) };
      }),
      devices: agg(byDevice.map((r) => ({ key: r.device, userId: r.userId, n: r._count._all }))).map(({ key, ...x }) => ({ device: key, ...x })),
      sections: agg(byPath.map((r) => ({ key: sectionLabel(r.path ?? ""), userId: r.userId, n: r._count._all }))).slice(0, 10).map(({ key, ...x }) => ({ label: key, ...x })),
      users,
      silent: activeUsers.filter((u) => !seen.has(u.id)),
      journal, journalTotal,
    };
  } catch (e) {
    if (isDbMissing(e)) return { ok: false, reason: "missing" };
    // Korxona bazasi hali yangilanmagan (VisitLog jadvali yo'q) — deploy'dagi migratsiyani kutadi
    if ((e as { code?: string }).code === "P2021" || /VisitLog.*does not exist|relation "VisitLog"/i.test(String(e))) return { ok: false, reason: "nolog" };
    return { ok: false, reason: "error", error: (e instanceof Error ? e.message : String(e)).split("\n").slice(-1)[0].slice(0, 200) };
  }
}

/** Umumiy holat kartasi uchun (stats.ts): bugun kirganlar va sahifa ochilishlari; jadval yo'q bo'lsa null. */
export async function visitsToday(dbName: string): Promise<{ usersToday: number; viewsToday: number; loginsToday: number } | null> {
  const db = tenantDb(dbName);
  try {
    const where = { createdAt: { gte: day0() }, superadmin: false };
    const [users, kinds] = await Promise.all([
      db.visitLog.groupBy({ by: ["userId"], where }),
      db.visitLog.groupBy({ by: ["kind"], where, _count: { _all: true } }),
    ]);
    return { usersToday: users.length, viewsToday: kinds.find((k) => k.kind === "PAGE")?._count._all ?? 0, loginsToday: kinds.find((k) => k.kind === "LOGIN")?._count._all ?? 0 };
  } catch {
    return null;
  }
}
