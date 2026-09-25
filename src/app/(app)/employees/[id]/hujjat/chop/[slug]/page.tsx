import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { HIRING_DOCS, HIRING_SLUG, HR_DOC_BY_SLUG } from "@/lib/hr-docs";
import { PrintButton } from "@/components/print-button";
import { AutoPrint } from "@/components/auto-print";
import { DOC_COMPONENTS, type DocProps } from "./documents";

/**
 * Kadr hujjatini chop etish: /employees/[id]/hujjat/chop/[slug]
 *
 *  · slug — hujjat turi (`ariza`, `shartnoma`, …) yoki `toplam` (ishga qabul to'plami);
 *  · `?doc=<id>` — aniq bir tayyorlangan yozuvni chiqaradi (bo'lmasa — oxirgisi);
 *  · `?print=1` — oyna o'zi chop etish muloqotini ochadi.
 *
 * Yozuv topilmasa bo'sh blanka chiqadi — qo'lda to'ldirish uchun ham ishlatsa bo'ladi.
 */
export default async function HrDocPrintPage({ params, searchParams }: {
  params: Promise<{ id: string; slug: string }>;
  searchParams: Promise<{ doc?: string; print?: string }>;
}) {
  await requireSession(["HR"]);
  const { id, slug } = await params;
  const { doc, print } = await searchParams;

  const bundle = slug === HIRING_SLUG;
  const spec = bundle ? null : HR_DOC_BY_SLUG.get(slug);
  if (!bundle && !spec) notFound();

  const kinds = bundle ? HIRING_DOCS.map((s) => s.kind) : [spec!.kind];
  const [e, company, records] = await Promise.all([
    db.employee.findUnique({ where: { id } }),
    getCompany(),
    db.hrDocument.findMany({
      where: doc && !bundle ? { id: doc, employeeId: id } : { employeeId: id, kind: { in: kinds } },
      orderBy: { docDate: "desc" },
    }),
  ]);
  if (!e) notFound();

  // Har bir tur bo'yicha eng oxirgi yozuv (`?doc=` berilgan bo'lsa — o'sha)
  const latest = new Map<string, (typeof records)[number]>();
  for (const r of records) if (!latest.has(r.kind)) latest.set(r.kind, r);

  const sheets = (bundle ? HIRING_DOCS : [spec!]).map((s) => ({
    slug: s.slug,
    label: s.label,
    Doc: DOC_COMPONENTS[s.slug] as (p: DocProps) => React.ReactNode,
    d: latest.get(s.kind) ?? null,
  }));

  const title = bundle ? "Ishga qabul to'plami" : spec!.label;

  return (
    <div className="print:m-0 print:p-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm }
          aside, nav, header { display: none !important }
          body { background: #fff }
          .doc-sheet { break-after: page }
          .doc-sheet:last-of-type, .doc-sheet.doc-last:last-of-type { break-after: auto }
        }
      `}</style>
      <AutoPrint enabled={print === "1"} />

      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <div className="text-xs text-slate-500">
            <Link href={`/employees/${e.id}`} className="hover:underline">{e.fullName}</Link> · kadr hujjati
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        </div>
        <PrintButton />
      </div>

      {sheets.every((s) => !s.d) && (
        <div className="mx-auto mb-4 max-w-[210mm] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          Bu hujjat hali tayyorlanmagan — bo&apos;sh blanka chiqdi. Sana, lavozim va boshqa maydonlar
          to&apos;ldirilib chiqishi uchun xodim kartasidagi <b>Kadr hujjatlari</b> bo&apos;limidan
          &laquo;Tayyorlash&raquo; tugmasini bosing.
        </div>
      )}

      <div>
        {sheets.map(({ slug: s, Doc, d }) => <Doc key={s} e={e} c={company} d={d} />)}
      </div>
    </div>
  );
}
