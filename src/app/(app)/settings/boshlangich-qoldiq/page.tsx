import Link from "next/link";
import { Ban, Landmark, Package, Truck, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { moduleWriteAllowed } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { money, qty as fq, date, isoDate } from "@/lib/format";
import { KIND_LABEL, OPENING_WRITERS, supplierOpeningDues } from "@/lib/opening-balances";
import { Badge, Callout, Card, CardHeader, Checkbox, Empty, Field, Input, PageHeader, Select, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { ConfirmButton } from "../../payments/confirm-button";
import { OpeningCreateForm, OpeningEditForm, SupplierPayForm } from "./forms";
import { cancelOpeningAction, importOpeningsAction } from "./actions";
import type { ImportField } from "@/lib/excel";
import type { OpeningKind } from "@/generated/prisma";

/**
 * Sozlamalar → Boshlang'ich qoldiqlar: real korxonani tizimga o'tkazish sanasidagi holat.
 * Mijozlar qarzi/avansi, yetkazuvchilarga qarz, kassa/bank qoldiqlari va tayyor mahsulot qoldig'i —
 * qo'lda yoki Excel'dan. Kiritish — direktor va buxgalteriya; tahrir/bekor qilish — faqat direktor.
 * Qanday hisobotlarga tushishi — `lib/opening-balances.ts` boshidagi izohda.
 */
const KINDS: OpeningKind[] = ["CUSTOMER", "SUPPLIER", "CASH", "STOCK"];
const ICON = { CUSTOMER: Users, SUPPLIER: Truck, CASH: Landmark, STOCK: Package } as const;

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
    { key: "amount", label: "Summa", required: true, hint: "+ qarz, − avans", synonyms: ["qarz", "долг", "сальдо", "остаток", "qoldiq", "summa", "сумма", "debet", "дебет"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "комментар", "note"] },
  ],
  SUPPLIER: [
    { key: "name", label: "Yetkazuvchi", required: true, synonyms: ["yetkazuvchi", "поставщик", "контрагент", "nomi", "наимен", "name"] },
    { key: "inn", label: "INN", hint: "bo'lsa shu bo'yicha topiladi", synonyms: ["инн", "inn", "стир", "stir"] },
    { key: "amount", label: "Summa", required: true, hint: "+ qarzimiz, − avansimiz", synonyms: ["qarz", "долг", "сальдо", "остаток", "qoldiq", "summa", "сумма", "kredit", "кредит"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "комментар", "note"] },
  ],
  CASH: [
    { key: "name", label: "Hisob (kassa/bank nomi)", required: true, hint: "Sozlamalardagi nom bilan bir xil", synonyms: ["hisob", "kassa", "касса", "счет", "счёт", "bank", "банк", "nomi", "name"] },
    { key: "amount", label: "Qoldiq", required: true, hint: "− bank overdrafti", synonyms: ["qoldiq", "остаток", "сальдо", "summa", "сумма"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "note"] },
  ],
  STOCK: [
    { key: "name", label: "Mahsulot (kod yoki nomi)", required: true, synonyms: ["mahsulot", "товар", "продукц", "kod", "код", "marka", "марка", "nomi", "наимен", "name"] },
    { key: "warehouse", label: "Sklad", hint: "bo'sh — formadagi standart sklad", synonyms: ["sklad", "склад", "ombor", "warehouse"] },
    { key: "qty", label: "Miqdor", required: true, synonyms: ["miqdor", "кол", "к-во", "qoldiq", "остаток", "soni", "qty"] },
    { key: "unitCost", label: "Tannarx (birlik)", synonyms: ["tannarx", "себестоим", "narx", "цена", "cost"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч", "note"] },
  ],
};

const EXAMPLE: Record<OpeningKind, Record<string, string | number>> = {
  CUSTOMER: { name: "\"QURILISH INVEST\" MCHJ", inn: "305123456", amount: 45000000, note: "1C akt sverka 30.09" },
  SUPPLIER: { name: "\"BODOMZOR SEMENT\" MCHJ", inn: "301987654", amount: 120000000, note: "" },
  CASH: { name: "Asosiy kassa", amount: 15000000, note: "" },
  STOCK: { name: "M300", warehouse: "Asosiy sklad", qty: 120, unitCost: 650000, note: "" },
};

export default async function OpeningBalancesPage({ searchParams }: { searchParams: Promise<{ tab?: string; bekor?: string }> }) {
  // Yo'l ruxsati (rol + direktor bergan "opening" modul ruxsati): "yopiq" qilingan buxgalter ham kira olmaydi
  const s = await requirePage("/settings/boshlangich-qoldiq");
  const canEdit = moduleWriteAllowed(s, "opening", OPENING_WRITERS) === true; // Finance — faqat ko'radi va to'laydi
  const sp = await searchParams;
  const kind: OpeningKind = KINDS.includes(sp.tab as OpeningKind) ? (sp.tab as OpeningKind) : "CUSTOMER";
  const showCancelled = sp.bekor === "1";
  const isDirector = s.role === "DIRECTOR";
  const canPay = canDo(s, "cashflow", "pay");

  const [rows, counts, warehouses, accounts] = await Promise.all([
    db.openingBalance.findMany({
      where: { kind, ...(showCancelled ? {} : { cancelledAt: null }) },
      orderBy: [{ cancelledAt: "asc" }, { createdAt: "desc" }],
      take: 1000,
      include: {
        customer: { select: { id: true, name: true, inn: true } }, supplier: { select: { id: true, name: true, inn: true } },
        cashAccount: { select: { name: true, type: true } }, product: { select: { code: true, name: true, unit: true } }, warehouse: { select: { name: true } },
        invoice: { select: { invoiceNo: true, status: true, payments: { select: { amount: true } } } },
      },
    }),
    db.openingBalance.groupBy({ by: ["kind"], where: { cancelledAt: null }, _count: true }),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
  ]);
  const active = rows.filter((r) => !r.cancelledAt);
  const usedIds = new Set(active.map((r) => r.customerId ?? r.supplierId ?? r.cashAccountId ?? ""));

  // Tanlov ro'yxati: qoldig'i hali kiritilmagan obyektlar (STOCK — mahsulot+sklad juftligi, shuning uchun hammasi)
  const entities = kind === "CUSTOMER"
    ? (await db.customer.findMany({ where: { isInternal: false, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, inn: true } })).filter((c) => !usedIds.has(c.id)).map((c) => ({ id: c.id, label: c.inn ? `${c.name} · ${c.inn}` : c.name }))
    : kind === "SUPPLIER"
      ? (await db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, inn: true } })).filter((c) => !usedIds.has(c.id)).map((c) => ({ id: c.id, label: c.inn ? `${c.name} · ${c.inn}` : c.name }))
      : kind === "CASH"
        ? accounts.filter((a) => !usedIds.has(a.id)).map((a) => ({ id: a.id, label: `${a.name} (${a.type === "CASH" ? "naqd" : "bank"})` }))
        : (await db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } })).map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));

  const dues = kind === "SUPPLIER" ? new Map((await supplierOpeningDues()).map((d) => [d.id, d])) : new Map();
  const total = active.reduce((x, r) => x + Number(r.amount), 0);
  const plus = active.filter((r) => Number(r.amount) > 0).reduce((x, r) => x + Number(r.amount), 0);
  const minus = total - plus;
  const lastDate = active[0]?.date;
  const countOf = (k: OpeningKind) => counts.find((c) => c.kind === k)?._count ?? 0;
  const qs = (k: OpeningKind, bekor = showCancelled) => `/settings/boshlangich-qoldiq?tab=${k}${bekor ? "&bekor=1" : ""}`;
  const Icon = ICON[kind];

  return (
    <div>
      <PageHeader
        title="Boshlang'ich qoldiqlar"
        subtitle="Tizimga o'tish sanasidagi holat: mijozlar va yetkazuvchilar bilan hisob-kitob, kassa/bank va tayyor mahsulot qoldig'i. Kiritish — direktor va buxgalteriya; tahrir va bekor qilish — faqat direktor (har o'zgarish auditda)."
      />
      <Tabs current={kind} className="mb-4" items={KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], href: qs(k), icon: ICON[k], count: countOf(k) || undefined }))} />

      <Callout tone="info" title="Hisobotlarga qanday tushadi">{HELP[kind]}</Callout>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Kiritilgan yozuvlar" value={String(active.length)} icon={Icon} hint={lastDate ? `oxirgisi ${date(lastDate)} holatiga` : "hali yo'q"} />
        <StatCard label={kind === "STOCK" ? "Ombor qiymati (tannarx)" : kind === "CASH" ? "Jami qoldiq" : kind === "CUSTOMER" ? "Mijozlar qarzi (+)" : "Qarzimiz (+)"} value={money(kind === "STOCK" || kind === "CASH" ? total : plus)} tone="info" />
        {kind !== "STOCK" && kind !== "CASH" && <StatCard label={kind === "CUSTOMER" ? "Mijozlar avansi (−)" : "Bergan avansimiz (−)"} value={money(-minus)} tone={minus < 0 ? "warning" : "default"} />}
      </div>

      {canEdit && <>
      <Card className="mt-6">
        <CardHeader title="Qo'lda kiritish" description="Bitta obyektga bitta boshlang'ich qoldiq — kiritilganlari tanlov ro'yxatida chiqmaydi" />
        <OpeningCreateForm kind={kind} entities={entities} warehouses={warehouses.map((w) => ({ id: w.id, label: w.name }))} defaultDate={isoDate(lastDate ?? new Date())} />
      </Card>

      <Card className="mt-6">
        <CardHeader title="Excel orqali yuklash" description="Namunani yuklab oling, to'ldiring va qaytarib yuklang. Bitta qatorda xato bo'lsa ham hech narsa yozilmaydi; qoldig'i bor obyektlar o'tkazib yuboriladi." />
        <ExcelImport
          action={importOpeningsAction.bind(null, kind)}
          submitLabel="Qoldiqlarni yozish"
          templateName={`boshlangich-qoldiq-${kind.toLowerCase()}`}
          example={EXAMPLE[kind]}
          fields={IMPORT_FIELDS[kind]}
        >
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
          {(kind === "CUSTOMER" || kind === "SUPPLIER") && (
            <Checkbox name="createMissing" label={`Bazada yo'q ${kind === "CUSTOMER" ? "mijozlarni" : "yetkazuvchilarni"} nomi va INN bilan yangi karta qilib ochish (aks holda xato beriladi)`} />
          )}
        </ExcelImport>
      </Card>
      </>}

      <div className="mt-6 mb-2 flex items-center justify-between gap-3">
        <h2 className="font-semibold">Kiritilgan qoldiqlar</h2>
        <Link href={qs(kind, !showCancelled)} className="text-sm text-slate-500 hover:underline">{showCancelled ? "Faqat faollari" : "Bekor qilinganlarini ham ko'rsatish"}</Link>
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
          {rows.length === 0 && <Empty text="Hali boshlang'ich qoldiq kiritilmagan" />}
          {rows.map((r) => {
            const amount = Number(r.amount);
            const paidCustomer = r.invoice ? r.invoice.payments.reduce((x, p) => x + Number(p.amount), 0) : 0;
            const due = dues.get(r.id) as { left: number } | undefined;
            const who = r.customer ? <Link href={`/customers/${r.customer.id}`} className="font-medium hover:underline">{r.customer.name}</Link>
              : r.supplier ? <Link href={`/suppliers/${r.supplier.id}`} className="font-medium hover:underline">{r.supplier.name}</Link>
              : r.cashAccount ? <span className="font-medium">{r.cashAccount.name} <span className="text-xs text-slate-500">{r.cashAccount.type === "CASH" ? "naqd" : "bank"}</span></span>
              : r.product ? <span className="font-medium">{r.product.code} · {r.product.name} <span className="text-xs text-slate-500">· {r.warehouse?.name}</span></span> : "—";
            return (
              <Tr key={r.id} className={r.cancelledAt ? "opacity-60" : ""}>
                <Td>{date(r.date)}</Td>
                <Td>{who}{r.invoice && <div className="text-xs text-slate-500">{r.invoice.invoiceNo}</div>}</Td>
                {kind === "STOCK" && <><Td right>{fq(Number(r.qty ?? 0))}</Td><Td right>{r.unitCost == null ? "—" : money(Number(r.unitCost))}</Td></>}
                <Td right className={amount < 0 ? "text-amber-700" : "font-medium"}>{amount < 0 ? `−${money(-amount)}` : money(amount)}</Td>
                {kind === "CUSTOMER" && <Td right>{paidCustomer ? money(paidCustomer) : "—"}</Td>}
                {kind === "SUPPLIER" && <Td right className={due && due.left > 0 ? "text-red-600" : ""}>{r.cancelledAt || !due ? "—" : money(due.left)}</Td>}
                <Td className="max-w-56 text-xs text-slate-500">{r.note ?? ""}{r.cancelReason && <div className="text-red-600">Bekor: {r.cancelReason}</div>}</Td>
                <Td>{r.cancelledAt ? <Badge color="slate">Bekor ({date(r.cancelledAt)})</Badge> : <Badge color="green">Faol</Badge>}</Td>
                <Td>
                  {!r.cancelledAt && (
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {kind === "SUPPLIER" && canPay && due && due.left > 0.005 && <SupplierPayForm id={r.id} left={due.left} accounts={accounts.map((a) => ({ id: a.id, label: a.name }))} />}
                      {isDirector && <OpeningEditForm id={r.id} kind={kind} date={isoDate(r.date)} amount={amount} qty={r.qty == null ? null : Number(r.qty)} unitCost={r.unitCost == null ? null : Number(r.unitCost)} note={r.note} />}
                      {isDirector && <ConfirmButton action={cancelOpeningAction.bind(null, r.id)} label="Bekor" icon={<Ban size={14} />} question="Boshlang'ich qoldiq bekor qilinsinmi?" reason="required" okText="Bekor qilindi" className="h-7 px-2 text-xs" />}
                    </div>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
