import { expect, test } from "vitest";

import { asDefault, colourNotes, withLanguage } from "../src/look";

test("a button colour is read out with the text on it, and warned about where it would not stand out", () => {
  expect(colourNotes("#5B2A86")).toEqual({
    text: "Text on it: white, 9.9 : 1",
    warnings: ["On dark screens this colour gives way to a light grey, so the buttons stay visible."],
  });
  expect(colourNotes("#EA580C").warnings).toEqual([]); // 3.6:1 on the light composer, 4.3:1 on the dark
  expect(colourNotes("#2B241F").warnings).toEqual(["On dark screens this colour gives way to a light grey, so the buttons stay visible."]);
  expect(colourNotes("#F4F4F2").warnings).toEqual(["On light screens these buttons hardly stand out from the chat's light background."]);
  expect(colourNotes("purple")).toEqual({ text: "", warnings: ["Write the colour as # and six digits, for example #5B2A86."] });
});

test("voice languages: ticking adds at the end, clearing keeps at least one, and the default moves to the front", () => {
  expect(withLanguage(["en-GB"], "hi-IN", true)).toEqual(["en-GB", "hi-IN"]);
  expect(withLanguage(["en-GB", "hi-IN"], "hi-IN", true)).toEqual(["en-GB", "hi-IN"]);
  expect(withLanguage(["en-GB", "hi-IN"], "en-GB", false)).toEqual(["hi-IN"]); // the next one becomes the default
  expect(withLanguage(["fr-FR"], "fr-FR", false)).toEqual(["fr-FR"]);
  expect(asDefault(["en-GB", "hi-IN", "fr-FR"], "fr-FR")).toEqual(["fr-FR", "en-GB", "hi-IN"]);
});
