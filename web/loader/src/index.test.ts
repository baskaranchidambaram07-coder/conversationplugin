// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { start, VERSION } from "./index";

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
