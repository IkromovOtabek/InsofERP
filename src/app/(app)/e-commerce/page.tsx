import Link from "next/link";
import { Smartphone, ShoppingBag, Store, Inbox, ExternalLink, History, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { dateTime, fmtNum } from "@/lib/format";
import { formatPhone } from "@/lib/sms/phone";
import { unitLabel } from "@/lib/unit";
import { SHOP_SOURCE } from "@/lib/shop";
import { Badge, Callout, Card, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { ShopItemForm, type ShopRowProduct } from "./shop-item-form";
import { BannerForm } from "./banner-form";
import { ShopHistoryList } from "./history";
import { shopHistory } from "@/lib/shop-history";
import { isoDate } from "@/lib/format";

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
export default async function EcommercePage({ searchParams }: { searchParams: Promise<{ tab?: string; p?: string }> }) {
  await requireRoles(["SALES", "DIRECTOR"]);
  const { tab = "vitrina", p: historyFor } = await searchParams;

  const [products, leads, banners] = await Promise.all([
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
    db.shopBanner.findMany({ orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }] }),
  ]);

  // Tarix uchun nomlar: ShopItem id va Product id → mahsulot nomi (reklama mahsuloti ham shu yerdan)
  const names = new Map<string, string>();
  for (const p of products) { names.set(p.id, p.name); if (p.shopItem) names.set(p.shopItem.id, p.shopItem.title?.trim() || p.name); }
  const history = await shopHistory({ names, entityIds: tab === "tarix" && historyFor ? [historyFor] : undefined });
  // Har vitrina qatoriga oxirgi o'zgarish (kim, qachon) — tarix yangidan eskiga tartiblangan
  const lastChange = new Map<string, { user: string; at: Date }>();
  for (const h of history) if (h.entity === "ShopItem" && !lastChange.has(h.entityId)) lastChange.set(h.entityId, { user: h.user, at: h.at });

  const rows: ShopRowProduct[] = products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    strengthClass: p.strengthClass,
    price: Number(p.price),
    group: p.group?.name ?? null,
    lastChange: p.shopItem && lastChange.has(p.shopItem.id)
      ? { itemId: p.shopItem.id, user: lastChange.get(p.shopItem.id)!.user, at: dateTime(lastChange.get(p.shopItem.id)!.at) }
      : null,
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
        { key: "reklama", label: "Reklama", href: "/e-commerce?tab=reklama", count: banners.filter((b) => b.isActive).length },
        { key: "buyurtmalar", label: "Buyurtmalar", href: "/e-commerce?tab=buyurtmalar", count: newLeads },
        { key: "tarix", label: "Tarix", href: "/e-commerce?tab=tarix", icon: History },
      ]} />

      {tab === "tarix" ? (
        <ShopHistoryList entries={history} filter={historyFor ? { subject: names.get(historyFor) ?? "Mahsulot" } : undefined} />
      ) : tab === "buyurtmalar" ? (
        <OrdersTab leads={leads} />
      ) : tab === "reklama" ? (
        <Card>
          <h2 className="mb-1 font-semibold">Reklama (ADS)</h2>
          <p className="mb-2 text-xs text-slate-500">Ilova bosh sahifasidagi swiper'da asosiy taklif, buyurtma qadamlari va "Nega biz" slaydlari bilan birga aylanadi. Muddat berilsa faqat shu kunlarda ko'rinadi.</p>
          <div className="divide-y divide-slate-100">
            {banners.map((b) => (
              <BannerForm key={b.id} products={products.map((p) => ({ id: p.id, name: p.name }))}
                b={{ id: b.id, title: b.title, subtitle: b.subtitle, image: b.image, productId: b.productId, buttonText: b.buttonText, isActive: b.isActive, sortOrder: b.sortOrder, startsAt: b.startsAt ? isoDate(b.startsAt) : "", endsAt: b.endsAt ? isoDate(b.endsAt) : "" }} />
            ))}
            <BannerForm products={products.map((p) => ({ id: p.id, name: p.name }))} />
          </div>
        </Card>
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
              {published.length === 0 && <EmptyNote text="Chiqarilgan mahsulot yo'q" icon={Store} />}
              {published.map((p) => <ShopItemForm key={p.id} p={p} />)}
            </div>
          </Card>
          <Card>
            <h2 className="mb-1 font-semibold">Yashirin mahsulotlar</h2>
            <p className="mb-2 text-xs text-slate-500">Faol mahsulotlar, lekin do'konda ko'rinmaydi. Yangi mahsulot Sozlamalar → Beton markalarida ochiladi.</p>
            <div className="divide-y divide-slate-100">
              {hidden.length === 0 && <EmptyNote text="Hamma mahsulot do'konda" icon={ShoppingBag} />}
              {hidden.map((p) => <ShopItemForm key={p.id} p={p} />)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/** Jadvaldan tashqaridagi bo'sh holat: `Empty` `<tr>` qaytaradi — `<div>` ichida gidratsiya xatosi beradi. */
function EmptyNote({ text, icon: Icon }: { text: string; icon: LucideIcon }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon size={18} /></div>
      <div className="text-sm text-slate-500">{text}</div>
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
