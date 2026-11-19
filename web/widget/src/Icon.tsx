import { useState } from "react";

import { save } from "./Attachments";
import { strings as t } from "./strings";

/** Authored glyphs: one 2px round-capped stroke in the text colour. */
export function Icon({ path, filled = false, flip = false }: { path: string; filled?: boolean; flip?: boolean }) {
  // flip: a glyph that points along the reading direction, mirrored for right-to-left languages
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={flip ? "glyph flip" : "glyph"}>
      <path
        d={path}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Copies text, then says for two seconds whether it worked. Used for answers, code and tables. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  async function copy() {
    let worked = false;
    try {
      await navigator.clipboard.writeText(text); // blocked by some browsers and host policies
      worked = true;
    } catch {
      // the visitor is told below
    }
    setResult(worked ? "copied" : "failed");
    setTimeout(() => setResult(null), 2000);
  }
  return (
    <button type="button" className="quiet" onClick={() => void copy()}>
      <Icon path={result === "copied" ? "M5 12l5 5L19 8" : "M8 8h11v11H8zM5 16V5h11"} />
      {result === "copied" ? t.copied : result === "failed" ? t.copyFailed : label}
    </button>
  );
}

export const DOWNLOAD = "M12 4v11M7 10l5 5 5-5M5 20h14";

/** Hands the visitor a file made on the press (a table's CSV, a chart's picture), saying for two seconds if it failed. */
/** `compact` hides the words (never from screen readers) in a narrow chat, where a code block's caption is tight. */
export function SaveButton(props: { label: string; name: string; make: () => Blob | Promise<Blob>; compact?: boolean }) {
  const { label, name, make, compact = false } = props;
  const [failed, setFailed] = useState(false);
  async function go() {
    try {
      const made = make(); // a file ready at once is saved within the press itself
      save(made instanceof Blob ? made : await made, name);
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    }
  }
  return (
    <button type="button" className={compact ? "quiet compact" : "quiet"} onClick={() => void go()}>
      <Icon path={DOWNLOAD} />
      <span className="save-words">{failed ? t.saveFailed : label}</span>
    </button>
  );
}
