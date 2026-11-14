import { expect, test } from "vitest";

import { changes } from "./golive";

test("only the settings that differ are listed, by their dotted path; lists compare whole", () => {
  const live = { public: { title: "One", suggested_prompts: ["a"] }, allowed_domains: ["https://a.example"], sign_in: "anonymous" };
  const draft = { public: { title: "Two", suggested_prompts: ["a"], logo_url: null }, allowed_domains: ["https://a.example", "https://b.example"], sign_in: "anonymous" };

  expect(changes(live, draft)).toEqual([
    { path: "allowed_domains", from: ["https://a.example"], to: ["https://a.example", "https://b.example"] },
    { path: "public.logo_url", from: undefined, to: null },
    { path: "public.title", from: "One", to: "Two" },
  ]);
  expect(changes(live, live)).toEqual([]);
});
