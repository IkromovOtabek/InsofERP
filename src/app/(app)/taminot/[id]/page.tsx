import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, HardHat, PackageCheck, ReceiptText, ShoppingCart, Truck, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { supplyRequest, SUPPLY_LABEL, SUPPLY_COLOR, SUPPLY_OWNER, SUPPLY_STEPS, plannedSum, hasFact, totalPlanned, totalFact } from "@/lib/supply";
import { money, qty as q, date, dateTime } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { ROLE_LABELS } from "@/lib/nav";
import { Badge, Callout, Card, CardHeader, DL, LinkButton, PageHeader, StatusSteps, Table, Td, Th, Tr } from "@/components/ui";
import { EditItemsPanel, PricePanel, ReceivePanel, type PanelItem } from "../panels";

/**
 * Bitta ta'minot zayavkasi — zanjirdagi barcha bo'lim shu sahifani ochadi,
 * lekin har kim faqat o'z bosqichidagi tugmani ko'radi. Kim nima qilgani pastdagi tarixda.
 */
export default async function SupplyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SALES", "FINANCE", "ACCOUNTING", "CASHIER"]);
  const r = await supplyRequest(id);
  if (!r) notFound();
  // "O'zimiz" bo'lsa — o'z haydovchimiz va mashinasi tanlanadi (haydovchi lavozimlari otdel kadrdan)
  const driverPositions = (await db.workPosition.findMany({ where: { isDriver: true }, select: { name: true } })).map((p) => p.name);
  const [suppliers, drivers] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employee.findMany({
      where: {
        isActive: true,
        OR: [
          { vehicleId: { not: null } },
          { position: { contains: "haydovchi", mode: "insensitive" } },
          ...driverPositions.map((name) => ({ position: { equals: name, mode: "insensitive" as const } })),
        ],
      },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, vehicle: { select: { plate: true } } },
    }),
  ]);
  const driverOpts = drivers.map((d) => ({ id: d.id, label: d.vehicle ? `${d.fullName} · ${d.vehicle.plate}` : d.fullName }));

  const items: PanelItem[] = r.items.map((i) => ({
    id: i.id, name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price),
    factQty: i.factQty == null ? null : Number(i.factQty),
    factPrice: i.factPrice == null ? null : Number(i.factPrice),
    note: i.note, inCatalog: !!i.materialId,
  }));
  const goods = plannedSum(r.items);
  const plan = totalPlanned(r);
  const fact = totalFact(r);
  const delivery = Number(r.deliveryCost);
  const deliveryFact = Number(r.deliveryFactCost ?? r.deliveryCost);
  const showFact = hasFact(r.items) || r.status === "RECEIVED";

  const role = s.role;
  const isDir = role === "DIRECTOR";
  const canProcure = isDir || ["PROCUREMENT", "WAREHOUSE"].includes(role);
  const canEditItems = isDir || ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"].includes(role);
  // Tasdiqlash tugmalari bu sahifada yo'q: Sotuv bo'limi — Zayavkalar oynasida, moliya — Kirim-Chiqimda tasdiqlaydi
  const canApprove = isDir || role === "SALES";
  const canFund = isDir || ["FINANCE", "ACCOUNTING", "CASHIER"].includes(role);
  // Tahrirlanadigan jadval ko'rsatilsa — tepadagi faqat ko'rish uchun jadval takrorlanmaydi
  const editing =
    (r.status === "NEW" && (canProcure || canEditItems)) ||
    (r.status === "PRICED" && canProcure) ||
    (r.status === "FUNDED" && canProcure);

  return (
    <div>
      <PageHeader
        back={{ href: "/taminot", label: "Ta'minot zayavkalari" }}
        title={<>Ta&apos;minot {r.docNo} <Badge color={SUPPLY_COLOR[r.status]}>{SUPPLY_LABEL[r.status]}</Badge></>}
        subtitle={`${r.warehouse.name} · ${date(r.date)} · ${r.createdBy.fullName} so'radi${r.needBy ? ` · ${date(r.needBy)} gacha kerak` : ""}${r.recheck > 0 ? ` · narx o'zgargani uchun ${r.recheck} marta qayta tasdiqqa qaytgan` : ""}`}
        action={r.receipt ? <LinkButton href={`/receipts/${r.receipt.id}`} variant="secondary"><ReceiptText size={16} /> Kirim {r.receipt.docNo}</LinkButton> : undefined}
      />

      <Card className="mb-5">
        <StatusSteps steps={SUPPLY_STEPS} current={r.status === "REJECTED" ? SUPPLY_STEPS[0].key : r.status} failed={r.status === "REJECTED"} />
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500">
          {r.status === "APPROVED" && <Clock size={15} className="text-amber-600" />}
          {SUPPLY_OWNER[r.status]}
        </p>
      </Card>

      {r.status === "REJECTED" && (
        <Callout tone="danger" title="Zayavka bekor qilingan">
          {r.events.filter((e) => e.stage === "REJECTED").map((e) => <div key={e.id}>{e.note} · {e.user.fullName} · {dateTime(e.createdAt)}</div>)}
        </Callout>
      )}
      {r.status === "RECEIVED" && (
        <Callout tone="success" title="Mahsulotlar skladga kirim qilindi">
          Fakt summa {money(fact)} (reja {money(plan)}). Yangi mahsulotlarni <Link href="/stock?tab=brigades" className="underline">Sklad → Brigadalar</Link> bo&apos;limidan brigadalarga taqsimlaysiz.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {!editing && (
            <Table>
              <thead>
                <tr>
                  <Th>Nomi</Th><Th>Birlik</Th><Th right>Kerak</Th><Th right>Narx</Th><Th right>Summa</Th>
                  {showFact && <><Th right>Kelgan</Th><Th right>Kelgan narx</Th><Th right>Fakt summa</Th></>}
                </tr>
              </thead>
              <tbody>
                {r.items.map((i) => {
                  const fq = i.factQty == null ? null : Number(i.factQty);
                  const fp = i.factPrice == null ? null : Number(i.factPrice);
                  return (
                    <Tr key={i.id}>
                      <Td className="font-medium">{i.name}{i.note && <div className="text-xs text-slate-500">{i.note}</div>}</Td>
                      <Td className="text-slate-500">{unitLabel(i.unit)}</Td>
                      <Td right>{q(i.qty)}</Td>
                      <Td right>{Number(i.price) > 0 ? money(i.price) : <span className="text-slate-400">narx yo&apos;q</span>}</Td>
                      <Td right className="font-medium">{money(Number(i.qty) * Number(i.price))}</Td>
                      {showFact && (
                        <>
                          <Td right className={fq != null && fq < Number(i.qty) - 0.0005 ? "font-medium text-red-600" : ""}>{fq == null ? "—" : q(fq)}</Td>
                          <Td right>{fp == null ? "—" : money(fp)}</Td>
                          <Td right className="font-medium">{fq == null || fp == null ? "—" : money(fq * fp)}</Td>
                        </>
                      )}
                    </Tr>
                  );
                })}
                {delivery > 0 && (
                  <Tr>
                    <Td colSpan={4} className="text-slate-700"><span className="inline-flex items-center gap-1.5"><Truck size={13} className="text-slate-400" /> Dostavka xizmati{r.deliveryKind ? ` · ${r.deliveryKind}` : ""}{r.deliveryProvider ? ` · ${r.deliveryProvider}` : ""}</span></Td>
                    <Td right className="font-medium">{money(delivery)}</Td>
                    {showFact && <><Td /><Td /><Td right className="font-medium">{money(deliveryFact)}</Td></>}
                  </Tr>
                )}
                <tr className="bg-slate-50/80">
                  <Td colSpan={4} className="font-semibold">Jami summa{delivery > 0 ? ` (mahsulot ${money(goods)} + dostavka)` : ""}</Td>
                  <Td right className="text-lg font-semibold">{money(plan)}</Td>
                  {showFact && <><Td /><Td /><Td right className="text-lg font-semibold">{money(fact)}</Td></>}
                </tr>
              </tbody>
            </Table>
          )}

          {r.status === "NEW" && canProcure && (
            <Card padded={false}>
              <div className="p-5"><CardHeader icon={ShoppingCart} title="Snabjeniye: narx qo'yish" description="Har qatorga narx qo'ying — jami summa o'zi hisoblanadi va zayavka tasdiqlashga ketadi." /></div>
              <div className="px-5 pb-5"><PricePanel id={r.id} items={items} suppliers={suppliers} supplierId={r.supplierId} drivers={driverOpts}
                delivery={{ kind: r.deliveryKind ?? "", provider: r.deliveryProvider ?? "", cost: delivery, note: r.deliveryNote ?? "" }} /></div>
            </Card>
          )}
          {r.status === "PRICED" && canProcure && (
            <Card padded={false}>
              <div className="p-5"><CardHeader icon={ShoppingCart} title="Narxni tuzatish" description="Zayavka tasdiq kutmoqda — tasdiqlangunicha narxni o'zgartirsangiz bo'ladi." /></div>
              <div className="px-5 pb-5"><PricePanel id={r.id} items={items} suppliers={suppliers} supplierId={r.supplierId} drivers={driverOpts}
                delivery={{ kind: r.deliveryKind ?? "", provider: r.deliveryProvider ?? "", cost: delivery, note: r.deliveryNote ?? "" }} /></div>
            </Card>
          )}
          {r.status === "NEW" && canEditItems && !canProcure && (
            <Card padded={false}>
              <div className="p-5"><CardHeader title="Jadvalni tuzatish" description="Narx qo'yilgunicha miqdorni o'zgartirsangiz bo'ladi." /></div>
              <div className="px-5 pb-5"><EditItemsPanel id={r.id} items={items} /></div>
            </Card>
          )}
          {r.status === "FUNDED" && canProcure && (
            <Card padded={false}>
              <div className="p-5"><CardHeader icon={PackageCheck} title="Tasdiqdan o'tdi — kelgan molni tekshiring" description="Nima kam keldi, necha pulga keldi. To'g'ri bo'lsa «Qabul qildim» — sklad qoldig'i oshadi." /></div>
              <div className="px-5 pb-5"><ReceivePanel id={r.id} items={items} suppliers={suppliers} supplierId={r.supplierId} delivery={{ kind: r.deliveryKind ?? "", cost: delivery, fact: deliveryFact }} /></div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {r.status === "PRICED" && (
            <Card>
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Clock size={18} className="mt-0.5 shrink-0 text-amber-600" />
                <span>
                  Ma&apos;sul xodim tasdig&apos;i kutilmoqda — <b>{money(plan)}</b>.
                  {canApprove ? <> Tasdiqlash <Link href="/orders" className="font-medium underline">Zayavkalar</Link> oynasida.</> : " Tasdiq Zayavkalar oynasida beriladi."}
                  {r.recheck > 0 && <span className="mt-1 block font-medium text-red-600">Narx o&apos;zgargani uchun qayta tasdiqqa qaytdi ({r.recheck}-marta).</span>}
                </span>
              </div>
            </Card>
          )}
          {r.status === "APPROVED" && (
            <Card>
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Clock size={18} className="mt-0.5 shrink-0 text-amber-600" />
                <span>
                  Moliya bo&apos;limi tasdig&apos;i kutilmoqda — <b>{money(plan)}</b>.
                  {canFund ? <> Pul ajratish <Link href="/cashflow" className="font-medium underline">Kirim-Chiqim</Link> bo&apos;limida.</> : " Tasdiqlangach snabjeniye sotib oladi."}
                </span>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Hujjat" />
            <DL items={[
              { k: "Sklad", v: r.warehouse.name },
              { k: "So'ragan", v: r.createdBy.fullName },
              { k: "Kerak bo'lgan sana", v: r.needBy ? date(r.needBy) : "—" },
              { k: "Yetkazuvchi", v: r.supplier?.name ?? "—" },
              { k: "Dostavka", v: delivery > 0 || r.deliveryKind ? `${r.deliveryKind ?? "Xizmat"} · ${money(delivery)}${r.deliveryProvider ? ` · ${r.deliveryProvider}` : ""}` : "—" },
              { k: "To'lov hisobi", v: r.cashAccount?.name ?? "—" },
              { k: "Reja summa", v: money(plan) },
              { k: "Fakt summa", v: showFact ? money(fact) : "—" },
              { k: "Kirim hujjati", v: r.receipt ? <Link href={`/receipts/${r.receipt.id}`} className="hover:underline">{r.receipt.docNo}</Link> : "—" },
              { k: "Izoh", v: r.note ?? "—" },
            ]} />
          </Card>

          <Card>
            <CardHeader title="Harakatlar tarixi" description="Kim, qachon, nima qildi" />
            <ol className="space-y-3">
              {r.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.stage === "REJECTED" ? "bg-red-500" : "bg-emerald-500"}`} />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{e.stage === "REJECTED" ? "Bekor qilindi" : SUPPLY_LABEL[e.stage]}</div>
                    <div className="text-slate-500">{e.user.fullName} · {ROLE_LABELS[e.user.role]} · {dateTime(e.createdAt)}</div>
                    {e.note && <div className="mt-0.5 text-slate-600">{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {r.status === "RECEIVED" && (
            <Card>
              <CardHeader icon={HardHat} title="Keyingi qadam" description="Kelgan xomashyoni brigadalarga taqsimlang" />
              <LinkButton href="/stock?tab=brigades" variant="secondary">Brigadalarga taqsimlash</LinkButton>
            </Card>
          )}
          {r.status === "REJECTED" && (
            <Card><div className="flex items-center gap-2 text-sm text-red-700"><XCircle size={16} /> Zayavka yopilgan — yangisini Sklad bo&apos;limidan oching.</div></Card>
          )}
        </div>
      </div>
    </div>
  );
}
