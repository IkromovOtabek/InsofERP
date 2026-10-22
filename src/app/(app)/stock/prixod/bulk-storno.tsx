"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Button, Callout, Input, Progress } from "@/components/ui";
import { isAccessDenied } from "@/lib/access-denied";
import { fmtNum } from "@/lib/format";
import { stornoReceipts, type BulkStornoResult } from "./actions";

/** Bir so'rovda yuboriladigan kirimlar (server chegarasi — 20). */
const CHUNK = 10;

/**
 * Kirim jurnali: ro'yxatdagi (davr, sklad, qidiruv bo'yicha) faol kirimlarni birdan bekor qilish — masalan, Excel'dan
 * xato yuklangan daftarni qaytarib, tozalangan faylni qayta yuklash uchun. Har kirim alohida storno qilinadi
 * (`stornoReceipts`), bo'lmaganlari sababi bilan ro'yxatda qoladi. Sabab majburiy.
 */
export function BulkStorno({ ids, summary }: { ids: string[]; summary: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<(BulkStornoResult & { stopped?: string }) | null>(null);

  async function run() {
    if (busy || why.trim().length < 3) return;
    setBusy(true); setDone(0);
    const acc: BulkStornoResult & { stopped?: string } = { done: 0, failed: [] };
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      try {
        const r = await stornoReceipts(part, why.trim());
        if (r.error) { acc.stopped = r.error; break; }
        acc.done += r.done; acc.failed.push(...r.failed);
      } catch (e) {
        acc.stopped = isAccessDenied(e) ? "Bekor qilishga huquq yo'q — direktorga murojaat qiling" : "Server bilan aloqa uzildi — sahifani yangilab, qaytadan bosing (bekor qilinganlari takrorlanmaydi)";
        break;
      }
      setDone(Math.min(ids.length, i + part.length));
    }
    setResult(acc);
    setBusy(false);
    router.refresh();
  }

  if (!open && !result) {
    if (!ids.length) return null;
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="text-red-700">
        <Undo2 size={16} /> Ro&apos;yxatdagi kirimlarni bekor qilish
      </Button>
    );
  }

  return (
    <Callout tone={result ? (result.stopped || result.failed.length ? "warning" : "success") : "danger"}
      title={result ? (result.stopped ? "Bekor qilish to'xtadi" : "Bekor qilish tugadi") : `${fmtNum(ids.length)} ta kirim bekor qilinadi`}>
      {!result && (
        <>
          <div>{summary}</div>
          <div className="mt-1">
            Har kirim storno qilinadi: sklad qoldig&apos;i kamayadi, kirim bilan birga yozilgan avto chiqim ham qaytariladi. Hujjatlar o&apos;chmaydi,
            «bekor qilingan» bo&apos;lib qoladi. Shundan keyin tozalangan faylni «Excel&apos;dan yuklash» orqali qayta yuklash mumkin.
            To&apos;lov bog&apos;langan, ta&apos;minot zayavkasidan kelgan yoki moli sarflangan kirimlar bekor bo&apos;lmaydi — ro&apos;yxatda sababi chiqadi.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Sabab (majburiy)" aria-label="Bekor qilish sababi"
              maxLength={300} disabled={busy} className="w-full sm:w-80" autoFocus />
            <Button type="button" variant="danger" onClick={run} disabled={busy || why.trim().length < 3}>
              <Undo2 size={16} /> {busy ? `Bekor qilinmoqda… ${fmtNum(done)} / ${fmtNum(ids.length)}` : `${fmtNum(ids.length)} ta kirimni bekor qilish`}
            </Button>
            {!busy && <Button type="button" variant="secondary" onClick={() => { setOpen(false); setWhy(""); }}>Yo&apos;q</Button>}
          </div>
          {busy && <div className="mt-3"><Progress value={done} max={ids.length} tone="danger" /></div>}
        </>
      )}
      {result && (
        <>
          <div>{`Bekor qilindi: ${fmtNum(result.done)}`}{result.failed.length ? ` · bekor bo'lmadi: ${fmtNum(result.failed.length)}` : ""}</div>
          {result.stopped && <div className="mt-1 font-medium">{result.stopped}</div>}
          {result.failed.length > 0 && (
            <ul className="mt-1 space-y-0.5">{result.failed.slice(0, 30).map((f, i) => <li key={i}><b>{f.docNo}</b>: {f.error}</li>)}</ul>
          )}
          <button type="button" className="mt-2 font-medium underline" onClick={() => { setResult(null); setOpen(false); setWhy(""); }}>Yopish</button>
        </>
      )}
    </Callout>
  );
}
