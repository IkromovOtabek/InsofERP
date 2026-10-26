import { FolderTree, HelpCircle, Layers } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { loadCategories, makeResolver, toTree, FLOW_LABEL, NEEDS_LABEL, PNL_LINE_LABEL } from "@/lib/fin-report/categories";
import { Badge, Card, CardHeader, Empty, PageHeader, Section, Table, Td, Th, Tr } from "@/components/ui";
import { MoliyaTabs } from "../moliya-tabs";
import { AliasForm, CategoryCreateForm, CategoryEditForm, ProjectCreateForm, ProjectToggle, type CatView } from "./forms";

/**
 * Kirim-Chiqim kategoriyalari daraxti (Manba → Sub manba): har manbaning pul oqimi turi (DDS) va PNL qatori.
 * Kassa yozuvi kategoriyaga NOM bo'yicha bog'langani uchun nomi o'zgarsa eski nom alias bo'lib qoladi.
 * «Topilmagan nomlar» — daraxtda yo'q kategoriya bilan yozilgan kassa yozuvlari: PNL'da «Manbasi aniqlanmagan».
 */
export default async function CategoriesPage() {
  const s = await requirePage("/moliya/kategoriyalar");
  const canWrite = canDo(s, "moliya", "categories");
  const [nodes, used, projects] = await Promise.all([
    loadCategories(),
    db.cashTransaction.groupBy({ by: ["category", "type"], where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] } }, _count: { _all: true }, _sum: { amount: true } }),
    db.project.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { _count: { select: { transactions: true } } } }),
  ]);
  const resolve = makeResolver(nodes);
  const unknown = used.filter((u) => !resolve(u.category)).sort((a, b) => Number(b._sum.amount ?? 0) - Number(a._sum.amount ?? 0));
  const usage = new Map<string, number>();
  for (const u of used) { const r = resolve(u.category); if (r) usage.set(r.top.id, (usage.get(r.top.id) ?? 0) + u._count._all); }

  const view = (c: (typeof nodes)[number]): CatView => ({ id: c.id, name: c.name, type: c.type as "INCOME" | "EXPENSE", parentId: c.parentId, flow: c.flow, pnlLine: c.pnlLine, needs: c.needs, loanPart: c.loanPart, aliases: c.aliases, isSystem: c.isSystem, isActive: c.isActive });
  const parents = toTree(nodes).map((t) => ({ id: t.id, label: `${t.type === "INCOME" ? "Kirim" : "Chiqim"} · ${t.name}` }));
  const aliasTargets = nodes.map((n) => ({ id: n.id, label: `${n.type === "INCOME" ? "Kirim" : "Chiqim"} · ${n.parentId ? `${nodes.find((p) => p.id === n.parentId)?.name} / ` : ""}${n.name}` }));

  const block = (type: "EXPENSE" | "INCOME") => (
    <Table>
      <thead><tr><Th>Manba / Sub manba</Th><Th>Pul oqimi (DDS)</Th><Th>PNL qatori</Th><Th>So&apos;raydi</Th><Th right>Yozuvlar</Th>{canWrite && <Th />}</tr></thead>
      <tbody>
        {toTree(nodes, { type }).flatMap((t) => [
          <Tr key={t.id} className={t.isActive ? undefined : "opacity-60"}>
            <Td>
              {t.name}{t.isSystem && <> <Badge color="slate" dot={false}>tizim</Badge></>}{!t.isActive && <> <Badge color="red">nofaol</Badge></>}
              {t.aliases.length > 0 && <div className="text-[12px] font-normal text-slate-400">alias: {t.aliases.join(", ")}</div>}
            </Td>
            <Td><Badge color={t.flow === "OPERATING" ? "green" : t.flow === "FINANCING" ? "violet" : "blue"}>{FLOW_LABEL[t.flow]}</Badge></Td>
            <Td className="text-slate-600">{PNL_LINE_LABEL[t.pnlLine]}</Td>
            <Td className="text-slate-500">{t.needs ? `${NEEDS_LABEL[t.needs]}${t.loanPart ? (t.loanPart === "INTEREST" ? " · foiz" : " · asosiy qarz") : ""}` : "—"}</Td>
            <Td right className="text-slate-500">{fmtNum(usage.get(t.id) ?? 0)}</Td>
            {canWrite && <Td right><CategoryEditForm c={view(t)} /></Td>}
          </Tr>,
          ...t.children.map((c) => (
            <Tr key={c.id} className={c.isActive ? undefined : "opacity-60"}>
              <Td className="pl-10 font-normal text-slate-700">{c.name}{!c.isActive && <> <Badge color="red">nofaol</Badge></>}{c.aliases.length > 0 && <div className="text-[12px] text-slate-400">alias: {c.aliases.join(", ")}</div>}</Td>
              <Td className="text-[13px] text-slate-400">manbadan</Td>
              <Td className="text-[13px] text-slate-400">manbadan</Td>
              <Td />
              <Td />
              {canWrite && <Td right><CategoryEditForm c={view(c)} /></Td>}
            </Tr>
          )),
        ])}
      </tbody>
    </Table>
  );

  return (
    <div>
      <PageHeader eyebrow="Moliya" title="Kategoriyalar va loyihalar" subtitle="Kirim-Chiqim manbalari: qaysi biri PNL'ning qaysi qatoriga va pul oqimining qaysi turiga tushadi" />
      <MoliyaTabs current="/moliya/kategoriyalar" />

      {unknown.length > 0 && (
        <Section title="Topilmagan nomlar">
          <p className="mb-3 text-[13px] text-slate-500">Bu nomlar bilan yozilgan kassa yozuvlari hisobotlarda «Manbasi aniqlanmagan» qatoriga tushyapti. Har birini to&apos;g&apos;ri kategoriyaga biriktiring.</p>
          <Table>
            <thead><tr><Th>Yozuvdagi nom</Th><Th>Turi</Th><Th right>Yozuvlar</Th><Th right>Summa</Th>{canWrite && <Th />}</tr></thead>
            <tbody>
              {unknown.map((u) => (
                <Tr key={`${u.category}:${u.type}`}>
                  <Td><HelpCircle size={14} className="mr-1 inline text-amber-500" />{u.category}</Td>
                  <Td>{u.type === "INCOME" ? "Kirim" : "Chiqim"}</Td>
                  <Td right>{u._count._all}</Td>
                  <Td right>{fmtNum(Number(u._sum.amount ?? 0))}</Td>
                  {canWrite && <Td right><AliasForm alias={u.category} options={aliasTargets.filter((o) => o.label.startsWith(u.type === "INCOME" ? "Kirim" : "Chiqim"))} /></Td>}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title="Chiqim manbalari">{block("EXPENSE")}</Section>
      <Section title="Kirim manbalari">{block("INCOME")}</Section>

      <Section title="Loyihalar">
        <p className="mb-3 text-[13px] text-slate-500">Zavoddan tashqari yo&apos;nalishlar. «Loyihalar» kategoriyasi bilan yozilgan chiqim PNL&apos;da zavod sof foydasidan keyin, alohida qatorda chiqadi.</p>
        <Table>
          <thead><tr><Th>Loyiha</Th><Th>Izoh</Th><Th right>Kassa yozuvlari</Th><Th>Holati</Th>{canWrite && <Th />}</tr></thead>
          <tbody>
            {projects.length === 0 && <Empty text="Loyiha qo'shilmagan" icon={Layers} />}
            {projects.map((p) => (
              <Tr key={p.id}>
                <Td>{p.name}</Td>
                <Td className="text-slate-500">{p.note ?? "—"}</Td>
                <Td right>{p._count.transactions}</Td>
                <Td>{p.isActive ? <Badge color="green">faol</Badge> : <Badge color="slate">yopilgan</Badge>}</Td>
                {canWrite && <Td right><ProjectToggle id={p.id} isActive={p.isActive} /></Td>}
              </Tr>
            ))}
          </tbody>
        </Table>
        {canWrite && <div className="mt-4"><ProjectCreateForm /></div>}
      </Section>

      {canWrite && (
        <div className="mt-8">
          <Card>
            <CardHeader title="Yangi manba yoki sub manba" icon={FolderTree} description="Sub manba — manba ichidagi tafsilot (masalan Transport → Yoqilg'i); u manbaning oqim turi va PNL qatorini oladi" />
            <CategoryCreateForm parents={parents} />
          </Card>
        </div>
      )}
    </div>
  );
}
