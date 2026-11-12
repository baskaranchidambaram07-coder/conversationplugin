import { expect, test } from "vitest";

import { safeHref } from "./links";

test.each([
  ["https://college.example/library", "https://college.example/library"],
  ["http://college.example", "http://college.example/"],
  ["mailto:porters@college.example", "mailto:porters@college.example"],
  ["tel:+442078374321", "tel:+442078374321"],
])("%s may be linked", (href, expected) => {
  expect(safeHref(href)).toBe(expected);
});

test.each([
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "  javascript:alert(1)",
  "java\tscript:alert(1)",
  "vbscript:msgbox(1)",
  "data:text/html;base64,PHNjcmlwdD4=",
  "file:///C:/Windows",
  "/v1/conversations",
  "../embed/w_1",
  "#section",
  "",
  undefined,
  42,
])("%j stays plain text", (href) => {
  expect(safeHref(href)).toBeNull();
});
