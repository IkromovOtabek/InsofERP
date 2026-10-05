// QA (B) — kadr: xodim kartasi (surat + hujjatlar: haqiqiy JPG/PNG/PDF, HEIC surat rad), tahrir, lavozim, davomat,
// login berish, ishdan bo'shatish (login bloklanadi, sessiya ham), qaytarish.
// Ishga tushirish: npx tsx scripts/qa/b-hr.mts
import sharp from "sharp";
import { as, check, summary, fd, q, q1, n1, Client } from "./b-client.mjs";

const OK = "(app)/otdel-kadr/actions";
const EA = "(app)/employees/actions";
const kadr = await as("kadr"), dir = await as("direktor"), sklad = await as("sklad");
const tag = Date.now() % 1_000_000;
const phone = () => `+99890${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;

// Haqiqiy kichik fayllar
const png = await sharp({ create: { width: 60, height: 80, channels: 3, background: { r: 200, g: 180, b: 160 } } }).png().toBuffer();
const jpg = await sharp({ create: { width: 60, height: 80, channels: 3, background: { r: 90, g: 120, b: 200 } } }).jpeg().toBuffer();
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
// HEIC: ISO-BMFF "ftypheic" sarlavhasi (iPhone fayli shunday boshlanadi)
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from([0, 0, 0, 0]), Buffer.from("mif1heic"), Buffer.alloc(200, 1)]);
const file = (b: Buffer, name: string, type: string) => new File([new Uint8Array(b)], name, { type });

// ── 1) Kadr kartasi ──
const name1 = `QA Xodim ${tag}`;
let r = await kadr.action(`${OK}#createEmployeeCard`, [undefined, fd({ fullName: name1, position: "Betonchi", phone: phone(), photo: file(heic, "IMG_0001.HEIC", "image/heic") })], "/otdel-kadr/yangi");
check(/HEIC/.test(r.error ?? ""), "HEIC profil surati aniq o'zbekcha xato bilan rad etildi", r.error);
check(n1(`select count(*) from "Employee" where "fullName"='${name1}'`) === 0, "HEIC rad etilganda karta yaratilmadi");
r = await kadr.action(`${OK}#createEmployeeCard`, [undefined, fd({ fullName: name1, position: "Betonchi", phone: phone(), birthDate: "1990-02-31x" })], "/otdel-kadr/yangi");
check(/Sana/.test(r.error ?? "") && !r.forbidden, "noto'g'ri tug'ilgan sana — forma xatosi (500 emas)", r.error);
r = await kadr.action(`${OK}#createEmployeeCard`, [undefined, fd({
  fullName: name1, position: "Betonchi", phone: phone(), birthDate: "1990-05-12", hiredAt: "2026-09-01", pinfl: "12345678901234",
  photo: file(png, "surat.png", "image/png"), "doc:Passport": file(jpg, "passport.jpg", "image/jpeg"), "doc:Diplom": file(pdf, "diplom.pdf", "application/pdf"),
})], "/otdel-kadr/yangi");
const emp = q1(`select id from "Employee" where "fullName"='${name1}'`)!;
check(!!emp && /varaqa/.test(r.redirect ?? ""), "karta surat + 2 hujjat bilan yaratildi", r.error ?? r.redirect);
check(n1(`select count(*) from "EmployeeDocument" where "employeeId"='${emp}'`) === 2, "2 ta hujjat saqlandi");
check(/\.png$/.test(q1(`select photo from "Employee" where id='${emp}'`) ?? ""), "surat PNG sifatida saqlandi");
// Dublikat PINFL
r = await kadr.action(`${OK}#createEmployeeCard`, [undefined, fd({ fullName: name1 + " 2", position: "Betonchi", phone: phone(), pinfl: "12345678901234" })], "/otdel-kadr/yangi");
check(!!r.error, "takroriy PINFL rad etildi", r.error);
// Fayllarni ko'rish (login talab qiladi)
const photoRes = await kadr.get(`/employees/${emp}/surat`);
check(photoRes.status === 200, "surat marshruti ochildi", photoRes.status);
const anon = new Client();
const photoAnon = await anon.get(`/employees/${emp}/surat`);
check(photoAnon.status !== 200, "surat loginsiz berilmaydi", photoAnon.status);
const docId = q1(`select id from "EmployeeDocument" where "employeeId"='${emp}' and "fileType"='application/pdf'`)!;
const docRes = await kadr.get(`/employees/${emp}/hujjat/${docId}`);
check(docRes.status === 200, "PDF hujjat yuklab olinadi", docRes.status);

// Surat almashtirish: HEIC → rad, JPG → ok
r = await kadr.action(`${OK}#updateEmployeePhoto`, [emp, undefined, fd({ photo: file(heic, "x.heic", "image/heic") })], `/employees/${emp}`);
check(/HEIC/.test(r.error ?? ""), "surat almashtirishda HEIC rad etildi", r.error);
r = await kadr.action(`${OK}#updateEmployeePhoto`, [emp, undefined, fd({ photo: file(jpg, "yangi.jpg", "image/jpeg") })], `/employees/${emp}`);
check(r.ok && /\.jpg$/.test(q1(`select photo from "Employee" where id='${emp}'`) ?? ""), "JPG surat bilan almashtirildi", r.error);
// Hujjat sifatida HEIC qabul qilinadi (faqat saqlanadi), matn fayli — yo'q
r = await kadr.action(`${OK}#addEmployeeDocument`, [emp, undefined, fd({ kind: "Tibbiy ma'lumotnoma", file: file(heic, "tibbiy.heic", "image/heic") })], `/employees/${emp}`);
check(r.ok, "HEIC hujjat nusxasi saqlandi", r.error);
r = await kadr.action(`${OK}#addEmployeeDocument`, [emp, undefined, fd({ kind: "Boshqa", file: file(Buffer.from("<script>alert(1)</script>"), "x.pdf", "application/pdf") })], `/employees/${emp}`);
check(/PDF yoki rasm/.test(r.error ?? ""), "soxta PDF (matn) rad etildi", r.error);
// Sklad kadr amallarini qila olmaydi
r = await sklad.action(`${OK}#addEmployeeDocument`, [emp, undefined, fd({ kind: "Boshqa", file: file(pdf, "a.pdf", "application/pdf") })], `/employees/${emp}`);
check(!r.ok, "sklad xodim hujjatini yuklay olmaydi");

// ── 2) Lavozim (stavka), tahrir ──
const posName = `QA lavozim ${tag}`;
r = await kadr.action(`${OK}#saveWorkPosition`, [null, undefined, fd({ name: posName, note: "QA", sortOrder: "5" })], "/otdel-kadr?tab=lavozimlar");
check(r.ok && n1(`select count(*) from "WorkPosition" where name='${posName}'`) === 1, "lavozim qo'shildi", r.error);
r = await kadr.action(`${OK}#saveWorkPosition`, [null, undefined, fd({ name: posName })], "/otdel-kadr?tab=lavozimlar");
check(/allaqachon/.test(r.error ?? ""), "takroriy lavozim rad etildi", r.error);
r = await kadr.action(`${OK}#saveWorkPosition`, [null, undefined, fd({ name: "Sklad" })], "/otdel-kadr?tab=lavozimlar");
check(/bo'lim/.test(r.error ?? ""), "bo'lim nomi ishchi lavozim bo'lolmaydi", r.error);
const empPhone = q1(`select phone from "Employee" where id='${emp}'`)!;
r = await kadr.action(`${EA}#updateEmployee`, [emp, undefined, fd({ fullName: name1, position: posName, phone: empPhone, tariffRate: "3 500 000", hiredAt: "2026-09-01", tabelNo: "T-77" })], `/employees/${emp}`);
check(r.ok && n1(`select "tariffRate" from "Employee" where id='${emp}'`) === 3_500_000, "stavka 3 500 000 va yangi lavozim saqlandi", r.error);
r = await kadr.action(`${EA}#updateEmployee`, [emp, undefined, fd({ fullName: name1, position: posName, phone: empPhone, hiredAt: "garbage" })], `/employees/${emp}`);
check(/Sana/.test(r.error ?? "") && !r.forbidden, "tahrirda noto'g'ri sana — forma xatosi", r.error);

// ── 3) Davomat ──
const today = new Date().toLocaleDateString("sv-SE");
const att = fd({ "emp[]": emp, [`st:${emp}`]: "PRESENT", [`in:${emp}`]: "08:00", [`out:${emp}`]: "18:30", [`ver:${emp}`]: "" });
r = await kadr.action("(app)/otdel-kadr/davomat-actions#saveAttendance", [today, undefined, att], "/otdel-kadr?tab=davomat");
check(r.ok && q1(`select status from "Attendance" where "employeeId"='${emp}'`) === "PRESENT", "davomat: keldi 08:00–18:30", r.error);
r = await kadr.action("(app)/otdel-kadr/davomat-actions#saveAttendance", [today, undefined, att], "/otdel-kadr?tab=davomat");
check(/o'tkazib/.test(r.text) || /o'tkazib/.test(JSON.stringify(r.text.match(/^1:.*$/m))), "eskirgan versiya bilan qayta saqlash o'tkazib yuborildi");
r = await kadr.action("(app)/otdel-kadr/davomat-actions#saveAttendance", [today, undefined, fd({ "emp[]": "yoq-xodim", "st:yoq-xodim": "PRESENT", "ver:yoq-xodim": "" })], "/otdel-kadr?tab=davomat");
check(!!r.error && !r.forbidden, "mavjud bo'lmagan xodimga davomat — aniq xato", r.error);
const tomorrow = new Date(Date.now() + 2 * 864e5).toLocaleDateString("sv-SE");
r = await kadr.action("(app)/otdel-kadr/davomat-actions#saveAttendance", [tomorrow, undefined, att], "/otdel-kadr?tab=davomat");
check(/Kelajak/.test(r.error ?? ""), "kelajak kuniga davomat rad etildi", r.error);

// ── 4) Login, bo'shatish, kirish bloklanadi ──
const loginName = `qa.xodim${tag}`;
const pass = "QaTest-2026!x";
r = await kadr.action(`${EA}#grantLogin`, [emp, undefined, fd({ login: loginName, password: pass, role: "DRIVER" })], `/employees/${emp}`);
check(r.ok && !!q1(`select "userId" from "Employee" where id='${emp}'`), "kadr haydovchi login berdi", r.error);
const u = new Client();
await u.login(loginName, pass);
let g = await u.get("/mening-reyslarim");
check(g.status === 200, "yangi login bilan kirdi", g.status);
// Kartadan bo'shatish sanasi (tahrir yo'li) ham loginni bloklaydi
r = await kadr.action(`${EA}#dismissEmployee`, [emp, undefined, fd({ firedAt: today, reason: "" })], `/employees/${emp}`);
check(/sabab/.test(r.error ?? ""), "sababsiz bo'shatish rad etildi", r.error);
r = await kadr.action(`${EA}#dismissEmployee`, [emp, undefined, fd({ firedAt: today, reason: "O'z xohishi bilan" })], `/employees/${emp}`);
check(r.ok, "xodim ishdan bo'shatildi", r.error);
check(q1(`select u."isActive"::text from "User" u join "Employee" e on e."userId"=u.id where e.id='${emp}'`) === "false", "login bloklandi");
g = await u.get("/mening-reyslarim");
check(g.status !== 200 || /login/i.test(g.location ?? ""), "bo'shatilgan xodimning ochiq sessiyasi ishlamaydi", `${g.status} ${g.location}`);
const u2 = new Client();
const lr = await u2.action("(auth)/login/actions#loginAction", [undefined, fd({ login: loginName, password: pass })], "/login");
check(!u2.cookies.insof_session, "bo'shatilgan xodim qayta kira olmaydi", lr.error ?? lr.text.slice(0, 120));
r = await kadr.action(`${EA}#dismissEmployee`, [emp, undefined, fd({ firedAt: today, reason: "Yana" })], `/employees/${emp}`);
check(/allaqachon/.test(r.error ?? ""), "qayta bo'shatish rad etildi", r.error);
r = await kadr.action(`${EA}#restoreEmployee`, [emp], `/employees/${emp}`);
check(r.ok && q1(`select u."isActive"::text from "User" u join "Employee" e on e."userId"=u.id where e.id='${emp}'`) === "true", "ishga qaytarildi, login ochildi", r.error);
const u3 = new Client();
await u3.login(loginName, pass);
check(!!u3.cookies.insof_session, "qaytarilgan xodim yana kira oladi");

// Ochiq reysi bor haydovchini kartadan (tahrir) bo'shatib bo'lmaydi
const drv = q(`select e.id, e."fullName", e.position, e.phone from "Employee" e join "Trip" t on t."driverId"=e.id where t.status in ('PLANNED','LOADED','ON_ROAD') and e."firedAt" is null limit 1`)[0];
if (drv) {
  r = await kadr.action(`${EA}#updateEmployee`, [drv[0], undefined, fd({ fullName: drv[1], position: drv[2], phone: drv[3] ?? "", firedAt: today })], `/employees/${drv[0]}`);
  check(/ochiq reys/.test(r.error ?? ""), "ochiq reysli haydovchini kartadan bo'shatish rad etildi", r.error);
} else console.log("   info: ochiq reysli haydovchi yo'q — tekshiruv o'tkazib yuborildi");

// Sahifalar
for (const p of ["/employees", `/employees/${emp}`, `/employees/${emp}/varaqa`, `/employees/${emp}/hujjat/chop/toplam`, "/otdel-kadr", "/otdel-kadr?tab=davomat", "/otdel-kadr?tab=lavozimlar", "/otdel-kadr?tab=taqvim", "/otdel-kadr?tab=bolimlar"]) {
  for (const [nm, c] of [["kadr", kadr], ["direktor", dir]] as const) { const x = await c.get(p); check(x.status === 200, `${nm} ${p} → ${x.status}`); }
}
summary("b-hr");
process.exit();
