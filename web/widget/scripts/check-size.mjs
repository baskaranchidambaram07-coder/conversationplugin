// Fails the build when the chat's first load (its script and styles, compressed) outgrows 100 KB (R3).
// Fonts are not counted: they load in parallel and only the subsets a page needs are fetched.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT_BYTES = 100 * 1024;
const assets = new URL("../dist/assets/", import.meta.url);
const files = readdirSync(assets).filter((name) => /\.(js|css)$/.test(name));
const size = files.reduce((sum, name) => sum + gzipSync(readFileSync(new URL(name, assets))).length, 0);

console.log(`chat first load: ${size} bytes gzipped in ${files.length} files (limit ${LIMIT_BYTES})`);
if (size > LIMIT_BYTES) process.exit(1);
