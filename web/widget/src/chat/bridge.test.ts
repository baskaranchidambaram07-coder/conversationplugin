import { expect, test, vi } from "vitest";

import { connect } from "./bridge";

const LOADER = "https://college.example";

/** A framed window: its parent records what the chat posts, and messages can be delivered as if from anyone. */
function framed() {
  const parent = { postMessage: vi.fn() };
  const target = new EventTarget();
  const win = Object.assign(target, { parent }) as unknown as Window;
  const deliver = (data: unknown, origin = LOADER, source: unknown = parent) =>
    target.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));
  return { win, parent, deliver };
}

test("the chat says ready to whoever framed it, and carries nothing in that message", () => {
  const { win, parent } = framed();
  connect(win, { init: () => {}, shown: () => {}, hidden: () => {} });

  expect(parent.postMessage).toHaveBeenCalledWith({ ucp: 1, type: "ready" }, "*");
});

test("it trusts the first init from its parent, and from then on only that origin", () => {
  const { win, parent, deliver } = framed();
  const onInit = vi.fn();
  const onShown = vi.fn();
  const bridge = connect(win, { init: onInit, shown: onShown, hidden: () => {} });
  deliver({ ucp: 1, type: "init", mode: "floating", signedIn: true });
  deliver({ ucp: 1, type: "init", mode: "inline", signedIn: false }, "https://evil.example");
  deliver({ ucp: 1, type: "shown" }, "https://evil.example");
  deliver({ ucp: 1, type: "shown" }, LOADER, {}); // the right origin, but not the parent window
  bridge.close();

  expect(onInit.mock.calls).toEqual([["floating", true]]);
  expect(onShown).not.toHaveBeenCalled();
  expect(parent.postMessage).toHaveBeenLastCalledWith({ ucp: 1, type: "close" }, LOADER);
});

test("a token request is answered by the loader, matched by its number", async () => {
  const { win, parent, deliver } = framed();
  const bridge = connect(win, { init: () => {}, shown: () => {}, hidden: () => {} });
  deliver({ ucp: 1, type: "init", mode: "floating", signedIn: true });
  const first = bridge.token();
  const second = bridge.token();
  deliver({ ucp: 1, type: "token", id: 2, token: "second" });
  deliver({ ucp: 1, type: "token", id: 1, token: null });

  expect(await first).toBeNull();
  expect(await second).toBe("second");
  expect(parent.postMessage).toHaveBeenCalledWith({ ucp: 1, type: "get-token", id: 1 }, LOADER);
});

test("before the loader has answered, or with no answer in 10 seconds, there is no token", async () => {
  vi.useFakeTimers();
  try {
    const { win, deliver } = framed();
    const bridge = connect(win, { init: () => {}, shown: () => {}, hidden: () => {} });
    expect(await bridge.token()).toBeNull();

    deliver({ ucp: 1, type: "init", mode: "floating", signedIn: true });
    const unanswered = bridge.token();
    vi.advanceTimersByTime(10_000);
    expect(await unanswered).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("opened as a page of its own, the chat is a full page with no bridge", () => {
  const win = { parent: undefined } as unknown as Window;
  (win as { parent: Window }).parent = win;
  const onInit = vi.fn();
  connect(win, { init: onInit, shown: () => {}, hidden: () => {} });

  expect(onInit).toHaveBeenCalledWith("page", false);
});

test("the panel opening and closing reach the chat as shown and hidden", () => {
  const { win, deliver } = framed();
  const on = { init: vi.fn(), shown: vi.fn(), hidden: vi.fn() };
  connect(win, on);
  deliver({ ucp: 1, type: "init", mode: "floating", signedIn: false });
  deliver({ ucp: 1, type: "hidden" });
  deliver({ ucp: 1, type: "shown" });

  expect([on.hidden.mock.calls.length, on.shown.mock.calls.length]).toEqual([1, 1]);
});
