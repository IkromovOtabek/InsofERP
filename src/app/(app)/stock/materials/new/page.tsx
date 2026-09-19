import Link from "next/link";
import { FileSpreadsheet, PencilLine, ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Card, Field, PageHeader, Select } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { importMaterials } from "../../actions";
import { MaterialsForm } from "../materials-form";
import { cn } from "@/lib/utils";

const MODES = [
  { key: "excel", label: "Excel orqali", icon: FileSpreadsheet, text: "Xomashyo ro'yxati fayldan: nomi, kodi, birlik, qoldiq, narx, minimal. Yuzlab qator bir vaqtda." },
  { key: "manual", label: "Qo'lda kiritish", icon: PencilLine, text: "Bir nechta qatorni jadvalga yozib saqlaysiz." },
] as const;

/** Sklad → Xomashyo qo'shish: Excel yoki qo'lda. Xomashyo ro'yxati + boshlang'ich qoldiq; retseptlar shu xomashyolarga tayanadi. */
export default async function StockMaterialsNew({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  const { mode } = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { isActive: true } });
  const current = MODES.find((m) => m.key === mode)?.key;
  const whSelect = (
    <Field label="Qoldiq qaysi skladga yoziladi *" className="max-w-xs">
      <Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
    </Field>
  );

  return (
    <div>
      <PageHeader back={{ href: "/stock", label: "Sklad" }} title="Xomashyo qo'shish" subtitle="Skladdagi xomashyo ro'yxati va qoldig'i. Retseptlar shu xomashyolardan tuziladi, ishlab chiqarish imkoni qoldiqqa qarab hisoblanadi." />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map((m) => (
          <Link key={m.key} href={`/stock/materials/new?mode=${m.key}`}
            className={cn("flex items-start gap-3 rounded-(--radius-card) border p-4 transition", current === m.key ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900" : "border-slate-200 bg-white hover:border-slate-400")}>
            <span className={cn("rounded-lg p-2", current === m.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}><m.icon size={18} /></span>
            <span><span className="block font-semibold text-slate-900">{m.label}</span><span className="block text-xs text-slate-500">{m.text}</span></span>
          </Link>
        ))}
      </div>

      {!current && <p className="text-sm text-slate-500"><ArrowLeft size={14} className="inline" /> Yuqoridan usulni tanlang.</p>}

      {current === "excel" && (
        <Card>
          <ExcelImport
            action={importMaterials}
            submitLabel="Xomashyolarni qo'shish"
            templateName="xomashyo-namuna"
            example={{ name: "Sement M400", code: "CEM400", unit: "kg", qty: 20000, price: 1200, minStock: 5000 }}
            fields={[
              { key: "name", label: "Nomi", required: true, synonyms: FIELD_SYNONYMS.material },
              { key: "code", label: "Kodi", hint: "bo'sh bo'lsa nomdan yasaladi", synonyms: ["kod", "code", "код", "artikul", "артикул"] },
              { key: "unit", label: "Birlik", hint: "kg, t, l, m3, dona", synonyms: FIELD_SYNONYMS.unit },
              { key: "qty", label: "Qoldiq", hint: "boshlang'ich qoldiq (ixtiyoriy)", synonyms: ["qoldiq", "остаток", ...FIELD_SYNONYMS.qty] },
              { key: "price", label: "Narx (birlik)", synonyms: FIELD_SYNONYMS.price },
              { key: "minStock", label: "Minimal qoldiq", hint: "kam qolsa signal", synonyms: ["minimal", "min", "минимал", "мин"] },
            ]}
          >
            {whSelect}
          </ExcelImport>
        </Card>
      )}

      {current === "manual" && <Card><MaterialsForm>{whSelect}</MaterialsForm></Card>}
    </div>
  );
}
