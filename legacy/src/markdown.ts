import stringWidth from "string-width";

export interface Span {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
}
export type Row = Span[];

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*)/;

function inline(text: string, base: Span = { text: "" }): Span[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part): Span => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
        return { ...base, text: part.slice(1, -1), color: "yellow" };
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
        return { ...base, text: part.slice(2, -2), bold: true };
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
        return { ...base, text: part.slice(1, -1), italic: true };
      return { ...base, text: part };
    });
}

/** Split spans into rows no wider than `width` display columns. */
function wrap(spans: Span[], width: number): Row[] {
  const rows: Row[] = [];
  let row: Row = [];
  let used = 0;
  for (const span of spans) {
    let buf = "";
    const flush = () => {
      if (buf) row.push({ ...span, text: buf });
      buf = "";
    };
    for (const ch of span.text) {
      const w = stringWidth(ch);
      if (used + w > width) {
        flush();
        rows.push(row);
        row = [];
        used = 0;
      }
      buf += ch;
      used += w;
    }
    flush();
  }
  rows.push(row);
  return rows;
}

/** Render a markdown subset (headings, lists, quotes, fenced code, inline styles) into wrapped rows. */
export function renderMarkdown(src: string, width: number): Row[] {
  const out: Row[] = [];
  let inCode = false;
  for (const line of src.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inCode = !inCode;
      if (inCode) {
        const lang = line.trim().slice(3);
        if (lang) out.push([{ text: lang, dim: true }]);
      }
      continue;
    }
    if (inCode) {
      out.push(...wrap([{ text: "  " + line, color: "cyan" }], width));
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(...wrap(inline(h[2], { text: "", bold: true, color: "magenta" }), width));
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      out.push(...wrap([{ text: "│ ", dim: true }, ...inline(quote[1], { text: "", dim: true })], width));
      continue;
    }
    const li = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) {
      out.push(...wrap([{ text: `${li[1]}• `, color: "blue" }, ...inline(li[2])], width));
      continue;
    }
    out.push(...wrap(inline(line), width));
  }
  return out;
}

export function plainRows(text: string, width: number, prefix = "", color?: string): Row[] {
  return text.split("\n").flatMap((l, i) => wrap([{ text: (i === 0 ? prefix : "") + l, color }], width));
}
