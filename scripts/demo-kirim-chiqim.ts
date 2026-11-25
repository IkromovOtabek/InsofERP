/**
 * Tahlil → Moliya → «Kirim-chiqim jamlanmasi» uchun sun'iy ma'lumot (lokal sinov):
 *  - 3 oy (joriy oy va oldingi ikkitasi) kassa kirim/chiqimlari — mavjud manba va sub manbalar bo'yicha,
 *    yetkazuvchi, mijoz, xodim kontragentlari bilan; Naqd kassa va bank hisoblariga taqsimlangan;
 *  - mijoz to'lovlari (`Payment`) — «Savdo tushumi»;
 *  - har hisobga 3 oy oldingi oy boshiga boshlang'ich qoldiq (OPENING) — qoldiqlar manfiy bo'lib ketmasin.
 *
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-kirim-chiqim.ts            → avvalgisini o'chirib, qaytadan yaratadi
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-kirim-chiqim.ts --remove   → faqat o'chiradi
 *
 * Har yozuv izohida `[demo-kirim-chiqim]` belgisi — o'chirish shu bo'yicha. Sklad, schyot, zayavka yozilmaydi.
 */
import { PrismaClient, Prisma } from "../src/generated/prisma";
import { guardDemo } from "./demo-guard";

guardDemo("scripts/demo-kirim-chiqim.ts");
const db = new PrismaClient();
const TAG = "[demo-kirim-chiqim]";

let seed = 20261125;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
/** Summa — `step` ga yaxlitlangan (kassa yozuvlari kabi) */
const amt = (a: number, b: number, step = 50_000) => Math.round(int(a, b) / step) * step;
const D = (n: number) => new Prisma.Decimal(n.toFixed(2));

async function remove() {
  const tx = await db.cashTransaction.deleteMany({ where: { note: { contains: TAG } } });
  const pay = await db.payment.deleteMany({ where: { note: { contains: TAG } } });
  console.log(`o'chirildi: kassa yozuvi ${tx.count}, mijoz to'lovi ${pay.count}`);
}

/** Chiqim manbalari: [manba, sub manbalar, oyiga necha yozuv, summa oralig'i, kontragent turi] */
const EXPENSES: [string, string[], [number, number], [number, number], "supplier" | "employee" | "free"][] = [
  ["Xomashyo", [], [10, 16], [8_000_000, 65_000_000], "supplier"],
  ["Ish haqi", ["Oylik va avans", "Yollanma (kunbay) ishchilar"], [6, 10], [2_500_000, 9_000_000], "employee"],
  ["Transport", ["Yoqilg'i", "Transport ta'miri va zapchast", "Yollanma texnika", "Yo'l kira, shtraf, sug'urta"], [12, 18], [400_000, 6_500_000], "free"],
  ["Kommunal (elektr, suv, gaz)", ["Elektr", "Gaz", "Suv"], [3, 4], [1_500_000, 14_000_000], "free"],
  ["Ta'mirlash / ehtiyot qism", [], [3, 6], [600_000, 7_000_000], "supplier"],
  ["Ofis / xo'jalik", ["Xo'jalik mollari", "Telefon va internet", "HR (ishga olish, o'qitish)"], [4, 7], [150_000, 1_800_000], "free"],
  ["Pitaniya", [], [4, 6], [500_000, 2_200_000], "free"],
  ["Soliq va to'lovlar", [], [1, 2], [6_000_000, 22_000_000], "free"],
  ["Ijara", [], [1, 1], [4_000_000, 4_000_000], "free"],
  ["Marketing", ["Xayriya va sovg'alar"], [1, 3], [800_000, 5_000_000], "free"],
  ["Bank xizmati", [], [2, 3], [80_000, 450_000], "free"],
  ["Hodimlar bilan hisob-kitob", ["Xodimga qarz", "oylik xisobidan avans/qarz"], [2, 4], [500_000, 3_000_000], "employee"],
];
/** Kirim manbalari (mijoz to'lovlaridan tashqari) */
const INCOMES: [string, [number, number], [number, number]][] = [
  ["Xizmat (nasos, transport)", [4, 8], [1_200_000, 6_000_000]],
  ["Chiqindi / brak sotuvi", [1, 3], [300_000, 2_500_000]],
  ["Boshqa tushum", [1, 2], [200_000, 1_500_000]],
  ["Qaytarilgan avans", [0, 1], [500_000, 2_000_000]],
];
const FREE_PARTIES: Record<string, string[]> = {
  "Transport": ["Mustang AYoQSh", "Avtoservis «Usta Bahrom»", "Texnika ijarasi MChJ", "Yo'l politsiyasi"],
  "Kommunal (elektr, suv, gaz)": ["Hududiy elektr tarmoqlari", "Hududgaz", "Suvoqova"],
  "Ofis / xo'jalik": ["Korzinka", "Uzmobile", "HeadHunter"],
  "Pitaniya": ["Oshxona «Barakali»", "Non sexi"],
  "Soliq va to'lovlar": ["Davlat soliq qo'mitasi"],
  "Ijara": ["Ijara beruvchi — Karimov A."],
  "Marketing": ["Mahalla qo'mitasi", "Reklama agentligi"],
  "Bank xizmati": [],
  "Xizmat (nasos, transport)": ["Qurilish trest №3", "Mega Build", "Xususiy buyurtmachi"],
  "Chiqindi / brak sotuvi": ["Metallolom qabul punkti"],
  "Boshqa tushum": [],
  "Qaytarilgan avans": ["Ta'minotchi — avans qaytdi"],
};

async function create() {
  const [author, accounts, suppliers, customers, employees] = await Promise.all([
    db.user.findFirst({ where: { role: "DIRECTOR" }, select: { id: true } }),
    db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true } }),
    db.supplier.findMany({ select: { id: true, name: true }, take: 20 }),
    db.customer.findMany({ select: { id: true, name: true }, take: 30 }),
    db.employee.findMany({ select: { id: true, fullName: true }, take: 40 }),
  ]);
  if (!author) throw new Error("Direktor foydalanuvchisi topilmadi");
  const cash = accounts.filter((a) => a.type === "CASH"), bank = accounts.filter((a) => a.type === "BANK");
  if (!cash.length || !bank.length) throw new Error("Kamida bitta naqd kassa va bitta bank hisobi kerak");
  if (!customers.length) throw new Error("Mijoz yo'q — avval seed");

  const now = new Date();
  const monthStarts = [2, 1, 0].map((k) => new Date(now.getFullYear(), now.getMonth() - k, 1));
  /** Oy ichidagi tasodifiy sana (joriy oyda — bugungacha) */
  const dayIn = (ms: Date) => {
    const last = ms.getMonth() === now.getMonth() && ms.getFullYear() === now.getFullYear() ? now.getDate() : new Date(ms.getFullYear(), ms.getMonth() + 1, 0).getDate();
    return new Date(ms.getFullYear(), ms.getMonth(), int(1, last), int(8, 18), int(0, 59));
  };
  /** Naqd 40% / bank 60% (bank xizmati va soliq — faqat bank) */
  const accFor = (cat: string) => (cat === "Bank xizmati" || cat === "Soliq va to'lovlar" || rnd() < 0.6 ? pick(bank) : pick(cash));

  const txs: Prisma.CashTransactionCreateManyInput[] = [];
  const pays: Prisma.PaymentCreateManyInput[] = [];

  // Boshlang'ich qoldiq — birinchi oy boshidan bir kun oldin
  const openAt = new Date(monthStarts[0]!.getTime() - 86400000);
  for (const a of accounts) txs.push({ date: openAt, type: "OPENING", cashAccountId: a.id, amount: D(a.type === "CASH" ? 85_000_000 : 420_000_000), category: "Boshlang'ich qoldiq", note: TAG, createdById: author.id });

  for (const ms of monthStarts) {
    // Mijoz to'lovlari — asosiy tushum
    for (let i = int(26, 38); i > 0; i--) {
      const c = pick(customers);
      pays.push({ date: dayIn(ms), customerId: c.id, cashAccountId: rnd() < 0.65 ? pick(bank).id : pick(cash).id, amount: D(amt(4_000_000, 70_000_000)), note: `${TAG} beton uchun to'lov` });
    }
    for (const [cat, [a, b], [lo, hi]] of INCOMES) {
      for (let i = int(a, b); i > 0; i--) {
        const parties = FREE_PARTIES[cat] ?? [];
        txs.push({ date: dayIn(ms), type: "INCOME", cashAccountId: accFor(cat).id, amount: D(amt(lo, hi)), category: cat, counterparty: parties.length ? pick(parties) : null, note: TAG, createdById: author.id });
      }
    }
    // Savdo kassasi orqali naqd tushum (mijozga bog'langan)
    for (let i = int(3, 6); i > 0; i--) {
      const c = pick(customers);
      txs.push({ date: dayIn(ms), type: "INCOME", cashAccountId: pick(cash).id, amount: D(amt(1_500_000, 12_000_000)), category: "Savdo", subCategory: null, counterparty: c.name, note: `${TAG} naqd savdo`, createdById: author.id });
    }
    for (const [cat, subs, [a, b], [lo, hi], kind] of EXPENSES) {
      for (let i = int(a, b); i > 0; i--) {
        const sub = subs.length ? pick(subs) : null;
        const base: Prisma.CashTransactionCreateManyInput = { date: dayIn(ms), type: "EXPENSE", cashAccountId: accFor(cat).id, amount: D(amt(lo, hi, lo >= 1_000_000 ? 50_000 : 10_000)), category: cat, subCategory: sub, note: TAG, createdById: author.id };
        if (kind === "supplier" && suppliers.length) { const s = pick(suppliers); base.supplierId = s.id; base.counterparty = s.name; }
        else if (kind === "employee" && employees.length) { const e = pick(employees); base.employeeId = e.id; base.counterparty = e.fullName; }
        else { const parties = FREE_PARTIES[cat] ?? []; base.counterparty = parties.length ? pick(parties) : null; }
        txs.push(base);
      }
    }
  }

  await db.cashTransaction.createMany({ data: txs });
  await db.payment.createMany({ data: pays });
  console.log(`yaratildi: kassa yozuvi ${txs.length} (shundan boshlang'ich qoldiq ${accounts.length}), mijoz to'lovi ${pays.length}`);
}

(async () => {
  await remove();
  if (!process.argv.includes("--remove")) await create();
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
