import { excelNumber, roundHalfAway } from "@/lib/format";

/**
 * Oylik varaqlari (`PayrollSheet`) — Excel kataklari va formulalar hisoblagichi. Brauzer (tahrirdan keyin darhol)
 * va server (Excel eksporti, import tekshiruvi) bir xil hisoblaydi; tashqi kutubxona yo'q.
 *
 * Qo'llanadi: + − * / ^ & %, taqqoslash (= <> < > <= >=), katak va oraliq — boshqa varaqdan ham
 * (`Ауп!C4`, `'БРУ 1'!A1:B9`, `$E$28`), funksiyalar `FUNCS` da (SUM, SUMPRODUCT, IFERROR, ROUND, IF, MIN, MAX…).
 * Tushunilmagan formula (tashqi fayl `[1]…`, nomlangan diapazon, butun ustun) qayta hisoblanmaydi —
 * Excel saqlagan oxirgi qiymat ko'rsatiladi. Aylana havola ham shunday.
 */

/** Katak: `v` — qiymat (formula bo'lsa Excel'dagi oxirgi natija), `e` — xato (#DIV/0!…), `f` — formula («=» siz), `s` — uslub indeksi. */
export type Cell = { v?: number | string | boolean; e?: string; f?: string; s?: number };
/** Uslub: fon, raqam formati, qalin/kursiv, shrift rangi/o'lchami, tekislash, so'z ko'chirish, chegaralar (1 tepa, 2 o'ng, 4 past, 8 chap). */
export type SheetStyle = {
  bg?: string; z?: string; b?: 1; i?: 1; fc?: string; fs?: number;
  ha?: "left" | "center" | "right"; va?: "top" | "center" | "bottom"; w?: 1; bd?: number;
};
/** Varaq: o'lcham, ustun eni / satr balandligi (px), yashirinlar, muzlatilgan qator/ustun, birlashganlar, uslublar, kataklar. */
export type SheetData = {
  nr: number; nc: number;
  cw: Record<number, number>; rh: Record<number, number>;
  dcw?: number; drh?: number; // sukut ustun eni / satr balandligi (px)
  hc?: number[]; hr?: number[];
  frz?: [number, number];
  zm?: number; // Excel'dagi masshtab, % (100 dan farqli bo'lsa)
  bf?: number; // asosiy shrift o'lchami, pt (uslubdagi `fs` shunga nisbatan)
  mg: [number, number, number, number][];
  st: SheetStyle[];
  cells: Record<string, Cell>;
};

export type CellErr = { err: string };
export type Scalar = number | string | boolean | null;
export type Val = Scalar | CellErr;

export const isErr = (v: unknown): v is CellErr => typeof v === "object" && v !== null && "err" in v;

// ─────────────────────────── Manzillar ───────────────────────────

export function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function colIndex(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const addrOf = (r: number, c: number) => colName(c) + (r + 1);
export function parseAddr(a: string): [number, number] | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a);
  return m && Number(m[2]) > 0 ? [Number(m[2]) - 1, colIndex(m[1])] : null;
}

// ─────────────────────────── Parser ───────────────────────────

type Ref = { sh: string | null; r: number; c: number };
type Node =
  | { k: "num"; v: number } | { k: "str"; v: string } | { k: "bool"; v: boolean } | { k: "err"; v: string } | { k: "blank" }
  | ({ k: "ref" } & Ref)
  | { k: "range"; sh: string | null; r1: number; c1: number; r2: number; c2: number }
  | { k: "fn"; name: string; args: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

type Tok =
  | { t: "num"; v: number } | { t: "str"; v: string } | { t: "err"; v: string } | { t: "sheet"; v: string }
  | { t: "word"; v: string } | { t: "fn"; v: string } | { t: "op"; v: string };

/** Qo'llab-quvvatlanmaydigan formula (tashqi havola, nomlar…) — Excel qiymati qoladi. */
class Unsupported extends Error {}
/** Hisob davomidagi Excel xatosi (#VALUE!, #DIV/0!…). */
class XErr { constructor(public code: string) {} }

const ERR_RE = /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let s = ""; i++;
      while (i < src.length) {
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } break; }
        s += src[i++];
      }
      if (src[i] !== '"') throw new Unsupported("qo'shtirnoq yopilmagan");
      i++; out.push({ t: "str", v: s }); continue;
    }
    if (ch === "'") {
      let s = ""; i++;
      while (i < src.length) {
        if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } break; }
        s += src[i++];
      }
      if (src[i] !== "'" || src[i + 1] !== "!") throw new Unsupported("varaq nomi");
      i += 2; out.push({ t: "sheet", v: s }); continue;
    }
    if (ch === "[") throw new Unsupported("tashqi fayl havolasi");
    if (ch === "#") {
      const m = ERR_RE.exec(src.slice(i));
      if (!m) throw new Unsupported("xato literal");
      out.push({ t: "err", v: m[0] }); i += m[0].length; continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const word = /^[\p{L}\p{N}_.$]+/u.exec(src.slice(i));
    if (word) {
      const w = word[0]; i += w.length;
      if (src[i] === "!") { i++; out.push({ t: "sheet", v: w }); continue; }
      if (src[i] === "(") { out.push({ t: "fn", v: w.toUpperCase() }); continue; }
      out.push({ t: "word", v: w }); continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^&%=<>(),;:".includes(ch)) { out.push({ t: "op", v: ch === ";" ? "," : ch }); i++; continue; }
    throw new Unsupported(`belgi «${ch}»`);
  }
  return out;
}

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = toks[p]; return t?.t === "op" && t.v === v; };
  const expect = (v: string) => { if (!isOp(v)) throw new Unsupported(`«${v}» kutilgan`); p++; };

  const cmp = (): Node => {
    let a = concat();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.v)) { p++; a = { k: "bin", op: t.v, a, b: concat() }; } else return a;
    }
  };
  const concat = (): Node => { let a = add(); while (isOp("&")) { p++; a = { k: "bin", op: "&", a, b: add() }; } return a; };
  const add = (): Node => {
    let a = mul();
    for (;;) { const t = peek(); if (t?.t === "op" && (t.v === "+" || t.v === "-")) { p++; a = { k: "bin", op: t.v, a, b: mul() }; } else return a; }
  };
  const mul = (): Node => {
    let a = pow();
    for (;;) { const t = peek(); if (t?.t === "op" && (t.v === "*" || t.v === "/")) { p++; a = { k: "bin", op: t.v, a, b: pow() }; } else return a; }
  };
  const pow = (): Node => { let a = unary(); while (isOp("^")) { p++; a = { k: "bin", op: "^", a, b: unary() }; } return a; };
  const unary = (): Node => {
    const t = peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) { p++; return { k: "un", op: t.v, a: unary() }; }
    let a = primary();
    while (isOp("%")) { p++; a = { k: "un", op: "%", a }; }
    return a;
  };
  const cellRef = (w: string, sh: string | null): Ref => {
    const rc = parseAddr(w);
    if (!rc) throw new Unsupported(`nom «${w}»`);
    return { sh, r: rc[0], c: rc[1] };
  };
  const refOrRange = (sh: string | null): Node => {
    const t = toks[p++];
    if (t?.t !== "word") throw new Unsupported("katak kutilgan");
    if (/^(TRUE|FALSE)$/i.test(t.v) && sh === null) return { k: "bool", v: t.v.toUpperCase() === "TRUE" };
    const a = cellRef(t.v, sh);
    if (!isOp(":")) return { k: "ref", ...a };
    p++;
    let t2 = toks[p++];
    if (t2?.t === "sheet") t2 = toks[p++]; // A1:Varaq!B2 — bir varaq deb olinadi
    if (t2?.t !== "word") throw new Unsupported("oraliq oxiri");
    const b = cellRef(t2.v, sh);
    return { k: "range", sh, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new Unsupported("formula tugamagan");
    if (t.t === "num") { p++; return { k: "num", v: t.v }; }
    if (t.t === "str") { p++; return { k: "str", v: t.v }; }
    if (t.t === "err") { p++; return { k: "err", v: t.v }; }
    if (t.t === "sheet") { p++; return refOrRange(t.v); }
    if (t.t === "word") return refOrRange(null);
    if (t.t === "fn") {
      p++; expect("(");
      const args: Node[] = [];
      if (isOp(")")) { p++; return { k: "fn", name: t.v, args }; }
      for (;;) {
        if (isOp(",") || isOp(")")) args.push({ k: "blank" }); else args.push(cmp());
        if (isOp(",")) { p++; continue; }
        expect(")"); break;
      }
      return { k: "fn", name: t.v, args };
    }
    if (t.t === "op" && t.v === "(") { p++; const e = cmp(); expect(")"); return e; }
    throw new Unsupported(`kutilmagan «${t.v}»`);
  };
  const root = cmp();
  if (p < toks.length) throw new Unsupported("ortiqcha belgilar");
  return root;
}

// ─────────────────────────── Hisoblash ───────────────────────────

type RangeVal = { rng: { si: number; r1: number; c1: number; r2: number; c2: number } };
const isRange = (v: unknown): v is RangeVal => typeof v === "object" && v !== null && "rng" in v;

const NUM_TEXT = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;
function toNum(v: Scalar): number {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (NUM_TEXT.test(v)) return Number(v);
  throw new XErr("#VALUE!");
}
function toText(v: Scalar): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  return v;
}
function toBool(v: Scalar): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  throw new XErr("#VALUE!");
}
const finite = (n: number) => { if (!Number.isFinite(n)) throw new XErr("#NUM!"); return n; };
/** Excel 15 xonali aniqlikda saqlaydi: 0.1+0.2 → 0.3 (taqqoslash va ko'rinish uchun). */
const fix15 = (n: number) => (Number.isInteger(n) ? n : Number(n.toPrecision(15)));

type SheetIn = { name: string; cells: Record<string, Cell> };

/**
 * Kitob hisoblagichi. Har katak bir marta hisoblanadi (memo); tahrirdan keyin yangi `Book` yaratiladi.
 * `value(si, r, c)` — ko'rsatiladigan natija (formula katagi uchun hisoblangan, bo'lmasa Excel'dagi).
 */
export class Book {
  private names = new Map<string, number>();
  private memo = new Map<string, Val>();
  private busy = new Set<string>();
  private static ast = new Map<string, Node | null>();

  constructor(private sheets: SheetIn[]) {
    sheets.forEach((s, i) => this.names.set(s.name.toUpperCase(), i));
  }

  /** Formulani tahlil qilish (kesh bilan); qo'llab-quvvatlanmasa null. */
  static parse(f: string): Node | null {
    if (Book.ast.has(f)) return Book.ast.get(f)!;
    let n: Node | null = null;
    try { n = parseFormula(f); } catch (e) { if (!(e instanceof Unsupported)) throw e; }
    if (Book.ast.size > 50000) Book.ast.clear();
    Book.ast.set(f, n);
    return n;
  }

  /** Formula hisoblanadimi (yo'q bo'lsa — Excel qiymati ko'rsatiladi). */
  static supported(f: string) { return Book.parse(f) !== null; }

  private stored(c: Cell | undefined): Val {
    if (!c) return null;
    if (c.e) return { err: c.e };
    return c.v ?? null;
  }

  value(si: number, r: number, c: number): Val {
    const cell = this.sheets[si]?.cells[addrOf(r, c)];
    if (!cell?.f) return this.stored(cell);
    const key = `${si}:${r}:${c}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    if (this.busy.has(key)) return this.stored(cell); // aylana havola — Excel qiymati
    const ast = Book.parse(cell.f);
    if (!ast) { const v = this.stored(cell); this.memo.set(key, v); return v; }
    this.busy.add(key);
    let out: Val;
    try {
      const v = this.scalar(ast, si);
      out = v === null ? 0 : typeof v === "number" ? fix15(v) : v;
    } catch (e) {
      if (e instanceof XErr) out = { err: e.code };
      else if (e instanceof Unsupported || e instanceof RangeError) out = this.stored(cell);
      else throw e;
    } finally {
      this.busy.delete(key);
    }
    this.memo.set(key, out);
    return out;
  }

  private sheetIdx(sh: string | null, si: number): number {
    if (sh === null) return si;
    const i = this.names.get(sh.toUpperCase());
    if (i === undefined) throw new XErr("#REF!");
    return i;
  }

  /** Bitta katak qiymati (xato — istisno). */
  private cellScalar(si: number, r: number, c: number): Scalar {
    const v = this.value(si, r, c);
    if (isErr(v)) throw new XErr(v.err);
    return v;
  }

  private eval(n: Node, si: number): Scalar | RangeVal {
    if (n.k === "range") return { rng: { si: this.sheetIdx(n.sh, si), r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 } };
    if (n.k === "ref") return { rng: { si: this.sheetIdx(n.sh, si), r1: n.r, c1: n.c, r2: n.r, c2: n.c } };
    return this.scalar(n, si);
  }

  /** Oraliqni qiymatga: bitta katak bo'lsa — uning qiymati, aks holda #VALUE!. */
  private one(v: Scalar | RangeVal): Scalar {
    if (!isRange(v)) return v;
    const g = v.rng;
    if (g.r1 !== g.r2 || g.c1 !== g.c2) throw new XErr("#VALUE!");
    return this.cellScalar(g.si, g.r1, g.c1);
  }

  private scalar(n: Node, si: number): Scalar {
    switch (n.k) {
      case "num": return n.v;
      case "str": return n.v;
      case "bool": return n.v;
      case "blank": return null;
      case "err": throw new XErr(n.v);
      case "ref": case "range": return this.one(this.eval(n, si));
      case "un": {
        const a = toNum(this.scalar(n.a, si));
        return n.op === "-" ? -a : n.op === "%" ? a / 100 : a;
      }
      case "bin": {
        const a = this.scalar(n.a, si), b = this.scalar(n.b, si);
        switch (n.op) {
          case "+": return finite(toNum(a) + toNum(b));
          case "-": return finite(toNum(a) - toNum(b));
          case "*": return finite(toNum(a) * toNum(b));
          case "/": { const d = toNum(b); if (d === 0) throw new XErr("#DIV/0!"); return finite(toNum(a) / d); }
          case "^": return finite(Math.pow(toNum(a), toNum(b)));
          case "&": return toText(a) + toText(b);
          default: return compare(a, b, n.op);
        }
      }
      case "fn": return this.call(n.name, n.args, si);
    }
  }

  /** Oraliq (yoki qiymat) kataklarini aylanib chiqish: `cb(qiymat, to'g'ridan-to'g'ri argumentmi)`. */
  private each(arg: Node, si: number, cb: (v: Scalar, direct: boolean) => void) {
    if (arg.k === "blank") return;
    const v = this.eval(arg, si);
    if (!isRange(v)) { cb(v, true); return; }
    const g = v.rng;
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) cb(this.cellScalar(g.si, r, c), false);
  }

  private nums(args: Node[], si: number): number[] {
    const out: number[] = [];
    for (const a of args) this.each(a, si, (v, direct) => {
      if (typeof v === "number") out.push(v);
      else if (direct && v !== null) out.push(toNum(v));
    });
    return out;
  }

  private call(name: string, args: Node[], si: number): Scalar {
    const arg = (i: number) => (args[i] ? this.scalar(args[i], si) : null);
    switch (name) {
      case "SUM": return this.nums(args, si).reduce((x, y) => x + y, 0);
      case "MIN": { const a = this.nums(args, si); return a.length ? Math.min(...a) : 0; }
      case "MAX": { const a = this.nums(args, si); return a.length ? Math.max(...a) : 0; }
      case "AVERAGE": { const a = this.nums(args, si); if (!a.length) throw new XErr("#DIV/0!"); return a.reduce((x, y) => x + y, 0) / a.length; }
      case "COUNT": return this.nums(args, si).length;
      case "COUNTA": { let n = 0; for (const a of args) this.each(a, si, (v) => { if (v !== null && v !== "") n++; }); return n; }
      case "SUMPRODUCT": {
        if (!args.length) throw new XErr("#VALUE!");
        const arrs = args.map((a) => {
          const vals: Scalar[] = [];
          this.each(a, si, (v) => vals.push(v));
          return vals;
        });
        const len = arrs[0].length;
        if (arrs.some((a) => a.length !== len)) throw new XErr("#VALUE!");
        let sum = 0;
        for (let i = 0; i < len; i++) {
          let prod = 1;
          for (const a of arrs) prod *= typeof a[i] === "number" ? (a[i] as number) : 0;
          sum += prod;
        }
        return sum;
      }
      case "IFERROR": {
        try {
          return this.one(this.eval(args[0] ?? { k: "blank" }, si));
        } catch (e) {
          if (e instanceof XErr) return arg(1);
          throw e;
        }
      }
      case "IF": return toBool(arg(0)) ? (args.length > 1 ? arg(1) : true) : args.length > 2 ? arg(2) : false;
      case "ROUND": return roundHalfAway(toNum(arg(0)), Math.trunc(toNum(arg(1))));
      case "ROUNDUP": case "ROUNDDOWN": {
        const x = toNum(arg(0)), d = Math.trunc(toNum(arg(1))), p = 10 ** d;
        const a = Number((Math.abs(x) * p).toPrecision(15));
        return (Math.sign(x) * (name === "ROUNDUP" ? Math.ceil(a) : Math.floor(a))) / p;
      }
      case "INT": return Math.floor(toNum(arg(0)));
      case "ABS": return Math.abs(toNum(arg(0)));
      case "AND": case "OR": {
        const bs: boolean[] = [];
        for (const a of args) this.each(a, si, (v, direct) => { if (typeof v === "boolean" || typeof v === "number" || (direct && v !== null)) bs.push(toBool(v)); });
        if (!bs.length) throw new XErr("#VALUE!");
        return name === "AND" ? bs.every(Boolean) : bs.some(Boolean);
      }
      case "NOT": return !toBool(arg(0));
      case "CONCATENATE": return args.map((_, i) => toText(arg(i))).join("");
      default: throw new XErr("#NAME?");
    }
  }
}

function compare(a: Scalar, b: Scalar, op: string): boolean {
  const rank = (v: Scalar) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : -1);
  let x: Scalar = a, y: Scalar = b;
  if (x === null) x = typeof y === "string" ? "" : typeof y === "boolean" ? false : 0;
  if (y === null) y = typeof x === "string" ? "" : typeof x === "boolean" ? false : 0;
  let d: number;
  if (rank(x) !== rank(y)) d = rank(x) - rank(y);
  else if (typeof x === "string") { const s = x.toLowerCase(), t = (y as string).toLowerCase(); d = s < t ? -1 : s > t ? 1 : 0; }
  else d = Number(x) - Number(y);
  switch (op) {
    case "=": return d === 0;
    case "<>": return d !== 0;
    case "<": return d < 0;
    case ">": return d > 0;
    case "<=": return d <= 0;
    default: return d >= 0;
  }
}

// ─────────────────────────── Ko'rinish va kiritish ───────────────────────────

/** Katak natijasini matnga (raqam formati bo'yicha). */
export function displayVal(v: Val, z?: string): string {
  if (v === null || v === undefined) return "";
  if (isErr(v)) return v.err;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  return excelNumber(v, z);
}

/** Formula satrida ko'rinadigan xom matn: formula «=…», raqam nuqtali kasr bilan. */
export function rawText(c: Cell | undefined): string {
  if (!c) return "";
  if (c.f) return "=" + c.f;
  if (c.e) return c.e;
  if (c.v === undefined) return "";
  if (typeof c.v === "boolean") return c.v ? "TRUE" : "FALSE";
  return String(c.v);
}

/**
 * Foydalanuvchi yozgan matn → katak qiymati: «=…» formula (tekshiriladi), «1 200 000» / «1,5» / «10%» — raqam,
 * bo'sh — tozalash, qolgani matn. Xato bo'lsa `error`.
 */
export function parseInput(input: string, numText: (s: string) => string): { cell: Pick<Cell, "v" | "f">; error?: string } {
  const s = input.replace(/\r/g, "");
  if (!s.trim()) return { cell: {} };
  if (s.startsWith("=") && s.trim().length > 1) {
    const f = s.slice(1).trim();
    if (!Book.supported(f)) return { cell: {}, error: "Formula tushunilmadi — SUM, SUMPRODUCT, IFERROR, ROUND, IF, MIN, MAX, AVERAGE va + − * / ishlatiladi" };
    return { cell: { f } };
  }
  const t = s.trim();
  const pct = /%$/.test(t);
  const n = numText(pct ? t.slice(0, -1) : t);
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(n)) return { cell: { v: pct ? Number(n) / 100 : Number(n) } };
  if (/^(TRUE|FALSE)$/i.test(t)) return { cell: { v: t.toUpperCase() === "TRUE" } };
  return { cell: { v: s } };
}
