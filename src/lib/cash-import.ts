import { db } from "@/lib/db";
import { auditMany } from "@/lib/audit";
import { isoDate, money } from "@/lib/format";
import { accountBalances } from "@/lib/payments";
import { JOURNAL_ONLY, isTransfer, txSign } from "@/lib/cash-tx";
import { PEREKIT_CATEGORY } from "@/lib/cash-categories";
import { MAX_AMOUNT } from "@/lib/action";
import { matchKey, numMoney, parseDate, str, valueMapper, type ValueMaps } from "@/lib/excel";
import { loadCategories, makeResolver, normCat } from "@/lib/fin-report/categories";

/**
 * Kassa / bank → «Excel orqali qo'shish»: Kassa jurnali ustunlaridagi fayl (Sana, Hisob, Kirim, Chiqim, Manba,
 * Sub manba, Kontragent, Izoh) → qo'lda kirim/chiqim yozuvlari (`CashTransaction`), Kirim-Chiqim formasidagi qoidalar bilan:
 *  · Manba — kategoriya daraxtidagi nom (yoki aliasi), yozuv turiga mos; Sub manba — shu manbaniki;
 *  · kredit / loyiha so'raydigan manba importda yozilmaydi (formada kredit yoki loyiha tanlanadi);
 *  · «Savdo tushumi» (mijoz to'lovi) va «Perekit» — o'z hujjatidan: jurnalda bor bo'lsa o'tkaziladi, yo'q bo'lsa xato;
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
export type CashImportResult = { error: string } | { ok: true; added: number; skipped: number; from: Date; to: Date };

type Fresh = {
  date: Date; type: "INCOME" | "EXPENSE"; cashAccountId: string; amount: number;
  category: string; subCategory: string | null; counterparty: string | null; note: string | null;
};
/** Fayl qatori: oddiy kirim/chiqim yoki faqat jurnalda borligi tekshiriladigan mijoz to'lovi / perekit. */
type Parsed = { no: number; date: Date; accountId: string; key: string; data: Fresh | null };

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
    // Mijoz to'lovi va perekit oddiy kirim/chiqim emas — faqat jurnalda borligi tekshiriladi
    const special = normCat(manba) === normCat(SALES_MANBA) ? SALES_MANBA : normCat(manba) === normCat(PEREKIT_CATEGORY) ? PEREKIT_CATEGORY : null;
    if (special) { parsed.push({ no: i + 1, date, accountId: acc.id, key: rowKey(date, acc.id, sign, amount, special), data: null }); return; }

    const sub = cell("sub");
    const base = resolve(manba);
    if (!base) return fail(`«${manba}» — bunday manba yo'q (moslang yoki Moliya → Kategoriyalarda qo'shing)`);
    const r = sub ? resolve(manba, sub) : base;
    if (sub && (!r?.sub || r.top.id !== base.top.id)) return fail(`«${sub}» — «${base.top.name}» ichida bunday sub manba yo'q`);
    const top = r!.top;
    if (top.type !== type) return fail(`«${top.name}» — ${top.type === "INCOME" ? "kirim" : "chiqim"} manbasi, summa esa ${type === "INCOME" ? "Kirim" : "Chiqim"} ustunida`);
    if (!top.isActive) return fail(`«${top.name}» manbasi o'chirilgan`);
    if (top.needs === "LOAN" || top.needs === "PROJECT") return fail(`«${top.name}» — ${top.needs === "LOAN" ? "kredit" : "loyiha"} tanlanadi: Kirim-Chiqim formasida kiriting`);
    parsed.push({
      no: i + 1, date, accountId: acc.id, key: rowKey(date, acc.id, sign, amount, top.name),
      data: { date, type, cashAccountId: acc.id, amount, category: top.name, subCategory: r!.sub?.name ?? null, counterparty: cell("who") || null, note: cell("note") || null },
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
      const missing: string[] = [];
      let skipped = 0;
      for (const p of parsed) {
        const n = have.get(p.key) ?? 0;
        if (n > 0) { have.set(p.key, n - 1); skipped++; continue; }
        if (p.data) fresh.push(p.data);
        else missing.push(`${p.no}-qator`);
      }
      if (missing.length) {
        throw new CashImportError(`${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` va yana ${missing.length - 5} ta` : ""}: «${SALES_MANBA}» yoki «${PEREKIT_CATEGORY}» jurnalda yo'q — mijoz to'lovini To'lovlar tabida, perekitni Kirim-Chiqim → «Kassa ⇄ bank» orqali kiriting yoki qatorni fayldan olib tashlang. Hech narsa yozilmadi`);
      }
      if (!fresh.length) return { added: 0, skipped };

      // Import tugagach hisob minusga tushmasin (naqd kassa — har doim, bank — overdraft ruxsati bo'lmasa)
      const balances = await accountBalances(tx, accIds);
      for (const id of accIds) {
        const a = accById.get(id)!;
        if (a.type === "BANK" && a.allowOverdraft) continue;
        const delta = fresh.filter((f) => f.cashAccountId === id).reduce((s, f) => s + (f.type === "INCOME" ? f.amount : -f.amount), 0);
        const left = (balances.get(id) ?? 0) + delta;
        if (delta < 0 && left < -0.005) {
          throw new CashImportError(`${a.name} ${a.type === "CASH" ? "kassasi" : "hisobi"} minusga tushadi: hozirgi qoldiq ${money(balances.get(id) ?? 0)}, import bilan ${money(left)}. Hech narsa yozilmadi`);
        }
      }

      const created = await tx.cashTransaction.createManyAndReturn({ data: fresh.map((f) => ({ ...f, createdById: userId })) });
      await auditMany(tx, userId, "CREATE", "CashTransaction", created.map((t) => ({ id: t.id, after: t })));
      return { added: created.length, skipped };
    }, { timeout: 60_000, maxWait: 15_000 });
    return { ok: true, ...res, from, to };
  } catch (e) {
    if (e instanceof CashImportError) return { error: e.message };
    throw e;
  }
}
