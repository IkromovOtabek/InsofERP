"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as FaceApiModule from "@vladmandic/face-api";

/**
 * Face ID skanerining brauzer qismi: face-api (TensorFlow.js) bilan yuz topish, 68 nuqta va 128 sonli yuz vektori.
 * Modellar `/api/face-models` dan (~7 MB, bir marta yuklanib keshda qoladi). Hisob videokartada (WebGL),
 * bo'lmasa protsessorda. Kadr serverga yuborilmaydi — faqat vektor va kichik dalil-kadr (`snapshot`).
 */

export type FaceApi = typeof FaceApiModule;
export type Box = { x: number; y: number; width: number; height: number };
export type FaceFrame = {
  box: Box;
  /** Yuz topish ishonchi, 0..1 */
  score: number;
  /** Ko'z ochiqligi (Eye Aspect Ratio, ikki ko'z o'rtachasi): ochiq ≈ 0,25–0,35, yumuq ≈ 0,1 */
  ear: number;
  /** Bosh burilishi: burun uchi jag' chizig'ining qayerida — 0,5 to'g'ri, 0,35 / 0,65 — yonga burilgan */
  yaw: number;
};

const MODEL_URL = "/api/face-models";
let loading: Promise<FaceApi> | null = null;

/** Kutubxona va modellarni bir marta yuklaydi (sahifalar orasida ham qayta yuklanmaydi). */
export function loadFaceApi(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const api = await import("@vladmandic/face-api");
      // Turlarda `setBackend`/`ready` e'lon qilinmagan, lekin ichidagi tfjs to'liq
      const tf = api.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      try { if (!(await tf.setBackend("webgl"))) await tf.setBackend("cpu"); } catch { await tf.setBackend("cpu"); }
      await tf.ready();
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return api;
    })();
    // Tarmoq xatosidan keyin qayta urinish mumkin bo'lsin; sababi konsolda (WebGL yo'q, model 404...)
    loading.catch((e) => { console.error("[face-id] model yuklanmadi:", e); loading = null; });
  }
  return loading;
}

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Eye Aspect Ratio (Soukupová & Čech, 2016): ko'z balandligining eniga nisbati. */
const eyeAR = (e: Pt[]) => (dist(e[1]!, e[5]!) + dist(e[2]!, e[4]!)) / (2 * dist(e[0]!, e[3]!) || 1);

type Landmarked = { detection: { box: Box; score: number }; landmarks: { getLeftEye(): Pt[]; getRightEye(): Pt[]; getJawOutline(): Pt[]; getNose(): Pt[] } };

function frameOf(r: Landmarked): FaceFrame {
  const { box, score } = r.detection;
  const lm = r.landmarks;
  const jaw = lm.getJawOutline();
  const tip = lm.getNose()[3]!; // 68 nuqtadagi 30-nuqta — burun uchi
  const span = jaw[16]!.x - jaw[0]!.x;
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    score,
    ear: (eyeAR(lm.getLeftEye()) + eyeAR(lm.getRightEye())) / 2,
    yaw: span ? (tip.x - jaw[0]!.x) / span : 0.5,
  };
}

const options = (api: FaceApi, inputSize: number) => new api.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 });

/** Kadrdagi barcha yuzlar (har kadrda — tez: vektorsiz). */
export async function detectFaces(api: FaceApi, input: HTMLVideoElement): Promise<FaceFrame[]> {
  const res = await api.detectAllFaces(input, options(api, 320)).withFaceLandmarks();
  return res.map((r) => frameOf(r as unknown as Landmarked));
}

/** Eng aniq yuzning vektori (og'irroq — faqat kerak bo'lganda). */
export async function describeFace(api: FaceApi, input: HTMLVideoElement): Promise<{ frame: FaceFrame; descriptor: number[] } | null> {
  const r = await api.detectSingleFace(input, options(api, 416)).withFaceLandmarks().withFaceDescriptor();
  if (!r) return null;
  return { frame: frameOf(r as unknown as Landmarked), descriptor: Array.from(r.descriptor, (v) => Math.round(v * 1e6) / 1e6) };
}

/**
 * Jonlilik: ko'z yumib ochilganini kuzatadi. Chop etilgan surat yoki qotgan rasm ko'z yummaydi.
 * Ochiq ko'z darajasi (asos) shu odamning o'zidan olinadi — ko'zi tor/katta odamga ham mos.
 */
export class BlinkDetector {
  private base = 0;
  private frames = 0;
  private closed = false;
  private yaw = 0.5;
  blinked = false;
  push(f: Pick<FaceFrame, "ear" | "yaw">) {
    if (this.blinked || !Number.isFinite(f.ear) || f.ear <= 0) return this.blinked;
    this.frames++;
    const turning = Math.abs(f.yaw - this.yaw) > 0.06; // bosh burilsa bir ko'z "torayadi" — bu yumish emas
    this.yaw = f.yaw;
    // Dastlabki kadrlar — ochiq ko'z asosi; keyin asosdan 35% pastga tushib, qayta ochilsa — yumib ochdi
    if (this.frames <= 3) { this.base = Math.max(this.base, f.ear); return false; }
    if (!this.closed) {
      if (f.ear < this.base * 0.65 && !turning) this.closed = true;
      else if (f.ear > this.base * 0.85) this.base = this.base * 0.8 + f.ear * 0.2;
    } else if (f.ear > this.base * 0.85) this.blinked = true;
    return this.blinked;
  }
}

/** Yuz atrofidan kichik JPEG (dalil uchun) — ko'zgu emas, haqiqiy tasvir. */
export function snapshot(video: HTMLVideoElement, box: Box, max = 360): string {
  const vw = video.videoWidth, vh = video.videoHeight;
  const w = Math.min(vw, Math.max(box.width, box.height) * 1.7);
  const h = Math.min(vh, w * 1.2);
  const x = Math.max(0, Math.min(vw - w, box.x + box.width / 2 - w / 2));
  const y = Math.max(0, Math.min(vh - h, box.y + box.height * 0.45 - h / 2));
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(video, x, y, w, h, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Ikki ketma-ket kadrdagi yuz "sakrab" ketdimi — boshqa odam kadrga kirgan bo'lishi mumkin. */
export function jumped(a: Box | null, b: Box) {
  if (!a) return false;
  const shift = Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
  return shift > a.width * 0.5 || Math.abs(b.width - a.width) > a.width * 0.4;
}

/** Ramkadagi yuzni chizadi. Kanva video bilan bir xil ko'zgulanadi (CSS). */
export function drawBox(canvas: HTMLCanvasElement | null, video: HTMLVideoElement | null, boxes: Box[], color: string) {
  if (!canvas || !video || !video.videoWidth) return;
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, canvas.width / 200);
  for (const b of boxes) {
    const r = Math.min(b.width, b.height) * 0.12;
    const [x, y, w, h] = [b.x - b.width * 0.08, b.y - b.height * 0.18, b.width * 1.16, b.height * 1.28];
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.stroke();
  }
}

let audio: AudioContext | null = null;
/** Qisqa ovozli signal: muvaffaqiyat — baland, xato — past. */
export function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(ok ? 880 : 240, t);
    if (ok) o.frequency.setValueAtTime(1320, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (ok ? 0.3 : 0.45));
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + 0.5);
  } catch { /* ovozsiz ham ishlaydi */ }
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Kameraga ruxsat berilmagan — manzil satridagi kamera belgisidan ruxsat bering va sahifani yangilang";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Kamera topilmadi — kompyuterga kamera ulang yoki boshqasini tanlang";
  if (name === "NotReadableError") return "Kamera boshqa dasturda band (Zoom, Telegram...) — o'shani yoping va qayta urining";
  return "Kamera ochilmadi — qayta urining";
}

/**
 * Old (yuz) kamerasi: ochish, yopish, almashtirish. Sahifadan chiqqanda va tab yashirilganda ham kamera
 * o'chmaydi (kiosk) — faqat komponent yopilganda.
 */
export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState("");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  const start = useCallback(async function start(id?: string): Promise<void> {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? "Bu brauzerda kamera ishlamaydi — Chrome, Edge yoki Safari'ning yangi versiyasini oching" : "Kamera faqat xavfsiz (https://) manzilda ishlaydi");
      return;
    }
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = s;
      const v = videoRef.current;
      if (v) { v.srcObject = s; await v.play().catch(() => {}); }
      setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId ?? id ?? "");
      setLive(true);
      // Ruxsatdan keyin nomlar ko'rinadi — bir nechta kamera bo'lsa tanlash uchun
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "videoinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Kamera ${i + 1}` })));
    } catch (e) {
      // Eslab qolingan kamera endi ulanmagan bo'lsa — standart old kameraga qaytamiz
      const name = (e as { name?: string })?.name;
      if (id && (name === "OverconstrainedError" || name === "NotFoundError")) return start();
      setError(cameraError(e));
    }
  }, [stop, videoRef]);

  useEffect(() => stop, [stop]);
  return { live, error, devices, deviceId, start, stop };
}

/** Kiosk planshet/noutbuk uxlab qolmasin (ekran o'chmasin) — qo'llab-quvvatlansa. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: { release(): Promise<void> } | null = null;
    let gone = false;
    const take = () => {
      (navigator as unknown as { wakeLock: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock
        .request("screen").then((l) => { if (gone) l.release(); else lock = l; }).catch(() => {});
    };
    const onVis = () => { if (document.visibilityState === "visible") take(); };
    take();
    document.addEventListener("visibilitychange", onVis);
    return () => { gone = true; document.removeEventListener("visibilitychange", onVis); lock?.release().catch(() => {}); };
  }, [active]);
}
