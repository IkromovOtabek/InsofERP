"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, Image as ImageIcon, ScanLine, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Server qaytaradigan natija (api/scan/receipt). */
export type ScanResult = { doc: { supplier: string; date: string; docNo: string }; rows: Record<string, string>[]; model?: string; latency?: number };

/** Rasm uzun tomoni shuncha pikselgacha kichraytiriladi — o'qish sifati yetarli, yuklash tez. */
const MAX_SIDE = 1600;
const MAX_SHOTS = 4;

/** Rasmni (fayl yoki kamera kadri) kichraytirib, JPEG data-URL qiladi. */
async function toJpeg(src: CanvasImageSource, w: number, h: number): Promise<string> {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

function fileToJpeg(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = async () => { const d = await toJpeg(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); res(d); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Rasm o'qilmadi")); };
    img.src = url;
  });
}

/**
 * Hujjatni kamera bilan skaner qilish: telefon/noutbuk kamerasidan yoki galereyadan rasm olinadi,
 * serverga yuboriladi (api/scan/receipt), model qatorlarni o'qib beradi — natija chaqiruvchiga qaytadi.
 * Hech narsa o'z-o'zidan saqlanmaydi: qatorlar jadvalga tushadi, foydalanuvchi tekshirib tasdiqlaydi.
 */
export function DocScan({ endpoint, onResult, label = "Kamera bilan skaner qilish" }: {
  endpoint: string;
  onResult: (r: ScanResult) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [camErr, setCamErr] = useState("");
  const [live, setLive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCam = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setLive(false); };

  const startCam = async () => {
    setCamErr("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr("Bu brauzerda kamera ochilmaydi. Quyidagi «Rasm tanlash» tugmasi telefon kamerasini ochadi.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
      streamRef.current = s;
      setLive(true);
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setCamErr(name === "NotAllowedError"
        ? "Kameraga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering yoki «Rasm tanlash»dan foydalaning."
        : "Kamera ochilmadi (telefonda HTTPS talab qilinadi). «Rasm tanlash» tugmasi kamerani baribir ochadi.");
    }
  };

  useEffect(() => { if (!open) stopCam(); return stopCam; }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const d = await toJpeg(v, v.videoWidth, v.videoHeight);
    setShots((s) => [...s, d].slice(0, MAX_SHOTS));
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr("");
    try {
      const out: string[] = [];
      for (const f of Array.from(files).slice(0, MAX_SHOTS)) out.push(await fileToJpeg(f));
      setShots((s) => [...s, ...out].slice(0, MAX_SHOTS));
    } catch { setErr("Rasmni o'qib bo'lmadi"); }
  };

  const send = async () => {
    if (!shots.length) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: shots }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Rasmni o'qib bo'lmadi");
      if (!data.rows?.length) throw new Error("Rasmdan tovar qatorlari topilmadi. Hujjat to'liq va yorug' tushganiga ishonch hosil qiling.");
      onResult(data as ScanResult);
      stopCam(); setOpen(false); setShots([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Xatolik");
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setErr(""); void startCam(); }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-sky-700">
        <Camera size={14} /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
              <span className="font-semibold text-slate-900">Nakladnoyni skaner qilish</span>
              <span className="text-xs text-slate-500">Hujjatni to&apos;liq, yorug&apos;da suratga oling · {shots.length}/{MAX_SHOTS}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Yopish"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="relative overflow-hidden rounded-lg bg-slate-900" style={{ aspectRatio: "4 / 3" }}>
                <video ref={videoRef} playsInline muted className={cn("h-full w-full object-contain", !live && "opacity-0")} />
                {!live && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-300">
                    <Camera size={28} className="opacity-60" />
                    <span>{camErr || "Kamera ochilmoqda…"}</span>
                    {camErr && <button type="button" onClick={startCam} className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"><RefreshCw size={12} /> Qayta urinish</button>}
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={!live || shots.length >= MAX_SHOTS} onClick={shoot}><Camera size={15} /> Suratga olish</Button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
                  <ImageIcon size={14} /> Rasm tanlash
                  <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                </label>
                <span className="text-xs text-slate-500">Uzun nakladnoyni bir necha qismga bo&apos;lib olsangiz ham bo&apos;ladi</span>
              </div>

              {shots.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {shots.map((s, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s} alt={`${i + 1}-surat`} className="h-24 w-32 rounded-md border border-slate-200 object-cover" />
                      <button type="button" onClick={() => setShots((x) => x.filter((_, j) => j !== i))} aria-label="O'chirish"
                        className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-red-600"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}

              {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            </div>

            <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
              <span className="text-xs text-slate-500">Rasmdan o&apos;qilgan qatorlar jadvalga tushadi — saqlashdan oldin tekshirib, tuzatib olasiz.</span>
              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Bekor qilish</Button>
                <Button type="button" size="sm" disabled={!shots.length || busy} onClick={send}>
                  <ScanLine size={15} /> {busy ? "O'qilmoqda…" : `Rasmdan o'qish${shots.length ? ` (${shots.length})` : ""}`}
                </Button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
