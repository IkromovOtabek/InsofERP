"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Eraser, User, UserCheck } from "lucide-react";
import { saveAttendance } from "./davomat-actions";
import { Badge, Button, FormError, Input, Select, Table, Td, Th, Tr, Empty } from "@/components/ui";
import {
  ATTENDANCE_MARKS, DEFAULT_SHIFT, MAX_SHIFT_MINUTES, dayTitle, hoursShort, hoursText, monthOf, shiftDay, today, workedMinutes,
} from "@/lib/davomat";
import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/generated/prisma";

export type KunRow = {
  id: string; fullName: string; position: string; photo: boolean;
  status: AttendanceStatus | null; checkIn: string | null; checkOut: string | null; note: string | null;
  /** Sahifa ochilgandagi yozuv versiyasi (`updatedAt` ISO, yozuv yo'q bo'lsa bo'sh) — boshqa joyda o'zgargan bo'lsa server ustidan yozmaydi. */
  ver: string;
};

type Val = { status: string; checkIn: string; checkOut: string; note: string };

const valOf = (r: KunRow): Val => ({ status: r.status ?? "", checkIn: r.checkIn ?? "", checkOut: r.checkOut ?? "", note: r.note ?? "" });
const initVals = (rows: KunRow[]) => Object.fromEntries(rows.map((r) => [r.id, valOf(r)]));
/** Server saqlaydigan ko'rinish: soat faqat "Keldi" da, izoh bo'shliqsiz — shu bo'yicha o'zgarganmi deb solishtiriladi. */
const norm = (v: Val) => [v.status, v.status === "PRESENT" ? v.checkIn : "", v.status === "PRESENT" ? v.checkOut : "", v.note.trim()].join("|");

const dayHref = (iso: string) => `/otdel-kadr?tab=davomat&kun=${iso}`;

/**
 * Kunlik davomat: bitta forma — har xodimga belgi, kelgan/ketgan vaqt va izoh.
 * Soat vaqtlardan o'zi hisoblanadi, tungi smena (20:00 → 06:00) ham to'g'ri chiqadi.
 */
export function DavomatKun({ iso, rows }: { iso: string; rows: KunRow[] }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, Val>>(() => initVals(rows));
  // Saqlangandan keyin sahifa yangilanadi (router.refresh) — jadval bazadagi joriy holatga qaytadi:
  // boshqa joyda o'zgargani uchun o'tkazib yuborilgan qatorda ham endi yangi qiymat ko'rinadi
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) { setPrevRows(rows); setVals(initVals(rows)); }
  const orig = new Map(rows.map((r) => [r.id, norm(valOf(r))]));
  const isChanged = (id: string) => !!vals[id] && norm(vals[id]) !== orig.get(id);
  const changedCount = rows.filter((r) => isChanged(r.id)).length;
  const [state, act, pending] = useActionState(saveAttendance.bind(null, iso), undefined);
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);

  const set = (id: string, patch: Partial<Val>) => setVals((v) => ({ ...v, [id]: { ...v[id], ...patch } }));

  /** Belgisi yo'qlarning hammasini "Keldi" qiladi — allaqachon belgilanganiga tegmaydi. */
  const fillPresent = () => setVals((v) => Object.fromEntries(Object.entries(v).map(([id, x]) =>
    [id, x.status ? x : { ...x, status: "PRESENT", checkIn: DEFAULT_SHIFT.checkIn, checkOut: DEFAULT_SHIFT.checkOut }])));
  const clearAll = () => setVals((v) => Object.fromEntries(Object.keys(v).map((id) => [id, { status: "", checkIn: "", checkOut: "", note: "" }])));

  const list = Object.values(vals);
  const counts = ATTENDANCE_MARKS.map((m) => ({ ...m, n: list.filter((v) => v.status === m.value).length }));
  const totalMin = list.reduce((n, v) => n + (v.status === "PRESENT" ? workedMinutes(v.checkIn, v.checkOut) ?? 0 : 0), 0);
  const unmarked = list.filter((v) => !v.status).length;
  const isToday = iso === today();

  return (
    <div className="space-y-3">
      {/* ── Kun tanlash ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-slate-200/80 bg-white px-3 py-2.5 shadow-(--shadow-card)">
        <Link href={dayHref(shiftDay(iso, -1))} aria-label="Oldingi kun" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronLeft size={16} /></Link>
        <Input type="date" aria-label="Sana" value={iso} onChange={(e) => e.target.value && router.push(dayHref(e.target.value))} className="h-9 w-[170px]" />
        <Link href={dayHref(shiftDay(iso, 1))} aria-label="Keyingi kun" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronRight size={16} /></Link>
        <span className="ml-1 text-sm font-medium text-slate-700">{dayTitle(iso)}</span>
        {isToday ? <Badge color="green">bugun</Badge> : <Link href={dayHref(today())} className="text-xs font-medium text-slate-500 underline hover:text-slate-900">bugunga qaytish</Link>}

        <div className="ml-auto flex items-center gap-2">
          <Link href={`/otdel-kadr?tab=davomat&oy=${monthOf(iso)}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <CalendarDays size={14} /> Oylik tabel
          </Link>
        </div>
      </div>

      {/* ── Kun yakuni ── */}
      <div className="flex flex-wrap items-center gap-2">
        {counts.map((c) => (
          <span key={c.value} className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset", c.cell)}>
            {c.label} <span className="tabular">{c.n}</span>
          </span>
        ))}
        {unmarked > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-300">Belgilanmagan <span className="tabular">{unmarked}</span></span>}
        <span className="ml-auto text-xs text-slate-500">Jami <span className="font-semibold text-slate-900 tabular">{hoursText(totalMin)}</span></span>
      </div>

      <form action={act}>
        <Table>
          <thead>
            <tr>
              <Th>F.I.O.</Th>
              <Th>Lavozim</Th>
              <Th className="w-[140px]">Belgi</Th>
              <Th className="w-[110px]">Keldi</Th>
              <Th className="w-[110px]">Ketdi</Th>
              <Th right className="w-[80px]">Soat</Th>
              <Th className="w-[180px]">Izoh</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <Empty text="Bu kunga xodim yo'q — ishga kirgan sanalarini tekshiring" />}
            {rows.map((r) => {
              const v = vals[r.id];
              const min = v.status === "PRESENT" ? workedMinutes(v.checkIn, v.checkOut) : null;
              const changed = isChanged(r.id);
              return (
                <Tr key={r.id} className={cn(!v.status && "bg-slate-50/40", changed && "bg-amber-50/50")}>
                  <Td>
                    {/* `<tr>` ichida bevosita `<input>` turolmaydi — yashirin maydon katak ichida.
                        Faqat o'zgartirilgan qator yuboriladi: boshqalar (masalan sex ilovada qo'ygan belgi) tegilmaydi */}
                    {changed && <input type="hidden" name="emp[]" value={r.id} />}
                    {changed && <input type="hidden" name={`ver:${r.id}`} value={r.ver} />}
                    <span className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-400">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.photo ? <img src={`/employees/${r.id}/surat`} alt="" className="h-full w-full object-cover" /> : <User size={14} />}
                      </span>
                      <Link href={`/employees/${r.id}`} className="hover:underline">{r.fullName}</Link>
                    </span>
                  </Td>
                  <Td className="text-xs text-slate-500">{r.position}</Td>
                  <Td>
                    <Select
                      name={`st:${r.id}`} aria-label={`${r.fullName}: davomat belgisi`} value={v.status} className="h-9 text-sm"
                      onChange={(e) => set(r.id, {
                        status: e.target.value,
                        // "Keldi" tanlansa vaqt bo'sh qolmasin; boshqa belgida soat yozilmaydi
                        ...(e.target.value === "PRESENT" && !v.checkIn ? DEFAULT_SHIFT : {}),
                      })}
                    >
                      <option value="">— belgilanmagan</option>
                      {ATTENDANCE_MARKS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    <Input type="time" name={`in:${r.id}`} aria-label={`${r.fullName}: kelgan vaqti`} value={v.checkIn} disabled={v.status !== "PRESENT"}
                      onChange={(e) => set(r.id, { checkIn: e.target.value })} className="h-9 px-2 text-sm" />
                  </Td>
                  <Td>
                    <Input type="time" name={`out:${r.id}`} aria-label={`${r.fullName}: ketgan vaqti`} value={v.checkOut} disabled={v.status !== "PRESENT"}
                      onChange={(e) => set(r.id, { checkOut: e.target.value })} className="h-9 px-2 text-sm" />
                  </Td>
                  <Td right className="text-sm">
                    {min !== null
                      ? <span title={min > MAX_SHIFT_MINUTES ? `${MAX_SHIFT_MINUTES / 60} soatdan uzun — saqlanmaydi, vaqtni tekshiring` : undefined}
                          className={cn("font-semibold", min > MAX_SHIFT_MINUTES ? "text-red-600" : min > 12 * 60 ? "text-amber-600" : "text-slate-900")}>{hoursShort(min)}</span>
                      : <span className="text-slate-300">—</span>}
                  </Td>
                  <Td>
                    <Input name={`nt:${r.id}`} aria-label={`${r.fullName}: izoh`} value={v.note} onChange={(e) => set(r.id, { note: e.target.value })}
                      placeholder={v.status && v.status !== "PRESENT" ? "sababi" : "izoh"} className="h-9 text-sm" />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>

        {/* ── Saqlash paneli ── */}
        <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-slate-200/80 bg-white/95 px-3 py-2.5 shadow-(--shadow-card) backdrop-blur">
          <Button type="button" variant="secondary" size="sm" onClick={fillPresent} disabled={rows.length === 0}>
            <UserCheck size={15} /> Belgilanmaganlar — «Keldi»
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearAll} disabled={rows.length === 0}>
            <Eraser size={15} /> Tozalash
          </Button>
          <span className="text-xs text-slate-500">Standart smena {DEFAULT_SHIFT.checkIn}–{DEFAULT_SHIFT.checkOut}</span>
          <div className="ml-auto flex items-center gap-3">
            {state?.ok && state.note && <span className="text-xs text-emerald-700">{state.note}</span>}
            <Button type="submit" disabled={pending || changedCount === 0}>{pending ? "Saqlanmoqda…" : changedCount ? `Saqlash (${changedCount})` : "Saqlash"}</Button>
          </div>
        </div>
        <FormError error={state?.error} />
      </form>

      <p className="px-1 text-xs text-slate-500">
        Faqat o&apos;zgartirilgan qatorlar (sariq) saqlanadi. Belgi «— belgilanmagan» qilib o&apos;zgartirilsa, o&apos;sha kunlik yozuv o&apos;chadi.
        Sahifa ochilgandan keyin boshqa joyda (sex ilovasi) o&apos;zgargan qator ustidan yozilmaydi.
        Ketish vaqti kelishdan oldin bo&apos;lsa tungi smena deb hisoblanadi: 20:00 → 06:00 = 10 soat.
      </p>
    </div>
  );
}
