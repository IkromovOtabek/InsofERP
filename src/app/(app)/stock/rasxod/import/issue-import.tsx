"use client";

import { useMemo, useState } from "react";
import { CalendarRange, FileSpreadsheet, FileUp, PackageMinus, Rows3, Users } from "lucide-react";
import { Badge, Button, Callout, Field, LinkButton, Progress, Select, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { JournalTemplateButton } from "@/components/journal-template";
import { dateRu, fmtNum, isoDate } from "@/lib/format";
import { groupIssueJournal, parseIssueJournal, type IssueJournalDoc } from "@/lib/issue-journal";
import { matchTarget, normTargetName, type TargetGroups } from "@/lib/issue-target";
import type { JournalIssue } from "@/lib/prixod-journal";
import type { IssueChunkResult } from "@/lib/issue-journal-import";
import { importIssueChunk } from "./actions";

/** Bir so'rovda yuboriladigan hujjatlar soni (server chegarasi — 40). */
const CHUNK = 25;
const SHOWN = 150;

const day = (iso: string) => dateRu(new Date(`${iso}T00:00:00`));
const payLabel = (p: "BANK" | "CASH" | null) => (p === "BANK" ? "P-r" : p === "CASH" ? "n-q" : "—");
const KIND = { brigade: "Brigada", employee: "Xodim", recipient: "Oluvchi" } as const;

type Parsed = { file: string; docs: IssueJournalDoc[]; errors: JournalIssue[]; warnings: JournalIssue[]; newRecipients: string[]; unknownMaterials: string[] };

function Issues({ title, tone, items }: { title: string; tone: "danger" | "warning"; items: JournalIssue[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const list = all ? items : items.slice(0, 8);
  return (
    <Callout tone={tone} title={`${title}: ${fmtNum(items.length)}`}>
      <ul className="mt-1 space-y-0.5">{list.map((x, i) => <li key={i}><span className="tabular text-slate-500">{x.line}-qator:</span> {x.text}</li>)}</ul>
      {items.length > list.length && <button type="button" className="mt-1 font-medium underline" onClick={() => setAll(true)}>Hammasini ko&apos;rsatish</button>}
    </Callout>
  );
}

export function IssueImport({ warehouses, targets, materials }: {
  warehouses: { id: string; name: string }[];
  targets: TargetGroups;
  /** Bazadagi xomashyo nomlari (kichik harf) — topilmaganlarini oldindan ko'rsatish uchun */
  materials: string[];
}) {
  const [data, setData] = useState<Parsed | null>(null);
  const [readError, setReadError] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<(IssueChunkResult & { stopped?: string }) | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setReadError(""); setData(null); setResult(null); setDone(0);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]!];
      if (!ws) throw new Error("Faylda varaq yo'q");
      const p = parseIssueJournal(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true }), isoDate());
      if (p.missing.length) { setReadError(`Ustun topilmadi: ${p.missing.join(", ")}. Birinchi qatorda sarlavhalar bo'lsin.`); return; }
      if (!p.rows.length) { setReadError(p.errors.length ? `Saqlanadigan qator yo'q: ${p.errors.slice(0, 3).map((x) => `${x.line}-qator — ${x.text}`).join("; ")}` : "Faylda chiqim qatori topilmadi"); return; }
      const known = new Set(materials);
      setData({
        file: f.name, docs: groupIssueJournal(p.rows), errors: p.errors, warnings: p.warnings,
        newRecipients: [...new Map(p.rows.filter((r) => !matchTarget(targets, r.recipient)).map((r) => [normTargetName(r.recipient), r.recipient])).values()],
        unknownMaterials: [...new Set(p.rows.filter((r) => !known.has(r.material.toLowerCase())).map((r) => r.material))],
      });
    } catch (e) {
      setReadError(e instanceof Error ? `Fayl o'qilmadi: ${e.message}` : "Fayl o'qilmadi");
    }
  }

  const stats = useMemo(() => {
    if (!data) return null;
    const dates = data.docs.map((d) => d.date);
    return {
      rows: data.docs.reduce((s, d) => s + d.rows.length, 0),
      from: dates[0]!, to: dates[dates.length - 1]!,
      recipients: new Set(data.docs.map((d) => normTargetName(d.recipient))).size,
      badDocs: data.docs.filter((d) => d.rows.some((r) => data.unknownMaterials.includes(r.material))).length,
    };
  }, [data]);

  async function save() {
    if (!data || busy) return;
    setBusy(true); setDone(0);
    const acc: IssueChunkResult & { stopped?: string } = { created: 0, existed: 0, failed: [] };
    for (let i = 0; i < data.docs.length; i += CHUNK) {
      const part = data.docs.slice(i, i + CHUNK);
      try {
        const r = await importIssueChunk({ warehouseId, docs: part });
        if (r.error) { acc.stopped = r.error; break; }
        acc.created += r.created; acc.existed += r.existed; acc.failed.push(...r.failed);
      } catch {
        acc.stopped = "Server bilan aloqa uzildi. Faylni qayta yuklab saqlang — saqlanganlari takrorlanmaydi.";
        break;
      }
      setDone(Math.min(data.docs.length, i + part.length));
    }
    setResult(acc);
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
          <FileUp size={16} /> Excel faylni tanlash
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <JournalTemplateButton file="chiqim-namuna" example={{ "Sana": isoDate().split("-").reverse().join("."), "Tovar": "Sement M400", "O'lchov": "t", "Miqdor": 2, "Kimga": "Brigada 1 — Ilxom", "Izoh": "ustun uchun" }} />
        <span className="text-sm text-slate-500">{data?.file ?? "Ustunlar Kirim bilan bir xil. Chiqimga Sana, Tovar, O'lchov, Miqdor, Kimga olinadi; TTN, Manzil, Izoh, Ta'minotchi — izohga. Narx skladdan."}</span>
      </div>
      {readError && <Callout tone="danger">{readError}</Callout>}

      {data && stats && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Chiqim hujjatlari" value={fmtNum(data.docs.length)} hint="sana + kimga bo'yicha" icon={FileSpreadsheet} />
            <StatCard label="Qatorlar" value={fmtNum(stats.rows)} icon={Rows3} />
            <StatCard label="Davr" value={<span className="text-base">{day(stats.from)} – {day(stats.to)}</span>} icon={CalendarRange} />
            <StatCard label="Kimga" value={fmtNum(stats.recipients)} hint={data.newRecipients.length ? `${fmtNum(data.newRecipients.length)} tasi yangi oluvchi bo'ladi` : "hammasi tizimda bor"} icon={Users} />
          </div>

          {data.unknownMaterials.length > 0 && (
            <Callout tone="danger" title={`Spravochnikda yo'q tovarlar: ${fmtNum(data.unknownMaterials.length)}`}>
              {`Bu tovarlar bor ${fmtNum(stats.badDocs)} ta chiqim saqlanmaydi (skladda yo'q narsani berib bo'lmaydi). Nomini Sklad → Xomashyo'dagi bilan bir xil yozing yoki avval kirim qiling: `}
              {data.unknownMaterials.slice(0, 30).join(", ")}{data.unknownMaterials.length > 30 ? "…" : ""}
            </Callout>
          )}
          {data.newRecipients.length > 0 && (
            <Callout tone="info" title={`Yangi oluvchilar: ${fmtNum(data.newRecipients.length)}`}>
              Brigada, xodim va oluvchilar orasida topilmadi — «Kimga» ro&apos;yxatiga yangi oluvchi bo&apos;lib qo&apos;shiladi.
              Brigada yoki xodim bo&apos;lsa, nomini tizimdagidek yozing.
              <div className="mt-1 text-slate-600">{data.newRecipients.slice(0, 30).join(", ")}</div>
            </Callout>
          )}
          <Issues title="Saqlanmaydigan qatorlar (faylni tuzatib qayta yuklang)" tone="danger" items={data.errors} />
          <Issues title="Ogohlantirishlar" tone="warning" items={data.warnings} />

          <Table maxHeight={480}>
            <thead><Tr><Th>Sana</Th><Th>Kimga</Th><Th>Tovarlar</Th><Th>Ta&apos;minotchi</Th><Th>To&apos;lov</Th><Th right>Summa (fayl)</Th></Tr></thead>
            <tbody>
              {data.docs.slice(0, SHOWN).map((d) => {
                const t = matchTarget(targets, d.recipient);
                return (
                  <Tr key={d.key}>
                    <Td className="tabular whitespace-nowrap">{day(d.date)}</Td>
                    <Td><span className="mr-1.5">{t?.label ?? d.recipient}</span><Badge color={t ? "slate" : "blue"}>{t ? KIND[t.kind] : "yangi"}</Badge></Td>
                    <Td className="text-slate-600">{d.rows.map((r) => `${r.material} ${fmtNum(r.qty, 3)} ${r.unit}`).join("; ")}</Td>
                    <Td className="text-slate-600">{[...new Set(d.rows.map((r) => r.supplier).filter(Boolean))].join(", ") || "—"}</Td>
                    <Td>{[...new Set(d.rows.map((r) => payLabel(r.payment)))].join(", ")}</Td>
                    <Td right className="tabular whitespace-nowrap">{fmtNum(d.rows.reduce((s, r) => s + r.fileSum, 0))}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          {data.docs.length > SHOWN && <p className="text-sm text-slate-500">{`Birinchi ${SHOWN} ta hujjat ko'rsatildi, saqlanganda ${fmtNum(data.docs.length)} tasi ham kiradi.`}</p>}

          {!result && (
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
              {warehouses.length > 1 && (
                <Field label="Sklad (Kimdan)" className="w-60">
                  <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={busy}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
              )}
              <p className="w-full text-sm text-slate-500">Narx skladdan olinadi (dona narxi yoki o&apos;rtacha). Qoldig&apos;i yetmagan hujjat saqlanmaydi, qolganlari yoziladi.</p>
              <Button type="button" onClick={save} disabled={busy || !warehouseId}>
                <PackageMinus size={16} /> {busy ? `Saqlanmoqda… ${fmtNum(done)} / ${fmtNum(data.docs.length)}` : `${fmtNum(data.docs.length)} ta chiqimni yozish`}
              </Button>
              {busy && <div className="w-full"><Progress value={done} max={data.docs.length} /></div>}
            </div>
          )}

          {result && (
            <Callout tone={result.stopped || result.failed.length ? "warning" : "success"} title={result.stopped ? "Saqlash to'xtadi" : "Chiqim yozildi"}>
              <div>{`Yangi chiqim: ${fmtNum(result.created)}`}{result.existed ? ` · avval yozilgan (takrorlanmadi): ${fmtNum(result.existed)}` : ""}{result.failed.length ? ` · saqlanmadi: ${fmtNum(result.failed.length)}` : ""}</div>
              {result.stopped && <div className="mt-1 font-medium">{result.stopped}</div>}
              {result.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5">{result.failed.slice(0, 30).map((f, i) => <li key={i}>{day(f.date)} · {f.recipient}: {f.error}</li>)}</ul>
              )}
              <div className="mt-3">
                <LinkButton href={`/stock/rasxod?from=${stats.from}&to=${stats.to}`} variant="secondary" size="sm"><FileSpreadsheet size={15} /> Chiqim jurnalini ochish</LinkButton>
              </div>
            </Callout>
          )}
        </>
      )}
    </div>
  );
}
