// Serves the browser tests. Host pages are opened on http://127.0.0.1:4174 and load our side from
// http://localhost:4174: two origins, as in production, where the customer's site and ours never share one.
// Our side is the built loader, the built chat page, widget configurations, and a fake gateway that speaks the
// API in backend/ucp/protocol.py until the real one (module M4) exists.
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const example = JSON.parse(await readFile(new URL("protocol/examples/v1/WidgetConfig/valid/full.json", root), "utf8"));
const configs = {
  w_test: { ...example, widget_id: "w_test" },
  w_left: { ...example, widget_id: "w_left", launcher_position: "bottom-left" },
  w_chat: { ...example, widget_id: "w_chat" },
};
// These widgets open the stand-in chat (e2e/chat-stub.html), which lets the loader be tested on its own.
const STAND_IN = new Set(["w_test", "w_left"]);
const types = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  json: "application/json",
};

// The long answer is the one Purple Fabric gave in the recording the fake PF replays.
const long = (await readFile(new URL("backend/fakepf/recordings/long.sse", root), "utf8"))
  .split("\n")
  .filter((line) => line.includes('"FINAL_RESPONSE"'))
  .map((line) => JSON.parse(line.slice(6)).content.response)[0];
const SHORT = "The library is open from 10:00 to 18:00 on Sundays. In exam weeks it stays open until 22:00.";

// [gallery:name] answers with an example from web/widget/src/render/gallery, and [injection] with every attempt in
// its security corpus, so the browser tests draw exactly what the unit tests do.
const GALLERY = new URL("web/widget/src/render/gallery/", root);
async function answerFor(question) {
  const example = question.match(/\[gallery:([a-z]+)\]/);
  if (example) return readFile(new URL(`${example[1]}.md`, GALLERY), "utf8");
  if (question.includes("[injection]")) {
    return JSON.parse(await readFile(new URL("injection.json", GALLERY), "utf8")).join("\n\n");
  }
  return question.includes("[long]") ? long : SHORT;
}

// The strict content policy the embed page will carry in production (M4-T3 adds the per-widget frame-ancestors).
// The chat needs only its own origin, plus the host of the widget's logo; anything an answer tried to load or run
// is refused.
const policyFor = (widget) =>
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; " +
  `img-src 'self' ${new URL(configs[widget].logo_url).origin}; base-uri 'none'; form-action 'none'`;

async function file(path) {
  if (path === "/loader.js") return [200, types.js, await readFile(new URL("web/loader/dist/loader.js", root))];
  const config = path.match(/^\/v1\/widgets\/([\w-]+)\/config$/);
  if (config) {
    const body = configs[config[1]];
    return body ? [200, types.json, JSON.stringify(body)] : [404, types.json, "{}"];
  }
  const embed = path.match(/^\/embed\/([\w-]+)$/);
  if (embed && STAND_IN.has(embed[1])) return [200, types.html, await readFile(new URL("e2e/chat-stub.html", root))];
  if (embed) {
    const chat = await readFile(new URL("web/widget/dist/index.html", root));
    return [200, types.html, chat, { "content-security-policy": policyFor(embed[1]) }];
  }
  const asset = path.match(/^\/assets\/([\w.-]+)\.(js|css|woff2)$/);
  if (asset) return [200, types[asset[2]], await readFile(new URL(`web/widget/dist/assets/${asset[1]}.${asset[2]}`, root))];
  const sample = path.match(/^\/(college|hosted)\/([a-z]+)\.(html|js)$/);
  if (sample) return [200, types[sample[3]], await samplePage(sample[1], `${sample[2]}.${sample[3]}`)];
  const page = path.match(/^\/hosts\/([a-z-]+)\.html$/);
  if (page) return [200, types.html, await readFile(new URL(`e2e/hosts/${page[1]}.html`, root))];
  return [404, "text/plain", "not found"];
}

// The fake gateway. Words in a message pick a behaviour, as the fake PF does: [long], [gallery:name], [injection],
// [slow], [busy], [fail], [drop] (the stream is cut, but the answer still finishes and can be fetched) and [expire]
// (the session ends once per question).
let next = 0;
const id = (prefix) => `${prefix}_${(++next).toString(36)}`;
const sessions = new Set();
const expired = new Set(); // questions whose session has already been ended once
const messages = new Map();
const problem = (code) => ({ code, message: "test gateway", retryable: true, retry_after: null, reference: id("r") });

function json(response, status, body) {
  response.writeHead(status, { "content-type": types.json, "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function stream(response, conversationId, body) {
  const envelope = { v: 1, conversation_id: conversationId, message_id: id("m"), correlation_id: id("r") };
  const text = await answerFor(body.text);
  const record = { id: envelope.message_id, role: "assistant", status: "in_progress", blocks: [], error: null };
  messages.set(envelope.message_id, { ...record, created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z") });
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  let seq = 0;
  const send = (event) => response.write(`data: ${JSON.stringify({ ...envelope, seq: seq++, ...event })}\n\n`);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  response.write(": ping\n\n");
  send({ type: "message.started" });
  await pause(body.text.includes("[slow]") ? 5000 : 400); // a moment of "finding an answer"
  send({ type: "content_block.started", index: 0, block: { type: "markdown", text: "" } });
  const words = text.match(/\S+\s*/g) ?? [];
  for (let at = 0; at < words.length; at += 3) {
    if (body.text.includes("[drop]") && at >= 6) {
      // Cut the stream; the answer finishes anyway, as PF's does, and the fetch call returns it a moment later.
      setTimeout(() => {
        const block = { type: "markdown", text };
        messages.set(envelope.message_id, { ...messages.get(envelope.message_id), status: "complete", blocks: [block] });
      }, 1500);
      return response.destroy();
    }
    if (body.text.includes("[fail]") && at >= 6) {
      send({ type: "message.failed", error: problem("assistant_unavailable") });
      return response.end();
    }
    send({ type: "content_block.delta", index: 0, text: words.slice(at, at + 3).join("") });
    await pause(25);
  }
  const block = { type: "markdown", text };
  send({ type: "content_block.completed", index: 0, block });
  send({ type: "message.completed" });
  messages.set(envelope.message_id, { ...messages.get(envelope.message_id), status: "complete", blocks: [block] });
  response.end();
}

async function gateway(request, response, path) {
  if (request.method === "POST" && path === "/v1/sessions") {
    const body = await readBody(request);
    if (!body || !configs[body.widget_id]) return json(response, 400, problem("invalid_request"));
    const token = id("s");
    sessions.add(token);
    return json(response, 200, { token, expires_in: 3600 });
  }
  if (!sessions.has((request.headers.authorization ?? "").replace(/^Bearer /, ""))) {
    return json(response, 401, problem("session_expired"));
  }
  if (request.method === "POST" && path === "/v1/conversations") {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return json(response, 201, { id: id("c"), title: null, created_at: now, updated_at: now });
  }
  const send = path.match(/^\/v1\/conversations\/([\w-]+)\/messages$/);
  if (request.method === "POST" && send) {
    const body = await readBody(request);
    if (typeof body?.text !== "string" || !/\S/.test(body.text)) return json(response, 400, problem("invalid_request"));
    if (body.text.includes("[busy]")) return json(response, 429, { ...problem("rate_limited"), retry_after: 30 });
    if (body.text.includes("[expire]") && !expired.has(body.client_message_id)) {
      expired.add(body.client_message_id);
      sessions.delete(request.headers.authorization.replace(/^Bearer /, ""));
      return json(response, 401, problem("session_expired"));
    }
    return stream(response, send[1], body);
  }
  const read = path.match(/^\/v1\/conversations\/[\w-]+\/messages\/([\w-]+)$/);
  if (request.method === "GET" && read && messages.has(read[1])) return json(response, 200, messages.get(read[1]));
  return json(response, 404, problem("not_found"));
}

// A stand-in for a customer's backend, on the host's own origin: it signs a host token for the signed-in user
// named in the address, with the Node snippet a customer would copy (examples/token-signing), and counts calls.
const portal = JSON.parse(await readFile(new URL("e2e/widgets.json", root), "utf8"));
const [secretId, secret] = portal.test_host_secrets["portal-test"].split(":");
Object.assign(process.env, {
  UCP_WIDGET_SECRET: secret,
  UCP_SECRET_ID: secretId,
  UCP_ISSUER: portal.widgets.w_portal.identity.issuer,
  UCP_WIDGET_ID: "w_portal",
});
const { widgetToken } = await import(new URL("examples/token-signing/node/sign.mjs", root));
const tokenCalls = {};

function portalBackend(url, response) {
  const user = url.searchParams.get("user");
  if (url.pathname === "/portal/calls") return json(response, 200, tokenCalls);
  if (!user) return json(response, 401, { error: "not signed in" });
  tokenCalls[user] = (tokenCalls[user] ?? 0) + 1;
  response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
  response.end(tokenFor("w_portal", user));
}

const tokenFor = (widget, user) => {
  process.env.UCP_WIDGET_ID = widget; // the snippet reads its settings on each call, and this runs to the end at once
  return widgetToken(user);
};

// The College's sample pages (examples/college) and our hosted copies (its hosted folder, over the same files),
// filled in as infra/aws/deploy.py fills them for the dev environment, but with this machine's gateway.
const FILLED = { "{{GATEWAY}}": "http://localhost:8200", "{{WIDGET}}": "w_college", "{{DEMO_WIDGET}}": "w_college_demo" };
async function samplePage(folder, name) {
  const read = (where) => readFile(new URL(`examples/college/${where}${name}`, root), "utf8");
  const text = folder === "hosted" ? await read("hosted/").catch(() => read("")) : await read("");
  return text.replace(/\{\{[A-Z_]+\}\}/g, (key) => FILLED[key]);
}

// The College's backend for its sample portal: the resident signed in to this site (a cookie here) gets a token.
function collegeBackend(request, response) {
  const user = request.headers.cookie?.match(/(?:^|; )resident=([\w-]+)/)?.[1];
  if (!user) return json(response, 401, { error: "not signed in" });
  response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
  response.end(tokenFor("w_college", user));
}

// The hosted samples' sign-in, run as CloudFront runs it, with this machine's test secret in place of the real one.
const demoCode = (await readFile(new URL("infra/aws/dev/functions/demo-token.js", root), "utf8")).replace(
  "${secret}",
  portal.test_host_secrets.demo.split(":")[1],
);
const demoToken = runInNewContext(`${demoCode}\nhandler`, { require: () => ({ createHmac }), btoa });
function demoSignIn(url, response) {
  const querystring = Object.fromEntries([...url.searchParams].map(([name, value]) => [name, { value }]));
  const reply = demoToken({ request: { querystring }, context: { requestId: randomUUID() } });
  const headers = Object.fromEntries(Object.entries(reply.headers).map(([name, header]) => [name, header.value]));
  response.writeHead(reply.statusCode, headers);
  response.end(reply.body.data);
}

createServer(async (request, response) => {
  const url = new URL(request.url, "http://x");
  const path = url.pathname;
  if (path.startsWith("/portal/")) return portalBackend(url, response);
  if (path === "/widget-token") return collegeBackend(request, response);
  if (path === "/demo-token") return demoSignIn(url, response);
  if (path.startsWith("/v1/") && !path.endsWith("/config")) return gateway(request, response, path);
  const [status, type, body, headers] = await file(path).catch(() => [404, "text/plain", "not found"]);
  // The configuration is public and read from the customer's page, so any origin may read it, without cookies.
  response.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}).listen(4174);
