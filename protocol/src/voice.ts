// The languages a visitor may speak and hear (M11), shared by the console and the chat. The list itself is
// backend/ucp/protocol.py's VOICE_LANGUAGES; tests/voice.test.ts holds this copy to the schema.
import type { VoiceLanguage } from "./v1";

export const VOICE_LANGUAGES = [
  "en-GB", "en-US", "en-AU", "en-IN", "en-IE", "en-NZ", "en-ZA",
  "ar-AE", "de-DE", "es-ES", "es-US", "fr-CA", "fr-FR", "hi-IN", "it-IT",
  "ja-JP", "ko-KR", "nl-NL", "pt-BR", "pt-PT", "zh-CN",
] as const satisfies readonly VoiceLanguage[]; // prettier-ignore

const languages = new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" });
const regions = new Intl.DisplayNames(["en"], { type: "region" });

/** "English (United Kingdom)": a language's full name, in English. */
export const languageName = (code: VoiceLanguage) => languages.of(code) ?? code;

/** The languages grouped by their language, "English" first, then the rest by name, each with its regions. */
export function languageGroups(): { name: string; variants: { code: VoiceLanguage; region: string }[] }[] {
  const groups = new Map<string, { code: VoiceLanguage; region: string }[]>();
  for (const code of VOICE_LANGUAGES) {
    const [language = code, region = ""] = code.split("-");
    const name = languages.of(language) ?? language;
    groups.set(name, [...(groups.get(name) ?? []), { code, region: regions.of(region) ?? region }]);
  }
  return [...groups].map(([name, variants]) => ({ name, variants })).sort((a, b) =>
    a.name === "English" ? -1 : b.name === "English" ? 1 : a.name.localeCompare(b.name),
  );
}
