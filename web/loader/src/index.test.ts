// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { contrast } from "@ucp/protocol/brand";

import { fullScreen, settings, start, VERSION } from "./index";

type Host = Window & { UCP?: unknown };
const host = window as Host;
const ORIGIN = "https://chat.example";
const CONFIG = { v: 1, widget_id: "w_1", title: "Ask us" };

function script(attributes: Record<string, string> = {}) {
  const element = document.createElement("script");
  element.src = `${ORIGIN}/loader.js`;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function serve(respond: () => Promise<Response> = async () => Response.json(CONFIG)) {
  const fetch = vi.fn((_url: string, _init?: RequestInit) => respond());
  host.fetch = fetch as unknown as typeof window.fetch;
  return fetch;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const widgets = () => document.querySelectorAll("[data-ucp]").length;
const requested = (fetch: ReturnType<typeof serve>) => fetch.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  delete host.UCP;
  document.body.innerHTML = "";
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test("the loader carries a three-part version", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

test("a script tag with a widget ID fetches its configuration from the loader's own origin, without cookies", async () => {
  const fetch = serve();
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();

  expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/v1/widgets/w_1/config`, { credentials: "omit" });
  expect(widgets()).toBe(1);
});

test("calls made before the loader arrived run in order, and a queued mount wins over the script tag", async () => {
  const fetch = serve();
  host.UCP = function (...args: unknown[]) {
    const stub = host.UCP as { q?: unknown[] };
    (stub.q = stub.q ?? []).push(args);
  };
  const call = host.UCP as (...args: unknown[]) => void;
  call("mount", { widgetId: "w_2" });
  call("unmount");
  call("mount", { widgetId: "w_3" });
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();

  expect(requested(fetch)).toEqual([`${ORIGIN}/v1/widgets/w_2/config`, `${ORIGIN}/v1/widgets/w_3/config`]);
  expect(widgets()).toBe(1);
});

test("loading the script twice, or mounting twice, changes nothing", async () => {
  const fetch = serve();
  start(script({ "data-widget-id": "w_1" }), host);
  const api = host.UCP as (command: string, options?: object) => void;
  start(script({ "data-widget-id": "w_1" }), host);
  api("mount", { widgetId: "w_1" });
  await settle();

  expect(host.UCP).toBe(api);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(widgets()).toBe(1);
});

test("a page that already uses the name UCP for something else is left alone", () => {
  const fetch = serve();
  const theirs = { version: "theirs" };
  host.UCP = theirs;
  start(script({ "data-widget-id": "w_1" }), host);

  expect(host.UCP).toBe(theirs);
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["../admin", "w 1", "", "w".repeat(65)])("the widget ID %j is refused before any request", (widgetId) => {
  const fetch = serve();
  start(script({ "data-debug": "" }), host);
  (host.UCP as (command: string, options: object) => void)("mount", { widgetId });

  expect(fetch).not.toHaveBeenCalled();
  if (widgetId) expect(console.info).toHaveBeenCalledWith(`UCP: ✗ "${widgetId}" is not a widget ID`);
});

test.each([
  ["the network fails", () => Promise.reject(new TypeError("Failed to fetch")), "Failed to fetch"],
  ["the widget is unknown", async () => new Response("", { status: 404 }), "HTTP 404"],
  ["the answer is not JSON", async () => new Response("<html>"), ""],
])("when %s, nothing is drawn, nothing is thrown, and debug mode says why", async (_, respond, reason) => {
  serve(respond as () => Promise<Response>);
  start(script({ "data-widget-id": "w_1", "data-debug": "" }), host);
  await settle();

  expect(widgets()).toBe(0);
  const line = vi.mocked(console.info).mock.lastCall?.[0] as string;
  expect(line).toContain(`UCP: ✗ configuration not loaded from ${ORIGIN}/v1/widgets/w_1/config (`);
  expect(line).toContain(reason);
});

test("broken calls from the host page throw nothing", () => {
  serve();
  start(script(), host);
  const api = host.UCP as (...args: unknown[]) => void;

  expect(() => {
    api("mount");
    api("mount", null);
    api("mount", { widgetId: 42 });
    api("explode");
    api();
  }).not.toThrow();
});

test("unmount removes the widget, even when its configuration arrives afterwards", async () => {
  serve();
  start(script({ "data-widget-id": "w_1" }), host);
  const api = host.UCP as (command: string, options?: object) => void;
  api("unmount");
  await settle();
  expect(widgets()).toBe(0);

  api("mount", { widgetId: "w_1" });
  await settle();
  api("unmount");
  expect(widgets()).toBe(0);
});

test("the checklist is printed only in debug mode", async () => {
  serve();
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();
  expect(console.info).not.toHaveBeenCalled();

  delete host.UCP;
  start(script({ "data-widget-id": "w_1", "data-debug": "" }), host);
  await settle();
  expect(console.info).toHaveBeenCalledWith("UCP: ✓ configuration loaded");
});

test("the loader stores nothing on the visitor's device", async () => {
  serve();
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();

  expect([localStorage.length, sessionStorage.length, document.cookie]).toEqual([0, 0, ""]);
});

test.each([
  [{ title: "  Ask the College  ", brand_color: "#5B2A86", launcher_position: "bottom-left" }, "Ask the College", "#5B2A86", true],
  [{ title: "", brand_color: "purple" }, "Chat", "#2b241f", false],
  [{ title: "x".repeat(200), brand_color: "#5B2A86\n" }, "x".repeat(80), "#2b241f", false],
  [{ title: 42, brand_color: "red;background:url(x)", launcher_position: "top-right" }, "Chat", "#2b241f", false],
])("configuration %j is read safely", (config, title, color, left) => {
  expect(settings(config as never)).toMatchObject({ title, color, left });
});

test("the launcher icon keeps at least 4.5:1 contrast on any brand colour", () => {
  const worst = Math.min(
    ...Array.from({ length: 4096 }, (_, n) => {
      const color = `#${[n >> 8, (n >> 4) & 15, n & 15].map((d) => (d * 17).toString(16).padStart(2, "0")).join("")}`;
      return contrast(color, settings({ brand_color: color }).ink);
    }),
  );

  expect(worst).toBeGreaterThanOrEqual(4.5);
});

test.each([
  [320, 640, true],
  [599, 900, true],
  [600, 900, false],
  [844, 390, true],
  [640, 360, true],
  [1440, 900, false],
])("at %i by %i px, full screen is %s", (width, height, expected) => {
  expect(fullScreen(width, height)).toBe(expected);
});

const root = () => (document.querySelector("[data-ucp]") as HTMLElement).shadowRoot as ShadowRoot;
const launcher = () => root().querySelector("button") as HTMLButtonElement;
const frame = () => root().querySelector("iframe");
const api = () => host.UCP as (command: string, options?: object) => void;

test("the launcher takes its name, colour and corner from the configuration, and mount options cannot change them", async () => {
  serve(async () => Response.json({ ...CONFIG, brand_color: "#5B2A86", launcher_position: "bottom-left" }));
  start(script(), host);
  api()("mount", { widgetId: "w_1", title: "Hacked", brand_color: "#ff0000", launcher_position: "bottom-right" });
  await settle();

  expect(launcher().getAttribute("aria-label")).toBe("Ask us");
  expect(launcher().getAttribute("aria-expanded")).toBe("false");
  const style = (root().querySelector(".w") as HTMLElement).style;
  expect([style.getPropertyValue("--brand"), style.getPropertyValue("--ink")]).toEqual(["#5B2A86", "#ffffff"]);
  expect(root().querySelector(".w")?.classList.contains("left")).toBe(true);
});

test("a title is never read as markup", async () => {
  serve(async () => Response.json({ ...CONFIG, title: '<img src=x onerror="alert(1)">' }));
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();

  expect(root().querySelector("img")).toBeNull();
  expect(launcher().getAttribute("aria-label")).toBe('<img src=x onerror="alert(1)">');
});

test("the chat page is requested only when the visitor first opens the chat, and kept when it closes", async () => {
  serve();
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();
  expect(frame()).toBeNull();

  launcher().click();
  const iframe = frame() as HTMLIFrameElement;
  expect([iframe.src, iframe.title, iframe.allow]).toEqual([`${ORIGIN}/embed/w_1`, "Ask us", "clipboard-write"]);
  expect(launcher().getAttribute("aria-expanded")).toBe("true");
  expect(root().activeElement).toBe(iframe);

  launcher().click();
  expect(launcher().getAttribute("aria-expanded")).toBe("false");
  expect(frame()).toBe(iframe);
});

test("Escape closes the chat and puts focus back on the launcher", async () => {
  serve();
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();
  launcher().click();
  frame()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));

  expect(launcher().getAttribute("aria-expanded")).toBe("false");
  expect(root().activeElement).toBe(launcher());
});

test("open, close and toggle work from the page, including before the configuration has arrived", async () => {
  serve();
  start(script({ "data-widget-id": "w_1" }), host);
  api()("open");
  await settle();
  expect(launcher().getAttribute("aria-expanded")).toBe("true");

  api()("toggle");
  expect(launcher().getAttribute("aria-expanded")).toBe("false");
  api()("close");
  expect(launcher().getAttribute("aria-expanded")).toBe("false");
});

test("on a narrow screen the open chat locks the page's scroll, and closing or unmounting gives it back", async () => {
  serve();
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(375);
  document.documentElement.style.overflow = "scroll";
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();

  api()("open");
  expect(document.documentElement.style.overflow).toBe("hidden");
  api()("close");
  expect(document.documentElement.style.overflow).toBe("scroll");
  api()("open");
  api()("unmount");
  expect(document.documentElement.style.overflow).toBe("scroll");
  document.documentElement.style.overflow = "";
});

test("inline placement draws the chat inside the named element, with no launcher", async () => {
  serve();
  document.body.innerHTML = '<section id="help"></section>';
  start(script({ "data-widget-id": "w_1", "data-target": "#help" }), host);
  await settle();

  expect(document.querySelector("#help [data-ucp]")).not.toBeNull();
  expect(launcher()).toBeNull();
  expect(frame()?.src).toBe(`${ORIGIN}/embed/w_1`);
});

test.each(["#nowhere", "[[["])("a target %j that matches nothing draws nothing, throws nothing, and debug says why", async (target) => {
  serve();
  start(script({ "data-widget-id": "w_1", "data-target": target, "data-debug": "" }), host);
  await settle();

  expect(widgets()).toBe(0);
  expect(console.info).toHaveBeenCalledWith(`UCP: ✗ no element on the page matches "${target}"`);
});

/** jsdom gives an iframe inside a Shadow DOM no window, so lend it a real one from the light DOM. */
function lendWindow(iframe: HTMLIFrameElement) {
  const donor = document.createElement("iframe");
  document.body.appendChild(donor);
  const chat = donor.contentWindow as Window;
  Object.defineProperty(iframe, "contentWindow", { get: () => chat });
  return chat;
}

test.each([
  ["our own chat, from our origin", true, ORIGIN, { ucp: 1, type: "close" }, "false"],
  ["another origin", true, "https://evil.example", { ucp: 1, type: "close" }, "true"],
  ["another window", false, ORIGIN, { ucp: 1, type: "close" }, "true"],
  ["a message of another version", true, ORIGIN, { ucp: 2, type: "close" }, "true"],
])("a close request from %s is obeyed only when it should be", async (_, fromOurFrame, origin, data, expanded) => {
  serve();
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();
  launcher().click();
  const chat = lendWindow(frame() as HTMLIFrameElement);
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: fromOurFrame ? chat : window }));

  expect(launcher().getAttribute("aria-expanded")).toBe(expanded);
});

test("unmount removes the listener it added to the page's window", async () => {
  serve();
  const removed = vi.spyOn(window, "removeEventListener");
  start(script({ "data-widget-id": "w_1" }), host);
  await settle();
  api()("unmount");

  expect(removed.mock.calls.some(([type]) => type === "message")).toBe(true);
});

async function openWithBridge(options: object = {}) {
  serve();
  start(script(), host);
  api()("mount", { widgetId: "w_1", ...options });
  await settle();
  api()("open");
  const chat = lendWindow(frame() as HTMLIFrameElement);
  const sent = vi.spyOn(chat, "postMessage");
  const fromChat = (data: unknown, origin = ORIGIN) => window.dispatchEvent(new MessageEvent("message", { data, origin, source: chat }));
  return { sent, fromChat };
}

test("when the chat says ready, the loader tells it the mode and sign-in state, pinned to our origin", async () => {
  const { sent, fromChat } = await openWithBridge({ debug: true });
  fromChat({ ucp: 1, type: "ready", addedInALaterRelease: true });

  expect(sent.mock.calls).toEqual([
    [{ ucp: 1, type: "init", mode: "floating", signedIn: false }, ORIGIN],
    [{ ucp: 1, type: "shown" }, ORIGIN],
  ]);
  expect(console.info).toHaveBeenCalledWith("UCP: ✓ chat connected");
});

test("a ready from another origin is ignored", async () => {
  const { sent, fromChat } = await openWithBridge();
  fromChat({ ucp: 1, type: "ready" }, "https://evil.example");

  expect(sent).not.toHaveBeenCalled();
});

test("each later opening tells a connected chat it is shown, so it can take focus", async () => {
  const { sent, fromChat } = await openWithBridge();
  fromChat({ ucp: 1, type: "ready" });
  api()("close");
  sent.mockClear();
  api()("open");

  expect(sent.mock.calls).toEqual([[{ ucp: 1, type: "shown" }, ORIGIN]]);
});

test.each([
  ["a string", () => "signed-by-host", "signed-by-host", "UCP: ✓ token supplied"],
  ["a promise of a string", async () => "signed-by-host", "signed-by-host", "UCP: ✓ token supplied"],
  ["a number", () => 42, null, "UCP: ✗ getToken gave no token"],
  ["an empty string", () => "", null, "UCP: ✗ getToken gave no token"],
  ["a throw", () => { throw new Error("no session"); }, null, "UCP: ✗ getToken failed (no session)"],
  ["a rejection", () => Promise.reject(new Error("offline")), null, "UCP: ✗ getToken failed (offline)"],
])("when getToken gives %s, the chat receives a string or null and nothing is thrown", async (_, getToken, token, line) => {
  const { sent, fromChat } = await openWithBridge({ getToken, debug: true });
  fromChat({ ucp: 1, type: "ready" });
  expect(sent.mock.calls[0]?.[0]).toMatchObject({ type: "init", signedIn: true });
  fromChat({ ucp: 1, type: "get-token", id: 7 });
  await settle();

  expect(sent.mock.lastCall).toEqual([{ ucp: 1, type: "token", id: 7, token }, ORIGIN]);
  expect(console.info).toHaveBeenCalledWith(line);
});

test("an anonymous widget answers a token request with null and never calls anything", async () => {
  const { sent, fromChat } = await openWithBridge();
  fromChat({ ucp: 1, type: "get-token", id: 2 });

  expect(sent.mock.calls).toEqual([[{ ucp: 1, type: "token", id: 2, token: null }, ORIGIN]]);
});

test("a chat that never says ready is reported after 10 seconds in debug mode, and not before", async () => {
  serve();
  start(script({ "data-widget-id": "w_1", "data-debug": "" }), host);
  await settle();
  vi.useFakeTimers();
  try {
    api()("open");
    vi.advanceTimersByTime(9_999);
    expect(vi.mocked(console.info).mock.lastCall?.[0]).toBe("UCP: ✓ configuration loaded");
    vi.advanceTimersByTime(1);
    expect(vi.mocked(console.info).mock.lastCall?.[0]).toContain("UCP: ✗ chat did not connect within 10 s");
  } finally {
    vi.useRealTimers();
  }
});

test("inline placement tells the chat it is inline", async () => {
  serve();
  document.body.innerHTML = '<section id="help"></section>';
  start(script({ "data-widget-id": "w_1", "data-target": "#help" }), host);
  await settle();
  const chat = lendWindow(frame() as HTMLIFrameElement);
  const sent = vi.spyOn(chat, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { data: { ucp: 1, type: "ready" }, origin: ORIGIN, source: chat }));

  expect(sent.mock.calls[0]?.[0]).toEqual({ ucp: 1, type: "init", mode: "inline", signedIn: false });
});
