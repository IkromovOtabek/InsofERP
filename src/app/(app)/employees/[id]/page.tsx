import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSignature, FileText, KeyRound, Paperclip } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { POSITIONS, positionCatalog } from "@/lib/positions";
import { ROLE_LABELS } from "@/lib/nav";
import { EMPLOYEE_ACCEPT, PHOTO_ACCEPT } from "@/lib/uploads";
import { date, dateTime, isoDate, money, qty } from "@/lib/format";
import { licenseDaysLeft } from "@/lib/kadr";
import { HR_DOCS, nextOrderNo } from "@/lib/hr-docs";
import { eco, ecoEnabled } from "@/lib/eco/client";
import { Badge, Card, CardHeader, DL, Empty, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { EmployeeCardForm } from "../employee-form";
import { ChangeLoginForm, ResetPasswordForm, ToggleLoginButton } from "../login-forms";
import { DismissButton, RestoreButton } from "../dismiss-form";
import { DeleteDocument, DocumentForms } from "./document-forms";
import { HrDocsPanel, type HrDocRow } from "./hr-doc-forms";
import { EmployeePhotoForm } from "./photo-form";

export default async function EmployeeCardPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(["HR"]);
  const { id } = await params;
  const [e, catalog, vehicles, orderNos] = await Promise.all([
    db.employee.findUnique({
      where: { id },
      include: {
        user: true, vehicle: true,
        documents: { orderBy: { createdAt: "asc" } },
        hrDocs: { orderBy: { docDate: "desc" } },
        _count: { select: { trips: true, brigades: true } },
      },
    }),
    positionCatalog(),
    db.vehicle.findMany({ orderBy: { plate: "asc" }, select: { plate: true, type: true, capacityM3: true } }),
    // Buyruq raqami korxona bo'yicha ketma-ket yuradi — shu yildagilardan keyingisi taklif qilinadi
    db.hrDocument.findMany({
      where: { kind: "BUYRUQ", docDate: { gte: new Date(new Date().getFullYear(), 0, 1) } },
      select: { no: true },
    }),
  ]);
  if (!e) notFound();

  // Har bir hujjat turi bo'yicha eng oxirgi yozuv — qatorlar shundan tuziladi
  const lastDoc = new Map<string, (typeof e.hrDocs)[number]>();
  for (const d of e.hrDocs) if (!lastDoc.has(d.kind)) lastDoc.set(d.kind, d);
  const hrRows: HrDocRow[] = HR_DOCS.map((spec) => {
    const d = lastDoc.get(spec.kind) ?? null;
    return {
      slug: spec.slug, kind: spec.kind, label: spec.label, hint: spec.hint, fields: spec.fields,
      id: d?.id ?? null,
      docDate: d ? isoDate(d.docDate) : null,
      effectiveAt: d?.effectiveAt ? isoDate(d.effectiveAt) : null,
      position: d?.position ?? null,
      salary: d?.salary ? String(d.salary) : null,
      fixedTerm: d?.fixedTerm ?? false,
      termUntil: d?.termUntil ? isoDate(d.termUntil) : null,
      no: d?.no ?? null,
      reason: d?.reason ?? null,
      fileName: d?.fileName ?? null,
      signedAt: d?.signedAt ? dateTime(d.signedAt) : null,
    };
  });
  // Lavozim ro'yxati hamma joyda bir xil: bo'limlar + ishchi lavozimlar + Excel'dan qolganlar
  const work = [...catalog.work, ...catalog.strays];
  const drivers = catalog.drivers;

  // Haydovchi bo'lsa — GPS izidan hisoblangan shu oylik yo'l (yoqilg'i va ish haqi uchun asos)
  let mileage: { meters: number; trips: number } | null = null;
  if (ecoEnabled() && e.ecoUserId) {
    try {
      const m = await eco.mileage();
      mileage = m.drivers.find((d) => d.userId === e.ecoUserId) ?? { meters: 0, trips: 0 };
    } catch { /* ECO o'chiq bo'lsa kartochka baribir ochiladi */ }
  }
  const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

  return (
    <div>
      <PageHeader
        title={e.fullName}
        eyebrow="Xodim kartasi"
        subtitle={e.position}
        back={{ href: "/otdel-kadr?tab=xodimlar", label: "Xodimlar ro'yxati" }}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {e.firedAt ? <Badge color="red">Ishdan bo&apos;shatilgan</Badge> : e.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}
            <LinkButton href={`/employees/${e.id}/varaqa`} variant="secondary"><FileText size={16} /> Shaxsiy varaqa</LinkButton>
            {e.userId !== s.userId && (e.firedAt
              ? <RestoreButton employeeId={e.id} />
              : <DismissButton employeeId={e.id} fullName={e.fullName} />)}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Ma'lumotlari" description="Otdel kadr yuritadi" />
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="shrink-0">
              <EmployeePhotoForm
                employeeId={e.id}
                accept={PHOTO_ACCEPT}
                hasPhoto={!!e.photo}
                // Surat almashganda brauzer eskisini keshdan olmasin (fayl nomi har safar yangi)
                src={`/employees/${e.id}/surat?v=${e.photo ?? ""}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <EmployeeCardForm
                employee={{
                  id: e.id, fullName: e.fullName, position: e.position, phone: e.phone, note: e.note,
                  tabelNo: e.tabelNo, subdivision: e.subdivision,
                  tariffRate: e.tariffRate ? String(e.tariffRate) : null,
                  hiredAt: e.hiredAt ? isoDate(e.hiredAt) : null,
                  firedAt: e.firedAt ? isoDate(e.firedAt) : null,
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
                work={[...new Set([...work, ...drivers])]}
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
            ...(mileage ? [{ k: "Shu oyda yurgan", v: mileage.meters > 0
              ? <><span className="font-medium text-slate-900">{km(mileage.meters)}</span> <span className="text-slate-500">· {mileage.trips} reys</span></>
              : <span className="text-slate-400">GPS yozuvi yo&apos;q</span> }] : []),
            ...(e.vehicle ? [{ k: "Texnikasi", v: <>{e.vehicle.plate}{e.vehicle.capacityM3 ? ` · ${qty(e.vehicle.capacityM3)} m³` : ""}</> }] : []),
            ...(e.licenseNo || e.licenseCategory ? [{ k: "Guvohnoma", v: `${e.licenseNo ?? "—"}${e.licenseCategory ? ` · ${e.licenseCategory}` : ""}` }] : []),
            ...(e.licenseExpiry ? [{ k: "Guvohnoma muddati", v: licenseDaysLeft(e.licenseExpiry) < 30 ? <span className="text-red-600">{date(e.licenseExpiry)}</span> : date(e.licenseExpiry) }] : []),
            { k: "Brigada boshlig'i", v: e._count.brigades },
            { k: "Kartaga kiritilgan", v: dateTime(e.createdAt) },
            ...(e.tabelNo ? [{ k: "Tabel №", v: e.tabelNo }] : []),
            ...(e.subdivision ? [{ k: "Bo'lim / brigada", v: e.subdivision }] : []),
            ...(e.tariffRate ? [{ k: "Tarif stavka", v: money(e.tariffRate) }] : []),
            { k: "Ishga kirgan", v: e.hiredAt ? date(e.hiredAt) : "—" },
            ...(e.firedAt ? [{ k: "Ishdan bo'shagan", v: <span className="text-red-600">{date(e.firedAt)}</span> }] : []),
            ...(e.firedReason ? [{ k: "Bo'shatish sababi", v: e.firedReason }] : []),
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
            <CardHeader
              title="Kadr hujjatlari"
              description="Ariza, anketa, mehnat shartnomasi, tilxat, moddiy javobgarlik, buyruq va bo'shatish arizasi — tizimda to'ldiriladi, chop etiladi, imzolangan nusxasi qaytib yuklanadi."
              icon={FileSignature}
            />
          </div>
          <HrDocsPanel
            employeeId={e.id}
            rows={hrRows}
            defaults={{
              today: isoDate(),
              hiredAt: e.hiredAt ? isoDate(e.hiredAt) : null,
              firedAt: e.firedAt ? isoDate(e.firedAt) : null,
              position: e.position,
              nextNo: nextOrderNo(orderNos.map((x) => x.no)),
            }}
            positions={[...new Set([...work, ...drivers])]}
            accept={EMPLOYEE_ACCEPT}
          />
        </Card>

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
