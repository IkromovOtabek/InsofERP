import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Clock, Phone, Send, ShieldAlert, Truck, Ban } from "lucide-react";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { date, dateTime, fmtNum } from "@/lib/format";
import { orderQrValid, orderPublicPath } from "@/lib/order-qr";
import { asOfferLang } from "@/lib/offer-i18n";
import { donePercent, soleUnit, unitLabel } from "@/lib/unit";
import { orderTotal } from "@/lib/order-total";
import { QrScreen, QrField, QrFooter, QrItemTile, QrLangLink, QrPill, qrCard, qrCaption, qrUp, qrBtnAmber, qrBtnTelegram, telegramUrl, telHref } from "@/components/qr-screen";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UZ = {
  subtitle: "Temir-beton mahsulotlari",
  eyebrow: "ZAYAVKA",
  genuine: "Haqiqiy hujjat",
  genuineSub: "Zavod tizimida ro'yxatga olingan. Ma'lumot real vaqtda.",
  pendingSub: "Hali tasdiqlanmagan — korxona ko'rib chiqmoqda.",
  reviewing: "Korxona ko'rib chiqmoqda",
  reviewHint: "Tasdiqlangach shu ekranda «Ishlab chiqarish» bosqichi yonadi.",
  closedTitle: "Buyurtma yakunlandi",
  closedSubPaid: "Hammasi yetkazildi va to'liq to'landi. Rahmat!",
  closedSub: "Hammasi yetkazildi. Rahmat!",
  cancelled: "Bekor qilingan",
  cancelledSub: "Bu hujjat endi amal qilmaydi.",
  stop: "Bu qog'oz bo'yicha yuk olmang va pul to'lamang",
  stopHint: "Zayavka korxona tomonidan bekor qilingan.",
  state: "Holati", stateShort: "Holat", date: "Sana",
  status: { DRAFT: "Ko'rib chiqilmoqda", BLOCKED: "Ko'rib chiqilmoqda", CONFIRMED: "Qabul qilingan", IN_PRODUCTION: "Ishlab chiqarilmoqda", DELIVERED: "Yetkazib berilgan", CLOSED: "Yakunlangan", CANCELLED: "Bekor qilingan" } as Record<string, string>,
  steps: ["Qabul qilindi", "Ishlab chiqarish", "Yetkazish", "Yakunlandi"],
  stepsDone: ["Qabul qilindi", "Ishlab chiqarildi", "Yetkazildi", "Yakunlandi"],
  stepsPending: ["Qabul qilish", "Ishlab chiqarish", "Yetkazish", "Yakunlandi"],
  client: "Mijoz", object: "Obyekt", delivery: "Yetkazish", deliveredOn: "Yetkazildi", unknown: "Kelishilmoqda",
  items: "MAHSULOTLAR", total: "Jami", paid: "To'langan", rest: "Qoldiq", fullyPaid: "To'liq to'langan", som: "so'm", deliveryFee: "Dastavka",
  trips: (n: number) => `YETKAZIB BERISHLAR · ${n} REYS`, tripStatus: { PLANNED: "Rejada", LOADED: "Yuklangan", ON_ROAD: "Yo'lda", DELIVERED: "Yetkazildi" } as Record<string, string>,
  check: "Qog'ozdagi mijoz, sana va jami summa shu ekrandagi bilan bir xil bo'lishi kerak.",
  manager: "Sizning menejeringiz", speedUp: "Tezlashtirish kerakmi?", again: "Yana buyurtma berasizmi?", againHint: "Menejer shu shartlar bilan takrorlaydi",
  question: "Savolingiz bormi?", managerShort: "Menejer", call: "Qo'ng'iroq", callManager: "Menejerga qo'ng'iroq qilish", telegram: "Telegram",
  staff: "Korxona xodimimisiz? ERP'da ochish", checked: "Tekshirildi", refresh: "Qayta tekshirish",
};

const RU: typeof UZ = {
  subtitle: "Железобетонные изделия",
  eyebrow: "ЗАЯВКА",
  genuine: "Подлинный документ",
  genuineSub: "Зарегистрирована в системе завода. Данные в реальном времени.",
  pendingSub: "Ещё не подтверждена — предприятие рассматривает.",
  reviewing: "Предприятие рассматривает",
  reviewHint: "После подтверждения здесь загорится этап «Производство».",
  closedTitle: "Заказ завершён",
  closedSubPaid: "Всё доставлено и полностью оплачено. Спасибо!",
  closedSub: "Всё доставлено. Спасибо!",
  cancelled: "Отменена",
  cancelledSub: "Документ больше не действует.",
  stop: "Не получайте товар и не платите по этому документу",
  stopHint: "Заявка отменена предприятием.",
  state: "Статус", stateShort: "Статус", date: "Дата",
  status: { DRAFT: "На рассмотрении", BLOCKED: "На рассмотрении", CONFIRMED: "Принята", IN_PRODUCTION: "В производстве", DELIVERED: "Доставлена", CLOSED: "Завершена", CANCELLED: "Отменена" },
  steps: ["Принята", "Производство", "Доставка", "Завершена"],
  stepsDone: ["Принята", "Произведено", "Доставлено", "Завершена"],
  stepsPending: ["Приём", "Производство", "Доставка", "Завершена"],
  client: "Клиент", object: "Объект", delivery: "Доставка", deliveredOn: "Доставлено", unknown: "Согласовывается",
  items: "ТОВАРЫ", total: "Итого", paid: "Оплачено", rest: "Остаток", fullyPaid: "Полностью оплачено", som: "сум", deliveryFee: "Доставка",
  trips: (n: number) => `ОТГРУЗКИ · ${n} РЕЙС.`, tripStatus: { PLANNED: "Запланирован", LOADED: "Загружен", ON_ROAD: "В пути", DELIVERED: "Доставлен" },
  check: "Клиент, дата и итоговая сумма на бумаге должны совпадать с этим экраном.",
  manager: "Ваш менеджер", speedUp: "Нужно ускорить?", again: "Хотите заказать ещё?", againHint: "Менеджер повторит на тех же условиях",
  question: "Есть вопросы?", managerShort: "Менеджер", call: "Позвонить", callManager: "Позвонить менеджеру", telegram: "Telegram",
  staff: "Вы сотрудник? Открыть в ERP", checked: "Проверено", refresh: "Обновить",
};

/** Holat belgisi ranglari (pill fon / matn / nuqta) */
const PILL: Record<string, [string, string, string]> = {
  CONFIRMED: ["#eff6ff", "#1447e6", "#155dfc"],
  IN_PRODUCTION: ["#f5f3ff", "#6d28d9", "#7c3aed"],
  DELIVERED: ["#ecfdf5", "#007a55", "#009966"],
};

/**
 * Ommaviy sahifa — zayavka hujjatidagi QR skanerlanganda ochiladi (login yo'q). Kim skanerlasa ham
 * (mijoz, uning buxgalteri, obyektdagi prorab, haydovchi) bir savolga javob oladi: «hujjat haqiqiymi va
 * zayavka hozir qayerda?». Ko'rinish — artifakt «QR ochilish ekrani»: tasdiqlanmagan / jarayonda / yakunlangan /
 * bekor qilingan. Ko'rsatiladi: bosqichlar, mahsulotlar va summa (qog'oz bilan solishtirish uchun), to'lov qoldig'i,
 * nakladnoylar (har biri o'z tekshiruv sahifasiga), menejer bilan bog'lanish. Ichki narsalar (tannarx,
 * brigada, izoh, kredit limiti) chiqmaydi. Kalit mos kelmasa — 404, raqam mavjudligi ham oshkor bo'lmaydi.
 */
export default async function PublicOrderPage({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ k?: string; lang?: string }> }) {
  const { no: rawNo } = await params;
  const { k, lang: langQ } = await searchParams;
  const no = decodeURIComponent(rawNo);
  if (!orderQrValid(no, k)) notFound();
  const o = await db.order.findUnique({
    where: { orderNo: no },
    include: {
      customer: { select: { name: true } },
      site: { select: { name: true } },
      createdBy: { select: { fullName: true, employee: { select: { phone: true } } } },
      items: { include: { product: { select: { name: true, unit: true } }, tasks: { select: { doneQty: true } } } },
      batches: { select: { qtyM3: true, product: { select: { unit: true } } } },
      trips: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, select: { deliveryNoteNo: true, verifyToken: true, status: true, qtyM3: true, acceptedQty: true, loadedAt: true, deliveredAt: true, createdAt: true } },
      invoices: { where: { status: { not: "CANCELLED" } }, select: { payments: { select: { id: true, amount: true } } } },
      payments: { select: { id: true, amount: true } },
    },
  });
  if (!o || o.kind === "STOCK") notFound();
  const company = await getCompany();
  const lang = asOfferLang(langQ);
  const T = lang === "ru" ? RU : UZ;
  const now = new Date();

  const itemRows = o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }));
  const unit = soleUnit(itemRows);
  const total = orderTotal(o);
  const paidMap = new Map<string, number>();
  for (const i of o.invoices) for (const x of i.payments) paidMap.set(x.id, Number(x.amount));
  for (const x of o.payments) paidMap.set(x.id, Number(x.amount));
  const paid = [...paidMap.values()].reduce((a, b) => a + b, 0);
  const rest = Math.max(0, total - paid);
  const paidPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  // Ishlab chiqarilgani: dona mahsulot — brigada topshirig'i (zayavka sahifasidagi bilan bir xil qoida).
  // Beton sexga tushmaydi (to'g'ridan-to'g'ri logistikaga): faqat betonli zayavkada bu bosqich qabul bilan yopiq
  const workRows = itemRows.filter((r) => r.unit !== "m3");
  const producedRows = o.items.filter((i) => i.product.unit !== "m3" && i.tasks.length).map((i) => ({ unit: i.product.unit, qty: i.tasks.reduce((s, t) => s + Number(t.doneQty), 0) }));
  const totalQty = itemRows.reduce((s, r) => s + Number(r.qty), 0);
  const delivered = o.trips.filter((t) => t.status === "DELIVERED").reduce((s, t) => s + Number(t.acceptedQty ?? t.qtyM3), 0);
  const cancelled = o.status === "CANCELLED";
  const pending = o.status === "DRAFT" || o.status === "BLOCKED";
  const closed = o.status === "CLOSED";
  const done = ["DELIVERED", "CLOSED"].includes(o.status);
  const producedPct = done || !workRows.length ? 100 : donePercent(producedRows, workRows);
  const shippedPct = done ? 100 : totalQty > 0 ? Math.min(100, (delivered / totalQty) * 100) : 0;
  const stepPct = pending ? [0, 0, 0, 0] : [100, producedPct, shippedPct, closed ? 100 : 0];
  const overall = stepPct.reduce((a, b) => a + b, 0) / 4;
  const current = stepPct.findIndex((p) => p < 100);
  const lastDelivery = o.trips.filter((t) => t.deliveredAt).map((t) => t.deliveredAt!).sort((a, b) => b.getTime() - a.getTime())[0];

  const managerPhone = o.createdBy.employee?.phone ?? company.phone ?? null;
  const telegram = telegramUrl(company.telegram);
  const site = o.site?.name ?? o.deliveryAddress;
  const otherLang = lang === "ru" ? "uz" : "ru";
  const self = orderPublicPath(o.orderNo, lang === "ru" ? "ru" : undefined);
  const pill = PILL[o.status] ?? PILL.CONFIRMED;

  const head = cancelled
    ? { tone: "red" as const, title: T.cancelled, sub: T.cancelledSub, badge: "x" as const, effect: undefined }
    : pending
      ? { tone: "amber" as const, title: T.genuine, sub: T.pendingSub, badge: "clock" as const, effect: undefined }
      : closed
        ? { tone: "amber" as const, title: T.closedTitle, sub: rest <= 0 ? T.closedSubPaid : T.closedSub, badge: "check" as const, effect: "confetti" as const }
        : { tone: "amber" as const, title: T.genuine, sub: T.genuineSub, badge: "check" as const, effect: "sparks" as const };

  const products = (
    <>
      <span className={qrCaption}>{T.items}</span>
      {o.items.map((i) => (
        <div key={i.id} className="flex items-center gap-3">
          <QrItemTile name={i.product.name} tone={cancelled ? "gray" : "amber"} />
          <div className="flex min-w-0 flex-1 flex-col"><span className="text-[14px] font-bold">{i.product.name}</span><span className="text-[12.5px] text-[#5f7088]">{fmtNum(i.qtyM3, 3)} {unitLabel(i.product.unit)}</span></div>
          <span className="shrink-0 text-[14px] font-bold tabular-nums">{fmtNum(Number(i.qtyM3) * Number(i.price))}</span>
        </div>
      ))}
      {Number(o.deliveryFee) > 0 && (
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f0f9ff] text-[#0069a8]"><Truck size={22} aria-hidden /></div>
          <span className="flex-1 text-[14px] font-bold">{T.deliveryFee}</span>
          <span className="shrink-0 text-[14px] font-bold tabular-nums">{fmtNum(o.deliveryFee)}</span>
        </div>
      )}
      <div className="h-px bg-[#f1f5f9]" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold">{T.total}</span>
        <span className={`text-[26px] font-extrabold tracking-[-.02em] tabular-nums ${cancelled ? "vf-strike text-[#5f7088]" : ""}`}>{fmtNum(total)} <span className="text-[14px] font-semibold text-[#5f7088]">{T.som}</span></span>
      </div>
      {!cancelled && !pending && total > 0 && (
        <div className="flex flex-col gap-2">
          <div className="relative h-2 overflow-hidden rounded-full bg-[#fef3c7]"><div className="vf-fill absolute inset-y-0 left-0 rounded-full bg-[#009966]" style={{ width: `${Math.round(paidPct)}%` }} /></div>
          {rest <= 0
            ? <div className="flex justify-between text-[13px] font-bold text-[#007a55]"><span>{T.fullyPaid}</span><span>{T.rest} 0</span></div>
            : <div className="flex justify-between gap-3 text-[13px] font-semibold"><span className="text-[#007a55]">{T.paid} {fmtNum(paid)}</span><span className="text-[#bb4d00]">{T.rest} {fmtNum(rest)}</span></div>}
        </div>
      )}
    </>
  );

  const fields = (
    <section className={`${qrUp(3)} grid grid-cols-2 gap-x-3 gap-y-3.5 ${qrCard} ${cancelled ? "opacity-85" : ""}`}>
      <QrField label={T.client} value={o.customer.name} />
      <QrField label={T.date} value={date(o.date)} />
      <QrField label={T.object} value={site || "—"} />
      {cancelled
        ? <QrField label={T.stateShort} value={T.status.CANCELLED} />
        : closed && lastDelivery
          ? <QrField label={T.deliveredOn} value={date(lastDelivery)} />
          : <QrField label={T.delivery} value={o.dateUnknown ? T.unknown : `${date(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""}`} />}
    </section>
  );

  return (
    <QrScreen lang={lang} head={{
      ...head, brand: company.legalName ?? company.name, brandSub: T.subtitle, eyebrow: T.eyebrow,
      badgeLabel: T.status[o.status] ?? T.genuine,
      corner: <QrLangLink href={orderPublicPath(o.orderNo, otherLang)} label={otherLang === "ru" ? "Рус" : "O'zb"} dark={cancelled} />,
    }}>
      {cancelled ? (
        <section className={`${qrUp(2)} flex items-start gap-3 rounded-[18px] bg-[#fef2f2] px-[18px] py-4 shadow-[inset_0_0_0_1.5px_#ffc9c9]`}>
          <Ban size={22} className="mt-px shrink-0 text-[#c10007]" aria-hidden />
          <div className="flex flex-col gap-0.5"><span className="text-[14px] font-bold text-[#82181a]">{T.stop}</span><span className="text-[13px] leading-[19px] text-[#82181a]">{T.stopHint}</span></div>
        </section>
      ) : (
        <section className={`${qrUp(2)} flex flex-col gap-3.5 ${qrCard}`}>
          <div className="flex items-center justify-between gap-2.5">
            <span className="text-[17px] font-bold">{T.state}</span>
            {pending
              ? <QrPill className="bg-[#fffbeb] text-[#bb4d00]"><span className="vf-dotc h-2 w-2 rounded-full bg-[#e17100] [--pc:rgba(225,113,0,.55)]" />{T.status[o.status]}</QrPill>
              : closed
                ? <QrPill className="bg-[#009966] text-[#ffffff]">{T.status.CLOSED}</QrPill>
                : <span className="inline-flex shrink-0 items-center gap-[7px] rounded-full px-3 py-1.5 text-[13px] font-bold" style={{ background: pill[0], color: pill[1] }}><span className="vf-dotc h-2 w-2 rounded-full" style={{ background: pill[2], ["--pc" as string]: `${pill[2]}8c` }} />{T.status[o.status]}</span>}
          </div>
          <div className={`relative h-2.5 overflow-hidden rounded-full ${pending ? "bg-[#fef3c7]" : "bg-[#f1f5f9]"}`}>
            {pending ? <div className="vf-scan" /> : <div className="vf-fill absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(overall)}%`, background: closed ? "#009966" : pill[2] }} />}
          </div>
          <ol className="grid grid-cols-4 gap-1.5 text-center text-[11.5px] leading-[15px] font-semibold">
            {stepPct.map((p, i) => {
              const isDone = p >= 100, isCur = i === current;
              const color = isDone ? "#009966" : isCur ? (pending ? "#e17100" : pill[2]) : null;
              return (
                <li key={i} className="flex flex-col items-center gap-1.5" style={{ color: isDone ? "#007a55" : isCur ? (pending ? "#bb4d00" : pill[1]) : "#5f7088" }}>
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-extrabold ${closed ? `vf-st` : ""} ${isCur && !isDone ? "vf-dotc" : ""}`}
                    style={{ background: color ?? "#f1f5f9", color: color ? "#ffffff" : undefined, animationDelay: closed ? `${1.1 + i * 0.25}s` : undefined, ["--pc" as string]: color ? `${color}8c` : undefined }}>
                    {isDone ? <Check size={15} strokeWidth={3} aria-hidden /> : i + 1}
                  </span>
                  {(closed ? T.stepsDone : pending ? T.stepsPending : T.steps)[i]}
                  {!isDone && p > 0 && <span className="text-[11px] tabular-nums opacity-80">{Math.round(p)}%</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {pending && (
        <section className={`${qrUp(3)} flex items-start gap-3 rounded-[18px] bg-[#fffbeb] px-[18px] py-4`}>
          <Clock size={22} className="mt-px shrink-0 text-[#bb4d00]" aria-hidden />
          <div className="flex flex-col gap-0.5 text-[#7c2d12]">
            <span className="text-[14px] font-bold">{T.reviewing}<span className="vf-dots" aria-hidden><span>.</span><span>.</span><span>.</span></span></span>
            <span className="text-[13px] leading-[19px]">{T.reviewHint}</span>
          </div>
        </section>
      )}

      {fields}

      <section className={`${qrUp(4)} flex flex-col gap-3.5 ${qrCard}`}>{products}</section>

      {!cancelled && !pending && o.trips.length > 0 && (
        <section className={`${qrUp(5)} flex flex-col gap-3 ${qrCard}`}>
          <span className={qrCaption}>{T.trips(o.trips.length)}</span>
          {o.trips.map((t) => {
            const when = t.deliveredAt ?? t.loadedAt ?? t.createdAt;
            const ok = t.status === "DELIVERED";
            return (
              <div key={t.deliveryNoteNo} className="flex items-center gap-3">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-[#009966]" : "bg-[#155dfc]"}`} />
                {t.verifyToken
                  ? <a href={`/verify/${encodeURIComponent(t.deliveryNoteNo)}?k=${t.verifyToken}`} className="min-w-0 flex-1 truncate text-[14px] font-bold text-[#1447e6] no-underline">{t.deliveryNoteNo}</a>
                  : <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{t.deliveryNoteNo}</span>}
                <span className="shrink-0 text-[13px] text-[#5f7088] tabular-nums">{fmtNum(t.acceptedQty ?? t.qtyM3, 3)}{unit ? ` ${unitLabel(unit)}` : ""} · {date(when).slice(0, 5)}</span>
                {!ok && <span className="shrink-0 rounded-full bg-[#eff6ff] px-2.5 py-1 text-[12px] font-bold text-[#1447e6]">{T.tripStatus[t.status] ?? t.status}</span>}
              </div>
            );
          })}
        </section>
      )}

      <section className={`${qrUp(6)} vf-noprint flex flex-col gap-3.5 rounded-[18px] bg-[#0f172b] p-[18px] text-[#ffffff]`}>
        <div className="flex items-center gap-3">
          {!closed && <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f59e0b] text-[15px] font-extrabold text-[#0f172b]">{o.createdBy.fullName.trim().charAt(0).toUpperCase()}</div>}
          <div className="flex min-w-0 flex-col">
            <span className="text-[15px] font-bold">{cancelled ? T.question : pending ? T.speedUp : closed ? T.again : T.manager}</span>
            <span className="text-[13px] opacity-75">{closed ? T.againHint : [pending || cancelled ? `${T.managerShort}: ${o.createdBy.fullName}` : o.createdBy.fullName, managerPhone].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        {cancelled
          ? managerPhone && <a href={telHref(managerPhone)} className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] bg-[#ffffff] text-[14px] font-extrabold text-[#0f172b] no-underline"><Phone size={18} aria-hidden />{T.callManager}</a>
          : (managerPhone || telegram) && (
            <div className={`grid gap-2.5 ${managerPhone && telegram ? "grid-cols-2" : "grid-cols-1"}`}>
              {managerPhone && <a href={telHref(managerPhone)} className={`${qrBtnAmber} vf-shine`}><Phone size={18} aria-hidden />{T.call}</a>}
              {telegram && <a href={telegram} target="_blank" rel="noopener" className={qrBtnTelegram}><Send size={18} aria-hidden />{T.telegram}</a>}
            </div>
          )}
      </section>

      {!cancelled && <p className={`${qrUp(7)} m-0 flex items-start justify-center gap-1.5 px-3 text-center text-[12.5px] leading-[18px] text-[#5f7088]`}><ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden />{T.check}</p>}
      <QrFooter checked={`${T.checked} ${dateTime(now)}`} refresh={T.refresh} href={self} color={cancelled ? "#c10007" : "#b45309"} staff={{ href: `/orders/${o.id}`, label: T.staff }} />
    </QrScreen>
  );
}
