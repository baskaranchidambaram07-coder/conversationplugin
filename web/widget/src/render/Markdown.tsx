// Markdown in an answer (M3-T2). Loaded only when the first answer arrives, so the chat's first load stays small.
// Raw HTML is never rendered, links open safely in a new tab, and images are never fetched: an image address can
// carry data out of the conversation, so it becomes a link the visitor chooses to follow.
import { createContext, type ReactNode, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Icon } from "../Icon";
import { strings as t } from "../strings";
import { safeHref } from "./links";
import { fenceRenderer, isBoxArt } from "./registry";
import { Table } from "./Table";

function Link({ href, children }: { href: string | null; children: ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

// The answer's own text, so a fenced block can tell whether its closing fence has arrived yet.
const Source = createContext("");

/** A fenced block whose closing fence has arrived: its source ends with a line of backticks or tildes. */
function Fence({ language, text, start, end }: { language: string; text: string; start?: number; end?: number }) {
  const source = useContext(Source);
  const closed = start === undefined || end === undefined || /\n[ \t]*(?:`{3,}|~{3,})[ \t]*$/.test(source.slice(start, end));
  const Drawn = fenceRenderer(language, text, closed);
  return <Drawn code={text.replace(/\n$/, "")} language={language} />;
}

// The chat's title is the page's top heading, so an answer's headings start one level below it.
const shifted = (level: 2 | 3 | 4 | 5 | 6) => {
  const Heading = `h${level}` as const;
  return ({ children }: { children?: ReactNode }) => <Heading>{children}</Heading>;
};

const components: Components = {
  a: ({ href, children }) => <Link href={safeHref(href)}>{children}</Link>,
  img: ({ src, alt }) => <Link href={safeHref(src)}>{t.image(alt ?? "")}</Link>,
  h1: shifted(2),
  h2: shifted(3),
  h3: shifted(4),
  h4: shifted(5),
  h5: shifted(6),
  h6: shifted(6),
  table: Table,
  // A task list's box is a mark, not a control, so it is drawn as one and named.
  input: ({ checked }) => (
    <span className="task" role="img" aria-label={checked ? t.taskDone : t.taskOpen}>
      <Icon path={checked ? "M5 5h14v14H5zM8.5 12l2.5 2.5 4.5-5" : "M5 5h14v14H5z"} />
    </span>
  ),
  // A fenced block goes to the renderer registered for its language, or to the code renderer.
  pre: ({ node }) => {
    const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
    const classes = code?.type === "element" ? code.properties.className : undefined;
    const language = (Array.isArray(classes) ? String(classes[0] ?? "") : "").replace(/^language-/, "");
    const text = code?.type === "element" ? code.children.map((child) => ("value" in child ? child.value : "")).join("") : "";
    return <Fence language={language} text={text} start={node?.position?.start.offset} end={node?.position?.end.offset} />;
  },
};

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DRAWN = /[┌┐└┘├┤┬┴┼│─▼▲►◄]/;

/** A drawing in box-drawing characters that an agent wrote straight into its answer, outside a fenced block, fenced
 *  so its spacing survives and it can be drawn. */
export function fenceDrawings(text: string): string {
  const out: string[] = [];
  let run: string[] = [];
  let held: string[] = []; // indented words inside a drawing, such as "Yes" on a line going down
  let fence = "";
  const flush = () => {
    out.push(...(isBoxArt(run.join("\n")) ? ["```", ...run, "```"] : run), ...held);
    [run, held] = [[], []];
  };
  for (const line of text.split("\n")) {
    const mark = FENCE.exec(line)?.[1];
    if (fence) {
      if (mark?.startsWith(fence)) fence = "";
    } else if (mark) fence = mark;
    else if (DRAWN.test(line)) {
      run.push(...held, line);
      held = [];
      continue;
    } else if (run.length && /^\s+\S/.test(line) && line.trim().length <= 40) {
      held.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n");
}

export default function Markdown({ text: given }: { text: string }) {
  const text = DRAWN.test(given) ? fenceDrawings(given) : given;
  return (
    <div className="md">
      {/* Every address is judged once, by safeHref in the components above; the library's own filter would drop tel: */}
      <Source.Provider value={text}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(url) => url} skipHtml>
          {text}
        </ReactMarkdown>
      </Source.Provider>
    </div>
  );
}
