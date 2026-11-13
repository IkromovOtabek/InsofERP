import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, PackageCheck, Trash2, Truck, Package, Clock, MapPin, MapPinned, Smartphone, Route, AlertTriangle, Coins, UserRoundCheck, FileSpreadsheet, Undo2 } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";
import { fuelNormText, PAY_TYPE_LABEL, payTrips } from "@/lib/driver-trip-pay";
import { PriceForm } from "../../logistika/tabel/tabel-forms";
import { qty, date, dateTime, opAt } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, DL, LinkButton, PageHeader, StatCard, StatusSteps } from "@/components/ui";
import { cancelTrip } from "../actions";
import { cancelExpense, cancelFuel } from "../../logistika/actions";
import { ConfirmButton } from "../../payments/confirm-button";
import { ISSUE_KIND, EXPENSE_KIND, FUEL_TYPE, VEHICLE_TYPE, DRUM_MAX_MIN, isConcreteTrip, PHASE_STEPS, TRIP_PHASE, tripPhase, tripPlannedAt, tripDelayMin, delayLevel, logisticsSettings, minutesLabel } from "@/lib/logistics";
import { lastFuelPrice } from "@/lib/logistics-costs";
import { cancelNote, cancellerNames } from "@/lib/cancelled";
import { money } from "@/lib/format";
import { CloseTripForm, DriverDeliverForm, DriverStepButton, LoadButton, ReportIssueForm, ResolveIssueForm, TripCostForm, TtnForm } from "./trip-extras";
import { DelayText, PhaseBadge } from "../../logistika/ui";
import { distanceLabel, tripLine, tripTrack, tripTrackStats } from "@/lib/trips";
import { tripActivity } from "@/lib/activity";
import { ActivityLog } from "@/components/activity-log";
import { TripTrackMap } from "./track-map";
import { unitLabel, soleUnit } from "@/lib/unit";
import { PickupForm } from "./pickup-form";
import { EcoSyncButtons } from "./eco-sync";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { geoSearchEnabled } from "@/lib/geo";

// TZ reys bosqichlari: yuklash kutilmoqda → … → yetkazildi → yopildi (oraliqlari vaqt belgilaridan)
const STEPS = PHASE_STEPS.map((k) => ({ key: k, label: TRIP_PHASE[k].label }));
const dt = (d: Date | null) => d ? dateTime(d) : "—";

/** `2026-11` — Hisob varag'i oyi (reys yetkazilgan oy). */
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** `104` → `1 soat 44 daq` — yo'lda o'tgan vaqt. */
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} soat ${m % 60} daq` : `${m} daq`);

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePage("/trips");
  const t = await db.trip.findUnique({
    where: { id },
    include: {
      order: { include: { customer: true, site: true, items: { include: { product: true } } } }, vehicle: true, driver: true,
      issues: { orderBy: { createdAt: "desc" } },
      fuelLogs: { orderBy: { date: "desc" } }, expenses: { orderBy: { date: "desc" } },
    },
  });
  if (!t || !s) notFound();
  const marks = await customerMarks([t.order.customerId]);
  const activity = await tripActivity(id);
  // Haydovchi ilovasidan kelgan GPS izi — qaysi yo'ldan yurgani va necha km bosgani
  const track = await tripTrack(id);
  const trackStat = (await tripTrackStats([id])).get(id);
  // Yuk olgan joyi hali belgilanmagan bo'lsa zavod ko'rsatiladi — reyslarning ko'pchiligi zavoddan chiqadi
  const plant = await db.companySettings.findUnique({ where: { id: "main" }, select: { name: true, address: true, lat: true, lng: true } });
  const blacklisted = marks.black.has(t.order.customerId);
  // Kim nima qiladi (har kim o'z ishiga javob beradi):
  //  • dispetcher (LOGISTICS) — reysni ochadi/bekor qiladi, ECO'ga yuboradi, muammoni hal qiladi, reysni yopadi;
  //  • ishlab chiqarish — "Yuklandi" (mikser zavodda yuklandi, skladdan chiqim);
  //  • haydovchi — yo'l bosqichlari (yukladim, yo'lga chiqdim, yetib keldim, tushirishni boshladim, yetkazdim, qaytdim) o'z ilovasidan;
  //    ilovasi bo'lmasa (hozircha hammasida) logistika / dispetcher «Haydovchi o'rniga» blokidan o'sha tugmalarni bosadi
  //    (`trips → driver`), «Yetkazdim» dan keyin mashinaning Hisob varag'i reys qatori tahriri bilan ochiladi;
  //  • direktor — dispetcher va ishlab chiqarish tugmalarini ham ko'radi.
  const canLog = ["LOGISTICS", "DIRECTOR"].includes(s.role);
  const canLoad = ["PRODUCTION", "DIRECTOR"].includes(s.role);
  const canDriver = t.status !== "CANCELLED" && !t.closedAt && (canDo(s, "trips", "driver") || canDo(s, "trips", "move"));
  const ledgerHref = canDo(s, "logistika", "ledger") && pathAllowed("/logistika/tabel", s.role, s.perms)
    ? `/logistika/tabel?bolim=hisob&transport=${t.vehicleId}&oy=${ym(t.deliveredAt ?? new Date())}&tahrir=${id}` : null;
  const canPlan = canLog || canLoad;
  const canResolve = canDo(s, "trips", "resolve");
  // O'chirish — ruxsatlar daraxti bo'yicha (trips → cancel), yuklanmagan reysgina
  const canCancel = canDo(s, "trips", "cancel");
  const pay = t.status === "DELIVERED" ? (await payTrips({ id, status: "DELIVERED" }, 1))[0] ?? null : null;
  const driverPhase = ["LOADED", "ON_ROAD"].includes(t.status) || (t.status === "DELIVERED" && !t.returnedAt);
  // Reys miqdori zayavkadagi mahsulot birligida ko'rsatiladi (beton m³, dona mahsulot dona)
  // Aralash zayavkada reysning qatori texnika turidan aniqlanadi (beton — mikser, dona — yuk mashina)
  const line = tripLine(t.order.items, t.vehicle.type);
  const tripUnit = "error" in line ? soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) : line.unit;
  const tripProduct = "error" in line ? t.order.items[0]?.product.name : t.order.items.find((i) => i.productId === line.productId)?.product.name;
  const phase = tripPhase(t);
  const settings = await logisticsSettings();
  const planned = tripPlannedAt(t, t.order);
  const delay = tripDelayMin(t, t.order);
  const openIssues = t.issues.filter((i) => !i.resolvedAt);
  // Bekor qilingan xarajat ro'yxatda belgisi bilan qoladi, jamiga kirmaydi
  const cNames = await cancellerNames([...t.fuelLogs, ...t.expenses]);
  const costs = [...t.fuelLogs.map((f) => ({ id: f.id, fuel: true, date: f.date, createdAt: f.createdAt, label: `Yoqilg'i · ${FUEL_TYPE[f.fuelType]} ${Number(f.liters)} l`, note: f.note, amount: Number(f.amount), cancel: cancelNote(f, cNames) })),
    ...t.expenses.map((e) => ({ id: e.id, fuel: false, date: e.date, createdAt: e.createdAt, label: EXPENSE_KIND[e.kind], note: e.note, amount: Number(e.amount), cancel: cancelNote(e, cNames) }))].sort((a, b) => b.date.getTime() - a.date.getTime());
  const costSum = costs.filter((c) => !c.cancel).reduce((a, c) => a + c.amount, 0);
  // Xarajatni bekor qilish — Yoqilg'i / Transport xarajatlari sahifalari bilan bir xil (`cancelFuel` / `cancelExpense` → `logistika` → `fuel`)
  const canCancelCost = canDo(s, "logistika", "fuel");
  const price = await lastFuelPrice(t.vehicle.fuelType);
  const mins = (a: Date | null, b: Date | null) => (a && b ? Math.round((b.getTime() - a.getTime()) / 60000) : null);
  // Baraban vaqti: yuklangan beton yetkazilmasdan qancha turibdi (faqat mikserdagi beton)
  const drumMin = isConcreteTrip(t) && ["LOADED", "ON_ROAD"].includes(t.status) ? mins(t.loadedAt, new Date()) : null;

  return (
    <div>
      <PageHeader
        back={{ href: "/trips", label: "Reyslar" }}
        title={`Nakladnoy ${t.deliveryNoteNo}`}
        subtitle={<><CustomerName name={t.order.customer.name} blacklisted={blacklisted} contracted={marks.contract.has(t.order.customerId)} href={`/customers/${t.order.customerId}`} /></>}
        action={
          <>
            <LinkButton href={`/trips/${id}/print`} variant="secondary"><Printer size={16} /> Chop etish</LinkButton>
            {t.status === "PLANNED" && canLoad && !canDriver && <LoadButton tripId={id} />}
            {driverPhase && canPlan && !canDriver && !t.vehicle.external && <span className="self-center text-xs text-slate-500">Yo&apos;l bosqichlarini haydovchi o&apos;z ilovasidan belgilaydi</span>}
            {t.status === "PLANNED" && canCancel && (
              <ConfirmButton action={cancelTrip.bind(null, id)} label="O'chirish" icon={<Trash2 size={16} />} reason="optional" okText="O'chirildi"
                question={`${t.deliveryNoteNo} reysi o'chirilsinmi? Haydovchiga xabar boradi`} goTo={`/orders/${t.orderId}`} className="h-10 px-3" />
            )}
          </>
        }
      />

      {t.vehicle.external && t.status !== "CANCELLED" && !t.closedAt && (
        <Callout tone="info" title="Ko'chadan chaqirilgan mashina">
          Haydovchida ilova va GPS yo&apos;q — yo&apos;l bosqichlarini (yo&apos;lga chiqdi, yetkazildi) dispetcher shu sahifadan belgilaydi. Haydovchi: {t.driver.fullName}{t.driver.phone ? `, ${t.driver.phone}` : ""}.
        </Callout>
      )}
      {blacklisted && t.status !== "CANCELLED" && t.status !== "DELIVERED" && (
        <Callout tone="danger" title="Mijoz qora ro'yxatda">Kredit limiti to'liq ishlatilgan. Jo'natishdan oldin sotuv bo'limi yoki direktor bilan kelishing. <Link href={`/customers/${t.order.customerId}`} className="underline">Mijoz kartasi</Link></Callout>
      )}
      {drumMin != null && drumMin >= DRUM_MAX_MIN * 0.8 && (
        <Callout tone={drumMin >= DRUM_MAX_MIN ? "danger" : "warning"} title={drumMin >= DRUM_MAX_MIN ? "Baraban vaqti oshdi — beton qotish xavfi" : "Baraban vaqti tugayapti"}>
          Beton yuklanganiga {minutesLabel(drumMin)} bo&apos;ldi (chegara {DRUM_MAX_MIN} daq). Obyekt bilan bog&apos;laning; kerak bo&apos;lsa laborant sifatini tekshirsin.
        </Callout>
      )}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StatusSteps steps={STEPS} current={phase === "CANCELLED" ? "ASSIGNED" : phase} failed={phase === "CANCELLED"} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="text-sm text-slate-600"><TtnForm tripId={id} ttn={t.ttn} canEdit={t.status !== "CANCELLED" && canDo(s, "trips", "create")} /></div>
            <div className="flex items-center gap-2"><PhaseBadge phase={phase} />{openIssues.length > 0 && <span className="text-xs font-medium text-red-700">{openIssues.length} ochiq muammo</span>}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Hajm" value={tripUnit ? `${qty(t.qtyM3)} ${unitLabel(tripUnit)}` : qty(t.qtyM3)} hint={tripProduct} icon={Package} tone="brand" href={pathAllowed("/orders", s.role, s.perms) ? `/orders/${t.orderId}` : undefined} />
        {t.vehicle.external
          ? <StatCard label={`${VEHICLE_TYPE[t.vehicle.type] ?? "Transport"} · ko'chadan`} value={<span className="tabular">{t.vehicle.plate}</span>} hint={[t.driver.fullName, t.driver.phone].filter(Boolean).join(" · ")} icon={Truck} />
          : <StatCard label={VEHICLE_TYPE[t.vehicle.type] ?? "Transport"} value={<span className="tabular">{t.vehicle.plate}</span>} hint={t.driver.fullName} icon={Truck} href={pathAllowed("/logistika/transport", s.role, s.perms) ? `/logistika/transport/${t.vehicle.id}` : undefined} />}
        <StatCard label="Yuklandi" value={<span className="text-base">{dt(t.loadedAt)}</span>} icon={Clock} href="#reys-vaqtlari" />
        <StatCard label="Yetkazildi" value={<span className="text-base">{dt(t.deliveredAt)}</span>} hint={t.receiverName ? `qabul qildi: ${t.receiverName}` : undefined} icon={Clock} tone={t.deliveredAt ? "success" : "default"} href="#reys-vaqtlari" />
      </div>

      {t.status === "LOADED" && canPlan && (
        <Card className="mt-5">
          <CardHeader title="Yukni olgani joyi" description="Mikser yukni qayerdan olgani — haydovchi ilovasida marshrut shu nuqtadan boshlanadi" icon={MapPinned} />
          <PickupForm
            tripId={id}
            searchEnabled={geoSearchEnabled()}
            address={t.pickupAddress ?? plant?.address ?? plant?.name ?? ""}
            lat={t.pickupLat ?? plant?.lat ?? null}
            lng={t.pickupLng ?? plant?.lng ?? null}
          />
        </Card>
      )}

      {/* ── Haydovchi o'rniga: ilovadagi tugmalar ketma-ket, har holatda faqat keyingi qadam (`lib/trip-dispatch.ts`) ── */}
      {canDriver && (
        <Card className="mt-5 border-brand-200">
          <CardHeader title="Haydovchi o'rniga" icon={UserRoundCheck}
            description={t.status === "DELIVERED"
              ? (t.returnedAt ? "Haydovchi bosqichlari tugadi — Hisob varag'ini to'ldiring va reysni yoping" : "Yetkazildi. Mashina zavodga qaytganda «Zavodga qaytdim» ni bosing")
              : "Haydovchida ilova yo'q — uning tugmalarini shu yerdan bosing. Kim va qachon belgilagani «Amallar tarixi»da qoladi"}
            action={t.status === "DELIVERED" && ledgerHref ? <LinkButton href={ledgerHref} variant="secondary" size="sm"><FileSpreadsheet size={15} /> Hisob varag&apos;i</LinkButton> : undefined} />
          <div className="flex flex-wrap items-start gap-2">
            {t.status === "PLANNED" && <DriverStepButton tripId={id} step="loaded" />}
            {t.status === "LOADED" && <DriverStepButton tripId={id} step="onroad" />}
            {t.status === "ON_ROAD" && !t.arrivedAt && <DriverStepButton tripId={id} step="arrived" />}
            {t.status === "ON_ROAD" && t.arrivedAt && !t.unloadingAt && <DriverStepButton tripId={id} step="unloading" />}
            {t.status === "DELIVERED" && !t.returnedAt && <DriverStepButton tripId={id} step="returned" />}
          </div>
          {t.status === "ON_ROAD" && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <DriverDeliverForm tripId={id} loaded={Number(t.qtyM3)} unit={tripUnit ? unitLabel(tripUnit) : ""} mixer={t.vehicle.type === "MIXER"} ledgerHref={ledgerHref} />
            </div>
          )}
        </Card>
      )}

      {/* ── Vaqtlar (TZ: yuklash / jo'nash / yetib borish / topshirish) ── */}
      <div id="reys-vaqtlari" className="scroll-mt-20" />
      <Card className="mt-5">
        <CardHeader title="Reys vaqtlari" description={planned ? `Reja: ${dateTime(planned)}` : "Rejadagi vaqt yo'q (zayavkada soat ko'rsatilmagan)"} icon={Clock}
          action={t.status !== "CANCELLED" && planned ? <span className="text-sm">Kechikish: <DelayText min={delay} level={delayLevel(delay, settings)} /></span> : undefined} />
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["Yuklandi", t.loadedAt], ["Yo'lga chiqdi", t.departedAt], ["Obyektga keldi", t.arrivedAt],
            ["Tushirish boshlandi", t.unloadingAt], ["Yetkazildi", t.deliveredAt], ["Zavodga qaytdi", t.returnedAt],
          ].map(([k, v]) => <div key={k as string}><div className="text-xs text-slate-500">{k as string}</div><div className="font-medium tabular">{dt(v as Date | null)}</div></div>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {mins(t.loadedAt, t.deliveredAt) != null && <Badge>yuklash → topshirish {minutesLabel(mins(t.loadedAt, t.deliveredAt))}</Badge>}
          {mins(t.departedAt, t.arrivedAt) != null && <Badge>yo'l {minutesLabel(mins(t.departedAt, t.arrivedAt))}</Badge>}
          {mins(t.arrivedAt, t.deliveredAt) != null && <Badge>obyektda {minutesLabel(mins(t.arrivedAt, t.deliveredAt))}</Badge>}
          {mins(t.loadedAt, t.returnedAt) != null && <Badge color="blue">aylanish {minutesLabel(mins(t.loadedAt, t.returnedAt))}</Badge>}
        </div>
      </Card>

      {/* ── Muammolar ── */}
      {t.status !== "CANCELLED" && (
        <Card className={`mt-5 ${openIssues.length ? "border-red-200" : ""}`}>
          <CardHeader title="Muammolar" description="Haydovchi ilovadan, dispetcher shu yerdan, ECO (rad etish / e'tiroz) avtomatik yozadi" icon={AlertTriangle} />
          {t.issues.length > 0 && (
            <ul className="mb-4 space-y-2">
              {t.issues.map((i) => (
                <li key={i.id} className={`rounded-lg border px-3 py-2 text-sm ${i.resolvedAt ? "border-slate-200" : "border-red-200 bg-red-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{ISSUE_KIND[i.kind]}{i.note ? <span className="font-normal text-slate-600"> — {i.note}</span> : null}</span>
                    <span className="text-xs text-slate-500 tabular">{dateTime(i.createdAt)} · {i.source === "DRIVER" ? "haydovchi" : i.source === "ECO" ? "ECO" : "dispetcher"}</span>
                  </div>
                  {i.resolvedAt ? <div className="mt-1 text-xs text-emerald-700">Hal qilindi {dateTime(i.resolvedAt)}: {i.resolution}</div> : canResolve && <ResolveIssueForm issueId={i.id} />}
                </li>
              ))}
            </ul>
          )}
          {canPlan && <ReportIssueForm tripId={id} />}
        </Card>
      )}

      {/* ── Yetkazib berish va yopish ── */}
      {t.status === "DELIVERED" && (
        <Card className="mt-5">
          <CardHeader title={t.closedAt ? "Reys yopilgan" : "Qabulni tasdiqlash va reysni yopish"} icon={PackageCheck}
            description={t.closedAt ? `${dateTime(t.closedAt)}` : "Qabul qilingan va qaytarilgan miqdorni tekshiring — keyin reys yopiladi"} />
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Yuklangan</div><div className="font-medium tabular">{qty(t.qtyM3)}</div></div>
            <div><div className="text-xs text-slate-500">Qabul qilingan</div><div className="font-medium tabular">{t.acceptedQty != null ? qty(t.acceptedQty) : "—"}</div></div>
            <div><div className="text-xs text-slate-500">Qaytarilgan</div><div className="font-medium tabular">{t.returnedQty != null ? qty(t.returnedQty) : "—"}</div></div>
          </div>
          {t.deliveryComment && <p className="mb-3 text-sm text-slate-600">{t.deliveryComment}</p>}
          {!t.closedAt && canLog && <CloseTripForm tripId={id} loaded={Number(t.qtyM3)} accepted={t.acceptedQty != null ? Number(t.acceptedQty) : null} returned={t.returnedQty != null ? Number(t.returnedQty) : null} />}
        </Card>
      )}

      {/* ── Haydovchi tabeli: haydovchi kiritgan soat/aylantirish, kutish, km va dispetcher narxi (`lib/driver-trip-pay.ts`) ── */}
      {pay && (
        <Card className="mt-5">
          <CardHeader title="Haydovchi tabeli" icon={Clock}
            description={!pay.pricedAt ? "Narx belgilanmagan — reys haydovchi oyligiga hali tushmagan"
              : !pay.payType ? "Narxlangan — oy yakunida Ish haqiga tushadi"
              : !pay.approvedAt ? `${PAY_TYPE_LABEL[pay.payType]} — ish boshqaruvchi tasdig'ini kutmoqda`
              : pay.payType === "CASH" ? "Naqd — tasdiqlangan, kassa beradi" : "Oylik — tasdiqlangan, oy yakunida Ish haqiga tushadi"}
            action={!pay.pricedAt ? <Badge color="amber">Narxsiz</Badge> : <Badge color={pay.approvedAt || !pay.payType ? "green" : "amber"}>{money(pay.amount ?? 0)}</Badge>} />
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div><div className="text-xs text-slate-500">Km (borib-kelish)</div><div className="font-medium tabular">{Math.round(pay.km)}</div></div>
            <div><div className="text-xs text-slate-500">Obyektda kutish</div><div className="font-medium tabular">{pay.waitMin != null ? `${pay.waitMin} daq` : "—"}</div></div>
            <div><div className="text-xs text-slate-500">Mikser aylantirildi</div><div className="font-medium tabular">{pay.drumTurns ?? "—"}</div></div>
            <div><div className="text-xs text-slate-500">Ishlagan soat</div><div className="font-medium tabular">{pay.workHours ?? "—"}</div></div>
            <div><div className="text-xs text-slate-500">Yoqilg&apos;i normasi</div><div className="font-medium tabular">{fuelNormText(pay) ?? "—"}</div></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-500">Taklif: {money(pay.suggested)} · {pay.suggestText}{pay.note ? ` · ${pay.note}` : ""}</span>
            {canDo(s, "logistika", "pay") && !(pay.payType === "CASH" && pay.approvedAt) && <PriceForm tripId={id} suggested={pay.suggested} amount={pay.amount} payType={pay.payType} priced={!!pay.pricedAt} />}
          </div>
        </Card>
      )}

      {/* ── Reys xarajatlari (TZ 12: reysning jami logistika tannarxi) ── */}
      {t.status !== "CANCELLED" && (
        <Card className="mt-5">
          <CardHeader title="Reys xarajatlari" description={costSum ? `Jami: ${money(costSum)}${Number(t.qtyM3) ? ` · 1 birlikka ${money(costSum / Number(t.qtyM3))}` : ""}` : "Yoqilg'i, haydovchi haqi, yo'l to'lovi…"} icon={Coins} />
          {costs.length > 0 && (
            <ul className="mb-3 divide-y divide-slate-100 text-sm">
              {costs.map((c) => <li key={c.id} className={`flex justify-between gap-3 py-1.5 ${c.cancel ? "text-slate-400" : ""}`}><span>{c.label}{c.note ? <span className="text-slate-500"> · {c.note}</span> : null}<span className="ml-2 text-xs text-slate-400">{opAt(c.date, c.createdAt)}</span>{c.cancel && <span className="mt-0.5 block"><Badge color="red">Bekor qilingan</Badge> <span className="text-xs text-slate-500">{c.cancel}</span></span>}</span><span className="flex flex-wrap items-start justify-end gap-1"><span className={`whitespace-nowrap tabular ${c.cancel ? "line-through" : ""}`}>{money(c.amount)}</span>{!c.cancel && canCancelCost && <ConfirmButton action={(c.fuel ? cancelFuel : cancelExpense).bind(null, c.id)} reason="required" label="" title="Bekor qilish" icon={<Undo2 size={14} />} question={`${c.label} (${money(c.amount)}) bekor qilinsinmi?`} okText="Bekor qilindi" className="h-6 px-1.5" />}</span></li>)}
            </ul>
          )}
          {canDo(s, "trips", "cost") && <TripCostForm tripId={id} lastPrice={price} dualFuel={t.vehicle.fuelType === "DIESEL_METHANE"} />}
        </Card>
      )}

      {track.length > 1 && (
        <Card className="mt-5">
          <CardHeader
            title="Yurgan yo'li"
            description="Haydovchi ilovasidan kelgan GPS izi — yashil bayroq qayerdan qo'zg'algan, qora belgi obyekt manzili"
            icon={Route}
          />
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge color="blue">{distanceLabel(trackStat?.meters ?? 0)} yurilgan</Badge>
            {trackStat?.minutes ? <Badge>{hm(trackStat.minutes)} yo'lda</Badge> : null}
            {trackStat?.minutes ? <Badge>o'rtacha {Math.round((trackStat.meters / 1000) / (trackStat.minutes / 60))} km/soat</Badge> : null}
            <Badge>{track.length} nuqta</Badge>
          </div>
          <TripTrackMap
            track={track.map((p) => [p.lat, p.lng] as [number, number])}
            start={t.pickupLat != null && t.pickupLng != null ? [t.pickupLat, t.pickupLng] : plant?.lat != null && plant?.lng != null ? [plant.lat, plant.lng] : null}
            finish={t.order.lat != null && t.order.lng != null ? [t.order.lat, t.order.lng] : null}
          />
        </Card>
      )}

      {ecoEnabled() && t.status !== "CANCELLED" && !t.vehicle.external && (() => {
        const st = ecoLabel(t.ecoStatus);
        return (
          <Card className={`mt-5 ${t.ecoError ? "border-red-200" : ""}`}>
            <CardHeader title="Haydovchi ilovasi (Insof ECO)" icon={Smartphone}
              description={st ? st.hint : "Reys haydovchi telefoniga hali yuborilmagan"}
              action={canPlan ? <EcoSyncButtons tripId={id} hasEco={!!t.ecoDeliveryId} /> : undefined} />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {st ? <Badge color={st.color}>{st.label}</Badge> : <Badge>Yuborilmagan</Badge>}
              {t.ecoSyncedAt && <span className="text-slate-500">sinxron: {dateTime(t.ecoSyncedAt)}</span>}
              {!t.driver.phone && <span className="text-amber-700">Haydovchi telefoni yo'q — ilovada ko'rinmaydi</span>}
            </div>
            {t.ecoError && <p className="mt-2 text-sm text-red-600">{t.ecoError}</p>}
          </Card>
        );
      })()}

      <Card className="mt-5">
        <CardHeader title="Yetkazish" icon={MapPin} action={<Link href={`/orders/${t.orderId}`} className="text-sm text-slate-500 hover:text-slate-900">Zayavkaga o'tish →</Link>} />
        <DL items={[
          ...(t.bru ? [{ k: "BRU", v: t.bru }] : []),
          ...(t.driverReason ? [{ k: "Boshqa haydovchi sababi", v: `${t.driver.fullName} — ${t.driverReason}` }] : []),
          ...(t.pickupAddress ? [{ k: "Yukni olgani joyi", v: t.pickupAddress }] : []),
          { k: "Manzil", v: t.order.deliveryAddress },
          { k: "Sana", v: date(t.order.deliveryDate) },
          { k: "Mijoz telefoni", v: t.order.customer.phone },
          ...(t.order.site ? [{ k: "Obyekt", v: <Link href={`/logistika/obyektlar/${t.order.site.id}`} className="hover:underline">{t.order.site.name}</Link> }] : []),
          ...(t.order.site?.contactName || t.order.site?.contactPhone ? [{ k: "Obyektda kontakt", v: [t.order.site.contactName, t.order.site.contactPhone].filter(Boolean).join(", ") }] : []),
          ...(t.order.site?.deliveryHours ? [{ k: "Qabul vaqti", v: t.order.site.deliveryHours }] : []),
          ...(t.order.site?.instructions ? [{ k: "Ko'rsatma", v: t.order.site.instructions }] : []),
          ...(t.receiverName ? [{ k: "Qabul qildi", v: t.receiverName }] : []),
          ...(t.note ? [{ k: "Izoh", v: t.note }] : []),
        ]} />
      </Card>

      {/* Yuqoridagi StatusSteps qayerda turganini ko'rsatadi; bu yerda esa har amalni KIM va QACHON qilgani —
          holat, bosqich (haydovchi ilovadan bosgani ham), TTN, reys haqi (`lib/activity.ts`). */}
      <ActivityLog rows={activity} className="mt-5" />
    </div>
  );
}
