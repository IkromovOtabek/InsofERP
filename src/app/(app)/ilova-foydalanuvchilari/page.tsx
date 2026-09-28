import Link from "next/link";
import { Search, Users, Briefcase, HardHat, Truck, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { eco, ecoEnabled, ecoUrl, type EcoAppRole, type EcoAppUser } from "@/lib/eco/client";
import { dateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import { APP_GRANTABLE_ROLES } from "@/lib/eco/app-login";
import { AppAccess } from "./access";
import { Badge, Callout, Card, Empty, Input, PageHeader, StatCard, Table, Tabs, Td, Th, Tr, type BadgeColor } from "@/components/ui";

export const dynamic = "force-dynamic";

const ROLE: Record<EcoAppRole, { label: string; color: BadgeColor }> = {
  TADBIRKOR: { label: "Tadbirkor", color: "violet" },
  QURUVCHI: { label: "Quruvchi", color: "blue" },
  HAYDOVCHI: { label: "Haydovchi", color: "amber" },
};
const TABS = ["all", "new", "TADBIRKOR", "QURUVCHI", "HAYDOVCHI"] as const;
const NEW_DAYS = 7;

/**
 * Insof ECO ilovasida ro'yxatdan o'tgan barcha foydalanuvchilar — direktor kim, qaysi rolda, qachon kirganini ko'radi.
 * Manba ECO (`GET /v1/erp/app-users`), ERP'da saqlanmaydi. ERP mijoz/xodim kartasiga ulanganlari havola bilan chiqadi.
 */
export default async function AppUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  await requireSession(["DIRECTOR"]);
  const { q = "", tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? rawTab! : "all";
  const enabled = ecoEnabled();

  let users: EcoAppUser[] = [], err: string | null = null;
  if (enabled) {
    try { users = await eco.appUsers(q.trim() || undefined); } catch (e) { err = (e as Error).message; }
  }

  // ERP bilan bog'liqlik: quruvchi tashkiloti → mijoz kartasi, haydovchi → xodim kartasi
  const refs = [...new Set(users.flatMap((u) => u.memberships.map((m) => m.org.externalRef).filter((r): r is string => !!r)))];
  const ecoIds = users.map((u) => u.userId);
  const [customers, employees, erpUsers] = await Promise.all([
    refs.length ? db.customer.findMany({ where: { id: { in: refs } }, select: { id: true, name: true } }) : [],
    ecoIds.length ? db.employee.findMany({ where: { ecoUserId: { in: ecoIds } }, select: { id: true, fullName: true, ecoUserId: true, userId: true } }) : [],
    // ERP'ga telefon bilan kirish ruxsati berilganlar
    ecoIds.length ? db.user.findMany({ where: { ecoUserId: { in: ecoIds } }, select: { ecoUserId: true, role: true, isActive: true } }) : [],
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const employeeByEco = new Map(employees.map((e) => [e.ecoUserId!, e]));
  const erpByEco = new Map(erpUsers.map((u) => [u.ecoUserId!, u]));
  const grantable = APP_GRANTABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const withAccess = erpUsers.filter((u) => u.isActive).length;

  const since = Date.now() - NEW_DAYS * 86_400_000;
  const isNew = (u: EcoAppUser) => new Date(u.registeredAt).getTime() >= since;
  const hasRole = (u: EcoAppUser, r: EcoAppRole) => u.memberships.some((m) => m.role === r);
  const count = (r: EcoAppRole) => users.filter((u) => hasRole(u, r)).length;
  const shown = tab === "all" ? users : tab === "new" ? users.filter(isNew) : users.filter((u) => hasRole(u, tab as EcoAppRole));
  const href = (t: string) => `/ilova-foydalanuvchilari?${new URLSearchParams({ ...(t !== "all" ? { tab: t } : {}), ...(q ? { q } : {}) })}`;

  return (
    <div>
      <PageHeader title="Ilova foydalanuvchilari" subtitle="Insof ECO mobil ilovasida o'zi ro'yxatdan o'tgan hamma: tadbirkorlar, quruvchilar (mijozlar) va haydovchilar. ERP'ga ruxsat bersangiz, u ERP login sahifasiga telefon raqami va ilovadagi paroli bilan kiradi va tanlangan rol bo'limlarini ko'radi." />

      {!enabled ? (
        <Callout tone="warning" title="ECO ulanmagan">ERP <code>.env</code> da <code>ECO_API_URL</code> va <code>ECO_API_KEY</code> yo'q — Haydovchilar (ECO) sahifasidagi ko'rsatma bo'yicha ulang.</Callout>
      ) : err ? (
        <Callout tone="danger" title="ECO serveriga ulanib bo'lmadi"><p>{err}</p><p className="mt-1 text-xs">Manzil: {ecoUrl()}</p></Callout>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Jami" value={users.length} hint={`oxirgi ${NEW_DAYS} kunda ${users.filter(isNew).length} ta yangi · ${withAccess} tasi ERP'ga kira oladi`} icon={Users} />
            <StatCard label="Tadbirkorlar" value={count("TADBIRKOR")} icon={Briefcase} />
            <StatCard label="Quruvchilar" value={count("QURUVCHI")} hint={`${users.filter((u) => u.memberships.some((m) => m.role === "QURUVCHI" && m.org.externalRef)).length} tasi ERP mijoziga ulangan`} icon={HardHat} />
            <StatCard label="Haydovchilar" value={count("HAYDOVCHI")} hint={`${users.filter((u) => u.memberships.some((m) => m.role === "HAYDOVCHI" && m.ownPlant)).length} tasi bizning zavodda`} icon={Truck} />
          </div>

          <form className="relative mb-4 max-w-md">
            {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input name="q" placeholder="Qidirish: ism, telefon, tashkilot" defaultValue={q} className="pl-9" />
          </form>

          <Tabs current={tab} items={[
            { key: "all", label: "Hammasi", href: href("all"), count: users.length },
            { key: "new", label: `Yangi (${NEW_DAYS} kun)`, href: href("new"), count: users.filter(isNew).length, icon: Sparkles },
            { key: "TADBIRKOR", label: "Tadbirkor", href: href("TADBIRKOR"), count: count("TADBIRKOR") },
            { key: "QURUVCHI", label: "Quruvchi", href: href("QURUVCHI"), count: count("QURUVCHI") },
            { key: "HAYDOVCHI", label: "Haydovchi", href: href("HAYDOVCHI"), count: count("HAYDOVCHI") },
          ]} />

          <Card padded={false}>
            <Table>
              <thead><tr><Th>F.I.O.</Th><Th>Telefon</Th><Th>Rol va tashkilot</Th><Th>ERP</Th><Th>Ro'yxatdan o'tgan</Th><Th>Oxirgi kirish</Th><Th>Qurilma</Th></tr></thead>
              <tbody>
                {shown.length === 0 && <Empty text={q ? "Hech kim topilmadi" : "Bu bo'limda foydalanuvchi yo'q"} />}
                {shown.map((u) => {
                  const emp = employeeByEco.get(u.userId);
                  const erp = erpByEco.get(u.userId);
                  const custs = u.memberships.map((m) => m.org.externalRef && customerById.get(m.org.externalRef)).filter((c): c is { id: string; name: string } => !!c);
                  return (
                    <Tr key={u.userId}>
                      <Td className="font-medium">
                        {u.fullName ?? <span className="text-slate-400">ism kiritilmagan</span>}
                        {isNew(u) && <span className="ml-2"><Badge color="green">yangi</Badge></span>}
                        {u.deleteRequestedAt && <div className="mt-0.5"><Badge color="red">o'chirish so'ralgan</Badge></div>}
                      </Td>
                      <Td className="tabular whitespace-nowrap">{u.phone}</Td>
                      <Td>
                        <div className="flex flex-col gap-1">
                          {u.memberships.length === 0 && <span className="text-xs text-slate-400">rol tanlanmagan</span>}
                          {u.memberships.map((m) => (
                            <div key={`${m.org.id}-${m.role}`} className="flex flex-wrap items-center gap-1.5 text-sm">
                              <Badge color={ROLE[m.role].color}>{ROLE[m.role].label}</Badge>
                              <span className="text-slate-700">{m.ownPlant ? "bizning zavod" : m.org.name}</span>
                              {!m.isActive && <span className="text-xs text-amber-600">tasdiq kutilmoqda</span>}
                            </div>
                          ))}
                        </div>
                      </Td>
                      <Td className="text-sm">
                        <div className="flex min-w-[12rem] flex-col gap-1.5">
                          {erp && (erp.isActive
                            ? <span><Badge color="green">Kira oladi · {ROLE_LABELS[erp.role]}</Badge></span>
                            : <span><Badge color="red">Ruxsat yopilgan</Badge></span>)}
                          {emp && <Link href={`/employees/${emp.id}`} className="hover:underline">Xodim: {emp.fullName}</Link>}
                          {custs.map((c) => <Link key={c.id} href={`/customers/${c.id}`} className="hover:underline">Mijoz: {c.name}</Link>)}
                          {u.deleteRequestedAt
                            ? null
                            : erp?.role === "DIRECTOR"
                              ? null
                              : <AppAccess ecoUserId={u.userId} phone={u.phone} current={erp?.isActive ? erp.role : null} employee={!!emp?.userId && !erp} roles={grantable} />}
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap text-sm">{dateTime(new Date(u.registeredAt))}</Td>
                      <Td className="whitespace-nowrap text-sm">{u.lastLoginAt ? dateTime(new Date(u.lastLoginAt)) : <span className="text-slate-400">—</span>}</Td>
                      <Td className="text-xs text-slate-500">{u.device ? <>{u.device.platform === "ios" ? "iOS" : u.device.platform === "android" ? "Android" : u.device.platform}{u.device.model && ` · ${u.device.model}`}{u.device.appVersion && <div>v{u.device.appVersion}</div>}</> : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          {users.length >= 500 && <p className="mt-2 text-xs text-slate-500">Eng oxirgi 500 ta ko'rsatildi — qolganini qidiruv orqali toping.</p>}
        </>
      )}
    </div>
  );
}
