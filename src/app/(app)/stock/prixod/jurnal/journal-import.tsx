"use client";

import { useMemo, useState } from "react";
import { CalendarRange, FileSpreadsheet, FileUp, HardHat, Package, Truck, Wallet } from "lucide-react";
import { Badge, Button, Callout, Checkbox, Field, InfoButton, Input, LinkButton, Progress, Select, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { JournalTemplateButton } from "@/components/journal-template";
import { CategoryBulkBar, CategorySelect, RowCheck } from "@/components/category-bulk";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { unitShort } from "@/lib/unit";
import type { MaterialCategory } from "@/generated/prisma";
import { dateRu, fmtNum, isoDate, moneyShort } from "@/lib/format";
import { groupJournal, journalMaterials, parseJournal, type JournalDoc, type JournalIssue } from "@/lib/prixod-journal";
import type { JournalChunkResult } from "@/lib/prixod-journal-import";
import { importJournalChunk } from "./actions";

/** Bir so'rovda yuboriladigan hujjatlar soni (server chegarasi — 40). */
const CHUNK = 25;
/** Oldindan ko'rish jadvalida ko'rsatiladigan hujjatlar. */
const SHOWN = 150;

const day = (iso: string) => dateRu(new Date(`${iso}T00:00:00`));
const payLabel = (p: JournalDoc["payment"]) => (p === "BANK" ? "P-r" : p === "CASH" ? "n-q" : "—");

/** Fayldagi tovar (xomashyo): `key` — kichik harfli nom (serverdagi `journalMaterials` bilan bir xil), `was` — spravochnikdagi kategoriyasi. */
type Mat = { key: string; name: string; unit: string; isNew: boolean; was: MaterialCategory | null; rows: number };
type Parsed = {
  file: string; docs: JournalDoc[]; errors: JournalIssue[]; warnings: JournalIssue[]; newSuppliers: string[]; newMaterials: string[]; supplierVat: Record<string, boolean>;
  mats: Mat[];
  /** Fayl qatori → tovar kaliti (bo'lak bilan shu bo'lakdagi tovarlar kategoriyasi yuboriladi) */
  lineMat: Record<number, string>;
};

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

/**
 * Excel jurnal importi. Saqlashdan oldin fayldagi har tovarga kategoriya beriladi (Xomashyo / Zavod zapchast / Avto zapchast):
 * qatorda yoki belgilab birdan. Boshlang'ich qiymat — spravochnikdagisi, yangisida fayldagi «Kategoriya» ustuni yoki Xomashyo.
 * Mavjud xomashyo kategoriyasini faqat spravochnikni yurituvchi (`canEditCategory`) o'zgartiradi.
 */
export function JournalImport({ warehouses, materials, categories, canEditCategory, suppliers, canAddSuppliers, canDistribute }: {
  warehouses: { id: string; name: string }[];
  /** [kichik harfli nom, birlik] — bazadagi xomashyolar */
  materials: [string, string][];
  /** kichik harfli nom → kategoriya (bazadagi xomashyolar) */
  categories: Record<string, MaterialCategory>;
  canEditCategory: boolean;
  /** kichik harfli yetkazuvchi nomlari */
  suppliers: string[];
  canAddSuppliers: boolean;
  canDistribute: boolean;
}) {
  const [data, setData] = useState<Parsed | null>(null);
  const [readError, setReadError] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  // Eski daftar odatda allaqachon to'langan — aks holda butun summa yetkazuvchilarga qarz bo'lib tushadi
  const [paid, setPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<(JournalChunkResult & { stopped?: string }) | null>(null);
  // Tovarlar kategoriyasi: tanlov, belgilanganlar, qidiruv
  const [cats, setCats] = useState<Record<string, MaterialCategory>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setReadError(""); setData(null); setResult(null); setDone(0); setSel(new Set()); setQ(""); setOnlyNew(false);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]!];
      if (!ws) throw new Error("Faylda varaq yo'q");
      const p = parseJournal(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true }));
      if (p.missing.length) { setReadError(`Ustun topilmadi: ${p.missing.join(", ")}. Birinchi qatorda sarlavhalar bo'lsin.`); return; }
      if (!p.rows.length) { setReadError("Faylda kirim qatori topilmadi"); return; }
      const known = new Set(suppliers);
      const supplierVat: Record<string, boolean> = {};
      for (const r of p.rows) { const k = r.supplier.trim().toLowerCase(); supplierVat[k] = supplierVat[k] || r.vatRate > 0; }
      const assigned = journalMaterials(p.rows, new Map(materials));
      const existing = new Set(materials.map(([n]) => n));
      // Birligi mos kelmagani uchun alohida xomashyoga ajratilgan qatorlar ham tekshirilsin (ko'pincha birlik xato yozilgan)
      const split = p.rows.filter((r) => assigned.get(r.line)!.name !== r.material.trim().replace(/\s+/g, " "))
        .map((r) => ({ line: r.line, text: `${r.material}: birlik «${r.unit}» boshqa qatorlardagidan farq qiladi — «${assigned.get(r.line)!.name}» alohida xomashyo bo'ladi` }));
      // Tovarlar ro'yxati: fayldagi tartibda, har biriga boshlang'ich kategoriya
      const mats = new Map<string, Mat>(), fileCat = new Map<string, MaterialCategory>(), lineMat: Record<number, string> = {};
      for (const r of p.rows) {
        const a = assigned.get(r.line)!;
        const key = a.name.toLowerCase();
        lineMat[r.line] = key;
        const m = mats.get(key);
        if (m) m.rows++;
        else mats.set(key, { key, name: a.name, unit: a.unit, isNew: !existing.has(key), was: categories[key] ?? null, rows: 1 });
        if (r.category && !fileCat.has(key)) fileCat.set(key, r.category);
      }
      setCats(Object.fromEntries([...mats.values()].map((m) => [m.key,
        m.isNew ? fileCat.get(m.key) ?? "XOMASHYO" : canEditCategory ? fileCat.get(m.key) ?? m.was ?? "XOMASHYO" : m.was ?? "XOMASHYO"])));
      setData({
        file: f.name, docs: groupJournal(p.rows), errors: p.errors, warnings: [...p.warnings, ...split].sort((a, b) => a.line - b.line), supplierVat,
        newSuppliers: [...new Set(p.rows.map((r) => r.supplier.trim()))].filter((n) => !known.has(n.toLowerCase())),
        newMaterials: [...new Set([...assigned.values()].map((m) => m.name))].filter((n) => !existing.has(n.toLowerCase())),
        mats: [...mats.values()], lineMat,
      });
    } catch (e) {
      setReadError(e instanceof Error ? `Fayl o'qilmadi: ${e.message}` : "Fayl o'qilmadi");
    }
  }

  const stats = useMemo(() => {
    if (!data) return null;
    const rows = data.docs.flatMap((d) => d.rows);
    const dates = data.docs.map((d) => d.date);
    return { rows: rows.length, total: rows.reduce((s, r) => s + r.total, 0), from: dates[0]!, to: dates[dates.length - 1]! };
  }, [data]);

  // Ro'yxatda ko'rinadigan tovarlar (qidiruv, «faqat yangilari») va ulardan kategoriyasi o'zgartiriladiganlari
  const editable = (m: Mat) => m.isNew || canEditCategory;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.mats ?? []).filter((m) => (!onlyNew || m.isNew) && (!t || m.key.includes(t)));
  }, [data, q, onlyNew]);
  const shownEditable = shown.filter(editable);
  const shownSel = shownEditable.filter((m) => sel.has(m.key));
  const matBy = useMemo(() => new Map((data?.mats ?? []).map((m) => [m.key, m])), [data]);
  const changed = (data?.mats ?? []).filter((m) => !m.isNew && m.was && cats[m.key] !== m.was).length;
  const byCat = (data?.mats ?? []).reduce<Record<string, number>>((a, m) => { const c = cats[m.key] ?? "XOMASHYO"; a[c] = (a[c] ?? 0) + 1; return a; }, {});
  const toggle = (keys: string[], on: boolean) => setSel((s0) => { const s1 = new Set(s0); for (const k of keys) { if (on) s1.add(k); else s1.delete(k); } return s1; });
  const setCat = (keys: string[], c: MaterialCategory) => setCats((m) => ({ ...m, ...Object.fromEntries(keys.map((k) => [k, c])) }));

  async function save() {
    if (!data || busy) return;
    setBusy(true); setDone(0);
    const acc: JournalChunkResult & { stopped?: string } = { created: 0, existed: 0, failed: [] };
    for (let i = 0; i < data.docs.length; i += CHUNK) {
      const part = data.docs.slice(i, i + CHUNK);
      try {
        // Shu bo'lakdagi tovarlar kategoriyasi: yangilari va o'zgartirilganlari (o'zgarmagan mavjud kategoriya qaytarib yozilmasin)
        const categories = Object.fromEntries(part.flatMap((d) => d.rows).map((r) => data.lineMat[r.line]!)
          .filter((k) => { const m = matBy.get(k); return !m || m.isNew || cats[k] !== m.was; }).map((k) => [k, cats[k] ?? "XOMASHYO"]));
        const r = await importJournalChunk({ warehouseId, docs: part, supplierVat: data.supplierVat, paid, categories });
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
        <JournalTemplateButton file="kirim-namuna" extra={["Kategoriya"]} example={{
          "Sana": isoDate().split("-").reverse().join("."), "Tovar": "Sement M400", "TTN №": "123", "O'lchov": "t", "Miqdor": 20, "Ta'minotchi": "Qizilqum sement",
          "Kimga": "Insof", "To'lov": "P-r", "Dostavka": 0, "Narx (QQSsiz)": 950000, "Summa (QQSsiz)": 19000000, "QQS 12%": 2280000, "Jami (QQS bilan)": 21280000,
          "Kategoriya": "Xomashyo",
        }} />
        <InfoButton title="Excel fayl ustunlari">
          <p>Ustunlar: Sana, Tovar, TTN №, O&apos;lchov, Miqdor, Ta&apos;minotchi, Kimga, To&apos;lov (P-r — perechisleniye, n-q — naqd), Dostavka, Narx (QQSsiz), Summa, QQS 12%, Jami, Manzil, Snabjenets, Izoh, Mashina, Qayerdan yuklandi, Kategoriya (ixtiyoriy).</p>
          <p>Excel&apos;dan faqat kirim bo&apos;ladi — chiqim yozilmaydi.</p>
        </InfoButton>
        {data?.file && <span className="text-sm text-slate-500">{data.file}</span>}
      </div>
      {readError && <Callout tone="danger">{readError}</Callout>}

      {data && stats && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Kirim hujjatlari" value={fmtNum(data.docs.length)} hint={`${fmtNum(stats.rows)} ta qator`} icon={FileSpreadsheet} />
            <StatCard label="Davr" value={<span className="text-base">{day(stats.from)} – {day(stats.to)}</span>} icon={CalendarRange} />
            <StatCard label="Yetkazuvchilar" value={fmtNum(new Set(data.docs.map((d) => d.supplier.toLowerCase())).size)} hint={data.newSuppliers.length ? `${fmtNum(data.newSuppliers.length)} tasi yangi — qo'shiladi` : "hammasi spravochnikda bor"} icon={Truck} />
            <StatCard label="Jami summa (QQS bilan)" value={moneyShort(stats.total)} hint={paid ? "to'langan deb yoziladi" : "to'lanmagan kirim bo'lib tushadi"} icon={Wallet} />
          </div>

          {data.newMaterials.length > 0 && (
            <Callout tone="info" title={`Yangi xomashyolar: ${fmtNum(data.newMaterials.length)}`}>
              Spravochnikda yo&apos;q tovarlar avtomatik yaratiladi (quyidagi ro&apos;yxatda «Yangi» belgisi bilan). Bir tovar turli birlikda yozilgan bo&apos;lsa, alohida xomashyo bo&apos;ladi, masalan «Qizil kiraska (l)».
              Keyin Sklad → Xomashyo bo&apos;limida nomini to&apos;g&apos;rilash mumkin.
            </Callout>
          )}

          {/* Tovarlar va kategoriya: qatorda yoki belgilab birdan */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">{`Tovarlar va kategoriya: ${fmtNum(data.mats.length)}`}</div>
              <div className="text-xs text-slate-500">
                {Object.entries(byCat).map(([c, n]) => `${MATERIAL_CATEGORY_LABEL[c as MaterialCategory]} ${fmtNum(n)}`).join(" · ")}
                {changed > 0 && ` · ${fmtNum(changed)} tasining spravochnikdagi kategoriyasi o'zgaradi`}
              </div>
            </div>
            <CategoryBulkBar total={shownEditable.length} selected={shownSel.length}
              onToggleAll={(on) => toggle(shownEditable.map((m) => m.key), on)}
              onApply={(c) => { setCat(shownSel.map((m) => m.key), c); toggle(shownSel.map((m) => m.key), false); }}>
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tovar nomi bo'yicha qidirish" aria-label="Tovar qidirish" className="h-8 w-56 text-sm pointer-coarse:h-9" />
              <Checkbox checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} label="Faqat yangilari" />
            </CategoryBulkBar>
            {!canEditCategory && data.mats.some((m) => !m.isNew) && (
              <p className="text-xs text-slate-500">Spravochnikda bor tovarlar kategoriyasini ombor, ta&apos;minot yoki direktor o&apos;zgartiradi — sizda faqat yangilariga beriladi.</p>
            )}
            <Table maxHeight={420}>
              <thead><Tr><Th className="w-10" /><Th>Tovar</Th><Th>Birlik</Th><Th>Holati</Th><Th right>Qatorlar</Th><Th>Kategoriya</Th></Tr></thead>
              <tbody>
                {shown.map((m) => {
                  const c = cats[m.key] ?? "XOMASHYO";
                  return (
                    <Tr key={m.key}>
                      <Td className="text-center">{editable(m) && <RowCheck checked={sel.has(m.key)} onChange={(on) => toggle([m.key], on)} label={`${m.name} — belgilash`} />}</Td>
                      <Td>{m.name}</Td>
                      <Td className="text-slate-600">{unitShort(m.unit)}</Td>
                      <Td>{m.isNew ? <Badge color="blue" dot={false}>Yangi</Badge> : <span className="text-xs text-slate-500">Spravochnikda</span>}</Td>
                      <Td right className="tabular">{fmtNum(m.rows)}</Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <CategorySelect value={c} onChange={(v) => setCat([m.key], v)} disabled={!editable(m)} />
                          {!m.isNew && m.was && c !== m.was && <span className="text-xs font-medium text-amber-700" title="Saqlanganda spravochnikda o'zgaradi">{`${MATERIAL_CATEGORY_LABEL[m.was]} → ${MATERIAL_CATEGORY_LABEL[c]}`}</span>}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
                {!shown.length && <Tr><Td colSpan={6} className="text-center text-sm text-slate-500">Hech narsa topilmadi</Td></Tr>}
              </tbody>
            </Table>
          </div>
          {data.newSuppliers.length > 0 && !canAddSuppliers && (
            <Callout tone="danger" title="Yangi yetkazuvchi qo'shishga ruxsatingiz yo'q">
              Avval Yetkazuvchilar bo&apos;limida qo&apos;shing: {data.newSuppliers.slice(0, 10).join(", ")}{data.newSuppliers.length > 10 ? "…" : ""}
            </Callout>
          )}
          <Issues title="Saqlanmaydigan qatorlar (faylni tuzatib qayta yuklang)" tone="danger" items={data.errors} />
          <Issues title="Avtomatik tuzatilgan qatorlar — tekshirib chiqing" tone="warning" items={data.warnings} />

          <Table maxHeight={480}>
            <thead><Tr><Th>Sana</Th><Th>Kimdan</Th><Th>TTN</Th><Th>To&apos;lov</Th><Th>Tovarlar</Th><Th right>Summa</Th></Tr></thead>
            <tbody>
              {data.docs.slice(0, SHOWN).map((d) => (
                <Tr key={d.key}>
                  <Td className="tabular whitespace-nowrap">{day(d.date)}</Td>
                  <Td>{d.supplier}</Td>
                  <Td className="tabular">{d.waybillNo || "—"}</Td>
                  <Td>{payLabel(d.payment)}</Td>
                  <Td className="text-slate-600">{d.rows.map((r) => `${r.material} ${fmtNum(r.qty, 3)} ${r.unit}`).join("; ")}</Td>
                  <Td right className="tabular whitespace-nowrap">{fmtNum(d.rows.reduce((s, r) => s + r.total, 0))}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {data.docs.length > SHOWN && <p className="text-sm text-slate-500">{`Birinchi ${SHOWN} ta hujjat ko'rsatildi, saqlanganda ${fmtNum(data.docs.length)} tasi ham kiradi.`}</p>}

          {!result && (
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
              {warehouses.length > 1 && (
                <Field label="Sklad" className="w-60">
                  <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={busy}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
              )}
              <div className="w-full">
                <Checkbox checked={paid} onChange={(e) => setPaid(e.target.checked)} disabled={busy}
                  label="Bu kirimlar allaqachon to'langan — «To'lanmagan kirimlar» va yetkazuvchi qarziga tushmasin (kassaga chiqim yozilmaydi)" />
              </div>
              <Button type="button" onClick={save} disabled={busy || !warehouseId || (data.newSuppliers.length > 0 && !canAddSuppliers)}>
                <Package size={16} /> {busy ? `Saqlanmoqda… ${fmtNum(done)} / ${fmtNum(data.docs.length)}` : `${fmtNum(data.docs.length)} ta kirimni saqlash`}
              </Button>
              {busy && <div className="w-full"><Progress value={done} max={data.docs.length} /></div>}
            </div>
          )}

          {result && (
            <Callout tone={result.stopped || result.failed.length ? "warning" : "success"} title={result.stopped ? "Saqlash to'xtadi" : "Kirim saqlandi"}>
              <div>{`Yangi kirim: ${fmtNum(result.created)}`}{result.existed ? ` · avval saqlangan (takrorlanmadi): ${fmtNum(result.existed)}` : ""}{result.failed.length ? ` · saqlanmadi: ${fmtNum(result.failed.length)}` : ""}</div>
              {result.stopped && <div className="mt-1 font-medium">{result.stopped}</div>}
              {result.failed.length > 0 && (
                <ul className="mt-1 space-y-0.5">{result.failed.slice(0, 20).map((f, i) => <li key={i}>{day(f.date)} · {f.supplier}: {f.error}</li>)}</ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <LinkButton href={`/stock/prixod?from=${stats.from}&to=${stats.to}`} variant="secondary" size="sm"><FileSpreadsheet size={15} /> Kirim jurnalini ochish</LinkButton>
                {canDistribute && <LinkButton href="/stock?tab=brigades" size="sm"><HardHat size={15} /> Brigadalarga taqsimlash (chiqim)</LinkButton>}
              </div>
            </Callout>
          )}
        </>
      )}
    </div>
  );
}
