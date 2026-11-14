import { expect, test } from "vitest";

import { colourNotes } from "./look";

test("a button colour is read out with the text on it, and warned about where it would not stand out", () => {
  expect(colourNotes("#5B2A86")).toEqual({ text: "Text on it: white, 9.9 : 1", warnings: [] });
  expect(colourNotes("#2B241F").warnings).toEqual(["On dark screens this colour gives way to cream, so the buttons stay visible."]);
  expect(colourNotes("#FFF4E8").warnings).toEqual(["On light screens these buttons hardly stand out from the chat's cream background."]);
  expect(colourNotes("purple")).toEqual({ text: "", warnings: ["Write the colour as # and six digits, for example #5B2A86."] });
});
