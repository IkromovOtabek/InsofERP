/**
 * E-commerce shablon suratlari — mahsulot turlari uchun tayyor izometrik rasmlar (`public/shop-templates/<key>.webp`).
 * Vitrinaga mahsulot qo'shilayotganda surat yuklash o'rniga shulardan biri tanlanadi (`lib/shop-templates.ts`).
 *
 *   npx tsx scripts/shop-templates.ts          — barchasini qayta chizadi (natija git'ga qo'shiladi)
 *
 * Rasmlar SVG'da chiziladi va sharp bilan 900×900 WEBP ga aylantiriladi. Matn yo'q — nom ilovada alohida ko'rinadi,
 * shuning uchun bitta shablon bir turdagi har xil mahsulotga (M200, M300 …) yarayveradi.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { SHOP_TEMPLATES } from "../src/lib/shop-templates";

const S = 900;
const OUT = path.join(process.cwd(), "public", "shop-templates");

// ───────────────────────── Izometriya ─────────────────────────

const C = Math.cos(Math.PI / 6), N = 0.5;
/** 3D (x — o'ngga-pastga, y — chapga-pastga, z — yuqoriga) → ekran. */
const P = (x: number, y: number, z: number, o = { x: 450, y: 520 }) => [o.x + (x - y) * C, o.y + (x + y) * N - z] as const;
const pts = (a: (readonly [number, number])[]) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

type Shade = { top: string; left: string; right: string; stroke?: string };
/** Material ranglari: yuqori yuz eng yorug', chap — o'rta, o'ng — to'q. */
const M = {
  concrete: { top: "#d9dcdf", left: "#b9bec4", right: "#9aa0a8", stroke: "#8a9098" },
  concreteDark: { top: "#c4c8cd", left: "#a3a9b0", right: "#868d95", stroke: "#767d86" },
  aerated: { top: "#f4f2ee", left: "#e2ded6", right: "#cbc6bc", stroke: "#b9b3a8" },
  keramzit: { top: "#c98d6a", left: "#ad7352", right: "#8f5c40", stroke: "#7c4f36" },
  paverRed: { top: "#c4564a", left: "#a3443a", right: "#86372f", stroke: "#73302a" },
  paverGray: { top: "#a9adb3", left: "#8f949b", right: "#777c84", stroke: "#686d75" },
  steel: { top: "#7e8794", left: "#666f7c", right: "#525a66", stroke: "#444b56" },
} satisfies Record<string, Shade>;

/** To'g'ri burchakli prizma (x, y, z — burchak, w — x bo'ylab, d — y bo'ylab, h — balandlik). */
function box(x: number, y: number, z: number, w: number, d: number, h: number, m: Shade, o?: { x: number; y: number }) {
  const p = (a: number, b: number, c: number) => P(a, b, c, o);
  const top = [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)];
  const left = [p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)];
  const right = [p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)];
  const st = m.stroke ? ` stroke="${m.stroke}" stroke-width="1.5" stroke-linejoin="round"` : "";
  return `<polygon points="${pts(left)}" fill="${m.left}"${st}/><polygon points="${pts(right)}" fill="${m.right}"${st}/><polygon points="${pts(top)}" fill="${m.top}"${st}/>`;
}

/** Vertikal silindr (halqa, svaya bo'lagi): yuqori ellips + yon devor. */
function cylinder(cx: number, cy: number, r: number, h: number, side: string, sideDark: string, top: string, stroke: string, id: string) {
  const rx = r * 1.0, ry = r * 0.5;
  return `
  <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${side}"/><stop offset="0.55" stop-color="${side}"/><stop offset="1" stop-color="${sideDark}"/></linearGradient></defs>
  <path d="M ${cx - rx} ${cy} L ${cx - rx} ${cy - h} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy - h} L ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy} Z" fill="url(#${id})" stroke="${stroke}" stroke-width="1.5"/>
  <ellipse cx="${cx}" cy="${cy - h}" rx="${rx}" ry="${ry}" fill="${top}" stroke="${stroke}" stroke-width="1.5"/>`;
}

// ───────────────────────── Fon ─────────────────────────

function frame(body: string, tint: [string, string], shadow = { cx: 450, cy: 640, rx: 300, ry: 70 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.38" r="0.75"><stop offset="0" stop-color="${tint[0]}"/><stop offset="1" stop-color="${tint[1]}"/></radialGradient>
    <radialGradient id="sh" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#1b2433" stop-opacity="0.32"/><stop offset="1" stop-color="#1b2433" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#1b2a4c" stroke-opacity="0.05" stroke-width="1"/></pattern>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <rect width="${S}" height="${S}" fill="url(#grid)"/>
  <ellipse cx="${shadow.cx}" cy="${shadow.cy}" rx="${shadow.rx}" ry="${shadow.ry}" fill="url(#sh)"/>
  ${body}
</svg>`;
}

const BG = {
  gray: ["#f7f8fa", "#dfe3e9"] as [string, string],
  warm: ["#fbf7f2", "#ece2d6"] as [string, string],
  blue: ["#f3f6fc", "#d8e1f0"] as [string, string],
  green: ["#f4f8f3", "#dbe6d8"] as [string, string],
};

// ───────────────────────── Rasmlar ─────────────────────────

/** Beton mikser (yon ko'rinish, yumshoq soyalar bilan). */
function mixer() {
  const body = `
  <defs>
    <linearGradient id="drum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f4f7"/><stop offset="0.5" stop-color="#d4d9e0"/><stop offset="1" stop-color="#a9b1bc"/></linearGradient>
    <linearGradient id="cab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f5bd3"/><stop offset="1" stop-color="#1d3f9e"/></linearGradient>
    <linearGradient id="chassis" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4350"/><stop offset="1" stop-color="#252b34"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe3ff"/><stop offset="1" stop-color="#7ea6e0"/></linearGradient>
  </defs>
  <rect x="150" y="520" width="600" height="34" rx="8" fill="url(#chassis)"/>
  <g transform="rotate(-9 420 420)">
    <path d="M 170 430 Q 170 330 300 318 L 560 300 Q 640 300 650 400 Q 655 470 560 500 L 300 520 Q 170 520 170 430 Z" fill="url(#drum)" stroke="#8d96a3" stroke-width="2"/>
    <path d="M 250 330 Q 330 420 290 515" fill="none" stroke="#f08a24" stroke-width="16" stroke-linecap="round" opacity="0.9"/>
    <path d="M 360 315 Q 440 410 400 512" fill="none" stroke="#f08a24" stroke-width="16" stroke-linecap="round" opacity="0.9"/>
    <path d="M 470 305 Q 550 400 510 505" fill="none" stroke="#f08a24" stroke-width="16" stroke-linecap="round" opacity="0.9"/>
    <ellipse cx="650" cy="400" rx="26" ry="62" fill="#9aa3af" stroke="#7d8692" stroke-width="2"/>
  </g>
  <path d="M 640 520 L 640 400 Q 640 380 662 378 L 720 378 Q 742 380 752 402 L 778 470 L 778 520 Z" fill="url(#cab)" stroke="#173583" stroke-width="2"/>
  <path d="M 664 396 L 718 396 Q 730 398 736 410 L 754 458 L 664 458 Z" fill="url(#glass)" stroke="#173583" stroke-width="2"/>
  <rect x="766" y="488" width="16" height="12" rx="3" fill="#ffd25a"/>
  <rect x="190" y="470" width="70" height="52" rx="6" fill="#3b4350"/>
  ${[250, 350, 690].map((x) => `<circle cx="${x}" cy="566" r="44" fill="#1e232b"/><circle cx="${x}" cy="566" r="22" fill="#8b939e"/><circle cx="${x}" cy="566" r="8" fill="#3b4350"/>`).join("")}`;
  return frame(body, BG.blue, { cx: 465, cy: 610, rx: 330, ry: 40 });
}

/** Qurilish qorishmasi: chelak, ichida qorishma, ustida kelma. */
function mortar() {
  const body = `
  <defs>
    <linearGradient id="bucket" x1="0" x2="1"><stop offset="0" stop-color="#3b6fe0"/><stop offset="0.6" stop-color="#2a55c4"/><stop offset="1" stop-color="#1c3e98"/></linearGradient>
    <radialGradient id="mix" cx="0.45" cy="0.4" r="0.7"><stop offset="0" stop-color="#cfd3d8"/><stop offset="1" stop-color="#9aa1aa"/></radialGradient>
  </defs>
  <path d="M 270 330 L 310 620 Q 450 660 590 620 L 630 330 Z" fill="url(#bucket)" stroke="#173583" stroke-width="2"/>
  <ellipse cx="450" cy="330" rx="180" ry="52" fill="#1c3e98" stroke="#173583" stroke-width="2"/>
  <ellipse cx="450" cy="338" rx="162" ry="42" fill="url(#mix)"/>
  <path d="M 330 330 Q 380 300 430 326 Q 480 296 540 322 Q 575 310 590 338" fill="none" stroke="#eef0f2" stroke-width="6" stroke-linecap="round" opacity="0.7"/>
  <path d="M 268 400 Q 450 440 632 400" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="10"/>
  <path d="M 285 330 Q 230 250 330 214" fill="none" stroke="#5d6673" stroke-width="10" stroke-linecap="round"/>
  <g transform="rotate(-28 560 260)">
    <path d="M 470 250 L 650 250 L 610 300 L 500 300 Z" fill="#c7ced6" stroke="#7d8692" stroke-width="2"/>
    <rect x="552" y="190" width="14" height="62" fill="#7d8692"/>
    <rect x="530" y="150" width="58" height="44" rx="14" fill="#c46a2c" stroke="#8d4a1d" stroke-width="2"/>
  </g>`;
  return frame(body, BG.gray, { cx: 450, cy: 640, rx: 230, ry: 40 });
}

/** Beton ustun — baland kvadrat kesimli ustun va yonida yotgan ikkinchisi. */
function column() {
  // Tik turgan ustun (chapda) va yonida yotgan ikkinchisi (o'ngda, oldinroq) — bir-biriga tegmaydi
  const stand = box(-40, -40, 0, 80, 80, 420, M.concrete, { x: 330, y: 590 });
  const lying = box(0, 0, 0, 380, 64, 64, M.concreteDark, { x: 470, y: 520 });
  return frame(stand + lying, BG.gray, { cx: 470, cy: 650, rx: 320, ry: 70 });
}

/** FBS poydevor bloklari — uch blok ustma-ust (g'isht terish tartibida). */
function fbs() {
  const o = { x: 430, y: 560 };
  const w = 300, d = 110, h = 120;
  return frame(
    box(-150, -40, 0, w, d, h, M.concreteDark, o) + box(160, -40, 0, w * 0.6, d, h, M.concreteDark, o) +
    box(-20, -40, h, w, d, h, M.concrete, o),
    BG.gray, { cx: 470, cy: 660, rx: 330, ry: 70 });
}

/** Kovak yopma plita — tekis plita, old yuzida dumaloq kovaklar. */
function hollowSlab() {
  const o = { x: 520, y: 540 };
  const w = 520, d = 220, h = 70;
  const slab2 = box(-300, -110, 0, w, d, h, M.concreteDark, o);
  const slab = box(-300, -110, h, w, d, h, M.concrete, o);
  // Old (chap, y = d) yuzidagi kovaklar
  const holes = [0.12, 0.28, 0.44, 0.6, 0.76, 0.92].map((t) => {
    const [cx, cy] = P(-300 + w, -110 + d * t, h * 1.5, o);
    return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="10" ry="22" fill="#5f6670" transform="rotate(-62 ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
  });
  const holes2 = [0.12, 0.28, 0.44, 0.6, 0.76, 0.92].map((t) => {
    const [cx, cy] = P(-300 + w, -110 + d * t, h * 0.5, o);
    return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="10" ry="22" fill="#525962" transform="rotate(-62 ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
  });
  return frame(slab2 + holes2.join("") + slab + holes.join(""), BG.gray, { cx: 450, cy: 640, rx: 340, ry: 80 });
}

/** Bordyur — uzun tosh, yuqori qirrasi qiya (oldingi yuzi nishabli). */
function curb(m: Shade = M.concrete, tint = BG.gray) {
  const o = { x: 450, y: 560 };
  const parts = [-260, 40].map((x0) => {
    const w = 280, d = 70, h = 150;
    const p = (a: number, b: number, c: number) => P(a, b, c, o);
    const x1 = x0 + w;
    const left = [p(x0, d, 0), p(x1, d, 0), p(x1, d, h - 40), p(x0, d, h - 40)];
    const bevel = [p(x0, d, h - 40), p(x1, d, h - 40), p(x1, d - 30, h), p(x0, d - 30, h)];
    const top = [p(x0, 0, h), p(x1, 0, h), p(x1, d - 30, h), p(x0, d - 30, h)];
    const right = [p(x1, 0, 0), p(x1, d, 0), p(x1, d, h - 40), p(x1, d - 30, h), p(x1, 0, h)];
    const st = `stroke="${m.stroke}" stroke-width="1.5" stroke-linejoin="round"`;
    return `<polygon points="${pts(left)}" fill="${m.left}" ${st}/><polygon points="${pts(right)}" fill="${m.right}" ${st}/><polygon points="${pts(bevel)}" fill="${m.top}" opacity="0.92" ${st}/><polygon points="${pts(top)}" fill="${m.top}" ${st}/>`;
  });
  return frame(parts.join(""), tint, { cx: 470, cy: 650, rx: 330, ry: 60 });
}

/** Trotuar plitkasi / brusschatka — tekis yotqizilgan plitkalar maydoni. */
function pavers(a: Shade, b: Shade, tint: [string, string]) {
  const o = { x: 450, y: 380 };
  const out: string[] = [];
  const W = 92, D = 92, H = 26, gap = 6;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const m = (i + j) % 3 === 0 ? b : a;
    out.push(box(-190 + i * (W + gap), -190 + j * (D + gap), 0, W, D, H, m, o));
  }
  return frame(out.join(""), tint, { cx: 450, cy: 600, rx: 360, ry: 120 });
}

/** Quduq halqasi — ikkita ustma-ust beton halqa. */
function wellRing() {
  const ring = (cy: number, h: number, id: string) =>
    cylinder(450, cy, 210, h, "#c3c8ce", "#8d949d", "#d9dcdf", "#7d848d", id) +
    `<ellipse cx="450" cy="${cy - h}" rx="160" ry="80" fill="#6c737c"/><ellipse cx="450" cy="${cy - h + 8}" rx="150" ry="72" fill="#555c65"/>`;
  return frame(ring(620, 170, "r1") + ring(450, 150, "r2"), BG.gray, { cx: 450, cy: 640, rx: 280, ry: 80 });
}

/** Quduq qopqog'i — yumaloq plita, markazida lyuk teshigi va metall qopqoq. */
function wellLid() {
  const disc = cylinder(450, 560, 240, 70, "#c3c8ce", "#8d949d", "#d9dcdf", "#7d848d", "lid");
  const hatch = `<ellipse cx="520" cy="478" rx="80" ry="40" fill="#3d434b"/><ellipse cx="520" cy="474" rx="70" ry="34" fill="#5a616b" stroke="#2c3138" stroke-width="2"/>
  ${[-40, -20, 0, 20, 40].map((dx) => `<line x1="${520 + dx - 22}" y1="${474 - 6}" x2="${520 + dx + 22}" y2="${474 + 6}" stroke="#2c3138" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`).join("")}`;
  return frame(disc + hatch, BG.gray, { cx: 450, cy: 600, rx: 300, ry: 90 });
}

/** Devor bloklari (gazoblok, keramzit, kovak beton) — terilgan bloklar. */
function blocks(m: Shade, tint: [string, string], hollow = false) {
  const o = { x: 450, y: 560 };
  const w = 200, d = 100, h = 100;
  // Pastda ikkita, ustida bitta (o'rtada) — rassom tartibi: avval pastki qator, keyin ustki
  const items: [number, number, number][] = [[-205, -50, 0], [5, -50, 0], [-100, -50, h]];
  const sorted = items.sort((a, b) => a[2] - b[2] || (a[0] + a[1]) - (b[0] + b[1]));
  let svg = "";
  for (const [x, y, z] of sorted) {
    svg += box(x, y, z, w, d, h, m, o);
    if (hollow) {
      for (const t of [0.28, 0.72]) {
        const [cx, cy] = P(x + w * t, y + d * 0.5, z + h, o);
        svg += `<polygon points="${pts([[cx - 28, cy], [cx, cy - 16], [cx + 28, cy], [cx, cy + 16]])}" fill="#5f6670"/>`;
      }
    }
  }
  return frame(svg, tint, { cx: 450, cy: 650, rx: 340, ry: 90 });
}

/** Svaya — uchi o'tkir uzun kvadrat qoziq, qiya yotgan holda. */
function pile() {
  const o = { x: 300, y: 520 };
  const p = (a: number, b: number, c: number) => P(a, b, c, o);
  const L = 480, s = 70, tip = 110;
  const m = M.concrete;
  const st = `stroke="${m.stroke}" stroke-width="1.5" stroke-linejoin="round"`;
  const bodyBox = box(0, 0, 0, L, s, s, m, o);
  const tipLeft = [p(L, s, 0), p(L + tip, s / 2, s / 2), p(L, s, s)];
  const tipRight = [p(L, 0, 0), p(L, s, 0), p(L + tip, s / 2, s / 2)];
  const tipTop = [p(L, 0, s), p(L, s, s), p(L + tip, s / 2, s / 2)];
  const second = box(-40, 140, 0, L, s, s, M.concreteDark, o);
  return frame(second + bodyBox + `<polygon points="${pts(tipRight)}" fill="${m.right}" ${st}/><polygon points="${pts(tipLeft)}" fill="${m.left}" ${st}/><polygon points="${pts(tipTop)}" fill="${m.top}" ${st}/>`,
    BG.gray, { cx: 470, cy: 650, rx: 330, ry: 70 });
}

/** Peremichka — uzun tor to'sin, ikkitasi ustma-ust. */
function lintel() {
  const o = { x: 450, y: 560 };
  return frame(box(-280, -30, 0, 560, 70, 90, M.concreteDark, o) + box(-250, -30, 90, 560, 70, 90, M.concrete, o),
    BG.gray, { cx: 470, cy: 650, rx: 340, ry: 60 });
}

/** Suv lotogi — U shaklidagi ariq bo'lagi. */
function tray() {
  const o = { x: 450, y: 560 };
  const m = M.concrete;
  const w = 460, d = 200, h = 110, t = 30;
  const p = (a: number, b: number, c: number) => P(a, b, c, o);
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  const st = `stroke="${m.stroke}" stroke-width="1.5" stroke-linejoin="round"`;
  // Tashqi quti + ichki kanal (yuqoridan ko'rinadi)
  const outer = box(x0, y0, 0, w, d, h, m, o);
  const inner = [p(x0, y0 + t, h), p(x1, y0 + t, h), p(x1, y1 - t, h), p(x0, y1 - t, h)];
  const innerFloor = [p(x0, y0 + t, t), p(x1, y0 + t, t), p(x1, y1 - t, t), p(x0, y1 - t, t)];
  const innerWall = [p(x0, y0 + t, h), p(x1, y0 + t, h), p(x1, y0 + t, t), p(x0, y0 + t, t)];
  return frame(outer + `<polygon points="${pts(inner)}" fill="#6c737c" ${st}/><polygon points="${pts(innerWall)}" fill="#8b929b" ${st}/><polygon points="${pts(innerFloor)}" fill="#7a818a" opacity="0.6"/>
  <path d="M ${p(x0 + 40, 0, t + 4).join(" ")} L ${p(x1 - 40, 0, t + 4).join(" ")}" stroke="#7fb7f0" stroke-width="10" stroke-linecap="round" opacity="0.8"/>`,
    BG.blue, { cx: 470, cy: 650, rx: 330, ry: 80 });
}

const DRAW: Record<string, () => string> = {
  beton: mixer,
  qorishma: mortar,
  ustun: column,
  fbs,
  "kovak-plita": hollowSlab,
  bordyur: () => curb(),
  "bog-bordyuri": () => curb(M.concreteDark, BG.green),
  "trotuar-plitka": () => pavers(M.paverGray, M.concreteDark, BG.gray),
  brusschatka: () => pavers(M.paverRed, M.paverGray, BG.warm),
  "quduq-halqasi": wellRing,
  "quduq-qopqogi": wellLid,
  gazoblok: () => blocks(M.aerated, BG.warm),
  keramzitoblok: () => blocks(M.keramzit, BG.warm, true),
  "beton-blok": () => blocks(M.concrete, BG.gray, true),
  svaya: pile,
  peremichka: lintel,
  lotok: tray,
};

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const t of SHOP_TEMPLATES) {
    const draw = DRAW[t.key];
    if (!draw) throw new Error(`Chizma yo'q: ${t.key}`);
    const buf = await sharp(Buffer.from(draw())).webp({ quality: 88 }).toBuffer();
    await writeFile(path.join(OUT, `${t.key}.webp`), buf);
    console.log(`${t.key}.webp  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
