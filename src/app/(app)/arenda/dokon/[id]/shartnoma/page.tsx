import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { date, fmtNum } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { numWords } from "@/lib/num-words";
import { currentLeases } from "@/lib/rent";
import { PrintButton } from "@/components/print-button";
import { BackLink } from "@/components/ui";

/**
 * Ijara shartnomasi — chop etish uchun (A4). Ma'lumot shartnomadan (`RentLease`: ijarachi, muddat, zaklad) va do'kondan
 * (joy, maydon, ijara haqi, to'lov kuni). `?lease=` — qaysi shartnoma, berilmasa — joriysi. Matn — umumiy namuna:
 * imzolashdan oldin tomonlar kelishuviga qarab qo'lda to'ldiriladi/tuzatiladi.
 */
export default async function RentContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lease?: string }> }) {
  await requirePage("/arenda");
  const { id } = await params;
  const sp = await searchParams;
  const shop = await db.rentShop.findUnique({ where: { id } });
  if (!shop) notFound();
  const leaseId = sp.lease ?? (await currentLeases([id])).get(id)?.id ?? null;
  const lease = leaseId ? await db.rentLease.findUnique({ where: { id: leaseId } }) : null;
  if (!lease || lease.shopId !== id) notFound();
  const company = await getCompany();

  const daily = shop.period === "DAILY";
  const bank = Number(shop.bankAmount), cash = Number(shop.cashAmount), rent = bank + cash;
  const deposit = Number(lease.deposit);
  const words = (v: number) => { const w = numWords(v); return w.charAt(0).toUpperCase() + w.slice(1); };
  const companyName = company.legalName ?? company.name;
  const tenant = lease.tenantName ?? "________________________";
  const blank = <span className="inline-block w-40 border-b border-black align-baseline" />;
  const p = "mt-1.5 text-justify";

  return (
    <div className="paper mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-black print:max-w-none print:p-0">
      <style>{`@media print { @page { size: A4 portrait; margin: 15mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <BackLink href={`/arenda/dokon/${id}`} label={shop.name} />
        <PrintButton />
      </div>

      <h1 className="text-center text-base font-bold uppercase">Ijara shartnomasi № {lease.no ?? "____"}</h1>
      <div className="mt-2 flex justify-between text-[12px]">
        <span>{company.address ? company.address.split(",")[0] : "________"}</span>
        <span>{date(lease.startDate)}</span>
      </div>

      <p className="mt-4 text-justify">
        <b>{companyName}</b>{company.directorName ? <>, direktor <b>{company.directorName}</b> shaxsida</> : null} (bundan buyon — «Ijaraga beruvchi»)
        {" "}bir tomondan, va <b>{tenant}</b>{lease.inn ? ` (INN/JShShIR ${lease.inn})` : ""} (bundan buyon — «Ijarachi») ikkinchi tomondan,
        {" "}ushbu shartnomani quyidagilar haqida tuzdik:
      </p>

      <h2 className="mt-4 font-bold">1. Shartnoma predmeti</h2>
      <p className={p}>1.1. Ijaraga beruvchi Ijarachiga vaqtincha foydalanish uchun quyidagi savdo joyini beradi: <b>«{shop.name}»</b>, manzil (joy): <b>{shop.location}</b>
        {shop.area ? <>, maydoni <b>{fmtNum(shop.area, 2)} m²</b></> : null}.</p>
      <p className={p}>1.2. Joy savdo faoliyati uchun beriladi; Ijarachi uni boshqa maqsadda ishlatishi yoki uchinchi shaxsga berishi faqat Ijaraga beruvchining yozma roziligi bilan mumkin.</p>

      <h2 className="mt-4 font-bold">2. Ijara muddati</h2>
      <p className={p}>2.1. Ijara {date(lease.startDate)} dan {lease.endDate ? <><b>{date(lease.endDate)}</b> gacha</> : "muddatsiz (tomonlardan biri bekor qilguncha)"} amal qiladi.</p>
      <p className={p}>2.2. Muddat tugashidan kamida 15 kun oldin tomonlar shartnomani uzaytirish yoki tugatish haqida bir-birini ogohlantiradi.</p>

      <h2 className="mt-4 font-bold">3. Ijara haqi va to&apos;lov tartibi</h2>
      <p className={p}>
        3.1. Ijara haqi {daily ? "bir kun" : "bir oy"} uchun <b>{fmtNum(rent)} so&apos;m</b> ({words(rent)} so&apos;m)
        {bank && cash ? <>, shundan bank orqali (perechisleniye) {fmtNum(bank)} so&apos;m va naqd {fmtNum(cash)} so&apos;m</> : bank ? ", bank orqali (perechisleniye)" : ", naqd pulda"}.
      </p>
      <p className={p}>3.2. {daily ? "Ijara haqi har kuni, shu kun uchun to'lanadi." : <>Ijara haqi har oyning <b>{shop.payDay ?? "___"}-sanasigacha</b> joriy oy uchun to&apos;lanadi. Bir necha oy uchun oldindan to&apos;lash mumkin.</>}</p>
      <p className={p}>3.3. Elektr energiyasi: {shop.electricityBilled ? "Ijarachi hisoblagich ko'rsatkichi bo'yicha belgilangan tarifda har oy ijara haqi bilan birga to'laydi." : "ijara haqiga kiritilgan."}</p>
      {deposit > 0 && <p className={p}>3.4. Ijarachi kafolat sifatida <b>{fmtNum(deposit)} so&apos;m</b> ({words(deposit)} so&apos;m) zaklad to&apos;laydi. Shartnoma tugaganda qarz va zarar bo&apos;lmasa zaklad qaytariladi, bo&apos;lsa — undan ushlab qolinadi.</p>}
      <p className={p}>3.{deposit > 0 ? 5 : 4}. Har bir to&apos;lov uchun Ijaraga beruvchi kvitansiya beradi; kvitansiyadagi QR kod orqali to&apos;lov va qarz holatini tekshirish mumkin.</p>

      <h2 className="mt-4 font-bold">4. Tomonlarning majburiyatlari</h2>
      <p className={p}>4.1. Ijaraga beruvchi joyni foydalanishga yaroqli holda topshiradi va ijara davrida Ijarachining qonuniy faoliyatiga to&apos;sqinlik qilmaydi.</p>
      <p className={p}>4.2. Ijarachi ijara haqini o&apos;z vaqtida to&apos;laydi, joyni ozoda va yaroqli holda saqlaydi, yong&apos;in xavfsizligi va sanitariya qoidalariga rioya qiladi, shartnoma tugaganda joyni dastlabki holatida qaytaradi.</p>

      <h2 className="mt-4 font-bold">5. Javobgarlik va shartnomani bekor qilish</h2>
      <p className={p}>5.1. Ijara haqi kechiktirilsa Ijaraga beruvchi Telegram yoki telefon orqali eslatma yuboradi; to&apos;lov ketma-ket 2 oy (kunlik ijarada 10 kun) kechiktirilsa, shartnomani bir tomonlama bekor qilishga haqli.</p>
      <p className={p}>5.2. Tomonlar shartnomani o&apos;zaro kelishuv bilan yoki 15 kun oldin yozma ogohlantirib bekor qilishi mumkin. Bekor qilinganda o&apos;zaro hisob-kitob akt-sverka bilan yopiladi.</p>
      <p className={p}>5.3. Nizolar muzokara yo&apos;li bilan, kelishilmasa — O&apos;zbekiston Respublikasi qonunchiligiga muvofiq sudda hal qilinadi.</p>
      {lease.note && <><h2 className="mt-4 font-bold">6. Qo&apos;shimcha shartlar</h2><p className={p}>{lease.note}</p></>}

      <h2 className="mt-4 font-bold">{lease.note ? 7 : 6}. Tomonlarning rekvizitlari va imzolari</h2>
      <div className="mt-2 grid grid-cols-2 gap-8 text-[12px]">
        <div>
          <div className="font-semibold">Ijaraga beruvchi</div>
          <div>{companyName}</div>
          {company.address && <div>{company.address}</div>}
          {company.inn && <div>INN {company.inn}</div>}
          {company.bankAccount && <div>H/r {company.bankAccount}{company.bankName ? `, ${company.bankName}` : ""}{company.mfo ? `, MFO ${company.mfo}` : ""}</div>}
          {company.phone && <div>Tel.: {formatPhone(company.phone)}</div>}
          <div className="mt-8 border-b border-black" />
          <div className="mt-1 text-slate-600">{company.directorName ?? "imzo"} · M.O&apos;.</div>
        </div>
        <div>
          <div className="font-semibold">Ijarachi</div>
          <div>{tenant}</div>
          {lease.inn && <div>INN/JShShIR {lease.inn}</div>}
          <div>Pasport: {blank}</div>
          {lease.phone && <div>Tel.: {formatPhone(lease.phone)}</div>}
          <div className="mt-8 border-b border-black" />
          <div className="mt-1 text-slate-600">imzo</div>
        </div>
      </div>
    </div>
  );
}
