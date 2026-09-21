import Link from "next/link";
import { driverPositionNames } from "@/lib/positions";
import { Smartphone, Plug, Users, Truck, Route, AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { requireSession } from "@/lib/auth";
import { eco, ecoEnabled, ecoUrl, normalizePhone, type EcoDriver, type EcoDelivery, type EcoVehicle } from "@/lib/eco/client";
import { ECO_STATUS } from "@/lib/eco/labels";
import { qty, dateTime } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, Empty, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ApproveDriverButton, ImportDriverButton, LinkAllButton, LinkDriverButton, ResendTripsButton, SyncAllButton, SyncVehiclesButton } from "./buttons";

export const dynamic = "force-dynamic";

/**
 * Haydovchilar (Insof ECO) — haydovchi ilovasi bilan ulanish markazi.
 * ERP: xodimlar/texnika/nakladnoy manbai. ECO: haydovchi telefoni (qabul, GPS, imzo).
 */
export default async function DriversPage() {
  const s = await requireSession(["LOGISTICS", "HR"]);
  const canManage = ["LOGISTICS", "DIRECTOR"].includes(s.role);
  const enabled = ecoEnabled();

  const [employees, vehicles, trips] = await Promise.all([
    db.employee.findMany({ where: { position: { in: await driverPositionNames() } }, orderBy: [{ isActive: "desc" }, { fullName: "asc" }], include: { _count: { select: { trips: true } } } }),
    db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" } }),
    db.trip.findMany({ where: { status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } }, orderBy: { createdAt: "desc" }, include: { driver: true, order: { include: { customer: true } } } }),
  ]);

  const marks = await customerMarks(trips.map((t) => t.order.customerId));
  // ECO'dan jonli ma'lumot — server o'chiq bo'lsa sahifa baribir ochiladi
  let ping: Awaited<ReturnType<typeof eco.ping>> | null = null, ecoDrivers: EcoDriver[] = [], ecoVehicles: EcoVehicle[] = [], ecoTrips: EcoDelivery[] = [], ecoErr: string | null = null;
  if (enabled) {
    try { [ping, ecoDrivers, ecoVehicles, ecoTrips] = await Promise.all([eco.ping(), eco.drivers(), eco.vehicles(), eco.trips()]); }
    catch (e) { ecoErr = (e as Error).message; }
  }
  const byUser = new Map(ecoDrivers.map((d) => [d.userId, d]));
  const byPhone = new Map(ecoDrivers.map((d) => [d.phone, d]));
  const linkedIds = new Set(employees.map((e) => e.ecoUserId).filter(Boolean));
  const unknownEco = ecoDrivers.filter((d) => !linkedIds.has(d.userId) && !employees.some((e) => normalizePhone(e.phone) === d.phone));
  const ecoPlates = new Set(ecoVehicles.map((v) => v.plateNumber));
  const pending = trips.filter((t) => !t.ecoDeliveryId || t.ecoError);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Haydovchilar (Insof ECO)</h1>
          <p className="mt-1 text-sm text-slate-500">Nakladnoy yaratilganda haydovchi telefoniga tushadi; u qabul qiladi, yo'lda GPS yuboradi, obyektda mijoz imzolaydi — holat ERP'ga qaytadi.</p>
        </div>
        {enabled && canManage && <div className="flex flex-wrap gap-2"><SyncAllButton /><SyncVehiclesButton /><ResendTripsButton /></div>}
      </div>

      {!enabled ? (
        <Callout tone="warning" title="ECO ulanmagan">
          <p>ECO serverida integratsiya kalitini yarating va ERP <code>.env</code> ga yozing, so'ng serverni qayta ishga tushiring:</p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs">{`# InsofECO papkasida
yarn workspace @insof/api integration:create -- --org <zavod INN> --webhook http://<erp-manzil>/api/eco/webhook

# Insof ERP .env
ECO_API_URL="http://localhost:3010"
ECO_API_KEY="eco_…"
ECO_WEBHOOK_SECRET="…"`}</pre>
        </Callout>
      ) : ecoErr ? (
        <Callout tone="danger" title="ECO serveriga ulanib bo'lmadi"><p>{ecoErr}</p><p className="mt-1 text-xs">Manzil: {ecoUrl()}. ECO API (3010) va uning bazasi ishga tushganini tekshiring.</p></Callout>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Ulanish" value={<span className="text-base">{ping?.organization.name}</span>} hint={`${ping?.client} · ${ecoUrl()}`} icon={Plug} tone="success" />
          <StatCard label="ECO haydovchilari" value={ecoDrivers.length} hint={`${ecoDrivers.filter((d) => d.isActive).length} tasdiqlangan · ${ecoDrivers.filter((d) => d.activeDelivery).length} reysda`} icon={Users} />
          <StatCard label="ECO mashinalari" value={ecoVehicles.length} hint={`ERP'da ${vehicles.length} ta faol texnika`} icon={Truck} />
          <StatCard label="Bugungi reyslar (ECO)" value={ecoTrips.length} hint={pending.length ? `${pending.length} ta reys yuborilmagan/xatoli` : "hammasi sinxron"} icon={Route} tone={pending.length ? "warning" : "default"} />
        </div>
      )}

      <Card className="mt-5" padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
          <CardHeader title="ERP haydovchilari" description="Xodimlar sahifasidagi 'Haydovchi' lavozimli xodimlar. Ulash uchun telefon +998… formatida bo'lsin." icon={Smartphone} />
          {enabled && canManage && employees.some((e) => e.isActive && !e.ecoUserId) && <LinkAllButton />}
        </div>
        <Table>
          <thead><tr><Th>F.I.O.</Th><Th>Telefon</Th><Th>ECO holati</Th><Th>Hozir</Th><Th right>Reyslar</Th><Th></Th></tr></thead>
          <tbody>
            {employees.length === 0 && <Empty text="Haydovchi lavozimli xodim yo'q — Xodimlar sahifasidan qo'shing" />}
            {employees.map((e) => {
              const phone = normalizePhone(e.phone);
              const d = (e.ecoUserId && byUser.get(e.ecoUserId)) || (phone && byPhone.get(phone)) || null;
              const act = d?.activeDelivery;
              const st = act ? ECO_STATUS[act.status] : null;
              return (
                <Tr key={e.id}>
                  <Td className="font-medium">{e.fullName}{!e.isActive && <Badge>nofaol</Badge>}</Td>
                  <Td>{e.phone ?? "—"}{e.phone && !phone && <span className="ml-1 text-xs text-red-600"><AlertTriangle size={12} className="inline" /> format</span>}</Td>
                  <Td>
                    {!enabled ? <span className="text-slate-400">—</span>
                      : d ? (d.isActive ? <Badge color="green">Ulangan</Badge> : <Badge color="amber">Tasdiq kutilmoqda</Badge>)
                      : e.ecoUserId ? <Badge color="amber">ECO'da topilmadi</Badge>
                      : <Badge>Ulanmagan</Badge>}
                    {e.ecoError && <div className="mt-0.5 max-w-xs text-xs text-red-600">{e.ecoError}</div>}
                  </Td>
                  <Td>{act ? <span className="text-sm"><Badge color={st!.color}>{st!.label}</Badge> {act.externalRef && <Link href={`/trips?q=${act.externalRef}`} className="text-xs text-slate-500 hover:underline">{act.externalRef}</Link>}</span> : d ? <span className="text-xs text-slate-500">{d.isAvailable ? "bo'sh" : "band"}</span> : "—"}</Td>
                  <Td right>{e._count.trips}</Td>
                  <Td>
                    {enabled && canManage && e.isActive && (!d || !e.ecoUserId) && <LinkDriverButton employeeId={e.id} relink={!!e.ecoUserId} />}
                    {enabled && canManage && e.isActive && d && !d.isActive && e.ecoUserId && <ApproveDriverButton employeeId={e.id} />}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {enabled && unknownEco.length > 0 && (
        <Card className="mt-5" padded={false}>
          <div className="px-5 pt-5"><CardHeader title="ECO'da ro'yxatdan o'tgan, ERP'da yo'q" description="Haydovchi ilovada zavodni tanlab ro'yxatdan o'tgan. Qo'shsangiz xodimlar ro'yxatiga tushadi va reys berish mumkin bo'ladi. Odatda bu avtomatik bo'ladi — bu yerda faqat webhook yetib bormaganlari qoladi." icon={Users} /></div>
          <Table>
            <thead><tr><Th>F.I.O.</Th><Th>Telefon</Th><Th>ECO holati</Th><Th></Th></tr></thead>
            <tbody>
              {unknownEco.map((d) => (
                <Tr key={d.userId}>
                  <Td className="font-medium">{d.fullName ?? "—"}</Td><Td>{d.phone}</Td>
                  <Td>{d.isActive ? <Badge color="green">Tasdiqlangan</Badge> : <Badge color="amber">Tadbirkor tasdig'i kutilmoqda (ECO ilovasida)</Badge>}</Td>
                  <Td>{canManage && <ImportDriverButton userId={d.userId} fullName={d.fullName ?? ""} phone={d.phone} isActive={d.isActive} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Texnika" description="Davlat raqami bo'yicha moslanadi. Reys yuborilganda mashina ECO'da avtomatik yaratiladi." icon={Truck} /></div>
          <Table>
            <thead><tr><Th>Raqam</Th><Th right>Sig'im</Th><Th>ECO</Th></tr></thead>
            <tbody>
              {vehicles.length === 0 && <Empty text="Texnika yo'q" />}
              {vehicles.map((v) => (
                <Tr key={v.id}><Td className="font-medium">{v.plate}</Td><Td right>{v.capacityM3 ? `${qty(v.capacityM3)} m³` : "—"}</Td>
                  <Td>{!enabled ? "—" : ecoPlates.has(v.plate) || v.ecoVehicleId ? <Badge color="green">Bor</Badge> : <Badge>Yo'q</Badge>}{v.ecoError && <div className="max-w-[12rem] text-xs text-red-600">{v.ecoError}</div>}</Td></Tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Faol reyslar — ECO holati" description="Haydovchi ilovasidagi jonli holat. Xatolik bo'lsa reys sahifasida 'ECO'ga yuborish'." icon={Route} /></div>
          <Table>
            <thead><tr><Th>Nakladnoy</Th><Th>Haydovchi</Th><Th>ERP</Th><Th>ECO</Th><Th>Sinxron</Th></tr></thead>
            <tbody>
              {trips.length === 0 && <Empty text="Faol reys yo'q" />}
              {trips.map((t) => {
                const st = t.ecoStatus ? ECO_STATUS[t.ecoStatus as keyof typeof ECO_STATUS] : null;
                return (
                  <Tr key={t.id}>
                    <Td><Link href={`/trips/${t.id}`} className="font-medium hover:underline">{t.deliveryNoteNo}</Link><div className="text-xs text-slate-500"><CustomerName name={t.order.customer.name} blacklisted={marks.black.has(t.order.customerId)} contracted={marks.contract.has(t.order.customerId)} short /></div></Td>
                    <Td>{t.driver.fullName}</Td>
                    <Td className="text-xs">{t.status}</Td>
                    <Td>{st ? <Badge color={st.color}>{st.label}</Badge> : <span className="text-xs text-slate-400">yuborilmagan</span>}</Td>
                    <Td className="max-w-xs text-xs">{t.ecoError ? <span className="text-red-600">{t.ecoError}</span> : t.ecoSyncedAt ? <span className="text-slate-500">{dateTime(t.ecoSyncedAt)}</span> : "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
