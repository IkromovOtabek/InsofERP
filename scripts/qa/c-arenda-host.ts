/**
 * QA (C) — Arenda alohida domeni (`lib/arenda-host.ts` → `arendaRedirect`), serversiz: middleware qoidasi
 * `NextRequest` bilan to'g'ridan-to'g'ri chaqiriladi.
 *  · asosiy domenda faqat Arenda hisobi (sekretar) sessiyasi kirish sahifasini to'smaydi — cookie o'chadi, forma ochiladi
 *    (ilgari /login → /dashboard → /arenda → arenda domeni aylanib, asosiy domenda boshqa hisob bilan kirib bo'lmasdi);
 *  · asosiy domendagi /arenda — arenda domeniga; arenda domenida faqat Arenda yo'llari, ruxsatsiz hisob chiqariladi.
 *
 *   npx tsx scripts/qa/c-arenda-host.ts
 */
import { NextRequest } from "next/server";
import { arendaRedirect } from "../../src/lib/arenda-host";
import { check, done, section } from "./c-lib";

const MAIN = "insof-erp.uz", ARENDA = "arenda.insof-erp.uz";
const req = (host: string, path: string, cookie = "insof_session=x.y.z; insof_tour=intro") =>
  new NextRequest(`http://127.0.0.1:3101${path}`, { headers: { host, "x-forwarded-host": host, cookie } });
const loc = (r: Response | null) => r?.headers.get("location") ?? null;
const cleared = (r: Response | null) => /insof_session=;/.test(r?.headers.get("set-cookie") ?? "");

section("ARENDA_HOST berilmagan — qoida ishlamaydi");
delete process.env.ARENDA_HOST;
check("sekretar /login — odatdagi tekshiruvga", arendaRedirect(req(MAIN, "/login"), "SECRETARY") === null);
check("/arenda — shu domenda qoladi", arendaRedirect(req(MAIN, "/arenda"), "SECRETARY") === null);

process.env.ARENDA_HOST = ARENDA;
section("Asosiy domen");
let r = arendaRedirect(req(MAIN, "/login"), "SECRETARY");
const fwd = r?.headers.get("x-middleware-request-cookie") ?? "";
check("sekretar sessiyasi bilan /login — sahifa ochiladi, cookie o'chadi", !!r && r.status === 200 && !loc(r) && cleared(r), [r?.status, loc(r), r?.headers.get("set-cookie")]);
check("sahifaga eski sessiya uzatilmaydi (boshqa cookie'lar qoladi)", !fwd.includes("insof_session") && fwd.includes("insof_tour=intro"), fwd);
check("direktor /login — odatdagi tekshiruvga (/dashboard)", arendaRedirect(req(MAIN, "/login"), "DIRECTOR") === null);
check("kirmagan /login — odatdagi", arendaRedirect(req(MAIN, "/login", ""), null) === null);
check("sekretar /dashboard — odatdagi (o'z sahifasi /arenda ga)", arendaRedirect(req(MAIN, "/dashboard"), "SECRETARY") === null);
r = arendaRedirect(req(MAIN, "/arenda/dokon/abc?tab=akt"), "DIRECTOR");
check("/arenda/... — arenda domeniga (yo'l va parametr bilan)", r?.status === 307 && loc(r) === `https://${ARENDA}/arenda/dokon/abc?tab=akt`, loc(r));

section("Arenda domeni");
r = arendaRedirect(req(ARENDA, "/login"), "SECRETARY");
check("kirgan sekretar /login — /arenda", r?.status === 307 && (loc(r) ?? "").endsWith("/arenda"), loc(r));
r = arendaRedirect(req(ARENDA, "/dashboard", ""), null);
check("kirmagan ERP yo'li — /login", r?.status === 307 && (loc(r) ?? "").endsWith("/login"), loc(r));
check("sekretar /arenda — ochiladi", arendaRedirect(req(ARENDA, "/arenda"), "SECRETARY") === null);
r = arendaRedirect(req(ARENDA, "/arenda"), "DRIVER");
check("o'z sahifasi boshqa (haydovchi) — chiqariladi, sabab bilan", r?.status === 307 && (loc(r) ?? "").includes("/login?arenda=yopiq") && cleared(r), [loc(r), r?.headers.get("set-cookie")]);

done();
