import { expect, test, vi } from "vitest";

import { Failure, gateway } from "./api";

const expired = () =>
  Response.json(
    { code: "session_expired", message: "Your session has ended.", retryable: true, retry_after: null, reference: "r_1" },
    { status: 401 },
  );
const conversation = { id: "c_1", title: null, created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z" };

/** A gateway that answers from a script: each call takes the next reply. */
function scripted(...replies: (() => Response | Promise<Response>)[]) {
  let session = 0;
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => {
    if (path === "/v1/sessions") return Response.json({ token: `s_${++session}`, expires_in: 3600 });
    const reply = replies.shift();
    if (!reply) throw new Error(`no reply scripted for ${path}`);
    return reply();
  });
  const calls = () =>
    fetcher.mock.calls.map(([path, init]) => [path, (init?.headers as Record<string, string>)?.authorization ?? null]);
  return { fetcher: fetcher as unknown as typeof fetch, calls, mock: fetcher };
}

test("the first call starts a session for the widget, then every call carries it, never with cookies", async () => {
  const { fetcher, calls, mock } = scripted(() => Response.json(conversation));
  await gateway("w_1", async () => null, fetcher).conversation();

  expect(calls()).toEqual([
    ["/v1/sessions", null],
    ["/v1/conversations", "Bearer s_1"],
  ]);
  expect(JSON.parse(mock.mock.calls[0]?.[1]?.body as string)).toEqual({ widget_id: "w_1", host_token: null });
  expect(mock.mock.calls.every(([, init]) => init?.credentials === "omit")).toBe(true);
});

test("a signed-in visitor's expired session is renewed once, with a fresh host token, and the call replayed", async () => {
  const hostToken = vi.fn(async () => "host-token");
  const { fetcher, calls } = scripted(expired, () => Response.json(conversation));
  const reply = await gateway("w_1", hostToken, fetcher).conversation();

  expect(reply).toEqual(conversation);
  expect(hostToken).toHaveBeenCalledTimes(2);
  expect(calls().map(([, token]) => token)).toEqual([null, "Bearer s_1", null, "Bearer s_2"]);
});

test("a second expiry in a row is not renewed again", async () => {
  const { fetcher } = scripted(expired, expired);

  await expect(gateway("w_1", async () => "host-token", fetcher).conversation()).rejects.toMatchObject({
    status: 401,
    error: { code: "session_expired" },
  });
});

test("an anonymous visitor's expired session is reported, not renewed", async () => {
  const { fetcher, calls } = scripted(expired);

  await expect(gateway("w_1", async () => null, fetcher).conversation()).rejects.toBeInstanceOf(Failure);
  expect(calls()).toHaveLength(2);
});

test("a network failure, and an error without a readable body, still become a Failure", async () => {
  const offline = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  await expect(gateway("w_1", async () => null, offline).start()).rejects.toMatchObject({ status: 0, error: null });

  const { fetcher } = scripted(() => new Response("<html>Bad gateway</html>", { status: 502 }));
  await expect(gateway("w_1", async () => null, fetcher).conversation()).rejects.toMatchObject({
    status: 502,
    error: null,
  });
});

test("a session that failed to start is tried again by the next call", async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (path: string) => {
    if (path === "/v1/sessions" && ++attempts === 1) return new Response("", { status: 503 });
    if (path === "/v1/sessions") return Response.json({ token: "s_2", expires_in: 3600 });
    return Response.json(conversation);
  }) as unknown as typeof fetch;
  const api = gateway("w_1", async () => null, fetcher);

  await expect(api.conversation()).rejects.toMatchObject({ status: 503 });
  await expect(api.conversation()).resolves.toEqual(conversation);
});

test("stopping a reply passes the abort through instead of reporting a failure", async () => {
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/v1/sessions") return Response.json({ token: "s_1", expires_in: 3600 });
    init?.signal?.throwIfAborted();
    return new Response("");
  }) as unknown as typeof fetch;
  const stop = new AbortController();
  stop.abort();

  await expect(
    gateway("w_1", async () => null, fetcher).send("c_1", { text: "Hi", client_message_id: "cm_1" }, stop.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
