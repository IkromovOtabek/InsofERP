import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { apkInfo, apkSize, iosAppUrl } from "@/lib/apk";
import { navFor, ROLE_LABELS } from "@/lib/nav";
import { AppShell } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { InputMemory } from "@/components/input-memory";
import { tourFor, TOUR_COOKIE, TOUR_DONE } from "@/lib/tour";
import { billingNotice, isControlMode } from "@/lib/tenant";
import { date } from "@/lib/format";
import { Callout } from "@/components/ui";
import { AvtoPartsBanner } from "@/components/avto-parts-banner";
import { canDo } from "@/lib/permissions";
import { pendingShipments } from "@/lib/shipments";
import { ShipmentBanner } from "@/components/shipment-banner";
import { ARENDA_PATH, arendaHost, isArendaHost } from "@/lib/arenda-host";

/** Arenda domenida sarlavha «Insof Arenda» (lib/arenda-host.ts) */
export async function generateMetadata(): Promise<Metadata> {
  return isArendaHost(await headers()) ? { title: { absolute: "Insof Arenda", template: "%s · Insof Arenda" } } : {};
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Markaziy panel jarayonida korxona sahifalari yo'q (middleware ham yo'naltiradi — ikkinchi himoya)
  if (isControlMode()) redirect("/superadmin");
  const s = await getSession();
  if (!s) redirect("/api/logout");
  const company = await getCompany();
  const apk = await apkInfo();
  // Instruksiyaning joriy bosqichi (yoki "done") — cookie sessiya bilan birga o'chadi
  // «Qayta ko'rsatilmasin» bosgan foydalanuvchiga avtomatik chiqmaydi (tepadagi tugmadan ko'rsa bo'ladi)
  const tourRaw = (await cookies()).get(TOUR_COOKIE)?.value;
  const tourHidden = (await db.user.findUnique({ where: { id: s.userId }, select: { tourHidden: true } }))?.tourHidden;
  const tourStart = tourHidden ? TOUR_DONE : tourRaw ? decodeURIComponent(tourRaw) : null;
  // Snabjeniye jo'natmasi — qabul qiladigan sklad xodimiga tepada banner (direktor qabul qilmaydi — unga ko'rsatilmaydi)
  // Arenda domeni: menyuda faqat Arenda, ERP bannerlari, AI va boshqa rollar instruksiyasi yo'q.
  // Asosiy domenda (ARENDA_HOST berilgan bo'lsa) «Arenda» bandi yo'q — u faqat o'z domenida (asosiy domendagi /arenda o'sha yerga o'tadi).
  // Direktor menyusida ham yo'q (sahifa havola orqali ochiladi), arenda domenida esa qoladi
  const arenda = isArendaHost(await headers());
  const nav = navFor(s.role, s.perms);
  const items = arenda ? nav.filter((i) => i.href === ARENDA_PATH)
    : arendaHost() || s.role === "DIRECTOR" ? nav.filter((i) => i.href !== ARENDA_PATH) : nav;
  const tourSteps = s.superadmin || (arenda && s.role !== "SECRETARY") ? []
    : arenda ? tourFor(s.role).map((t) => (t.id === "intro" ? { ...t, title: "Insof Arenda — qisqa instruksiya" } : t)) : tourFor(s.role);
  const shipments = !arenda && s.role !== "DIRECTOR" && canDo(s, "stock", "shipment_accept") ? await pendingShipments() : null;
  // Platforma obunasi tugayapti / o'tgan — faqat direktor (va IT) ko'radi; xodimlarga ko'rsatilmaydi
  const bill = s.role === "DIRECTOR" ? await billingNotice().catch(() => null) : null;
  const dmy = (iso: string) => date(new Date(`${iso}T00:00:00`));
  return (
    <AppShell items={items} product={arenda ? "Insof Arenda" : undefined} user={{ fullName: s.fullName, roleLabel: s.superadmin ? ROLE_LABELS.SUPERADMIN : ROLE_LABELS[s.role] }} brand={company.name} ai={!arenda && ["DIRECTOR", "FINANCE", "ACCOUNTING"].includes(s.role)} apk={apk.exists ? apkSize(apk.size) : null} ios={iosAppUrl()} tour={{ steps: tourSteps, start: tourStart }}>
      {/* Ma'lumot o'zi yangilanib turadi — sahifani qo'lda yangilash shart emas */}
      <LiveRefresh />
      {/* Qo'lda yozilgan qiymatlar eslab qolinadi va keyingi safar taklif qilinadi */}
      <InputMemory />
      {s.superadmin && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
          IT superadmin rejimi — direktor huquqi bilan ishlayapsiz. Har amal korxonaning audit jurnaliga yoziladi.
        </div>
      )}
      {bill && (
        <Callout tone={bill.daysLeft >= 0 ? "warning" : "danger"} title={bill.daysLeft >= 0 ? "Platforma obunasi tugayapti" : "Platforma obunasi muddati o'tgan"}>
          {bill.daysLeft >= 0
            ? <>Obuna <b>{dmy(bill.paidUntil)}</b> da tugaydi{bill.daysLeft > 0 ? ` (${bill.daysLeft} kun qoldi)` : " (bugun)"}. To&apos;lov bo&apos;yicha Insof administratoriga murojaat qiling.</>
            : <>Obuna <b>{dmy(bill.paidUntil)}</b> da tugagan. To&apos;lov qilinmasa <b>{dmy(bill.suspendOn)}</b> dan tizim vaqtincha to&apos;xtatiladi (ma&apos;lumotlar saqlanadi).</>}
        </Callout>
      )}
      {shipments && <ShipmentBanner count={shipments.count} rows={shipments.rows.map((r) => ({ id: r.id, docNo: r.docNo, by: r.by, supplier: r.supplier, pending: r.pending }))} />}
      {/* Mexanik: yangi qo'shilgan / skladga kelgan avto zapchastlar — «Ko'rish» bilan to'liq ro'yxat */}
      {!arenda && s.role === "MECHANIC" && !s.superadmin && <AvtoPartsBanner userId={s.userId} />}
      {children}
    </AppShell>
  );
}
