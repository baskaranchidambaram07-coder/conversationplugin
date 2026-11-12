// Writes src/v1.ts from schema/v1.json (which the backend generates). With --check it changes nothing
// and fails when src/v1.ts is out of date, which is how the pipeline catches drift.
import { readFileSync, writeFileSync } from "node:fs";

import { compile } from "json-schema-to-typescript";

const schema = JSON.parse(readFileSync(new URL("schema/v1.json", import.meta.url), "utf8"));
const types = await compile(schema, "Protocol", {
  bannerComment: "// Generated from schema/v1.json by `npm run generate --workspace @ucp/protocol`. Do not edit.",
  unreachableDefinitions: true,
  maxItems: -1,
});
const target = new URL("src/v1.ts", import.meta.url);

if (!process.argv.includes("--check")) {
  writeFileSync(target, types);
} else if (readFileSync(target, "utf8") !== types) {
  console.error("protocol/src/v1.ts is out of date. Run: npm run generate --workspace @ucp/protocol");
  process.exit(1);
}
