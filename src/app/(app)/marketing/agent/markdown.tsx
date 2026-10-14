import { Fragment, type ReactNode } from "react";

/**
 * Agent javobi uchun kichik markdown: sarlavha, ro'yxat, jadval, iqtibos, **qalin**, *kursiv*, `kod`, [havola](url).
 * HTML sifatida emas, React elementlari bilan quriladi — model matni sahifaga skript kirita olmaydi.
 */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k} className="font-semibold">{m[2]}</strong>);
    else if (m[3]) out.push(<code key={k} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[13px]">{m[3]}</code>);
    else if (m[4]) {
      const href = m[5]!;
      const safe = /^(https?:\/\/|\/(?!\/))/.test(href) ? href : "#";
      out.push(<a key={k} href={safe} target={/^\/(?!\/)/.test(safe) ? undefined : "_blank"} rel="noreferrer" className="text-blue-700 underline">{m[4]}</a>);
    } else if (m[6] || m[7]) out.push(<em key={k}>{m[6] ?? m[7]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push(<h4 key={i} className={h[1]!.length <= 2 ? "mt-4 mb-1.5 text-base font-semibold" : "mt-3 mb-1 font-semibold"}>{inline(h[2]!, i)}</h4>);
      i++; continue;
    }
    // Jadval: | a | b | + |---|---|
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={`t${i}`} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr>{head.map((c, j) => <th key={j} className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-semibold">{inline(c, j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border border-slate-200 px-2 py-1.5 align-top">{inline(c, ri * 100 + j)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const cls = ordered ? "my-2 list-decimal space-y-1 pl-5" : "my-2 list-disc space-y-1 pl-5";
      const lis = items.map((t, j) => <li key={j}>{inline(t, j)}</li>);
      blocks.push(ordered ? <ol key={`l${i}`} className={cls}>{lis}</ol> : <ul key={`l${i}`} className={cls}>{lis}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) q.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={`q${i}`} className="my-2 border-l-2 border-slate-300 pl-3 text-slate-600">{q.map((x, j) => <Fragment key={j}>{inline(x, j)}<br /></Fragment>)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*([-*•]|\d+[.)])\s|>|\|)/.test(lines[i]!)) para.push(lines[i++]!);
    if (!para.length) para.push(lines[i++]!);
    blocks.push(<p key={`p${i}`} className="my-2">{para.map((x, j) => <Fragment key={j}>{j > 0 && <br />}{inline(x, j)}</Fragment>)}</p>);
  }
  return <div className="text-[15px] leading-relaxed text-slate-800">{blocks}</div>;
}
