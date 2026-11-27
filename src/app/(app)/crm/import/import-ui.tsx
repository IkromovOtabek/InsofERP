"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Button, Callout, Card, CardHeader, Field, FormError, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import type { ImportReport } from "@/lib/crm/import/plan";
import type { AmoDiscovery } from "@/lib/crm/import/amo";
import { amoDiscover, importAmo, importSheets, type ImportResult } from "./actions";

type Opt = { id: string; label: string };

/** Quruq ishga tushirish / import natijasi */
function Report({ r }: { r: ImportReport }) {
  return (
    <Card className="mt-4">
      <CardHeader title={r.dryRun ? "Tekshiruv hisoboti (hali yozilmadi)" : "Import bajarildi"} icon={r.dryRun ? Info : CheckCircle2} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Yangi mijoz", r.clientsNew], ["Mavjud kartaga", r.clientsMatched], ["Yangi aloqa", r.contactsNew], ["Avval import qilingan", r.contactsExisting]].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-xl font-bold tabular text-slate-900">{v}</div></div>
        ))}
      </div>
      {r.errors.length > 0 && <List icon={XCircle} tone="text-red-700" title="Xatolar — import qilinmaydi" items={r.errors} />}
      {r.warnings.length > 0 && <List icon={AlertTriangle} tone="text-amber-700" title="Ogohlantirishlar" items={r.warnings} />}
      {r.newOptions.length > 0 && <List icon={Info} tone="text-blue-700" title="Ro'yxatga yangi qiymatlar qo'shiladi" items={r.newOptions} />}
      {r.info.length > 0 && <List icon={Info} tone="text-slate-600" title="Ma'lumot" items={r.info} />}
      {r.sample.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-sm font-medium text-slate-700">Namuna (birinchi {r.sample.length} ta mijoz)</div>
          <Table>
            <thead><tr><Th>Nomi</Th><Th>Telefon</Th><Th>Manba</Th><Th>Mavjud kartaga</Th></tr></thead>
            <tbody>{r.sample.map((s, i) => <Tr key={i}><Td>{s.name}</Td><Td>{s.phone ?? "—"}</Td><Td>{s.source ?? "—"}</Td><Td>{s.match ?? "yangi"}</Td></Tr>)}</tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
function List({ icon: Icon, tone, title, items }: { icon: typeof Info; tone: string; title: string; items: string[] }) {
  return (
    <div className="mb-3">
      <div className={`mb-1 flex items-center gap-1.5 text-sm font-semibold ${tone}`}><Icon size={15} /> {title}</div>
      <ul className="ml-5 list-disc space-y-0.5 text-sm text-slate-700">{items.map((x, i) => <li key={i} className="break-words">{x}</li>)}</ul>
    </div>
  );
}

export function SheetsImport() {
  const form = useRef<HTMLFormElement>(null);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const run = (commit: boolean) => {
    if (!form.current) return;
    const fd = new FormData(form.current);
    if (commit) fd.set("commit", "1");
    start(async () => setRes(await importSheets(fd)));
  };
  const report = res?.ok ? res.report : null;
  return (
    <>
      <Card>
        <CardHeader title="«Mijozlar bazasi» fayli" description="Google Sheets → Fayl → Yuklab olish → Microsoft Excel (.xlsx). Yoki uchta varaqni CSV qilib: Mijozlar, Aloqalar, Zayafkalar" />
        <form ref={form} onSubmit={(e) => { e.preventDefault(); run(false); }} className="grid gap-4">
          <Field label="Fayl(lar)">
            <Input type="file" name="files" accept=".xlsx,.xls,.csv" multiple required onChange={() => setRes(null)} />
          </Field>
          <Callout tone="info">Ustunlar sarlavha nomi bo'yicha moslanadi. Sanalar dd.mm.yyyy, telefonlar har xil yozilgan bo'lsa ham +998XXXXXXXXX ga keltiriladi. «Tender sayti» manbasi — tender.mc.uz. Hisoblanadigan ustunlar (Oxirgi aloqa, Faollik…) olinmaydi.</Callout>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Tekshirilmoqda…" : "Tekshirish (quruq ishga tushirish)"}</Button>
            {report?.dryRun && report.errors.length === 0 && <Button type="button" disabled={pending} onClick={() => run(true)}>Import qilish</Button>}
          </div>
        </form>
        {res && !res.ok && <div className="mt-3"><FormError error={res.error} /></div>}
      </Card>
      {report && <Report r={report} />}
    </>
  );
}

export function AmoImport({ sources, results, users }: { sources: Opt[]; results: Opt[]; users: Opt[] }) {
  const [domain, setDomain] = useState("insofuz.amocrm.ru");
  const [token, setToken] = useState("");
  const [disc, setDisc] = useState<AmoDiscovery | null>(null);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [umap, setUmap] = useState<Record<string, string>>({});
  const [sourceId, setSourceId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, start] = useTransition();

  const discover = () => start(async () => {
    setErr(null); setReport(null);
    const r = await amoDiscover(domain, token);
    if (!r.ok) { setErr(r.error); return; }
    setDisc(r.data);
    setStages(Object.fromEntries(r.data.stages.map((s) => [String(s.id), s.guess])));
    setUmap(Object.fromEntries(r.data.users.map((u) => [String(u.id), u.guess])));
  });
  const run = (commit: boolean) => start(async () => {
    setErr(null);
    const r = await importAmo(domain, token, { stages, users: umap, sourceId }, commit);
    if (!r.ok) { setErr(r.error); return; }
    setReport(r.report);
  });

  return (
    <>
      <Card>
        <CardHeader title="amoCRM ulanishi" description="amoCRM → Sozlamalar → Integratsiyalar → «Integratsiya yaratish» → Kalitlar → uzoq muddatli token. Token faqat shu import uchun ishlatiladi, saqlanmaydi" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="amoCRM manzili"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="insofuz.amocrm.ru" /></Field>
          <Field label="Uzoq muddatli token"><Input type="password" autoComplete="off" value={token} onChange={(e) => { setToken(e.target.value); setDisc(null); setReport(null); }} /></Field>
        </div>
        <div className="mt-4"><Button type="button" variant="secondary" disabled={pending || !token} onClick={discover}>{pending && !disc ? "Ulanmoqda…" : "Bosqich va xodimlarni olish"}</Button></div>
        {err && <div className="mt-3"><FormError error={err} /></div>}
      </Card>

      {disc && (
        <Card className="mt-4">
          <CardHeader title="Moslash" description={`${disc.leads} ta sdelka. Har bosqich qaysi natija bo'lib yozilsin; xodimlar kimga biriktirilsin`} />
          <Field label="Manba (sdelka teglarida Facebook/Instagram yoki «Входящий» bo'lmasa)" className="mb-4 max-w-md">
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">— tanlang —</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Table>
            <thead><tr><Th>Voronka · bosqich</Th><Th right>Sdelka</Th><Th>CRM natijasi</Th></tr></thead>
            <tbody>{disc.stages.map((s) => (
              <Tr key={s.id}>
                <Td>{s.pipeline} · <b>{s.name}</b></Td><Td right>{s.count}</Td>
                <Td><Select aria-label={s.name} value={stages[String(s.id)] ?? ""} onChange={(e) => setStages({ ...stages, [String(s.id)]: e.target.value })}>
                  <option value="">— natijasiz (faqat 1-bosqich) —</option>
                  {results.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select></Td>
              </Tr>
            ))}</tbody>
          </Table>
          <div className="mt-4">
            <Table>
              <thead><tr><Th>amoCRM xodimi</Th><Th right>Sdelka</Th><Th>ERP xodimi</Th></tr></thead>
              <tbody>{disc.users.map((u) => (
                <Tr key={u.id}>
                  <Td>{u.name}</Td><Td right>{u.count}</Td>
                  <Td><Select aria-label={u.name} value={umap[String(u.id)] ?? ""} onChange={(e) => setUmap({ ...umap, [String(u.id)]: e.target.value })}>
                    <option value="">— import qiluvchi —</option>
                    {users.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </Select></Td>
                </Tr>
              ))}</tbody>
            </Table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={pending || !sourceId} onClick={() => run(false)}>{pending ? "Tekshirilmoqda…" : "Tekshirish (quruq ishga tushirish)"}</Button>
            {report?.dryRun && report.errors.length === 0 && <Button type="button" disabled={pending} onClick={() => run(true)}>Import qilish</Button>}
          </div>
        </Card>
      )}
      {report && <Report r={report} />}
    </>
  );
}
