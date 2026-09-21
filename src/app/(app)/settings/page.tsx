import Link from "next/link";
import { Building2, Package, Layers, Warehouse, Landmark, Users, ScrollText } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { ROLE_LABELS } from "@/lib/nav";
import { dateTime } from "@/lib/format";
import { Badge, Button, Card, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { RowForm } from "@/components/row-form";
import { UserForm, ResetPasswordForm } from "./user-forms";
import { toggleUser, saveCompany, saveProduct, saveMaterial, saveWarehouse, saveCashAccount } from "./actions";

const TABS = [
  ["company", "Zavod rekvizitlari", Building2],
  ["products", "Beton markalari", Package],
  ["materials", "Xomashyo", Layers],
  ["warehouses", "Skladlar", Warehouse],
  ["accounts", "Kassa / hisoblar", Landmark],
  ["users", "Foydalanuvchilar", Users],
  ["audit", "Audit jurnali", ScrollText],
] as const;

const ACTION_LABEL: Record<string, string> = { CREATE: "Yaratdi", UPDATE: "O'zgartirdi", DELETE: "O'chirdi", STATUS_CHANGE: "Holatni o'zgartirdi" };
const ENTITY_LABEL: Record<string, string> = {
  Customer: "Mijoz", Supplier: "Yetkazuvchi", Order: "Zayavka", ProductionBatch: "Zames", Recipe: "Retsept", GoodsReceipt: "Kirim",
  Trip: "Reys", Invoice: "Schyot", Payment: "To'lov", Employee: "Xodim", Vehicle: "Texnika", User: "Foydalanuvchi",
  Product: "Beton markasi", Material: "Xomashyo", Warehouse: "Sklad", CashAccount: "Kassa/hisob", CompanySettings: "Rekvizitlar", StockMove: "Sklad harakati",
  Brigade: "Brigada", BrigadeTask: "Topshiriq", TaskProgress: "Bajarilganlik", CashTransaction: "Kirim-chiqim",
};
const UNITS: [string, string][] = [["kg", "kg"], ["t", "t"], ["l", "l"], ["m3", "m³"], ["dona", "dona"]];
const PRODUCT_UNITS: [string, string][] = [["m3", "m³ — tayyor beton"], ["dona", "dona — ustun, blok, bordyur"], ["m2", "m² — plitka"], ["m", "m — pogon"], ["t", "t"]];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession(["DIRECTOR"]);
  const { tab = "company" } = await searchParams;

  return (
    <div>
      <PageHeader title="Sozlamalar" subtitle="Faqat direktor uchun. Har bir o'zgarish audit jurnaliga tushadi." />
      <Tabs current={tab} className="mb-6" items={TABS.map(([k, label, Icon]) => ({ key: k, label, href: `/settings?tab=${k}`, icon: Icon }))} />

      {tab === "company" && <CompanyTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "materials" && <MaterialsTab />}
      {tab === "warehouses" && <WarehousesTab />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "users" && <UsersTab me={s.userId} />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

async function CompanyTab() {
  const c = await getCompany();
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Zavod rekvizitlari</h2>
      <p className="mb-4 text-sm text-slate-500">Nakladnoy, schyot va mijozlar sahifasida ishlatiladi.</p>
      <RowForm action={saveCompany} cols={3} submit="Saqlash" fields={[
        { name: "name", label: "Zavod nomi (brend) *", defaultValue: c.name, required: true },
        { name: "legalName", label: "Yuridik nomi", defaultValue: c.legalName, placeholder: "INSOF BETON MChJ" },
        { name: "inn", label: "INN", defaultValue: c.inn },
        { name: "directorName", label: "Direktor F.I.O.", defaultValue: c.directorName },
        { name: "phone", label: "Telefon", defaultValue: c.phone },
        { name: "phone2", label: "Qo'shimcha telefon", defaultValue: c.phone2 },
        { name: "email", label: "E-mail", defaultValue: c.email },
        { name: "workingHours", label: "Ish vaqti", defaultValue: c.workingHours },
        { name: "foundedYear", label: "Tashkil topgan yil", type: "number", defaultValue: c.foundedYear },
        { name: "address", label: "Manzil", defaultValue: c.address, className: "sm:col-span-3" },
        { name: "bankName", label: "Bank", defaultValue: c.bankName },
        { name: "bankAccount", label: "Hisob raqam", defaultValue: c.bankAccount },
        { name: "mfo", label: "MFO", defaultValue: c.mfo },
        { name: "about", label: "Zavod haqida (mijozlar sahifasida ko'rinadi)", type: "textarea", defaultValue: c.about, className: "sm:col-span-3" },
      ]} />
    </Card>
  );
}

async function ProductsTab() {
  const products = await db.product.findMany({ orderBy: { code: "asc" }, include: { recipes: { where: { isActive: true }, select: { version: true } } } });
  const fields = (p?: (typeof products)[number]) => [
    { name: "code", label: "Kod", defaultValue: p?.code, placeholder: "M300", required: true },
    { name: "name", label: "Nomi", defaultValue: p?.name, placeholder: "Beton M300 (B22.5)", required: true, className: "sm:col-span-2" },
    { name: "strengthClass", label: "Klass", defaultValue: p?.strengthClass, placeholder: "B22.5" },
    { name: "unit", label: "Birlik", type: "select" as const, defaultValue: p?.unit ?? "m3", options: PRODUCT_UNITS },
    { name: "price", label: "Narx, so'm/birlik", type: "number" as const, step: "1", defaultValue: p ? Number(p.price) : "" },
    ...(p ? [{ name: "isActive", label: "Faol", type: "checkbox" as const, defaultValue: p.isActive }] : []),
  ];
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-1 font-semibold">Yangi mahsulot</h2><p className="mb-3 text-xs text-slate-500">Birligi m³ — tayyor beton (saqlanmaydi). Dona/m² — hovlida turadigan tayyor mahsulot, Sklad → Ishlab chiqarish imkoni bo'limida hisoblanadi.</p><RowForm action={saveProduct.bind(null, null)} mode="create" cols={6} fields={fields()} /></Card>
      <Card>
        <h2 className="mb-3 font-semibold">Mahsulotlar</h2>
        <div className="divide-y divide-slate-100">
          {products.map((p) => (
            <div key={p.id} className="py-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                {p.recipes[0] ? <Badge color="green">retsept v{p.recipes[0].version}</Badge> : <Badge color="red">retsept yo'q</Badge>}
                <Link href={`/recipes/${p.id}`} className="hover:underline">Retseptga o'tish</Link>
              </div>
              <RowForm action={saveProduct.bind(null, p.id)} cols={6} fields={fields(p)} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function MaterialsTab() {
  const materials = await db.material.findMany({ orderBy: { name: "asc" } });
  const fields = (m?: (typeof materials)[number]) => [
    { name: "code", label: "Kod", defaultValue: m?.code, placeholder: "CEM", required: true },
    { name: "name", label: "Nomi", defaultValue: m?.name, placeholder: "Sement M400", required: true, className: "sm:col-span-2" },
    { name: "unit", label: "Birlik", type: "select" as const, defaultValue: m?.unit ?? "kg", options: UNITS },
    { name: "minStock", label: "Minimal qoldiq", type: "number" as const, step: "0.001", defaultValue: m ? Number(m.minStock) : "" },
    ...(m ? [{ name: "isActive", label: "Faol", type: "checkbox" as const, defaultValue: m.isActive }] : []),
  ];
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-3 font-semibold">Yangi xomashyo</h2><RowForm action={saveMaterial.bind(null, null)} mode="create" cols={6} fields={fields()} /></Card>
      <Card>
        <h2 className="mb-1 font-semibold">Xomashyo ro'yxati</h2>
        <p className="mb-3 text-xs text-slate-500">Minimal qoldiqdan kam qolsa bosh sahifada "Kam qoldi" signali chiqadi.</p>
        <div className="divide-y divide-slate-100">{materials.map((m) => <div key={m.id} className="py-3"><RowForm action={saveMaterial.bind(null, m.id)} cols={6} fields={fields(m)} /></div>)}</div>
      </Card>
    </div>
  );
}

async function WarehousesTab() {
  const list = await db.warehouse.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { stockMoves: true } } } });
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-3 font-semibold">Yangi sklad</h2><RowForm action={saveWarehouse.bind(null, null)} mode="create" cols={3} fields={[{ name: "name", label: "Nomi", placeholder: "2-sklad", required: true, className: "sm:col-span-2" }]} /></Card>
      <Card>
        <h2 className="mb-3 font-semibold">Skladlar</h2>
        <div className="divide-y divide-slate-100">
          {list.map((w) => (
            <div key={w.id} className="py-3">
              <div className="mb-1 text-xs text-slate-500">{w._count.stockMoves} ta harakat</div>
              <RowForm action={saveWarehouse.bind(null, w.id)} cols={3} fields={[{ name: "name", label: "Nomi", defaultValue: w.name, required: true }, { name: "isActive", label: "Faol", type: "checkbox", defaultValue: w.isActive }]} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function AccountsTab() {
  const list = await db.cashAccount.findMany({ orderBy: { name: "asc" } });
  const types: [string, string][] = [["CASH", "Naqd kassa"], ["BANK", "Bank hisobi"]];
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-3 font-semibold">Yangi kassa / hisob</h2><RowForm action={saveCashAccount.bind(null, null)} mode="create" cols={4} fields={[{ name: "name", label: "Nomi", placeholder: "Asosiy hisob raqam", required: true, className: "sm:col-span-2" }, { name: "type", label: "Turi", type: "select", options: types, defaultValue: "BANK" }]} /></Card>
      <Card>
        <h2 className="mb-3 font-semibold">Kassa va hisoblar</h2>
        <div className="divide-y divide-slate-100">
          {list.map((a) => <div key={a.id} className="py-3"><RowForm action={saveCashAccount.bind(null, a.id)} cols={4} fields={[{ name: "name", label: "Nomi", defaultValue: a.name, required: true, className: "sm:col-span-2" }, { name: "type", label: "Turi", type: "select", options: types, defaultValue: a.type }, { name: "isActive", label: "Faol", type: "checkbox", defaultValue: a.isActive }]} /></div>)}
        </div>
      </Card>
    </div>
  );
}

async function UsersTab({ me }: { me: string }) {
  const users = await db.user.findMany({ orderBy: [{ isActive: "desc" }, { fullName: "asc" }], include: { employee: true } });
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-1 font-semibold">Yangi foydalanuvchi</h2><p className="mb-3 text-xs text-slate-500">Xodim bilan bog'lash uchun Xodimlar sahifasidan qo'shing — u yerda lavozim bo'yicha rol avtomatik beriladi.</p><UserForm roles={Object.entries(ROLE_LABELS)} /></Card>
      <Table>
        <thead><tr><Th>F.I.O.</Th><Th>Login</Th><Th>Rol</Th><Th>Xodim</Th><Th>Holat</Th><Th>Parol</Th><Th></Th></tr></thead>
        <tbody>
          {users.map((u) => (
            <Tr key={u.id}>
              <Td className="font-medium">{u.fullName}</Td><Td><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{u.login}</code></Td><Td>{ROLE_LABELS[u.role]}</Td>
              <Td className="text-slate-500">{u.employee ? u.employee.position : "—"}</Td>
              <Td>{u.isActive ? <Badge color="green">Faol</Badge> : <Badge>Bloklangan</Badge>}</Td>
              <Td><ResetPasswordForm userId={u.id} /></Td>
              <Td>{u.id !== me && <form action={toggleUser.bind(null, u.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{u.isActive ? "Bloklash" : "Yoqish"}</Button></form>}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

async function AuditTab() {
  const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { user: true } });
  return (
    <Table>
      <thead><tr><Th>Vaqt</Th><Th>Kim</Th><Th>Amal</Th><Th>Obyekt</Th><Th>O'zgarish</Th></tr></thead>
      <tbody>
        {logs.map((l) => (
          <Tr key={l.id}>
            <Td className="whitespace-nowrap">{dateTime(l.createdAt)}</Td>
            <Td>{l.user.fullName}</Td><Td>{ACTION_LABEL[l.action] ?? l.action}</Td><Td>{ENTITY_LABEL[l.entity] ?? l.entity}</Td>
            <Td className="max-w-md truncate font-mono text-xs text-slate-500">{l.after ? JSON.stringify(l.after).slice(0, 120) : ""}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
