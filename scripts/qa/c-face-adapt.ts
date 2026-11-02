/**
 * QA (C) — Face ID moslashuvchan namunalari (`learnFaceSample`, `lib/face-id.ts`): masofa oynasi, qo'lda olingan
 * namunaga langar (zanjir bo'lib uzoqlashmaslik), "begona odam" (`MATCH_MIN_MARGIN`) va boshqa xodim namunasiga
 * yaqinlik (`DUPLICATE_DISTANCE`), vaqt oralig'i, avtomatik namunalar chegarasi (eng eskisi almashadi, qo'lda olinganlar
 * o'chmaydi), jami `ENROLL_MAX_SAMPLES`, ko'zgu-aks varianti, kesh yangilanishi, qayta ro'yxatga olishda tozalanish.
 * Server shart emas — vektorlar sintetik (deterministik), faqat baza.
 *
 *   DATABASE_URL=… npx tsx scripts/qa/c-face-adapt.ts
 */
import { check, done, section } from "./c-lib";
import { db } from "@/lib/db";
import { ADAPT_MAX_AUTO, DUPLICATE_DISTANCE, type FaceActor, MATCH_MAX_DISTANCE, distance, faceTemplates, invalidateFaceTemplates, learnFaceSample, saveEnrollment } from "@/lib/face-id";
import { ENROLL_MAX_SAMPLES, FACE_DIM } from "@/lib/face-id-const";

const stamp = Date.now().toString(36);
let seed = 20261031;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
/** Tasodifiy "yuz" vektori (me'yori ~1, face-api vektorlariga o'xshash). */
const face = () => Array.from({ length: FACE_DIM }, () => rnd() * 0.15);
/** Birlik yo'nalish. */
const dir = () => { const v = face(); const n = Math.hypot(...v); return v.map((x) => x / n); };
/** `m` dan `u` yo'nalishda aynan `k` masofadagi vektor. */
const at = (m: number[], u: number[], k: number) => m.map((x, i) => x + k * u[i]!);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function main() {
  const actor = await db.user.findFirstOrThrow({ where: { login: "test.kadr" } });
  const ctx = { userId: actor.id };
  const fa: FaceActor = { userId: actor.id, role: actor.role };
  const emp = async (name: string) => db.employee.create({ data: { fullName: `QA-A ${name} ${stamp}`, position: "Operator" } });
  const put = (employeeId: string, descriptor: number[], auto = false, createdAt?: Date) => db.faceTemplate.create({ data: { employeeId, descriptor, auto, ...(createdAt ? { createdAt } : {}) } });
  const autos = (employeeId: string) => db.faceTemplate.findMany({ where: { employeeId, auto: true }, orderBy: { createdAt: "asc" } });
  /** Avtomatik namunalarni `h` soat oldinga suradi — vaqt oralig'i qoidasi keyingi qo'shishni to'smasin. */
  const age = (employeeId: string, h: number) => db.$executeRaw`UPDATE "FaceTemplate" SET "createdAt" = "createdAt" - ${h}::int * interval '1 hour' WHERE "employeeId" = ${employeeId} AND auto`;

  section("Masofa oynasi va saqlash");
  const x = await emp("X");
  const m = face();
  await put(x.id, m);
  const u1 = dir();
  check("juda yaqin kadr (0,05) — qo'shilmaydi", !(await learnFaceSample(x.id, [[at(m, u1, 0.05)]], ctx)));
  check("uzoq kadr (0,40 ≥ 0,35) — qo'shilmaydi", !(await learnFaceSample(x.id, [[at(m, u1, 0.4)]], ctx)));
  const p1 = at(m, u1, 0.25);
  check("0,25 — qo'shildi", await learnFaceSample(x.id, [[p1]], ctx));
  let a = await autos(x.id);
  check(`bazada 1 ta avtomatik namuna, vektor — kadrniki (${a.length})`, a.length === 1 && distance(a[0]!.descriptor, p1) < 1e-9 && a[0]!.createdById === actor.id, a.length);
  const cached = (await faceTemplates()).filter((t) => t.employeeId === x.id);
  check(`kesh yangilandi: ${cached.length} namuna, biri auto`, cached.length === 2 && cached.filter((t) => t.auto).length === 1);
  const log = await db.auditLog.findFirst({ where: { entity: "FaceTemplate", entityId: x.id }, orderBy: { createdAt: "desc" } });
  check("auditga yozildi", !!log && JSON.stringify(log.after).includes("avtoNamuna"), log?.after);
  check("darhol yana (vaqt oralig'i) — qo'shilmaydi", !(await learnFaceSample(x.id, [[at(m, dir(), 0.25)]], ctx)));

  section(`Chegara: ${ADAPT_MAX_AUTO} ta avtomatik, eng eskisi almashadi, qo'lda olingan o'chmaydi`);
  const added: number[][] = [p1];
  for (let i = 0; i < ADAPT_MAX_AUTO + 1; i++) {
    await age(x.id, 7);
    const p = at(m, dir(), 0.3);
    const ok = await learnFaceSample(x.id, [[p]], ctx);
    if (ok) added.push(p);
    check(`${i + 2}-avtomatik namuna qo'shildi`, ok);
  }
  a = await autos(x.id);
  const kept = added.slice(-ADAPT_MAX_AUTO);
  check(`avtomatik namunalar ${a.length} = ${ADAPT_MAX_AUTO}, eng yangilari qoldi`, a.length === ADAPT_MAX_AUTO && kept.every((k) => a.some((t) => distance(t.descriptor, k) < 1e-9)));
  check("qo'lda olingan namuna joyida", (await db.faceTemplate.count({ where: { employeeId: x.id, auto: false } })) === 1);

  section("Langar: avtomatik namunaga yaqin, qo'lda olinganidan uzoq — qo'shilmaydi");
  const y = await emp("Y");
  const my = face(), uy = dir();
  await put(y.id, my);
  await put(y.id, at(my, uy, 0.3), true, new Date(Date.now() - 10 * 3_600_000));
  const drift = at(my, uy, 0.55); // avtomatikdan 0,25, qo'ldagidan 0,55
  check(`zanjir bo'lib uzoqlashish (qo'ldagidan ${r3(distance(drift, my))} > ${MATCH_MAX_DISTANCE}) — rad`, !(await learnFaceSample(y.id, [[drift]], ctx)));

  section("Begona odam va boshqa xodim namunasiga yaqinlik");
  const z = await emp("Z"), w = await emp("W");
  const mz = face(), uz = dir();
  await put(z.id, mz);
  const pz = at(mz, uz, 0.25);
  // W namunasi kadrga 0,28 da — o'zinikidan (0,25) MATCH_MIN_MARGIN dan kam uzoq
  // W yo'nalishi Z ning siljishiga tik — masofalar aniq
  const v = dir();
  const vu = v.reduce((s, c, j) => s + c * uz[j]!, 0);
  const raw = v.map((c, i) => c - vu * uz[i]!);
  const on = Math.hypot(...raw);
  const uw = raw.map((c) => c / on);
  const wt = await put(w.id, at(pz, uw, 0.28));
  check(`boshqa xodim 0,28 da (margin < 0,06) — rad`, !(await learnFaceSample(z.id, [[pz]], ctx)));
  await db.faceTemplate.update({ where: { id: wt.id }, data: { descriptor: at(pz, uw, 0.38) } });
  invalidateFaceTemplates(); // joyida o'zgartirish kesh imzosiga ta'sir qilmaydi (prod kodda namuna faqat qo'shiladi/o'chiriladi)
  check(`boshqa xodim 0,38 da (margin bor, lekin < DUPLICATE ${DUPLICATE_DISTANCE}) — rad`, !(await learnFaceSample(z.id, [[pz]], ctx)));
  await db.faceTemplate.update({ where: { id: wt.id }, data: { descriptor: at(pz, uw, 0.6) } });
  invalidateFaceTemplates();
  check("boshqa xodim 0,60 da — qo'shildi", await learnFaceSample(z.id, [[pz]], ctx));

  section("Ko'zgu-aks: saqlanadigan vektor — eng yaqin variant");
  const k = await emp("K");
  const mk = face();
  await put(k.id, mk);
  const mir = at(mk, dir(), 0.2);
  check("[asl uzoq, aksi 0,2] — qo'shildi", await learnFaceSample(k.id, [[face(), mir]], ctx));
  a = await autos(k.id);
  check("saqlangani — aksi", a.length === 1 && distance(a[0]!.descriptor, mir) < 1e-9);

  section(`Jami ${ENROLL_MAX_SAMPLES} dan oshmaydi`);
  const f = await emp("F");
  const mf = face();
  for (let i = 0; i < ENROLL_MAX_SAMPLES - 1; i++) await put(f.id, at(mf, dir(), 0.05));
  check(`${ENROLL_MAX_SAMPLES - 1} qo'lda + 1 avtomatik — qo'shildi`, await learnFaceSample(f.id, [[at(mf, dir(), 0.3)]], ctx));
  await age(f.id, 7);
  check("yana biri — eskisi almashadi", await learnFaceSample(f.id, [[at(mf, dir(), 0.3)]], ctx));
  check(`jami ${ENROLL_MAX_SAMPLES}, avtomatik 1`, (await db.faceTemplate.count({ where: { employeeId: f.id } })) === ENROLL_MAX_SAMPLES && (await autos(f.id)).length === 1);
  await put(f.id, at(mf, dir(), 0.05));
  await db.faceTemplate.deleteMany({ where: { employeeId: f.id, auto: true } });
  check(`${ENROLL_MAX_SAMPLES} qo'lda — o'rin yo'q, qo'shilmaydi`, !(await learnFaceSample(f.id, [[at(mf, dir(), 0.3)]], ctx)));

  section("Qayta ro'yxatga olish avtomatiklarni ham almashtiradi");
  const before = await db.faceTemplate.count({ where: { employeeId: x.id, auto: true } });
  const nm = face();
  const r = await saveEnrollment(fa, x.id, [0, 1, 2].map(() => ({ descriptor: at(nm, dir(), 0.05), score: 0.9 })), async () => null);
  check(`saveEnrollment (${r.ok ? r.note : r.error}): avtomatik ${before} → ${(await autos(x.id)).length}`, r.ok && (await autos(x.id)).length === 0);
  check("eski yuzdan kadr endi qo'shilmaydi", !(await learnFaceSample(x.id, [[p1]], ctx)));

  await db.employee.deleteMany({ where: { fullName: { startsWith: "QA-A ", endsWith: stamp } } });
  await db.$disconnect();
  done();
}
void main();
