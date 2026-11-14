import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canEditMaterials } from "@/lib/catalog";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { issuePrices } from "@/lib/stock-price";
import { companyVatPayer } from "@/lib/receipt-vat";
import { dateRu, isoDate } from "@/lib/format";
import { visionEnabled } from "@/lib/ai/vision";
import { canSeePrixod } from "@/lib/stock-journal-access";
import { resolveReceiptPayments, syncWaybillInNote, waybillFromNote } from "@/lib/receipts";
import type { TargetGroups } from "@/lib/issue-target";
import { Callout, PageHeader } from "@/components/ui";
import { HoldingsPanel } from "@/components/holdings-panel";
import { issueTargetOptions } from "@/lib/stock-recipients";
import { holdingsOverview } from "@/lib/holdings";
import { PrixodForm, type PrixodInitial } from "../prixod-form";

const VAT_STR = { 12: "12", 6: "6", 0: "0" } as const;

/**
 * «Tuzatish» / nusxa (`?copy=<kirim id>`): eski kirimning rekvizitlari va qatorlari formaga. Yopilgan xomashyo qatorlari
 * tushirilmaydi (`skipped` — ogohlantirish), yopilgan oluvchi / brigada / snabjenets — bo'sh qoladi (saqlashda xato bermasin).
 */
async function loadCopy(id: string, materialIds: Set<string>, targets: TargetGroups) {
  const r = await db.goodsReceipt.findUnique({
    where: { id },
    select: {
      id: true, docNo: true, date: true, cancelledAt: true, supplierId: true, supplier: { select: { name: true } }, warehouseId: true, payment: true,
      waybillNo: true, address: true, purpose: true, carrier: true, loadedFrom: true, note: true, buyerId: true, recipientId: true,
      autoIssueToId: true, autoIssueBrigadeId: true, autoIssueEmployeeId: true,
      items: { orderBy: { id: "asc" }, select: { materialId: true, qty: true, price: true, vatRate: true, deliveryCost: true, material: { select: { name: true, category: true } } } },
    },
  });
  if (!r) return null;
  const [pay, buyer, recipient, employee] = await Promise.all([
    resolveReceiptPayments([{ id: r.id, payment: r.payment }]),
    r.buyerId ? db.user.findFirst({ where: { id: r.buyerId, isActive: true }, select: { id: true } }) : null,
    r.recipientId ? db.stockRecipient.findFirst({ where: { id: r.recipientId, isActive: true }, select: { id: true } }) : null,
    r.autoIssueEmployeeId ? db.employee.findFirst({ where: { id: r.autoIssueEmployeeId, isActive: true }, select: { id: true, fullName: true, position: true } }) : null,
  ]);
  const autoKey = r.autoIssueBrigadeId ? (targets.brigades.some((b) => b.id === r.autoIssueBrigadeId) ? `b:${r.autoIssueBrigadeId}` : "")
    : employee ? `e:${employee.id}`
    : r.autoIssueToId && targets.recipients.some((x) => x.id === r.autoIssueToId) ? `r:${r.autoIssueToId}` : "";
  const waybillNo = r.waybillNo ?? waybillFromNote(r.note) ?? "";
  const kept = r.items.filter((i) => materialIds.has(i.materialId));
  const initial: PrixodInitial = {
    date: isoDate(r.date), supplier: { id: r.supplierId, text: r.supplier.name }, warehouseId: r.warehouseId,
    payment: pay.get(r.id) ?? "BANK", waybillNo, autoKey,
    address: r.address ?? "", loadedFrom: r.loadedFrom ?? "", carrier: r.carrier ?? "", purpose: r.purpose ?? "",
    // «Nakladnoy № …» prefiksi izohdan olinadi — saqlashda TTN dan qayta qo'shiladi (`receiptNote`)
    note: syncWaybillInNote(r.note, waybillNo || null, null) ?? "", recipientId: recipient?.id ?? "",
    rows: kept.map((i) => ({
      materialId: i.materialId, qty: String(Number(i.qty)), price: String(Number(i.price)),
      delivery: Number(i.deliveryCost) ? String(Number(i.deliveryCost)) : "",
      vat: VAT_STR[i.vatRate as keyof typeof VAT_STR] ?? "12", category: i.material.category ?? "XOMASHYO",
    })),
  };
  return {
    docNo: r.docNo, date: r.date, cancelled: !!r.cancelledAt, initial, buyerId: buyer?.id ?? null,
    skipped: r.items.filter((i) => !materialIds.has(i.materialId)).map((i) => i.material.name),
    employee: employee ? { id: employee.id, name: employee.fullName, position: employee.position } : null,
  };
}

/**
 * Sklad → «Kirim» → yangi kirim (Excel jurnali ustunlari bilan). `?scan=1` — nakladnoy skaneri darhol ochiladi.
 * `?copy=<id>` — eski kirim bilan to'ldirilgan forma («Tuzatish»: kirim sahifasida bekor qilingach shu yerga keladi).
 */
export default async function NewPrixodPage({ searchParams }: { searchParams: Promise<{ scan?: string; copy?: string }> }) {
  const s = await requireRoles(["PROCUREMENT", "WAREHOUSE"], { module: "stock", actions: ["receipt"] });
  // Rol mos, lekin direktor bu amalni olib qo'ygan bo'lsa — forma ochilmaydi (saqlashda baribir rad bo'lardi)
  if (!canDo(s, "stock", "receipt")) redirect("/stock/prixod");
  const sp = await searchParams;
  const [suppliers, warehouses, materials, groups, accounts, balances, targets, holdings, vatPayer] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, vatPayer: true } }),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, groupId: true, category: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    s.role === "DIRECTOR" ? db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }) : Promise.resolve([]),
    // Qoldiq — spravochnikda ko'rinadi
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    issueTargetOptions(),
    holdingsOverview(),
    companyVatPayer(),
  ]);
  // Tanlanganda qatorga tushadigan narx: «Dona narxi» (Snabjeniye belgilagan), bo'lmasa o'rtacha tannarx
  const prices = await issuePrices(materials.map((m) => m.id));
  const bal = new Map(balances.map((b) => [b.materialId, Number(b._sum.qty ?? 0)]));
  // Nusxada xarid narxlari bor — faqat Kirim jurnalini ko'radiganlarga
  const copyId = sp.copy && /^[A-Za-z0-9_-]{1,64}$/.test(sp.copy) && canSeePrixod(s) ? sp.copy : null;
  const copy = copyId ? await loadCopy(copyId, new Set(materials.map((m) => m.id)), targets) : null;
  // «Kimga» ro'yxatida xodimlar ko'rsatilmaydi — faqat brigadalar va oluvchilar (nusxadagi xodim bundan mustasno)
  const formTargets = { ...targets, employees: copy?.employee ? [copy.employee] : [] };
  return (
    <div>
      <PageHeader back={{ href: "/stock/prixod", label: "Kirim" }} title={copy?.cancelled ? `Tuzatish: ${copy.docNo} o'rniga yangi kirim` : "Yangi kirim"} info="Saqlangandan keyin skladdagi qoldiq darhol oshadi" />
      {copy && (
        <div className="mb-4">
          <Callout tone={copy.cancelled ? "warning" : "info"} title={copy.cancelled ? `${copy.docNo} bekor qilingan` : `${copy.docNo} dan nusxa`}>
            {copy.cancelled
              ? `Forma ${copy.docNo} (${dateRu(copy.date)}) qatorlari va rekvizitlari bilan to'ldirildi. Xatoni to'g'rilab, «Kirimni saqlash» ni bosing — yangi kirim yoziladi. Saqlamasangiz, bu kirim umuman qolmaydi.`
              : `Forma ${copy.docNo} (${dateRu(copy.date)}) qatorlari bilan to'ldirildi. Saqlansa — yangi, alohida kirim yoziladi; ${copy.docNo} o'zgarmaydi.`}
            {copy.skipped.length > 0 && <div className="mt-1 font-medium">{`Yopilgan xomashyo qatorlari tushirilmadi: ${copy.skipped.join(", ")}`}</div>}
          </Callout>
        </div>
      )}
      <PrixodForm
        today={isoDate()}
        suppliers={suppliers}
        warehouses={warehouses}
        materials={materials.map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId, category: m.category, price: prices.get(m.id) ?? 0, balance: bal.get(m.id) ?? 0 }))}
        groups={groups}
        canCreate={canEditMaterials(s.role)}
        canAddSupplier={canDo(s, "stock", "suppliers")}
        targets={formTargets}
        holdings={holdings}
        // «Ta'minotchi» (xaridni qilgan snabjenets) — formada alohida maydon yo'q: Snabjeniye kiritsa o'zi yoziladi
        defaultBuyerId={copy?.buyerId ?? (s.role === "PROCUREMENT" ? s.userId : "")}
        accounts={accounts}
        clientToken={crypto.randomUUID()}
        companyVatPayer={vatPayer}
        scan={{ enabled: visionEnabled(), autoOpen: !copy && sp.scan === "1" }}
        initial={copy?.initial}
      />
      <div className="mt-6"><HoldingsPanel holdings={holdings} collapsible /></div>
    </div>
  );
}
