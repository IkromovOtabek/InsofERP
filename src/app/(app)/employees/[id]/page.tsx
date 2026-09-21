import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, KeyRound, Paperclip, User } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { POSITIONS, driverPositionNames, workPositions } from "@/lib/positions";
import { ROLE_LABELS } from "@/lib/nav";
import { EMPLOYEE_ACCEPT } from "@/lib/uploads";
import { date, dateTime, isoDate, qty } from "@/lib/format";
import { licenseDaysLeft } from "@/lib/kadr";
import { Badge, Card, CardHeader, DL, Empty, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { EmployeeCardForm } from "../employee-form";
import { ChangeLoginForm, ResetPasswordForm, ToggleLoginButton } from "../login-forms";
import { DeleteDocument, DocumentForms } from "./document-forms";

export default async function EmployeeCardPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(["HR"]);
  const { id } = await params;
  const [e, work, drivers, vehicles] = await Promise.all([
    db.employee.findUnique({
      where: { id },
      include: { user: true, vehicle: true, documents: { orderBy: { createdAt: "asc" } }, _count: { select: { trips: true, brigades: true } } },
    }),
    workPositions(),
    driverPositionNames(),
    db.vehicle.findMany({ orderBy: { plate: "asc" }, select: { plate: true, type: true, capacityM3: true } }),
  ]);
  if (!e) notFound();

  return (
    <div>
      <PageHeader
        title={e.fullName}
        eyebrow="Xodim kartasi"
        subtitle={e.position}
        back={{ href: "/otdel-kadr?tab=xodimlar", label: "Xodimlar ro'yxati" }}
        action={
          <div className="flex items-center gap-3">
            {e.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}
            <LinkButton href={`/employees/${e.id}/varaqa`} variant="secondary"><FileText size={16} /> Shaxsiy varaqa</LinkButton>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Ma'lumotlari" description="Otdel kadr yuritadi" />
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="shrink-0">
              <div className="flex h-[150px] w-[120px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-400">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {e.photo ? <img src={`/employees/${e.id}/surat`} alt={e.fullName} className="h-full w-full object-cover" /> : <User size={28} />}
              </div>
              <p className="mt-1 w-[120px] text-[11px] text-slate-500">{e.photo ? "3x4 surat" : "Surat yuklanmagan"}</p>
            </div>
            <div className="min-w-0 flex-1">
              <EmployeeCardForm
                employee={{
                  id: e.id, fullName: e.fullName, position: e.position, phone: e.phone, note: e.note,
                  hiredAt: e.hiredAt ? isoDate(e.hiredAt) : null,
                  birthDate: e.birthDate ? isoDate(e.birthDate) : null,
                  passportSeries: e.passportSeries, pinfl: e.pinfl, passportIssuedBy: e.passportIssuedBy,
                  passportIssuedAt: e.passportIssuedAt ? isoDate(e.passportIssuedAt) : null,
                  address: e.address, education: e.education, maritalStatus: e.maritalStatus,
                  plate: e.vehicle?.plate ?? null, vehicleType: e.vehicle?.type ?? null,
                  capacityM3: e.vehicle?.capacityM3 ? String(e.vehicle.capacityM3) : null,
                  licenseNo: e.licenseNo, licenseCategory: e.licenseCategory,
                  licenseExpiry: e.licenseExpiry ? isoDate(e.licenseExpiry) : null,
                }}
                departments={POSITIONS}
                work={[...new Set([...drivers, ...work.map((w) => w.name)])]}
                drivers={drivers}
                vehicles={vehicles.map((v) => ({ plate: v.plate, type: v.type, capacityM3: v.capacityM3 ? String(v.capacityM3) : null }))}
                hasLogin={!!e.userId}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Tizim va faoliyat" />
          <DL items={[
            { k: "Login", v: e.user ? <><code className="rounded bg-slate-100 px-1.5 py-0.5">{e.user.login}</code> · {ROLE_LABELS[e.user.role]}{!e.user.isActive && <> <Badge color="red">bloklangan</Badge></>}</> : <span className="text-slate-400">yo&apos;q</span> },
            { k: "Reyslar", v: e._count.trips > 0 ? <Link href={`/trips?status=tarix&driver=${e.id}`} className="font-medium text-slate-700 hover:underline">{e._count.trips} ta — tarixi</Link> : 0 },
            ...(e.vehicle ? [{ k: "Texnikasi", v: <>{e.vehicle.plate}{e.vehicle.capacityM3 ? ` · ${qty(e.vehicle.capacityM3)} m³` : ""}</> }] : []),
            ...(e.licenseNo || e.licenseCategory ? [{ k: "Guvohnoma", v: `${e.licenseNo ?? "—"}${e.licenseCategory ? ` · ${e.licenseCategory}` : ""}` }] : []),
            ...(e.licenseExpiry ? [{ k: "Guvohnoma muddati", v: licenseDaysLeft(e.licenseExpiry) < 30 ? <span className="text-red-600">{date(e.licenseExpiry)}</span> : date(e.licenseExpiry) }] : []),
            { k: "Brigada boshlig'i", v: e._count.brigades },
            { k: "Kartaga kiritilgan", v: dateTime(e.createdAt) },
            { k: "Ishga kirgan", v: e.hiredAt ? date(e.hiredAt) : "—" },
            { k: "Tug'ilgan", v: e.birthDate ? date(e.birthDate) : "—" },
            { k: "Haydovchi ilovasi (ECO)", v: e.ecoUserId ? (e.ecoActive ? <Badge color="green">ulangan</Badge> : <Badge color="amber">tasdiqlanmagan</Badge>) : "—" },
            ...(e.ecoError ? [{ k: "ECO xatosi", v: <span className="text-red-600">{e.ecoError}</span> }] : []),
          ]} />
        </Card>

        {e.user && (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Tizimga kirish"
              description={!e.isActive
                ? "Xodim nofaol — logini ham bloklangan. Qaytarish uchun Xodimlar ro'yxatida \"Yoqish\" tugmasini bosing."
                : e.user.isActive
                  ? "Loginni yoki parolni almashtirish, kerak bo'lsa kirishni vaqtincha bloklash"
                  : "Bu login bloklangan — xodim ERP'ga kira olmaydi"}
              icon={KeyRound}
              action={e.userId === s.userId || !e.isActive ? undefined : <ToggleLoginButton employeeId={e.id} blocked={!e.user.isActive} />}
            />
            {e.userId === s.userId ? (
              <p className="text-sm text-slate-500">Bu sizning loginingiz — uni bu yerdan o&apos;zgartirib bo&apos;lmaydi.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ChangeLoginForm employeeId={e.id} currentLogin={e.user.login} />
                <ResetPasswordForm employeeId={e.id} />
              </div>
            )}
          </Card>
        )}

        <Card className="lg:col-span-2" padded={false}>
          <div className="border-b border-slate-100 px-5 pt-5">
            <CardHeader title="Hujjat nusxalari" description="Rasm yoki PDF. Fayllar tizimda saqlanadi, tashqariga chiqmaydi." icon={Paperclip} />
          </div>
          <div className="border-b border-slate-100 px-5 py-4">
            <DocumentForms employeeId={e.id} accept={EMPLOYEE_ACCEPT} />
          </div>
          <Table>
            <thead><tr><Th>Hujjat turi</Th><Th>Fayl</Th><Th>Qabul qilingan</Th><Th></Th></tr></thead>
            <tbody>
              {e.documents.length === 0 && <Empty text="Hujjat nusxasi yuklanmagan" />}
              {e.documents.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-medium">{d.kind}</Td>
                  <Td>
                    <Link href={`/employees/${e.id}/hujjat/${d.id}`} target="_blank" className="text-slate-700 hover:underline">{d.fileName}</Link>
                    <span className="ml-2 text-xs text-slate-400">{d.fileType}</span>
                  </Td>
                  <Td>{date(d.createdAt)}</Td>
                  <Td><DeleteDocument docId={d.id} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
