/**
 * QA (C) — mobil autentifikatsiya: login/parol, SMS kod bilan kirish (FAKE kanal → devCode),
 * refresh rotatsiyasi, soxta/eskirgan token, qulf, noma'lum raqamga bir xil javob, logout.
 */
import { api, check, done, section, freshIp, PASSWORD } from "./c-lib";
import { SignJWT } from "jose";
import { PrismaClient } from "@/generated/prisma";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!.trim());

async function main() {
  section("Login / parol");
  let r = await api("POST", "/api/mobile/auth/login", { body: { login: "test.sotuv", password: PASSWORD } });
  check("to'g'ri parol → 200 + tokenlar", r.status === 200 && !!r.json?.accessToken && !!r.json?.refreshToken && r.json?.user?.role === "SALES", r.json);
  const t1 = r.json;
  r = await api("POST", "/api/mobile/auth/login", { body: { login: "test.sotuv", password: "xato" } });
  const wrongMsg = r.json?.message;
  check("noto'g'ri parol → 401 BAD_CREDENTIALS", r.status === 401 && r.json?.code === "BAD_CREDENTIALS", r.json);
  r = await api("POST", "/api/mobile/auth/login", { body: { login: "yoq.bunday.login", password: "xato" } });
  check("noma'lum login → xuddi shu javob", r.status === 401 && r.json?.message === wrongMsg, r.json);
  r = await api("POST", "/api/mobile/auth/login", { raw: "{buzuq" , headers: { "content-type": "application/json" } });
  check("buzuq JSON → 400", r.status === 400, r.status);
  r = await api("POST", "/api/mobile/auth/login", { body: { login: "   ", password: "x" } });
  check("bo'sh login → 400", r.status === 400, r.status);

  section("Qulf (login bo'yicha 5 xato)");
  // Vaqtinchalik hisob — test.* xodimlari boshqa testlar uchun qulflanib qolmasin
  const lockLogin = `qa.lock.${Date.now()}`;
  await db.user.create({ data: { login: lockLogin, passwordHash: await bcrypt.hash(PASSWORD, 10), fullName: "QA qulf sinovi", role: "MECHANIC" } });
  for (let i = 0; i < 5; i++) await api("POST", "/api/mobile/auth/login", { body: { login: lockLogin, password: `xato${i}` } });
  r = await api("POST", "/api/mobile/auth/login", { body: { login: lockLogin, password: PASSWORD } });
  check("5 xatodan keyin to'g'ri parol ham → 429 LOCKED", r.status === 429 && r.json?.code === "LOCKED", r.json);
  r = await api("POST", "/api/mobile/auth/login", { body: { login: ` ${lockLogin.toUpperCase()} `, password: PASSWORD } });
  check("katta harf/bo'shliq bilan aylanib o'tib bo'lmaydi", r.status === 429, r.status);

  section("/me — token tekshiruvi");
  r = await api("GET", "/api/mobile/me", { token: t1.accessToken });
  check("access token → 200", r.status === 200 && r.json?.login === "test.sotuv", r.json);
  r = await api("GET", "/api/mobile/me", {});
  check("tokensiz → 401 NO_TOKEN", r.status === 401 && r.json?.code === "NO_TOKEN", r.json);
  r = await api("GET", "/api/mobile/me", { token: t1.refreshToken });
  check("refresh token access o'rnida → 401", r.status === 401, r.json);
  const u = await db.user.findUniqueOrThrow({ where: { login: "test.sotuv" } });
  const forged = await new SignJWT({ sub: u.id, login: u.login, role: "DIRECTOR", typ: "access", sv: u.sessionVersion })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode("boshqa-kalit-0123456789-0123456789-xx"));
  r = await api("GET", "/api/mobile/me", { token: forged });
  check("boshqa kalit bilan imzolangan → 401", r.status === 401, r.json);
  const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: u.id, typ: "access", sv: u.sessionVersion, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.`;
  r = await api("GET", "/api/mobile/me", { token: none });
  check("alg=none → 401", r.status === 401, r.json);
  const expired = await new SignJWT({ sub: u.id, login: u.login, role: u.role, typ: "access", sv: u.sessionVersion })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 3600).sign(secret);
  r = await api("GET", "/api/mobile/me", { token: expired });
  check("muddati o'tgan → 401", r.status === 401, r.json);
  const oldSv = await new SignJWT({ sub: u.id, login: u.login, role: u.role, typ: "access", sv: u.sessionVersion - 1 })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
  r = await api("GET", "/api/mobile/me", { token: oldSv });
  check("eski sessionVersion → 401", r.status === 401, r.json);
  // Rol tokendan emas, bazadan olinadi: tokendagi role=DIRECTOR hech narsa bermaydi
  const roleLie = await new SignJWT({ sub: u.id, login: u.login, role: "DIRECTOR", typ: "access", sv: u.sessionVersion })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);
  r = await api("GET", "/api/mobile/me", { token: roleLie });
  check("tokendagi rol e'tiborga olinmaydi (bazadagi SALES)", r.status === 200 && r.json?.role === "SALES", r.json);

  section("Refresh rotatsiyasi");
  const a = await api("POST", "/api/mobile/auth/login", { body: { login: "test.buh", password: PASSWORD } });
  r = await api("POST", "/api/mobile/auth/refresh", { body: { refreshToken: a.json.refreshToken } });
  check("refresh → yangi juftlik", r.status === 200 && !!r.json?.accessToken && r.json.refreshToken !== a.json.refreshToken, r.json);
  const b = r.json;
  r = await api("POST", "/api/mobile/auth/refresh", { body: { refreshToken: a.json.refreshToken } });
  check("eski refresh qayta ishlatilsa → 401 (rotatsiya)", r.status === 401, r.json);
  r = await api("POST", "/api/mobile/auth/refresh", { body: { refreshToken: b.refreshToken } });
  check("yangi refresh ishlaydi", r.status === 200, r.json);
  r = await api("POST", "/api/mobile/auth/refresh", { body: { refreshToken: a.json.accessToken } });
  check("access token refresh o'rnida → 401", r.status === 401, r.json);
  r = await api("POST", "/api/mobile/auth/refresh", { body: {} });
  check("refreshToken yo'q → 400", r.status === 400, r.json);

  section("Logout");
  const l = await api("POST", "/api/mobile/auth/login", { body: { login: "test.kadr", password: PASSWORD } });
  const other = await api("POST", "/api/mobile/auth/login", { body: { login: "test.kadr", password: PASSWORD } });
  r = await api("POST", "/api/mobile/auth/logout", { token: l.json.accessToken, body: { refreshToken: l.json.refreshToken } });
  check("logout → 200", r.status === 200 && r.json?.ok === true, r.json ?? r.text);
  r = await api("GET", "/api/mobile/me", { token: l.json.accessToken });
  check("logoutdan keyin access → 401", r.status === 401, r.json);
  r = await api("POST", "/api/mobile/auth/refresh", { body: { refreshToken: l.json.refreshToken } });
  check("logoutdan keyin refresh → 401", r.status === 401, r.json);
  r = await api("GET", "/api/mobile/me", { token: other.json.accessToken });
  check("boshqa qurilmadagi sessiya ishlayveradi", r.status === 200, r.json);
  r = await api("POST", "/api/mobile/auth/logout", {});
  check("tokensiz logout → 200 (idempotent)", r.status === 200, r.json ?? r.text);
  r = await api("POST", "/api/mobile/auth/logout", { token: "buzuq.token.qiymat" });
  check("buzuq token bilan logout → 200, 500 emas", r.status === 200, r.json ?? r.text);

  section("SMS kod bilan kirish (FAKE kanal)");
  const ip = freshIp();
  const phone = "+998909000006"; // test.sklad
  const ph2 = "+998909000010"; // test.kadr
  // Oldingi yugurishlar izi: kod soni bazada ham soatiga hisoblanadi
  await db.passwordResetCode.deleteMany({ where: { phone: { in: [phone, ph2] } } });
  r = await api("POST", "/api/mobile/auth/request-code", { body: { phone }, ip });
  check("mavjud raqam → {sent:true}", r.status === 200 && r.json?.sent === true, r.json);
  const code = r.json?.devCode as string | undefined;
  check("test rejimida devCode qaytadi (real kanal yo'q)", !!code && /^\d{6}$/.test(code), r.json);
  const known = Object.keys(r.json ?? {}).filter((k) => k !== "devCode").sort().join(",");
  r = await api("POST", "/api/mobile/auth/request-code", { body: { phone: "+998909999999" }, ip });
  check("noma'lum raqam → xuddi shunday javob (devCode'siz)", r.status === 200 && r.json?.sent === true && Object.keys(r.json).sort().join(",") === known && !r.json.devCode, r.json);
  r = await api("POST", "/api/mobile/auth/request-code", { body: { phone: "123" }, ip });
  check("noto'g'ri raqam formati → 429/400 emas 500", r.status < 500, r.status);
  const sms = await db.smsLog.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } });
  check("SMS jurnalida SKIPPED (FAKE provayder, real yuborilmadi)", !sms || sms.status === "SKIPPED", sms?.status);
  r = await api("POST", "/api/mobile/auth/code-login", { body: { phone, code: "000000" === code ? "111111" : "000000" } });
  check("noto'g'ri kod → 401", r.status === 401 && r.json?.code === "BAD_CODE", r.json);
  r = await api("POST", "/api/mobile/auth/code-login", { body: { phone: "90 900 00 06", code } });
  check("to'g'ri kod (boshqa yozilish) → tokenlar", r.status === 200 && r.json?.user?.login === "test.sklad", r.json);
  r = await api("POST", "/api/mobile/auth/code-login", { body: { phone, code } });
  check("kod ikkinchi marta ishlamaydi", r.status === 401, r.json);
  r = await api("POST", "/api/mobile/auth/code-login", { body: { phone: "+998909999999", code: "123456" } });
  check("noma'lum raqam kod bilan → 401 (bir xil xabar)", r.status === 401 && r.json?.code === "BAD_CODE", r.json);
  // Raqam bo'yicha soatlik chek: 3 ta kod
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await api("POST", "/api/mobile/auth/request-code", { body: { phone: ph2 } })).status);
  check("raqamga soatiga 3 tadan ortiq kod → 429", codes.slice(0, 3).every((s) => s === 200) && codes[3] === 429, codes);
  const unk: number[] = [];
  for (let i = 0; i < 4; i++) unk.push((await api("POST", "/api/mobile/auth/request-code", { body: { phone: "+998909999998" } })).status);
  check("noma'lum raqamga ham xuddi shu chek", JSON.stringify(unk) === JSON.stringify(codes), unk);
  // IP bo'yicha 10 ta
  const ip3 = freshIp();
  const st: number[] = [];
  for (let i = 0; i < 11; i++) st.push((await api("POST", "/api/mobile/auth/request-code", { body: { phone: `+99890800${String(1000 + i).slice(-4)}` }, ip: ip3 })).status);
  check("bitta IP'dan soatiga 10 tadan ortiq → 429", st[10] === 429 && st.slice(0, 10).every((s) => s === 200), st);
  // Kod-login qulfi (raqam bo'yicha)
  const ph3 = "+998909000014";
  for (let i = 0; i < 5; i++) await api("POST", "/api/mobile/auth/code-login", { body: { phone: ph3, code: "000000" } });
  r = await api("POST", "/api/mobile/auth/code-login", { body: { phone: "90-900-00-14", code: "000000" } });
  check("kod-login 5 xatodan keyin qulf (boshqa yozilishda ham)", r.status === 429, r.json);

  section("Bloklangan hisob");
  const blk = await api("POST", "/api/mobile/auth/login", { body: { login: "test.snab", password: PASSWORD } });
  await db.user.update({ where: { login: "test.snab" }, data: { isActive: false } });
  try {
    r = await api("GET", "/api/mobile/me", { token: blk.json.accessToken });
    check("o'chirilgan hisob access → 401", r.status === 401, r.json);
    r = await api("POST", "/api/mobile/auth/refresh", { body: { refreshToken: blk.json.refreshToken } });
    check("o'chirilgan hisob refresh → 401", r.status === 401, r.json);
    r = await api("POST", "/api/mobile/auth/login", { body: { login: "test.snab", password: PASSWORD } });
    check("o'chirilgan hisob login → 401 (bir xil xabar)", r.status === 401 && r.json?.message === wrongMsg, r.json);
  } finally {
    await db.user.update({ where: { login: "test.snab" }, data: { isActive: true } });
    await db.user.deleteMany({ where: { login: { startsWith: "qa.lock." } } }).catch(() => undefined);
  }
  await db.$disconnect();
  done();
}
void main();
