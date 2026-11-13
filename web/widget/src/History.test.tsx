import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";
import { strings as t } from "./strings";

// The history panel (M2-T8): a signed-in visitor's earlier chats, opened, carried on, and a new chat for everyone.
const LOADER = "https://college.example";
const CONFIG = {
  v: 1,
  widget_id: "w_1",
  title: "Ask the College",
  welcome_message: "Hello.",
  suggested_prompts: ["When does the library open?"],
  ai_notice: null,
  brand_color: "#5B2A86",
  logo_url: null,
  color_scheme: "auto",
  launcher_position: "bottom-right",
  history_enabled: true,
};
const chat = (id: string, title: string | null, updated_at = "2026-11-12T10:00:00Z") => ({
  id,
  title,
  created_at: updated_at,
  updated_at,
});
const message = (id: string, role: "user" | "assistant", text: string) => ({
  id,
  role,
  status: "complete",
  blocks: [{ type: role === "user" ? "text" : "markdown", text }],
  error: null,
  created_at: "2026-11-12T10:00:00Z",
});
const envelope = { v: 1, conversation_id: "c_new", message_id: "m_9", correlation_id: "r_1" };
const answered = (text: string) =>
  [
    { ...envelope, seq: 0, type: "message.started" },
    { ...envelope, seq: 1, type: "content_block.completed", index: 0, block: { type: "markdown", text } },
    { ...envelope, seq: 2, type: "message.completed" },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");

/** A chat framed by a loader that says whether the visitor is signed in, and answers token requests. */
function framed(signedIn: boolean) {
  const target = new EventTarget();
  const deliver = (data: object) =>
    target.dispatchEvent(Object.assign(new Event("message"), { data: { ucp: 1, ...data }, origin: LOADER, source: parent }));
  const parent = {
    postMessage: vi.fn((data: { type: string; id?: number }) => {
      if (data.type === "get-token") queueMicrotask(() => deliver({ type: "token", id: data.id, token: "h_1" }));
    }),
  };
  const win = Object.assign(target, { parent }) as unknown as Window;
  return { win, start: () => deliver({ type: "init", mode: "floating", signedIn }) };
}

/** The gateway: two earlier chats (a page of older ones behind them), a long chat, and an answer to every question. */
function gateway(config = CONFIG) {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const post = init?.method === "POST";
    if (path.endsWith("/config")) return Response.json(config);
    if (path === "/v1/sessions") return Response.json({ token: "s_1", expires_in: 900 });
    if (path === "/v1/conversations" && post) return Response.json(chat("c_new", null));
    if (path === "/v1/conversations")
      return Response.json({
        conversations: [chat("c_long", "Room bookings"), chat("c_empty", null), chat("c_old", "When does the library open?")],
        next: "cursor-1",
      });
    if (path === "/v1/conversations?before=cursor-1")
      return Response.json({ conversations: [chat("c_older", "Laundry")], next: null });
    if (path === "/v1/conversations/c_old/messages")
      return Response.json({
        messages: [message("m_1", "user", "When does the library open?"), message("m_2", "assistant", "At eight.")],
        next: null,
      });
    if (path === "/v1/conversations/c_long/messages")
      return Response.json({
        messages: [message("m_3", "user", "Can I book a room?"), message("m_4", "assistant", "Yes, online.")],
        next: "2",
      });
    if (path === "/v1/conversations/c_long/messages?before=2")
      return Response.json({
        messages: [message("m_1", "user", "Hello"), message("m_2", "assistant", "Hi, how can I help?")],
        next: null,
      });
    if (path.endsWith("/messages") && post) return new Response(answered("Sunday: ten to four."));
    throw new Error(`unexpected call ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function open(signedIn = true, config = CONFIG) {
  const fetcher = gateway(config);
  const { win, start } = framed(signedIn);
  render(<App widgetId="w_1" win={win} />);
  start();
  await screen.findByRole("heading", { name: "Ask the College" });
  return { fetcher, win };
}

const texts = () => screen.queryAllByRole("article").map((article) => article.textContent);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("a signed-in visitor opens the list of their chats: titled ones, newest first, with older ones on demand", async () => {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));

  const list = await screen.findByRole("navigation", { name: t.chats });
  await within(list).findByRole("button", { name: /Room bookings/ });
  expect(within(list).getAllByRole("listitem").map((item) => item.querySelector(".topic")?.textContent)).toEqual([
    "Room bookings",
    "When does the library open?",
  ]); // a chat with no question yet has nothing to reopen
  expect(screen.queryByRole("textbox", { name: t.input })).toBeNull(); // the list stands in for the conversation
  expect(screen.getByRole("button", { name: t.back }).getAttribute("aria-expanded")).toBe("true");
  await waitFor(() => expect(document.activeElement?.textContent).toBe(t.chats));

  fireEvent.click(within(list).getByRole("button", { name: t.olderChats }));
  await within(list).findByRole("button", { name: /Laundry/ });
  expect(within(list).queryByRole("button", { name: t.olderChats })).toBeNull();
});

test("an earlier chat opens where it left off, and the next question carries on in it", async () => {
  const { fetcher } = await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(await screen.findByRole("button", { name: /When does the library open\?/ }));

  await waitFor(() => expect(texts()).toEqual([`${t.answer}At eight.${t.copy}`]));
  expect(screen.getByText("When does the library open?", { selector: ".mine" })).toBeTruthy();
  expect(screen.queryByRole("navigation")).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: t.input })));
  expect(screen.getByText(t.opened("When does the library open?"))).toBeTruthy(); // said to screen readers

  fireEvent.change(screen.getByRole("textbox", { name: t.input }), { target: { value: "And on Sunday?" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: t.input }), { key: "Enter" });

  await waitFor(() => expect(texts()).toHaveLength(2));
  const sent = fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([path]) => path);
  expect(sent).toEqual(["/v1/sessions", "/v1/conversations/c_old/messages"]); // no new chat was started
  fireEvent.click(screen.getByRole("button", { name: t.chats }));
  const current = await screen.findByRole("button", { name: /When does the library open\?/ });
  expect(current.getAttribute("aria-current")).toBe("true");
});

test("earlier messages of a long chat load above, on demand", async () => {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(await screen.findByRole("button", { name: /Room bookings/ }));
  await waitFor(() => expect(texts()).toHaveLength(1));

  fireEvent.click(screen.getByRole("button", { name: t.earlier }));

  await waitFor(() => expect(texts()).toHaveLength(2));
  expect(texts()[0]).toContain("Hi, how can I help?");
  expect(screen.queryByRole("button", { name: t.earlier })).toBeNull();
});

test("Escape leaves the list and returns to the button that opened it", async () => {
  const { win } = await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  await screen.findByRole("navigation", { name: t.chats });

  win.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  await waitFor(() => expect(screen.queryByRole("navigation")).toBeNull());
  expect(screen.getByRole("textbox", { name: t.input })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: t.chats })));
});

test("anonymous visitors, and widgets without history, get no list; anyone gets a new chat once they have asked", async () => {
  for (const [signedIn, config] of [
    [false, CONFIG],
    [true, { ...CONFIG, history_enabled: false }],
  ] as const) {
    await open(signedIn, config);
    expect(screen.queryByRole("button", { name: t.chats })).toBeNull();
    expect(screen.queryByRole("button", { name: t.startChat })).toBeNull(); // nothing to leave yet

    fireEvent.click(screen.getByRole("button", { name: "When does the library open?" }));
    await waitFor(() => expect(texts()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: t.startChat }));

    expect(texts()).toEqual([]);
    expect(screen.getByRole("button", { name: "When does the library open?" })).toBeTruthy(); // the prompts return
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: t.input })));
    cleanup();
  }
});

test("with no earlier chats, the list says where they will appear", async () => {
  const fetcher = gateway();
  fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/config")) return Response.json(CONFIG);
    if (path === "/v1/sessions") return Response.json({ token: "s_1", expires_in: 900 });
    if (path === "/v1/conversations" && !init?.method) return Response.json({ conversations: [], next: null });
    throw new Error(`unexpected call ${path}`);
  });
  const { win, start } = framed(true);
  render(<App widgetId="w_1" win={win} />);
  start();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));

  expect(await screen.findByText(t.noChats)).toBeTruthy();
  expect(screen.getByRole("button", { name: t.startChat })).toBeTruthy();
});
