import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma";
import { ORG_TREE } from "./orgchart";
import { matchKey } from "./excel";

/**
 * Bo'lim lavozimlari — rolli, egasi login oladi va faqat o'z bo'limini ko'radi.
 * Ishchi lavozimlar bu yerda emas: ular bazada (`WorkPosition`) va Otdel kadr sahifasida boshqariladi.
 */
export const POSITIONS: { label: string; role: Role }[] = [
  { label: "Sotuv", role: "SALES" },
  // Ko'chadagi sotuv agenti — faqat o'z mijozlari va ularga zayavka ochish (cheklangan kabinet)
  { label: "Sotuv agenti", role: "AGENT" },
  { label: "Ishlab chiqarish", role: "PRODUCTION" },
  { label: "Ish boshqaruvchi", role: "SUPERVISOR" },
  { label: "Logistika", role: "LOGISTICS" },
  { label: "Buxgalteriya", role: "ACCOUNTING" },
  { label: "Otdel kadr", role: "HR" },
  { label: "Sklad", role: "WAREHOUSE" },
  // Snabjeniye — ta'minot (xarid): narx, yetkazuvchi, sotib olish va qabul; bosh sahifasi — ta'minot kabineti
  { label: "Snabjeniye", role: "PROCUREMENT" },
  { label: "Kassa / bank", role: "CASHIER" },
  // Mexanik — bosh sahifasi "Sklad & Logistika" nazorati (bugun/ertaga zayavka, mahsulot ehtiyoji, qoldiq, transport)
  { label: "Mexanik", role: "MECHANIC" },
  // Sekretar — vebda faqat «Arenda»: do'konlar ijarasi oylik hisobi va arenda kassasi kirim-chiqimi
  { label: "Sekretar", role: "SECRETARY" },
  { label: "Direktor", role: "DIRECTOR" },
];

/** Login qaysi bo'lim uchun ochilishi: bo'lim lavozimlari + haydovchi va brigadir ilovasi. */
export const LOGIN_ROLE_OPTIONS: { value: Role; label: string }[] = [
  ...POSITIONS.map((p) => ({ value: p.role, label: p.label })),
  { value: "DRIVER", label: "Haydovchi (ilova)" },
  { value: "BRIGADIER", label: "Brigadir (ilova)" },
];

/** Ro'yxatdan chiqarilgan, lekin bazada xodimi qolgan bo'lishi mumkin bo'lgan eski nomlar. */
const LEGACY: Record<string, Role> = { finance: "FINANCE", snabjenie: "PROCUREMENT", "ta'minot": "PROCUREMENT" };

export const roleForPosition = (position: string): Role | null => {
  const key = position.trim().toLowerCase();
  return POSITIONS.find((p) => p.label.toLowerCase() === key)?.role ?? LEGACY[key] ?? null;
};


/**
 * Lavozimlarning yagona ro'yxati — hamma sahifa (Boshqaruv → Xodimlar, Otdel kadr,
 * filtrlar, formalar) shu bittasidan oladi, shuning uchun ro'yxat hamma joyda bir xil.
 *
 * `departments` — tizimga kiradigan bo'lim lavozimlari (login beradi),
 * `work` — Otdel kadr yuritadigan ishchi lavozimlar (`WorkPosition`),
 * `drivers` — haydovchi ilovasiga chiqadiganlar,
 * `strays` — xodimlarda yozilgan, lekin ro'yxatga tushmagan lavozimlar (masalan Excel importdan
 *   qolgan eski yozuv): ular ham tanlovda ko'rinadi, aks holda o'sha xodimlar filtrda topilmaydi.
 */
export async function positionCatalog(): Promise<{
  departments: { label: string; role: Role }[];
  work: string[];
  drivers: string[];
  strays: string[];
}> {
  const [work, used] = await Promise.all([
    db.workPosition.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, isDriver: true } }),
    db.employee.groupBy({ by: ["position"] }),
  ]);
  const known = new Set<string>([
    ...POSITIONS.map((p) => p.label.trim().toLowerCase()),
    // Tuzilma tugunlari ("Brigadir") ham lavozim nomi — Excel importda moslanishi mumkin
    ...ORG_TREE.map((d) => d.label.trim().toLowerCase()),
    ...work.map((w) => w.name.trim().toLowerCase()),
  ]);
  const strays = used
    .map((u) => u.position.trim())
    .filter((n) => n && !known.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const drivers = work.filter((w) => w.isDriver).map((w) => w.name);
  return {
    departments: POSITIONS,
    work: work.map((w) => w.name),
    drivers: drivers.length ? drivers : ["Haydovchi"],
    strays: [...new Set(strays)],
  };
}

/** Otdel kadr yuritadigan ishchi lavozimlar (login bermaydi). */
export const workPositions = (opts?: { all?: boolean }) =>
  db.workPosition.findMany({
    where: opts?.all ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

/**
 * Haydovchi ilovasiga (Insof ECO) chiqadigan lavozim nomlari — Otdel kadr belgilaydi
 * (`WorkPosition.isDriver`). Ro'yxat bo'sh bo'lsa eski xulq: faqat "Haydovchi".
 */
export async function driverPositionNames(): Promise<string[]> {
  const rows = await db.workPosition.findMany({ where: { isDriver: true, isActive: true }, select: { name: true } });
  return rows.length ? rows.map((r) => r.name) : ["Haydovchi"];
}

export async function isDriverPosition(position: string): Promise<boolean> {
  const key = position.trim().toLowerCase();
  return (await driverPositionNames()).some((n) => n.toLowerCase() === key);
}

/**
 * Excel importidagi «Qiymatlarni moslash» uchun nom taxminlari (taqqoslash `matchKey` bilan: kirill/lotin farqsiz).
 * Faqat aniq nom mos kelmaganda ishlaydi; oxiridagi raqam tashlab solishtiriladi («БРИГАДИР 1» → Brigadir).
 */
const POSITION_ALIASES: Record<string, string[]> = {
  "Kassa / bank": ["kassir", "kassirka", "kassa", "старший кассир"],
  "Buxgalteriya": ["бухгалтер", "главный бухгалтер", "бош бухгалтер"],
  "Sklad": ["skladchi", "кладовщик", "завсклад", "заведующий складом"],
  "Snabjeniye": ["снабженец", "снабжение", "ta'minotchi"],
  "Otdel kadr": ["кадровик", "инспектор по кадрам", "отдел кадров"],
  "Logistika": ["логист", "диспетчер"],
  "Sotuv": ["sotuvchi", "продавец", "менеджер по продажам"],
  "Sotuv agenti": ["агент", "торговый агент", "агент по продажам"],
  "Mexanik": ["главный механик", "бош механик"],
  "Brigadir": ["бригадир"],
  "Haydovchi": ["водитель", "шофёр", "шофер", "ҳайдовчи"],
};

export type ImportPositionOption = { value: string; label: string; group: string; aliases?: string[] };
export const LOGIN_GROUP = "Tizimga kiradigan lavozimlar";
export const WORK_GROUP = "Ishchi lavozimlar";

/**
 * Excel importida lavozimni moslash mumkin bo'lgan barcha mavjud lavozimlar: bo'lim lavozimlari (Direktordan
 * tashqari), «Brigadir», haydovchi lavozimi va direktor login shabloni bergan ishchi lavozimlar — «Tizimga
 * kiradigan»; qolgan faol ishchi lavozimlar — «Ishchi». Import login OCHMAYDI: xodim kartasiga lavozim nomi
 * yoziladi, login keyin Xodimlar sahifasida beriladi (lavozim shabloni bo'lsa bo'lim va ruxsatlar o'zi qo'yiladi).
 */
export async function importPositionOptions(): Promise<ImportPositionOption[]> {
  const [work, drivers] = await Promise.all([workPositions(), driverPositionNames()]);
  const labelOf = (r: Role) => LOGIN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;
  const out: ImportPositionOption[] = [];
  const seen = new Set<string>();
  const add = (o: ImportPositionOption) => {
    const k = o.value.trim().toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    const aliases = POSITION_ALIASES[o.value]?.map(matchKey).filter(Boolean);
    out.push({ ...o, ...(aliases?.length ? { aliases } : {}) });
  };
  for (const p of POSITIONS) if (p.role !== "DIRECTOR") add({ value: p.label, label: p.label, group: LOGIN_GROUP });
  for (const d of ORG_TREE) if (d.role !== "DIRECTOR") add({ value: d.label, label: d.label, group: LOGIN_GROUP });
  for (const w of work) {
    if (w.loginRole && w.loginRole !== "DIRECTOR") add({ value: w.name, label: `${w.name} · ${labelOf(w.loginRole)}`, group: LOGIN_GROUP });
  }
  // Haydovchi ilovasi lavozimi — ishchi lavozimlar ro'yxatida bo'lmasa ham (standart «Haydovchi»)
  for (const n of drivers) if (!work.some((w) => w.name.toLowerCase() === n.toLowerCase())) add({ value: n, label: `${n} (ECO ilova)`, group: LOGIN_GROUP });
  for (const w of work) add({ value: w.name, label: w.isDriver ? `${w.name} (ECO ilova)` : w.name, group: WORK_GROUP });
  return out;
}
