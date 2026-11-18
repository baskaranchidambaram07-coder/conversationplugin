// A fenced code block (M3-T4): labelled, copyable, scrollable sideways by mouse, touch or keyboard, and never
// interpreted. Code in a language the highlighter knows is coloured once it has loaded (highlight.tsx); until then,
// and in any other language, it is plain.
import { lazy, Suspense } from "react";

import { CopyButton } from "../Icon";
import { strings as t } from "../strings";
import { type FenceProps, isBoxArt } from "./registry";

const Highlighted = lazy(() => import("./highlight"));

/** The languages highlight.tsx registers, and the names agents give them (a test keeps the two in step). */
export const HIGHLIGHTED = new Set(
  (
    "bash sh zsh shell console c h cpp c++ cc hpp cxx csharp cs c# css diff patch dockerfile docker go golang ini toml " +
    "java javascript js jsx mjs cjs json jsonc kotlin kt kts markdown md php powershell ps ps1 pwsh python py gyp " +
    "ruby rb rust rs sql swift typescript ts tsx mts cts xml html xhtml svg rss plist yaml yml"
  ).split(" "),
);

export function Code({ code, language }: FenceProps) {
  const art = isBoxArt(code); // a drawing in text: set close, so its upright lines meet
  const label = language === "mermaid" ? t.diagramSource : language || (art ? t.drawing : t.code);
  const coloured = !art && HIGHLIGHTED.has(language.toLowerCase());
  return (
    <figure className="code">
      <figcaption>
        <span>{label}</span>
        <CopyButton text={code} label={art ? t.copyText : t.copyCode} />
      </figcaption>
      <pre className={art ? "art" : undefined} tabIndex={0} role="region" aria-label={label}>
        <code>
          {coloured ? (
            <Suspense fallback={code}>
              <Highlighted code={code} language={language} />
            </Suspense>
          ) : (
            code
          )}
        </code>
      </pre>
    </figure>
  );
}
