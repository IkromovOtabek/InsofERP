// Dispetcher haydovchiga kirish beradi (`logistika` → `driver_login`, `lib/temp-password.ts`):
//  · faqat dispetcher (vebda direktor ham), faqat faol haydovchi lavozimidagi xodim, faqat DRIVER roli;
//  · parolni tizim yaratadi, u 72 soat amal qiladi; vaqtinchalik parol bilan kirilganda sessiya yo'q —
//    avval o'z paroli (veb: loginAction → setTempPasswordAction, mobil: PASSWORD_CHANGE_REQUIRED → /auth/temp-password);
//  · token bir martalik, muddati o'tgan parol kirmaydi, kadr/direktor parolni tiklasa belgi tozalanadi;
//  · audit va Otdel kadr + direktorga bildirishnoma; haydovchi kartasida blok faqat huquqi borga.
// Ishga tushirish: npx tsx scripts/qa/driver-login.mts  (QA_BASE, QA_DATABASE_URL — README.md)
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, summary, BASE } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q1, exec, lit } from "./db.mjs";
import { catalogProblems } from "../../src/lib/perm-buttons";

const T = Date.now().toString(36).slice(-5);
const OWN = "OzParol2026", OWN2 = "Yangi2026x";
const disp = new Client("dispetcher"), kadr = new Client("kadr"), logi = new Client("logistika"), dir = new Client("direktor");
await Promise.all([disp.login("test.dispetcher"), kadr.login("test.kadr"), logi.login("test.logistika"), dir.login("test.direktor")]);
// Prisma DateTime — `timestamp` (zonasiz, UTC): psql JSON'ida "Z" yo'q, aks holda JS mahalliy vaqt deb o'qiydi
const userOf = (login: string) => q1(`select id, role, "isActive", "sessionVersion" as sv, to_char("tempPasswordUntil", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as until from "User" where login=${lit(login)}`);
const empOf = (id: string) => q1(`select "userId" from "Employee" where id=${lit(id)}`);

let ipSeq = 0;
async function mobile(path: string, body: unknown) {
  const r = await fetch(BASE + path, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` },
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const give = (c: Client, id: string, form: Record<string, unknown> = {}) =>
  c.action("logistika/actions#giveDriverLogin", [id, undefined, fd(form)], `/logistika/haydovchilar/${id}`);
const webLogin = (c: Client, login: string, password: string) =>
  c.action("(auth)/login/actions#loginAction", [undefined, fd({ login, password })], "/login");
const setOwn = (c: Client, token: string, password: string, confirm = password) =>
  c.action("(auth)/login/actions#setTempPasswordAction", [undefined, fd({ token, password, confirm })], "/login");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────── 0. Tayyorgarlik ─────────
console.log("\n0. Tayyorgarlik");
check("0.1 ruxsatlar daraxti: driver_login katalogda", catalogProblems().length === 0, catalogProblems());
const fullName = `QA Haydovchi ${T}`;
let r = await kadr.action("employees/actions#createEmployee", [undefined, fd({ fullName, position: "Haydovchi", plate: `QA${T}`.toUpperCase() })], "/employees");
const emp = q1(`select id from "Employee" where "fullName"=${lit(fullName)}`);
check("0.2 kadr loginsiz haydovchi kartasini ochdi", r.result?.ok === true && !!emp && !empOf(emp.id).userId, r.result ?? r.status);
const sales = q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login='test.sotuv'`);

// ───────── 1. Kim bera oladi ─────────
console.log("\n1. Ruxsat va cheklovlar");
const login = `qadl${T}`.toLowerCase();
r = await give(logi, emp.id, { login });
check("1.1 logistika bera olmaydi (driver_login yo'q)", r.result?.password === undefined && !userOf(login), r.result ?? r.status);
r = await give(disp, sales.id, { login: `qax${T}` });
check("1.2 haydovchi bo'lmagan xodimga — xato", /haydovchi lavozimidagi/.test(r.result?.error ?? ""), r.result ?? r.status);
r = await give(disp, emp.id, { login: "A" });
check("1.3 noto'g'ri login — xato, hisob ochilmaydi", /Login:/.test(r.result?.error ?? "") && !empOf(emp.id).userId, r.result);
let page = await logi.get(`/logistika/haydovchilar/${emp.id}`);
check("1.4 logistika kartasida «Tizimga kirish» bloki yo'q", page.status === 200 && !page.text.includes("Login va parol berish"), page.status);

// ───────── 2. Login berish ─────────
console.log("\n2. Dispetcher login beradi");
r = await give(disp, emp.id, { login });
const temp1 = r.result?.password as string;
let u = userOf(login);
const hours = u?.until ? (new Date(u.until).getTime() - Date.now()) / 3600_000 : 0;
check("2.1 login va 8 belgili parol qaytdi", r.result?.created === true && r.result.login === login && /^[a-z]{4}\d{4}$/.test(temp1 ?? ""), r.result);
check("2.2 DRIVER roli, vaqtinchalik ~72 soat, kartaga bog'landi", u?.role === "DRIVER" && hours > 71.9 && hours <= 72 && empOf(emp.id).userId === u.id, [u, hours]);
check("2.3 audit: tempPassword + loginCreated", !!q1(`select id from "AuditLog" where entity='Employee' and "entityId"=${lit(emp.id)} and after->>'tempPassword'='true' and after->>'loginCreated'='true'`));
await sleep(1500);
const notes = q1(`select count(distinct n."userId")::int as n, bool_or(u.role='HR') as hr, bool_or(u.role='DIRECTOR') as dir from "Notification" n join "User" u on u.id=n."userId" where n.type='DRIVER_LOGIN' and n.body like ${lit(`%${login}%`)}`);
check("2.4 Otdel kadr va direktorga bildirishnoma", notes?.hr === true && notes?.dir === true, notes);
r = await give(disp, emp.id, { login: `boshqa${T}` });
const temp2 = r.result?.password as string;
check("2.5 qayta bosish — yangi hisob emas, shu loginga yangi parol", r.result?.created === false && r.result.login === login && temp2 !== temp1, r.result);
page = await disp.get(`/logistika/haydovchilar/${emp.id}`);
check("2.6 dispetcher kartasida holat: vaqtinchalik parol", page.status === 200 && page.text.includes("vaqtinchalik parol") && page.text.includes("Yangi vaqtinchalik parol"), page.status);

// ───────── 3. Veb: vaqtinchalik parol bilan kirish ─────────
console.log("\n3. Veb kirish");
const drv = new Client("haydovchi");
r = await webLogin(drv, login, temp1);
check("3.1 eski vaqtinchalik parol (qayta berilgan) ishlamaydi", /noto'g'ri/.test(r.result?.error ?? ""), r.result);
r = await webLogin(drv, login, temp2);
const token = r.result?.tempToken as string;
check("3.2 to'g'ri parol — sessiya yo'q, 2-qadam tokeni", typeof token === "string" && token.length > 40 && !drv.cookies.insof_session, [r.result, drv.cookies]);
r = await setOwn(drv, token, OWN, OWN + "x");
check("3.3 takror mos emas — xato, token saqlanadi", /mos emas/.test(r.result?.error ?? "") && r.result.tempToken === token, r.result);
r = await setOwn(drv, token, "qisqa1");
check("3.4 parol siyosati (8 belgi)", /kamida 8/.test(r.result?.error ?? "") && r.result.tempToken === token, r.result);
r = await setOwn(drv, token, temp2);
check("3.5 vaqtinchalik parolning o'zi — rad", /farq qilsin/.test(r.result?.error ?? ""), r.result);
r = await setOwn(drv, token, OWN);
u = userOf(login);
check("3.6 o'z paroli saqlandi → sessiya, belgi tozalandi", !!r.redirect && !!drv.cookies.insof_session && u.until === null, [r.redirect, r.result, u]);
r = await setOwn(new Client("x"), token, "Boshqa2026");
check("3.7 token bir martalik — qayta ishlatib bo'lmaydi", !!r.result?.error && !r.result.tempToken, r.result);
page = await drv.get("/mening-reyslarim");
check("3.8 haydovchi o'z sahifasini ochadi", page.status === 200, page.status);
r = await webLogin(new Client("x"), login, temp2);
check("3.9 vaqtinchalik parol endi ishlamaydi", /noto'g'ri/.test(r.result?.error ?? ""), r.result);
const again = new Client("haydovchi2");
await again.login(login, OWN);
check("3.10 o'z paroli bilan oddiy kirish", !!again.cookies.insof_session);

// ───────── 4. Parolni qayta berish: eski sessiya kuyadi ─────────
console.log("\n4. Qayta berish");
const sv0 = userOf(login).sv;
r = await give(disp, emp.id);
const temp3 = r.result?.password as string;
u = userOf(login);
check("4.1 yangi vaqtinchalik parol, sessionVersion oshdi", r.result?.created === false && !!temp3 && u.sv > sv0 && !!u.until, [r.result, u]);
page = await again.get("/mening-reyslarim");
check("4.2 haydovchining eski sessiyasi tugadi", page.status !== 200, page.status);
r = await webLogin(new Client("x"), login, OWN);
check("4.3 eski o'z paroli ishlamaydi", /noto'g'ri/.test(r.result?.error ?? ""), r.result);

// ───────── 5. Mobil ─────────
console.log("\n5. Mobil API");
let m = await mobile("/api/mobile/auth/login", { login, password: temp3 });
const ct = m.json?.changeToken;
check("5.1 vaqtinchalik parol — 403 PASSWORD_CHANGE_REQUIRED + changeToken, token yo'q", m.status === 403 && m.json?.code === "PASSWORD_CHANGE_REQUIRED" && typeof ct === "string" && !m.json?.accessToken, m);
m = await mobile("/api/mobile/auth/temp-password", { changeToken: "buzuq", password: OWN2 });
check("5.2 buzuq token — 401", m.status === 401 && m.json?.code === "TOKEN_INVALID", m);
m = await mobile("/api/mobile/auth/temp-password", { changeToken: ct, password: "parolsiz" });
check("5.3 siyosat — 400", m.status === 400 && /raqam/.test(m.json?.message ?? ""), m);
m = await mobile("/api/mobile/auth/temp-password", { changeToken: ct, password: OWN2 });
check("5.4 o'z paroli → tokenlar, DRIVER", m.status === 200 && !!m.json?.accessToken && m.json?.user?.role === "DRIVER" && userOf(login).until === null, m.status);
m = await mobile("/api/mobile/auth/temp-password", { changeToken: ct, password: "Uchinchi2026" });
check("5.5 changeToken bir martalik", m.status === 401, m);
m = await mobile("/api/mobile/auth/login", { login, password: OWN2 });
check("5.6 yangi parol bilan oddiy mobil kirish", m.status === 200 && !!m.json?.accessToken, m.status);

// ───────── 6. Muddati o'tgan parol ─────────
console.log("\n6. Muddat");
r = await give(disp, emp.id);
const temp4 = r.result?.password as string;
exec(`update "User" set "tempPasswordUntil" = (now() at time zone 'utc') - interval '1 minute' where login=${lit(login)}`);
r = await webLogin(new Client("x"), login, temp4);
check("6.1 veb: muddati o'tgan — aniq xabar, sessiya yo'q", /muddati tugagan/.test(r.result?.error ?? "") && !r.result?.tempToken, r.result);
m = await mobile("/api/mobile/auth/login", { login, password: temp4 });
check("6.2 mobil: 403 TEMP_PASSWORD_EXPIRED", m.status === 403 && m.json?.code === "TEMP_PASSWORD_EXPIRED" && !m.json?.changeToken, m);

// ───────── 7. Kadr va bloklangan login ─────────
console.log("\n7. Kadr bilan chegaralar");
r = await kadr.action("employees/actions#resetEmployeePassword", [emp.id, undefined, fd({ password: OWN })], `/employees/${emp.id}`);
check("7.1 kadr parolni tiklasa — vaqtinchalik belgi tozalanadi", r.result?.ok === true && userOf(login).until === null, r.result);
await kadr.action("employees/actions#toggleEmployeeLogin", [emp.id], `/employees/${emp.id}`);
r = await give(disp, emp.id);
check("7.2 bloklangan loginga dispetcher tegmaydi", /bloklangan/.test(r.result?.error ?? "") && userOf(login).until === null, r.result);
await kadr.action("employees/actions#toggleEmployeeLogin", [emp.id], `/employees/${emp.id}`);
r = await kadr.action("employees/actions#changeEmployeeRole", [emp.id, undefined, fd({ role: "WAREHOUSE" })], `/employees/${emp.id}`);
if (userOf(login).role === "WAREHOUSE") {
  r = await give(disp, emp.id);
  check("7.3 boshqa bo'limdagi loginga dispetcher tegmaydi", /faqat Otdel kadr/.test(r.result?.error ?? ""), r.result);
} else check("7.3 (rol almashmadi — o'tkazib yuborildi)", true);
r = await give(dir, sales.id);
check("7.4 direktor ham faqat haydovchiga beradi", /haydovchi lavozimidagi/.test(r.result?.error ?? ""), r.result);

summary("Haydovchiga kirish (vaqtinchalik parol):");
