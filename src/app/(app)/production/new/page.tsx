import { db } from "@/lib/db";
import { customerMarks, markedName } from "@/lib/finance";
import { redirect } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { productCatalog } from "@/lib/product-catalog";
import { canEditProducts } from "@/lib/catalog";
import { BatchForm, type OpenTask } from "../batch-form";
import { unitLabel } from "@/lib/unit";

export default async function NewBatch() {
  const s = await requirePage("/production");
  // Zames faqat ishlab chiqarish (va direktor) yozadi — boshqalarga xato sahifasi emas, ro'yxatga qaytish
  if (s.role !== "PRODUCTION" && s.role !== "DIRECTOR") redirect("/production");
  const [orders, catalog, warehouses, tasks] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      orderBy: { deliveryDate: "asc" },
      include: { customer: true, items: { include: { product: true } }, batches: true },
    }),
    productCatalog(), // hamma joyda bir xil mahsulot ro'yxati
    db.warehouse.findMany({ where: { isActive: true } }),
    // Ochiq brigada topshiriqlari — faqat DONA mahsulot bo'yicha: brigada qayd qilganda
    // shunday mahsulot hovliga o'zi kirim bo'ladi, ustiga zames yozilsa ikki marta hisoblanadi.
    // Beton (m³) bunga kirmaydi — uning yagona kirim yo'li shu zames.
    db.brigadeTask.findMany({
      where: { status: { in: ["NEW", "IN_PROGRESS"] }, orderItem: { product: { unit: { not: "m3" } } } },
      include: { brigade: { select: { name: true } }, order: { select: { orderNo: true } }, orderItem: { select: { productId: true, product: { select: { unit: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const openTasks: Record<string, OpenTask[]> = {};
  for (const t of tasks) {
    (openTasks[t.orderItem.productId] ??= []).push({
      taskNo: t.taskNo, brigade: t.brigade.name, orderNo: t.order.orderNo,
      qty: Number(t.qty), doneQty: Number(t.doneQty), unit: unitLabel(t.orderItem.product.unit),
    });
  }
  const marks = await customerMarks(orders.map((o) => o.customerId));
  // Har zayavka QATORI alohida variant: o'z mahsuloti, birligi va shu mahsulot bo'yicha qolgan miqdori.
  // Zames faqat beton (m³) uchun — dona mahsulot brigada topshirig'i orqali chiqariladi.
  // Zames `orderItemId` saqlamaydi, shuning uchun qoldiq (zayavka, mahsulot) juftligi bo'yicha:
  // bir zayavkada bir marka ikki qatorda bo'lsa — bitta variant (miqdorlar qo'shiladi).
  const orderOpts = orders.flatMap((o) => {
    const byProduct = new Map<string, { name: string; unit: string; total: number }>();
    for (const i of o.items) {
      if (i.product.unit !== "m3") continue;
      const cur = byProduct.get(i.productId) ?? { name: i.product.name, unit: i.product.unit, total: 0 };
      cur.total += Number(i.qtyM3);
      byProduct.set(i.productId, cur);
    }
    return [...byProduct].map(([productId, x]) => {
      const done = o.batches.filter((b) => b.productId === productId).reduce((s, b) => s + Number(b.qtyM3), 0);
      return {
        key: `${o.id}~${productId}`, id: o.id, orderNo: o.orderNo, customer: markedName(o.customer.name, o.customerId, marks),
        productId, product: x.name, remainingM3: Math.max(0, Math.round((x.total - done) * 1000) / 1000), unit: unitLabel(x.unit),
      };
    });
  }).filter((o) => o.remainingM3 > 0);

  return (
    <div>
      <PageHeader title="Yangi zames" subtitle="Saqlanganda retsept bo'yicha xomashyo skladdan avtomatik yozib olinadi" />
      <BatchForm
        orders={orderOpts}
        products={catalog.products}
        groups={catalog.groups}
        canCreateProduct={canEditProducts(s.role)}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        openTasks={openTasks}
      />
    </div>
  );
}
