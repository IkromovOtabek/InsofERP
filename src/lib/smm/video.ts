/**
 * AI studiya: Reels motion-video (9:16, 1080×1920, 30 kadr/s, H.264 + AAC — Instagram Reels talabi).
 *
 * Faqat Claude: ssenariy bilan birga har sahna dizaynini ham Claude tuzadi — ranglar, SVG grafika, matn joylashuvi,
 * animatsiya va o'tish. Rasm, video yoki ovoz yaratuvchi tashqi AI yo'q — sahnani server o'zi chizadi:
 *   · fon — media kutubxonadan kadr (rasmga kamera harakati, video kesib olinadi) yoki Claude grafikasi (gradient + SVG);
 *   · matn — har element (yorliq, sarlavha qatorlari, urg'u chizig'i, qo'shimcha qator) alohida PNG bo'lib,
 *     ketma-ket animatsiya bilan kiradi (sharp chizadi, ffmpeg harakatlantiradi);
 *   · sahnalar orasida `xfade` o'tishlari, oxirida qorayish.
 * Video ovozsiz (jim AAC yo'lagi bor — ba'zi pleyerlar ovozsiz faylni qabul qilmaydi); musiqa Instagram'da qo'yiladi.
 *
 * Navbat: `SmmVideoJob` (QUEUED → GENERATING → RENDERING → DONE/FAILED), bir vaqtda bitta ish — VPS band bo'lib qolmasin.
 * Muhit: SMM_FFMPEG (standart `ffmpeg`), SMM_FFPROBE.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { SCENE_ANIMS, SCENE_CAMERAS, SCENE_LAYOUTS, SCENE_TRANSITIONS, type SceneCamera, type SceneTransition } from "./labels";
import { mediaPath, SMM_DIR } from "./media";

const run = promisify(execFile);
const W = 1080, H = 1920, FPS = 30;
/** Sahnalar orasidagi o'tish, soniya */
const XF = 0.45;
/** Reels interfeysi yopadigan joylar: tepada profil, pastda izoh va tugmalar */
const SAFE_TOP = 280, SAFE_BOTTOM = 420, PAD_X = 72;
const FONT = "Montserrat, Inter, 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";

/** Matn maydoni: uzunini kesadi (AI yoki eski ish uzun matn bersa — xato emas) */
const str = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : ""), z.string());
const hex = (fallback: string) => z.preprocess((v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback), z.string());

export const sceneSchema = z.object({
  durationSec: z.preprocess((v) => Math.min(15, Math.max(1, Number(v) || 3)), z.number()),
  kicker: str(40), // kichik yorliq: «01», «FBS blok»
  text: str(140), // asosiy ekrandagi matn
  sub: str(200), // qo'shimcha qator
  layout: z.enum(SCENE_LAYOUTS).catch("bottom"),
  anim: z.enum(SCENE_ANIMS).catch("fade-up"),
  camera: z.enum(SCENE_CAMERAS).catch("push-in"),
  transition: z.enum(SCENE_TRANSITIONS).catch("fade"), // keyingi sahnaga o'tish
  colors: z.tuple([hex("#0f172a"), hex("#1e3a8a")]).catch(["#0f172a", "#1e3a8a"]), // grafik fon gradienti
  art: z.string().max(20_000).nullish().catch(null), // Claude chizgan SVG (faqat <svg> ichi)
  mediaId: z.string().regex(/^[a-z0-9]{16,40}$/).nullish().catch(null), // kutubxonadan kadr
});
export const specSchema = z.object({
  title: str(160),
  accent: hex("#f59e0b"),
  scenes: z.array(sceneSchema).min(1).max(12),
});
export type VideoSpec = z.infer<typeof specSchema>;
export type Scene = z.infer<typeof sceneSchema>;

const env = (k: string) => (process.env[k] ?? "").trim();
const ffmpegBin = () => env("SMM_FFMPEG") || "ffmpeg";

let ffmpegOk: boolean | null = null;
export async function ffmpegReady(): Promise<boolean> {
  // Topilmasa keshlanmaydi — ffmpeg o'rnatilgach xizmatni qayta ishga tushirmasdan ham ishlaydi
  if (ffmpegOk) return true;
  ffmpegOk = await run(ffmpegBin(), ["-version"], { timeout: 10_000 }).then(() => true, () => false);
  return ffmpegOk;
}

const ff = (args: string[], timeoutMs = 10 * 60_000) =>
  run(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });

/* ───────── Grafika (sharp → PNG) ───────── */

const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function png(svg: string, out: string): Promise<void> {
  const { default: sharp } = await import("sharp");
  await sharp(Buffer.from(svg)).png().toFile(out);
}

/**
 * Claude chizgan SVG — ishonchsiz matn: tashqi fayl/havola, skript, uslub bloki va animatsiya teglari bo'lsa tashlanadi.
 * Faqat ichki havola `url(#id)` ruxsat (gradient). Natija faqat sharp (librsvg) bilan PNG ga aylanadi, brauzerga berilmaydi.
 */
export function safeArt(svg: string | null | undefined): string | null {
  const s = (svg ?? "").replace(/<\?xml[^>]*\?>/gi, "").trim();
  if (!s || s.length > 20_000) return null;
  if (/<\s*\/?\s*(script|foreignObject|image|use|iframe|style|a|feImage|animate\w*|set)\b|\bon\w+\s*=|href|<!|@import|javascript:|data:/i.test(s)) return null;
  if (/url\s*\(\s*['"]?\s*[^#'"\s]/i.test(s)) return null;
  return s;
}

/** Grafik fon (2× o'lchamda — kamera harakati titramasin): gradient + urg'u nuri + Claude grafikasi */
function backdropSvg(sc: Scene, accent: string, art: string | null): string {
  const [c0, c1] = sc.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="__bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>
      <radialGradient id="__glow" cx="0.85" cy="0.12" r="0.7"><stop offset="0" stop-color="${accent}" stop-opacity="0.32"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#__bg)"/>
    <rect width="${W}" height="${H}" fill="url(#__glow)"/>
    ${art ? `<g>${art}</g>` : ""}
  </svg>`;
}

/** Kadr ustidagi qoraytirish — matn har qanday kadrda o'qilsin */
function scrimSvg(layout: Scene["layout"]): string {
  const g = layout === "top"
    ? `<stop offset="0" stop-color="#000" stop-opacity="0.8"/><stop offset="0.55" stop-color="#000" stop-opacity="0.1"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/>`
    : layout === "center"
      ? `<stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/>`
      : `<stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="0.4" stop-color="#000" stop-opacity="0.1"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">${g}</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#s)"/></svg>`;
}

/** Uzun matnni qatorlarga bo'lish (so'z bo'yicha) */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

/** Qalin shriftda bitta harfning taxminiy kengligi (o'lchamga nisbatan) */
const CHAR = 0.64;
const box = (h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}">${body}</svg>`;

type Block = { svg: string; h: number; mt: number };

/** Matn bloki elementlari (yuqoridan pastga): yorliq, sarlavha qatorlari, urg'u chizig'i, qo'shimcha qator */
function textBlocks(sc: Scene, accent: string): Block[] {
  const out: Block[] = [];
  const room = W - 2 * PAD_X;
  const kicker = sc.kicker.toUpperCase();
  if (kicker) {
    const size = 34, h = 66, w = Math.min(room, Math.round(kicker.length * size * 0.74 + 52));
    out.push({ h, mt: 0, svg: box(h, `<rect x="${PAD_X}" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="${accent}"/><text x="${PAD_X + 26}" y="${Math.round(h / 2 + size * 0.36)}" font-family="${FONT}" font-weight="800" font-size="${size}" letter-spacing="2" fill="#0b0f19">${xml(kicker)}</text>`) });
  }
  if (sc.text) {
    // Eng katta o'lchamdan boshlab — 4 qatorga sig'guncha kichraytiriladi
    let size = 112, lines = wrap(sc.text, Math.floor(room / (size * CHAR)));
    while (size > 60 && (lines.length > 4 || Math.max(...lines.map((l) => l.length)) * size * CHAR > room)) {
      size -= 8;
      lines = wrap(sc.text, Math.floor(room / (size * CHAR)));
    }
    const lh = Math.round(size * 1.12);
    lines.slice(0, 5).forEach((l, i) => out.push({ h: lh, mt: i === 0 && out.length ? 30 : 0, svg: box(lh, `<text x="${PAD_X}" y="${Math.round(size * 0.9)}" font-family="${FONT}" font-weight="800" font-size="${size}" fill="#ffffff">${xml(l)}</text>`) }));
    out.push({ h: 10, mt: 26, svg: box(10, `<rect x="${PAD_X}" y="0" width="150" height="10" rx="5" fill="${accent}"/>`) });
  }
  if (sc.sub) {
    const size = 42, lh = 58, lines = wrap(sc.sub, Math.floor(room / (size * 0.56))).slice(0, 4);
    const h = lines.length * lh + 12;
    out.push({ h, mt: out.length ? 30 : 0, svg: box(h, lines.map((l, i) => `<text x="${PAD_X}" y="${i * lh + size}" font-family="${FONT}" font-weight="500" font-size="${size}" fill="#ffffff" fill-opacity="0.9">${xml(l)}</text>`).join("")) });
  }
  return out;
}

/* ───────── Harakat (ffmpeg ifodalari) ───────── */

/** Fon kamerasi: 2× kattalikdagi bitta kadrdan `frames` ta kadr */
function camera(cam: SceneCamera, frames: number): string {
  const p = `on/${Math.max(1, frames - 1)}`;
  const cx = "iw/2-(iw/zoom/2)", cy = "ih/2-(ih/zoom/2)";
  const zp = cam === "push-in" ? `z='1+0.12*${p}':x='${cx}':y='${cy}'`
    : cam === "pull-out" ? `z='1.12-0.12*${p}':x='${cx}':y='${cy}'`
      : cam === "pan-left" ? `z='1.12':x='(iw-iw/zoom)*(1-${p})':y='${cy}'`
        : cam === "pan-right" ? `z='1.12':x='(iw-iw/zoom)*${p}':y='${cy}'`
          : `z='1':x='0':y='0'`;
  return `zoompan=${zp}:d=${frames}:s=${W}x${H}:fps=${FPS}`;
}

/** Element kirishi: ease-out (kubik), `st` dan `d` soniya davomida joyiga keladi */
function enter(anim: Scene["anim"], st: number, d: number, y: number): { x: string; y: string } {
  const rest = `pow(1-clip((t-${st.toFixed(2)})/${d},0,1),3)`;
  switch (anim) {
    case "fade-up": return { x: "0", y: `${y}+70*${rest}` };
    case "stagger": return { x: "0", y: `${y}+110*${rest}` };
    case "slide-left": return { x: `240*${rest}`, y: String(y) };
    case "slide-right": return { x: `-240*${rest}`, y: String(y) };
    default: return { x: "0", y: String(y) };
  }
}

/* ───────── Montaj ───────── */

/**
 * Bitta sahna → 1080×1920 ovozsiz bo'lak. `lead` — oldingi sahnadan o'tish vaqti: bo'lak shuncha uzunroq,
 * matn esa o'tish tugagach kiradi.
 */
export async function renderScene(sc: Scene, src: { file: string; kind: "IMAGE" | "VIDEO" } | null, out: string, tmp: string, i: number, opts: { accent: string; lead: number }): Promise<number> {
  const len = sc.durationSec + opts.lead;
  const frames = Math.ceil(len * FPS);
  const args: string[] = [];
  const graph: string[] = [];

  // 0 — fon
  if (src?.kind === "VIDEO") {
    args.push("-stream_loop", "-1", "-t", len.toFixed(3), "-i", src.file);
    graph.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS[b0]`);
  } else if (src) {
    args.push("-i", src.file);
    graph.push(`[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,${camera(sc.camera, frames)}[b0]`);
  } else {
    const bg = path.join(tmp, `bg${i}.png`);
    const art = safeArt(sc.art);
    // Noto'g'ri SVG bo'lsa — grafikasiz gradient (sahna yiqilmasin)
    await png(backdropSvg(sc, opts.accent, art), bg).catch(() => png(backdropSvg(sc, opts.accent, null), bg));
    args.push("-i", bg);
    graph.push(`[0:v]setsar=1,${camera(sc.camera, frames)}[b0]`);
  }
  const still = (file: string) => args.push("-loop", "1", "-framerate", String(FPS), "-t", len.toFixed(3), "-i", file);
  let input = 1, last = "b0";

  // 1 — kadr ustida qoraytirish
  if (src) {
    const f = path.join(tmp, `scrim${i}.png`);
    await png(scrimSvg(sc.layout), f);
    still(f);
    graph.push(`[${last}][${input}:v]overlay=0:0[b${input}]`);
    last = `b${input}`; input++;
  }

  // Matn elementlari — ketma-ket kiradi
  const blocks = textBlocks(sc, opts.accent);
  const total = blocks.reduce((a, b) => a + b.mt + b.h, 0);
  let y = sc.layout === "top" ? SAFE_TOP : sc.layout === "center" ? Math.round((H - total) / 2) : H - SAFE_BOTTOM - total;
  const step = sc.anim === "stagger" ? 0.2 : 0.09;
  for (const [k, b] of blocks.entries()) {
    y += b.mt;
    const f = path.join(tmp, `t${i}_${k}.png`);
    await png(b.svg, f);
    still(f);
    const st = opts.lead + 0.15 + k * step, d = 0.6;
    const m = enter(sc.anim, st, d, y);
    graph.push(`[${input}:v]format=rgba,fade=t=in:st=${st.toFixed(2)}:d=${d}:alpha=1[l${input}]`);
    graph.push(`[${last}][l${input}]overlay=x='${m.x}':y='${m.y}':eval=frame[b${input}]`);
    last = `b${input}`; input++;
    y += b.h;
  }
  graph.push(`[${last}]format=yuv420p,trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS[v]`);

  args.push("-filter_complex", graph.join(";"), "-map", "[v]", "-an", "-t", len.toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", String(FPS), "-pix_fmt", "yuv420p", "-threads", "2", out);
  await ff(args);
  return len;
}

/** Bo'laklarni o'tishlar bilan yig'ish + jim ovoz yo'lagi. Qaytaradi: davomiylik, soniya */
export async function assemble(parts: { file: string; len: number; transition: SceneTransition }[], out: string): Promise<number> {
  const total = parts.reduce((a, p) => a + p.len, 0) - XF * (parts.length - 1);
  const args = parts.flatMap((p) => ["-i", p.file]);
  args.push("-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=44100:cl=stereo");
  const graph = parts.map((_, i) => `[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p,setsar=1[p${i}]`);
  let last = "p0", at = parts[0]!.len;
  for (let i = 1; i < parts.length; i++) {
    graph.push(`[${last}][p${i}]xfade=transition=${parts[i - 1]!.transition}:duration=${XF}:offset=${(at - XF).toFixed(3)}[x${i}]`);
    last = `x${i}`;
    at += parts[i]!.len - XF;
  }
  graph.push(`[${last}]fade=t=out:st=${Math.max(0, total - 0.5).toFixed(3)}:d=0.5,format=yuv420p[v]`);
  args.push("-filter_complex", graph.join(";"), "-map", "[v]", "-map", `${parts.length}:a`, "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", String(FPS), "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-movflags", "+faststart", out);
  await ff(args, 15 * 60_000);
  return total;
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

    // 1. Sahnalar (kutubxonadagi kadr o'chirilgan bo'lsa — grafik fon)
    const media = await db.smmMedia.findMany({ where: { id: { in: spec.scenes.map((s) => s.mediaId).filter((x): x is string => !!x) } } });
    const parts: { file: string; len: number; transition: SceneTransition }[] = [];
    for (const [i, sc] of spec.scenes.entries()) {
      const m = media.find((x) => x.id === sc.mediaId);
      const file = m ? mediaPath(m.fileName) : null;
      const out = path.join(tmp, `s${i}.mp4`);
      const len = await renderScene(sc, m && file ? { file, kind: m.kind } : null, out, tmp, i, { accent: spec.accent, lead: i ? XF : 0 });
      parts.push({ file: out, len, transition: sc.transition });
      await db.smmVideoJob.update({ where: { id: job.id }, data: { progress: 5 + Math.round(((i + 1) / spec.scenes.length) * 75) } });
    }

    // 2. Montaj
    await db.smmVideoJob.update({ where: { id: job.id }, data: { status: "RENDERING", progress: 85 } });
    const final = path.join(tmp, "final.mp4");
    await assemble(parts, final);

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
