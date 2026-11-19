import { expect, test } from "vitest";

import schema from "../schema/v1.json";
import { languageGroups, languageName, VOICE_LANGUAGES } from "../src/voice";

test("the shared list of voice languages is the schema's, in the same order", () => {
  expect(VOICE_LANGUAGES).toEqual(schema.$defs.VoiceLanguage.enum);
});

test("languages are grouped by language, English first, each named with its regions", () => {
  const groups = languageGroups();
  expect(groups[0]).toMatchObject({ name: "English", variants: expect.arrayContaining([{ code: "en-GB", region: "United Kingdom" }]) });
  expect(groups.map((group) => group.name).slice(1)).toEqual([...groups.map((group) => group.name).slice(1)].sort());
  expect(groups.flatMap((group) => group.variants.map((variant) => variant.code)).sort()).toEqual([...VOICE_LANGUAGES].sort());
  expect(languageName("hi-IN")).toBe("Hindi (India)");
});
