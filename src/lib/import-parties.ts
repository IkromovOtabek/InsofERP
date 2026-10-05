import { db } from "./db";
import { audit } from "./audit";
import { flatName, numMoney, str } from "./excel";
import { normalizePhone } from "./phone";
import { DEFAULT_CREDIT_LIMIT } from "./finance";
import { INN_ERROR, parseInn } from "./inn";

/**
 * Excel'dan mijozlar / yetkazuvchilar ro'yxati (real korxona ma'lumotini ko'chirish).
 * Ustunlar: Nomi · INN · Telefon · Manzil · Mas'ul shaxs · (mijozda) Kredit limit.
 *
 * Takroriylik (dedupe) tartibi: INN → telefon → nomi. Bazada topilsa yangi karta ochilmaydi:
 * "yangilash" belgilangan bo'lsa bo'sh bo'lmagan kataklar kartaga yoziladi, aks holda qator o'tkazib yuboriladi.
 * Faylning o'zida takrorlangan qator ham bitta karta bo'ladi. Xato bo'lsa — qator raqami bilan, hech narsa yozilmaydi.
 */
export type PartyRow = { name?: unknown; inn?: unknown; phone?: unknown; address?: unknown; contactPerson?: unknown; creditLimit?: unknown };
export type PartyKind = "customer" | "supplier";
export type ImportPartiesResult = { created: number; updated: number; skipped: number; dupInFile: number; samples: string[] };

type Prepared = { no: number; name: string; inn: string | null; phone: string | null; address: string | null; contactPerson: string | null; creditLimit: number | null };


function prepare(rows: PartyRow[], kind: PartyKind): Prepared[] {
  const errors: string[] = [];
  const out: Prepared[] = [];
  for (const [i, x] of rows.entries()) {
    const no = i + 1;
    const name = str(x.name).replace(/\s+/g, " ");
    if (!name) { if ([x.inn, x.phone, x.address].some((v) => str(v) !== "")) errors.push(`${no}-qator: nomi yo'q`); continue; }
    // INN — 9 (STIR) yoki 14 (JSHSHIR) raqam; bo'sh joylar olib tashlanadi, boshqa belgi bo'lsa — xato
    const innR = parseInn(str(x.inn));
    if (innR.error !== undefined) errors.push(`${no}-qator (${name}): ${INN_ERROR} — «${str(x.inn)}»`);
    const inn = innR.inn ?? null;
    const rawPhone = str(x.phone);
    let creditLimit: number | null = null;
    if (kind === "customer" && str(x.creditLimit) !== "") {
      const n = numMoney(x.creditLimit);
      if (!Number.isFinite(n) || n < 0) errors.push(`${no}-qator (${name}): kredit limit raqam bo'lsin — «${str(x.creditLimit)}»`);
      else creditLimit = n;
    }
    out.push({
      no, name, inn,
      // Raqam O'zbekiston ko'rinishiga keltiriladi; keltirib bo'lmasa fayldagicha qoladi
      phone: rawPhone ? normalizePhone(rawPhone) ?? rawPhone : null,
      address: str(x.address) || null,
      contactPerson: str(x.contactPerson) || null,
      creditLimit,
    });
  }
  if (errors.length) throw new Error(`${errors.length} ta qatorda xato: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? "…" : ""}`);
  if (!out.length) throw new Error("Faylda qator topilmadi");
  return out;
}

export async function importParties(kind: PartyKind, rows: PartyRow[], opts: { updateExisting: boolean; canSetLimit: boolean }, userId: string): Promise<ImportPartiesResult> {
  const list = prepare(rows, kind);
  const entity = kind === "customer" ? "Customer" : "Supplier";

  return db.$transaction(async (tx) => {
    type Found = { id: string; name: string; inn: string | null; phone: string | null };
    const all: Found[] = kind === "customer"
      ? await tx.customer.findMany({ where: { isInternal: false }, select: { id: true, name: true, inn: true, phone: true } })
      : await tx.supplier.findMany({ select: { id: true, name: true, inn: true, phone: true } });
    const byInn = new Map<string, Found>(), byPhone = new Map<string, Found>(), byName = new Map<string, Found>();
    const index = (f: Found) => {
      if (f.inn) byInn.set(f.inn.replace(/\D+/g, ""), f);
      const p = f.phone ? normalizePhone(f.phone) ?? f.phone : null;
      if (p) byPhone.set(p, f);
      if (!byName.has(flatName(f.name))) byName.set(flatName(f.name), f);
    };
    all.forEach(index);

    let created = 0, updated = 0, skipped = 0, dupInFile = 0;
    const touched = new Set<string>();
    const samples: string[] = [];
    for (const r of list) {
      // INN bor bo'lsa — faqat INN bo'yicha (boshqa INN li namesake — boshqa korxona); aks holda telefon, keyin nom
      const cur = r.inn
        ? byInn.get(r.inn) ?? (() => { const n = byName.get(flatName(r.name)); return n && !n.inn ? n : undefined; })()
        : (r.phone ? byPhone.get(r.phone) : undefined) ?? byName.get(flatName(r.name));
      if (cur) {
        if (touched.has(cur.id)) dupInFile++;
        if (!opts.updateExisting) { skipped++; if (samples.length < 5) samples.push(`${r.no}-qator «${r.name}» → bazada «${cur.name}»`); continue; }
        // INN boshqa kartada band bo'lsa yozilmaydi (unique)
        const innFree = !r.inn || !byInn.has(r.inn) || byInn.get(r.inn)!.id === cur.id;
        const patch = {
          ...(r.inn && innFree ? { inn: r.inn } : {}),
          ...(r.phone ? { phone: r.phone } : {}),
          ...(r.address ? { address: r.address } : {}),
          ...(r.contactPerson ? { contactPerson: r.contactPerson } : {}),
          ...(kind === "customer" && r.creditLimit != null && opts.canSetLimit ? { creditLimit: r.creditLimit } : {}),
        };
        if (Object.keys(patch).length) {
          const before = kind === "customer" ? await tx.customer.findUniqueOrThrow({ where: { id: cur.id } }) : await tx.supplier.findUniqueOrThrow({ where: { id: cur.id } });
          const after = kind === "customer" ? await tx.customer.update({ where: { id: cur.id }, data: patch }) : await tx.supplier.update({ where: { id: cur.id }, data: patch });
          await audit(tx, userId, "UPDATE", entity, cur.id, before, { ...after, via: "excel" });
          if (!touched.has(cur.id)) updated++;
          index({ id: after.id, name: after.name, inn: after.inn, phone: after.phone });
        } else if (!touched.has(cur.id)) skipped++;
        touched.add(cur.id);
        continue;
      }
      const base = { name: r.name, inn: r.inn, phone: r.phone, address: r.address, contactPerson: r.contactPerson };
      const c = kind === "customer"
        // Limitni faqat buxgalteriya/finance/direktor belgilaydi — boshqalar uchun standart limit
        ? await tx.customer.create({ data: { ...base, creditLimit: opts.canSetLimit && r.creditLimit != null ? r.creditLimit : DEFAULT_CREDIT_LIMIT } })
        : await tx.supplier.create({ data: base });
      await audit(tx, userId, "CREATE", entity, c.id, undefined, { ...c, via: "excel" });
      created++;
      touched.add(c.id);
      index({ id: c.id, name: c.name, inn: c.inn, phone: c.phone });
    }
    return { created, updated, skipped, dupInFile, samples };
  }, { timeout: 120_000, maxWait: 20_000 });
}
