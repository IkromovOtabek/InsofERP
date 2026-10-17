import { notFound } from "next/navigation";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { surveyResults, surveyToText } from "@/lib/hr/voice";
import { Badge, Card, CardHeader, Empty, PageHeader, Progress, StatCard } from "@/components/ui";
import { SurveyForm, SurveyStatusButtons } from "../../hr4-forms";

/** So'rovnoma: natijalar (NPS, o'rtacha baho, variantlar, matnli javoblar), ochish / yopish, tahrir (javobsizida). */
export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("/otdel-kadr");
  const s = await requireRoles(["HR"], { module: "employees" });
  const { id } = await params;
  const r = await surveyResults(id);
  if (!r) notFound();
  const editable = canDo(s, "employees", "voice", ["HR"]);
  const sv = r.survey;
  const target = await db.employee.count({ where: { isActive: true, userId: { not: null }, ...(sv.position ? { position: { equals: sv.position, mode: "insensitive" } } : {}) } });
  const positions = [...new Set((await db.employee.findMany({ where: { isActive: true }, select: { position: true } })).map((e) => e.position))].sort();
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/otdel-kadr?tab=sorovnoma", label: "So'rovnomalar" }} eyebrow={sv.anonymous ? "Anonim so'rovnoma" : "So'rovnoma"} title={sv.title} subtitle={sv.description ?? undefined}
        action={<Badge color={sv.status === "OPEN" ? "green" : "slate"}>{sv.status === "OPEN" ? "Ochiq" : sv.status === "DRAFT" ? "Qoralama" : "Yopilgan"}</Badge>} />
      {editable && <SurveyStatusButtons id={sv.id} status={sv.status} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Javob berdi" value={`${r.total} / ${target}`} hint={target ? `${Math.round((r.total / target) * 100)}%` : undefined} />
        <StatCard label="Ochilgan" value={sv.openedAt ? dateTime(sv.openedAt) : "—"} />
        <StatCard label="Yopiladi" value={sv.closesAt ? dateTime(sv.closesAt) : "—"} />
      </div>
      {r.results.map((x) => (
        <Card key={x.q.key}>
          <CardHeader title={x.q.text} description={`${x.count} javob`} />
          {"nps" in x && (x.nps == null ? <Empty text="Javob yo'q" /> : (
            <div className="space-y-1 text-sm">
              <div className="text-2xl font-semibold">{`NPS ${x.nps}`}</div>
              <div className="text-slate-600">O&apos;rtacha {x.avg} / 10 · tavsiya qiladi (9–10): {x.pro} · tanqidchi (0–6): {x.det}</div>
            </div>
          ))}
          {"avg" in x && !("nps" in x) && (x.avg == null ? <Empty text="Javob yo'q" /> : <div className="space-y-1"><div className="text-2xl font-semibold">{x.avg} / 5</div><Progress value={x.avg} max={5} tone={x.avg >= 4 ? "success" : x.avg >= 3 ? "warning" : "danger"} /></div>)}
          {"dist" in x && <div className="space-y-2">{x.dist!.map((d) => <div key={d.option}><div className="flex justify-between text-sm"><span>{d.option}</span><span className="tabular">{d.n}</span></div><Progress value={d.n} max={Math.max(1, x.count)} /></div>)}</div>}
          {"texts" in x && (x.texts!.length === 0 ? <Empty text="Javob yo'q" /> : <ul className="space-y-2">{x.texts!.map((t, i) => <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{t.text}{t.who && <div className="text-xs text-slate-500">{t.who}</div>}</li>)}</ul>)}
        </Card>
      ))}
      {editable && r.total === 0 && sv.status !== "CLOSED" && (
        <Card><CardHeader title="Tahrirlash" /><SurveyForm positions={positions} s={{ id: sv.id, title: sv.title, description: sv.description, anonymous: sv.anonymous, position: sv.position, text: surveyToText(sv.questions), closesAt: sv.closesAt ? sv.closesAt.toISOString().slice(0, 10) : null }} /></Card>
      )}
    </div>
  );
}
