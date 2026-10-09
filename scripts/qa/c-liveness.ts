/**
 * QA (C) — mobil yuz skanerining jonlilik (liveness) tekshiruvi: challenge topshirig'i, `frames` (3 kadr), qotgan
 * surat / nusxa, boshqa odam kadri, eskirgan/begona nonce, eski bitta kadrli oqim (`lib/face-liveness.ts`).
 *
 *   DATABASE_URL=… QA_BASE=http://localhost:3203 npx tsx scripts/qa/c-liveness.ts
 *   QA_FACE_LIVENESS=on …  — server MOBILE_FACE_LIVENESS_REQUIRED=true bilan: faqat "jonlilik majburiy" bo'limi
 *
 * Kadrlar: @vladmandic/face-api demo surati (sample3, o'rtadagi odam — to'g'ri qaragan). Bosh burish sintetik:
 * yuzning bir yarmi siqiladi (burun yuz kengligi bo'yicha siljiydi). Har kadr baytlari noyob (EXIF izohi) — xesh
 * bo'yicha "replay" bo'lib qolmasin; "bir xil kadr" sinovlarida aynan bitta bufer ishlatiladi.
 */
import path from "node:path";
import sharp from "sharp";
import { api, check, done, section, tok } from "./c-lib";
import { db } from "@/lib/db";
import { UPLOADS_DIR } from "@/lib/uploads";
import { faceDescriptor } from "@/lib/face-descriptor";

const ON = process.env.QA_FACE_LIVENESS === "on";
const LAT = 41.311, LNG = 69.279;
const S3 = path.join(process.cwd(), "node_modules/@vladmandic/face-api/demo/sample3.jpg");
const S1 = path.join(process.cwd(), "node_modules/@vladmandic/face-api/demo/sample1.jpg");
const stamp = Date.now().toString(36);
const msg = (r: { json: any; text: string }) => r.json?.message ?? r.text.slice(0, 160); // eslint-disable-line @typescript-eslint/no-explicit-any
const dataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString("base64")}`;

/** O'zimiz (sample3, o'rtadagi) va begona (sample1, chapdagi) odam. */
const ME = () => sharp(S3).extract({ left: 1040, top: 190, width: 330, height: 360 });
const OTHER = () => sharp(S1).extract({ left: 330, top: 300, width: 360, height: 400 });
let seq = 0;
/** Baytlari noyob JPEG (piksellar bir xil, EXIF izohi har xil). */
const uniq = (img: sharp.Sharp, q = 88) => img.withExif({ IFD0: { ImageDescription: `qa-live-${stamp}-${++seq}` } }).jpeg({ quality: q }).toBuffer();
const front = (q = 88) => uniq(ME(), q);
/** Sintetik burilish: side=+1 — o'ng yarmi siqiladi (burun kadrda o'ngga → odam o'z CHAPIGA burgan), -1 — aksincha. */
async function turned(side: 1 | -1, f: number, q = 88) {
  const base = await ME().toBuffer();
  const { width: W = 0, height: H = 0 } = await sharp(base).metadata();
  const half = Math.round(W / 2);
  const L = await sharp(base).extract({ left: 0, top: 0, width: half, height: H }).resize({ width: side === -1 ? Math.round(half * f) : half, height: H, fit: "fill" }).toBuffer();
  const R = await sharp(base).extract({ left: half, top: 0, width: W - half, height: H }).resize({ width: side === 1 ? Math.round((W - half) * f) : W - half, height: H, fit: "fill" }).toBuffer();
  const lw = (await sharp(L).metadata()).width!, rw = (await sharp(R).metadata()).width!;
  return uniq(sharp({ create: { width: lw + rw, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite([{ input: L, left: 0, top: 0 }, { input: R, left: lw, top: 0 }]), q);
}
type Task = "TURN_LEFT" | "TURN_RIGHT" | "BLINK";
/** Topshiriqni to'g'ri bajargan ketma-ketlik: [to'g'ri, biroz burilgan, ko'proq burilgan]. */
async function goodFrames(task: Task) {
  return task === "TURN_LEFT"
    ? [await front(), await turned(1, 0.55), await turned(1, 0.4)]
    : [await front(), await turned(-1, 0.7), await turned(-1, 0.55)];
}
const urls = (bufs: Buffer[]) => bufs.map(dataUrl);

async function linked(login: string, descriptor: number[]) {
  const u = await db.user.findUniqueOrThrow({ where: { login } });
  let e = await db.employee.findFirst({ where: { userId: u.id } });
  const created = !e;
  if (!e) e = await db.employee.create({ data: { fullName: `QA-L ${login}`, position: "Operator", userId: u.id } });
  else await db.employee.update({ where: { id: e.id }, data: { isActive: true, firedAt: null } });
  await db.attendance.deleteMany({ where: { employeeId: e.id } });
  await db.faceTemplate.deleteMany({ where: { employeeId: e.id } });
  await db.faceTemplate.create({ data: { employeeId: e.id, descriptor } });
  return { u, e, created, token: await tok(login) };
}
/** Test uchun yaratilgan bog'lanishni olib tashlaydi (keyingi to'plamlarga ta'sir qilmasin). */
const unlink = async (x: { e: { id: string }; created: boolean }) => { if (x.created) await db.employee.update({ where: { id: x.e.id }, data: { userId: null } }); };
const body = (extra: Record<string, unknown>) => ({ kind: "in", lat: LAT, lng: LNG, accuracy: 10, deviceId: "qa-live-" + stamp, at: new Date().toISOString(), ...extra });
const self = (token: string, b: unknown) => api("POST", "/api/mobile/attendance/self", { token, body: b });
const action = (token: string, a: string, id: string, payload?: Record<string, unknown>) => api("POST", "/api/mobile/action", { token, body: { action: a, id, payload } });
type Challenge = { nonce: string; task?: { code: Task; text: string; steps: string[]; frames: number }; livenessRequired?: boolean };
const challenge = async (token: string) => (await api("GET", "/api/mobile/attendance/challenge", { token })).json as Challenge;
/** Challenge + topshiriqni testda aniq qilib qo'yish (tasodifiy tanlov sinovni beqaror qilmasin). */
async function challengeAs(token: string, task: Task | null) {
  const c = await challenge(token);
  await db.faceNonce.update({ where: { nonce: c.nonce }, data: { task } });
  return c.nonce;
}

async function main() {
  await db.companySettings.upsert({ where: { id: "main" }, create: { id: "main", lat: LAT, lng: LNG, attendanceRadiusM: 300 }, update: { lat: LAT, lng: LNG, attendanceRadiusM: 300 } });
  const v = await faceDescriptor(await ME().jpeg({ quality: 90 }).toBuffer());
  check("namuna vektori olindi", !!v);
  if (!v) done();
  const tpl = v!.descriptor;
  const brigade = await db.brigade.findFirst({ where: { isActive: true, leader: { user: { login: "test.brigadir" } } } });
  const sexMember = async (name: string) => {
    const e = await db.employee.create({ data: { fullName: `QA-L ${name} ${stamp}`, position: "Betonchi", brigadeId: brigade!.id } });
    await db.faceTemplate.create({ data: { employeeId: e.id, descriptor: tpl } });
    return e;
  };

  if (ON) {
    // ── Server MOBILE_FACE_LIVENESS_REQUIRED=true bilan ──
    section("Jonlilik majburiy (MOBILE_FACE_LIVENESS_REQUIRED=true)");
    const u = await linked("test.mexanik", tpl);
    const c = await challenge(u.token);
    check(`challenge: livenessRequired=true, topshiriq ${c.task?.code}`, c.livenessRequired === true && !!c.task?.code && c.task.frames === 3, c);
    let r = await self(u.token, body({ photo: dataUrl(await front()), nonce: c.nonce }));
    check(`bitta kadr + nonce → 400 LIVENESS_REQUIRED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_REQUIRED", { s: r.status, j: r.json });
    r = await self(u.token, body({ photo: dataUrl(await front()) }));
    check(`bitta kadr nonce'siz → 400 LIVENESS_REQUIRED`, r.status === 400 && r.json?.code === "LIVENESS_REQUIRED", { s: r.status, j: r.json });
    r = await self(u.token, body({ frames: urls(await goodFrames("TURN_LEFT")) }));
    check(`frames nonce'siz → 400 NONCE_REQUIRED (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_REQUIRED", { s: r.status, j: r.json });
    r = await self(u.token, body({ frames: urls(await goodFrames("TURN_LEFT")), nonce: await challengeAs(u.token, null) }));
    check(`frames + topshiriqsiz nonce → 400 LIVENESS_REQUIRED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_REQUIRED", { s: r.status, j: r.json });
    r = await self(u.token, body({ frames: urls(await goodFrames("TURN_RIGHT")), nonce: await challengeAs(u.token, "TURN_RIGHT") }));
    check(`to'g'ri ketma-ketlik (o'ngga) → 200 keldi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });

    const sup = await tok("test.ishlab");
    const s1 = await sexMember("live-on");
    r = await action(sup, "att.face", s1.id, { photo: dataUrl(await front()), nonce: (await challenge(sup)).nonce });
    check(`att.face bitta kadr → 400 LIVENESS_REQUIRED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_REQUIRED", { s: r.status, j: r.json });
    r = await action(sup, "att.face", s1.id, { frames: urls(await goodFrames("TURN_LEFT")), nonce: await challengeAs(sup, "TURN_LEFT") });
    check(`att.face to'g'ri ketma-ketlik → 200 (${msg(r)})`, r.status === 200, { s: r.status, j: r.json });
    await unlink(u);
    await db.$disconnect();
    done();
  }

  // ───────────────────────── 1. Challenge ─────────────────────────
  section("Challenge: topshiriq nonce bilan saqlanadi");
  const a = await linked("test.mexanik", tpl);
  const c0 = await challenge(a.token);
  const row = await db.faceNonce.findUnique({ where: { nonce: c0.nonce } });
  check(`challenge → topshiriq ${c0.task?.code} «${c0.task?.text}», 3 kadr, bayroq o'chiq`, !!c0.task && ["TURN_LEFT", "TURN_RIGHT"].includes(c0.task.code) && c0.task.frames === 3 && c0.task.steps.length === 2 && c0.livenessRequired === false, c0);
  check("nonce yozuvida o'sha topshiriq", row?.task === c0.task?.code, row?.task);

  // ───────────────────────── 2. Qotgan surat / nusxa ─────────────────────────
  section("Qotgan surat va bir kadr nusxalari — rad");
  const one = await front();
  let r = await self(a.token, body({ frames: urls([one, one, one]), nonce: await challengeAs(a.token, "TURN_LEFT") }));
  check(`bir xil 3 kadr → 400 LIVENESS_FAILED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED" && /Topshiriq bajarilmadi/.test(msg(r)), { s: r.status, j: r.json });
  r = await self(a.token, body({ frames: urls([await front(), await front(), await front()]), nonce: await challengeAs(a.token, "TURN_LEFT") }));
  check(`piksellari bir xil (faqat metadata farqli) 3 kadr → 400 LIVENESS_FAILED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED", { s: r.status, j: r.json });
  r = await self(a.token, body({ frames: urls([await front(92), await front(70), await front(50)]), nonce: await challengeAs(a.token, "TURN_RIGHT") }));
  check(`bir suratning har xil sifatdagi nusxalari → 400 LIVENESS_FAILED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED", { s: r.status, j: r.json });
  r = await self(a.token, body({ frames: urls(await goodFrames("TURN_LEFT")), nonce: await challengeAs(a.token, "TURN_RIGHT") }));
  check(`teskari tomonga burilish → 400 LIVENESS_FAILED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED", { s: r.status, j: r.json });
  r = await self(a.token, body({ frames: urls([await front(), await front(80), await front(70)]), nonce: await challengeAs(a.token, "BLINK") }));
  check(`BLINK topshirig'i qotgan kadrlar bilan → 400 LIVENESS_FAILED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED", { s: r.status, j: r.json });
  const fails = await db.auditLog.count({ where: { entity: "Attendance", entityId: a.e.id, createdAt: { gt: new Date(Date.now() - 120_000) } } });
  check(`muvaffaqiyatsiz urinishlar auditda (${fails})`, fails >= 3, fails);

  // ───────────────────────── 3. Boshqa odam, nonce ─────────────────────────
  section("Boshqa odam kadri, eskirgan/begona nonce, topshiriqsiz frames");
  const b = await linked("test.sklad", tpl);
  const good = await goodFrames("TURN_LEFT");
  r = await self(b.token, body({ frames: urls([good[0]!, good[1]!, await uniq(OTHER())]), nonce: await challengeAs(b.token, "TURN_LEFT") }));
  check(`3-kadr boshqa odam → 403 FACE_MISMATCH (${msg(r)})`, r.status === 403 && r.json?.code === "FACE_MISMATCH", { s: r.status, j: r.json });
  r = await self(b.token, body({ frames: urls([await uniq(OTHER()), await turned(1, 0.55), await turned(1, 0.4)]), nonce: await challengeAs(b.token, "TURN_LEFT") }));
  check(`1-kadr boshqa odam → 403 FACE_MISMATCH (${msg(r)})`, r.status === 403 && r.json?.code === "FACE_MISMATCH", { s: r.status, j: r.json });
  r = await self(b.token, body({ frames: urls(await goodFrames("TURN_LEFT")) }));
  check(`frames nonce'siz (bayroq o'chiq) → 400 LIVENESS_FAILED «topshiriq topilmadi» (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED" && /topilmadi/.test(msg(r)), { s: r.status, j: r.json });
  r = await self(b.token, body({ frames: urls(await goodFrames("TURN_LEFT")), nonce: await challengeAs(b.token, null) }));
  check(`frames + topshiriqsiz (eski) nonce → 400 LIVENESS_FAILED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED", { s: r.status, j: r.json });
  const old = await challengeAs(b.token, "TURN_LEFT");
  await db.faceNonce.update({ where: { nonce: old }, data: { expiresAt: new Date(Date.now() - 1000) } });
  r = await self(b.token, body({ frames: urls(await goodFrames("TURN_LEFT")), nonce: old }));
  check(`eskirgan nonce → 400 NONCE_INVALID (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_INVALID", { s: r.status, j: r.json });
  const k = await linked("test.kassa", tpl);
  r = await self(k.token, body({ frames: urls(await goodFrames("TURN_LEFT")), nonce: await challengeAs(b.token, "TURN_LEFT") }));
  check(`boshqa foydalanuvchining nonce'i → 400 NONCE_INVALID (${msg(r)})`, r.status === 400 && r.json?.code === "NONCE_INVALID", { s: r.status, j: r.json });

  // ───────────────────────── 4. Format ─────────────────────────
  section("frames formati va hajmi");
  r = await self(k.token, body({ frames: urls([await front(), await turned(1, 0.5)]), nonce: await challengeAs(k.token, "TURN_LEFT") }));
  check(`2 ta kadr → 400 (${msg(r)})`, r.status === 400 && /Kadrlar soni/.test(msg(r)), { s: r.status, j: r.json });
  const big = dataUrl(Buffer.alloc(1_500_000, 7));
  r = await self(k.token, body({ frames: [big, big, big] }));
  check(`jami chegaradan katta (3×2 M belgi) → 400 (${msg(r)})`, r.status === 400 && /juda katta/.test(msg(r)), { s: r.status, j: r.json });
  r = await self(k.token, body({ frames: ["data:image/jpeg;base64,", "x", 5] }));
  check(`buzuq kadrlar → 400 (${msg(r)})`, r.status === 400, { s: r.status, j: r.json });

  // ───────────────────────── 5. To'g'ri ketma-ketlik ─────────────────────────
  section("To'g'ri ketma-ketlik — qabul, birinchi kadr saqlanadi");
  const c = await linked("test.direktor", tpl);
  const okFrames = await goodFrames("TURN_RIGHT");
  r = await self(c.token, body({ frames: urls(okFrames), nonce: await challengeAs(c.token, "TURN_RIGHT") }));
  check(`o'ngga burilish → 200 keldi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });
  const att = await db.attendance.findFirst({ where: { employeeId: c.e.id } });
  const meta = att?.facePhoto ? await sharp(path.join(UPLOADS_DIR, "employees", att.facePhoto)).metadata() : null;
  check(`kadr saqlandi (JPEG, EXIF'siz, ${meta?.width}×${meta?.height} — birinchi kadr o'lchami 330×360)`, meta?.format === "jpeg" && !meta.exif && meta.width === 330 && meta.height === 360, { photo: att?.facePhoto, w: meta?.width });
  const log = await db.auditLog.findFirst({ where: { entity: "Attendance", entityId: att?.id ?? "-" }, orderBy: { createdAt: "desc" } });
  check("auditda jonlilik topshirig'i", JSON.stringify(log?.after ?? "").includes("TURN_RIGHT"), log?.after);
  await db.attendance.deleteMany({ where: { employeeId: c.e.id } });
  r = await self(c.token, body({ frames: urls(okFrames), nonce: await challengeAs(c.token, "TURN_RIGHT") }));
  check(`o'sha kadrlar qayta → 409 FACE_REPLAY (${msg(r)})`, r.status === 409 && r.json?.code === "FACE_REPLAY", { s: r.status, j: r.json });
  r = await self(c.token, body({ frames: urls(await goodFrames("TURN_LEFT")), nonce: await challengeAs(c.token, "TURN_LEFT") }));
  check(`chapga burilish → 200 keldi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });

  // ───────────────────────── 6. Eski oqim (bayroq o'chiq) ─────────────────────────
  section("Bayroq o'chiq: eski bitta kadr ishlaydi");
  const back = new Date(Date.now() - 30 * 60_000);
  await db.attendance.updateMany({ where: { employeeId: c.e.id }, data: { checkIn: `${String(back.getHours()).padStart(2, "0")}:${String(back.getMinutes()).padStart(2, "0")}` } });
  r = await self(c.token, body({ kind: "out", photo: dataUrl(await front()), nonce: (await challenge(c.token)).nonce }));
  check(`bitta kadr + topshiriqli nonce (eski ilova) → 200 ketdi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });
  const d = await linked("test.haydovchi", tpl);
  r = await self(d.token, body({ photo: dataUrl(await front()) }));
  check(`bitta kadr nonce'siz → 200 keldi (${msg(r)})`, r.status === 200 && r.json?.already === false, { s: r.status, j: r.json });

  // ───────────────────────── 7. att.face ─────────────────────────
  section("Rahbar skaneri (att.face) — frames");
  const sup = await tok("test.ishlab");
  const s1 = await sexMember("live");
  r = await action(sup, "att.face", s1.id, { frames: urls([await front(92), await front(70), await front(50)]), nonce: await challengeAs(sup, "TURN_LEFT") });
  check(`att.face qotgan kadrlar → 400 LIVENESS_FAILED (${msg(r)})`, r.status === 400 && r.json?.code === "LIVENESS_FAILED", { s: r.status, j: r.json });
  r = await action(sup, "att.face", s1.id, { frames: urls(await goodFrames("TURN_LEFT")), nonce: await challengeAs(sup, "TURN_LEFT") });
  check(`att.face to'g'ri ketma-ketlik → 200 (${msg(r)})`, r.status === 200, { s: r.status, j: r.json });
  const s2 = await sexMember("live-old");
  r = await action(sup, "att.face", s2.id, { photo: dataUrl(await front()), nonce: (await challenge(sup)).nonce });
  check(`att.face eski bitta kadr → 200 (${msg(r)})`, r.status === 200, { s: r.status, j: r.json });

  for (const x of [a, b, k, c, d]) await unlink(x);
  await db.$disconnect();
  done();
}
void main();
