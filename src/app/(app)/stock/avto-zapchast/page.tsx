import Link from "next/link";
import { Car, PackagePlus, Truck } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { avtoPartsFeed, avtoPartsUnread } from "@/lib/avto-parts";
import { date, dateTime, fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { SeenMarker } from "./seen-marker";

const DAYS = 30;

/**
 * Yangi kelgan avto zapchastlar — tepadagi bannerdagi «Ko'rish» shu yerga olib keladi.
 * So'nggi 30 kun: skladga kirim bo'lganlari va spravochnikka qo'shilgan kartalar. Xodim hali ko'rmaganlari
 * (o'qilmagan xabardan keyingilari) «Yangi» bilan ajratiladi; sahifa ochilgach xabarlar o'qilgan bo'ladi.
 */
export default async function AvtoPartsPage() {
  const s = await requirePage("/stock");
  const [{ feed, parts }, unread] = await Promise.all([avtoPartsFeed(DAYS), avtoPartsUnread(s.userId)]);
  const since = unread.since?.getTime() ?? null;
  // Xabar yozilishi kirimdan bir necha soniya keyin (guruhlash) — chegara 1 daqiqa oldinga suriladi
  const isNew = (d: Date) => since != null && d.getTime() >= since - 60_000;
  const fresh = feed.filter((f) => isNew(f.addedAt)).length;
  const inStock = parts.filter((p) => p.balance > 0).length;
  return (
    <div>
      <SeenMarker unread={unread.count} />
      <PageHeader back={{ href: "/stock", label: "Sklad" }} title="Yangi kelgan avto zapchastlar"
        subtitle={`So'nggi ${DAYS} kun: skladga kelgan va ro'yxatga qo'shilgan avto zapchastlar${fresh ? ` · ${fresh} tasi siz uchun yangi` : ""}`} />

      <div className="space-y-5">
        <Table>
          <thead><tr><Th>Sana</Th><Th>Avto zapchast</Th><Th>Nima bo&apos;ldi</Th><Th right>Miqdor</Th><Th>Ta&apos;minotchi</Th><Th>Hujjat</Th></tr></thead>
          <tbody>
            {feed.length === 0 && <Empty text={`So'nggi ${DAYS} kunda avto zapchast kelmagan`} icon={Car} />}
            {feed.map((f) => (
              <Tr key={f.key} className={cn(isNew(f.addedAt) && "bg-blue-50/60")}>
                <Td className="whitespace-nowrap">{f.kind === "in" ? date(f.date) : dateTime(f.date)}</Td>
                <Td>
                  <span className="font-medium text-slate-900">{f.name}</span>
                  <span className="ml-1.5 text-[11px] text-slate-400">{f.code}</span>
                  {isNew(f.addedAt) && <span className="ml-1.5 inline-block align-middle"><Badge color="blue" dot={false}>Yangi</Badge></span>}
                </Td>
                <Td>{f.kind === "in"
                  ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><Truck size={15} aria-hidden /> Skladga keldi</span>
                  : <span className="inline-flex items-center gap-1.5 text-violet-700"><PackagePlus size={15} aria-hidden /> Ro&apos;yxatga qo&apos;shildi</span>}</Td>
                <Td right className="tabular">{f.qty != null ? `${fmtNum(f.qty, 3)} ${unitLabel(f.unit)}` : "—"}</Td>
                <Td>{f.supplier ?? "—"}</Td>
                <Td>{f.receiptId ? <Link href={`/receipts/${f.receiptId}`} className="hover:underline">{f.docNo}</Link> : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>

        <Card>
          <CardHeader icon={Car} title="Barcha avto zapchastlar — skladdagi qoldiq" description={`${parts.length} ta · ${inStock} tasi skladda bor`} />
          {parts.length === 0
            ? <p className="text-sm text-slate-500">Avto zapchast kategoriyasida mahsulot yo&apos;q — Sklad → Qoldiqlar jadvalida belgilab «Avto zapchast» ga o&apos;tkazing.</p>
            : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {parts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{p.name}</span>
                      <span className="block text-xs text-slate-500">{p.code}{p.lastIn ? ` · oxirgi kirim ${date(p.lastIn)}` : ""}</span>
                    </span>
                    <span className={cn("shrink-0 tabular font-semibold", p.balance > 0 ? "text-emerald-700" : "text-slate-400")}>{fmtNum(p.balance, 3)} {unitLabel(p.unit)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>
    </div>
  );
}
