import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "../src/App";
import { excerpt } from "../src/Pinned";
import { strings as t } from "../src/strings";

// Pinned answers: pinned under an answer, listed on their own page, and opened back in their chat.
const CONFIG = {
  v: 1,
  widget_id: "w_1",
  title: "Ask the College",
  welcome_message: null,
  suggested_prompts: [],
  ai_notice: null,
  brand_color: "#5B2A86",
  logo_url: null,
  color_scheme: "auto",
  launcher_position: "bottom-right",
  history_enabled: true,
};
const AT = "2026-11-18T10:00:00Z";
const CHAT = { id: "c_rent", title: "When is rent due?", created_at: AT, updated_at: AT, project_id: null };
const message = (id: string, role: "user" | "assistant", text: string, pinned = false) => ({
  id,
  role,
  status: "complete",
  blocks: [{ type: role === "user" ? "text" : "markdown", text }],
  error: null,
  created_at: AT,
  pinned,
});
const PINNED = message("m_old", "assistant", "## Rent\n\nRent is due on the **first** of each month.", true);

/** A long chat: the pinned answer is on the second page back, so opening it has to reach for it. */
function gateway() {
  const pins = [{ conversation: CHAT, question: "When is rent due?", message: PINNED, pinned_at: AT }];
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path.endsWith("/config")) return Response.json(CONFIG);
    if (path === "/v1/sessions") return Response.json({ token: "s_1", expires_in: 900 });
    if (path === "/v1/projects") return Response.json({ projects: [] });
    if (path === "/v1/pins") return Response.json({ pins });
    if (path === "/v1/conversations") return Response.json({ conversations: [CHAT], next: null });
    if (path === "/v1/conversations/c_rent/messages")
      return Response.json({ messages: [message("m_3", "user", "Thanks"), message("m_4", "assistant", "You are welcome.")], next: "3" });
    if (path === "/v1/conversations/c_rent/messages?before=3")
      return Response.json({ messages: [message("m_1", "user", "When is rent due?"), PINNED], next: null });
    if (path.endsWith("/pin") && (method === "PUT" || method === "DELETE")) return new Response(null, { status: 204 });
    throw new Error(`unexpected call ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function open() {
  const fetcher = gateway();
  const target = new EventTarget();
  const parent = {
    postMessage: vi.fn((data: { type: string; id?: number }) => {
      if (data.type === "get-token") queueMicrotask(() => deliver({ type: "token", id: data.id, token: "h_1" }));
    }),
  };
  const deliver = (data: object) =>
    target.dispatchEvent(
      Object.assign(new Event("message"), { data: { ucp: 1, ...data }, origin: "https://college.example", source: parent }),
    );
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const win = Object.assign(target, { parent, matchMedia }) as unknown as Window;
  render(<App widgetId="w_1" win={win} />);
  act(() => deliver({ type: "init", mode: "floating", signedIn: true }));
  await screen.findByRole("heading", { name: "Ask the College" });
  return fetcher;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("an excerpt is the answer's words without its Markdown", () => {
  expect(excerpt("## Rent\n\nRent is due on the **first**.\n\n- by card\n- by `transfer`")).toBe(
    "Rent Rent is due on the first. by card by transfer",
  );
  expect(excerpt("See [the portal](https://example.org) and\n```python\nprint(1)\n```")).toBe(
    "See the portal and print(1)",
  );
  expect(excerpt("| Day | Time |\n|---|---|\n| Mon | 9 |")).toBe("Day Time --- --- Mon 9");
});

test("an answer is pinned and unpinned from under it, and the visitor is told", async () => {
  const fetcher = await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(await screen.findByRole("button", { name: /When is rent due\?/ }));
  const pin = await screen.findByRole("button", { name: t.pin });
  expect(pin.getAttribute("aria-pressed")).toBe("false");

  fireEvent.click(pin);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(t.pinnedNow));
  expect(pin.getAttribute("aria-pressed")).toBe("true");
  const pinned = fetcher.mock.calls.find(([path]) => String(path).endsWith("/pin"));
  expect(pinned).toEqual(["/v1/conversations/c_rent/messages/m_4/pin", expect.objectContaining({ method: "PUT" })]);

  fireEvent.click(pin);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(t.unpinnedNow));
  expect(pin.getAttribute("aria-pressed")).toBe("false");
});

test("the Pinned page lists each answer under its question and opens it in its chat, reaching back for it", async () => {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(within(screen.getByRole("navigation", { name: t.chats })).getByRole("button", { name: t.pinned }));

  expect(await screen.findByRole("heading", { name: t.pinned })).toBe(document.activeElement);
  const row = await screen.findByRole("button", { name: /Rent is due on the first/ });
  expect(row.querySelector(".asked")?.textContent).toBe("When is rent due?");
  expect(row.querySelector(".excerpt")?.textContent).toBe("Rent Rent is due on the first of each month.");

  fireEvent.click(row);

  const answer = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-answer="m_old"]');
    expect(found).not.toBeNull();
    return found!;
  });
  await waitFor(() => expect(document.activeElement).toBe(answer));
  expect(answer.classList.contains("found")).toBe(true);
  expect(within(answer).getByRole("button", { name: t.pin }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: t.earlier })).toBeNull(); // the whole chat came back to reach it
});

test("an answer unpinned on the Pinned page leaves it", async () => {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(screen.getByRole("button", { name: t.pinned }));

  fireEvent.click(await screen.findByRole("button", { name: t.unpin }));

  expect(await screen.findByText(t.noPins)).toBeTruthy();
});
