import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { qty, date, dateTime, money } from "@/lib/format";
import { tripLine } from "@/lib/trips";
import { PrintButton } from "@/components/print-button";
import { BackLink } from "@/components/ui";
import { getCompany } from "@/lib/company";
import { publicOrigin } from "@/lib/public-url";
import { unitLabel } from "@/lib/unit";
import { requirePage } from "@/lib/page-guard";

/**
 * Nakladnoy maketi — 4-shablon «Beton nazorati». Joylashuvni foydalanuvchi shablon muharririda o'zi
 * tuzgan (2026-11-14). Hamma o'lcham mm da, bitta nusxa 194 × 134 mm
 * (A4 ning yarmi, @page chetlari 8 mm). Elementni surish — shu yerdagi x/y ni o'zgartirish.
 */
type Pos = { x: number; y: number; w: number; h?: number };
const L = {
  topLine: { x: 0, y: 0, w: 194, h: 0.8 },
  title: { x: 0, y: 1.6, w: 125 },
  meta: { x: 0, y: 8.6, w: 135 },
  bru: { x: 0, y: 13.2, w: 135 },
  label: { x: 138, y: 6, w: 33 },
  qr: { x: 174, y: 1.6, w: 20, h: 20 },
  sepLine: { x: 0, y: 23.2, w: 194, h: 0.26 },
  sender: { x: 0, y: 24.6, w: 62 },
  receiver: { x: 66, y: 24.6, w: 62 },
  transport: { x: 132, y: 24.6, w: 62 },
  items: { x: 0, y: 43.5, w: 194 },
  times: { x: 0, y: 66.4, h: 10.4 },
  signs: [89.2, 105.1, 117.5].map((y) => ({ x: 0, y, w: 102 })),
  // Muhr o'rni — faqat punktir doira, yozuvsiz (odatiy muhr 40 mm)
  stamp: { x: 129, y: 86.1, w: 42, h: 42 },
};
// Vaqt nazorati kataklari, mm (oxirgisi — «Suv qo'shildi», kengroq)
const TIME_W = [36, 36, 36, 36, 50];

const at = (p: Pos, extra?: CSSProperties): CSSProperties => ({
  position: "absolute", left: `${p.x}mm`, top: `${p.y}mm`, width: `${p.w}mm`, ...(p.h != null ? { height: `${p.h}mm` } : {}), ...extra,
});
const GRAY = "text-[#555]";
const CAPS = "text-[0.714em] font-bold uppercase tracking-[.06em] text-[#555]";
const CELL = "border border-black px-[1.6mm] py-[0.6mm]";
const BOX = "inline-block h-[3mm] w-[3mm] border border-black align-[-0.4mm]";

function Party({ pos, title, name, sub }: { pos: Pos; title: string; name: ReactNode; sub: ReactNode[] }) {
  return (
    <div style={at(pos)}>
      <div className={CAPS}>{title}</div>
      <b>{name}</b>
      {sub.filter(Boolean).map((s, i) => <div key={i} className={`${GRAY} text-[0.857em]`}>{s}</div>)}
    </div>
  );
}

function SignRow({ pos, title, name }: { pos: Pos; title: string; name?: string | null }) {
  const line = "relative h-[7mm] border-b border-black";
  const cap = `absolute -bottom-[3.6mm] left-0 text-[0.714em] ${GRAY}`;
  return (
    <div style={at(pos, { display: "grid", gridTemplateColumns: "31% 1fr 27%", columnGap: "3mm", alignItems: "end", paddingBottom: "3.6mm" })}>
      <div className="pb-[0.5mm] font-semibold">{title}</div>
      <div className={line}>{name && <span className="absolute bottom-[0.4mm] left-0">{name}</span>}<span className={cap}>F.I.O.</span></div>
      <div className={line}><span className={cap}>Imzo</span></div>
    </div>
  );
}

/** Chop etish uchun nakladnoy: bitta A4 varaqda 2 nusxa (zavod va yuk oluvchi), o'rtada qirqish chizig'i. Brauzerda Ctrl+P → PDF. */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("/trips");
  const { id } = await params;
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true, driver: true } });
  if (!t) notFound();
  const company = await getCompany();
  const { origin, fromEnv } = await publicOrigin();
  // Yangi reyslarda tasodifiy kalit bilan — kalitsiz havola ochiq sahifada "topilmadi" beradi
  const verifyUrl = `${origin}/verify/${encodeURIComponent(t.deliveryNoteNo)}${t.verifyToken ? `?k=${t.verifyToken}` : ""}`;
  // Skaner ishlashi uchun QR atrofida "tinch zona" (margin) bo'lishi shart; M darajali xato tuzatish
  // qog'oz g'ijimlansa ham o'qishga yordam beradi. Ranglar qat'iy qora/oq — dark rejimga bog'liq emas.
  const qr = await QRCode.toString(verifyUrl, { type: "svg", margin: 2, width: 96, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  // Aralash zayavkada reys qatori texnika turidan (beton — mikser, dona — yuk mashina)
  const line = tripLine(t.order.items, t.vehicle.type);
  const item = ("error" in line ? undefined : t.order.items.find((i) => i.productId === line.productId)) ?? t.order.items[0];
  const sum = item ? Number(t.qtyM3) * Number(item.price) : 0;
  // Zames raqami: shu zayavka va mahsulot bo'yicha yuklashgacha quyilgan oxirgi zames (beton uchun)
  const batch = item && item.product.unit === "m3"
    ? await db.productionBatch.findFirst({ where: { cancelledAt: null, orderId: t.orderId, productId: item.productId, ...(t.loadedAt ? { date: { lte: t.loadedAt } } : {}) }, orderBy: { date: "desc" }, select: { batchNo: true, date: true } })
    : null;

  const no = t.ttn ?? t.deliveryNoteNo;
  const concrete = item?.product.unit === "m3";
  const customer = t.order.customer;
  // Quyish va suv — faqat beton uchun; dona mahsulotda (ustun, blok) faqat chiqish/yetish vaqti
  const times = [
    { title: "Zavoddan chiqdi" },
    { title: "Obyektga yetdi" },
    ...(concrete ? [{ title: "Quyish boshlandi" }, { title: "Quyish tugadi" }, { title: "Suv qo'shildi", water: true }] : []),
  ];
  const timeCols = TIME_W.slice(0, times.length);

  // Bitta nusxa — A4 ning yarmi, qat'iy 194 × 134 mm: ikkinchisi doim pastki yarimda, qirqish chizig'i o'rtada
  const copy = (label: string) => (
    <section className="relative overflow-hidden" style={{ width: "194mm", height: "134mm", fontSize: "10.5px", lineHeight: 1.32 }}>
      <div className="bg-black" style={at(L.topLine)} />
      <div style={at(L.title, { fontSize: "14.5px", fontWeight: 800 })}>TOVAR-TRANSPORT NAKLADNOYI <span style={{ fontSize: "1.17em" }}>№ {no}</span></div>
      <div style={at(L.meta)}>
        Sana <b>{date(t.loadedAt ?? t.createdAt)}</b> · Yuklash vaqti <b>{t.loadedAt ? dateTime(t.loadedAt) : "—"}</b>
        {concrete && <> · Zames № <b>{batch?.batchNo ?? "—"}</b></>}
        {t.ttn && <> · Tizim № {t.deliveryNoteNo}</>}
      </div>
      {/* Beton qaysi BRU (beton qorishma uzeli) dan olingani — reys ochilganda tanlanadi */}
      {(concrete || t.bru) && <div style={at(L.bru)}>BRU: <b>{t.bru ?? "—"}</b></div>}
      <div style={at(L.label, { fontSize: "8.5px", textAlign: "right" })}><b>{label}</b><br /><span className={GRAY}>Tekshirish uchun<br />skanerlang</span></div>
      <div className="bg-white [&>svg]:block [&>svg]:h-full [&>svg]:w-full" style={at(L.qr)} dangerouslySetInnerHTML={{ __html: qr }} />
      <div className="bg-black" style={at(L.sepLine)} />

      <Party pos={L.sender} title="Yuk jo'natuvchi" name={company.legalName ?? company.name}
        sub={[`Olgan joyi: ${t.pickupAddress ?? company.address ?? "—"}`, [company.inn && `INN ${company.inn}`, company.phone].filter(Boolean).join(" · ")]} />
      <Party pos={L.receiver} title="Yuk oluvchi" name={<>{customer.name}{customer.inn && <span className="font-normal"> (INN {customer.inn})</span>}</>}
        sub={[[t.order.deliveryAddress, customer.phone].filter(Boolean).join(" · ") || "—"]} />
      <Party pos={L.transport} title="Transport / haydovchi" name={<>{t.vehicle.plate}{t.vehicle.external && <span className="font-normal"> (ko&apos;chadan)</span>}</>}
        sub={[[t.driver.fullName, t.vehicle.external && t.driver.phone].filter(Boolean).join(" · ")]} />

      <table className="border-collapse" style={at(L.items)}>
        <thead><tr className="bg-[#eee]">
          <th className={`${CELL} text-left`}>№</th>
          <th className={`${CELL} text-left`}>Mahsulot</th>
          <th className={`${CELL} text-left`}>Klass</th>
          <th className={`${CELL} text-right`}>Miqdor, {unitLabel(item?.product.unit ?? "m3")}</th>
          <th className={`${CELL} text-right`}>Narx</th>
          <th className={`${CELL} text-right`}>Summa</th>
        </tr></thead>
        <tbody><tr>
          <td className={CELL}>1</td>
          <td className={CELL}>{item?.product.name}</td>
          <td className={CELL}>{item?.product.strengthClass ?? "—"}</td>
          <td className={`${CELL} text-right`}>{qty(t.qtyM3)}</td>
          <td className={`${CELL} text-right`}>{item ? money(item.price) : "—"}</td>
          <td className={`${CELL} text-right font-bold`}>{money(sum)}</td>
        </tr></tbody>
      </table>

      {/* Vaqt nazorati — qo'lda yoziladi (beton 90 daqiqa qoidasi bo'yicha da'volarda dalil) */}
      <div className="grid border border-black" style={at({ ...L.times, w: timeCols.reduce((a, b) => a + b, 0) }, { gridTemplateColumns: timeCols.map((w) => `${w}fr`).join(" ") })}>
        {times.map((c, i) => (
          <div key={c.title} className={`px-[1.6mm] py-[0.8mm] ${i ? "border-l border-black" : ""}`}>
            <div className={CAPS}>{c.title}</div>
            {"water" in c
              ? <div className="mt-[1.4mm] text-[0.9em] whitespace-nowrap"><span className={BOX} /> yo&apos;q <span className={`${BOX} ml-[1mm]`} /> ha ____ l</div>
              : <div className="mt-[1.4mm] text-[1.05em] tracking-[.04em] whitespace-nowrap">____ : ____</div>}
          </div>
        ))}
      </div>

      <SignRow pos={L.signs[0]} title="Yukladi (zavod)" />
      <SignRow pos={L.signs[1]} title="Haydovchi" />
      <SignRow pos={L.signs[2]} title="Qabul qildi (obyekt)" name={t.receiverName} />
      <div className="rounded-full border-[1.2px] border-dashed border-[#8a8a8a]" style={at(L.stamp)} />
    </section>
  );

  return (
    <div className="overflow-x-auto print:overflow-visible">
      <div className="paper mx-auto w-[210mm] rounded-sm bg-white p-[8mm] text-black [print-color-adjust:exact] print:w-auto print:rounded-none print:p-0 print:shadow-none">
        <style>{`@media print { @page { size: A4 portrait; margin: 8mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-[11.5px] print:hidden">
          <BackLink href={`/trips/${id}`} label="Reys" />
          <PrintButton />
        </div>
        {!fromEnv && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">
            QR havolasi <b>{origin}</b> ga ishora qiladi — telefon bu manzilni ocha olmasligi mumkin. <code>.env</code> da <code>APP_URL</code> ni serverning tashqi manzili (masalan, <code>http://192.168.1.10:3000</code> yoki domen) qilib bering.
          </div>
        )}
        {copy("Zavod nusxasi")}
        <div className="flex h-[5mm] items-center"><span className="flex-1 border-t border-dashed border-slate-400" /></div>
        {copy("Yuk oluvchi nusxasi")}
      </div>
    </div>
  );
}
