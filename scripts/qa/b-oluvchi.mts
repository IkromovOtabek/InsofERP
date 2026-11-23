// QA (B) — Chiqim «Kimga»: xodimga berish ("e:<id>", StockMove.employeeId), jurnal va «Kimga» filtri, oluvchi kartasi
// (/oluvchi/b|e|r — sklad, ish boshqaruvchi ko'radi; sotuvchi yo'q; noto'g'ri tur 404), tez tanlash (issueHints — oxirgi
// oluvchi va tovari formada chiqadi), storno xodim qatorini ham teskari yozadi, mobil: «Kimga» tartibi (brigada → xodim →
// oluvchi) va brigadirning «Mening skladim» kartochkasi (o'ziniki ochiladi, begona brigada — 404); «Haydovchilar» guruhi
// (mashina raqami + F.I.O.), haydovchiga chiqim → dispetcherga bildirishnoma va Haydovchilar tabeli → «Ombor»;
// bir oynada bir nechta oluvchiga chiqim (`to[]` + `grp[]`): alohida hujjatlar, bitta tranzaksiya, qoldiq yetmasa hech biri yo'q.
// Ishga tushirish: npx tsx scripts/qa/b-oluvchi.mts (b-all.sh ichida)
import { as, check, summary, fd, q1, n1, BASE, Client } from "./b-client.mjs";

const RX = "(app)/stock/rasxod/actions";
const sklad = await as("sklad"), dir = await as("direktor"), prorab = await as("prorab"), sotuv = await as("sotuv"), disp = await as("dispetcher");
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
const drv = q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login='test.haydovchi'`) as string | null;
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
// Yangi chiqimda «Kimga» ro'yxatida xodimlar yo'q (2026-10-24) — na select'da, na «Tez tanlash» tugmalarida;
// 2026-11-20 dan haydovchilar alohida «Haydovchilar» guruhida ("e:<id>")
check(nf.status === 200 && has(nf.text, "Qo'lda kiritish") && !nf.text.includes(`value="e:${emp}"`), "2.3 forma: «Qo'lda kiritish» bor, oddiy xodim tanlovi yo'q", String(nf.status));
// Select guruhlari (menyudagi «Xodimlar» havolasi emas — optgroup label'lari) ketma-ketligi; «Boshqa oluvchilar» guruhi
// test bazasida oluvchi bo'lmasa chiqmaydi — bo'lsa, brigadalardan keyin va «Qo'lda kiritish» dan oldin turishi kerak
const grp = (l: string) => nf.text.indexOf(`label="${l.replace(/'/g, "&#x27;")}"`);
const gB = grp("Bizning brigadalar"), gD = grp("Haydovchilar"), gE = grp("Xodimlar"), gR = grp("Boshqa oluvchilar"), gN = grp("Ro'yxatda yo'q");
check(gB >= 0 && gE === -1 && gB < gN && (gR === -1 || (gB < gR && gR < gN)) && (gD === -1 || (gB < gD && gD < gN && (gR === -1 || gD < gR))),
  "2.4 «Kimga» tartibi: brigadalar → haydovchilar → boshqa oluvchilar → qo'lda kiritish (xodimlarsiz)", [gB, gD, gE, gR, gN].join(","));
if (drv) check(gD >= 0 && nf.text.includes(`value="e:${drv}"`), "2.5 «Haydovchilar» guruhida test haydovchi bor", String(gD));

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

// ── 6. Haydovchiga chiqim → dispetcher: bildirishnoma va tabel «Ombor» ──
if (drv) {
  const drvName = q1(`select "fullName" from "Employee" where id=${lit(drv)}`) as string;
  const matName = q1(`select name from "Material" where id=${lit(mat!)}`) as string;
  const tok2 = `qa-haydovchi-${Date.now()}`;
  const r6 = await sklad.action(`${RX}#createRasxod`, [undefined, fd({ warehouseId: wh, to: `e:${drv}`, date: today, note: "QA haydovchiga", clientToken: tok2, "materialId[]": [mat!], "qty[]": ["1"] })], "/stock/rasxod/new");
  check(!r6.error && /saved=1/.test(r6.redirect ?? ""), "6.1 sklad haydovchiga chiqim yozdi", r6.error ?? r6.redirect ?? String(r6.status));
  const ref6 = q1(`select "refId" from "StockMove" where "clientToken"=${lit(tok2)}`) as string | null;
  check(n1(`select count(*) from "StockMove" where "refId"=${lit(ref6 ?? "")} and type='ISSUE' and "employeeId"=${lit(drv)} and "vehicleId" is null`) === 1, "6.2 ISSUE: employeeId = haydovchi, transport bo'sh");
  // Bildirishnoma javobdan keyin (`after`) yoziladi — bir oz kutiladi
  let notes = 0;
  for (let i = 0; i < 20 && !notes; i++) {
    notes = n1(`select count(*) from "Notification" n join "User" u on u.id=n."userId" where u.login='test.dispetcher' and n.type='DRIVER_STOCK' and n.link->>'id'=${lit(`employees:${drv}`)} and n."createdAt" > now() - interval '5 minutes'`);
    if (!notes) await new Promise((r) => setTimeout(r, 250));
  }
  check(notes >= 1, "6.3 dispetcherga «Skladdan haydovchiga» bildirishnomasi", String(notes));
  const om = await disp.get(`/logistika/tabel?bolim=ombor&driver=${drv}`);
  check(om.status === 200 && om.text.includes(drvName) && has(om.text, matName) && om.text.includes("Kimda nima bor"), "6.4 dispetcher tabel → «Ombor» da haydovchi va narsa ko'rinadi", String(om.status));
  // Jurnaldagi «Summa» ustuni faqat `canSeeLogiMoney` (direktor, ish boshqaruvchi, mexanik)
  check(!om.text.includes(">Summa<"), "6.5 dispetcherga «Summa» ustuni ko'rinmaydi");
  const omD = await dir.get(`/logistika/tabel?bolim=ombor`);
  check(omD.status === 200 && omD.text.includes(drvName) && omD.text.includes(">Summa<"), "6.6 direktor «Ombor» ni summa bilan ko'radi", String(omD.status));
  const st6 = await dir.action(`${RX}#cancelRasxod`, [ref6, "QA storno haydovchi"], "/stock/rasxod");
  check(!st6.error, "6.7 haydovchiga chiqim storno qilindi", st6.error ?? "");
  const om2 = await disp.get(`/logistika/tabel?bolim=ombor&driver=${drv}`);
  check(om2.status === 200 && om2.text.includes("Bekor qilingan"), "6.8 bekor qilingan chiqim «Ombor» jurnalida belgilangan", String(om2.status));
}

// ── 7. Bir oynada bir nechta oluvchiga chiqim (`to[]` + `grp[]` → issueStockMany, bitta tranzaksiya) ──
{
  const mats = (q1(`select string_agg(m, ',') from (select "materialId" m from "StockMove" where "warehouseId"=${lit(wh)} and "materialId" is not null
    group by "materialId" having sum(qty) > 5 order by sum(qty) desc limit 3) x`) as string | null)?.split(",") ?? [];
  const t2 = brig ? `b:${brig}` : drv ? `e:${drv}` : null;
  if (mats.length >= 2 && t2) {
    const [m1, m2, m3 = mats[1]] = mats;
    const balOf = (m: string) => n1(`select coalesce(sum(qty),0) from "StockMove" where "warehouseId"=${lit(wh)} and "materialId"=${lit(m)}`);
    const b0 = { m1: balOf(m1), m2: balOf(m2), m3: balOf(m3) };
    const tok7 = `qa-kopchiqim-${Date.now()}`;
    const multi = (o: Record<string, unknown>) => sklad.action(`${RX}#createRasxod`, [undefined, fd({ warehouseId: wh, date: today, note: "QA ko'p chiqim", ...o })], "/stock/rasxod/new");
    const body = { "to[]": [`e:${emp}`, t2], "materialId[]": [m1, m2, m3, m1], "qty[]": ["1", "1", "1", "1"], "grp[]": ["0", "0", "0", "1"] };
    const r7 = await multi({ ...body, clientToken: tok7 });
    check(!r7.error && /saved=\d+&docs=2/.test(r7.redirect ?? ""), "7.1 bir oynada 2 oluvchiga chiqim yozildi → jurnal «2 ta chiqim»", r7.error ?? r7.redirect ?? String(r7.status));
    const refs = (q1(`select string_agg(distinct "refId", ',') from "StockMove" where "clientToken" like ${lit(`${tok7}-g%`)}`) as string | null)?.split(",") ?? [];
    check(refs.length === 2, "7.2 ikkita alohida chiqim hujjati (har oluvchiga bittadan)", String(refs.length));
    const inRefs = `(${refs.map(lit).join(",") || "''"})`;
    check(n1(`select count(*) from "StockMove" where "refType"='Issue' and "refId" in ${inRefs} and "employeeId"=${lit(emp)}`) === (m3 === m2 ? 2 : 3),
      "7.3 1-chiqim qatorlari — 1-oluvchiga (xodim)");
    // Kutilgan kamayish: har qator 1 dan — m1 ikki chiqimda (2), m2 va m3 bittadan (faqat 2 xomashyo bo'lsa m3 = m2)
    const exp = (m: string) => [m1, m2, m3, m1].filter((x) => x === m).length;
    const balOk = () => [m1, m2, m3].every((m) => Math.abs(balOf(m) - ((m === m1 ? b0.m1 : m === m2 ? b0.m2 : b0.m3) - exp(m))) < 0.0005);
    check(balOk(), "7.4 sklad qoldig'i barcha chiqimlar yig'indisicha kamaydi", `${b0.m1}→${balOf(m1)}, ${b0.m2}→${balOf(m2)}, ${b0.m3}→${balOf(m3)}`);
    check(n1(`select count(*) from "AuditLog" where entity='StockMove' and "entityId" in ${inRefs} and (after->'batch'->>'of')='2'`) === 2, "7.5 AuditLog: har hujjat yozuvida «batch» (1/2, 2/2)");
    const movesBefore = n1(`select count(*) from "StockMove" where "refId" in ${inRefs}`);
    const d7 = await multi({ ...body, clientToken: tok7 });
    check(!d7.error && /docs=2/.test(d7.redirect ?? "") && n1(`select count(*) from "StockMove" where "createdAt" > now() - interval '5 minutes' and note like ${lit("%QA ko'p chiqim")}`) === movesBefore && balOk(),
      "7.6 o'sha kalit bilan takror — yangi chiqim yozilmadi, mavjud ikkalasi qaytdi", d7.error ?? d7.redirect ?? "");
    // Qoldiq yetmasa — hech biri yozilmaydi: 1-chiqimda m1 butun qoldig'i, 2-chiqimda yana 1
    const tok7b = `qa-kopchiqim-b-${Date.now()}`;
    const left = balOf(m1);
    const sh = await multi({ "to[]": [`e:${emp}`, t2], "materialId[]": [m2, m1, m1], "qty[]": ["1", String(left), "1"], "grp[]": ["0", "0", "1"], clientToken: tok7b });
    check(/yetarli emas/.test(sh.error ?? "") && /1, 2-chiqim/.test(sh.error ?? ""), "7.7 ikki chiqim yig'indisi qoldiqdan ko'p — rad, qaysi chiqimlar aytiladi", sh.error ?? "xato yo'q");
    check(n1(`select count(*) from "StockMove" where "clientToken" like ${lit(`${tok7b}%`)}`) === 0 && Math.abs(balOf(m1) - left) < 0.0005,
      "7.8 rad etilganda birorta chiqim ham yozilmadi (1-chiqim ham)");
    const same = await multi({ "to[]": [`e:${emp}`, `e:${emp}`], "materialId[]": [m1, m2], "qty[]": ["1", "1"], "grp[]": ["0", "1"], clientToken: "" });
    check(/1- va 2-chiqimda tanlangan/.test(same.error ?? ""), "7.9 bir oluvchi ikki chiqimda — rad", same.error ?? "xato yo'q");
    const noTo = await multi({ "to[]": [`e:${emp}`, ""], "materialId[]": [m1, m2], "qty[]": ["1", "1"], "grp[]": ["0", "1"], clientToken: "" });
    check(/^2-chiqim: Kimga/.test(noTo.error ?? ""), "7.10 2-chiqimda «Kimga» yo'q — chiqim raqami bilan xato", noTo.error ?? "xato yo'q");
    const noLine = await multi({ "to[]": [`e:${emp}`, t2], "materialId[]": [m1], "qty[]": ["1"], "grp[]": ["0"], clientToken: "" });
    check(/^2-chiqim: kamida bitta qator/.test(noLine.error ?? ""), "7.11 qatorsiz chiqim — rad", noLine.error ?? "xato yo'q");
    const cp7 = await multi({ ...body, clientToken: "", copyOf: "yoq-hujjat" });
    check(/Tuzatishda faqat bitta chiqim/.test(cp7.error ?? ""), "7.12 «Tuzatish» da bir nechta chiqim — rad", cp7.error ?? "xato yo'q");
    const jr = await sklad.get("/stock/rasxod?saved=4&docs=2");
    check(jr.status === 200 && jr.text.includes("2 ta chiqim yozildi"), "7.13 jurnal: «2 ta chiqim yozildi»", String(jr.status));
    const nf7 = await sklad.get("/stock/rasxod/new");
    check(nf7.status === 200 && nf7.text.includes("Yana chiqim — boshqa oluvchiga"), "7.14 formada «Yana chiqim — boshqa oluvchiga» tugmasi");
    for (const r of refs) {
      const x = await dir.action(`${RX}#cancelRasxod`, [r, "QA storno ko'p chiqim"], "/stock/rasxod");
      check(!x.error, "7.15 ko'p chiqim hujjati storno qilindi", x.error ?? "");
    }
    check(Math.abs(balOf(m1) - b0.m1) < 0.0005 && Math.abs(balOf(m2) - b0.m2) < 0.0005 && Math.abs(balOf(m3) - b0.m3) < 0.0005, "7.16 storno'dan keyin qoldiqlar asliga qaytdi");
  } else check(false, "7.0 tayyorgarlik: 2 ta qoldiqli xomashyo va ikkinchi oluvchi (brigada / haydovchi)", `mats=${mats.length} t2=${t2}`);
}

// Tozalash: hujjatlar storno qilingan (o'chirilmaydi); boshqa narsa yaratilmadi
void Client;
summary("b-oluvchi");
