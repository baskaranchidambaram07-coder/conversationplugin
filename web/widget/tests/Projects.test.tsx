import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "../src/App";
import { strings as t } from "../src/strings";

// Projects: a signed-in visitor's folders of chats, opened from the list, started, renamed, deleted, and filed into.
const LOADER = "https://college.example";
const CONFIG = {
  v: 1,
  widget_id: "w_1",
  title: "Ask the College",
  welcome_message: "Hello.",
  suggested_prompts: [],
  ai_notice: null,
  brand_color: "#5B2A86",
  logo_url: null,
  color_scheme: "auto",
  launcher_position: "bottom-right",
  history_enabled: true,
};
const AT = "2026-11-18T10:00:00Z";
const chat = (id: string, title: string | null, project_id: string | null = null) => ({
  id,
  title,
  created_at: AT,
  updated_at: AT,
  project_id,
});
const project = (id: string, name: string) => ({ id, name, created_at: AT, updated_at: AT });
const answered = (conversation: string, text: string) =>
  [
    { seq: 0, type: "message.started" },
    { seq: 1, type: "content_block.completed", index: 0, block: { type: "markdown", text } },
    { seq: 2, type: "message.completed" },
  ]
    .map((event) => `data: ${JSON.stringify({ v: 1, conversation_id: conversation, message_id: "m_9", correlation_id: "r_1", ...event })}\n\n`)
    .join("");

/** A gateway holding projects in memory, as the real one does, and answering every question. */
function gateway() {
  let projects = [project("p_fees", "Fees")];
  const filed: Record<string, string | null> = { c_old: null };
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    if (path.endsWith("/config")) return Response.json(CONFIG);
    if (path === "/v1/sessions") return Response.json({ token: "s_1", expires_in: 900 });
    if (path === "/v1/projects" && method === "GET") return Response.json({ projects });
    if (path === "/v1/projects" && method === "POST") {
      const made = project(`p_${projects.length + 1}`, body.name);
      projects = [made, ...projects];
      return Response.json(made, { status: 201 });
    }
    const one = path.match(/^\/v1\/projects\/([\w-]+)$/);
    if (one && method === "PATCH") {
      projects = projects.map((each) => (each.id === one[1] ? { ...each, name: body.name } : each));
      return Response.json(projects.find((each) => each.id === one[1]));
    }
    if (one && method === "DELETE") {
      projects = projects.filter((each) => each.id !== one[1]);
      return new Response(null, { status: 204 });
    }
    if (path === "/v1/conversations?project=p_fees&limit=50") return Response.json({ conversations: [chat("c_due", "When are fees due?", "p_fees")], next: null });
    if (path.startsWith("/v1/conversations?project=")) return Response.json({ conversations: [], next: null });
    if (path === "/v1/conversations" && method === "POST") {
      filed.c_new = body?.project_id ?? null;
      return Response.json(chat("c_new", null, filed.c_new), { status: 201 });
    }
    if (path === "/v1/conversations") return Response.json({ conversations: [chat("c_old", "Gym hours")], next: null });
    const moved = path.match(/^\/v1\/conversations\/([\w-]+)$/);
    if (moved && method === "PATCH") {
      filed[moved[1]!] = body.project_id;
      return Response.json(chat(moved[1]!, "Gym hours", body.project_id));
    }
    if (path === "/v1/conversations/c_old/messages") return Response.json({ messages: [], next: null });
    const asked = path.match(/^\/v1\/conversations\/([\w-]+)\/messages$/);
    if (asked && method === "POST") return new Response(answered(asked[1]!, "Fees are due on the first."));
    throw new Error(`unexpected call ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, filed };
}

function framed() {
  const target = new EventTarget();
  const parent = {
    postMessage: vi.fn((data: { type: string; id?: number }) => {
      if (data.type === "get-token") queueMicrotask(() => deliver({ type: "token", id: data.id, token: "h_1" }));
    }),
  };
  const deliver = (data: object) =>
    target.dispatchEvent(Object.assign(new Event("message"), { data: { ucp: 1, ...data }, origin: LOADER, source: parent }));
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const win = Object.assign(target, { parent, matchMedia }) as unknown as Window;
  return { win, start: () => deliver({ type: "init", mode: "floating", signedIn: true }) };
}

async function open() {
  const stub = gateway();
  const { win, start } = framed();
  render(<App widgetId="w_1" win={win} />);
  act(start);
  await screen.findByRole("heading", { name: "Ask the College" });
  return stub;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a project is opened from the list, shows its chats, and a question asked on its page starts a chat filed there", async () => {
  const { fetcher, filed } = await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(within(await screen.findByRole("navigation", { name: t.chats })).getByRole("button", { name: t.projects }));

  expect(await screen.findByRole("heading", { name: t.projects })).toBe(document.activeElement);
  expect(screen.queryByRole("textbox", { name: t.input })).toBeNull(); // the list of projects asks nothing
  fireEvent.click(await screen.findByRole("button", { name: /Fees/ }));

  expect(await screen.findByRole("heading", { name: "Fees" })).toBe(document.activeElement);
  expect(await screen.findByRole("button", { name: /When are fees due\?/ })).toBeTruthy();
  const field = screen.getByRole("textbox", { name: t.input });
  expect(field.getAttribute("placeholder")).toBe(t.askInProject("Fees"));

  fireEvent.change(field, { target: { value: "And the deposit?" } });
  fireEvent.keyDown(field, { key: "Enter" });

  expect(await screen.findByText("Fees are due on the first.")).toBeTruthy();
  expect(filed.c_new).toBe("p_fees");
  const started = fetcher.mock.calls.find(([path, init]) => path === "/v1/conversations" && init?.method === "POST");
  expect(JSON.parse(started![1]!.body as string)).toEqual({ project_id: "p_fees" });
  expect(screen.getByRole("button", { name: "Fees", expanded: false })).toBeTruthy(); // the chat says where it is filed
});

test("a new project is named in place and opened; renamed; deleted after a second word", async () => {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(screen.getByRole("button", { name: t.projects }));
  fireEvent.click(await screen.findByRole("button", { name: t.newProject }));

  const name = screen.getByRole("textbox", { name: t.projectName });
  fireEvent.change(name, { target: { value: "Moving in" } });
  fireEvent.click(screen.getByRole("button", { name: t.create }));
  expect(await screen.findByRole("heading", { name: "Moving in" })).toBeTruthy();
  expect(await screen.findByText(t.noProjectChats)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: t.rename }));
  fireEvent.change(screen.getByRole("textbox", { name: t.projectName }), { target: { value: "Arrival" } });
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  expect(await screen.findByRole("heading", { name: "Arrival" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: t.deleteProject }));
  expect(screen.getByText(t.confirmDelete("Arrival"))).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: t.cancel })); // focus starts on the safe choice
  fireEvent.click(screen.getByRole("button", { name: t.delete }));

  expect(await screen.findByRole("heading", { name: t.projects })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("button", { name: /Arrival/ })).toBeNull());
  expect(screen.getByRole("button", { name: /Fees/ })).toBeTruthy();
});

test("an open chat is filed under a project, or a new one, from the top of the conversation", async () => {
  const { filed } = await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(await screen.findByRole("button", { name: /Gym hours/ }));

  const control = await screen.findByRole("button", { name: t.addToProject });
  fireEvent.click(control);
  const card = screen.getByRole("group", { name: t.projectFor });
  expect(within(card).getByRole("button", { name: t.noProject }).getAttribute("aria-current")).toBe("true");
  fireEvent.click(within(card).getByRole("button", { name: "Fees" }));

  await waitFor(() => expect(filed.c_old).toBe("p_fees"));
  expect(screen.queryByRole("group", { name: t.projectFor })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fees", expanded: false }));

  fireEvent.click(screen.getByRole("button", { name: "Fees", expanded: false }));
  fireEvent.click(screen.getByRole("button", { name: t.newProject }));
  fireEvent.change(screen.getByRole("textbox", { name: t.projectName }), { target: { value: "Sport" } });
  fireEvent.click(screen.getByRole("button", { name: t.create }));

  await waitFor(() => expect(filed.c_old).toBe("p_2"));
  expect(await screen.findByRole("button", { name: "Sport", expanded: false })).toBeTruthy();
});

test("Escape closes the filing card, not the chat", async () => {
  await open();
  fireEvent.click(await screen.findByRole("button", { name: t.chats }));
  fireEvent.click(await screen.findByRole("button", { name: /Gym hours/ }));
  fireEvent.click(await screen.findByRole("button", { name: t.addToProject }));

  fireEvent.keyDown(within(screen.getByRole("group", { name: t.projectFor })).getByRole("button", { name: "Fees" }), {
    key: "Escape",
  });

  expect(screen.queryByRole("group", { name: t.projectFor })).toBeNull();
  expect(screen.getByRole("textbox", { name: t.input })).toBeTruthy();
});
