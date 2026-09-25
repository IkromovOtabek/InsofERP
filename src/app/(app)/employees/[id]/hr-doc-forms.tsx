"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileSignature, FileText, Pencil, Printer, Upload, X } from "lucide-react";
import type { HrDocField } from "@/lib/hr-docs";
import { deleteHrDoc, deleteHrDocScan, prepareHiringSet, saveHrDoc, uploadHrDocScan } from "../../otdel-kadr/hr-doc-actions";
import { Badge, Button, Field, FormError, Input, Select } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { MoneyInput } from "@/components/money-input";

/** Serverdan keladigan bir qator — hujjat turi va (agar tayyorlangan bo'lsa) uning maydonlari. */
export type HrDocRow = {
  slug: string;
  kind: string;
  label: string;
  hint: string;
  fields: HrDocField[];
  /** Tayyorlangan yozuv id — null bo'lsa hujjat hali tayyorlanmagan */
  id: string | null;
  docDate: string | null;
  effectiveAt: string | null;
  position: string | null;
  salary: string | null;
  fixedTerm: boolean;
  termUntil: string | null;
  no: string | null;
  reason: string | null;
  fileName: string | null;
  signedAt: string | null;
};

export type HrDocDefaults = {
  today: string;
  hiredAt: string | null;
  firedAt: string | null;
  position: string;
  /** Keyingi buyruq raqami taklifi — «216 K» ko'rinishida */
  nextNo: string;
};

const fileCls =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700";

const uzDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

/**
 * Xodim kartasidagi «Kadr hujjatlari» bo'limi: yettita shakl tayyorlanadi, chop etiladi
 * va imzolangandan keyin nusxasi shu yerga qaytib yuklanadi.
 */
export function HrDocsPanel({ employeeId, rows, defaults, positions, accept }: {
  employeeId: string;
  rows: HrDocRow[];
  defaults: HrDocDefaults;
  positions: string[];
  accept: string;
}) {
  const [bundleOpen, setBundleOpen] = useState(false);
  const hiring = rows.filter((r) => r.kind !== "BOSHATISH");
  const missing = hiring.filter((r) => !r.id);
  const prepared = rows.filter((r) => r.id).length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        {missing.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setBundleOpen((v) => !v)}>
            {bundleOpen ? <X size={14} /> : <FileSignature size={14} />}
            {bundleOpen ? "Yopish" : `Ishga qabul to'plami (${missing.length} ta)`}
          </Button>
        )}
        {hiring.some((r) => r.id) && (
          <Link
            href={`/employees/${employeeId}/hujjat/chop/toplam?print=1`}
            target="_blank"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Printer size={14} /> Ishga qabul to&apos;plamini chop etish
          </Link>
        )}
        <span className="ml-auto text-xs text-slate-500">{prepared} / {rows.length} tayyorlangan</span>
      </div>

      {bundleOpen && (
        <BundleForm
          employeeId={employeeId}
          defaults={defaults}
          positions={positions}
          missing={missing.map((r) => r.label)}
          onDone={() => setBundleOpen(false)}
        />
      )}

      <ul className="divide-y divide-slate-100">
        {rows.map((r) => <DocRow key={r.slug} employeeId={employeeId} row={r} defaults={defaults} positions={positions} accept={accept} />)}
      </ul>
    </div>
  );
}

/* ───────── Ishga qabul to'plami ───────── */

function BundleForm({ employeeId, defaults, positions, missing, onDone }: {
  employeeId: string;
  defaults: HrDocDefaults;
  positions: string[];
  missing: string[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(prepareHiringSet.bind(null, employeeId), undefined);
  const [fixed, setFixed] = useState(false);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);

  return (
    <form action={action} className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
      <p className="mb-3 text-xs text-slate-600">
        Bir xil sana va lavozim bilan tayyorlanadi: {missing.join(", ")}. Tayyorlangan hujjatlarga tegilmaydi.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Hujjat sanasi"><Input name="docDate" type="date" defaultValue={defaults.today} required /></Field>
        <Field label="Ishga qabul sanasi"><Input name="effectiveAt" type="date" defaultValue={defaults.hiredAt ?? defaults.today} required /></Field>
        <Field label="Lavozimi">
          <Select name="position" defaultValue={defaults.position}>
            {[...new Set([defaults.position, ...positions])].filter(Boolean).map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Buyruq raqami" hint="Blankadagi «№216 K» kabi">
          <Input name="no" defaultValue={defaults.nextNo} />
        </Field>
        <Field label="Oylik ish haqi" hint="Shartnoma va buyruqda chiqadi; bo'sh qoldirilsa «штат жадвалига мувофиқ»">
          <MoneyInput name="salary" />
        </Field>
        <Field label="Shartnoma muddati" className="sm:col-span-2">
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="fixedTerm" checked={fixed} onChange={(e) => setFixed(e.target.checked)} className="size-4 rounded border-slate-300" />
            Muddatli shartnoma (belgilanmasa — muddatsiz)
          </label>
        </Field>
        {fixed && <Field label="Qaysi sanagacha"><Input name="termUntil" type="date" /></Field>}
      </div>
      <FormError error={state?.error} />
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Tayyorlanmoqda…" : "Hujjatlarni tayyorlash"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Bekor qilish</Button>
      </div>
    </form>
  );
}

/* ───────── Bitta hujjat qatori ───────── */

function DocRow({ employeeId, row, defaults, positions, accept }: {
  employeeId: string;
  row: HrDocRow;
  defaults: HrDocDefaults;
  positions: string[];
  accept: string;
}) {
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const printHref = `/employees/${employeeId}/hujjat/chop/${row.slug}${row.id ? `?doc=${row.id}&print=1` : "?print=1"}`;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <FileText size={16} className={row.id ? "mt-0.5 text-slate-500" : "mt-0.5 text-slate-300"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{row.label}</span>
            {row.signedAt
              ? <Badge color="green">imzolangan nusxa bor</Badge>
              : row.id ? <Badge color="amber">tayyorlangan</Badge> : <Badge>tayyorlanmagan</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {row.id
              ? <>
                  {uzDate(row.docDate)} sanali
                  {row.no ? ` · №${row.no}` : ""}
                  {row.position ? ` · ${row.position}` : ""}
                  {row.effectiveAt ? ` · kuchga kirish ${uzDate(row.effectiveAt)}` : ""}
                </>
              : row.hint}
          </div>
          {row.fileName && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <CheckCircle2 size={13} className="text-emerald-600" />
              <Link href={`/employees/${employeeId}/kadr-hujjat/${row.id}`} target="_blank" className="text-slate-700 hover:underline">
                {row.fileName}
              </Link>
              <Link href={`/employees/${employeeId}/kadr-hujjat/${row.id}?download=1`} className="text-slate-400 hover:text-slate-700" title="Yuklab olish">
                <Download size={13} />
              </Link>
              <DeleteButton
                action={deleteHrDocScan}
                id={row.id!}
                name={`${row.label} — imzolangan nusxa`}
                title="Nusxani olib tashlash"
                className="h-6 w-6"
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => { setEditing((v) => !v); setUploading(false); }}>
            {row.id ? <><Pencil size={14} /> Tuzatish</> : <><FileSignature size={14} /> Tayyorlash</>}
          </Button>
          <Link
            href={printHref}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            title={row.id ? "To'ldirilgan holda chop etish" : "Bo'sh blanka chop etiladi"}
          >
            <Printer size={14} /> Chop etish
          </Link>
          {row.id && (
            <Button variant="ghost" size="sm" onClick={() => { setUploading((v) => !v); setEditing(false); }}>
              <Upload size={14} /> {row.signedAt ? "Almashtirish" : "Nusxa yuklash"}
            </Button>
          )}
          {row.id && (
            <DeleteButton action={deleteHrDoc} id={row.id} name={row.label} title="Tayyorlangan hujjatni o'chirish" />
          )}
        </div>
      </div>

      {editing && (
        <DocForm
          employeeId={employeeId}
          row={row}
          defaults={defaults}
          positions={positions}
          onDone={() => setEditing(false)}
        />
      )}
      {uploading && row.id && <ScanForm docId={row.id} accept={accept} onDone={() => setUploading(false)} />}
    </li>
  );
}

/* ───────── Hujjat maydonlari ───────── */

function DocForm({ employeeId, row, defaults, positions, onDone }: {
  employeeId: string;
  row: HrDocRow;
  defaults: HrDocDefaults;
  positions: string[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveHrDoc.bind(null, employeeId), undefined);
  const [fixed, setFixed] = useState(row.fixedTerm);
  const has = (f: HrDocField) => row.fields.includes(f);
  const dismissal = row.kind === "BOSHATISH";
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);

  return (
    <form action={action} className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <input type="hidden" name="kind" value={row.kind} />
      {row.id && <input type="hidden" name="docId" value={row.id} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Hujjat sanasi">
          <Input name="docDate" type="date" defaultValue={row.docDate ?? defaults.today} required />
        </Field>

        {has("effectiveAt") && (
          <Field label={dismissal ? "Bo'shatish sanasi" : "Ishga qabul sanasi"}>
            <Input
              name="effectiveAt"
              type="date"
              defaultValue={row.effectiveAt ?? (dismissal ? defaults.firedAt ?? defaults.today : defaults.hiredAt ?? defaults.today)}
              required
            />
          </Field>
        )}

        {has("no") && (
          <Field label="Buyruq raqami" hint="Blankada «БУЙРУҚ №216 K» bo'lib chiqadi">
            <Input name="no" defaultValue={row.no ?? defaults.nextNo} />
          </Field>
        )}

        {has("position") && (
          <Field label="Lavozimi">
            <Select name="position" defaultValue={row.position ?? defaults.position}>
              {[...new Set([row.position ?? defaults.position, ...positions])].filter(Boolean).map((p) => (
                <option key={p} value={p!}>{p}</option>
              ))}
            </Select>
          </Field>
        )}

        {has("salary") && (
          <Field label="Oylik ish haqi" hint="Bo'sh qoldirilsa «штат жадвалига мувофиқ» deb chiqadi">
            <MoneyInput name="salary" defaultValue={row.salary ?? undefined} />
          </Field>
        )}

        {has("term") && (
          <Field label="Shartnoma muddati" className="sm:col-span-2">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="fixedTerm" checked={fixed} onChange={(e) => setFixed(e.target.checked)} className="size-4 rounded border-slate-300" />
              Muddatli (belgilanmasa — muddatsiz)
            </label>
          </Field>
        )}
        {has("term") && fixed && (
          <Field label="Qaysi sanagacha"><Input name="termUntil" type="date" defaultValue={row.termUntil ?? ""} /></Field>
        )}

        {has("reason") && (
          <Field label="Sababi" hint="Ixtiyoriy — arizada qo'shimcha qator bo'lib chiqadi" className="sm:col-span-2">
            <Input name="reason" defaultValue={row.reason ?? ""} placeholder="oilaviy sharoit" />
          </Field>
        )}
      </div>

      <FormError error={state?.error} />
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : row.id ? "Saqlash" : "Tayyorlash"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Bekor qilish</Button>
        {row.fields.length === 0 && (
          <span className="text-xs text-slate-500">Bu shakl kartadagi ma&apos;lumotlar bilan to&apos;ldiriladi.</span>
        )}
      </div>
    </form>
  );
}

/* ───────── Imzolangan nusxa ───────── */

function ScanForm({ docId, accept, onDone }: { docId: string; accept: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(uploadHrDocScan.bind(null, docId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) { ref.current?.reset(); onDone(); } }, [state, onDone]);

  return (
    <form ref={ref} action={action} className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <p className="mb-2 text-xs text-slate-600">
        Imzolangan hujjatni skaner qiling yoki telefonda suratga oling — PDF, JPG, PNG yoki WEBP.
      </p>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input name="file" type="file" accept={accept} required className={fileCls} />
        <Button variant="secondary" disabled={pending}><Upload size={15} /> {pending ? "Yuklanmoqda…" : "Yuklash"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Bekor qilish</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
