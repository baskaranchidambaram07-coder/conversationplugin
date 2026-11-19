// A fenced code block (M3-T4): labelled, copyable, scrollable sideways by mouse, touch or keyboard, and never
// interpreted. Code in a language the highlighter knows is coloured once it has loaded (highlight.tsx); until then,
// and in any other language, it is plain.
import { lazy, Suspense } from "react";

import { CopyButton, SaveButton } from "../Icon";
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

// A file's extension from the language an agent names; anything else is saved as text.
const EXTENSIONS: Record<string, string> = Object.fromEntries(
  (
    "bash:sh sh:sh zsh:sh shell:sh console:txt c:c h:h cpp:cpp c++:cpp cc:cpp hpp:hpp cxx:cpp csharp:cs cs:cs c#:cs css:css " +
    "diff:diff patch:diff go:go golang:go ini:ini toml:toml java:java javascript:js js:js jsx:jsx mjs:mjs cjs:cjs json:json " +
    "jsonc:json kotlin:kt kt:kt kts:kts markdown:md md:md php:php powershell:ps1 ps:ps1 ps1:ps1 pwsh:ps1 python:py py:py " +
    "python3:py ruby:rb rb:rb rust:rs rs:rs sql:sql swift:swift typescript:ts ts:ts tsx:tsx mts:mts cts:cts xml:xml html:html " +
    "xhtml:html svg:svg yaml:yml yml:yml csv:csv tsv:tsv mermaid:mmd latex:tex tex:tex r:r scala:scala dart:dart lua:lua"
  )
    .split(" ")
    .map((pair) => pair.split(":") as [string, string]),
);

/** The name a code block is saved under: code.py, diagram.mmd, drawing.txt. */
export const codeFile = (language: string, art = false) =>
  art ? "drawing.txt" : `${language === "mermaid" ? "diagram" : "code"}.${EXTENSIONS[language.toLowerCase()] ?? "txt"}`;

export function Code({ code, language }: FenceProps) {
  const art = isBoxArt(code); // a drawing in text: set close, so its upright lines meet
  const label = language === "mermaid" ? t.diagramSource : language || (art ? t.drawing : t.code);
  const coloured = !art && HIGHLIGHTED.has(language.toLowerCase());
  return (
    <figure className="code">
      <figcaption>
        <span>{label}</span>
        <div className="caption-tools">
          <CopyButton text={code} label={art ? t.copyText : t.copyCode} />
          <SaveButton label={t.download} compact name={codeFile(language, art)} make={() => new Blob([code], { type: "text/plain;charset=utf-8" })} />
        </div>
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
