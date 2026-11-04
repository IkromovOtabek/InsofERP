import { HardHat, PackageX, TriangleAlert } from "lucide-react";
import type { Session } from "@/lib/auth";
import { canSee } from "@/lib/nav";
import { canDo } from "@/lib/permissions";
import { stockStatus } from "@/lib/production-report";
import { undistributedMaterials } from "@/lib/brigade-stock";
import { StatCard } from "@/components/ui";
import { RawStockStatus } from "@/components/raw-stock-status";

/**
 * Sklad xodimi (WAREHOUSE) bosh sahifasi: zayavkalarga yetmaydigan va kam qolgan xomashyo, kelib hali brigadalarga
 * berilmagan mahsulot va xomashyo holati jadvali. Ilgari umumiy operatsion ko'rinishni (debitorka, kredit bloklari,
 * jonli xarita, mikserlar, reyslar) ko'rardi — bu uning ishi emas, havolalari ham unga yopiq sahifalarga olib borardi.
 */
export async function WarehouseHome({ s }: { s: Session }) {
  // «Brigadalarga berish» — Sklad sahifasidagi tugma bilan bir xil shart
  const seeBrigade = canDo(s, "stock", "brigade") && canSee(s, "stock", "brigada");
  const [stock, undistributed] = await Promise.all([stockStatus(), seeBrigade ? undistributedMaterials() : null]);
  const gap = stock.filter((m) => m.orderGap > 0).length;
  const low = stock.filter((m) => m.level !== "ok" && m.orderGap <= 0).length;

  return (
    <div className="min-w-0 space-y-6">
      <div className={"grid grid-cols-2 gap-3 [&>*]:min-w-0 " + (undistributed ? "xl:grid-cols-3" : "xl:grid-cols-2")}>
        <StatCard label="Zayavkalarga yetmaydi" value={`${gap} ta`} hint="tasdiqlangan zayavkalar uchun xomashyo" icon={PackageX} tone={gap > 0 ? "danger" : "default"} href="/stock?bolim=holat" />
        <StatCard label="Kam qoldi" value={`${low} ta`} hint="minimal qoldiqdan kam yoki tez tugaydi" icon={TriangleAlert} tone={low > 0 ? "warning" : "default"} href="/stock?bolim=holat" />
        {undistributed && <StatCard label="Brigadaga berilmagan" value={`${undistributed.count} ta`} hint="so'nggi 30 kunda kelgan mahsulot" icon={HardHat} tone={undistributed.count > 0 ? "info" : "default"} href="/stock?tab=brigades" />}
      </div>
      <RawStockStatus stock={stock} />
    </div>
  );
}
