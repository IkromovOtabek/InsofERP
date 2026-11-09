import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, IdCard, KeyRound, Package, Route, Timer } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { canDo } from "@/lib/permissions";
import { isDriverPosition } from "@/lib/positions";
import { LOGIN_HINT } from "@/lib/self-account";
import { delayLevel, ISSUE_KIND, logisticsSettings, minutesLabel, tripDelayMin, tripPhase } from "@/lib/logistics";
import { dateTime, isoDate, qty } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { DriverCardForm } from "../driver-card-form";
import { DriverLoginForm } from "../driver-login-form";
import { DelayText, PhaseBadge, TripLink } from "../../ui";

export const dynamic = "force-dynamic";

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRoles(["LOGISTICS", "DISPATCHER"], { module: "logistika" });
  const tripsClosed = !pathAllowed("/trips", s.role, s.perms);
  const { id } = await params;
  const settings = await logisticsSettings();
  const d = await db.employee.findUnique({
    where: { id },
    include: {
      vehicle: { select: { id: true, plate: true } },
      user: { select: { id: true, login: true, role: true, isActive: true, ecoUserId: true, tempPasswordUntil: true } },
      trips: {
        orderBy: { createdAt: "desc" }, take: 60,
        include: { order: { select: { orderNo: true, deliveryDate: true, deliveryTime: true, deliveryAddress: true, customer: { select: { name: true } } } }, vehicle: { select: { plate: true } }, issues: true },
      },
    },
  });
  if (!d) notFound();
  const canLogin = canDo(s, "logistika", "driver_login");
  const loginBlock = canLogin ? await driverLoginBlock(d, s.userId) : null;
  const vehicles = await db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" }, select: { id: true, plate: true } });
  const done = d.trips.filter((t) => t.status === "DELIVERED");
  const total = d.trips.filter((t) => t.status !== "CANCELLED");
  const delays = done.map((t) => tripDelayMin(t, t.order)).filter((x): x is number => x != null);
  const late = delays.filter((x) => delayLevel(x, settings) !== "ok").length;
  const durs = done.filter((t) => t.loadedAt && t.deliveredAt).map((t) => (t.deliveredAt!.getTime() - t.loadedAt!.getTime()) / 60000);
  const issues = d.trips.flatMap((t) => t.issues.map((i) => ({ ...i, noteNo: t.deliveryNoteNo })));

  return (
    <div>
      <PageHeader back={{ href: "/logistika/haydovchilar", label: "Haydovchilar" }} title={d.fullName}
        subtitle={<>{d.position}{d.phone ? ` · ${d.phone}` : ""}{d.vehicle ? <> · <Link href={`/logistika/transport/${d.vehicle.id}`} className="hover:underline">{d.vehicle.plate}</Link></> : ""}{!d.isActive && " · ishdan ketgan"}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Reyslar (oxirgi 60)" value={total.length} hint={`${done.length} yetkazilgan`} icon={Route} tone="brand" href="#reyslar" />
        <StatCard label="Yetkazilgan hajm" value={qty(done.reduce((a, t) => a + Number(t.qtyM3), 0))} icon={Package} tone="success" href="#reyslar" />
        <StatCard label="O'rtacha yetkazish" value={minutesLabel(durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null)} icon={Timer} href="#reyslar" />
        <StatCard label="Kechikish / muammo" value={`${late} / ${issues.length}`} hint={delays.length ? `o'z vaqtida ${Math.round(((delays.length - late) / delays.length) * 100)}%` : undefined} icon={AlertTriangle} tone={late || issues.length ? "warning" : "default"} href="#muammolar" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader title="Haydovchi kartasi" description="F.I.O., telefon, passport — Otdel kadrda" icon={IdCard} />
          <DriverCardForm id={d.id} vehicles={vehicles} v={{ workSchedule: d.workSchedule, licenseNo: d.licenseNo, licenseCategory: d.licenseCategory, licenseExpiry: d.licenseExpiry ? isoDate(d.licenseExpiry) : "", vehicleId: d.vehicleId }} />
          {canLogin && (
            <div id="kirish" className="mt-6 scroll-mt-20 border-t border-slate-100 pt-5">
              <CardHeader title="Tizimga kirish" description={loginStatus(d.user)} icon={KeyRound} />
              {loginBlock
                ? <p className="text-sm text-slate-500">{loginBlock}</p>
                : <DriverLoginForm id={d.id} login={d.user?.login ?? null} suggested={suggestLogin(d.fullName)} loginHint={LOGIN_HINT} />}
            </div>
          )}
        </Card>
        <Card padded={false} className="xl:col-span-3">
          <div id="muammolar" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Kechikish va muammolar tarixi" icon={AlertTriangle} /></div>
          <Table>
            <thead><tr><Th>Sana</Th><Th>Nakladnoy</Th><Th>Muammo</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {issues.length === 0 && <Empty text="Muammo qayd etilmagan" />}
              {issues.map((i) => (
                <Tr key={i.id}><Td className="text-sm tabular">{dateTime(i.createdAt)}</Td><Td className="text-sm">{i.noteNo}</Td><Td className="text-sm">{ISSUE_KIND[i.kind]}{i.note && <div className="text-xs text-slate-500">{i.note}</div>}</Td><Td>{i.resolvedAt ? <Badge color="green">hal qilindi</Badge> : <Badge color="red">ochiq</Badge>}</Td></Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
      <Card padded={false} className="mt-5">
        <div id="reyslar" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Reyslar" icon={Route} /></div>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Mijoz / manzil</Th><Th>Transport</Th><Th right>Hajm</Th><Th>Bosqich</Th><Th>Reja</Th><Th>Kechikish</Th></tr></thead>
          <tbody>
            {d.trips.length === 0 && <Empty text="Reys yo'q" />}
            {d.trips.map((t) => {
              const dl = tripDelayMin(t, t.order);
              return (
                <Tr key={t.id}>
                  <Td><TripLink id={t.id} noteNo={t.deliveryNoteNo} plain={tripsClosed} /><div className="text-xs text-slate-500">{dateTime(t.createdAt)}</div></Td>
                  <Td><div className="text-sm">{t.order.customer.name}</div><div className="max-w-xs truncate text-xs text-slate-500">{t.order.deliveryAddress}</div></Td>
                  <Td className="text-sm tabular">{t.vehicle.plate}</Td>
                  <Td right className="tabular">{qty(t.qtyM3)}</Td>
                  <Td><PhaseBadge phase={tripPhase(t)} /></Td>
                  <Td className="text-sm tabular">{t.order.deliveryTime ?? "—"}</Td>
                  <Td>{t.status === "CANCELLED" ? "—" : <DelayText min={dl} level={delayLevel(dl, settings)} />}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

type LoginUser = { id: string; login: string; role: string; isActive: boolean; ecoUserId: string | null; tempPasswordUntil: Date | null } | null;

function loginStatus(u: LoginUser): string {
  if (!u) return "Login berilmagan — haydovchi Telegram kod bilan ham kira oladi";
  if (u.ecoUserId) return `«${u.login}» — ilovadagi telefon va parol bilan kiradi`;
  if (!u.isActive) return `«${u.login}» — kirish bloklangan`;
  if (!u.tempPasswordUntil) return `«${u.login}» — haydovchi o'z paroli bilan kiradi`;
  return u.tempPasswordUntil > new Date()
    ? `«${u.login}» — vaqtinchalik parol, ${dateTime(u.tempPasswordUntil)} gacha; haydovchi hali o'z parolini qo'ymagan`
    : `«${u.login}» — vaqtinchalik parol muddati tugagan`;
}

/** Dispetcher bu loginga tegolmaydigan holatlar — sabab tugma o'rnida (server ham xuddi shuni tekshiradi). */
async function driverLoginBlock(d: { isActive: boolean; firedAt: Date | null; position: string; user: LoginUser }, me: string): Promise<string | null> {
  if (!d.isActive || d.firedAt) return "Xodim nofaol — kirishni Otdel kadr qaytaradi.";
  if (!(await isDriverPosition(d.position))) return "Kirish faqat haydovchi lavozimidagi xodimga beriladi.";
  if (!d.user) return null;
  if (d.user.role !== "DRIVER") return "Bu login boshqa bo'limda — uni Otdel kadr boshqaradi.";
  if (!d.user.isActive) return "Kirish bloklangan — uni Otdel kadr ochadi.";
  if (d.user.ecoUserId) return "Parol ilovada tiklanadi.";
  if (d.user.id === me) return "O'z loginingiz — «Mening hisobim» bo'limida.";
  return null;
}

/** "Aliyev Vali G'aniyevich" → "aliyev.vali" (o', g' va boshqa belgilarsiz). Band bo'lsa dispetcher o'zgartiradi. */
function suggestLogin(fullName: string): string {
  const parts = fullName.toLowerCase().replace(/[ʻʼ'`‘’]/g, "").split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  return parts.slice(0, 2).join(".").slice(0, 32);
}
