import Link from "next/link";
import { AlertTriangle, Search, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { POSITIONS, driverPositionNames, roleForPosition, workPositions } from "@/lib/positions";
import { ROLE_LABELS } from "@/lib/nav";
import { date, qty } from "@/lib/format";
import { licenseDaysLeft } from "@/lib/kadr";
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui";
import { EmployeeForm, GrantLoginForm } from "./employee-form";
import { ToggleLoginButton } from "./login-forms";
import { toggleEmployee } from "./actions";
import type { Prisma } from "@/generated/prisma";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; pos?: string; holat?: string }> }) {
  const s = await requireSession(["HR", "LOGISTICS"]);
  const isHR = ["HR", "DIRECTOR"].includes(s.role);
  const { q = "", pos = "", holat = "" } = await searchParams;

  const where: Prisma.EmployeeWhereInput = {
    ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
    ...(pos ? { position: pos } : {}),
    ...(holat === "faol" ? { isActive: true } : holat === "nofaol" ? { isActive: false } : {}),
  };

  const [employees, work, drivers, vehicles] = await Promise.all([
    db.employee.findMany({ where, orderBy: [{ isActive: "desc" }, { fullName: "asc" }], include: { user: true, vehicle: true, _count: { select: { trips: true } } } }),
    workPositions(),
    driverPositionNames(),
    db.vehicle.findMany({ orderBy: { plate: "asc" }, select: { plate: true, type: true, capacityM3: true } }),
  ]);
  const workNames = work.map((w) => w.name);
  const vehicleOpts = vehicles.map((v) => ({ plate: v.plate, type: v.type, capacityM3: v.capacityM3 ? String(v.capacityM3) : null }));
  const filtering = !!(q || pos || holat);

  return (
    <div>
      <PageHeader
        title="Xodimlar"
        subtitle="Bo'lim lavozimi tanlansa xodimga login beriladi va u faqat o'z bo'limini ko'radi"
        action={isHR ? <Link href="/otdel-kadr" className="text-sm font-medium text-slate-600 hover:text-slate-900">Otdel kadr →</Link> : undefined}
      />

      {isHR && (
        <Card className="mb-4">
          <p className="mb-3 text-xs text-slate-500">
            Bu yerda faqat bo&apos;lim xodimi (login beriladigan) ochiladi. Ishchi lavozimdagi xodim —{" "}
            <Link href="/otdel-kadr?tab=xodimlar" className="font-medium text-slate-700 underline">Otdel kadr → Xodimlar ro&apos;yxati</Link> da, hujjatlari bilan.
          </p>
          <EmployeeForm departments={POSITIONS} drivers={drivers} vehicles={vehicleOpts} canGrant={isHR} />
        </Card>
      )}

      {/* Qidiruv — ro'yxat uzayganda kerak bo'ladi */}
      <form className="mb-4 grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_200px_150px_auto_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Qidiruv</span>
          <Input name="q" defaultValue={q} placeholder="F.I.O. yoki telefon" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Lavozim</span>
          <Select name="pos" defaultValue={pos}>
            <option value="">Hammasi</option>
            <optgroup label="Bo'limlar">{POSITIONS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}</optgroup>
            <optgroup label="Ishchi lavozimlar">{[...new Set([...drivers, ...workNames])].map((w) => <option key={w} value={w}>{w}</option>)}</optgroup>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Holat</span>
          <Select name="holat" defaultValue={holat}><option value="">Hammasi</option><option value="faol">Faol</option><option value="nofaol">Nofaol</option></Select>
        </label>
        <Button variant="secondary"><Search size={16} /> Qidirish</Button>
        {filtering && <Link href="/employees" className="self-center text-sm text-slate-500 hover:text-slate-900">Tozalash</Link>}
      </form>

      <Table>
        <thead><tr><Th>F.I.O.</Th><Th>Lavozim</Th><Th>Telefon</Th><Th>Ishga kirgan</Th><Th>Tizimga kirish</Th><Th right>Reyslar</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {employees.length === 0 && <Empty text={filtering ? "Shu shartga mos xodim yo'q" : "Xodimlar yo'q"} />}
          {employees.map((e) => {
            const role = roleForPosition(e.position);
            return (
              <Tr key={e.id}>
                <Td className="font-medium">
                  {isHR ? <Link href={`/employees/${e.id}`} className="hover:underline">{e.fullName}</Link> : e.fullName}
                  {e.note && <div className="text-xs text-slate-500">{e.note}</div>}
                </Td>
                <Td>
                  {e.position}
                  {e.vehicle && <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><Truck size={12} /> {e.vehicle.plate}{e.vehicle.capacityM3 ? ` · ${qty(e.vehicle.capacityM3)} m³` : ""}</div>}
                  {e.licenseExpiry && licenseDaysLeft(e.licenseExpiry) < 30 && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle size={12} /> Guvohnoma {licenseDaysLeft(e.licenseExpiry) < 0 ? "muddati o'tgan" : `${licenseDaysLeft(e.licenseExpiry)} kundan keyin tugaydi`}
                    </div>
                  )}
                </Td>
                <Td>{e.phone ?? "—"}</Td>
                <Td>{e.hiredAt ? date(e.hiredAt) : <span className="text-slate-400">—</span>}</Td>
                <Td>
                  {e.user
                    ? (
                      <span className="flex flex-wrap items-center gap-1.5 text-sm">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5">{e.user.login}</code>
                        <span className="text-slate-500">· {ROLE_LABELS[e.user.role]}</span>
                        {!e.user.isActive && <Badge color="red">bloklangan</Badge>}
                        {/* Kirishni bloklash — xodim ro'yxatda faol qoladi; ishdan bo'shatish "O'chirish" tugmasida */}
                        {isHR && e.isActive && e.userId !== s.userId && <ToggleLoginButton employeeId={e.id} blocked={!e.user.isActive} compact />}
                      </span>
                    )
                    : role && isHR && e.isActive ? <GrantLoginForm employeeId={e.id} />
                    : <span className="text-slate-400">—</span>}
                </Td>
                <Td right>{e._count.trips}</Td>
                <Td>{e.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
                <Td>{isHR && e.userId !== s.userId && <form action={toggleEmployee.bind(null, e.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{e.isActive ? "O'chirish" : "Yoqish"}</Button></form>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
