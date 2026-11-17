import { expect, test } from "vitest";

import { colourNotes } from "../src/look";

test("a button colour is read out with the text on it, and warned about where it would not stand out", () => {
  expect(colourNotes("#5B2A86")).toEqual({
    text: "Text on it: white, 9.9 : 1",
    warnings: ["On dark screens this colour gives way to a light grey, so the buttons stay visible."],
  });
  expect(colourNotes("#EA580C").warnings).toEqual([]); // 3.6:1 on both composers
  expect(colourNotes("#2B241F").warnings).toEqual(["On dark screens this colour gives way to a light grey, so the buttons stay visible."]);
  expect(colourNotes("#F4F4F2").warnings).toEqual(["On light screens these buttons hardly stand out from the chat's light background."]);
  expect(colourNotes("purple")).toEqual({ text: "", warnings: ["Write the colour as # and six digits, for example #5B2A86."] });
});
