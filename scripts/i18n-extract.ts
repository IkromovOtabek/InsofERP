/**
 * Rus tili lug'ati uchun manba matnlarni yig'ish: kod ichidagi o'zbekcha (lotin) UI matnlari.
 *
 *   npx tsx scripts/i18n-extract.ts <chiqish.json> <papka>...
 *   npx tsx scripts/i18n-extract.ts scripts/i18n/source-erp.json src
 *
 * Natija: { exact: { matn: kontekst }, templates: { "{0} ta zayavka": kontekst } }.
 * `exact` — JSX matni, satr literallari; `templates` — `${}` li shablonlar ({0}, {1} — ifodalar o'rni).
 * Kontekst — tarjimonga yordam: shu matn turgan JSX/shablonning to'liq ko'rinishi va fayl.
 * Lug'atning o'zi (`src/i18n/ru.json`) qo'lda/tarjima bilan to'ldiriladi; bu skript faqat nima tarjima
 * qilinishi kerakligini ko'rsatadi (`--missing <ru.json>` — lug'atda hali yo'qlarini chiqaradi).
 */
import * as ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const [, , out, ...rest] = process.argv;
const missingIdx = rest.indexOf("--missing");
const dictPath = missingIdx >= 0 ? rest[missingIdx + 1] : null;
const roots = missingIdx >= 0 ? rest.filter((_, i) => i !== missingIdx && i !== missingIdx + 1) : rest;
if (!out || !roots.length) { console.error("ishlatish: tsx scripts/i18n-extract.ts <out.json> <papka>... [--missing ru.json]"); process.exit(1); }

/** Matn emas — atributlar va xossalar (stil, havola, kalit, ikonka …). */
const SKIP_ATTR = new Set(["className", "class", "href", "src", "key", "id", "type", "name", "value", "defaultValue", "htmlFor", "rel", "target", "method", "action", "role", "lang", "icon", "tone", "variant", "color", "size", "form", "accept", "autoComplete", "inputMode", "pattern", "testID", "nativeID", "style", "contentContainerStyle", "align", "v", "module", "route", "kind", "status", "encType", "dir", "mode", "format", "data-tour", "keyboardType", "autoCapitalize", "textContentType", "returnKeyType", "resizeMode"]);
const SKIP_PROP = new Set(["className", "href", "key", "id", "icon", "tone", "variant", "color", "module", "kind", "type", "route", "status", "path", "url", "src", "unit", "code", "field", "name", "value", "equals", "dependsOn", "target", "refType", "open", "group", "prefix", "prefixes", "module", "mode", "format", "lang", "slug", "env", "role", "roles", "action", "by", "orderBy", "select", "include", "where", "mime", "accept", "ext", "sort", "dir", "align", "camera", "screen", "tab", "v"]);
const SKIP_CALL = new Set(["require", "import", "console.log", "console.error", "console.warn", "console.info", "console.debug", "revalidatePath", "redirect", "fetch", "cookies().get", "searchParams.get", "get", "has", "set", "delete", "getItem", "setItem", "removeItem", "querySelector", "querySelectorAll", "addEventListener", "removeEventListener", "startsWith", "endsWith", "includes", "split", "join", "replace", "replaceAll", "indexOf", "match", "test", "RegExp", "Intl.NumberFormat", "toLocaleString", "toLocaleDateString", "padStart", "localeCompare", "findUnique", "createElement", "getAttribute", "setAttribute", "classList.add", "classList.remove", "classList.toggle", "useQuery", "router.push", "router.replace", "push", "env", "assertEnv", "Symbol"]);

const hasLatinWord = (s: string) => /[A-Za-z]{2,}/.test(s);
/** Kirill harflari lotindan ko'p — allaqachon ruscha/kirillcha matn. */
const isCyr = (s: string) => (s.match(/[А-Яа-яЁёЎўҚқҒғҲҳ]/g)?.length ?? 0) >= (s.match(/[A-Za-z]/g)?.length ?? 0);
/** Tailwind/CSS sinflar qatori: har bo'lak sinfga o'xshaydi va kamida bittasida "-" bor. */
const isClassList = (s: string) => { const w = s.trim().split(/\s+/); return w.length > 0 && w.every((x) => /^[!-]?[a-z0-9:[\]().%/#_&>*,'"=@+-]+$/.test(x)) && w.some((x) => /[a-z]-|:/.test(x)); };
/** JSX matnidagi HTML belgilari — DOM'da ochilgan ko'rinishda bo'ladi. */
const ENT: Record<string, string> = { apos: "'", quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…", rarr: "→", larr: "←", middot: "·", times: "×", minus: "−", le: "≤", ge: "≥", deg: "°", sup2: "²", sup3: "³", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
const decode = (s: string) => s.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);

/** UI matniga o'xshaydimi (identifikator, yo'l, stil, kod emas). */
function looksUi(s: string, strong: boolean): boolean {
  const t = s.trim();
  if (t.length < 2 || !hasLatinWord(t) || isCyr(t) || isClassList(t)) return false;
  if (/^[@./~#]|^https?:|:\/\/|^\w+:\/\/|^data:|^mailto:|^tel:/.test(t)) return false; // yo'l, URL
  if (/^[\w$-]+\.[\w.$-]+$/.test(t) && !/\s/.test(t)) return false; // a.b.c, fayl.tsx
  if (/^[A-Z0-9_]+$/.test(t)) return false; // ENUM_KOD
  if (/^[a-z][a-zA-Z0-9]*$/.test(t) && /[A-Z]/.test(t)) return false; // camelCase
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(t)) return false; // kebab-case, snake_case
  if (/(^|\s)(?:-?[a-z]+:)*-?(?:p[xytrbl]?|m[xytrbl]?|w|h|min-w|max-w|gap|text|bg|border|rounded|flex|grid|items|justify|col|row|font|leading|tracking|shadow|ring|inset|top|left|right|bottom|z|overflow|opacity|space|divide|transition|duration|ease|translate|scale|rotate|origin|cursor|select|pointer|sr|line|whitespace|truncate|tabular|inline|block|hidden|absolute|relative|fixed|sticky|static|accent|fill|stroke|object|aspect|basis|grow|shrink|order|place|self|content|list|underline|decoration|outline|animate|backdrop|blur|from|to|via)(?:-[\w./[\]%#-]+)?(?=\s|$)/.test(t) && !/[.,!?:;'ʻ’]/.test(t.replace(/\[[^\]]*\]/g, "").replace(/[\w-]+\/\d+/g, ""))) return false; // tailwind
  if (/^[\w-]+(\s[\w-]+)*$/.test(t) && t.split(/\s+/).every((w) => /-/.test(w) || /^(flex|grid|hidden|block|inline|truncate|underline|uppercase|lowercase|capitalize|italic|relative|absolute|fixed|sticky|static|tabular|group|peer|container|prose|dark|sr-only)$/.test(w))) return false;
  if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(t)) return false;
  if (/^[a-z]+\/[a-z0-9.+-]+$/i.test(t)) return false; // mime
  if (/^(asc|desc|true|false|null|undefined|use client|use server|nodejs|edge|force-dynamic|utf-?8|base64|hex|latin1)$/i.test(t)) return false;
  if (/[{}<>]|=>|\(\)|;\s*$|^\$|\bfunction\b|\bconst\b|\breturn\b/.test(t)) return false; // kod
  if (/^[a-z][\w-]*=/.test(t)) return false; // cookie=...
  if (/^\d+[\w%.]*$/.test(t)) return false;
  if (strong) return true; // JSX matni, label/title kabi xossalar
  // Kuchsiz kontekst: bo'shliq, bosh harf yoki o'zbekcha tutuq belgisi bo'lsa
  return /\s/.test(t) || /^[A-ZŌÖ]/.test(t) || /[a-z]['ʻ’][a-z]/.test(t);
}

const UI_PROPS = new Set(["label", "title", "subtitle", "hint", "message", "placeholder", "description", "text", "empty", "submitLabel", "confirm", "caption", "error", "help", "note", "tooltip", "heading", "name_uz", "header", "aria-label", "alt", "summary", "body", "short", "long", "action", "cta", "badge", "tip", "info", "warning", "success", "question", "answer"]);

const exact = new Map<string, string>();
const templates = new Map<string, string>();
const add = (m: Map<string, string>, k: string, ctx: string) => { const t = k.replace(/\s+/g, " ").trim(); if (!m.has(t)) m.set(t, ctx.slice(0, 220)); };

function calleeName(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return `${calleeName(e.expression)}.${e.name.text}`.replace(/^.*\.(\w+\.\w+)$/, "$1");
  if (ts.isCallExpression(e)) return `${calleeName(e.expression)}()`;
  return "";
}

/** Literalning konteksti: qaysi atribut/xossa/chaqiruv ichida. null — umuman o'tkazib yuboriladi. */
function context(n: ts.Node): { strong: boolean } | null {
  let p = n.parent;
  // (a ?? "x"), a ? "x" : "y", "x" + y — bir pog'ona yuqoriga
  while (p && (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression?.(p) || ts.isNonNullExpression(p) || ts.isTemplateSpan(p) || ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p))) {
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return null;
    if (ts.isArrayLiteralExpression(p)) { p = p.parent; break; }
    p = p.parent;
  }
  if (!p) return { strong: false };
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p) || ts.isImportTypeNode(p)) return null;
  if (ts.isCaseClause(p) || ts.isElementAccessExpression(p) || ts.isEnumMember(p)) return null;
  if (ts.isJsxAttribute(p)) {
    const a = p.name.getText();
    return SKIP_ATTR.has(a) || a.startsWith("data-") && a !== "data-title" ? null : { strong: true };
  }
  if (ts.isJsxExpression(p)) {
    const pp = p.parent;
    if (ts.isJsxAttribute(pp)) { const a = pp.name.getText(); return SKIP_ATTR.has(a) || a.startsWith("data-") ? null : { strong: true }; }
    return { strong: true }; // {"matn"} JSX ichida
  }
  if (ts.isPropertyAssignment(p)) {
    if (p.name === n) return null; // kalit
    const k = p.name.getText().replace(/["']/g, "");
    if (SKIP_PROP.has(k)) return null;
    return { strong: UI_PROPS.has(k) };
  }
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const c = calleeName(p.expression);
    const last = c.split(".").pop() ?? "";
    if (SKIP_CALL.has(c) || SKIP_CALL.has(last) || /^(db|tx|prisma)\./.test(c) || /\.(findMany|findFirst|groupBy|aggregate|count|update|create|upsert|deleteMany|updateMany|createMany|\$queryRaw|\$executeRaw)$/.test(c)) return null;
    if (/^(Error|ListError|IssueError|MobileAuthError|ActionError)$/.test(c) || /Error$/.test(c)) return { strong: true };
    return { strong: false };
  }
  if (ts.isThrowStatement(p) || ts.isReturnStatement(p)) return { strong: false };
  if (ts.isVariableDeclaration(p)) return { strong: false };
  return { strong: false };
}

function visitFile(file: string) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(process.cwd(), file);
  const walk = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const t = decode(n.text).replace(/\s+/g, " ").trim();
      if (t && looksUi(t, true)) {
        // Kontekst: shu element ichidagi barcha bolalar ({…} bilan)
        const parent = n.parent;
        const sib = ts.isJsxElement(parent) || ts.isJsxFragment(parent) ? parent.children.map((c) => (ts.isJsxText(c) ? decode(c.text) : ts.isJsxExpression(c) ? "{…}" : "<…>")).join("").replace(/\s+/g, " ").trim() : t;
        add(exact, t, `${rel}: ${sib}`);
      }
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const c = context(n);
      if (c && looksUi(n.text, c.strong)) add(exact, n.text, `${rel}`);
    } else if (ts.isTemplateExpression(n)) {
      const c = context(n);
      if (c) {
        let pat = n.head.text;
        n.templateSpans.forEach((s, i) => { pat += `{${i}}` + s.literal.text; });
        const lit = pat.replace(/\{\d+\}/g, " ");
        // O'zgaruvchi o'rni ham so'z: "chiqarildi {0}" — bitta kichik harfli so'z bo'lsa ham UI matni (4+ harfli so'z bo'lsa)
        if (looksUi(lit, c.strong || /[A-Za-z']{4,}/.test(lit)) && /[A-Za-z]{2,}/.test(lit)) add(templates, pat, `${rel}: \`${n.getText().slice(1, -1).slice(0, 180)}\``);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
}

function walkDir(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "generated" || e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkDir(p);
    else if (/\.(tsx?|mts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) visitFile(p);
  }
}
for (const r of roots) walkDir(r);

let dict: { exact?: Record<string, string>; templates?: Record<string, string> } | null = null;
if (dictPath && fs.existsSync(dictPath)) {
  const raw = JSON.parse(fs.readFileSync(dictPath, "utf8"));
  // `src/i18n/ru.json` ({ e, t }) ham, bo'lak formati ({ exact, templates }) ham qabul qilinadi
  dict = raw.e ? { exact: raw.e, templates: Object.fromEntries(raw.t ?? []) } : raw;
}
const pick = (m: Map<string, string>, have?: Record<string, string>) =>
  Object.fromEntries([...m].filter(([k]) => !have || !(k in have)).sort(([a], [b]) => a.localeCompare(b)));
const res = { exact: pick(exact, dict?.exact), templates: pick(templates, dict?.templates) };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`${out}: exact ${Object.keys(res.exact).length}, templates ${Object.keys(res.templates).length}${dict ? " (lug'atda yo'qlari)" : ""}`);
