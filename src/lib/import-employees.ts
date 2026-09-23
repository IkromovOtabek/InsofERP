import { db } from "./db";
import { audit } from "./audit";
import { flatName, num, parseDate, str } from "./excel";
import { driverPositionNames, roleForPosition } from "./positions";
import { normalizePhone } from "./sms/phone";

/**
 * Excel'dan xodimlar ro'yxati (buxgalteriya tabeli ko'rinishi):
 * Сотрудник · Табельный номер · Должность · Тарифная ставка · Дата приема · Дата увольнения · Телефон · Дата рождения.
 *
 * Faylda xodimlar bo'lim (Подразделение) sarlavhalari ostida guruhlanadi: "Бригада 1" faqat F.I.O. ustunida
 * turadigan qator bo'lib keladi — u xodim emas, undan keyingi qatorlarning bo'limi (`groupRows`).
 *
 * Mavjud xodim tabel raqami, bo'lmasa F.I.O. bo'yicha topiladi: qayta yuklansa dublikat chiqmaydi, kartasi yangilanadi.
 * Bo'sh kataklar kartadagi eski qiymatni o'chirmaydi. "Дата увольнения" to'ldirilgan xodim nofaol bo'ladi
 * (logini bo'lsa — u ham bloklanadi).
 */
export type ImportEmployeeRow = {
  fullName?: unknown; tabelNo?: unknown; position?: unknown; subdivision?: unknown;
  tariffRate?: unknown; hiredAt?: unknown; firedAt?: unknown; phone?: unknown; birthDate?: unknown;
};

export type ImportEmployeesInput = {
  rows: ImportEmployeeRow[];
  /** Faqat F.I.O. ustuni to'ldirilgan qator — bo'lim sarlavhasi ("Бригада 1"), xodim emas. */
  groupRows: boolean;
  /** Lavozimi ko'rsatilmagan qatorlar shu lavozim bilan qo'shiladi (bo'sh bo'lsa — xato). */
  defaultPosition: string | null;
  /** Ro'yxatda yo'q lavozimlarni ishchi lavozim sifatida ochish. */
  createPositions: boolean;
  /** Bazada bor xodimlarning kartasini fayldagi ma'lumot bilan yangilash. */
  updateExisting: boolean;
};

export type ImportEmployeesResult = {
  created: number;
  updated: number;
  /** Bazada bor, lekin "yangilansin" belgilanmagani uchun tegilmagan xodimlar. */
  skipped: number;
  createdPositions: string[];
  groups: string[];
  /** Nofaol qilinganlar (Дата увольнения to'ldirilgan). */
  fired: number;
  /** Haydovchi lavozimidagi xodimlar — haydovchi ilovasiga (ECO) jo'natish uchun. */
  driverIds: string[];
};

type Prepared = {
  no: number; fullName: string; tabelNo: string | null; position: string; subdivision: string | null;
  tariffRate: number | null; hiredAt: Date | null; firedAt: Date | null; phone: string | null; birthDate: Date | null;
};

const cut = (l: string[], n = 8) => `${l.slice(0, n).join(", ")}${l.length > n ? `… (jami ${l.length} ta)` : ""}`;
/** "00401" va "401" bitta xodim — taqqoslashda boshidagi nollar tashlanadi. */
const tabelKey = (v: string) => v.toLowerCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");

/** Fayldagi qatorlarni tekshirib tayyorlaydi; xato bo'lsa qator raqami bilan tushuntiradi. */
function prepare(input: ImportEmployeesInput): { rows: Prepared[]; groups: string[] } {
  const out: Prepared[] = [];
  const groups: string[] = [];
  let group = ""; // oxirgi ko'rilgan bo'lim sarlavhasi

  const dateCell = (v: unknown, what: string, no: number, name: string, minYear: number) => {
    if (str(v) === "") return null;
    const d = parseDate(v, false, minYear);
    if (!d) throw new Error(`${no}-qator (${name}): ${what} o'qilmadi — «${str(v)}»`);
    return d;
  };

  for (const [i, x] of input.rows.entries()) {
    const no = i + 1;
    const fullName = str(x.fullName).replace(/\s+/g, " ");
    const own = str(x.subdivision);
    if (!fullName) { if (own) group = own; continue; } // faqat bo'lim yozilgan qator
    // Qolgan hamma katagi bo'sh, faqat ismi bor qator — bu xodim emas, bo'lim sarlavhasi
    const filled = [x.tabelNo, x.position, x.tariffRate, x.hiredAt, x.firedAt, x.phone, x.birthDate].some((v) => str(v) !== "");
    if (input.groupRows && !own && !filled) {
      group = fullName;
      if (!groups.includes(fullName)) groups.push(fullName);
      continue;
    }

    const position = str(x.position) || input.defaultPosition || "";
    if (!position) throw new Error(`${no}-qator (${fullName}): lavozim yo'q — "Должность" ustunini moslang yoki standart lavozimni tanlang`);

    let tariffRate: number | null = null;
    if (str(x.tariffRate) !== "") {
      const n = num(x.tariffRate);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${no}-qator (${fullName}): tarif stavka raqam bo'lsin — «${str(x.tariffRate)}»`);
      tariffRate = n;
    }

    const phone = str(x.phone);
    out.push({
      no, fullName, position,
      tabelNo: str(x.tabelNo) || null,
      subdivision: own || group || null,
      tariffRate,
      hiredAt: dateCell(x.hiredAt, "ishga kirgan sana", no, fullName, 1950),
      firedAt: dateCell(x.firedAt, "ishdan bo'shagan sana", no, fullName, 1950),
      birthDate: dateCell(x.birthDate, "tug'ilgan sana", no, fullName, 1900),
      // Raqam O'zbekiston ko'rinishiga keltiriladi; keltirib bo'lmasa fayldagicha qoladi
      phone: phone ? normalizePhone(phone) ?? phone : null,
    });
  }
  if (!out.length) throw new Error("Faylda xodim qatori topilmadi");
  return { rows: out, groups };
}

export async function importEmployees(input: ImportEmployeesInput, userId: string): Promise<ImportEmployeesResult> {
  const { rows, groups } = prepare(input);

  // Bo'lim lavozimlari (Sotuv, Buxgalteriya...) login talab qiladi — ular bu yerdan qo'shilmaydi
  const names = [...new Set(rows.map((r) => r.position))];
  const dept = names.filter((n) => roleForPosition(n));
  if (dept.length) {
    throw new Error(`Bu lavozimlar tizimga kiradigan bo'lim: ${cut(dept)} — ularni Xodimlar sahifasida login bilan qo'shing`);
  }

  const drivers = new Set((await driverPositionNames()).map((n) => n.toLowerCase()));
  const work = await db.workPosition.findMany({ select: { name: true } });
  const known = new Map(work.map((w) => [w.name.trim().toLowerCase(), w.name]));
  const missing = names.filter((n) => !known.has(n.toLowerCase()));
  if (missing.length && !input.createPositions) {
    throw new Error(`Ro'yxatda yo'q lavozim: ${cut(missing)} — "yangi lavozimlarni ochish"ni belgilang yoki Otdel kadr → Ishchi lavozimlar da qo'shing`);
  }

  return db.$transaction(async (tx) => {
    // Yangi lavozimlar ro'yxat oxiriga qo'shiladi (haydovchi emas deb — kerak bo'lsa kadr o'zi belgilaydi)
    const last = await tx.workPosition.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    let order = (last?.sortOrder ?? 0) + 10;
    for (const name of missing) {
      const p = await tx.workPosition.create({ data: { name, sortOrder: order, note: "Excel importda ochildi" } });
      await audit(tx, userId, "CREATE", "WorkPosition", p.id, undefined, p);
      known.set(name.toLowerCase(), p.name);
      order += 10;
    }

    const all = await tx.employee.findMany({ select: { id: true, fullName: true, tabelNo: true, isActive: true, userId: true } });
    type Found = (typeof all)[number];
    const byTabel = new Map<string, Found>();
    const byName = new Map<string, Found>();
    for (const e of all) {
      if (e.tabelNo) byTabel.set(tabelKey(e.tabelNo), e);
      if (!byName.has(flatName(e.fullName))) byName.set(flatName(e.fullName), e);
    }

    let created = 0, updated = 0, skipped = 0, fired = 0;
    const driverIds: string[] = [];
    for (const r of rows) {
      const position = known.get(r.position.toLowerCase()) ?? r.position;
      const isActive = !r.firedAt;
      const cur = (r.tabelNo ? byTabel.get(tabelKey(r.tabelNo)) : undefined) ?? byName.get(flatName(r.fullName));

      if (cur) {
        if (!input.updateExisting) { skipped++; continue; }
        const before = await tx.employee.findUniqueOrThrow({ where: { id: cur.id } });
        // Fayldagi bo'sh katak kartadagi qiymatni o'chirmaydi
        const e = await tx.employee.update({
          where: { id: cur.id },
          data: {
            position, isActive,
            ...(r.tabelNo ? { tabelNo: r.tabelNo } : {}),
            ...(r.subdivision ? { subdivision: r.subdivision } : {}),
            ...(r.tariffRate != null ? { tariffRate: r.tariffRate } : {}),
            ...(r.phone ? { phone: r.phone } : {}),
            ...(r.hiredAt ? { hiredAt: r.hiredAt } : {}),
            ...(r.birthDate ? { birthDate: r.birthDate } : {}),
            firedAt: r.firedAt,
          },
        });
        // Nofaol xodim tizimga ham kira olmasin (qayta ishga olinsa — ochiladi)
        if (cur.userId && cur.isActive !== isActive) await tx.user.update({ where: { id: cur.userId }, data: { isActive } });
        await audit(tx, userId, "UPDATE", "Employee", e.id, before, { ...e, via: "excel" });
        updated++;
        if (!isActive) fired++;
        if (drivers.has(position.toLowerCase())) driverIds.push(e.id);
        const rec: Found = { id: e.id, fullName: e.fullName, tabelNo: e.tabelNo, isActive: e.isActive, userId: e.userId };
        if (e.tabelNo) byTabel.set(tabelKey(e.tabelNo), rec);
        byName.set(flatName(e.fullName), rec);
        continue;
      }

      const e = await tx.employee.create({
        data: {
          fullName: r.fullName, position, tabelNo: r.tabelNo, subdivision: r.subdivision,
          tariffRate: r.tariffRate, phone: r.phone, hiredAt: r.hiredAt, firedAt: r.firedAt,
          birthDate: r.birthDate, isActive,
        },
      });
      await audit(tx, userId, "CREATE", "Employee", e.id, undefined, { ...e, via: "excel" });
      created++;
      if (!isActive) fired++;
      if (drivers.has(position.toLowerCase())) driverIds.push(e.id);
      // Faylda bir odam ikki marta kelsa — ikkinchisi yangilanish bo'lib o'tadi
      const rec: Found = { id: e.id, fullName: e.fullName, tabelNo: e.tabelNo, isActive: e.isActive, userId: e.userId };
      if (e.tabelNo) byTabel.set(tabelKey(e.tabelNo), rec);
      byName.set(flatName(e.fullName), rec);
    }

    return { created, updated, skipped, createdPositions: missing, groups, fired, driverIds };
  }, { timeout: 120_000, maxWait: 20_000 });
}
