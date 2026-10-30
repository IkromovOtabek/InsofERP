import Link from "next/link";
import { HardHat, Users } from "lucide-react";
import { markOf } from "@/lib/davomat";
import type { ProductionStaff } from "@/lib/production-staff";
import { Badge, Card, Callout } from "@/components/ui";
import { AssignSelect } from "../dashboard/production-forms";
import { AddMemberSelect } from "./forms";

type Emp = { id: string; fullName: string; position: string; brigadeId: string | null };

/**
 * «Xodimlar» tabi: har brigada — karta, ichida a'zolari. Xodimning brigadasi o'zgartirilsa yoki «+ Xodim qo'shish»dan
 * tanlansa darhol saqlanadi (`assignStaff` → `lib/production-staff.ts`; ruxsat `production` → `staff`).
 * Sex tarkibi, davomat va sdelka fondining bo'linishi shu biriktirishdan olinadi.
 */
export function BrigadeStaffView({ staff, employees, canEdit }: { staff: ProductionStaff; employees: Emp[]; canEdit: boolean }) {
  const brigadeName = new Map(staff.brigades.map((b) => [b.id, b.name]));
  const optionsFor = (bid: string) => employees
    .filter((e) => e.brigadeId !== bid)
    .map((e) => ({ id: e.id, label: `${e.fullName} · ${e.position}${e.brigadeId && brigadeName.has(e.brigadeId) ? ` (hozir: ${brigadeName.get(e.brigadeId)})` : ""}` }));
  return (
    <div className="space-y-3">
      {!canEdit && <Callout tone="info">Xodimlarni brigadaga direktor yoki ish boshqaruvchi taqsimlaydi — sizda faqat ko&apos;rish.</Callout>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {staff.groups.map((g) => (
          <Card key={g.id ?? "none"} className={g.id ? "" : "border-amber-200"}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${g.id ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-600"}`}>{g.id ? <HardHat size={16} /> : <Users size={16} />}</div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{g.name}</div>
                  <div className="text-xs text-slate-500">{g.total} xodim · bugun keldi {g.present}</div>
                </div>
              </div>
              {g.id && <Link href={`/tasks?brigade=${g.id}`} className="shrink-0 text-xs text-slate-500 hover:text-slate-900">Topshiriqlar</Link>}
            </div>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {g.members.map((m) => {
                const st = m.status ? markOf(m.status) : null;
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.fullName}{m.leads && <span className="ml-2"><Badge color="blue">brigadir</Badge></span>}</div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">{m.position}{st && <Badge color={st.color}>{st.label}</Badge>}</div>
                    </div>
                    {canEdit && <div className="w-full sm:w-48"><AssignSelect employeeId={m.id} brigadeId={m.brigadeId} brigades={staff.brigades} /></div>}
                  </li>
                );
              })}
              {g.members.length === 0 && <li className="py-2 text-xs text-slate-400">Xodim biriktirilmagan</li>}
            </ul>
            {canEdit && g.id && <div className="mt-2 border-t border-slate-100 pt-3"><AddMemberSelect brigadeId={g.id} employees={optionsFor(g.id)} /></div>}
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-500">Brigadasi o&apos;zgartirilgan xodim sex davomatida yangi brigadada ko&apos;rinadi; sdelka fondi a&apos;zolarga ishlagan soati bo&apos;yicha bo&apos;linadi.</p>
    </div>
  );
}
