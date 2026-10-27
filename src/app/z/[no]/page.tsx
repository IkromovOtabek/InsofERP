import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck, ShieldAlert, Hourglass, Ban, Phone, Send, MapPin, UserRound, Clock, Check, Factory, Truck, Flag, ClipboardCheck, FileText, LogIn } from "lucide-react";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { date, dateTime, fmtNum } from "@/lib/format";
import { orderQrValid, orderPublicPath } from "@/lib/order-qr";
import { asOfferLang } from "@/lib/offer-i18n";
import { donePercent, soleUnit, unitLabel } from "@/lib/unit";
import { LogoMark } from "@/components/logo";
import { orderTotal } from "@/lib/order-total";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const UZ = {
  subtitle: "Temir-beton mahsulotlari",
  genuine: "Haqiqiy hujjat",
  genuineHint: "Zayavka korxona tizimida ro'yxatga olingan. Ma'lumot real vaqtda ko'rsatilmoqda.",
  pending: "Haqiqiy hujjat — hali tasdiqlanmagan",
  pendingHint: "Zayavka ro'yxatga olingan, korxona uni ko'rib chiqmoqda. Tasdiqlangach ishlab chiqarishga tushadi.",
  cancelled: "Zayavka bekor qilingan",
  cancelledHint: "Bu hujjat amal qilmaydi. Savol bo'lsa menejerga qo'ng'iroq qiling.",
  title: "Zayavka", date: "Sana",
  status: { DRAFT: "Ko'rib chiqilmoqda", BLOCKED: "Ko'rib chiqilmoqda", CONFIRMED: "Qabul qilingan", IN_PRODUCTION: "Ishlab chiqarilmoqda", DELIVERED: "Yetkazib berilgan", CLOSED: "Yakunlangan", CANCELLED: "Bekor qilingan" } as Record<string, string>,
  steps: ["Qabul qilindi", "Ishlab chiqarish", "Yetkazib berish", "Yakunlandi"],
  client: "Mijoz", object: "Obyekt", delivery: "Yetkazish sanasi", unknown: "Kelishilmoqda", manager: "Menejer",
  items: "Mahsulotlar", qty: "Soni", sum: "Summa", total: "Jami", paid: "To'langan", rest: "Qoldiq", som: "so'm", deliveryFee: "Dastavka",
  trips: "Yetkazib berishlar", tripStatus: { PLANNED: "Rejada", LOADED: "Yuklangan", ON_ROAD: "Yo'lda", DELIVERED: "Yetkazildi" } as Record<string, string>,
  noTrips: "Hali jo'natma yo'q",
  check: "Qog'ozdagi mijoz, sana va jami summa shu sahifadagi bilan bir xil bo'lishi kerak. Farq bo'lsa — hujjat o'zgartirilgan bo'lishi mumkin, menejerga qo'ng'iroq qiling.",
  contact: "Bog'lanish", call: "Qo'ng'iroq qilish", telegram: "Telegram'da yozish", map: "Zavod xaritada",
  staff: "Korxona xodimimisiz? ERP'da ochish",
  checked: "Tekshirilgan vaqt",
};

const RU: typeof UZ = {
  subtitle: "Железобетонные изделия",
  genuine: "Подлинный документ",
  genuineHint: "Заявка зарегистрирована в системе предприятия. Данные показаны в реальном времени.",
  pending: "Подлинный документ — ещё не подтверждён",
  pendingHint: "Заявка зарегистрирована, предприятие её рассматривает. После подтверждения она уйдёт в производство.",
  cancelled: "Заявка отменена",
  cancelledHint: "Документ недействителен. По вопросам звоните менеджеру.",
  title: "Заявка", date: "Дата",
  status: { DRAFT: "На рассмотрении", BLOCKED: "На рассмотрении", CONFIRMED: "Принята", IN_PRODUCTION: "В производстве", DELIVERED: "Доставлена", CLOSED: "Завершена", CANCELLED: "Отменена" },
  steps: ["Принята", "Производство", "Доставка", "Завершена"],
  client: "Клиент", object: "Объект", delivery: "Дата доставки", unknown: "Согласовывается", manager: "Менеджер",
  items: "Товары", qty: "Кол-во", sum: "Сумма", total: "Итого", paid: "Оплачено", rest: "Остаток", som: "сум", deliveryFee: "Доставка",
  trips: "Отгрузки", tripStatus: { PLANNED: "Запланирован", LOADED: "Загружен", ON_ROAD: "В пути", DELIVERED: "Доставлен" },
  noTrips: "Отгрузок пока нет",
  check: "Клиент, дата и итоговая сумма на бумаге должны совпадать с этой страницей. Если есть разница — документ мог быть изменён, позвоните менеджеру.",
  contact: "Связаться", call: "Позвонить", telegram: "Написать в Telegram", map: "Завод на карте",
  staff: "Вы сотрудник? Открыть в ERP",
  checked: "Время проверки",
};

/**
 * Ommaviy sahifa — zayavka hujjatidagi QR skanerlanganda ochiladi (login yo'q). Kim skanerlasa ham
 * (mijoz, uning buxgalteri, obyektdagi prorab, haydovchi) bir savolga javob oladi: «hujjat haqiqiymi va
 * zayavka hozir qayerda?». Ko'rsatiladi: haqiqiylik va holat, bosqichlar (qabul → ishlab chiqarish → yetkazish
 * → yakun) foizlari bilan, mahsulotlar va summa (qog'oz bilan solishtirish uchun), to'lov qoldig'i,
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

  const itemRows = o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }));
  const unit = soleUnit(itemRows);
  const total = orderTotal(o);
  const paidMap = new Map<string, number>();
  for (const i of o.invoices) for (const x of i.payments) paidMap.set(x.id, Number(x.amount));
  for (const x of o.payments) paidMap.set(x.id, Number(x.amount));
  const paid = [...paidMap.values()].reduce((a, b) => a + b, 0);
  const rest = Math.max(0, total - paid);

  // Ishlab chiqarilgani: dona mahsulot — brigada topshirig'i, beton — zames (zayavka sahifasidagi bilan bir xil qoida)
  const producedRows = [
    ...o.items.filter((i) => i.product.unit !== "m3" && i.tasks.length).map((i) => ({ unit: i.product.unit, qty: i.tasks.reduce((s, t) => s + Number(t.doneQty), 0) })),
    ...o.batches.filter((b) => b.product.unit === "m3").map((b) => ({ unit: b.product.unit, qty: b.qtyM3 })),
  ];
  const totalQty = itemRows.reduce((s, r) => s + Number(r.qty), 0);
  const delivered = o.trips.filter((t) => t.status === "DELIVERED").reduce((s, t) => s + Number(t.acceptedQty ?? t.qtyM3), 0);
  const cancelled = o.status === "CANCELLED";
  const pending = o.status === "DRAFT" || o.status === "BLOCKED";
  const closed = o.status === "CLOSED";
  const done = ["DELIVERED", "CLOSED"].includes(o.status);
  const producedPct = done ? 100 : donePercent(producedRows, itemRows);
  const shippedPct = done ? 100 : totalQty > 0 ? Math.min(100, (delivered / totalQty) * 100) : 0;
  const steps = [
    { icon: ClipboardCheck, label: T.steps[0], pct: pending || cancelled ? 0 : 100 },
    { icon: Factory, label: T.steps[1], pct: pending || cancelled ? 0 : producedPct },
    { icon: Truck, label: T.steps[2], pct: pending || cancelled ? 0 : shippedPct },
    { icon: Flag, label: T.steps[3], pct: closed ? 100 : 0 },
  ];

  const managerPhone = o.createdBy.employee?.phone ?? company.phone ?? null;
  const telegram = company.telegram ? (company.telegram.startsWith("http") ? company.telegram : `https://t.me/${company.telegram.replace(/^@/, "")}`) : null;
  const mapUrl = company.lat != null && company.lng != null ? `https://maps.google.com/?q=${company.lat},${company.lng}` : null;
  const STATE = cancelled
    ? { icon: Ban, cls: "bg-red-50 border-red-200 text-red-900", title: T.cancelled, text: T.cancelledHint }
    : pending
      ? { icon: Hourglass, cls: "bg-amber-50 border-amber-200 text-amber-900", title: T.pending, text: T.pendingHint }
      : { icon: ShieldCheck, cls: "bg-emerald-50 border-emerald-200 text-emerald-900", title: T.genuine, text: T.genuineHint };
  const otherLang = lang === "ru" ? "uz" : "ru";
  const row = "flex justify-between gap-3 border-b border-slate-100 py-1.5";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LogoMark className="h-11 w-11" />
            <div>
              <div className="text-base font-semibold leading-tight">{company.legalName ?? company.name}</div>
              <div className="text-xs text-slate-500">{T.subtitle}</div>
            </div>
          </div>
          <a href={orderPublicPath(o.orderNo, otherLang)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700">{otherLang === "ru" ? "Рус" : "O'zb"}</a>
        </header>

        {/* Haqiqiylik va holat */}
        <section className={`flex items-start gap-3 rounded-2xl border p-4 ${STATE.cls}`}>
          <STATE.icon size={28} className="mt-0.5 shrink-0" />
          <div>
            <div className="text-lg font-semibold leading-tight">{STATE.title}</div>
            <div className="mt-0.5 text-sm opacity-90">{STATE.text}</div>
          </div>
        </section>

        {/* Bosqichlar */}
        {!cancelled && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-xl font-bold tracking-tight">{T.title}</h1>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{T.status[o.status]}</span>
            </div>
            <ol className="mt-4 grid grid-cols-4 gap-2">
              {steps.map((s) => (
                <li key={s.label} className="text-center">
                  <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${s.pct >= 100 ? "bg-emerald-600 text-white" : s.pct > 0 ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-400"}`}>
                    {s.pct >= 100 ? <Check size={18} /> : <s.icon size={18} />}
                  </div>
                  <div className="mt-1.5 text-[11.5px] font-medium leading-tight">{s.label}</div>
                  <div className="mx-auto mt-1 h-1.5 w-full max-w-[90px] overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(s.pct)}%` }} /></div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">{Math.round(s.pct)}%</div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Hujjat: qog'oz bilan solishtirish uchun */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          {cancelled && <h1 className="mb-3 text-xl font-bold tracking-tight">{T.title}</h1>}
          <dl className="grid gap-x-6 text-sm sm:grid-cols-2">
            <div className={row}><dt className="text-slate-500">{T.date}</dt><dd className="font-semibold">{date(o.date)}</dd></div>
            <div className={row}><dt className="text-slate-500">{T.client}</dt><dd className="text-right font-medium">{o.customer.name}</dd></div>
            <div className={row}><dt className="text-slate-500">{T.delivery}</dt><dd>{o.dateUnknown ? T.unknown : `${date(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""}`}</dd></div>
            {o.deliveryAddress && <div className={row}><dt className="text-slate-500">{T.object}</dt><dd className="text-right">{o.deliveryAddress}</dd></div>}
          </dl>

          <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">{T.items}</h2>
          <table className="mt-2 w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {o.items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-2 font-medium">{i.product.name}</td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{fmtNum(i.qtyM3, 3)} {unitLabel(i.product.unit)}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{fmtNum(Number(i.qtyM3) * Number(i.price))}</td>
                </tr>
              ))}
              {Number(o.deliveryFee) > 0 && (
                <tr><td colSpan={2} className="py-2 pr-2 font-medium">{T.deliveryFee}</td><td className="py-2 text-right font-semibold tabular-nums">{fmtNum(o.deliveryFee)}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr><td colSpan={2} className="pr-3 pt-3 text-right font-semibold">{T.total}</td><td className="whitespace-nowrap pt-3 text-right text-lg font-bold tabular-nums">{fmtNum(total)} <span className="text-sm font-medium text-slate-500">{T.som}</span></td></tr>
              {!cancelled && <tr><td colSpan={2} className="py-0.5 text-right text-slate-600">{T.paid}</td><td className="py-0.5 text-right tabular-nums">{fmtNum(paid)}</td></tr>}
              {!cancelled && <tr><td colSpan={2} className="py-0.5 text-right font-semibold">{T.rest}</td><td className={`py-0.5 text-right font-semibold tabular-nums ${rest > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmtNum(rest)}</td></tr>}
            </tfoot>
          </table>
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-slate-500" /> {T.check}</p>
        </section>

        {/* Yetkazib berishlar — har nakladnoy o'z QR tekshiruv sahifasiga */}
        {!cancelled && !pending && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{T.trips}</h2>
            {o.trips.length === 0 ? <p className="mt-2 text-sm text-slate-500">{T.noTrips}</p> : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {o.trips.map((t) => {
                  const when = t.deliveredAt ?? t.loadedAt;
                  return (
                    <li key={t.deliveryNoteNo} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText size={15} className="shrink-0 text-slate-400" />
                        {t.verifyToken ? <a href={`/verify/${encodeURIComponent(t.deliveryNoteNo)}?k=${t.verifyToken}`} className="font-medium text-sky-700 underline">{t.deliveryNoteNo}</a> : <span className="font-medium">{t.deliveryNoteNo}</span>}
                        <span className="truncate text-xs text-slate-500">{when ? dateTime(when) : date(t.createdAt)}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums">{fmtNum(t.acceptedQty ?? t.qtyM3, 3)}{unit ? ` ${unitLabel(unit)}` : ""}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.status === "DELIVERED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{T.tripStatus[t.status] ?? t.status}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* Bog'lanish */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{T.contact}</h2>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600"><UserRound size={22} /></div>
            <div>
              <div className="font-semibold">{o.createdBy.fullName}</div>
              <div className="text-sm text-slate-600">{T.manager}{managerPhone ? ` · ${managerPhone}` : ""}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {managerPhone && <a href={`tel:${managerPhone.replace(/[^\d+]/g, "")}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"><Phone size={16} /> {T.call}</a>}
            {telegram && <a href={telegram} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800"><Send size={16} /> {T.telegram}</a>}
            {mapUrl && <a href={mapUrl} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800"><MapPin size={16} /> {T.map}</a>}
          </div>
          {company.address && <div className="mt-3 flex items-start gap-1.5 text-xs text-slate-500"><MapPin size={13} className="mt-0.5 shrink-0" /> {company.address}</div>}
        </section>

        <footer className="space-y-2 pb-4 text-center text-[11px] text-slate-400">
          <div className="flex items-center justify-center gap-1.5"><Clock size={12} /> {T.checked}: {dateTime(new Date())}</div>
          {/* Xodim uchun — login talab qilinadi, ruxsat sahifa himoyasida tekshiriladi */}
          <a href={`/orders/${o.id}`} className="inline-flex items-center gap-1 text-slate-500 underline"><LogIn size={12} /> {T.staff}</a>
        </footer>
      </div>
    </main>
  );
}
