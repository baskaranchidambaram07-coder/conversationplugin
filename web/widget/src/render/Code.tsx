// A fenced code block (M3-T4): labelled, copyable, scrollable sideways by mouse, touch or keyboard, and never
// interpreted. Syntax highlighting is not in the base version.
import { CopyButton } from "../Icon";
import { strings as t } from "../strings";
import { type FenceProps, isBoxArt } from "./registry";

export function Code({ code, language }: FenceProps) {
  const art = isBoxArt(code); // a drawing in text: set close, so its upright lines meet
  const label = language === "mermaid" ? t.diagramSource : language || (art ? t.drawing : t.code);
  return (
    <figure className="code">
      <figcaption>
        <span>{label}</span>
        <CopyButton text={code} label={art ? t.copyText : t.copyCode} />
      </figcaption>
      <pre className={art ? "art" : undefined} tabIndex={0} role="region" aria-label={label}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
