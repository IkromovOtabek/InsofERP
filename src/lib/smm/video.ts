/**
 * AI studiya: Reels montaji (9:16, 1080×1920, 30 kadr/s, H.264 + AAC — Instagram Reels talabi).
 *
 * Navbat: `SmmVideoJob` (QUEUED → GENERATING → RENDERING → DONE/FAILED), bir vaqtda bitta ish —
 * VPS protsessori band bo'lib qolmasin. Har sahna:
 *   · kadr — media kutubxonadan (video kesib olinadi, rasm sekin yaqinlashadi) yoki AI video (Veo) yaratadi;
 *   · ekrandagi matn — kadr ustida, pastki uchdan birda;
 *   · ovoz — ElevenLabs (kalit bo'lsa), sahna davomiyligi ovozga moslashadi.
 * Tayyor video media kutubxonaga tushadi va (post bo'lsa) postga biriktiriladi.
 *
 * Ekrandagi matn sharp bilan PNG qilib chiziladi va kadr ustiga qo'yiladi (ffmpeg `drawtext` har yig'ilmada bo'lmaydi).
 *
 * Muhit: SMM_FFMPEG (standart `ffmpeg`), GEMINI_API_KEY + SMM_VIDEO_MODEL (AI kadr),
 *        ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID (ovoz).
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { mediaPath, SMM_DIR } from "./media";

const run = promisify(execFile);
const W = 1080, H = 1920, FPS = 30;

export const sceneSchema = z.object({
  text: z.string().max(140).default(""), // ekrandagi matn
  voice: z.string().max(600).default(""), // ovoz matni
  durationSec: z.number().min(1).max(15).default(3),
  mediaId: z.string().regex(/^[a-z0-9]{16,40}$/).nullish(), // kutubxonadan kadr
  aiPrompt: z.string().max(800).nullish(), // kadr yo'q bo'lsa — AI yaratadi
  aiMediaId: z.string().nullish(), // AI yaratgan kadr (qayta urinishda qayta yaratilmasin)
  voiceFile: z.string().nullish(),
});
export const specSchema = z.object({
  title: z.string().max(160),
  scenes: z.array(sceneSchema).min(1).max(12),
  voice: z.boolean().default(true),
  voiceId: z.string().max(60).nullish(),
});
export type VideoSpec = z.infer<typeof specSchema>;
export type Scene = z.infer<typeof sceneSchema>;

const env = (k: string) => (process.env[k] ?? "").trim();
export const ttsReady = () => !!env("ELEVENLABS_API_KEY");
export const aiVideoReady = () => !!env("GEMINI_API_KEY");
const ffmpegBin = () => env("SMM_FFMPEG") || "ffmpeg";
const ffprobeBin = () => env("SMM_FFPROBE") || ffmpegBin().replace(/ffmpeg$/, "ffprobe");

let ffmpegOk: boolean | null = null;
export async function ffmpegReady(): Promise<boolean> {
  if (ffmpegOk !== null) return ffmpegOk;
  ffmpegOk = await run(ffmpegBin(), ["-version"], { timeout: 10_000 }).then(() => true, () => false);
  return ffmpegOk;
}

const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Ekrandagi matn: shaffof fonda yarim shaffof qora plashka + oq qalin matn (1080 kenglik) */
async function textOverlay(text: string, out: string): Promise<void> {
  const lines = wrap(text, 22).split("\n");
  const size = 62, lh = 80, padX = 44, padY = 30;
  const boxW = Math.min(W - 80, Math.max(...lines.map((l) => l.length)) * size * 0.64 + padX * 2);
  const boxH = lines.length * lh + padY * 2;
  const x0 = (W - boxW) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${boxH}">
    <rect x="${x0}" y="0" width="${boxW}" height="${boxH}" rx="28" fill="#000" fill-opacity="0.58"/>
    ${lines.map((l, i) => `<text x="${W / 2}" y="${padY + lh * i + size}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="#fff" text-anchor="middle">${xml(l)}</text>`).join("")}
  </svg>`;
  const { default: sharp } = await import("sharp");
  await sharp(Buffer.from(svg)).png().toFile(out);
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run(ffprobeBin(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeout: 30_000 });
  const d = Number(stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

const ff = (args: string[], timeoutMs = 10 * 60_000) =>
  run(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });

/* ───────── Ovoz (ElevenLabs) ───────── */

async function tts(text: string, voiceId: string | null | undefined, out: string): Promise<void> {
  const voice = voiceId || env("ELEVENLABS_VOICE_ID") || "pNInz6obpgDQGcFmaJgB";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: env("ELEVENLABS_MODEL") || "eleven_multilingual_v2" }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Ovoz yaratilmadi (ElevenLabs ${res.status})`);
  await writeFile(out, new Uint8Array(await res.arrayBuffer()));
}

/* ───────── AI kadr (Google Veo, Gemini API) ───────── */

async function veoClip(prompt: string, out: string): Promise<void> {
  const key = env("GEMINI_API_KEY");
  const model = env("SMM_VIDEO_MODEL") || "veo-3.0-fast-generate-001";
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const start = await fetch(`${base}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: "9:16" } }),
    signal: AbortSignal.timeout(60_000),
  });
  const op = (await start.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
  if (!start.ok || !op.name) throw new Error(`AI kadr boshlanmadi: ${op.error?.message ?? start.status}`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const r = await fetch(`${base}/${op.name}`, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(30_000) });
    const j = (await r.json().catch(() => ({}))) as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } } };
    if (j.error) throw new Error(`AI kadr yaratilmadi: ${j.error.message ?? ""}`);
    if (!j.done) continue;
    const uri = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error("AI kadr yaratilmadi (xavfsizlik filtri yoki bo'sh javob) — sahnaga o'z videongizni qo'ying");
    const file = await fetch(uri, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(120_000) });
    if (!file.ok) throw new Error("AI kadrni yuklab bo'lmadi");
    await writeFile(out, new Uint8Array(await file.arrayBuffer()));
    return;
  }
  throw new Error("AI kadr juda uzoq tayyorlandi — keyinroq qayta urinib ko'ring");
}

/** Yangi fayl → media kutubxona yozuvi */
async function addToLibrary(file: string, title: string, tags: string[], by: { id: string | null; name: string | null }): Promise<string> {
  const id = randomBytes(12).toString("hex");
  await mkdir(SMM_DIR, { recursive: true });
  const fileName = `${id}.mp4`;
  await rename(file, path.join(SMM_DIR, fileName));
  const size = (await stat(path.join(SMM_DIR, fileName))).size;
  await db.smmMedia.create({ data: { id, kind: "VIDEO", fileName, mime: "video/mp4", size, title: title.slice(0, 160), tags, uploadedById: by.id, uploadedBy: by.name } });
  return id;
}

/* ───────── Montaj ───────── */

/** Bitta sahna → 1080×1920 bo'lak (o'z ovozi yoki jimlik bilan — keyin oddiy concat) */
export async function renderScene(sc: Scene, src: { file: string; kind: "IMAGE" | "VIDEO" } | null, voice: string | null, out: string, tmp: string, i: number): Promise<void> {
  const voiceLen = voice ? await duration(voice) : 0;
  const len = Math.min(15, Math.max(sc.durationSec, voiceLen ? voiceLen + 0.4 : 0));
  const filters: string[] = [];
  if (!src) filters.push(`color=c=0x111827:s=${W}x${H}:d=${len}:r=${FPS}`);
  // Kadr: ekranni to'ldirib kesiladi; rasmga sekin yaqinlashish (Ken Burns) — statik slayd bo'lmasin
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  let v = src ? (src.kind === "IMAGE"
    // Rasm 2 baravar kattalashtirib yaqinlashtiriladi — zoompan titramasin; bitta kadrdan `d` ta kadr chiqadi
    ? `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,zoompan=z='min(zoom+0.0009,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(len * FPS)}:s=${W}x${H}:fps=${FPS}`
    : `[0:v]${fit},fps=${FPS},trim=duration=${len},setpts=PTS-STARTPTS`) : "[0:v]null";
  const overlay = sc.text.trim() ? path.join(tmp, `t${i}.png`) : null;
  if (overlay) await textOverlay(sc.text.trim(), overlay);
  // Boshida va oxirida yengil qorayish — sahnalar silliq ulanadi
  const fades = `fade=t=in:st=0:d=0.25,fade=t=out:st=${Math.max(0, len - 0.25)}:d=0.25,format=yuv420p`;
  // Kirishlar: 0 — kadr, 1 — ovoz/jimlik, 2 — matn (bo'lsa)
  v = overlay ? `${v}[bg];[bg][2:v]overlay=x=0:y=H*0.66,${fades}[v]` : `${v},${fades}[v]`;
  const args: string[] = [];
  if (src?.kind === "IMAGE") args.push("-i", src.file);
  else if (src) args.push("-stream_loop", "-1", "-t", String(len), "-i", src.file);
  else args.push("-f", "lavfi", "-i", filters[0]!);
  if (voice) args.push("-i", voice);
  else args.push("-f", "lavfi", "-t", String(len), "-i", "anullsrc=r=44100:cl=stereo");
  if (overlay) args.push("-i", overlay);
  const a = `[1:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${len},atrim=duration=${len}[a]`;
  args.push("-filter_complex", `${v};${a}`, "-map", "[v]", "-map", "[a]", "-t", String(len),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", String(FPS), "-threads", "2",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", out);
  await ff(args);
}

/** Uzun matnni qatorlarga bo'lish (drawtext o'zi bo'lmaydi) */
function wrap(text: string, max: number): string {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if ((line + " " + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 4).join("\n");
}

/** Navbatdagi bitta ishni bajaradi (rejalashtiruvchi chaqiradi). Bajarilgan bo'lsa — true */
export async function runNextVideoJob(): Promise<boolean> {
  const job = await db.smmVideoJob.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
  if (!job) return false;
  const claim = await db.smmVideoJob.updateMany({ where: { id: job.id, status: "QUEUED" }, data: { status: "GENERATING", attempts: { increment: 1 }, progress: 5, error: null } });
  if (claim.count === 0) return false;
  const tmp = path.join(SMM_DIR, ".tmp", `video-${job.id}`);
  const by = { id: job.createdById, name: job.createdByName };
  try {
    if (!(await ffmpegReady())) throw new Error("Serverda video montaj dasturi (ffmpeg) o'rnatilmagan — administratorga murojaat qiling");
    const spec = specSchema.parse(job.spec);
    await mkdir(tmp, { recursive: true });

    // 1. Kadrlar va ovoz
    const media = await db.smmMedia.findMany({ where: { id: { in: spec.scenes.flatMap((s) => [s.mediaId, s.aiMediaId].filter((x): x is string => !!x)) } } });
    const sources: ({ file: string; kind: "IMAGE" | "VIDEO" } | null)[] = [];
    const voices: (string | null)[] = [];
    for (const [i, sc] of spec.scenes.entries()) {
      let m = media.find((x) => x.id === (sc.mediaId || sc.aiMediaId));
      if (!m && sc.aiPrompt && aiVideoReady()) {
        const clip = path.join(tmp, `ai${i}.mp4`);
        await veoClip(sc.aiPrompt, clip);
        const id = await addToLibrary(clip, `AI kadr: ${spec.title} — ${i + 1}`, ["ai-kadr"], by);
        sc.aiMediaId = id;
        await db.smmVideoJob.update({ where: { id: job.id }, data: { spec } });
        m = (await db.smmMedia.findUnique({ where: { id } })) ?? undefined;
      }
      const file = m ? mediaPath(m.fileName) : null;
      sources.push(m && file ? { file, kind: m.kind } : null);
      let vf: string | null = null;
      if (spec.voice && sc.voice.trim() && ttsReady()) {
        vf = path.join(tmp, `v${i}.mp3`);
        await tts(sc.voice.trim(), spec.voiceId, vf);
      }
      voices.push(vf);
      await db.smmVideoJob.update({ where: { id: job.id }, data: { progress: 5 + Math.round(((i + 1) / spec.scenes.length) * 40) } });
    }

    // 2. Montaj
    await db.smmVideoJob.update({ where: { id: job.id }, data: { status: "RENDERING", progress: 50 } });
    const parts: string[] = [];
    for (const [i, sc] of spec.scenes.entries()) {
      const out = path.join(tmp, `s${i}.mp4`);
      await renderScene(sc, sources[i]!, voices[i]!, out, tmp, i);
      parts.push(out);
      await db.smmVideoJob.update({ where: { id: job.id }, data: { progress: 50 + Math.round(((i + 1) / spec.scenes.length) * 40) } });
    }
    const list = path.join(tmp, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    const final = path.join(tmp, "final.mp4");
    await ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final]);

    // 3. Kutubxonaga va postga
    const mediaId = await addToLibrary(final, `Reels: ${spec.title}`, ["ai-studiya", "reels"], by);
    if (job.contentId) {
      const c = await db.marketingContent.findUnique({ where: { id: job.contentId }, include: { media: true } });
      // Tasdiqlangan postga tegmaymiz (direktor ko'rmagan video chiqib ketmasin) — faqat qoralama/rad etilgan
      if (c && (c.approval === "DRAFT" || c.approval === "REJECTED") && c.media.length < 10) {
        await db.marketingContentMedia.create({ data: { contentId: c.id, mediaId, sort: -1 } });
        if (c.status === "IDEA" || c.status === "SCRIPT" || c.status === "FILMED") await db.marketingContent.update({ where: { id: c.id }, data: { status: "EDITING" } });
      }
    }
    await db.smmVideoJob.update({ where: { id: job.id }, data: { status: "DONE", progress: 100, outputMediaId: mediaId } });
    if (job.createdById) await audit(db, job.createdById, "STATUS_CHANGE", "SmmVideoJob", job.id, { status: "QUEUED" }, { status: "DONE", mediaId });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 400);
    console.error("[smm] video", job.id, msg);
    await db.smmVideoJob.update({ where: { id: job.id }, data: { status: "FAILED", error: /ffmpeg|Command failed/i.test(msg) ? "Montajda xato — kadrlardan birini almashtirib qayta urinib ko'ring" : msg } });
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  return true;
}

/** Jarayon to'xtab qolgan (GENERATING/RENDERING da osilgan) ishlar — xato deb belgilanadi */
export async function failStuckVideoJobs(now = new Date()): Promise<void> {
  await db.smmVideoJob.updateMany({
    where: { status: { in: ["GENERATING", "RENDERING"] }, updatedAt: { lt: new Date(now.getTime() - 40 * 60_000) } },
    data: { status: "FAILED", error: "Montaj uzilib qoldi — «Qayta urinish»ni bosing" },
  });
}
