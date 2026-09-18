import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseRange } from "@/lib/bi/core";
import { salesExport } from "@/lib/bi/sales";
import { customerBase } from "@/lib/bi/customers";
import { materialOverview } from "@/lib/bi/stock";
import { returnsTab } from "@/lib/bi/returns";
import { agentsTab } from "@/lib/bi/agents";
import { dateTime, date as fmtDate } from "@/lib/format";

const csv = (rows: (string | number | null | undefined)[][]) =>
  "﻿" + rows.map((r) => r.map((c) => { const s = c === null || c === undefined ? "" : String(c); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\r\n");

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || !["DIRECTOR", "FINANCE", "ACCOUNTING"].includes(s.role)) return new NextResponse("Forbidden", { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const r = parseRange(sp);
  let rows: (string | number | null | undefined)[][] = [], name = "export";

  if (sp.type === "sales") {
    name = "sotuv";
    rows = [["Sana", "Zayavka", "Holat", "Mijoz", "Marka", "Mahsulot", "Miqdor", "Birlik", "Narx", "Bazaviy narx", "Summa", "Tannarx", "Foyda"],
      ...(await salesExport(r)).map((x) => [dateTime(x.date), x.orderNo, x.status, x.customer, x.code, x.product, x.qty, x.unit, x.price, x.basePrice, x.revenue, x.cost, x.revenue - x.cost])];
  } else if (sp.type === "customers") {
    name = "mijozlar";
    rows = [["Mijoz", "Telefon", "Segment", "Xavf", "Xavf bali", "Oxirgi buyurtma", "Necha kun", "Buyurtmalar (180 kun)", "Sotuv (180 kun)", "Umumiy sotuv", "Qarz", "Muddati o'tgan", "Kutilayotgan yo'qotish", "ABC", "Harakat"],
      ...(await customerBase()).map((c) => [c.name, c.phone, c.segment, c.risk, c.riskScore, c.lastOrder ? fmtDate(c.lastOrder) : "", c.recency, c.frequency, c.monetary, c.lifetime, c.debt, c.overdueDebt, Math.round(c.expectedLoss), c.abc, c.action])];
  } else if (sp.type === "materials") {
    name = "ombor";
    rows = [["Kod", "Xomashyo", "Birlik", "Qoldiq", "O'rt. narx", "Qiymat", "Kunlik sarf", "Yetadi (kun)", "Zona", "Rejadagi ehtiyoj", "Yetmaydi", "ABC", "Tavsiya miqdor", "Tavsiya summa"],
      ...(await materialOverview()).map((m) => [m.code, m.name, m.unit, m.balance, m.avgCost, m.value, m.perDay.toFixed(2), m.days === null ? "" : m.days.toFixed(1), m.zone, m.planned, m.short ? "ha" : "", m.abc, m.suggestQty.toFixed(1), Math.round(m.suggestCost)])];
  } else if (sp.type === "payments") {
    name = "tolovlar";
    const list = await db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, include: { customer: true, cashAccount: true, invoice: true }, orderBy: { date: "desc" } });
    rows = [["Sana", "Mijoz", "Kassa/hisob", "Schyot", "Summa", "Izoh"], ...list.map((p) => [dateTime(p.date), p.customer.name, p.cashAccount.name, p.invoice?.invoiceNo ?? "", Number(p.amount), p.note ?? ""])];
  } else if (sp.type === "returns") {
    name = "bekor";
    const d = await returnsTab(r, "day", { page: 1, size: 100000 });
    rows = [["Sana", "Zayavka", "Mijoz", "Sotuvchi", "Marka", "Miqdor", "Birlik", "Narx", "Summa", "Yo'qotilgan foyda", "Sabab"],
      ...d.list.rows.map((x) => [dateTime(x.date), x.orderNo, x.customer, x.seller, x.code, x.qty, x.unit, x.price, x.revenue, Math.round(x.margin), x.reason])];
  } else if (sp.type === "agents") {
    name = "sotuvchilar";
    const d = await agentsTab(r);
    rows = [["Sotuvchi", "Daraja", "Ball", "Sotuv", "Oldingi davr", "Zayavka (sotuv)", "Kiritilgan", "Bekor", "Hajm m3", "Mijozlar", "O'rt. chek", "Konversiya %", "Odatiy kunlik", "Hozirgi kunlik", "Sekinlashuv sababi", "Reja", "Reja %"],
      ...d.sellers.map((x) => [x.name, x.tier, x.score, Math.round(x.revenue), Math.round(x.prevRevenue), x.orders, x.created, x.cancelled, x.volume, x.customers, Math.round(x.avgCheck), x.conversion.toFixed(1), Math.round(x.usualPerDay), Math.round(x.nowPerDay), x.slowReason ?? "", x.plan ?? "", x.planPct === null ? "" : x.planPct.toFixed(1)])];
  } else return new NextResponse("Unknown type", { status: 400 });

  return new NextResponse(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="bi-${name}-${r.label.replace(/[^\d.]/g, "_")}.csv"` } });
}
