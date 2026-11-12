// A fenced code block (M3-T4): labelled, copyable, scrollable sideways by mouse, touch or keyboard, and never
// interpreted. Syntax highlighting is not in the base version.
import { CopyButton } from "../Icon";
import { strings as t } from "../strings";
import type { FenceProps } from "./registry";

export function Code({ code, language }: FenceProps) {
  const label = language === "mermaid" ? t.diagramSource : language || t.code;
  return (
    <figure className="code">
      <figcaption>
        <span>{label}</span>
        <CopyButton text={code} label={t.copyCode} />
      </figcaption>
      <pre tabIndex={0} role="region" aria-label={label}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
