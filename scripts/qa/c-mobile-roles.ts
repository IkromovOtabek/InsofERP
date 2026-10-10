/**
 * QA (C) — har bir rol uchun barcha /api/mobile/* endpointlari: 500 yo'q, ruxsatsiz → 403/404,
 * ro'yxat va kartochkalar "o'rgimchak" bilan aylanib chiqiladi (home → kartalar → ro'yxat → kartochka → ichki qatorlar).
 */
import { api, check, done, section, tok, ROLES } from "./c-lib";

const LISTS: Record<string, string[]> = {
  orders: ["AGENT", "SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"],
  sales: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"],
  customers: ["AGENT", "SALES", "ACCOUNTING", "FINANCE"],
  leads: ["SALES"],
  invoices: ["ACCOUNTING", "FINANCE", "SALES", "CASHIER"],
  production: ["PRODUCTION", "SUPERVISOR"],
  recipes: ["PRODUCTION"],
  tasks: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS", "BRIGADIER"],
  brigades: ["SUPERVISOR", "PRODUCTION", "HR", "SALES"],
  "prod-report": ["PRODUCTION", "SUPERVISOR"],
  "brig-issues": ["BRIGADIER", "PRODUCTION", "SUPERVISOR", "WAREHOUSE", "PROCUREMENT", "HR"],
  "brig-shifts": ["BRIGADIER", "PRODUCTION", "SUPERVISOR"],
  trips: ["LOGISTICS", "PRODUCTION", "SUPERVISOR", "DRIVER", "MECHANIC"],
  drivers: ["LOGISTICS", "HR"],
  stock: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS", "MECHANIC"],
  snabjeniye: ["WAREHOUSE", "PROCUREMENT"],
  supply: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SALES", "FINANCE", "ACCOUNTING", "CASHIER"],
  receipts: ["PROCUREMENT", "WAREHOUSE", "SALES"],
  suppliers: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"],
  cashflow: ["CASHIER", "ACCOUNTING", "FINANCE"],
  payments: ["CASHIER", "ACCOUNTING", "FINANCE"],
  employees: ["HR", "LOGISTICS", "PRODUCTION", "SUPERVISOR"],
  approvals: [],
  activity: [],
};
/** Face ID skaneri doirasi (`faceScope`): otdel kadr darajasi — hamma, sex boshliqlari — sex; qolganlarda skaner yo'q. */
const SCANNER: Record<string, "all" | "sex" | undefined> = { DIRECTOR: "all", HR: "all", PRODUCTION: "sex", SUPERVISOR: "sex" };
const DETAIL_KEY: Record<string, string> = { sales: "orders", snabjeniye: "supply", drivers: "employees", "brig-issues": "brig-issue", "brig-shifts": "brig-shift" };
const FORMS = ["orders", "trips", "supply", "customers", "suppliers", "brigades"];

type Open = { key: string; id: string };

/** JSON ichidan barcha `open: {key,id}` va `{target, rows:[{id}]}` havolalarini yig'adi. */
function collect(j: unknown, out: Open[]) {
  if (!j || typeof j !== "object") return;
  if (Array.isArray(j)) { for (const x of j) collect(x, out); return; }
  const o = j as Record<string, unknown>;
  const op = o.open as Open | undefined;
  if (op && typeof op.key === "string" && typeof op.id === "string") out.push(op);
  if (typeof o.target === "string" && Array.isArray(o.rows)) {
    for (const r of (o.rows as { id?: unknown }[]).slice(0, 3)) if (typeof r?.id === "string") out.push({ key: DETAIL_KEY[o.target] ?? o.target, id: r.id });
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") collect(v, out);
}

async function main() {
  const fives: string[] = [];
  const no500 = (what: string, s: number) => { if (s >= 500) fives.push(`${what} → ${s}`); };

  for (const login of ROLES) {
    const t = await tok(`test.${login}`);
    const me = await api("GET", "/api/mobile/me", { token: t });
    const role = me.json?.role as string;
    section(`${login} (${role})`);
    const opens: Open[] = [];

    for (const q of ["", "?period=week", "?period=month", "?period=year", "?period=custom&from=2026-01-01&to=2026-12-31", "?revenue=week", "?period=zzz", "?from=bad&to=bad"]) {
      const r = await api("GET", `/api/mobile/home${q}`, { token: t });
      no500(`${login} home${q}`, r.status);
      if (q === "") { check(`home → 200`, r.status === 200, r.json); collect(r.json, opens); }
      if (q === "") {
        // «Davomat» — hamma xodimda: o'z davomati + umumiy jadval (faqat ko'rish); skaner faqat ruxsati borlarda
        const a = r.json?.attendance;
        const scan = SCANNER[role];
        check(`home: «Davomat» (jadval, xodim kartasi${scan ? `, skaner ${scan}` : ", skanersiz"})`,
          a?.canViewTable === true && a?.linked === true && a?.canScan === !!scan && a?.canEnroll === (scan === "all") && !!r.json?.selfAttendance
          && !!r.json?.faceAttendance === !!scan, { a, face: r.json?.faceAttendance });
      }
    }
    {
      // Jadval — faqat ko'rish: hamma xodim qatorlari; manba/izoh faqat mas'ullarga
      const r = await api("GET", "/api/mobile/attendance/day", { token: t });
      const rows: { id: string; source: string | null; note: string | null }[] = r.json?.rows ?? [];
      check(`davomat jadvali → 200 (${rows.length} xodim)`, r.status === 200 && rows.length > 0, { s: r.status });
      if (!SCANNER[role]) check(`jadvalda manba va izoh yashirilgan`, rows.every((x) => x.source === null && x.note === null));
      const e = rows[0] ? await api("GET", `/api/mobile/attendance/employee?id=${rows[0].id}`, { token: t }) : null;
      check(`xodimning oylik varag'i → 200`, e?.status === 200, { s: e?.status });
      if (!SCANNER[role]) {
        check(`oylik varaqda telefon, manba, izoh yo'q`, e?.json?.employee?.phone === null && (e?.json?.days ?? []).every((d: { source: unknown; note: unknown }) => d.source === null && d.note === null));
        const f = await api("GET", "/api/mobile/face", { token: t });
        check(`skaner ma'lumoti (GET /face) → 403`, f.status === 403, { s: f.status });
        const sc = await api("POST", "/api/mobile/face/scan", { token: t, body: { mode: "auto", photo: "x" } });
        check(`skaner (POST /face/scan) → rad`, sc.json?.ok === false && sc.json?.code === "FORBIDDEN", { s: sc.status, j: sc.json });
        const en = await api("POST", "/api/mobile/face/enroll", { token: t, body: { employeeId: rows[0]?.id, consent: true, photo: "x" } });
        check(`yuz olish (POST /face/enroll) → rad`, en.json?.ok === false && /otdel kadr/.test(en.json?.error ?? ""), { s: en.status, j: en.json });
      }
    }
    for (const p of ["/api/mobile/notifications", "/api/mobile/account"]) {
      const r = await api("GET", p, { token: t });
      check(`${p} → 200`, r.status === 200, r.json);
    }
    let listOk = 0, listDenied = 0;
    for (const [key, roles] of Object.entries(LISTS)) {
      const allowed = role === "DIRECTOR" || roles.includes(role);
      const r = await api("GET", `/api/mobile/list?key=${key}`, { token: t });
      no500(`${login} list ${key}`, r.status);
      if (allowed) {
        if (r.status === 200) listOk++; else check(`list ${key} → 200`, false, r.json);
        for (const row of (r.json?.rows ?? []).slice(0, 4)) if (typeof row?.id === "string") opens.push({ key: DETAIL_KEY[key] ?? key, id: row.id });
        for (const f of (r.json?.filters ?? []).slice(0, 6)) {
          const rf = await api("GET", `/api/mobile/list?key=${key}&filter=${encodeURIComponent(f.key)}&q=a`, { token: t });
          no500(`${login} list ${key} filter=${f.key}`, rf.status);
        }
      } else if (r.status === 403) listDenied++;
      else check(`list ${key} ruxsatsiz → 403`, false, `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
    }
    check(`ro'yxatlar: ${listOk} ochiq, ${listDenied} yopiq, 500 yo'q`, true);
    const unk = await api("GET", "/api/mobile/list?key=constructor", { token: t });
    check("list key=constructor → 404", unk.status === 404, unk.status);

    // Kartochkalar — ikki qavat chuqurlikda
    const seen = new Set<string>();
    let depth = 0, queue = opens;
    let ok = 0, denied = 0;
    while (queue.length && depth < 2) {
      const next: Open[] = [];
      for (const o of queue) {
        const k = `${o.key}|${o.id}`;
        if (seen.has(k) || seen.size > 120) continue;
        seen.add(k);
        const r = await api("GET", `/api/mobile/detail?key=${encodeURIComponent(o.key)}&id=${encodeURIComponent(o.id)}`, { token: t });
        no500(`${login} detail ${o.key}/${o.id}`, r.status);
        if (r.status === 200) { ok++; collect(r.json?.sections, next); } else denied++;
      }
      queue = next; depth++;
    }
    check(`kartochkalar: ${ok} ochildi, ${denied} rad/yo'q, 500 yo'q`, true);
    for (const key of ["orders", "trips", "invoices", "payments", "receipts", "tasks", "production", "stock", "employees", "cashflow", "supply", "customers", "leads", "brigades", "suppliers", "recipes", "dash", "sex", "problem", "brig-issue", "brig-shift", "prod-report", "rep", "activity", "nope"]) {
      const r = await api("GET", `/api/mobile/detail?key=${key}&id=yoq-id-123`, { token: t });
      no500(`${login} detail ${key}/yoq-id`, r.status);
    }
    const ref = await api("GET", `/api/mobile/detail?key=orders&id=${encodeURIComponent("orders:orders:x")}`, { token: t });
    no500(`${login} detail ref`, ref.status);

    for (const [k, id] of [["constructor", "x"], ["toString", "x"], ["__proto__", "x"], ["dash", "constructor.week"], ["dash", "toString"]]) {
      const r = await api("GET", `/api/mobile/detail?key=${k}&id=${id}`, { token: t });
      check(`detail ${k}/${id} → 404/403`, r.status === 404 || r.status === 403, r.status);
    }
    const fc = await api("GET", "/api/mobile/form?key=constructor", { token: t });
    check("form key=constructor → 404", fc.status === 404, fc.status);
    const cc = await api("POST", "/api/mobile/create", { token: t, body: { key: "constructor", payload: {} } });
    check("create key=constructor → 404", cc.status === 404, cc.status);
    for (const f of FORMS) {
      const r = await api("GET", `/api/mobile/form?key=${f}`, { token: t });
      no500(`${login} form ${f}`, r.status);
    }
    for (const [m, p, body] of [
      ["GET", "/api/mobile/fleet", undefined],
      ["GET", "/api/mobile/trip-route?id=yoq", undefined],
      ["GET", "/api/mobile/trip-route", undefined],
      ["POST", "/api/mobile/track", { tripId: "yoq", points: [] }],
      ["POST", "/api/mobile/track", null],
      ["POST", "/api/mobile/action", { action: "toString", id: "x" }],
      ["POST", "/api/mobile/action", { action: "trip.fuel", id: "yoq", payload: {} }],
      ["POST", "/api/mobile/action", { action: "order.confirm", id: "yoq" }],
      ["POST", "/api/mobile/create", { key: "orders", payload: {} }],
      ["POST", "/api/mobile/create", { key: "nope", payload: null }],
      ["POST", "/api/mobile/notifications", { ids: "x" }],
      ["PUT", "/api/mobile/devices", { deviceId: 1 }],
      ["DELETE", "/api/mobile/devices", undefined],
      ["GET", "/api/mobile/report/daily", undefined],
      ["GET", "/api/mobile/ai", undefined],
    ] as [string, string, unknown][]) {
      const r = await api(m, p, { token: t, body });
      no500(`${login} ${m} ${p} ${JSON.stringify(body)}`, r.status);
    }
    const fleet = await api("GET", "/api/mobile/fleet", { token: t });
    check(`fleet: ${["DIRECTOR", "LOGISTICS", "MECHANIC"].includes(role) ? "200" : "403"}`, fleet.status === (["DIRECTOR", "LOGISTICS", "MECHANIC"].includes(role) ? 200 : 403), fleet.status);
    const rep = await api("GET", "/api/mobile/report/daily", { token: t });
    check(`kunlik hisobot: ${role === "DIRECTOR" ? "200" : "403"}`, rep.status === (role === "DIRECTOR" ? 200 : 403), rep.status);
  }

  section("Javob 500 bo'lmasligi (hamma rol, hamma endpoint)");
  check(`500 javoblar yo'q (${fives.length})`, fives.length === 0, fives.slice(0, 20).join("\n      "));
  done();
}
void main();
