"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon, RefreshCw, SwitchCamera, Trash2, User, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Surat uzun tomoni shuncha pikselgacha kichraytiriladi — 3x4 uchun yetarli, yuklash tez. */
const MAX_SIDE = 1200;
/** Shundan katta fayl brauzerning o'zida kichraytiriladi (o'qib bo'lmasa — asl fayl ketadi). */
const SHRINK_OVER = 1.5 * 1024 * 1024;
/** 3x4 surat nisbati (eni / bo'yi) — kamera kadri shu o'lchamga kesiladi. */
const ASPECT = 3 / 4;

/** Rasmni kichraytirib (kerak bo'lsa kesib) JPEG qiladi. */
function toJpeg(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Promise<Blob | null> {
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  c.getContext("2d")!.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
}

/** Kadr o'rtasidan 3x4 bo'lak — yon tomonlari ortiqcha bo'lsa kesiladi. */
function crop3x4(w: number, h: number) {
  let sw = w, sh = w / ASPECT;
  if (sh > h) { sh = h; sw = h * ASPECT; }
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

function loadImage(f: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Rasm o'qilmadi")); };
    img.src = url;
  });
}

/**
 * Tanlangan fayl: katta bo'lsa kichraytiriladi. HEIC kabi brauzer o'qiy olmaydigan
 * formatda kichraytirish o'tmaydi — bunday fayl asl holicha serverga ketadi.
 */
async function prepare(f: File): Promise<File> {
  if (!f.type.startsWith("image/") || f.size <= SHRINK_OVER) return f;
  try {
    const img = await loadImage(f);
    const b = await toJpeg(img, 0, 0, img.naturalWidth, img.naturalHeight);
    if (!b) return f;
    return new File([b], `${f.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } catch { return f; }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Rasm o'qilmadi"));
    r.readAsDataURL(b);
  });
}

/**
 * Surat tanlash: fayldan, sudrab tashlash orqali yoki shu yerning o'zida kamerada olish.
 *
 * Har qanday vaziyatda ishlaydi: kompyuterda kamera oynasi ochiladi, telefonda esa
 * brauzer kamerani bermasa «Rasm tanlash» tugmasi telefon kamerasini ochadi.
 * Kamera kadri formaga oddiy fayl bo'lib tushadi (`name` maydoni); brauzer fayl
 * maydonini dasturiy to'ldirishga ruxsat bermasa — `<name>Data` yashirin maydonida
 * data-URL bo'lib ketadi, server ikkalasini ham qabul qiladi.
 */
export function PhotoPicker({ name = "photo", accept, currentSrc, hint, onPick }: {
  name?: string;
  accept: string;
  /** Kartada turgan surat (bor bo'lsa) — yangisi tanlanmaguncha shu ko'rinadi. */
  currentSrc?: string | null;
  hint?: string;
  onPick?: (has: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState("");
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [cam, setCam] = useState(false);
  const [live, setLive] = useState(false);
  const [camErr, setCamErr] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const fileRef = useRef<HTMLInputElement>(null);
  const camFileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);

  const show = (u: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = u;
    setUrl(u);
    onPick?.(!!u);
  };
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  /** Faylni forma maydoniga qo'yadi; brauzer ruxsat bermasa data-URL bilan yuboriladi. */
  const apply = async (f: File | null) => {
    setErr("");
    let ok = false;
    try {
      const dt = new DataTransfer();
      if (f) dt.items.add(f);
      fileRef.current!.files = dt.files;
      ok = true;
    } catch { ok = false; }
    if (f && !ok) {
      try { setDataUrl(await blobToDataUrl(f)); } catch { setErr("Suratni tayyorlab bo'lmadi"); return; }
    } else {
      setDataUrl("");
    }
    show(f ? URL.createObjectURL(f) : null);
  };

  const take = async (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) {
      setErr("Surat rasm bo'lishi kerak (JPG, PNG, WEBP)");
      return;
    }
    await apply(await prepare(f));
  };

  /* ───────── Kamera ───────── */

  const stopCam = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setLive(false); };

  const startCam = async (mode: "user" | "environment" = facing) => {
    setCamErr("");
    stopCam();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr("Bu brauzerda kamera ochilmaydi. «Telefon kamerasi» tugmasidan foydalaning.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: 1280 } }, audio: false });
      streamRef.current = s;
      setLive(true);
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
    } catch (e) {
      const n = e instanceof DOMException ? e.name : "";
      setCamErr(n === "NotAllowedError"
        ? "Kameraga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering yoki «Telefon kamerasi»dan foydalaning."
        : n === "NotFoundError"
          ? "Kamera topilmadi. «Telefon kamerasi» yoki «Fayl tanlash» tugmasidan foydalaning."
          : "Kamera ochilmadi (telefonda HTTPS talab qilinadi). «Telefon kamerasi» tugmasi kamerani baribir ochadi.");
    }
  };

  useEffect(() => { if (!cam) stopCam(); return stopCam; }, [cam]);
  useEffect(() => {
    if (!cam) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCam(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cam]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const c = crop3x4(v.videoWidth, v.videoHeight);
    const b = await toJpeg(v, c.sx, c.sy, c.sw, c.sh);
    if (!b) { setCamErr("Kadr olinmadi, qayta urinib ko'ring"); return; }
    await apply(new File([b], `surat-${Date.now()}.jpg`, { type: "image/jpeg" }));
    setCam(false);
  };

  const preview = url ?? currentSrc ?? null;

  return (
    <div>
      {/* Formaga shu maydon ketadi; kamera kadri ham shu yerga tushadi */}
      <input
        ref={fileRef} name={name} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(f); }}
      />
      {/* Fayl maydonini to'ldirib bo'lmagan holat uchun zaxira yo'l */}
      {dataUrl && <input type="hidden" name={`${name}Data`} value={dataUrl} />}
      {/* Telefonda kamerani to'g'ridan-to'g'ri ochadigan maydon */}
      <input
        ref={camFileRef} type="file" accept="image/*" capture="user" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void take(f).then(() => setCam(false)); }}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files?.[0]); }}
        title="Surat tanlash (faylni sudrab tashlasangiz ham bo'ladi)"
        className={cn(
          "flex h-[150px] w-[120px] items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 transition hover:border-slate-400 hover:text-slate-600",
          drag && "border-sky-500 bg-sky-50 text-sky-600",
        )}
      >
        {preview
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={preview} alt="Surat" className="h-full w-full object-cover" />
          : <span className="flex flex-col items-center gap-1 px-2 text-center text-[11px] leading-tight"><User size={26} /> 3x4 surat</span>}
      </button>

      <div className="mt-2 flex w-[120px] flex-col gap-1.5">
        <button type="button" onClick={() => { setCam(true); void startCam(); }}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700">
          <Camera size={14} /> Rasmga olish
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
          <ImageIcon size={14} /> Fayl tanlash
        </button>
        {url && (
          <button type="button" onClick={() => { setDataUrl(""); void apply(null); }}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:text-red-600">
            <Trash2 size={13} /> Bekor qilish
          </button>
        )}
      </div>
      {hint && <p className="mt-1 w-[120px] text-[11px] leading-tight text-slate-500">{hint}</p>}
      {err && <p className="mt-1 w-[120px] text-[11px] leading-tight text-red-600">{err}</p>}

      {cam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setCam(false); }}>
          <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-2xl">
            <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
              <span className="font-semibold text-slate-900">Suratga olish</span>
              <span className="text-xs text-slate-500">Yuz kadr o&apos;rtasida, yorug&apos;da bo&apos;lsin</span>
              <button type="button" onClick={() => setCam(false)} aria-label="Yopish"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="relative mx-auto w-full max-w-xs overflow-hidden rounded-lg bg-slate-900" style={{ aspectRatio: "3 / 4" }}>
                <video ref={videoRef} playsInline muted className={cn("h-full w-full object-cover", !live && "opacity-0", facing === "user" && "scale-x-[-1]")} />
                {live && <div className="pointer-events-none absolute inset-[8%] rounded-md border-2 border-dashed border-white/50" />}
                {!live && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-300">
                    <Camera size={26} className="opacity-60" />
                    <span>{camErr || "Kamera ochilmoqda…"}</span>
                    {camErr && <button type="button" onClick={() => void startCam()} className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"><RefreshCw size={12} /> Qayta urinish</button>}
                  </div>
                )}
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">Kadr 3x4 o&apos;lchamga o&apos;zi kesiladi</p>
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={() => { const m = facing === "user" ? "environment" : "user"; setFacing(m); void startCam(m); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
                <SwitchCamera size={14} /> {facing === "user" ? "Orqa kamera" : "Old kamera"}
              </button>
              <button type="button" onClick={() => camFileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
                <ImageIcon size={14} /> Telefon kamerasi
              </button>
              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setCam(false)}>Bekor qilish</Button>
                <Button type="button" size="sm" disabled={!live} onClick={() => void shoot()}><Camera size={15} /> Suratga olish</Button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
