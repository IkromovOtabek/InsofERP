/**
 * QA (C) — mobil «Davomat» (ECO direktor/kadr kabineti, `lib/mobile/face-kiosk.ts`): ruxsatlar, yuzni ikki bosqichli
 * ro'yxatga olish (rozilik, faqat to'g'ri qaragan kadrlar namuna, tasdiqlash: boshqa odam / begona pendingId / urinishlar
 * tugashi, replay), kiosk 1:N skaneri (keldi / allaqachon / tanilmadi / boshqa odam kadri / sex doirasi / ko'zgu-aks kadr),
 * bugungi jurnal, kadrni ko'rish va yuz ma'lumotini o'chirish.
 *
 *   DATABASE_URL=… QA_BASE=http://localhost:3203 npx tsx scripts/qa/c-face-kiosk.ts
 *
 * Boshqa c-* testlari bir xil demo yuzlarni bir nechta xodimga yozadi — 1:N tanish "aniq emas" bo'lib qolmasin, shuning
 * uchun test vaqtida mavjud namunalar chetga olinadi va oxirida qaytariladi.
 */
import path from "node:path";
import sharp from "sharp";
import { api, check, done, section, tok } from "./c-lib";
import { db } from "@/lib/db";
import { dayUtc, today } from "@/lib/davomat";
import { faceDescriptor } from "@/lib/face-descriptor";
import { distance } from "@/lib/face-id";

const stamp = Date.now().toString(36);
const S3 = path.join(process.cwd(), "node_modules/@vladmandic/face-api/demo/sample3.jpg");
const S1 = path.join(process.cwd(), "node_modules/@vladmandic/face-api/demo/sample1.jpg");
/** `d` — kesish biroz siljitilgan (o'sha odam, o'sha holat, boshqa kadr: "kameraga qarang" dan keyingi to'g'ri kadr). */
const ME = (d = 0) => sharp(S3).extract({ left: 1040 + d, top: 190 + d, width: 330, height: 360 });
const OTHER = (d = 0) => sharp(S1).extract({ left: 330 + d, top: 300 + d, width: 360, height: 400 });
let seq = 0;
const uniq = (img: sharp.Sharp, q = 88) => img.withExif({ IFD0: { ImageDescription: `qa-kiosk-${stamp}-${++seq}` } }).jpeg({ quality: q }).toBuffer();
const dataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString("base64")}`;
/** Sintetik burilish (c-liveness.ts dagidek): side=+1 — o'ng yarmi siqiladi (odam o'z chapiga burgan). */
async function turned(side: 1 | -1, f: number, who = ME) {
  const base = await who().toBuffer();
  const { width: W = 0, height: H = 0 } = await sharp(base).metadata();
  const half = Math.round(W / 2);
  const L = await sharp(base).extract({ left: 0, top: 0, width: half, height: H }).resize({ width: side === -1 ? Math.round(half * f) : half, height: H, fit: "fill" }).toBuffer();
  const R = await sharp(base).extract({ left: half, top: 0, width: W - half, height: H }).resize({ width: side === 1 ? Math.round((W - half) * f) : W - half, height: H, fit: "fill" }).toBuffer();
  const lw = (await sharp(L).metadata()).width!, rw = (await sharp(R).metadata()).width!;
  return uniq(sharp({ create: { width: lw + rw, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } }).composite([{ input: L, left: 0, top: 0 }, { input: R, left: lw, top: 0 }]));
}
/** Kiosk uchun: [to'g'ri, burilgan, ko'proq burilgan] — oxirgi kadr to'g'ri EMAS (tanish faqat [0] bo'yicha). */
const goodFrames = async () => [await uniq(ME()), await turned(1, 0.55), await turned(1, 0.4)];
/** Ro'yxatga olish uchun: [to'g'ri, burilgan (topshiriq), yana to'g'ri] — ilovadagi "kameraga qarang" oqimi. */
const enrollFrames = async (who = ME) => [await uniq(who()), await turned(1, who === ME ? 0.55 : 0.4, who), await uniq(who(6))];
/** Kadrning gorizontal ko'zgu-aksi (ba'zi telefonlarda old kamera kadri shunday). */
const flop = async (b: Buffer) => uniq(sharp(b).flop());
const urls = (b: Buffer[]) => b.map(dataUrl);
const msg = (r: { json: any; text: string }) => r.json?.error ?? r.json?.message ?? r.text.slice(0, 160); // eslint-disable-line @typescript-eslint/no-explicit-any

async function nonceAs(token: string, task: "TURN_LEFT" | "TURN_RIGHT" | null) {
  const c = (await api("GET", "/api/mobile/attendance/challenge", { token })).json as { nonce: string };
  await db.faceNonce.update({ where: { nonce: c.nonce }, data: { task } });
  return c.nonce;
}

async function main() {
  const saved = await db.faceTemplate.findMany();
  await db.faceTemplate.deleteMany({ where: { id: { in: saved.map((t) => t.id) } } });
  const [dir, kadr, ishlab, drv] = await Promise.all(["test.direktor", "test.kadr", "test.ishlab", "test.haydovchi"].map(tok));
  const e = await db.employee.create({ data: { fullName: `QA-K Kiosk ${stamp}`, position: "QA ofis xodimi" } });
  const date = dayUtc(today());

  try {
    // ───────────────────────── 1. Ruxsat ─────────────────────────
    section("Ruxsat: kim «Davomat» ni ochadi");
    let r = await api("GET", "/api/mobile/face", { token: dir });
    check(`direktor → 200, hamma xodim, yuz olish mumkin`, r.status === 200 && r.json?.scope === "all" && r.json?.canEnroll === true && Array.isArray(r.json?.roster), { s: r.status, j: r.json?.scope });
    r = await api("GET", "/api/mobile/face", { token: kadr });
    check(`otdel kadr → 200, yuz olish mumkin`, r.status === 200 && r.json?.canEnroll === true, { s: r.status });
    r = await api("GET", "/api/mobile/face", { token: ishlab });
    check(`ishlab chiqarish → 200, faqat sex, yuz olmaydi, ro'yxat yo'q`, r.status === 200 && r.json?.scope === "sex" && r.json?.canEnroll === false && r.json?.roster === null, { s: r.status, j: r.json });
    r = await api("GET", "/api/mobile/face", { token: drv });
    check(`haydovchi → 403`, r.status === 403, { s: r.status });
    r = await api("GET", "/api/mobile/home", { token: dir });
    check(`bosh sahifa: direktorda «Davomat» tugmasi`, r.json?.faceAttendance?.canEnroll === true, r.json?.faceAttendance);
    r = await api("GET", "/api/mobile/home", { token: drv });
    check(`bosh sahifa: haydovchida tugma yo'q`, r.status === 200 && !r.json?.faceAttendance, r.json?.faceAttendance);

    // ───────────────────────── 2. Ro'yxatga olish (ikki bosqich) ─────────────────────────
    section("Yuzni ro'yxatga olish — 1-bosqich (namunalar)");
    const enroll = (token: string, b: Record<string, unknown>) => api("POST", "/api/mobile/face/enroll", { token, body: { employeeId: e.id, ...b } });
    const tplCount = () => db.faceTemplate.count({ where: { employeeId: e.id } });
    r = await enroll(ishlab, { consent: true, frames: urls(await enrollFrames()), nonce: await nonceAs(ishlab, "TURN_LEFT") });
    check(`ishlab chiqarish yuz ololmaydi (${msg(r)})`, r.json?.ok === false && /otdel kadr/.test(msg(r)), r.json);
    r = await enroll(dir, { frames: urls(await enrollFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`roziliksiz → rad (${msg(r)})`, r.json?.ok === false && /rozilig/.test(msg(r)), r.json);
    r = await enroll(dir, { consent: true, photo: dataUrl(await uniq(ME())) });
    check(`bitta kadr → kamida 3 namuna kerak (${msg(r)})`, r.json?.ok === false && /Kamida 3/.test(msg(r)), r.json);
    r = await enroll(dir, { consent: true, frames: urls(await goodFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`oxirgi kadr burilgan (to'g'ri emas) → rad, namuna olinmaydi (${msg(r)})`, r.json?.ok === false && /to'g'ri qaramagan/.test(msg(r)) && (await tplCount()) === 0, r.json);
    const frames1 = await enrollFrames();
    r = await enroll(dir, { consent: true, frames: urls(frames1), nonce: await nonceAs(dir, "TURN_LEFT") });
    const pendingId = r.json?.pendingId as string | undefined;
    check(`1-bosqich → stage «verify», pendingId (${r.json?.note ?? msg(r)})`, r.json?.ok === true && r.json?.stage === "verify" && typeof pendingId === "string" && pendingId.length >= 16, r.json);
    check("1-bosqichdan keyin bazaga namuna yozilmadi", (await tplCount()) === 0);
    r = await enroll(dir, { consent: true, frames: urls(frames1), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`aynan o'sha kadrlar qayta → rad (${msg(r)})`, r.json?.ok === false && /avval yuborilgan/.test(msg(r)), r.json);

    section("Yuzni ro'yxatga olish — 2-bosqich (tasdiqlash)");
    r = await enroll(dir, { pendingId: "yoq-" + stamp, frames: urls(await enrollFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`noto'g'ri pendingId → rad, retry=false (${msg(r)})`, r.json?.ok === false && r.json?.retry === false && /qaytadan/.test(msg(r)), r.json);
    r = await enroll(kadr, { pendingId, frames: urls(await enrollFrames()), nonce: await nonceAs(kadr, "TURN_LEFT") });
    check(`boshqa foydalanuvchining pendingId'si → rad, retry=false (${msg(r)})`, r.json?.ok === false && r.json?.retry === false, r.json);
    for (let i = 1; i <= 3; i++) {
      r = await enroll(dir, { pendingId, frames: urls(await enrollFrames(OTHER)), nonce: await nonceAs(dir, "TURN_LEFT") });
      const last = i === 3;
      check(`${i}-urinish: boshqa odam kadrlari → tasdiqlanmadi, retry=${!last} (${msg(r)})`,
        r.json?.ok === false && r.json?.retry === !last && /o'xshashlik \d+%/.test(msg(r)) && (await tplCount()) === 0, r.json);
    }
    r = await enroll(dir, { pendingId, frames: urls(await enrollFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`3 ta muvaffaqiyatsiz urinishdan keyin pendingId bekor (${msg(r)})`, r.json?.ok === false && r.json?.retry === false && (await tplCount()) === 0, r.json);

    r = await enroll(dir, { consent: true, frames: urls(await enrollFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    const pending2 = r.json?.pendingId as string | undefined;
    check(`yangi 1-bosqich → verify (${r.json?.note ?? msg(r)})`, r.json?.stage === "verify" && !!pending2, r.json);
    const frames2 = await enrollFrames();
    r = await enroll(dir, { pendingId: pending2, frames: urls(frames2), nonce: await nonceAs(dir, "TURN_LEFT") });
    const tpl = await db.faceTemplate.findMany({ where: { employeeId: e.id } });
    check(`o'sha odam → stage «done», ${r.json?.count} namuna, o'xshashlik ${r.json?.similarity}% (${r.json?.note ?? msg(r)})`,
      r.json?.ok === true && r.json?.stage === "done" && r.json?.count === 4 && tpl.length === 4 && typeof r.json?.similarity === "number" && tpl.some((t) => t.photo), { j: r.json, n: tpl.length });
    check("xodim roziligi vaqti yozildi", !!(await db.employee.findUnique({ where: { id: e.id } }))?.faceConsentAt);
    const vFront = (await faceDescriptor(frames2[0]!))!.descriptor;
    const vTask = (await faceDescriptor(frames2[1]!))!.descriptor;
    const near = (v: number[]) => Math.min(...tpl.map((t) => distance(v, t.descriptor)));
    check(`topshiriq (burilgan) kadri namuna emas (eng yaqin namuna ${near(vTask).toFixed(3)}), to'g'ri kadr namuna (${near(vFront).toFixed(3)})`, near(vTask) > 0.05 && near(vFront) < 0.01, { task: near(vTask), front: near(vFront) });
    r = await enroll(dir, { pendingId: pending2, frames: urls(await enrollFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`saqlangandan keyin o'sha pendingId qayta → rad (${msg(r)})`, r.json?.ok === false && r.json?.retry === false, r.json);

    // ───────────────────────── 3. Kiosk ─────────────────────────
    section("Kiosk: kameraga qaragan xodimni tanish");
    await db.attendance.deleteMany({ where: { employeeId: e.id, date } });
    const scan = (token: string, b: Record<string, unknown>) => api("POST", "/api/mobile/face/scan", { token, body: b });
    r = await scan(drv, { mode: "auto", frames: urls(await goodFrames()), nonce: await nonceAs(drv, "TURN_LEFT") });
    check(`haydovchi skaner qila olmaydi (${msg(r)})`, r.json?.ok === false && r.json?.code === "FORBIDDEN", r.json);
    r = await scan(ishlab, { mode: "auto", frames: urls(await goodFrames()), nonce: await nonceAs(ishlab, "TURN_LEFT") });
    check(`sex boshlig'i — sex tarkibida bo'lmagan xodim → OUT_OF_SCOPE (${msg(r)})`, r.json?.ok === false && r.json?.code === "OUT_OF_SCOPE", r.json);
    r = await scan(dir, { mode: "auto", frames: urls([await uniq(ME()), await uniq(OTHER()), await turned(1, 0.4)]), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`ketma-ketlikda boshqa odam kadri → rad (${msg(r)})`, r.json?.ok === false && r.json?.code === "PHOTO_MISMATCH", r.json);
    r = await scan(dir, { mode: "auto", photo: dataUrl(await uniq(OTHER())) });
    check(`ro'yxatda yo'q odam → NO_MATCH, eng yaqin o'xshashlik bilan (${msg(r)})`, r.json?.ok === false && r.json?.code === "NO_MATCH" && /eng yaqin o'xshashlik \d+%/.test(msg(r)), r.json);
    r = await scan(dir, { mode: "auto", frames: urls(await goodFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    const att = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: e.id, date } } });
    check(`to'g'ri ketma-ketlik → «Keldi» (${r.json?.text})`, r.json?.ok === true && r.json?.kind === "in" && r.json?.employee?.id === e.id, r.json);
    check("tabelga FACE_ID manbasi va kadr bilan yozildi", att?.status === "PRESENT" && att.source === "FACE_ID" && !!att.facePhoto && att.markedById !== null, att);
    r = await scan(dir, { mode: "auto", frames: urls(await goodFrames()), nonce: await nonceAs(dir, "TURN_LEFT") });
    check(`qayta skaner (30 daq ichida) → «allaqachon» (${r.json?.text})`, r.json?.ok === true && r.json?.kind === "already", r.json);

    section("Kiosk: ko'zgu-aks kadr (old kamera) — o'sha odam");
    // Ko'zgu-aksda burilish tomoni ham teskari — topshiriq o'ngga. Aksning vektori aslidan ~0,25 uzoq; ko'zgu-aks
    // varianti bilan masofa ~0,06 — o'xshashlik ~100% (aks hisoblanmasa ~97% bo'lardi)
    const mirrored = await Promise.all((await goodFrames()).map(flop));
    const dRaw = distance((await faceDescriptor(mirrored[0]!))!.descriptor, (await faceDescriptor(await uniq(ME())))!.descriptor);
    await db.attendance.deleteMany({ where: { employeeId: e.id, date } });
    r = await scan(dir, { mode: "auto", frames: urls(mirrored), nonce: await nonceAs(dir, "TURN_RIGHT") });
    check(`ko'zgu-aks kadrlar → tanildi, o'xshashlik ${r.json?.similarity}% (aks hisobisiz masofa ${dRaw.toFixed(3)}) (${r.json?.text ?? msg(r)})`,
      r.json?.ok === true && r.json?.kind === "in" && r.json?.employee?.id === e.id && r.json?.similarity >= 99, r.json);

    // ───────────────────────── 4. Jurnal va kadr ─────────────────────────
    section("Bugungi jurnal va kadrni ko'rish");
    // Ko'zgu-aks sinovida yozuv qayta yaratilgan — joriy yozuv
    const cur = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: e.id, date } } });
    r = await api("GET", "/api/mobile/face", { token: dir });
    const row = (r.json?.log ?? []).find((x: { employee: { id: string } }) => x.employee.id === e.id);
    check("jurnalda xodim «Keldi» va kadri bor", row?.kind === "in" && row?.photo === true, row);
    r = await api("GET", `/api/mobile/face/photo?a=${cur?.id}&k=in`, { token: dir });
    check("jurnal kadri → data-URL (JPEG)", r.status === 200 && String(r.json?.data ?? "").startsWith("data:image/jpeg;base64,"), { s: r.status });
    r = await api("GET", `/api/mobile/face/photo?a=${cur?.id}&k=in`, { token: drv });
    check("haydovchi kadrni ko'ra olmaydi → 403", r.status === 403, { s: r.status });
    const tId = tpl.find((t) => t.photo)?.id;
    r = await api("GET", `/api/mobile/face/photo?t=${tId}`, { token: dir });
    check("ro'yxatga olish kadri → direktor ko'radi", r.status === 200 && !!r.json?.data, { s: r.status });
    r = await api("GET", `/api/mobile/face/photo?t=${tId}`, { token: ishlab });
    check("ro'yxatga olish kadri → sex boshlig'iga yo'q (404)", r.status === 404, { s: r.status });

    // ───────────────────────── 5. O'chirish ─────────────────────────
    section("Yuz ma'lumotini o'chirish");
    r = await api("POST", "/api/mobile/face/delete", { token: ishlab, body: { employeeId: e.id } });
    check(`ishlab chiqarish o'chira olmaydi (${msg(r)})`, r.json?.ok === false, r.json);
    r = await api("POST", "/api/mobile/face/delete", { token: dir, body: { employeeId: e.id } });
    check(`direktor o'chiradi (${r.json?.note})`, r.json?.ok === true && (await db.faceTemplate.count({ where: { employeeId: e.id } })) === 0, r.json);
  } finally {
    await db.faceTemplate.deleteMany({ where: { employeeId: e.id } });
    await db.attendance.deleteMany({ where: { employeeId: e.id } });
    await db.employee.update({ where: { id: e.id }, data: { isActive: false } });
    const alive = new Set((await db.employee.findMany({ where: { id: { in: saved.map((t) => t.employeeId) } }, select: { id: true } })).map((x) => x.id));
    await db.faceTemplate.createMany({ data: saved.filter((t) => alive.has(t.employeeId)), skipDuplicates: true });
    await db.$disconnect();
  }
  done();
}

main().catch((err) => { console.error(err); process.exit(1); });
