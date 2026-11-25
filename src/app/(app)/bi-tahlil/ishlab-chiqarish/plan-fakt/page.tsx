import Link from "next/link";
import { Factory, PackageX, Scale, Warehouse } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { materialPlanFact, type PfProduct } from "@/lib/bi/material-plan-fact";
import { fmtNum, moneyShort, pct } from "@/lib/format";
import { Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { biContext, BiPage } from "../../shell";
import { tabHref } from "../../ui";

export const dynamic = "force-dynamic";

const q3 = (v: number) => fmtNum(v, 3);
/** Farq: ortiqcha sarf qizil, tejalgan yashil; ±2% ichida — oddiy */
function Diff({ v, p, money }: { v: number | null; p?: number | null; money?: boolean }) {
  if (v === null) return <span className="text-slate-300">—</span>;
  if (Math.abs(v) < (money ? 0.5 : 0.0005)) return <span className="text-slate-300">–</span>;
  const bad = p != null ? p > 2 : v > 0, good = p != null ? p < -2 : v < 0;
  return <span className={cn("tabular", bad ? "font-semibold text-red-600" : good ? "text-emerald-700" : "")}>{v > 0 ? "+" : ""}{money ? fmtNum(v) : q3(v)}</span>;
}
function Pct({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-300">—</span>;
  return <span className={cn("rounded px-1.5 py-0.5 tabular", v > 2 ? "bg-red-50 font-semibold text-red-600" : v < -2 ? "bg-emerald-50 text-emerald-700" : "text-slate-500")}>{v > 0 ? "+" : ""}{pct(v)}</span>;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/ishlab-chiqarish/plan-fakt");
  const { sp, range } = await biContext(searchParams, "/bi-tahlil/ishlab-chiqarish/plan-fakt");
  const d = await materialPlanFact(range.from, range.to);
  const sel: PfProduct | undefined = sp.m ? d.products.find((p) => p.id === sp.m) : undefined;
  const priceNote = d.vatPayer ? "QQSsiz" : "QQS bilan";

  const sheets = [
    { name: "Xomashyo", rows: d.materials.map((m) => ({ Xomashyo: m.name, "O'lchov": m.unit, "Norma bo'yicha": m.plan, "Fakt (skladdan chiqdi)": m.fact, Farq: m.diff, "Farq, %": m.diffPct, Narx: m.price, "Norma, so'm": m.planSum, "Fakt, so'm": m.factSum, "Farq, so'm": m.diffSum })) },
    { name: "Mahsulot (1 birlik)", rows: d.products.map((p) => ({ Mahsulot: p.name, Guruh: p.group, "O'lchov": p.unit, "Ishlab chiqarildi": p.produced, "Norma (1 birlik), so'm": p.unitPlan, "Fakt (1 birlik), so'm": p.unitFact, "Farq (1 birlik), so'm": p.unitDiff, "Farq, %": p.diffPct, "Norma jami, so'm": p.totalPlan, "Fakt jami, so'm": p.totalFact })) },
    { name: "Mahsulot tarkibi", rows: d.products.flatMap((p) => p.lines.map((l) => ({ Mahsulot: p.name, Xomashyo: l.name, "O'lchov": l.unit, "Norma (1 birlik)": l.plan, "Fakt (1 birlik)": l.fact, Narx: l.price, "Norma, so'm": l.planSum, "Fakt, so'm": l.factSum }))) },
    { name: "Brigadalar", rows: d.brigades.flatMap((b) => b.lines.map((l) => ({ Brigada: b.name, Xomashyo: l.name, "O'lchov": l.unit, "Norma (chiqargani)": l.plan, "Skladdan berildi": l.issued, Farq: l.diff }))) },
  ];

  return (
    <BiPage title="Ishlab chiqarish" subtitle={`Xomashyo plan-fakt — ${range.label}`} tab="planFact" range={range} keep={{ m: sp.m }} info={<>
      <p><b>Plan (norma)</b> — davrda ishlab chiqarilgan mahsulot × faol retsept. Retsept ichidagi boshqa mahsulot (FBS ichidagi beton) jamiga qo&apos;shilmaydi — u o&apos;z zamesida hisoblangan.</p>
      <p><b>Fakt</b> — skladdan haqiqatda chiqqan xomashyo: zames + brigadaga berilgan + «Chiqim» − brigadadan qaytgan.</p>
      <p>Sklad har dona uchun alohida sarf yozmaydi: mahsulot 1 birligining fakti har xomashyoning «fakt ÷ norma» koeffitsiyenti bilan hisoblanadi. Narx — davrning o&apos;rtacha xarid narxi ({priceNote}).</p>
    </>}>
      <div className="mb-3 flex justify-end"><ExcelButton file={`Xomashyo plan-fakt ${range.label}`} sheets={sheets} /></div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Norma bo'yicha xomashyo" value={moneyShort(d.planSum)} hint={fmtNum(d.planSum)} icon={Factory} href="#xomashyo" />
        <StatCard label="Fakt — skladdan chiqdi" value={moneyShort(d.factSum)} hint={fmtNum(d.factSum)} icon={Warehouse} href="#xomashyo" />
        <StatCard label="Farq (fakt − norma)" value={moneyShort(d.diffSum)} hint={d.diffPct === null ? "ishlab chiqarish yo'q" : `normadan ${d.diffPct > 0 ? "ortiq" : "kam"} ${pct(Math.abs(d.diffPct))}`} icon={Scale} tone={d.diffPct !== null && d.diffPct > 2 ? "danger" : "default"} href="#mahsulot" />
        <StatCard label="Retseptsiz mahsulot" value={String(d.noRecipe)} hint="normasini hisoblab bo'lmaydi" icon={PackageX} tone={d.noRecipe ? "warning" : "default"} href="#mahsulot" />
      </div>

      <Section id="xomashyo" title="1. Xomashyo bo'yicha" info={<p>Norma — shu davrda ishlab chiqarilganga kerak bo&apos;lgan miqdor; fakt — skladdan chiqqani. «normada yo&apos;q» — xomashyo chiqqan, lekin uni ishlatadigan mahsulot ishlab chiqarilmagan (yoki retseptda yo&apos;q).</p>}>
        <Table maxHeight="60vh">
          <thead><tr><Th>Xomashyo</Th><Th>O&apos;lchov</Th><Th right>Norma</Th><Th right>Fakt</Th><Th right>Farq</Th><Th right>Farq, %</Th><Th right>Narx</Th><Th right>Norma, so&apos;m</Th><Th right>Fakt, so&apos;m</Th><Th right>Farq, so&apos;m</Th></tr></thead>
          <tbody>
            {d.materials.length === 0 && <Empty text="Shu davrda xomashyo sarfi va ishlab chiqarish yo'q" />}
            {d.materials.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium">{m.name}</Td>
                <Td className="text-slate-500">{m.unit}</Td>
                <Td right>{m.plan ? q3(m.plan) : <span className="text-[13px] italic text-slate-400">normada yo&apos;q</span>}</Td>
                <Td right>{q3(m.fact)}</Td>
                <Td right><Diff v={m.diff} p={m.diffPct} /></Td>
                <Td right><Pct v={m.diffPct} /></Td>
                <Td right className="text-slate-500">{fmtNum(m.price)}</Td>
                <Td right>{fmtNum(m.planSum)}</Td>
                <Td right>{fmtNum(m.factSum)}</Td>
                <Td right><Diff v={m.diffSum} p={m.diffPct} money /></Td>
              </Tr>
            ))}
            {d.materials.length > 0 && <Tr className="bg-violet-50/60 font-semibold"><Td>Jami</Td><Td /><Td /><Td /><Td /><Td right><Pct v={d.diffPct} /></Td><Td /><Td right>{fmtNum(d.planSum)}</Td><Td right>{fmtNum(d.factSum)}</Td><Td right><Diff v={d.diffSum} p={d.diffPct} money /></Td></Tr>}
          </tbody>
        </Table>
      </Section>

      <Section id="mahsulot" title="2. Mahsulot bo'yicha — 1 birlikka ketgan xomashyo" info={<p>Mahsulot nomini bossangiz, 1 birlik tarkibi (har xomashyo norma va fakt) ochiladi.</p>}>
        <Table maxHeight="60vh">
          <thead><tr><Th>Mahsulot</Th><Th>Guruh</Th><Th right>Ishlab chiqarildi</Th><Th right>Norma (1), so&apos;m</Th><Th right>Fakt (1), so&apos;m</Th><Th right>Farq (1), so&apos;m</Th><Th right>Farq, %</Th><Th right>Norma jami</Th><Th right>Fakt jami</Th></tr></thead>
          <tbody>
            {d.products.length === 0 && <Empty text="Shu davrda ishlab chiqarish yo'q" />}
            {d.products.map((p) => (
              <Tr key={p.id} className={cn(sel?.id === p.id && "bg-brand-50/60")}>
                <Td className="font-medium"><Link href={`${tabHref(range, "planFact", { m: p.id })}#tarkib`} className="hover:underline">{p.name}</Link></Td>
                <Td className="text-slate-500">{p.group}</Td>
                <Td right>{q3(p.produced)} <span className="text-slate-400">{p.unit}</span></Td>
                {p.hasRecipe ? <>
                  <Td right>{fmtNum(p.unitPlan ?? 0)}</Td>
                  <Td right>{fmtNum(p.unitFact ?? 0)}</Td>
                  <Td right><Diff v={p.unitDiff} p={p.diffPct} money /></Td>
                  <Td right><Pct v={p.diffPct} /></Td>
                  <Td right>{fmtNum(p.totalPlan ?? 0)}</Td>
                  <Td right>{fmtNum(p.totalFact ?? 0)}</Td>
                </> : <Td colSpan={6} className="text-[13px] italic text-amber-700">retsept yo&apos;q — norma hisoblanmaydi</Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      {sel && (
        <Section id="tarkib" title={`${sel.name} — 1 ${sel.unit} tarkibi`} action={<Link href={tabHref(range, "planFact")} className="text-sm text-slate-500 hover:underline">Yopish</Link>}>
          <Table>
            <thead><tr><Th>Xomashyo</Th><Th>O&apos;lchov</Th><Th right>Norma (1)</Th><Th right>Fakt (1)</Th><Th right>Farq</Th><Th right>Narx</Th><Th right>Norma, so&apos;m</Th><Th right>Fakt, so&apos;m</Th></tr></thead>
            <tbody>
              {sel.lines.length === 0 && <Empty text="Retseptda xomashyo yo'q" />}
              {sel.lines.map((l) => (
                <Tr key={l.materialId}>
                  <Td>{l.name}</Td>
                  <Td className="text-slate-500">{l.unit}</Td>
                  <Td right>{q3(l.plan)}</Td>
                  <Td right>{l.fact === null ? <span className="text-[13px] italic text-slate-400">norma (sarf yo&apos;q)</span> : q3(l.fact)}</Td>
                  <Td right><Diff v={l.fact === null ? null : l.fact - l.plan} p={l.fact === null || !l.plan ? null : ((l.fact - l.plan) / l.plan) * 100} /></Td>
                  <Td right className="text-slate-500">{fmtNum(l.price)}</Td>
                  <Td right>{fmtNum(l.planSum)}</Td>
                  <Td right>{l.factSum === null ? "—" : fmtNum(l.factSum)}</Td>
                </Tr>
              ))}
              {sel.lines.length > 0 && <Tr className="bg-violet-50/60 font-semibold"><Td>Jami 1 {sel.unit}</Td><Td /><Td /><Td /><Td /><Td /><Td right>{fmtNum(sel.unitPlan ?? 0)}</Td><Td right>{fmtNum(sel.unitFact ?? 0)}</Td></Tr>}
            </tbody>
          </Table>
        </Section>
      )}

      <Section id="brigada" title="3. Brigada bo'yicha" info={<p>Brigadaga skladdan berilgan xomashyo (− qaytgani) va shu brigada chiqargan mahsulot normasi. Brigada qo&apos;lida qolgan ishlatilmagan xomashyo «ortiqcha» bo&apos;lib ko&apos;rinadi.</p>}>
        <Table maxHeight="60vh">
          <thead><tr><Th>Brigada</Th><Th>Chiqargani</Th><Th right>Norma, so&apos;m</Th><Th right>Berildi, so&apos;m</Th><Th right>Farq, so&apos;m</Th><Th right>Farq, %</Th></tr></thead>
          <tbody>
            {d.brigades.length === 0 && <Empty text="Shu davrda brigadalarga berish va brigada ishi yo'q" />}
            {d.brigades.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium">
                  <details>
                    <summary className="cursor-pointer">{b.name}</summary>
                    <div className="mt-2 space-y-0.5 text-[13px] font-normal text-slate-600">
                      {b.lines.map((l) => <div key={l.materialId}>{l.name}: norma {q3(l.plan)}, berildi {q3(l.issued)} {l.unit} (<Diff v={l.diff} p={l.plan ? (l.diff / l.plan) * 100 : null} />)</div>)}
                    </div>
                  </details>
                </Td>
                <Td className="max-w-md text-[13px] text-slate-500">{b.output || "—"}</Td>
                <Td right>{fmtNum(b.planSum)}</Td>
                <Td right>{fmtNum(b.issuedSum)}</Td>
                <Td right><Diff v={b.diffSum} p={b.diffPct} money /></Td>
                <Td right><Pct v={b.diffPct} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </BiPage>
  );
}
