import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, X, Truck, MapPin, Phone, RefreshCw, ShieldCheck, Info, UserRoundCheck, LogIn } from "lucide-react";
import { db } from "@/lib/db";
import { qty, date, dateTime, time } from "@/lib/format";
import { getCompany } from "@/lib/company";
import { unitLabel, soleUnit } from "@/lib/unit";
import { tripLine } from "@/lib/trips";
import { VEHICLE_TYPE, capText } from "@/lib/logistics";
import { LogoMark } from "@/components/logo";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Animatsiyalar — "QR ochilish ekrani" dizaynidan (Claude artifakti). Ranglar qat'iy hex: sahifa doim
 * ochiq rangda (telefon dark rejimida ham — qog'oz bilan solishtiriladigan hujjat), tokenlar `.dark` da teskari bo'ladi.
 */
const CSS = `
.vf-ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,.9);animation:vf-ring 2.4s cubic-bezier(.2,.7,.3,1) .5s infinite both}
.vf-r2{animation-delay:1.3s}.vf-r3{animation-delay:2.1s}
.vf-badge{animation:vf-pop .7s cubic-bezier(.3,1.6,.5,1) .15s both}
.vf-tick path{stroke-dasharray:30;stroke-dashoffset:30;animation:vf-draw .45s ease-out .7s forwards}
.vf-spark{position:absolute;width:8px;height:8px;border-radius:2px;left:50%;top:50%;margin:-4px;animation:vf-spark 1s ease-out .75s both}
.vf-up{animation:vf-up .6s cubic-bezier(.2,.8,.2,1) both}
.vf-d1{animation-delay:.55s}.vf-d2{animation-delay:.7s}.vf-d3{animation-delay:.85s}.vf-d4{animation-delay:1s}.vf-d5{animation-delay:1.15s}.vf-d6{animation-delay:1.3s}.vf-d7{animation-delay:1.45s}
.vf-road{background-image:linear-gradient(90deg,#155dfc 50%,transparent 50%);background-size:14px 3px;background-repeat:repeat-x;background-position:0 50%;animation:vf-road .6s linear infinite}
.vf-truck{position:absolute;top:50%;margin-top:-21px;left:4%;animation:vf-drive 1.8s cubic-bezier(.4,.1,.3,1) 1s both}
.vf-arrived{left:calc(100% - 92px);animation:vf-arrive 1.6s cubic-bezier(.4,.1,.3,1) 1s both}
.vf-bob{animation:vf-bob .5s ease-in-out 2.8s infinite}
.vf-dot{animation:vf-pulse 1.6s ease-in-out infinite}
.vf-vol{animation:vf-vol .9s cubic-bezier(.3,1.5,.5,1) 1.2s both}
.vf-idle{animation:vf-bob .35s ease-in-out 1s infinite}
.vf-puff{position:absolute;left:-10px;bottom:6px;width:10px;height:10px;border-radius:50%;background:#cad5e2;animation:vf-puff 1.4s ease-out 1s infinite}
.vf-p2{animation-delay:1.7s}
.vf-load{animation:vf-load 2.2s cubic-bezier(.4,0,.2,1) 1.2s infinite}
.vf-trail{animation:vf-trail 1.6s cubic-bezier(.4,.1,.3,1) 1s both}
.vf-pin{animation:vf-pin .55s cubic-bezier(.3,1.6,.5,1) 2.5s both}
.vf-stop{animation:vf-stop 1.4s ease-in-out 1.4s infinite}
@keyframes vf-ring{0%{transform:scale(.7);opacity:.85}100%{transform:scale(2.5);opacity:0}}
@keyframes vf-pop{0%{transform:scale(0) rotate(-20deg)}60%{transform:scale(1.14) rotate(4deg)}100%{transform:scale(1) rotate(0)}}
@keyframes vf-draw{to{stroke-dashoffset:0}}
@keyframes vf-spark{0%{opacity:0;transform:translate(0,0) scale(.3)}30%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(1) rotate(90deg)}}
@keyframes vf-up{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes vf-road{to{background-position:-14px 50%}}
@keyframes vf-drive{from{left:4%}to{left:56%}}
@keyframes vf-arrive{from{left:0}to{left:calc(100% - 92px)}}
@keyframes vf-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes vf-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,.8)}60%{box-shadow:0 0 0 8px rgba(255,255,255,0)}}
@keyframes vf-vol{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@keyframes vf-puff{0%{opacity:.9;transform:translate(0,0) scale(.6)}100%{opacity:0;transform:translate(-26px,-18px) scale(2)}}
@keyframes vf-load{0%{width:0}70%,100%{width:100%}}
@keyframes vf-trail{from{width:0}}
@keyframes vf-pin{0%{opacity:0;transform:translateY(-26px) scale(.6)}100%{opacity:1;transform:none}}
@keyframes vf-stop{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@media (prefers-reduced-motion:reduce){.vf *{animation:none!important}.vf-tick path{stroke-dashoffset:0}.vf-truck{left:56%}.vf-arrived{left:calc(100% - 92px)}}
`;

const SPARKS = [
  { dx: -62, dy: -30, c: "#ffffff" }, { dx: 58, dy: -44, c: "#f59e0b" }, { dx: 66, dy: 26, c: "#ffffff" },
  { dx: -54, dy: 40, c: "#34d399" }, { dx: 4, dy: -70, c: "#ffffff" },
];

const card = "rounded-[18px] bg-[#ffffff] p-[18px] shadow-[0_1px_3px_rgba(15,23,42,.08)]";
const muted = "text-[12px] font-medium text-[#5f7088]";

/** "Toshkent Qurilish MChJ" → "Tosh*** Q*** M***" — eski (kalitsiz) QR'da mijoz nomi to'liq ochilmaydi. */
function maskName(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w, i) => (i === 0 ? `${w.slice(0, Math.min(4, Math.max(1, w.length - 2)))}***` : `${w[0]}***`)).join(" ");
}

/** "01A123BC" → 01 | A 123 BC, "01123ABC" → 01 | 123 ABC (yuridik shaxs). Boshqa ko'rinishda — null, raqam oddiy matn bo'ladi. */
function plateParts(plate: string): { region: string; rest: string } | null {
  const m = plate.replace(/\s+/g, "").toUpperCase().match(/^(\d{2})([A-Z]\d{3}[A-Z]{2}|\d{3}[A-Z]{3})$/);
  if (!m) return null;
  return { region: m[1], rest: m[2].replace(/^([A-Z])(\d{3})([A-Z]{2})$/, "$1 $2 $3").replace(/^(\d{3})([A-Z]{3})$/, "$1 $2") };
}

const minutes = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
const durText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} soat ${m % 60} daqiqa` : `${m} daqiqa`);
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

function Field({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 flex-col gap-0.5"><span className={muted}>{label}</span><span className="text-[15px] font-bold break-words">{value}</span></div>;
}

function Plate({ plate }: { plate: string }) {
  const p = plateParts(plate);
  if (!p) return <span className="rounded-lg border-[2.5px] border-[#0f172b] px-2.5 py-1 text-[20px] font-extrabold tracking-[.06em]">{plate}</span>;
  return (
    <span className="flex items-stretch overflow-hidden rounded-lg border-[2.5px] border-[#0f172b] bg-[#ffffff] text-[22px] font-extrabold tracking-[.06em]">
      <span className="border-r-[2.5px] border-[#0f172b] px-[9px] py-1">{p.region}</span>
      <span className="px-2.5 py-1 whitespace-nowrap">{p.rest}</span>
      <span className="flex flex-col items-center justify-center gap-0.5 px-[7px] text-[9px] tracking-[.04em]">
        <span aria-hidden className="flex h-2.5 w-4 flex-col"><span className="flex-1 bg-[#1eb5e8]" /><span className="flex-1 bg-[#ffffff]" /><span className="flex-1 bg-[#1eb53a]" /></span>UZ
      </span>
    </span>
  );
}

/** Mikser belgisi — amber plitkada yuk mashinasi */
function TruckTile({ big = false, className = "" }: { big?: boolean; className?: string }) {
  return (
    <div className={`grid place-items-center rounded-xl bg-[#f59e0b] text-[#0f172b] ${big ? "h-[46px] w-[58px]" : "h-[42px] w-[52px] shadow-[0_8px_16px_-6px_rgba(180,83,9,.6)]"} ${className}`}>
      <Truck size={big ? 30 : 28} strokeWidth={2} aria-hidden />
    </div>
  );
}

/**
 * Ommaviy sahifa — mijoz QR orqali nakladnoy haqiqiyligini tekshiradi. Login shart emas.
 *
 * Nakladnoy raqami ketma-ket (N-000123), shuning uchun raqamning o'zi kalit bo'lolmaydi: yangi
 * reyslarda QR havolasida tasodifiy kalit (`?k=`) bor va u mos kelmasa — "topilmadi" (raqam
 * mavjudligi ham oshkor qilinmaydi). Kalitsiz eski nakladnoylarda mijoz nomi qisman yashiriladi.
 *
 * Ko'rinish holatga qarab 4 xil (artifakt "QR ochilish ekrani"): rejada/yuklangan — mashina zavodda,
 * yo'lda — jonli yo'l chizig'i, yetkazilgan — yuklangan va qabul qilingan hajm, bekor — "yukni qabul qilmang".
 * Narx va telefonlar chiqmaydi — faqat zavodning umumiy raqami.
 */
export default async function VerifyPage({ params, searchParams }: { params: Promise<{ noteNo: string }>; searchParams: Promise<{ k?: string }> }) {
  const { noteNo } = await params;
  const { k } = await searchParams;
  // Kalit so'rovning o'zida tekshiriladi: mos kelmasa reys ma'lumoti umuman o'qilmaydi
  // (dev rejimida React await qilingan qiymatlarni sahifaga debug uchun qo'shadi — u yerga ham tushmasin)
  const t = await db.trip.findFirst({
    where: { deliveryNoteNo: noteNo, OR: [{ verifyToken: null }, ...(k ? [{ verifyToken: k }] : [])] },
    include: { order: { include: { customer: true, site: { select: { name: true } }, items: { include: { product: true } } } }, vehicle: true },
  });
  // Haqiqiy 404 (200 emas): skanerlar/qidiruv tizimlari "topilmadi" sahifasini mavjud hujjat deb hisoblamasin.
  // Kalit mos kelmasa ham xuddi shu javob — raqam mavjudligi oshkor bo'lmaydi (`./not-found.tsx`).
  if (!t) notFound();
  const company = await getCompany();
  const now = new Date();

  // Aralash zayavkada reys qatori texnika turidan (beton — mikser, dona — yuk mashina)
  const line = tripLine(t.order.items, t.vehicle.type);
  const item = ("error" in line ? undefined : t.order.items.find((i) => i.productId === line.productId)) ?? t.order.items[0];
  const product = item?.product;
  const unit = unitLabel(("error" in line ? null : line.unit) ?? soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? product?.unit ?? "m3");
  const batch = product?.unit === "m3" && item
    ? await db.productionBatch.findFirst({ where: { cancelledAt: null, orderId: t.orderId, productId: item.productId, ...(t.loadedAt ? { date: { lte: t.loadedAt } } : {}) }, orderBy: { date: "desc" }, select: { batchNo: true } })
    : null;

  const customer = t.verifyToken ? t.order.customer.name : maskName(t.order.customer.name);
  const productName = product ? `${product.name}${product.strengthClass && !product.name.includes(product.strengthClass) ? ` (${product.strengthClass})` : ""}` : "—";
  const site = t.order.site?.name ?? t.order.deliveryAddress;
  const vehicleKind = [VEHICLE_TYPE[t.vehicle.type], capText(t.vehicle)].filter(Boolean).join(", ");
  const day = date(t.loadedAt ?? t.createdAt);
  const S = t.status;
  const cancelled = S === "CANCELLED";
  const onRoad = S === "ON_ROAD";
  const delivered = S === "DELIVERED";
  const atPlant = S === "PLANNED" || S === "LOADED";
  const self = `/verify/${encodeURIComponent(t.deliveryNoteNo)}${k ? `?k=${encodeURIComponent(k)}` : ""}`;
  const phone = company.phone ? company.phone.replace(/[^\d+]/g, "") : null;
  const mapUrl = company.lat != null && company.lng != null ? `https://maps.google.com/?q=${company.lat},${company.lng}` : null;

  const hero = cancelled
    ? { title: "Bekor qilingan", sub: "Bu reys zavod tomonidan bekor qilingan." }
    : onRoad
      ? t.arrivedAt ? { title: "Yuk haqiqiy", sub: "Mashina obyektda — yuk tushirilmoqda." } : { title: "Yuk haqiqiy", sub: "Bu mashina zavoddan chiqqan va tizimda ro'yxatda." }
      : delivered
        ? { title: "Yuk yetkazildi", sub: t.receiverName ? "Obyektda qabul qilingan va imzolangan." : "Obyektda qabul qilingan." }
        : { title: "Haqiqiy nakladnoy", sub: S === "LOADED" ? "Yuklandi — mashina jo'nashga tayyor." : "Reys rejada — mashina hali zavodda." };

  // Zavoddagi reys: jo'nash va obyektga yetish vaqti (marshrut hisoblangan bo'lsa)
  const start = S === "LOADED" ? t.loadedAt : t.plannedAt;
  const eta = start && t.plannedMin ? addMin(start, t.plannedMin) : null;
  const tripMin = delivered && (t.departedAt ?? t.loadedAt) ? minutes((t.departedAt ?? t.loadedAt)!, t.arrivedAt ?? t.deliveredAt ?? now) : null;

  // Nakladnoy raqami: TTN bo'lsa — u (qog'ozdagi sarlavha), tizim raqami pastda
  const numberBlock = (
    <div className="flex min-w-0 flex-col">
      <span className={muted}>{t.ttn ? "TTN" : "Nakladnoy"}</span>
      <span className="truncate text-[20px] font-extrabold tracking-[-.01em]">{t.ttn ?? t.deliveryNoteNo}</span>
      {t.ttn && <span className="text-[11px] text-[#5f7088]">Tizim № {t.deliveryNoteNo}</span>}
    </div>
  );
  const pill = (text: string, cls: string) => <span className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-bold ${cls}`}>{text}</span>;

  return (
    <main className="vf min-h-screen bg-[#f5f6f8] font-sans text-[#0f172b]">
      <style>{CSS}</style>
      <header className={`relative overflow-hidden px-5 pb-16 pt-[22px] text-[#ffffff] ${cancelled ? "bg-[#e7000b]" : "bg-[#155dfc]"}`}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-[22px]">
          <div className="vf-up flex items-center gap-2.5">
            <LogoMark className="h-[38px] w-[38px] shrink-0 [--logo-blue:#f59e0b]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-extrabold tracking-[.02em]">{company.legalName ?? company.name}</span>
              <span className="truncate text-[12px] font-medium opacity-85">{company.address ?? "Beton zavodi"}</span>
            </div>
            {onRoad && <span className="inline-flex shrink-0 items-center gap-[7px] rounded-full bg-[rgba(255,255,255,.18)] px-[11px] py-1.5 text-[12px] font-bold"><span className="vf-dot h-2 w-2 rounded-full bg-[#ffffff]" />Jonli</span>}
          </div>
          <div className="flex flex-col items-center gap-3.5 text-center">
            <div className="relative h-[104px] w-[104px]">
              <span className="vf-ring" /><span className="vf-ring vf-r2" />{!cancelled && <span className="vf-ring vf-r3" />}
              {(onRoad || delivered) && SPARKS.map((s) => <span key={`${s.dx}${s.dy}`} className="vf-spark" style={{ "--dx": `${s.dx}px`, "--dy": `${s.dy}px`, background: s.c } as React.CSSProperties} />)}
              <div className={`vf-badge absolute inset-0 grid place-items-center rounded-full bg-[#ffffff] ${cancelled ? "shadow-[0_14px_30px_-10px_rgba(80,0,0,.6)]" : "shadow-[0_14px_30px_-10px_rgba(10,30,90,.6)]"}`}>
                {cancelled
                  ? <X size={54} strokeWidth={2.6} color="#e7000b" className="vf-tick" role="img" aria-label="Bekor qilingan" />
                  : <Check size={54} strokeWidth={2.6} color="#009966" className="vf-tick" role="img" aria-label={delivered ? "Yetkazildi" : "Tasdiqlandi"} />}
              </div>
            </div>
            <div className="vf-up vf-d1 flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-[.14em] opacity-90">TOVAR-TRANSPORT NAKLADNOYI</span>
              <h1 className="m-0 text-[32px] leading-9 font-extrabold tracking-[-.02em]">{hero.title}</h1>
              <p className="m-0 text-[14px] leading-5 font-medium">{hero.sub}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="relative -mt-[34px] rounded-t-[28px] bg-[#f5f6f8] px-4 pb-5 pt-[18px]">
        <div className="mx-auto flex w-full max-w-md flex-col gap-3">
          {cancelled && (
            <>
              <section className="vf-up vf-d2 flex items-center gap-3.5 rounded-[18px] bg-[#e7000b] p-[18px] text-[#ffffff]">
                <div className="vf-stop grid h-14 w-14 shrink-0 place-items-center bg-[#ffffff] text-[12px] font-extrabold tracking-[.04em] text-[#e7000b] [clip-path:polygon(30%_0,70%_0,100%_30%,100%_70%,70%_100%,30%_100%,0_70%,0_30%)]">STOP</div>
                <div className="flex flex-col gap-[3px]">
                  <span className="text-[16px] font-extrabold">Yukni qabul qilmang</span>
                  <span className="text-[13px] leading-[19px] opacity-95">Shu qog&apos;oz bilan kelgan mashina haqida zavodga xabar bering.</span>
                </div>
              </section>
              <section className={`vf-up vf-d3 flex flex-col gap-3.5 ${card}`}>
                <div className="flex items-center justify-between gap-2.5">{numberBlock}{pill("Bekor", "bg-[#fef2f2] text-[#c10007] shadow-[inset_0_0_0_1.5px_#ffc9c9]")}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 opacity-80">
                  <Field label="Mijoz" value={customer} /><Field label="Sana" value={day} />
                  <Field label="Mahsulot" value={productName} /><Field label="Mashina" value={t.vehicle.plate} />
                </div>
              </section>
              <section className={`vf-up vf-d4 flex items-start gap-3 ${card}`}>
                <Info size={22} className="mt-px shrink-0 text-[#5f7088]" aria-hidden />
                <p className="m-0 text-[13.5px] leading-5 text-[#314158]">Zayavkangiz o&apos;z kuchida bo&apos;lsa, yangi reys yangi nakladnoy va yangi QR bilan keladi.</p>
              </section>
            </>
          )}

          {atPlant && (
            <>
              <section className={`vf-up vf-d2 flex flex-col gap-4 ${card}`}>
                <div className="flex items-center justify-between gap-2.5">{numberBlock}{pill(S === "LOADED" ? "Yuklangan" : "Rejada", "bg-[#eff6ff] text-[#1447e6]")}</div>
                <div className="flex items-center gap-3.5">
                  <div className="relative shrink-0"><span className="vf-puff" /><span className="vf-puff vf-p2" /><TruckTile big className="vf-idle" /></div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <span className="text-[14px] font-bold">{S === "LOADED" ? "Zavodda, jo'nashga tayyor" : "Zavodda, jo'nashga tayyorlanmoqda"}</span>
                    <div className="relative h-2 overflow-hidden rounded-full bg-[#eff6ff]"><div className="vf-load absolute inset-y-0 left-0 rounded-full bg-[#155dfc]" /></div>
                  </div>
                </div>
                {(start || eta) && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-0.5 rounded-[14px] bg-[#eff6ff] p-3"><span className="text-[12px] font-semibold text-[#1447e6]">{S === "LOADED" ? "Yuklandi" : "Jo'nash"}</span><span className="text-[22px] font-extrabold text-[#0f3bbf]">{start ? `${S === "LOADED" ? "" : "~"}${time(start)}` : "—"}</span></div>
                    <div className="flex flex-col gap-0.5 rounded-[14px] bg-[#ecfdf5] p-3"><span className="text-[12px] font-semibold text-[#007a55]">Obyektga</span><span className="text-[22px] font-extrabold text-[#065f46]">{eta ? `~${time(eta)}` : "—"}</span></div>
                  </div>
                )}
              </section>
              <section className={`vf-up vf-d3 flex items-center gap-4 ${card}`}>
                <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-[22px] bg-[#eff6ff] text-[#155dfc] shadow-[inset_0_0_0_2px_#bedbff]">
                  <span className="text-[38px] leading-10 font-extrabold tracking-[-.03em]">{qty(t.qtyM3)}</span><span className="text-[14px] font-bold">{unit}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className={muted}>{S === "LOADED" ? "Yuklangan" : "Reja bo'yicha"}</span>
                  <span className="text-[18px] font-extrabold">{productName}</span>
                  <span className="text-[13px] text-[#5f7088]">{S === "LOADED" ? (batch ? `Zames № ${batch.batchNo}` : "Yuklash tugadi") : "Yuklangach hajm aniq ko'rsatiladi"}</span>
                </div>
              </section>
              <section className={`vf-up vf-d4 grid grid-cols-2 gap-x-3 gap-y-3.5 ${card}`}>
                <Field label="Mijoz" value={customer} /><Field label="Sana" value={day} />
                <Field label="Mashina" value={t.vehicle.plate} /><Field label="Obyekt" value={site} />
              </section>
            </>
          )}

          {onRoad && (
            <>
              <section className={`vf-up vf-d2 flex flex-col gap-4 ${card}`}>
                <div className="flex items-center justify-between gap-2.5">{numberBlock}{pill(t.arrivedAt ? "Obyektda" : "Yo'lda", "bg-[#155dfc] text-[#ffffff]")}</div>
                <div className="flex flex-col gap-2">
                  <div className="relative h-[54px]">
                    <div className="vf-road absolute inset-x-4 top-1/2 -mt-px h-[3px]" />
                    <div className="absolute left-0 top-1/2 -mt-[9px] h-[18px] w-[18px] rounded-full bg-[#155dfc] shadow-[0_0_0_5px_#dbe7ff]" />
                    <div className="absolute right-0 top-1/2 -mt-[11px] grid h-[22px] w-[22px] place-items-center rounded-full border-[3px] border-[#009966] bg-[#ffffff]"><span className="h-1.5 w-1.5 rounded-full bg-[#009966]" /></div>
                    <div className={t.arrivedAt ? "vf-truck vf-arrived" : "vf-truck"}><div className="vf-bob"><TruckTile /></div></div>
                  </div>
                  <div className="flex justify-between gap-3 text-[12.5px] font-semibold">
                    <span className="shrink-0">Zavod{t.departedAt ?? t.loadedAt ? ` · ${time((t.departedAt ?? t.loadedAt)!)}` : ""}</span>
                    <span className="flex min-w-0 justify-end gap-1 text-[#007a55]"><span className="truncate">{site}</span>{t.arrivedAt && <span className="shrink-0">· {time(t.arrivedAt)}</span>}</span>
                  </div>
                </div>
              </section>
              <section className={`vf-up vf-d3 flex items-center gap-4 ${card}`}>
                <div className="vf-vol flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-[22px] bg-[#155dfc] text-[#ffffff]">
                  <span className="text-[38px] leading-10 font-extrabold tracking-[-.03em]">{qty(t.qtyM3)}</span><span className="text-[14px] font-bold">{unit}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className={muted}>Mahsulot</span>
                  <span className="text-[18px] font-extrabold">{productName}</span>
                  {(batch || t.bru) && <span className="text-[13px] text-[#5f7088]">{[batch && `Zames № ${batch.batchNo}`, t.bru && `BRU: ${t.bru}`].filter(Boolean).join(", ")}</span>}
                </div>
              </section>
              <section className={`vf-up vf-d4 flex flex-col gap-3.5 ${card}`}>
                <span className="text-[11px] font-bold tracking-[.12em] text-[#5f7088]">MASHINA</span>
                <div className="flex flex-wrap items-center gap-3.5"><Plate plate={t.vehicle.plate} />{vehicleKind && <span className="text-[13px] text-[#5f7088]">{vehicleKind}</span>}</div>
                <div className="grid grid-cols-2 gap-3"><Field label="Mijoz" value={customer} /><Field label="Sana" value={day} /></div>
              </section>
              <section className="vf-up vf-d5 flex items-start gap-3 rounded-[18px] bg-[#ecfdf5] px-[18px] py-4">
                <ShieldCheck size={22} className="mt-px shrink-0 text-[#007a55]" aria-hidden />
                <p className="m-0 text-[13.5px] leading-5 font-medium text-[#065f46]">Qog&apos;ozdagi hajm va mashina raqami shu ekrandagi bilan bir xil bo&apos;lsa, yukni qabul qilishingiz mumkin.</p>
              </section>
            </>
          )}

          {delivered && (
            <>
              <section className={`vf-up vf-d2 flex flex-col gap-4 ${card}`}>
                <div className="flex items-center justify-between gap-2.5">{numberBlock}{pill("Yetkazilgan", "bg-[#009966] text-[#ffffff]")}</div>
                <div className="flex flex-col gap-2">
                  <div className="relative h-[54px]">
                    <div className="absolute inset-x-4 top-1/2 -mt-px h-[3px] rounded-sm bg-[#e2e8f0]" />
                    <div className="vf-trail absolute inset-x-4 top-1/2 -mt-0.5 h-1 rounded-sm bg-[#009966]" />
                    <div className="absolute left-0 top-1/2 -mt-[9px] h-[18px] w-[18px] rounded-full bg-[#155dfc] shadow-[0_0_0_5px_#dbe7ff]" />
                    <div className="vf-truck vf-arrived"><TruckTile /></div>
                    <div className="vf-pin absolute -right-1 -top-1.5"><MapPin size={34} fill="#009966" color="#ffffff" strokeWidth={1.5} aria-hidden /></div>
                  </div>
                  <div className="flex justify-between gap-3 text-[12.5px] font-semibold">
                    <span className="shrink-0">Zavod{t.loadedAt ? ` · ${time(t.loadedAt)}` : ""}</span>
                    <span className="flex min-w-0 justify-end gap-1 text-[#007a55]"><span className="truncate">{site}</span>{t.deliveredAt && <span className="shrink-0">· {time(t.deliveredAt)}</span>}</span>
                  </div>
                </div>
              </section>
              <section className={`vf-up vf-d3 flex flex-col gap-3.5 ${card}`}>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-0.5 rounded-[14px] bg-[#eff6ff] p-3"><span className="text-[12px] font-semibold text-[#1447e6]">Yuklangan</span><span className="text-[26px] font-extrabold text-[#0f3bbf]">{qty(t.qtyM3)} {unit}</span></div>
                  <div className="flex flex-col gap-0.5 rounded-[14px] bg-[#ecfdf5] p-3"><span className="text-[12px] font-semibold text-[#007a55]">Qabul qilingan</span><span className="text-[26px] font-extrabold text-[#065f46]">{qty(t.acceptedQty ?? t.qtyM3)} {unit}</span></div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-bold">{productName}</span>
                  {t.returnedQty != null && Number(t.returnedQty) > 0 && <span className="shrink-0 rounded-full bg-[#fef2f2] px-2.5 py-1 text-[12px] font-bold text-[#c10007]">Qaytgan {qty(t.returnedQty)} {unit}</span>}
                </div>
              </section>
              <section className={`vf-up vf-d4 flex flex-col gap-2.5 ${card}`}>
                <span className="text-[11px] font-bold tracking-[.12em] text-[#5f7088]">QABUL QILDI</span>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col"><span className="text-[15px] font-bold">{t.receiverName ?? customer}</span><span className="text-[13px] text-[#5f7088]">{t.deliveredAt ? dateTime(t.deliveredAt) : day}</span></div>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#ecfdf5] text-[#009966]"><UserRoundCheck size={22} aria-hidden /></span>
                </div>
              </section>
              <section className={`vf-up vf-d5 grid grid-cols-2 gap-x-3 gap-y-3.5 ${card}`}>
                <Field label="Mashina" value={t.vehicle.plate} />
                {tripMin != null ? <Field label="Yo'lda" value={durText(tripMin)} /> : <Field label="Sana" value={day} />}
                <Field label="Mijoz" value={customer} />
                {(batch || t.bru) ? <Field label={batch ? "Zames №" : "BRU"} value={batch?.batchNo ?? t.bru ?? "—"} /> : <Field label="Obyekt" value={site} />}
              </section>
            </>
          )}

          {(phone || mapUrl) && (
            <section className={`vf-up vf-d6 grid gap-2.5 ${phone && mapUrl && !cancelled ? "grid-cols-2" : "grid-cols-1"}`}>
              {phone && <a href={`tel:${phone}`} className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-[#0f172b] text-[14px] font-extrabold text-[#ffffff] no-underline"><Phone size={18} aria-hidden />{cancelled ? "Zavodga qo'ng'iroq" : "Qo'ng'iroq"}</a>}
              {mapUrl && !cancelled && <a href={mapUrl} target="_blank" rel="noopener" className="flex min-h-[52px] items-center justify-center gap-2 rounded-[14px] bg-[#ffffff] text-[14px] font-extrabold text-[#0f172b] no-underline shadow-[inset_0_0_0_1.5px_#e2e8f0]"><MapPin size={18} aria-hidden />Zavod xaritada</a>}
            </section>
          )}

          <div className="vf-up vf-d7 flex flex-col items-center gap-1 text-[12px] text-[#5f7088]">
            <div className="flex items-center justify-center gap-2">
              <span>Tekshirildi {dateTime(now)}</span><span aria-hidden>·</span>
              <a href={self} className={`inline-flex items-center gap-[5px] px-1 py-1.5 font-bold no-underline ${cancelled ? "text-[#c10007]" : "text-[#1447e6]"}`}><RefreshCw size={13} strokeWidth={2.4} aria-hidden />Qayta tekshirish</a>
            </div>
            {/* Xodim uchun — login talab qilinadi, ruxsat sahifa himoyasida tekshiriladi */}
            <a href={`/trips/${t.id}`} className="inline-flex items-center gap-1 text-[11px] text-[#5f7088] underline"><LogIn size={12} aria-hidden /> Korxona xodimimisiz? ERP&apos;da ochish</a>
          </div>
        </div>
      </div>
    </main>
  );
}
