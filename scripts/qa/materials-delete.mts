// Sklad → Xomashyo qoldig'i: belgilab o'chirish («Hammasini belgilash» + «O'chirish») — lib/material-actions:
// deleteMaterials (belgilanganlar) va deleteCatalogMaterial (bitta tugma), ikkalasi ham bitta qoida — removeMaterial:
//  · hech qayerda ishlatilmagan — butunlay o'chiriladi;
//  · faqat «Xomashyo qo'shish» boshlang'ich qoldig'i bor (StockMove ADJUSTMENT, refType "StockIn") — o'chiruvchi direktor
//    yoki o'sha qoldiqni kiritgan xodim bo'lsa va partiya Kirim-Chiqimga chiqim bo'lmagan bo'lsa — StockMove'lari bilan
//    butunlay o'chiriladi (AuditLog DELETE, before.openingMoves — to'liq nusxa);
//  · boshqa sklad harakati / hujjatda ishlatilgan (bu yerda — spisanie) — qoldig'i 0 bo'lsa arxiv (isActive=false),
//    harakatlar joyida; skladda qoldig'i bor bo'lsa arxivga ham olinmaydi (bor tovar jadvaldan yo'qolmasin);
//  · ruxsat: stock moduliga yozolmaydigan rol (sotuv, buxgalter) — 403, hech narsa o'zgarmaydi, sahifada panel yo'q;
//  · bo'sh ro'yxat, mavjud bo'lmagan va takroriy id.
// Har test o'z xomashyosini T qo'shimchasi bilan ochadi; oxirida qolgan faol test xomashyolari o'chiriladi.
// Ishga tushirish: npx tsx scripts/qa/materials-delete.mts  (QA_BASE, QA_DATABASE_URL — README.md; b-all.sh ichida ham)
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, summary } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q1, lit } from "./db.mjs";

const T = Date.now().toString(36).slice(-5);

const sklad = new Client("sklad"), snab = new Client("snab"), dir = new Client("direktor"), sotuv = new Client("sotuv"), buh = new Client("buh");
await Promise.all([sklad.login("test.sklad"), snab.login("test.snab"), dir.login("test.direktor"), sotuv.login("test.sotuv"), buh.login("test.buh")]);
type C = typeof dir;

const n = (sql: string) => Number(q1(`select count(*)::int as n from (${sql}) x`).n);
const userId = (login: string) => q1(`select id from "User" where login=${lit(login)}`)?.id as string;
const skladId = userId("test.sklad"), snabId = userId("test.snab"), dirId = userId("test.direktor");
const wh = q1(`select id from "Warehouse" where "isActive" order by "isDefault" desc, name limit 1`)?.id as string | undefined;
if (!wh || !skladId || !snabId || !dirId) { console.error("Faol sklad yoki test.* foydalanuvchilar yo'q — test bazasi tayyor emas"); process.exit(2); }

const nm = (k: string) => `QA MD ${k} ${T}`;
const idOf = (name: string) => (q1(`select id from "Material" where name=${lit(name)}`)?.id as string | undefined) ?? "-";
const matOf = (id: string) => q1(`select id, name, "isActive" as active from "Material" where id=${lit(id)}`);
const movesOf = (id: string, extra = "") => n(`select id from "StockMove" where "materialId"=${lit(id)} ${extra}`);
/** «Xomashyo qo'shish» partiyasi (StockMove.refId, refType "StockIn") — bitta qo'shish seansi = bitta partiya. */
const openingBatch = (id: string) => (q1(`select "refId" from "StockMove" where "materialId"=${lit(id)} and "refType"='StockIn' limit 1`)?.refId as string | undefined) ?? "-";
const batchMoves = (batch: string) => n(`select id from "StockMove" where "refType"='StockIn' and "refId"=${lit(batch)}`);
const audits = (id: string, action: string, extra = "") => n(`select id from "AuditLog" where entity='Material' and "entityId"=${lit(id)} and action=${lit(action)} ${extra}`);

// ── Action chaqiruvlari (forma maydonlari — materials-form.tsx, material-bulk.tsx, spisanie formasi kabi) ──
const MA = "lib/material-actions";
const BALANCE = "/stock?tab=balance";
type Row = { name: string; qty?: number; price?: number };
/** Sklad → Xomashyo qo'shish: warehouseId, cashAccountId (faqat direktor; bo'sh — «Hisobga olinmasin»), rows JSON. */
async function add(c: C, rows: Row[], cashAccountId = "") {
  const r = await c.action("stock/actions#importMaterials", [undefined, fd({
    warehouseId: wh, cashAccountId,
    rows: JSON.stringify(rows.map((x) => ({ name: x.name, code: "", unit: "kg", qty: x.qty ?? "", price: x.price ?? "", minStock: "" }))),
  })], "/stock/materials/new");
  return { r, ids: Object.fromEntries(rows.map((x) => [x.name, idOf(x.name)])) as Record<string, string> };
}
/** «O'chirish» paneli: <input form="material-bulk" name="ids"> belgilari bitta formada (deleteMaterials faqat /stock sahifasida). */
const del = (c: C, ids: string[], page = BALANCE) => c.action(`${MA}#deleteMaterials`, [undefined, fd({ ids })], page);
/** Bitta tugma (spravochnik oynasi) — material-picker orqali /stock/materials/new sahifasida ro'yxatda. */
const delOne = (c: C, id: string, page = "/stock/materials/new") => c.action(`${MA}#deleteCatalogMaterial`, [id], page);
const writeOff = (c: C, materialId: string, qty: number) =>
  c.action("stock/adjust-actions#saveWriteOff", [undefined, fd({ warehouseId: wh, kind: "Brak (sifatsiz)", note: `QA materials-delete ${T}`, rows: JSON.stringify([{ materialId, qty }]) })], "/stock/spisanie");

let r, w;
let mC = "-", mX = "-", mK = "-";
try {
  // ───────── 1. Sklad xodimi: A — qoldiqsiz, B — boshlang'ich qoldiq, C — qoldiq + spisanie ─────────
  console.log("\n1. Sklad xodimi o'zi qo'shgan xomashyolarni belgilab o'chiradi");
  const [nA, nB, nC] = [nm("A"), nm("B"), nm("C")];
  const a1 = await add(sklad, [{ name: nA }, { name: nB, qty: 10, price: 1000 }, { name: nC, qty: 10, price: 1000 }]);
  const mA = a1.ids[nA], mB = a1.ids[nB];
  mC = a1.ids[nC];
  check("1.1 sklad 3 ta xomashyo qo'shdi (2 tasi boshlang'ich qoldiq bilan), /stock?tab=balance ga qaytdi",
    /added=3\b/.test(a1.r.redirect ?? "") && /moved=2\b/.test(a1.r.redirect ?? "") && [mA, mB, mC].every((x) => x !== "-"), [a1.r.redirect, a1.r.result ?? a1.r.status]);
  const batch1 = openingBatch(mB);
  check("1.2 B va C qoldig'i bitta partiyada: StockMove ADJUSTMENT / StockIn, kiritgan — sklad xodimi",
    batch1 !== "-" && openingBatch(mC) === batch1 && batchMoves(batch1) === 2
    && n(`select id from "StockMove" where "refType"='StockIn' and "refId"=${lit(batch1)} and type='ADJUSTMENT' and "createdById"=${lit(skladId)}`) === 2, batch1);
  // C ning butun qoldig'i (10 kg) hisobdan chiqariladi: ishlatilgan, lekin qoldig'i 0 — arxivga olinadi
  w = await writeOff(sklad, mC, 10);
  check("1.3 C ning 10 kg qoldig'i to'liq hisobdan chiqarildi (boshqa sklad harakati — WRITE_OFF)", w.result?.ok === true && movesOf(mC, `and type='WRITE_OFF'`) === 1, w.result ?? w.status);

  r = await del(sklad, [mA, mB, mC]);
  const note1: string = r.result?.note ?? "";
  check("1.4 javob: «2 ta xomashyo o'chirildi (1 tasi boshlang'ich qoldig'i bilan)» + C arxivga, sababi bilan",
    r.result?.ok === true && /^2 ta xomashyo o'chirildi \(1 tasi boshlang'ich qoldig'i bilan\)\./.test(note1)
    && /1 tasi o'chirilmadi, ro'yxatdan olib tashlandi: /.test(note1) && note1.includes(`${nC} — hujjatlarda ishlatilgan (sklad harakatida 1)`), r.result ?? r.status);
  check("1.5 A va B butunlay o'chirildi (Material qatori yo'q)", !matOf(mA) && !matOf(mB), [matOf(mA), matOf(mB)]);
  check("1.6 B ning boshlang'ich qoldig'i (StockIn) o'chdi; shu partiyadagi C niki joyida",
    movesOf(mB) === 0 && batchMoves(batch1) === 1 && movesOf(mC, `and "refType"='StockIn'`) === 1, batchMoves(batch1));
  check("1.7 C arxivda (isActive=false), harakatlari joyida (boshlang'ich + spisanie)", matOf(mC)?.active === false && movesOf(mC) === 2, [matOf(mC), movesOf(mC)]);
  check("1.8 AuditLog: A — DELETE (sklad xodimi, openingMoves bo'sh)",
    audits(mA, "DELETE", `and "userId"=${lit(skladId)} and jsonb_array_length(before->'openingMoves') = 0`) === 1);
  check("1.9 AuditLog: B — DELETE, before.openingMoves ichida 10 kg qoldiqning to'liq nusxasi (partiya bilan)",
    audits(mB, "DELETE", `and "userId"=${lit(skladId)} and jsonb_array_length(before->'openingMoves') = 1
      and (before->'openingMoves'->0->>'qty')::numeric = 10 and before->'openingMoves'->0->>'refId' = ${lit(batch1)}
      and before->'openingMoves'->0->>'type' = 'ADJUSTMENT'`) === 1);
  check("1.10 AuditLog: C — UPDATE (isActive=false, sababi bilan), DELETE yo'q",
    audits(mC, "UPDATE", `and "userId"=${lit(skladId)} and after->>'isActive' = 'false' and after->>'reason' like '%arxiv%hujjatlarda ishlatilgan%'`) === 1 && audits(mC, "DELETE") === 0);
  r = await del(sklad, [mC]);
  check("1.11 arxivdagi C ni qayta o'chirish — «1 tasi o'zgarmadi: … allaqachon arxivda» xatosi, o'zgarish yo'q",
    /1 tasi o'zgarmadi: .*allaqachon arxivda/.test(r.result?.error ?? "") && matOf(mC)?.active === false && movesOf(mC) === 2 && audits(mC, "UPDATE") === 1, r.result ?? r.status);

  // Ishlatilgan va skladda qoldig'i bor xomashyo — arxivga ham olinmaydi (bor tovar jadvaldan yo'qolmasin)
  const nH = nm("H");
  const a1h = await add(sklad, [{ name: nH, qty: 10, price: 700 }]);
  const mH = a1h.ids[nH];
  w = await writeOff(sklad, mH, 1);
  r = await del(sklad, [mH]);
  check("1.12 ishlatilgan, qoldig'i bor H (9 kg) — o'chirilmadi va arxivga ham olinmadi, sababi: qoldiq bor",
    mH !== "-" && w.result?.ok === true && /^1 tasi o'zgarmadi: /.test(r.result?.error ?? "") && /skladda qoldig'i bor \(9 kg\)/.test(r.result?.error ?? "")
    && matOf(mH)?.active === true && movesOf(mH) === 2 && audits(mH, "UPDATE") === 0, r.result ?? r.status);
  w = await writeOff(sklad, mH, 9);
  r = await del(sklad, [mH]);
  check("1.13 H qoldig'i 0 ga tushgach — arxivga olindi", w.result?.ok === true && r.result?.ok === true && matOf(mH)?.active === false, r.result ?? r.status);

  // ───────── 2. Boshqa xodim kiritgan boshlang'ich qoldiq ─────────
  console.log("\n2. Qoldiqni boshqa xodim kiritgan — faqat kiritgan xodim yoki direktor o'chiradi");
  const nD = nm("D");
  const a2 = await add(sklad, [{ name: nD, qty: 5, price: 2000 }]);
  const mD = a2.ids[nD];
  check("2.1 sklad D ni boshlang'ich qoldiq (5 kg) bilan qo'shdi", mD !== "-" && movesOf(mD, `and "createdById"=${lit(skladId)}`) === 1, [a2.r.redirect, a2.r.result]);
  r = await del(snab, [mD]);
  check("2.2 ta'minotchi D ni o'chira olmaydi — boshqa xodim kiritgan, skladda qoldig'i bor (5 kg): o'zgarmadi",
    /^1 tasi o'zgarmadi: /.test(r.result?.error ?? "") && /boshlang'ich qoldig'ini boshqa xodim kiritgan/.test(r.result?.error ?? "") && /skladda qoldig'i bor \(5 kg\)/.test(r.result?.error ?? ""), r.result ?? r.status);
  check("2.3 D faol (arxivga ham olinmadi), StockMove o'chmagan, Material auditi yo'q",
    matOf(mD)?.active === true && movesOf(mD) === 1 && audits(mD, "UPDATE") === 0 && audits(mD, "DELETE") === 0, [matOf(mD), movesOf(mD)]);
  r = await del(snab, [mD]);
  check("2.4 ta'minotchi qayta urinsa — xuddi shu javob, qoldiq joyida", /^1 tasi o'zgarmadi: /.test(r.result?.error ?? "") && movesOf(mD) === 1, r.result ?? r.status);
  // Faqat boshlang'ich qoldig'i bor (boshqa hujjat yo'q, kassaga chiqim yo'q) xomashyoni direktor qoldig'i bilan butunlay o'chiradi
  r = await del(dir, [mD]);
  check("2.5 direktor D ni boshlang'ich qoldig'i bilan butunlay o'chirdi",
    r.result?.ok === true && /^1 ta xomashyo o'chirildi \(1 tasi boshlang'ich qoldig'i bilan\)\./.test(r.result.note ?? "") && !matOf(mD) && movesOf(mD) === 0, r.result ?? r.status);
  check("2.6 AuditLog: D — DELETE (direktor), openingMoves'da kiritgan — sklad xodimi",
    audits(mD, "DELETE", `and "userId"=${lit(dirId)} and jsonb_array_length(before->'openingMoves') = 1 and before->'openingMoves'->0->>'createdById' = ${lit(skladId)}`) === 1);

  // ───────── 3. Qo'shish summasi kassadan chiqim bo'lgan partiya ─────────
  console.log("\n3. Partiya Kirim-Chiqimga chiqim bo'lib yozilgan — direktor ham butunlay o'chirmaydi");
  // Qoldig'i eng katta faol hisob: naqd kassa / overdraftsiz bank minusga tushmasin (cashOutflowError), summa — 3 000 so'm
  const acc = q1(`select a.id, a.name,
      coalesce((select sum(p.amount) from "Payment" p where p."cashAccountId"=a.id), 0)
    + coalesce((select sum(case when t.type in ('EXPENSE','TRANSFER_OUT') then -t.amount else t.amount end) from "CashTransaction" t where t."cashAccountId"=a.id), 0) as bal
    from "CashAccount" a where a."isActive" order by bal desc limit 1`);
  const nE = nm("E");
  const a3 = await add(dir, [{ name: nE, qty: 2, price: 1500 }], acc?.id ?? "");
  const mE = a3.ids[nE], batchE = openingBatch(mE);
  const cashE = () => n(`select id from "CashTransaction" where "refType"='StockIn' and "refId"=${lit(batchE)} and type='EXPENSE' and amount = 3000`);
  check(`3.1 direktor E ni qo'shdi, 3 000 so'm «${acc?.name ?? "?"}» hisobidan chiqim (CashTransaction StockIn)`,
    mE !== "-" && batchE !== "-" && movesOf(mE) === 1 && cashE() === 1, [a3.r.redirect, a3.r.result, acc]);
  r = await del(dir, [mE]);
  check("3.2 direktor deleteMaterials([E]) — o'zgarmadi: «Kirim-Chiqimga chiqim bo'lib yozilgan», qoldig'i bor",
    /^1 tasi o'zgarmadi: /.test(r.result?.error ?? "") && /Kirim-Chiqimga chiqim bo'lib yozilgan/.test(r.result?.error ?? "") && /skladda qoldig'i bor \(2 kg\)/.test(r.result?.error ?? ""), r.result ?? r.status);
  check("3.3 E faol, StockMove va CashTransaction joyida, Material auditi yo'q",
    matOf(mE)?.active === true && movesOf(mE) === 1 && cashE() === 1 && audits(mE, "UPDATE") === 0 && audits(mE, "DELETE") === 0, [matOf(mE), movesOf(mE), cashE()]);

  // ───────── 4. Ruxsat ─────────
  console.log("\n4. Ruxsat: stock moduliga yozolmaydigan rol o'chira olmaydi");
  const nX = nm("X");
  const a4 = await add(sklad, [{ name: nX }]);
  mX = a4.ids[nX];
  check("4.0 (tayyorlov) sklad qoldiqsiz X ni qo'shdi", mX !== "-" && matOf(mX)?.active === true, a4.r.result ?? a4.r.redirect);
  // deleteMaterials /stock sahifasida ro'yxatda; sotuvchi va buxgalterga /stock faqat ko'rish uchun ochiq — middleware o'tkazadi,
  // requireModuleWrite("stock") AccessDenied (digest NEXT_HTTP_ERROR_FALLBACK;403) tashlaydi → Next 403 qaytaradi.
  // Asosiy dalil — 4.4: rad etilgan chaqiruvlardan keyin hech narsa o'zgarmagan.
  for (const [i, who, c] of [[1, "sotuvchi", sotuv], [2, "buxgalter", buh]] as [number, string, C][]) {
    r = await del(c, [mX]);
    check(`4.${i} ${who} deleteMaterials chaqira olmaydi (/stock dan — 403)`, r.status === 403 && r.result?.ok !== true, `${r.status} ${JSON.stringify(r.result ?? "")}`);
  }
  r = await delOne(sotuv, mX);
  check("4.3 sotuvchi bitta tugma (deleteCatalogMaterial) bilan ham o'chira olmaydi (307 yoki 403)", [307, 403].includes(r.status) && r.result?.ok !== true, `${r.status} ${JSON.stringify(r.result ?? "")}`);
  check("4.4 rad etilgan chaqiruvlardan keyin X joyida va faol, Material auditida o'zgarish yo'q",
    matOf(mX)?.active === true && audits(mX, "DELETE") === 0 && audits(mX, "UPDATE") === 0, matOf(mX));

  // ───────── 5. Chegaraviy holatlar ─────────
  console.log("\n5. Bo'sh ro'yxat, mavjud bo'lmagan va takroriy id");
  const nY = nm("Y");
  const a5 = await add(sklad, [{ name: nY }]);
  const mY = a5.ids[nY];
  r = await del(sklad, []);
  check("5.1 bo'sh ro'yxat — «Xomashyo belgilanmagan» xatosi", r.result?.error === "Xomashyo belgilanmagan", r.result ?? r.status);
  r = await del(sklad, [`yoq-${T}`]);
  check("5.2 mavjud bo'lmagan id — «1 tasi topilmadi» (xato, hech narsa o'chmadi)", /^1 tasi topilmadi/.test(r.result?.error ?? ""), r.result ?? r.status);
  r = await del(sklad, [mY, mY, `yoq-${T}`]);
  check("5.3 takroriy id bir marta: «1 ta xomashyo o'chirildi» + «1 tasi topilmadi», DELETE audit 1 ta",
    mY !== "-" && r.result?.ok === true && /^1 ta xomashyo o'chirildi\./.test(r.result.note ?? "") && /1 tasi topilmadi/.test(r.result.note ?? "")
    && !matOf(mY) && audits(mY, "DELETE") === 1, r.result ?? r.status);

  // ───────── 6. Bitta tugma (deleteCatalogMaterial) — o'sha qoida ─────────
  console.log("\n6. deleteCatalogMaterial ham removeMaterial qoidasi bilan");
  const [nF, nG] = [nm("F"), nm("G")];
  const a6 = await add(sklad, [{ name: nF, qty: 3, price: 500 }, { name: nG, qty: 4, price: 500 }]);
  const mF = a6.ids[nF], mG = a6.ids[nG];
  r = await delOne(sklad, mF);
  check("6.1 o'zi kiritgan qoldiqli F — «o'chirildi (boshlang'ich qoldig'i bilan)», qoldiq ham o'chdi",
    mF !== "-" && r.result?.ok === true && r.result.note === `«${nF}» o'chirildi (boshlang'ich qoldig'i bilan).` && !matOf(mF) && movesOf(mF) === 0
    && audits(mF, "DELETE", `and jsonb_array_length(before->'openingMoves') = 1`) === 1, r.result ?? r.status);
  r = await delOne(sklad, mF);
  check("6.2 o'chirilganini qayta — «Xomashyo topilmadi»", r.result?.error === "Xomashyo topilmadi", r.result ?? r.status);
  w = await writeOff(sklad, mG, 1);
  r = await delOne(sklad, mG);
  check("6.3 ishlatilgan, qoldig'i bor G (3 kg) — «o'chirilmadi: … skladda qoldig'i bor», faol qoldi",
    w.result?.ok === true && /^«.+» o'chirilmadi: hujjatlarda ishlatilgan \(sklad harakatida 1\); skladda qoldig'i bor \(3 kg\)/.test(r.result?.error ?? "")
    && matOf(mG)?.active === true && movesOf(mG) === 2, [w.result, r.result ?? r.status]);
  w = await writeOff(sklad, mG, 3);
  r = await delOne(sklad, mG);
  check("6.3b G qoldig'i 0 — «o'chirilmadi … Ro'yxatdan olib tashlandi», arxiv, harakatlari joyida",
    w.result?.ok === true && r.result?.ok === true && /o'chirilmadi — hujjatlarda ishlatilgan \(sklad harakatida 2\)\. Ro'yxatdan olib tashlandi/.test(r.result.note ?? "")
    && matOf(mG)?.active === false && movesOf(mG) === 3, [w.result, r.result ?? r.status]);
  r = await delOne(sklad, mC);
  check("6.4 arxivdagi ishlatilgan C — «o'chirilmadi: … allaqachon arxivda» xatosi",
    /o'chirilmadi: hujjatlarda ishlatilgan.*allaqachon arxivda/.test(r.result?.error ?? "") && matOf(mC)?.active === false && movesOf(mC) === 2, r.result ?? r.status);

  // ───────── 7. Sahifa: belgilash paneli ─────────
  console.log("\n7. /stock?tab=balance — belgilash paneli faqat yoza oladiganlarga");
  const nK = nm("K");
  const a7 = await add(sklad, [{ name: nK }]);
  mK = a7.ids[nK];
  let page = await sklad.get(BALANCE);
  check("7.1 sklad xodimiga 200, «Hammasini belgilash» paneli va material-bulk formasi bor",
    page.status === 200 && page.text.includes("Hammasini belgilash") && page.text.includes(`id="material-bulk"`), `${page.status} ${page.location ?? ""}`);
  check("7.2 faol xomashyo qatorida belgi (form=material-bulk, name=ids), arxivdagi C ning belgisi yo'q",
    mK !== "-" && page.text.includes(`value="${mK}"`) && /<input[^>]*form="material-bulk"[^>]*name="ids"/.test(page.text) && !page.text.includes(`value="${mC}"`));
  page = await dir.get(BALANCE);
  check("7.3 direktorga ham panel bor", page.status === 200 && page.text.includes("Hammasini belgilash"), `${page.status} ${page.location ?? ""}`);
  for (const [who, c] of [["sotuvchi", sotuv], ["buxgalter", buh]] as [string, C][]) {
    page = await c.get(BALANCE);
    check(`7.4 ${who}ga qoldiqlar ochiladi (200), lekin belgilash paneli va belgilar yo'q`,
      page.status === 200 && page.text.includes(nK) && !page.text.includes("Hammasini belgilash") && !page.text.includes(`form="material-bulk"`), `${page.status} ${page.location ?? ""}`);
  }
} catch (e) {
  check("kutilmagan xato — test to'xtadi", false, String((e as Error)?.stack ?? e));
} finally {
  // Tozalash: qoldiqsiz test xomashyolari (X, K) — o'zi qo'shgan sklad xodimi o'chiradi
  const left = [mX, mK].filter((x) => x !== "-" && matOf(x));
  if (left.length) {
    r = await del(sklad, left).catch((e: unknown) => ({ result: { error: String(e) } }));
    check("8. tozalash: qolgan test xomashyolari (X, K) o'chirildi", r.result?.ok === true && left.every((x) => !matOf(x)), r.result);
  }
}

summary("materials-delete:");
