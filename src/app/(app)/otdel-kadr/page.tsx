import Link from "next/link";
import { BriefcaseBusiness, CakeSlice, Building2, FileText, IdCard, Paperclip, Plus, UserCheck, User, Users, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { workPositions } from "@/lib/positions";
import { date } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { NewPositionForm, PositionRow } from "./position-forms";
import { OrgChart, type OrgEmployee } from "./org-chart";

const TABS = [
  ["xodimlar", "Xodimlar ro'yxati", Users],
  ["lavozimlar", "Ishchi lavozimlar", BriefcaseBusiness],
  ["bolimlar", "Bo'limlar", Building2],
  ["taqvim", "Kadr taqvimi", CakeSlice],
] as const;

/** Tug'ilgan kunigacha necha kun qolgani (yilni hisobga olmay). */
function daysToAnniversary(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}
const inDays = (n: number) => (n === 0 ? "bugun" : n === 1 ? "ertaga" : `${n} kundan keyin`);

export default async function OtdelKadrPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSession(["HR"]);
  const { tab = "xodimlar" } = await searchParams;

  const [employees, positions, orderStages, tripStages] = await Promise.all([
    db.employee.findMany({ orderBy: [{ isActive: "desc" }, { fullName: "asc" }], include: { user: { select: { role: true, isActive: true } }, _count: { select: { documents: true } } } }),
    workPositions({ all: true }),
    tab === "bolimlar" ? db.order.groupBy({ by: ["status"], _count: true }) : [],
    tab === "bolimlar" ? db.trip.groupBy({ by: ["status"], _count: true }) : [],
  ]);

  const active = employees.filter((e) => e.isActive);
  const withLogin = employees.filter((e) => e.userId).length;
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const newHires = employees.filter((e) => e.hiredAt && e.hiredAt >= monthAgo).length;
  const countByPosition = new Map<string, number>();
  for (const e of employees) countByPosition.set(e.position, (countByPosition.get(e.position) ?? 0) + 1);

  // ── Bo'limlar tabi: tuzilma diagrammasi uchun sodda ma'lumot + etaplardagi jonli sanoq ──
  const orgEmployees: OrgEmployee[] = employees.map((e) => ({
    id: e.id, fullName: e.fullName, position: e.position, phone: e.phone,
    hiredAt: e.hiredAt ? date(e.hiredAt) : null, photo: !!e.photo,
    isActive: e.isActive, login: !!e.userId, docs: e._count.documents,
  }));
  // Yashirilgan lavozim ham xodimi bo'lsa chizmada qoladi — aks holda odam ko'rinmay qoladi
  const orgPositions = positions
    .filter((p) => p.isActive || (countByPosition.get(p.name) ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, note: p.note, department: p.department, isDriver: p.isDriver }));

  const oc = new Map(orderStages.map((r) => [String(r.status), Number(r._count)]));
  const tc = new Map(tripStages.map((r) => [String(r.status), Number(r._count)]));
  const nOf = (m: Map<string, number>, ...keys: string[]) => keys.reduce((n, k) => n + (m.get(k) ?? 0), 0);
  const stageCounts = {
    zayavka: nOf(oc, "DRAFT"),
    tasdiq: nOf(oc, "BLOCKED"),
    ishlab: nOf(oc, "CONFIRMED", "IN_PRODUCTION"),
    yuklash: nOf(tc, "PLANNED", "LOADED"),
    reys: nOf(tc, "ON_ROAD"),
    tolov: nOf(oc, "DELIVERED"),
  };

  return (
    <div>
      <PageHeader title="Otdel kadr" subtitle="Lavozimlar ro'yxati, bo'limlar va kadr taqvimi shu yerda. Xodim kartasi — Xodimlar sahifasida." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Jami xodim" value={employees.length} hint={`${active.length} faol`} icon={Users} tone="brand" />
        <StatCard label="Tizimga kiradi" value={withLogin} hint="login berilgan" icon={IdCard} tone="info" href="/employees" />
        <StatCard label="Ishchi lavozim" value={positions.filter((p) => p.isActive).length} hint={`${positions.length} tadan faol`} icon={BriefcaseBusiness} />
        <StatCard label="Oxirgi oyda qabul" value={newHires} hint="ishga kirgan" icon={UserCheck} tone="success" />
      </div>

      <Tabs current={tab} items={TABS.map(([k, label, icon]) => ({ key: k, label, href: `/otdel-kadr?tab=${k}`, icon }))} />

      {tab === "xodimlar" && (
        <Card padded={false}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Xodimlar ro&apos;yxati</h2>
              <p className="text-xs text-slate-500">Yangi xodim ma&apos;lumotlari va hujjat nusxalari bilan kiritiladi; saqlangach shaxsiy varaqa chop etiladi.</p>
            </div>
            <LinkButton href="/otdel-kadr/yangi"><Plus size={16} /> Xodim qo&apos;shish</LinkButton>
          </div>
          <Table>
            <thead><tr><Th>Surat</Th><Th>F.I.O.</Th><Th>Lavozim</Th><Th>Telefon</Th><Th>Ishga kirgan</Th><Th right>Hujjat</Th><Th>Holat</Th><Th></Th></tr></thead>
            <tbody>
              {employees.length === 0 && <Empty text="Xodim yo'q — 'Xodim qo'shish' tugmasi bilan boshlang" />}
              {employees.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <span className="flex h-10 w-8 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 text-slate-400">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {e.photo ? <img src={`/employees/${e.id}/surat`} alt="" className="h-full w-full object-cover" /> : <User size={14} />}
                    </span>
                  </Td>
                  <Td className="font-medium"><Link href={`/employees/${e.id}`} className="hover:underline">{e.fullName}</Link></Td>
                  <Td>{e.position}</Td>
                  <Td>{e.phone ?? "—"}</Td>
                  <Td>{e.hiredAt ? date(e.hiredAt) : <span className="text-slate-400">—</span>}</Td>
                  <Td right>{e._count.documents > 0 ? <span className="inline-flex items-center gap-1 text-slate-600"><Paperclip size={13} />{e._count.documents}</span> : <span className="text-slate-400">—</span>}</Td>
                  <Td>{e.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
                  <Td><Link href={`/employees/${e.id}/varaqa`} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><FileText size={14} /> Varaqa</Link></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "lavozimlar" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Yangi ishchi lavozim" description="Login bermaydigan lavozimlar. Qo'shilgani darhol Xodimlar sahifasidagi ro'yxatga tushadi." icon={BriefcaseBusiness} />
            <NewPositionForm nextOrder={(positions.at(-1)?.sortOrder ?? 0) + 10} />
          </Card>
          <Card padded={false}>
            <div className="border-b border-slate-100 px-3 py-2.5">
              <h2 className="text-sm font-semibold">Lavozimlar ro&apos;yxati</h2>
              <p className="text-xs text-slate-500">Nomni o&apos;zgartirsangiz shu lavozimdagi xodimlar kartasi ham yangilanadi. Bandi bor lavozimni o&apos;chirib bo&apos;lmaydi — yashiring.</p>
            </div>
            {positions.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">Lavozim yo&apos;q</div>}
            {positions.map((p) => (
              <div key={p.id} className={p.isActive ? "" : "bg-slate-50/70 opacity-70"}>
                <PositionRow p={p} used={countByPosition.get(p.name) ?? 0} />
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === "bolimlar" && (
        <div className="space-y-3">
          <OrgChart employees={orgEmployees} positions={orgPositions} stageCounts={stageCounts} />
          <p className="px-1 text-xs text-slate-500">
            Bo&apos;limlar tizim rollariga bog&apos;langan — qo&apos;shish yoki olib tashlash uchun dasturchi kerak.
            Ishchi lavozimni boshqa bo&apos;lim tagiga ko&apos;chirish uchun <span className="font-medium text-slate-700">Ishchi lavozimlar</span> bo&apos;limidagi <span className="font-medium text-slate-700">Bo&apos;lim</span> ustunidan tanlang.
          </p>
        </div>
      )}

      {tab === "taqvim" && <KadrTaqvim employees={active} />}
    </div>
  );
}

type Emp = { id: string; fullName: string; position: string; phone: string | null; hiredAt: Date | null; birthDate: Date | null };

/** Otdel kadr kundalik ishi: yaqin tug'ilgan kunlar, ish yubileylari va to'ldirilmagan kartalar. */
function KadrTaqvim({ employees }: { employees: Emp[] }) {
  const birthdays = employees
    .filter((e) => e.birthDate)
    .map((e) => ({ e, days: daysToAnniversary(e.birthDate!) }))
    .filter((x) => x.days <= 45)
    .sort((a, b) => a.days - b.days);

  const anniversaries = employees
    .filter((e) => e.hiredAt)
    .map((e) => ({ e, days: daysToAnniversary(e.hiredAt!), years: new Date().getFullYear() - e.hiredAt!.getFullYear() }))
    .filter((x) => x.days <= 45 && x.years >= 1)
    .sort((a, b) => a.days - b.days);

  const incomplete = employees.filter((e) => !e.phone || !e.hiredAt || !e.birthDate);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Yaqin tug&apos;ilgan kunlar</h2><p className="text-xs text-slate-500">Keyingi 45 kun</p></div>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Sana</Th><Th right>Qachon</Th></tr></thead>
          <tbody>
            {birthdays.length === 0 && <Empty text="Yaqin kunlarda tug'ilgan kun yo'q" />}
            {birthdays.map(({ e, days }) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.fullName}<div className="text-xs text-slate-500">{e.position}</div></Td>
                <Td>{date(e.birthDate!)}</Td>
                <Td right>{days <= 7 ? <Badge color="amber">{inDays(days)}</Badge> : <span className="text-slate-500">{inDays(days)}</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Ish yubileylari</h2><p className="text-xs text-slate-500">Zavodda ishlagan yillari to&apos;ladigan xodimlar</p></div>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Ishga kirgan</Th><Th right>Qachon</Th></tr></thead>
          <tbody>
            {anniversaries.length === 0 && <Empty text="Yaqin kunlarda yubiley yo'q" />}
            {anniversaries.map(({ e, days, years }) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.fullName}<div className="text-xs text-slate-500">{e.position}</div></Td>
                <Td>{date(e.hiredAt!)} <span className="text-slate-500">· {years} yil</span></Td>
                <Td right><span className="text-slate-500">{inDays(days)}</span></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card padded={false} className="lg:col-span-2">
        <div className="flex items-start gap-2 border-b border-slate-100 px-4 py-3">
          {incomplete.length > 0 && <TriangleAlert size={16} className="mt-0.5 text-amber-600" />}
          <div><h2 className="text-sm font-semibold">To&apos;ldirilmagan kartalar</h2><p className="text-xs text-slate-500">Telefon, ishga kirgan yoki tug&apos;ilgan sanasi yo&apos;q faol xodimlar — Xodimlar sahifasida to&apos;ldiring</p></div>
        </div>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Lavozim</Th><Th>Yetishmayapti</Th></tr></thead>
          <tbody>
            {incomplete.length === 0 && <Empty text="Barcha kartalar to'liq" />}
            {incomplete.map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium">{e.fullName}</Td>
                <Td>{e.position}</Td>
                <Td>
                  <span className="flex flex-wrap gap-1.5">
                    {!e.phone && <Badge color="amber">telefon</Badge>}
                    {!e.hiredAt && <Badge color="amber">ishga kirgan sana</Badge>}
                    {!e.birthDate && <Badge color="amber">tug&apos;ilgan sana</Badge>}
                  </span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
