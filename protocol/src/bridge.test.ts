import { expect, test } from "vitest";

import { fromChat, fromLoader } from "./bridge";

test.each([
  { ucp: 1, type: "ready" },
  { ucp: 1, type: "close" },
  { ucp: 1, type: "get-token", id: 3 },
  { ucp: 1, type: "ready", addedInALaterRelease: true },
])("the loader accepts %j", (message) => {
  expect(fromChat(message)).toBe(message);
});

test.each([
  null,
  "ready",
  { type: "ready" },
  { ucp: 2, type: "ready" },
  { ucp: "1", type: "ready" },
  { ucp: 1, type: "added-in-a-later-release" },
  { ucp: 1, type: "get-token" },
  { ucp: 1, type: "get-token", id: "3" },
  { ucp: 1, type: "get-token", id: 1.5 },
  { ucp: 1, type: "init", mode: "floating", signedIn: false },
])("the loader drops %j", (message) => {
  expect(fromChat(message)).toBeNull();
});

test.each([
  { ucp: 1, type: "init", mode: "floating", signedIn: false },
  { ucp: 1, type: "init", mode: "inline", signedIn: true },
  { ucp: 1, type: "token", id: 3, token: "abc" },
  { ucp: 1, type: "token", id: 3, token: null },
  { ucp: 1, type: "shown" },
  { ucp: 1, type: "hidden" },
])("the chat accepts %j", (message) => {
  expect(fromLoader(message)).toBe(message);
});

test.each([
  { ucp: 1, type: "init", mode: "full-page", signedIn: false },
  { ucp: 1, type: "init", mode: "floating" },
  { ucp: 1, type: "token", id: 3 },
  { ucp: 1, type: "token", id: 3, token: 42 },
  { ucp: 1, type: "ready" },
  { ucp: 2, type: "shown" },
])("the chat drops %j", (message) => {
  expect(fromLoader(message)).toBeNull();
});
