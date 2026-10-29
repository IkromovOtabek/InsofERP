import Link from "next/link";
import { Car, ChevronRight } from "lucide-react";
import { avtoPartsUnread } from "@/lib/avto-parts";
import { dateTime } from "@/lib/format";

/**
 * Mexanik uchun ekran tepasidagi banner: yangi qo'shilgan / skladga kelgan avto zapchastlar
 * (o'qilmagan AVTO_PART_* xabarlari). «Ko'rish» — to'liq ro'yxat; ochilgach banner yo'qoladi.
 */
export async function AvtoPartsBanner({ userId }: { userId: string }) {
  const u = await avtoPartsUnread(userId);
  if (u.count === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <Car size={20} className="shrink-0 text-blue-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{u.count > 1 ? `Yangi avto zapchastlar — ${u.count} ta xabar` : u.lines[0]?.title}</div>
        <ul className="mt-0.5 space-y-0.5 text-blue-800">
          {u.lines.map((l) => <li key={l.id} className="truncate">{u.count > 1 && <b className="font-medium">{l.title}: </b>}{l.body} <span className="text-xs text-blue-600/80">· {dateTime(l.createdAt)}</span></li>)}
        </ul>
      </div>
      <Link href="/stock/avto-zapchast" className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-4 font-semibold text-white transition hover:bg-blue-700 pointer-coarse:h-11">
        Ko&apos;rish <ChevronRight size={16} aria-hidden />
      </Link>
    </div>
  );
}
