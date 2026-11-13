import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { Prisma, type CashTransaction, type CashTransfer } from "@/generated/prisma";
import { audit, auditMany } from "@/lib/audit";
import { isoDate, money } from "@/lib/format";
import { accountBalances, balanceDropError } from "@/lib/payments";
import { JOURNAL_ONLY, TRANSFER_REF, isTransfer, txSign } from "@/lib/cash-tx";
import { PEREKIT_CATEGORY, SALES_CATEGORY } from "@/lib/cash-categories";
import { insertTransfer } from "@/lib/cash-transfer";
import { DDS_FIXED } from "@/lib/fin-report/sheet-lines";
import { MAX_AMOUNT } from "@/lib/action";
import { matchKey, numMoney, parseDate, str, valueMapper, type ValueMaps } from "@/lib/excel";
import { loadCategories, makeResolver, normCat, resetCategoryCache, type CatNode } from "@/lib/fin-report/categories";

/**
 * Kassa / bank → «Excel orqali qo'shish»: Kassa jurnali ustunlaridagi fayl (Sana, Hisob, Kirim, Chiqim, Manba,
 * Sub manba, Kontragent, Izoh) → qo'lda kirim/chiqim yozuvlari (`CashTransaction`), Kirim-Chiqim formasidagi qoidalar bilan:
 *  · Manba — kategoriya daraxtidagi nom (yoki aliasi), yozuv turiga mos; daraxtda yo'q bo'lsa — qator turi bilan yangi
 *    manba bo'lib qo'shiladi (joriy faoliyat, PNL'da «Boshqa tushum» / «Boshqa chiqim»dagidek — keyin Kategoriyalarda
 *    tuzatiladi). Sub manba shu manbaniki bo'lmasa — o'sha manba ostiga yangi sub manba bo'lib qo'shiladi (nomi boshqa
 *    manbada band bo'lsa — «Nom (Manba)»);
 *  · kredit / loyiha so'raydigan manba importda yozilmaydi (formada kredit yoki loyiha tanlanadi);
 *  · «Savdo tushumi» — mijoz to'lovi jurnalda (To'lovlar) bo'lsa o'tkaziladi, bo'lmasa «Savdo» kirimi bo'lib yoziladi
 *    (mijoz qarzini kamaytirmaydi);
 *  · «Perekit» / «99999-Xisob raqam almashinuvi» — o'tkazma: jurnalda bo'lsa o'tkaziladi, bo'lmasa bir xil summali juft
 *    qator (bir hisobdan chiqim + boshqasiga kirim, o'sha kuni yoki ±1 kun) o'tkazma hujjatiga (OT-…) aylanadi, jufti yo'q — xato;
 *  · jurnalda bor qator (kun, hisob, kirim/chiqim, summa, manba bir xil) qayta yozilmaydi — jurnalning o'zidan
 *    yuklab olingan faylni ham, bir faylni qayta ham yuklash mumkin (bekor qilingan yozuv ham «bor» hisoblanadi);
 *  · import tugagach naqd kassa (va overdraftsiz bank) minusga tushmaydi;
 *  · biror qatorda xato bo'lsa hech narsa yozilmaydi;
 *  · har import — partiya: AuditLog'da bitta «CashImport» yozuvi (yozilgan qatorlar, o'tkazmalar, yangi kategoriyalar va
 *    ularning import paytidagi holati). Noto'g'ri fayl butunligicha qaytariladi (`rollbackCashImport`), sxema o'zgarmaydi.
 */

/** Kassa jurnalida mijoz to'lovlari (`Payment`) shu manba nomi bilan ko'rinadi. */
export const SALES_MANBA = "Savdo tushumi";
export const CASH_IMPORT_MAX = 2000;

/** Fayldagi bitta qator — kalitlar import sahifasidagi maydonlar bilan bir xil. */
export type CashImportRow = Record<string, unknown>;
export type CashImportResult = { error: string } | { ok: true; added: number; skipped: number; transfers: number; newSubs: string[]; newTops: string[]; from: Date; to: Date; batchId?: string };

type Fresh = {
  date: Date; type: "INCOME" | "EXPENSE"; cashAccountId: string; amount: number;
  category: string; subCategory: string | null; counterparty: string | null; note: string | null;
};
/**
 * Fayl qatori: oddiy kirim/chiqim (`data`) yoki o'tkazma oyog'i (`leg`). `altKeys` — jurnalda boshqacha yozilgan bo'lishi
 * mumkin: mijoz to'lovi «Savdo» kirimi bo'lib, perekit oyog'i ±1 kun bilan (o'tkazma chiqim kuni bilan yoziladi).
 */
type Parsed = { no: number; date: Date; accountId: string; key: string; altKeys?: string[]; data: Fresh | null; leg?: { sign: number; amount: number; note: string | null } };
/** O'tkazma deb olinadigan manba nomlari (Google jadvalidagi «99999-Xisob raqam almashinuvi» ham). */
const TRANSFER_NAMES = new Set([PEREKIT_CATEGORY, "Perekit", ...DDS_FIXED.transfers.slice(0, 3)].map(normCat));
const isTransferManba = (m: string) => TRANSFER_NAMES.has(normCat(m)) || /perekit|raqam almashinuvi/.test(normCat(m));

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const rowKey = (d: Date, accountId: string, sign: number, amount: number, manba: string) =>
  [dayKey(d), accountId, sign > 0 ? "+" : "-", r2(amount).toFixed(2), normCat(manba)].join("|");
/** Eksportdagi «Jami» qatori — ma'lumot emas. */
const TOTAL_ROW = /^(jami|итого|итог|всего|жами)\b/i;

class CashImportError extends Error {}

export async function importCashEntries(rows: CashImportRow[], opts: { defaultAccountId: string; maps: ValueMaps; fileName?: string | null }, userId: string): Promise<CashImportResult> {
  const list = rows.filter((x) => !TOTAL_ROW.test(str(x.date)) && ["date", "inc", "exp", "manba"].some((k) => str(x[k]) !== ""));
  if (!list.length) return { error: "Faylda qator yo'q" };
  if (list.length > CASH_IMPORT_MAX) return { error: `Bir martada ko'pi bilan ${CASH_IMPORT_MAX} qator — faylni bo'lib yuklang` };

  const [accounts, cats] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true, allowOverdraft: true } }),
    loadCategories(),
  ]);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  // Hisob nomi bo'yicha (kirill/lotin, belgilarsiz); bir xil nomli ikki hisob bo'lsa — nom yetmaydi, null
  const accByName = new Map<string, (typeof accounts)[number] | null>();
  for (const a of accounts) { const k = matchKey(a.name); accByName.set(k, accByName.has(k) ? null : a); }
  const defAcc = accById.get(opts.defaultAccountId);
  const resolve = makeResolver(cats);
  // Yangi sub manbalar: nom (yoki alias) butun daraxtda yagona — band bo'lsa «Nom (Manba)»
  const byNorm = new Map(cats.map((c) => [normCat(c.name), c]));
  const taken = new Set(cats.flatMap((c) => [normCat(c.name), ...c.aliases.map(normCat)]));
  const newSubs = new Map<string, { parentId: string; name: string }>();
  const subOf = (top: (typeof cats)[number], raw: string): string | null => {
    const plain = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    const suffixed = `${plain} (${top.name})`.slice(0, 80);
    const own = byNorm.get(normCat(suffixed));
    if (own?.parentId === top.id) return own.name;
    const k = `${top.id}|${normCat(plain)}`;
    const planned = newSubs.get(k);
    if (planned) return planned.name;
    const name = !taken.has(normCat(plain)) ? plain : !taken.has(normCat(suffixed)) ? suffixed : null;
    if (!name) return null;
    taken.add(normCat(name));
    newSubs.set(k, { parentId: top.id, name });
    return name;
  };
  // Daraxtda yo'q manba — birinchi qatorining turi bilan yangi manba (id vaqtincha, yozishda haqiqiysi bilan almashadi)
  const newTops = new Map<string, CatNode>();
  const topFor = (raw: string, type: "INCOME" | "EXPENSE"): CatNode => {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    const k = normCat(name);
    let t = newTops.get(k);
    if (!t) {
      t = {
        id: `new:${k}`, name, type, parentId: null, flow: "OPERATING", pnlLine: type === "INCOME" ? "OTHER_INCOME" : "PRODUCTION",
        needs: null, loanPart: null, aliases: [], isSystem: false, isActive: true, sort: 500, inCost: false,
      };
      newTops.set(k, t);
      taken.add(k);
    }
    return t;
  };
  const accOf = valueMapper(opts.maps, "account");
  const manbaOf = valueMapper(opts.maps, "manba");
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);

  const errors: string[] = [];
  const parsed: Parsed[] = [];
  list.forEach((x, i) => {
    const cell = (k: string) => str(x[k]);
    const at = `${i + 1}-qator${cell("who") ? ` (${cell("who")})` : ""}`;
    const fail = (m: string) => { errors.push(`${at}: ${m}`); };

    const day = parseDate(x.date);
    if (!day) return fail(cell("date") ? `sana o'qilmadi — «${cell("date")}»` : "sana bo'sh");
    // Kirim-Chiqim formasidagidek saqlanadi (`new Date("YYYY-MM-DD")`) — jurnal filtri va hisobotlar shu bilan hisoblaydi
    const date = new Date(isoDate(day));
    if (date > endOfToday) return fail("sana kelajakda");

    // Kirim yoki Chiqim — bittasi to'ldiriladi (jurnaldagidek); raqam emas / manfiy bo'lsa qator o'zicha ko'rsatiladi
    const amt = (k: "inc" | "exp", label: string) => {
      if (!cell(k)) return 0;
      const v = numMoney(x[k]);
      if (!Number.isFinite(v)) { fail(`${label} — raqam emas («${cell(k)}»)`); return null; }
      if (v < 0) { fail(`${label} manfiy (${cell(k)}) — qaytarishni teskari ustunga yozing`); return null; }
      return r2(v);
    };
    const inc = amt("inc", "Kirim"), exp = amt("exp", "Chiqim");
    if (inc === null || exp === null) return;
    if (inc > 0 && exp > 0) return fail("Kirim va Chiqim ikkalasi to'ldirilgan — bittasini qoldiring");
    if (!(inc > 0 || exp > 0)) return fail("Kirim yoki Chiqim summasi yo'q");
    const amount = inc || exp;
    if (amount > MAX_AMOUNT) return fail("summa juda katta");
    const type = inc > 0 ? "INCOME" : "EXPENSE";
    const sign = type === "INCOME" ? 1 : -1;

    const accRaw = cell("account");
    const accVal = accRaw ? accOf(accRaw) : "";
    const acc = accVal ? accById.get(accVal) ?? accByName.get(matchKey(accVal)) : defAcc;
    if (acc === null) return fail(`«${accRaw}» nomli hisob bir nechta (naqd va bank) — fayldagi nomni aniqlashtiring`);
    if (!acc) return fail(accRaw ? `hisob topilmadi — «${accRaw}» (ro'yxatdagi hisobga moslang)` : "hisob ko'rsatilmagan");

    const manba = manbaOf(cell("manba"));
    if (!manba) return fail("Manba bo'sh");
    // Perekit — o'tkazma oyog'i: jurnalda bo'lmasa juftiga qarab o'tkazma hujjati bo'ladi
    if (isTransferManba(manba)) {
      const near = [-1, 1].map((k) => rowKey(new Date(date.getTime() + k * 86_400_000), acc.id, sign, amount, PEREKIT_CATEGORY));
      parsed.push({ no: i + 1, date, accountId: acc.id, key: rowKey(date, acc.id, sign, amount, PEREKIT_CATEGORY), altKeys: near, data: null, leg: { sign, amount, note: cell("note") || null } });
      return;
    }
    const who = cell("who") || null, note = cell("note") || null;
    // Mijoz to'lovi: To'lovlarda bo'lsa o'tkaziladi, bo'lmasa «Savdo» kirimi (mijoz qarziga tegmaydi)
    if (normCat(manba) === normCat(SALES_MANBA)) {
      if (type !== "INCOME") return fail(`«${SALES_MANBA}» — kirim, summa esa Chiqim ustunida`);
      parsed.push({
        no: i + 1, date, accountId: acc.id, key: rowKey(date, acc.id, sign, amount, SALES_MANBA), altKeys: [rowKey(date, acc.id, sign, amount, SALES_CATEGORY)],
        data: { date, type, cashAccountId: acc.id, amount, category: SALES_CATEGORY, subCategory: null, counterparty: who, note },
      });
      return;
    }

    const sub = cell("sub");
    const base = resolve(manba) ?? { top: topFor(manba, type), sub: null };
    const top = base.top;
    if (top.type !== type) return fail(`«${top.name}» — ${top.type === "INCOME" ? "kirim" : "chiqim"} manbasi, summa esa ${type === "INCOME" ? "Kirim" : "Chiqim"} ustunida`);
    if (!top.isActive) return fail(`«${top.name}» manbasi o'chirilgan`);
    if (top.needs === "LOAN" || top.needs === "PROJECT") return fail(`«${top.name}» — ${top.needs === "LOAN" ? "kredit" : "loyiha"} tanlanadi: Kirim-Chiqim formasida kiriting`);
    let subName = base.sub?.name ?? null;
    if (sub) {
      const r = resolve(manba, sub);
      subName = r?.sub && r.top.id === top.id ? r.sub.name : subOf(top, sub);
      if (!subName) return fail(`«${sub}» — sub manba nomi band, «${top.name}» ostiga qo'shib bo'lmadi (Moliya → Kategoriyalarda qo'shing)`);
    }
    parsed.push({
      no: i + 1, date, accountId: acc.id, key: rowKey(date, acc.id, sign, amount, top.name),
      data: { date, type, cashAccountId: acc.id, amount, category: top.name, subCategory: subName, counterparty: who, note },
    });
  });
  if (errors.length) return { error: `${errors.slice(0, 5).join("; ")}${errors.length > 5 ? `; yana ${errors.length - 5} ta qatorda xato` : ""}. Faylni tuzatib qayta yuklang — hech narsa yozilmadi` };

  const times = parsed.map((p) => p.date.getTime());
  const from = new Date(Math.min(...times)), to = new Date(Math.max(...times));
  // Mavjud yozuvlar vaqti har xil (forma, mobil, avtomatik) — bir kun kengroq olinadi, solishtirish kun bo'yicha
  const range = { gte: new Date(from.getTime() - 86_400_000), lt: new Date(to.getTime() + 2 * 86_400_000) };
  const accIds = [...new Set(parsed.map((p) => p.accountId))].sort();

  try {
    const res = await db.$transaction(async (tx) => {
      // Kirim-Chiqim formasi bilan bir navbat (`lib/cash-entry.ts`): avval yozuv qulfi, keyin qoldiq qulfi
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash-import"}))`;
      for (const id of accIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + id}))`;
      for (const id of accIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash:" + id}))`;

      const [pays, txs] = await Promise.all([
        tx.payment.findMany({ where: { date: range, cashAccountId: { in: accIds } }, select: { date: true, cashAccountId: true, amount: true } }),
        tx.cashTransaction.findMany({ where: { ...JOURNAL_ONLY, date: range, cashAccountId: { in: accIds } }, select: { date: true, cashAccountId: true, amount: true, type: true, category: true, subCategory: true } }),
      ]);
      // Jurnalda bor yozuvlar soni kalit bo'yicha: faylda bir xil ikki qator bo'lsa, jurnalda bittasi bor — bittasi yoziladi
      const have = new Map<string, number>();
      const add = (k: string) => have.set(k, (have.get(k) ?? 0) + 1);
      for (const p of pays) add(rowKey(p.date, p.cashAccountId, 1, Number(p.amount), SALES_MANBA));
      for (const t of txs) add(rowKey(t.date, t.cashAccountId, txSign(t.type), Number(t.amount), isTransfer(t.type) ? PEREKIT_CATEGORY : resolve(t.category, t.subCategory)?.top.name ?? t.category));

      const fresh: Fresh[] = [];
      const legs: Parsed[] = [];
      let skipped = 0;
      for (const p of parsed) {
        const hit = [p.key, ...(p.altKeys ?? [])].find((k) => (have.get(k) ?? 0) > 0);
        if (hit) { have.set(hit, have.get(hit)! - 1); skipped++; continue; }
        if (p.data) fresh.push(p.data);
        else legs.push(p);
      }
      // Perekit: bir xil summa — bir hisobdan chiqim, boshqasiga kirim (fayl tartibida). Avval o'sha kuni, keyin ±1 kun:
      // bankdan yechilgan naqd kassaga ertasi kuni kirim qilingan bo'lishi mumkin — o'tkazma sanasi chiqim kuni
      const pairs: { out: Parsed; in: Parsed }[] = [];
      const used = new Set<Parsed>();
      const days = (a: Date, b: Date) => Math.abs(Math.round((new Date(isoDate(a)).getTime() - new Date(isoDate(b)).getTime()) / 86_400_000));
      for (const gap of [0, 1]) {
        for (const o of legs.filter((l) => l.leg!.sign < 0 && !used.has(l))) {
          const m = legs.find((x) => !used.has(x) && x.leg!.sign > 0 && x.accountId !== o.accountId && days(x.date, o.date) === gap && Math.abs(x.leg!.amount - o.leg!.amount) < 0.005);
          if (m) { used.add(o); used.add(m); pairs.push({ out: o, in: m }); }
        }
      }
      const lonely = legs.filter((l) => !used.has(l));
      if (lonely.length) {
        throw new CashImportError(`${lonely.slice(0, 5).map((l) => `${l.no}-qator`).join(", ")}${lonely.length > 5 ? ` va yana ${lonely.length - 5} ta` : ""}: perekitning jufti yo'q — shu summa bilan (o'sha kuni yoki ±1 kun) boshqa hisobga kirim (yoki boshqa hisobdan chiqim) qatori bo'lishi kerak. Faylni tuzating yoki o'tkazmani Kirim-Chiqim → «Kassa ⇄ bank» orqali kiriting. Hech narsa yozilmadi`);
      }
      if (!fresh.length && !pairs.length) return { added: 0, skipped, transfers: 0, newSubs: [], newTops: [] };

      // Import tugagach hisob minusga tushmasin (naqd kassa — har doim, bank — overdraft ruxsati bo'lmasa)
      const balances = await accountBalances(tx, accIds);
      for (const id of accIds) {
        const a = accById.get(id)!;
        if (a.type === "BANK" && a.allowOverdraft) continue;
        const delta = fresh.filter((f) => f.cashAccountId === id).reduce((s, f) => s + (f.type === "INCOME" ? f.amount : -f.amount), 0)
          + pairs.reduce((s, p) => s + (p.in.accountId === id ? p.in.leg!.amount : 0) - (p.out.accountId === id ? p.out.leg!.amount : 0), 0);
        const left = (balances.get(id) ?? 0) + delta;
        if (delta < 0 && left < -0.005) {
          throw new CashImportError(`${a.name} ${a.type === "CASH" ? "kassasi" : "hisobi"} minusga tushadi: hozirgi qoldiq ${money(balances.get(id) ?? 0)}, import bilan ${money(left)}. Hech narsa yozilmadi. Exceldan o'tayotgan bo'lsangiz — avval «Oy oxiri qoldiqlari»da jurnal boshlanishidan oldingi oy oxiridagi qoldiqni kiriting`);
        }
      }

      // Yangi manbalar va sub manbalar — faqat yoziladigan qatorlarda ishlatilgani (sub — ota-onaning turi, oqimi va PNL qatori bilan)
      const tops = [...newTops.values()].filter((t) => fresh.some((f) => f.category === t.name));
      const realId = new Map<string, string>();
      const madeCats: BatchAfter["categories"] = [];
      for (const t of tops) {
        const c = await tx.cashCategory.create({ data: { name: t.name, type: t.type, flow: t.flow, pnlLine: t.pnlLine, sort: t.sort } });
        realId.set(t.id, c.id);
        madeCats.push({ id: c.id, name: c.name, parentId: null });
        await audit(tx, userId, "CREATE", "CashCategory", c.id, undefined, { ...c, via: "kassa-import" });
      }
      const subs = [...newSubs.values()].filter((n) => fresh.some((f) => f.subCategory === n.name));
      for (const n of subs) {
        const parent = cats.find((c) => c.id === n.parentId) ?? tops.find((t) => t.id === n.parentId)!;
        const c = await tx.cashCategory.create({ data: { name: n.name, type: parent.type, parentId: realId.get(parent.id) ?? parent.id, flow: parent.flow, pnlLine: parent.pnlLine } });
        madeCats.push({ id: c.id, name: c.name, parentId: c.parentId });
        await audit(tx, userId, "CREATE", "CashCategory", c.id, undefined, { ...c, via: "kassa-import" });
      }

      const created = fresh.length ? await tx.cashTransaction.createManyAndReturn({ data: fresh.map((f) => ({ ...f, createdById: userId })) }) : [];
      await auditMany(tx, userId, "CREATE", "CashTransaction", created.map((t) => ({ id: t.id, after: t })));
      const docs: { t: CashTransfer; legs: string[] }[] = [];
      for (const p of pairs) {
        const from = accById.get(p.out.accountId)!, to = accById.get(p.in.accountId)!;
        const note = [p.out.leg!.note, p.in.leg!.note].find(Boolean) ?? null;
        const { t, outTx, inTx } = await insertTransfer(tx, { date: p.out.date, from, to, amount: p.out.leg!.amount, note }, userId);
        await audit(tx, userId, "CREATE", "CashTransfer", t.id, undefined, { ...t, legs: [outTx.id, inTx.id], via: "kassa-import" });
        docs.push({ t, legs: [outTx.id, inTx.id] });
      }
      const out = { added: created.length, skipped, transfers: pairs.length, newSubs: subs.map((n) => n.name), newTops: tops.map((t) => t.name) };
      // Partiya belgisi — butun importni qaytarish uchun (`rollbackCashImport`): nima yozildi va qanday holatda
      const batchId = randomUUID();
      const batch: BatchAfter = {
        txIds: created.map((t) => t.id), txSigs: created.map(txSig),
        transferIds: docs.map((d) => d.t.id), transferSigs: docs.map((d) => transferSig(d.t)), transferLegs: docs.map((d) => d.legs), legTxIds: docs.flatMap((d) => d.legs),
        categoryIds: madeCats.map((c) => c.id), categories: madeCats,
        ...out, from: isoDate(from), to: isoDate(to), fileName: opts.fileName?.trim().slice(0, 200) || null,
      };
      await audit(tx, userId, "CREATE", CASH_IMPORT_ENTITY, batchId, undefined, batch);
      return { ...out, batchId };
    }, { timeout: 60_000, maxWait: 15_000 });
    if (res.newSubs.length || res.newTops.length) resetCategoryCache();
    return { ok: true, ...res, from, to };
  } catch (e) {
    if (e instanceof CashImportError) return { error: e.message };
    throw e;
  }
}

// ───────────────────────── Importni qaytarish (partiya) ─────────────────────────

/** AuditLog'dagi partiya yozuvi: entity «CashImport», entityId — partiya id (UUID), qaytarilganda STATUS_CHANGE. */
export const CASH_IMPORT_ENTITY = "CashImport";

/** Partiya yozuvining `after` qismi — import nima yozganini va qanday holatda yozganini saqlaydi. */
type BatchAfter = {
  txIds: string[]; txSigs: string[];
  transferIds: string[]; transferSigs: string[]; transferLegs: string[][]; legTxIds: string[];
  categoryIds: string[]; categories: { id: string; name: string; parentId: string | null }[];
  added: number; skipped: number; transfers: number; newSubs: string[]; newTops: string[];
  from: string; to: string; fileName: string | null;
};

const hash = (s: string) => createHash("sha1").update(s).digest("base64url").slice(0, 16);
/** Yozuvning holati (qisqa xesh): tahrir, hujjatga bog'lash yoki bekor qilish uni o'zgartiradi. */
const txSig = (t: CashTransaction) => hash([
  t.type, Number(t.amount).toFixed(2), t.date.toISOString(), t.cashAccountId, t.category, t.subCategory ?? "", t.counterparty ?? "", t.note ?? "",
  t.supplierId ?? "", t.refType ?? "", t.refId ?? "", t.projectId ?? "", t.loanId ?? "", t.cancelledAt ? "bekor" : "",
].join("|"));
const transferSig = (t: CashTransfer) => hash([
  Number(t.amount).toFixed(2), t.date.toISOString(), t.fromAccountId, t.toAccountId, t.note ?? "", Number(t.fee ?? 0).toFixed(2), t.cancelledAt ? "bekor" : "",
].join("|"));

function batchOf(v: unknown): BatchAfter | null {
  const o = v as Partial<BatchAfter> | null;
  const arr = (x: unknown): x is string[] => Array.isArray(x) && x.every((i) => typeof i === "string");
  if (!o || typeof o !== "object" || !arr(o.txIds) || !arr(o.txSigs) || o.txIds.length !== o.txSigs.length) return null;
  if (!arr(o.transferIds) || !arr(o.transferSigs) || !Array.isArray(o.transferLegs) || o.transferIds.length !== o.transferSigs.length || o.transferLegs.length !== o.transferIds.length) return null;
  if (!arr(o.categoryIds) || !Array.isArray(o.categories)) return null;
  return o as BatchAfter;
}

export type CashImportBatch = {
  id: string; at: Date; userId: string; by: string;
  added: number; transfers: number; skipped: number; newCats: number; from: string | null; to: string | null; fileName: string | null;
};

/**
 * Hali qaytarilmagan oxirgi importlar (Kassa / bank → «Excel orqali qo'shish» sahifasidagi ro'yxat va import xabari).
 * `after` katta bo'lishi mumkin (2000 qator id'lari) — kerakli maydonlargina olinadi.
 */
export async function recentCashImports(opts: { take?: number; userId?: string } = {}): Promise<CashImportBatch[]> {
  const take = Math.min(Math.max(opts.take ?? 10, 1), 50);
  const rows = await db.$queryRaw<{ id: string; at: Date; userId: string; by: string; added: number | null; transfers: number | null; skipped: number | null; newCats: number | null; from: string | null; to: string | null; fileName: string | null }[]>`
    SELECT a."entityId" AS id, a."createdAt" AS at, a."userId" AS "userId", u."fullName" AS by,
      (a.after->>'added')::int AS added, (a.after->>'transfers')::int AS transfers, (a.after->>'skipped')::int AS skipped,
      COALESCE(jsonb_array_length(a.after->'categoryIds'), 0) AS "newCats",
      a.after->>'from' AS "from", a.after->>'to' AS "to", a.after->>'fileName' AS "fileName"
    FROM "AuditLog" a JOIN "User" u ON u.id = a."userId"
    WHERE a.entity = ${CASH_IMPORT_ENTITY} AND a.action = 'CREATE'
      AND (${opts.userId ?? null}::text IS NULL OR a."userId" = ${opts.userId ?? null}::text)
      AND NOT EXISTS (SELECT 1 FROM "AuditLog" b WHERE b.entity = ${CASH_IMPORT_ENTITY} AND b."entityId" = a."entityId" AND b.action = 'STATUS_CHANGE')
    ORDER BY a."createdAt" DESC
    LIMIT ${take}`;
  return rows.map((r) => ({ ...r, added: Number(r.added ?? 0), transfers: Number(r.transfers ?? 0), skipped: Number(r.skipped ?? 0), newCats: Number(r.newCats ?? 0) }));
}

const txDesc = (t: { date: Date; type: string; amount: unknown; category: string }) =>
  `${isoDate(t.date)} ${t.type === "INCOME" ? "kirim" : "chiqim"} ${money(Number(t.amount))} «${t.category}»`;

/**
 * Butun importni qaytarish (noto'g'ri fayl). Partiyadagi hamma narsa yuklangan holatida bo'lsa — bitta tranzaksiyada:
 *  · kirim/chiqimlar Kassa jurnalidagi «O'chirish» kabi butunlay o'chiriladi (to'liq holati va sabab AuditLog'da DELETE).
 *    Bekor qilish emas: bekor qilingan yozuv importda «bor» hisoblanadi — to'g'ri faylni qayta yuklaganda o'tkazib yuborilardi;
 *  · o'tkazmalar (OT-…) «O'tkazmani o'chirish» kabi — ikkala oyog'i va hujjatning o'zi;
 *  · import qo'shgan manba / sub manba endi hech qayerda ishlatilmasa o'chiriladi (nomi o'zgartirilgan bo'lsa — tegilmaydi);
 *  · qaytarilgach naqd kassa (va overdraftsiz bank) minusga tushmaydi — tushsa rad etiladi;
 *  · partiyaga AuditLog STATUS_CHANGE (sabab bilan) — ikkinchi marta qaytarilmaydi.
 * Yuklangandan keyin biror yozuv tahrirlangan, bekor qilingan, o'chirilgan yoki hujjatga bog'langan bo'lsa — hech narsa
 * qilinmaydi, qaysilari ekani aytiladi.
 */
export async function rollbackCashImport(batchId: string, reason: string, who: { userId: string; ownOnly: boolean }): Promise<{ error?: string; note?: string }> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { error: "Qaytarish sababini yozing (kamida 3 belgi)" };
  const row = await db.auditLog.findFirst({ where: { entity: CASH_IMPORT_ENTITY, entityId: batchId, action: "CREATE" } });
  if (!row) return { error: "Import topilmadi" };
  if (who.ownOnly && row.userId !== who.userId) return { error: "Bu importni boshqa xodim yuklagan — buxgalteriya qaytaradi" };
  const b = batchOf(row.after);
  if (!b) return { error: "Import ma'lumoti o'qilmadi — yozuvlarni Kassa jurnalida alohida o'chiring" };
  // Qulf tartibi uchun hisoblar (qulfdan keyin hammasi qayta o'qiladi va solishtiriladi)
  const [preTx, preTr] = await Promise.all([
    db.cashTransaction.findMany({ where: { id: { in: b.txIds } }, select: { cashAccountId: true } }),
    db.cashTransfer.findMany({ where: { id: { in: b.transferIds } }, select: { fromAccountId: true, toAccountId: true } }),
  ]);
  const accIds = [...new Set([...preTx.map((t) => t.cashAccountId), ...preTr.flatMap((t) => [t.fromAccountId, t.toAccountId])])].sort();

  try {
    const res = await db.$transaction(async (tx) => {
      // Import, Kirim-Chiqim formasi va o'tkazma bilan bir navbat (importdagi tartibda)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash-import"}))`;
      for (const id of accIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + id}))`;
      for (const id of accIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash:" + id}))`;
      if (await tx.auditLog.count({ where: { entity: CASH_IMPORT_ENTITY, entityId: batchId, action: "STATUS_CHANGE" } })) throw new CashImportError("Bu import allaqachon qaytarilgan");

      const [txs, trs, legs, assets] = await Promise.all([
        tx.cashTransaction.findMany({ where: { id: { in: b.txIds } } }),
        tx.cashTransfer.findMany({ where: { id: { in: b.transferIds } } }),
        b.transferIds.length ? tx.cashTransaction.findMany({ where: { refType: TRANSFER_REF, refId: { in: b.transferIds } } }) : Promise.resolve([] as CashTransaction[]),
        tx.fixedAsset.findMany({ where: { cashTxId: { in: b.txIds } }, select: { cashTxId: true } }),
      ]);
      // Yuklangandan keyin o'zgarganlar — biri bo'lsa ham qaytarilmaydi
      const problems: string[] = [];
      const txById = new Map(txs.map((t) => [t.id, t]));
      let gone = 0;
      b.txIds.forEach((id, i) => {
        const t = txById.get(id);
        if (!t) { gone++; return; }
        const what = t.cancelledAt ? "bekor qilingan" : t.refType || t.projectId || t.loanId ? "hujjatga bog'langan" : txSig(t) !== b.txSigs[i] ? "tahrirlangan" : null;
        if (what) problems.push(`${txDesc(t)} — ${what}`);
      });
      for (const a of assets) { const t = txById.get(a.cashTxId!); if (t) problems.push(`${txDesc(t)} — asosiy vosita kartochkasi bog'langan`); }
      const trById = new Map(trs.map((t) => [t.id, t]));
      let goneTr = 0;
      b.transferIds.forEach((id, i) => {
        const t = trById.get(id);
        if (!t) { goneTr++; return; }
        const own = legs.filter((l) => l.refId === id).map((l) => l.id).sort().join(",");
        const what = t.cancelledAt ? "bekor qilingan" : transferSig(t) !== b.transferSigs[i] ? "tahrirlangan" : own !== [...(b.transferLegs[i] ?? [])].sort().join(",") ? "yozuvlari o'zgargan" : null;
        if (what) problems.push(`o'tkazma ${t.docNo} — ${what}`);
      });
      if (gone) problems.push(`${gone} ta yozuv jurnaldan o'chirilgan`);
      if (goneTr) problems.push(`${goneTr} ta o'tkazma o'chirilgan`);
      if (problems.length) {
        throw new CashImportError(`Import qaytarilmadi — yuklangandan keyin o'zgargan: ${problems.slice(0, 8).join("; ")}${problems.length > 8 ? `; yana ${problems.length - 8} ta` : ""}. Bu yozuvlarni Kassa jurnalida alohida tuzating yoki o'chiring`);
      }

      // Qaytarilgach hisob minusga tushmasin: kirim o'chsa pul chiqqandek, o'tkazma o'chsa qabul qiluvchidan qaytadi
      const own = [...txs, ...legs];
      const err = await balanceDropError(tx, own.map((t) => ({ accountId: t.cashAccountId, delta: -txSign(t.type) * Number(t.amount) })));
      if (err) throw new CashImportError(`Import qaytarilsa hisob minusga tushadi (pul allaqachon sarflangan). ${err}`);

      const mark = { reason: why, by: "import-rollback", batch: batchId };
      if (txs.length) {
        await tx.cashTransaction.deleteMany({ where: { id: { in: txs.map((t) => t.id) } } });
        await auditMany(tx, who.userId, "DELETE", "CashTransaction", txs.map((t) => ({ id: t.id, before: t, after: { deleted: true, ...mark } })));
      }
      for (const t of trs) {
        const mine = legs.filter((l) => l.refId === t.id);
        await tx.cashTransaction.deleteMany({ where: { id: { in: mine.map((l) => l.id) } } });
        await auditMany(tx, who.userId, "DELETE", "CashTransaction", mine.map((l) => ({ id: l.id, before: l, after: { reversed: true, transfer: t.docNo, ...mark } })));
        await tx.cashTransfer.delete({ where: { id: t.id } });
        await audit(tx, who.userId, "DELETE", "CashTransfer", t.id, t, { deleted: true, ...mark });
      }

      // Import qo'shgan kategoriyalar: avval sub manbalar, keyin manbalar — hech qayerda ishlatilmasa o'chiriladi
      const orig = new Map(b.categories.map((c) => [c.id, c]));
      const cats = (await tx.cashCategory.findMany({ where: { id: { in: b.categoryIds } } })).sort((x, y) => (x.parentId ? 0 : 1) - (y.parentId ? 0 : 1));
      const dropped: string[] = [], kept: string[] = [];
      for (const c of cats) {
        // Nomi o'zgartirilgan / alias qo'shilgan — foydalanuvchi ishlatmoqda, tegilmaydi
        if (c.isSystem || orig.get(c.id)?.name !== c.name || c.aliases.length) { kept.push(c.name); continue; }
        const like = (f: "category" | "subCategory"): Prisma.CashTransactionWhereInput => (f === "category" ? { category: { equals: c.name, mode: "insensitive" } } : { subCategory: { equals: c.name, mode: "insensitive" } });
        const used = c.parentId
          ? await tx.cashTransaction.count({ where: { OR: [like("subCategory"), like("category")] } })
          : (await Promise.all([
            tx.cashTransaction.count({ where: like("category") }),
            tx.cashCategory.count({ where: { parentId: c.id } }),
            tx.recurringPayment.count({ where: { category: c.name } }),
            tx.plannedFlow.count({ where: { category: c.name } }),
            tx.expenseBudget.count({ where: { category: c.name } }),
          ])).reduce((s, n) => s + n, 0);
        if (used) { kept.push(c.name); continue; }
        await tx.cashCategory.delete({ where: { id: c.id } });
        await audit(tx, who.userId, "DELETE", "CashCategory", c.id, c, { via: "kassa-import-qaytarish", ...mark });
        dropped.push(c.name);
      }

      await audit(tx, who.userId, "STATUS_CHANGE", CASH_IMPORT_ENTITY, batchId,
        { status: "IMPORTED", added: b.added, transfers: b.transfers, at: row.createdAt },
        { status: "ROLLED_BACK", reason: why, deleted: txs.length, transfersDeleted: trs.length, categoriesDeleted: dropped, categoriesKept: kept });
      return { txs: txs.length, trs: trs.length, dropped, kept };
    }, { timeout: 60_000, maxWait: 15_000 });
    if (res.dropped.length) resetCategoryCache();
    return {
      note: `Import qaytarildi: ${res.txs} ta yozuv${res.trs ? `, ${res.trs} ta o'tkazma` : ""} o'chirildi${res.dropped.length ? `, ${res.dropped.length} ta yangi manba / sub manba olib tashlandi` : ""}${res.kept.length ? ` · ${res.kept.join(", ")} — ishlatilmoqda, qoldirildi` : ""}`,
    };
  } catch (e) {
    if (e instanceof CashImportError) return { error: e.message };
    throw e;
  }
}
