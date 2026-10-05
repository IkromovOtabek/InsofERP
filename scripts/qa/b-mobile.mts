// QA (B) — mobil ro'yxat/kartochka: storno qilingan kirim va zames aniq belgilanadi, qoldiq/hisobotga kirmaydi.
// Lib funksiyalari to'g'ridan-to'g'ri chaqiriladi (HTTP emas). Ishga tushirish: DATABASE_URL=... npx tsx scripts/qa/b-mobile.mts
import { check, summary, q, q1 } from "./b-client.mjs";

process.env.DATABASE_URL ??= process.env.QA_DB ?? "postgresql://otabek@localhost:5432/insof_test_b";
const { mobileList } = await import("../../src/lib/mobile/list");
const { mobileDetail } = await import("../../src/lib/mobile/detail");
const { lastInboundMoves } = await import("../../src/lib/stock");

const u = q(`select id, login, "fullName" from "User" where login='test.direktor'`)[0];
const user = { id: u[0], login: u[1], fullName: u[2], role: "DIRECTOR" as const, roleLabel: "Direktor" };

const rec = q1(`select id from "GoodsReceipt" where "cancelledAt" is not null order by "cancelledAt" desc limit 1`);
const bat = q1(`select id from "ProductionBatch" where "cancelledAt" is not null order by "cancelledAt" desc limit 1`);
if (!rec || !bat) { check(false, "storno qilingan kirim va zames kerak — avval b-receipts va b-production ni ishga tushiring"); summary("b-mobile"); process.exit(); }

const rl = await mobileList(user, "receipts");
const rrow = rl.rows.find((x) => x.id === rec);
check(!!rrow && rrow.status === "Storno" && rrow.right === "storno", "mobil kirimlar ro'yxatida storno belgilangan", rrow);
const okRow = rl.rows.find((x) => x.id !== rec && !x.status);
check(!okRow || /\d/.test(String(okRow.right)), "oddiy kirim summasi bilan ko'rinadi");
const rd = await mobileDetail(user, "receipts", rec);
check(rd.status === "Storno" && rd.fields.some((f) => f.label === "Holat" && /Storno/.test(f.value)) && /storno/.test(rd.receipt?.headline ?? ""), "mobil kirim kartochkasida storno holati", { status: rd.status, headline: rd.receipt?.headline });

const pl = await mobileList(user, "production");
const prow = pl.rows.find((x) => x.id === bat);
check(!!prow && prow.status === "Storno", "mobil zameslar ro'yxatida storno belgilangan", prow);
const pd = await mobileDetail(user, "production", bat);
check(pd.status === "Storno" && pd.fields.some((f) => f.label === "Holat" && /Storno/.test(f.value)), "mobil zames kartochkasida storno holati", pd.fields[0]);

// Xomashyo kartochkasi: storno harakati alohida nomlanadi
const mat = q1(`select "materialId" from "StockMove" where "refId"='${rec}' and qty < 0 limit 1`)!;
const md = await mobileDetail(user, "stock", mat);
const moves = md.sections.find((s) => /harakat/i.test(s.title));
check(!!moves && moves.rows.some((r) => /^Storno/.test(String(r.title))), "xomashyo harakatlarida 'Storno' nomi", moves?.rows.slice(0, 5).map((r) => r.title));

// "Oxirgi kirim" storno qilingan hujjatdan olinmaydi
const last = await lastInboundMoves();
const stornoMoveIds = new Set(q(`select "materialId" from "StockMove" where "refId"='${rec}' and qty > 0`).map((r) => r[0]));
const lastRec = q(`select s."materialId", s.date from "StockMove" s where s."refId"='${rec}' and s.qty > 0`);
const leaked = lastRec.filter(([m, d]) => last.materials.get(m)?.date.getTime() === new Date(d).getTime() && stornoMoveIds.has(m));
check(leaked.length === 0, "storno qilingan kirim 'oxirgi kirim' bo'lib ko'rinmaydi", leaked);

summary("b-mobile");
process.exit();
