// QA (B) — Chiqim «Kimga»: xodimga berish ("e:<id>", StockMove.employeeId), jurnal va «Kimga» filtri, oluvchi kartasi
// (/oluvchi/b|e|r — sklad, ish boshqaruvchi ko'radi; sotuvchi yo'q; noto'g'ri tur 404), tez tanlash (issueHints — oxirgi
// oluvchi va tovari formada chiqadi), storno xodim qatorini ham teskari yozadi, mobil: «Kimga» tartibi (brigada → xodim →
// oluvchi) va brigadirning «Mening skladim» kartochkasi (o'ziniki ochiladi, begona brigada — 404).
// Ishga tushirish: npx tsx scripts/qa/b-oluvchi.mts (b-all.sh ichida)
import { as, check, summary, fd, q1, n1, BASE, Client } from "./b-client.mjs";

const RX = "(app)/stock/rasxod/actions";
const sklad = await as("sklad"), dir = await as("direktor"), prorab = await as("prorab"), sotuv = await as("sotuv");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** HTML'da apostrof `&#x27;` bo'lib chiqadi — ikkala ko'rinishda qidiradi. */
const has = (t: string, s: string) => t.includes(s) || t.includes(s.replace(/'/g, "&#x27;"));
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const tok = `qa-oluvchi-${Date.now()}`;

const wh = q1(`select id from "Warehouse" where "isActive" order by "isDefault" desc limit 1`) as string;
const mat = q1(`select "materialId" from "StockMove" where "warehouseId"=${lit(wh)} and "materialId" is not null group by "materialId" having sum(qty) > 5 order by sum(qty) desc limit 1`) as string | null;
const emp = q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login='test.prorab'`) as string;
const empName = q1(`select "fullName" from "Employee" where id=${lit(emp)}`) as string;
const brig = q1(`select b.id from "Brigade" b join "Employee" e on e.id=b."leaderId" join "User" u on u.id=e."userId" where u.login='test.brigadir' and b."isActive" limit 1`) as string | null;
check(!!mat && !!emp, "tayyorgarlik: qoldiqli xomashyo va test xodim bor", `mat=${mat} emp=${emp}`);

// ── 1. Xodimga chiqim ──
const r1 = await sklad.action(`${RX}#createRasxod`, [undefined, fd({ warehouseId: wh, to: `e:${emp}`, date: today, note: "QA xodimga", clientToken: tok, "materialId[]": [mat!], "qty[]": ["1"] })], "/stock/rasxod/new");
check(!r1.error && /\/stock\/rasxod\?saved=1/.test(r1.redirect ?? ""), "1.1 sklad xodimga chiqim yozdi → jurnalga qaytdi", r1.error ?? r1.redirect ?? String(r1.status));
const ref = q1(`select "refId" from "StockMove" where "clientToken"=${lit(tok)}`) as string | null;
check(!!ref, "1.2 harakat yozildi (clientToken bo'yicha topildi)");
check(n1(`select count(*) from "StockMove" where "refType"='Issue' and "refId"=${lit(ref ?? "")} and type='ISSUE' and "employeeId"=${lit(emp)} and "recipientId" is null`) === 1,
  "1.3 ISSUE qatorida employeeId = xodim, recipientId bo'sh");
const dup = await sklad.action(`${RX}#createRasxod`, [undefined, fd({ warehouseId: wh, to: `e:${emp}`, date: today, note: "QA xodimga", clientToken: tok, "materialId[]": [mat!], "qty[]": ["1"] })], "/stock/rasxod/new");
check(!dup.error && n1(`select count(*) from "StockMove" where "clientToken"=${lit(tok)}`) === 1, "1.4 o'sha kalit bilan takror — ikkinchi harakat yozilmadi", dup.error ?? "");
const bad = await sklad.action(`${RX}#createRasxod`, [undefined, fd({ warehouseId: wh, to: "e:yoq-xodim", date: today, clientToken: "", "materialId[]": [mat!], "qty[]": ["1"] })], "/stock/rasxod/new");
check(/Xodim topilmadi/.test(bad.error ?? ""), "1.5 mavjud bo'lmagan xodim — o'zbekcha xato", bad.error ?? "xato yo'q");

// ── 2. Jurnal, filtr, tez tanlash ──
const j = await sklad.get(`/stock/rasxod?komu=e:${emp}`);
check(j.status === 200 && j.text.includes(empName) && j.text.includes(`/oluvchi/e/${emp}`), "2.1 jurnal «Kimga» = xodim filtri: ism va karta havolasi bor", String(j.status));
const jAll = await sklad.get(`/stock/rasxod?komu=e`);
check(jAll.status === 200 && jAll.text.includes(empName), "2.2 «Barcha xodimlar» filtri", String(jAll.status));
const nf = await sklad.get("/stock/rasxod/new");
// Yangi chiqimda «Kimga» ro'yxatida xodimlar yo'q (2026-10-24) — na select'da, na «Tez tanlash» tugmalarida
check(nf.status === 200 && has(nf.text, "Qo'lda kiritish") && !nf.text.includes(`value="e:`), "2.3 forma: «Qo'lda kiritish» bor, xodim tanlovi yo'q", String(nf.status));
// Select guruhlari (menyudagi «Xodimlar» havolasi emas — optgroup label'lari) ketma-ketligi; «Boshqa oluvchilar» guruhi
// test bazasida oluvchi bo'lmasa chiqmaydi — bo'lsa, brigadalardan keyin va «Qo'lda kiritish» dan oldin turishi kerak
const grp = (l: string) => nf.text.indexOf(`label="${l.replace(/'/g, "&#x27;")}"`);
const gB = grp("Bizning brigadalar"), gE = grp("Xodimlar"), gR = grp("Boshqa oluvchilar"), gN = grp("Ro'yxatda yo'q");
check(gB >= 0 && gE === -1 && gB < gN && (gR === -1 || (gB < gR && gR < gN)),
  "2.4 «Kimga» tartibi: brigadalar → boshqa oluvchilar → qo'lda kiritish (xodimlarsiz)", [gB, gE, gR, gN].join(","));

// ── 3. Oluvchi kartasi ──
const ce = await sklad.get(`/oluvchi/e/${emp}`);
check(ce.status === 200 && ce.text.includes(empName) && ce.text.includes("Davrda berilgan"), "3.1 sklad xodim kartasini ochdi", String(ce.status));
const cp = await prorab.get(`/oluvchi/e/${emp}`);
check(cp.status === 200 && cp.text.includes(empName), "3.2 ish boshqaruvchi kartani ko'radi", String(cp.status));
const cs = await sotuv.get(`/oluvchi/e/${emp}`);
check(cs.status !== 200 || !cs.text.includes("Davrda berilgan"), "3.3 sotuvchiga karta yopiq (redirect)", String(cs.status));
const cx = await sklad.get(`/oluvchi/x/${emp}`);
check(cx.status === 404, "3.4 noto'g'ri tur → 404", String(cx.status));
if (brig) {
  const cb = await prorab.get(`/oluvchi/b/${brig}`);
  check(cb.status === 200 && has(cb.text, "Qo'lidagi xomashyo"), "3.5 brigada kartasi: qo'lidagi xomashyo bloki", String(cb.status));
}

// ── 4. Storno ──
const st = await dir.action(`${RX}#cancelRasxod`, [ref, "QA storno"], "/stock/rasxod");
check(st.ok || !st.error, "4.1 direktor xodimga chiqimni storno qildi", st.error ?? "");
check(n1(`select count(*) from "StockMove" where "refType"='IssueStorno' and "refId"=${lit(ref ?? "")} and "employeeId"=${lit(emp)} and qty > 0`) === 1, "4.2 storno qatori ham xodimga bog'langan (qty +)");
check(Math.abs(n1(`select coalesce(sum(qty),0) from "StockMove" where "refId"=${lit(ref ?? "")}`)) < 0.0005, "4.3 hujjat yig'indisi 0 — qoldiq qaytdi");

// ── 5. Mobil ──
async function mobile(login: string) {
  const r = await fetch(`${BASE}/api/mobile/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login, password: "Test2026" }) });
  const j = await r.json() as { accessToken?: string };
  return (p: string) => fetch(`${BASE}${p}`, { headers: { authorization: `Bearer ${j.accessToken ?? ""}` } }).then((x) => x.json() as Promise<Record<string, unknown>>);
}
const mSklad = await mobile("test.sklad");
const form = await mSklad("/api/mobile/form?key=rasxod") as { fields?: { name: string; options?: { value: string; label: string }[] }[] };
const opts = form.fields?.find((f) => f.name === "to")?.options ?? [];
const firstE = opts.findIndex((o) => o.value.startsWith("e:")), firstR = opts.findIndex((o) => o.value.startsWith("r:")), lastB = opts.map((o) => o.value[0]).lastIndexOf("b");
check(opts.length > 0 && opts[0].value.startsWith("b:") && firstE > lastB && (firstR === -1 || firstR > firstE), "5.1 mobil «Kimga»: brigada → xodim → oluvchi tartibi", `${opts.length} variant`);
check(opts.some((o) => o.value === `e:${emp}` && o.label.includes(empName)), "5.2 mobil ro'yxatda test xodim bor");
if (brig) {
  const mBrig = await mobile("test.brigadir");
  const home = await mBrig("/api/mobile/home") as { cards?: { key: string; open?: { key: string; id?: string } }[] };
  check(!!home.cards?.some((c) => c.key === `stock-${brig}` && c.open?.key === "brig-stock"), "5.3 brigadir bosh ekranida «Mening skladim» kartasi");
  const det = await mBrig(`/api/mobile/detail?key=brig-stock&id=${brig}`) as { title?: string; fields?: unknown[]; sections?: unknown[] };
  check(/Mening skladim/.test(det.title ?? "") && (det.sections?.length ?? 0) >= 3, "5.4 «Mening skladim» kartochkasi ochildi", det.title ?? JSON.stringify(det).slice(0, 120));
  const other = q1(`select id from "Brigade" where id<>${lit(brig)} limit 1`) as string | null;
  if (other) {
    const no = await mBrig(`/api/mobile/detail?key=brig-stock&id=${other}`) as { code?: string };
    check(no.code === "NOT_FOUND", "5.5 begona brigada kartochkasi brigadirga yopiq", no.code ?? "ochildi");
  }
}

// Tozalash: hujjat storno qilingan (o'chirilmaydi); boshqa narsa yaratilmadi
void Client;
summary("b-oluvchi");
