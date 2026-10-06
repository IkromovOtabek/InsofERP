"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, ScanFace, Search, User, UserPlus, X, XCircle } from "lucide-react";
import { deleteFaceAction, enrollFaceAction } from "./actions";
import { describeFace, detectFaces, drawBox, loadFaceApi, snapshot, useCamera, type FaceApi } from "./face-engine";
import type { RosterRow } from "@/lib/face-id";
import { DeleteButton } from "@/components/delete-button";
import { Badge, Button, Callout, Card, Checkbox, Empty, Input, Table, Td, Th, Tr } from "@/components/ui";
import { date } from "@/lib/format";
import { cn } from "@/lib/utils";


/** Otdel kadr: faol xodimlar ro'yxati — kimning yuzi skanerga ro'yxatga olingan, kimniki yo'q. */
export function FaceRosterPanel({ rows }: { rows: RosterRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "no" | "yes">("all");
  const [target, setTarget] = useState<RosterRow | null>(null);
  const [note, setNote] = useState("");
  const enrolled = rows.filter((r) => r.samples > 0).length;
  const needle = q.trim().toLowerCase();
  const list = rows.filter((r) =>
    (filter === "all" || (filter === "yes") === r.samples > 0) &&
    (!needle || r.fullName.toLowerCase().includes(needle) || r.position.toLowerCase().includes(needle)));

  return (
    <>
      {note && <Callout tone="success">{note}</Callout>}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="relative w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki lavozim" className="pl-9" aria-label="Qidirish" />
          </div>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm">
            {([["all", `Hammasi ${rows.length}`], ["no", `Ro'yxatda yo'q ${rows.length - enrolled}`], ["yes", `Ro'yxatda ${enrolled}`]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded-md px-3 py-1.5 font-medium transition pointer-coarse:py-2.5", filter === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900")}>{label}</button>
            ))}
          </div>
          <p className="w-full text-xs text-slate-500">
            Xodim kamera oldida turadi: to&apos;g&apos;ri qaraydi, boshini ikki tomonga biroz buradi — 5 ta namuna olinadi (10–20 soniya).
            Rasm emas, yuzdan hisoblangan 128 sonli vektor saqlanadi; xodim ishdan bo&apos;shasa skaner uni tanimaydi.
          </p>
        </div>
        <Table>
          <thead><tr><Th>Kadr</Th><Th>Xodim</Th><Th>Face ID</Th><Th right></Th></tr></thead>
          <tbody>
            {list.length === 0 && <Empty text={rows.length ? "Mos xodim topilmadi" : "Faol xodim yo'q"} icon={User} />}
            {list.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <span className="flex h-12 w-10 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 text-slate-300">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.templatePhotoId ? <img src={`/dashboard/davomat/kadr?t=${r.templatePhotoId}`} alt="" className="h-full w-full object-cover" /> : <ScanFace size={16} />}
                  </span>
                </Td>
                <Td><div className="font-medium">{r.fullName}</div><div className="text-xs text-slate-500">{r.position}</div></Td>
                <Td>{r.samples > 0 ? <Badge color="green">Ro&apos;yxatda · {r.samples} namuna · {date(new Date(r.enrolledAt!))}</Badge> : <Badge>Yo&apos;q</Badge>}</Td>
                <Td right>
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" size="sm" variant={r.samples ? "secondary" : "primary"} onClick={() => { setNote(""); setTarget(r); }}>
                      {r.samples ? <RefreshCw size={14} /> : <UserPlus size={14} />} {r.samples ? "Qayta olish" : "Ro'yxatga olish"}
                    </Button>
                    {r.samples > 0 && <DeleteButton action={deleteFaceAction} id={r.id} name={r.fullName} title="Yuz ma'lumotini o'chirish" />}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {target && <EnrollDialog employee={target} onClose={() => setTarget(null)} onDone={(n) => { setTarget(null); setNote(n); router.refresh(); }} />}
    </>
  );
}

type StepKind = "center" | "side" | "other";
const STEPS: { kind: StepKind; text: string }[] = [
  { kind: "center", text: "Kameraga to'g'ri qarang" },
  { kind: "center", text: "Shunday turing" },
  { kind: "side", text: "Boshingizni sekin bir tomonga burang" },
  { kind: "other", text: "Endi boshqa tomonga burang" },
  { kind: "center", text: "Yana to'g'ri qarang" },
];
/** Qadam shuncha vaqtda bajarilmasa — talab yumshatiladi (har qanday sifatli kadr olinadi). */
const RELAX_MS = 8000;

function EnrollDialog({ employee, onClose, onDone }: { employee: RosterRow; onClose: () => void; onDone: (note: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useCamera(videoRef);
  const { start: startCam, stop: stopCam } = cam;
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<"consent" | "capture" | "saving" | "error">("consent");
  const [api, setApi] = useState<FaceApi | null>(null);
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "saving") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  const begin = () => {
    setError(""); setStep(0); setPhase("capture"); setAttempt((n) => n + 1);
    if (!cam.live) startCam();
    loadFaceApi().then(setApi).catch(() => { setError("Yuz modeli yuklanmadi — internetni tekshiring"); setPhase("error"); });
  };

  // Namuna olish tsikli — har "Kamerani ochish" / "Qayta urinish" (attempt) yangi tsikl
  useEffect(() => {
    if (!api || !cam.live || !attempt) return;
    let stopped = false, timer = 0;
    const samples: { descriptor: number[]; score: number }[] = [];
    let photo = "", side = 0, i = 0, stepAt = performance.now(), lastAt = 0;
    const next = (ms: number) => { if (!stopped) timer = window.setTimeout(tick, ms); };
    const say = (t: string) => setHint((h) => (h === t ? h : t));

    async function tick() {
      const v = videoRef.current;
      if (stopped || !api) return;
      if (!v || v.readyState < 2) return next(200);
      let faces;
      try { faces = await detectFaces(api, v); } catch { return next(400); }
      if (stopped) return;
      drawBox(canvasRef.current, v, faces.map((f) => f.box), faces.length === 1 ? "#0ea5e9" : "#ef4444");
      if (!faces.length) { say("Yuz ko'rinmayapti — kameraga qarang"); return next(150); }
      if (faces.length > 1) { say("Kadrda faqat xodimning o'zi tursin"); return next(150); }
      const f = faces[0]!;
      if (f.box.width < v.videoWidth * 0.2) { say("Yaqinroq keling"); return next(150); }
      const now = performance.now();
      const s = STEPS[i]!;
      const dy = f.yaw - 0.5;
      const relaxed = now - stepAt > RELAX_MS;
      // Burilish jag' chizig'idan taxminiy (soch yopsa noaniq) — vaqt o'tsa har qanday sifatli kadr olinadi
      const ok = relaxed || (s.kind === "center" ? Math.abs(dy) < 0.07
        : s.kind === "side" ? Math.abs(dy) > 0.09
        : Math.sign(dy) === -side && Math.abs(dy) > 0.09);
      say(s.text);
      if (!ok || now - lastAt < 350) return next(80);
      let d: Awaited<ReturnType<typeof describeFace>> = null;
      try { d = await describeFace(api, v); } catch { /* keyingi kadr */ }
      if (stopped) return;
      if (!d || d.frame.score < 0.6) return next(80);
      samples.push({ descriptor: d.descriptor, score: Math.round(d.frame.score * 1000) / 1000 });
      if (!photo && s.kind === "center") photo = snapshot(v, d.frame.box);
      if (s.kind === "side") side = Math.sign(dy) || 1;
      i++; stepAt = now; lastAt = now;
      setStep(i);
      if (i < STEPS.length) return next(80);

      // Hammasi olindi — saqlash
      setPhase("saving"); say("Saqlanmoqda…");
      drawBox(canvasRef.current, v, [], "#10b981");
      let r: Awaited<ReturnType<typeof enrollFaceAction>>;
      try { r = await enrollFaceAction({ employeeId: employee.id, samples, photo, consent: true }); }
      catch { r = { ok: false, error: "Server bilan aloqa uzildi — qayta urining" }; }
      if (stopped) return;
      if (r.ok) { stopCam(); doneRef.current(r.note); }
      else { setError(r.error); setPhase("error"); }
    }
    next(0);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [api, cam.live, attempt, employee.id, stopCam]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`${employee.fullName} — yuzni ro'yxatga olish`}>
      <div className="max-h-full w-full max-w-2xl overflow-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Yuzni ro&apos;yxatga olish</div>
            <div className="truncate text-lg font-semibold">{employee.fullName}</div>
            <div className="truncate text-xs text-slate-500">{employee.position}{employee.samples ? " · eski namunalar yangisi bilan almashtiriladi" : ""}</div>
          </div>
          <button type="button" onClick={onClose} disabled={phase === "saving"} aria-label="Yopish" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"><X size={18} /></button>
        </div>

        {phase === "consent" ? (
          <div className="space-y-4 px-5 py-5 text-sm">
            <p className="text-slate-600">
              Skaner xodimni yuzidan taniydi. Saqlanadi: yuzdan hisoblangan 128 sonli vektor (undan suratni tiklab bo&apos;lmaydi)
              va ro&apos;yxatga olishdagi bitta kichik kadr. Ma&apos;lumot faqat davomat uchun; istalgan vaqtda «O&apos;chirish» bilan yo&apos;q qilinadi.
            </p>
            <Checkbox label="Xodimga tushuntirdim va uning roziligini oldim" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Bekor qilish</Button>
              <Button type="button" onClick={begin} disabled={!consent}><ScanFace size={16} /> Kamerani ochish</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-950">
              <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full -scale-x-100 object-contain" />
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-contain" />
              {(cam.error || !cam.live || !api) && phase === "capture" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-200">
                  {cam.error ? <><XCircle size={28} className="text-red-400" />{cam.error}</> : <><Loader2 size={28} className="animate-spin" />{!cam.live ? "Kamera ochilmoqda…" : "Yuz modeli yuklanmoqda…"}</>}
                </div>
              )}
              {cam.live && api && phase !== "error" && (
                <div className="absolute inset-x-0 top-3 flex justify-center px-3">
                  <div className={cn("flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg", phase === "saving" ? "bg-emerald-500 text-white" : "bg-sky-500 text-white")}>
                    {phase === "saving" ? <Loader2 size={16} className="animate-spin" /> : <ScanFace size={16} />}{hint || STEPS[0]!.text}
                  </div>
                </div>
              )}
            </div>
            <ol className="grid grid-cols-5 gap-2">
              {STEPS.map((s, k) => (
                <li key={k} className={cn("flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center text-[11px] leading-tight", k < step ? "border-emerald-200 bg-emerald-50 text-emerald-800" : k === step && phase === "capture" ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-200 text-slate-400")}>
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold", k < step ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600")}>{k < step ? <Check size={12} /> : k + 1}</span>
                  {s.kind === "center" ? "To'g'ri" : s.kind === "side" ? "Bir yon" : "Boshqa yon"}
                </li>
              ))}
            </ol>
            {phase === "error" && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <span>{error}</span>
                <Button type="button" size="sm" variant="secondary" onClick={begin}><RefreshCw size={14} /> Qayta urinish</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
