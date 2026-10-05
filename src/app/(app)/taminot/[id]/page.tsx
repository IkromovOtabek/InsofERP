import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BadgeCheck, ClipboardList, Clock, FileText, HardHat, Layers, PackageCheck, ReceiptText, Scale, ShoppingCart, Truck, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { supplyRequest, SUPPLY_LABEL, SUPPLY_COLOR, SUPPLY_OWNER, SUPPLY_STEPS, plannedSum, hasFact, totalPlanned, totalFact, canRejectSupply } from "@/lib/supply";
import { money, qty as q, date, dateTime } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { ROLE_LABELS } from "@/lib/nav";
import { Badge, Callout, Card, CardHeader, DL, LinkButton, PageHeader, StatusSteps, Table, Td, Th, Tr } from "@/components/ui";
import { EditItemsPanel, PricePanel, ReceivePanel, RejectPanel, type PanelItem } from "../panels";
import { DeliveryPanel, DirectorPanel, DocsPanel, IncidentsPanel, MetaPanel, QuotesPanel } from "../procurement-panels";
import { canRemoveSupplyDoc, directorLimit, needsDirector, responsibleOptions, SUPPLY_DOC_ACCEPT } from "@/lib/procurement";
import { DELIVERY_COLOR, DELIVERY_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, REQUIRED_DOCS } from "@/lib/procurement-const";
import { isoDate } from "@/lib/format";

/**
 * Bitta ta'minot zayavkasi — zanjirdagi barcha bo'lim shu sahifani ochadi,
 * lekin har kim faqat o'z bosqichidagi tugmani ko'radi. Kim nima qilgani pastdagi tarixda.
 */
export default async function SupplyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireRoles(["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SALES", "FINANCE", "ACCOUNTING", "CASHIER"]);
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
  // Snabjeniye TZ: mas'ul tanlovi, katta xarid chegarasi, har qator bo'yicha ombor qoldig'i
  const matIds = r.items.map((i) => i.materialId).filter((x): x is string => !!x);
  const [people, limit, balances] = await Promise.all([
    responsibleOptions(),
    directorLimit(),
    matIds.length ? db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { in: matIds } }, _sum: { qty: true } }) : Promise.resolve([]),
  ]);
  const balance = new Map(balances.map((b) => [b.materialId, Number(b._sum.qty ?? 0)]));
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
  const bigPurchase = needsDirector(plan, limit);
  const waitDirector = r.status === "PRICED" && bigPurchase && !r.directorOkAt;
  const open = !["RECEIVED", "REJECTED"].includes(r.status);
  const openIncidents = r.incidents.filter((x) => !x.resolvedAt).length;
  const missingDocs = r.status === "FUNDED" || r.status === "RECEIVED" ? REQUIRED_DOCS.filter((k) => !r.documents.some((d) => d.kind === k)) : [];

  const role = s.role;
  // Bosqichlar mas'ul bo'limlarda (narx — snabjeniye, tasdiq — sotuv, pul — moliya); direktor hammasini qila oladi
  const canProcure = ["PROCUREMENT", "WAREHOUSE", "DIRECTOR"].includes(role);
  const canEditItems = ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "DIRECTOR"].includes(role);
  // Tasdiqlash tugmalari bu sahifada yo'q: Sotuv bo'limi — Zayavkalar oynasida, moliya — Kirim-Chiqimda tasdiqlaydi
  const canApprove = ["SALES", "DIRECTOR"].includes(role);
  const canFund = ["FINANCE", "ACCOUNTING", "CASHIER", "DIRECTOR"].includes(role);
  // Tahrirlanadigan jadval ko'rsatilsa — tepadagi faqat ko'rish uchun jadval takrorlanmaydi
  // Bekor qilish: NEW/PRICED — yaratuvchi/snabjeniye; pul bosqichida — faqat moliya/direktor (`canRejectSupply`)
  const canReject = canRejectSupply(r, { id: s.userId, role });
  const refund = r.cashTxId ? (await db.cashTransaction.findUnique({ where: { id: r.cashTxId }, select: { amount: true } }))?.amount : null;
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
          {refund != null && Number(refund) > 0 && (
            <div className="mt-1 font-semibold">Ajratilgan {money(Number(refund))} chiqim Kirim-Chiqimda qoldi — yetkazuvchidan qaytarilishi kerak.</div>
          )}
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
                  <Th>Nomi</Th><Th>Birlik</Th><Th right>Kerak</Th><Th right>Narx (QQS bilan)</Th><Th right>Summa</Th>
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

          {/* ── Snabjeniye TZ: yetkazish, takliflar, rekvizitlar, muammolar, hujjatlar ── */}
          {r.status === "FUNDED" && (
            <Card>
              <CardHeader icon={Truck} title="Yetkazib berish monitoringi"
                description={r.deliveryStatus ? `Hozir: ${DELIVERY_LABEL[r.deliveryStatus]}${r.shippedAt ? ` · jo'natilgan ${date(r.shippedAt)}` : ""}${r.eta ? ` · ETA ${date(r.eta)}` : ""}${r.arrivedAt ? ` · keldi ${dateTime(r.arrivedAt)}` : ""}` : "Buyurtma berilgach holatni yangilab boring"} />
              {canProcure
                ? <DeliveryPanel id={r.id} value={{ status: r.deliveryStatus, shippedAt: r.shippedAt ? isoDate(r.shippedAt) : "", eta: r.eta ? isoDate(r.eta) : "", provider: r.deliveryProvider ?? "" }} />
                : <p className="text-sm text-slate-500">{r.deliveryProvider ?? "Transport ko'rsatilmagan"}</p>}
            </Card>
          )}
          {(r.quotes.length > 0 || ((r.status === "NEW" || r.status === "PRICED") && canProcure)) && (
            <Card>
              <CardHeader icon={Scale} title="Tijorat takliflari" description="Narx, muddat va to'lov sharti bo'yicha taqqoslang — tanlangani yetkazuvchi bo'ladi" />
              <QuotesPanel id={r.id} suppliers={suppliers} editable={canProcure && (r.status === "NEW" || r.status === "PRICED")}
                quotes={r.quotes.map((x) => ({ id: x.id, supplierName: x.supplierName, supplierId: x.supplierId, amount: Number(x.amount), deliveryDays: x.deliveryDays, paymentTerms: x.paymentTerms, validUntil: x.validUntil ? date(x.validUntil) : null, note: x.note, chosen: x.chosen, by: `${x.createdBy.fullName} · ${dateTime(x.createdAt)}` }))} />
            </Card>
          )}
          {open && canProcure && (
            <Card>
              <CardHeader icon={ClipboardList} title="Talabnoma rekvizitlari" description="Bo'lim, ustuvorlik, mas'ul xodim va muddat — dashboard shular bo'yicha saralaydi" />
              <MetaPanel id={r.id} people={people.map((p) => ({ id: p.id, name: `${p.fullName} · ${ROLE_LABELS[p.role]}` }))}
                value={{ department: r.department ?? "", priority: r.priority, responsibleId: r.responsibleId ?? "", needBy: r.needBy ? isoDate(r.needBy) : "", contractNo: r.contractNo ?? "" }} />
            </Card>
          )}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader icon={AlertTriangle} title="Muammolar" description={openIncidents ? `${openIncidents} ta ochiq` : "Kam miqdor, sifat, kechikish, hujjat"} />
              <IncidentsPanel id={r.id} canAdd={r.status !== "REJECTED" && (canProcure || role === "PRODUCTION")} canResolve={canProcure}
                incidents={r.incidents.map((x) => ({ id: x.id, kind: x.kind, note: x.note, by: x.createdBy.fullName, at: dateTime(x.createdAt), resolvedAt: x.resolvedAt ? dateTime(x.resolvedAt) : null, resolution: x.resolution }))} />
            </Card>
            <Card>
              <CardHeader icon={FileText} title="Hujjatlar" description="Shartnoma, hisob-faktura, nakladnoy, sertifikat" />
              <DocsPanel id={r.id} accept={SUPPLY_DOC_ACCEPT} missing={[...missingDocs]} canEdit={canProcure || ["ACCOUNTING", "FINANCE"].includes(role)}
                canDelete={(canProcure || ["ACCOUNTING", "FINANCE"].includes(role)) && canRemoveSupplyDoc(r.status, role)}
                docs={r.documents.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, by: d.createdBy.fullName, at: dateTime(d.createdAt) }))} />
            </Card>
          </div>
        </div>

        <div className="space-y-5">
          {r.status === "PRICED" && (
            <Card>
              <div className="flex items-start gap-3 text-sm text-slate-600">
                <Clock size={18} className="mt-0.5 shrink-0 text-amber-600" />
                <span>
                  {waitDirector
                    ? <>Katta xarid — <b>{money(plan)}</b> (chegara {money(limit)}). Avval <b>direktor</b> tasdiqlaydi, keyin ma&apos;sul xodim.</>
                    : <>Ma&apos;sul xodim tasdig&apos;i kutilmoqda — <b>{money(plan)}</b>.{r.directorOkAt && " Direktor tasdiqlagan."}</>}
                  {!waitDirector && (canApprove ? <> Tasdiqlash <Link href="/orders" className="font-medium underline">Zayavkalar</Link> oynasida.</> : " Tasdiq Zayavkalar oynasida beriladi.")}
                  {r.recheck > 0 && <span className="mt-1 block font-medium text-red-600">Narx o&apos;zgargani uchun qayta tasdiqqa qaytdi ({r.recheck}-marta).</span>}
                </span>
              </div>
            </Card>
          )}
          {waitDirector && role === "DIRECTOR" && (
            <Card>
              <CardHeader icon={BadgeCheck} title="Direktor tasdig'i" description={`Jami ${money(plan)} — chegaradan (${money(limit)}) katta xarid`} />
              <DirectorPanel id={r.id} />
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

          {canReject && (
            <Card>
              <CardHeader icon={XCircle} title="Bekor qilish"
                description={r.cashTxId || r.status === "APPROVED" || r.status === "FUNDED" ? "Moliya bosqichi — chiqim o'chirilmaydi, qaytarilishi kerak bo'lib qoladi" : "Sabab bilan — so'rovni kiritgan xodimga xabar ketadi"} />
              <RejectPanel id={r.id} refund={refund == null ? null : Number(refund)} />
            </Card>
          )}

          <Card>
            <CardHeader title="Hujjat" />
            <DL items={[
              { k: "Sklad", v: r.warehouse.name },
              { k: "Bo'lim", v: r.department ?? "—" },
              { k: "Ustuvorlik", v: <Badge color={PRIORITY_COLOR[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge> },
              { k: "Mas'ul", v: r.responsible?.fullName ?? "—" },
              { k: "So'ragan", v: r.createdBy.fullName },
              { k: "Shartnoma", v: r.contractNo ?? "—" },
              ...(bigPurchase ? [{ k: "Direktor tasdig'i", v: r.directorOkAt ? `Tasdiqlangan · ${dateTime(r.directorOkAt)}` : r.status === "PRICED" ? "Kutilmoqda" : "—" }] : []),
              ...(r.deliveryStatus ? [{ k: "Yetkazish", v: <Badge color={DELIVERY_COLOR[r.deliveryStatus]}>{DELIVERY_LABEL[r.deliveryStatus]}</Badge> }] : []),
              ...(r.eta ? [{ k: "Kutilayotgan sana (ETA)", v: <span className={open && r.eta < new Date(new Date().setHours(0, 0, 0, 0)) ? "font-semibold text-red-600" : ""}>{date(r.eta)}</span> }] : []),
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

          {open && matIds.length > 0 && (
            <Card>
              <CardHeader icon={Layers} title="Ombor qoldig'i" description="Omborda bor bo'lsa — xaridni kamaytiring" />
              <ul className="space-y-2 text-sm">
                {r.items.filter((i) => i.materialId).map((i) => {
                  const b = balance.get(i.materialId!) ?? 0;
                  const covers = b >= Number(i.qty);
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-slate-700">{i.name}</span>
                      <span className={`shrink-0 tabular ${covers ? "font-semibold text-emerald-700" : "text-slate-500"}`}>{q(b)} / {q(i.qty)} {unitLabel(i.unit)}</span>
                    </li>
                  );
                })}
              </ul>
              {r.items.some((i) => i.materialId && (balance.get(i.materialId) ?? 0) >= Number(i.qty)) && (
                <p className="mt-2 text-xs text-emerald-700">Yashil qatorlar omborda yetarli — xarid shart emasligini tekshiring.</p>
              )}
            </Card>
          )}

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
