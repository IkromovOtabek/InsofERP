import Link from "next/link";
import { Ban, Landmark, Package, Search, Trash2, Truck, Users } from "lucide-react";
import { db } from "@/lib/db";
import { moduleWriteAllowed, type Session } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { money, qty as fq, date, isoDate } from "@/lib/format";
import { OPENING_WRITERS, supplierOpeningDues, supplierOpeningPayments } from "@/lib/opening-balances";
import { Badge, Callout, Card, CardHeader, Checkbox, Empty, Field, Input, Select, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { ConfirmButton } from "../../payments/confirm-button";
import { OpeningCreateForm, OpeningEditForm, OpeningReduceForm, SupplierPayForm } from "./forms";
import { cancelOpeningAction, importOpeningsAction, reverseSupplierOpeningPaymentAction } from "./actions";
import type { ImportField } from "@/lib/excel";
import type { OpeningKind, Prisma } from "@/generated/prisma";

/**
 * Bitta qoldiq turining to'liq bo'limi: izoh, kartalar, qo'lda kiritish, Excel import va kiritilganlar ro'yxati
 * (tahrir, kamaytirish, o'chirish, yetkazuvchiga to'lash). Sozlamalar → Boshlang'ich qoldiqlar va
 * Tahlil → Mijoz / Ta'minotchi debitorka sahifalaridagi «Qarzlarni kiritish» — ikkalasi shu bitta komponent.
 */
export const OPENING_ICON = { CUSTOMER: Users, SUPPLIER: Truck, CASH: Landmark, STOCK: Package } as const;

const HELP: Record<OpeningKind, string> = {
  CUSTOMER: "Mijozning shu sanadagi qarzi BQ-raqamli «boshlang'ich schyot» bo'lib yoziladi: qarz, kredit limiti, qora ro'yxat, akt sverka, debitorka va BI shu bilan hisoblaydi. Kassir to'lovni shu schyotga yozadi. Avans (−) — qarzdan ayiriladi. Sotuv (tushum) hisobotlariga kirmaydi.",
  SUPPLIER: "Yetkazuvchiga shu sanadagi qarzimiz — yetkazuvchi kartasida qarzga qo'shiladi. To'lov shu yerdan yoki yetkazuvchi kartasidan Kirim-Chiqimga chiqim bo'lib yoziladi. Avans (−) — yetkazuvchi kartasida avans sifatida ko'rinadi.",
  CASH: "Kassa / bank hisobidagi qoldiq hisob qoldig'iga qo'shiladi (Kassa / bank, dashbordlar, «kassa minusga tushmasin» tekshiruvi), lekin kirim-chiqim, pul oqimi va foyda hisobotlariga kirmaydi.",
  STOCK: "Tayyor mahsulotning skladdagi qoldig'i tannarxi bilan sklad harakati (Boshlang'ich qoldiq) bo'lib yoziladi — Sklad, ishlab chiqarish imkoni va ombor qiymati shu bilan hisoblaydi.",
};

const IMPORT_FIELDS: Record<OpeningKind, ImportField[]> = {
  CUSTOMER: [
    { key: "name", label: "Mijoz", required: true, synonyms: ["mijoz", "контрагент", "клиент", "покупател", "nomi", "наимен", "name"] },
    { key: "inn", label: "INN", hint: "bo'lsa shu bo'yicha topiladi", synonyms: ["инн", "inn", "стир", "stir"] },
    { key: "date", label: "Sana", hint: "bo'lmasa — formadagi sana", synonyms: ["sana", "дата", "date", "kun"] },
    { key: "amount", label: "Qoldiq", required: true, hint: "shu kun oxiridagi qarz / avans", synonyms: ["qoldiq", "остаток", "сальдо", "qarz", "долг", "summa", "сумма", "debet", "дебет"] },
    { key: "kirim", label: "Kirim", hint: "izohga yoziladi", synonyms: ["kirim", "приход"] },
    { key: "chiqim", label: "Chiqim", hint: "izohga yoziladi", synonyms: ["chiqim", "расход"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "комментар", "note"] },
  ],
  SUPPLIER: [
    { key: "name", label: "Yetkazuvchi", required: true, synonyms: ["yetkazuvchi", "поставщик", "контрагент", "ta'minotchi", "taminotchi", "nomi", "наимен", "name"] },
    { key: "inn", label: "INN", hint: "bo'lsa shu bo'yicha topiladi", synonyms: ["инн", "inn", "стир", "stir"] },
    { key: "date", label: "Sana", hint: "bo'lmasa — formadagi sana", synonyms: ["sana", "дата", "date", "kun"] },
    { key: "amount", label: "Qoldiq", required: true, hint: "shu kun oxiridagi qarz / avans", synonyms: ["qoldiq", "остаток", "сальдо", "qarz", "долг", "summa", "сумма", "kredit", "кредит"] },
    { key: "kirim", label: "Kirim", hint: "izohga yoziladi", synonyms: ["kirim", "приход"] },
    { key: "chiqim", label: "Chiqim", hint: "izohga yoziladi", synonyms: ["chiqim", "расход"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "комментар", "note"] },
  ],
  CASH: [
    { key: "name", label: "Hisob (kassa/bank nomi)", required: true, hint: "Sozlamalardagi nom bilan bir xil", synonyms: ["hisob", "kassa", "касса", "счет", "счёт", "bank", "банк", "nomi", "name"] },
    { key: "amount", label: "Qoldiq", required: true, hint: "− bank overdrafti", synonyms: ["qoldiq", "остаток", "сальдо", "summa", "сумма"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "note"] },
  ],
  STOCK: [
    { key: "name", label: "Mahsulot nomi", required: true, synonyms: ["mahsulot", "товар", "продукц", "kod", "код", "marka", "марка", "nomi", "наимен", "name"] },
    { key: "warehouse", label: "Sklad", hint: "bo'sh — formadagi standart sklad", synonyms: ["sklad", "склад", "ombor", "warehouse"] },
    { key: "qty", label: "Miqdor", required: true, synonyms: ["miqdor", "кол", "к-во", "qoldiq", "остаток", "soni", "qty"] },
    { key: "unitCost", label: "Tannarx (birlik)", synonyms: ["tannarx", "себестоим", "narx", "цена", "cost"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "note"] },
  ],
};

const EXAMPLE: Record<OpeningKind, Record<string, string | number>> = {
  CUSTOMER: { name: "\"QURILISH INVEST\" MCHJ", inn: "305123456", date: "01.11.2026", amount: -45.5, kirim: "", chiqim: 6.888, note: "" },
  SUPPLIER: { name: "\"BODOMZOR SEMENT\" MCHJ", inn: "301987654", date: "01.11.2026", amount: 120, kirim: 20, chiqim: "", note: "" },
  CASH: { name: "Asosiy kassa", amount: 15000000, note: "" },
  STOCK: { name: "M300", warehouse: "Asosiy sklad", qty: 120, unitCost: 650000, note: "" },
};

/** Ro'yxatdagi qidiruv: kim / qaysi hisob / qaysi mahsulot nomi bo'yicha. */
function searchWhere(kind: OpeningKind, q: string): Prisma.OpeningBalanceWhereInput {
  const has = { contains: q, mode: "insensitive" as const };
  switch (kind) {
    case "CUSTOMER": return { customer: { OR: [{ name: has }, { inn: has }] } };
    case "SUPPLIER": return { supplier: { OR: [{ name: has }, { inn: has }] } };
    case "CASH": return { cashAccount: { name: has } };
    case "STOCK": return { product: { OR: [{ name: has }, { code: has }] } };
  }
}

export async function OpeningSection({ kind, s, base, keep = {}, showCancelled, q, help = true }: {
  kind: OpeningKind;
  s: Session;
  /** Sahifa yo'li — qidiruv va «bekor qilinganlar» havolalari shu yerga */
  base: string;
  /** URL'da saqlanadigan boshqa parametrlar (masalan `tab`) */
  keep?: Record<string, string>;
  showCancelled: boolean;
  q?: string;
  help?: boolean;
}) {
  const canEdit = moduleWriteAllowed(s, "opening", OPENING_WRITERS) === true; // Finance — faqat ko'radi va to'laydi
  const isDirector = s.role === "DIRECTOR"; // ta'minotchi to'lovini storno qilish — faqat direktor
  const canPay = canDo(s, "cashflow", "pay");
  const term = q?.trim() ?? "";

  const [rows, used, warehouses, accounts] = await Promise.all([
    db.openingBalance.findMany({
      where: { kind, ...(showCancelled ? {} : { cancelledAt: null }), ...(term ? searchWhere(kind, term) : {}) },
      orderBy: [{ cancelledAt: "asc" }, { date: "desc" }, { createdAt: "desc" }],
      take: 1000,
      include: {
        customer: { select: { id: true, name: true, inn: true } }, supplier: { select: { id: true, name: true, inn: true } },
        cashAccount: { select: { name: true, type: true } }, product: { select: { code: true, name: true, unit: true } }, warehouse: { select: { name: true } },
        invoice: { select: { invoiceNo: true, status: true, payments: { select: { amount: true } } } },
      },
    }),
    // Kartalar va tanlov ro'yxati qidiruvdan qat'i nazar — barcha faol qoldiqlar bo'yicha
    db.openingBalance.findMany({ where: { kind, cancelledAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], select: { amount: true, date: true, customerId: true, supplierId: true, cashAccountId: true } }),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
  ]);
  const usedIds = new Set(used.map((r) => r.customerId ?? r.supplierId ?? r.cashAccountId ?? ""));

  // Tanlov ro'yxati: kassada — qoldig'i hali kiritilmagan hisoblar; mijoz/yetkazuvchida — hammasi (har sanaga bitta yozuv,
  // takror sanani server rad etadi); STOCK — mahsulot+sklad juftligi, shuning uchun hammasi
  const entities = !canEdit ? []
    : kind === "CUSTOMER"
      ? (await db.customer.findMany({ where: { isInternal: false, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, inn: true } })).map((c) => ({ id: c.id, label: c.inn ? `${c.name} · ${c.inn}` : c.name }))
      : kind === "SUPPLIER"
        ? (await db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, inn: true } })).map((c) => ({ id: c.id, label: c.inn ? `${c.name} · ${c.inn}` : c.name }))
        : kind === "CASH"
          ? accounts.filter((a) => !usedIds.has(a.id)).map((a) => ({ id: a.id, label: `${a.name} (${a.type === "CASH" ? "naqd" : "bank"})` }))
          : (await db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } })).map((p) => ({ id: p.id, label: p.name }));

  const dues = kind === "SUPPLIER" ? new Map((await supplierOpeningDues()).map((d) => [d.id, d])) : new Map();
  // Yetkazuvchi qoldig'iga qilingan to'lovlar — xato yozilganini direktor storno qiladi
  const supPays = kind === "SUPPLIER" ? await supplierOpeningPayments(rows.map((r) => r.id)) : new Map();
  const total = used.reduce((x, r) => x + Number(r.amount), 0);
  // Qarz / avans — obyekt bo'yicha sof (mijozda bir necha sanaga yozuv bo'lishi mumkin: +qarz, −kamayish)
  const net = new Map<string, number>();
  for (const r of used) { const k = r.customerId ?? r.supplierId ?? r.cashAccountId ?? ""; net.set(k, (net.get(k) ?? 0) + Number(r.amount)); }
  const plus = [...net.values()].filter((v) => v > 0).reduce((x, v) => x + v, 0);
  const minus = [...net.values()].filter((v) => v < 0).reduce((x, v) => x + v, 0);
  const lastDate = used[0]?.date;
  const href = (o: { bekor?: boolean; q?: string }) => {
    const p = new URLSearchParams({ ...keep, ...(o.bekor ? { bekor: "1" } : {}), ...(o.q ? { q: o.q } : {}) }).toString();
    return p ? `${base}?${p}` : base;
  };
  const Icon = OPENING_ICON[kind];
  const debtKind = kind === "CUSTOMER" || kind === "SUPPLIER";

  return (
    <>
      {help && <Callout tone="info" title="Hisobotlarga qanday tushadi">{HELP[kind]}</Callout>}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Kiritilgan yozuvlar" value={String(used.length)} icon={Icon} hint={!lastDate ? "hali yo'q" : debtKind ? `${net.size} ta ${kind === "CUSTOMER" ? "mijoz" : "yetkazuvchi"} · oxirgi sana ${date(lastDate)}` : `oxirgisi ${date(lastDate)} holatiga`} href="#kiritilganlar" />
        <StatCard label={kind === "STOCK" ? "Ombor qiymati (tannarx)" : kind === "CASH" ? "Jami qoldiq" : kind === "CUSTOMER" ? "Mijozlar qarzi (+)" : "Qarzimiz (+)"} value={money(kind === "STOCK" || kind === "CASH" ? total : plus)} tone="info" href="#kiritilganlar" />
        {debtKind && <StatCard label={kind === "CUSTOMER" ? "Mijozlar avansi (−)" : "Bergan avansimiz (−)"} value={money(-minus)} tone={minus < 0 ? "warning" : "default"} href="#kiritilganlar" />}
      </div>

      {canEdit && <>
      <Card className="mt-6">
        <CardHeader title="Excel orqali yuklash" description={debtKind
          ? "Kunlik jadval (har sana ostida Kirim · Chiqim · Qoldiq) yoki ro'yxat (Nomi · Sana · Qoldiq). Har sanadagi «Qoldiq» — shu kun oxiridagi qarz: tizim qarzni o'sha kunda Exceldagiga tenglaydi, farqi yozuv bo'lib tushadi. Fayl qayta yuklansa sanalar qayta hisoblanadi — ikki marta yozilmaydi. Bitta qatorda xato bo'lsa ham hech narsa yozilmaydi."
          : "Namunani yuklab oling, to'ldiring va qaytarib yuklang. Bitta qatorda xato bo'lsa ham hech narsa yozilmaydi; qoldig'i bor obyektlar o'tkazib yuboriladi (ularni ro'yxatdan tahrirlang)."} />
        <ExcelImport
          action={importOpeningsAction.bind(null, kind)}
          submitLabel={debtKind ? "Qarzlarni yozish" : "Qoldiqlarni yozish"}
          templateName={`boshlangich-qoldiq-${kind.toLowerCase()}`}
          example={EXAMPLE[kind]}
          fields={IMPORT_FIELDS[kind]}
          dayGroups={debtKind}
        >
          {debtKind ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Summalar birligi" hint="Exceldagi raqam nimada">
                  <Select name="unit" defaultValue="1000000">
                    <option value="1000000">mln so&apos;m (131,06 → 131 060 000)</option>
                    <option value="1000">ming so&apos;m</option>
                    <option value="1">so&apos;m</option>
                  </Select>
                </Field>
                <Field label="Exceldagi minus (−)" hint="qaysi tomon kimga qarz">
                  <Select name="sign" defaultValue={kind === "CUSTOMER" ? "-1" : "1"}>
                    {kind === "CUSTOMER" ? (
                      <><option value="-1">mijoz bizga qarz (−131 = qarzi 131)</option><option value="1">mijoz avans bergan (+ — qarz)</option></>
                    ) : (
                      <><option value="1">biz avans berganmiz (+ — qarzimiz)</option><option value="-1">biz yetkazuvchiga qarzmiz</option></>
                    )}
                  </Select>
                </Field>
                <Field label="Sana" hint="faylda «Sana» bo'lmasa — hamma qatorga"><Input name="date" type="date" defaultValue={isoDate(new Date())} /></Field>
              </div>
              <Checkbox name="createMissing" defaultChecked label={`Bazada yo'q ${kind === "CUSTOMER" ? "mijozlarni" : "yetkazuvchilarni"} yangi karta qilib ochish (nomi va INN bilan; qarzi 0 bo'lsa ochilmaydi)`} />
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Qaysi sana holatiga *" hint="tizimga o'tish sanasi — hamma qatorga"><Input name="date" type="date" defaultValue={isoDate(lastDate ?? new Date())} required /></Field>
              {kind === "STOCK" && (
                <Field label="Standart sklad" hint="«Sklad» ustuni bo'sh qatorlar uchun">
                  <Select name="warehouseId" defaultValue={warehouses[0]?.id ?? ""}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}
        </ExcelImport>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Qo'lda kiritish" description={debtKind ? "Bitta sanaga bitta yozuv: summa — shu kungi qarz (+) yoki avans (−) qo'shimchasi" : "Bitta obyektga bitta boshlang'ich qoldiq — kiritilganlari tanlov ro'yxatida chiqmaydi"} />
        <OpeningCreateForm kind={kind} entities={entities} warehouses={warehouses.map((w) => ({ id: w.id, label: w.name }))} defaultDate={isoDate(lastDate ?? new Date())} />
      </Card>
      </>}

      <div id="kiritilganlar" className="mt-6 mb-2 flex scroll-mt-20 flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Kiritilgan qoldiqlar</h2>
        <div className="flex flex-wrap items-center gap-3">
          <form method="get" action={base} className="relative">
            {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {showCancelled && <input type="hidden" name="bekor" value="1" />}
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={term} placeholder="Nomi yoki INN…" className="h-9 w-60 pl-9" />
          </form>
          <Link href={href({ bekor: !showCancelled, q: term })} className="text-sm text-slate-500 hover:underline">{showCancelled ? "Faqat faollari" : "O'chirilganlarini ham ko'rsatish"}</Link>
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Sana</Th>
            <Th>{kind === "STOCK" ? "Mahsulot · sklad" : kind === "CASH" ? "Hisob" : kind === "CUSTOMER" ? "Mijoz" : "Yetkazuvchi"}</Th>
            {kind === "STOCK" && <><Th right>Miqdor</Th><Th right>Tannarx</Th></>}
            <Th right>{kind === "STOCK" ? "Qiymat" : "Summa"}</Th>
            {kind === "CUSTOMER" && <Th right>To&apos;langan</Th>}
            {kind === "SUPPLIER" && <Th right>Qolgan qarz</Th>}
            <Th>Izoh</Th><Th>Holat</Th><Th></Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <Empty text={term ? "Qidiruv bo'yicha hech narsa topilmadi" : "Hali boshlang'ich qoldiq kiritilmagan"} />}
          {rows.map((r) => {
            const amount = Number(r.amount);
            const paidCustomer = r.invoice ? r.invoice.payments.reduce((x, p) => x + Number(p.amount), 0) : 0;
            const due = dues.get(r.id) as { left: number; paid: number } | undefined;
            const who = r.customer ? <Link href={`/customers/${r.customer.id}`} className="font-medium hover:underline">{r.customer.name}</Link>
              : r.supplier ? <Link href={`/suppliers/${r.supplier.id}`} className="font-medium hover:underline">{r.supplier.name}</Link>
              : r.cashAccount ? <span className="font-medium">{r.cashAccount.name} <span className="text-xs text-slate-500">{r.cashAccount.type === "CASH" ? "naqd" : "bank"}</span></span>
              : r.product ? <span className="font-medium">{r.product.name} <span className="text-xs text-slate-500">· {r.warehouse?.name}</span></span> : "—";
            return (
              <Tr key={r.id} className={r.cancelledAt ? "opacity-60" : ""}>
                <Td>{date(r.date)}</Td>
                <Td>{who}{r.invoice && <div className="text-xs text-slate-500">{r.invoice.invoiceNo}</div>}</Td>
                {kind === "STOCK" && <><Td right>{fq(Number(r.qty ?? 0))}</Td><Td right>{r.unitCost == null ? "—" : money(Number(r.unitCost))}</Td></>}
                <Td right className={amount < 0 ? "text-amber-700" : "font-medium"}>{amount < 0 ? `−${money(-amount)}` : money(amount)}</Td>
                {kind === "CUSTOMER" && <Td right>{paidCustomer ? money(paidCustomer) : "—"}</Td>}
                {kind === "SUPPLIER" && (
                  <Td right className={due && due.left > 0 ? "text-red-600" : ""}>
                    {r.cancelledAt || !due ? "—" : money(due.left)}
                    {(supPays.get(r.id) ?? []).map((p: { id: string; date: Date; amount: number; account: string }) => (
                      <div key={p.id} className="mt-1 flex items-center justify-end gap-1 text-xs font-normal text-slate-500">
                        <span>{date(p.date)} · {money(p.amount)} · {p.account}</span>
                        {isDirector && <ConfirmButton action={reverseSupplierOpeningPaymentAction.bind(null, p.id)} label="Bekor qilish" icon={<Ban size={12} />} question="To'lov bekor qilinsinmi? Pul hisobga qaytadi, qarz yana ochiladi" reason="required" okText="Bekor qilindi" className="h-6 px-1.5 text-[11px]" />}
                      </div>
                    ))}
                  </Td>
                )}
                <Td className="max-w-56 text-xs text-slate-500">{r.note ?? ""}{r.cancelReason && <div className="text-red-600">O&apos;chirildi: {r.cancelReason}</div>}</Td>
                <Td>{r.cancelledAt ? <Badge color="slate">O&apos;chirilgan ({date(r.cancelledAt)})</Badge> : <Badge color="green">Faol</Badge>}</Td>
                <Td>
                  {!r.cancelledAt && (
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {kind === "SUPPLIER" && canPay && due && due.left > 0.005 && <SupplierPayForm id={r.id} left={due.left} accounts={accounts.map((a) => ({ id: a.id, label: a.name }))} />}
                      {canEdit && <OpeningEditForm id={r.id} kind={kind} date={isoDate(r.date)} amount={amount} qty={r.qty == null ? null : Number(r.qty)} unitCost={r.unitCost == null ? null : Number(r.unitCost)} note={r.note} />}
                      {canEdit && debtKind && <OpeningReduceForm id={r.id} amount={amount} paid={kind === "CUSTOMER" ? paidCustomer : due?.paid ?? 0} />}
                      {canEdit && <ConfirmButton action={cancelOpeningAction.bind(null, r.id)} label="O'chirish" icon={<Trash2 size={14} />} question="Qoldiq o'chirilsinmi? Qarz hisobotlardan chiqadi, yozuv «O'chirilganlar»da tarix uchun qoladi" reason="required" okText="O'chirildi" className="h-7 px-2 text-xs" />}
                    </div>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
