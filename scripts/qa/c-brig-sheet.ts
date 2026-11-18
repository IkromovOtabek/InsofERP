/**
 * QA (C) — ish haqi, mobil:
 *   · brigadir «Brigada varag'i» (`brig-sheet`, `bsheet.hours` / `bsheet.output`): faqat BRIGADIER, faqat o'z brigadasi,
 *     kelajak kuni va yopiq oy rad etiladi, noma'lum xodim — xato, yozuv bazaga tushadi va tozalanadi;
 *   · «Oyligim»: ushlanmalar turi bo'yicha (C2026 ustunlari), «Kassadan berilgan» → «Oylikdan qarz», qarz/ijro qoldig'i qatori;
 *   · kassir to'lovi: plastik qismi bo'lsa formada `bankAccountId` (majburiy), bankisiz yuborilsa — tushunarli xato.
 *   npx tsx scripts/qa/c-brig-sheet.ts   (server QA_BASE da, baza insof_test…)
 */
import { api, check, done, section, tok } from "./c-lib";
import { PrismaClient } from "@/generated/prisma";

const db = new PrismaClient();
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const lineKey = (name: string) => `q_${Buffer.from(name, "utf8").toString("base64url")}`;
type Field = { name: string; label: string; required?: boolean; value?: string };
type Act = { id: string; form?: Field[] };

async function main() {
  const now = new Date();
  const today = isoOf(now);
  const month = today.slice(0, 7);
  const tomorrow = isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const LOCK_MONTH = "2020-01";
  const brUser = await db.user.findUniqueOrThrow({ where: { login: "test.brigadir" }, include: { employee: true } });
  const dirUser = await db.user.findUniqueOrThrow({ where: { login: "test.direktor" } });
  const own = await db.brigade.findFirst({ where: { leader: { userId: brUser.id } }, select: { id: true } });
  const foreign = await db.brigade.findFirst({ where: { NOT: { leader: { userId: brUser.id } } }, select: { id: true } });
  if (!own || !brUser.employee) { check("brigadirning brigadasi / xodim kartasi yo'q — test ma'lumoti yetarli emas", false); return; }
  const brEmp = brUser.employee.id;
  const LINE = "QA blok 20x20";
  const created = { emp: null as string | null, month: false, run: null as string | null, debt: null as string | null, wh: null as string | null };

  try {
    // Brigadaga sdelkachi a'zo va oy qatori (golden bazada yo'q)
    const member = await db.employee.create({ data: { fullName: "QA Sdelkachi Brigada", position: "Ishchi", payType: "PIECE", brigadeId: own.id, hiredAt: new Date(2020, 0, 1) } });
    created.emp = member.id;
    if (!(await db.brigadeMonth.findUnique({ where: { brigadeId_month: { brigadeId: own.id, month } } }))) {
      await db.brigadeMonth.create({ data: { brigadeId: own.id, month, lines: [{ name: LINE, rate: 1000, productId: null }] } });
      created.month = true;
    }
    const brg = await tok("test.brigadir");
    const ownId = `${own.id}.${today}`;

    section("Brigada varag'i — brigadir, o'z brigadasi");
    let r = await api("GET", "/api/mobile/list?key=brig-sheet", { token: brg });
    const rows: { id: string }[] = r.json?.rows ?? [];
    check("ro'yxat 200, bugungi kun bor", r.status === 200 && rows.some((x) => x.id === ownId), { status: r.status, n: rows.length });
    check("ro'yxatda faqat o'z brigadasi", rows.length > 0 && rows.every((x) => x.id.startsWith(`${own.id}.`)));
    r = await api("GET", `/api/mobile/home`, { token: brg });
    check("bosh ekran tezkor amallarida «Brigada varag'i»", r.status === 200 && (r.json?.quick ?? []).some((q: { key: string }) => q.key === "brig-sheet"), r.status);
    r = await api("GET", `/api/mobile/detail?key=brig-sheet&id=${encodeURIComponent(ownId)}`, { token: brg });
    const acts: Act[] = r.json?.actions ?? [];
    const hoursAct = acts.find((a) => a.id === "bsheet.hours");
    const outAct = acts.find((a) => a.id === "bsheet.output");
    check("kun kartasi 200, «Soatlarni yozish» va «Mahsulot sonini yozish» bor", r.status === 200 && !!hoursAct && !!outAct, { status: r.status, acts: acts.map((a) => a.id) });
    check("soat formasida QA a'zo", !!hoursAct?.form?.some((f) => f.name === `h_${member.id}`));
    check("mahsulot formasida oy qatori", !!outAct?.form?.some((f) => f.name === lineKey(LINE)));

    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: ownId, payload: { [`h_${member.id}`]: "7,5" } } });
    let h = await db.brigadeHours.findUnique({ where: { brigadeId_employeeId_date: { brigadeId: own.id, employeeId: member.id, date: dayUtc(today) } } });
    check("soat yozildi (7,5)", r.status === 200 && Number(h?.hours) === 7.5, { status: r.status, msg: r.json?.message, h: h?.hours });
    const aud = await db.auditLog.findFirst({ where: { entity: "BrigadeSheet", entityId: `${own.id}:${month}`, userId: brUser.id }, orderBy: { createdAt: "desc" } });
    check("AuditLog yozildi (brigadir nomidan)", !!aud);
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: ownId, payload: { [`h_${member.id}`]: "7.5" } } });
    check("o'zgarmagan qiymat — «O'zgarish yo'q»", r.status === 200 && /O'zgarish yo'q/.test(r.json?.message ?? ""), r.json?.message);
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: ownId, payload: { [`h_${member.id}`]: "0" } } });
    h = await db.brigadeHours.findUnique({ where: { brigadeId_employeeId_date: { brigadeId: own.id, employeeId: member.id, date: dayUtc(today) } } });
    check("«0» — ishlamadi (0 soat saqlanadi)", r.status === 200 && h != null && Number(h.hours) === 0, { status: r.status, h: h?.hours });
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: ownId, payload: { [`h_${member.id}`]: "" } } });
    h = await db.brigadeHours.findUnique({ where: { brigadeId_employeeId_date: { brigadeId: own.id, employeeId: member.id, date: dayUtc(today) } } });
    check("bo'sh — tozalandi", r.status === 200 && h == null, { status: r.status });
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: ownId, payload: { [`h_${member.id}`]: "abc" } } });
    check("noto'g'ri soat → 400", r.status === 400, r.status);
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: ownId, payload: { [`h_${brEmp}x`]: "8" } } });
    check("varaqda yo'q xodim → 400", r.status === 400, r.status);

    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.output", id: ownId, payload: { [lineKey(LINE)]: "12" } } });
    let o = await db.brigadeOutput.findUnique({ where: { brigadeId_date_line: { brigadeId: own.id, date: dayUtc(today), line: LINE } } });
    check("mahsulot soni yozildi (12)", r.status === 200 && Number(o?.qty) === 12, { status: r.status, msg: r.json?.message });
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.output", id: ownId, payload: { [lineKey("Yo'q qator")]: "3" } } });
    check("noma'lum qator → 400", r.status === 400, r.status);
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.output", id: ownId, payload: { [lineKey(LINE)]: "" } } });
    o = await db.brigadeOutput.findUnique({ where: { brigadeId_date_line: { brigadeId: own.id, date: dayUtc(today), line: LINE } } });
    check("mahsulot soni tozalandi", r.status === 200 && o == null, r.status);

    section("Brigada varag'i — ruxsatlar");
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: `${own.id}.${tomorrow}`, payload: { [`h_${member.id}`]: "8" } } });
    check("kelajak kuni → 400", r.status === 400, r.status);
    r = await api("GET", `/api/mobile/detail?key=brig-sheet&id=${encodeURIComponent(`${own.id}.${tomorrow}`)}`, { token: brg });
    check("kelajak kuni kartasi → 404", r.status === 404, r.status);
    if (foreign) {
      r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: `${foreign.id}.${today}`, payload: { [`h_${member.id}`]: "8" } } });
      check("begona brigada → 403", r.status === 403, `${r.status} ${r.json?.message}`);
      r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.output", id: `${foreign.id}.${today}`, payload: { [lineKey(LINE)]: "1" } } });
      check("begona brigada mahsuloti → 403", r.status === 403, r.status);
      r = await api("GET", `/api/mobile/detail?key=brig-sheet&id=${encodeURIComponent(`${foreign.id}.${today}`)}`, { token: brg });
      check("begona brigada kartasi → 404", r.status === 404, r.status);
    } else check("begona brigada yo'q — o'tkazib yuborildi", true);
    for (const l of ["test.ishlab", "test.direktor", "test.kadr", "test.kassa"]) {
      r = await api("POST", "/api/mobile/action", { token: await tok(l), body: { action: "bsheet.hours", id: ownId, payload: { [`h_${member.id}`]: "8" } } });
      check(`${l}: bsheet.hours → 403`, r.status === 403, r.status);
    }
    r = await api("GET", `/api/mobile/detail?key=brig-sheet&id=${encodeURIComponent(ownId)}`, { token: await tok("test.direktor") });
    check("direktor kartani ko'radi, tugmasiz", r.status === 200 && !(r.json?.actions ?? []).length, { status: r.status, acts: r.json?.actions?.length });
    r = await api("GET", `/api/mobile/detail?key=brig-sheet&id=${encodeURIComponent(ownId)}`, { token: await tok("test.sotuv") });
    check("sotuv kartani ochmaydi → 403", r.status === 403, r.status);

    // Yopiq oy: yakuniy vedomost tasdiqlangan (2020-01) — shu vedomost pastda to'lov testida ham ishlatiladi
    const run = await db.payrollRun.create({
      data: {
        docNo: `QA-BSHEET-${Date.now()}`, month: LOCK_MONTH, kind: "FINAL", status: "APPROVED", createdById: dirUser.id, gross: 1_000_000, net: 580_000, deductions: 420_000,
        lines: {
          create: [{
            employeeId: brEmp, payType: "PIECE", gross: 1_000_000, base: 1_000_000, incomeTax: 120_000, penalty: 300_000, net: 580_000, cardAmount: 200_000,
            breakdown: {
              period: { from: "2020-01-01", to: "2020-01-31" }, normDays: 26, presentDays: 26, paidLeaveDays: 0, unpaidLeaveDays: 0, sickDays: 0, absentDays: 0, dayoffDays: 0, minutes: 0, dailyAvg: 0, sickPct: 0,
              rules: [{ rule: "Kassadan berilgan", kind: "PENALTY", amount: 100_000, days: 1, detail: "Kirim-Chiqim: 05.01 100 000 so'm" }],
              manual: [
                { id: "qa-m1", kind: "PENALTY", amount: 150_000, reason: "Aliment / ijro", category: "ALIMENT" },
                { id: "qa-m2", kind: "PENALTY", amount: 50_000, reason: "To'y puli", category: "FUND" },
              ],
              advances: [], warnings: [],
            },
          }],
        },
      },
    });
    created.run = run.id;
    r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "bsheet.hours", id: `${own.id}.${LOCK_MONTH}-15`, payload: { [`h_${member.id}`]: "8" } } });
    check("yopiq oy (vedomost tasdiqlangan) → 400 «tabel yopiq»", r.status === 400 && /yopiq/.test(r.json?.message ?? ""), `${r.status} ${r.json?.message}`);
    r = await api("GET", `/api/mobile/detail?key=brig-sheet&id=${encodeURIComponent(`${own.id}.${LOCK_MONTH}-15`)}`, { token: brg });
    check("yopiq oy kartasi — tugmasiz, «Yopiq»", r.status === 200 && !(r.json?.actions ?? []).length && r.json?.status === "Yopiq", { status: r.status, st: r.json?.status });

    section("Oyligim — ushlanmalar turi bo'yicha, qarz qoldig'i");
    const debt = await db.employeeDebt.create({ data: { employeeId: brEmp, amount: 600_000, months: 3, startMonth: month, note: "QA qarz", createdById: dirUser.id } });
    created.debt = debt.id;
    const wh = await db.withholding.create({ data: { employeeId: brEmp, kind: "ALIMENT", caseNo: "QA-1", monthly: 100_000, startMonth: month, createdById: dirUser.id } });
    created.wh = wh.id;
    r = await api("GET", "/api/mobile/list?key=oyligim", { token: brg });
    const lrows: { id: string; right?: string }[] = r.json?.rows ?? [];
    check("ro'yxat tepasida «qarz» qatori", r.status === 200 && lrows[0]?.id === "qarz", { status: r.status, first: lrows[0]?.id });
    check("vedomost qatori ham bor", lrows.some((x) => x.id === run.id));
    r = await api("GET", "/api/mobile/detail?key=oyligim&id=qarz", { token: brg });
    const lf: { label: string; value: string }[] = r.json?.fields ?? [];
    check("qarz kartasi: qoldiq 600 000, aliment muddatsiz", r.status === 200 && lf.some((f) => f.label === "Qarz qoldig'i" && f.value.replace(/\s/g, "").startsWith("600000")) && lf.some((f) => f.label === "Ijro / aliment qoldig'i" && f.value === "muddatsiz"), lf);
    r = await api("GET", `/api/mobile/detail?key=oyligim&id=${run.id}`, { token: brg });
    const pf: { label: string; value: string }[] = r.json?.fields ?? [];
    const val = (label: string) => pf.find((f) => f.label === label)?.value.replace(/[\s  ]/g, "");
    check("«Oylikdan qarz» −100 000 (kassadan berilgan)", val("Oylikdan qarz") === "−100000so'm", pf.map((f) => `${f.label}=${f.value}`));
    check("«Aliment / ijro» −150 000", val("Aliment / ijro") === "−150000so'm");
    check("«To'y puli» −50 000", val("To'y puli") === "−50000so'm");
    check("hammasi «Jarima» bo'lib chiqmaydi", !pf.some((f) => f.label === "Jarima"));
    check("qarz qoldig'i (hozir) ko'rinadi", pf.some((f) => f.label === "Qarz qoldig'i (hozir)"));
    const tafsilot: { title: string }[] = (r.json?.sections ?? []).flatMap((s: { rows: { title: string }[] }) => s.rows);
    check("tafsilotda «Oylikdan qarz — kassadan berilgan» va «Aliment / ijro»", tafsilot.some((x) => x.title === "Oylikdan qarz — kassadan berilgan") && tafsilot.some((x) => x.title === "Aliment / ijro"), tafsilot.map((x) => x.title));
    r = await api("GET", "/api/mobile/detail?key=oyligim&id=qarz", { token: await tok("test.kassa") });
    check("boshqa xodim brigadirning qarzini ko'rmaydi (o'zinikini ochadi)", r.status !== 200 || !(r.json?.sections ?? []).some((s: { rows: { title: string }[] }) => s.rows.some((x) => x.title.startsWith("QA qarz"))), r.status);

    section("Kassir to'lovi — plastik qismi uchun bank hisobi");
    const kassa = await tok("test.kassa");
    r = await api("GET", `/api/mobile/detail?key=ish-haqi&id=${run.id}`, { token: kassa });
    const pay = (r.json?.actions ?? []).find((a: Act) => a.id === "payroll.pay") as Act | undefined;
    const bank = pay?.form?.find((f) => f.name === "bankAccountId");
    check("to'lov formasida «Plastik qismi» bank hisobi, majburiy", r.status === 200 && !!bank && !!bank.required, { status: r.status, fields: pay?.form?.map((f) => f.name) });
    const lineId = (await db.payrollLine.findFirstOrThrow({ where: { runId: run.id } })).id;
    check("xodim qatorida plastik summasi", !!pay?.form?.some((f) => f.name === `line_${lineId}` && /plastik/.test(f.label)));
    const cash = pay?.form?.find((f) => f.name === "cashAccountId")?.value;
    r = await api("POST", "/api/mobile/action", { token: kassa, body: { action: "payroll.pay", id: run.id, payload: { cashAccountId: cash, [`line_${lineId}`]: "true" } } });
    check("bank tanlanmasa → 400 «Plastik qismi …»", r.status === 400 && /Plastik qismi/.test(r.json?.message ?? ""), `${r.status} ${r.json?.message}`);
    const paid = await db.payrollLine.findUniqueOrThrow({ where: { id: lineId } });
    check("qator to'lanmagan bo'lib qoldi", paid.paidAt == null);
  } finally {
    if (created.run) await db.payrollRun.delete({ where: { id: created.run } }).catch(() => undefined);
    if (created.debt) await db.employeeDebt.delete({ where: { id: created.debt } }).catch(() => undefined);
    if (created.wh) await db.withholding.delete({ where: { id: created.wh } }).catch(() => undefined);
    await db.brigadeHours.deleteMany({ where: { brigadeId: own.id, ...(created.emp ? { employeeId: created.emp } : {}) } }).catch(() => undefined);
    await db.brigadeOutput.deleteMany({ where: { brigadeId: own.id, line: LINE } }).catch(() => undefined);
    if (created.month) await db.brigadeMonth.delete({ where: { brigadeId_month: { brigadeId: own.id, month } } }).catch(() => undefined);
    if (created.emp) await db.employee.delete({ where: { id: created.emp } }).catch(() => undefined);
  }
}

main().catch((e) => { check("kutilmagan xato", false, String(e)); }).finally(async () => { await db.$disconnect(); done(); });
