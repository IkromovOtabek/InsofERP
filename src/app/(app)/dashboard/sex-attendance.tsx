import { HardHat, ScanFace, UserCog, Users } from "lucide-react";
import { markOf, dayTitle } from "@/lib/davomat";
import type { ProductionDay } from "@/lib/production-day";
import { Badge, Card, Empty, LinkButton, Progress, Td, Th, Tr } from "@/components/ui";
import { MarkAllButton, StaffMark } from "./production-forms";

/**
 * Sex xodimlari va bugungi davomat: brigadalar bo'yicha keldi / jami, lavozimlar va belgilash jadvali.
 * Bosh sahifadagi «Ishga keldi» kartasi bosilganda ochiladigan `/dashboard/sex` sahifasida turadi.
 */
export function SexAttendance({ d, canStaff, isDirector }: { d: ProductionDay; canStaff: boolean; isDirector: boolean }) {
  const presentCount = d.attendance.present.length;
  const iso = d.iso;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{canStaff && <LinkButton href="/brigades?tab=xodimlar" variant="secondary" size="sm"><UserCog size={14} /> Xodimlarni taqsimlash</LinkButton>}{!isDirector && <MarkAllButton left={d.attendance.notMarked.length} />}</div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <div className="flex items-center gap-2 text-sm font-medium"><HardHat size={15} className="text-slate-400" /> Brigadalar bo&apos;yicha · keldi / jami</div>
          <ul className="mt-3 space-y-2 text-sm">
            {d.staff.groups.map((g) => (
              <li key={g.id ?? "none"}>
                <div className="flex justify-between"><span className={g.id ? "text-slate-600" : "text-amber-700"}>{g.name}</span><span className="font-medium tabular">{g.present} / {g.total}</span></div>
                <Progress value={g.present} max={Math.max(g.total, 1)} tone={g.total && g.present === g.total ? "success" : "default"} />
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold"><span>Jami sexda</span><span className="tabular">{presentCount} / {d.staff.total}</span></div>
          {d.staff.unassigned > 0 && (
            <p className="mt-2 text-xs text-amber-700">{d.staff.unassigned} kishi brigadaga taqsimlanmagan{canStaff ? " — «Xodimlarni taqsimlash» dan biriktiring." : " — direktor taqsimlaydi."}</p>
          )}
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Lavozim bo&apos;yicha</div>
          <ul className="mt-2 space-y-1 text-sm">
            {d.staff.byPosition.map(([pos, n]) => (
              <li key={pos} className="flex justify-between"><span className="text-slate-600">{pos}</span><span className="tabular">{n}</span></li>
            ))}
          </ul>
        </Card>
        <Card className="xl:col-span-2" padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <div className="flex items-center gap-2 text-sm font-medium"><ScanFace size={15} className="text-slate-400" /> Bugungi davomat · {dayTitle(iso)}</div>
            <div className="flex flex-wrap gap-1.5">
              <Badge color="green">Keldi {presentCount}</Badge>
              {d.attendance.absent > 0 && <Badge color="red">Kelmadi {d.attendance.absent}</Badge>}
              {d.attendance.sick > 0 && <Badge color="amber">Kasal {d.attendance.sick}</Badge>}
              {d.attendance.leave > 0 && <Badge color="blue">Ta&apos;til {d.attendance.leave}</Badge>}
              {d.attendance.notMarked.length > 0 && <Badge color="slate">Belgilanmagan {d.attendance.notMarked.length}</Badge>}
            </div>
          </div>
          <p className="px-5 pt-1 text-xs text-slate-400">{isDirector ? "Davomatni sex boshlig'i belgilaydi — otdel kadr tabeliga ham shu yozuv tushadi." : "Belgi bosilsa darhol saqlanadi (Keldi — hozirgi soat bilan). Otdel kadr tabeliga ham tushadi."}</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><Th>Xodim</Th><Th>Brigada</Th><Th>Holat</Th><Th right>Keldi</Th><Th right>Ketdi</Th>{!isDirector && <Th right>Belgilash</Th>}</tr></thead>
              <tbody>
                {[...d.attendance.notMarked, ...d.attendance.present, ...d.attendance.away].map((e) => {
                  const m = e.status ? markOf(e.status) : null;
                  return (
                    <Tr key={e.id}>
                      <Td className={m ? "font-medium" : "text-slate-500"}>{e.fullName}<div className="text-xs font-normal text-slate-400">{e.position}</div></Td>
                      <Td className={e.brigade ? "text-slate-500" : "text-amber-700"}>{e.brigade ?? "taqsimlanmagan"}</Td>
                      <Td>{m ? <Badge color={m.color}>{m.label}</Badge> : <span className="text-xs text-slate-400">belgilanmagan</span>}</Td>
                      <Td right className="tabular">{e.checkIn ?? "—"}</Td>
                      <Td right className="tabular text-slate-500">{e.checkOut ?? "—"}</Td>
                      {!isDirector && <Td right><StaffMark employeeId={e.id} status={e.status} checkedOut={!!e.checkOut} /></Td>}
                    </Tr>
                  );
                })}
                {d.staff.total === 0 && <Empty text={canStaff ? "Sexga xodim taqsimlanmagan — «Xodimlarni taqsimlash» ni oching" : "Sexga xodim taqsimlanmagan — direktorga ayting"} icon={Users} />}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
