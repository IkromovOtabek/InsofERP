import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { moduleWriteAllowed } from "@/lib/auth";
import { MECH_ROLES, MECH_STATUS_COLOR, MECH_STATUS_LABEL, TARGET_LABEL, mechSubject, mechanicRequest, payAccounts } from "@/lib/mechanic-requests";
import { VEHICLE_TYPE } from "@/lib/logistics";
import { money, dateTime } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, DL, LinkButton, PageHeader, StatusSteps } from "@/components/ui";
import { CancelPanel, DecidePanel, PayPanel } from "../panels";

const STEPS = [
  { key: "NEW", label: "So'rov" },
  { key: "APPROVED", label: "Tasdiqlandi" },
  { key: "PAID", label: "Pul berildi" },
];

/** Bitta mexanik so'rovi — har kim faqat o'z bosqichidagi tugmani ko'radi (tasdiq, pul, bekor). */
export default async function MexanikSorovPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePage("/mexanik-sorovlar");
  const r = await mechanicRequest(id);
  // Mexanik faqat o'z so'rovini ochadi
  if (!r || (s.role === "MECHANIC" && r.createdById !== s.userId)) notFound();
  const st = r.status;
  const canDecide = st === "NEW" && moduleWriteAllowed(s, "mexanik", MECH_ROLES.decide) === true;
  const canPay = st === "APPROVED" && moduleWriteAllowed(s, "mexanik", MECH_ROLES.pay) === true;
  const canCancel = st === "NEW" && r.createdById === s.userId;
  const accounts = canPay ? await payAccounts() : [];
  const v = r.vehicle;
  const failed = st === "REJECTED" || st === "CANCELLED";

  return (
    <div>
      <PageHeader
        back={{ href: "/mexanik-sorovlar", label: "Mexanik so'rovlari" }}
        title={<>{r.docNo} <Badge color={MECH_STATUS_COLOR[st]}>{MECH_STATUS_LABEL[st]}</Badge>{r.urgent && <Badge color="red">Shoshilinch</Badge>}</>}
        subtitle={`${TARGET_LABEL[r.target]} · ${mechSubject(r)} · ${r.createdBy.fullName} · ${dateTime(r.createdAt)}`}
        action={r.cashTxId && ["CASHIER", "ACCOUNTING", "FINANCE", "DIRECTOR"].includes(s.role) ? <LinkButton href="/cashflow?tab=EXPENSE" variant="secondary">Kirim-Chiqim</LinkButton> : undefined}
      />

      <Card className="mb-5">
        <StatusSteps steps={STEPS} current={failed ? "NEW" : st} failed={failed} />
      </Card>

      {st === "REJECTED" && <Callout tone="danger" title="So'rov rad etildi">{r.rejectReason} · {r.decidedBy}{r.decidedAt ? ` · ${dateTime(r.decidedAt)}` : ""}</Callout>}
      {st === "CANCELLED" && <Callout tone="warning" title="Mexanik so'rovni bekor qildi">{r.decidedAt ? dateTime(r.decidedAt) : ""}</Callout>}
      {st === "PAID" && <Callout tone="success" title="Pul berildi">{money(r.amount)} · {r.cashAccount?.name ?? "—"} · {r.paidBy}{r.paidAt ? ` · ${dateTime(r.paidAt)}` : ""}</Callout>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="So'rov" />
            <DL items={[
              { k: "Summa", v: money(r.amount) },
              { k: "Turi", v: TARGET_LABEL[r.target] },
              ...(v ? [{ k: "Mashina", v: `${v.plate} · ${VEHICLE_TYPE[v.type] ?? v.type}${v.brand || v.model ? ` · ${[v.brand, v.model].filter(Boolean).join(" ")}` : ""}` }] : []),
              ...(r.object ? [{ k: r.target === "OTHER" ? "Nima uchun" : "Obyekt", v: r.object }] : []),
              { k: "Muammo", v: r.problem },
              { k: "Tavsif", v: r.note ?? "—" },
              { k: "Kim so'radi", v: `${r.createdBy.fullName} · ${dateTime(r.createdAt)}` },
              ...(r.decidedAt && st !== "CANCELLED" ? [{ k: st === "REJECTED" ? "Rad etdi" : "Tasdiqladi", v: `${r.decidedBy ?? "—"} · ${dateTime(r.decidedAt)}` }] : []),
              ...(r.paidAt ? [{ k: "Pul berdi", v: `${r.paidBy ?? "—"} · ${dateTime(r.paidAt)}` }] : []),
              ...(r.cashAccount ? [{ k: "Kassa", v: r.cashAccount.name }] : []),
            ]} />
          </Card>
          {r.photo && (
            <Card>
              <CardHeader title="Surat" />
              <a href={`/mexanik-sorovlar/${r.id}/surat`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- himoyalangan marshrut, next/image optimizatsiyasi kerak emas */}
                <img src={`/mexanik-sorovlar/${r.id}/surat`} alt="Muammo surati" className="max-h-[480px] w-auto rounded-lg border border-slate-200" />
              </a>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          {canDecide && (
            <Card>
              <CardHeader title="Ish boshqaruvchi qarori" description="Tasdiqlasangiz kassa pul beradi" />
              <DecidePanel id={r.id} />
            </Card>
          )}
          {canPay && (
            <Card>
              <CardHeader title="Pul berish" description="Kirim-Chiqimga chiqim bo'lib yoziladi" />
              <PayPanel id={r.id} amount={money(r.amount)} accounts={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.type === "CASH" ? "kassa" : "bank"}) · qoldiq ${money(a.balance)}` }))} />
            </Card>
          )}
          {st === "NEW" && !canDecide && !canCancel && <Callout tone="info">Ish boshqaruvchi tasdig&apos;i kutilmoqda — tasdiqlanmaguncha kassa pul bermaydi.</Callout>}
          {canCancel && (
            <Card>
              <CardHeader title="Bekor qilish" description="Tasdiqlanmaguncha bekor qilish mumkin" />
              <CancelPanel id={r.id} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
