// Markdown in an answer (M3-T2). Loaded only when the first answer arrives, so the chat's first load stays small.
// Raw HTML is never rendered, links open safely in a new tab, and images are never fetched: an image address can
// carry data out of the conversation, so it becomes a link the visitor chooses to follow.
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { strings as t } from "../strings";
import { safeHref } from "./links";
import { fenceRenderer } from "./registry";
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
  // A fenced block goes to the renderer registered for its language, or to the code renderer.
  pre: ({ node }) => {
    const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
    const classes = code?.type === "element" ? code.properties.className : undefined;
    const language = (Array.isArray(classes) ? String(classes[0] ?? "") : "").replace(/^language-/, "");
    const text = code?.type === "element" ? code.children.map((child) => ("value" in child ? child.value : "")).join("") : "";
    const Fence = fenceRenderer(language);
    return <Fence code={text.replace(/\n$/, "")} language={language} />;
  },
};

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
