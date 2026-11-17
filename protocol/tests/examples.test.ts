// The same example files the backend tests read (backend/tests/test_protocol.py), checked here against the
// generated schema. The folder names the type and the verdict; both languages must reach that verdict.
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { expect, test } from "vitest";

import schema from "../schema/v1.json?raw";

const examples = Object.entries(
  import.meta.glob<string>("../examples/v1/*/*/*.json", { query: "?raw", import: "default", eager: true }),
);

const ajv = new Ajv2020();
addFormats(ajv);
ajv.addKeyword("discriminator"); // a hint for code generators; `oneOf` already decides the verdict
ajv.addSchema(JSON.parse(schema), "v1");

function verdict(kind: string, text: string): "valid" | "invalid" {
  const validate = ajv.getSchema(`v1#/$defs/${kind}`);
  if (!validate) throw new Error(`no schema for ${kind}`);
  try {
    return validate(JSON.parse(text)) ? "valid" : "invalid";
  } catch {
    return "invalid"; // not JSON at all
  }
}

test("the example folder is found", () => {
  expect(examples.length).toBeGreaterThan(80);
});

test.each(examples)("%s", (path, text) => {
  const [kind = "", expected] = path.split("/").slice(-3, -1);

  expect(verdict(kind, text)).toBe(expected);
});
