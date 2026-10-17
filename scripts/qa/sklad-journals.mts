// Sklad → «Приход», «Расход», «Остатки» (ruscha jurnallar, Excel'dagidek), «Дона сўм», «Кому» ro'yxati va mobil:
//  · «Кому» (StockRecipient, stock/rasxod/actions#saveRecipient|toggleRecipient): sklad qo'shadi (bo'shliqlar tozalanadi),
//    takror nom (katta-kichik harf farqisiz, nofaol bo'lsa ham) — xato, snabjeniye tahrirlaydi, nofaol qilinadi (o'chirilmaydi),
//    sotuvchi qo'sha / yashira olmaydi; /stock/rasxod (boshqaruv) va /stock/rasxod/new (faqat faollar);
//  · «Приход» (stock/prixod/actions#createPrixod → lib/receipts createGoodsReceipt): П-р kirim 2 qator, biri dostavka bilan —
//    GoodsReceipt yangi maydonlari (ТТН, Деньги, Кому, Адрес, Снабженец, Почему), item.deliveryCost, StockMove RECEIPT
//    unitCost = narx (korxona QQS to'lovchisi emas — QQS bilan) + dostavka / qty; Н-к — barcha qatorlarda QQS 0;
//    clientToken takrori — bitta kirim; ruscha xatolar; sklad tanlagan hisob e'tiborsiz; sotuvchi — 403;
//    prixodJournal / prixodTotals va /stock/prixod sahifasi (sotuvchiga yopiq → /stock); yetkazuvchi qarzi (supplierLedger)
//    dostavka bilan; lastReceiptTerms; storno qilingan kirim — asl qator o'z sanasida (ustidan chizilgan) + manfiy «Сторно»
//    qatori, Σ К-во = «Остатки» Приход;
//  · «Дона сўм» (stock/price-actions#saveMaterialPrice): faqat snabjeniye, audit, «O'zgarish yo'q», noto'g'ri narx;
//  · «Расход» (stock/rasxod/actions#createRasxod → lib/stock-issue issueStock): oluvchiga ISSUE (recipientId, unitCost =
//    Дона сўм, narxsizda — o'rtacha tannarx), brigadaga BRIGADE_ISSUE + BrigadeMove; bir xomashyo ikki qatorda — bitta harakat;
//    qoldiqdan oshsa hech narsa yozilmaydi; takror kalit; sana chegaralari; sotuvchi — 403; rasxodJournal (Деньги/НДС
//    oxirgi kirimdan, «Кому» filtri), zames — kun + xomashyo + sklad bo'yicha bitta qator (bazada bo'lsa); sahifa;
//  · narx o'zgargach: keyingi spisanie / brigadaga berish — yangi narx, eski chiqim narxi o'zgarmaydi;
//  · «Расход» (R): sotuvchiga /stock/rasxod yopiq (→ /stock); korxona QQS to'lovchisi emas — НДС 0 (saveVatPayer orqali vaqtincha,
//    keyin qaytariladi); brigadadan qaytish — berilgan narxda (qo'lidagi o'rtacha), joriy «Дона сўм» da emas; storno
//    (stock/rasxod/actions#cancelRasxod): sklad / snabjeniye — 403, sababsiz — xato, direktor — teskari harakatlar, qoldiq qaytadi,
//    jurnalda manfiy «Сторно» qatori va asl qatorda «отменён», takror — «уже отменён», brigada sarflagan bo'lsa — rad; «Остатки» ayniyati;
//  · «Остатки» (lib/stock-turnover materialTurnover + /stock?tab=balance): test xomashyosi bo'yicha aniq qiymatlar,
//    har xomashyo uchun oxirgi = boshlang'ich + приход − расход va SQL qoldig'i bilan moslik, Расход = Расход jurnali;
//  · mobil: /api/mobile/list?key=prixod|rasxod|ostatki, /api/mobile/form?key=prixod|rasxod (sklad — 200, sotuvchi — 403),
//    /api/mobile/create rasxod (payload forma tavsifidan yig'iladi) va takror kalit; Приход formasida «Цена» avto-to'ldirilmaydi;
//    xomashyo kartochkasida «Дона сўм» / «Остатки» — sklad ko'radi, sotuvchi ko'rmaydi.
// Har test o'z ma'lumotini T qo'shimchasi bilan ochadi (yetkazuvchi, xomashyo, oluvchi, brigada). Oxirida: brigada qoldig'i
// skladga qaytariladi, test xomashyosi qoldig'i hisobdan chiqarilib arxivga olinadi, «Дона сўм» qaytariladi, oluvchilar,
// brigada va yetkazuvchi nofaol qilinadi (hujjatlar o'chirilmaydi). Boshqa xomashyolar narxiga tegilmaydi.
// Ishga tushirish: npx tsx scripts/qa/sklad-journals.mts  (QA_BASE, QA_DATABASE_URL — README.md; b-all.sh ichida ham)
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, eq2, summary, BASE } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q, q1, lit, DB_URL } from "./db.mjs";

// Lib funksiyalari (faqat o'qish) shu test bazasiga ulansin — db.mjs nomini tekshirgan (insof_test…, golden emas)
process.env.DATABASE_URL = DB_URL;
const { prixodJournal, prixodTotals, lastReceiptTerms } = await import("../../src/lib/receipts");
const { rasxodJournal, rasxodTotals } = await import("../../src/lib/stock-issue");
const { materialTurnover } = await import("../../src/lib/stock-turnover");
const { supplierLedger } = await import("../../src/lib/receipt-payables");

const T = Date.now().toString(36).slice(-5);
const pad = (x: number) => String(x).padStart(2, "0");
/** Mahalliy sana YYYY-MM-DD (server bilan bir mashina — `isoDate` kabi). */
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plusDays = (d: Date, k: number) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
/** Mahalliy yarim tun — `stockPeriod` kabi; davr `to` si eksklyuziv (oxirgi kun ertasi). */
const dayAt = (s: string) => new Date(`${s}T00:00:00`);
/** StockMove.date — vaqt mintaqasisiz (UTC devor vaqti): chegara `'<ISO>'::timestamp` (lib/stock-turnover kabi). */
const tsLit = (d: Date) => `'${d.toISOString()}'::timestamp`;
/** psql json'idagi timestamp (mintaqasiz) — UTC. */
const utc = (s: string) => new Date(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
const near = (a: unknown, b: number, eps = 0.0015) => a != null && Number.isFinite(Number(a)) && Math.abs(Number(a) - b) < eps;
const r2 = (v: number) => Math.round(v * 100) / 100;
const now = new Date();
const today = ymd(now), yesterday = ymd(plusDays(now, -1)), tomorrow = ymd(plusDays(now, 1));
const old40 = ymd(plusDays(now, -40));

const sklad = new Client("sklad"), snab = new Client("snab"), dir = new Client("direktor"), sotuv = new Client("sotuv");
await Promise.all([sklad.login("test.sklad"), snab.login("test.snab"), dir.login("test.direktor"), sotuv.login("test.sotuv")]);
type C = typeof dir;
type ActionRes = { status: number; redirect: string | null; text: string; result?: { ok?: boolean; error?: string; note?: string } };

const n = (sql: string) => Number(q1(`select count(*)::int as n from (${sql}) x`).n);
const userOf = (login: string) => q1(`select id, "fullName" as name from "User" where login=${lit(login)}`) as { id: string; name: string } | undefined;
const skladRow = userOf("test.sklad"), snabRow = userOf("test.snab");
const whRow = q1(`select id, name from "Warehouse" where "isActive" order by "isDefault" desc, name limit 1`) as { id: string; name: string } | undefined;
if (!whRow || !skladRow || !snabRow) { console.error("Faol sklad yoki test.* foydalanuvchilar yo'q — test bazasi tayyor emas"); process.exit(2); }
const wh = whRow, uSklad = skladRow, uSnab = snabRow;
// Korxona QQS to'lovchisi (yozuv bo'lmasa — standart true): sklad tannarxi shunga bog'liq (lib/receipt-vat stockUnitCost)
const cv = q1(`select "vatPayer" as v from "CompanySettings" where id='main'`)?.v !== false;
const bankAcc = q1(`select id from "CashAccount" where "isActive" and type='BANK' order by name limit 1`)?.id as string | undefined;
const otherWh = q1(`select id from "Warehouse" where "isActive" and id <> ${lit(wh.id)} limit 1`)?.id as string | undefined;

// ── Test ma'lumoti (T bilan noyob) ──
const supName = `QA SJ Поставщик ${T}`;
const M1n = `QA SJ Цемент ${T}`, M2n = `QA SJ Арматура ${T}`;
const R1n = `QA SJ Шофёры ${T}`, R2n = `QA SJ Сварщики ${T}`;
const brName = `QA SJ Бригада ${T}`;
const TTN = `QA-${T}-1`, TTN_B = `QA-${T}-2`, ADDR = `Ташкент, объект ${T}`, PURP = `Для замеса ${T}`, RNOTE = `QA рейс ${T}`;
let supId = "", M1 = "", M2 = "", R1 = "", R2 = "", brId = "";
let docA = "", docB = "", docC = "";

const idBy = (table: string, name: string) => (q1(`select id from "${table}" where name=${lit(name)} limit 1`)?.id as string | undefined) ?? "";
const bal = (m: string) => Number(q1(`select coalesce(sum(qty), 0)::float8 as b from "StockMove" where "materialId"=${lit(m)} and "warehouseId"=${lit(wh.id)}`).b);
const cyr = (s: string | undefined) => /[А-Яа-яЁё]/.test(s ?? "");

// ── Action chaqiruvlari (forma maydonlari — prixod-form.tsx, rasxod-form.tsx, recipients-manager.tsx, price-cell.tsx kabi) ──
const PX = "stock/prixod/actions#createPrixod", PX_NEW = "/stock/prixod/new";
const RX = "stock/rasxod/actions", RX_PAGE = "/stock/rasxod", RX_NEW = "/stock/rasxod/new";
const BAL = "/stock?tab=balance", BRIG = "/stock?tab=brigades";

type PxLine = { m: string; qty: string; price: string; delivery?: string; vat?: string };
type PxOpts = { token?: string; date?: string; payment?: string; waybillNo?: string; recipientId?: string; address?: string; buyerId?: string; purpose?: string; cashAccountId?: string; lines: PxLine[] };
/** «Новый приход»: qatorlar `materialId[]`, `qty[]`, `price[]`, `deliveryCost[]`, `vatRate[]` (formadagi yashirin maydonlar). */
const prixod = (c: C, o: PxOpts): Promise<ActionRes> => c.action(PX, [undefined, fd({
  clientToken: o.token ?? crypto.randomUUID(), date: o.date ?? today, supplierId: supId, warehouseId: wh.id,
  payment: o.payment ?? "BANK", waybillNo: o.waybillNo ?? "", recipientId: o.recipientId ?? "", address: o.address ?? "",
  buyerId: o.buyerId ?? "", purpose: o.purpose ?? "", note: `QA sklad-journals ${T}`, cashAccountId: o.cashAccountId ?? "",
  "materialId[]": o.lines.map((l) => l.m), "qty[]": o.lines.map((l) => l.qty), "price[]": o.lines.map((l) => l.price),
  "deliveryCost[]": o.lines.map((l) => l.delivery ?? ""), "vatRate[]": o.lines.map((l) => l.vat ?? "12"),
})], PX_NEW);
/** Saqlangandan keyin: /stock/prixod?from=…&to=…&saved=<docNo>. */
const savedOf = (r: ActionRes) => { const m = /[?&]saved=([^&;]+)/.exec(r.redirect ?? ""); return m ? decodeURIComponent(m[1]) : ""; };

/** «Новый расход»: «Кому» — "r:<id>" | "b:<id>", qatorlar `materialId[]` + `qty[]`. */
const rasxod = (c: C, o: { to: string; rows: [string, string][]; token?: string; date?: string; note?: string }): Promise<ActionRes> =>
  c.action(`${RX}#createRasxod`, [undefined, fd({
    warehouseId: wh.id, to: o.to, date: o.date ?? today, note: o.note ?? "", clientToken: o.token ?? "",
    "materialId[]": o.rows.map((x) => x[0]), "qty[]": o.rows.map((x) => x[1]),
  })], RX_NEW);
const saveRec = (c: C, form: Record<string, string>): Promise<ActionRes> => c.action(`${RX}#saveRecipient`, [undefined, fd(form)], RX_PAGE);
const toggleRec = (c: C, id: string, on: boolean): Promise<ActionRes> => c.action(`${RX}#toggleRecipient`, [id, on], RX_PAGE);
/** Расход stornosi: cancelRasxod(ref, sabab) — sahifadagi «Сторно» tugmasi (stock/rasxod/storno-button.tsx) kabi. */
const cancelRx = (c: C, ref: string, reason: string): Promise<ActionRes> => c.action(`${RX}#cancelRasxod`, [ref, reason], RX_PAGE);
/** «Сторно» tugmasining title'i — sahifada tugma bor-yo'qligi shu bo'yicha tekshiriladi. */
const STORNO_BTN = `title="Storno — chiqimni bekor qilish"`;
/** Korxona QQS to'lovchisi (settings/actions#saveVatPayer — faqat direktor; b-vat.mts dagidek). */
const setCompanyVat = (v: "1" | "0"): Promise<ActionRes> => dir.action("settings/actions#saveVatPayer", [undefined, fd({ vatPayer: v })], "/settings");
const vatPayerNow = () => q1(`select "vatPayer" as v from "CompanySettings" where id='main'`)?.v !== false;
/** Sklad → Brigadalar: brigadadan skladga qaytarish (brigade-actions#returnToStock). */
const returnBr = (c: C, materialId: string, qty: string): Promise<ActionRes> =>
  c.action("stock/brigade-actions#returnToStock", [brId, undefined, fd({ materialId, qty, warehouseId: wh.id })], "/stock?tab=brigades");
/** Sahifada «Dona narxi» qalamchasi bormi: IconButton `aria-label` — HTML'da tutuq belgisi `&#x27;` bo'lib keladi. */
const priceEditable = (html: string, name: string) => ["'", "&#x27;", "&#39;"].some((q) => html.includes(`Narxni o${q}zgartirish: ${name}`));
/** «Дона сўм» katagi: saveMaterialPrice(materialId, prev, fd{price}) — bo'sh = narxni olib tashlash. */
const setPrice = (c: C, id: string, price: string): Promise<ActionRes> => c.action("stock/price-actions#saveMaterialPrice", [id, undefined, fd({ price })], BAL);
const writeOff = (c: C, rows: { materialId: string; qty: number }[], kind = "Brak (sifatsiz)"): Promise<ActionRes> =>
  c.action("stock/adjust-actions#saveWriteOff", [undefined, fd({ warehouseId: wh.id, kind, note: `QA sklad-journals ${T}`, rows: JSON.stringify(rows) })], "/stock/spisanie");
const denied = (r: ActionRes) => [307, 403].includes(r.status) && r.result?.ok !== true && !r.redirect;

const recOf = (name: string) => q1(`select id, name, note, "isActive" as active from "StockRecipient" where name=${lit(name)}`) as { id: string; name: string; note: string | null; active: boolean } | undefined;
const recAudits = (id: string, action: string) => n(`select id from "AuditLog" where entity='StockRecipient' and "entityId"=${lit(id)} and action=${lit(action)}`);
type RecRow = { id: string; docNo: string; supplierId: string; warehouseId: string; waybillNo: string | null; payment: string | null; recipientId: string | null; address: string | null; buyerId: string | null; purpose: string | null; createdById: string; note: string | null };
const recBy = (where: string) => q1(`select id, "docNo", "supplierId", "warehouseId", "waybillNo", payment, "recipientId", address, "buyerId", purpose, "createdById", note
  from "GoodsReceipt" where ${where}`) as RecRow | undefined;
type ItemRow = { m: string; qty: number; price: number; rate: number; vat: number; dc: number };
const itemsOf = (rid: string) => q(`select "materialId" as m, qty::float8 as qty, price::float8 as price, "vatRate" as rate, "vatAmount"::float8 as vat, "deliveryCost"::float8 as dc
  from "GoodsReceiptItem" where "receiptId"=${lit(rid)}`) as ItemRow[];
type MoveRow = { m: string; type: string; qty: number; cost: number | null; wh: string; rec: string | null; br: string | null; rt: string | null; ref: string | null; note: string | null };
const movesWhere = (where: string) => q(`select "materialId" as m, type, qty::float8 as qty, "unitCost"::float8 as cost, "warehouseId" as wh, "recipientId" as rec,
  "brigadeId" as br, "refType" as rt, "refId" as ref, note from "StockMove" where ${where} order by "createdAt"`) as MoveRow[];
const priceOf = (id: string) => q1(`select "unitPrice"::float8 as p, "unitPriceById" as by, "unitPriceAt" is not null as at from "Material" where id=${lit(id)}`) as { p: number | null; by: string | null; at: boolean } | undefined;
type PriceAudit = { before: { unitPrice?: number | null } | null; after: { unitPrice?: number | null } | null; u: string };
const priceAudits = (id: string) => q(`select before, after, "userId" as u from "AuditLog" where entity='Material' and "entityId"=${lit(id)}
  and action='UPDATE' and after ? 'unitPrice' order by "createdAt"`) as PriceAudit[];

// ── Mobil API (login-templates.mts dagi mobile() uslubida: har so'rov o'z IP'si bilan — login-guard qulfi aralashmasin) ──
let ipSeq = 0;
async function mobile(method: "GET" | "POST", path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = { "x-forwarded-for": `10.91.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* JSON emas */ }
  return { status: res.status, json, text };
}
const mLogin = async (login: string) => (await mobile("POST", "/api/mobile/auth/login", undefined, { login, password: "Test2026" })).json?.accessToken as string | undefined;
type MField = { name: string; type: string; value?: string; options?: { value: string }[]; columns?: MField[] };
/**
 * Mobil forma tavsifidan (`/api/mobile/form`) payload — ilova kabi: maydon nomlari serverdan keladi.
 * select: «Кому» ("r:<id>" yoki oluvchi id) / sklad / xomashyo qaysi variantda bo'lsa o'sha; date — bugun; number — miqdor;
 * items — bitta qator; *token* maydoni — bir martalik kalit (`clientToken` har holda yuqori darajada ham beriladi).
 */
function mobilePayload(fields: MField[], w: { warehouseId: string; recipientId: string; materialId: string; qty: number; date: string; token: string }) {
  const pick = (f: MField): unknown => {
    if (/token/i.test(f.name)) return w.token;
    if (f.type === "select") {
      const vals = (f.options ?? []).map((o) => o.value);
      for (const v of [`r:${w.recipientId}`, w.recipientId, w.warehouseId, "recipient", w.materialId]) if (vals.includes(v)) return v;
      return f.value;
    }
    if (f.type === "date") return w.date;
    if (f.type === "number") return w.qty;
    return f.value;
  };
  const out: Record<string, unknown> = { clientToken: w.token };
  for (const f of fields) {
    if (f.type === "items") out[f.name] = [Object.fromEntries((f.columns ?? []).map((c) => [c.name, pick(c)]).filter(([, v]) => v !== undefined))];
    else { const v = pick(f); if (v !== undefined) out[f.name] = v; }
  }
  return out;
}

let r: ActionRes;
try {
  // ───────── 0. Tayyorlov ─────────
  console.log("\n0. Tayyorlov: yetkazuvchi (QQS to'lovchisi), 2 ta xomashyo, brigada");
  r = await sklad.action("suppliers/actions#createSupplier", [undefined, fd({ name: supName, vatPayer: "1" })], "/suppliers");
  supId = idBy("Supplier", supName);
  r = await sklad.action("stock/actions#importMaterials", [undefined, fd({
    warehouseId: wh.id, cashAccountId: "",
    rows: JSON.stringify([M1n, M2n].map((name) => ({ name, code: "", unit: "kg", qty: "", price: "", minStock: "" }))),
  })], "/stock/materials/new");
  M1 = idBy("Material", M1n); M2 = idBy("Material", M2n);
  r = await dir.action("brigades/actions#saveBrigade", [null, undefined, fd({ name: brName })], "/brigades");
  brId = idBy("Brigade", brName);
  check(`0.1 yetkazuvchi, xomashyolar (qoldiqsiz), brigada ochildi (korxona QQS to'lovchisi: ${cv ? "ha" : "yo'q"})`,
    !!supId && !!M1 && !!M2 && !!brId && bal(M1) === 0 && bal(M2) === 0, { supId, M1, M2, brId, last: r.result ?? r.status });
  if (!supId || !M1 || !M2 || !brId) throw new Error("tayyorlov bajarilmadi");

  // ───────── 1. «Кому» — oluvchilar ro'yxati ─────────
  console.log("\n1. «Кому»: oluvchilar ro'yxati (Расход sahifasidagi «Получатели»)");
  r = await saveRec(sklad, { name: `  QA SJ   Шофёры ${T} `, note: "водители миксеров" });
  const rec1 = recOf(R1n);
  R1 = rec1?.id ?? "";
  check("1.1 sklad oluvchi qo'shdi — «Oluvchi qo'shildi», nomdagi ortiqcha bo'shliqlar olib tashlandi, faol, audit CREATE",
    r.result?.ok === true && r.result.note === "Oluvchi qo'shildi" && rec1?.active === true && rec1.note === "водители миксеров" && recAudits(R1, "CREATE") === 1, [r.result ?? r.status, rec1]);
  r = await saveRec(sklad, { name: `qa sj шофёры ${T.toUpperCase()}` });
  check("1.2 takror nom (boshqa registr) — «allaqachon bor» xatosi, ikkinchi yozuv yo'q",
    /^«.+» oluvchisi allaqachon bor/.test(r.result?.error ?? "") && n(`select id from "StockRecipient" where lower(name)=lower(${lit(R1n)})`) === 1, r.result ?? r.status);
  r = await saveRec(snab, { id: R1, name: R1n, note: "водители" });
  check("1.3 snabjeniye (Расход huquqi bor) izohni tahrirladi — «Saqlandi», audit UPDATE",
    r.result?.ok === true && r.result.note === "Saqlandi" && recOf(R1n)?.note === "водители" && recAudits(R1, "UPDATE") === 1, r.result ?? r.status);
  r = await saveRec(sklad, { name: R2n });
  R2 = recOf(R2n)?.id ?? "";
  const t1 = await toggleRec(sklad, R2, false);
  const t2 = await toggleRec(sklad, R2, false);
  check("1.4 ikkinchi oluvchi nofaol qilindi (o'chirilmadi) — «yashirildi», audit STATUS_CHANGE bitta (qayta bosish o'zgartirmaydi)",
    !!R2 && t1.result?.ok === true && /«Kimga» ro'yxatidan yashirildi/.test(t1.result.note ?? "") && t2.result?.ok === true
    && recOf(R2n)?.active === false && recAudits(R2, "STATUS_CHANGE") === 1, [t1.result ?? t1.status, t2.result ?? t2.status]);
  r = await saveRec(sklad, { name: R2n.toUpperCase() });
  check("1.5 nofaol oluvchi nomini qayta qo'shish — «allaqachon bor (nofaol — … yoqing)»", /allaqachon bor \(nofaol/.test(r.result?.error ?? ""), r.result ?? r.status);
  const forbiddenName = `QA SJ Чужой ${T}`;
  const s1 = await saveRec(sotuv, { name: forbiddenName });
  const s2 = await toggleRec(sotuv, R1, false);
  check("1.6 sotuvchi oluvchi qo'sha ham, yashira ham olmaydi (403), hech narsa o'zgarmadi",
    denied(s1) && denied(s2) && !recOf(forbiddenName) && recOf(R1n)?.active === true, [s1.status, s2.status]);
  let pg = await sklad.get(RX_PAGE);
  check("1.7 /stock/rasxod (sklad): «Oluvchilar (Kimga)» bo'limi, ikkala oluvchi (nofaoli ham) ko'rinadi",
    pg.status === 200 && pg.text.includes("Oluvchilar (Kimga)") && pg.text.includes(R1n) && pg.text.includes(R2n), pg.status);
  pg = await sklad.get(RX_NEW);
  check("1.8 /stock/rasxod/new: «Кому» ro'yxatida faol oluvchi va brigada bor, nofaoli yo'q",
    pg.status === 200 && pg.text.includes(R1n) && pg.text.includes(brName) && !pg.text.includes(R2n), pg.status);
  pg = await sotuv.get(RX_PAGE);
  check("1.9 sotuvchiga «Расход» jurnali ochilmaydi (narx va summalar) — /stock ga yo'naltiriladi, «Oluvchilar» ko'rinmaydi",
    [303, 307, 308].includes(pg.status) && /\/stock(?:$|[?#])/.test(pg.location ?? "") && !pg.text.includes("Oluvchilar (Kimga)") && !pg.text.includes(R1n),
    `${pg.status} ${pg.location ?? ""}`);

  // ───────── 2. «Приход» ─────────
  console.log("\n2. «Приход»: kirim (П-р / Н-к), dostavka, QQS, takror yuborish, jurnal, yetkazuvchi qarzi");
  // Korxona QQS to'lovchisi: tannarx QQS'siz; aks holda QQS birlikka bo'lib qo'shiladi. Dostavka ikkalasida ham + dc / qty.
  const u1 = cv ? 1000 + 50 : 1000 + 120 + 50, u2 = cv ? 2500 : 2800;
  const tokA = crypto.randomUUID();
  const formA: PxOpts = {
    token: tokA, payment: "BANK", waybillNo: TTN, recipientId: R1, address: ADDR, buyerId: uSnab.id, purpose: PURP, cashAccountId: bankAcc ?? "",
    lines: [{ m: M1, qty: "100", price: "1 000", delivery: "5 000", vat: "12" }, { m: M2, qty: "40", price: "2500", delivery: "", vat: "12" }],
  };
  r = await prixod(sklad, formA);
  docA = savedOf(r);
  const recA = recBy(`"clientToken"=${lit(tokA)}`);
  check("2.1 sklad П-р kirim saqladi → /stock/prixod?…&saved=<docNo>",
    !!docA && /^\/stock\/prixod\?/.test(r.redirect ?? "") && recA?.docNo === docA, [r.redirect, r.result ?? r.status]);
  check("2.2 GoodsReceipt yangi maydonlari: ТТН, Деньги=BANK, Кому, Адрес, Снабженец, Почему (+ yetkazuvchi, sklad, kiritgan)",
    recA?.waybillNo === TTN && recA.payment === "BANK" && recA.recipientId === R1 && recA.address === ADDR && recA.buyerId === uSnab.id
    && recA.purpose === PURP && recA.supplierId === supId && recA.warehouseId === wh.id && recA.createdById === uSklad.id && (recA.note ?? "").includes(`Nakladnoy № ${TTN}`), recA);
  const itA = recA ? itemsOf(recA.id) : [];
  const a1 = itA.find((x) => x.m === M1), a2 = itA.find((x) => x.m === M2);
  check("2.3 qatorlar: «1 000» → 1000, Доставка 5 000 (faqat 1-qatorda), НДС 12% tovarga (12 000 / 12 000)",
    itA.length === 2 && near(a1?.qty, 100) && eq2(a1?.price, 1000) && a1?.rate === 12 && eq2(a1?.vat, 12000) && eq2(a1?.dc, 5000)
    && near(a2?.qty, 40) && eq2(a2?.price, 2500) && a2?.rate === 12 && eq2(a2?.vat, 12000) && eq2(a2?.dc, 0), itA);
  const mvA = recA ? movesWhere(`"refType"='GoodsReceipt' and "refId"=${lit(recA.id)}`) : [];
  const ma1 = mvA.find((x) => x.m === M1), ma2 = mvA.find((x) => x.m === M2);
  check(`2.4 StockMove RECEIPT: tannarx = narx${cv ? "" : " + QQS/qty"} + dostavka/qty → ${u1} va ${u2}`,
    mvA.length === 2 && mvA.every((x) => x.type === "RECEIPT" && x.wh === wh.id) && near(ma1?.qty, 100) && eq2(ma1?.cost, u1) && near(ma2?.qty, 40) && eq2(ma2?.cost, u2), mvA);
  check("2.5 audit CREATE GoodsReceipt; sklad tanlagan hisob e'tiborsiz — kassadan chiqim yozilmadi",
    !!recA && n(`select id from "AuditLog" where entity='GoodsReceipt' and "entityId"=${lit(recA.id)} and action='CREATE'`) === 1
    && n(`select id from "CashTransaction" where "refType"='GoodsReceipt' and "refId"=${lit(recA.id)}`) === 0);
  r = await prixod(sklad, formA);
  check("2.6 o'sha clientToken bilan qayta yuborish — o'sha kirim, ikkinchisi ochilmadi, harakatlar 2 ta",
    savedOf(r) === docA && n(`select id from "GoodsReceipt" where "clientToken"=${lit(tokA)}`) === 1
    && n(`select id from "StockMove" where "refType"='GoodsReceipt' and "refId"=${lit(recA?.id ?? "-")}`) === 2, [r.redirect, r.result]);

  const tokB = crypto.randomUUID();
  r = await prixod(sklad, { token: tokB, date: yesterday, payment: "CASH", waybillNo: TTN_B, lines: [{ m: M1, qty: "50", price: "1100", vat: "12" }] });
  docB = savedOf(r);
  const recB = recBy(`"clientToken"=${lit(tokB)}`);
  const itB = recB ? itemsOf(recB.id) : [];
  const mvB = recB ? movesWhere(`"refType"='GoodsReceipt' and "refId"=${lit(recB.id)}`) : [];
  check("2.7 Н-к kirim (kecha): Деньги=CASH, stavka 12 yuborilsa ham QQS 0, tannarx 1100",
    !!docB && recB?.payment === "CASH" && itB.length === 1 && itB[0].rate === 0 && eq2(itB[0].vat, 0) && mvB.length === 1 && eq2(mvB[0].cost, 1100), [r.redirect, r.result, itB, mvB]);
  const tokC = crypto.randomUUID();
  r = await prixod(snab, { token: tokC, payment: "CASH", lines: [{ m: M2, qty: "10", price: "2600", vat: "12" }] });
  docC = savedOf(r);
  const recC = recBy(`"clientToken"=${lit(tokC)}`);
  const itC = recC ? itemsOf(recC.id) : [];
  check("2.8 snabjeniye ham Приход qiladi: Н-к, QQS 0, Снабженец tanlanmagan (null)",
    !!docC && recC?.createdById === uSnab.id && recC.buyerId === null && recC.payment === "CASH" && itC.length === 1 && itC[0].rate === 0 && eq2(itC[0].vat, 0), [r.redirect, r.result, recC]);

  // Xatolar — o'zbekcha (ruschasi «Рус» rejimida lug'atdan), hech narsa yozilmaydi
  const recCount = () => n(`select id from "GoodsReceipt" where "supplierId"=${lit(supId)}`);
  const c0 = recCount();
  const e1 = await prixod(sklad, { payment: "", lines: [{ m: M1, qty: "1", price: "1" }] });
  const e2 = await prixod(sklad, { lines: [{ m: M1, qty: "1", price: "1", delivery: "-100" }] });
  const e3 = await prixod(sklad, { recipientId: R2, lines: [{ m: M1, qty: "1", price: "1" }] });
  const e4 = await prixod(sklad, { lines: [{ m: M1, qty: "0", price: "1" }] });
  check("2.9 o'zbekcha xatolar: «To'lov turi» tanlanmagan, manfiy dostavka, nofaol «Kimga», miqdor 0",
    /To'lov turini tanlang/.test(e1.result?.error ?? "") && /yetkazib berish summasi/.test(e2.result?.error ?? "") && /Oluvchi/.test(e3.result?.error ?? "") && /Miqdor/.test(e4.result?.error ?? "")
    && [e1, e2, e3, e4].every((e) => !!e.result?.error && !cyr(e.result.error)), [e1.result, e2.result, e3.result, e4.result]);
  if (bankAcc) {
    const e5 = await prixod(dir, { payment: "CASH", cashAccountId: bankAcc, lines: [{ m: M1, qty: "1", price: "1" }] });
    check("2.10 direktor: naqd kirimni bank hisobidan to'lab bo'lmaydi — «Naqd pul kirimi — faqat naqd kassadan to'lanadi»", /Naqd pul kirimi — faqat naqd kassadan/.test(e5.result?.error ?? ""), e5.result ?? e5.status);
  }
  const tokS = crypto.randomUUID();
  const e6 = await prixod(sotuv, { token: tokS, lines: [{ m: M1, qty: "1", price: "1" }] });
  check("2.11 sotuvchi Приход qila olmaydi (403); xato urinishlardan keyin yangi kirim yo'q",
    denied(e6) && n(`select id from "GoodsReceipt" where "clientToken"=${lit(tokS)}`) === 0 && recCount() === c0 && c0 === 3, [e6.status, c0, recCount()]);

  // Jurnal: kecha..bugun, faqat shu yetkazuvchi (qidiruv Наименование / От Кого bo'yicha)
  const px = await prixodJournal({ from: dayAt(yesterday), to: dayAt(tomorrow), q: supName });
  const pA1 = px.find((x) => x.receiptId === recA?.id && x.materialId === M1), pA2 = px.find((x) => x.receiptId === recA?.id && x.materialId === M2);
  const pB = px.find((x) => x.receiptId === recB?.id), pC = px.find((x) => x.receiptId === recC?.id);
  check("2.12 prixodJournal: 4 qator, sana bo'yicha (kechagi Н-к birinchi)", px.length === 4 && px[0].receiptId === recB?.id, px.map((x) => [x.docNo, x.material]));
  check("2.13 П-р qatori: Общие = 100×1000 + 5000 = 105 000, НДС 12 000, Итого 117 000, ТТН, Кому, Адрес, Снабженец, Почему",
    !!pA1 && pA1.payment === "BANK" && eq2(pA1.delivery, 5000) && eq2(pA1.price, 1000) && pA1.vatRate === 12 && eq2(pA1.sum, 105000) && eq2(pA1.vat, 12000)
    && eq2(pA1.total, 117000) && pA1.waybillNo === TTN && pA1.recipient === R1n && pA1.supplier === supName && pA1.address === ADDR
    && pA1.buyer === uSnab.name && pA1.purpose === PURP && pA1.unit === "kg" && pA1.docNo === docA, pA1);
  check("2.14 ikkinchi П-р qatori dostavkasiz: Общие 100 000, Итого 112 000",
    !!pA2 && eq2(pA2.delivery, 0) && eq2(pA2.sum, 100000) && eq2(pA2.vat, 12000) && eq2(pA2.total, 112000), pA2);
  check("2.15 Н-к qatorlari: Деньги=CASH, НДС 0; «Кому» bo'sh — sklad nomi; Снабженец bo'sh — kiritgan xodim",
    pB?.payment === "CASH" && eq2(pB.vat, 0) && eq2(pB.total, 55000) && pB.recipient === wh.name && pB.buyer === uSklad.name && pB.waybillNo === TTN_B
    && pC?.payment === "CASH" && eq2(pC.vat, 0) && eq2(pC.total, 26000) && pC.buyer === uSnab.name, [pB, pC]);
  const pt = prixodTotals(px);
  check("2.16 prixodTotals: 4 qator, Доставка 5 000, Общие 286 000, НДС 24 000, Итого 310 000",
    pt.rows === 4 && eq2(pt.delivery, 5000) && eq2(pt.sum, 286000) && eq2(pt.vat, 24000) && eq2(pt.total, 310000), pt);
  pg = await sklad.get(`/stock/prixod?from=${yesterday}&to=${today}`);
  // Sahifa matni o'zbekcha (ruschasi — «Рус» rejimida lug'atdan); apostrofli so'zlar HTML'da &#x27; — ular tekshirilmaydi
  check("2.17 /stock/prixod (davr bilan) 200: Excel ustunlari (Tovar, TTN №, Dostavka, Summa (QQSsiz), Jami (QQS bilan), Snabjenets, Izoh, Mashina, Qayerdan yuklandi, Darhol kimga berildi), hujjatlar, Bank o'tkazma / Naqd pul, summalar, Kimga, Manzil, Maqsad (Izoh ichida)",
    pg.status === 200 && ["Tovar", "TTN №", "Miqdor", "Kimga", "Dostavka", "Summa (QQSsiz)", "QQS 12%", "Jami (QQS bilan)", "Manzil", "Snabjenets", "Izoh", "Mashina (kim olib keldi)", "Qayerdan yuklandi", "Darhol kimga berildi", "Maqsad:",
      docA, docB, docC, TTN, TTN_B, "Bank o", "Naqd pul", "105 000", "117 000", "112 000", R1n, ADDR, PURP, supName, M1n, M2n, uSnab.name].every((s) => pg.text.includes(s)), pg.status);
  pg = await sklad.get(`/stock/prixod?from=${yesterday}&to=${today}&q=${encodeURIComponent(supName)}&saved=${encodeURIComponent(docA)}`);
  check("2.18 qidiruv (Kimdan) bo'yicha «Jami»: 286 000 / 24 000 / 310 000; «Kirim saqlandi» xabari",
    pg.status === 200 && ["286 000", "24 000", "310 000", "Kirim saqlandi"].every((s) => pg.text.includes(s)), pg.status);
  // Jurnalda xarid narxlari va yetkazuvchilar — sotuvchiga ochilmaydi (lib/stock-journal-access canSeePrixod) → /stock
  pg = await sotuv.get(`/stock/prixod?from=${yesterday}&to=${today}`);
  check("2.19 sotuvchiga «Приход» jurnali ochilmaydi — /stock ga yo'naltiriladi, hujjatlar ko'rinmaydi",
    [303, 307, 308].includes(pg.status) && /\/stock(?:$|[?#])/.test(pg.location ?? "") && !pg.text.includes(docA), `${pg.status} ${pg.location ?? ""}`);
  const led = await supplierLedger(supId);
  check("2.20 yetkazuvchi qarzi dostavka va QQS bilan: 229 000 + 55 000 + 26 000 = 310 000 (to'lanmagan)",
    eq2(led.received, 310000) && eq2(led.debt, 310000) && led.unpaid.length === 3, { received: led.received, debt: led.debt, unpaid: led.unpaid.length });
  const terms = await lastReceiptTerms([M1, M2]);
  const termsBefore = await lastReceiptTerms([M1, M2], dayAt(today));
  check("2.21 lastReceiptTerms: M1 — oxirgi П-р (12%), M2 — oxirgi Н-к (0%); bugundan oldin: M1 — kechagi Н-к, M2 — yo'q",
    terms.get(M1)?.payment === "BANK" && terms.get(M1)?.vatRate === 12 && terms.get(M1)?.receiptId === recA?.id
    && terms.get(M2)?.payment === "CASH" && terms.get(M2)?.vatRate === 0 && terms.get(M2)?.receiptId === recC?.id
    && termsBefore.get(M1)?.receiptId === recB?.id && termsBefore.get(M1)?.payment === "CASH" && !termsBefore.has(M2),
    { M1: terms.get(M1), M2: terms.get(M2), before: Object.fromEntries(termsBefore) });

  // Storno: asl qator o'z sanasida qoladi (cancelled), storno paytida — manfiy qator. Bugun kirim + storno → M2 bo'yicha
  // keyingi qiymatlar (qoldiq, o'rtacha tannarx, «Остатки» Приход 50) o'zgarmaydi: +5 va −5 bir xil tannarxda.
  const tokD = crypto.randomUUID();
  r = await prixod(sklad, { token: tokD, payment: "CASH", lines: [{ m: M2, qty: "5", price: "3000", vat: "12" }] });
  const docD = savedOf(r);
  const recD = recBy(`"clientToken"=${lit(tokD)}`);
  const st = recD ? await dir.action("receipts/actions#stornoReceipt", [recD.id, `QA sklad-journals storno ${T}`], `/receipts/${recD.id}`) : null;
  const pxT = await prixodJournal({ from: dayAt(today), to: dayAt(tomorrow), q: supName });
  const pxD = pxT.filter((x) => x.receiptId === recD?.id);
  const dO = pxD.find((x) => !x.storno), dS = pxD.find((x) => x.storno);
  check("2.22 storno qilingan kirim: asl qator o'z sanasida (cancelled, +5 / 15 000), storno qatori manfiy (−5 / −15 000), yig'indi 0",
    !!docD && st?.result?.ok === true && pxD.length === 2 && dO?.cancelled === true && near(dO.qty, 5) && eq2(dO.total, 15000)
    && dS?.storno === true && !dS.cancelled && near(dS.qty, -5) && eq2(dS.sum, -15000) && eq2(dS.vat, 0) && eq2(dS.total, -15000)
    && dS.docNo === docD && dS.id !== dO.id && pxT.indexOf(dS) > pxT.indexOf(dO) && eq2(prixodTotals(pxD).total, 0),
    [r.redirect, st?.result ?? st?.status, pxD]);
  const tD = (await materialTurnover({ from: dayAt(today), to: dayAt(tomorrow) })).find((x) => x.id === M2);
  const pxM2 = pxT.filter((x) => x.materialId === M2).reduce((a, x) => a + x.qty, 0);
  check("2.23 «Остатки» Приход (M2, bugun) = Приход jurnali Σ К-во storno bilan: 40 + 10 + 5 − 5 = 50",
    !!tD && near(tD.in.q, 50) && near(pxM2, 50) && near(bal(M2), 50), { in: tD?.in, pxM2, bal: bal(M2) });
  pg = await sklad.get(`/stock/prixod?from=${today}&to=${today}&q=${encodeURIComponent(supName)}`);
  check("2.24 /stock/prixod: storno qilingan qator ustidan chizilgan («storno» belgisi), «Storno <docNo>» qatori minus bilan",
    pg.status === 200 && pg.text.includes(`Storno ${docD}`) && pg.text.includes("line-through") && pg.text.includes(">storno<") && pg.text.includes("-15 000"), pg.status);

  // ───────── 3. «Дона сўм» ─────────
  console.log("\n3. «Дона сўм»: narxni faqat snabjeniye belgilaydi");
  r = await setPrice(sklad, M1, "1 200");
  check("3.1 sklad (price huquqi yo'q) narx qo'ya olmaydi — 403, narx yo'q", r.status === 403 && priceOf(M1)?.p === null && priceAudits(M1).length === 0, r.status);
  r = await setPrice(snab, M1, "1 200");
  const pa1 = priceAudits(M1);
  check("3.2 snabjeniye «1 200» → 1200: «Narx saqlandi», kim/qachon yozildi, audit {unitPrice: null} → {unitPrice: 1200}",
    r.result?.ok === true && /^Narx saqlandi/.test(r.result.note ?? "") && priceOf(M1)?.p === 1200 && priceOf(M1)?.by === uSnab.id && priceOf(M1)?.at === true
    && pa1.length === 1 && pa1[0].before?.unitPrice === null && Number(pa1[0].after?.unitPrice) === 1200 && pa1[0].u === uSnab.id, [r.result ?? r.status, pa1]);
  r = await setPrice(snab, M1, "1200");
  check("3.3 o'sha narx qayta — «O'zgarish yo'q», audit qo'shilmadi", r.result?.ok === true && r.result.note === "O'zgarish yo'q" && priceAudits(M1).length === 1, r.result ?? r.status);
  const ep1 = await setPrice(snab, M1, "-5"), ep2 = await setPrice(snab, M1, "abc");
  check("3.4 manfiy / raqam emas — «Narx noto'g'ri», narx o'zgarmadi",
    /Narx noto'g'ri/.test(ep1.result?.error ?? "") && /Narx noto'g'ri/.test(ep2.result?.error ?? "") && priceOf(M1)?.p === 1200, [ep1.result, ep2.result]);
  r = await setPrice(sotuv, M2, "999");
  check("3.5 sotuvchi ham qo'ya olmaydi (403)", r.status === 403 && priceOf(M2)?.p === null, r.status);

  // ───────── 4. «Расход» ─────────
  console.log("\n4. «Расход»: oluvchiga va brigadaga berish, qoldiq nazorati, jurnal");
  const avg2 = r2((40 * u2 + 10 * 2600) / 50); // M2 narxsiz — o'rtacha tannarx (kirimlar miqdorga tortilgan)
  const tokR = crypto.randomUUID();
  const formR = { to: `r:${R1}`, rows: [[M1, "30"], [M2, "5"], [M1, "10"]] as [string, string][], token: tokR, note: RNOTE };
  r = await rasxod(sklad, formR);
  const mvR = movesWhere(`type='ISSUE' and "refType"='Issue' and "recipientId"=${lit(R1)} and "materialId" in (${lit(M1)}, ${lit(M2)})`);
  const ri1 = mvR.find((x) => x.m === M1), ri2 = mvR.find((x) => x.m === M2);
  const refR = ri1?.ref ?? "-";
  check("4.1 sklad oluvchiga berdi → /stock/rasxod?saved=2 (M1 ikki qatorda — bitta harakat)",
    /^\/stock\/rasxod\?saved=2\b/.test(r.redirect ?? "") && mvR.length === 2, [r.redirect, r.result ?? r.status, mvR]);
  check("4.2 StockMove ISSUE: qty manfiy, recipientId, unitCost = «Дона сўм» (1200); narxsiz M2 — o'rtacha tannarx; bitta hujjat (refType Issue)",
    near(ri1?.qty, -40) && eq2(ri1?.cost, 1200) && near(ri2?.qty, -5) && eq2(ri2?.cost, avg2) && mvR.every((x) => x.rt === "Issue" && x.ref === refR && x.wh === wh.id && x.note === RNOTE),
    { mvR, avg2 });
  check("4.3 audit: StockMove, entityId = hujjat, after.via = rasxod", n(`select id from "AuditLog" where entity='StockMove' and "entityId"=${lit(refR)} and action='CREATE' and after->>'via'='rasxod'`) === 1);
  check("4.4 qoldiq: M1 100 + 50 − 40 = 110, M2 50 − 5 = 45", near(bal(M1), 110) && near(bal(M2), 45), [bal(M1), bal(M2)]);
  r = await rasxod(sklad, formR);
  check("4.5 o'sha clientToken bilan qayta — yangi harakat yo'q, qoldiq o'zgarmadi",
    /saved=2\b/.test(r.redirect ?? "") && n(`select id from "StockMove" where "refType"='Issue' and "refId"=${lit(refR)}`) === 2 && near(bal(M1), 110), [r.redirect, r.result]);
  const tokBr = crypto.randomUUID();
  r = await rasxod(sklad, { to: `b:${brId}`, rows: [[M1, "15"]], token: tokBr });
  const mvBr = movesWhere(`type='BRIGADE_ISSUE' and "brigadeId"=${lit(brId)}`);
  const bm = q(`select type, qty::float8 as qty, "unitCost"::float8 as cost from "BrigadeMove" where "brigadeId"=${lit(brId)} and "materialId"=${lit(M1)}`) as { type: string; qty: number; cost: number | null }[];
  check("4.6 brigadaga: StockMove BRIGADE_ISSUE (−15, 1200, refType Issue) + BrigadeMove ISSUE (+15) — brigada qoldig'i 15",
    /saved=1\b/.test(r.redirect ?? "") && mvBr.length === 1 && near(mvBr[0].qty, -15) && eq2(mvBr[0].cost, 1200) && mvBr[0].rt === "Issue"
    && bm.length === 1 && bm[0].type === "ISSUE" && near(bm[0].qty, 15) && eq2(bm[0].cost, 1200) && near(bal(M1), 95), [r.redirect, r.result, mvBr, bm]);
  const issueCount = () => n(`select id from "StockMove" where "materialId" in (${lit(M1)}, ${lit(M2)}) and type in ('ISSUE', 'BRIGADE_ISSUE')`);
  const ic0 = issueCount();
  r = await rasxod(sklad, { to: `r:${R1}`, rows: [[M1, "10"], [M2, "1000"]] });
  check("4.7 qoldiqdan oshsa — «skladida yetarli emas» (qaysi xomashyo, bor/kerak), M1 ham yozilmadi",
    /^«.+» skladida yetarli emas: /.test(r.result?.error ?? "") && (r.result?.error ?? "").includes(M2n) && (r.result?.error ?? "").includes("kerak 1 000 kg")
    && issueCount() === ic0 && near(bal(M1), 95) && near(bal(M2), 45), r.result ?? r.status);
  const x1 = await rasxod(sklad, { to: `r:${R2}`, rows: [[M1, "1"]] });
  const x2 = await rasxod(sklad, { to: `r:${R1}`, rows: [[M1, "1"]], date: tomorrow });
  const x3 = await rasxod(sklad, { to: `r:${R1}`, rows: [[M1, "1"]], date: old40 });
  const x4 = await rasxod(sklad, { to: `r:${R1}`, rows: [[M1, "0"]] });
  const x5 = await rasxod(sklad, { to: "", rows: [[M1, "1"]] });
  check("4.8 nofaol oluvchi, ertangi / 40 kun oldingi sana, miqdor 0, «Kimga» tanlanmagan — o'zbekcha xato, hech narsa yozilmadi",
    /Oluvchi topilmadi yoki nofaol/.test(x1.result?.error ?? "") && /kelajakda/.test(x2.result?.error ?? "") && /kundan eski/.test(x3.result?.error ?? "")
    && /0 dan katta/.test(x4.result?.error ?? "") && /Kimga/.test(x5.result?.error ?? "") && issueCount() === ic0,
    [x1.result, x2.result, x3.result, x4.result, x5.result]);
  r = await rasxod(sotuv, { to: `r:${R1}`, rows: [[M1, "1"]] });
  check("4.9 sotuvchi Расход qila olmaydi (403), qoldiq o'zgarmadi", denied(r) && issueCount() === ic0 && near(bal(M1), 95), r.status);

  const rxFrom = dayAt(today), rxTo = dayAt(tomorrow);
  const rx = await rasxodJournal({ from: rxFrom, to: rxTo });
  const mine = rx.filter((x) => x.materialId === M1 || x.materialId === M2);
  const j1 = mine.find((x) => x.kind === "issue" && x.materialId === M1), j2 = mine.find((x) => x.kind === "issue" && x.materialId === M2);
  const jb = mine.find((x) => x.kind === "brigade");
  // НДС — faqat korxona QQS to'lovchisi bo'lsa (12% oxirgi kirimdan); to'lovchi emas — 0 (narx QQS ichida). Teskarisi — R.1
  const vr = cv ? 0.12 : 0;
  check(`4.10 rasxodJournal: oluvchi qatori — Кому, От Кого (sklad), Цена 1200, Общие 48 000, Деньги П-р va НДС ${cv ? "12% (oxirgi kirimdan)" : "0 (to'lovchi emas)"} → Итого ${48000 * (1 + vr)}`,
    mine.length === 3 && !!j1 && near(j1.qty, 40) && j1.to === R1n && j1.from === wh.name && eq2(j1.price, 1200) && eq2(j1.sum, 48000) && j1.payment === "BANK"
    && eq2(j1.vat, 48000 * vr) && eq2(j1.total, 48000 * (1 + vr)) && j1.priceApprox === false && eq2(j1.delivery, 0) && j1.toKey === `r:${R1}` && j1.note === RNOTE
    && j1.ref === refR && !j1.cancelled, j1 ?? mine);
  check(`4.11 M2 qatori: oxirgi kirim Н-к → Деньги CASH, НДС 0; brigada qatori: Кому = brigada, 18 000 + НДС ${18000 * vr}`,
    !!j2 && near(j2.qty, 5) && eq2(j2.price, avg2) && eq2(j2.sum, 5 * avg2) && j2.payment === "CASH" && eq2(j2.vat, 0) && eq2(j2.total, 5 * avg2)
    && !!jb && near(jb.qty, 15) && jb.to === brName && eq2(jb.sum, 18000) && eq2(jb.vat, 18000 * vr) && jb.payment === "BANK" && jb.toKey === `b:${brId}` && !jb.auto, [j2, jb]);
  const rt = rasxodTotals(mine);
  check(`4.12 rasxodTotals: 3 qator, Сумма = 48 000 + M2 + 18 000, НДС ${66000 * vr}`,
    rt.count === 3 && eq2(rt.sum, 66000 + 5 * avg2) && eq2(rt.vat, 66000 * vr) && eq2(rt.total, 66000 * (1 + vr) + 5 * avg2), rt);
  const fr = await rasxodJournal({ from: rxFrom, to: rxTo, to_: `r:${R1}` });
  const fb = await rasxodJournal({ from: rxFrom, to: rxTo, to_: `b:${brId}` });
  check("4.13 «Кому» filtri: r:<oluvchi> — faqat shu oluvchi, b:<brigada> — faqat shu brigada",
    fr.length === 2 && fr.every((x) => x.kind === "issue" && x.toKey === `r:${R1}`) && fb.length === 1 && fb[0].kind === "brigade" && fb[0].toKey === `b:${brId}`, [fr.length, fb.length]);
  pg = await sklad.get(`/stock/rasxod?from=${today}&to=${today}`);
  check(`4.14 /stock/rasxod (davr bilan) 200: o'zbekcha ustunlar, Kimga (oluvchi va brigada), bank / naqd, Итого ${cv ? "53 760" : "48 000"}; sklad — «Сторно» tugmasi yo'q`,
    pg.status === 200 && ["Sana", "Nomi", "Birlik", "Kimdan", "Kimga", "Yetkazib berish", "Narx", "Umumiy summa", "QQS", "Jami summa",
      R1n, brName, M1n, M2n, cv ? "53 760" : "48 000", "48 000", "Bank o", "Naqd pul"].every((s) => pg.text.includes(s)) && !pg.text.includes(STORNO_BTN), pg.status);

  // Zames: kun + xomashyo + sklad bo'yicha bitta (ko'k) qator, storno ayiriladi — test bazasida zames bo'lsa
  const lastProd = q1(`select date from "StockMove" where type='PRODUCTION_CONSUME' and "materialId" is not null order by date desc limit 1`)?.date as string | undefined;
  if (!lastProd) console.log("  --   4.15 test bazasida zames (PRODUCTION_CONSUME) yo'q — guruh qatori tekshirilmadi");
  else {
    const d = ymd(utc(lastProd));
    const pFrom = dayAt(d), pTo = plusDays(pFrom, 1);
    const prod = await rasxodJournal({ from: pFrom, to: pTo, to_: "prod" });
    const keys = prod.map((x) => `${ymd(x.date)}|${x.materialId}|${x.warehouseId}`);
    const groups = q(`select "materialId" as m, "warehouseId" as w, sum(qty)::float8 as s from "StockMove" where type='PRODUCTION_CONSUME' and "materialId" is not null
      and date >= ${tsLit(pFrom)} and date < ${tsLit(pTo)} group by 1, 2`) as { m: string; w: string; s: number }[];
    const live = groups.filter((g) => Math.abs(g.s) > 0.0005);
    const sumRows = prod.reduce((a, x) => a + x.qty, 0), sumSql = -groups.reduce((a, g) => a + g.s, 0);
    check(`4.15 zames (${d}): xomashyo+sklad bo'yicha bitta qator «Ishlab chiqarish (zames)», К-во = Σ sarf (storno ayirilgan)`,
      prod.length > 0 && prod.length === live.length && new Set(keys).size === keys.length && prod.every((x) => x.kind === "prod" && x.to === "Ishlab chiqarish (zames)" && x.toKey === "prod")
      && Math.abs(sumRows - sumSql) < 0.001 * (prod.length + 1), { rows: prod.length, groups: live.length, sumRows, sumSql });
    pg = await sklad.get(`/stock/rasxod?from=${d}&to=${d}&komu=prod`);
    // «Кому» filtrida ham shu matnli variant bor — jadval qatori (title'siz <span>) bo'yicha tekshiriladi
    check("4.16 /stock/rasxod?komu=prod — zames qatorlari ko'rinadi", pg.status === 200 && pg.text.includes("<span>Ishlab chiqarish (zames)</span>"), pg.status);
  }

  // ───────── 5. Narx o'zgargach ─────────
  console.log("\n5. «Дона сўм» o'zgardi: keyingi chiqimlar yangi narxda, eskilari o'zgarmaydi");
  r = await setPrice(snab, M1, "1300");
  const pa2 = priceAudits(M1);
  check("5.1 snabjeniye narxni 1300 qildi — audit {1200} → {1300}",
    r.result?.ok === true && priceOf(M1)?.p === 1300 && pa2.length === 2 && Number(pa2[1].before?.unitPrice) === 1200 && Number(pa2[1].after?.unitPrice) === 1300, [r.result ?? r.status, pa2]);
  r = await writeOff(sklad, [{ materialId: M1, qty: 2 }]);
  const wo = movesWhere(`type='WRITE_OFF' and "materialId"=${lit(M1)}`);
  check("5.2 spisanie (2 kg) — unitCost = yangi narx 1300", r.result?.ok === true && wo.length === 1 && near(wo[0].qty, -2) && eq2(wo[0].cost, 1300), [r.result ?? r.status, wo]);
  r = await sklad.action("stock/brigade-actions#distributeToBrigade", [undefined, fd({ warehouseId: wh.id, note: `QA sklad-journals ${T}`, rows: JSON.stringify([{ materialId: M1, qty: 3, brigadeId: brId }]) })], BRIG);
  const mvBr2 = movesWhere(`type='BRIGADE_ISSUE' and "brigadeId"=${lit(brId)} and "refType"='Brigade'`);
  check("5.3 Sklad → Brigadalar orqali berish (3 kg) — unitCost 1300", r.result?.ok === true && mvBr2.length === 1 && near(mvBr2[0].qty, -3) && eq2(mvBr2[0].cost, 1300), [r.result ?? r.status, mvBr2]);
  const oldR = movesWhere(`"refType"='Issue' and "refId"=${lit(refR)} and "materialId"=${lit(M1)}`)[0];
  const oldB = movesWhere(`type='BRIGADE_ISSUE' and "brigadeId"=${lit(brId)} and "refType"='Issue'`)[0];
  const rx5 = (await rasxodJournal({ from: rxFrom, to: rxTo })).filter((x) => x.materialId === M1);
  const w5 = rx5.find((x) => x.kind === "writeoff"), j5 = rx5.find((x) => x.kind === "issue");
  check("5.4 eski chiqimlar narxi o'zgarmadi (1200); jurnalda: oluvchi — 1200 / 48 000, spisanie «Hisobdan chiqarish: Brak (sifatsiz)» — 1300 / 2 600",
    eq2(oldR?.cost, 1200) && eq2(oldB?.cost, 1200) && eq2(j5?.price, 1200) && eq2(j5?.sum, 48000) && w5?.to === "Hisobdan chiqarish: Brak (sifatsiz)" && eq2(w5.price, 1300) && eq2(w5.sum, 2600),
    { oldR: oldR?.cost, oldB: oldB?.cost, j5, w5 });

  // ───────── 6. «Остатки» ─────────
  console.log("\n6. «Остатки»: Остатка | Приход | Расход | Остатка (davr: bugun)");
  const oFrom = dayAt(today), oTo = dayAt(tomorrow);
  const turn = await materialTurnover({ from: oFrom, to: oTo });
  const t1m = turn.find((x) => x.id === M1), t2m = turn.find((x) => x.id === M2);
  const cost2 = Number(ri2?.cost ?? avg2);
  check(`6.1 M1: boshi 50 / 55 000 (kechagi Н-к), Приход 100 / ${100 * u1}, Расход 60 / 72 500 (40×1200 + 15×1200 + 2×1300 + 3×1300), oxiri 90`,
    !!t1m && near(t1m.open.q, 50) && eq2(t1m.open.s, 55000) && near(t1m.in.q, 100) && eq2(t1m.in.s, 100 * u1) && near(t1m.out.q, 60) && eq2(t1m.out.s, 72500)
    && near(t1m.close.q, 90) && eq2(t1m.close.s, 55000 + 100 * u1 - 72500) && t1m.approx === false && t1m.unitPrice === 1300 && t1m.unit === "kg", t1m);
  check("6.2 M2: boshi 0, Приход 50 (П-р 40 + Н-к 10), Расход 5 (o'rtacha tannarxda), oxiri 45; «Дона сўм» yo'q, o'rtacha tannarx bor",
    !!t2m && near(t2m.open.q, 0) && eq2(t2m.open.s, 0) && near(t2m.in.q, 50) && eq2(t2m.in.s, 40 * u2 + 26000) && near(t2m.out.q, 5) && eq2(t2m.out.s, 5 * cost2)
    && near(t2m.close.q, 45) && eq2(t2m.close.s, 40 * u2 + 26000 - 5 * cost2) && t2m.unitPrice === null && eq2(t2m.avgCost, avg2), t2m);
  const tw = (await materialTurnover({ from: oFrom, to: oTo, warehouseId: wh.id })).find((x) => x.id === M1);
  check("6.3 sklad filtri: M1 qiymatlari o'sha (hamma harakat shu skladda)",
    !!tw && near(tw.open.q, 50) && near(tw.in.q, 100) && near(tw.out.q, 60) && near(tw.close.q, 90) && eq2(tw.close.s, t1m?.close.s), tw);
  if (otherWh) {
    const to2 = (await materialTurnover({ from: oFrom, to: oTo, warehouseId: otherWh })).find((x) => x.id === M1);
    check("6.4 boshqa sklad filtri: M1 bo'yicha hammasi 0", !!to2 && [to2.open.q, to2.in.q, to2.out.q, to2.close.q].every((v) => near(v, 0)), to2);
  }
  // Ayniyat har xomashyo uchun: oxirgi = boshlang'ich + приход − расход; boshi/oxiri = SQL qoldig'i (date < from / date < to)
  const sqlBal = (cond: string) => new Map((q(`select "materialId" as m, sum(qty)::float8 as s from "StockMove" where "materialId" is not null and ${cond} group by 1`) as { m: string; s: number }[]).map((x) => [x.m, x.s]));
  const openSql = sqlBal(`date < ${tsLit(oFrom)}`), closeSql = sqlBal(`date < ${tsLit(oTo)}`);
  const bad = turn.filter((x) => !near(x.open.q, openSql.get(x.id) ?? 0) || !near(x.close.q, closeSql.get(x.id) ?? 0)
    || !near(x.close.q, x.open.q + x.in.q - x.out.q) || Math.abs(x.close.s - (x.open.s + x.in.s - x.out.s)) > 0.015);
  const ids = new Set(turn.map((x) => x.id));
  const missing = [...closeSql].filter(([m, s]) => Math.abs(s) > 0.0005 && !ids.has(m));
  check(`6.5 ${turn.length} ta xomashyo: oxirgi = boshlang'ich + приход − расход (К-во va Сумма), boshi/oxiri SQL qoldig'i bilan teng, qoldig'i bor hech biri tushib qolmagan`,
    turn.length > 0 && bad.length === 0 && missing.length === 0, { bad: bad.slice(0, 3).map((x) => [x.name, x.open, x.in, x.out, x.close]), missing: missing.slice(0, 3) });
  const rx6 = await rasxodJournal({ from: oFrom, to: oTo });
  const px6 = await prixodJournal({ from: oFrom, to: oTo });
  const sumBy = <R extends { materialId: string }>(rows: R[], m: string, f: (x: R) => number) => rows.filter((x) => x.materialId === m).reduce((a, x) => a + f(x), 0);
  check("6.6 «Расход» ustuni = Расход jurnali yig'indisi, «Приход» = Приход jurnali (M1 va M2, К-во va Сумма)",
    !!t1m && !!t2m && near(t1m.out.q, sumBy(rx6, M1, (x) => x.qty)) && Math.abs(t1m.out.s - sumBy(rx6, M1, (x) => x.sum)) < 0.05
    && near(t2m.out.q, sumBy(rx6, M2, (x) => x.qty)) && Math.abs(t2m.out.s - sumBy(rx6, M2, (x) => x.sum)) < 0.05
    && near(t1m.in.q, sumBy(px6, M1, (x) => x.qty)) && near(t2m.in.q, sumBy(px6, M2, (x) => x.qty)),
    { m1: [t1m?.out, sumBy(rx6, M1, (x) => x.qty), sumBy(rx6, M1, (x) => x.sum)], m2: [t2m?.out, sumBy(rx6, M2, (x) => x.qty)] });
  pg = await sklad.get(`/stock?tab=balance&from=${today}&to=${today}`);
  check("6.7 /stock?tab=balance&from&to 200 (sklad): sarlavhalar (Qoldiq, Kirim, Chiqim, Dona narxi, Jami), xomashyo, narx 1 300; sklad narxni tahrirlay olmaydi",
    pg.status === 200 && ["Qoldiq", "Kirim", "Chiqim", "Dona narxi", "Jami", "Nomi", M1n, M2n, "1 300"].every((s) => pg.text.includes(s))
    && !priceEditable(pg.text, M1n), pg.status);
  pg = await snab.get(`/stock?tab=balance&from=${today}&to=${today}`);
  check("6.8 snabjeniye sahifasida «Dona narxi» katagi tahrirlanadi («Narxni o'zgartirish»)", pg.status === 200 && priceEditable(pg.text, M1n), pg.status);
  pg = await sklad.get(`/stock?tab=moves&material=${M1}&from=${today}&to=${today}`);
  check("6.9 /stock?tab=moves&material=<id>&from&to — xomashyo harakatlari 200", pg.status === 200 && pg.text.includes(M1n), pg.status);

  // ───────── R. «Расход»: НДС (to'lovchi emas), brigadadan qaytish narxi, storno ─────────
  console.log("\nR. «Расход»: QQS to'lovchisi emas — НДС 0; brigadadan qaytish berilgan narxda; storno (cancelRasxod)");
  // R.1–R.3: korxona QQS to'lovchisi holati vaqtincha teskarisiga (saveVatPayer), finally'da qaytariladi
  const flip = !cv, vrF = flip ? 0.12 : 0;
  try {
    r = await setCompanyVat(flip ? "1" : "0");
    const jv = (await rasxodJournal({ from: rxFrom, to: rxTo })).find((x) => x.kind === "issue" && x.ref === refR && x.materialId === M1);
    check(`R.1 korxona QQS to'lovchisi${flip ? "" : " emas"} (vaqtincha): oluvchi qatori Общие 48 000, НДС ${48000 * vrF}, Итого ${48000 * (1 + vrF)}${flip ? "" : " — narx QQS ichida, ustiga qo'shilmaydi"}`,
      r.result?.ok === true && vatPayerNow() === flip && !!jv && eq2(jv.sum, 48000) && eq2(jv.vat, 48000 * vrF) && eq2(jv.total, 48000 * (1 + vrF)),
      [r.result ?? r.status, jv]);
    pg = await sklad.get(`/stock/rasxod?from=${today}&to=${today}`);
    check(`R.2 /stock/rasxod: «QQS to'lovchisi emas» izohi ${flip ? "yo'q, Итого 53 760" : "bor"}`,
      pg.status === 200 && pg.text.includes("QQS 0: korxona QQS") === !flip && (!flip || pg.text.includes("53 760")), pg.status);
  } finally {
    r = await setCompanyVat(cv ? "1" : "0");
  }
  check("R.3 QQS to'lovchisi holati qaytarildi", vatPayerNow() === cv, r.result ?? r.status);

  // R.4–R.5: brigada qo'lida 15 kg × 1200 (4.6) + 3 kg × 1300 (5.3) → o'rtacha 1216,67; joriy «Дона сўм» — 1300.
  // Qaytish berilgan narxda (o'rtacha), joriy narxda emas — «Остатки» summasida yo'q qiymat paydo bo'lmasin
  const brHeld = () => Number(q1(`select coalesce(sum(qty), 0)::float8 as b from "BrigadeMove" where "brigadeId"=${lit(brId)} and "materialId"=${lit(M1)}`).b);
  const avgBr = r2((15 * 1200 + 3 * 1300) / 18);
  const b0 = bal(M1);
  r = await returnBr(sklad, M1, "6");
  const rtM = movesWhere(`type='BRIGADE_RETURN' and "brigadeId"=${lit(brId)} and "materialId"=${lit(M1)}`);
  const rtB = q(`select qty::float8 as qty, "unitCost"::float8 as cost from "BrigadeMove" where "brigadeId"=${lit(brId)} and "materialId"=${lit(M1)} and type='RETURN'`) as { qty: number; cost: number | null }[];
  check(`R.4 narx 1300 bo'lgach brigadadan 6 kg qaytdi — StockMove BRIGADE_RETURN va BrigadeMove RETURN berilgan narxda (${avgBr}), 1300 emas`,
    r.result?.ok === true && rtM.length === 1 && near(rtM[0].qty, 6) && eq2(rtM[0].cost, avgBr) && rtB.length === 1 && near(rtB[0].qty, -6) && eq2(rtB[0].cost, avgBr)
    && near(bal(M1), b0 + 6) && near(brHeld(), 12), [r.result ?? r.status, rtM, rtB]);
  const jr = (await rasxodJournal({ from: rxFrom, to: rxTo, to_: `b:${brId}` })).find((x) => x.kind === "return" && x.materialId === M1);
  check(`R.5 jurnalda qaytish — manfiy qator «— qaytarish»: К-во −6, Цена ${avgBr}, Общие ${r2(-6 * avgBr)}`,
    !!jr && near(jr.qty, -6) && eq2(jr.price, avgBr) && eq2(jr.sum, r2(-6 * avgBr)) && jr.to === `${brName} — qaytarish`, jr);

  // R.6–R.11: oluvchiga berilgan Расход stornosi
  const stornoMoves = (ref: string) => movesWhere(`"refType"='IssueStorno' and "refId"=${lit(ref)}`);
  const tokS1 = crypto.randomUUID();
  const bS = bal(M1);
  r = await rasxod(sklad, { to: `r:${R1}`, rows: [[M1, "5"]], token: tokS1 });
  const refS = movesWhere(`"clientToken"=${lit(tokS1)}`)[0]?.ref ?? "";
  check("R.6 storno uchun yangi Расход: oluvchiga 5 kg (narx 1300)", /saved=1\b/.test(r.redirect ?? "") && !!refS && near(bal(M1), bS - 5), [r.redirect, r.result]);
  const WHY = `QA ошибка ввода ${T}`;
  const d1 = await cancelRx(sklad, refS, WHY), d2 = await cancelRx(snab, refS, WHY);
  check("R.7 sklad va snabjeniye storno qila olmaydi (stock → issue_storno: direktor / ruxsat berilgan) — 403, hech narsa yozilmadi",
    denied(d1) && denied(d2) && stornoMoves(refS).length === 0 && near(bal(M1), bS - 5), [d1.status, d2.status]);
  const d3 = await cancelRx(dir, refS, "  ab ");
  check("R.8 sabab 3 belgidan kam — «Storno sababini yozing», hech narsa yozilmadi",
    /Storno sababini yozing/.test(d3.result?.error ?? "") && stornoMoves(refS).length === 0, d3.result ?? d3.status);
  r = await cancelRx(dir, refS, WHY);
  const sm = stornoMoves(refS);
  check("R.9 direktor storno qildi: teskari ISSUE +5 (o'sha narx 1300, oluvchi, sklad), «Storno: <sabab>», qoldiq qaytdi, audit STATUS_CHANGE",
    r.result?.ok === true && /Chiqim bekor qilindi/.test(r.result.note ?? "") && sm.length === 1 && sm[0].type === "ISSUE" && near(sm[0].qty, 5) && eq2(sm[0].cost, 1300)
    && sm[0].rec === R1 && sm[0].wh === wh.id && sm[0].note === `Storno: ${WHY}` && near(bal(M1), bS)
    && n(`select id from "AuditLog" where entity='StockMove' and "entityId"=${lit(refS)} and action='STATUS_CHANGE' and after->>'reason'=${lit(WHY)}`) === 1,
    [r.result ?? r.status, sm]);
  const d4 = await cancelRx(dir, refS, WHY);
  check("R.10 takror storno — «allaqachon bekor qilingan», ikkinchi teskari harakat yo'q",
    /allaqachon bekor qilingan/.test(d4.result?.error ?? "") && stornoMoves(refS).length === 1 && near(bal(M1), bS), d4.result ?? d4.status);
  const rxS = (await rasxodJournal({ from: rxFrom, to: rxTo, to_: `r:${R1}` })).filter((x) => x.ref === refS);
  const so = rxS.find((x) => x.kind === "issue"), sn = rxS.find((x) => x.kind === "storno");
  check("R.11 jurnal: asl qator «bekor qilingan», storno — manfiy qator «Storno: <oluvchi>» −5 / −6 500, Деньги / НДС / Итого asl qatorga teskari",
    rxS.length === 2 && !!so && so.cancelled === true && near(so.qty, 5) && eq2(so.sum, 6500) && !!sn && near(sn.qty, -5) && eq2(sn.price, 1300) && eq2(sn.sum, -6500)
    && eq2(sn.vat, -so.vat) && eq2(sn.total, -so.total) && sn.payment === so.payment && sn.to === `Storno: ${R1n}` && sn.note === `Storno: ${WHY}` && sn.toKey === `r:${R1}`, rxS);

  // R.12–R.13: brigadaga berilgan Расход stornosi — brigada qoldig'i ham qaytadi; brigada sarflagan bo'lsa — rad
  const tokS2 = crypto.randomUUID();
  const bS2 = bal(M1), h0 = brHeld();
  r = await rasxod(sklad, { to: `b:${brId}`, rows: [[M1, "4"]], token: tokS2 });
  const refB = movesWhere(`"clientToken"=${lit(tokS2)}`)[0]?.ref ?? "";
  r = await cancelRx(dir, refB, WHY);
  const smB = stornoMoves(refB);
  const bmS = q(`select b.type, b.qty::float8 as qty, b."unitCost"::float8 as cost from "BrigadeMove" b join "StockMove" s on s.id = b."refId"
    where b."refType"='StockMove' and s."refType"='IssueStorno' and s."refId"=${lit(refB)}`) as { type: string; qty: number; cost: number | null }[];
  check("R.12 brigadaga berilgan Расход stornosi: StockMove BRIGADE_ISSUE +4 va BrigadeMove ISSUE −4 (1300), sklad va brigada qoldig'i qaytdi",
    !!refB && r.result?.ok === true && smB.length === 1 && smB[0].type === "BRIGADE_ISSUE" && near(smB[0].qty, 4) && eq2(smB[0].cost, 1300) && smB[0].br === brId
    && bmS.length === 1 && bmS[0].type === "ISSUE" && near(bmS[0].qty, -4) && eq2(bmS[0].cost, 1300) && near(bal(M1), bS2) && near(brHeld(), h0),
    { res: r.result ?? r.status, smB, bmS, bal: [bal(M1), bS2], held: [brHeld(), h0] });
  const tokS3 = crypto.randomUUID();
  r = await rasxod(sklad, { to: `b:${brId}`, rows: [[M1, "4"]], token: tokS3 });
  const refB2 = movesWhere(`"clientToken"=${lit(tokS3)}`)[0]?.ref ?? "";
  const rb = await returnBr(sklad, M1, String(Math.round((brHeld() - 3) * 1000) / 1000)); // brigadada 3 kg qoladi (< 4)
  const bS3 = bal(M1);
  const d5 = await cancelRx(dir, refB2, WHY);
  check("R.13 brigada qo'lida berilganidan kam qolgan (3 < 4) — «Storno mumkin emas» (xomashyo nomi bilan), hech narsa yozilmadi",
    !!refB2 && rb.result?.ok === true && /^Storno mumkin emas/.test(d5.result?.error ?? "") && (d5.result?.error ?? "").includes(M1n)
    && stornoMoves(refB2).length === 0 && near(bal(M1), bS3) && near(brHeld(), 3), [rb.result ?? rb.status, d5.result ?? d5.status, brHeld()]);

  pg = await dir.get(`/stock/rasxod?from=${today}&to=${today}`);
  check("R.14 /stock/rasxod (direktor): «Storno» tugmasi bor, storno qatori «Storno: <oluvchi>» va sababi, asl qatorda «bekor qilingan»",
    pg.status === 200 && pg.text.includes(STORNO_BTN) && pg.text.includes(`Storno: ${R1n}`) && pg.text.includes(WHY) && pg.text.includes("bekor qilingan"), pg.status);
  // «Остатки» ayniyati qaytish va storno bilan ham: Расход ustuni = Расход jurnali, oxirgi = SQL qoldig'i
  const turnR = (await materialTurnover({ from: oFrom, to: oTo })).find((x) => x.id === M1);
  const rxR = (await rasxodJournal({ from: oFrom, to: oTo })).filter((x) => x.materialId === M1);
  check("R.15 «Остатки» M1: Расход ustuni = Расход jurnali (qaytish va storno qatorlari bilan, К-во va Сумма), oxirgi = SQL qoldig'i",
    !!turnR && near(turnR.out.q, rxR.reduce((a, x) => a + x.qty, 0)) && Math.abs(turnR.out.s - rxR.reduce((a, x) => a + x.sum, 0)) < 0.05
    && near(turnR.close.q, Number(q1(`select coalesce(sum(qty), 0)::float8 as b from "StockMove" where "materialId"=${lit(M1)}`).b)),
    { out: turnR?.out, jq: rxR.reduce((a, x) => a + x.qty, 0), js: rxR.reduce((a, x) => a + x.sum, 0) });

  // ───────── 7. Mobil (ECO / ERP ilova) ─────────
  console.log("\n7. Mobil: ro'yxatlar, formalar, Расход yaratish");
  const mt = await mLogin("test.sklad"), mtSotuv = await mLogin("test.sotuv");
  check("7.0 mobil login (sklad, sotuvchi)", !!mt && !!mtSotuv);
  for (const [key, needles] of [["prixod", [docA, M1n]], ["rasxod", [M1n, R1n]], ["ostatki", [M1n]]] as [string, string[]][]) {
    const l = await mobile("GET", `/api/mobile/list?key=${key}`, mt);
    const rows = l.json?.rows;
    check(`7.1 /api/mobile/list?key=${key} (sklad) — 200, qatorlar bor, test ma'lumoti ko'rinadi`,
      l.status === 200 && Array.isArray(rows) && rows.length > 0 && needles.some((s) => l.text.includes(s)), `${l.status} ${l.text.slice(0, 200)}`);
  }
  const forms: Record<string, MField[]> = {};
  for (const key of ["prixod", "rasxod"]) {
    const f = await mobile("GET", `/api/mobile/form?key=${key}`, mt);
    const fields = f.json?.fields;
    if (Array.isArray(fields)) forms[key] = fields as MField[];
    check(`7.2 /api/mobile/form?key=${key} (sklad) — 200, maydonlar bor`, f.status === 200 && Array.isArray(fields) && fields.length > 0, `${f.status} ${f.text.slice(0, 200)}`);
    const fs = await mobile("GET", `/api/mobile/form?key=${key}`, mtSotuv);
    check(`7.3 /api/mobile/form?key=${key} (sotuvchi) — 403`, fs.status === 403, `${fs.status} ${fs.text.slice(0, 120)}`);
  }
  const rxForm = JSON.stringify(forms.rasxod ?? []);
  check("7.4 mobil Расход formasida «Кому» ro'yxatida faol oluvchi va brigada bor, nofaoli yo'q",
    rxForm.includes(R1) && rxForm.includes(brId) && !rxForm.includes(R2), rxForm.slice(0, 200));
  const tokM = crypto.randomUUID();
  const payload = mobilePayload(forms.rasxod ?? [], { warehouseId: wh.id, recipientId: R1, materialId: M2, qty: 2, date: today, token: tokM });
  const mIssues = () => n(`select id from "StockMove" where type='ISSUE' and "materialId"=${lit(M2)} and "recipientId"=${lit(R1)} and qty = -2`);
  const mc1 = await mobile("POST", "/api/mobile/create", mt, { key: "rasxod", payload });
  check("7.5 mobil orqali Расход (sklad): 200, StockMove ISSUE M2 −2 → oluvchi, qoldiq 45 → 43",
    mc1.status === 200 && mIssues() === 1 && near(bal(M2), 43), { status: mc1.status, body: mc1.text.slice(0, 200), payload });
  const mc2 = await mobile("POST", "/api/mobile/create", mt, { key: "rasxod", payload });
  check("7.6 o'sha clientToken bilan qayta yuborish — ikkinchi harakat yozilmadi", mc2.status === 200 && mIssues() === 1 && near(bal(M2), 43), `${mc2.status} ${mc2.text.slice(0, 160)}`);
  const ms = await mobile("POST", "/api/mobile/create", mtSotuv, { key: "rasxod", payload: { ...payload, clientToken: crypto.randomUUID() } });
  check("7.7 sotuvchi mobil Расход qila olmaydi (403), qoldiq o'zgarmadi", ms.status === 403 && near(bal(M2), 43), `${ms.status} ${ms.text.slice(0, 120)}`);
  // Приход formasi: «Цена» avtomatik to'ldirilmaydi (xomashyo almashtirilsa eski narx qolardi) — bo'sh bo'lsa server «Дона сўм» ni oladi
  const pxItems = (forms.prixod ?? []).find((f) => f.name === "items");
  const pxPrice = pxItems?.columns?.find((c) => c.name === "price") as (MField & { required?: boolean }) | undefined;
  const pxMat = JSON.stringify(pxItems?.columns?.find((c) => c.name === "materialId") ?? {});
  check("7.8 mobil Приход formasi: «Цена» majburiy emas, xomashyo `extra` sida narx yo'q",
    !!pxPrice && !pxPrice.required && !/"extra":\{[^}]*"price"/.test(pxMat), { price: pxPrice, mat: pxMat.slice(0, 200) });
  // Xomashyo kartochkasi: «Dona narxi» va oylik «Qoldiqlar» summalari — faqat ko'rish huquqi borlarga (sklad — bor, sotuvchi — yo'q)
  const cardSklad = await mobile("GET", `/api/mobile/detail?key=stock&id=${encodeURIComponent(M1)}`, mt);
  const cardSotuv = await mobile("GET", `/api/mobile/detail?key=stock&id=${encodeURIComponent(M1)}`, mtSotuv);
  check("7.9 mobil xomashyo kartochkasi: sklad — «Dona narxi» va «Qoldiqlar» bor; sotuvchi — 200, narx va summalar yo'q",
    cardSklad.status === 200 && cardSklad.text.includes("Dona narxi") && cardSklad.text.includes("Qoldiqlar")
      && cardSotuv.status === 200 && !cardSotuv.text.includes("Dona narxi") && !cardSotuv.text.includes("Qoldiqlar"),
    { sklad: cardSklad.status, sotuv: `${cardSotuv.status} ${cardSotuv.text.slice(0, 160)}` });
} catch (e) {
  check("kutilmagan xato", false, String((e as Error)?.stack ?? e));
} finally {
  await restore();
  summary("sklad-journals");
  process.exit();
}

/** Tozalash: brigada qoldig'i skladga, test xomashyosi qoldig'i hisobdan chiqariladi va arxivga, narx qaytariladi, oluvchi/brigada/yetkazuvchi nofaol. */
async function restore() {
  const step = async (name: string, f: () => Promise<unknown>) => { try { await f(); } catch (e) { console.log(`    tozalash (${name}):`, String(e)); } };
  const mats = [M1, M2].filter(Boolean);
  if (brId) {
    const left = q(`select "materialId" as m, sum(qty)::float8 as b from "BrigadeMove" where "brigadeId"=${lit(brId)} group by 1 having sum(qty) > 0.0005`) as { m: string; b: number }[];
    for (const x of left) {
      await step("brigadadan qaytarish", () => sklad.action("stock/brigade-actions#returnToStock", [brId, undefined, fd({ materialId: x.m, qty: String(x.b), warehouseId: wh.id })], BRIG));
    }
  }
  const rest = mats.map((m) => ({ materialId: m, qty: Math.round(bal(m) * 1000) / 1000 })).filter((x) => x.qty > 0.0005);
  if (rest.length) await step("qoldiqni hisobdan chiqarish", () => writeOff(sklad, rest, "Boshqa"));
  if (M1 && priceOf(M1)?.p != null) await step("narxni qaytarish", () => setPrice(snab, M1, ""));
  if (mats.length) await step("arxivga olish", () => sklad.action("lib/material-actions#deleteMaterials", [undefined, fd({ ids: mats })], BAL));
  const recs = q(`select id from "StockRecipient" where name like ${lit(`QA SJ %${T}`)} and "isActive"`) as { id: string }[];
  for (const x of recs) await step("oluvchini yashirish", () => toggleRec(sklad, x.id, false));
  if (brId && q1(`select "isActive" as a from "Brigade" where id=${lit(brId)}`)?.a === true) await step("brigada", () => dir.action("brigades/actions#toggleBrigade", [brId], "/brigades"));
  if (supId && q1(`select "isActive" as a from "Supplier" where id=${lit(supId)}`)?.a === true) await step("yetkazuvchi", () => sklad.action("suppliers/actions#toggleSupplier", [supId], "/suppliers"));
  if (!mats.length) return;
  const matsOk = mats.every((m) => near(bal(m), 0) && q1(`select "isActive" as a, "unitPrice" as p from "Material" where id=${lit(m)}`)?.a === false && priceOf(m)?.p === null);
  const brOk = !brId || (q1(`select coalesce(sum(qty), 0)::float8 as b from "BrigadeMove" where "brigadeId"=${lit(brId)}`).b === 0 && q1(`select "isActive" as a from "Brigade" where id=${lit(brId)}`)?.a === false);
  const recOk = n(`select id from "StockRecipient" where name like ${lit(`QA SJ %${T}`)} and "isActive"`) === 0;
  const supOk = !supId || q1(`select "isActive" as a from "Supplier" where id=${lit(supId)}`)?.a === false;
  check("T. tozalash: brigada qoldig'i 0, test xomashyolari qoldiqsiz va arxivda, «Дона сўм» qaytarildi, oluvchilar / brigada / yetkazuvchi nofaol",
    matsOk && brOk && recOk && supOk, { matsOk, brOk, recOk, supOk });
}
