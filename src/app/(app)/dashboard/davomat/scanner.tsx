"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, CheckCircle2, Info, Loader2, LogIn, LogOut, Maximize2, Minimize2, RefreshCw, ScanFace, Volume2, VolumeX, XCircle } from "lucide-react";
import { scanFaceAction } from "./actions";
import {
  BlinkDetector, beep, describeFace, detectFaces, drawBox, jumped, loadFaceApi, snapshot, useCamera, useWakeLock,
  type Box, type FaceApi, type FaceFrame,
} from "./face-engine";
import { AUTO_OUT_AFTER_MIN, FACE_MODES, SCAN_PROBES, type FaceMode, type FaceScanResult } from "@/lib/face-id-const";
import type { FaceLogRow } from "@/lib/face-id";
import { Badge, Card, Checkbox, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

type Tone = "idle" | "work" | "busy" | "ok" | "fail";
const TONE_COLOR: Record<Tone, string> = { idle: "#94a3b8", work: "#f59e0b", busy: "#0ea5e9", ok: "#10b981", fail: "#ef4444" };
const TONE_PILL: Record<Tone, string> = {
  idle: "bg-slate-900/70 text-white",
  work: "bg-amber-500 text-slate-950",
  busy: "bg-sky-500 text-white",
  ok: "bg-emerald-500 text-white",
  fail: "bg-red-600 text-white",
};

/** Yuz kengligi kadr enining kamida shuncha qismi (≈ kameradan 1–1,5 m). Uzoqdagi yuz vektori ishonchsiz. */
const MIN_FACE = 0.16;
/** Natija ekranda turadigan vaqt. */
const RESULT_MS = 3500;
/** Muvaffaqiyatdan keyin shu odam kadrdan chiqmaguncha (yoki shuncha vaqt) qayta skaner qilinmaydi. */
const LEAVE_MS = 6000;
/** Ko'z yumib ochilgandan keyin vektor shu vaqt ichida olinsin — aks holda jonlilik qaytadan. */
const BLINK_VALID_MS = 4000;

type LogItem = { key: string; kind: "in" | "out" | "already" | "fail"; time: string; name: string; position: string; text: string; img: string | null };

const hhmm = () => new Date().toTimeString().slice(0, 5);
const PREFS = "faceid-kiosk";
type Prefs = { mode: FaceMode; liveness: boolean; sound: boolean; camera: string };

function readPrefs(): Partial<Prefs> {
  try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<Prefs>; } catch { return {}; }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* xususiy oyna — eslab qolinmaydi */ }
}

/**
 * Face ID davomat skaneri (kiosk). Kamera doim ochiq, xodim kelib kameraga qaraydi:
 *   1) bitta yuz, yetarlicha yaqin; 2) ko'z yumib ochadi (jonlilik); 3) ketma-ket 3 kadrdan yuz vektori;
 *   4) server kimligini topadi va "Keldi" / "Ketdi" yozadi; 5) natija 3,5 s ko'rinadi, keyingi xodim.
 */
export function FaceScanner({ initialLog, enrolled, total, canEnroll }: { initialLog: FaceLogRow[]; enrolled: number; total: number; canEnroll: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useCamera(videoRef);
  const { start: startCam } = cam;
  const [api, setApi] = useState<FaceApi | null>(null);
  const [apiError, setApiError] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({ mode: "auto", liveness: true, sound: true, camera: "" });
  const prefsRef = useRef(prefs);
  const [msg, setMsg] = useState<{ tone: Tone; text: string }>({ tone: "idle", text: "Kamera tayyorlanmoqda…" });
  const [result, setResult] = useState<{ r: FaceScanResult; img: string } | null>(null);
  const [log, setLog] = useState<LogItem[]>(() => initialLog.map((r) => ({
    key: r.key, kind: r.kind, time: r.time, name: r.employee.fullName, position: r.employee.position,
    text: r.kind === "in" ? `Keldi ${r.time}` : `Ketdi ${r.time}`,
    img: r.photo ? `/dashboard/davomat/kadr?a=${r.attendanceId}&k=${r.kind}` : null,
  })));
  const [full, setFull] = useState(false);
  useWakeLock(cam.live);

  const setPref = (p: Partial<Prefs>) => setPrefs((cur) => { const next = { ...cur, ...p }; savePrefs(next); return next; });
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);

  // Model va kamera — sahifa ochilganda (sozlamalar shu kompyuterda eslab qolinadi)
  useEffect(() => {
    let alive = true;
    const saved = readPrefs();
    setPrefs((cur) => ({ ...cur, ...saved }));
    startCam(saved.camera || undefined);
    loadFaceApi().then((a) => { if (alive) setApi(a); }).catch(() => { if (alive) setApiError("Yuz modeli yuklanmadi — internetni tekshirib sahifani yangilang"); });
    return () => { alive = false; };
  }, [startCam]);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrapRef.current?.requestFullscreen().catch(() => {});
  };

  // ── Skaner tsikli ──
  useEffect(() => {
    if (!api || !cam.live) return;
    let stopped = false;
    let timer = 0;
    const st = { blink: new BlinkDetector(), last: null as Box | null, probes: [] as number[][], photo: "", blinkAt: 0, until: 0, leave: false, leaveAt: 0, noFace: 0 };
    const reset = () => { st.blink = new BlinkDetector(); st.probes = []; st.photo = ""; st.blinkAt = 0; };
    const say = (tone: Tone, text: string) => setMsg((m) => (m.tone === tone && m.text === text ? m : { tone, text }));
    const draw = (boxes: Box[], tone: Tone) => drawBox(canvasRef.current, videoRef.current, boxes, TONE_COLOR[tone]);
    const next = (ms: number) => { if (!stopped) timer = window.setTimeout(tick, ms); };

    async function tick() {
      const v = videoRef.current;
      if (stopped || !api) return;
      if (!v || v.readyState < 2 || document.hidden) return next(300);
      const now = performance.now();
      if (now < st.until) return next(200);
      if (st.until) { st.until = 0; setResult(null); }

      let faces: FaceFrame[];
      try { faces = await detectFaces(api, v); } catch { return next(500); }
      if (stopped) return;
      if (!faces.length) {
        draw([], "idle");
        st.noFace ||= now;
        if (now - st.noFace > 700) { st.leave = false; st.last = null; reset(); }
        say("idle", "Kameraga qarang — yuzingiz ramkaga tushsin");
        return next(120);
      }
      st.noFace = 0;
      // Hozirgina belgilangan xodim hali kadrda — u chiqib ketguncha kutamiz
      if (st.leave && now - st.leaveAt < LEAVE_MS) { draw(faces.map((f) => f.box), "ok"); say("ok", "Keyingi xodim kelsin"); return next(150); }
      st.leave = false;
      if (faces.length > 1) { reset(); draw(faces.map((f) => f.box), "fail"); say("fail", "Kadrda faqat bitta odam tursin"); return next(150); }

      const f = faces[0]!;
      if (jumped(st.last, f.box)) reset(); // boshqa odam kirgan bo'lishi mumkin — jonlilik qaytadan
      st.last = f.box;
      if (f.box.width < v.videoWidth * MIN_FACE) { draw([f.box], "work"); say("work", "Yaqinroq keling"); return next(120); }

      const p = prefsRef.current;
      if (p.liveness && !st.blinkAt) {
        if (!st.blink.push(f)) { draw([f.box], "work"); say("work", "Ko'zingizni bir marta yumib oching"); return next(60); }
        st.blinkAt = now;
      }
      if (p.liveness && now - st.blinkAt > BLINK_VALID_MS) { reset(); return next(60); }

      draw([f.box], "busy");
      say("busy", "Tekshirilmoqda…");
      let d: Awaited<ReturnType<typeof describeFace>> = null;
      try { d = await describeFace(api, v); } catch { /* keyingi kadr */ }
      if (stopped) return;
      if (!d || jumped(st.last, d.frame.box)) return next(60);
      st.probes.push(d.descriptor);
      if (!st.photo) st.photo = snapshot(v, d.frame.box);
      if (st.probes.length < SCAN_PROBES) return next(40);

      const photo = st.photo, probes = st.probes;
      reset();
      let r: FaceScanResult;
      try { r = await scanFaceAction({ probes, photo, mode: p.mode }); }
      catch { r = { ok: false, code: "BAD_REQUEST", error: "Server bilan aloqa uzildi — internetni tekshiring" }; }
      if (stopped) return;
      if (prefsRef.current.sound) beep(r.ok);
      setResult({ r, img: photo });
      const item: LogItem | null = r.ok
        ? { key: `${Date.now()}`, kind: r.kind, time: r.time ?? hhmm(), name: r.employee.fullName, position: r.employee.position, text: r.text, img: photo }
        : r.employee ? { key: `${Date.now()}`, kind: "fail", time: hhmm(), name: r.employee.fullName, position: r.employee.position, text: r.error, img: photo } : null;
      if (item) setLog((l) => [item, ...l].slice(0, 200));
      st.until = performance.now() + RESULT_MS;
      if (r.ok) { st.leave = true; st.leaveAt = st.until; }
      say(r.ok ? "ok" : "fail", r.ok ? `${r.employee.fullName} — ${r.text}` : r.error);
      draw([], r.ok ? "ok" : "fail");
      next(200);
    }
    next(0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [api, cam.live]);

  const ins = log.filter((l) => l.kind === "in").length;
  const outs = log.filter((l) => l.kind === "out").length;
  const ready = !!api && cam.live;
  const blocker = apiError || cam.error;

  return (
    <div ref={wrapRef} className={cn("grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0", full && "h-screen overflow-auto bg-white p-4")}>
      <div className="space-y-3">
        <Card padded={false} className="overflow-hidden">
          <div className={cn("relative bg-slate-950", full ? "h-[78vh]" : "aspect-[4/3] sm:aspect-video")}>
            <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full -scale-x-100 object-contain" />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-contain" />

            {/* Holat — tepada */}
            {ready && !result && (
              <div className="absolute inset-x-0 top-3 flex justify-center px-3">
                <div className={cn("flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur sm:text-base", TONE_PILL[msg.tone])}>
                  {msg.tone === "busy" ? <Loader2 size={18} className="animate-spin" /> : <ScanFace size={18} />}
                  <span>{msg.text}</span>
                </div>
              </div>
            )}

            {/* Natija — pastda */}
            {result && <ResultCard r={result.r} img={result.img} />}

            {/* Yuklanish / xato */}
            {(!ready || blocker) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
                {blocker ? (
                  <>
                    <XCircle size={36} className="text-red-400" />
                    <div className="max-w-md text-sm">{blocker}</div>
                    <button type="button" onClick={() => (apiError ? location.reload() : startCam(prefs.camera || undefined))} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900">
                      <RefreshCw size={15} /> Qayta urinish
                    </button>
                  </>
                ) : (
                  <>
                    <Loader2 size={32} className="animate-spin text-slate-300" />
                    <div className="text-sm text-slate-300">{!cam.live ? "Kamera ochilmoqda — brauzer so'rasa, ruxsat bering" : "Yuz modeli yuklanmoqda… (birinchi marta ~7 MB, keyin tez ochiladi)"}</div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Boshqaruv */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-slate-100 px-4 py-3">
            <div role="radiogroup" aria-label="Rejim" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {FACE_MODES.map((m) => (
                <button
                  key={m.value} type="button" role="radio" aria-checked={prefs.mode === m.value}
                  onClick={() => setPref({ mode: m.value })}
                  className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition pointer-coarse:py-2.5", prefs.mode === m.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900")}
                >
                  {m.value === "in" ? <LogIn size={14} /> : m.value === "out" ? <LogOut size={14} /> : <ScanFace size={14} />}{m.label}
                </button>
              ))}
            </div>
            <Checkbox label="Jonlilik (ko'z yumib ochish)" checked={prefs.liveness} onChange={(e) => setPref({ liveness: e.target.checked })} />
            <div className="ml-auto flex items-center gap-2">
              {cam.devices.length > 1 && (
                <Select aria-label="Kamera" value={cam.deviceId} onChange={(e) => { setPref({ camera: e.target.value }); startCam(e.target.value); }} className="h-9 w-44">
                  {cam.devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </Select>
              )}
              <button type="button" onClick={() => setPref({ sound: !prefs.sound })} title={prefs.sound ? "Ovozni o'chirish" : "Ovozni yoqish"} aria-label={prefs.sound ? "Ovozni o'chirish" : "Ovozni yoqish"} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 pointer-coarse:h-11 pointer-coarse:w-11">
                {prefs.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button type="button" onClick={toggleFull} title={full ? "To'liq ekrandan chiqish" : "To'liq ekran (kiosk)"} aria-label={full ? "To'liq ekrandan chiqish" : "To'liq ekran"} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 pointer-coarse:h-11 pointer-coarse:w-11">
                {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
        </Card>
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <Info size={13} className="mt-0.5 shrink-0" />
          {prefs.mode === "auto"
            ? `Avto: bugun kelmagan xodim — «Keldi», kelgan xodim (${AUTO_OUT_AFTER_MIN} daqiqadan keyin) — «Ketdi». Smena boshida navbat bo'lsa «Keldi» rejimini tanlang.`
            : prefs.mode === "in" ? "Faqat kelishni belgilaydi — kelgan xodim qayta o'tsa hech narsa o'zgarmaydi." : "Faqat ketishni belgilaydi — bugun kelgani belgilangan bo'lishi kerak."}
          {!prefs.liveness && " Jonlilik o'chiq: surat bilan aldash mumkin — faqat nazorat ostida ishlating."}
        </p>
      </div>

      <aside className="space-y-3">
        <Card>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Bugun skaner orqali</span>
            <span className="flex gap-1.5"><Badge color="green">Keldi {ins}</Badge><Badge color="blue">Ketdi {outs}</Badge></span>
          </div>
          <div className="mt-2 text-xs text-slate-500">Yuzi ro&apos;yxatda: <b className="tabular text-slate-700">{enrolled}</b> / {total} xodim
            {canEnroll && <> · <Link href="/dashboard/davomat?tab=yuzlar" className="font-medium text-slate-700 hover:underline">ro&apos;yxatga olish</Link></>}
          </div>
          {enrolled === 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Hali hech kimning yuzi ro&apos;yxatga olinmagan — skaner hech kimni tanimaydi. {canEnroll ? "Avval «Yuzlarni ro'yxatga olish» bo'limida xodimlarni qo'shing." : "Otdel kadrga ayting."}
            </div>
          )}
        </Card>
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-medium">Jurnal</div>
          <ul className={cn("divide-y divide-slate-100 overflow-auto", full ? "max-h-[70vh]" : "max-h-[32rem]")}>
            {log.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">Bugun hali hech kim skanerdan o&apos;tmadi</li>}
            {log.map((l) => (
              <li key={l.key} className="flex items-center gap-3 px-4 py-2">
                <span className="flex h-11 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 text-slate-300">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {l.img ? <img src={l.img} alt="" className="h-full w-full object-cover" /> : <Camera size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.name}</span>
                  <span className={cn("block truncate text-xs", l.kind === "fail" ? "text-red-600" : "text-slate-500")}>{l.text}</span>
                </span>
                <span className="shrink-0">
                  {l.kind === "in" ? <Badge color="green">Keldi</Badge> : l.kind === "out" ? <Badge color="blue">Ketdi</Badge> : l.kind === "already" ? <Badge>Avval</Badge> : <Badge color="red">Rad</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function ResultCard({ r, img }: { r: FaceScanResult; img: string }) {
  const ok = r.ok && r.kind !== "already";
  const tone = !r.ok ? "border-red-400 bg-red-50 text-red-950" : ok ? "border-emerald-400 bg-emerald-50 text-emerald-950" : "border-slate-300 bg-white text-slate-900";
  const who = r.employee;
  return (
    <div className="absolute inset-x-3 bottom-3 flex justify-center" aria-live="assertive">
      <div className={cn("flex w-full max-w-xl items-center gap-4 rounded-2xl border-2 p-3 shadow-2xl animate-fade-up", tone)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt="" className="h-24 w-20 shrink-0 rounded-lg object-cover sm:h-28 sm:w-24" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {r.ok ? <CheckCircle2 size={22} className={ok ? "text-emerald-600" : "text-slate-500"} /> : <XCircle size={22} className="text-red-600" />}
            <span className="truncate text-lg font-semibold sm:text-xl">{who ? who.fullName : "Tanilmadi"}</span>
          </div>
          {who && <div className="truncate text-xs opacity-70">{who.position}</div>}
          <div className="mt-1 text-base font-semibold sm:text-lg">{r.ok ? r.text : r.error}</div>
          {r.ok && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs opacity-80">
              {r.hint && <span>{r.hint}</span>}
              <span>o&apos;xshashlik {r.similarity}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
