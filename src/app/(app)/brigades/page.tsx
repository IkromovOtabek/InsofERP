import Link from "next/link";
import { HardHat, ArrowRight, Boxes, Package, TriangleAlert, Users, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { qty, money } from "@/lib/format";
import { brigadeStocks, undistributedMaterials } from "@/lib/brigade-stock";
import { unitLabel } from "@/lib/unit";
import { canTask } from "@/lib/tasks";
import { canDo } from "@/lib/permissions";
import { brigadeDefectsMonth, brigadePayMonth, brigadeProducts } from "@/lib/brigade-pay";
import { MonthBar, parseMonth } from "../bi-tahlil/month-bar";
import { BrigadeProductsView } from "./brigade-products";
import { BrigadePayView, BrigadeDefectsView } from "./pay-view";
import { BrigadeStaffView } from "./staff-view";
import { productionStaff } from "@/lib/production-staff";
import { ROLE_LABELS } from "@/lib/nav";
import { Badge, Button, Card, LinkButton, PageHeader, Progress, Tabs } from "@/components/ui";
import { RowForm } from "@/components/row-form";
import { saveBrigade, toggleBrigade } from "./actions";

/**
 * Brigadalar: ro'yxat (brigadir, topshiriq, xomashyo), «Xodimlar» — brigadaga xodim tayinlash, «Mahsulotlar» — qaysi brigadada qanday mahsulot va necha pullik,
 * «Oylik» — sdelka fondi − brak = brigada oyligi, «Brak» — kunlik brak va summasini tahrirlash (`lib/brigade-pay.ts`).
 */
export default async function BrigadesPage({ searchParams }: { searchParams: Promise<{ tab?: string; oy?: string; brigada?: string }> }) {
  const s = await requireRoles(["SUPERVISOR", "PRODUCTION", "HR", "SALES"], { module: "tasks" });
  const sp = await searchParams;
  const canEdit = canTask(s.role, "brigadeEdit"); // rol matritsasi — `lib/tasks.ts`
  // Pul (oylik, brak summasi) — sotuv bo'limiga kerak emas; summani tahrirlash — `tasks` → `pay` (ish boshqaruvchi)
  const showPay = s.role !== "SALES";
  const canPay = canDo(s, "tasks", "pay");
  const tab = ["mahsulotlar", ...(showPay ? ["xodimlar", "oylik", "brak"] : [])].includes(sp.tab ?? "") ? sp.tab! : "royxat";
  const month = parseMonth(sp.oy);
  const tabs = (
    <Tabs current={tab} items={[
      { key: "royxat", label: "Brigadalar", href: "/brigades", icon: HardHat },
      ...(showPay ? [{ key: "xodimlar", label: "Xodimlar", href: "/brigades?tab=xodimlar", icon: Users }] : []),
      { key: "mahsulotlar", label: "Mahsulotlar", href: "/brigades?tab=mahsulotlar", icon: Package },
      ...(showPay ? [
        { key: "oylik", label: "Oylik", href: `/brigades?tab=oylik&oy=${month}`, icon: Wallet },
        { key: "brak", label: "Brak (kunlik)", href: `/brigades?tab=brak&oy=${month}`, icon: TriangleAlert },
      ] : []),
    ]} />
  );
  if (tab !== "royxat") {
    const title = <PageHeader title="Brigadalar" subtitle={tab === "xodimlar" ? "Xodimni brigadaga tayinlash yoki boshqasiga o'tkazish — tanlansa darhol saqlanadi. Sex davomati va sdelka fondi shu tarkib bo'yicha" : tab === "mahsulotlar" ? "Ochiq topshiriqlar mahsulot bo'yicha: berilgan, bajarilgan, qoldiq — nechta va necha pullik (mahsulot narxida)" : tab === "oylik" ? "Brigada oyligi = bajarilgan hajm × sdelka narxi − brak summasi. Vedomostda brak sdelkadagi a'zolardan fond ulushi bo'yicha ushlanadi" : "Brak kun va brigada bo'yicha. Summa yozilganda miqdor × sotuv narxi — ish boshqaruvchi tahrirlaydi"} />;
    if (tab === "xodimlar") {
      const [staff, emps] = await Promise.all([
        productionStaff(),
        db.employee.findMany({ where: { isActive: true, firedAt: null }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true, brigadeId: true } }),
      ]);
      return <div>{title}{tabs}<BrigadeStaffView staff={staff} employees={emps} canEdit={canDo(s, "production", "staff")} /></div>;
    }
    if (tab === "mahsulotlar") return <div>{title}{tabs}<BrigadeProductsView data={await brigadeProducts()} /></div>;
    const brigadaId = sp.brigada || null;
    if (tab === "oylik") return <div>{title}{tabs}<MonthBar base="/brigades" month={month} keep={{ tab }} /><BrigadePayView data={await brigadePayMonth(month)} /></div>;
    return (
      <div>{title}{tabs}
        <MonthBar base="/brigades" month={month} keep={{ tab, brigada: brigadaId ?? undefined }} />
        <BrigadeDefectsView data={await brigadeDefectsMonth(month)} month={month} brigadeId={brigadaId} canEdit={canPay} />
      </div>
    );
  }
  const [brigades, employees, stocks, undistributed] = await Promise.all([
    // Brigadirning login roli ham kerak: topshiriq ECO ilovasiga faqat BRIGADIER logini bor brigadirga tushadi
    db.brigade.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { leader: { include: { user: { select: { role: true, isActive: true } } } }, tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } } }, _count: { select: { members: { where: { isActive: true } } } } } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } }),
    // Brigada qo'lidagi xomashyo va shu xomashyo bilan qancha chiqara olishi
    brigadeStocks({ includeInactive: true }),
    undistributedMaterials(),
  ]);
  const stockOf = new Map(stocks.map((x) => [x.id, x]));

  return (
    <div>
      <PageHeader title={undistributed.count > 0
        ? <>Brigadalar <span className="rounded-full bg-red-100 px-2 py-0.5 text-sm font-bold text-red-700">{undistributed.count}</span></>
        : "Brigadalar"} subtitle={`Zayavkadagi mahsulotlar brigadalarga topshiriq sifatida biriktiriladi. Brigadir — Xodimlar ro'yxatidan. Qo'lidagi xomashyo topshiriq bajarilganda retsept bo'yicha kamayadi.${undistributed.count > 0 ? ` Kelgan mahsulotlardan ${undistributed.count} tasi hali taqsimlanmagan: ${undistributed.names.slice(0, 5).join(", ")}.` : ""}`}
        action={<LinkButton href="/stock?tab=brigades" variant="secondary"><Boxes size={16} /> Xomashyo taqsimlash</LinkButton>} />
      {tabs}
      {canEdit && (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold">Yangi brigada</h2>
          <RowForm action={saveBrigade.bind(null, null)} mode="create" cols={5} submit="Qo'shish" fields={[
            { name: "name", label: "Nomi *", placeholder: "1-brigada", required: true },
            { name: "leaderId", label: "Brigadir", type: "select", options: [["", "—"], ...employees.map((e) => [e.id, `${e.fullName} · ${e.position}`] as [string, string])] },
            { name: "phone", label: "Telefon" },
            { name: "note", label: "Izoh", className: "sm:col-span-2" },
          ]} />
        </Card>
      )}
      {brigades.length === 0 ? <Card className="text-sm text-slate-500">Brigadalar yo&apos;q</Card> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {brigades.map((b) => {
            const total = b.tasks.reduce((x, t) => x + Number(t.qty), 0);
            const done = b.tasks.reduce((x, t) => x + Number(t.doneQty), 0);
            const st = stockOf.get(b.id);
            const best = st?.makes.filter((m) => m.canMake > 0).sort((x, y) => y.canMake - x.canMake)[0] ?? null;
            return (
              <Card key={b.id} className={b.isActive ? "flex flex-col" : "flex flex-col opacity-70"}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><HardHat size={16} /></div>
                    <div className="min-w-0">
                      <div className="font-semibold leading-snug">{b.name}</div>
                      {b.note && <div className="text-xs text-slate-500">{b.note}</div>}
                    </div>
                  </div>
                  {b.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}
                </div>

                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">Brigadir</span>
                    <span className="truncate font-medium">{b.leader?.fullName ?? "—"}</span>
                  </div>
                  {b.leader && <div className="mt-0.5 text-right text-xs">{
                    !b.leader.user ? <span className="text-amber-700">Ilovaga kirmaydi — Xodimlar bo&apos;limidan login bering</span>
                    : b.leader.user.role === "BRIGADIER" ? <span className="text-emerald-700">Insof ECO ilovasiga kiradi</span>
                    : <span className="text-slate-500">Login bor · {ROLE_LABELS[b.leader.user.role]}</span>
                  }</div>}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">Telefon</span>
                    <span className="tabular">{b.phone ?? b.leader?.phone ?? "—"}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">Xodimlar</span>
                    <Link href="/brigades?tab=xodimlar" className="hover:underline">{b._count.members} kishi</Link>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-sm">
                    <Link href={`/tasks?brigade=${b.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">{b.tasks.length} ochiq topshiriq <ArrowRight size={13} /></Link>
                    <span className="text-xs text-slate-500 tabular">{qty(done)} / {qty(total)}</span>
                  </div>
                  <Progress value={done} max={total || 1} tone={done >= total && total > 0 ? "success" : "default"} />
                  <div className="mt-0.5 text-xs text-slate-500">qoldiq {qty(total - done)}</div>
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="rounded-lg border border-slate-100 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Qo&apos;lidagi xomashyo</div>
                    {st && st.materials.length > 0 ? (
                      <>
                        <div className="font-medium">{st.materials.length} xil · {money(st.value)}</div>
                        <div className="text-xs text-slate-500">{st.materials.slice(0, 3).map((m) => `${m.name} ${qty(m.qty)} ${unitLabel(m.unit)}`).join(", ")}{st.materials.length > 3 ? "…" : ""}</div>
                      </>
                    ) : <Link href="/stock?tab=brigades" className="text-xs text-slate-500 underline">xomashyo berilmagan</Link>}
                  </div>
                  <div className="rounded-lg border border-slate-100 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Ishlab chiqara oladi</div>
                    {best ? <div className="font-semibold text-emerald-700">{qty(best.canMake)} {unitLabel(best.unit)}</div> : <div className="text-xs text-slate-400">—</div>}
                    {best && <div className="text-xs text-slate-500">{best.product}</div>}
                  </div>
                </div>

                {canEdit && (
                  <div className="mt-auto pt-3">
                    <div className="flex justify-end border-t border-slate-100 pt-3">
                      <form action={toggleBrigade.bind(null, b.id)}><Button variant="secondary" size="sm">{b.isActive ? "Nofaol qilish" : "Faollashtirish"}</Button></form>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
