import { requireAdmin } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { toActionView } from "@/lib/control/monitor/snapshot";
import { asSuggested, type IncidentStatusT, type SeverityT } from "@/lib/control/monitor/shared";
import type { Prisma } from "@/generated/control";
import { IncidentsView, type IncidentFull } from "./view";

export const metadata = { title: "Hodisalar" };
export const dynamic = "force-dynamic";

const STATUSES = ["active", "OPEN", "ACKED", "RESOLVED", "all"] as const;
const SEVERITIES: SeverityT[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Hodisalar: filtrlar (URL'da — havolani ulashish mumkin), tafsilot oynasi, tuzatish/ko'rdim/yopish. */
export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(one(sp.status)) ? one(sp.status) : "active";
  const severity = SEVERITIES.includes(one(sp.severity) as SeverityT) ? (one(sp.severity) as SeverityT) : "";
  const category = one(sp.category).slice(0, 40);
  const source = one(sp.source).slice(0, 20);
  const tenantSlug = one(sp.tenant).slice(0, 40);
  const openId = one(sp.id).slice(0, 40);

  const tenants = await control.tenant.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } });
  const tenant = tenants.find((t) => t.slug === tenantSlug);

  const where: Prisma.IncidentWhereInput = {
    ...(status === "active" ? { status: { in: ["OPEN", "ACKED"] } } : status === "all" ? {} : { status: status as IncidentStatusT }),
    ...(severity ? { severity } : {}),
    ...(category ? { category } : {}),
    ...(source ? { source } : {}),
    ...(tenantSlug ? { tenantId: tenant?.id ?? "__yo'q__" } : {}),
  };
  const [rows, cats, srcs, extra] = await Promise.all([
    control.incident.findMany({
      where, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 200,
      include: { actions: { orderBy: { requestedAt: "desc" }, take: 20 } },
    }),
    control.incident.groupBy({ by: ["category"], _count: { _all: true } }),
    control.incident.groupBy({ by: ["source"], _count: { _all: true } }),
    // ?id=… filtrdan tashqarida bo'lsa ham (masalan monitoring sahifasidagi havola) tafsilot ochilsin
    openId ? control.incident.findUnique({ where: { id: openId }, include: { actions: { orderBy: { requestedAt: "desc" }, take: 20 } } }) : null,
  ]);
  const all = extra && !rows.some((r) => r.id === extra.id) ? [extra, ...rows] : rows;

  const adminIds = [...new Set(all.flatMap((r) => [r.ackedById, ...r.actions.map((a) => a.requestedById)]).filter((x): x is string => !!x))];
  const admins = adminIds.length ? await control.superAdmin.findMany({ where: { id: { in: adminIds } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(admins.map((a) => [a.id, a.fullName]));
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const incidents: IncidentFull[] = all.map((i) => ({
    id: i.id, key: i.key, source: i.source, category: i.category, severity: i.severity, status: i.status, title: i.title,
    tenantId: i.tenantId, count: i.count, firstSeenAt: i.firstSeenAt.toISOString(), lastSeenAt: i.lastSeenAt.toISOString(),
    suggestedActions: asSuggested(i.suggestedActions), detail: i.detail ?? null,
    resolvedAt: i.resolvedAt?.toISOString() ?? null, ackedAt: i.ackedAt?.toISOString() ?? null,
    ackedBy: i.ackedById ? names.get(i.ackedById) ?? null : null, notifiedAt: i.notifiedAt?.toISOString() ?? null,
    tenant: i.tenantId ? (tenantById.get(i.tenantId) ?? null) : null,
    actions: i.actions.map((a) => toActionView(a, names)),
  }));

  return (
    <IncidentsView
      incidents={incidents}
      openId={openId || null}
      filters={{ status, severity, category, source, tenant: tenantSlug }}
      options={{
        categories: cats.map((c) => c.category).sort(),
        sources: srcs.map((s) => s.source).sort(),
        tenants: tenants.map((t) => ({ slug: t.slug, name: t.name })),
      }}
    />
  );
}
