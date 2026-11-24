// Syntax highlighting for code in answers (M3-T4), loaded only when an answer holds code in a language it knows. The
// code is split into tokens by highlight.js's grammars, through lowlight, which returns a tree rather than HTML; each
// token becomes a span with a class, which styles.css colours for both schemes. Nothing is set as raw HTML.
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import { createElement, type ReactNode, useMemo } from "react";

import type { FenceProps } from "./registry";

export const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, powershell,
  python, ruby, rust, shell, sql, swift, typescript, xml, yaml,
});

type Token = { type: string; value?: string; properties?: { className?: unknown }; children?: Token[] };

/** A token as a span with its classes (hljs-keyword, hljs-string...), its text as text. */
const toReact = (token: Token, key: number): ReactNode =>
  token.type === "text"
    ? token.value
    : createElement(
        "span",
        { key, className: Array.isArray(token.properties?.className) ? token.properties.className.join(" ") : undefined },
        token.children?.map(toReact),
      );

export default function Highlighted({ code, language }: FenceProps) {
  const tokens = useMemo(() => {
    try {
      return lowlight.highlight(language.toLowerCase(), code).children as Token[];
    } catch {
      return null; // a grammar that fails leaves the code plain
    }
  }, [code, language]);
  return <>{tokens ? tokens.map(toReact) : code}</>;
}
