// Fails the build when the loader outgrows its budget: it is downloaded on every customer page view.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT_BYTES = 6 * 1024;
const size = gzipSync(readFileSync(new URL("../dist/loader.js", import.meta.url))).length;

console.log(`loader.js: ${size} bytes gzipped (limit ${LIMIT_BYTES})`);
if (size > LIMIT_BYTES) process.exit(1);
