import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { avgUnitCosts } from "@/lib/stock";
import { issueTargetOptions } from "@/lib/stock-recipients";
import { ISSUE_BACK_DAYS, ISSUE_STORNO, issueHints, parseIssueTarget } from "@/lib/stock-issue";
import { dateRu, isoDate } from "@/lib/format";
import { Callout, Card, PageHeader } from "@/components/ui";
import { HoldingsPanel } from "@/components/holdings-panel";
import { holdingsOverview } from "@/lib/holdings";
import type { TargetGroups } from "@/lib/issue-target";
import { categoriesFor, categoryFromSlug } from "@/lib/material-category";
import { RasxodForm, type RasxodInitial } from "../rasxod-form";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * «Tuzatish» / nusxa (`?copy=<ref>`): chiqim hujjatining (`refType "Issue"`) sklad, «Kimga», sana, izoh va qatorlari.
 * Bir xomashyo bir necha harakatda bo'lsa — bitta qatorga qo'shiladi. Yopilgan xomashyo tushirilmaydi (`skipped`),
 * nofaol oluvchi / brigada / xodim — «Kimga» bo'sh qoladi. Brigada izohidagi «… brigadasiga berildi · » olib tashlanadi.
 */
async function loadCopy(ref: string, materialIds: Set<string>, all: TargetGroups) {
  const [moves, stornoed] = await Promise.all([
    db.stockMove.findMany({
      where: { refType: "Issue", refId: ref }, orderBy: { createdAt: "asc" },
      select: { date: true, warehouseId: true, materialId: true, recipientId: true, employeeId: true, vehicleId: true, brigadeId: true, qty: true, note: true, brigade: { select: { name: true } }, material: { select: { name: true } } },
    }),
    db.stockMove.count({ where: { refType: ISSUE_STORNO, refId: ref } }),
  ]);
  const first = moves[0];
  if (!first) return null;
  const sum = new Map<string, number>();
  for (const m of moves) if (m.materialId) sum.set(m.materialId, r3((sum.get(m.materialId) ?? 0) - Number(m.qty)));
  const key = first.brigadeId ? `b:${first.brigadeId}` : first.vehicleId ? `v:${first.vehicleId}` : first.employeeId ? `e:${first.employeeId}` : first.recipientId ? `r:${first.recipientId}` : "";
  const t = parseIssueTarget(key);
  const employee = t?.kind === "employee" ? all.employees.find((e) => e.id === t.id) ?? null : null;
  const known = !!t && targetList(all, t.kind).some((x) => x.id === t.id);
  const brigadePrefix = first.brigade ? `${first.brigade.name} brigadasiga berildi` : null;
  const note = brigadePrefix && first.note?.startsWith(brigadePrefix) ? first.note.slice(brigadePrefix.length).replace(/^\s*·\s*/, "") : first.note ?? "";
  const initial: RasxodInitial = {
    warehouseId: first.warehouseId, to: known ? key : "", date: isoDate(first.date), note,
    lines: [...sum.entries()].filter(([id, q]) => materialIds.has(id) && q > 0).map(([materialId, q]) => ({ materialId, qty: String(q) })),
    copyOf: stornoed > 0 ? ref : null,
  };
  return {
    date: first.date, cancelled: stornoed > 0, initial, targetLost: !known, employee,
    skipped: [...new Set(moves.filter((m) => m.materialId && !materialIds.has(m.materialId)).map((m) => m.material?.name ?? "?"))],
  };
}

/** Kalit turi bo'yicha «Kimga» ro'yxati (bor-yo'qligini tekshirish uchun). */
const targetList = (g: TargetGroups, kind: string): { id: string }[] =>
  kind === "brigade" ? g.brigades : kind === "employee" ? g.employees : kind === "vehicle" ? g.vehicles ?? [] : g.recipients;

/**
 * Sklad → «Chiqim» → Yangi chiqim: skladdan oluvchiga yoki brigadaga xomashyo berish.
 * «Avto zapchast» kategoriyasida «Kimga» — o'z parkimiz transportlari: berilgan zapchast summasi Logistika moliyada chiqim.
 * Narx — «Dona narxi» («Дона сўм») (Snabjeniye belgilagan; bo'lmasa o'rtacha tannarx, «≈»). Qoldiq — tanlangan sklad bo'yicha.
 */
export default async function NewRasxodPage({ searchParams }: { searchParams: Promise<{ to?: string; copy?: string; kat?: string }> }) {
  const s = await requireRoles(["WAREHOUSE", "PROCUREMENT"], { module: "stock", actions: ["issue"] });
  // Rol mos, lekin direktor bu amalni olib qo'ygan bo'lsa — forma ochilmaydi (saqlashda baribir rad bo'lardi)
  if (!canDo(s, "stock", "issue")) redirect("/stock/rasxod");
  const sp = await searchParams;

  const [warehouses, baseTargets, hints, materials, groups, sums, avg, holdings, vehicles] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    issueTargetOptions(),
    issueHints(),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, groupId: true, unitPrice: true, category: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    db.stockMove.groupBy({ by: ["warehouseId", "materialId", "type"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    avgUnitCosts(),
    holdingsOverview(),
    // O'z parkimiz (ko'chadan yollanganlarsiz) — avto zapchast shularga beriladi
    db.vehicle.findMany({ where: { isActive: true, external: false }, orderBy: { plate: "asc" }, select: { id: true, plate: true, brand: true, model: true } }),
  ]);
  const allTargets: TargetGroups = {
    ...baseTargets,
    vehicles: vehicles.map((v) => ({ id: v.id, plate: v.plate, label: [v.plate, [v.brand, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") })),
  };
  // Qoldiq — barcha harakatlar yig'indisi; «Kirim» / «Chiqim» — nom tanlashda ko'rsatish uchun (shu sklad, butun davr):
  // kirim = RECEIPT, chiqim = oluvchi/xodimga (ISSUE) + brigadaga (BRIGADE_ISSUE − BRIGADE_RETURN), stornolar ichida netlanadi
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const balances: Record<string, Record<string, number>> = {};
  const flows: Record<string, Record<string, { received: number; issued: number }>> = {};
  for (const x of sums) {
    if (!x.materialId) continue;
    const q = Number(x._sum.qty ?? 0);
    const b = (balances[x.warehouseId] ??= {});
    b[x.materialId] = r3((b[x.materialId] ?? 0) + q);
    const f = ((flows[x.warehouseId] ??= {})[x.materialId] ??= { received: 0, issued: 0 });
    if (x.type === "RECEIPT") f.received = r3(f.received + q);
    else if (x.type === "ISSUE" || x.type === "BRIGADE_ISSUE" || x.type === "BRIGADE_RETURN") f.issued = r3(f.issued - q);
  }
  for (const b of Object.values(balances)) for (const [id, q] of Object.entries(b)) if (Math.abs(q) < 0.0005) delete b[id];
  // «Tuzatish» / nusxa: ?copy=<ref> (chiqim hujjati — UUID)
  const copyRef = sp.copy && /^[A-Za-z0-9_-]{1,64}$/.test(sp.copy) ? sp.copy : null;
  const copy = copyRef ? await loadCopy(copyRef, new Set(materials.map((m) => m.id)), allTargets) : null;
  // «Kimga» ro'yxatida xodimlar ko'rsatilmaydi — faqat brigadalar va oluvchilar (Tez tanlash va ?to=e: ham tushib qoladi);
  // nusxadagi xodim bundan mustasno — tanlangan holda ko'rinsin
  const targets = { ...allTargets, employees: copy?.employee ? [copy.employee] : [] };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);
  // Bekor qilingan hujjat sanasi 31 kundan eski bo'lsa — faqat shu sana qo'shimcha ochiladi (server ham `copyOf` bo'yicha tekshiradi)
  const copyDay = copy?.initial.copyOf ? new Date(copy.date) : null;
  if (copyDay) copyDay.setHours(0, 0, 0, 0);
  const minDate = copyDay && copyDay < min ? copyDay : min;
  // Bekor qilinmagan hujjat nusxasida eski sana 31 kunlik oynadan tashqarida bo'lsa — bugungi sana
  if (copy && !copy.initial.copyOf && copy.initial.date < isoDate(min)) copy.initial.date = isoDate(today);
  // ?to=b:<id> | e:<id> | r:<id> (oluvchi kartasidan «Shu oluvchiga chiqim») — faqat ro'yxatda bor bo'lsa
  const t = parseIssueTarget(sp.to);
  const known = t && targetList(targets, t.kind).some((x) => x.id === t.id);
  const defaultTo = known ? sp.to! : "";

  return (
    <div>
      <PageHeader back={{ href: "/stock/rasxod", label: "Chiqim" }} title={copy?.cancelled ? "Tuzatish: yangi chiqim" : "Yangi chiqim"}
        info="Skladdan xomashyo berish. Qoldiq darhol kamayadi; narx — ta'minot belgilagan «Dona narxi»." />
      {copy && (
        <div className="mb-4">
          <Callout tone={copy.cancelled ? "warning" : "info"} title={copy.cancelled ? `${dateRu(copy.date)} sanadagi chiqim bekor qilingan` : `${dateRu(copy.date)} sanadagi chiqimdan nusxa`}>
            {copy.cancelled
              ? "Forma eski chiqim qatorlari bilan to'ldirildi, xomashyo skladga qaytgan. Xatoni to'g'rilab, «Chiqimni yozish» ni bosing — yangi chiqim yoziladi. Yozmasangiz, bu chiqim umuman qolmaydi."
              : "Forma eski chiqim qatorlari bilan to'ldirildi. Yozilsa — yangi, alohida chiqim bo'ladi; eskisi o'zgarmaydi."}
            {copy.targetLost && <div className="mt-1 font-medium">Eski «Kimga» ro&apos;yxatda yo&apos;q (nofaol) — qaytadan tanlang.</div>}
            {copy.skipped.length > 0 && <div className="mt-1 font-medium">{`Yopilgan xomashyo qatorlari tushirilmadi: ${copy.skipped.join(", ")}`}</div>}
          </Callout>
        </div>
      )}
      {warehouses.length === 0 ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <Card>
          <RasxodForm
            warehouses={warehouses}
            targets={targets}
            hints={hints}
            materials={materials.map((m) => {
              const own = m.unitPrice == null ? null : Number(m.unitPrice);
              const fallback = avg.get(m.id) ?? null;
              return { id: m.id, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId, category: m.category, price: own ?? fallback, approx: own == null && fallback != null };
            })}
            groups={groups}
            categories={categoriesFor(s.role)}
            defaultCategory={categoryFromSlug(sp.kat) ?? (copy?.initial.to.startsWith("v:") || defaultTo.startsWith("v:") ? "AVTO_ZAPCHAST" : null)}
            balances={balances}
            flows={flows}
            holdings={holdings}
            clientToken={crypto.randomUUID()}
            today={isoDate(today)}
            minDate={isoDate(minDate)}
            defaultTo={defaultTo}
            initial={copy?.initial}
          />
        </Card>
      )}
      <div className="mt-6"><HoldingsPanel holdings={holdings} collapsible /></div>
    </div>
  );
}
