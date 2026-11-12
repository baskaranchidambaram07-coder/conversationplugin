import { expect, test } from "vitest";

import { Failure } from "./api";
import { problemOf } from "./problem";

const failure = (status: number, code?: string) =>
  new Failure(
    status,
    code ? ({ code, message: "gateway words", retryable: true, retry_after: null, reference: "r_9" } as never) : null,
  );

test.each([
  ["no network while offline", new Failure(0, null), false, "offline", null, true],
  ["no network while online", new Failure(0, null), true, "unavailable", null, true],
  ["too many requests", failure(429, "rate_limited"), true, "busy", "r_9", true],
  ["an ended session", failure(401, "session_expired"), true, "expired", "r_9", false],
  ["a site not allowed", failure(403, "site_not_allowed"), true, "notAllowed", "r_9", false],
  ["a refused widget", failure(403, "forbidden"), true, "notAllowed", "r_9", false],
  ["the assistant down", failure(502, "assistant_unavailable"), true, "unavailable", "r_9", true],
  ["a server error without a body", failure(503), true, "unavailable", null, true],
  ["a refused request", failure(400, "invalid_request"), true, "failed", "r_9", true],
  ["something that is not a Failure", new Error("boom"), true, "failed", null, true],
])("%s becomes the right state", (_, error, online, kind, reference, retryable) => {
  expect(problemOf(error, online)).toEqual({ kind, reference, retryable });
});
