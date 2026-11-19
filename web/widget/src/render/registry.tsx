// The renderer registry (M3-T1). A block type, or the language of a fenced block inside Markdown (D9), picks the
// renderer that draws it, loaded only when first needed. Every block is drawn behind its own boundary, so one
// that fails shows its plain text and never blanks the rest of the answer.
import type { Block } from "@ucp/protocol/v1";
import { Component, type ComponentType, lazy, type ReactNode, Suspense } from "react";

import { textOf } from "../chat/state";
import { SaveButton } from "../Icon";
import { strings as t } from "../strings";
import { Code } from "./Code";

export type FenceProps = { code: string; language: string };

const Markdown = lazy(() => import("./Markdown"));
const LazyDiagram = lazy(() => import("./Diagram"));
const LazyChart = lazy(() => import("./Chart"));

// Until the diagram renderer has loaded, and while a diagram is still arriving, the block shows as code.
const Diagram = (props: FenceProps) => (
  <Suspense fallback={<Code {...props} />}>
    <LazyDiagram {...props} />
  </Suspense>
);

/** Whether a fenced block holds draw.io XML or Excalidraw JSON, judged cheaply on every streamed render. */
export const isDiagram = (code: string) =>
  /^\s*<(?:mxfile|mxGraphModel)\b/.test(code) || /^\s*[[{][\s\S]{0,200}"type"\s*:\s*"excalidraw"/.test(code);

// A chart likewise: as code until its renderer has loaded and its data has arrived whole.
const Chart = (props: FenceProps) => (
  <Suspense fallback={<Code {...props} />}>
    <LazyChart {...props} />
  </Suspense>
);

const LazyMaths = lazy(() => import("./maths"));

// A formula on a line of its own: its TeX, as code, until the maths renderer has loaded.
const Maths = (props: FenceProps) => (
  <Suspense fallback={<Code {...props} />}>
    <LazyMaths {...props} />
  </Suspense>
);

/** A fenced block of TeX that is a formula, not a whole LaTeX document. */
const isFormula = (language: string, code: string) =>
  language === "math" ||
  (/^(?:latex|tex)$/i.test(language) && code.length < 2_000 && !/\\(?:documentclass|usepackage|begin\{document\})/.test(code));

const PLOTTING = /\b(?:plt|ax\w*|px)\.(?:plot|bar|barh|scatter|step|pie|line|area)\s*\(/;

/** Fenced-block languages with a renderer of their own. Anything else is code. */
const FENCES: Record<string, ComponentType<FenceProps>> = { chart: Chart };

/** Whether text holds two or more boxes drawn with box-drawing characters, as agents draw flowcharts in plain text. */
export const isBoxArt = (code: string) =>
  (code.match(/[┌╭┏╔][─━═]/g)?.length ?? 0) >= 2 && /[└╰┗╚][─━═]/.test(code) && /[│┃║]/.test(code);

/** The renderer for a fenced block: by its content for diagrams (agents label draw.io XML as "xml"), else its language.
 *  A Mermaid chart, or a flowchart drawn in text, is drawn only once its fence has closed: until then it is still
 *  growing. */
export function fenceRenderer(language: string, code = "", closed = true): ComponentType<FenceProps> {
  if (isFormula(language, code)) return closed ? Maths : Code;
  // A Mermaid pie is a chart, read like any other; the rest of Mermaid is drawn as a diagram.
  if (language === "mermaid" && closed && /^(?:\s*%%.*\n)*\s*pie\b/.test(code)) return Chart;
  if (language === "mermaid" || (language !== "chart" && isBoxArt(code))) return closed ? Diagram : Code;
  // Python that plots: its chart is drawn over it when the values are written into the code (derive.ts).
  if (closed && /^(?:python3?|py)$/i.test(language) && PLOTTING.test(code)) return Chart;
  return isDiagram(code) ? Diagram : (FENCES[language] ?? Code);
}

// Markdown the parser would take seconds over (it is quadratic in emphasis marks and in containers opened on one
// line) or overflow its stack on is shown as plain text instead, so no answer can freeze the chat. Measured in
// gallery.test.tsx. The marker must be followed by a space and all spaces are taken at once, so this cannot backtrack.
const DEEP = /^[ \t]*(?:(?:>|(?:[-+*]|\d{1,9}[.)])(?=[ \t]))[ \t]*){32}/m;

export const tooHeavy = (text: string) =>
  text.length > 20_000 || (text.match(/[*_~]/g)?.length ?? 0) > 2_000 || DEEP.test(text);

class Isolated extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function BlockView({ block }: { block: Block }) {
  const text = textOf(block);
  if (!text && (block.type === "text" || block.type === "markdown")) return null;
  const plain = <p className="text">{text}</p>;
  if (block.type === "text" || (block.type === "markdown" && tooHeavy(text))) return plain;
  if (block.type === "markdown") {
    return (
      <Isolated fallback={plain}>
        <Suspense fallback={plain}>
          <Markdown text={text} />
        </Suspense>
      </Isolated>
    );
  }
  // A kind of part this chat does not know yet: what text it has, and the part itself to save (M3-T1).
  return (
    <>
      <p className="text unknown">{text || t.unknownBlock}</p>
      <SaveButton label={t.unknownPart} name="part.json" make={() => new Blob([JSON.stringify(block, null, 2)], { type: "application/json" })} />
    </>
  );
}
