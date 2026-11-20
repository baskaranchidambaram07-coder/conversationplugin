// Maths in answers (M3), loaded only when an answer holds a formula. TeX becomes MathML through temml, which browsers
// draw themselves, so no script or style is needed to lay a formula out. temml writes a few inline styles, which the
// chat's content policy refuses, so its MathML is rebuilt as React elements from an allow-list: MathML's own elements
// and attributes, and temml's class names (styled by its stylesheet, imported here); styles, links and anything else
// are dropped. A formula temml cannot read is shown as its source.
import "temml/dist/Temml-Local.css";

import { createElement, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import temml from "temml";

import { strings as t } from "../strings";
import { Code } from "./Code";
import type { FenceProps } from "./registry";

const TAGS = new Set(
  ("math semantics annotation mrow mi mn mo ms mtext mspace msup msub msubsup mfrac msqrt mroot mover munder " +
    "munderover mtable mtr mtd mlabeledtr mstyle mpadded mphantom menclose mmultiscripts mprescripts none merror").split(" "),
);
const ATTRIBUTES = new Set(
  ("display displaystyle scriptlevel mathvariant stretchy fence separator form lspace rspace largeop movablelimits " +
    "accent accentunder linethickness width height depth voffset columnalign rowalign columnspacing rowspacing " +
    "columnlines rowlines frame notation encoding minsize maxsize symmetric dir").split(" "),
);
const CLASS = /^(?:tml-|wbk-|chr-|ff-|menclose$|mathcal$|mathscr$|upstrike$|downstrike$|sout$|longdiv|phasor|circle-pad$|textcircle$|actuarial$)/;
const LIMITS = { maxSize: [20, 20] as [number, number], maxExpand: 300 }; // no formula may grow huge or loop

/** An element of temml's MathML, and what it holds, as React elements: only what the allow-lists name. */
function rebuild(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.localName;
  if (!TAGS.has(tag)) return null;
  const props: Record<string, string | number> = { key };
  for (const { name, value } of node.attributes) {
    if (ATTRIBUTES.has(name)) props[name] = value;
    else if (name === "class") props.className = value.split(/\s+/).filter((c) => CLASS.test(c)).join(" ");
  }
  return createElement(tag, props, ...Array.from(node.childNodes, rebuild));
}

/** A formula as React elements, or null when temml cannot read it. */
function formula(tex: string, block: boolean): ReactNode {
  try {
    const mathml = temml.renderToString(tex, { displayMode: block, annotate: true, throwOnError: true, trust: false, ...LIMITS });
    // WebKit judges even a parsed, never-shown document's inline styles by the page's content policy, and reports each
    // as refused; they would be dropped below anyway. temml writes attributes in double quotes, escaping any inside.
    const unstyled = mathml.replace(/\sstyle="[^"]*"/g, "");
    const math = new DOMParser().parseFromString(unstyled, "text/html").body.firstElementChild;
    return math?.localName === "math" ? rebuild(math, 0) : null;
  } catch {
    return null;
  }
}

/** A formula inside a sentence. */
export function InlineMaths({ tex }: { tex: string }) {
  const drawn = useMemo(() => formula(tex, false), [tex]);
  return drawn ? <span className="maths">{drawn}</span> : <code>{tex}</code>;
}

/** A formula on a line of its own, in its own frame that scrolls sideways when it is wider than the answer. */
export default function Maths({ code, language }: FenceProps) {
  const drawn = useMemo(() => formula(code, true), [code]);
  const frame = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWide(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, [drawn]);
  if (!drawn) return <Code code={code} language={language} />;
  // Only a formula that scrolls takes a place in the tab order, so the keyboard can scroll it.
  return (
    <div ref={frame} className="maths block" {...(wide ? { tabIndex: 0, role: "region", "aria-label": t.formula } : {})}>
      {drawn}
    </div>
  );
}
