import Link from "next/link";
import { BriefcaseBusiness, CakeSlice, Building2, CalendarCheck, CalendarRange, Clock, BarChart3, ClipboardList, GraduationCap, Handshake, MessageSquare, Inbox, ListChecks, Scale, Target, UserPlus, FileSpreadsheet, FileText, IdCard, Paperclip, Plus, UserCheck, User, Users, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { positionCatalog, workPositions } from "@/lib/positions";
import { parsePerms } from "@/lib/auth";
import { TEMPLATE_ROLE_OPTIONS } from "@/lib/perm-template";
import { date } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, Empty, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import {
  DEFAULT_SHIFT, dayUtc, isoDay, monthDays, monthOf, today, validDay, validMonth, workedMinutes,
} from "@/lib/davomat";
import { NewPositionForm, PositionRow, SyncPositionsButton } from "./position-forms";
import { OrgChart, type OrgEmployee } from "./org-chart";
import { DavomatKun, type KunOutside, type KunRow } from "./davomat-kun";
import { parseSchedule, shiftOf, sourceLabel } from "@/lib/attendance-time";
import { IshVaqti, type IshVaqtiRow } from "./ish-vaqti";
import { DavomatOy, type OyRow } from "./davomat-oy";
import { DismissButton, RestoreButton } from "../employees/dismiss-form";
import { distanceText } from "@/lib/attendance-zone";
import { faceScope } from "@/lib/face-id";
import { employeesInWindow } from "@/lib/attendance-report";
import { plansFor } from "@/lib/hr/shifts";
import { getLateFine } from "@/lib/hr/late-fine";
import { ArizalarTab, CheklistTab, GrafikTab, JarimaTab, KpiTab } from "./hr-tabs";
import { MoslashuvTab, OqitishTab, YollashTab } from "./hr3-tabs";
import { HisobotTab, MurojaatTab, SorovnomaTab } from "./hr4-tabs";

const TABS = [
  ["xodimlar", "Xodimlar ro'yxati", Users],
  ["lavozimlar", "Ishchi lavozimlar", BriefcaseBusiness],
  ["bolimlar", "Bo'limlar", Building2],
  ["davomat", "Davomat", CalendarCheck],
  ["ish-vaqti", "Ish vaqti", Clock],
  ["taqvim", "Kadr taqvimi", CakeSlice],
  ["grafik", "Smena grafigi", CalendarRange],
  ["arizalar", "Arizalar", Inbox],
  ["jarima-bonus", "Jarima va bonuslar", Scale],
  ["cheklistlar", "Cheklistlar", ListChecks],
  ["kpi", "KPI", Target],
  ["yollash", "Yollash", UserPlus],
  ["moslashuv", "Moslashuv", Handshake],
  ["oqitish", "O'qitish", GraduationCap],
  ["sorovnoma", "So'rovnoma", ClipboardList],
  ["murojaatlar", "Murojaatlar", MessageSquare],
  ["hisobotlar", "Hisobotlar", BarChart3],
] as const;

/** Tug'ilgan kunigacha necha kun qolgani (yilni hisobga olmay). */
function daysToAnniversary(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}
const inDays = (n: number) => (n === 0 ? "bugun" : n === 1 ? "ertaga" : `${n} kundan keyin`);

export default async function OtdelKadrPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; qoshildi?: string; yangilandi?: string; kun?: string; oy?: string; hafta?: string; holat?: string; vakansiya?: string }>;
}) {
  // Direktor modulni "yo'q" qilib qo'ygan bo'lsa — HR roli bo'lsa ham sahifa yopiq (perms)
  await requirePage("/otdel-kadr");
  const s = await requireRoles(["HR"], { module: "employees" });
  const { tab = "xodimlar", qoshildi, yangilandi, kun, oy, hafta, holat, vakansiya } = await searchParams;

  // Davomat tabi: `oy` berilsa oylik tabel, aks holda kunlik belgilash oynasi
  const oyParam = validMonth(oy);
  const kunIso = validDay(kun) ?? today();
  const oyIso = oyParam ?? monthOf(kunIso);
  const davomat = tab === "davomat";

  const [employees, positions, catalog, orderStages, tripStages] = await Promise.all([
    db.employee.findMany({ orderBy: [{ isActive: "desc" }, { fullName: "asc" }], include: { user: { select: { role: true, isActive: true } }, _count: { select: { documents: true } } } }),
    workPositions({ all: true }),
    positionCatalog(), // ro'yxatda yo'q (Excel'dan qolgan) lavozimlarni ko'rsatish uchun
    tab === "bolimlar" ? db.order.groupBy({ by: ["status"], _count: true }) : [],
    tab === "bolimlar" ? db.trip.groupBy({ by: ["status"], _count: true }) : [],
  ]);

  const { strays } = catalog;
  const active = employees.filter((e) => e.isActive);
  const withLogin = employees.filter((e) => e.userId).length;
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const newHires = employees.filter((e) => e.hiredAt && e.hiredAt >= monthAgo).length;
  const countByPosition = new Map<string, number>();
  for (const e of employees) countByPosition.set(e.position, (countByPosition.get(e.position) ?? 0) + 1);
  // Lavozimdagi faol login egalari — login shabloni shularga qo'llanadi
  const loginsByPosition = new Map<string, number>();
  for (const e of employees) if (e.isActive && e.user?.isActive) loginsByPosition.set(e.position, (loginsByPosition.get(e.position) ?? 0) + 1);

  // ── Bo'limlar tabi: tuzilma diagrammasi uchun sodda ma'lumot + etaplardagi jonli sanoq ──
  const orgEmployees: OrgEmployee[] = employees.map((e) => ({
    id: e.id, fullName: e.fullName, position: e.position, phone: e.phone,
    hiredAt: e.hiredAt ? date(e.hiredAt) : null, photo: !!e.photo,
    isActive: e.isActive, login: !!e.userId, docs: e._count.documents,
  }));
  // Yashirilgan lavozim ham xodimi bo'lsa chizmada qoladi — aks holda odam ko'rinmay qoladi
  const orgPositions = positions
    .filter((p) => p.isActive || (countByPosition.get(p.name) ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, note: p.note, department: p.department, loginRole: p.loginRole, isDriver: p.isDriver }));

  // ── Davomat: kunlik ro'yxat yoki oylik tabel ──
  // Tabelda xodim ishga kirgan kundan bo'shagan kunigacha turadi; shu oyning eski
  // kunlarini to'g'rilash uchun bo'shatilganlar ham oynadan tushib qolmaydi.
  const inWindow = employeesInWindow;
  const tabelOrder = [{ position: "asc" as const }, { fullName: "asc" as const }];

  let kunRows: KunRow[] = [];
  let oyRows: OyRow[] = [];
  if (davomat && oyParam) {
    const days = monthDays(oyIso);
    const from = dayUtc(days[0].iso);
    const to = dayUtc(days[days.length - 1].iso);
    const [list, marks] = await Promise.all([
      db.employee.findMany({ where: inWindow(from, to), orderBy: tabelOrder, select: { id: true, fullName: true, position: true } }),
      db.attendance.findMany({ where: { date: { gte: from, lte: to } } }),
    ]);
    const byEmp = new Map<string, OyRow["cells"]>();
    for (const m of marks) {
      const cells = byEmp.get(m.employeeId) ?? {};
      // Hududdan tashqaridagi belgi — katakda nuqta, izohda masofa
      const km = (d: number | null) => (d == null ? "" : ` ${distanceText(d)}`);
      const outs = m.status === "PRESENT" ? [m.checkInOutside && `keldi${km(m.checkInDistance)}`, m.checkOutOutside && `ketdi${km(m.checkOutDistance)}`].filter(Boolean) : [];
      cells[isoDay(m.date)] = { status: m.status, min: workedMinutes(m.checkIn, m.checkOut), note: m.note, out: outs.length ? `Hududdan tashqarida: ${outs.join(", ")}` : null, late: m.status === "PRESENT" ? m.lateMinutes : null };
      byEmp.set(m.employeeId, cells);
    }
    oyRows = list.map((e) => ({ ...e, cells: byEmp.get(e.id) ?? {} }));
  } else if (davomat) {
    const day = dayUtc(kunIso);
    const [list, marks] = await Promise.all([
      db.employee.findMany({ where: inWindow(day, day), orderBy: tabelOrder, select: { id: true, fullName: true, position: true, photo: true, workSchedule: true, attendanceAnywhere: true } }),
      db.attendance.findMany({ where: { date: day } }),
    ]);
    const markers = new Map((await db.user.findMany({ where: { id: { in: [...new Set(marks.map((m) => m.markedById).filter((x): x is string => !!x))] } }, select: { id: true, role: true } })).map((u) => [u.id, u.role]));
    const byEmp = new Map(marks.map((m) => [m.employeeId, m]));
    // Hududdan tashqaridagi belgi: nuqta, masofa va joy rasmi (rasmni yuz kadri kabi faqat skaner huquqi borlar ochadi)
    const photos = !!faceScope(s);
    const outside = (m: (typeof marks)[number] | undefined, k: "in" | "out"): KunOutside | null => {
      if (!m || m.status !== "PRESENT") return null;
      const [on, lat, lng, dist, photo] = k === "in"
        ? [m.checkInOutside, m.checkInLat, m.checkInLng, m.checkInDistance, m.checkInPlacePhoto]
        : [m.checkOutOutside, m.checkOutLat, m.checkOutLng, m.checkOutDistance, m.checkOutPlacePhoto];
      if (!on || lat == null || lng == null) return null;
      return { lat, lng, distanceM: dist == null ? null : Math.round(dist), photo: photos && photo ? `/otdel-kadr/joy-rasmi?a=${m.id}&k=${k}` : null };
    };
    const plans = await plansFor(list.map((e) => e.id), kunIso); // smena grafigi (katak bo'lmasa — kartadagi grafik)
    kunRows = list.map((e) => {
      const m = byEmp.get(e.id);
      const plan = plans.get(e.id) ?? shiftOf(e.workSchedule);
      return {
        id: e.id, fullName: e.fullName, position: e.position, photo: !!e.photo,
        shiftStart: plan.start, shiftEnd: plan.end,
        source: m ? sourceLabel(m.source, { face: !!m.facePhoto && !!m.faceVerifiedAt, markerRole: m.markedById ? markers.get(m.markedById) ?? null : null }) : null,
        status: m?.status ?? null, checkIn: m?.checkIn ?? null, checkOut: m?.checkOut ?? null, note: m?.note ?? null,
        ver: m?.updatedAt.toISOString() ?? "",
        anywhere: e.attendanceAnywhere, outsideIn: outside(m, "in"), outsideOut: outside(m, "out"),
      } satisfies KunRow;
    });
  }

  // ── Ish vaqti tabi: faol xodimlar smenasi (lavozim, keyin F.I.O. tartibida) ──
  const ishVaqtiRows: IshVaqtiRow[] = tab === "ish-vaqti"
    ? active
      .map((e) => ({ id: e.id, fullName: e.fullName, position: e.position, ...parseSchedule(e.workSchedule) }))
      .sort((a, b) => a.position.localeCompare(b.position) || a.fullName.localeCompare(b.fullName))
    : [];

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

      {(qoshildi || yangilandi) && (
        <Callout tone="success" title="Excel import bajarildi">
          {Number(qoshildi) || 0} ta yangi xodim qo&apos;shildi, {Number(yangilandi) || 0} tasining kartasi yangilandi — surat va hujjat nusxalarini kartadan yuklaysiz.
        </Callout>
      )}

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
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/otdel-kadr/import" variant="secondary"><FileSpreadsheet size={16} /> Excel orqali qo&apos;shish</LinkButton>
              <LinkButton href="/otdel-kadr/yangi"><Plus size={16} /> Xodim qo&apos;shish</LinkButton>
            </div>
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
                  <Td className="font-medium">
                    <Link href={`/employees/${e.id}`} className="hover:underline">{e.fullName}</Link>
                    {e.tabelNo && <div className="text-xs font-normal text-slate-500">Tabel № {e.tabelNo}</div>}
                    {e.attendanceAnywhere && <div className="mt-0.5 font-normal"><Badge color="violet">Hududdan tashqarida davomat</Badge></div>}
                  </Td>
                  <Td>
                    {e.position}
                    {e.subdivision && <div className="text-xs text-slate-500">{e.subdivision}</div>}
                  </Td>
                  <Td>{e.phone ?? "—"}</Td>
                  <Td>{e.hiredAt ? date(e.hiredAt) : <span className="text-slate-400">—</span>}</Td>
                  <Td right>{e._count.documents > 0 ? <span className="inline-flex items-center gap-1 text-slate-600"><Paperclip size={13} />{e._count.documents}</span> : <span className="text-slate-400">—</span>}</Td>
                  <Td>
                    {e.firedAt ? <Badge color="red">Bo&apos;shatilgan</Badge> : e.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}
                    {e.firedAt && <div className="mt-0.5 text-xs font-normal text-slate-500">{date(e.firedAt)}{e.firedReason ? ` · ${e.firedReason}` : ""}</div>}
                  </Td>
                  <Td>
                    <span className="flex items-center justify-end gap-2">
                      <Link href={`/employees/${e.id}/varaqa`} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><FileText size={14} /> Varaqa</Link>
                      {e.userId !== s.userId && (e.firedAt
                        ? <RestoreButton employeeId={e.id} compact />
                        : <DismissButton employeeId={e.id} fullName={e.fullName} compact />)}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "lavozimlar" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Yangi ishchi lavozim" description={s.role === "DIRECTOR" ? "Qo'shilgani darhol Xodimlar sahifasidagi ro'yxatga tushadi. Lavozim tizimga kirsin desangiz — ro'yxatdagi «Login shabloni» orqali asosiy bo'lim va ruxsatlarni belgilang." : "Qo'shilgani darhol Xodimlar sahifasidagi ro'yxatga tushadi. Lavozimni tizimga kiradigan qilishni (login shabloni) direktor belgilaydi."} icon={BriefcaseBusiness} />
            <NewPositionForm nextOrder={(positions.at(-1)?.sortOrder ?? 0) + 10} />
          </Card>
          <Card>
            <CardHeader title="Lavozimlarni tartibga solish" description="Excel orqali kelgan xodimlarning lavozimini ro'yxat bilan moslaydi: bir xil ishning turli yozilishi bitta nomga keltiriladi, ro'yxatda yo'q lavozim ro'yxatga olinadi — shundan keyin lavozim Xodimlar sahifasida, filtrlarda va tuzilma diagrammasida bir xil ko'rinadi." icon={BriefcaseBusiness} />
            <SyncPositionsButton strays={strays} />
          </Card>
          <Card padded={false}>
            <div className="border-b border-slate-100 px-3 py-2.5">
              <h2 className="text-sm font-semibold">Lavozimlar ro&apos;yxati</h2>
              <p className="text-xs text-slate-500">Nomni o&apos;zgartirsangiz shu lavozimdagi xodimlar kartasi ham yangilanadi. Bandi bor lavozimni o&apos;chirib bo&apos;lmaydi — yashiring.</p>
            </div>
            {positions.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">Lavozim yo&apos;q</div>}
            {positions.map((p) => (
              <div key={p.id} className={p.isActive ? "" : "bg-slate-50/70 opacity-70"}>
                <PositionRow
                  p={{ ...p, perms: parsePerms(p.perms) ?? {} }}
                  used={countByPosition.get(p.name) ?? 0}
                  logins={loginsByPosition.get(p.name) ?? 0}
                  roles={TEMPLATE_ROLE_OPTIONS}
                  canTemplate={s.role === "DIRECTOR"}
                />
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

      {davomat && (oyParam
        ? <DavomatOy ym={oyIso} rows={oyRows} fine={await getLateFine()} />
        : <DavomatKun key={kunIso} iso={kunIso} rows={kunRows} />)}

      {tab === "ish-vaqti" && <IshVaqti rows={ishVaqtiRows} std={{ start: DEFAULT_SHIFT.checkIn, end: DEFAULT_SHIFT.checkOut }} />}

      {tab === "taqvim" && <KadrTaqvim employees={active} />}
      {tab === "grafik" && <GrafikTab employees={active} hafta={hafta} />}
      {tab === "arizalar" && <ArizalarTab s={s} employees={active} holat={holat} />}
      {tab === "cheklistlar" && <CheklistTab s={s} positions={[...new Set(active.map((e) => e.position))].sort()} kun={kun} />}
      {tab === "sorovnoma" && <SorovnomaTab s={s} positions={[...new Set(active.map((e) => e.position))].sort()} />}
      {tab === "murojaatlar" && <MurojaatTab s={s} positions={[...new Set(active.map((e) => e.position))].sort()} holat={holat} />}
      {tab === "hisobotlar" && <HisobotTab oy={oy} />}
      {tab === "yollash" && <YollashTab s={s} positions={[...new Set(active.map((e) => e.position))].sort()} vakansiya={vakansiya} />}
      {tab === "moslashuv" && <MoslashuvTab s={s} employees={active} positions={[...new Set(active.map((e) => e.position))].sort()} holat={holat} />}
      {tab === "oqitish" && <OqitishTab s={s} positions={[...new Set(active.map((e) => e.position))].sort()} />}
      {tab === "kpi" && <KpiTab s={s} positions={[...new Set(active.map((e) => e.position))].sort()} employees={active} oy={oy} />}
      {tab === "jarima-bonus" && <JarimaTab s={s} employees={active} positions={[...new Set(active.map((e) => e.position))].sort()} oy={oy} />}
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
    // Yil yubiley kunining o'zidan olinadi: dekabrda keyingi yanvardagi yubiley bir yil ko'p to'ladi
    .map((e) => { const days = daysToAnniversary(e.hiredAt!); return { e, days, years: new Date(Date.now() + days * 86_400_000).getFullYear() - e.hiredAt!.getFullYear() }; })
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
