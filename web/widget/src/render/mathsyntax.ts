// Maths in answers is TeX between dollars or brackets: $x^2$, $$\sum_i x_i$$, \(x\), \[x\]. Markdown has no such
// syntax, so before an answer is parsed each formula becomes Markdown that keeps it whole: a display formula a fenced
// `math` block, an inline one a code span opening with INLINE, both drawn by maths.tsx. A single dollar is maths only
// as Pandoc reads it (no space just inside either dollar, no digit after the closing one), so "$5 and $10" stays money.
// Code, fenced or inline, is never touched.

/** A private-use character no answer writes, opening an inline formula's code span. */
export const INLINE = String.fromCharCode(0xe000);

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const OPENS = /^(\s*)(\$\$|\\\[)(.*)$/;

/** A code span holding the formula, its backtick run longer than any inside. */
function span(tex: string, inTable: boolean): string {
  const body = inTable ? tex.replace(/\|/g, "\\vert ") : tex; // a bar would end a table's cell
  const ticks = "`".repeat(Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  return `${ticks}${INLINE}${body} ${ticks}`;
}

/** The formulas in text outside code: \(…\), $$…$$ on one line, and $…$ as Pandoc reads it. */
function inline(text: string, inTable: boolean): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1] ?? "";
    if (ch === "\\" && next === "(") {
      const end = text.indexOf("\\)", i + 2);
      if (end > i + 2) {
        out += span(text.slice(i + 2, end), inTable);
        i = end + 1;
        continue;
      }
    }
    if (ch === "\\") {
      out += ch + next; // an escaped character, such as \$, stays as written
      i++;
      continue;
    }
    if (ch === "$" && next === "$") {
      const end = text.indexOf("$$", i + 2);
      if (end > i + 2) {
        out += span(text.slice(i + 2, end), inTable);
        i = end + 1;
      } else {
        out += "$$";
        i++;
      }
      continue;
    }
    if (ch === "$" && /\S/.test(next)) {
      // The first unescaped dollar after it closes the formula, or nothing does.
      let j = i + 1;
      while (j < text.length && text[j] !== "$") j += text[j] === "\\" ? 2 : 1;
      if (j < text.length && j > i + 1 && /\S/.test(text[j - 1]!) && !/\d/.test(text[j + 1] ?? "")) {
        out += span(text.slice(i + 1, j), inTable);
        i = j;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** A line's text with its formulas marked, its code spans (a run of backticks to the next run as long) untouched. */
function line(text: string): string {
  const inTable = /^\s*\|/.test(text);
  let out = "";
  let from = 0;
  for (const run of text.matchAll(/`+/g)) {
    if (run.index! < from) continue;
    const close = text.indexOf(run[0], run.index! + run[0].length);
    const closes = close >= 0 && text[close + run[0].length] !== "`" && text[close - 1] !== "`";
    if (!closes) continue;
    out += inline(text.slice(from, run.index), inTable) + text.slice(run.index, close + run[0].length);
    from = close + run[0].length;
  }
  return out + inline(text.slice(from), inTable);
}

/** The answer with its formulas marked for maths.tsx. */
export function markMaths(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence = "";
  for (let n = 0; n < lines.length; n++) {
    const current = lines[n]!;
    const mark = FENCE.exec(current)?.[1];
    if (fence) {
      if (mark?.startsWith(fence)) fence = "";
      out.push(current);
      continue;
    }
    if (mark) {
      fence = mark;
      out.push(current);
      continue;
    }
    // A display formula: a line that opens with $$ or \[ and the line that closes it, perhaps the same one.
    const opens = OPENS.exec(current);
    if (opens) {
      const [, indent, open, rest] = opens;
      const close = open === "$$" ? "$$" : "\\]";
      const body: string[] = [];
      let end = -1;
      for (let k = n, tail = rest!; k < lines.length; tail = lines[++k] ?? "") {
        const at = tail.indexOf(close);
        if (at >= 0) {
          if (tail.slice(at + close.length).trim()) break; // words after it: an inline formula, read below
          body.push(tail.slice(0, at));
          end = k;
          break;
        }
        body.push(tail);
      }
      const tex = body.join("\n").trim();
      if (end >= 0 && tex) {
        out.push(`${indent}\`\`\`math`, ...tex.split("\n").map((l) => indent + l), `${indent}\`\`\``);
        n = end;
        continue;
      }
    }
    out.push(line(current));
  }
  return out.join("\n");
}
