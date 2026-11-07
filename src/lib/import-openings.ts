import { db } from "./db";
import { audit } from "./audit";
import { MAX_AMOUNT } from "./action";
import { DEBT_SKIP_ROW, flatName, matchKey, nameIndex, num, numMoney, parseDate, str } from "./excel";
import { defaultCreditLimit } from "./finance";
import { isoDate, money } from "./format";
import { INN_ERROR, parseInn } from "./inn";
import { customerBalances } from "./receivables";
import { supplierPositions } from "./fin-report/balance";
import { createOpeningTx, cancelOpeningTx, updateOpeningTx, activeKeyOf, lockOpening, openingDay, OpeningError, type OpeningInput } from "./opening-balances";

/**
 * Boshlang'ich qoldiqlarni Excel'dan yuklash:
 *   CASH:     Hisob (kassa/bank nomi) · Summa · Izoh
 *   STOCK:    Mahsulot (kod yoki nomi) · Sklad · Miqdor · Tannarx · Izoh
 *   CUSTOMER / SUPPLIER — `importDebtBalances` (sana-sana qoldiq, kunlik jadval ham).
 *
 * Avval hamma qator tekshiriladi (obyekt topiladimi, summa to'g'rimi); bitta xato bo'lsa ham hech narsa
 * yozilmaydi — xatolar qator raqami bilan qaytadi. Shu obyektga qoldiq oldin kiritilgan bo'lsa — o'tkazib
 * yuboriladi (ikki marta yozilmaydi) va hisobotda ko'rsatiladi.
 */
export type OpeningRow = { name?: unknown; inn?: unknown; date?: unknown; amount?: unknown; kirim?: unknown; chiqim?: unknown; warehouse?: unknown; qty?: unknown; unitCost?: unknown; note?: unknown };
export type ImportOpeningsResult = { created: number; skipped: string[]; total: number };

const cut = (l: string[], n = 8) => `${l.slice(0, n).join("; ")}${l.length > n ? `… (jami ${l.length} ta)` : ""}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function importOpenings(
  kind: "CASH" | "STOCK",
  rows: OpeningRow[],
  opts: { date: Date; warehouseId: string | null },
  userId: string,
): Promise<ImportOpeningsResult> {
  const errors: string[] = [];
  type Plan = { no: number; label: string; input: OpeningInput };
  const plans: Plan[] = [];

  // Spravochniklar bir marta o'qiladi
  const [accounts, products, warehouses] = await Promise.all([
    kind === "CASH" ? db.cashAccount.findMany({ select: { id: true, name: true, type: true, allowOverdraft: true } }) : [],
    kind === "STOCK" ? db.product.findMany({ select: { id: true, code: true, name: true } }) : [],
    kind === "STOCK" ? db.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true } }) : [],
  ]);
  const accByName = new Map(accounts.map((a) => [flatName(a.name), a]));
  const prodByCode = new Map(products.map((p) => [p.code.toLowerCase(), p]));
  const prodByName = new Map(products.map((p) => [flatName(p.name), p]));
  const whByName = new Map(warehouses.map((w) => [flatName(w.name), w]));
  const seen = new Map<string, number>(); // faylning o'zida bitta obyekt ikki marta

  for (const [i, x] of rows.entries()) {
    const no = i + 1;
    const name = str(x.name).replace(/\s+/g, " ");
    if (!name && [x.amount, x.qty].every((v) => str(v) === "")) continue; // bo'sh qator
    if (!name) { errors.push(`${no}-qator: nomi yo'q`); continue; }
    const note = str(x.note) || null;
    const base = { kind, date: opts.date, note };

    if (kind === "CASH") {
      const amount = numMoney(x.amount);
      if (!Number.isFinite(amount) || amount === 0) { errors.push(`${no}-qator (${name}): summa raqam va 0 dan farqli bo'lsin — «${str(x.amount)}»`); continue; }
      const acc = accByName.get(flatName(name));
      if (!acc) { errors.push(`${no}-qator: «${name}» hisobi topilmadi (bor hisoblar: ${accounts.map((a) => a.name).join(", ") || "yo'q"} — yangisini Sozlamalarda oching)`); continue; }
      if (seen.has(acc.id)) { errors.push(`${no}-qator: «${name}» faylda ${seen.get(acc.id)}-qatorda ham bor`); continue; }
      // Manfiy qoldiq — faqat overdraft ruxsat etilgan bankda (aks holda yozishda butun import qator raqamisiz yiqilardi)
      if (amount < 0 && !(acc.type === "BANK" && acc.allowOverdraft)) { errors.push(`${no}-qator (${acc.name}): qoldiq manfiy bo'lolmaydi — overdraft faqat ruxsat etilgan bank hisobida`); continue; }
      seen.set(acc.id, no);
      plans.push({ no, label: acc.name, input: { ...base, cashAccountId: acc.id, amount } });
      continue;
    }
    // STOCK
    const p = prodByCode.get(name.toLowerCase()) ?? prodByName.get(flatName(name));
    if (!p) { errors.push(`${no}-qator: «${name}» mahsuloti topilmadi (nomi bo'yicha)`); continue; }
    const whName = str(x.warehouse);
    const wh = whName ? whByName.get(flatName(whName)) : warehouses.find((w) => w.id === opts.warehouseId);
    if (!wh) { errors.push(`${no}-qator (${name}): sklad ${whName ? `«${whName}» topilmadi` : "tanlanmagan — formada standart skladni tanlang"}`); continue; }
    const qty = num(x.qty);
    if (!Number.isFinite(qty) || qty <= 0) { errors.push(`${no}-qator (${name}): miqdor 0 dan katta raqam bo'lsin — «${str(x.qty)}»`); continue; }
    let unitCost: number | null = null;
    if (str(x.unitCost) !== "") {
      unitCost = numMoney(x.unitCost);
      if (!Number.isFinite(unitCost) || unitCost < 0) { errors.push(`${no}-qator (${name}): tannarx raqam bo'lsin — «${str(x.unitCost)}»`); continue; }
    }
    const k = `${p.id}:${wh.id}`;
    if (seen.has(k)) { errors.push(`${no}-qator: «${p.name}» (${wh.name}) faylda ${seen.get(k)}-qatorda ham bor`); continue; }
    seen.set(k, no);
    plans.push({ no, label: `${p.name} · ${wh.name}`, input: { ...base, productId: p.id, warehouseId: wh.id, qty, unitCost } });
  }

  if (errors.length) throw new OpeningError(`${errors.length} ta qatorda xato — hech narsa yozilmadi: ${cut(errors)}`);
  if (!plans.length) throw new OpeningError("Faylda qator topilmadi");

  return db.$transaction(async (tx) => {
    let created = 0;
    const skipped: string[] = [];
    for (const p of plans) {
      const exists = await tx.openingBalance.findUnique({ where: { activeKey: activeKeyOf(p.input) }, select: { id: true } });
      if (exists) { skipped.push(`${p.no}-qator ${p.label}`); continue; }
      await createOpeningTx(tx, p.input, userId);
      created++;
    }
    return { created, skipped, total: plans.length };
  }, { timeout: 180_000, maxWait: 20_000 });
}

// ───────────────────────── Mijoz / yetkazuvchi qarzi (sana-sana) ─────────────────────────

export type DebtImportOpts = {
  /** «Sana» ustuni bo'lmagan qatorlar uchun (YYYY-MM-DD) */
  date: string | null;
  createMissing: boolean;
  /** Exceldagi summalar birligi: 1 — so'm, 1 000 — ming so'm, 1 000 000 — mln so'm */
  scale: number;
  /** Exceldagi minus — mijoz qarzi / bizning qarzimiz (tizimda qarz musbat), ya'ni ishora teskari */
  flip: boolean;
};
export type DebtImportResult = {
  parties: number; created: number; updated: number; removed: number; same: number;
  createdEntities: string[]; noDebt: string[]; future: string[];
};

const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
/** Kun oxiri (server vaqti) — qarz varaqlari ham kunni shunday yopadi (`fin-report/debts.ts`). */
const endOfDay = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d + 1); };

/**
 * Mijoz / yetkazuvchi qarzi Excel'dan — har qator «shu sana oxiridagi qoldiq»:
 *   Nomi · INN · Sana · Qoldiq (· Kirim · Chiqim · Izoh); kunlik jadval klientda shu ro'yxatga yoyiladi.
 * Tizimdagi qarz har sanada Exceldagiga tenglanadi: yozuv = qoldiq − tizimdagi boshqa hujjatlar (schyot, to'lov,
 * kirim, chiqim) − shu sanagacha bo'lgan oldingi yozuvlar. Bir obyektga bir kunda bitta yozuv: fayl qayta yuklansa
 * o'sha kunlar qayta hisoblanadi (o'zgarmagani tegilmaydi, farq 0 bo'lsa yozuv olib tashlanadi) — ikki marta yozilmaydi.
 * Bazada yo'q nom — yangi karta (`createMissing`); butun davrda qarzi 0 bo'lsa karta ochilmaydi.
 * Avval hamma qator tekshiriladi; bitta xato bo'lsa ham hech narsa yozilmaydi.
 */
export async function importDebtBalances(kind: "CUSTOMER" | "SUPPLIER", rows: OpeningRow[], opts: DebtImportOpts, userId: string): Promise<DebtImportResult> {
  const isCust = kind === "CUSTOMER";
  const errors: string[] = [];
  const today = isoDate(new Date());
  const party: { id: string; name: string; inn: string | null; aliases?: string[] }[] = isCust
    ? await db.customer.findMany({ where: { isInternal: false }, select: { id: true, name: true, inn: true, aliases: true } })
    : await db.supplier.findMany({ select: { id: true, name: true, inn: true } });
  const byInn = new Map(party.filter((p) => p.inn).map((p) => [p.inn!.replace(/\D+/g, ""), p]));
  const byName = nameIndex(party);
  // Yozuvi boshqacha bir xil nom: «Rahmatillo» = «Raxmatillo», «Ҳонгхинг» = «Xongxing»
  const byKey = new Map<string, (typeof party)[number]>();
  for (const p of party) for (const n of [p.name, ...(p.aliases ?? [])]) { const k = matchKey(n); if (k && !byKey.has(k)) byKey.set(k, p); }
  // Birlik so'mdan katta bo'lsa «6.888» — kasr (mln), so'mda esa «450.000» — minglik nuqta
  const parse = opts.scale === 1 ? numMoney : num;
  const sign = opts.flip ? -1 : 1;

  type Day = { iso: string; target: number; no: number; kirim: number | null; chiqim: number | null; note: string | null };
  type Group = { label: string; id: string | null; create: { name: string; inn: string | null } | null; days: Map<string, Day> };
  const groups = new Map<string, Group>();
  const future = new Set<string>();
  let maxAbs = 0;
  for (const [i, x] of rows.entries()) {
    const no = i + 1;
    const name = str(x.name).replace(/\s+/g, " ");
    if (!name && str(x.amount) === "") continue; // bo'sh qator
    if (!name) { errors.push(`${no}-qator: nomi yo'q`); continue; }
    if (DEBT_SKIP_ROW.test(name)) continue; // «Jami», «Inkassa» — mijoz emas
    // Sana — fayldagi «Sana» ustunidan, bo'lmasa formadagi sana
    let iso = opts.date ?? "";
    if (str(x.date) !== "") {
      const d = parseDate(x.date);
      if (!d) { errors.push(`${no}-qator (${name}): sana o'qilmadi — «${str(x.date)}»`); continue; }
      iso = isoDate(d);
    }
    if (!iso) { errors.push(`${no}-qator (${name}): sana yo'q — faylda «Sana» ustuni bo'lsin yoki formada sanani kiriting`); continue; }
    if (iso > today) { future.add(iso); continue; }
    const raw = parse(x.amount);
    if (!Number.isFinite(raw)) { errors.push(`${no}-qator (${name}): qoldiq raqam bo'lsin — «${str(x.amount)}»`); continue; }
    const target = r2(raw * opts.scale * sign);
    if (Math.abs(target) > MAX_AMOUNT) { errors.push(`${no}-qator (${name}): summa juda katta — birlikni tekshiring`); continue; }
    maxAbs = Math.max(maxAbs, Math.abs(target));
    // INN — 9 (STIR) yoki 14 (JSHSHIR) raqam (bazada yo'q bo'lsa shu INN bilan yaratiladi)
    const innR = parseInn(str(x.inn));
    if (innR.error !== undefined) { errors.push(`${no}-qator (${name}): ${INN_ERROR} — «${str(x.inn)}»`); continue; }
    const inn = innR.inn;
    const found = (inn ? byInn.get(inn) : undefined) ?? byName.get(flatName(name)) ?? byKey.get(matchKey(name));
    const k = found ? found.id : `new:${inn ?? (matchKey(name) || flatName(name))}`;
    let g = groups.get(k);
    if (!g) { g = { label: found?.name ?? name, id: found?.id ?? null, create: found ? null : { name, inn }, days: new Map() }; groups.set(k, g); }
    const dup = g.days.get(iso);
    if (dup) { errors.push(`${no}-qator: «${name}» ${dmy(iso)} sanasi faylda ${dup.no}-qatorda ham bor — bitta qatorga jamlang`); continue; }
    const extra = (v: unknown) => { const n = str(v) === "" ? NaN : parse(v); return Number.isFinite(n) && n !== 0 ? r2(n * opts.scale) : null; };
    g.days.set(iso, { iso, target, no, kirim: extra(x.kirim), chiqim: extra(x.chiqim), note: str(x.note) || null });
  }
  if (!opts.createMissing) {
    for (const g of groups.values()) if (g.create) errors.push(`${[...g.days.values()][0]?.no}-qator: «${g.label}» bazada yo'q («bazada yo'qlarini ochish»ni belgilang)`);
  }
  if (errors.length) throw new OpeningError(`${errors.length} ta qatorda xato — hech narsa yozilmadi: ${cut(errors)}`);
  // Birlik noto'g'ri tanlangan: so'mda hamma qarz 100 000 dan kichik (fayl mln/ming so'mda) yoki mln/ming bilan 1 trln dan katta (fayl so'mda)
  if (opts.scale === 1 && maxAbs > 0 && maxAbs < 100_000) {
    throw new OpeningError(`Summalar juda kichik (eng kattasi ${money(maxAbs)}) — Excel mln so'mda bo'lsa «Summalar birligi»ni «mln so'm» qiling`);
  }
  if (opts.scale > 1 && maxAbs >= 1e12) {
    throw new OpeningError(`Summalar juda katta (eng kattasi ${money(maxAbs)}) — Excel so'mda bo'lsa «Summalar birligi»ni «so'm» qiling`);
  }
  // Bazada yo'q va butun davrda qarzi 0 — karta ochilmaydi
  const noDebt: string[] = [];
  for (const [k, g] of groups) if (g.create && [...g.days.values()].every((d) => Math.abs(d.target) < 0.005)) { noDebt.push(g.label); groups.delete(k); }
  if (!groups.size && !noDebt.length && !future.size) throw new OpeningError("Faylda qator topilmadi");

  // Mavjud yozuvlar (yuklashdan oldingi holat)
  const ids = [...groups.values()].flatMap((g) => (g.id ? [g.id] : []));
  const entriesBefore = new Map<string, { date: Date; amount: number }[]>();
  if (ids.length) {
    const list = await db.openingBalance.findMany({ where: { kind, cancelledAt: null, ...(isCust ? { customerId: { in: ids } } : { supplierId: { in: ids } }) }, select: { customerId: true, supplierId: true, date: true, amount: true } });
    for (const e of list) { const id = (e.customerId ?? e.supplierId)!; entriesBefore.set(id, [...(entriesBefore.get(id) ?? []), { date: e.date, amount: Number(e.amount) }]); }
  }
  // Fayl oralig'idagi (birinchi va oxirgi sana orasi), lekin faylda sanasi yo'q eski yozuv — o'sha kungi qoldiq
  // oldingi sananikidek (kunlik jadvalda harakatsiz kun tashlab ketiladi): yozuv qayta hisoblanadi, oraliq kunlar ham to'g'ri
  for (const g of groups.values()) {
    if (!g.id) continue;
    const days = [...g.days.values()].sort((a, b) => a.iso.localeCompare(b.iso));
    const first = days[0].iso, last = days[days.length - 1].iso;
    for (const e of entriesBefore.get(g.id) ?? []) {
      const iso = openingDay(e.date);
      if (iso <= first || iso >= last || g.days.has(iso)) continue;
      const prev = days.filter((d) => d.iso < iso).at(-1)!;
      g.days.set(iso, { ...prev, iso, kirim: null, chiqim: null, note: null });
    }
  }
  // Tizimdagi qarz har sana oxirida (yozuvlar bilan) — yozuvlarni ayirsak «boshqa hujjatlar» qoladi
  const isos = [...new Set([...groups.values()].flatMap((g) => [...g.days.keys()]))].sort();
  if (isos.length > 400) throw new OpeningError(`Faylda ${isos.length} xil sana — bir yuklashda 400 tagacha (faylni bo'lib yuklang)`);
  const book = new Map<string, Map<string, number>>();
  if (ids.length) {
    for (let i = 0; i < isos.length; i += 8) {
      await Promise.all(isos.slice(i, i + 8).map(async (iso) => {
        const asOf = endOfDay(iso);
        book.set(iso, isCust
          ? new Map([...(await customerBalances({ asOf, ids })).values()].map((b) => [b.customerId, b.balance]))
          : await supplierPositions(asOf));
      }));
    }
  }
  const sumUpTo = (l: { date: Date; amount: number }[], end: Date) => l.reduce((s, e) => (e.date < end ? s + e.amount : s), 0);
  const who = isCust ? ["qarz", "avans"] : ["qarzimiz", "avansimiz"];
  const noteOf = (d: Day) => [
    `Excel: ${dmy(d.iso)} kun oxiri ${who[d.target < 0 ? 1 : 0]} ${money(Math.abs(d.target))}`,
    d.kirim != null ? `kirim ${money(d.kirim)}` : "", d.chiqim != null ? `chiqim ${money(d.chiqim)}` : "", d.note ?? "",
  ].filter(Boolean).join(" · ");

  return db.$transaction(async (tx) => {
    const res: DebtImportResult = { parties: groups.size, created: 0, updated: 0, removed: 0, same: 0, createdEntities: [], noDebt, future: [...future].sort() };
    // Yangi mijozga standart limit (Sozlamalar → Limitlar) — bir marta, faqat ochiladigan mijoz bo'lsa o'qiladi
    const defLimit = isCust && [...groups.values()].some((g) => g.create) ? await defaultCreditLimit(tx) : 0;
    for (const g of groups.values()) {
      // Yangi mijoz/yetkazuvchi — import davomida ochiladi (faqat nomi va INN; qolganini keyin kartadan)
      if (g.create) {
        const c = isCust
          ? await tx.customer.create({ data: { name: g.create.name, inn: g.create.inn, creditLimit: defLimit } })
          : await tx.supplier.create({ data: { name: g.create.name, inn: g.create.inn } });
        await audit(tx, userId, "CREATE", isCust ? "Customer" : "Supplier", c.id, undefined, { ...c, via: "opening-import" });
        g.id = c.id;
        res.createdEntities.push(c.name);
      }
      const ref = isCust ? { kind, customerId: g.id } : { kind, supplierId: g.id };
      await lockOpening(tx, ref);
      // Joriy yozuvlar — qulf ostida qayta o'qiladi; shu yuklashda o'zgarganlari ham shu ro'yxatda yangilanadi
      const cur = (await tx.openingBalance.findMany({ where: { kind, cancelledAt: null, ...(isCust ? { customerId: g.id } : { supplierId: g.id }) }, select: { id: true, date: true, amount: true } }))
        .map((e) => ({ id: e.id, date: e.date, amount: Number(e.amount) }));
      const before = entriesBefore.get(g.id!) ?? [];
      for (const d of [...g.days.values()].sort((a, b) => a.iso.localeCompare(b.iso))) {
        const end = endOfDay(d.iso);
        const other = g.create ? 0 : (book.get(d.iso)?.get(g.id!) ?? 0) - sumUpTo(before, end);
        const mine = cur.find((e) => openingDay(e.date) === d.iso);
        const prior = sumUpTo(cur.filter((e) => e !== mine), end);
        const need = r2(d.target - other - prior);
        try {
          if (Math.abs(need) < 0.005) {
            if (!mine) { res.same++; continue; }
            await cancelOpeningTx(tx, mine.id, `Excel: ${dmy(d.iso)} qoldig'i tizimdagi hujjatlarga teng`, userId);
            cur.splice(cur.indexOf(mine), 1);
            res.removed++;
          } else if (mine) {
            if (Math.abs(mine.amount - need) < 0.005) { res.same++; continue; }
            await updateOpeningTx(tx, mine.id, { date: new Date(d.iso), amount: need, note: noteOf(d) }, userId);
            mine.amount = need;
            res.updated++;
          } else {
            const o = await createOpeningTx(tx, { ...ref, date: new Date(d.iso), amount: need, note: noteOf(d) }, userId);
            cur.push({ id: o.id, date: new Date(d.iso), amount: need });
            res.created++;
          }
        } catch (e) {
          if (e instanceof OpeningError) throw new OpeningError(`${d.no}-qator («${g.label}», ${dmy(d.iso)}): ${e.message} — hech narsa yozilmadi`);
          throw e;
        }
      }
    }
    return res;
  }, { timeout: 180_000, maxWait: 20_000 });
}
