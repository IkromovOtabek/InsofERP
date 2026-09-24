import Link from "next/link";
import { FileSpreadsheet, PencilLine, ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Card, Field, PageHeader, Select } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { importMaterials } from "../../actions";
import { MaterialsForm, type MaterialOpt } from "../materials-form";
import { cn } from "@/lib/utils";

const MODES = [
  { key: "excel", label: "Excel orqali", icon: FileSpreadsheet, text: "9 ta ustun: nomi, kodi, birlik, qoldiq, narx, minimal, papka, NDS, summa. Faylingizda boshqa ustun bo'lsa — «+ Ustun qo'shish» bilan nomini yozib qo'shasiz. Bir xil qatorlar birlashtirilib miqdorlari qo'shiladi; NDS va summa faylda bo'lmasa o'zi hisoblanadi." },
  { key: "manual", label: "Qo'lda kiritish", icon: PencilLine, text: "Nomini yozganda mavjud xomashyolar chiqadi (yoki «…» tugmasi orqali tanlaysiz) — kodi, birligi va narxi o'zi to'ladi. Pastdan qator qo'shasiz." },
] as const;

/** Sklad → Xomashyo qo'shish: Excel yoki qo'lda. Xomashyo ro'yxati + boshlang'ich qoldiq; retseptlar shu xomashyolarga tayanadi. */
export default async function StockMaterialsNew({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  const { mode } = await searchParams;
  const [warehouses, materials, groups, costs, accounts] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, minStock: true, groupId: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    // Oxirgi narx sifatida kirim/boshlang'ich qoldiqlarning o'rtacha birlik narxi olinadi
    db.stockMove.groupBy({ by: ["materialId"], where: { type: { in: ["RECEIPT", "ADJUSTMENT"] }, unitCost: { not: null }, materialId: { not: null } }, _avg: { unitCost: true } }),
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }),
  ]);
  const avg = new Map(costs.map((c) => [c.materialId, Number(c._avg.unitCost ?? 0)]));
  const existing: MaterialOpt[] = materials.map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, price: avg.get(m.id) ?? 0, minStock: Number(m.minStock), groupId: m.groupId }));
  const current = MODES.find((m) => m.key === mode)?.key;
  const whSelect = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Qoldiq qaysi skladga yoziladi *">
        <Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
      </Field>
      {/* Qo'shilgan xomashyo summasi shu hisobdan chiqim bo'lib Kirim-Chiqimga tushadi */}
      <Field label="Qaysi hisobdan to'landi" hint="Jami summa shu hisobdan chiqim bo'lib yoziladi. Xomashyo allaqachon to'langan bo'lsa — «Hisobga olinmasin»">
        <Select name="cashAccountId" defaultValue={accounts.find((a) => a.type === "CASH")?.id ?? ""}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === "CASH" ? " (naqd)" : " (o'tkazma)"}</option>)}
          <option value="">Hisobga olinmasin</option>
        </Select>
      </Field>
    </div>
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
            example={{ name: "Sement M400", code: "CEM400", unit: "kg", qty: 20000, price: 1200, minStock: 5000, group: "Sement", nds: 2880000, sum: 24000000 }}
            amountCols={{ qtyKey: "qty", priceKey: "price", sumKey: "sum", ndsKey: "nds", rate: 0.12, fill: true }}
            merge={{ sum: ["qty", "nds", "sum"], unitKeys: ["unit"] }}
            allowExtra
            fields={[
              { key: "name", label: "Nomi", required: true, synonyms: FIELD_SYNONYMS.material },
              { key: "code", label: "Kodi", hint: "bo'sh bo'lsa nomdan yasaladi", synonyms: ["kod", "code", "код", "artikul", "артикул"] },
              { key: "unit", label: "Birlik", hint: "letr/тн/metir kabi yozuvlar o'zi tarjima qilinadi", synonyms: FIELD_SYNONYMS.unit },
              { key: "qty", label: "Qoldiq", hint: "boshlang'ich qoldiq (ixtiyoriy)", synonyms: ["qoldiq", "остаток", ...FIELD_SYNONYMS.qty] },
              { key: "price", label: "Narx (birlik)", synonyms: FIELD_SYNONYMS.price },
              { key: "minStock", label: "Minimal qoldiq", hint: "kam qolsa signal", synonyms: ["minimal", "min", "минимал", "мин"] },
              { key: "group", label: "Papka", hint: "bo'sh bo'lsa — ro'yxat ildizida; «Inertlar / Qum» — papka ichida papka", synonyms: ["papka", "guruh", "group", "папка", "группа", "kategoriya", "категор", "razdel", "раздел", "bo'lim"] },
              { key: "nds", label: "NDS", hint: "faylda bo'lmasa 12% hisoblanadi", synonyms: FIELD_SYNONYMS.nds },
              { key: "sum", label: "Summa", hint: "faylda bo'lmasa qoldiq × narx", synonyms: FIELD_SYNONYMS.sum },
            ]}
          >
            {whSelect}
          </ExcelImport>
        </Card>
      )}

      {current === "manual" && <Card><MaterialsForm existing={existing} groups={groups} canCreate={["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "DIRECTOR"].includes(s.role)}>{whSelect}</MaterialsForm></Card>}
    </div>
  );
}
