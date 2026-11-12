import { expect, test } from "vitest";

import { VERSION } from "./index";

test("the loader carries a three-part version", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
