import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { date, dateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import { PrintButton } from "@/components/print-button";
import { AutoPrint } from "@/components/auto-print";

/**
 * Xodimning shaxsiy varaqasi (kadr hisobi bo'yicha T-2 ga yaqin).
 * Brauzerdan chop etiladi yoki PDF qilib saqlanadi; `?print=1` bilan oyna o'zi ochiladi.
 */
export default async function EmployeeSheetPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  await requireSession(["HR"]);
  const { id } = await params;
  const { print } = await searchParams;
  const [e, company] = await Promise.all([
    db.employee.findUnique({ where: { id }, include: { user: true, documents: { orderBy: { createdAt: "asc" } } } }),
    getCompany(),
  ]);
  if (!e) notFound();

  const rows: [string, string][] = [
    ["Lavozimi", e.position],
    ["Telefon", e.phone ?? "—"],
    ["Tug'ilgan sana", e.birthDate ? date(e.birthDate) : "—"],
    ["Ishga kirgan sana", e.hiredAt ? date(e.hiredAt) : "—"],
    ["Ma'lumoti", e.education ?? "—"],
    ["Oilaviy holati", e.maritalStatus ?? "—"],
    ["Yashash manzili", e.address ?? "—"],
    ["Passport", e.passportSeries ?? "—"],
    ["JSHSHIR (PINFL)", e.pinfl ?? "—"],
    ["Passportni bergan", [e.passportIssuedBy, e.passportIssuedAt ? date(e.passportIssuedAt) : null].filter(Boolean).join(", ") || "—"],
    ["Tizimdagi login", e.user ? `${e.user.login} · ${ROLE_LABELS[e.user.role]}` : "yo'q"],
  ];

  return (
    <div className="paper mx-auto max-w-3xl rounded-sm bg-white p-8 text-[13px] text-black print:max-w-none print:rounded-none print:p-4 print:shadow-none">
      <style>{`@media print { @page { size: A4; margin: 14mm } aside, nav { display: none } body { background: #fff } }`}</style>
      <AutoPrint enabled={print === "1"} />

      <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider">{company.legalName || company.name}{company.inn ? ` · INN ${company.inn}` : ""}</div>
          <div className="mt-1 text-xl font-bold">XODIMNING SHAXSIY VARAQASI</div>
          <div className="mt-1 text-[12px]">Tuzilgan sana: {dateTime(new Date())}</div>
        </div>
        <div className="h-[150px] w-[120px] shrink-0 overflow-hidden border border-black">
          {e.photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`/employees/${e.id}/surat`} alt={e.fullName} className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-center text-[10px] text-slate-500">3x4<br />surat</div>}
        </div>
      </div>

      <div className="mt-4 text-lg font-semibold">{e.fullName}</div>

      <table className="mt-3 w-full border-collapse">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-slate-300">
              <td className="w-56 py-1.5 pr-3 align-top text-slate-600">{k}</td>
              <td className="py-1.5 font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5">
        <div className="mb-2 font-semibold">Topshirilgan hujjat nusxalari</div>
        {e.documents.length === 0 ? (
          <div className="text-slate-600">Hujjat nusxasi yuklanmagan.</div>
        ) : (
          <table className="w-full border-collapse border border-slate-400">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-400 px-2 py-1 text-left">#</th>
                <th className="border border-slate-400 px-2 py-1 text-left">Hujjat turi</th>
                <th className="border border-slate-400 px-2 py-1 text-left">Fayl</th>
                <th className="border border-slate-400 px-2 py-1 text-left">Qabul qilingan</th>
              </tr>
            </thead>
            <tbody>
              {e.documents.map((d, i) => (
                <tr key={d.id}>
                  <td className="border border-slate-400 px-2 py-1">{i + 1}</td>
                  <td className="border border-slate-400 px-2 py-1">{d.kind}</td>
                  <td className="border border-slate-400 px-2 py-1">{d.fileName}</td>
                  <td className="border border-slate-400 px-2 py-1">{date(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {e.note && (
        <div className="mt-4">
          <div className="font-semibold">Izoh</div>
          <div className="mt-1 whitespace-pre-wrap">{e.note}</div>
        </div>
      )}

      <div className="mt-10 grid grid-cols-2 gap-10">
        {["Xodim (imzo)", "Otdel kadr (imzo)"].map((l) => (
          <div key={l}>
            <div className="h-8 border-b border-black" />
            <div className="mt-1 text-[11px] text-slate-600">{l}</div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-slate-500 print:hidden">
        Hujjat nusxalari tizimda saqlanadi — xodim kartasidan ochib ko&apos;rish mumkin. Chop etishda faqat ro&apos;yxat chiqadi.
      </p>
      <div className="mt-4 print:hidden"><PrintButton /></div>
    </div>
  );
}
