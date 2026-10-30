import { cookies } from "next/headers";
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
import { isControlMode } from "@/lib/tenant";
import { AvtoPartsBanner } from "@/components/avto-parts-banner";
import { canDo } from "@/lib/permissions";
import { pendingShipments } from "@/lib/shipments";
import { ShipmentBanner } from "@/components/shipment-banner";

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
  const shipments = s.role !== "DIRECTOR" && canDo(s, "stock", "shipment_accept") ? await pendingShipments() : null;
  return (
    <AppShell items={navFor(s.role, s.perms)} user={{ fullName: s.fullName, roleLabel: s.superadmin ? ROLE_LABELS.SUPERADMIN : ROLE_LABELS[s.role] }} brand={company.name} ai={["DIRECTOR", "FINANCE", "ACCOUNTING"].includes(s.role)} apk={apk.exists ? apkSize(apk.size) : null} ios={iosAppUrl()} tour={{ steps: s.superadmin ? [] : tourFor(s.role), start: tourStart }}>
      {/* Ma'lumot o'zi yangilanib turadi — sahifani qo'lda yangilash shart emas */}
      <LiveRefresh />
      {/* Qo'lda yozilgan qiymatlar eslab qolinadi va keyingi safar taklif qilinadi */}
      <InputMemory />
      {s.superadmin && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
          IT superadmin rejimi — direktor huquqi bilan ishlayapsiz. Har amal korxonaning audit jurnaliga yoziladi.
        </div>
      )}
      {shipments && <ShipmentBanner count={shipments.count} rows={shipments.rows.map((r) => ({ id: r.id, docNo: r.docNo, by: r.by, supplier: r.supplier, pending: r.pending }))} />}
      {/* Mexanik: yangi qo'shilgan / skladga kelgan avto zapchastlar — «Ko'rish» bilan to'liq ro'yxat */}
      {s.role === "MECHANIC" && !s.superadmin && <AvtoPartsBanner userId={s.userId} />}
      {children}
    </AppShell>
  );
}
