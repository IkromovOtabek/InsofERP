/**
 * QA (A) — yagona debitorka (`src/lib/receivables.ts`): mijoz balansi hamma joyda bir xil.
 *
 * Mijoz: boshlang'ich qarz + turli sanadagi 3 ta schyot + schyotga bog'lanmagan avans + schyotga bog'langan
 * qisman to'lov + storno qilingan to'lov. Tekshiriladi:
 *   · balans = Σ schyotlar − Σ to'lovlar (storno kirmaydi), kredit limiti (finance.ts) ham shu raqam;
 *   · FIFO aging: to'lovlar eng eski schyotlardan yopiladi, muddati o'tgan qism sozlamadagi kun bo'yicha;
 *   · bir xil raqam: mijoz kartasi, operatsion dashboard, Egasi dashboardi, BI (mijozlar/moliya), /sales,
 *     /invoices, akt sverka, mobil (mijoz kartochkasi va buxgalter debitorka kartasi);
 *   · faqat avans to'lagan mijoz — kartada "Avans", qarz 0.
 *
 *   DATABASE_URL=postgresql://…/insof_test_x QA_BASE=http://localhost:3210 npx tsx scripts/qa/receivables.mts
 */
import { api, check, done, section, tok, webCookie } from "./c-lib";
import { db } from "@/lib/db";
import { createOrder, orderConfirm } from "@/lib/orders";
import { createInvoice, customerStatement } from "@/lib/invoices";
import { addPayment, reversePayment } from "@/lib/payments";
import { createOpening } from "@/lib/opening-balances";
import { customerCredit } from "@/lib/finance";
import { receivablesReport, customerBalance, OWNER_EDGES } from "@/lib/receivables";
import { ownerDashboard } from "@/lib/owner-dashboard";
import { customerBase, customersTab } from "@/lib/bi/customers";
import { financeTab } from "@/lib/bi/finance";
import { parseRange } from "@/lib/bi/core";

const DAY = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * DAY);
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
const flat = (html: string) => html.replace(/[\s  ]/g, "");
/** Sahifada `money(n)` ko'rinishidagi summa bormi (bo'shliq/nbsp e'tiborsiz). */
const hasMoney = (html: string, n: number) => flat(html).includes(`${Math.round(n)}so`);
const field = (j: { fields?: { label: string; value: string }[] } | null, label: string) => j?.fields?.find((f) => f.label === label)?.value;
const digits = (s: unknown) => Number(String(s ?? "").replace(/[^\d]/g, ""));

/** Mustaqil hisob (modulga tayanmasdan): Σ musbat (schyotlar − to'lovlar), ichki mijozsiz. */
async function expectedTotals() {
  const rows = await db.$queryRaw<{ id: string; bal: string }[]>`
    SELECT c.id, (COALESCE(i.s, 0) - COALESCE(p.s, 0))::text AS bal FROM "Customer" c
    LEFT JOIN (SELECT "customerId", SUM(amount) s FROM "Invoice" WHERE status::text <> 'CANCELLED' GROUP BY 1) i ON i."customerId" = c.id
    LEFT JOIN (SELECT p."customerId", SUM(p.amount) s FROM "Payment" p WHERE NOT EXISTS (SELECT 1 FROM "SalesRegister" r WHERE r."paymentId" = p.id) GROUP BY 1) p ON p."customerId" = c.id
    WHERE NOT c."isInternal"`;
  const b = rows.map((r) => Number(r.bal));
  return { total: Math.round(b.filter((x) => x > 0).reduce((s, x) => s + x, 0) * 100) / 100, advance: Math.round(-b.filter((x) => x < 0).reduce((s, x) => s + x, 0) * 100) / 100, debtors: b.filter((x) => x > 0.005).length };
}

async function main() {
  const T = Date.now().toString(36);
  const sotuv = await db.user.findFirstOrThrow({ where: { login: "test.sotuv" } });
  const buhU = await db.user.findFirstOrThrow({ where: { login: "test.buh" } });
  const dirU = await db.user.findFirstOrThrow({ where: { login: "test.direktor" } });
  const prod = await db.product.findFirstOrThrow({ where: { code: "M200" } });
  const kassa = await db.cashAccount.findFirstOrThrow({ where: { type: "CASH", isActive: true }, orderBy: { name: "asc" } });
  const overdueDays = (await db.companySettings.findUnique({ where: { id: "main" } }))?.overdueDays ?? 30;

  section("Ma'lumot: boshlang'ich qarz, 3 schyot, avans, qisman to'lov, storno");
  const c = await db.customer.create({ data: { name: `QA Debitorka ${T}`, creditLimit: 100_000_000 } });
  const op = await createOpening({ kind: "CUSTOMER", customerId: c.id, date: ago(100), amount: 1_011_111, note: "QA" }, dirU.id);
  check("boshlang'ich qarz 1 011 111 (100 kun oldin)", !op.error, op.error);
  const invoice = async (amount: number, days: number) => {
    const o = await createOrder({ customerId: c.id, deliveryDate: new Date(Date.now() + DAY), deliveryAddress: `QA deb ${T}`, items: [{ productId: prod.id, qtyM3: 1, price: amount }] }, sotuv.id);
    const conf = await orderConfirm(o.id, sotuv.id);
    if (conf.error) throw new Error(`orderConfirm: ${conf.error}`);
    const r = await createInvoice({ orderId: o.id, amount, date: ago(days) }, buhU.id);
    if (r.error || !r.id) throw new Error(`createInvoice: ${r.error}`);
    return r.id;
  };
  const A = await invoice(2_022_222, 70);
  const B = await invoice(3_033_333, 40);
  const C = await invoice(1_544_444, 5);
  check("3 ta schyot (70, 40, 5 kun oldin)", !!(A && B && C));
  const adv = await addPayment({ customerId: c.id, cashAccountId: kassa.id, amount: 2_511_111, date: ago(3) }, buhU.id);
  check("schyotga bog'lanmagan avans 2 511 111", !adv.error, adv.error);
  const part = await addPayment({ customerId: c.id, invoiceId: C, cashAccountId: kassa.id, amount: 1_000_123, date: ago(2) }, buhU.id);
  check("C schyotiga qisman to'lov 1 000 123 → PARTIAL", part.invoiceStatus === "PARTIAL", part);
  const rev = await addPayment({ customerId: c.id, cashAccountId: kassa.id, amount: 4_000_000, date: ago(1) }, buhU.id);
  const rr = await reversePayment(rev.id!, "QA storno — xato to'lov", buhU.id);
  check("4 000 000 to'lov storno qilindi", !rr.error && !(await db.payment.findUnique({ where: { id: rev.id! } })), rr.error);
  // Faqat avans to'lagan mijoz
  const c2 = await db.customer.create({ data: { name: `QA Avans ${T}` } });
  await addPayment({ customerId: c2.id, cashAccountId: kassa.id, amount: 700_000, date: ago(1) }, buhU.id);

  const INVOICED = 1_011_111 + 2_022_222 + 3_033_333 + 1_544_444; // 7 611 110
  const PAID = 2_511_111 + 1_000_123; // 3 511 234
  const BAL = INVOICED - PAID; // 4 099 876
  // FIFO: 3 511 234 → boshlang'ich (1 011 111) + A (2 022 222) + B dan 477 901 → B qoldig'i 2 555 432, C 1 544 444
  const LEFT_B = 2_555_432, LEFT_C = 1_544_444;

  section("Modul: balans, FIFO aging, kredit limiti");
  const bal = await customerBalance(c.id);
  check(`balans ${BAL} (schyotlar ${INVOICED} − to'lovlar ${PAID})`, eq(bal.balance, BAL) && eq(bal.invoiced, INVOICED) && eq(bal.paid, PAID) && eq(bal.debt, BAL) && bal.advance === 0, bal);
  const one = await receivablesReport({ ids: [c.id] });
  const row = one.byCustomer.get(c.id);
  check("FIFO: ochiq qismlar faqat B va C", row?.items.length === 2 && row.items[0]!.invoiceId === B && eq(row.items[0]!.left, LEFT_B) && row.items[1]!.invoiceId === C && eq(row.items[1]!.left, LEFT_C), row?.items);
  check("aging (0–30 / 31–60 / 61–90 / 90+) = [C, B, 0, 0]", eq(row!.buckets[0]!, LEFT_C) && eq(row!.buckets[1]!, LEFT_B) && row!.buckets[2] === 0 && row!.buckets[3] === 0, row?.buckets);
  const expOverdue = (40 > overdueDays ? LEFT_B : 0) + (5 > overdueDays ? LEFT_C : 0);
  check(`muddati o'tgan (${overdueDays} kun) = ${expOverdue}, eng eskisi 40 kun`, eq(row!.overdue, expOverdue) && row!.oldestDays === 40, { overdue: row?.overdue, oldest: row?.oldestDays });
  check("aging yig'indisi = qarz", eq(row!.buckets.reduce((s, x) => s + x, 0), BAL));
  const own = await receivablesReport({ ids: [c.id], edges: OWNER_EDGES });
  check("owner chegaralari (0–7 / 8–30 / 31–60 / 60+) = [C, 0, B, 0]", eq(own.rows[0]!.buckets[0]!, LEFT_C) && own.rows[0]!.buckets[1] === 0 && eq(own.rows[0]!.buckets[2]!, LEFT_B), own.rows[0]?.buckets);
  const cr = await customerCredit(c.id);
  check("kredit limiti: debt = balans, ochiq zayavka 0, ishlatilgan = balans", eq(cr.debt, BAL) && eq(cr.balance, BAL) && cr.open === 0 && eq(cr.used, BAL) && eq(cr.free, 100_000_000 - BAL), cr);
  const cr2 = await customerCredit(c2.id);
  check("avans mijoz: balans −700 000, qarz 0, qora ro'yxatda emas", eq(cr2.balance, -700_000) && cr2.debt === 0 && eq(cr2.advance, 700_000) && !cr2.blacklisted, cr2);
  const before = await customerBalance(c.id, { asOf: ago(4) });
  check("o'tgan sana holati (4 kun oldin): barcha schyotlar, to'lovlar hali yo'q", eq(before.balance, INVOICED) && before.paid === 0, before);

  section("Global jami — mustaqil SQL bilan");
  const exp = await expectedTotals();
  const all = await receivablesReport();
  check(`jami debitorka ${exp.total}, avans ${exp.advance}, qarzdorlar ${exp.debtors}`, eq(all.total, exp.total) && eq(all.advance, exp.advance) && all.debtors === exp.debtors, { all: [all.total, all.advance, all.debtors], exp });
  check("aging jami = debitorka", eq(all.buckets.reduce((s, x) => s + x, 0), all.total));

  section("Egasi dashboardi va BI (lib)");
  const od = await ownerDashboard();
  check("owner: debitorka = jami", eq(od.debt.receivable, exp.total), od.debt.receivable);
  check("owner: top qarzdorlarda mijoz qarzi = balans", eq(od.debt.topDebtors.find((x) => x.id === c.id)?.debt ?? NaN, BAL) || od.debt.topDebtors.length === 10);
  const ownAll = await receivablesReport({ edges: OWNER_EDGES });
  check("owner: aging = modul (0–7 / 8–30 / 31–60 / 60+)", od.debt.aging.every((v, i) => eq(v, ownAll.buckets[i]!)), { od: od.debt.aging, mod: ownAll.buckets });
  const bi = (await customerBase()).find((x) => x.id === c.id);
  check("BI mijoz: qarz = balans, muddati o'tgan = FIFO", eq(bi?.debt ?? NaN, BAL) && eq(bi?.overdueDebt ?? NaN, expOverdue) && bi?.oldestDebtDays === 40, bi && { debt: bi.debt, overdue: bi.overdueDebt, oldest: bi.oldestDebtDays });
  const range = parseRange({ period: "month" });
  const tab = await customersTab(range, { page: 1, size: 20 });
  check("BI mijozlar: aging jami = debitorka", eq(Object.values(tab.aging).reduce((s, x) => s + x, 0), exp.total), tab.aging);
  const fin = await financeTab(range, "day", 1, 20);
  check("BI moliya: debitorka = jami", eq(fin.kpis.receivable, exp.total), fin.kpis.receivable);
  const st = await customerStatement(c.id, ago(365), new Date());
  check("akt sverka: yakuniy qoldiq = balans", eq(st.closing, BAL) && st.opening === 0, { opening: st.opening, closing: st.closing });

  section("Veb sahifalar");
  const cookie = await webCookie(dirU);
  const page = async (p: string) => { const r = await api("GET", p, { cookie }); return { status: r.status, html: r.text }; };
  const card = await page(`/customers/${c.id}`);
  check("mijoz kartasi: Qarz (debitorka) = balans", card.status === 200 && card.html.includes("Qarz (debitorka)") && hasMoney(card.html, BAL), card.status);
  const card2 = await page(`/customers/${c2.id}`);
  check("avans mijoz kartasi: «Avans» 700 000", card2.status === 200 && card2.html.includes("Avans (oldindan to") && hasMoney(card2.html, 700_000), card2.status);
  const list = await page("/customers");
  check("mijozlar ro'yxati: qarz ustuni", list.status === 200 && hasMoney(list.html, BAL), list.status);
  const dash = await page("/dashboard?view=operations");
  check("operatsion dashboard: Debitorka = jami, mijoz qarzi = balans", dash.status === 200 && hasMoney(dash.html, exp.total) && hasMoney(dash.html, BAL), dash.status);
  const sales = await page(`/sales?customer=${c.id}`);
  check("/sales (mijoz filtri): Debitorka = balans", sales.status === 200 && sales.html.includes("Debitorka (joriy)") && hasMoney(sales.html, BAL), sales.status);
  const salesAll = await page("/sales");
  check("/sales: Debitorka = jami", salesAll.status === 200 && hasMoney(salesAll.html, exp.total), salesAll.status);
  const inv = await page("/invoices");
  check("/invoices: Jami debitorka = jami", inv.status === 200 && hasMoney(inv.html, exp.total), inv.status);
  for (const p of ["/dashboard", "/bi-tahlil", "/bi-tahlil/mijozlar", "/bi-tahlil/moliya", `/customers/${c.id}/akt`]) {
    const r = await page(p);
    check(`${p} → 200`, r.status === 200, r.status);
  }

  section("Mobil ilova");
  const buh = await tok("test.buh");
  const m = await api("GET", `/api/mobile/detail?key=customers&id=${c.id}`, { token: buh });
  check("mobil mijoz kartochkasi: Qarz (debitorka) = balans", m.status === 200 && eq(digits(field(m.json, "Qarz (debitorka)")), BAL), m.json?.fields);
  const m2 = await api("GET", `/api/mobile/detail?key=customers&id=${c2.id}`, { token: buh });
  check("mobil avans mijoz: Avans 700 000", m2.status === 200 && eq(digits(field(m2.json, "Avans (oldindan to'langan)")), 700_000), m2.json?.fields);
  const md = await api("GET", "/api/mobile/detail?key=dash&id=receivable.month", { token: buh });
  check("mobil debitorka kartasi: Jami qarz = jami", md.status === 200 && eq(digits(field(md.json, "Jami qarz")), Math.round(exp.total)), { status: md.status, v: field(md.json, "Jami qarz"), exp: exp.total });
  const home = await api("GET", "/api/mobile/home", { token: buh });
  check("mobil buxgalter bosh ekrani → 200", home.status === 200, home.status);

  await db.$disconnect();
  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
