// QA (B) — server action'larni HTTP orqali chaqiruvchi yordamchi. Faqat test bazasiga qarshi ishlating.
// Ishlatish: QA_BASE=http://localhost:3202 node scripts/qa/b-....mjs
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.QA_BASE ?? "http://localhost:3202";
const manifest = JSON.parse(fs.readFileSync(path.resolve(".next/server/server-reference-manifest.json"), "utf8"));

/** "fayl#nom" (masalan "(app)/receipts/actions#createReceipt") va qisqa "nom" bo'yicha action id. */
export const A = {};
for (const [id, e] of Object.entries(manifest.node)) {
  const f = e.filename.replace(/^app\//, "").replace(/\.tsx?$/, "");
  A[`${f}#${e.exportedName}`] = id;
  A[e.exportedName] ??= id;
}

export class Client {
  constructor(extraHeaders = {}) { this.cookies = {}; this.h = extraHeaders; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [kv] = sc.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (v === "" || /max-age=0/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
  }
  async get(p, headers = {}) {
    const res = await fetch(BASE + p, { headers: { cookie: this.cookieHeader(), ...this.h, ...headers }, redirect: "manual" });
    this.absorb(res);
    return { status: res.status, location: res.headers.get("location"), text: await res.text(), headers: res.headers };
  }
  /** args: massiv; FormData React encodeReply kabi kodlanadi. */
  async action(name, args, page = "/dashboard", headers = {}) {
    const id = A[name]; if (!id) throw new Error("no action " + name);
    let body; const fdIdx = args.findIndex((a) => a instanceof FormData);
    let part = 0; const pid = [];
    const enc = args.map((a, i) => a === undefined ? "$undefined" : a instanceof FormData ? `$K${(pid[i] = ++part).toString(16)}` : a);
    if (fdIdx >= 0) {
      body = new FormData();
      args.forEach((a, i) => { if (a instanceof FormData) for (const [k, v] of a.entries()) body.append(`_${pid[i]}_${k}`, v); });
      body.append("0", JSON.stringify(enc));
    } else body = JSON.stringify(enc);
    const res = await fetch(BASE + page, {
      method: "POST", body, redirect: "manual",
      headers: { cookie: this.cookieHeader(), "Next-Action": id, Accept: "text/x-component", ...this.h, ...headers },
    });
    this.absorb(res);
    const text = await res.text();
    const redirect = res.headers.get("x-action-redirect");
    // FORBIDDEN — requireSession/requireAction rad etganda server xato digest bilan qaytaradi
    const forbidden = /E\{"digest"/.test(text);
    return { status: res.status, redirect, text, error: actionError(text) ?? (forbidden ? "FORBIDDEN(digest)" : null), ok: /^1:\{"ok":true/m.test(text) || /^0:.*"ok":true/m.test(text), forbidden };
  }
  async login(login, password = "Test2026") {
    const r = await this.action("(auth)/login/actions#loginAction", [undefined, fd({ login, password })], "/login");
    if (!this.cookies.session && !Object.keys(this.cookies).length) throw new Error(`login ${login} failed: ${r.text.slice(0, 200)}`);
    return r;
  }
}
/** RSC javobidan `{"error":"..."}` ni ajratadi. */
export function actionError(text) {
  // Action natijasi "1:" qatorida; sahifa daraxtida boshqa "error" kalitlari ham bo'lishi mumkin
  const line = text.match(/^1:(\{.*\})$/m);
  if (line) { try { const v = JSON.parse(line[1]); if (typeof v.error === "string" && !v.error.startsWith("$")) return v.error; return null; } catch { /* pastga */ } }
  for (const m of text.matchAll(/"error":"((?:[^"\\]|\\.)*)"/g)) if (!m[1].startsWith("$")) return JSON.parse(`"${m[1]}"`);
  return null;
}
export const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x instanceof Blob ? x : String(x));
    else if (v instanceof Blob) f.append(k, v);
    else if (v !== undefined && v !== null) f.append(k, String(v));
  }
  return f;
};

let fails = 0, passes = 0;
export function check(cond, msg, extra) {
  if (cond) { passes++; console.log("  ok  " + msg); }
  else { fails++; console.log("  FAIL " + msg + (extra !== undefined ? " :: " + (typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400) : "")); }
}
export function summary(name) {
  console.log(`\n${name}: ${passes} ok, ${fails} fail`);
  if (fails) process.exitCode = 1;
}
export const idFrom = (redirect) => redirect?.split(";")[0].split("?")[0].split("/").filter(Boolean).pop();
export const token = () => crypto.randomUUID();

/** Login bo'lgan mijozlar keshi */
const clients = new Map();
export async function as(role) {
  if (!clients.has(role)) { const c = new Client(); await c.login(`test.${role}`); clients.set(role, c); }
  return clients.get(role);
}

// ── Bazadan to'g'ridan-to'g'ri o'qish (psql) — faqat insof_test… bazasi ──
import { execFileSync } from "node:child_process";
export const DB_URL = process.env.QA_DB ?? "postgresql://otabek@localhost:5432/insof_test_b";
if (!/\/insof_test[\w]*(\?|$)/.test(DB_URL)) throw new Error("QA_DB faqat insof_test… bazasi bo'lishi kerak");
/** SQL natijasi: qatorlar massivi (har biri ustunlar massivi). */
export function q(sql) {
  const out = execFileSync("psql", [DB_URL, "-At", "-F", "\t", "-c", sql], { encoding: "utf8" }).trim();
  return out ? out.split("\n").map((l) => l.split("\t")) : [];
}
export const q1 = (sql) => q(sql)[0]?.[0] ?? null;
export const n1 = (sql) => Number(q1(sql) ?? 0);
