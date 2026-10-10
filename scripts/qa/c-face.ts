/**
 * QA (C) — Face ID / davomat xavfsizligi: mobil "Keldim/Ketdim" (`/api/mobile/attendance/self`), rahbar skaneri
 * (`att.face`), brigadir "Keldi" qoidalari, challenge (nonce), kadr xeshi (replay), kadr formati/hajmi, EXIF tozalash,
 * parallel "Keldim", mobil davomat jadvali doirasi va veb skanerning server tomondagi kadr↔vektor tekshiruvi.
 *
 *   DATABASE_URL=… QA_BASE=http://localhost:3203 npx tsx scripts/qa/c-face.ts
 *   QA_FACE_NONCE=on …  — server MOBILE_FACE_NONCE_REQUIRED=true bilan: faqat "nonce majburiy" bo'limi
 *
 * Yuz kadrlari: @vladmandic/face-api demo surati (node_modules) — undan uch xil odamning yuzi kesib olinadi.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { api, check, done, section, tok } from "./c-lib";
import { db } from "@/lib/db";
import { today, dayUtc } from "@/lib/davomat";
import { faceDescriptor } from "@/lib/face-descriptor";
import { enrollFace, scanFace } from "@/lib/face-id";
import { productionStaff } from "@/lib/production-staff";
import { UPLOADS_DIR } from "@/lib/uploads";
import type { Session } from "@/lib/auth";

const NONCE_ON = process.env.QA_FACE_NONCE === "on";
const LAT = 41.311, LNG = 69.279;
const SRC = path.join(process.cwd(), "node_modules/@vladmandic/face-api/demo/sample1.jpg");
const stamp = Date.now().toString(36);
const msg = (r: { json: any; text: string }) => r.json?.message ?? r.text.slice(0, 160); // eslint-disable-line @typescript-eslint/no-explicit-any
const dataUrl = (b: Buffer, mime = "image/jpeg") => `data:${mime};base64,${b.toString("base64")}`;

/** Demo suratdan yuz: A — chapdagi, B — o'ngdagi, C — o'rtadagi odam. `q` har xil — har kadr baytlari boshqa (xesh). */
const FACES = { A: [330, 300, 360, 400], B: [1400, 180, 320, 360], C: [780, 330, 340, 380] } as const;
let qSeq = 95;
async function face(who: keyof typeof FACES, q = qSeq--) {
  const [left, top, width, height] = FACES[who];
  return sharp(SRC).extract({ left, top, width, height }).jpeg({ quality: q }).toBuffer();
}

async function linked(login: string, position = "Operator") {
  const u = await db.user.findUniqueOrThrow({ where: { login } });
  let e = await db.employee.findFirst({ where: { userId: u.id } });
  if (!e) e = await db.employee.create({ data: { fullName: `QA-F ${login}`, position, userId: u.id } });
  else await db.employee.update({ where: { id: e.id }, data: { isActive: true, firedAt: null } });
  await db.attendance.deleteMany({ where: { employeeId: e.id } });
  return { u, e, token: await tok(login) };
}
async function setTemplate(employeeId: string, descriptor: number[] | null) {
  await db.faceTemplate.deleteMany({ where: { employeeId } });
  if (descriptor) await db.faceTemplate.create({ data: { employeeId, descriptor } });
}
async function filesOf(employeeId: string) {
  try { return (await readdir(path.join(UPLOADS_DIR, "employees"))).filter((f) => f.startsWith(`${employeeId}-`)); } catch { return []; }
}
const body = (photo: unknown, extra: Record<string, unknown> = {}) => ({ kind: "in", lat: LAT, lng: LNG, accuracy: 10, photo, deviceId: "qa-face-" + stamp, at: new Date().toISOString(), ...extra });
const self = (token: string, b: unknown) => api("POST", "/api/mobile/attendance/self", { token, body: b });
const action = (token: string, a: string, id: string, payload?: Record<string, unknown>) => api("POST", "/api/mobile/action", { token, body: { action: a, id, payload } });
const challenge = async (token: string) => (await api("GET", "/api/mobile/attendance/challenge", { token })).json?.nonce as string | undefined;

async function main() {
  await db.companySettings.upsert({ where: { id: "main" }, create: { id: "main", lat: LAT, lng: LNG, attendanceRadiusM: 300 }, update: { lat: LAT, lng: LNG, attendanceRadiusM: 300 } });
  const t0 = Date.now();
  const [vA, vB, vC] = await Promise.all([face("A", 90), face("B", 90), face("C", 90)].map(async (p) => faceDescriptor(await p)));
  check(`demo suratdan uch yuz vektori olindi (${Date.now() - t0} ms)`, !!(vA && vB && vC));
  if (!vA || !vB || !vC) done();
  const dA = vA!.descriptor, dB = vB!.descriptor, dC = vC!.descriptor;

  const brigade = await db.brigade.findFirst({ where: { isActive: true, leader: { user: { login: "test.brigadir" } } } });
  const sexMember = async (name: string, descriptor: number[] | null) => {
    const e = await db.employee.create({ data: { fullName: `QA-F ${name} ${stamp}`, position: "Betonchi", brigadeId: brigade!.id } });
    await setTemplate(e.id, descriptor);
    return e;
  };

  if (NONCE_ON) {
    // ── Server MOBILE_FACE_NONCE_REQUIRED=true bilan ──
    section("Nonce majburiy (MOBILE_FACE_NONCE_REQUIRED=true)");
    const u = await linked("test.finance");
    await setTemplate(u.e.id, dA);
    let r = await self(u.token, body(dataUrl(await face("A"))));
    check(`self nonce'siz → 400 NONCE_REQUIRED (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_REQUIRED", { s: r.status, j: r.json });
    r = await self(u.token, body(dataUrl(await face("A")), { nonce: "yo'q-nonce" }));
    check(`self soxta nonce → 400 NONCE_INVALID`, r.status === 400 && r.json?.code === "NONCE_INVALID", { s: r.status, j: r.json });
    r = await self(u.token, body(dataUrl(await face("A")), { nonce: await challenge(u.token) }));
    check(`self yangi nonce bilan → 200 keldi (${msg(r)})`, r.status === 200 && r.json?.ok === true && r.json?.already === false, { s: r.status, j: r.json });

    const sup = await tok("test.ishlab");
    const s1 = await sexMember("nonce-on", dA);
    r = await action(sup, "att.face", s1.id, { photo: dataUrl(await face("A")) });
    check(`att.face nonce'siz → 400 NONCE_REQUIRED (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_REQUIRED", { s: r.status, j: r.json });
    r = await action(sup, "att.face", s1.id, { photo: dataUrl(await face("A")), nonce: await challenge(sup) });
    check(`att.face nonce bilan → 200 (${msg(r)})`, r.status === 200, { s: r.status, j: r.json });
    await db.$disconnect();
    done();
  }

  // ───────────────────────── 1. Brigadir: yuzsiz "Keldi" ─────────────────────────
  section("Brigadir: Face ID'li a'zoga yuzsiz \"Keldi\" yo'q");
  check("test.brigadir brigadasi bor", !!brigade);
  const brig = await tok("test.brigadir");
  const m1 = await sexMember("faceid", dB);
  const m2 = await sexMember("namunasiz", null);
  const date = dayUtc(today());
  const members = (await productionStaff()).members.filter((m) => m.brigadeId === brigade!.id).map((m) => m.id);
  await db.attendance.deleteMany({ where: { employeeId: { in: members }, date } });

  let r = await action(brig, "att.present", m1.id);
  check(`att.present Face ID'li a'zo → 403 (${msg(r)})`, r.status === 403, { s: r.status, j: r.json });
  r = await action(brig, "att.status", m1.id, { status: "PRESENT" });
  check(`att.status PRESENT Face ID'li a'zo → 403 (${msg(r)})`, r.status === 403, { s: r.status, j: r.json });
  r = await api("GET", `/api/mobile/detail?key=sex-emp&id=${m1.id}`, { token: brig });
  const stForm = (r.json?.actions ?? []).find((a: { id: string }) => a.id === "att.status");
  const opts = (stForm?.form?.[0]?.options ?? []).map((o: { value: string }) => o.value);
  check(`sex-emp kartasi: brigadir formasida PRESENT yo'q (${opts.join(",")})`, r.status === 200 && opts.length > 0 && !opts.includes("PRESENT"), { s: r.status, opts });
  r = await action(brig, "att.present", m2.id);
  check(`att.present namunasiz a'zo → 200 (AI o'chiq) (${msg(r)})`, r.status === 200, { s: r.status, j: r.json });
  await db.attendance.deleteMany({ where: { employeeId: m2.id, date } });

  r = await action(brig, "att.all", `b~${brigade!.id}`);
  const a1 = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: m1.id, date } } });
  const a2 = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: m2.id, date } } });
  check(`att.all → 200, Face ID'li o'tkazib yuborildi (${msg(r)})`, r.status === 200 && /Face ID/.test(msg(r)) && !a1 && a2?.status === "PRESENT", { s: r.status, j: r.json, a1: a1?.status, a2: a2?.status });
  r = await api("GET", `/api/mobile/detail?key=brig-shift&id=b~${brigade!.id}`, { token: brig });
  check("smena kartasi: faqat Face ID'li a'zo qolganda «Qolganlari keldi» yo'q", r.status === 200 && !(r.json?.actions ?? []).some((a: { id: string }) => a.id === "att.all"), { s: r.status });
  r = await action(brig, "att.all", `b~${brigade!.id}`);
  check(`att.all faqat Face ID'lilar qolganda → 403 (${msg(r)})`, r.status === 403 && /Face ID/.test(msg(r)), { s: r.status, j: r.json });
  r = await action(brig, "att.absent", m1.id);
  check(`att.absent Face ID'li a'zo → 200 (faqat "Keldi" yuz bilan)`, r.status === 200, { s: r.status, j: r.json });

  // ───────────────────────── 2. Kadr formati va hajmi ─────────────────────────
  section("Kadr formati va hajmi (500 bo'lmasin)");
  const v1 = await linked("test.sotuv"), v2 = await linked("test.snab");
  await setTemplate(v1.e.id, dA); await setTemplate(v2.e.id, dA);
  const fA = await face("A");
  const bigPng = await sharp({ limitInputPixels: false, create: { width: 20000, height: 20000, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png({ compressionLevel: 9 }).toBuffer();
  const cases: [string, typeof v1, string, (s: number, j: any) => boolean][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ["2,2 M belgili kadr", v1, dataUrl(Buffer.alloc(1_650_000, 7)), (s, j) => s === 400 && /juda katta/.test(j?.message ?? "")],
    ["AVIF", v1, dataUrl(await sharp(fA).avif().toBuffer(), "image/avif"), (s, j) => s === 409 && j?.code === "FACE_ERROR"],
    ["SVG", v1, dataUrl(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900"/>${" ".repeat(200)}</svg>`), "image/svg+xml"), (s, j) => s === 409 && j?.code === "FACE_ERROR"],
    ["TIFF", v1, dataUrl(await sharp(fA).tiff().toBuffer(), "image/tiff"), (s, j) => s === 409 && j?.code === "FACE_ERROR"],
    ["GIF", v1, dataUrl(await sharp(fA).gif().toBuffer(), "image/gif"), (s, j) => s === 409 && j?.code === "FACE_ERROR"],
    [`20000×20000 PNG «bomba» (${(bigPng.length / 1e6).toFixed(1)} MB)`, v2, dataUrl(bigPng, "image/png"), (s, j) => s >= 400 && s < 500 && /katta/.test(j?.message ?? "")],
    ["kulrang PNG", v2, dataUrl(await sharp(fA).grayscale().png().toBuffer(), "image/png"), (s) => s === 200 || s === 409 || s === 403],
    ["16-bit PNG", v2, dataUrl(await sharp(fA).toColourspace("rgb16").png().toBuffer(), "image/png"), (s, j) => s === 200 && j?.ok === true],
  ];
  for (const [name, u, photo, ok] of cases) {
    const t1 = Date.now();
    r = await self(u.token, body(photo));
    check(`${name} → ${r.status} ${r.json?.code ?? ""} (${msg(r)}) ${Date.now() - t1}ms`, ok(r.status, r.json) && r.status !== 500, { s: r.status, j: r.json });
  }
  const sup = await tok("test.ishlab");
  const s1 = await sexMember("att-face", dA);
  r = await action(sup, "att.face", m2.id, { photo: dataUrl(await face("A")) });
  check(`att.face namunasiz a'zo → 400 «yuzni ro'yxatga oling» (${msg(r)})`, r.status === 400 && /ECO → Davomat → Yuzlar/.test(msg(r)), { s: r.status, j: r.json });
  r = await action(sup, "att.face", s1.id, { photo: dataUrl(Buffer.alloc(1_650_000, 7)) });
  check(`att.face 2,2 M belgili kadr → 400 (${msg(r)})`, r.status === 400 && /juda katta/.test(msg(r)), { s: r.status, j: r.json });

  // ───────────────────────── 3. EXIF tozalash + nonce (bayroq o'chiq) ─────────────────────────
  section("att.face: nonce ixtiyoriy, kadr EXIF'siz saqlanadi");
  const fin = await linked("test.finance");
  const finNonce = await challenge(fin.token);
  r = await action(sup, "att.face", s1.id, { photo: dataUrl(await face("A")), nonce: finNonce });
  check(`att.face boshqa foydalanuvchining nonce'i → 400 NONCE_INVALID (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_INVALID", { s: r.status, j: r.json });
  const gps = await sharp(await face("A")).withExif({ IFD0: { Copyright: "QA GPS" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 18/1 40/1", GPSLongitudeRef: "E", GPSLongitude: "69/1 16/1 44/1" } }).jpeg().toBuffer();
  check("sinov kadrida EXIF bor", !!(await sharp(gps).metadata()).exif);
  const exifFrame = dataUrl(gps);
  r = await action(sup, "att.face", s1.id, { photo: exifFrame, nonce: await challenge(sup) });
  check(`att.face EXIF'li kadr + nonce → 200 (${msg(r)})`, r.status === 200, { s: r.status, j: r.json });
  const sa = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: s1.id, date } } });
  const meta = sa?.facePhoto ? await sharp(path.join(UPLOADS_DIR, "employees", sa.facePhoto)).metadata() : null;
  check(`saqlangan kadr JPEG va EXIF'siz (${meta?.format}, exif=${!!meta?.exif})`, meta?.format === "jpeg" && !meta.exif, { photo: sa?.facePhoto });
  const s2 = await sexMember("replay", dA);
  r = await action(sup, "att.face", s2.id, { photo: exifFrame });
  check(`att.face o'sha kadr boshqa xodimga (replay) → 409 FACE_REPLAY (${msg(r)})`, r.status === 409 && r.json?.code === "FACE_REPLAY", { s: r.status, j: r.json });

  // ───────────────────────── 4. Nonce oqimi (self, bayroq o'chiq) ─────────────────────────
  section("Challenge (nonce) — self");
  r = await api("GET", "/api/mobile/attendance/challenge");
  check("challenge tokensiz → 401", r.status === 401, r.status);
  await setTemplate(fin.e.id, dA);
  const n1 = await challenge(fin.token);
  check("challenge → nonce", typeof n1 === "string" && n1.length >= 20, n1);
  r = await self(fin.token, body(dataUrl(await face("A")), { nonce: n1 }));
  check(`self nonce bilan → 200 keldi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });
  // "Ketdim" bir daqiqada bo'lsa smena 24 soat deb hisoblanadi — kelgan vaqtni 30 daqiqa oldinga suramiz
  const back = new Date(Date.now() - 30 * 60_000);
  await db.attendance.updateMany({ where: { employeeId: fin.e.id }, data: { checkIn: `${String(back.getHours()).padStart(2, "0")}:${String(back.getMinutes()).padStart(2, "0")}` } });
  r = await self(fin.token, body(dataUrl(await face("A")), { kind: "out", nonce: n1 }));
  check(`ishlatilgan nonce qayta → 400 NONCE_INVALID (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_INVALID", { s: r.status, j: r.json });
  const n2 = await challenge(fin.token);
  await db.faceNonce.update({ where: { nonce: n2! }, data: { expiresAt: new Date(Date.now() - 1000) } });
  r = await self(fin.token, body(dataUrl(await face("A")), { kind: "out", nonce: n2 }));
  check(`eskirgan nonce → 400 NONCE_INVALID (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_INVALID", { s: r.status, j: r.json });
  r = await self(fin.token, body(dataUrl(await face("A")), { kind: "out" }));
  check(`nonce'siz (bayroq o'chiq — eski ilova) → 200 ketdi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });

  // ───────────────────────── 5. Replay: bir xil kadr ─────────────────────────
  section("Kadr xeshi: aynan o'sha kadr qayta — rad");
  const rp = await linked("test.buh");
  await setTemplate(rp.e.id, null);
  r = await self(rp.token, body(dataUrl(await face("A"))));
  check(`Face ID namunasi yo'q (AI zaxirasi o'chiq) → 409 FACE_DISABLED «yuzni ro'yxatga oling» (${msg(r)})`, r.status === 409 && r.json?.code === "FACE_DISABLED" && /ECO → Davomat → Yuzlar/.test(msg(r)), { s: r.status, j: r.json });
  await setTemplate(rp.e.id, dA);
  const gray = dataUrl(await sharp({ create: { width: 480, height: 640, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer());
  r = await self(rp.token, body(gray));
  check(`yuzsiz kadr → 409 (${msg(r)})`, r.status === 409 && /yuz topilmadi/i.test(msg(r)), { s: r.status, j: r.json });
  r = await self(rp.token, body(gray));
  check(`o'sha yuzsiz kadr qayta → 409 FACE_REPLAY (${msg(r)})`, r.status === 409 && r.json?.code === "FACE_REPLAY", { s: r.status, j: r.json });
  const okFrame = dataUrl(await face("A"));
  r = await self(rp.token, body(okFrame));
  check(`yangi kadr → 200 keldi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });
  await db.attendance.deleteMany({ where: { employeeId: rp.e.id } });
  r = await self(rp.token, body(okFrame));
  check(`qabul qilingan kadr qayta yuborildi → 409 FACE_REPLAY (${msg(r)})`, r.status === 409 && r.json?.code === "FACE_REPLAY", { s: r.status, j: r.json });

  // ───────────────────────── 6. Parallel "Keldim" ─────────────────────────
  section("Parallel ikki «Keldim» → bitta yozuv, yetim kadr yo'q");
  const par = await linked("test.logistika");
  await setTemplate(par.e.id, dA);
  const before = (await filesOf(par.e.id)).length;
  const [p1, p2] = await Promise.all([self(par.token, body(dataUrl(await face("A")))), self(par.token, body(dataUrl(await face("A"))))]);
  const fresh = [p1, p2].filter((x) => x.json?.already === false).length;
  check(`ikkalasi 200, faqat bittasi yangi yozuv (${p1.status}/${p2.status}, yangi=${fresh}) (${msg(p1)} | ${msg(p2)})`, p1.status === 200 && p2.status === 200 && fresh === 1, { p1: p1.json, p2: p2.json });
  const rows = await db.attendance.findMany({ where: { employeeId: par.e.id } });
  const after = await filesOf(par.e.id);
  check(`bitta davomat yozuvi, diskda bitta yangi kadr (${after.length - before})`, rows.length === 1 && !!rows[0]?.facePhoto && after.length - before === 1 && after.includes(rows[0]!.facePhoto!), { rows: rows.length, files: after });

  // ───────────────────────── 7. Mobil davomat jadvali doirasi ─────────────────────────
  section("Mobil davomat jadvali: sex boshlig'i faqat sex xodimlarini ko'radi");
  const outsider = await db.employee.create({ data: { fullName: `QA-F Hisobchi ${stamp}`, position: "Bosh hisobchi yordamchisi QA" } });
  const sexIds = new Set((await productionStaff()).members.map((m) => m.id));
  check("tashqi xodim sex tarkibida emas", !sexIds.has(outsider.id));
  for (const login of ["test.ishlab", "test.prorab"]) {
    const t = await tok(login);
    r = await api("GET", "/api/mobile/attendance/day", { token: t });
    const ids: string[] = (r.json?.rows ?? []).map((x: { id: string }) => x.id);
    check(`${login}: kunlik jadval faqat sex (${ids.length} qator, sex=${sexIds.size})`, r.status === 200 && ids.length > 0 && ids.every((id) => sexIds.has(id)) && ids.includes(s1.id) && !ids.includes(outsider.id), { s: r.status, n: ids.length });
    r = await api("GET", `/api/mobile/attendance/employee?id=${outsider.id}`, { token: t });
    check(`${login}: tashqi xodimning oyi → 404`, r.status === 404, r.status);
    r = await api("GET", `/api/mobile/attendance/employee?id=${s1.id}`, { token: t });
    check(`${login}: sex xodimining oyi → 200`, r.status === 200, r.status);
  }
  const hr = await tok("test.kadr");
  r = await api("GET", "/api/mobile/attendance/day", { token: hr });
  check("otdel kadr: kunlik jadvalda tashqi xodim ham bor", r.status === 200 && (r.json?.rows ?? []).some((x: { id: string }) => x.id === outsider.id), r.status);
  r = await api("GET", `/api/mobile/attendance/employee?id=${outsider.id}`, { token: hr });
  check("otdel kadr: tashqi xodimning oyi → 200", r.status === 200, r.status);

  // ───────────────────────── 8. Veb skaner: kadr ↔ vektor (server tomonda) ─────────────────────────
  section("Veb Face ID skaneri: mijoz vektoriga ko'r-ko'rona ishonilmaydi");
  const hrUser = await db.user.findUniqueOrThrow({ where: { login: "test.kadr" } });
  const sess = { userId: hrUser.id, login: hrUser.login, fullName: hrUser.fullName, role: hrUser.role } as Session;
  const web = await db.employee.create({ data: { fullName: `QA-F Veb ${stamp}`, position: "Operator" } });
  const jpegUrl = async (who: keyof typeof FACES) => dataUrl(await sharp(await face(who)).resize(300).jpeg({ quality: 85 }).toBuffer());
  const samples = [dC, dC, dC].map((d) => ({ descriptor: d, score: 0.9 }));
  const e1 = await enrollFace(sess, { employeeId: web.id, samples, photo: await jpegUrl("A"), consent: true });
  check(`ro'yxatga olish: boshqa odamning kadri → rad (${e1.ok ? "ok" : e1.error})`, !e1.ok && /mos emas/.test(e1.error), e1);
  const e2 = await enrollFace(sess, { employeeId: web.id, samples, photo: await jpegUrl("C"), consent: true });
  check(`ro'yxatga olish: o'z kadri → ok (${e2.ok ? e2.note : e2.error})`, e2.ok, e2);
  const sc1 = await scanFace(sess, { probes: [dC, dC, dC], photo: await jpegUrl("A"), mode: "in" });
  check(`skaner: C vektori + A kadri → PHOTO_MISMATCH (${sc1.ok ? sc1.text : sc1.error})`, !sc1.ok && sc1.code === "PHOTO_MISMATCH", sc1);
  const sc2 = await scanFace(sess, { probes: [dC, dC, dC], photo: gray, mode: "in" });
  check(`skaner: yuzsiz kadr → PHOTO_MISMATCH (${sc2.ok ? sc2.text : sc2.error})`, !sc2.ok && sc2.code === "PHOTO_MISMATCH" && /yuz topilmadi/i.test(sc2.error), sc2);
  const sc3 = await scanFace(sess, { probes: [dC, dC, dC], photo: await jpegUrl("C"), mode: "in" });
  check(`skaner: o'z kadri → keldi (${sc3.ok ? `${sc3.kind} ${sc3.employee.fullName}` : sc3.error})`, sc3.ok && sc3.employee.id === web.id, sc3);

  await db.$disconnect();
  done();
}
void main();
