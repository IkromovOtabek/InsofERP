/**
 * SQL matnidan qiymat literallarini yashirish — pg_stat_activity / pg_stat_statements dagi so'rov panelda
 * ko'rinadi, unda mijoz ismi, telefon, summa kabi shaxsiy ma'lumot bo'lishi mumkin.
 *
 * Bitta o'tishli tokenizator: satr literallari ('...', E'...', $tag$...$tag$) → '?', sonlar → ?, izohlar olib
 * tashlanadi; "qo'shtirnoqli identifikatorlar" (jadval/ustun nomlari) qoladi. pg_stat_activity matni 1024 baytda
 * kesilgan bo'lishi mumkin — yopilmagan literal ham oxirigacha yashiriladi. Natija bir qatorga yig'iladi va qisqartiriladi.
 */
const TOKEN = new RegExp(
  [
    /(\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?(?:\$\2\$|$))/.source, // 1,2: dollar-quoted
    /((?:[EeBbXxNn]|[Uu]&)?'(?:[^'\\]|''|\\[\s\S])*(?:'|$))/.source, // 3: satr literali (yopilmagani ham)
    /("(?:[^"]|"")*"?)/.source, // 4: identifikator — qoladi
    /(--[^\n]*)/.source, // 5: qator izohi
    /(\/\*[\s\S]*?(?:\*\/|$))/.source, // 6: blok izoh
    /((?<![A-Za-z0-9_$])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.source, // 7: son
  ].join("|"),
  "g",
);

export function maskSql(q: string | null | undefined, max = 300): string {
  if (!q) return "";
  let s = q.replace(TOKEN, (m, dq, _tag, str, ident, lc, bc, num) => {
    if (dq !== undefined || str !== undefined) return "'?'";
    if (ident !== undefined) return ident;
    if (lc !== undefined || bc !== undefined) return " ";
    if (num !== undefined) return "?";
    return m;
  });
  // IN ('?', '?', '?', ...) → IN ('?', …)
  s = s.replace(/('\?'|\?)(\s*,\s*('\?'|\?)){2,}/g, "$1, …");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}
