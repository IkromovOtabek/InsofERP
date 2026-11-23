import { notFound, redirect } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { date, dateTime, money } from "@/lib/format";
import { monthTitle } from "@/lib/davomat";
import { payAccounts } from "@/lib/mechanic-requests";
import { ROLE_LABELS } from "@/lib/nav";
import {
  ADVANCE_STATUS_BADGE, ADVANCE_STATUS_LABEL, advanceRecipients, advanceSheet, canAdvance, canDeleteAdvance, canGiveAdvance, canViewSheet,
} from "@/lib/hr/advance-sheet";
import { Badge, Callout, Card, LinkButton, PageHeader, StatCard, StatusSteps } from "@/components/ui";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelAdvanceSheetAction, deleteAdvanceSheetAction } from "../actions";
import { AdvanceEditor, AdvanceLines, SheetButtons, type AdvLine } from "../avans-forms";

const STEPS = [{ key: "DRAFT", label: "Saqlangan" }, { key: "SENT", label: "Jo'natilgan" }, { key: "DONE", label: "Berildi" }];

/**
 * Avans varaqasi: qoralamada — avansni yozish, saqlash va jo'natish (Sekretar); jo'natilganda — qabul qiluvchi kassani
 * tanlab har xodimga «Berildi» belgilaydi. Excel'ni ikkalasi ham yuklab oladi. Qoidalar — `lib/hr/advance-sheet.ts`.
 */
export default async function AdvanceSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/avans");
  const { id } = await params;
  const sh = await advanceSheet(id);
  if (!sh) notFound();
  if (!canViewSheet(s, sh)) redirect("/avans?denied=1");
  const editor = canAdvance(s);
  const isRecipient = s.userId === sh.recipientId || s.role === "DIRECTOR";
  const canGive = sh.status === "SENT" && isRecipient && canGiveAdvance(s);
  const [recipients, accounts] = await Promise.all([
    sh.status === "DRAFT" && editor ? advanceRecipients() : Promise.resolve([]),
    canGive ? payAccounts() : Promise.resolve([]),
  ]);
  const lines: AdvLine[] = sh.lines.map((l) => ({
    id: l.id, fullName: l.fullName, position: l.position, groupLabel: l.groupLabel, earned: l.earned, suggested: l.suggested, amount: l.amount,
    given: l.givenAt ? `${dateTime(l.givenAt)}${l.account ? ` · ${l.account}` : ""}` : null, givenBy: l.givenBy,
    canUndo: !!l.givenAt && sh.status !== "CANCELLED" && (l.givenById === s.userId || s.role === "DIRECTOR"),
  }));
  const back = editor ? { href: "/ish-haqi?tab=avans", label: "Ish haqi → Avans" } : { href: "/avans", label: "Avans varaqalari" };
  const anyGiven = sh.givenCount > 0;
  // Eski varaqalarda «Ishlagan» / «Tavsiya» hisoblangan; yangilari — ro'yxat, avans qo'lda
  const calc = sh.lines.some((l) => l.earned > 0 || l.suggested > 0);
  const manual = sh.groupLabel === "Qo'lda avans";

  return (
    <div className="space-y-4" data-wide="">
      <PageHeader back={back} title={`${sh.docNo} · Avans`}
        subtitle={`${monthTitle(sh.month)} · ${sh.groupLabel ?? "Barcha xodimlar"} · ${calc ? `${date(sh.asOf)} holatiga ishlagani` : manual ? date(sh.asOf) : "avans qo'lda yoziladi"}`}
        action={<Badge color={ADVANCE_STATUS_BADGE[sh.status]}>{ADVANCE_STATUS_LABEL[sh.status]}</Badge>}
        info={<>
          {calc
            ? <p><b>Ishlagan</b> — oy boshidan {date(sh.asOf)} gacha: tabel / davomat bo&apos;yicha oklad, kunbay, soatbay va brigada varag&apos;i (sdelka). <b>Tavsiya</b> — xodim kartasida qo&apos;lda belgilangan avans, bo&apos;lmasa Sozlamalardagi avans foizi (ishlaganidan oshmaydi), shu oy berilgan va boshqa varaqada jo&apos;natilgan avans ayirilgan.</p>
            : <p>Varaqa — shu oy Tabeldagi xodimlar ro&apos;yxati; avans summasi har xodimga qo&apos;lda yoziladi (bo&apos;sh — avans yo&apos;q). «Ro&apos;yxatni yangilash» — guruhga yangi kelganlarni qo&apos;shadi.</p>}
          <p>«Saqlash» — varaqa bizda qoladi. «Jo&apos;natish» — tanlangan xodimga (kassa huquqi bilan) bildirishnoma boradi; u kassani tanlab har xodimga «Berildi» belgilaydi — har biriga kassadan alohida «Ish haqi» chiqimi yoziladi. Berilgan avans oy yakuni vedomostida o&apos;zi ushlanadi.</p>
        </>} />
      {sh.status !== "CANCELLED" && <StatusSteps steps={STEPS} current={sh.status} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Xodim (avans yozilgan)" value={String(sh.count)} hint={`${sh.lines.length} xodim varaqada`} />
        <StatCard label="Jami avans" value={money(sh.total)} tone="brand" />
        <StatCard label="Berildi" value={money(sh.given)} tone={sh.given ? "success" : "default"} hint={`${sh.givenCount} xodim`} />
        <StatCard label="Qoldi" value={money(sh.total - sh.given)} tone={sh.total - sh.given > 0 && sh.status === "SENT" ? "warning" : "default"} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
          <span>Tuzdi: <b className="text-slate-900">{sh.createdBy}</b> · {dateTime(sh.createdAt)}</span>
          {sh.sentAt && <span>Jo&apos;natdi: <b className="text-slate-900">{sh.sentBy}</b> → <b className="text-slate-900">{sh.recipient}</b> · {dateTime(sh.sentAt)}</span>}
          {sh.doneAt && <span>Yopildi: {dateTime(sh.doneAt)}</span>}
          {sh.note && <span>Izoh: {sh.note}</span>}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <LinkButton href={`/avans/${sh.id}/excel`} variant="secondary" size="sm"><FileSpreadsheet size={14} /> Excel yuklab olish</LinkButton>
            <SheetButtons id={sh.id} can={{
              refresh: editor && sh.status === "DRAFT",
              recall: editor && sh.status === "SENT" && !anyGiven,
              close: sh.status === "SENT" && anyGiven && (isRecipient || editor),
            }} />
            {(editor || s.role === "DIRECTOR") && (sh.status === "DRAFT" || sh.status === "SENT") && !anyGiven && (
              <ConfirmButton action={cancelAdvanceSheetAction.bind(null, sh.id)} label="Bekor qilish" reason="required" question="Varaqa bekor qilinadi (o'chirilmaydi, ro'yxatda «bekor» bo'lib qoladi). Sababi?" className="text-xs" />
            )}
            {canDeleteAdvance(s) && (
              <ConfirmButton action={deleteAdvanceSheetAction.bind(null, sh.id)} label="O'chirish" reason="optional" okText="O'chirildi" goTo={editor ? "/ish-haqi?tab=avans" : "/avans"}
                question={`${sh.docNo} butunlay o'chirilsinmi? Amallar tarixida qoladi. Kassadan avans berilgan bo'lsa — avval «Berildi»ni qaytaring.`}
                className="text-xs font-medium text-red-600 hover:underline" />
            )}
          </span>
        </div>
      </Card>

      {sh.status === "CANCELLED" && <Callout tone="warning" title="Varaqa bekor qilingan">{sh.cancelReason ?? "Sabab ko'rsatilmagan"}{sh.cancelledBy ? ` — ${sh.cancelledBy}` : ""}</Callout>}
      {sh.status === "SENT" && s.userId === sh.recipientId && !canGive && (
        <Callout tone="warning" title="Kassa huquqi yo'q">Avansni kassadan berish uchun direktor sizga kassa (kirim-chiqim yozish) huquqini berishi kerak.</Callout>
      )}
      {sh.status === "SENT" && !isRecipient && editor && (
        <Callout tone="info" title={`${sh.recipient}ga jo'natilgan`}>U har xodimga «Berildi» belgilaydi. Tahrir kerak bo&apos;lsa — hali hech kimga berilmagan bo&apos;lsa «Qaytarib olish».</Callout>
      )}

      {sh.status === "DRAFT" && editor
        ? <AdvanceEditor id={sh.id} lines={lines} recipients={recipients.map((u) => ({ id: u.id, fullName: u.fullName, role: ROLE_LABELS[u.role] }))} />
        : <AdvanceLines id={sh.id} lines={lines} canGive={canGive} accounts={accounts} />}
    </div>
  );
}
