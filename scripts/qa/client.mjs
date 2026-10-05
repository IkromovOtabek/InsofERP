// QA HTTP mijozi: server action'larni brauzer kabi chaqiradi (Next-Action sarlavhasi + RSC javobi).
// Action id'lari `.next/server/server-reference-manifest.json` dan olinadi — har build'dan keyin o'zi yangilanadi.
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.QA_BASE ?? "http://localhost:3201";
const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".next/server/server-reference-manifest.json"), "utf8"));
export const A = {};
for (const [id, v] of Object.entries(manifest.node)) {
  A[`${v.filename.replace(/^app\//, "").replace(/\.ts$/, "")}#${v.exportedName}`] = id;
}

export class Client {
  constructor(name = "") { this.name = name; this.cookies = {}; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [kv] = sc.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (v === "" || /max-age=0/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
  }
  async get(p) {
    const res = await fetch(BASE + p, { headers: { cookie: this.cookieHeader() }, redirect: "manual" });
    this.absorb(res);
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  }
  /** name: "orders/actions#createOrder" (`(app)/` prefiksisiz ham bo'ladi). FormData — React encodeReply kabi kodlanadi. */
  async action(name, args, page = "/dashboard") {
    const id = A[name] ?? A[`(app)/${name}`];
    if (!id) throw new Error("action topilmadi: " + name);
    let part = 0; const pid = [];
    const enc = args.map((a, i) => a === undefined ? "$undefined" : a instanceof FormData ? `$K${(pid[i] = ++part).toString(16)}` : a);
    let body;
    if (args.some((a) => a instanceof FormData)) {
      body = new FormData();
      args.forEach((a, i) => { if (a instanceof FormData) for (const [k, v] of a.entries()) body.append(`_${pid[i]}_${k}`, v); });
      body.append("0", JSON.stringify(enc));
    } else body = JSON.stringify(enc);
    const res = await fetch(BASE + page, {
      method: "POST", body, redirect: "manual",
      headers: { cookie: this.cookieHeader(), "Next-Action": id, Accept: "text/x-component" },
    });
    this.absorb(res);
    const text = await res.text();
    return { status: res.status, redirect: res.headers.get("x-action-redirect"), text, result: parseResult(text) };
  }
  async login(login, password = "Test2026") {
    const r = await this.action("(auth)/login/actions#loginAction", [undefined, fd({ login, password })], "/login");
    if (!Object.keys(this.cookies).length) throw new Error(`login ${login} muvaffaqiyatsiz: ${r.status} ${r.text.slice(0, 300)}`);
    return r;
  }
}

/** RSC javobidagi action natijasi ("1:{...}" qatori). */
export function parseResult(text) {
  for (const line of text.split("\n")) {
    const m = line.match(/^1:(.*)$/);
    if (m) { try { return JSON.parse(m[1]); } catch { return m[1]; } }
  }
  return undefined;
}

export const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, String(x));
    else if (v !== undefined && v !== null) f.append(k, String(v));
  }
  return f;
};

// ── Tekshiruv yordamchilari ──
let pass = 0, fail = 0;
export function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${typeof extra === "string" ? extra : JSON.stringify(extra)}`); }
}
export const eq2 = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
export function summary(title = "") {
  console.log(`\n${title} ${pass} OK, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
}
