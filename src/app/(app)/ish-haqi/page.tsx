import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, FileSpreadsheet, HandCoins, MinusCircle, Settings2, Sheet as SheetIcon, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { date, dateTime, money } from "@/lib/format";
import { dayUtc, monthDays, monthOf, monthTitle, shiftMonth, today } from "@/lib/davomat";
import { canPayroll, listRuns, payrollSettings } from "@/lib/hr/payroll";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Callout, Card, CardHeader, Empty, EmptyState, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { Fold } from "@/components/fold";
import { CalculateForm, PieceRatesForm, SettingsForm } from "./forms";
import { listDebts } from "@/lib/hr/employee-debt";
import { listWorkbooks, loadWorkbook } from "@/lib/payroll-sheets";
import type { SheetData } from "@/lib/sheet-calc";
import { ConfirmButton } from "../payments/confirm-button";
import { cancelEmployeeDebt } from "./actions";
import { cancelWorkbookAction } from "./varaq-actions";
import { SheetGrid } from "./sheet-grid";
import { WorkbookPicker, WorkbookUploadForm } from "./varaq-forms";
import { tabelMonth } from "@/lib/hr/tabel";
import { employeesInWindow } from "@/lib/attendance-report";
import { TabelGrid } from "./tabel-grid";
import { BrigadeSheetGrid } from "./brigade-sheet-grid";
import { brigadeSheet } from "@/lib/hr/brigade-sheet";
import { deductionsMonth, listWithholdings } from "@/lib/hr/deductions";
import { DeductionsGrid } from "./deductions-grid";
import { DeductImport } from "./deduct-import";
import { OpeningDebtForm, WithholdingForm } from "./ushlanma-forms";
import { cancelWithholdingAction } from "./ushlanma-actions";
import { TabelImport } from "./tabel-import";

/**
 * Ish haqi: otdel kadr / buxgalteriya hisoblaydi, direktor tasdiqlaydi, kassir to'laydi (`lib/hr/payroll.ts`).
 * Har vedomost — oy uchun avans, oy yakuni yoki alohida to'lov (xodimning avans arizasi).
 */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ tab?: string; kitob?: string; varaq?: string; oy?: string; guruh?: string }> }) {
  const s = await requirePage("/ish-haqi");
  const sp = await searchParams;
  const month = monthOf(today());
  const canCalc = canPayroll(s, "calc");
  const canSettings = canPayroll(s, "settings");
  const canDebts = canPayroll(s, "debts");
  const canSheets = canPayroll(s, "sheets");
  const canTabel = canPayroll(s, "tabel");
  const canDeduct = canPayroll(s, "deductions");
  // Sekretar: vedomost va sozlamalar ko'rinmaydi — faqat Tabel, «Oylik varaqlari» (Excel kitobi) va «Xodim qarzlari»
  const limited = (canDebts || canSheets || canTabel || canDeduct) && !canCalc && !canSettings && !["HR", "ACCOUNTING", "FINANCE", "CASHIER", "DIRECTOR", "SUPERADMIN"].includes(s.role);
  const keys = limited
    ? [...(canTabel ? ["tabel"] : []), ...(canDeduct ? ["ushlanmalar"] : []), ...(canSheets ? ["varaqlar"] : []), ...(canDebts || canDeduct ? ["qarzlar"] : [])]
    : ["vedomostlar", ...(canTabel ? ["tabel"] : []), ...(canDeduct ? ["ushlanmalar"] : []), ...(canSheets ? ["varaqlar"] : []), ...(canDebts || canDeduct ? ["qarzlar"] : []), "sozlamalar"];
  const tab = keys.includes(sp.tab ?? "") ? sp.tab! : keys[0];
  const debts = tab === "qarzlar" ? await listDebts() : [];
  const tabItems = [
    { key: "vedomostlar", label: "Vedomostlar", href: "/ish-haqi", icon: Wallet },
    { key: "tabel", label: "Tabel", href: "/ish-haqi?tab=tabel", icon: CalendarDays },
    { key: "ushlanmalar", label: "Ushlanmalar", href: "/ish-haqi?tab=ushlanmalar", icon: MinusCircle },
    { key: "varaqlar", label: "Oylik varaqlari", href: "/ish-haqi?tab=varaqlar", icon: SheetIcon },
    { key: "qarzlar", label: "Xodim qarzlari", href: "/ish-haqi?tab=qarzlar", icon: HandCoins },
    { key: "sozlamalar", label: "Sozlamalar", href: "/ish-haqi?tab=sozlamalar", icon: Settings2 },
  ].filter((t) => keys.includes(t.key));
  if (limited) {
    return (
      <div className="space-y-4" {...(tab === "varaqlar" || tab === "tabel" || tab === "ushlanmalar" ? { "data-wide": "" } : {})}>
        {tab === "qarzlar"
          ? <PageHeader title="Xodim qarzlari" info="Kirim-Chiqimda «Hodimlar bilan hisob-kitob» chiqimi «Oylikdan nasiya» bilan yozilsa — qarz shu yerda; har oy yakuni vedomostida ulushi ushlanadi" />
          : <PageHeader title="Ish haqi" info={tab === "tabel" ? TABEL_INFO : tab === "ushlanmalar" ? DEDUCT_INFO : SHEETS_INFO} />}
        {tabItems.length > 1 && <Tabs current={tab} items={tabItems} />}
        {tab === "tabel" ? <TabelTab oy={sp.oy} guruh={sp.guruh} canEdit={canTabel} />
          : tab === "ushlanmalar" ? <DeductionsTab oy={sp.oy} canEdit={canDeduct} />
          : tab === "varaqlar" ? <SheetsTab kitob={sp.kitob} varaq={sp.varaq} canEdit={canSheets} />
          : <><DebtTable debts={debts} canCancel={canDebts} />{canDeduct && <LedgersPanel />}</>}
      </div>
    );
  }

  const [runs, st, products] = await Promise.all([
    listRuns({ take: 80 }),
    payrollSettings(),
    tab === "sozlamalar" ? db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, pieceRate: true } }) : Promise.resolve([]),
  ]);
  const waiting = runs.filter((r) => r.status === "SUBMITTED");
  const toPay = runs.filter((r) => r.status === "APPROVED");
  const thisMonth = runs.filter((r) => r.month === month && r.status !== "CANCELLED");

  if (tab === "varaqlar" || tab === "tabel" || tab === "ushlanmalar") {
    return (
      <div className="space-y-4" data-wide="">
        <PageHeader title="Ish haqi" info={tab === "tabel" ? TABEL_INFO : tab === "ushlanmalar" ? DEDUCT_INFO : SHEETS_INFO} />
        <Tabs current={tab} items={tabItems} />
        {tab === "tabel" ? <TabelTab oy={sp.oy} guruh={sp.guruh} canEdit={canTabel} /> : tab === "ushlanmalar" ? <DeductionsTab oy={sp.oy} canEdit={canDeduct} /> : <SheetsTab kitob={sp.kitob} varaq={sp.varaq} canEdit={canSheets} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Ish haqi" info="Avans va oy yakuni vedomostlari: hisoblash → direktor tasdig'i → kassadan to'lov" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`${monthTitle(month)} — hisoblangan`} value={money(thisMonth.filter((r) => r.kind === "FINAL").reduce((x, r) => x + Number(r.gross), 0))} icon={Wallet} href="/ish-haqi#vedomostlar" />
        <StatCard label="Direktor tasdig'ida" value={String(waiting.length)} tone={waiting.length ? "warning" : "default"} hint={waiting.length ? money(waiting.reduce((x, r) => x + Number(r.net), 0)) : undefined} href={waiting.length === 1 ? `/ish-haqi/${waiting[0].id}` : "/ish-haqi#vedomostlar"} />
        <StatCard label="To'lov kutmoqda" value={String(toPay.length)} tone={toPay.length ? "brand" : "default"} hint={toPay.length ? money(toPay.reduce((x, r) => x + Number(r.net) - Number(r.paid), 0)) : undefined} href={toPay.length === 1 ? `/ish-haqi/${toPay[0].id}` : "/ish-haqi#vedomostlar"} />
        <StatCard label={`${monthTitle(month)} — to'langan`} value={money(thisMonth.reduce((x, r) => x + Number(r.paid), 0))} href="/ish-haqi#vedomostlar" />
      </div>
      <Tabs current={tab} items={tabItems} />

      {tab === "qarzlar" && <DebtTable debts={debts} canCancel={canDebts} />}
      {tab === "qarzlar" && canDeduct && <LedgersPanel />}

      {tab === "vedomostlar" && (
        <>
          {canCalc && (
            <Card>
              <CardHeader title="Hisoblash" info={`Avans — 1–${st.advanceDay} kunlar bo'yicha, oylikning ${st.advancePct}%; oy yakuni — tabel, smena grafigi, ta'til/kasallik, jarima/bonus, soliq va berilgan avanslar bilan`} />
              <CalculateForm month={month} />
            </Card>
          )}
          <Card padded={false}>
            <div id="vedomostlar" className="scroll-mt-20" />
            <Table>
              <thead><tr><Th>Vedomost</Th><Th>Oy</Th><Th>Turi</Th><Th right>Xodim</Th><Th right>Hisoblangan</Th><Th right>Qo&apos;lga</Th><Th right>To&apos;langan</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {runs.length === 0 && <Empty text="Vedomost hali yo'q — yuqorida oy va turini tanlab hisoblang" />}
                {runs.map((r) => (
                  <Tr key={r.id} className={r.status === "CANCELLED" ? "opacity-50" : ""}>
                    <Td className="font-medium"><Link href={`/ish-haqi/${r.id}`} className="text-brand-700 hover:underline">{r.docNo}</Link><div className="text-xs font-normal text-slate-500">{dateTime(r.createdAt)}{r.note ? ` · ${r.note}` : ""}</div></Td>
                    <Td>{monthTitle(r.month)}</Td>
                    <Td>{PAYROLL_KIND_LABEL[r.kind]}</Td>
                    <Td right>{r._count.lines}</Td>
                    <Td right>{money(Number(r.gross))}</Td>
                    <Td right className="font-medium">{money(Number(r.net))}</Td>
                    <Td right>{money(Number(r.paid))}</Td>
                    <Td><Badge color={PAYROLL_STATUS_BADGE[r.status]}>{PAYROLL_STATUS_LABEL[r.status]}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "sozlamalar" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Soliq, avans, kasallik"
              info={<>
                <p>Barcha xodimlarga bir xil. O&apos;zgarish keyingi hisobdan qo&apos;llanadi — tasdiqlangan vedomostlar o&apos;zgarmaydi.</p>
                <p><b>Xodimning ish haqi turi.</b> Oklad, kunbay, soatbay yoki sdelka — xodim kartasida («Ish haqi turi» va «Tarif stavka»). Jarima va bonus qoidalari — Otdel kadr → Jarima va bonuslar.</p>
              </>} />
            <SettingsForm editable={canSettings} v={{
              incomeTaxPct: Number(st.incomeTaxPct), inpsPct: Number(st.inpsPct), socialTaxPct: Number(st.socialTaxPct), advancePct: st.advancePct, advanceDay: st.advanceDay,
              sickPctShort: st.sickPctShort, sickPctLong: st.sickPctLong, hoursPerDay: Number(st.hoursPerDay), vacationPaid: st.vacationPaid,
            }} />
          </Card>
          <Card>
            <CardHeader title="Sdelka narxlari" info="Brigada bajargan 1 birlik uchun ish haqi fondiga qo'shiladigan summa. Fond sdelkadagi a'zolarga ishlagan soati bo'yicha bo'linadi" />
            {products.length ? <PieceRatesForm editable={canSettings} products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, pieceRate: p.pieceRate == null ? null : Number(p.pieceRate) }))} /> : <Empty text="Mahsulot yo'q" />}
          </Card>
        </div>
      )}
    </div>
  );
}

type Debt = Awaited<ReturnType<typeof listDebts>>[number];

const SHEETS_INFO = (
  <>
    <p><b>Oylik varaqlari</b> — korxonaning oylik Excel kitobi (tabellar, vedomostlar, qarzlar) ERP ichida, barcha varaqlari bilan. Har oy uchun fayl bir marta yuklanadi.</p>
    <p>Katakni tanlab yozing (yoki F2 / ikki marta bosing): Enter — pastga, Tab — o&apos;ngga, Esc — bekor, Delete — tozalash, Ctrl+Z — orqaga. Formula «=» bilan boshlanadi (SUM, SUMPRODUCT, IFERROR, ROUND, IF…); formula yozilayotganda katak bosilsa — manzili qo&apos;shiladi. Excel&apos;dan blokni nusxa olib Ctrl+V bilan joylash mumkin.</p>
    <p>O&apos;zgarish darhol saqlanadi va formulalar shu zahoti qayta hisoblanadi. «Excel yuklab olish» — joriy holat (tahrirlar bilan) .xlsx bo&apos;lib.</p>
  </>
);

const DEDUCT_INFO = (
  <>
    <p><b>Ushlanmalar</b> — Excel C2026&apos;ning G–K ustunlari: har xodimga oy bo&apos;yicha aliment/ijro, qarz to&apos;lovi, oylikdan qarz, to&apos;y puli, jarima. Oy yakuni vedomosti shularni ushlaydi.</p>
    <p>Kul rang raqam — taklif: aliment — ijro/aliment daftaridan, qarz — nasiya jadvalidan, oylikdan qarz — shu oy kassadan xodimga berilgan (nasiyasiz) pul, to&apos;y puli — sozlamadan. Ustun sarlavhasidagi ✓ bo&apos;sh kataklarga takliflarni qo&apos;yadi.</p>
    <p>Qarz to&apos;lovi va aliment yozilsa — jadval ulushi / avtomatik summa o&apos;rniga shu ushlanadi va «Xodim qarzlari» dagi qoldiqdan kamayadi. Oy yakuni vedomosti direktorga yuborilgach jadval yopiladi.</p>
  </>
);

/** «Ushlanmalar»: oy tanlash va C2026 G–K kabi jadval. */
async function DeductionsTab({ oy, canEdit }: { oy?: string; canEdit: boolean }) {
  const cur = monthOf(today());
  const month = oy && /^\d{4}-(0[1-9]|1[0-2])$/.test(oy) && oy <= shiftMonth(cur, 1) ? oy : cur;
  const data = await deductionsMonth(month);
  const href = (m: string) => `/ish-haqi?tab=ushlanmalar&oy=${m}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={href(shiftMonth(month, -1))} variant="secondary" size="sm"><ChevronLeft size={14} /> {monthTitle(shiftMonth(month, -1))}</LinkButton>
        <span className="px-2 text-base font-semibold text-slate-900">{data.title}</span>
        {month < shiftMonth(cur, 1) && <LinkButton href={href(shiftMonth(month, 1))} variant="secondary" size="sm">{monthTitle(shiftMonth(month, 1))} <ChevronRight size={14} /></LinkButton>}
        <LinkButton href="/ish-haqi?tab=qarzlar" variant="ghost" size="sm"><HandCoins size={14} /> Qarzlar va ijro daftari</LinkButton>
      </div>
      {data.locked && <Callout tone="warning" title="Ushlanmalar yopiq">{data.locked}</Callout>}
      <DeductionsGrid key={month} data={data} canEdit={canEdit} />
      {canEdit && !data.locked && (
        <Fold title="Excel'dan import (C2026 ushlanmalari, «Карз», «Миб»)">
          <DeductImport month={month} monthLabel={data.title} employees={await activeEmployees(month)} />
        </Fold>
      )}
    </div>
  );
}

/** Oyda ishlagan xodimlar (import oynasidagi tanlov uchun). */
async function activeEmployees(month: string) {
  const days = monthDays(month);
  return db.employee.findMany({ where: employeesInWindow(dayUtc(days[0]!.iso), dayUtc(days[days.length - 1]!.iso)), orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } });
}

/** «Xodim qarzlari» ostida: ijro/aliment daftari va qarzning boshlang'ich qoldig'i (Excel «Миб», «Карз»). */
async function LedgersPanel() {
  const cur = monthOf(today());
  const months = Array.from({ length: 15 }, (_, i) => shiftMonth(cur, 1 - i)).map((m) => ({ key: m, label: monthTitle(m) }));
  const [ws, employees] = await Promise.all([
    listWithholdings(),
    db.employee.findMany({ where: { firedAt: null }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } }),
  ]);
  const active = ws.filter((w) => !w.cancelledAt);
  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4"><h3 className="text-sm font-semibold text-slate-900">Ijro varaqalari va aliment</h3><span className="text-xs text-slate-500">Qoldiq: {money(active.reduce((x, w) => x + (w.left ?? 0), 0))}</span></div>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Turi / raqami</Th><Th right>Umumiy qarz</Th><Th right>Oyiga</Th><Th>Boshlanish</Th><Th right>Ushlangan</Th><Th right>Qolgan</Th><Th>Izoh</Th><Th></Th></tr></thead>
          <tbody>
            {ws.length === 0 && <tr><td colSpan={9}><Empty text="Ijro varaqasi yoki aliment yozilmagan — pastdagi forma orqali qo'shing" /></td></tr>}
            {ws.map((w) => (
              <Tr key={w.id} className={w.cancelledAt ? "opacity-50" : ""}>
                <Td className="font-medium">{w.employee.fullName}<div className="text-xs font-normal text-slate-500">{w.employee.position}</div></Td>
                <Td>{w.kind === "MIB" ? "Ijro (MIB)" : "Aliment"}{w.caseNo ? <div className="text-xs text-slate-500">№{w.caseNo}</div> : null}{w.creditor ? <div className="text-xs text-slate-500">{w.creditor}</div> : null}</Td>
                <Td right>{w.amount != null ? money(w.amount) : "muddatsiz"}</Td>
                <Td right>{w.monthly != null ? money(w.monthly) : w.percent != null ? `${w.percent}%` : "—"}</Td>
                <Td>{monthTitle(w.startMonth)}</Td>
                <Td right>{money(w.held)}</Td>
                <Td right className="font-medium">{w.cancelledAt ? <Badge color="slate">Bekor</Badge> : w.left == null ? "—" : w.left > 0 ? money(w.left) : <Badge color="green">Yopildi</Badge>}</Td>
                <Td className="text-slate-600">{w.cancelledAt ? w.cancelReason : w.note ?? "—"}</Td>
                <Td right>{!w.cancelledAt && <ConfirmButton action={cancelWithholdingAction.bind(null, w.id)} label="Bekor qilish" reason="required" question="Ijro/aliment yozuvi bekor qilinadi (keyingi vedomostlarda ushlanmaydi). Sababi?" className="text-xs" />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Fold title="Ijro varaqasi yoki aliment qo'shish"><WithholdingForm employees={employees} months={months} defMonth={cur} /></Fold>
      <Fold title="Qarzning boshlang'ich qoldig'i (Excel «Карз» dan)"><OpeningDebtForm employees={employees} months={months} defMonth={cur} /></Fold>
    </div>
  );
}

const TABEL_INFO = (
  <>
    <p><b>Tabel</b> — Excel tabeli kabi: guruhni tanlang (oklad, brigada, komanda…), katakka kunlik soatni yozing (8, 4, 7,5) yoki H — kelmadi, K — kasal, T — ta&apos;til, D — dam olish. O&apos;zgarish o&apos;zi saqlanadi; ↑↓←→ va Enter bilan yuriladi, Excel&apos;dan blokni nusxa olib Ctrl+V bilan joylash mumkin.</p>
    <p>Oklad: <b>oklad × kun ÷ norma</b>, kunbay: <b>stavka × kun</b>, soatbay: <b>stavka × soat</b>; kun = soat ÷ 8. Kul rang raqam — Face ID yoki kelish-ketish vaqtidan (1 kun), ustiga yozilsa qo&apos;lda soat bo&apos;ladi. Sdelka (brigada) hisobi — keyingi bosqichda.</p>
    <p>«Excel&apos;dan import» — oylik Excel faylidagi barcha tabel varaqlari (Ауп, brigadalar, Поврименшики, Сваршики, БРУ) bir marta yuklanadi; ismlar xodimlarga moslanadi. Oy yakuni vedomosti direktorga yuborilgach tabel yopiladi.</p>
  </>
);

/** «Tabel»: oy va guruh tanlash, Excel kabi soat jadvali, Excel'dan import. */
async function TabelTab({ oy, guruh, canEdit }: { oy?: string; guruh?: string; canEdit: boolean }) {
  const cur = monthOf(today());
  const month = oy && /^\d{4}-(0[1-9]|1[0-2])$/.test(oy) && oy <= cur ? oy : cur;
  const data = await tabelMonth(month, guruh);
  // Brigada guruhi — Excel'dagi brigada varag'i (soat + mahsulot soni + narx, sdelka hisobi)
  const sheet = data.group.startsWith("b:") ? await brigadeSheet(month, data.group.slice(2)) : null;
  const href = (m: string, g: string) => `/ish-haqi?tab=tabel&oy=${m}&guruh=${encodeURIComponent(g)}`;
  const days = monthDays(month);
  const employees = canEdit && !data.locked
    ? await db.employee.findMany({ where: employeesInWindow(dayUtc(days[0]!.iso), dayUtc(days[days.length - 1]!.iso)), orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } })
    : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={href(shiftMonth(month, -1), data.group)} variant="secondary" size="sm"><ChevronLeft size={14} /> {monthTitle(shiftMonth(month, -1))}</LinkButton>
        <span className="px-2 text-base font-semibold text-slate-900">{data.title}</span>
        {month < cur && <LinkButton href={href(shiftMonth(month, 1), data.group)} variant="secondary" size="sm">{monthTitle(shiftMonth(month, 1))} <ChevronRight size={14} /></LinkButton>}
      </div>
      <Tabs current={data.group} scroll={false} className="mb-0" items={data.groups.map((g) => ({ key: g.key, label: g.label, count: g.count, href: href(month, g.key) }))} />
      {data.locked && <Callout tone="warning" title="Tabel yopiq">{data.locked}</Callout>}
      {sheet ? <BrigadeSheetGrid key={`${month}|${data.group}`} data={sheet} canEdit={canEdit} /> : <TabelGrid key={`${month}|${data.group}`} data={data} canEdit={canEdit} />}
      {employees.length > 0 && (
        <Fold title="Excel'dan import (oylik fayldagi tabel varaqlari)">
          <TabelImport month={month} monthLabel={data.title} employees={employees} />
        </Fold>
      )}
    </div>
  );
}

/** «Oylik varaqlari»: kitob tanlash, yuklash, Excel kabi jadval. */
async function SheetsTab({ kitob, varaq, canEdit }: { kitob?: string; varaq?: string; canEdit: boolean }) {
  const list = await listWorkbooks();
  const cur = list.find((w) => w.id === kitob) ?? list.find((w) => !w.cancelledAt) ?? list[0];
  const wb = cur ? await loadWorkbook(cur.id) : null;
  const thisMonth = monthOf(today());
  const months = Array.from({ length: 15 }, (_, i) => shiftMonth(thisMonth, 1 - i)).map((m) => ({ key: m, label: monthTitle(m) }));
  const upload = canEdit && <WorkbookUploadForm months={months} defMonth={shiftMonth(thisMonth, -1)} />;
  if (!wb) {
    return (
      <Card>
        <EmptyState icon={FileSpreadsheet} title="Hali Excel kitobi yuklanmagan" text={canEdit ? "Oylik Excel faylini yuklang — barcha varaqlari shu yerda Excel'dagidek ochiladi va tahrirlanadi" : "Sekretar oylik Excel faylini yuklagach shu yerda ko'rinadi"} />
        {upload && <div className="border-t border-slate-100 pt-4">{upload}</div>}
      </Card>
    );
  }
  const editable = canEdit && !wb.cancelledAt;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <WorkbookPicker current={wb.id} items={list.map((w) => ({ id: w.id, label: `${monthTitle(w.month)} — ${w.title}${w.cancelledAt ? " (bekor)" : ""}` }))} />
        <span className="text-xs text-slate-500">{wb.sheets.length} varaq · yuklangan {dateTime(wb.createdAt)}{+wb.updatedAt - +wb.createdAt > 60_000 ? ` · oxirgi tahrir ${dateTime(wb.updatedAt)}` : ""}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <LinkButton href={`/ish-haqi/varaq-excel?id=${wb.id}`} variant="secondary" size="sm"><FileSpreadsheet size={14} /> Excel yuklab olish</LinkButton>
          {editable && <ConfirmButton action={cancelWorkbookAction.bind(null, wb.id)} label="Bekor qilish" reason="required" question="Kitob bekor qilinadi (o'chirilmaydi, ro'yxatda «bekor» bo'lib qoladi, tahrir yopiladi). Sababi?" className="text-xs" />}
        </span>
      </div>
      {wb.cancelledAt && <Callout tone="warning" title="Kitob bekor qilingan">{wb.cancelReason ?? "Sabab ko'rsatilmagan"} — faqat ko&apos;rish mumkin.</Callout>}
      <SheetGrid key={wb.id} canEdit={editable} initial={varaq}
        sheets={wb.sheets.map((x) => ({ id: x.id, name: x.name, hidden: x.hidden, data: x.data as unknown as SheetData }))} />
      {upload && <Fold title="Yangi Excel yuklash (boshqa oy yoki yangilangan fayl)">{upload}</Fold>}
    </div>
  );
}

/** Nasiya qarzlari: jami, oylik ulush, muddat, ushlangan / qolgan. Ushlangan — oy yakuni vedomosti tasdiqlangan oylar. */
function DebtTable({ debts, canCancel }: { debts: Debt[]; canCancel: boolean }) {
  const active = debts.filter((d) => !d.cancelledAt);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Faol qarzlar" value={String(active.filter((d) => d.left > 0).length)} icon={HandCoins} />
        <StatCard label="Jami berilgan" value={money(active.reduce((x, d) => x + d.amount, 0))} />
        <StatCard label="Ushlangan" value={money(active.reduce((x, d) => x + d.held, 0))} />
        <StatCard label="Qolgan" value={money(active.reduce((x, d) => x + d.left, 0))} tone="warning" />
      </div>
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Sana</Th><Th right>Summa</Th><Th right>Oyiga</Th><Th>Muddat</Th><Th right>Ushlangan</Th><Th right>Qolgan</Th><Th>Izoh</Th><Th></Th></tr></thead>
          <tbody>
            {debts.length === 0 && <tr><td colSpan={9}><Empty text="Qarz yo'q — Kirim-Chiqimda «Hodimlar bilan hisob-kitob» chiqimida «Oylikdan nasiya» belgilansa shu yerga tushadi" /></td></tr>}
            {debts.map((d) => (
              <Tr key={d.id} className={d.cancelledAt ? "opacity-50" : ""}>
                <Td className="font-medium"><Link href={`/employees/${d.employee.id}`} className="hover:underline">{d.employee.fullName}</Link><div className="text-xs font-normal text-slate-500">{d.employee.position}</div></Td>
                <Td>{date(d.date)}{d.account ? <div className="text-xs text-slate-500">{d.account}</div> : null}</Td>
                <Td right>{money(d.amount)}</Td>
                <Td right>{money(d.monthly)}</Td>
                <Td>{monthTitle(d.startMonth)} — {monthTitle(d.endMonth)}<div className="text-xs text-slate-500">{d.months} oy · {d.heldN} ushlangan</div></Td>
                <Td right>{money(d.held)}</Td>
                <Td right className="font-medium">{d.cancelledAt ? <Badge color="slate">Bekor</Badge> : d.left > 0 ? money(d.left) : <Badge color="green">Yopildi</Badge>}</Td>
                <Td className="text-slate-600">{d.cancelledAt ? d.cancelReason : d.note ?? "—"}</Td>
                <Td right>{canCancel && !d.cancelledAt && d.left > 0 && (
                  <ConfirmButton action={cancelEmployeeDebt.bind(null, d.id)} label="Bekor qilish" reason="required" question="Qarz oylikdan ushlanmay qo'yiladi (kassa chiqimi o'zgarmaydi). Sababi?" className="text-xs" />
                )}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
