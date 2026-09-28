import Link from "next/link";
import { Smartphone, ShoppingBag, Store, Inbox, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { dateTime, fmtNum } from "@/lib/format";
import { formatPhone } from "@/lib/sms/phone";
import { unitLabel } from "@/lib/unit";
import { SHOP_SOURCE } from "@/lib/shop";
import { Badge, Callout, Card, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { ShopItemForm, type ShopRowProduct } from "./shop-item-form";

const LEAD_STATUS = {
  NEW: { label: "Yangi", color: "amber" },
  IN_PROGRESS: { label: "Ishda", color: "blue" },
  CONVERTED: { label: "Mijoz bo'ldi", color: "green" },
  REJECTED: { label: "Bekor", color: "slate" },
} as const;

/**
 * E-commerce boshqaruv paneli (Sotuv bo'limi).
 *
 * Insof ECO ilovasi ochilganda login so'ramaydi — mehmon shu vitrinani ko'radi.
 * "Vitrina" tabi: qaysi mahsulot ko'rinadi, surat, tavsif, do'kon narxi.
 * "Buyurtmalar" tabi: ilovadan tushgan buyurtmalar (Lead, source = eco-shop) — ishlov
 * "Sayt arizalari" sahifasidagi bilan bir xil (bog'lanish, mijozga aylantirish).
 */
export default async function EcommercePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSession(["SALES", "DIRECTOR"]);
  const { tab = "vitrina" } = await searchParams;

  const [products, leads] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: [{ shopItem: { sortOrder: "asc" } }, { code: "asc" }],
      include: { shopItem: true, group: { select: { name: true } } },
    }),
    db.lead.findMany({
      where: { source: SHOP_SOURCE },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { product: { select: { name: true, unit: true } }, customer: { select: { id: true, name: true } } },
    }),
  ]);

  const rows: ShopRowProduct[] = products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    strengthClass: p.strengthClass,
    price: Number(p.price),
    group: p.group?.name ?? null,
    item: p.shopItem
      ? {
          isPublished: p.shopItem.isPublished,
          title: p.shopItem.title,
          description: p.shopItem.description,
          photo: p.shopItem.photo,
          price: p.shopItem.price == null ? null : Number(p.shopItem.price),
          minQty: p.shopItem.minQty == null ? null : Number(p.shopItem.minQty),
          badge: p.shopItem.badge,
          sortOrder: p.shopItem.sortOrder,
        }
      : null,
  }));
  // Chiqarilganlar yuqorida, keyin yashirinlar — sotuvchi avval vitrinani ko'radi
  const published = rows.filter((r) => r.item?.isPublished);
  const hidden = rows.filter((r) => !r.item?.isPublished);

  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const newLeads = leads.filter((l) => l.status === "NEW").length;
  const todayLeads = leads.filter((l) => l.createdAt > dayAgo).length;

  return (
    <div>
      <PageHeader
        title="E-commerce"
        subtitle="Insof ECO ilovasidagi do'kon. Ilova ochilganda mijoz login qilmasdan shu mahsulotlarni ko'radi va buyurtma qoldiradi — buyurtma sotuv bo'limiga ariza bo'lib tushadi."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Do'konda" value={String(published.length)} icon={Store} hint={`${rows.length} ta mahsulotdan`} tone={published.length ? "success" : "warning"} />
        <StatCard label="Yashirin" value={String(hidden.length)} icon={ShoppingBag} hint="chiqarilmagan" />
        <StatCard label="Yangi buyurtma" value={String(newLeads)} icon={Inbox} tone={newLeads ? "warning" : "default"} href="/e-commerce?tab=buyurtmalar" hint="ilovadan, ishlanmagan" />
        <StatCard label="Oxirgi 24 soat" value={String(todayLeads)} icon={Smartphone} hint="ilovadan buyurtma" />
      </div>

      <Tabs current={tab} className="mb-6" items={[
        { key: "vitrina", label: "Vitrina", href: "/e-commerce?tab=vitrina", count: published.length },
        { key: "buyurtmalar", label: "Buyurtmalar", href: "/e-commerce?tab=buyurtmalar", count: newLeads },
      ]} />

      {tab === "buyurtmalar" ? (
        <OrdersTab leads={leads} />
      ) : (
        <div className="space-y-4">
          {published.length === 0 && (
            <Callout tone="warning" title="Do'kon bo'sh">
              Hali birorta mahsulot chiqarilmagan — ilovada "Mahsulot yo'q" ko'rinadi. Quyidagi ro'yxatdan "Chiqarish" tugmasini bosing,
              keyin "Tahrirlash" orqali surat va tavsif qo'shing.
            </Callout>
          )}
          <Card>
            <h2 className="mb-1 font-semibold">Do'kondagi mahsulotlar</h2>
            <p className="mb-2 text-xs text-slate-500">Ilovada shu tartibda ko'rinadi. Nom va narx bo'sh qoldirilsa Sozlamalar → Beton markalaridagi qiymat olinadi.</p>
            <div className="divide-y divide-slate-100">
              {published.length === 0 && <Empty text="Chiqarilgan mahsulot yo'q" icon={Store} />}
              {published.map((p) => <ShopItemForm key={p.id} p={p} />)}
            </div>
          </Card>
          <Card>
            <h2 className="mb-1 font-semibold">Yashirin mahsulotlar</h2>
            <p className="mb-2 text-xs text-slate-500">Faol mahsulotlar, lekin do'konda ko'rinmaydi. Yangi mahsulot Sozlamalar → Beton markalarida ochiladi.</p>
            <div className="divide-y divide-slate-100">
              {hidden.length === 0 && <Empty text="Hamma mahsulot do'konda" icon={ShoppingBag} />}
              {hidden.map((p) => <ShopItemForm key={p.id} p={p} />)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function OrdersTab({ leads }: { leads: { id: string; name: string; phone: string; qty: unknown; address: string | null; message: string | null; status: keyof typeof LEAD_STATUS; createdAt: Date; product: { name: string; unit: string } | null; customer: { id: string; name: string } | null }[] }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div>
          <h2 className="font-semibold">Ilovadan tushgan buyurtmalar</h2>
          <p className="text-xs text-slate-500">Ishlov (bog'landim, mijozga aylantirish) "Sayt arizalari" sahifasida — u yerda ilova buyurtmalari ham turadi.</p>
        </div>
        <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-slate-700 hover:underline">Sayt arizalari <ExternalLink size={14} /></Link>
      </div>
      <Table className="mt-3">
        <thead><tr><Th>Vaqt</Th><Th>Mijoz</Th><Th>Telefon</Th><Th>Mahsulot</Th><Th right>Hajm</Th><Th>Manzil / izoh</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {leads.length === 0 && <Empty text="Ilovadan buyurtma hali tushmagan" icon={Smartphone} />}
          {leads.map((l) => {
            const st = LEAD_STATUS[l.status] ?? LEAD_STATUS.NEW;
            return (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap">{dateTime(l.createdAt)}</Td>
                <Td>{l.customer ? <Link href={`/customers/${l.customer.id}`} className="font-medium hover:underline">{l.customer.name}</Link> : <span className="font-medium">{l.name}</span>}</Td>
                <Td className="whitespace-nowrap"><a href={`tel:${l.phone}`} className="hover:underline">{formatPhone(l.phone)}</a></Td>
                <Td>{l.product?.name ?? "—"}</Td>
                <Td right className="whitespace-nowrap">{l.qty != null && l.product ? `${fmtNum(String(l.qty), 3)} ${unitLabel(l.product.unit)}` : "—"}</Td>
                <Td className="max-w-xs"><div className="truncate text-slate-700">{l.address ?? ""}</div>{l.message && <div className="truncate text-xs text-slate-500">{l.message}</div>}</Td>
                <Td><Badge color={st.color}>{st.label}</Badge></Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
