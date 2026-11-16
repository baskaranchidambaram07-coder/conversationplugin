import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App, forDark, readConfig } from "./App";
import { strings as t } from "./strings";

const CONFIG = {
  v: 1,
  widget_id: "w_1",
  title: "Ask the College",
  welcome_message: "Hello. Ask me about accommodation, events or the library.",
  suggested_prompts: ["When does the library open?", "How do I book a guest room?"],
  ai_notice: null,
  brand_color: "#5B2A86",
  logo_url: null,
  color_scheme: "auto",
  launcher_position: "bottom-right",
  history_enabled: false,
};
const envelope = { v: 1, conversation_id: "c_1", message_id: "m_1", correlation_id: "r_42" };
const error = (code: string) => ({ code, message: "gateway words", retryable: true, retry_after: null, reference: "r_42" });
const conversation = { id: "c_1", title: null, created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z" };

function streamOf(events: object[], signal?: AbortSignal, keepOpen = false) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
        if (!keepOpen) controller.close();
      },
    }),
  );
}

const answered = (text: string) => [
  { ...envelope, seq: 0, type: "message.started" },
  { ...envelope, seq: 1, type: "content_block.started", index: 0, block: { type: "markdown", text: "" } },
  { ...envelope, seq: 2, type: "content_block.delta", index: 0, text },
  { ...envelope, seq: 3, type: "content_block.completed", index: 0, block: { type: "markdown", text } },
  { ...envelope, seq: 4, type: "message.completed" },
];

/** The gateway for one test: the configuration, a session, a conversation, then `reply` for each message sent. */
function gatewayAnswering(reply: (signal?: AbortSignal) => Response | Promise<Response>) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/config")) return Response.json(CONFIG);
    if (path === "/v1/sessions") return Response.json({ token: "s_1", expires_in: 3600 });
    if (path === "/v1/conversations") return Response.json(conversation);
    return reply(init?.signal ?? undefined);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const field = () => screen.getByLabelText(t.input) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const enter = (init: object = {}) => fireEvent.keyDown(field(), { key: "Enter", ...init });

beforeEach(() => vi.spyOn(window, "postMessage").mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("the chat shows the configured title, the AI notice, the welcome, the suggested questions and the credit", async () => {
  gatewayAnswering(() => new Response());
  render(<App widgetId="w_1" />);

  expect(await screen.findByRole("heading", { name: "Ask the College" })).toBeTruthy();
  expect(screen.getByText(t.notice)).toBeTruthy();
  expect(screen.getByText(CONFIG.welcome_message)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /library|guest room/ })).toHaveLength(2);
  expect(screen.getByText(t.credit)).toBeTruthy();
  expect(screen.getByText("AT")).toBeTruthy(); // initials stand in for a missing logo
});

test("a logo that fails to load gives way to the title's initials", async () => {
  gatewayAnswering(() => new Response());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ...CONFIG, logo_url: "https://example.org/missing.svg" })),
  );
  const { container } = render(<App widgetId="w_1" />);
  await screen.findByRole("heading", { name: "Ask the College" });
  fireEvent.error(container.querySelector(".logo img") as HTMLImageElement);

  expect(container.querySelector(".logo img")).toBeNull();
  expect(screen.getByText("AT")).toBeTruthy();
});

test("a configuration that cannot load shows a plain problem and a retry that loads it", async () => {
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (++attempts === 1 ? new Response("", { status: 503 }) : Response.json(CONFIG))),
  );
  render(<App widgetId="w_1" />);

  expect((await screen.findByRole("alert")).textContent).toContain(t.problems.unavailable);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  expect(await screen.findByRole("heading", { name: "Ask the College" })).toBeTruthy();
});

test("configuration values are read safely", () => {
  expect(
    readConfig({ title: "  ", brand_color: "purple", logo_url: "javascript:alert(1)", suggested_prompts: ["", "Hi", 5] as never }),
  ).toMatchObject({ title: "Chat", color: "#2b241f", logo: null, prompts: ["Hi"], notice: t.notice });
});

test("on the dark ground a brand keeps its colour unless it nearly vanishes there", () => {
  expect(["#7C3AED", "#5B2A86", "#1e3a8a", "#2b241f", "#000000", "#333333"].map(forDark)).toEqual([
    "#7C3AED",
    "#5B2A86",
    "#1e3a8a",
    "#f2e9df",
    "#f2e9df",
    "#f2e9df",
  ]);
});

test("Enter sends; Shift+Enter, an input method composing, or blank text does not", async () => {
  const fetcher = gatewayAnswering(() => streamOf(answered("Open 10:00 to 18:00.")));
  render(<App widgetId="w_1" />);
  await screen.findByRole("heading", { name: "Ask the College" });
  const sends = () => fetcher.mock.calls.filter(([path]) => path.endsWith("/messages")).length;

  type("   ");
  enter();
  type("When does it open?");
  enter({ shiftKey: true });
  enter({ isComposing: true });
  enter({ keyCode: 229 });
  expect(sends()).toBe(0);

  enter();
  expect(await screen.findByText("Open 10:00 to 18:00.")).toBeTruthy();
  expect(sends()).toBe(1);
  expect(field().value).toBe("");
});

test("the character count appears only near the 4,000 limit", async () => {
  gatewayAnswering(() => new Response());
  render(<App widgetId="w_1" />);
  await screen.findByRole("heading", { name: "Ask the College" });

  type("x".repeat(3000));
  expect(screen.queryByText(/characters left/)).toBeNull();
  type("x".repeat(3700));
  expect(screen.getByText("300 characters left")).toBeTruthy();
  expect(field().maxLength).toBe(4000);
});

test("a suggested question streams its answer, the suggestions go, and the finished answer is announced once", async () => {
  gatewayAnswering(() => streamOf(answered("The library opens at 10:00.")));
  render(<App widgetId="w_1" />);
  fireEvent.click(await screen.findByRole("button", { name: "When does the library open?" }));

  expect(await screen.findByText("The library opens at 10:00.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "How do I book a guest room?" })).toBeNull();
  expect(screen.getByRole("status").textContent).toBe(t.answered("The library opens at 10:00."));
  expect(screen.getByRole("button", { name: t.copy })).toBeTruthy();
});

test("a failure in the middle of an answer keeps the text, says what happened, and offers a retry", async () => {
  let call = 0;
  gatewayAnswering(() =>
    ++call === 1
      ? streamOf([...answered("Partial").slice(0, 3), { ...envelope, seq: 3, type: "message.failed", error: error("assistant_unavailable") }])
      : streamOf(answered("Complete answer.")),
  );
  render(<App widgetId="w_1" />);
  fireEvent.click(await screen.findByRole("button", { name: "When does the library open?" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(t.problems.unavailable);
  expect(alert.textContent).toContain(t.reference("r_42"));
  expect(alert.textContent).not.toContain("gateway words");
  expect(screen.getByText("Partial")).toBeTruthy();

  fireEvent.click(within(alert).getByRole("button", { name: t.retry }));
  expect(await screen.findByText("Complete answer.")).toBeTruthy();
  expect(screen.queryByText("Partial")).toBeNull();
});

test("too many messages is explained, with a retry", async () => {
  gatewayAnswering(() => Response.json(error("rate_limited"), { status: 429 }));
  render(<App widgetId="w_1" />);
  fireEvent.click(await screen.findByRole("button", { name: "When does the library open?" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(t.problems.busy);
  expect(within(alert).getByRole("button", { name: t.retry })).toBeTruthy();
});

test("an anonymous visitor's ended session stops the conversation and offers a new chat", async () => {
  gatewayAnswering(() => Response.json(error("session_expired"), { status: 401 }));
  render(<App widgetId="w_1" />);
  fireEvent.click(await screen.findByRole("button", { name: "When does the library open?" }));

  await waitFor(() => expect(screen.getAllByText(t.problems.expired).length).toBeGreaterThan(0));
  expect(field().disabled).toBe(true);
  expect(screen.queryByRole("button", { name: t.retry })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: t.newChat }));
  expect(field().disabled).toBe(false);
  expect(screen.queryByText(t.problems.expired)).toBeNull();
});

test("the send button becomes stop while an answer arrives, and stopping keeps what arrived", async () => {
  gatewayAnswering((signal) => streamOf(answered("Half an answer").slice(0, 3), signal, true));
  render(<App widgetId="w_1" />);
  fireEvent.click(await screen.findByRole("button", { name: "When does the library open?" }));
  await screen.findByText("Half an answer");

  fireEvent.click(screen.getByRole("button", { name: t.stop }));
  expect(await screen.findByText(t.stopped)).toBeTruthy();
  expect(screen.getByText("Half an answer")).toBeTruthy();
  expect(screen.getByRole("button", { name: t.send })).toBeTruthy();
});

test("a block type this chat does not know shows its plain text, or says it cannot be shown", async () => {
  gatewayAnswering(() =>
    streamOf([
      { ...envelope, seq: 0, type: "message.started" },
      { ...envelope, seq: 1, type: "content_block.completed", index: 0, block: { type: "chart", text: "Sales rose." } },
      { ...envelope, seq: 2, type: "content_block.completed", index: 1, block: { type: "poll" } },
      { ...envelope, seq: 3, type: "message.completed" },
    ]),
  );
  render(<App widgetId="w_1" />);
  fireEvent.click(await screen.findByRole("button", { name: "When does the library open?" }));

  expect(await screen.findByText("Sales rose.")).toBeTruthy();
  expect(screen.getByText(t.unknownBlock)).toBeTruthy();
});

test("the console's preview draws the settings it is sent, only from the console's own address, and sends nothing", async () => {
  const fetched = vi.fn();
  vi.stubGlobal("fetch", fetched);
  render(<App widgetId="" preview />);
  const send = (origin: string, title: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin,
        data: { ucp: 1, type: "preview", config: { ...CONFIG, title }, scheme: "dark" },
      }),
    );

  send("https://elsewhere.example", "Not ours");
  send(location.origin, "Ask Riverside");

  expect(await screen.findByRole("heading", { name: "Ask Riverside" })).toBeTruthy();
  expect(screen.queryByText("Not ours")).toBeNull();
  expect(document.documentElement.dataset.scheme).toBe("dark");
  expect(screen.getByRole("textbox", { name: t.input })).toHaveProperty("disabled", true);
  expect(screen.getByRole("textbox", { name: t.input }).getAttribute("placeholder")).toBe(t.previewPlaceholder);
  expect(screen.getByRole("button", { name: "When does the library open?" })).toHaveProperty("disabled", true);
  expect(fetched).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.scheme;
});
