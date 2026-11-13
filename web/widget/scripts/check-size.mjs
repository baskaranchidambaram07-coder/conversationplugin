// Fails the build when the chat outgrows its budgets (R3), measured compressed:
// - the first load, meaning the script and styles index.html itself fetches, at most 100 KB;
// - each renderer loaded later, on demand (Markdown now, charts and diagrams later), at most 60 KB.
// Fonts are not counted: they load in parallel and only the subsets a page needs are fetched.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const FIRST_LOAD_BYTES = 100 * 1024;
const RENDERER_BYTES = 60 * 1024;
const dist = new URL("../dist/", import.meta.url);
const size = (name) => gzipSync(readFileSync(new URL(`assets/${name}`, dist))).length;

const page = readFileSync(new URL("index.html", dist), "utf8");
const first = [...page.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((match) => match[1]);
const firstLoad = first.reduce((sum, name) => sum + size(name), 0);
console.log(`chat first load: ${firstLoad} bytes gzipped in ${first.length} files (limit ${FIRST_LOAD_BYTES})`);

let failed = firstLoad > FIRST_LOAD_BYTES;
for (const name of readdirSync(new URL("assets/", dist)).filter((file) => file.endsWith(".js") && !first.includes(file))) {
  console.log(`loaded on demand: ${name}, ${size(name)} bytes gzipped (limit ${RENDERER_BYTES})`);
  failed ||= size(name) > RENDERER_BYTES;
}
if (failed) process.exit(1);
