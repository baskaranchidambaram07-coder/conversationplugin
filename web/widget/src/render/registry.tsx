// The renderer registry (M3-T1). A block type, or the language of a fenced block inside Markdown (D9), picks the
// renderer that draws it, loaded only when first needed. Every block is drawn behind its own boundary, so one
// that fails shows its plain text and never blanks the rest of the answer.
import type { Block } from "@ucp/protocol/v1";
import { Component, type ComponentType, lazy, type ReactNode, Suspense } from "react";

import { strings as t } from "../strings";

export type FenceProps = { code: string; language: string };

const Markdown = lazy(() => import("./Markdown"));

/** Fenced-block languages with a renderer of their own. Anything else is code. */
const FENCES: Record<string, ComponentType<FenceProps>> = {};

export function fenceRenderer(language: string): ComponentType<FenceProps> {
  return FENCES[language] ?? Code;
}

/** Until M3's next pull request styles it: a fenced block, labelled, scrollable, and never interpreted. */
function Code({ code, language }: FenceProps) {
  const label = language === "mermaid" ? t.diagramSource : language;
  return (
    <figure className="code">
      {label && <figcaption>{label}</figcaption>}
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

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
  if (block.type === "text") return plain;
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
