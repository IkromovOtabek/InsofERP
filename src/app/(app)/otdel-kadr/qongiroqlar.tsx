import Link from "next/link";
import { FileSpreadsheet, PhoneCall, Search } from "lucide-react";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { dayUtc, isoDay, monthDays, monthOf, monthTitle, shiftMonth, today } from "@/lib/davomat";
import { CALL_STATUSES, CALL_STATUS_BADGE, CALL_STATUS_LABEL } from "@/lib/hr/labels";
import { formatPhone } from "@/lib/phone";
import { isoDate, time } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, Empty, Input, LinkButton, Select, Table, Th } from "@/components/ui";
import type { HrCallStatus, Prisma } from "@/generated/prisma";
import { CallForm, CallRow, type CallRowData } from "./qongiroq-forms";

const isStatus = (v: string | undefined): v is HrCallStatus => !!v && (CALL_STATUSES as string[]).includes(v);

/**
 * «Qo'ng'iroqlar jurnali» — ishga so'rab telefon qilganlar bilan gaplashuv daftari (HR'ning Excel jurnali o'rniga).
 * Sukut — tanlangan oy; qidiruv (telefon, ism, manzil) butun jurnal bo'yicha.
 */
export async function QongiroqTab({ s, month, q, suhbat, lavozim, workPositions }: {
  s: Session; month: string; q: string; suhbat?: string; lavozim: string; workPositions: string[];
}) {
  const editable = canDo(s, "employees", "calls", ["HR"]);
  const canHire = canDo(s, "employees", "create", ["HR"]);
  const now = today();
  const days = monthDays(month);
  const range = { gte: dayUtc(days[0].iso), lte: dayUtc(days[days.length - 1].iso) };
  const status = isStatus(suhbat) ? suhbat : null;

  const text = q.trim();
  const digits = text.replace(/\D/g, "");
  const where: Prisma.HrCallLogWhereInput = {
    ...(text
      ? { OR: [
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          { fullName: { contains: text, mode: "insensitive" as const } },
          { address: { contains: text, mode: "insensitive" as const } },
          { reason: { contains: text, mode: "insensitive" as const } },
        ] }
      : { date: range }),
    ...(status && { status }),
    ...(lavozim && { position: lavozim }),
  };

  const [rows, monthStats, usedPositions, visits] = await Promise.all([
    db.hrCallLog.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "asc" }], take: 2000 }),
    db.hrCallLog.groupBy({ by: ["status"], where: { date: range }, _count: true }),
    db.hrCallLog.groupBy({ by: ["position"], _count: true, orderBy: { position: "asc" } }),
    db.hrCallLog.findMany({ where: { status: "WAITING", visitDate: dayUtc(now) }, orderBy: { createdAt: "asc" } }),
  ]);

  // Takror qo'ng'iroq: shu telefonning nechanchi qo'ng'irog'i (butun jurnal bo'yicha, sana tartibida)
  const phones = [...new Set(rows.map((r) => r.phone).filter((p): p is string => !!p))];
  const history = phones.length
    ? await db.hrCallLog.findMany({ where: { phone: { in: phones } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { id: true, phone: true } })
    : [];
  const ordinal = new Map<string, number>();
  const counter = new Map<string, number>();
  for (const h of history) { const n = (counter.get(h.phone!) ?? 0) + 1; counter.set(h.phone!, n); ordinal.set(h.id, n); }

  const statCount = new Map(monthStats.map((x) => [x.status, Number(x._count)]));
  const monthTotal = monthStats.reduce((n, x) => n + Number(x._count), 0);
  const positions = [...new Set([...workPositions, ...usedPositions.map((p) => p.position)])].sort((a, b) => a.localeCompare(b));

  const data: CallRowData[] = rows.map((r) => ({
    id: r.id, date: isoDay(r.date), position: r.position, phone: r.phone, fullName: r.fullName, address: r.address,
    age: r.age, status: r.status, visitDate: r.visitDate ? isoDay(r.visitDate) : null, reason: r.reason,
    time: isoDate(r.createdAt) === isoDay(r.date) ? time(r.createdAt) : null,
  }));
  const cols = editable ? 10 : 9;
  const href = (p: Record<string, string | undefined>) => {
    const sp = new URLSearchParams({ tab: "qongiroqlar" });
    for (const [k, v] of Object.entries({ oy: month, suhbat: status ?? undefined, lavozim: lavozim || undefined, q: text || undefined, ...p })) if (v) sp.set(k, v);
    return `/otdel-kadr?${sp}`;
  };
  const filtering = !!(text || status || lavozim);

  return (
    <div className="space-y-4">
      {visits.length > 0 && (
        <Callout tone="warning" title={`Bugun suhbatga keladi: ${visits.length} kishi`}>
          {visits.map((v) => (
            <div key={v.id}>
              {v.fullName ?? "Ismsiz"} · {v.phone ? formatPhone(v.phone) : "telefonsiz"} · {v.position}
              {v.reason && <span className="text-amber-800/80"> — {v.reason}</span>}
            </div>
          ))}
        </Callout>
      )}

      {editable && (
        <Card>
          <CardHeader
            title="Yangi qo'ng'iroq"
            info="Ishga so'rab telefon qilgan odam bilan gaplashuv. Raqam oldin qo'ng'iroq qilgan bo'lsa — oldingi yozuvlari chiqadi."
            icon={PhoneCall}
            action={<LinkButton href="/otdel-kadr/qongiroqlar/import" variant="secondary"><FileSpreadsheet size={16} /> Excel orqali qo&apos;shish</LinkButton>}
          />
          <CallForm positions={positions} today={now} />
        </Card>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href({ oy: shiftMonth(month, -1) })} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">← {monthTitle(shiftMonth(month, -1))}</Link>
            <h2 className="text-base font-semibold">{monthTitle(month)}</h2>
            {month < monthOf(now) && <Link href={href({ oy: shiftMonth(month, 1) })} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">{monthTitle(shiftMonth(month, 1))} →</Link>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <span className="font-medium text-slate-900">{monthTotal} ta qo&apos;ng&apos;iroq:</span>
            {CALL_STATUSES.map((k) => (
              <Link key={k} href={href({ suhbat: status === k ? "" : k, q: "" })} className={status === k ? "rounded-full ring-2 ring-slate-300" : ""}>
                <Badge color={CALL_STATUS_BADGE[k]}>{CALL_STATUS_LABEL[k]} {statCount.get(k) ?? 0}</Badge>
              </Link>
            ))}
          </div>
        </div>

        <form action="/otdel-kadr" className="grid grid-cols-1 items-end gap-2 border-b border-slate-100 px-4 py-3 sm:grid-cols-[1fr_190px_220px_auto]">
          <input type="hidden" name="tab" value="qongiroqlar" />
          <input type="hidden" name="oy" value={month} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Qidiruv (butun jurnal)</span>
            <Input name="q" type="search" aria-label="Qo'ng'iroqlarni qidirish" defaultValue={text} placeholder="Telefon, ism, manzil yoki izoh" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Suhbat</span>
            <Select name="suhbat" defaultValue={status ?? ""}>
              <option value="">Hammasi</option>
              {CALL_STATUSES.map((k) => <option key={k} value={k}>{CALL_STATUS_LABEL[k]}</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Lavozim</span>
            <Select name="lavozim" defaultValue={lavozim}>
              <option value="">Hammasi</option>
              {usedPositions.map((p) => <option key={p.position} value={p.position}>{p.position} ({Number(p._count)})</option>)}
            </Select>
          </label>
          <div className="flex items-center gap-3">
            <Button variant="secondary"><Search size={16} /> Qidirish</Button>
            {filtering && <Link href={`/otdel-kadr?tab=qongiroqlar&oy=${month}`} className="text-sm text-slate-500 hover:text-slate-900">Tozalash</Link>}
          </div>
          {filtering && <p className="text-xs text-slate-500 sm:col-span-4">Topildi: {data.length} ta{text ? " (barcha oylar bo'yicha)" : ""}</p>}
        </form>

        <Table>
          <thead>
            <tr>
              {(["Sana", "Lavozim", "№", "Telefon", "Ismi", "Manzil", "Yosh", "Suhbat", "Sababi / izoh"] as const).map((h) => (
                <Th key={h} right={h === "№" || h === "Yosh"} className="px-3">{h}</Th>
              ))}
              {editable && <Th className="px-3" />}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && <Empty icon={filtering ? Search : PhoneCall} text={filtering ? "Bu qidiruv bo'yicha qo'ng'iroq topilmadi" : "Bu oyda qo'ng'iroq yozilmagan"} />}
            {data.map((r, i) => {
              const first = i === 0 || data[i - 1].date !== r.date;
              let no = 1;
              for (let j = i - 1; j >= 0 && data[j].date === r.date; j--) no++;
              return (
                <CallRow
                  key={r.id} row={r} no={no} first={first} times={ordinal.get(r.id) ?? 1} cols={cols}
                  editable={editable} canHire={canHire} positions={positions} today={now}
                />
              );
            })}
          </tbody>
        </Table>
      </Card>
      {!editable && <Callout tone="info">Qo&apos;ng&apos;iroqlar jurnalini otdel kadr yozadi</Callout>}
    </div>
  );
}
