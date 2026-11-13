// The renderer registry (M3-T1). A block type, or the language of a fenced block inside Markdown (D9), picks the
// renderer that draws it, loaded only when first needed. Every block is drawn behind its own boundary, so one
// that fails shows its plain text and never blanks the rest of the answer.
import type { Block } from "@ucp/protocol/v1";
import { Component, type ComponentType, lazy, type ReactNode, Suspense } from "react";

import { strings as t } from "../strings";
import { Code } from "./Code";

export type FenceProps = { code: string; language: string };

const Markdown = lazy(() => import("./Markdown"));

/** Fenced-block languages with a renderer of their own. Anything else is code. */
const FENCES: Record<string, ComponentType<FenceProps>> = {};

export function fenceRenderer(language: string): ComponentType<FenceProps> {
  return FENCES[language] ?? Code;
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
  const text = typeof block.text === "string" ? block.text : "";
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
  return <p className="text unknown">{text || t.unknownBlock}</p>;
}
