/**
 * Brigada oyligi va brak ushlanmasi uchun sun'iy ma'lumot + tekshiruv (lokal sinov).
 *
 * Joriy oyda (o'tgan kunlar) ikki demo brigada:
 *  1. «Sinov brigadasi» — 3 sdelkachi (20 / 15 / 10 kun, 08:00–17:00) va 1 okladchi a'zo;
 *     topshiriqlar: ustun 300 (oy ichida) + 40 (o'tgan oyda — kirmaydi), plita 150, bekor qilingan topshiriqda 50 (kirmaydi);
 *     brak: ustun 6 × 60 000, plita 2 × 120 000 → ish boshqaruvchi 150 000 ga tuzatgan; o'tgan oy braki va
 *     brigadasiz brak — ushlanmaydi.
 *  2. «Qarzdor brigada» — 1 sdelkachi, brak fonddan katta (oylik manfiy — brigada qarzi).
 *  3. O'tgan oydan qarz (`lib/hr/payroll.ts`): demo oy yakuni vedomostlari (to'langan / bekor qilingan) —
 *     Fayzullayev: avgust −999 999, sentabr −150 000 → faqat eng so'nggisi (150 000) ushlanadi;
 *     G'ofurov: sentabr −600 000, oktyabr oyligi yetmaydi → yana manfiy (keyingi oyga o'tadi);
 *     Hamidov: sentabr vedomosti bekor qilingan (−100 000) → ushlanmaydi.
 *     Demo vedomostlar `DEMO-BRAK-` raqamli: shu oylar uchun haqiqiy vedomost hisoblashni to'sadi — sinovdan keyin --remove.
 *
 * Kutilgan natija `lib/brigade-pay.ts` (`brigadePayMonth`) va vedomost hisobi (`lib/hr/payroll.ts` → `calculate`) bilan
 * solishtiriladi: fond, brak, oylik, a'zolar ulushi, «Brigada braki» ushlanmasi, okladchiga tushmasligi.
 *
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-brigada-brak.ts            → o'chirib qaytadan yaratadi va tekshiradi
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-brigada-brak.ts --check    → faqat tekshiradi
 *   ALLOW_DEMO=yes-i-know npx tsx scripts/demo-brigada-brak.ts --remove   → faqat o'chiradi
 *
 * Hamma yozuv `[demo-brak]` belgisi bilan (nom / izoh) — o'chirish shu bo'yicha. Sklad harakati yozilmaydi.
 */
import { guardDemo } from "./demo-guard";

guardDemo("scripts/demo-brigada-brak.ts");

const TAG = "[demo-brak]";
const now = new Date();
const YM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
/** Joriy oyning `d`-kuni (mahalliy), soat 10:00 — oy chegarasidan uzoqda. */
const day = (d: number, monthOffset = 0) => new Date(now.getFullYear(), now.getMonth() + monthOffset, d, 10, 0);
/** Davomat sanasi — `@db.Date` (UTC yarim tun). */
const attDay = (d: number) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), d));
/** Joriy oydan `off` oy oldingi «YYYY-MM». */
const ymAgo = (off: number) => { const d = new Date(now.getFullYear(), now.getMonth() - off, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
/** Oyning o'tgan ish kunlari (yakshanbasiz), 1-dan boshlab. */
const workDays = (n: number) => {
  const out: number[] = [];
  for (let d = 1; d < now.getDate() && out.length < n; d++) if (new Date(now.getFullYear(), now.getMonth(), d).getDay() !== 0) out.push(d);
  return out;
};

async function main() {
  const { db } = await import("../src/lib/db");
  const { brigadePayMonth } = await import("../src/lib/brigade-pay");
  const { calculate } = await import("../src/lib/hr/payroll");

  async function remove() {
    const brigades = (await db.brigade.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((b) => b.id);
    const emps = (await db.employee.findMany({ where: { fullName: { startsWith: TAG } }, select: { id: true } })).map((e) => e.id);
    const orders = (await db.order.findMany({ where: { note: { startsWith: TAG } }, select: { id: true } })).map((o) => o.id);
    const tasks = (await db.brigadeTask.findMany({ where: { OR: [{ orderId: { in: orders } }, { brigadeId: { in: brigades } }] }, select: { id: true } })).map((t) => t.id);
    await db.payrollRun.deleteMany({ where: { docNo: { startsWith: "DEMO-BRAK" } } }); // qatorlari bilan (cascade)
    const r = await db.$transaction([
      db.productDefect.deleteMany({ where: { OR: [{ note: { startsWith: TAG } }, { brigadeId: { in: brigades } }, { taskId: { in: tasks } }] } }),
      db.taskProgress.deleteMany({ where: { taskId: { in: tasks } } }),
      db.brigadeTask.deleteMany({ where: { id: { in: tasks } } }),
      db.order.deleteMany({ where: { id: { in: orders } } }),
      db.attendance.deleteMany({ where: { employeeId: { in: emps } } }),
      db.brigade.updateMany({ where: { id: { in: brigades } }, data: { leaderId: null } }),
      db.employee.deleteMany({ where: { id: { in: emps } } }),
      db.brigade.deleteMany({ where: { id: { in: brigades } } }),
      db.product.deleteMany({ where: { code: { startsWith: "DEMO-BRAK" } } }),
      db.customer.deleteMany({ where: { name: { startsWith: TAG } } }),
    ]);
    console.log(`O'chirildi: brak ${r[0].count}, bajarilgan ${r[1].count}, topshiriq ${r[2].count}, zayavka ${r[3].count}, davomat ${r[4].count}, xodim ${r[6].count}, brigada ${r[7].count}, mahsulot ${r[8].count}`);
  }

  async function create() {
    const user = await db.user.findFirst({ where: { role: "SUPERVISOR", isActive: true }, orderBy: { createdAt: "asc" } })
      ?? await db.user.findFirstOrThrow({ where: { role: "DIRECTOR" } });
    const by = user.id;
    const customer = await db.customer.create({ data: { name: `${TAG} Ichki sinov mijozi`, isInternal: true } });
    // Nofaol: ishlab chiqarish matritsasi, sklad va katalogda ko'rinmasin (oylik hisobi faolligiga qaramaydi)
    const ustun = await db.product.create({ data: { code: "DEMO-BRAK-U6", name: `${TAG} Ustun U-6`, unit: "dona", price: 60000, pieceRate: 6000, isActive: false } });
    const plita = await db.product.create({ data: { code: "DEMO-BRAK-P4", name: `${TAG} Plita P-4`, unit: "dona", price: 120000, pieceRate: 10000, isActive: false } });

    const brigade = await db.brigade.create({ data: { name: `${TAG} Sinov brigadasi` } });
    const debtor = await db.brigade.create({ data: { name: `${TAG} Qarzdor brigada` } });
    const payBack = await db.brigade.create({ data: { name: `${TAG} Qarzni qaytaruvchi` } });
    const payPart = await db.brigade.create({ data: { name: `${TAG} Qisman qaytaruvchi` } });
    const emp = (name: string, b: string, payType: "PIECE" | "SALARY", tariffRate?: number) =>
      db.employee.create({ data: { fullName: `${TAG} ${name}`, position: payType === "PIECE" ? "Formovshik" : "Brigadir", payType, tariffRate, brigadeId: b, hiredAt: day(1, -6) } });
    const [a, b, c, d, e] = [
      await emp("Aliyev Anvar", brigade.id, "PIECE"),
      await emp("Botirov Bekzod", brigade.id, "PIECE"),
      await emp("Choriyev Sardor", brigade.id, "PIECE"),
      await emp("Davronov Dilshod (oklad)", brigade.id, "SALARY", 3000000),
      await emp("Ergashev Elyor", debtor.id, "PIECE"),
    ];
    const f = await emp("Fayzullayev Farrux", payBack.id, "PIECE");
    const g = await emp("G'ofurov G'ayrat", payPart.id, "PIECE");
    const h = await db.employee.create({ data: { fullName: `${TAG} Hamidov Hasan (oklad)`, position: "Qorovul", payType: "SALARY", tariffRate: 2000000, hiredAt: day(1, -6) } });
    await db.brigade.update({ where: { id: brigade.id }, data: { leaderId: d.id } });

    // Davomat — ulush shundan (ishlagan daqiqasi): 20 / 15 / 10 kun × 9 soat; okladchi va qarzdor brigada a'zosi — 15 kun
    const att = (id: string, n: number) => workDays(n).map((x) => ({ employeeId: id, date: attDay(x), status: "PRESENT" as const, checkIn: "08:00", checkOut: "17:00", note: TAG }));
    await db.attendance.createMany({ data: [...att(a.id, 20), ...att(b.id, 15), ...att(c.id, 10), ...att(d.id, 15), ...att(e.id, 15), ...att(f.id, 12), ...att(g.id, 12), ...att(h.id, 10)] });

    const order = await db.order.create({
      data: {
        // Yopilgan — ishlab chiqarish doskasi va matritsasiga tushmasin (topshiriqlar va bajarilgan ish o'zgarmaydi)
        orderNo: `DEMO-BRAK-${Date.now()}`, customerId: customer.id, status: "CLOSED", deliveryDate: day(28), deliveryAddress: "Zavod hovlisi",
        note: `${TAG} sinov zayavkasi`, createdById: by,
        items: { create: [{ productId: ustun.id, qtyM3: 600, price: 60000 }, { productId: plita.id, qtyM3: 150, price: 120000 }] },
      },
      include: { items: true },
    });
    const [iU, iP] = [order.items.find((i) => i.productId === ustun.id)!, order.items.find((i) => i.productId === plita.id)!];
    const task = async (no: string, itemId: string, brigadeId: string, qty: number, status: "IN_PROGRESS" | "DONE" | "CANCELLED", prog: [number, number, number?][]) => {
      const t = await db.brigadeTask.create({
        data: { taskNo: `DEMO-BRAK-${no}-${Date.now()}`, orderId: order.id, orderItemId: itemId, brigadeId, qty, doneQty: prog.reduce((s, p) => s + p[1], 0), status, dueDate: day(28), note: TAG, createdById: by },
      });
      await db.taskProgress.createMany({ data: prog.map(([dd, q, mo]) => ({ taskId: t.id, qty: q, date: day(dd, mo ?? 0), note: TAG, createdById: by })) });
      return t;
    };
    const t1 = await task("U", iU.id, brigade.id, 400, "IN_PROGRESS", [[28, 40, -1], [5, 120], [12, 100], [20, 80]]);
    const t2 = await task("P", iP.id, brigade.id, 150, "DONE", [[8, 60], [18, 90]]);
    await task("UX", iU.id, brigade.id, 100, "CANCELLED", [[3, 50]]);
    const t4 = await task("UQ", iU.id, debtor.id, 100, "IN_PROGRESS", [[10, 20]]);
    await task("PF", iP.id, payBack.id, 50, "DONE", [[9, 50]]);   // 50 × 10 000 = 500 000
    await task("UG", iU.id, payPart.id, 100, "IN_PROGRESS", [[9, 50]]); // 50 × 6 000 = 300 000

    // O'tgan oylarning oy yakuni vedomostlari (to'langan — kassa navbatiga tushmaydi; bekor qilingan — hisobga olinmaydi)
    const run = (ym: string, status: "PAID" | "CANCELLED", lines: { employeeId: string; payType: "PIECE" | "SALARY"; net: number }[]) =>
      db.payrollRun.create({ data: { docNo: `DEMO-BRAK-${ym}-${status}`, month: ym, kind: "FINAL", status, note: TAG, createdById: by, lines: { create: lines } } });
    await run(ymAgo(2), "PAID", [{ employeeId: f.id, payType: "PIECE", net: -999999 }]);
    await run(ymAgo(1), "PAID", [{ employeeId: f.id, payType: "PIECE", net: -150000 }, { employeeId: g.id, payType: "PIECE", net: -600000 }]);
    await run(ymAgo(1), "CANCELLED", [{ employeeId: h.id, payType: "SALARY", net: -100000 }]);

    await db.productDefect.createMany({
      data: [
        { date: day(14), productId: ustun.id, brigadeId: brigade.id, taskId: t1.id, qty: 6, amount: 360000, reason: "Darz ketgan", note: TAG, createdById: by },
        // Ish boshqaruvchi tuzatgan summa: 2 × 120 000 = 240 000 → 150 000 (qisman qayta ishlatiladi)
        { date: day(19), productId: plita.id, brigadeId: brigade.id, taskId: t2.id, qty: 2, amount: 150000, reason: "Armatura chiqib qolgan", note: `${TAG} summa 240 000 → 150 000 tuzatildi`, createdById: by },
        { date: day(29, -1), productId: ustun.id, brigadeId: brigade.id, qty: 3, amount: 180000, reason: "O'tgan oy braki", note: TAG, createdById: by },
        { date: day(16), productId: ustun.id, brigadeId: null, qty: 1, amount: 60000, reason: "Tashishda singan (brigadasiz)", note: TAG, createdById: by },
        { date: day(11), productId: ustun.id, brigadeId: debtor.id, taskId: t4.id, qty: 5, amount: 300000, reason: "Qolip buzuq", note: TAG, createdById: by },
      ],
    });
    console.log(`Yaratildi (${YM}): 4 brigada, 8 xodim, 6 topshiriq, 5 brak, 3 demo vedomost (${ymAgo(2)}, ${ymAgo(1)})`);
  }

  async function check() {
    let fail = 0;
    const ok = (name: string, got: number, want: number) => {
      const pass = Math.abs(got - want) <= 1;
      if (!pass) fail++;
      console.log(`  ${pass ? "✓" : "✗"} ${name}: ${got.toLocaleString("ru-RU")}${pass ? "" : `  (kutilgan ${want.toLocaleString("ru-RU")})`}`);
    };
    const pay = await brigadePayMonth(YM);
    const main = pay.rows.find((r) => r.name === `${TAG} Sinov brigadasi`);
    const debt = pay.rows.find((r) => r.name === `${TAG} Qarzdor brigada`);
    if (!main || !debt) throw new Error("Demo brigadalar topilmadi — avval skriptni bayroqsiz ishga tushiring");

    console.log(`\n── Brigadalar → «Oylik» (${YM})`);
    ok("Sinov brigadasi: fond (300 × 6 000 + 150 × 10 000; o'tgan oy va bekor qilingan topshiriq kirmaydi)", main.fund, 3300000);
    ok("Sinov brigadasi: brak (360 000 + tuzatilgan 150 000; o'tgan oy va brigadasiz kirmaydi)", main.brak, 510000);
    ok("Sinov brigadasi: brak yozuvlari soni", main.brakCount, 2);
    ok("Sinov brigadasi: oylik = fond − brak", main.net, 2790000);
    ok("Qarzdor brigada: fond (20 × 6 000)", debt.fund, 120000);
    ok("Qarzdor brigada: brak", debt.brak, 300000);
    ok("Qarzdor brigada: oylik manfiy (brigada qarzi)", debt.net, -180000);

    const emps = await db.employee.findMany({ where: { fullName: { startsWith: TAG } }, select: { id: true } });
    const lines = await calculate(YM, "FINAL", { employeeIds: emps.map((x) => x.id) });
    const line = (n: string) => {
      const l = lines.find((x) => x.fullName.includes(n));
      if (!l) throw new Error(`Vedomostda ${n} yo'q`);
      return l;
    };
    const brakOf = (l: (typeof lines)[number]) => l.breakdown.rules.filter((h) => h.rule === "Brigada braki").reduce((s, h) => s + h.amount, 0);
    console.log("\n── Ish haqi vedomosti (oy yakuni) — sdelka va «Brigada braki» ushlanmasi");
    // Ulush: ishlagan daqiqa — 20 : 15 : 10 kun (bir xil soat) → 4/9, 3/9, 2/9
    const shares = [["Aliyev", 4 / 9], ["Botirov", 3 / 9], ["Choriyev", 2 / 9]] as const;
    let brakSum = 0;
    for (const [n, sh] of shares) {
      const l = line(n);
      ok(`${n}: asosiy (fond × ${(sh * 100).toFixed(1)}%)`, Math.round(Number(l.base)), Math.round(3300000 * sh));
      ok(`${n}: brak ushlanmasi (510 000 × ${(sh * 100).toFixed(1)}%)`, brakOf(l), Math.round(510000 * sh));
      brakSum += brakOf(l);
    }
    ok("Uchala sdelkachidan ushlangan brak jami = brigada braki", brakSum, 510000);
    ok("Okladchi a'zodan brak ushlanmaydi", brakOf(line("Davronov")), 0);
    const er = line("Ergashev");
    ok("Qarzdor brigada a'zosi: asosiy", Math.round(Number(er.base)), 120000);
    ok("Qarzdor brigada a'zosi: brak ushlanmasi (to'liq, yagona a'zo)", brakOf(er), 300000);
    console.log(`  · Ergashev qo'lga: ${Math.round(Number(er.net)).toLocaleString("ru-RU")} (brak fonddan katta — manfiy qoldiq)`);
    ok("Ergashev: manfiy qoldiq keyingi oyga o'tishi haqida ogohlantirish", er.breakdown.warnings.some((w) => w.includes("keyingi oy")) ? 1 : 0, 1);

    console.log(`\n── O'tgan oydan qarz (${ymAgo(2)} → ${ymAgo(1)} → ${YM})`);
    const debtOf = (l: (typeof lines)[number]) => l.breakdown.rules.filter((x) => x.rule === "O'tgan oydan qarz").reduce((s, x) => s + x.amount, 0);
    const fl = line("Fayzullayev"), gl = line("G'ofurov"), hl = line("Hamidov");
    ok("Fayzullayev: asosiy (50 × 10 000)", Math.round(Number(fl.base)), 500000);
    ok("Fayzullayev: faqat eng so'nggi oy qarzi ushlanadi (sentabr 150 000, avgust emas)", debtOf(fl), 150000);
    ok("Fayzullayev: qo'lga = hisoblangan − JShDS − qarz", fl.net, fl.gross - fl.incomeTax - 150000);
    ok("G'ofurov: qarz to'liq ushlanadi (600 000)", debtOf(gl), 600000);
    ok("G'ofurov: oylik yetmaydi — qo'lga manfiy (qolgani keyingi oyga)", gl.net, gl.gross - gl.incomeTax - 600000);
    ok("G'ofurov: manfiy ekani", gl.net < 0 ? 1 : 0, 1);
    ok("Hamidov: bekor qilingan vedomostdagi manfiy summa ushlanmaydi", debtOf(hl), 0);

    console.log(`\n${fail ? `✗ ${fail} ta tekshiruv yiqildi` : "✓ Hammasi to'g'ri"}`);
    if (fail) process.exitCode = 1;
  }

  if (!process.argv.includes("--check")) {
    await remove();
    if (process.argv.includes("--remove")) return db.$disconnect();
    await create();
  }
  await check();
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
