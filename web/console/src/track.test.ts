import { expect, test } from "vitest";

import { stations, timeLeft } from "./track";

const states = (track: ReturnType<typeof stations>) => track.map((station) => `${station.id}:${station.state}`);

test("a new widget starts at the agent, with the whole journey's minutes left", () => {
  const track = stations({ set: [], version: null, unpublished: false, signedIn: false });

  expect(states(track)).toEqual(["agent:now", "sites:next", "sign-in:next", "look:next", "install:next", "live:next"]);
  expect(timeLeft(track)).toBe(19);
});

test("a widget for signed-in visitors takes longer to set up and to install", () => {
  expect(timeLeft(stations({ set: [], version: null, unpublished: false, signedIn: true }))).toBe(41);
});

test("a configured draft waits at install; a live widget is done; changes not published reopen go-live", () => {
  const configured = { set: ["agent", "sites", "sign-in", "look"] as const, signedIn: false };
  const draft = stations({ ...configured, set: [...configured.set], version: null, unpublished: true });
  const live = stations({ ...configured, set: [...configured.set], version: 3, unpublished: false });
  const changed = stations({ ...configured, set: [...configured.set], version: 3, unpublished: true });

  expect(states(draft).slice(4)).toEqual(["install:now", "live:next"]);
  expect([timeLeft(draft), timeLeft(live), timeLeft(changed)]).toEqual([5, 0, 2]);
  expect(states(changed).at(-1)).toBe("live:now");
});
