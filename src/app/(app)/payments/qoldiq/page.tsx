import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { Button, Callout, Card, Input, PageHeader } from "@/components/ui";
import { accountBalances } from "@/lib/payments";
import { txSign } from "@/lib/cash-tx";
import { monthEndDate } from "@/lib/opening-balances";
import { dateRu } from "@/lib/format";
import { MonthEndForm, type MonthEndRow } from "./form";

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Kassa / bank → «Oy oxiri qoldiqlari»: Exceldan tizimga o'tishda har hisob (naqd kassa, bank) uchun tanlangan oy
 * oxiridagi qoldiq kiritiladi. Qoldiq hisobning boshlang'ich qoldig'i bo'lib yoziladi (Sozlamalar → «Boshlang'ich
 * qoldiq» dagi bilan bitta yozuv): kirim/chiqim va P&L hisobotlariga kirmaydi, faqat hisob qoldig'iga.
 */
export default async function MonthEndBalancesPage({ searchParams }: { searchParams: Promise<{ oy?: string }> }) {
  await requireRoles(["ACCOUNTING"], { module: "payments", actions: ["balance"] });
  const sp = await searchParams;
  const now = new Date();
  const lastEnded = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const oy = sp.oy && monthEndDate(sp.oy) ? sp.oy : lastEnded;
  const day = monthEndDate(oy)!;
  const upTo = { lt: new Date(day.getTime() + 86_400_000) };

  const [accounts, nowBal, pay, tx, openings] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }),
    accountBalances(),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: upTo }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { date: upTo, cancelledAt: null }, _sum: { amount: true } }),
    db.openingBalance.findMany({ where: { kind: "CASH", activeKey: { not: null } }, select: { cashAccountId: true, date: true, amount: true } }),
  ]);
  // Hisob qoldig'i tanlangan oy oxirida (Kirim-Chiqimdagi hisob ko'chirmasi bilan bir xil: to'lovlar + barcha yozuvlar ishorasi bilan)
  const atDay = new Map<string, number>();
  for (const p of pay) atDay.set(p.cashAccountId, (atDay.get(p.cashAccountId) ?? 0) + Number(p._sum.amount ?? 0));
  for (const t of tx) atDay.set(t.cashAccountId, (atDay.get(t.cashAccountId) ?? 0) + txSign(t.type) * Number(t._sum.amount ?? 0));
  const openingOf = new Map(openings.map((o) => [o.cashAccountId, o]));

  const rows: MonthEndRow[] = accounts.map((a) => {
    const o = openingOf.get(a.id);
    return {
      id: a.id, name: a.name, bank: a.type === "BANK",
      atDay: Math.round((atDay.get(a.id) ?? 0) * 100) / 100,
      now: nowBal.get(a.id) ?? 0,
      opening: o ? { date: dateRu(o.date), amount: Number(o.amount) } : null,
    };
  });

  return (
    <div>
      <PageHeader
        back={{ href: "/payments?tab=kassa", label: "Kassa / bank" }}
        title="Oy oxiri qoldiqlari"
        info={<>
          <p>Exceldan tizimga o&apos;tish: naqd kassa va bank hisoblarining oy oxiridagi qoldig&apos;ini kiriting — keyingi kirim-chiqim shu qoldiq ustiga yoziladi.</p>
          <p>Exceldagi qoldiqni ERPga o&apos;tgan kundan oldingi oy oxiri holatiga yozing. Excel jurnalini keyingi oydan boshlab
            «Excel orqali qo&apos;shish» bilan yuklasangiz yoki kunlik kiritsangiz — hisob shu qoldiqdan davom etadi va minusga tushmaydi.</p>
          <p>Qoldiq kirim/chiqim va foyda-zarar hisobotlariga kirmaydi. Har hisobda bitta boshlang&apos;ich qoldiq: qayta kiritilsa —
            summa va sana yangilanadi (tarix AuditLog&apos;da).</p>
          <p>Bo&apos;sh qoldirilgan hisob o&apos;zgarmaydi. «O&apos;zgaradi» ustuni — saqlangach hisob qoldig&apos;i shuncha o&apos;zgaradi.</p>
        </>}
      />

      <Card className="max-w-6xl">
        <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Qaysi oy oxiri holatiga</span>
            <Input type="month" name="oy" defaultValue={oy} max={lastEnded} className="w-48" />
          </label>
          <Button variant="secondary" size="sm">Ko&apos;rsatish</Button>
        </form>

        {accounts.length === 0 ? (
          <Callout tone="warning" title="Kassa/hisob yo'q">
            Avval Sozlamalar → «Kassa va hisoblar» bo&apos;limida kamida bitta kassa yoki bank hisobini oching.
          </Callout>
        ) : (
          <MonthEndForm key={oy} oy={oy} day={dateRu(day)} rows={rows} />
        )}

      </Card>
    </div>
  );
}
