import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Bell, CalendarClock, FileText, Link2Off, MessageCircle, Pencil, Phone, Printer, QrCode, Send, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, dateTime, fmtNum, money } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { RENT_METHOD_LABEL, currentMonth, monthKey, monthLabel } from "@/lib/rent";
import { reminderText, shopLedger } from "@/lib/rent-tenant";
import { botEnabled, botUsername } from "@/lib/telegram/api";
import { Badge, Callout, Card, CardHeader, DL, EmptyState, LinkButton, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { createRentTgLink, sendRentReminderNow, unlinkRentTg } from "../../actions";
import { CopyButton } from "../../tenant-forms";

const cell = (v: number) => (Math.abs(v) < 0.005 ? "–" : fmtNum(v));

/**
 * Ijarachi (do'kon) kartasi: rekvizitlar, jami qarz, oyma-oy hisob, to'lovlar tarixi, Telegram ulash (QR)
 * va qarz eslatmasi (bot orqali yoki matnni nusxalab). Hisob qoidalari — `lib/rent-tenant.ts`.
 */
export default async function RentShopPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/arenda");
  const { id } = await params;
  const shop = await db.rentShop.findUnique({ where: { id } });
  if (!shop) notFound();
  const canShops = canDo(s, "arenda", "shops");
  const canCreate = canDo(s, "arenda", "create");
  const [ledger, txs, reminders, bot] = await Promise.all([
    shopLedger(id),
    db.rentTx.findMany({ where: { shopId: id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100, include: { createdBy: { select: { fullName: true } } } }),
    db.rentReminder.findMany({ where: { shopId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    botEnabled() ? botUsername() : Promise.resolve(null),
  ]);
  const debt = ledger.debt;
  const cur = ledger.months.find((m) => m.key === monthKey(currentMonth()));
  const lastPay = txs.find((t) => t.type === "INCOME" && !t.cancelledAt);
  const linkUrl = bot && shop.tgLinkToken ? `https://t.me/${bot}?start=ijara_${shop.tgLinkToken}` : null;
  const qr = linkUrl && !shop.tgChatId ? await QRCode.toString(linkUrl, { type: "svg", margin: 1, width: 168, errorCorrectionLevel: "M" }) : null;
  const text = debt > 1 ? await reminderText(shop, ledger) : null;
  const phone = shop.phone ? formatPhone(shop.phone) : null;

  return (
    <div>
      <PageHeader
        back={{ href: "/arenda?tab=qarzdorlar", label: "Arenda" }}
        title={shop.name}
        subtitle={<>{shop.location}{shop.tenantName ? ` · ${shop.tenantName}` : ""}{!shop.isActive && <> · <Badge color="amber">bo&apos;sh joy</Badge></>}</>}
        action={<>
          <LinkButton href={`/arenda/dokon/${id}/akt`} variant="secondary"><FileText size={16} /> Akt-sverka</LinkButton>
          {canShops && <LinkButton href={`/arenda?tab=dokonlar&edit=${id}`} variant="secondary"><Pencil size={16} /> Tahrirlash</LinkButton>}
        </>}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Jami qarz" value={debt < -1 ? `avans ${money(-debt)}` : money(Math.max(0, debt))} icon={Wallet} tone={debt > 1 ? "danger" : "success"} hint={`${ledger.unpaid.length} ta oy to'liq to'lanmagan`} />
        <StatCard label={`Shu oy (${monthLabel(currentMonth())}) qoldig'i`} value={cur ? money(Math.max(0, cur.left)) : "hisob ochilmagan"} icon={CalendarClock} hint={cur ? `hisob ${money(cur.due)}, tushgan ${money(cur.paid)}` : undefined} />
        <StatCard label="Oxirgi to'lov" value={lastPay ? money(lastPay.amount) : "—"} hint={lastPay ? `${date(lastPay.date)} · ${RENT_METHOD_LABEL[lastPay.method]}` : "to'lov yozilmagan"} />
        <StatCard label="Oylik summa (andoza)" value={money(Number(shop.bankAmount) + Number(shop.cashAmount))} hint={`perechisleniye ${fmtNum(shop.bankAmount)}, naqd ${fmtNum(shop.cashAmount)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title="Oyma-oy hisob" description="Har oy: to'lashi kerak (perechisleniye + naqd), shu oy uchun tushgan va qoldiq. Ortiqcha to'lov — avans." /></div>
            {ledger.months.length === 0 ? <div className="p-5 pt-0"><EmptyState title="Hisob yo'q" text="Oy varag'i ochilganda yoki Excel'dan import qilinganda shu yerda chiqadi." /></div> : (
              <Table>
                <thead><tr><Th>Oy</Th><Th right>Perechisleniye</Th><Th right>Naqd</Th><Th right>Jami</Th><Th right>Tushgan</Th><Th right>Qoldiq</Th></tr></thead>
                <tbody>
                  {ledger.months.map((m) => (
                    <Tr key={m.key}>
                      <Td><Link href={`/arenda?oy=${m.key}`} className="hover:underline">{m.label}</Link>{m.note && <span className="block text-xs text-slate-500">{m.note}</span>}</Td>
                      <Td right>{cell(m.bankDue)}</Td>
                      <Td right>{cell(m.cashDue)}</Td>
                      <Td right className="font-medium">{cell(m.due)}</Td>
                      <Td right className="text-emerald-700">{cell(m.paid)}</Td>
                      <Td right className={`font-semibold ${m.left > 1 ? "text-red-600" : m.left < -1 ? "text-emerald-700" : "text-slate-400"}`}>{m.left < -1 ? `avans ${fmtNum(-m.left)}` : cell(m.left)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-slate-50/70">
                    <Td className="font-semibold">Jami</Td><Td /><Td />
                    <Td right className="font-semibold">{cell(ledger.due)}</Td>
                    <Td right className="font-semibold text-emerald-700">{cell(ledger.paid)}</Td>
                    <Td right className={`font-bold ${debt > 1 ? "text-red-600" : "text-emerald-700"}`}>{debt < -1 ? `avans ${fmtNum(-debt)}` : cell(debt)}</Td>
                  </Tr>
                </tbody>
              </Table>
            )}
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title="To'lovlar tarixi" description="Ijarachidan arenda kassasiga tushgan pul. Bekor qilingan yozuv chizilgan holda qoladi." /></div>
            {txs.length === 0 ? <div className="p-5 pt-0"><EmptyState title="To'lov yo'q" text="Arenda sahifasidagi «Kirim» tugmasi bilan yoziladi." /></div> : (
              <Table>
                <thead><tr><Th>Sana</Th><Th>Qaysi oy uchun</Th><Th>Usul</Th><Th right>Summa</Th><Th>Kim yozdi</Th><Th></Th></tr></thead>
                <tbody>
                  {txs.map((t) => (
                    <Tr key={t.id} className={t.cancelledAt ? "opacity-50 line-through" : undefined}>
                      <Td>{date(t.date)}</Td>
                      <Td>{t.month ? monthLabel(t.month) : "—"}{t.type === "EXPENSE" && <span className="ml-1 text-xs text-slate-500">(chiqim: {t.category})</span>}</Td>
                      <Td>{RENT_METHOD_LABEL[t.method]}</Td>
                      <Td right className={t.type === "INCOME" ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{t.type === "INCOME" ? "+" : "−"}{fmtNum(t.amount)}</Td>
                      <Td className="text-xs text-slate-500">{t.createdBy.fullName}{t.note ? ` · ${t.note}` : ""}{t.cancelReason ? ` · bekor: ${t.cancelReason}` : ""}</Td>
                      <Td>{t.type === "INCOME" && <Link href={`/arenda/kvitansiya/${t.id}`} title="Kvitansiyani chop etish" className="inline-flex items-center gap-1 text-xs text-slate-500 no-underline hover:text-slate-900"><Printer size={13} /> Kvitansiya</Link>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Ijarachi" />
            <DL items={[
              { k: "F.I.O. / mas'ul", v: shop.tenantName ?? <span className="text-slate-400">kiritilmagan</span> },
              { k: "Telefon", v: phone ? <a href={`tel:${shop.phone}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Phone size={13} /> {phone}</a> : <span className="text-slate-400">kiritilmagan</span> },
              { k: "INN", v: shop.inn ?? <span className="text-slate-400">—</span> },
              { k: "Joy", v: shop.location },
              ...(shop.note ? [{ k: "Izoh", v: shop.note }] : []),
            ]} />
            {canShops && (!shop.tenantName || !shop.phone) && <p className="mt-3 text-xs text-slate-500">Ijarachi va telefonni «Tahrirlash» orqali kiriting — eslatma matni shu bilan chiqadi.</p>}
          </Card>

          <Card>
            <CardHeader title="Telegram" icon={MessageCircle} description="Ijarachi botga ulansa, qarz eslatmasi o'zi boradi va u istalgan payt «qarz» deb yozib, holatini bila oladi." />
            {!botEnabled() ? (
              <Callout tone="warning" title="Bot sozlanmagan">Serverda TELEGRAM_BOT_TOKEN bo&apos;lmasa eslatma faqat qo&apos;lda (matnni nusxalab) yuboriladi.</Callout>
            ) : shop.tgChatId ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm"><Badge color="green">ulangan</Badge><span className="text-slate-500">{shop.tgLinkedAt ? dateTime(shop.tgLinkedAt) : ""}</span></div>
                <div className="flex flex-wrap gap-2">
                  {canCreate && debt > 1 && <ActionButton action={sendRentReminderNow.bind(null, id)}><Send size={15} /> Eslatma yuborish</ActionButton>}
                  {canShops && <ActionButton action={unlinkRentTg.bind(null, id)} variant="ghost" className="text-slate-500"><Link2Off size={15} /> Uzish</ActionButton>}
                </div>
              </div>
            ) : linkUrl ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Ijarachi QR ni telefoni bilan skanerlaydi (yoki havolani ochadi) va botda <b>«Start»</b> ni bosadi — chat shu do&apos;konga ulanadi.</p>
                {qr && <div className="mx-auto w-fit rounded-lg border border-slate-200 bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />}
                <div className="flex flex-wrap gap-2"><CopyButton text={linkUrl} label="Havolani nusxalash" /></div>
              </div>
            ) : canShops ? (
              <ActionButton action={createRentTgLink.bind(null, id)} variant="secondary"><QrCode size={15} /> Ulash uchun QR yaratish</ActionButton>
            ) : <p className="text-sm text-slate-500">Hali ulanmagan.</p>}
          </Card>

          {text && (
            <Card>
              <CardHeader title="Eslatma matni" icon={Bell} description={shop.tgChatId ? "Bot shu matnni yuboradi." : "Ijarachi botga ulanmagan — matnni nusxalab Telegram yoki SMS orqali o'zingiz yuboring."} />
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700">{text}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton text={text} label="Matnni nusxalash" />
                {shop.phone && <a href={`tel:${shop.phone}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"><Phone size={13} /> Qo&apos;ng&apos;iroq</a>}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Eslatmalar jurnali" />
            {reminders.length === 0 ? <p className="text-sm text-slate-500">Hali eslatma yuborilmagan.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                    <div>
                      <div className="font-medium text-slate-800">{dateTime(r.createdAt)} · {r.auto ? "avtomatik" : "qo'lda"}</div>
                      {r.error && <div className="text-xs text-red-600">{r.error}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular-nums">{fmtNum(r.debt)}</div>
                      <Badge color={r.ok ? "green" : "red"}>{r.ok ? "yetkazildi" : "yetmadi"}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
