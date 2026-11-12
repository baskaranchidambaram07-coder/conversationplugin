import { useState } from "react";

import { strings as t } from "./strings";

/** Authored glyphs: one 2px round-capped stroke in the text colour. */
export function Icon({ path, filled = false }: { path: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="glyph">
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
