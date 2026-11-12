// Serves the loader tests. Host pages are opened on http://127.0.0.1:4174 and load our side (the loader, the
// widget configuration and, later, the chat page) from http://localhost:4174: two origins, as in production,
// where the customer's site and ours never share one.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const root = new URL("../", import.meta.url);
const example = JSON.parse(await readFile(new URL("protocol/examples/v1/WidgetConfig/valid/full.json", root), "utf8"));
const configs = {
  w_test: { ...example, widget_id: "w_test" },
  w_left: { ...example, widget_id: "w_left", launcher_position: "bottom-left" },
};
const types = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8" };

async function answer(path) {
  if (path === "/loader.js") return [200, types.js, await readFile(new URL("web/loader/dist/loader.js", root))];
  const config = path.match(/^\/v1\/widgets\/([\w-]+)\/config$/);
  if (config) {
    const body = configs[config[1]];
    return body ? [200, "application/json", JSON.stringify(body)] : [404, "application/json", "{}"];
  }
  const page = path.match(/^\/hosts\/([a-z-]+)\.html$/);
  if (page) return [200, types.html, await readFile(new URL(`e2e/hosts/${page[1]}.html`, root))];
  return [404, "text/plain", "not found"];
}

createServer(async (request, response) => {
  const [status, type, body] = await answer(new URL(request.url, "http://x").pathname).catch(() => [
    404,
    "text/plain",
    "not found",
  ]);
  // The configuration is public and read from the customer's page, so any origin may read it, without cookies.
  response.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "cache-control": "no-store" });
  response.end(body);
}).listen(4174);
