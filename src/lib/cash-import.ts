import { db } from "@/lib/db";
import { audit, auditMany } from "@/lib/audit";
import { isoDate, money } from "@/lib/format";
import { accountBalances } from "@/lib/payments";
import { JOURNAL_ONLY, isTransfer, txSign } from "@/lib/cash-tx";
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
 *  · biror qatorda xato bo'lsa hech narsa yozilmaydi.
 */

/** Kassa jurnalida mijoz to'lovlari (`Payment`) shu manba nomi bilan ko'rinadi. */
export const SALES_MANBA = "Savdo tushumi";
export const CASH_IMPORT_MAX = 2000;

/** Fayldagi bitta qator — kalitlar import sahifasidagi maydonlar bilan bir xil. */
export type CashImportRow = Record<string, unknown>;
export type CashImportResult = { error: string } | { ok: true; added: number; skipped: number; transfers: number; newSubs: string[]; newTops: string[]; from: Date; to: Date };

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

export async function importCashEntries(rows: CashImportRow[], opts: { defaultAccountId: string; maps: ValueMaps }, userId: string): Promise<CashImportResult> {
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
      for (const t of tops) {
        const c = await tx.cashCategory.create({ data: { name: t.name, type: t.type, flow: t.flow, pnlLine: t.pnlLine, sort: t.sort } });
        realId.set(t.id, c.id);
        await audit(tx, userId, "CREATE", "CashCategory", c.id, undefined, { ...c, via: "kassa-import" });
      }
      const subs = [...newSubs.values()].filter((n) => fresh.some((f) => f.subCategory === n.name));
      for (const n of subs) {
        const parent = cats.find((c) => c.id === n.parentId) ?? tops.find((t) => t.id === n.parentId)!;
        const c = await tx.cashCategory.create({ data: { name: n.name, type: parent.type, parentId: realId.get(parent.id) ?? parent.id, flow: parent.flow, pnlLine: parent.pnlLine } });
        await audit(tx, userId, "CREATE", "CashCategory", c.id, undefined, { ...c, via: "kassa-import" });
      }

      const created = fresh.length ? await tx.cashTransaction.createManyAndReturn({ data: fresh.map((f) => ({ ...f, createdById: userId })) }) : [];
      await auditMany(tx, userId, "CREATE", "CashTransaction", created.map((t) => ({ id: t.id, after: t })));
      for (const p of pairs) {
        const from = accById.get(p.out.accountId)!, to = accById.get(p.in.accountId)!;
        const note = [p.out.leg!.note, p.in.leg!.note].find(Boolean) ?? null;
        const { t, outTx, inTx } = await insertTransfer(tx, { date: p.out.date, from, to, amount: p.out.leg!.amount, note }, userId);
        await audit(tx, userId, "CREATE", "CashTransfer", t.id, undefined, { ...t, legs: [outTx.id, inTx.id], via: "kassa-import" });
      }
      return { added: created.length, skipped, transfers: pairs.length, newSubs: subs.map((n) => n.name), newTops: tops.map((t) => t.name) };
    }, { timeout: 60_000, maxWait: 15_000 });
    if (res.newSubs.length || res.newTops.length) resetCategoryCache();
    return { ok: true, ...res, from, to };
  } catch (e) {
    if (e instanceof CashImportError) return { error: e.message };
    throw e;
  }
}
