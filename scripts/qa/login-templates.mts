// Lavozim login shabloni va ruxsat shablonlari — direktor ishchi lavozimga asosiy bo'lim + modul ruxsatlarini beradi:
//  · Excel importidagi «+ Yangi lavozim…» (createPositionInline): kadr — oddiy, direktor — tizimga kiradigan;
//  · savePositionTemplate: faqat direktor, DIRECTOR rolini bermaydi, shu lavozimdagi loginlarga qo'llanadi;
//  · shu lavozimga ochilgan login (createEmployee / grantLogin) shablondagi rol va ruxsat bilan ochiladi;
//  · mobil ilova (/api/mobile/auth/login) — rol va ruxsat ishlaydi; ruxsat o'zgarishi qayta kirishsiz, rol o'zgarishi — sessiya tugaydi;
//  · Ruxsatlar → bir nechta xodimga birdan: shablon / matritsa, direktor o'tkazib yuboriladi, har xodimga audit.
// Ishga tushirish: npx tsx scripts/qa/login-templates.mts  (QA_BASE, QA_DATABASE_URL — README.md)
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, summary, BASE } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q1, lit } from "./db.mjs";

const T = Date.now().toString(36).slice(-5);
const PASS = "QaParol2026";
const dir = new Client("direktor"), kadr = new Client("kadr");
await Promise.all([dir.login("test.direktor"), kadr.login("test.kadr")]);
const n = (sql: string) => Number(q1(`select count(*)::int as n from (${sql}) x`).n);
const userOf = (login: string) => q1(`select id, role, perms, "sessionVersion" as sv from "User" where login=${lit(login)}`);

let ipSeq = 0;
async function mobile(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = { "x-forwarded-for": `10.88.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const inline = (c: typeof dir, name: string, loginRole?: string) =>
  c.action("otdel-kadr/actions#createPositionInline", [{ name, loginRole: loginRole ?? null }], "/otdel-kadr/import");
const saveTpl = (c: typeof dir, id: string, form: Record<string, unknown>) =>
  c.action("otdel-kadr/actions#savePositionTemplate", [id, undefined, fd(form)], "/otdel-kadr?tab=lavozimlar");

// ───────── 1. «+ Yangi lavozim…» (import ichida) ─────────
console.log("\n1. Lavozimni import sahifasidan ochish");
const pos = `Laborant LT ${T}`, plain = `Yordamchi LT ${T}`;
let r = await inline(kadr, pos, "PRODUCTION");
check("1.1 kadr tizimga kiradigan lavozim ocholmaydi", /faqat direktor/.test(r.result?.error ?? ""), r.result ?? r.status);
r = await inline(kadr, plain);
check("1.2 kadr oddiy ishchi lavozim ochadi", r.result?.ok === true && r.result.name === plain && !r.result.loginRole, r.result ?? r.status);
r = await inline(kadr, plain.toUpperCase());
check("1.3 bir xil nom (katta-kichik harf farqi bilan) — xato", /allaqachon bor/.test(r.result?.error ?? ""), r.result);
r = await inline(dir, "Sotuv", "SALES");
check("1.4 bo'lim lavozimi nomi bilan ochilmaydi", /bo'lim lavozimi/.test(r.result?.error ?? ""), r.result);
r = await inline(dir, `Boss LT ${T}`, "DIRECTOR");
check("1.5 DIRECTOR rolini shablon bilan berib bo'lmaydi", /Asosiy bo'limni tanlang/.test(r.result?.error ?? ""), r.result);
r = await inline(dir, pos, "PRODUCTION");
const wp = q1(`select id, "loginRole", department from "WorkPosition" where name=${lit(pos)}`);
check("1.6 direktor tizimga kiradigan lavozim ochdi (loginRole, bo'lim tuzilmada)", r.result?.ok === true && wp?.loginRole === "PRODUCTION" && wp?.department === "PRODUCTION", [r.result, wp]);
check("1.7 AuditLog: lavozim yaratildi", n(`select id from "AuditLog" where entity='WorkPosition' and action='CREATE' and after->>'name'=${lit(pos)}`) === 1);

// ───────── 2. Login shabloni (faqat direktor) ─────────
console.log("\n2. Login shabloni");
const tplForm = { login: "on", loginRole: "PRODUCTION", "perm.production": "none", "perm.orders": "custom", "act.orders": ["create", "nope"] };
r = await saveTpl(kadr, wp.id, tplForm);
check("2.1 kadr shablonni saqlay olmaydi", /faqat direktor/.test(r.result?.error ?? ""), r.result ?? r.status);
r = await saveTpl(dir, wp.id, { ...tplForm, loginRole: "DIRECTOR" });
check("2.2 DIRECTOR — asosiy bo'lim bo'la olmaydi", /Asosiy bo'limni tanlang/.test(r.result?.error ?? ""), r.result);
r = await saveTpl(dir, wp.id, tplForm);
const wp2 = q1(`select "loginRole", perms from "WorkPosition" where id=${lit(wp.id)}`);
check("2.3 shablon saqlandi (katalogda yo'q amal tashlandi)", r.result?.ok === true && wp2.loginRole === "PRODUCTION"
  && JSON.stringify(wp2.perms) === JSON.stringify({ orders: ["create"], production: "none" }), [r.result, wp2]);

// ───────── 3. Shu lavozimga login ochish ─────────
console.log("\n3. Login shablon bilan ochiladi");
const l1 = `lt1${T}`.toLowerCase(), l2 = `lt2${T}`.toLowerCase(), l3 = `lt3${T}`.toLowerCase();
r = await kadr.action("employees/actions#createEmployee", [undefined, fd({ fullName: `LT Birinchi ${T}`, position: pos, role: "PRODUCTION", login: l1, password: PASS })], "/employees");
let u1 = userOf(l1);
check("3.1 createEmployee: rol va ruxsatlar shablondan", r.result?.ok === true && u1?.role === "PRODUCTION" && JSON.stringify(u1.perms) === JSON.stringify(wp2.perms), [r.result, u1]);
// Login keyin beriladi (Xodimlar ro'yxatidagi «Login berish»): avval loginsiz karta
r = await kadr.action("employees/actions#createEmployee", [undefined, fd({ fullName: `LT Ikkinchi ${T}`, position: pos })], "/employees");
const e2 = q1(`select id from "Employee" where "fullName"=${lit(`LT Ikkinchi ${T}`)}`);
r = await kadr.action("employees/actions#grantLogin", [e2.id, undefined, fd({ role: "PRODUCTION", login: l2, password: PASS })], "/employees");
const u2 = userOf(l2);
check("3.2 grantLogin: rol va ruxsatlar shablondan", r.result?.ok === true && u2?.role === "PRODUCTION" && JSON.stringify(u2.perms) === JSON.stringify(wp2.perms), [r.result, u2]);
// Kadr boshqa bo'limni tanlasa — rol o'sha, shablon ruxsatlari nusxalanmaydi
r = await kadr.action("employees/actions#createEmployee", [undefined, fd({ fullName: `LT Uchinchi ${T}`, position: pos, role: "WAREHOUSE", login: l3, password: PASS })], "/employees");
const u3 = userOf(l3);
check("3.3 boshqa bo'lim tanlansa — shablon ruxsati qo'shilmaydi", r.result?.ok === true && u3?.role === "WAREHOUSE" && u3.perms == null, [r.result, u3]);

// ───────── 4. Mobil ilova ─────────
console.log("\n4. Mobil ilova (ECO / ERP ilova)");
let ml = await mobile("POST", "/api/mobile/auth/login", undefined, { login: l1, password: PASS });
let t1 = ml.json?.accessToken as string;
check("4.1 mobil login ishlaydi", ml.status === 200 && !!t1, ml);
const me = await mobile("GET", "/api/mobile/me", t1);
check("4.2 /me: rol PRODUCTION, ruxsat shablondan", me.json?.role === "PRODUCTION" && JSON.stringify(me.json?.perms?.orders) === JSON.stringify(["create"]), me.json);
let lp = await mobile("GET", "/api/mobile/list?key=production", t1);
const lo = await mobile("GET", "/api/mobile/list?key=orders", t1);
check("4.3 yopilgan modul (Ishlab chiqarish) ko'rinmaydi, Zayavkalar ochiq", lp.status >= 400 && lp.status < 500 && lo.status === 200, [lp.status, lo.status]);

// Shablon ruxsati o'zgaradi → lavozimdagi loginlarga qo'llanadi, qayta kirish shart emas
const sv1 = Number(u1.sv);
r = await saveTpl(dir, wp.id, { login: "on", loginRole: "PRODUCTION", "perm.production": "view" });
u1 = userOf(l1);
check("4.4 shablon o'zgarishi lavozimdagi barcha loginlarga qo'llandi", /3 ta foydalanuvchiga qo'llandi/.test(r.result?.note ?? "") && JSON.stringify(u1.perms) === JSON.stringify({ production: "view" }) && JSON.stringify(userOf(l2).perms) === JSON.stringify({ production: "view" }), [r.result, u1]);
check("4.5 faqat ruxsat o'zgardi — sessiya tugamadi", Number(u1.sv) === sv1, [sv1, u1.sv]);
lp = await mobile("GET", "/api/mobile/list?key=production", t1);
check("4.6 eski token bilan Ishlab chiqarish endi ochiladi", lp.status === 200, lp.status);
check("4.7 shu lavozimda boshqa bo'lim bilan ochilgan login ham shablon bo'limiga o'tdi", userOf(l3).role === "PRODUCTION" && Number(userOf(l3).sv) === Number(u3.sv) + 1, userOf(l3));
check("4.8 AuditLog: har login uchun yozuv", n(`select id from "AuditLog" where entity='User' and "entityId" in (${lit(u1.id)}, ${lit(u2.id)}, ${lit(u3.id)}) and after->>'via'=${lit(`lavozim:${pos}`)}`) === 3);

// Shablonda asosiy bo'lim almashadi → rol o'zgaradi, sessiya tugaydi
r = await saveTpl(dir, wp.id, { login: "on", loginRole: "WAREHOUSE", "perm.production": "view" });
u1 = userOf(l1);
check("4.9 asosiy bo'lim almashdi — rol WAREHOUSE, sessionVersion oshdi", u1.role === "WAREHOUSE" && Number(u1.sv) === sv1 + 1, u1);
const old = await mobile("GET", "/api/mobile/me", t1);
check("4.10 eski mobil token endi ishlamaydi (qayta kirish)", old.status === 401, old.status);
ml = await mobile("POST", "/api/mobile/auth/login", undefined, { login: l1, password: PASS });
t1 = ml.json?.accessToken;
const me2 = await mobile("GET", "/api/mobile/me", t1);
check("4.11 qayta kirgach — yangi bo'lim", me2.json?.role === "WAREHOUSE", me2.json);

// ───────── 5. Bir nechta xodimga birdan ─────────
console.log("\n5. Ruxsatlar → bir nechta xodimga birdan");
const dirId = userOf("test.direktor").id;
const ids = [u1.id, u2.id, dirId];
const before5 = n(`select id from "AuditLog" where entity='User' and "entityId" in (${lit(u1.id)}, ${lit(u2.id)})`);
r = await dir.action("settings/actions#bulkSaveUserPerms", [undefined, fd({ ids, "perm.customers": "view", "perm.orders": "custom", "act.orders": ["create", "confirm"] })], "/settings?tab=permissions");
const want = JSON.stringify({ orders: ["create", "confirm"], customers: "view" });
check("5.1 matritsa 2 xodimga qo'llandi, direktor o'tkazib yuborildi",
  /2 ta xodimga ruxsatlar qo'llandi/.test(r.result?.note ?? "") && /direktor hisobi o'tkazib yuborildi/.test(r.result?.note ?? ""), r.result ?? r.status);
check("5.2 ikkalasida ruxsat bir xil, direktorda perms yo'q", JSON.stringify(userOf(l1).perms) === want && JSON.stringify(userOf(l2).perms) === want && userOf("test.direktor").perms == null, [userOf(l1).perms, userOf(l2).perms]);
check("5.3 har xodimga alohida audit", n(`select id from "AuditLog" where entity='User' and "entityId" in (${lit(u1.id)}, ${lit(u2.id)})`) === before5 + 2);

// Shablon (rol bilan emas) — ruxsat shablondan, rol o'zgarmaydi, sessiya tugamaydi (4.9 dan keyin ikkalasi WAREHOUSE)
const s2 = Number(userOf(l2).sv), r2 = userOf(l2).role;
r = await dir.action("settings/actions#applyPermTemplate", [undefined, fd({ ids, template: wp.id })], "/settings?tab=permissions");
check("5.4 shablon (bo'limsiz): ruxsat shablondan, rol va sessiya o'zgarmadi",
  /2 ta xodimga/.test(r.result?.note ?? "") && JSON.stringify(userOf(l2).perms) === JSON.stringify({ production: "view" }) && userOf(l2).role === r2 && Number(userOf(l2).sv) === s2, [r.result, userOf(l2)]);
// Boshqa shablon bo'lim bilan — rol CASHIER, sessiya tugaydi
const kas = `Kassir LT ${T}`;
await inline(dir, kas, "CASHIER");
const kwp = q1(`select id from "WorkPosition" where name=${lit(kas)}`);
await saveTpl(dir, kwp.id, { login: "on", loginRole: "CASHIER", "perm.customers": "view" });
const s1 = Number(userOf(l1).sv);
r = await dir.action("settings/actions#applyPermTemplate", [undefined, fd({ ids, template: kwp.id, withRole: "on" })], "/settings?tab=permissions");
check("5.5 shablon bo'lim bilan: ikkalasi CASHIER, ruxsat shablondan, sessionVersion oshdi",
  /2 ta xodimga/.test(r.result?.note ?? "") && [l1, l2].every((l) => userOf(l).role === "CASHIER" && JSON.stringify(userOf(l).perms) === JSON.stringify({ customers: "view" }))
  && Number(userOf(l1).sv) === s1 + 1 && Number(userOf(l2).sv) === s2 + 1, [r.result, userOf(l1), userOf(l2)]);
r = await dir.action("settings/actions#applyPermTemplate", [undefined, fd({ ids, template: kwp.id, withRole: "on" })], "/settings?tab=permissions");
check("5.5b takror qo'llash — o'zgarish yo'q, sessiya tugamaydi", /0 ta xodimga/.test(r.result?.note ?? "") && /2 tasida o'zgarish yo'q/.test(r.result?.note ?? "") && Number(userOf(l1).sv) === s1 + 1, r.result);
// «Rol bo'yicha» — qo'shimcha ruxsatlar tozalanadi
r = await dir.action("settings/actions#applyPermTemplate", [undefined, fd({ ids: [u1.id, u2.id], template: "role" })], "/settings?tab=permissions");
check("5.6 «rol bo'yicha»: perms tozalandi", r.result?.ok === true && userOf(l1).perms == null && userOf(l2).perms == null, r.result);
// Kadr bulk qila olmaydi
const pBefore = JSON.stringify(userOf(l1).perms);
r = await kadr.action("settings/actions#bulkSaveUserPerms", [undefined, fd({ ids: [u1.id], "perm.customers": "write" })], "/settings?tab=permissions");
check("5.7 kadr bir nechta xodimga ruxsat bera olmaydi", JSON.stringify(userOf(l1).perms) === pBefore && !r.result?.ok, [r.status, r.result]);
r = await dir.action("settings/actions#applyPermTemplate", [undefined, fd({ template: "role" })], "/settings?tab=permissions");
check("5.8 xodim belgilanmasa — tushunarli xato", /Kamida bitta xodimni belgilang/.test(r.result?.error ?? ""), r.result);

// Shablon o'chirilsa — mavjud loginlar o'zgarmaydi
const roleBefore = userOf(l1).role;
r = await saveTpl(dir, wp.id, {});
check("5.9 shablon o'chirildi, loginlar joyida", r.result?.ok === true && q1(`select "loginRole" from "WorkPosition" where id=${lit(wp.id)}`).loginRole == null && userOf(l1).role === roleBefore, r.result);

summary("login-templates:");
